/**
 * Prueba manual: arma de punta a punta el satélite de una brigada (Esri → WebP → MinIO → PMTiles).
 *   pnpm --filter @toce/api exec tsx test/satelliteBuild.manual.ts "<nombre de brigada>"
 */
import { Client } from 'minio';
import { PMTiles, type Source } from 'pmtiles';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { env } from '../src/env.js';
import { packKey, planSatellite, readMeta, startBuild } from '../src/lib/satellitePack.js';

const name = process.argv[2] ?? 'Masto 1';
const minio = new Client({
  endPoint: env.MINIO_ENDPOINT, port: env.MINIO_PORT, useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ROOT_USER, secretKey: env.MINIO_ROOT_PASSWORD, region: 'us-east-1',
});
const bucket = env.MINIO_BUCKET;
try {
  const b = (await db.execute(sql`SELECT id FROM brigades WHERE name = ${name}`)).rows[0] as { id: string };
  const plan = await planSatellite(b.id);
  if (!plan) throw new Error('Sin zona');
  console.log(`${name}: ${plan.tiles.length} teselas, zoom máx ${plan.maxZoom}`);
  const t0 = Date.now();
  const build = startBuild(minio, bucket, plan, (e) => console.error(e));
  const timer = setInterval(() => console.log(`  ${build.done}/${build.total}`), 5000);
  await build.promise;
  clearInterval(timer);
  if (build.error) throw new Error(build.error);
  const meta = await readMeta(minio, bucket, b.id);
  console.log(`Listo en ${((Date.now() - t0) / 1000).toFixed(0)} s:`, meta);
  // Segunda vez: todo sale del caché de MinIO.
  const t1 = Date.now();
  await startBuild(minio, bucket, { ...plan, version: `${plan.version}x` }, (e) => console.error(e)).promise;
  console.log(`Reconstrucción desde caché: ${((Date.now() - t1) / 1000).toFixed(0)} s`);

  const chunks: Buffer[] = [];
  for await (const c of await minio.getObject(bucket, packKey(b.id, `${plan.version}x`))) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  const src: Source = { getKey: () => 'k', getBytes: async (o, l) => ({ data: buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + l) as ArrayBuffer }) };
  const pm = new PMTiles(src);
  let found = 0;
  for (const t of plan.tiles) if (await pm.getZxy(t.z, t.x, t.y)) found++;
  console.log(`Archivo ${(buf.length / 1024 / 1024).toFixed(1)} MB, ${found}/${plan.tiles.length} teselas legibles`);
} finally {
  await pool.end();
}
