import fp from 'fastify-plugin';
import { Client } from 'minio';
import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Cliente interno (subidas, lecturas y ZIP desde el servidor). */
    minio: Client;
    /** Solo para firmar enlaces que abre el navegador: usa la dirección pública (MINIO_PUBLIC_URL). */
    minioSign: Client;
    minioBucket: string;
  }
}

/** Región fija: así firmar enlaces no consulta al servidor (la dirección pública puede no ser alcanzable desde el contenedor). */
const REGION = 'us-east-1';

/** Cliente con la dirección pública de MinIO; si no es válida, se usa el interno. */
function publicClient(internal: Client) {
  try {
    const u = new URL(env.MINIO_PUBLIC_URL);
    const useSSL = u.protocol === 'https:';
    return new Client({
      endPoint: u.hostname,
      port: u.port ? Number(u.port) : useSSL ? 443 : 80,
      useSSL,
      accessKey: env.MINIO_ROOT_USER,
      secretKey: env.MINIO_ROOT_PASSWORD,
      region: REGION,
      pathStyle: true,
    });
  } catch {
    return internal;
  }
}

export default fp(async (app) => {
  const client = new Client({
    endPoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ROOT_USER,
    secretKey: env.MINIO_ROOT_PASSWORD,
    region: REGION,
  });
  try {
    const exists = await client.bucketExists(env.MINIO_BUCKET);
    if (!exists) await client.makeBucket(env.MINIO_BUCKET, REGION);
    app.log.info({ bucket: env.MINIO_BUCKET, publicUrl: env.MINIO_PUBLIC_URL }, 'MinIO listo');
  } catch (e) {
    app.log.warn({ err: e }, 'MinIO no disponible al iniciar (se reintentará al usarlo)');
  }
  app.decorate('minio', client);
  app.decorate('minioSign', publicClient(client));
  app.decorate('minioBucket', env.MINIO_BUCKET);
});
