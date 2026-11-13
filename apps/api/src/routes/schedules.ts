import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ADMIN_ROLES, WEB_ROLES, scheduleSchema } from '@toce/shared';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, idParam, notFound, projectParam } from '../lib/http.js';

const { schedules } = schema;
type Exec = Pick<typeof db, 'execute'>;

/** La estación debe tener métodos de la especialidad de la brigada (si la brigada tiene especialidad). */
async function validatePair(exec: Exec, projectId: string, brigadeId: string, stationId: string) {
  const res = await exec.execute(sql`
    SELECT b.name AS brigade, b.project_id AS "brigadeProject", b.is_active AS active, sp.name AS specialty, b.specialty_id AS "specialtyId",
      s.code AS station, s.project_id AS "stationProject",
      EXISTS (SELECT 1 FROM station_methods sm JOIN methods m ON m.id = sm.method_id
        WHERE sm.station_id = s.id AND (b.specialty_id IS NULL OR m.specialty_id = b.specialty_id)) AS "hasMethods"
    FROM brigades b CROSS JOIN stations s LEFT JOIN specialties sp ON sp.id = b.specialty_id
    WHERE b.id = ${brigadeId} AND s.id = ${stationId} AND s.deleted_at IS NULL`);
  const row = res.rows[0] as
    | { brigade: string; brigadeProject: string; active: boolean; specialty: string | null; station: string; stationProject: string; hasMethods: boolean }
    | undefined;
  if (!row) throw badRequest('Brigada o estación no encontrada');
  if (row.brigadeProject !== projectId || row.stationProject !== projectId) throw badRequest('La brigada y la estación deben ser del mismo proyecto');
  if (!row.active) throw badRequest(`La brigada ${row.brigade} está inactiva`);
  if (!row.hasMethods) {
    throw badRequest(`La estación ${row.station} no tiene métodos${row.specialty ? ` de ${row.specialty}` : ''} habilitados. Configúralos en Estaciones.`);
  }
  return row;
}

const schedulesRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.requireRoles(...WEB_ROLES, 'jefe_proyecto');
  const write = app.requireRoles(...ADMIN_ROLES);

  r.get(
    '/projects/:projectId/schedules',
    {
      onRequest: read,
      schema: {
        params: projectParam,
        querystring: z.object({ from: z.string().optional(), to: z.string().optional(), brigadeId: z.string().uuid().optional() }),
      },
    },
    async (req) => {
      const { from, to, brigadeId } = req.query;
      const rows = await app.db.execute(sql`
        SELECT sc.id, to_char(sc.planned_date, 'YYYY-MM-DD') AS "plannedDate", to_char(sc.original_date, 'YYYY-MM-DD') AS "originalDate",
          sc.sort_order AS "sortOrder", sc.status, sc.notes,
          sc.brigade_id AS "brigadeId", b.name AS "brigadeName", sp.code AS "specialtyCode",
          sc.station_id AS "stationId", s.code AS "stationCode", ST_Y(s.geom) AS lat, ST_X(s.geom) AS lng
        FROM schedules sc
        JOIN brigades b ON b.id = sc.brigade_id
        LEFT JOIN specialties sp ON sp.id = b.specialty_id
        JOIN stations s ON s.id = sc.station_id
        WHERE sc.project_id = ${req.params.projectId}
          ${from ? sql`AND sc.planned_date >= ${from}` : sql``}
          ${to ? sql`AND sc.planned_date <= ${to}` : sql``}
          ${brigadeId ? sql`AND sc.brigade_id = ${brigadeId}` : sql``}
        ORDER BY sc.planned_date, b.name, sc.sort_order`);
      return rows.rows;
    },
  );

  /** Programa varias estaciones a una brigada en una fecha (o una sola). */
  r.post(
    '/projects/:projectId/schedules',
    {
      onRequest: write,
      schema: {
        params: projectParam,
        body: z.object({
          brigadeId: z.string().uuid(),
          plannedDate: scheduleSchema.shape.plannedDate,
          stationIds: z.array(z.string().uuid()).min(1).max(50),
          notes: scheduleSchema.shape.notes,
        }),
      },
    },
    async (req, reply) => {
      const { projectId } = req.params;
      const { brigadeId, plannedDate, stationIds, notes } = req.body;
      const created = await app.db.transaction(async (tx) => {
        const [{ max }] = (await tx.execute(sql`SELECT coalesce(max(sort_order), -1)::int AS max FROM schedules WHERE brigade_id = ${brigadeId} AND planned_date = ${plannedDate}`)).rows as [{ max: number }];
        let order = max + 1;
        const out = [];
        for (const stationId of stationIds) {
          const pair = await validatePair(tx, projectId, brigadeId, stationId);
          const dup = await tx.select({ id: schedules.id }).from(schedules).where(and(eq(schedules.brigadeId, brigadeId), eq(schedules.stationId, stationId), eq(schedules.plannedDate, plannedDate)));
          if (dup.length) throw conflict(`${pair.station} ya está programada para ${pair.brigade} ese día`);
          const [s] = await tx
            .insert(schedules)
            .values({ projectId, brigadeId, stationId, plannedDate, originalDate: plannedDate, sortOrder: order++, notes, createdById: req.user.sub })
            .returning({ id: schedules.id });
          out.push(s!.id);
        }
        await audit(req, 'schedule', null, 'create', { after: req.body }, tx);
        return out;
      });
      return reply.code(201).send({ created: created.length });
    },
  );

  r.patch('/schedules/:id', { onRequest: write, schema: { params: idParam, body: scheduleSchema.partial() } }, async (req) => {
    return app.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(schedules).where(eq(schedules.id, req.params.id));
      if (!cur) throw notFound('Programación');
      if (cur.status !== 'planificada' && (req.body.plannedDate || req.body.stationId || req.body.brigadeId)) {
        throw conflict('Esta programación ya se inició; los cambios de fecha o estación se hacen como reprogramación.');
      }
      if (req.body.brigadeId || req.body.stationId) {
        await validatePair(tx, cur.projectId, req.body.brigadeId ?? cur.brigadeId, req.body.stationId ?? cur.stationId);
      }
      await tx.update(schedules).set(req.body).where(eq(schedules.id, cur.id));
      await audit(req, 'schedule', cur.id, 'update', { before: cur, after: req.body }, tx);
      return { ok: true };
    });
  });

  r.delete('/schedules/:id', { onRequest: write, schema: { params: idParam } }, async (req) => {
    const [cur] = await app.db.select().from(schedules).where(eq(schedules.id, req.params.id));
    if (!cur) throw notFound('Programación');
    if (cur.status !== 'planificada') throw conflict('Solo se pueden eliminar programaciones que no se han iniciado');
    await app.db.delete(schedules).where(eq(schedules.id, cur.id));
    await audit(req, 'schedule', cur.id, 'delete', { before: cur });
    return { ok: true };
  });
};
export default schedulesRoutes;
