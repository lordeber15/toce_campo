import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { and, asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ADMIN_ROLES, methodCreateSchema, methodUpdateSchema, specialtyAccessSchema } from '@toce/shared';
import { schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, idParam, isUniqueViolation, notFound } from '../lib/http.js';
import { specialtyCode } from '../lib/templateImport.js';
import { setMethodUnits } from '../lib/stationMethods.js';

const { methods, specialties, specialtyAccess } = schema;

const methodsRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const write = app.requireRoles(...ADMIN_ROLES);

  /** grantIds: otras especialidades que ve (y puede asumir) quien tiene esta. */
  r.get('/specialties', { onRequest: app.authenticate }, async () =>
    app.db
      .select({
        ...getTableColumns(specialties),
        grantIds: sql<string[]>`coalesce((SELECT array_agg(a.granted_id) FROM specialty_access a WHERE a.specialty_id = ${specialties.id}), '{}')`,
      })
      .from(specialties)
      .where(eq(specialties.isActive, true))
      .orderBy(sql`${specialties.sortOrder} NULLS LAST`, asc(specialties.name)),
  );

  /** Nueva especialidad (el código se genera si no se indica). */
  r.post(
    '/specialties',
    { onRequest: write, schema: { body: z.object({ name: z.string().trim().min(2).max(80), code: z.string().trim().min(2).max(30).regex(/^[A-Z0-9-]+$/).optional() }) } },
    async (req, reply) => {
      const rows = await app.db.select({ code: specialties.code, name: specialties.name, sortOrder: specialties.sortOrder }).from(specialties);
      if (rows.some((x) => x.name.toLowerCase() === req.body.name.toLowerCase())) throw conflict(`Ya existe la especialidad ${req.body.name}`);
      const code = req.body.code ?? specialtyCode(req.body.name, new Set(rows.map((x) => x.code)));
      const next = rows.reduce((a, x) => Math.max(a, Number(x.sortOrder) || 0), 0) + 1;
      try {
        const [sp] = await app.db.insert(specialties).values({ code, name: req.body.name, sortOrder: String(next) }).returning();
        await audit(req, 'specialty', sp!.id, 'create', { after: req.body });
        return reply.code(201).send({ ...sp!, grantIds: [] });
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict(`Ya existe una especialidad con el código ${code}`);
        throw e;
      }
    },
  );

  /**
   * Edita una especialidad. grantIds reemplaza sus accesos (otras especialidades que ve y puede asumir:
   * perfil botánico, Mamíferos, Fauna transversal...). Su propia especialidad siempre la ve.
   */
  r.patch(
    '/specialties/:id',
    {
      onRequest: write,
      schema: {
        params: idParam,
        body: specialtyAccessSchema.partial().extend({ name: z.string().trim().min(2).max(80).optional(), isActive: z.boolean().optional() }),
      },
    },
    async (req) => {
      const { grantIds, ...data } = req.body;
      return app.db.transaction(async (tx) => {
        const [sp] = await tx.select().from(specialties).where(eq(specialties.id, req.params.id));
        if (!sp) throw notFound('Especialidad');
        if (Object.keys(data).length) await tx.update(specialties).set(data).where(eq(specialties.id, sp.id));
        const before = (await tx.select({ id: specialtyAccess.grantedId }).from(specialtyAccess).where(eq(specialtyAccess.specialtyId, sp.id))).map((x) => x.id);
        let after = before;
        if (grantIds) {
          after = [...new Set(grantIds.filter((g) => g !== sp.id))];
          if (after.length) {
            const found = await tx.select({ id: specialties.id }).from(specialties).where(inArray(specialties.id, after));
            if (found.length !== after.length) throw badRequest('Alguna especialidad no existe');
          }
          await tx.delete(specialtyAccess).where(eq(specialtyAccess.specialtyId, sp.id));
          if (after.length) await tx.insert(specialtyAccess).values(after.map((grantedId) => ({ specialtyId: sp.id, grantedId })));
        }
        await audit(req, 'specialty', sp.id, 'update', { before: { ...sp, grantIds: before }, after: req.body }, tx);
        return { ...sp, ...data, grantIds: after };
      });
    },
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
    return app.db.transaction(async (tx) => {
      const [m] = await tx.update(methods).set(req.body).where(eq(methods.id, cur.id)).returning();
      // Cambio de unidades desde Métodos: se aplica a todas las estaciones que lo tienen (sin borrar nada).
      const units = req.body.defaultUnitsRequired;
      const applied = units !== undefined && units !== cur.defaultUnitsRequired && !m!.isOpenEnded
        ? await setMethodUnits(tx, cur.id, units)
        : null;
      await audit(req, 'method', cur.id, 'update', { before: cur, after: req.body, ...(applied && { unitsApplied: applied }) }, tx);
      return { ...m!, unitsApplied: applied };
    });
  });
};
export default methodsRoutes;
