import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { ADMIN_ROLES, createUserSchema, updateUserSchema } from '@toce/shared';
import { schema } from '../db/index.js';
import { hashPassword } from '../lib/password.js';

const { users, specialties, sessions, auditLogs } = schema;

const publicUser = {
  id: users.id,
  dni: users.dni,
  fullName: users.fullName,
  email: users.email,
  phone: users.phone,
  roles: users.roles,
  specialtyId: users.specialtyId,
  specialtyCode: specialties.code,
  specialtyName: specialties.name,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

const usersRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = app.requireRoles(...ADMIN_ROLES);

  r.get(
    '/users',
    { onRequest: admin, schema: { querystring: z.object({ q: z.string().optional(), includeInactive: z.coerce.boolean().optional() }) } },
    async (req) => {
      const { q, includeInactive } = req.query;
      const conds = [isNull(users.deletedAt)];
      if (!includeInactive) conds.push(eq(users.isActive, true));
      if (q) conds.push(or(ilike(users.fullName, `%${q}%`), ilike(users.dni, `%${q}%`))!);
      return app.db.select(publicUser).from(users).leftJoin(specialties, eq(users.specialtyId, specialties.id)).where(and(...conds)).orderBy(desc(users.createdAt));
    },
  );

  r.post('/users', { onRequest: admin, schema: { body: createUserSchema } }, async (req, reply) => {
    const { password, ...rest } = req.body;
    const [exists] = await app.db.select({ id: users.id }).from(users).where(eq(users.dni, rest.dni)).limit(1);
    if (exists) return reply.code(409).send({ error: 'Ya existe un usuario con ese DNI' });
    const [created] = await app.db
      .insert(users)
      .values({ ...rest, specialtyId: rest.specialtyId ?? null, passwordHash: await hashPassword(password), mustChangePassword: true })
      .returning({ id: users.id });
    await app.db.insert(auditLogs).values({ userId: req.user.sub, entity: 'user', entityId: created!.id, action: 'create', after: rest });
    return reply.code(201).send({ id: created!.id });
  });

  r.patch('/users/:id', { onRequest: admin, schema: { params: z.object({ id: z.string().uuid() }), body: updateUserSchema } }, async (req, reply) => {
    const { password, ...rest } = req.body;
    const patch: Record<string, unknown> = { ...rest };
    if (password) {
      patch.passwordHash = await hashPassword(password);
      patch.mustChangePassword = true;
    }
    const [updated] = await app.db.update(users).set(patch).where(eq(users.id, req.params.id)).returning({ id: users.id });
    if (!updated) return reply.code(404).send({ error: 'Usuario no encontrado' });
    if (rest.isActive === false || password) {
      await app.db.update(sessions).set({ revokedAt: new Date(), revokeReason: 'admin' }).where(and(eq(sessions.userId, req.params.id), isNull(sessions.revokedAt)));
    }
    await app.db.insert(auditLogs).values({ userId: req.user.sub, entity: 'user', entityId: req.params.id, action: 'update', after: rest });
    return { ok: true };
  });

  r.delete('/users/:id', { onRequest: admin, schema: { params: z.object({ id: z.string().uuid() }) } }, async (req, reply) => {
    if (req.params.id === req.user.sub) return reply.code(400).send({ error: 'No puedes eliminar tu propio usuario' });
    await app.db.update(users).set({ deletedAt: new Date(), isActive: false }).where(eq(users.id, req.params.id));
    await app.db.update(sessions).set({ revokedAt: new Date(), revokeReason: 'admin' }).where(and(eq(sessions.userId, req.params.id), isNull(sessions.revokedAt)));
    await app.db.insert(auditLogs).values({ userId: req.user.sub, entity: 'user', entityId: req.params.id, action: 'delete' });
    return { ok: true };
  });
};
export default usersRoutes;
