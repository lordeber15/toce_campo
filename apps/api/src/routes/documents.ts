import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { Readable } from 'node:stream';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ZipArchive } from 'archiver';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  DOCUMENT_CATEGORY_LABELS, EVIDENCE_MAX_FILES, FILES_PAGE_SIZE, FILE_ORIGIN_LABELS, FILE_TYPE_LABELS, INQUIRY_FILE_MAX_BYTES,
  INQUIRY_FILE_TYPES, WEB_ROLES, documentUploadSchema, filesQuerySchema,
  type FileOrigin, type FileRow, type FileType, type FilesFacets, type FilesPage, type FilesQuery,
} from '@toce/shared';
import { db } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, idParam, notFound, projectParam } from '../lib/http.js';
import { iso } from './records.js';
import { disposition, safe } from './reports.js';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** Parámetro sí/no en la URL ("1" o "true"). */
const flag = z.enum(['0', '1', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true');

/** Logística: cada registro vive en su propia tabla. */
const LOGISTICS = ['logistics_vehicles', 'logistics_support_staff', 'logistics_expenses', 'logistics_samples', 'logistics_equipment'];

/**
 * Todos los archivos del proyecto con su contexto resuelto según el origen:
 * brigada, persona responsable, estación, método y unidad de muestreo.
 */
const LIBRARY = (projectId: string) => sql`
  WITH lib AS (
    SELECT a.id, a.owner_type AS origin, a.kind, a.slot_key, a.caption, a.mime_type, a.object_key, a.original_object_key,
      a.size_bytes, a.original_size_bytes, a.upload_status, a.original_upload_status, a.taken_at, a.uploaded_by_id, a.geom,
      CASE a.kind WHEN 'foto_metodo' THEN 'foto' WHEN 'foto' THEN 'foto' WHEN 'audio' THEN 'audio' WHEN 'comprobante' THEN 'comprobante' ELSE 'documento' END AS ftype,
      COALESCE(e.brigade_id, i.brigade_id, q.brigade_id, lg.brigade_id, sc.brigade_id, a.brigade_id) AS brigade_id,
      COALESCE(e.specialist_id, i.reported_by_id, q.target_user_id, lg.registered_by_id, a.uploaded_by_id) AS person_id,
      COALESCE(a.station_id, su.station_id, i.station_id, q.station_id, sc.station_id, lg.station_id) AS station_id,
      COALESCE(su.method_id, q.method_id) AS method_id,
      su.id AS unit_id
    FROM attachments a
    LEFT JOIN executions e ON a.owner_type = 'execution' AND e.id = a.owner_id
    LEFT JOIN incidents i ON a.owner_type = 'incident' AND i.id = a.owner_id
    LEFT JOIN inquiry_messages im ON a.owner_type = 'inquiry_message' AND im.id = a.owner_id
    LEFT JOIN inquiries q ON q.id = im.inquiry_id
    LEFT JOIN reschedules r ON a.owner_type = 'reschedule' AND r.id = a.owner_id
    LEFT JOIN schedules sc ON sc.id = r.schedule_id
    LEFT JOIN LATERAL (
      ${sql.join(LOGISTICS.map((t) => sql`SELECT brigade_id, registered_by_id, ${t === 'logistics_samples' ? sql`station_id` : sql`NULL::uuid`} AS station_id
        FROM ${sql.raw(t)} WHERE id = a.owner_id`), sql` UNION ALL `)}
    ) lg ON a.owner_type = 'logistics'
    LEFT JOIN sampling_units su ON su.id = COALESCE(a.sampling_unit_id, e.sampling_unit_id, i.sampling_unit_id)
    WHERE a.project_id = ${projectId}
  )`;

const FROM = sql`
  FROM lib f
  LEFT JOIN brigades b ON b.id = f.brigade_id
  LEFT JOIN users pu ON pu.id = f.person_id
  JOIN users uu ON uu.id = f.uploaded_by_id
  LEFT JOIN stations s ON s.id = f.station_id
  LEFT JOIN methods m ON m.id = f.method_id
  LEFT JOIN sampling_units su ON su.id = f.unit_id`;

function where(q: Omit<FilesQuery, 'page'>): SQL {
  const like = q.q ? `%${q.q}%` : null;
  const origin = q.origin === 'incident' ? sql`f.origin IN ('incident', 'alert_message')`
    : q.origin === 'document' ? sql`f.origin IN ('document', 'station')`
      : q.origin ? sql`f.origin = ${q.origin}` : sql`TRUE`;
  return sql`${origin}
    ${q.type ? sql`AND f.ftype = ${q.type}` : sql``}
    ${q.brigadeId ? sql`AND f.brigade_id = ${q.brigadeId}` : sql``}
    ${q.personId ? sql`AND f.person_id = ${q.personId}` : sql``}
    ${q.stationId ? sql`AND f.station_id = ${q.stationId}` : sql``}
    ${q.methodId ? sql`AND f.method_id = ${q.methodId}` : sql``}
    ${q.from ? sql`AND (f.taken_at AT TIME ZONE 'America/Lima')::date >= ${q.from}::date` : sql``}
    ${q.to ? sql`AND (f.taken_at AT TIME ZONE 'America/Lima')::date <= ${q.to}::date` : sql``}
    ${like ? sql`AND (su.code ILIKE ${like} OR coalesce(f.caption, '') ILIKE ${like} OR coalesce(s.code, '') ILIKE ${like}
      OR coalesce(pu.full_name, '') ILIKE ${like} OR coalesce(m.code || ' ' || m.name, '') ILIKE ${like} OR coalesce(b.name, '') ILIKE ${like})` : sql``}`;
}

type Raw = Omit<FileRow, 'thumbUrl' | 'label' | 'canDelete' | 'sizeBytes'> & {
  sizeBytes: string | null; slotKey: string | null; caption: string | null; kind: string; key: string; originalKey: string | null;
};

const label = (r: { origin: string; kind: string; slotKey: string | null; caption: string | null }) =>
  r.caption ?? (r.kind === 'audio' ? 'Nota de voz' : r.kind === 'foto_metodo' ? 'Foto del método' : r.slotKey ? `Foto ${r.slotKey}` : r.kind === 'comprobante' ? 'Comprobante' : 'Foto');

const SELECT = sql`
  SELECT f.id, f.origin, f.ftype AS type, f.kind, f.slot_key AS "slotKey", f.caption, f.mime_type AS "mimeType", f.size_bytes AS "sizeBytes",
    ${iso(sql`f.taken_at`)} AS "takenAt", (f.upload_status = 'subido') AS uploaded,
    (f.original_object_key IS NOT NULL AND f.original_upload_status = 'subido') AS "hasOriginal",
    f.object_key AS key, f.original_object_key AS "originalKey",
    b.name AS "brigadeName", pu.full_name AS "personName", s.code AS "stationCode", m.code AS "methodCode", m.name AS "methodName",
    su.code AS "unitCode", uu.full_name AS "uploadedByName", ST_Y(f.geom) AS lat, ST_X(f.geom) AS lng`;

/**
 * Documentos y evidencias (6): repositorio único del proyecto con filtros, vista previa,
 * descarga en ZIP organizada automáticamente y carga de documentos del proyecto.
 */
const documentsRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const roles = [...WEB_ROLES, 'jefe_proyecto'] as const;
  const read = app.requireRoles(...roles);
  const download = app.requireRolesOrTicket(...roles);

  app.addContentTypeParser([...INQUIRY_FILE_TYPES, 'application/octet-stream'], (_req, payload, done) => done(null, payload));

  r.get('/projects/:projectId/files/facets', { onRequest: read, schema: { params: projectParam } }, async (req): Promise<FilesFacets> => {
    const p = req.params.projectId;
    const ids = await db.execute(sql`${LIBRARY(p)} SELECT
      array_remove(array_agg(DISTINCT brigade_id), NULL) AS b, array_remove(array_agg(DISTINCT person_id), NULL) AS u,
      array_remove(array_agg(DISTINCT station_id), NULL) AS s, array_remove(array_agg(DISTINCT method_id), NULL) AS m FROM lib`);
    const x = ids.rows[0] as { b: string[]; u: string[]; s: string[]; m: string[] };
    const any = (list: string[]) => sql`ANY(${`{${list.join(',')}}`}::uuid[])`;
    const [brigades, people, stations, methods] = await Promise.all([
      db.execute(sql`SELECT id, name FROM brigades WHERE project_id = ${p} OR id = ${any(x.b)} ORDER BY name`),
      db.execute(sql`SELECT id, full_name AS "fullName" FROM users WHERE id = ${any(x.u)} ORDER BY full_name`),
      db.execute(sql`SELECT id, code FROM stations WHERE id = ${any(x.s)} ORDER BY code`),
      db.execute(sql`SELECT id, code, name FROM methods WHERE id = ${any(x.m)} ORDER BY code`),
    ]);
    return {
      brigades: brigades.rows as FilesFacets['brigades'],
      people: people.rows as FilesFacets['people'],
      stations: stations.rows as FilesFacets['stations'],
      methods: methods.rows as FilesFacets['methods'],
    };
  });

  r.get('/projects/:projectId/files', { onRequest: read, schema: { params: projectParam, querystring: filesQuerySchema } }, async (req): Promise<FilesPage> => {
    const { page, ...q } = req.query;
    const w = where(q);
    const [rows, sum] = await Promise.all([
      db.execute(sql`${LIBRARY(req.params.projectId)} ${SELECT} ${FROM} WHERE ${w}
        ORDER BY f.taken_at DESC, f.id LIMIT ${FILES_PAGE_SIZE} OFFSET ${(page - 1) * FILES_PAGE_SIZE}`),
      db.execute(sql`${LIBRARY(req.params.projectId)}
        SELECT count(*)::int AS total, COALESCE(sum(f.size_bytes), 0)::bigint AS bytes, count(*) FILTER (WHERE f.upload_status <> 'subido')::int AS pending,
          count(*) FILTER (WHERE f.ftype = 'foto')::int AS foto, count(*) FILTER (WHERE f.ftype = 'audio')::int AS audio,
          count(*) FILTER (WHERE f.ftype = 'documento')::int AS documento, count(*) FILTER (WHERE f.ftype = 'comprobante')::int AS comprobante
        ${FROM} WHERE ${w}`),
    ]);
    const s = sum.rows[0] as { total: number; bytes: string; pending: number } & Record<FileType, number>;
    const out: FileRow[] = [];
    for (const x of rows.rows as Raw[]) {
      const { key, originalKey: _o, slotKey: _s, caption: _c, kind: _k, sizeBytes, ...rest } = x;
      out.push({
        ...rest,
        label: label(x),
        sizeBytes: sizeBytes == null ? null : Number(sizeBytes),
        canDelete: x.origin === 'document',
        thumbUrl: x.type === 'foto' && x.uploaded ? await app.minioSign.presignedGetObject(app.minioBucket, key, 30 * 60) : null,
      });
    }
    return {
      rows: out, total: s.total, bytes: Number(s.bytes), pending: s.pending, page, pageSize: FILES_PAGE_SIZE,
      byType: { foto: s.foto, audio: s.audio, documento: s.documento, comprobante: s.comprobante },
    };
  });

  /** Enlace temporal para ver o descargar un archivo (original en alta resolución si se pide y existe). */
  r.get(
    '/files/:id/url',
    {
      onRequest: read,
      schema: { params: idParam, querystring: z.object({ original: flag, download: flag }) },
    },
    async (req) => {
      const a = (await db.execute(sql`
        SELECT a.object_key AS key, a.original_object_key AS "originalKey", a.upload_status AS up, a.original_upload_status AS oup,
          a.caption, a.mime_type AS mime, a.kind, a.slot_key AS "slotKey", a.owner_type AS origin, su.code AS unit
        FROM attachments a LEFT JOIN sampling_units su ON su.id = a.sampling_unit_id WHERE a.id = ${req.params.id}`)).rows[0] as
        | { key: string; originalKey: string | null; up: string; oup: string; caption: string | null; mime: string; kind: string; slotKey: string | null; origin: string; unit: string | null }
        | undefined;
      if (!a) throw notFound('Archivo');
      const original = req.query.original && a.originalKey && a.oup === 'subido';
      if (!original && a.up !== 'subido') throw conflict('El archivo aún no se ha subido desde el teléfono');
      const ext = EXT[a.mime] ?? 'bin';
      const base = a.caption ?? [a.unit, label(a)].filter(Boolean).join(' ');
      const name = base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
      const url = await app.minioSign.presignedGetObject(app.minioBucket, original ? a.originalKey! : a.key, 15 * 60, {
        'response-content-disposition': `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      });
      return { url };
    },
  );

  /** Cuántos archivos entrarían en el ZIP con estos filtros. */
  r.get('/projects/:projectId/files/count', { onRequest: read, schema: { params: projectParam, querystring: filesQuerySchema.omit({ page: true }) } }, async (req) => {
    const row = (await db.execute(sql`${LIBRARY(req.params.projectId)}
      SELECT count(*) FILTER (WHERE f.upload_status = 'subido')::int AS ready, count(*) FILTER (WHERE f.upload_status <> 'subido')::int AS pending,
        COALESCE(sum(CASE WHEN f.upload_status = 'subido' THEN
          CASE WHEN f.original_upload_status = 'subido' THEN COALESCE(f.original_size_bytes, f.size_bytes) ELSE f.size_bytes END END), 0)::bigint AS bytes
      ${FROM} WHERE ${where(req.query)}`)).rows[0] as { ready: number; pending: number; bytes: string };
    return { ready: row.ready, pending: row.pending, bytes: Number(row.bytes), max: EVIDENCE_MAX_FILES };
  });

  /**
   * ZIP organizado: Proyecto / Brigada / Persona / Estación / Método / Unidad / Tipo de archivo.
   * Los niveles que no aplican (p. ej. un comprobante sin estación) se omiten; los archivos sin brigada van a "General".
   */
  r.get('/projects/:projectId/files.zip', { onRequest: download, schema: { params: projectParam, querystring: filesQuerySchema.omit({ page: true }) } }, async (req, reply) => {
    const p = (await db.execute(sql`SELECT code FROM projects WHERE id = ${req.params.projectId} AND deleted_at IS NULL`)).rows[0] as { code: string } | undefined;
    if (!p) throw notFound('Proyecto');
    const files = (await db.execute(sql`${LIBRARY(req.params.projectId)} ${SELECT},
        to_char(f.taken_at AT TIME ZONE 'America/Lima', 'YYYYMMDD-HH24MISS') AS taken,
        CASE WHEN f.original_upload_status = 'subido' AND f.original_object_key IS NOT NULL THEN f.original_object_key ELSE f.object_key END AS best
      ${FROM} WHERE ${where(req.query)}
      ORDER BY b.name NULLS LAST, pu.full_name, s.code, m.code, su.code, f.taken_at`)).rows as (Raw & { taken: string; best: string })[];
    const ready = files.filter((f) => f.uploaded);
    if (!ready.length) throw badRequest('No hay archivos subidos con estos filtros');
    if (ready.length > EVIDENCE_MAX_FILES) throw badRequest(`Son ${ready.length} archivos; filtra para bajar como máximo ${EVIDENCE_MAX_FILES} por vez`);

    const root = safe(p.code, 'Proyecto');
    const used = new Set<string>();
    const nameOf = (f: (typeof files)[number]) => {
      const dir = [
        root,
        safe(f.brigadeName, 'General'),
        f.personName ? safe(f.personName, 'Persona') : null,
        f.stationCode ? safe(f.stationCode, 'Estacion') : null,
        f.methodCode ? safe(`${f.methodCode} ${f.methodName ?? ''}`, 'Metodo') : null,
        f.unitCode ? safe(f.unitCode, 'Unidad') : null,
        // Lo que no es registro de campo se separa por origen para no mezclarlo con las evidencias del método.
        f.origin === 'execution' ? null : safe(FILE_ORIGIN_LABELS[f.origin as FileOrigin] ?? f.origin, 'Otros'),
        FILE_TYPE_LABELS[f.type],
      ].filter(Boolean).join('/');
      const ext = EXT[f.mimeType] ?? 'bin';
      const stem = safe(f.caption ? f.caption.replace(/\.[a-z0-9]{2,5}$/i, '') : [f.unitCode, label(f)].filter(Boolean).join('_'), 'archivo');
      let name = `${dir}/${stem}_${f.taken}.${ext}`;
      for (let i = 2; used.has(name); i++) name = `${dir}/${stem}_${f.taken}_${i}.${ext}`;
      used.add(name);
      return name;
    };

    const zip = new ZipArchive({ store: true });
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
    reply.header('content-type', 'application/zip').header('content-disposition', disposition(`Documentos y evidencias ${p.code} ${day}.zip`));
    reply.send(zip);

    (async () => {
      const missing: string[] = [];
      for (const f of ready) {
        if (reply.raw.destroyed) { zip.abort(); return; }
        try {
          const stream = await app.minio.getObject(app.minioBucket, f.best);
          zip.append(stream, { name: nameOf(f) });
          await once(zip, 'entry');
        } catch (e) {
          req.log.warn({ err: e, attachment: f.id }, 'archivo no disponible en MinIO');
          missing.push(`${label(f)}${f.unitCode ? ` · ${f.unitCode}` : ''} (${f.taken})`);
        }
      }
      const pending = files.filter((f) => !f.uploaded);
      const notes = [
        `Documentos y evidencias de ${p.code}, descargados el ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' })}`,
        'Carpetas: Proyecto / Brigada / Persona / Estación / Método / Unidad / Tipo de archivo.',
        'Lo que no viene de un registro de campo (alertas, consultas, logística, reprogramaciones, documentos) va en una carpeta con ese nombre.',
        `Archivos incluidos: ${ready.length - missing.length}.`,
        ...(pending.length ? ['', `Aún en los teléfonos (no se han subido): ${pending.length}`, ...pending.map((f) => `- ${label(f)}${f.unitCode ? ` · ${f.unitCode}` : ''} (${f.taken})`)] : []),
        ...(missing.length ? ['', `No se pudieron leer del almacenamiento: ${missing.length}`, ...missing.map((m) => `- ${m}`)] : []),
      ];
      zip.append(notes.join('\r\n') + '\r\n', { name: `${root}/LEEME.txt` });
      await zip.finalize();
    })().catch((e) => {
      req.log.error({ err: e }, 'error al armar el ZIP de documentos');
      zip.abort();
    });
    return reply;
  });

  /** Documento del proyecto subido desde la web (acta, permiso, informe…), con brigada y estación opcionales. */
  r.put(
    '/projects/:projectId/documents',
    { onRequest: read, schema: { params: projectParam, querystring: documentUploadSchema } },
    async (req, reply) => {
      const mime = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
      if (!(INQUIRY_FILE_TYPES as readonly string[]).includes(mime)) throw badRequest('Tipo de archivo no admitido (fotos, PDF, audio, Excel o Word)');
      const declared = req.headers['content-length'] ? Number(req.headers['content-length']) : undefined;
      if (!declared) throw badRequest('Archivo vacío');
      if (declared > INQUIRY_FILE_MAX_BYTES) throw badRequest('El archivo supera los 25 MB');
      const { name, category, brigadeId, stationId } = req.query;
      const ctx = (await db.execute(sql`
        SELECT p.code AS project,
          ${brigadeId ? sql`(SELECT name FROM brigades WHERE id = ${brigadeId} AND project_id = p.id)` : sql`NULL`} AS brigade,
          ${stationId ? sql`(SELECT code FROM stations WHERE id = ${stationId} AND project_id = p.id AND deleted_at IS NULL)` : sql`NULL`} AS station
        FROM projects p WHERE p.id = ${req.params.projectId} AND p.deleted_at IS NULL`)).rows[0] as
        | { project: string; brigade: string | null; station: string | null }
        | undefined;
      if (!ctx) throw notFound('Proyecto');
      if (brigadeId && !ctx.brigade) throw badRequest('La brigada no es de este proyecto');
      if (stationId && !ctx.station) throw badRequest('La estación no es de este proyecto');
      const body = req.body as Readable | undefined;
      if (!body || typeof body.pipe !== 'function') throw badRequest('Archivo vacío');

      const clientId = randomUUID();
      const kind = mime.startsWith('image/') ? 'foto' : mime.startsWith('audio/') ? 'audio' : 'documento';
      const key = `${ctx.project}/documentos/${ctx.station ?? 'general'}/${category}/${clientId}.${EXT[mime] ?? 'bin'}`;
      await app.minio.putObject(app.minioBucket, key, body, declared, { 'Content-Type': mime });
      const stat = await app.minio.statObject(app.minioBucket, key);
      const row = (await db.execute(sql`
        INSERT INTO attachments (client_id, owner_type, owner_id, kind, slot_key, object_key, mime_type, size_bytes, taken_at, uploaded_by_id,
          project_id, station_id, brigade_id, upload_status, original_upload_status, caption)
        VALUES (${clientId}, 'document', ${req.params.projectId}, ${kind}, ${category}, ${key}, ${mime}, ${stat.size}, now(), ${req.user.sub},
          ${req.params.projectId}, ${stationId ?? null}, ${brigadeId ?? null}, 'subido', 'subido', ${name})
        RETURNING id`)).rows[0] as { id: string };
      await audit(req, 'document', row.id, 'upload', { after: { name, category: DOCUMENT_CATEGORY_LABELS[category], brigade: ctx.brigade, station: ctx.station, size: stat.size } });
      return reply.code(201).send({ id: row.id, size: stat.size });
    },
  );

  /** Solo se borran documentos subidos en la web; las evidencias de campo se conservan. */
  r.delete('/documents/:id', { onRequest: read, schema: { params: idParam } }, async (req) => {
    const a = (await db.execute(sql`
      DELETE FROM attachments WHERE id = ${req.params.id} AND owner_type = 'document'
      RETURNING object_key AS key, caption, project_id AS "projectId"`)).rows[0] as { key: string; caption: string | null; projectId: string } | undefined;
    if (!a) throw notFound('Documento');
    await app.minio.removeObject(app.minioBucket, a.key).catch((e: unknown) => req.log.warn({ err: e }, 'no se pudo borrar el objeto'));
    await audit(req, 'document', req.params.id, 'delete', { before: a });
    return { ok: true };
  });
};

export default documentsRoutes;
