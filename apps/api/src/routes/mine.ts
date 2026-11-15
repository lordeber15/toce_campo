import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ROLES, WEB_ROLES, hasAnyRole, myQuerySchema,
  LOGISTICS_ENTITIES,
  type JournalDay, type JournalUnit, type MyIncident, type MyJournal, type MyLogisticsRow, type MyOverview, type MyQuery, type RecordsQuery,
} from '@toce/shared';
import { db } from '../db/index.js';
import { recordsWorkbook } from '../lib/reports.js';
import { XLSX_MIME } from '../lib/xlsx.js';
import { HttpError, idParam, notFound } from '../lib/http.js';
import { LOGISTICS_TABLES, selectData } from './logistics.js';
import { RECORDS_FROM, ROW_COLUMNS, iso, recordDetail, recordsWhere } from './records.js';
import { disposition, evidenceCount, sendEvidenceZip } from './reports.js';

const STAFF = [...WEB_ROLES, 'jefe_proyecto'] as const;

const isStaff = (req: FastifyRequest) => hasAnyRole(req.user.roles, [...STAFF]);

async function leads(userId: string, brigadeId: string) {
  const r = await db.execute(sql`SELECT 1 FROM brigades WHERE id = ${brigadeId} AND leader_id = ${userId}`);
  return r.rows.length > 0;
}

/**
 * Qué registros puede ver: los propios o, con brigadeId, los de una brigada que dirige
 * (coordinación también puede pedir una brigada).
 */
async function scopeOf(req: FastifyRequest, q: MyQuery): Promise<Omit<RecordsQuery, 'page'>> {
  const range = { from: q.from, to: q.to };
  if (!q.brigadeId) return { ...range, specialistId: req.user.sub };
  if (!isStaff(req) && !(await leads(req.user.sub, q.brigadeId))) throw new HttpError(403, 'Solo el jefe de esta brigada puede ver sus registros');
  return { ...range, brigadeId: q.brigadeId };
}

/**
 * "Mis registros" (web): lo que cada persona cargó desde su teléfono, ordenado como en la app,
 * con su ficha y descargas para armar informes. El jefe de brigada ve además toda su brigada
 * y su tablero de avance.
 */
const mineRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  // Descargas: el navegador abre la URL con un ticket de un minuto (cualquier rol).
  const download = app.requireRolesOrTicket(...ROLES);

  r.get('/me/overview', { onRequest: app.authenticate }, async (req): Promise<MyOverview> => {
    const me = req.user.sub;
    const projects = (await db.execute(sql`
      SELECT DISTINCT p.id, p.code, p.name, p.created_at FROM projects p
      WHERE p.deleted_at IS NULL AND (
        EXISTS (SELECT 1 FROM brigades b WHERE b.project_id = p.id AND (b.leader_id = ${me} OR b.supervisor_id = ${me} OR b.logistician_id = ${me}
          OR EXISTS (SELECT 1 FROM brigade_members bm WHERE bm.brigade_id = b.id AND bm.user_id = ${me})))
        OR EXISTS (SELECT 1 FROM executions e JOIN stations s ON s.id = e.station_id WHERE s.project_id = p.id AND e.specialist_id = ${me}))
      ORDER BY p.created_at DESC`)).rows as (MyOverview['projects'][number] & { created_at?: unknown })[];
    const ledBrigades = (await db.execute(sql`
      SELECT b.id, b.name, b.project_id AS "projectId", p.code AS "projectCode"
      FROM brigades b JOIN projects p ON p.id = b.project_id AND p.deleted_at IS NULL
      WHERE b.leader_id = ${me} AND b.is_active ORDER BY p.code, b.name`)).rows as MyOverview['ledBrigades'];
    return { projects: projects.map(({ created_at: _c, ...p }) => p), ledBrigades };
  });

  /** Jornadas: día → estación → método → unidad, como en el teléfono. */
  r.get('/me/journal', { onRequest: app.authenticate, schema: { querystring: myQuerySchema } }, async (req): Promise<MyJournal> => {
    const f = await scopeOf(req, req.query);
    const rows = (await db.execute(sql`
      SELECT ${ROW_COLUMNS}, e.method_id AS "methodId", s.name AS "stationName",
        to_char(e.started_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS day
      ${RECORDS_FROM}
      WHERE ${recordsWhere(req.query.projectId, f)}
      ORDER BY day DESC, s.code, m.sort_order, m.code, su.code
      LIMIT 3000`)).rows as (JournalUnit & {
        methodId: string; methodCode: string; methodName: string; stationId: string; stationCode: string; stationName: string | null;
        specialistName: string; day: string;
      })[];
    const days: JournalDay[] = [];
    for (const x of rows) {
      let d = days.at(-1);
      if (!d || d.date !== x.day) days.push((d = { date: x.day, stations: [] }));
      let st = d.stations.find((s) => s.stationId === x.stationId);
      if (!st) d.stations.push((st = { stationId: x.stationId, code: x.stationCode, name: x.stationName, methods: [] }));
      let me = st.methods.find((m) => m.methodId === x.methodId);
      if (!me) st.methods.push((me = { methodId: x.methodId, code: x.methodCode, name: x.methodName, units: [] }));
      me.units.push({
        id: x.id, unitCode: x.unitCode, status: x.status, startedAt: x.startedAt, finishedAt: x.finishedAt, specialistName: x.specialistName,
        records: x.records, photos: x.photos, audios: x.audios, pendingFiles: x.pendingFiles, incidents: x.incidents,
      });
    }
    const sum = (k: 'records' | 'photos' | 'audios' | 'pendingFiles') => rows.reduce((a, x) => a + x[k], 0);
    return {
      days,
      totals: {
        units: rows.length, completed: rows.filter((x) => x.status === 'completada').length, notDone: rows.filter((x) => x.status === 'no_realizada').length,
        records: sum('records'), photos: sum('photos'), audios: sum('audios'), pendingFiles: sum('pendingFiles'),
      },
    };
  });

  /** Ficha de un registro propio (o de la brigada que dirige). */
  r.get('/me/records/:id', { onRequest: app.authenticate, schema: { params: idParam } }, async (req) => {
    const e = (await db.execute(sql`SELECT specialist_id AS "by", brigade_id AS "brigadeId" FROM executions WHERE id = ${req.params.id}`)).rows[0] as
      | { by: string; brigadeId: string | null }
      | undefined;
    if (!e) throw notFound('Registro');
    const allowed = e.by === req.user.sub || isStaff(req) || (e.brigadeId ? await leads(req.user.sub, e.brigadeId) : false);
    if (!allowed) throw new HttpError(403, 'Este registro es de otra persona');
    return recordDetail(req.params.id);
  });

  /** Alertas registradas por la persona (o por su brigada), con la respuesta de coordinación. */
  r.get('/me/incidents', { onRequest: app.authenticate, schema: { querystring: myQuerySchema } }, async (req): Promise<MyIncident[]> => {
    const f = await scopeOf(req, req.query);
    const who = f.brigadeId ? sql`i.brigade_id = ${f.brigadeId}` : sql`i.reported_by_id = ${req.user.sub}`;
    const day = sql`(i.occurred_at AT TIME ZONE 'America/Lima')::date`;
    return (await db.execute(sql`
      SELECT i.id, i.type, i.status, i.description, i.proposed_action AS "proposedAction", ${iso(sql`i.occurred_at`)} AS "occurredAt",
        u.full_name AS "reportedByName", s.code AS "stationCode", su.code AS "unitCode", m.code AS "methodCode",
        i.coordination_response AS "coordinationResponse", i.corrective_action AS "correctiveAction", ru.full_name AS "resolvedByName",
        COALESCE((SELECT json_agg(json_build_object('id', a.id, 'kind', a.kind, 'uploaded', a.upload_status = 'subido') ORDER BY a.taken_at)
          FROM attachments a WHERE a.owner_type = 'incident' AND a.owner_id = i.id), '[]'::json) AS files,
        COALESCE((SELECT json_agg(json_build_object('fromDate', to_char(r.from_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD'),
            'toDate', to_char(r.to_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD'), 'reason', r.reason, 'status', r.status) ORDER BY r.created_at)
          FROM reschedules r WHERE r.incident_id = i.id), '[]'::json) AS reschedules
      FROM incidents i
      JOIN users u ON u.id = i.reported_by_id
      LEFT JOIN users ru ON ru.id = i.resolved_by_id
      LEFT JOIN stations s ON s.id = i.station_id
      LEFT JOIN sampling_units su ON su.id = i.sampling_unit_id
      LEFT JOIN methods m ON m.id = su.method_id
      WHERE i.project_id = ${req.query.projectId} AND ${who}
        ${f.from ? sql`AND ${day} >= ${f.from}::date` : sql``}
        ${f.to ? sql`AND ${day} <= ${f.to}::date` : sql``}
      ORDER BY i.occurred_at DESC LIMIT 500`)).rows as MyIncident[];
  });

  /** Registros logísticos de la persona (o de su brigada), con sus fotos y comprobantes. */
  r.get('/me/logistics', { onRequest: app.authenticate, schema: { querystring: myQuerySchema } }, async (req): Promise<MyLogisticsRow[]> => {
    const f = await scopeOf(req, req.query);
    const out: MyLogisticsRow[] = [];
    for (const entity of LOGISTICS_ENTITIES) {
      const { table } = LOGISTICS_TABLES[entity];
      const who = f.brigadeId ? sql`t.brigade_id = ${f.brigadeId}` : sql`t.registered_by_id = ${req.user.sub}`;
      const day = sql`(t.updated_at AT TIME ZONE 'America/Lima')::date`;
      const rows = (await db.execute(sql`
        SELECT t.id, ${selectData(entity)} AS data, b.name AS "brigadeName", u.full_name AS "registeredByName", ${iso(sql`t.updated_at`)} AS "updatedAt",
          COALESCE((SELECT json_agg(json_build_object('id', a.id, 'kind', a.kind, 'uploaded', a.upload_status = 'subido') ORDER BY a.taken_at)
            FROM attachments a WHERE a.owner_type = 'logistics' AND a.owner_id = t.id), '[]'::json) AS files
        FROM ${sql.raw(table)} t
        LEFT JOIN brigades b ON b.id = t.brigade_id
        JOIN users u ON u.id = t.registered_by_id
        WHERE t.project_id = ${req.query.projectId} AND ${who}
          ${f.from ? sql`AND ${day} >= ${f.from}::date` : sql``}
          ${f.to ? sql`AND ${day} <= ${f.to}::date` : sql``}
        ORDER BY t.updated_at DESC LIMIT 500`)).rows as Omit<MyLogisticsRow, 'entity'>[];
      for (const row of rows) out.push({ entity, ...row });
    }
    return out;
  });

  /** Enlace temporal a un archivo propio o de la brigada que dirige (fotos, audios, comprobantes). */
  r.get('/me/files/:id/url', { onRequest: app.authenticate, schema: { params: idParam, querystring: z.object({ original: z.enum(['0', '1']).optional() }) } }, async (req) => {
    const a = (await db.execute(sql`
      SELECT a.object_key AS key, a.original_object_key AS "originalKey", a.upload_status AS up, a.original_upload_status AS oup, a.uploaded_by_id AS "by",
        COALESCE(
          (SELECT e.brigade_id FROM executions e WHERE a.owner_type = 'execution' AND e.id = a.owner_id),
          (SELECT i.brigade_id FROM incidents i WHERE a.owner_type = 'incident' AND i.id = a.owner_id),
          ${sql.join(LOGISTICS_ENTITIES.map((e) => sql`(SELECT t.brigade_id FROM ${sql.raw(LOGISTICS_TABLES[e].table)} t WHERE a.owner_type = 'logistics' AND t.id = a.owner_id)`), sql`, `)}
        ) AS "brigadeId"
      FROM attachments a WHERE a.id = ${req.params.id}`)).rows[0] as
      | { key: string; originalKey: string | null; up: string; oup: string; by: string; brigadeId: string | null }
      | undefined;
    if (!a) throw notFound('Archivo');
    const allowed = a.by === req.user.sub || isStaff(req) || (a.brigadeId ? await leads(req.user.sub, a.brigadeId) : false);
    if (!allowed) throw new HttpError(403, 'Este archivo es de otra persona');
    const original = req.query.original === '1' && a.originalKey && a.oup === 'subido';
    if (!original && a.up !== 'subido') throw new HttpError(409, 'El archivo aún no se ha subido desde el teléfono');
    return { url: await app.minioSign.presignedGetObject(app.minioBucket, original ? a.originalKey! : a.key, 15 * 60) };
  });

  r.get('/me/evidence/count', { onRequest: app.authenticate, schema: { querystring: myQuerySchema } }, async (req) =>
    evidenceCount(req.query.projectId, await scopeOf(req, req.query)));

  r.get('/me/records.xlsx', { onRequest: download, schema: { querystring: myQuerySchema } }, async (req, reply) => {
    const { wb, filename } = await recordsWorkbook(req.query.projectId, await scopeOf(req, req.query));
    const buf = await wb.xlsx.writeBuffer();
    return reply.header('content-type', XLSX_MIME).header('content-disposition', disposition(filename)).send(Buffer.from(buf));
  });

  r.get('/me/evidence.zip', { onRequest: download, schema: { querystring: myQuerySchema } }, async (req, reply) =>
    sendEvidenceZip(app, req, reply, req.query.projectId, await scopeOf(req, req.query)));
};

export default mineRoutes;
