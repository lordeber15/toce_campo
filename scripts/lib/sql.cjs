// Ejecuta una consulta y escribe el resultado como `psql -tAc` (columnas separadas por |).
// Para los scripts de prueba cuando `docker exec` no está disponible. Lee DB_* de apps/api/.env.
const fs = require('node:fs');
const path = require('node:path');
const { Client, types } = require('pg');

// Igual que psql: fechas tal cual vienen de Postgres y booleanos como t/f.
for (const oid of [1082, 1114, 1184]) types.setTypeParser(oid, (v) => v);

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '../../apps/api/.env'), 'utf8').split('\n')
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);
const v = (k, d) => process.env[k] ?? env[k] ?? d;
const cfg = { host: v('DB_HOST', 'localhost'), port: Number(v('DB_PORT', 5433)), user: v('DB_USER'), password: v('DB_PASSWORD'), database: v('DB_NAME') };
// La consulta va como argumento; sin argumento (o con opciones estilo psql como -tAq) se lee de la entrada estándar.
const arg = process.argv[2];
const text = arg && !arg.startsWith('-') ? arg : fs.readFileSync(0, 'utf8');
const c = new Client(cfg);
c.connect()
  .then(() => c.query({ text, rowMode: 'array' }))
  .then((r) => {
    const rows = Array.isArray(r) ? r.at(-1).rows : r.rows;
    for (const row of rows ?? []) console.log(row.map((v) => (v === null ? '' : typeof v === 'boolean' ? (v ? 't' : 'f') : typeof v === 'object' ? JSON.stringify(v) : String(v))).join('|'));
  })
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => c.end());
