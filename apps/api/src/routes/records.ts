import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { sql, type SQL } from 'drizzle-orm';
import {
  RECORD_PAGE_SIZE, WEB_ROLES, recordsQuerySchema,
  type RecordDetail, type RecordFilterOptions, type RecordRow, type RecordsPage,
} from '@toce/shared';
import { db } from '../db/index.js';
import { idParam, notFound, projectParam } from '../lib/http.js';

/** Marca de tiempo en ISO UTC (el formato por defecto de Postgres no lo lee Safari). */
const iso = (col: SQL) => sql`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Columnas comunes de la lista y del detalle (alias e = executions). */
const ROW_COLUMNS = sql`
  e.id, su.code AS "unitCode", e.status, ${iso(sql`e.started_at`)} AS "startedAt", ${iso(sql`e.finished_at`)} AS "finishedAt",
  e.station_id AS "stationId", s.code AS "stationCode", m.code AS "methodCode", m.name AS "methodName", sp.code AS "specialtyCode",
  b.name AS "brigadeName", u.full_name AS "specialistName", ${iso(sql`e.synced_at`)} AS "syncedAt",
  COALESCE(jsonb_array_length(e.form_data->'records'), 0)::int AS records,
  (SELECT count(*) FROM attachments a WHERE a.owner_type = 'execution' AND a.owner_id = e.id AND a.kind IN ('foto', 'foto_metodo'))::int AS photos,
  (SELECT count(*) FROM attachments a WHERE a.owner_type = 'execution' AND a.owner_id = e.id AND a.kind = 'audio')::int AS audios,
  (SELECT count(*) FROM attachments a WHERE a.owner_type = 'execution' AND a.owner_id = e.id AND a.upload_status <> 'subido')::int AS "pendingFiles",
  (SELECT count(*) FROM incidents i WHERE i.sampling_unit_id = e.sampling_unit_id)::int AS incidents`;

const FROM = sql`
  FROM executions e
  JOIN sampling_units su ON su.id = e.sampling_unit_id
  JOIN stations s ON s.id = e.station_id
  JOIN methods m ON m.id = e.method_id
  JOIN specialties sp ON sp.id = m.specialty_id
  JOIN users u ON u.id = e.specialist_id
  LEFT JOIN brigades b ON b.id = e.brigade_id`;

const limaDay = sql`(e.started_at AT TIME ZONE 'America/Lima')::date`;

/**
 * Consultas (Fase 2): búsqueda de registros de campo con filtros y su detalle completo
 * (formulario, fotos, audios, alertas). Solo lectura para coordinación, supervisión y jefatura.
 */
const recordsRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.requireRoles(...WEB_ROLES, 'jefe_proyecto');

  r.get('/projects/:projectId/records', { onRequest: read, schema: { params: projectParam, querystring: recordsQuerySchema } }, async (req): Promise<RecordsPage> => {
    const f = req.query;
    const where: SQL[] = [sql`s.project_id = ${req.params.projectId}`, sql`s.deleted_at IS NULL`];
    if (f.stationId) where.push(sql`e.station_id = ${f.stationId}`);
    if (f.methodId) where.push(sql`e.method_id = ${f.methodId}`);
    if (f.brigadeId) where.push(sql`e.brigade_id = ${f.brigadeId}`);
    if (f.specialistId) where.push(sql`e.specialist_id = ${f.specialistId}`);
    if (f.specialtyId) where.push(sql`m.specialty_id = ${f.specialtyId}`);
    if (f.status) where.push(sql`e.status = ${f.status}`);
    if (f.from) where.push(sql`${limaDay} >= ${f.from}::date`);
    if (f.to) where.push(sql`${limaDay} <= ${f.to}::date`);
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(sql`(su.code ILIKE ${like} OR u.full_name ILIKE ${like} OR e.observations ILIKE ${like}
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(e.form_data->'records', '[]'::jsonb)) rec, jsonb_each_text(rec->'values') kv
          WHERE kv.value ILIKE ${like}))`);
    }
    const cond = sql.join(where, sql` AND `);
    const total = Number(((await db.execute(sql`SELECT count(*) AS n ${FROM} WHERE ${cond}`)).rows[0] as { n: string }).n);
    const rows = (await db.execute(sql`
      SELECT ${ROW_COLUMNS} ${FROM} WHERE ${cond}
      ORDER BY e.started_at DESC, su.code
      LIMIT ${RECORD_PAGE_SIZE} OFFSET ${(f.page - 1) * RECORD_PAGE_SIZE}`)).rows as RecordRow[];
    return { total, page: f.page, pageSize: RECORD_PAGE_SIZE, rows };
  });

  /** Valores para los filtros: solo lo que tiene registros en el proyecto. */
  r.get('/projects/:projectId/records/filters', { onRequest: read, schema: { params: projectParam } }, async (req): Promise<RecordFilterOptions> => {
    const p = req.params.projectId;
    const base = sql`FROM executions e JOIN stations s ON s.id = e.station_id AND s.project_id = ${p} AND s.deleted_at IS NULL`;
    const [stations, methods, brigades, specialists, specialties] = await Promise.all([
      db.execute(sql`SELECT DISTINCT s.id, s.code ${base} ORDER BY s.code`),
      db.execute(sql`SELECT DISTINCT m.id, m.code, m.name, sp.code AS "specialtyCode", m.sort_order ${base}
        JOIN methods m ON m.id = e.method_id JOIN specialties sp ON sp.id = m.specialty_id ORDER BY sp.code, m.sort_order, m.code`),
      db.execute(sql`SELECT DISTINCT b.id, b.name ${base} JOIN brigades b ON b.id = e.brigade_id ORDER BY b.name`),
      db.execute(sql`SELECT DISTINCT u.id, u.full_name AS name ${base} JOIN users u ON u.id = e.specialist_id ORDER BY name`),
      db.execute(sql`SELECT DISTINCT sp.id, sp.code, sp.name ${base} JOIN methods m ON m.id = e.method_id JOIN specialties sp ON sp.id = m.specialty_id ORDER BY sp.name`),
    ]);
    return {
      stations: stations.rows as RecordFilterOptions['stations'],
      methods: (methods.rows as (RecordFilterOptions['methods'][number] & { sort_order?: number })[]).map(({ sort_order: _, ...m }) => m),
      brigades: brigades.rows as RecordFilterOptions['brigades'],
      specialists: specialists.rows as RecordFilterOptions['specialists'],
      specialties: specialties.rows as RecordFilterOptions['specialties'],
    };
  });

  r.get('/records/:id', { onRequest: read, schema: { params: idParam } }, async (req): Promise<RecordDetail> => {
    const row = (await db.execute(sql`
      SELECT ${ROW_COLUMNS},
        e.observations, ${iso(sql`e.form_completed_at`)} AS "formCompletedAt", e.device_id AS "deviceId",
        ST_Y(e.start_geom) AS "startLat", ST_X(e.start_geom) AS "startLng", e.start_accuracy AS "startAccuracy",
        to_char(sc.planned_date, 'YYYY-MM-DD') AS "plannedDate", to_char(sc.original_date, 'YYYY-MM-DD') AS "originalDate",
        json_build_object('lat', ST_Y(s.geom), 'lng', ST_X(s.geom), 'vegetationUnit', s.vegetation_unit,
          'influenceArea', s.influence_area, 'utmZone', p.utm_zone) AS station,
        CASE WHEN e.start_geom IS NULL THEN NULL ELSE round(ST_Distance(e.start_geom::geography, s.geom::geography))::int END AS "distanceToStationM",
        u.dni AS "specialistDni", m.form_schema AS "formSchema", m.photo_slots AS "photoSlots",
        COALESCE(e.form_data->'records', '[]'::jsonb) AS "formRecords"
      ${FROM}
      JOIN projects p ON p.id = s.project_id
      LEFT JOIN schedules sc ON sc.id = e.schedule_id
      WHERE e.id = ${req.params.id}`)).rows[0] as Omit<RecordDetail, 'attachments' | 'incidentList'> | undefined;
    if (!row) throw notFound('Registro');
    const [attachments, incidentList] = await Promise.all([
      db.execute(sql`
        SELECT a.id, a.kind, a.slot_key AS "slotKey", a.mime_type AS "mimeType", ${iso(sql`a.taken_at`)} AS "takenAt", a.upload_status AS "uploadStatus",
          (a.original_object_key IS NOT NULL AND a.original_upload_status = 'subido') AS "hasOriginal", a.duration_sec AS "durationSec",
          ST_Y(a.geom) AS lat, ST_X(a.geom) AS lng, a.accuracy, a.caption
        FROM attachments a WHERE a.owner_type = 'execution' AND a.owner_id = ${req.params.id}
        ORDER BY CASE a.kind WHEN 'foto' THEN 0 WHEN 'foto_metodo' THEN 1 WHEN 'audio' THEN 2 ELSE 3 END, a.taken_at`),
      db.execute(sql`
        SELECT i.id, i.type, i.status, i.description, ${iso(sql`i.occurred_at`)} AS "occurredAt"
        FROM incidents i JOIN executions e ON e.sampling_unit_id = i.sampling_unit_id
        WHERE e.id = ${req.params.id} ORDER BY i.occurred_at DESC`),
    ]);
    return {
      ...row,
      attachments: attachments.rows as RecordDetail['attachments'],
      incidentList: incidentList.rows as RecordDetail['incidentList'],
    };
  });
};

export default recordsRoutes;
