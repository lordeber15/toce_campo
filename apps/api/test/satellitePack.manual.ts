/**
 * Prueba manual del mapa satelital por brigada (usa la base local y pide teselas reales a Esri).
 *   pnpm --filter @toce/api exec tsx test/satellitePack.manual.ts <archivo.kmz> [teselas_a_bajar]
 * Carga temporalmente el KMZ como capas de una brigada, muestra el plan (teselas por zoom) y arma un
 * PMTiles con las primeras N teselas para verificar que se lee bien. Al final borra lo insertado.
 */
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { PMTiles, type Source } from 'pmtiles';
import { db, pool } from '../src/db/index.js';
import { planSatellite } from '../src/lib/satellitePack.js';
import { PmtilesBuilder } from '../src/lib/pmtilesWriter.js';

const [kmzPath, nArg] = process.argv.slice(2);
if (!kmzPath) throw new Error('Falta el archivo KMZ');
const N = Number(nArg ?? 150);
const TAG = 'TEST-SATELLITE';

const zip = await JSZip.loadAsync(readFileSync(kmzPath));
const kml = await Object.values(zip.files).find((f) => f.name.endsWith('.kml'))!.async('string');
const coords = (block: string) => block.trim().split(/\s+/).map((p) => p.split(',').slice(0, 2).map(Number)).filter((c) => c.length === 2 && c.every(Number.isFinite));
const geoms: object[] = [];
for (const m of kml.matchAll(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
  const ring = coords(m[1]!);
  if (ring.length >= 4) geoms.push({ type: 'Polygon', coordinates: [ring] });
}
for (const m of kml.matchAll(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
  const line = coords(m[1]!);
  if (line.length >= 2) geoms.push({ type: 'LineString', coordinates: line });
}
for (const m of kml.matchAll(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
  const p = coords(m[1]!)[0];
  if (p) geoms.push({ type: 'Point', coordinates: p });
}
console.log(`KMZ: ${geoms.length} geometrías`);

const brigade = (await db.execute(sql`SELECT id, project_id AS "projectId", name FROM brigades ORDER BY name LIMIT 1`)).rows[0] as { id: string; projectId: string; name: string };
try {
  for (let i = 0; i < geoms.length; i += 200) {
    const chunk = geoms.slice(i, i + 200);
    await db.execute(sql`INSERT INTO project_layers (project_id, kind, name, geom, source_file, folder_path, sort_order, brigade_id)
      SELECT ${brigade.projectId}, 'otro', ${TAG}, ST_SetSRID(ST_GeomFromGeoJSON(g), 4326), ${TAG}, '{}', 0, ${brigade.id}
      FROM jsonb_array_elements_text(${JSON.stringify(chunk.map((g) => JSON.stringify(g)))}::jsonb) g`);
  }

  const t0 = Date.now();
  const plan = await planSatellite(brigade.id);
  if (!plan) throw new Error('Sin plan');
  const byZ = new Map<number, number>();
  for (const t of plan.tiles) byZ.set(t.z, (byZ.get(t.z) ?? 0) + 1);
  console.log(`Plan (${Date.now() - t0} ms): ${plan.tiles.length} teselas, zoom máx ${plan.maxZoom}${plan.reduced ? ' (reducido)' : ''}`);
  console.log([...byZ].map(([z, n]) => `  z${z}: ${n}`).join('\n'));
  const rect = (z: number) => {
    const [w, s, e, n] = plan.bounds;
    const x = (lon: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
    const y = (lat: number) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
    return (x(e) - x(w) + 1) * (y(s) - y(n) + 1);
  };
  let all = 0;
  for (let z = 12; z <= 18; z++) all += rect(z);
  console.log(`Rectángulo completo z12–18: ${all} teselas → ahorro ${(100 * (1 - plan.tiles.length / all)).toFixed(1)} %`);

  // Archivo de prueba con las primeras N teselas (bajadas de Esri y pasadas a WebP).
  const dir = mkdtempSync(join(tmpdir(), 'sat-test-'));
  const out = join(dir, 'test.pmtiles');
  const builder = new PmtilesBuilder(out);
  let jpeg = 0, webp = 0;
  const sample = plan.tiles.filter((t) => t.z >= 16).slice(0, N);
  sample.sort((a, b) => plan.tiles.indexOf(a) - plan.tiles.indexOf(b));
  for (const t of sample) {
    const res = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${t.z}/${t.y}/${t.x}`, { headers: { 'User-Agent': 'TOCE-Campo/1.0 (prueba)' } });
    if (!res.ok) continue;
    const raw = Buffer.from(await res.arrayBuffer());
    const w = await sharp(raw).webp({ quality: 70 }).toBuffer();
    jpeg += raw.length; webp += w.length;
    builder.add(t.z, t.x, t.y, w);
  }
  const bytes = await builder.finish({ tileType: 'webp', minZoom: 12, maxZoom: plan.maxZoom, bounds: plan.bounds });
  console.log(`Muestra ${builder.tiles} teselas: JPEG ${(jpeg / 1024).toFixed(0)} KB → WebP ${(webp / 1024).toFixed(0)} KB (${(100 * (1 - webp / jpeg)).toFixed(0)} % menos). Archivo ${(bytes / 1024).toFixed(0)} KB`);
  const avg = webp / Math.max(1, builder.tiles);
  console.log(`Estimado del archivo completo: ${((avg * plan.tiles.length) / 1024 / 1024).toFixed(0)} MB (con JPEG: ${(((jpeg / Math.max(1, builder.tiles)) * plan.tiles.length) / 1024 / 1024).toFixed(0)} MB)`);

  // Lectura con la librería oficial de PMTiles.
  const buf = readFileSync(out);
  const src: Source = { getKey: () => 'test', getBytes: async (o, l) => ({ data: buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + l) as ArrayBuffer }) };
  const pm = new PMTiles(src);
  const h = await pm.getHeader();
  let ok = 0;
  for (const t of sample) if (await pm.getZxy(t.z, t.x, t.y)) ok++;
  console.log(`Lectura: tipo ${h.tileType}, zoom ${h.minZoom}–${h.maxZoom}, ${ok}/${sample.length} teselas encontradas`);
  rmSync(dir, { recursive: true, force: true });
} finally {
  await db.execute(sql`DELETE FROM project_layers WHERE source_file = ${TAG}`);
  await pool.end();
}
