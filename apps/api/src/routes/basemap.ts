import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { FetchSource, PMTiles } from 'pmtiles';
import { layers, namedFlavor } from '@protomaps/basemaps';
import { db } from '../db/index.js';
import { env } from '../env.js';

/**
 * Mapa base OpenStreetMap para la app, servido por nuestro servidor.
 *
 * Los servidores de openstreetmap.org prohíben descargar zonas para uso offline, así que
 * las teselas vectoriales se leen (por rangos) de la compilación pública diaria de Protomaps,
 * que está hecha para extraer regiones, y se guardan en MinIO: cada tesela se pide una sola vez.
 * El teléfono descarga la zona del proyecto desde aquí (paquete offline de MapLibre).
 *
 * Público (sin sesión) porque MapLibre descarga sin cabeceras, pero limitado a la zona de los
 * proyectos: fuera de ella solo se sirven los niveles de zoom generales.
 */

const BUILDS_URL = 'https://build-metadata.protomaps.dev/builds.json';
const BUILD_BASE = 'https://build.protomaps.com/';
const ASSETS_BASE = 'https://protomaps.github.io/basemaps-assets/';
export const BASEMAP_MAX_ZOOM = 15;
/** Por debajo de este zoom se sirve cualquier zona (mapa general del país). */
const FREE_ZOOM = 7;
/** Margen alrededor de cada proyecto (grados, ~15 km). */
const MARGIN_DEG = 0.15;
const ATTRIBUTION = '© OpenStreetMap contributors · Protomaps';

let archive: { pm: PMTiles; build: string; at: number } | null = null;
async function getArchive(): Promise<PMTiles> {
  if (archive && Date.now() - archive.at < 24 * 3600 * 1000) return archive.pm;
  let url = env.BASEMAP_PMTILES_URL;
  if (!url) {
    const builds = (await (await fetch(BUILDS_URL)).json()) as { key: string }[];
    const latest = builds.map((b) => b.key).filter((k) => /^\d{8}\.pmtiles$/.test(k)).sort().at(-1);
    if (!latest) throw new Error('No hay compilaciones de Protomaps disponibles');
    url = BUILD_BASE + latest;
  }
  archive = { pm: new PMTiles(new FetchSource(url)), build: url, at: Date.now() };
  return archive.pm;
}

type Box = [number, number, number, number];
let areas: { boxes: Box[]; at: number } | null = null;
/** Rectángulos de los proyectos abiertos (estaciones + capas), con margen. */
export async function projectBoxes(): Promise<Box[]> {
  if (areas && Date.now() - areas.at < 5 * 60 * 1000) return areas.boxes;
  const rows = (await db.execute(sql`
    SELECT ST_XMin(e) AS w, ST_YMin(e) AS s, ST_XMax(e) AS e, ST_YMax(e) AS n FROM (
      SELECT ST_Extent(g)::geometry AS e FROM (
        SELECT project_id, geom AS g FROM stations WHERE deleted_at IS NULL
        UNION ALL SELECT project_id, geom FROM project_layers
      ) x JOIN projects p ON p.id = x.project_id AND p.deleted_at IS NULL AND p.status <> 'cerrado'
      GROUP BY x.project_id
    ) b WHERE e IS NOT NULL`)).rows as { w: number; s: number; e: number; n: number }[];
  const boxes = rows.map((r): Box => [r.w - MARGIN_DEG, r.s - MARGIN_DEG, r.e + MARGIN_DEG, r.n + MARGIN_DEG]);
  areas = { boxes, at: Date.now() };
  return boxes;
}

function tileBox(z: number, x: number, y: number): Box {
  const n = 2 ** z;
  const lon = (i: number) => (i / n) * 360 - 180;
  const lat = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}
const intersects = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

const basemapRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function cached(key: string): Promise<Buffer | null> {
    try {
      const stream = await app.minio.getObject(app.minioBucket, key);
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
  const store = (key: string, data: Buffer, type: string) =>
    app.minio.putObject(app.minioBucket, key, data, data.length, { 'Content-Type': type }).catch((e) => app.log.warn({ err: e, key }, 'No se pudo guardar en caché'));

  /** Archivo de Protomaps (fuentes, íconos) con caché en MinIO. */
  async function asset(reply: FastifyReply, path: string, type: string) {
    const key = `basemap/assets/${path}`;
    let data = await cached(key);
    if (!data) {
      const res = await fetch(ASSETS_BASE + path.split('/').map(encodeURIComponent).join('/'));
      if (res.status === 404) return reply.code(404).send({ error: 'No existe' });
      if (!res.ok) return reply.code(502).send({ error: 'Mapa base no disponible' });
      data = Buffer.from(await res.arrayBuffer());
      void store(key, data, type);
    }
    return reply.header('content-type', type).header('cache-control', 'public, max-age=2592000').send(data);
  }

  r.get('/basemap/style.json', async (req) => {
    const base = `${req.protocol}://${req.headers.host}/api/basemap`;
    return {
      version: 8,
      name: 'TOCE OSM',
      glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
      sprite: `${base}/sprites/light`,
      sources: {
        protomaps: {
          type: 'vector',
          tiles: [`${base}/tiles/{z}/{x}/{y}.mvt`],
          minzoom: 0,
          maxzoom: BASEMAP_MAX_ZOOM,
          attribution: ATTRIBUTION,
        },
      },
      layers: layers('protomaps', namedFlavor('light'), { lang: 'es' }),
    };
  });

  r.get(
    '/basemap/tiles/:z/:x/:y.mvt',
    { schema: { params: z.object({ z: z.coerce.number().int().min(0).max(BASEMAP_MAX_ZOOM), x: z.coerce.number().int().min(0), y: z.coerce.number().int().min(0) }) } },
    async (req, reply) => {
      const { z: zoom, x, y } = req.params;
      if (x >= 2 ** zoom || y >= 2 ** zoom) return reply.code(404).send({ error: 'Fuera de rango' });
      if (zoom >= FREE_ZOOM) {
        const box = tileBox(zoom, x, y);
        if (!(await projectBoxes()).some((b) => intersects(b, box))) return reply.code(204).send();
      }
      const key = `basemap/tiles/${zoom}/${x}/${y}.mvt`;
      let data = await cached(key);
      if (!data) {
        const pm = await getArchive();
        const t = await pm.getZxy(zoom, x, y);
        if (!t) return reply.code(204).send(); // sin datos (mar abierto, etc.)
        data = Buffer.from(t.data);
        void store(key, data, 'application/x-protobuf');
      }
      return reply.header('content-type', 'application/x-protobuf').header('cache-control', 'public, max-age=2592000').send(data);
    },
  );

  r.get(
    '/basemap/fonts/:fontstack/:range.pbf',
    { schema: { params: z.object({ fontstack: z.string().regex(/^Noto Sans [A-Za-z ]{2,30}$/), range: z.string().regex(/^\d{1,5}-\d{1,5}$/) }) } },
    async (req, reply) => asset(reply, `fonts/${req.params.fontstack}/${req.params.range}.pbf`, 'application/x-protobuf'),
  );

  r.get(
    '/basemap/sprites/:name',
    { schema: { params: z.object({ name: z.string().regex(/^light(@2x)?\.(json|png)$/) }) } },
    async (req, reply) => asset(reply, `sprites/v4/${req.params.name}`, req.params.name.endsWith('.png') ? 'image/png' : 'application/json'),
  );
};

export default basemapRoutes;
