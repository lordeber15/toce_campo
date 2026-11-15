import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { once } from 'node:events';
import { ZipArchive } from 'archiver';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { EVIDENCE_MAX_FILES, WEB_ROLES, recordsQuerySchema, type RecordsQuery } from '@toce/shared';
import { db } from '../db/index.js';
import { badRequest, notFound, projectParam } from '../lib/http.js';
import { consolidatedWorkbook, dailyReport, dailyWorkbook, limaToday, recordsWorkbook } from '../lib/reports.js';
import { XLSX_MIME } from '../lib/xlsx.js';
import { RECORDS_FROM, recordsWhere } from './records.js';

const dateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const exportQuery = recordsQuerySchema.omit({ page: true });
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac' };

/** Nombre seguro para carpetas y archivos del ZIP (Windows incluido). */
export const safe = (s: string | null | undefined, fallback: string) =>
  (s ?? '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 60) || fallback;

/** Content-Disposition con nombre UTF-8 (tildes) y alternativa ASCII. */
export const disposition = (name: string) =>
  `attachment; filename="${name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** Cuántas evidencias de registros entrarían en un ZIP con estos filtros. */
export async function evidenceCount(projectId: string, f: Omit<RecordsQuery, 'page'>) {
  const row = (await db.execute(sql`
      SELECT count(*) FILTER (WHERE a.upload_status = 'subido')::int AS ready, count(*) FILTER (WHERE a.upload_status <> 'subido')::int AS pending,
        COALESCE(sum(CASE WHEN a.upload_status = 'subido' THEN
          CASE WHEN a.original_upload_status = 'subido' THEN COALESCE(a.original_size_bytes, a.size_bytes) ELSE a.size_bytes END END), 0)::bigint AS bytes
      ${RECORDS_FROM} JOIN attachments a ON a.owner_type = 'execution' AND a.owner_id = e.id
      WHERE ${recordsWhere(projectId, f)}`)).rows[0] as { ready: number; pending: number; bytes: string };
  return { ready: row.ready, pending: row.pending, bytes: Number(row.bytes), max: EVIDENCE_MAX_FILES };
}

/**
 * Evidencias de registros en ZIP, organizadas automáticamente (6):
 * Proyecto / Brigada / Especialista / Estación / Método / Unidad / Fotos|Audios / archivo.
 * Usa el original en alta resolución cuando ya se subió.
 */
export async function sendEvidenceZip(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, projectId: string, f: Omit<RecordsQuery, 'page'>) {
  const p = (await db.execute(sql`SELECT code FROM projects WHERE id = ${projectId} AND deleted_at IS NULL`)).rows[0] as { code: string } | undefined;
  if (!p) throw notFound('Proyecto');
  const files = (await db.execute(sql`
    SELECT a.id, a.kind, a.slot_key AS "slotKey", a.mime_type AS "mimeType", a.upload_status AS "up",
      CASE WHEN a.original_upload_status = 'subido' AND a.original_object_key IS NOT NULL THEN a.original_object_key ELSE a.object_key END AS key,
      to_char(a.taken_at AT TIME ZONE 'America/Lima', 'YYYYMMDD-HH24MISS') AS taken,
      b.name AS brigade, u.full_name AS specialist, s.code AS station, m.code || ' ' || m.name AS method, su.code AS unit
    ${RECORDS_FROM} JOIN attachments a ON a.owner_type = 'execution' AND a.owner_id = e.id
    WHERE ${recordsWhere(projectId, f)}
    ORDER BY b.name, u.full_name, s.code, m.code, su.code, a.taken_at`)).rows as {
      id: string; kind: string; slotKey: string | null; mimeType: string; up: string; key: string; taken: string;
      brigade: string | null; specialist: string; station: string; method: string; unit: string;
    }[];
  const ready = files.filter((f) => f.up === 'subido');
  if (!ready.length) throw badRequest('No hay evidencias subidas con estos filtros');
  if (ready.length > EVIDENCE_MAX_FILES) throw badRequest(`Son ${ready.length} archivos; filtra para bajar como máximo ${EVIDENCE_MAX_FILES} por vez`);

  const root = safe(p.code, 'Proyecto');
  const used = new Set<string>();
  const nameOf = (f: (typeof files)[number]) => {
    const folder = f.kind === 'audio' ? 'Audios' : 'Fotos';
    const label = f.kind === 'foto_metodo' ? 'metodo' : f.kind === 'audio' ? 'nota-voz' : safe(f.slotKey, 'foto');
    const dir = [root, safe(f.brigade, 'Sin brigada'), safe(f.specialist, 'Especialista'), safe(f.station, 'Estacion'), safe(f.method, 'Metodo'), safe(f.unit, 'Unidad'), folder].join('/');
    let name = `${dir}/${f.unit}_${label}_${f.taken}.${EXT[f.mimeType] ?? 'bin'}`;
    for (let i = 2; used.has(name); i++) name = `${dir}/${f.unit}_${label}_${f.taken}_${i}.${EXT[f.mimeType] ?? 'bin'}`;
    used.add(name);
    return name;
  };

  // Fotos y audios ya vienen comprimidos: se guardan sin volver a comprimir.
  const zip = new ZipArchive({ store: true });
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  reply.header('content-type', 'application/zip').header('content-disposition', disposition(`Evidencias ${p.code} ${day}.zip`));
  reply.send(zip);

  // Se van agregando de a uno para no abrir cientos de conexiones a MinIO a la vez.
  (async () => {
    const missing: string[] = [];
    for (const f of ready) {
      if (reply.raw.destroyed) { zip.abort(); return; } // el usuario canceló la descarga
      try {
        const stream = await app.minio.getObject(app.minioBucket, f.key);
        zip.append(stream, { name: nameOf(f) });
        await once(zip, 'entry');
      } catch (e) {
        req.log.warn({ err: e, attachment: f.id }, 'evidencia no disponible en MinIO');
        missing.push(`${f.unit} · ${f.kind}${f.slotKey ? ` ${f.slotKey}` : ''} (${f.taken})`);
      }
    }
    const pending = files.filter((f) => f.up !== 'subido');
    const notes = [
      `Evidencias de ${p.code} descargadas el ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' })}`,
      'Carpetas: Proyecto / Brigada / Especialista / Estación / Método / Unidad / Fotos o Audios.',
      `Archivos incluidos: ${ready.length - missing.length}.`,
      ...(pending.length ? ['', `Aún en los teléfonos (no se han subido): ${pending.length}`, ...pending.map((f) => `- ${f.unit} · ${f.kind}${f.slotKey ? ` ${f.slotKey}` : ''} (${f.taken})`)] : []),
      ...(missing.length ? ['', `No se pudieron leer del almacenamiento: ${missing.length}`, ...missing.map((m) => `- ${m}`)] : []),
    ];
    zip.append(notes.join('\r\n') + '\r\n', { name: `${root}/LEEME.txt` });
    await zip.finalize();
  })().catch((e) => {
    req.log.error({ err: e }, 'error al armar el ZIP de evidencias');
    zip.abort();
  });
  return reply;
}

/**
 * Reportes (Fase 2): reporte diario (pantalla y Excel), consolidado en Excel, exportación de registros
 * históricos y descarga de evidencias en ZIP. Las descargas aceptan un ticket de un minuto en la URL.
 */
const reportsRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const roles = [...WEB_ROLES, 'jefe_proyecto'] as const;
  const read = app.requireRoles(...roles);
  const download = app.requireRolesOrTicket(...roles);

  /** Ticket de descarga: el navegador abre la URL directamente y el archivo se descarga sin pasar por memoria. */
  r.post('/download-ticket', { onRequest: app.authenticate, schema: { body: z.object({ path: z.string().regex(/^\/[\w\-/.]+$/).max(300) }) } }, async (req) => {
    const { sub, dni, roles: rr, specialtyId, sid } = req.user;
    const path = `/api${req.body.path}`;
    return { ticket: app.jwt.sign({ sub, dni, roles: rr, specialtyId, sid, dl: path }, { expiresIn: '60s' }) };
  });

  r.get('/projects/:projectId/reports/daily', { onRequest: read, schema: { params: projectParam, querystring: dateQuery } }, async (req) =>
    dailyReport(req.params.projectId, req.query.date ?? (await limaToday())));

  r.get('/projects/:projectId/reports/daily.xlsx', { onRequest: download, schema: { params: projectParam, querystring: dateQuery } }, async (req, reply) => {
    const { wb, filename } = await dailyWorkbook(req.params.projectId, req.query.date ?? (await limaToday()));
    const buf = await wb.xlsx.writeBuffer();
    return reply.header('content-type', XLSX_MIME).header('content-disposition', disposition(filename)).send(Buffer.from(buf));
  });

  r.get('/projects/:projectId/reports/consolidated.xlsx', { onRequest: download, schema: { params: projectParam, querystring: dateQuery } }, async (req, reply) => {
    const { wb, filename } = await consolidatedWorkbook(req.params.projectId, req.query.date ?? (await limaToday()));
    const buf = await wb.xlsx.writeBuffer();
    return reply.header('content-type', XLSX_MIME).header('content-disposition', disposition(filename)).send(Buffer.from(buf));
  });

  r.get('/projects/:projectId/records.xlsx', { onRequest: download, schema: { params: projectParam, querystring: exportQuery } }, async (req, reply) => {
    const { wb, filename } = await recordsWorkbook(req.params.projectId, req.query);
    const buf = await wb.xlsx.writeBuffer();
    return reply.header('content-type', XLSX_MIME).header('content-disposition', disposition(filename)).send(Buffer.from(buf));
  });

  r.get('/projects/:projectId/evidence/count', { onRequest: read, schema: { params: projectParam, querystring: exportQuery } }, async (req) =>
    evidenceCount(req.params.projectId, req.query));

  r.get('/projects/:projectId/evidence.zip', { onRequest: download, schema: { params: projectParam, querystring: exportQuery } }, async (req, reply) =>
    sendEvidenceZip(app, req, reply, req.params.projectId, req.query));
};

export default reportsRoutes;
