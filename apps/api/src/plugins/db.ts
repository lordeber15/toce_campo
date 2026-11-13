import fp from 'fastify-plugin';
import { db, pool, type Db } from '../db/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export default fp(async (app) => {
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await pool.end();
  });
});
