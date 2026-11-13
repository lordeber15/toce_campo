import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { and, asc, eq, getTableColumns, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ADMIN_ROLES, methodCreateSchema, methodUpdateSchema } from '@toce/shared';
import { schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { conflict, idParam, isUniqueViolation, notFound } from '../lib/http.js';

const { methods, specialties } = schema;

const methodsRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const write = app.requireRoles(...ADMIN_ROLES);

  r.get('/specialties', { onRequest: app.authenticate }, async () =>
    app.db.select().from(specialties).where(eq(specialties.isActive, true)).orderBy(asc(specialties.sortOrder)),
  );

  r.get(
    '/methods',
    { onRequest: app.authenticate, schema: { querystring: z.object({ specialtyId: z.string().uuid().optional(), includeInactive: z.coerce.boolean().optional() }) } },
    async (req) => {
      const { specialtyId, includeInactive } = req.query;
      return app.db
        .select({
          ...getTableColumns(methods),
          specialtyCode: specialties.code,
          specialtyName: specialties.name,
          stationCount: sql<number>`(SELECT count(*)::int FROM station_methods sm WHERE sm.method_id = ${methods.id})`,
        })
        .from(methods)
        .innerJoin(specialties, eq(specialties.id, methods.specialtyId))
        .where(and(specialtyId ? eq(methods.specialtyId, specialtyId) : undefined, includeInactive ? undefined : eq(methods.isActive, true)))
        .orderBy(asc(specialties.sortOrder), asc(methods.sortOrder));
    },
  );

  r.post('/methods', { onRequest: write, schema: { body: methodCreateSchema } }, async (req, reply) => {
    try {
      const [{ next }] = (await app.db.execute(sql`SELECT coalesce(max(sort_order), -1)::int + 1 AS next FROM methods WHERE specialty_id = ${req.body.specialtyId}`)).rows as [{ next: number }];
      const [m] = await app.db.insert(methods).values({ ...req.body, sortOrder: next }).returning();
      await audit(req, 'method', m!.id, 'create', { after: req.body });
      return reply.code(201).send(m);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict(`Ya existe el método ${req.body.code} en esa especialidad`);
      throw e;
    }
  });

  r.patch('/methods/:id', { onRequest: write, schema: { params: idParam, body: methodUpdateSchema } }, async (req) => {
    const [cur] = await app.db.select().from(methods).where(eq(methods.id, req.params.id));
    if (!cur) throw notFound('Método');
    const [m] = await app.db.update(methods).set(req.body).where(eq(methods.id, cur.id)).returning();
    await audit(req, 'method', cur.id, 'update', { before: cur, after: req.body });
    return m;
  });
};
export default methodsRoutes;
