import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../env.js';
import * as schema from './schema/index.js';

export const pool = new Pool({
  host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, max: 10,
});
export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };
