import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { ADMIN_ROLES, WEB_ROLES, brigadeSchema } from '@toce/shared';
import { schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, idParam, isUniqueViolation, notFound, projectParam } from '../lib/http.js';

const { brigades, brigadeMembers, users } = schema;
type Tx = Parameters<Parameters<typeof import('../db/index.js').db.transaction>[0]>[0];

const brigadesRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.requireRoles(...WEB_ROLES, 'jefe_proyecto');
  const write = app.requireRoles(...ADMIN_ROLES);

  r.get('/projects/:projectId/brigades', { onRequest: read, schema: { params: projectParam } }, async (req) => {
    const rows = await app.db.execute(sql`
      SELECT b.id, b.name, b.is_active AS "isActive", b.specialty_id AS "specialtyId", sp.name AS "specialtyName",
        b.leader_id AS "leaderId", lu.full_name AS "leaderName",
        b.logistician_id AS "logisticianId", lg.full_name AS "logisticianName",
        b.supervisor_id AS "supervisorId", su.full_name AS "supervisorName",
        coalesce((SELECT json_agg(json_build_object('id', u.id, 'fullName', u.full_name, 'dni', u.dni, 'specialtyId', u.specialty_id) ORDER BY u.full_name)
          FROM brigade_members m JOIN users u ON u.id = m.user_id WHERE m.brigade_id = b.id AND m.left_at IS NULL), '[]') AS members,
        (SELECT count(*)::int FROM schedules sc WHERE sc.brigade_id = b.id) AS schedules
      FROM brigades b
      LEFT JOIN specialties sp ON sp.id = b.specialty_id
      LEFT JOIN users lu ON lu.id = b.leader_id
      LEFT JOIN users lg ON lg.id = b.logistician_id
      LEFT JOIN users su ON su.id = b.supervisor_id
      WHERE b.project_id = ${req.params.projectId}
      ORDER BY b.is_active DESC, b.name`);
    return rows.rows;
  });

  /** Valida y sincroniza los miembros de una brigada (reemplazo completo). */
  async function syncMembers(tx: Tx, projectId: string, brigadeId: string, specialtyId: string | null | undefined, leaderId: string | null | undefined, memberIds: string[]) {
    const ids = [...new Set([...memberIds, ...(leaderId ? [leaderId] : [])])];
    if (ids.length) {
      const found = await tx.select({ id: users.id, fullName: users.fullName, roles: users.roles, specialtyId: users.specialtyId }).from(users).where(and(inArray(users.id, ids), isNull(users.deletedAt)));
      if (found.length !== ids.length) throw badRequest('Algún miembro no existe');
      if (specialtyId) {
        const wrong = found.filter((u) => u.roles.includes('especialista') && u.specialtyId !== specialtyId);
        if (wrong.length) throw badRequest(`Especialidad distinta a la de la brigada: ${wrong.map((u) => u.fullName).join(', ')}`);
      }
      // Un especialista solo puede estar en una brigada activa del proyecto.
      const busy = await tx.execute(sql`
        SELECT u.full_name AS name, b.name AS brigade FROM brigade_members m
        JOIN brigades b ON b.id = m.brigade_id JOIN users u ON u.id = m.user_id
        WHERE b.project_id = ${projectId} AND b.is_active AND b.id <> ${brigadeId} AND m.left_at IS NULL
          AND m.user_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
      if (busy.rows.length) {
        throw conflict(`Ya pertenecen a otra brigada: ${(busy.rows as { name: string; brigade: string }[]).map((b) => `${b.name} (${b.brigade})`).join(', ')}`);
      }
    }
    // Marca salida de los que ya no están y reactiva/inserta los nuevos.
    await tx
      .update(brigadeMembers)
      .set({ leftAt: new Date() })
      .where(and(eq(brigadeMembers.brigadeId, brigadeId), isNull(brigadeMembers.leftAt), ids.length ? sql`${brigadeMembers.userId} NOT IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql`true`));
    for (const userId of ids) {
      await tx
        .insert(brigadeMembers)
        .values({ brigadeId, userId })
        .onConflictDoUpdate({ target: [brigadeMembers.brigadeId, brigadeMembers.userId], set: { leftAt: null } });
    }
  }

  r.post('/projects/:projectId/brigades', { onRequest: write, schema: { params: projectParam, body: brigadeSchema } }, async (req, reply) => {
    const { memberIds, ...data } = req.body;
    try {
      const b = await app.db.transaction(async (tx) => {
        const [b] = await tx.insert(brigades).values({ ...data, projectId: req.params.projectId }).returning();
        await syncMembers(tx, req.params.projectId, b!.id, data.specialtyId, data.leaderId, memberIds);
        await audit(req, 'brigade', b!.id, 'create', { after: req.body }, tx);
        return b!;
      });
      return reply.code(201).send(b);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Ya existe una brigada con ese nombre en el proyecto');
      throw e;
    }
  });

  r.patch('/brigades/:id', { onRequest: write, schema: { params: idParam, body: brigadeSchema.partial() } }, async (req) => {
    const { memberIds, ...data } = req.body;
    try {
      return await app.db.transaction(async (tx) => {
        const [cur] = await tx.select().from(brigades).where(eq(brigades.id, req.params.id));
        if (!cur) throw notFound('Brigada');
        const [b] = Object.keys(data).length ? await tx.update(brigades).set(data).where(eq(brigades.id, cur.id)).returning() : [cur];
        if (memberIds || data.leaderId !== undefined || data.specialtyId !== undefined) {
          const current = memberIds ?? (await tx.select({ id: brigadeMembers.userId }).from(brigadeMembers).where(and(eq(brigadeMembers.brigadeId, cur.id), isNull(brigadeMembers.leftAt)))).map((m) => m.id);
          await syncMembers(tx, cur.projectId, cur.id, b!.specialtyId, b!.leaderId, current);
        }
        await audit(req, 'brigade', cur.id, 'update', { before: cur, after: req.body }, tx);
        return b;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Ya existe una brigada con ese nombre en el proyecto');
      throw e;
    }
  });

  /** Usuarios disponibles para armar brigadas (activos, no asignados a otra brigada del proyecto). */
  r.get('/projects/:projectId/brigade-candidates', { onRequest: read, schema: { params: projectParam } }, async (req) => {
    const rows = await app.db.execute(sql`
      SELECT u.id, u.full_name AS "fullName", u.dni, u.roles, u.specialty_id AS "specialtyId",
        (SELECT b.id FROM brigade_members m JOIN brigades b ON b.id = m.brigade_id
          WHERE m.user_id = u.id AND m.left_at IS NULL AND b.is_active AND b.project_id = ${req.params.projectId} LIMIT 1) AS "brigadeId"
      FROM users u WHERE u.is_active AND u.deleted_at IS NULL ORDER BY u.full_name`);
    return rows.rows;
  });

  r.delete('/brigades/:id', { onRequest: write, schema: { params: idParam } }, async (req) => {
    const [b] = await app.db.update(brigades).set({ isActive: false }).where(and(eq(brigades.id, req.params.id), ne(brigades.isActive, false))).returning({ id: brigades.id });
    if (!b) throw notFound('Brigada');
    await app.db.update(brigadeMembers).set({ leftAt: new Date() }).where(and(eq(brigadeMembers.brigadeId, b.id), isNull(brigadeMembers.leftAt)));
    await audit(req, 'brigade', b.id, 'deactivate');
    return { ok: true };
  });
};
export default brigadesRoutes;
