import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ADMIN_ROLES, INCIDENT_DECISION_LABELS, INCIDENT_STATUSES, INCIDENT_TYPES, WEB_ROLES, hasAnyRole,
  incidentDecisionSchema, incidentMessageSchema, incidentSyncSchema, rescheduleSchema,
  type BrigadeIncidentDto, type IncidentMessageDto, type MyIncidentDto,
} from '@toce/shared';
import { db } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, conflict, idParam, notFound, projectParam } from '../lib/http.js';

/** ¿Participa el usuario en la brigada (jefe, miembro, supervisor o logístico)? */
async function inBrigade(userId: string, brigadeId: string) {
  const r = await db.execute(sql`
    SELECT 1 FROM brigades b WHERE b.id = ${brigadeId} AND (
      b.leader_id = ${userId} OR b.supervisor_id = ${userId} OR b.logistician_id = ${userId}
      OR EXISTS (SELECT 1 FROM brigade_members bm WHERE bm.brigade_id = b.id AND bm.user_id = ${userId} AND bm.left_at IS NULL))`);
  return r.rows.length > 0;
}

/** ¿Es el usuario supervisor de la brigada? */
async function supervises(userId: string, brigadeId: string | null) {
  if (!brigadeId) return false;
  const r = await db.execute(sql`SELECT 1 FROM brigades WHERE id = ${brigadeId} AND supervisor_id = ${userId}`);
  return r.rows.length > 0;
}

async function stationAllowed(userId: string, stationId: string) {
  const r = await db.execute(sql`
    SELECT 1 FROM schedules sc JOIN brigades b ON b.id = sc.brigade_id AND b.is_active
    WHERE sc.station_id = ${stationId} AND (
      b.leader_id = ${userId} OR b.supervisor_id = ${userId} OR b.logistician_id = ${userId}
      OR EXISTS (SELECT 1 FROM brigade_members bm WHERE bm.brigade_id = b.id AND bm.user_id = ${userId} AND bm.left_at IS NULL))
    LIMIT 1`);
  return r.rows.length > 0;
}

const messagesOf = async (incidentIds: string[]) => {
  if (!incidentIds.length) return [] as (IncidentMessageDto & { incidentId: string })[];
  return (await db.execute(sql`
    SELECT m.id, m.client_id AS "clientId", m.incident_id AS "incidentId", m.author_id AS "authorId", u.full_name AS "authorName",
      m.body, m.kind, m.sent_at AS "sentAt"
    FROM incident_messages m JOIN users u ON u.id = m.author_id
    WHERE m.incident_id IN (${sql.join(incidentIds.map((i) => sql`${i}`), sql`, `)})
    ORDER BY m.sent_at, m.created_at`)).rows as (IncidentMessageDto & { incidentId: string })[];
};

const reschedulesOf = async (incidentIds: string[]) => {
  if (!incidentIds.length) return [] as { incidentId: string; fromDate: string; toDate: string; reason: string; approvedByName: string | null }[];
  return (await db.execute(sql`
    SELECT r.incident_id AS "incidentId", to_char(r.from_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "fromDate",
      to_char(r.to_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "toDate", r.reason, u.full_name AS "approvedByName"
    FROM reschedules r LEFT JOIN users u ON u.id = r.approved_by_id
    WHERE r.incident_id IN (${sql.join(incidentIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY r.created_at`)).rows as {
    incidentId: string; fromDate: string; toDate: string; reason: string; approvedByName: string | null;
  }[];
};

/**
 * Alertas e incidencias.
 * Teléfono: POST /field/incidents, GET /field/incidents/mine, POST /field/incidents/:clientId/messages.
 * Web: bandeja por proyecto, detalle, mensajes, respuesta de coordinación, cierre y reprogramación.
 */
const incidentRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.requireRoles(...WEB_ROLES, 'jefe_proyecto');
  const write = app.requireRoles(...ADMIN_ROLES);

  // ---------------------------------------------------------------- teléfono

  r.post('/field/incidents', { onRequest: app.authenticate, schema: { body: incidentSyncSchema } }, async (req) => {
    const i = req.body;
    const userId = req.user.sub;
    const web = hasAnyRole(req.user.roles, WEB_ROLES);

    // Proyecto: de la estación, de la brigada o el indicado.
    let projectId = i.projectId ?? null;
    if (i.stationId) {
      const st = (await db.execute(sql`SELECT project_id AS "projectId" FROM stations WHERE id = ${i.stationId} AND deleted_at IS NULL`)).rows[0] as { projectId: string } | undefined;
      if (!st) throw notFound('Estación');
      if (!web && !(await stationAllowed(userId, i.stationId))) throw new HttpError(403, 'No tienes programación en esta estación');
      projectId = st.projectId;
    }
    if (i.brigadeId) {
      const b = (await db.execute(sql`SELECT project_id AS "projectId" FROM brigades WHERE id = ${i.brigadeId}`)).rows[0] as { projectId: string } | undefined;
      if (!b) throw notFound('Brigada');
      if (!web && !(await inBrigade(userId, i.brigadeId))) throw new HttpError(403, 'No perteneces a esta brigada');
      if (projectId && projectId !== b.projectId) throw badRequest('La brigada no es del proyecto de la estación');
      projectId ??= b.projectId;
    }
    if (!projectId) throw badRequest('Indica la estación o la brigada de la alerta');
    if (i.samplingUnitId) {
      const u = (await db.execute(sql`SELECT station_id AS "stationId" FROM sampling_units WHERE id = ${i.samplingUnitId}`)).rows[0] as { stationId: string } | undefined;
      if (!u || u.stationId !== i.stationId) throw badRequest('La unidad no pertenece a la estación');
    }

    return db.transaction(async (tx) => {
      const prev = (await tx.execute(sql`
        SELECT id, reported_by_id AS "by", status, client_updated_at AS "cu", coordination_decision AS "decision"
        FROM incidents WHERE client_id = ${i.clientId} FOR UPDATE`)).rows[0] as
        | { id: string; by: string; status: string; cu: string | Date; decision: string | null }
        | undefined;
      if (prev && prev.by !== userId) throw new HttpError(403, 'Esta alerta pertenece a otro usuario');
      // Se edita mientras coordinación no la haya resuelto (abierta, en revisión o resuelta en campo) y si el envío es más reciente.
      const editable = !prev || prev.status === 'abierta' || prev.status === 'en_revision' || (prev.status === 'resuelta' && !prev.decision);
      if (prev && (!editable || new Date(prev.cu).getTime() >= new Date(i.clientUpdatedAt).getTime())) {
        return { id: prev.id, clientId: i.clientId, status: prev.status, applied: false };
      }
      // El supervisor que documenta cómo se resolvió la deja "resuelta en campo" (coordinación puede responder igual).
      const fieldResolved = !!i.resolutionNotes && (await supervises(userId, i.brigadeId ?? null));
      const geom = i.lat != null && i.lng != null ? sql`ST_SetSRID(ST_MakePoint(${i.lng}, ${i.lat}), 4326)` : sql`NULL`;
      const row = (await tx.execute(sql`
        INSERT INTO incidents (client_id, project_id, brigade_id, station_id, method_id, sampling_unit_id, schedule_id, reported_by_id,
          type, moment, launched_from, description, proposed_action, methodological_deviation, field_corrective_action, resolution_notes,
          status, resolved_by_id, resolved_at, occurred_at, geom, client_updated_at)
        VALUES (${i.clientId}, ${projectId}, ${i.brigadeId ?? null}, ${i.stationId ?? null}, ${i.methodId ?? null}, ${i.samplingUnitId ?? null},
          ${i.scheduleId ?? null}, ${userId}, ${i.type}, ${i.moment ?? null}, ${i.launchedFrom ?? null}, ${i.description},
          ${i.proposedAction ?? null}, ${i.methodologicalDeviation ?? null}, ${i.correctiveAction ?? null}, ${i.resolutionNotes ?? null},
          ${fieldResolved ? 'resuelta' : 'abierta'}, ${fieldResolved ? userId : null}, ${fieldResolved ? sql`now()` : sql`NULL`},
          ${i.occurredAt}, ${geom}, ${i.clientUpdatedAt})
        ON CONFLICT (client_id) DO UPDATE SET type = EXCLUDED.type, moment = EXCLUDED.moment, description = EXCLUDED.description,
          proposed_action = EXCLUDED.proposed_action, method_id = EXCLUDED.method_id, sampling_unit_id = EXCLUDED.sampling_unit_id,
          methodological_deviation = EXCLUDED.methodological_deviation, field_corrective_action = EXCLUDED.field_corrective_action,
          resolution_notes = EXCLUDED.resolution_notes,
          -- Resuelta en campo: pasa a "resuelta"; si se borra la solución vuelve a "abierta".
          status = CASE
            WHEN ${fieldResolved} THEN 'resuelta'::incident_status
            WHEN incidents.status = 'resuelta' THEN 'abierta'::incident_status
            ELSE incidents.status END,
          resolved_by_id = CASE WHEN ${fieldResolved} THEN ${userId}::uuid WHEN incidents.status = 'resuelta' THEN NULL ELSE incidents.resolved_by_id END,
          resolved_at = CASE WHEN ${fieldResolved} THEN COALESCE(incidents.resolved_at, now()) WHEN incidents.status = 'resuelta' THEN NULL ELSE incidents.resolved_at END,
          client_updated_at = EXCLUDED.client_updated_at, updated_at = now()
        RETURNING id, status`)).rows[0] as { id: string; status: string };
      if (i.unitNotDone && i.samplingUnitId) {
        await tx.execute(sql`
          UPDATE sampling_units SET status = 'no_realizada', updated_at = now()
          WHERE id = ${i.samplingUnitId} AND status IN ('pendiente', 'en_ejecucion', 'fotos_ok')`);
      }
      if (!prev) await audit(req, 'incident', row.id, 'create', { after: { type: i.type, stationId: i.stationId, unitNotDone: !!i.unitNotDone, fieldResolved } }, tx);
      else if (fieldResolved && prev.status !== 'resuelta') await audit(req, 'incident', row.id, 'field_resolved', { before: { status: prev.status }, after: { resolutionNotes: i.resolutionNotes } }, tx);
      return { id: row.id, clientId: i.clientId, status: row.status, applied: true };
    });
  });

  r.get('/field/incidents/mine', { onRequest: app.authenticate }, async (req): Promise<MyIncidentDto[]> => {
    const rows = (await db.execute(sql`
      SELECT i.id, i.client_id AS "clientId", i.status, i.coordination_decision AS "coordinationDecision",
        i.coordination_response AS "coordinationResponse", i.corrective_action AS "correctiveAction",
        i.resolved_at AS "resolvedAt", u.full_name AS "resolvedByName", i.updated_at AS "updatedAt"
      FROM incidents i LEFT JOIN users u ON u.id = i.resolved_by_id
      WHERE i.reported_by_id = ${req.user.sub} AND i.created_at > now() - interval '90 days'
      ORDER BY i.occurred_at DESC`)).rows as Omit<MyIncidentDto, 'messages' | 'reschedules'>[];
    const ids = rows.map((x) => x.id);
    const [msgs, rs] = await Promise.all([messagesOf(ids), reschedulesOf(ids)]);
    return rows.map((x) => ({
      ...x,
      messages: msgs.filter((m) => m.incidentId === x.id).map(({ incidentId: _i, ...m }) => m),
      reschedules: rs.filter((m) => m.incidentId === x.id).map(({ incidentId: _i, ...m }) => m),
    }));
  });

  /** Supervisor: alertas de sus brigadas registradas por otras personas (últimos 30 días). */
  r.get('/field/incidents/brigades', { onRequest: app.authenticate }, async (req): Promise<BrigadeIncidentDto[]> => {
    const rows = (await db.execute(sql`
      SELECT i.id, i.client_id AS "clientId", i.status, i.coordination_decision AS "coordinationDecision",
        i.coordination_response AS "coordinationResponse", i.corrective_action AS "correctiveAction",
        i.resolved_at AS "resolvedAt", rv.full_name AS "resolvedByName", i.updated_at AS "updatedAt",
        i.type, i.moment, i.launched_from AS "launchedFrom", i.description, i.proposed_action AS "proposedAction",
        i.methodological_deviation AS "methodologicalDeviation", i.resolution_notes AS "resolutionNotes", i.occurred_at AS "occurredAt",
        i.reported_by_id AS "reportedById", ru.full_name AS "reportedByName", i.brigade_id AS "brigadeId", i.station_id AS "stationId",
        s.code AS "stationCode", su.code AS "unitCode", m.code AS "methodCode",
        (SELECT count(*)::int FROM attachments a WHERE a.owner_type = 'incident' AND a.owner_id = i.id) AS files
      FROM incidents i
      JOIN brigades b ON b.id = i.brigade_id AND b.supervisor_id = ${req.user.sub}
      JOIN users ru ON ru.id = i.reported_by_id
      LEFT JOIN users rv ON rv.id = i.resolved_by_id
      LEFT JOIN stations s ON s.id = i.station_id
      LEFT JOIN sampling_units su ON su.id = i.sampling_unit_id
      LEFT JOIN methods m ON m.id = i.method_id
      WHERE i.reported_by_id <> ${req.user.sub} AND i.created_at > now() - interval '30 days'
      ORDER BY i.occurred_at DESC
      LIMIT 300`)).rows as Omit<BrigadeIncidentDto, 'messages' | 'reschedules'>[];
    const ids = rows.map((x) => x.id);
    const [msgs, rs] = await Promise.all([messagesOf(ids), reschedulesOf(ids)]);
    return rows.map((x) => ({
      ...x,
      messages: msgs.filter((m) => m.incidentId === x.id).map(({ incidentId: _i, ...m }) => m),
      reschedules: rs.filter((m) => m.incidentId === x.id).map(({ incidentId: _i, ...m }) => m),
    }));
  });

  r.post(
    '/field/incidents/:clientId/messages',
    { onRequest: app.authenticate, schema: { params: z.object({ clientId: z.string().uuid() }), body: incidentMessageSchema } },
    async (req) => {
      const inc = (await db.execute(sql`
        SELECT id, reported_by_id AS "by", brigade_id AS "brigadeId" FROM incidents WHERE client_id = ${req.params.clientId}`)).rows[0] as
        | { id: string; by: string; brigadeId: string | null }
        | undefined;
      if (!inc) throw conflict('Primero se debe sincronizar la alerta');
      // Responde quien la registró; el supervisor de la brigada deja notas de supervisión.
      const own = inc.by === req.user.sub;
      if (!own && !(await supervises(req.user.sub, inc.brigadeId))) throw new HttpError(403, 'Esta alerta pertenece a otro usuario');
      await db.execute(sql`
        INSERT INTO incident_messages (client_id, incident_id, author_id, body, kind, sent_at)
        VALUES (${req.body.clientId}, ${inc.id}, ${req.user.sub}, ${req.body.body}, ${own ? 'respuesta' : 'comentario'}, ${req.body.sentAt})
        ON CONFLICT (client_id) DO NOTHING`);
      await db.execute(sql`UPDATE incidents SET updated_at = now() WHERE id = ${inc.id}`);
      return { ok: true };
    },
  );

  // ---------------------------------------------------------------- web

  r.get(
    '/projects/:projectId/incidents',
    {
      onRequest: read,
      schema: {
        params: projectParam,
        querystring: z.object({
          status: z.enum(INCIDENT_STATUSES).optional(),
          type: z.enum(INCIDENT_TYPES).optional(),
          brigadeId: z.string().uuid().optional(),
          stationId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) => {
      const q = req.query;
      const conds = [sql`i.project_id = ${req.params.projectId}`];
      if (q.status) conds.push(sql`i.status = ${q.status}`);
      if (q.type) conds.push(sql`i.type = ${q.type}`);
      if (q.brigadeId) conds.push(sql`i.brigade_id = ${q.brigadeId}`);
      if (q.stationId) conds.push(sql`i.station_id = ${q.stationId}`);
      return (await db.execute(sql`
        SELECT i.id, i.type, i.moment, i.status, i.description, i.proposed_action AS "proposedAction", i.occurred_at AS "occurredAt",
          i.launched_from AS "launchedFrom", (i.resolution_notes IS NOT NULL AND i.coordination_decision IS NULL AND i.status = 'resuelta') AS "fieldResolved",
          i.coordination_decision AS "coordinationDecision", i.updated_at AS "updatedAt",
          ru.full_name AS "reportedBy", b.name AS "brigadeName", s.code AS "stationCode", m.code AS "methodCode", su.code AS "unitCode",
          (SELECT count(*)::int FROM attachments a WHERE a.owner_type = 'incident' AND a.owner_id = i.id) AS "files",
          (SELECT count(*)::int FROM incident_messages im WHERE im.incident_id = i.id) AS "messages",
          (SELECT max(im.sent_at) FROM incident_messages im WHERE im.incident_id = i.id AND im.author_id = i.reported_by_id) AS "lastReplyAt"
        FROM incidents i
        JOIN users ru ON ru.id = i.reported_by_id
        LEFT JOIN brigades b ON b.id = i.brigade_id
        LEFT JOIN stations s ON s.id = i.station_id
        LEFT JOIN methods m ON m.id = i.method_id
        LEFT JOIN sampling_units su ON su.id = i.sampling_unit_id
        WHERE ${sql.join(conds, sql` AND `)}
        ORDER BY CASE i.status WHEN 'abierta' THEN 0 WHEN 'en_revision' THEN 1 ELSE 2 END, i.occurred_at DESC
        LIMIT 500`)).rows;
    },
  );

  r.get('/incidents/:id', { onRequest: read, schema: { params: idParam } }, async (req) => {
    const inc = (await db.execute(sql`
      SELECT i.id, i.project_id AS "projectId", i.type, i.moment, i.launched_from AS "launchedFrom", i.status, i.description,
        i.proposed_action AS "proposedAction", i.occurred_at AS "occurredAt", i.created_at AS "syncedAt",
        i.methodological_deviation AS "methodologicalDeviation", i.field_corrective_action AS "fieldCorrectiveAction",
        i.resolution_notes AS "resolutionNotes",
        (i.resolution_notes IS NOT NULL AND i.coordination_decision IS NULL AND i.status = 'resuelta') AS "fieldResolved",
        ST_Y(i.geom) AS lat, ST_X(i.geom) AS lng,
        i.coordination_decision AS "coordinationDecision", i.coordination_response AS "coordinationResponse",
        i.corrective_action AS "correctiveAction", i.resolved_at AS "resolvedAt", rv.full_name AS "resolvedByName",
        i.reported_by_id AS "reportedById", ru.full_name AS "reportedBy", ru.phone AS "reporterPhone",
        i.brigade_id AS "brigadeId", b.name AS "brigadeName", i.station_id AS "stationId", s.code AS "stationCode",
        s.influence_area AS "influenceArea", s.vegetation_unit AS "vegetationUnit",
        m.code AS "methodCode", m.name AS "methodName", su.code AS "unitCode", su.status AS "unitStatus",
        i.schedule_id AS "scheduleId"
      FROM incidents i
      JOIN users ru ON ru.id = i.reported_by_id
      LEFT JOIN users rv ON rv.id = i.resolved_by_id
      LEFT JOIN brigades b ON b.id = i.brigade_id
      LEFT JOIN stations s ON s.id = i.station_id
      LEFT JOIN methods m ON m.id = i.method_id
      LEFT JOIN sampling_units su ON su.id = i.sampling_unit_id
      WHERE i.id = ${req.params.id}`)).rows[0] as { id: string; stationId: string | null; brigadeId: string | null } | undefined;
    if (!inc) throw notFound('Alerta');
    const [messages, reschedules] = await Promise.all([messagesOf([inc.id]), reschedulesOf([inc.id])]);
    const files = (await db.execute(sql`
      SELECT id, kind, mime_type AS "mimeType", width, height, duration_sec AS "durationSec", taken_at AS "takenAt",
        upload_status AS "uploadStatus", original_upload_status AS "originalUploadStatus"
      FROM attachments WHERE owner_type = 'incident' AND owner_id = ${inc.id} ORDER BY taken_at`)).rows;
    // Visitas de la estación que se pueden reprogramar.
    const schedules = inc.stationId
      ? (await db.execute(sql`
          SELECT sc.id, to_char(sc.planned_date, 'YYYY-MM-DD') AS "plannedDate", sc.status, b.name AS "brigadeName"
          FROM schedules sc JOIN brigades b ON b.id = sc.brigade_id
          WHERE sc.station_id = ${inc.stationId} AND sc.status <> 'cancelada' ${inc.brigadeId ? sql`AND sc.brigade_id = ${inc.brigadeId}` : sql``}
          ORDER BY sc.planned_date`)).rows
      : [];
    return { ...inc, messages: messages.map(({ incidentId: _i, ...m }) => m), reschedules: reschedules.map(({ incidentId: _i, ...m }) => m), files, schedules };
  });

  r.post(
    '/incidents/:id/messages',
    { onRequest: read, schema: { params: idParam, body: z.object({ body: z.string().trim().min(1).max(4000), kind: z.enum(['comentario', 'solicitud_info']).default('comentario') }) } },
    async (req) => {
      const inc = (await db.execute(sql`SELECT id, status FROM incidents WHERE id = ${req.params.id}`)).rows[0] as { id: string; status: string } | undefined;
      if (!inc) throw notFound('Alerta');
      await db.execute(sql`
        INSERT INTO incident_messages (client_id, incident_id, author_id, body, kind, sent_at)
        VALUES (gen_random_uuid(), ${inc.id}, ${req.user.sub}, ${req.body.body}, ${req.body.kind}, now())`);
      // Pedir información pone la alerta "en revisión".
      await db.execute(sql`
        UPDATE incidents SET updated_at = now(), status = CASE WHEN ${req.body.kind} = 'solicitud_info' AND status = 'abierta' THEN 'en_revision'::incident_status ELSE status END
        WHERE id = ${inc.id}`);
      return { ok: true };
    },
  );

  r.post('/incidents/:id/decision', { onRequest: write, schema: { params: idParam, body: incidentDecisionSchema } }, async (req) => {
    const d = req.body;
    return db.transaction(async (tx) => {
      const before = (await tx.execute(sql`SELECT id, status FROM incidents WHERE id = ${req.params.id} FOR UPDATE`)).rows[0] as { id: string; status: string } | undefined;
      if (!before) throw notFound('Alerta');
      if (before.status === 'cerrada') throw conflict('La alerta está cerrada');
      const status = d.decision === 'aprobada' ? 'resuelta' : d.decision === 'rechazada' ? 'rechazada' : 'en_revision';
      const final = d.decision !== 'info_adicional';
      await tx.execute(sql`
        UPDATE incidents SET status = ${status}, coordination_decision = ${d.decision}, coordination_response = ${d.response},
          corrective_action = ${d.correctiveAction ?? null},
          resolved_by_id = ${final ? req.user.sub : null}, resolved_at = ${final ? sql`now()` : sql`NULL`}, updated_at = now()
        WHERE id = ${before.id}`);
      const body = `${INCIDENT_DECISION_LABELS[d.decision]}. ${d.response}${d.correctiveAction ? `\nAcción correctiva: ${d.correctiveAction}` : ''}`;
      await tx.execute(sql`
        INSERT INTO incident_messages (client_id, incident_id, author_id, body, kind, sent_at)
        VALUES (gen_random_uuid(), ${before.id}, ${req.user.sub}, ${body}, ${d.decision === 'info_adicional' ? 'solicitud_info' : 'decision'}, now())`);
      await audit(req, 'incident', before.id, `decision:${d.decision}`, { before: { status: before.status }, after: { status, ...d } }, tx);
      return { ok: true, status };
    });
  });

  r.post('/incidents/:id/close', { onRequest: write, schema: { params: idParam } }, async (req) => {
    const res = await db.execute(sql`UPDATE incidents SET status = 'cerrada', updated_at = now() WHERE id = ${req.params.id} AND status IN ('resuelta', 'rechazada') RETURNING id`);
    if (!res.rows.length) throw conflict('Solo se cierran alertas resueltas o rechazadas');
    await audit(req, 'incident', req.params.id, 'close');
    return { ok: true };
  });

  r.post('/incidents/:id/reschedule', { onRequest: write, schema: { params: idParam, body: rescheduleSchema } }, async (req) => {
    const b = req.body;
    return db.transaction(async (tx) => {
      const inc = (await tx.execute(sql`SELECT id, project_id AS "projectId", reported_by_id AS "by" FROM incidents WHERE id = ${req.params.id}`)).rows[0] as
        | { id: string; projectId: string; by: string }
        | undefined;
      if (!inc) throw notFound('Alerta');
      const sc = (await tx.execute(sql`
        SELECT sc.id, to_char(sc.planned_date, 'YYYY-MM-DD') AS "plannedDate", sc.station_id AS "stationId", b.project_id AS "projectId",
          b.specialty_id AS "specialtyId", sc.status
        FROM schedules sc JOIN brigades b ON b.id = sc.brigade_id WHERE sc.id = ${b.scheduleId} FOR UPDATE OF sc`)).rows[0] as
        | { id: string; plannedDate: string; stationId: string; projectId: string; specialtyId: string | null; status: string }
        | undefined;
      if (!sc || sc.projectId !== inc.projectId) throw badRequest('La programación no es del proyecto de la alerta');
      if (sc.status === 'cancelada') throw conflict('La programación está cancelada');
      if (sc.plannedDate === b.newDate) throw badRequest('La nueva fecha es igual a la programada');

      await tx.execute(sql`UPDATE schedules SET planned_date = ${b.newDate}::date, status = 'planificada', updated_at = now() WHERE id = ${sc.id}`);
      await tx.execute(sql`
        INSERT INTO reschedules (schedule_id, incident_id, from_date, to_date, reason, status, proposed_by_id, approved_by_id, approved_at)
        VALUES (${sc.id}, ${inc.id}, ${`${sc.plannedDate}T12:00:00-05:00`}, ${`${b.newDate}T12:00:00-05:00`}, ${b.reason}, 'aprobada', ${inc.by}, ${req.user.sub}, now())`);
      let reopened = 0;
      if (b.reopenUnits) {
        // Unidades "no realizadas" de la estación (de la especialidad de la brigada) vuelven a pendiente.
        const res = await tx.execute(sql`
          UPDATE sampling_units su SET status = 'pendiente', updated_at = now()
          FROM methods m WHERE m.id = su.method_id AND su.station_id = ${sc.stationId} AND su.status = 'no_realizada'
            ${sc.specialtyId ? sql`AND m.specialty_id = ${sc.specialtyId}` : sql``}
          RETURNING su.id`);
        reopened = res.rows.length;
      }
      const fmt = (d: string) => d.split('-').reverse().join('/');
      await tx.execute(sql`
        INSERT INTO incident_messages (client_id, incident_id, author_id, body, kind, sent_at)
        VALUES (gen_random_uuid(), ${inc.id}, ${req.user.sub},
          ${`Reprogramado del ${fmt(sc.plannedDate)} al ${fmt(b.newDate)}. ${b.reason}${reopened ? ` (${reopened} unidad${reopened > 1 ? 'es' : ''} vuelve${reopened > 1 ? 'n' : ''} a pendiente)` : ''}`},
          'decision', now())`);
      await tx.execute(sql`UPDATE incidents SET updated_at = now() WHERE id = ${inc.id}`);
      await audit(req, 'schedule', sc.id, 'reschedule', { before: { plannedDate: sc.plannedDate }, after: { plannedDate: b.newDate, incidentId: inc.id, reopened } }, tx);
      return { ok: true, fromDate: sc.plannedDate, toDate: b.newDate, reopened };
    });
  });
};

export default incidentRoutes;
