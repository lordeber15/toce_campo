import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'minio';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { PmtilesBuilder, tileIdOf } from './pmtilesWriter.js';

/**
 * Imagen satelital offline por brigada, en un solo archivo PMTiles (WebP).
 *
 * En vez del rectángulo completo de la zona, se baja lo que la brigada usa:
 *  - z12–14: hasta 5 km alrededor de la zona (para ubicarse al llegar);
 *  - z15–16: hasta 1,5 km alrededor del KMZ (polígonos completos, líneas y puntos) y estaciones;
 *  - z17–18: hasta 500 m alrededor del KMZ y estaciones (interior de polígonos incluido).
 * Si la zona es tan grande que pasa el límite, se baja el detalle máximo (nunca se deja sin cubrir el KMZ).
 *
 * Las teselas se guardan una sola vez en MinIO (las comparten brigadas y reconstrucciones), así Esri
 * recibe una descarga por zona en el servidor y no una por teléfono.
 */

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const USER_AGENT = 'TOCE-Campo/1.0 (mapa offline de brigada)';
export const SAT_MIN_ZOOM = 12;
const SAT_MAX_ZOOM = 18;
/** El detalle máximo no baja de aquí (por debajo no se distinguen caminos). */
const SAT_MIN_DETAIL = 15;
/** ~60 000 teselas WebP ≈ 0,7–0,9 GB: tope por brigada. */
export const SAT_MAX_TILES = 60000;
const WEBP_QUALITY = 70;
const CONCURRENCY = 8;
/** Cambia si cambia la forma de armar el archivo (fuerza reconstruir). */
const RECIPE = 'v1-webp70-1500m-500m';

const MARGIN_DEG = 0.04;
const tierOf = (z: number) => (z <= 14 ? 'a1' : z <= 16 ? 'a2' : 'a3');
/** Margen alrededor del KMZ, estaciones y polígono por nivel: z12–14, z15–16, z17–18. */
const TIER_METERS = { a1: 5000, a2: 1500, a3: 500 } as const;

type Tile = { z: number; x: number; y: number };
export type SatPlan = { brigadeId: string; tiles: Tile[]; maxZoom: number; reduced: boolean; bounds: [number, number, number, number]; version: string };
export type SatMeta = { version: string; bytes: number; tiles: number; maxZoom: number; reduced: boolean; bounds: [number, number, number, number]; builtAt: string };

/** Teselas de la brigada por nivel de zoom, ajustadas al tope. null: la brigada no tiene KMZ, estaciones ni polígono. */
export async function planSatellite(brigadeId: string): Promise<SatPlan | null> {
  return db.transaction(async (tx) => {
    // Zona: KMZ de la brigada + su polígono de trabajo + sus estaciones (programadas o con métodos),
    // en Web Mercator, troceada e indexada. No se arma un buffer gigante (con miles de elementos es lento
    // y puede tumbar la base): cada tesela se prueba con ST_DWithin contra las piezas cercanas.
    await tx.execute(sql`
      CREATE TEMP TABLE sat_geom ON COMMIT DROP AS
      WITH src AS (
        SELECT l.geom AS g FROM project_layers l WHERE l.brigade_id = ${brigadeId}
        UNION ALL SELECT b.area_geom FROM brigades b WHERE b.id = ${brigadeId} AND b.area_geom IS NOT NULL
        UNION ALL SELECT s.geom FROM stations s WHERE s.deleted_at IS NULL AND s.id IN (
          SELECT sc.station_id FROM schedules sc WHERE sc.brigade_id = ${brigadeId} AND sc.status <> 'cancelada'
          UNION SELECT sm.station_id FROM station_methods sm WHERE sm.brigade_id = ${brigadeId})
      )
      SELECT ST_Subdivide(ST_Transform(g, 3857), 128) AS g FROM src WHERE g IS NOT NULL AND NOT ST_IsEmpty(g) AND ST_IsValid(g)
      UNION ALL
      -- Geometrías inválidas del KMZ: se usa su contorno (rectángulo), que igual las cubre.
      SELECT ST_Transform(ST_Envelope(g), 3857) FROM src WHERE g IS NOT NULL AND NOT ST_IsEmpty(g) AND NOT ST_IsValid(g)`);
    await tx.execute(sql`CREATE INDEX ON sat_geom USING gist (g)`);
    await tx.execute(sql`ANALYZE sat_geom`);
    const box = (await tx.execute(sql`
      SELECT ST_XMin(e) AS w, ST_YMin(e) AS s, ST_XMax(e) AS e, ST_YMax(e) AS n
      FROM (SELECT ST_Transform(ST_SetSRID(ST_Extent(g)::geometry, 3857), 4326) AS e FROM sat_geom) x`)).rows[0] as
      | { w: number | null; s: number; e: number; n: number }
      | undefined;
    if (!box || box.w == null) return null;
    const ext: [number, number, number, number] = [Number(box.w), Number(box.s), Number(box.e), Number(box.n)];
    const bounds: [number, number, number, number] = [ext[0] - MARGIN_DEG, ext[1] - MARGIN_DEG, ext[2] + MARGIN_DEG, ext[3] + MARGIN_DEG];
    // En Web Mercator un metro del terreno mide 1/cos(lat) unidades.
    const k = 1 / Math.cos((((ext[1] + ext[3]) / 2) * Math.PI) / 180);

    const perZoom = new Map<number, Tile[]>();
    for (let z = SAT_MIN_ZOOM; z <= SAT_MAX_ZOOM; z++) {
      const d = TIER_METERS[tierOf(z)] * k;
      // Candidatas: las teselas alrededor de cada pieza (no todo el rectángulo); luego, las que quedan a menos de d.
      const rows = (await tx.execute(sql`
        WITH c AS (SELECT 40075016.68557849 / 2 ^ ${z} AS t, 20037508.342789244 AS o)
        SELECT DISTINCT x, y FROM sat_geom p, c,
          generate_series(floor((ST_XMin(p.g) - ${d} + c.o) / c.t)::int, floor((ST_XMax(p.g) + ${d} + c.o) / c.t)::int) x,
          generate_series(floor((c.o - ST_YMax(p.g) - ${d}) / c.t)::int, floor((c.o - ST_YMin(p.g) + ${d}) / c.t)::int) y
        WHERE ST_DWithin(p.g, ST_TileEnvelope(${z}, x, y), ${d})`)).rows as { x: number; y: number }[];
      perZoom.set(z, rows.map((r) => ({ z, x: r.x, y: r.y })));
    }

    let maxZoom = SAT_MAX_ZOOM;
    const total = (mz: number) => [...perZoom].filter(([z]) => z <= mz).reduce((n, [, t]) => n + t.length, 0);
    while (maxZoom > SAT_MIN_DETAIL && total(maxZoom) > SAT_MAX_TILES) maxZoom--;
    const tiles = [...perZoom].filter(([z]) => z <= maxZoom).flatMap(([, t]) => t)
      .sort((a, b) => tileIdOf(a.z, a.x, a.y) - tileIdOf(b.z, b.x, b.y));
    const version = createHash('sha256').update(RECIPE).update(tiles.map((t) => `${t.z}/${t.x}/${t.y}`).join(',')).digest('hex').slice(0, 16);
    return { brigadeId, tiles, maxZoom, reduced: maxZoom < SAT_MAX_ZOOM, bounds, version };
  });
}

// ---------------------------------------------------------------------------
// Construcción (en segundo plano, una por brigada a la vez).

type Build = { version: string; done: number; total: number; error?: string; errorAt?: number; promise: Promise<void> };
const builds = new Map<string, Build>();

export const packKey = (brigadeId: string, version: string) => `satellite/packs/${brigadeId}/${version}.pmtiles`;
const metaKey = (brigadeId: string) => `satellite/packs/${brigadeId}/latest.json`;
const tileKey = (t: Tile) => `satellite/tiles/${t.z}/${t.x}/${t.y}.webp`;
/** Marca de tesela sin imagen en Esri (no se vuelve a pedir). */
const EMPTY = Buffer.from('vacía');

async function readObject(minio: Client, bucket: string, key: string): Promise<Buffer | null> {
  try {
    const stream = await minio.getObject(bucket, key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

export async function readMeta(minio: Client, bucket: string, brigadeId: string): Promise<SatMeta | null> {
  const b = await readObject(minio, bucket, metaKey(brigadeId));
  if (!b) return null;
  try { return JSON.parse(b.toString()) as SatMeta; } catch { return null; }
}

/** Imagen WebP de una tesela (de MinIO o de Esri). null: Esri no tiene imagen ahí. */
async function tileImage(minio: Client, bucket: string, t: Tile): Promise<Buffer | null> {
  const cached = await readObject(minio, bucket, tileKey(t));
  if (cached) return cached.equals(EMPTY) ? null : cached;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${ESRI}/${t.z}/${t.y}/${t.x}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
      if (res.status === 404 || res.status === 204) {
        await minio.putObject(bucket, tileKey(t), EMPTY, EMPTY.length).catch(() => undefined);
        return null;
      }
      if (!res.ok) throw new Error(`Esri respondió ${res.status}`);
      const webp = await sharp(Buffer.from(await res.arrayBuffer())).webp({ quality: WEBP_QUALITY }).toBuffer();
      await minio.putObject(bucket, tileKey(t), webp, webp.length, { 'Content-Type': 'image/webp' }).catch(() => undefined);
      return webp;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function build(minio: Client, bucket: string, plan: SatPlan, state: Build) {
  const dir = mkdtempSync(join(tmpdir(), 'toce-sat-'));
  const out = join(dir, 'pack.pmtiles');
  const builder = new PmtilesBuilder(out);
  try {
    // Se piden en paralelo, pero se agregan al archivo en orden de tileId.
    for (let i = 0; i < plan.tiles.length; i += CONCURRENCY) {
      const chunk = plan.tiles.slice(i, i + CONCURRENCY);
      const images = await Promise.all(chunk.map((t) => tileImage(minio, bucket, t)));
      chunk.forEach((t, j) => { const img = images[j]; if (img) builder.add(t.z, t.x, t.y, img); });
      state.done = Math.min(plan.tiles.length, i + CONCURRENCY);
    }
    const bytes = await builder.finish({
      tileType: 'webp', minZoom: SAT_MIN_ZOOM, maxZoom: plan.maxZoom, bounds: plan.bounds,
      metadata: { name: 'TOCE satélite', attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community', version: plan.version },
    });
    await minio.fPutObject(bucket, packKey(plan.brigadeId, plan.version), out, { 'Content-Type': 'application/octet-stream' });
    const meta: SatMeta = { version: plan.version, bytes, tiles: builder.tiles, maxZoom: plan.maxZoom, reduced: plan.reduced, bounds: plan.bounds, builtAt: new Date().toISOString() };
    const old = await readMeta(minio, bucket, plan.brigadeId);
    const body = Buffer.from(JSON.stringify(meta));
    await minio.putObject(bucket, metaKey(plan.brigadeId), body, body.length, { 'Content-Type': 'application/json' });
    if (old && old.version !== plan.version) await minio.removeObject(bucket, packKey(plan.brigadeId, old.version)).catch(() => undefined);
  } catch (e) {
    builder.abort();
    throw e;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Inicia (si no está en curso) la construcción del archivo de la brigada. */
export function startBuild(minio: Client, bucket: string, plan: SatPlan, log: (e: unknown) => void): Build {
  const running = builds.get(plan.brigadeId);
  // Tras un error se espera un minuto antes de reintentar (el teléfono ve el error mientras tanto).
  if (running && running.version === plan.version && (!running.error || Date.now() - (running.errorAt ?? 0) < 60000)) return running;
  const state: Build = { version: plan.version, done: 0, total: plan.tiles.length, promise: Promise.resolve() };
  state.promise = build(minio, bucket, plan, state)
    .then(() => { builds.delete(plan.brigadeId); })
    .catch((e: unknown) => { state.error = e instanceof Error ? e.message : 'No se pudo armar el mapa satelital'; state.errorAt = Date.now(); log(e); });
  builds.set(plan.brigadeId, state);
  return state;
}

export const currentBuild = (brigadeId: string) => builds.get(brigadeId);
