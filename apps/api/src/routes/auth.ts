import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { loginSchema, refreshSchema, authResponseSchema, type AuthUser } from '@toce/shared';
import { schema } from '../db/index.js';
import { verifyPassword, hashPassword } from '../lib/password.js';
import { randomToken, sha256, ttlToMs } from '../lib/tokens.js';
import { env } from '../env.js';

const { users, sessions, specialties, auditLogs } = schema;
const errorSchema = z.object({ error: z.string() });
const ROTATION_GRACE_MS = 60_000;

const auth: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function buildAuthUser(userId: string): Promise<AuthUser | null> {
    const rows = await app.db
      .select({
        id: users.id,
        dni: users.dni,
        fullName: users.fullName,
        roles: users.roles,
        specialtyId: users.specialtyId,
        specialtyCode: specialties.code,
        isActive: users.isActive,
      })
      .from(users)
      .leftJoin(specialties, eq(users.specialtyId, specialties.id))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async function issueSession(user: AuthUser, meta: { deviceId?: string; deviceName?: string; ip?: string; ua?: string }) {
    // Un solo usuario activo por dispositivo: revoca sesiones de otros usuarios en el mismo deviceId.
    if (meta.deviceId) {
      await app.db
        .update(sessions)
        .set({ revokedAt: new Date(), revokeReason: 'device' })
        .where(and(eq(sessions.deviceId, meta.deviceId), ne(sessions.userId, user.id), isNull(sessions.revokedAt)));
    }
    const refreshToken = randomToken();
    const [session] = await app.db
      .insert(sessions)
      .values({
        userId: user.id,
        refreshTokenHash: sha256(refreshToken),
        deviceId: meta.deviceId,
        deviceName: meta.deviceName,
        ipAddress: meta.ip,
        userAgent: meta.ua,
        expiresAt: new Date(Date.now() + ttlToMs(env.JWT_REFRESH_TTL)),
        lastUsedAt: new Date(),
      })
      .returning({ id: sessions.id });

    const accessToken = app.jwt.sign({
      sub: user.id,
      dni: user.dni,
      roles: user.roles,
      specialtyId: user.specialtyId,
      sid: session!.id,
    });
    return { accessToken, refreshToken, user };
  }

  r.post(
    '/auth/login',
    { schema: { body: loginSchema, response: { 200: authResponseSchema, '4xx': errorSchema } } },
    async (req, reply) => {
      const { dni, password, deviceId, deviceName } = req.body;
      const [row] = await app.db.select().from(users).where(and(eq(users.dni, dni), isNull(users.deletedAt))).limit(1);
      const ok = row ? await verifyPassword(row.passwordHash, password) : false;
      if (!row || !ok) {
        await new Promise((res) => setTimeout(res, 300)); // frena fuerza bruta
        return reply.code(401).send({ error: 'DNI o contraseña incorrectos' });
      }
      if (!row.isActive) return reply.code(403).send({ error: 'Usuario desactivado' });

      const user = (await buildAuthUser(row.id))!;
      const result = await issueSession(user, {
        deviceId,
        deviceName,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });
      await app.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id));
      await app.db.insert(auditLogs).values({ userId: row.id, entity: 'user', entityId: row.id, action: 'login', ipAddress: req.ip, deviceId });
      return result;
    },
  );

  r.post('/auth/refresh', { schema: { body: refreshSchema, response: { 200: authResponseSchema, '4xx': errorSchema } } }, async (req, reply) => {
    const hash = sha256(req.body.refreshToken);
    const [session] = await app.db.select().from(sessions).where(eq(sessions.refreshTokenHash, hash)).limit(1);
    // Gracia: si la respuesta de una renovación se perdió (señal débil), el teléfono puede reintentar
    // con el token anterior durante ROTATION_GRACE_MS. Solo aplica a sesiones rotadas, nunca a revocadas.
    const inGrace =
      session?.revokeReason === 'rotated' && !!session.revokedAt && Date.now() - session.revokedAt.getTime() < ROTATION_GRACE_MS;
    if (!session || (session.revokedAt && !inGrace) || session.expiresAt < new Date()) {
      return reply.code(401).send({ error: 'Sesión inválida o expirada' });
    }
    const user = await buildAuthUser(session.userId);
    if (!user || !user.isActive) {
      await app.db.update(sessions).set({ revokedAt: new Date(), revokeReason: 'admin' }).where(eq(sessions.id, session.id));
      return reply.code(403).send({ error: 'Usuario desactivado' });
    }
    // Rotación: revoca la sesión usada y emite una nueva.
    if (!session.revokedAt) {
      await app.db.update(sessions).set({ revokedAt: new Date(), revokeReason: 'rotated', lastUsedAt: new Date() }).where(eq(sessions.id, session.id));
    }
    return issueSession(user, {
      deviceId: session.deviceId ?? undefined,
      deviceName: session.deviceName ?? undefined,
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  });

  r.post('/auth/logout', { onRequest: app.authenticate }, async (req) => {
    await app.db.update(sessions).set({ revokedAt: new Date(), revokeReason: 'logout' }).where(eq(sessions.id, req.user.sid));
    return { ok: true };
  });

  r.get('/auth/me', { onRequest: app.authenticate }, async (req, reply) => {
    const user = await buildAuthUser(req.user.sub);
    if (!user) return reply.code(404).send({ error: 'Usuario no encontrado' });
    const [session] = await app.db.select({ revokedAt: sessions.revokedAt }).from(sessions).where(eq(sessions.id, req.user.sid));
    if (!session || session.revokedAt) return reply.code(401).send({ error: 'Sesión revocada' });
    return user;
  });

  r.post(
    '/auth/change-password',
    {
      onRequest: app.authenticate,
      schema: { body: z.object({ currentPassword: z.string(), newPassword: z.string().min(6).max(72) }) },
    },
    async (req, reply) => {
      const [row] = await app.db.select().from(users).where(eq(users.id, req.user.sub)).limit(1);
      if (!row || !(await verifyPassword(row.passwordHash, req.body.currentPassword))) {
        return reply.code(400).send({ error: 'Contraseña actual incorrecta' });
      }
      await app.db
        .update(users)
        .set({ passwordHash: await hashPassword(req.body.newPassword), mustChangePassword: false })
        .where(eq(users.id, row.id));
      // Cierra las demás sesiones del usuario.
      await app.db
        .update(sessions)
        .set({ revokedAt: new Date(), revokeReason: 'password' })
        .where(and(eq(sessions.userId, row.id), ne(sessions.id, req.user.sid), isNull(sessions.revokedAt)));
      return { ok: true };
    },
  );
};
export default auth;
