import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  INQUIRY_FILE_MAX_BYTES, INQUIRY_FILE_TYPES, RESCHEDULE_APPROVER_ROLES, RESCHEDULE_STATUSES, WEB_ROLES, hasAnyRole,
  rescheduleApproveSchema, rescheduleCreateSchema, rescheduleRejectSchema,
  type RescheduleDetail, type RescheduleFile, type RescheduleHistoryItem, type RescheduleOptions, type RescheduleRow,
} from '@toce/shared';
import { db } from '../db/index.js';
import { HttpError, badRequest, conflict, idParam, notFound, projectParam } from '../lib/http.js';
import { approveReschedule, createReschedule, fmtDay, rejectReschedule } from '../lib/reschedules.js';
import { iso } from './records.js';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const limaDay = (col: ReturnType<typeof sql>) => sql`to_char(${col} AT TIME ZONE 'America/Lima', 'YYYY-MM-DD')`;

const ROW = sql`
  SELECT r.id, r.status, r.schedule_id AS "scheduleId", sc.brigade_id AS "brigadeId", b.name AS "brigadeName",
    sc.station_id AS "stationId", s.code AS "stationCode", to_char(sc.original_date, 'YYYY-MM-DD') AS "originalDate",
    ${limaDay(sql`r.from_date`)} AS "fromDate", ${limaDay(sql`r.to_date`)} AS "toDate", r.reason,
    r.incident_id AS "incidentId", i.type AS "incidentType", pu.full_name AS "proposedByName", du.full_name AS "decidedByName",
    ${iso(sql`r.approved_at`)} AS "decidedAt", ${iso(sql`r.created_at`)} AS "createdAt",
    (SELECT count(*)::int FROM attachments a WHERE a.owner_type = 'reschedule' AND a.owner_id = r.id) AS files`;
const FROM = sql`
  FROM reschedules r
  JOIN schedules sc ON sc.id = r.schedule_id
  JOIN brigades b ON b.id = sc.brigade_id
  JOIN stations s ON s.id = sc.station_id
  LEFT JOIN incidents i ON i.id = r.incident_id
  LEFT JOIN users pu ON pu.id = r.proposed_by_id
  LEFT JOIN users du ON du.id = r.approved_by_id`;

const ACTION_LABEL: Record<string, string> = {
  create: 'Propuesta registrada',
  'create:aprobada': 'Registrada y aprobada',
  approve: 'Aprobada',
  reject: 'Rechazada',
  file: 'Evidencia adjunta',
};

/**
 * Reprogramaciones (5.5).
 * Supervisor, coordinador y jefe de proyecto proponen; coordinador y jefe de proyecto aprueban o rechazan.
 * Al aprobar se actualiza el cronograma; los paquetes de trabajo lo reflejan en la siguiente sincronización.
 */
const rescheduleRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const staff = app.requireRoles(...WEB_ROLES, 'jefe_proyecto');
  const approver = app.requireRoles(...RESCHEDULE_APPROVER_ROLES);

  app.addContentTypeParser([...INQUIRY_FILE_TYPES, 'application/octet-stream'], (_req, payload, done) => done(null, payload));

  r.get('/projects/:projectId/reschedules/options', { onRequest: staff, schema: { params: projectParam } }, async (req): Promise<RescheduleOptions> => {
    const p = req.params.projectId;
    const brigades = (await db.execute(sql`SELECT id, name FROM brigades WHERE project_id = ${p} AND is_active ORDER BY name`)).rows as RescheduleOptions['brigades'];
    const visits = (await db.execute(sql`
      SELECT sc.id, to_char(sc.planned_date, 'YYYY-MM-DD') AS "plannedDate", to_char(sc.original_date, 'YYYY-MM-DD') AS "originalDate", sc.status,
        sc.brigade_id AS "brigadeId", b.name AS "brigadeName", sc.station_id AS "stationId", s.code AS "stationCode",
        EXISTS (SELECT 1 FROM reschedules r WHERE r.schedule_id = sc.id AND r.status = 'propuesta') AS pending
      FROM schedules sc JOIN brigades b ON b.id = sc.brigade_id JOIN stations s ON s.id = sc.station_id AND s.deleted_at IS NULL
      WHERE sc.project_id = ${p} AND sc.status NOT IN ('cancelada', 'ejecutada')
      ORDER BY sc.planned_date, b.name, s.code`)).rows as RescheduleOptions['visits'];
    const incidents = (await db.execute(sql`
      SELECT i.id, i.type, i.description, i.status, i.brigade_id AS "brigadeId", i.station_id AS "stationId", s.code AS "stationCode",
        u.full_name AS "reportedByName", ${iso(sql`i.occurred_at`)} AS "occurredAt",
        (NOT EXISTS (SELECT 1 FROM reschedules r WHERE r.incident_id = i.id)
          AND (i.proposed_action ILIKE '%reprogram%' OR EXISTS (
            SELECT 1 FROM sampling_units su WHERE su.id = i.sampling_unit_id AND su.status = 'no_realizada'))) AS "needsReschedule"
      FROM incidents i JOIN users u ON u.id = i.reported_by_id LEFT JOIN stations s ON s.id = i.station_id
      WHERE i.project_id = ${p} AND i.status IN ('abierta', 'en_revision', 'resuelta')
      ORDER BY i.occurred_at DESC LIMIT 300`)).rows as RescheduleOptions['incidents'];
    return { brigades, visits, incidents };
  });

  r.get(
    '/projects/:projectId/reschedules',
    {
      onRequest: staff,
      schema: {
        params: projectParam,
        querystring: z.object({
          status: z.enum(RESCHEDULE_STATUSES).optional(),
          brigadeId: z.string().uuid().optional(),
          q: z.string().trim().max(100).optional(),
        }),
      },
    },
    async (req): Promise<RescheduleRow[]> => {
      const { status, brigadeId, q } = req.query;
      const like = q ? `%${q}%` : null;
      return (await db.execute(sql`${ROW} ${FROM}
        WHERE sc.project_id = ${req.params.projectId}
          ${status ? sql`AND r.status = ${status}` : sql``}
          ${brigadeId ? sql`AND sc.brigade_id = ${brigadeId}` : sql``}
          ${like ? sql`AND (s.code ILIKE ${like} OR b.name ILIKE ${like} OR r.reason ILIKE ${like} OR coalesce(r.justification, '') ILIKE ${like}
            OR coalesce(pu.full_name, '') ILIKE ${like})` : sql``}
        ORDER BY (r.status = 'propuesta') DESC, r.created_at DESC LIMIT 500`)).rows as RescheduleRow[];
    },
  );

  r.get('/reschedules/:id', { onRequest: staff, schema: { params: idParam } }, async (req): Promise<RescheduleDetail> => {
    const row = (await db.execute(sql`${ROW}, r.justification, r.decision_notes AS "decisionNotes", r.reopen_units AS "reopenUnits",
        sc.status AS "scheduleStatus", to_char(sc.planned_date, 'YYYY-MM-DD') AS "currentDate",
        i.description AS "incidentDescription", i.status AS "incidentStatus"
      ${FROM} WHERE r.id = ${req.params.id}`)).rows[0] as Omit<RescheduleDetail, 'fileList' | 'visitHistory' | 'log'> | undefined;
    if (!row) throw notFound('Reprogramación');
    const [files, visitHistory, log] = await Promise.all([
      db.execute(sql`
        SELECT id, kind, caption AS name, mime_type AS "mimeType", size_bytes AS "sizeBytes"
        FROM attachments WHERE owner_type = 'reschedule' AND owner_id = ${row.id} ORDER BY created_at`),
      db.execute(sql`
        SELECT r.id, r.status, ${limaDay(sql`r.from_date`)} AS "fromDate", ${limaDay(sql`r.to_date`)} AS "toDate", r.reason,
          du.full_name AS "decidedByName", ${iso(sql`r.approved_at`)} AS "decidedAt", ${iso(sql`r.created_at`)} AS "createdAt"
        FROM reschedules r LEFT JOIN users du ON du.id = r.approved_by_id
        WHERE r.schedule_id = ${row.scheduleId} ORDER BY r.created_at`),
      db.execute(sql`
        SELECT ${iso(sql`l.at`)} AS at, l.action, u.full_name AS "userName", l.after AS data
        FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.entity = 'reschedule' AND l.entity_id = ${row.id} ORDER BY l.at`),
    ]);
    return {
      ...row,
      fileList: (files.rows as RescheduleFile[]).map((f) => ({ ...f, sizeBytes: f.sizeBytes == null ? null : Number(f.sizeBytes) })),
      visitHistory: visitHistory.rows as RescheduleDetail['visitHistory'],
      log: (log.rows as { at: string; action: string; userName: string | null; data: Record<string, unknown> | null }[]).map((l): RescheduleHistoryItem => {
        const d = l.data ?? {};
        const detail = l.action === 'approve' && d.toDate ? `Nueva fecha ${fmtDay(String(d.toDate))}${d.note ? ` · ${String(d.note)}` : ''}`
          : l.action === 'reject' ? (d.note ? String(d.note) : null)
            : l.action === 'file' ? (d.name ? String(d.name) : null)
              : l.action.startsWith('create') && d.newDate ? `Del ${fmtDay(String(d.fromDate))} al ${fmtDay(String(d.newDate))}` : null;
        return { at: l.at, action: ACTION_LABEL[l.action] ?? l.action, userName: l.userName, detail };
      }),
    };
  });

  r.post('/projects/:projectId/reschedules', { onRequest: staff, schema: { params: projectParam, body: rescheduleCreateSchema } }, async (req, reply) => {
    if (req.body.approve && !hasAnyRole(req.user.roles, [...RESCHEDULE_APPROVER_ROLES])) {
      throw new HttpError(403, 'Solo coordinación o la jefatura del proyecto aprueban reprogramaciones; guárdala como propuesta');
    }
    const out = await db.transaction((tx) => createReschedule(tx, req, req.params.projectId, req.body));
    return reply.code(201).send(out);
  });

  r.post('/reschedules/:id/approve', { onRequest: approver, schema: { params: idParam, body: rescheduleApproveSchema } }, async (req) =>
    db.transaction((tx) => approveReschedule(tx, req, req.params.id, req.body)),
  );

  r.post('/reschedules/:id/reject', { onRequest: approver, schema: { params: idParam, body: rescheduleRejectSchema } }, async (req) =>
    db.transaction((tx) => rejectReschedule(tx, req, req.params.id, req.body.note)),
  );

  // Evidencias del sustento (actas, fotos, partes de lluvia, etc.).
  r.put(
    '/reschedules/:id/files',
    { onRequest: staff, schema: { params: idParam, querystring: z.object({ name: z.string().trim().min(1).max(200) }) } },
    async (req) => {
      const mime = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
      if (!(INQUIRY_FILE_TYPES as readonly string[]).includes(mime)) throw badRequest('Tipo de archivo no admitido (fotos, PDF, audio, Excel o Word)');
      const declared = req.headers['content-length'] ? Number(req.headers['content-length']) : undefined;
      if (!declared) throw badRequest('Archivo vacío');
      if (declared > INQUIRY_FILE_MAX_BYTES) throw badRequest('El archivo supera los 25 MB');
      const rs = (await db.execute(sql`
        SELECT r.id, p.code AS project, sc.project_id AS "projectId", sc.station_id AS "stationId"
        FROM reschedules r JOIN schedules sc ON sc.id = r.schedule_id JOIN projects p ON p.id = sc.project_id
        WHERE r.id = ${req.params.id}`)).rows[0] as { id: string; project: string; projectId: string; stationId: string } | undefined;
      if (!rs) throw notFound('Reprogramación');
      const body = req.body as Readable | undefined;
      if (!body || typeof body.pipe !== 'function') throw badRequest('Archivo vacío');

      const clientId = randomUUID();
      const kind = mime.startsWith('image/') ? 'foto' : mime.startsWith('audio/') ? 'audio' : 'documento';
      const key = `${rs.project}/reprogramaciones/${rs.id}/${kind === 'foto' ? 'fotos' : kind === 'audio' ? 'audios' : 'documentos'}/${clientId}.${EXT[mime] ?? 'bin'}`;
      await app.minio.putObject(app.minioBucket, key, body, declared, { 'Content-Type': mime });
      const stat = await app.minio.statObject(app.minioBucket, key);
      const row = (await db.execute(sql`
        INSERT INTO attachments (client_id, owner_type, owner_id, kind, object_key, mime_type, size_bytes, taken_at, uploaded_by_id,
          project_id, station_id, upload_status, original_upload_status, caption)
        VALUES (${clientId}, 'reschedule', ${rs.id}, ${kind}, ${key}, ${mime}, ${stat.size}, now(), ${req.user.sub},
          ${rs.projectId}, ${rs.stationId}, 'subido', 'subido', ${req.query.name})
        RETURNING id`)).rows[0] as { id: string };
      await db.execute(sql`
        INSERT INTO audit_logs (user_id, entity, entity_id, action, after, ip_address)
        VALUES (${req.user.sub}, 'reschedule', ${rs.id}, 'file', ${JSON.stringify({ name: req.query.name, attachmentId: row.id })}::jsonb, ${req.ip})`);
      return { id: row.id, size: stat.size };
    },
  );

  r.get('/reschedule-files/:id/url', { onRequest: staff, schema: { params: idParam } }, async (req) => {
    const a = (await db.execute(sql`
      SELECT object_key AS "key", caption AS name, upload_status AS up FROM attachments WHERE id = ${req.params.id} AND owner_type = 'reschedule'`)).rows[0] as
      | { key: string; name: string | null; up: string }
      | undefined;
    if (!a) throw notFound('Archivo');
    if (a.up !== 'subido') throw conflict('El archivo aún no se ha subido');
    const url = await app.minioSign.presignedGetObject(app.minioBucket, a.key, 15 * 60, {
      'response-content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.name ?? 'archivo')}`,
    });
    return { url };
  });
};

export default rescheduleRoutes;
