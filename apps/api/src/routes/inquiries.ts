import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  INQUIRY_FILE_MAX_BYTES, INQUIRY_FILE_TYPES, INQUIRY_STATUSES, WEB_ROLES, hasAnyRole, inquiryCreateSchema, inquiryMessageSchema,
  inquiryReplySchema,
  type InquiryDetail, type InquiryFile, type InquiryMessageDto, type InquiryOptions, type InquiryRow, type MyInquiryDto,
} from '@toce/shared';
import { db } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, conflict, idParam, notFound, projectParam } from '../lib/http.js';
import { iso } from './records.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const ids = (list: string[]) => sql.join(list.map((i) => sql`${i}`), sql`, `);

/** Personas de campo de una brigada (jefe, integrantes, supervisor y logístico). */
const PEOPLE = (brigade: SQL) => sql`
  SELECT DISTINCT ON (u.id) u.id, u.full_name AS "fullName", u.phone, x.role
  FROM (
    SELECT b.leader_id AS uid, 'Jefe de brigada' AS role, 1 AS ord FROM brigades b WHERE b.id = ${brigade}
    UNION ALL SELECT bm.user_id, 'Integrante', 2 FROM brigade_members bm WHERE bm.brigade_id = ${brigade} AND bm.left_at IS NULL
    UNION ALL SELECT b.supervisor_id, 'Supervisor', 3 FROM brigades b WHERE b.id = ${brigade}
    UNION ALL SELECT b.logistician_id, 'Logístico', 4 FROM brigades b WHERE b.id = ${brigade}
  ) x JOIN users u ON u.id = x.uid AND u.deleted_at IS NULL
  ORDER BY u.id, x.ord`;

/** Conversación de varias consultas con sus archivos. */
async function threadsOf(inquiryIds: string[]) {
  if (!inquiryIds.length) return new Map<string, InquiryMessageDto[]>();
  const msgs = (await db.execute(sql`
    SELECT m.id, m.client_id AS "clientId", m.inquiry_id AS "inquiryId", m.kind, m.channel, m.author_id AS "authorId",
      a.full_name AS "authorName", ob.full_name AS "onBehalfOfName", m.body, ${iso(sql`m.sent_at`)} AS "sentAt"
    FROM inquiry_messages m JOIN users a ON a.id = m.author_id LEFT JOIN users ob ON ob.id = m.on_behalf_of_id
    WHERE m.inquiry_id IN (${ids(inquiryIds)})
    ORDER BY m.sent_at, m.created_at`)).rows as (Omit<InquiryMessageDto, 'files'> & { inquiryId: string })[];
  const files = msgs.length
    ? (await db.execute(sql`
        SELECT id, owner_id AS "messageId", kind, mime_type AS "mimeType", caption AS name, size_bytes AS "sizeBytes", upload_status AS "uploadStatus"
        FROM attachments WHERE owner_type = 'inquiry_message' AND owner_id IN (${ids(msgs.map((m) => m.id))}) ORDER BY created_at`)).rows as (InquiryFile & { messageId: string })[]
    : [];
  const out = new Map<string, InquiryMessageDto[]>();
  for (const { inquiryId, ...m } of msgs) {
    const list = out.get(inquiryId) ?? [];
    list.push({ ...m, files: files.filter((f) => f.messageId === m.id).map(({ messageId: _m, ...f }) => ({ ...f, sizeBytes: f.sizeBytes == null ? null : Number(f.sizeBytes) })) });
    out.set(inquiryId, list);
  }
  return out;
}

/** Estado que deja un mensaje: preguntar abre, responder marca respondida, el seguimiento no cambia nada. */
async function addMessage(
  tx: Tx,
  inq: { id: string; status: string },
  m: { clientId?: string; kind: string; channel: string; authorId: string; onBehalfOfId?: string | null; body: string; sentAt?: string },
) {
  const row = (await tx.execute(sql`
    INSERT INTO inquiry_messages (client_id, inquiry_id, author_id, body, kind, channel, on_behalf_of_id, sent_at)
    VALUES (${m.clientId ?? randomUUID()}, ${inq.id}, ${m.authorId}, ${m.body}, ${m.kind}, ${m.channel}, ${m.onBehalfOfId ?? null},
      ${m.sentAt ? sql`${m.sentAt}::timestamptz` : sql`now()`})
    ON CONFLICT (client_id) DO NOTHING
    RETURNING id`)).rows[0] as { id: string } | undefined;
  if (!row) return null; // reenvío del teléfono: ya estaba guardado
  // Una respuesta enviada sin conexión puede llegar con la consulta ya cerrada: se guarda, pero sigue cerrada.
  const next = inq.status === 'cerrada' ? 'cerrada'
    : m.kind === 'respuesta' ? 'respondida'
      : m.kind === 'seguimiento' ? inq.status : 'abierta';
  await tx.execute(sql`UPDATE inquiries SET status = ${next}::inquiry_status, updated_at = now() WHERE id = ${inq.id}`);
  return row.id;
}

const ROW = sql`
  SELECT q.id, q.subject, q.status, q.channel, q.brigade_id AS "brigadeId", b.name AS "brigadeName",
    q.target_user_id AS "targetUserId", tu.full_name AS "targetName", s.code AS "stationCode", m.code AS "methodCode",
    cu.full_name AS "createdByName", ${iso(sql`q.created_at`)} AS "createdAt", ${iso(sql`q.updated_at`)} AS "updatedAt",
    (SELECT count(*)::int FROM inquiry_messages im WHERE im.inquiry_id = q.id) AS messages,
    (SELECT count(*)::int FROM attachments a JOIN inquiry_messages im ON im.id = a.owner_id
      WHERE a.owner_type = 'inquiry_message' AND im.inquiry_id = q.id) AS files,
    (SELECT ${iso(sql`max(im.sent_at)`)} FROM inquiry_messages im WHERE im.inquiry_id = q.id) AS "lastMessageAt",
    (SELECT im.kind FROM inquiry_messages im WHERE im.inquiry_id = q.id ORDER BY im.sent_at DESC, im.created_at DESC LIMIT 1) AS "lastKind"`;
const FROM = sql`
  FROM inquiries q
  JOIN users cu ON cu.id = q.created_by_id
  LEFT JOIN users tu ON tu.id = q.target_user_id
  LEFT JOIN brigades b ON b.id = q.brigade_id
  LEFT JOIN stations s ON s.id = q.station_id
  LEFT JOIN methods m ON m.id = q.method_id`;

/**
 * Consultas coordinación ↔ campo (5.4).
 * Web: bandeja por proyecto, registrar consulta, pedir información, registrar respuestas recibidas por otro medio,
 * seguimiento, adjuntos, cierre y reapertura.
 * Teléfono: GET /field/inquiries/mine y POST /field/inquiries/:id/messages (respuestas, también encoladas sin conexión).
 */
const inquiryRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const staff = app.requireRoles(...WEB_ROLES, 'jefe_proyecto');

  // Adjuntos desde la web: el archivo llega como cuerpo binario y va a MinIO en streaming.
  app.addContentTypeParser([...INQUIRY_FILE_TYPES, 'application/octet-stream'], (_req, payload, done) => done(null, payload));

  // ---------------------------------------------------------------- teléfono

  r.get('/field/inquiries/mine', { onRequest: app.authenticate }, async (req): Promise<MyInquiryDto[]> => {
    const rows = (await db.execute(sql`
      SELECT q.id, q.subject, q.status, b.name AS "brigadeName", s.code AS "stationCode", m.code AS "methodCode",
        cu.full_name AS "createdByName", ${iso(sql`q.created_at`)} AS "createdAt", ${iso(sql`q.updated_at`)} AS "updatedAt"
      ${FROM}
      WHERE q.target_user_id = ${req.user.sub} AND (q.status <> 'cerrada' OR q.updated_at > now() - interval '30 days')
      ORDER BY q.updated_at DESC LIMIT 200`)).rows as Omit<MyInquiryDto, 'thread'>[];
    const threads = await threadsOf(rows.map((x) => x.id));
    return rows.map((x) => ({ ...x, thread: threads.get(x.id) ?? [] }));
  });

  r.post(
    '/field/inquiries/:id/messages',
    { onRequest: app.authenticate, schema: { params: idParam, body: inquiryReplySchema } },
    async (req) => db.transaction(async (tx) => {
      const inq = (await tx.execute(sql`SELECT id, status, target_user_id AS "target" FROM inquiries WHERE id = ${req.params.id} FOR UPDATE`)).rows[0] as
        | { id: string; status: string; target: string | null }
        | undefined;
      if (!inq) throw notFound('Consulta');
      if (inq.target !== req.user.sub) throw new HttpError(403, 'Esta consulta es para otra persona');
      // Lo que se escribe en el teléfono cuenta como respuesta enviada por la app.
      await addMessage(tx, inq, { clientId: req.body.clientId, kind: 'respuesta', channel: 'app', authorId: req.user.sub, body: req.body.body, sentAt: req.body.sentAt });
      return { ok: true };
    }),
  );

  // Enlace temporal a un adjunto (web, o la persona a quien se dirige la consulta).
  r.get('/inquiry-files/:id/url', { onRequest: app.authenticate, schema: { params: idParam } }, async (req) => {
    const a = (await db.execute(sql`
      SELECT a.object_key AS "key", a.caption AS name, a.upload_status AS "up", q.target_user_id AS "target"
      FROM attachments a JOIN inquiry_messages im ON im.id = a.owner_id JOIN inquiries q ON q.id = im.inquiry_id
      WHERE a.id = ${req.params.id} AND a.owner_type = 'inquiry_message'`)).rows[0] as
      | { key: string; name: string | null; up: string; target: string | null }
      | undefined;
    if (!a) throw notFound('Archivo');
    if (a.target !== req.user.sub && !hasAnyRole(req.user.roles, [...WEB_ROLES, 'jefe_proyecto'])) throw new HttpError(403, 'Sin acceso');
    if (a.up !== 'subido') throw conflict('El archivo aún no se ha subido');
    const name = a.name ?? 'archivo';
    const url = await app.minioSign.presignedGetObject(app.minioBucket, a.key, 15 * 60, {
      'response-content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    return { url };
  });

  // ---------------------------------------------------------------- web

  r.get('/projects/:projectId/inquiries/options', { onRequest: staff, schema: { params: projectParam } }, async (req): Promise<InquiryOptions> => {
    const brigades = (await db.execute(sql`
      SELECT id, name, specialty_id AS "specialtyId" FROM brigades
      WHERE project_id = ${req.params.projectId} AND is_active ORDER BY name`)).rows as { id: string; name: string; specialtyId: string | null }[];
    const out: InquiryOptions['brigades'] = [];
    for (const b of brigades) {
      const people = (await db.execute(PEOPLE(sql`${b.id}::uuid`))).rows as InquiryOptions['brigades'][number]['people'];
      const stations = (await db.execute(sql`
        SELECT DISTINCT s.id, s.code FROM schedules sc JOIN stations s ON s.id = sc.station_id AND s.deleted_at IS NULL
        WHERE sc.brigade_id = ${b.id} AND sc.status <> 'cancelada' ORDER BY s.code`)).rows as { id: string; code: string }[];
      out.push({ ...b, people: people.sort((x, y) => x.fullName.localeCompare(y.fullName)), stations });
    }
    const methods = (await db.execute(sql`
      SELECT id, code, name, specialty_id AS "specialtyId" FROM methods WHERE is_active ORDER BY code`)).rows as InquiryOptions['methods'];
    return { brigades: out, methods };
  });

  r.get(
    '/projects/:projectId/inquiries',
    {
      onRequest: staff,
      schema: {
        params: projectParam,
        querystring: z.object({
          status: z.enum(INQUIRY_STATUSES).optional(),
          brigadeId: z.string().uuid().optional(),
          targetUserId: z.string().uuid().optional(),
          q: z.string().trim().max(100).optional(),
        }),
      },
    },
    async (req): Promise<InquiryRow[]> => {
      const f = req.query;
      const conds = [sql`q.project_id = ${req.params.projectId}`];
      if (f.status) conds.push(sql`q.status = ${f.status}`);
      if (f.brigadeId) conds.push(sql`q.brigade_id = ${f.brigadeId}`);
      if (f.targetUserId) conds.push(sql`q.target_user_id = ${f.targetUserId}`);
      if (f.q) {
        const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        conds.push(sql`(q.subject ILIKE ${like} OR tu.full_name ILIKE ${like} OR s.code ILIKE ${like}
          OR EXISTS (SELECT 1 FROM inquiry_messages im WHERE im.inquiry_id = q.id AND im.body ILIKE ${like}))`);
      }
      return (await db.execute(sql`
        ${ROW} ${FROM}
        WHERE ${sql.join(conds, sql` AND `)}
        ORDER BY CASE q.status WHEN 'respondida' THEN 0 WHEN 'abierta' THEN 1 ELSE 2 END, q.updated_at DESC
        LIMIT 500`)).rows as InquiryRow[];
    },
  );

  r.get('/inquiries/:id', { onRequest: staff, schema: { params: idParam } }, async (req): Promise<InquiryDetail> => {
    const d = (await db.execute(sql`
      ${ROW}, q.project_id AS "projectId", tu.phone AS "targetPhone", q.station_id AS "stationId", q.method_id AS "methodId",
        m.name AS "methodName", clu.full_name AS "closedByName", ${iso(sql`q.closed_at`)} AS "closedAt"
      ${FROM} LEFT JOIN users clu ON clu.id = q.closed_by_id
      WHERE q.id = ${req.params.id}`)).rows[0] as Omit<InquiryDetail, 'thread'> | undefined;
    if (!d) throw notFound('Consulta');
    return { ...d, thread: (await threadsOf([d.id])).get(d.id) ?? [] };
  });

  r.post('/projects/:projectId/inquiries', { onRequest: staff, schema: { params: projectParam, body: inquiryCreateSchema } }, async (req) => {
    const b = req.body;
    const projectId = req.params.projectId;
    const brigade = (await db.execute(sql`SELECT id, specialty_id AS "specialtyId" FROM brigades WHERE id = ${b.brigadeId} AND project_id = ${projectId}`)).rows[0] as
      | { id: string; specialtyId: string | null }
      | undefined;
    if (!brigade) throw badRequest('La brigada no es de este proyecto');
    const people = (await db.execute(PEOPLE(sql`${b.brigadeId}::uuid`))).rows as { id: string }[];
    if (!people.some((p) => p.id === b.targetUserId)) throw badRequest('La persona no pertenece a la brigada');
    if (b.stationId) {
      const st = (await db.execute(sql`SELECT 1 FROM stations WHERE id = ${b.stationId} AND project_id = ${projectId} AND deleted_at IS NULL`)).rows;
      if (!st.length) throw badRequest('La estación no es de este proyecto');
    }
    if (b.methodId) {
      const m = (await db.execute(sql`SELECT 1 FROM methods WHERE id = ${b.methodId}`)).rows;
      if (!m.length) throw badRequest('Método no encontrado');
    }
    if (b.response && b.channel === 'app') throw badRequest('La respuesta se registra solo si la consulta se hizo por otro medio');

    return db.transaction(async (tx) => {
      const inq = (await tx.execute(sql`
        INSERT INTO inquiries (project_id, brigade_id, target_user_id, station_id, method_id, subject, channel, created_by_id)
        VALUES (${projectId}, ${b.brigadeId}, ${b.targetUserId}, ${b.stationId ?? null}, ${b.methodId ?? null}, ${b.subject}, ${b.channel}, ${req.user.sub})
        RETURNING id, status`)).rows[0] as { id: string; status: string };
      const messageId = await addMessage(tx, inq, { kind: 'consulta', channel: b.channel, authorId: req.user.sub, body: b.body });
      let responseId: string | null = null;
      if (b.response) {
        responseId = await addMessage(tx, { ...inq, status: 'abierta' }, {
          kind: 'respuesta', channel: b.channel, authorId: req.user.sub, onBehalfOfId: b.targetUserId, body: b.response,
        });
      }
      await audit(req, 'inquiry', inq.id, 'create', { after: { brigadeId: b.brigadeId, targetUserId: b.targetUserId, channel: b.channel, subject: b.subject } }, tx);
      return { id: inq.id, messageId, responseId };
    });
  });

  r.post('/inquiries/:id/messages', { onRequest: staff, schema: { params: idParam, body: inquiryMessageSchema } }, async (req) => {
    const b = req.body;
    if (b.kind === 'respuesta' && b.channel === 'app') throw badRequest('Indica por qué medio se recibió la respuesta');
    return db.transaction(async (tx) => {
      const inq = (await tx.execute(sql`SELECT id, status, target_user_id AS "target" FROM inquiries WHERE id = ${req.params.id} FOR UPDATE`)).rows[0] as
        | { id: string; status: string; target: string | null }
        | undefined;
      if (!inq) throw notFound('Consulta');
      if (inq.status === 'cerrada') throw conflict('La consulta está cerrada; reábrela para continuar');
      const id = await addMessage(tx, inq, {
        kind: b.kind, channel: b.channel, authorId: req.user.sub, body: b.body,
        onBehalfOfId: b.kind === 'respuesta' ? inq.target : null,
      });
      return { id };
    });
  });

  r.put(
    '/inquiry-messages/:id/files',
    { onRequest: staff, schema: { params: idParam, querystring: z.object({ name: z.string().trim().min(1).max(200) }) } },
    async (req) => {
      const mime = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
      if (!(INQUIRY_FILE_TYPES as readonly string[]).includes(mime)) throw badRequest('Tipo de archivo no admitido (fotos, PDF, audio, Excel o Word)');
      const declared = req.headers['content-length'] ? Number(req.headers['content-length']) : undefined;
      if (!declared) throw badRequest('Archivo vacío');
      if (declared > INQUIRY_FILE_MAX_BYTES) throw badRequest('El archivo supera los 25 MB');
      const msg = (await db.execute(sql`
        SELECT im.id, q.id AS "inquiryId", q.status, p.code AS "project", q.project_id AS "projectId", q.station_id AS "stationId"
        FROM inquiry_messages im JOIN inquiries q ON q.id = im.inquiry_id JOIN projects p ON p.id = q.project_id
        WHERE im.id = ${req.params.id}`)).rows[0] as
        | { id: string; inquiryId: string; status: string; project: string; projectId: string; stationId: string | null }
        | undefined;
      if (!msg) throw notFound('Mensaje');
      if (msg.status === 'cerrada') throw conflict('La consulta está cerrada');
      const body = req.body as Readable | undefined;
      if (!body || typeof body.pipe !== 'function') throw badRequest('Archivo vacío');

      const clientId = randomUUID();
      const kind = mime.startsWith('image/') ? 'foto' : mime.startsWith('audio/') ? 'audio' : 'documento';
      const key = `${msg.project}/consultas/${msg.inquiryId}/${kind === 'foto' ? 'fotos' : kind === 'audio' ? 'audios' : 'documentos'}/${clientId}.${EXT[mime] ?? 'bin'}`;
      await app.minio.putObject(app.minioBucket, key, body, declared, { 'Content-Type': mime });
      const stat = await app.minio.statObject(app.minioBucket, key);
      const row = (await db.execute(sql`
        INSERT INTO attachments (client_id, owner_type, owner_id, kind, object_key, mime_type, size_bytes, taken_at, uploaded_by_id,
          project_id, station_id, upload_status, original_upload_status, caption)
        VALUES (${clientId}, 'inquiry_message', ${msg.id}, ${kind}, ${key}, ${mime}, ${stat.size}, now(), ${req.user.sub},
          ${msg.projectId}, ${msg.stationId}, 'subido', 'subido', ${req.query.name})
        RETURNING id`)).rows[0] as { id: string };
      await db.execute(sql`UPDATE inquiries SET updated_at = now() WHERE id = ${msg.inquiryId}`);
      return { id: row.id, size: stat.size };
    },
  );

  r.post('/inquiries/:id/close', { onRequest: staff, schema: { params: idParam } }, async (req) => {
    const res = await db.execute(sql`
      UPDATE inquiries SET status = 'cerrada', closed_by_id = ${req.user.sub}, closed_at = now(), updated_at = now()
      WHERE id = ${req.params.id} AND status <> 'cerrada' RETURNING id`);
    if (!res.rows.length) throw conflict('La consulta no existe o ya está cerrada');
    await audit(req, 'inquiry', req.params.id, 'close');
    return { ok: true };
  });

  r.post('/inquiries/:id/reopen', { onRequest: staff, schema: { params: idParam } }, async (req) => {
    // Vuelve a "respondida" si lo último fue una respuesta; si no, queda esperando respuesta.
    const res = await db.execute(sql`
      UPDATE inquiries q SET closed_by_id = NULL, closed_at = NULL, updated_at = now(),
        status = CASE WHEN (SELECT im.kind FROM inquiry_messages im WHERE im.inquiry_id = q.id AND im.kind <> 'seguimiento'
          ORDER BY im.sent_at DESC, im.created_at DESC LIMIT 1) = 'respuesta' THEN 'respondida'::inquiry_status ELSE 'abierta'::inquiry_status END
      WHERE q.id = ${req.params.id} AND q.status = 'cerrada' RETURNING q.id`);
    if (!res.rows.length) throw conflict('Solo se reabren consultas cerradas');
    await audit(req, 'inquiry', req.params.id, 'reopen');
    return { ok: true };
  });
};

export default inquiryRoutes;
