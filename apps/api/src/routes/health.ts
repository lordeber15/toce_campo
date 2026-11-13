import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';

const health: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    const r = await app.db.execute(sql`select now() as now, postgis_version() as postgis`);
    return { ok: true, db: r.rows[0], tz: process.env.TZ };
  });
};
export default health;
