import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index.js';

async function main() {
  await db.execute('CREATE EXTENSION IF NOT EXISTS postgis');
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  console.log('Migraciones aplicadas');
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
