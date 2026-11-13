import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler, hasZodFastifySchemaValidationErrors } from '@fastify/type-provider-zod';
import { env } from './env.js';
import dbPlugin from './plugins/db.js';
import authPlugin from './plugins/auth.js';
import minioPlugin from './plugins/minio.js';
import health from './routes/health.js';
import auth from './routes/auth.js';
import users from './routes/users.js';
import methods from './routes/methods.js';
import projects from './routes/projects.js';
import brigades from './routes/brigades.js';
import stations from './routes/stations.js';
import schedules from './routes/schedules.js';
import species from './routes/species.js';
import workPackage from './routes/workPackage.js';
import field from './routes/field.js';
import basemap from './routes/basemap.js';
import incidents from './routes/incidents.js';
import logistics from './routes/logistics.js';
import tracking from './routes/tracking.js';

export async function buildApp() {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? { level: 'info', transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
        : { level: 'info' },
    trustProxy: true,
    bodyLimit: 20 * 1024 * 1024,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: 'Datos inválidos',
        issues: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
      });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'Error no controlado');
    return reply.code(status).send({ error: status >= 500 ? 'Error interno' : err.message });
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);
  await app.register(dbPlugin);
  await app.register(authPlugin);
  await app.register(minioPlugin);

  await app.register(health, { prefix: '/api' });
  await app.register(auth, { prefix: '/api' });
  await app.register(users, { prefix: '/api' });
  for (const routes of [methods, projects, brigades, stations, schedules, species, workPackage, field, basemap, incidents, logistics, tracking]) {
    await app.register(routes, { prefix: '/api' });
  }

  return app;
}
