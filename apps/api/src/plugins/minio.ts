import fp from 'fastify-plugin';
import { Client } from 'minio';
import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyInstance {
    minio: Client;
    minioBucket: string;
  }
}

export default fp(async (app) => {
  const client = new Client({
    endPoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ROOT_USER,
    secretKey: env.MINIO_ROOT_PASSWORD,
  });
  try {
    const exists = await client.bucketExists(env.MINIO_BUCKET);
    if (!exists) await client.makeBucket(env.MINIO_BUCKET);
    app.log.info({ bucket: env.MINIO_BUCKET }, 'MinIO listo');
  } catch (e) {
    app.log.warn({ err: e }, 'MinIO no disponible al iniciar (se reintentará al usarlo)');
  }
  app.decorate('minio', client);
  app.decorate('minioBucket', env.MINIO_BUCKET);
});
