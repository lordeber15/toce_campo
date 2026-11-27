import { sql, type SQL } from 'drizzle-orm';
import {
  BRIGADE_FLAG_LABELS, EXECUTION_STATUS_LABELS, INCIDENT_DECISION_LABELS, INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS,
  STATION_STATUS_LABELS, formatUtm, latLngToUtm, canonicalFormJson,
  type DailyReport, type FormField, type IncidentDecision, type IncidentStatus, type IncidentType, type ProjectTracking,
  type RecordsQuery, type TrackingMetrics,
} from '@toce/shared';
import { db } from '../db/index.js';
import { RECORDS_FROM, recordsWhere } from '../routes/records.js';
import { computeTracking } from './tracking.js';
import { addKeyValues, addTable, ddmmyyyy, limaDateTime, workbook } from './xlsx.js';
import { notFound } from './http.js';

const ISO = (col: SQL) => sql`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const limaDay = (col: SQL) => sql`(${col} AT TIME ZONE 'America/Lima')::date`;
const pct = (v: number | null) => (v == null ? null : v / 100);
const PCT = '0.0%';
const RESCHEDULE_LABELS = { propuesta: 'Propuesta', aprobada: 'Aprobada', rechazada: 'Rechazada' } as const;

async function project(projectId: string) {
  const p = (await db.execute(sql`SELECT code, name FROM projects WHERE id = ${projectId} AND deleted_at IS NULL`)).rows[0] as
    | { code: string; name: string } | undefined;
  if (!p) throw notFound('Proyecto');
  return p;
}

export async function limaToday() {
  return ((await db.execute(sql`SELECT to_char((now() AT TIME ZONE 'America/Lima')::date, 'YYYY-MM-DD') AS d`)).rows[0] as { d: string }).d;
}

/** Reporte diario (5.6): avance de brigadas, estaciones del día, unidades, incidencias, reprogramaciones y pendientes. */
export async function dailyReport(projectId: string, date: string, tracking?: ProjectTracking): Promise<DailyReport> {
  const p = await project(projectId);
  const t = tracking ?? (await computeTracking(projectId, { today: date }));

  const units = (await db.execute(sql`
    SELECT e.id, su.code AS "unitCode", s.code AS "stationCode", m.code AS "methodCode", b.name AS "brigadeName", e.brigade_id AS "brigadeId",
      u.full_name AS "specialistName", e.status, ${ISO(sql`e.started_at`)} AS "startedAt",
      COALESCE(jsonb_array_length(e.form_data->'records'), 0)::int AS records,
      (SELECT count(*) FROM attachments a WHERE a.owner_type = 'execution' AND a.owner_id = e.id AND a.kind IN ('foto', 'foto_metodo'))::int AS photos
    FROM executions e
    JOIN sampling_units su ON su.id = e.sampling_unit_id
    JOIN stations s ON s.id = e.station_id AND s.project_id = ${projectId} AND s.deleted_at IS NULL
    JOIN methods m ON m.id = e.method_id
    JOIN users u ON u.id = e.specialist_id
    LEFT JOIN brigades b ON b.id = e.brigade_id
    WHERE ${limaDay(sql`e.started_at`)} = ${date}::date
    ORDER BY b.name NULLS LAST, s.code, e.started_at`)).rows as (DailyReport['units'][number] & { brigadeId: string | null })[];

  const visits = (await db.execute(sql`
    SELECT sc.brigade_id AS "brigadeId", b.name AS "brigadeName", sc.station_id AS "stationId", s.code AS "stationCode",
      CASE WHEN sc.original_date <> sc.planned_date THEN to_char(sc.original_date, 'YYYY-MM-DD') END AS "originalDate"
    FROM schedules sc JOIN brigades b ON b.id = sc.brigade_id JOIN stations s ON s.id = sc.station_id AND s.deleted_at IS NULL
    WHERE sc.project_id = ${projectId} AND sc.planned_date = ${date}::date AND sc.status <> 'cancelada'
    ORDER BY b.name, sc.sort_order, s.code`)).rows as { brigadeId: string; brigadeName: string; stationId: string; stationCode: string; originalDate: string | null }[];

  const incidents = (await db.execute(sql`
    SELECT i.id, i.type, i.status, b.name AS "brigadeName", s.code AS "stationCode", u.full_name AS "reportedBy",
      ${ISO(sql`i.occurred_at`)} AS "occurredAt", i.description
    FROM incidents i JOIN users u ON u.id = i.reported_by_id
    LEFT JOIN brigades b ON b.id = i.brigade_id LEFT JOIN stations s ON s.id = i.station_id
    WHERE i.project_id = ${projectId} AND ${limaDay(sql`i.occurred_at`)} = ${date}::date
    ORDER BY i.occurred_at`)).rows as DailyReport['incidents'];

  const reschedules = (await db.execute(sql`
    SELECT s.code AS "stationCode", b.name AS "brigadeName",
      to_char(r.from_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "fromDate", to_char(r.to_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "toDate",
      r.reason, r.status, au.full_name AS "approvedByName"
    FROM reschedules r JOIN schedules sc ON sc.id = r.schedule_id JOIN stations s ON s.id = sc.station_id JOIN brigades b ON b.id = sc.brigade_id
    LEFT JOIN users au ON au.id = r.approved_by_id
    WHERE sc.project_id = ${projectId}
      AND (${limaDay(sql`r.created_at`)} = ${date}::date OR ${limaDay(sql`r.approved_at`)} = ${date}::date)
    ORDER BY r.created_at`)).rows as DailyReport['reschedules'];

  const closed = (u: { status: string }) => u.status === 'completada' || u.status === 'no_realizada';
  const stations: DailyReport['stations'] = visits.map((v) => {
    const st = t.brigades.find((b) => b.id === v.brigadeId)?.stations.find((s) => s.stationId === v.stationId);
    return {
      brigadeName: v.brigadeName, stationCode: v.stationCode, originalDate: v.originalDate,
      status: st?.status ?? 'pendiente', required: st?.required ?? 0, done: st?.done ?? 0, notDone: st?.notDone ?? 0,
      doneToday: units.filter((u) => u.brigadeId === v.brigadeId && u.stationCode === v.stationCode && u.status === 'completada').length,
    };
  });

  const pending: DailyReport['pending'] = t.brigades.flatMap((b) => b.stations
    .filter((s) => s.firstDate <= date && s.done + s.notDone < s.required)
    .map((s) => ({ brigadeName: b.name, stationCode: s.code, firstDate: s.firstDate, pendingUnits: s.required - s.done - s.notDone, late: s.late })))
    .sort((a, b) => a.firstDate.localeCompare(b.firstDate) || a.brigadeName.localeCompare(b.brigadeName));

  return {
    date, projectCode: p.code, projectName: p.name, metrics: t.metrics,
    day: {
      stationsPlanned: stations.length,
      stationsExecuted: stations.filter((s) => s.status === 'ejecutada' || s.status === 'cerrada_incompleta').length,
      units: units.filter(closed).length,
      unitsCompleted: units.filter((u) => u.status === 'completada').length,
      records: units.reduce((a, u) => a + u.records, 0),
      photos: units.reduce((a, u) => a + u.photos, 0),
      incidents: incidents.length,
    },
    brigades: t.brigades.map((b) => ({
      id: b.id, name: b.name, specialtyCode: b.specialtyCode, flag: b.flag,
      progressPct: b.metrics.progressPct, compliancePct: b.metrics.compliancePct,
      unitsToday: units.filter((u) => u.brigadeId === b.id && closed(u)).length,
      stationsToday: visits.filter((v) => v.brigadeId === b.id).length,
      lastSyncAt: b.lastSyncAt,
    })),
    stations,
    units: units.map(({ brigadeId: _b, ...u }) => u),
    incidents, reschedules, pending,
  };
}

function metricPairs(m: TrackingMetrics & { brigades?: number }): [string, unknown][] {
  return [
    ...(m.brigades != null ? [['Brigadas', m.brigades] as [string, unknown]] : []),
    ['Estaciones programadas', m.stationsPlanned],
    ['Estaciones con fecha cumplida', m.stationsDue],
    ['Estaciones ejecutadas', m.stationsExecuted],
    ['Estaciones en curso', m.stationsInProgress],
    ['Estaciones atrasadas', m.stationsLate],
    ['Unidades requeridas', m.unitsRequired],
    ['Unidades completadas', m.unitsDone],
    ['Unidades no realizadas', m.unitsNotDone],
    ['Avance (completadas / requeridas)', m.progressPct == null ? null : `${m.progressPct} %`],
    ['Cumplimiento a la fecha', m.compliancePct == null ? null : `${m.compliancePct} %`],
    ['Unidades ejecutadas fuera de fecha', m.offDateUnits],
    ['Desviación del cronograma', m.deviationPct == null ? null : `${m.deviationPct} %`],
    ['Unidades ejecutadas en fecha reprogramada', m.rescheduledUnits],
    ['Alertas activas', m.activeAlerts],
    ['Alertas críticas sin cerrar', m.criticalAlerts],
    ['Reprogramaciones pendientes', m.pendingReschedules],
  ];
}

/** Excel del reporte diario. */
export async function dailyWorkbook(projectId: string, date: string) {
  const r = await dailyReport(projectId, date);
  const wb = workbook();
  addKeyValues(wb, 'Resumen', `Reporte diario ${r.projectCode} · ${ddmmyyyy(date)}`, [
    ['Proyecto', `${r.projectCode} · ${r.projectName}`],
    ['Fecha del reporte', ddmmyyyy(date)],
    ['Generado', limaDateTime(new Date().toISOString())],
    ['', null],
    ['Estaciones programadas en el día', r.day.stationsPlanned],
    ['Estaciones ejecutadas en el día', r.day.stationsExecuted],
    ['Unidades ejecutadas en el día', r.day.units],
    ['Unidades completadas en el día', r.day.unitsCompleted],
    ['Registros del formulario', r.day.records],
    ['Fotos', r.day.photos],
    ['Incidencias del día', r.day.incidents],
    ['', null],
    ['Avance acumulado del proyecto', null],
    ...metricPairs(r.metrics),
  ]);
  addTable(wb, 'Brigadas', [
    { header: 'Brigada', width: 22, value: (b) => b.name },
    { header: 'Especialidad', value: (b) => b.specialtyCode },
    { header: 'Estado', width: 16, value: (b) => BRIGADE_FLAG_LABELS[b.flag] },
    { header: 'Avance', value: (b) => pct(b.progressPct), numFmt: PCT },
    { header: 'Cumplimiento a la fecha', width: 14, value: (b) => pct(b.compliancePct), numFmt: PCT },
    { header: 'Estaciones del día', width: 12, value: (b) => b.stationsToday },
    { header: 'Unidades del día', width: 12, value: (b) => b.unitsToday },
    { header: 'Última sincronización', width: 20, value: (b) => limaDateTime(b.lastSyncAt) },
  ], r.brigades);
  addTable(wb, 'Estaciones del día', [
    { header: 'Brigada', width: 22, value: (s) => s.brigadeName },
    { header: 'Estación', value: (s) => s.stationCode },
    { header: 'Reprogramada desde', width: 14, value: (s) => ddmmyyyy(s.originalDate) },
    { header: 'Estado', width: 18, value: (s) => STATION_STATUS_LABELS[s.status] },
    { header: 'Unidades requeridas', width: 12, value: (s) => s.required },
    { header: 'Completadas (total)', width: 12, value: (s) => s.done },
    { header: 'No realizadas', width: 12, value: (s) => s.notDone },
    { header: 'Completadas en el día', width: 12, value: (s) => s.doneToday },
  ], r.stations);
  addTable(wb, 'Unidades', [
    { header: 'Unidad', width: 16, value: (u) => u.unitCode },
    { header: 'Estación', value: (u) => u.stationCode },
    { header: 'Método', value: (u) => u.methodCode },
    { header: 'Brigada', width: 20, value: (u) => u.brigadeName },
    { header: 'Especialista', width: 28, value: (u) => u.specialistName },
    { header: 'Estado', width: 14, value: (u) => EXECUTION_STATUS_LABELS[u.status] },
    { header: 'Inicio', width: 18, value: (u) => limaDateTime(u.startedAt) },
    { header: 'Registros', value: (u) => u.records },
    { header: 'Fotos', value: (u) => u.photos },
  ], r.units);
  addTable(wb, 'Incidencias', [
    { header: 'Fecha y hora', width: 18, value: (i) => limaDateTime(i.occurredAt) },
    { header: 'Tipo', width: 22, value: (i) => INCIDENT_TYPE_LABELS[i.type] },
    { header: 'Estado', width: 14, value: (i) => INCIDENT_STATUS_LABELS[i.status] },
    { header: 'Brigada', width: 20, value: (i) => i.brigadeName },
    { header: 'Estación', value: (i) => i.stationCode },
    { header: 'Reportó', width: 26, value: (i) => i.reportedBy },
    { header: 'Descripción', width: 60, value: (i) => i.description },
  ], r.incidents);
  addTable(wb, 'Reprogramaciones', reschedCols, r.reschedules);
  addTable(wb, 'Pendientes', [
    { header: 'Brigada', width: 22, value: (p) => p.brigadeName },
    { header: 'Estación', value: (p) => p.stationCode },
    { header: 'Fecha programada', width: 14, value: (p) => ddmmyyyy(p.firstDate) },
    { header: 'Unidades pendientes', width: 12, value: (p) => p.pendingUnits },
    { header: 'Atrasada', value: (p) => (p.late ? 'Sí' : 'No') },
  ], r.pending);
  return { wb, filename: `Reporte diario ${r.projectCode} ${date}.xlsx` };
}

const reschedCols = [
  { header: 'Estación', value: (r: DailyReport['reschedules'][number]) => r.stationCode },
  { header: 'Brigada', width: 20, value: (r: DailyReport['reschedules'][number]) => r.brigadeName },
  { header: 'Fecha anterior', width: 14, value: (r: DailyReport['reschedules'][number]) => ddmmyyyy(r.fromDate) },
  { header: 'Nueva fecha', width: 14, value: (r: DailyReport['reschedules'][number]) => ddmmyyyy(r.toDate) },
  { header: 'Estado', value: (r: DailyReport['reschedules'][number]) => RESCHEDULE_LABELS[r.status] },
  { header: 'Aprobó', width: 26, value: (r: DailyReport['reschedules'][number]) => r.approvedByName },
  { header: 'Motivo', width: 50, value: (r: DailyReport['reschedules'][number]) => r.reason },
];

/** Excel del reporte consolidado (5.6): avance general, cumplimiento por brigada y estación, desviaciones, alertas y sincronización. */
export async function consolidatedWorkbook(projectId: string, date: string) {
  const p = await project(projectId);
  const t = await computeTracking(projectId, { today: date });
  const wb = workbook();
  addKeyValues(wb, 'Resumen', `Reporte consolidado ${p.code} · corte ${ddmmyyyy(date)}`, [
    ['Proyecto', `${p.code} · ${p.name}`],
    ['Fecha de corte', ddmmyyyy(date)],
    ['Generado', limaDateTime(new Date().toISOString())],
    ['', null],
    ...metricPairs(t.metrics),
  ]);
  addTable(wb, 'Por brigada', [
    { header: 'Brigada', width: 22, value: (b) => b.name },
    { header: 'Especialidad', width: 16, value: (b) => b.specialtyName },
    { header: 'Jefe de brigada', width: 26, value: (b) => b.leaderName },
    { header: 'Supervisor', width: 26, value: (b) => b.supervisorName },
    { header: 'Estado', width: 16, value: (b) => BRIGADE_FLAG_LABELS[b.flag] },
    { header: 'Estaciones programadas', width: 12, value: (b) => b.metrics.stationsPlanned },
    { header: 'Estaciones ejecutadas', width: 12, value: (b) => b.metrics.stationsExecuted },
    { header: 'Estaciones atrasadas', width: 12, value: (b) => b.metrics.stationsLate },
    { header: 'Unidades requeridas', width: 12, value: (b) => b.metrics.unitsRequired },
    { header: 'Completadas', width: 12, value: (b) => b.metrics.unitsDone },
    { header: 'No realizadas', width: 12, value: (b) => b.metrics.unitsNotDone },
    { header: 'Avance', value: (b) => pct(b.metrics.progressPct), numFmt: PCT },
    { header: 'Cumplimiento a la fecha', width: 14, value: (b) => pct(b.metrics.compliancePct), numFmt: PCT },
    { header: 'Fuera de fecha', width: 12, value: (b) => b.metrics.offDateUnits },
    { header: 'Desviación', value: (b) => pct(b.metrics.deviationPct), numFmt: PCT },
    { header: 'Alertas activas', width: 12, value: (b) => b.metrics.activeAlerts },
    { header: 'Última sincronización', width: 20, value: (b) => limaDateTime(b.lastSyncAt) },
  ], t.brigades);
  const stationRows = t.brigades.flatMap((b) => b.stations.map((s) => ({ b, s })));
  addTable(wb, 'Por estación', [
    { header: 'Brigada', width: 22, value: (x) => x.b.name },
    { header: 'Estación', value: (x) => x.s.code },
    { header: 'Área', value: (x) => x.s.influenceArea },
    { header: 'Fecha original', width: 14, value: (x) => ddmmyyyy(x.s.originalDate) },
    { header: 'Fecha programada', width: 14, value: (x) => ddmmyyyy(x.s.firstDate) },
    { header: 'Reprogramada', value: (x) => (x.s.rescheduled ? 'Sí' : 'No') },
    { header: 'Estado', width: 18, value: (x) => STATION_STATUS_LABELS[x.s.status] },
    { header: 'Métodos', width: 30, value: (x) => x.s.methods.filter((m) => !m.openEnded).map((m) => `${m.code} ${m.done}/${m.required}`).join(', ') },
    { header: 'Requeridas', value: (x) => x.s.required },
    { header: 'Completadas', value: (x) => x.s.done },
    { header: 'No realizadas', value: (x) => x.s.notDone },
    { header: 'Cumplimiento', value: (x) => (x.s.required ? x.s.done / x.s.required : null), numFmt: PCT },
    { header: 'Fuera de fecha', value: (x) => x.s.offDateUnits },
    { header: 'Registros oportunos', width: 12, value: (x) => x.s.openRecords },
    { header: 'Alertas', value: (x) => x.s.alerts },
  ], stationRows);

  const deviations = (await db.execute(sql`
    SELECT su.code AS "unitCode", s.code AS "stationCode", m.code AS "methodCode", b.name AS "brigadeName", u.full_name AS "specialistName",
      to_char(${limaDay(sql`e.started_at`)}, 'YYYY-MM-DD') AS "executedOn",
      (SELECT string_agg(DISTINCT to_char(sc.planned_date, 'YYYY-MM-DD'), ', ') FROM schedules sc
        WHERE sc.station_id = e.station_id AND sc.brigade_id = e.brigade_id AND sc.status <> 'cancelada') AS "plannedOn",
      (SELECT string_agg(DISTINCT to_char(sc.original_date, 'YYYY-MM-DD'), ', ') FROM schedules sc
        WHERE sc.station_id = e.station_id AND sc.brigade_id = e.brigade_id AND sc.status <> 'cancelada') AS "originalOn",
      EXISTS (SELECT 1 FROM schedules sc WHERE sc.station_id = e.station_id AND sc.brigade_id = e.brigade_id AND sc.status <> 'cancelada'
        AND sc.planned_date = ${limaDay(sql`e.started_at`)}) AS rescheduled
    FROM executions e
    JOIN sampling_units su ON su.id = e.sampling_unit_id AND su.status = 'completada'
    JOIN stations s ON s.id = e.station_id AND s.project_id = ${projectId} AND s.deleted_at IS NULL
    JOIN methods m ON m.id = e.method_id AND NOT m.is_open_ended
    JOIN brigades b ON b.id = e.brigade_id
    JOIN users u ON u.id = e.specialist_id
    WHERE e.status = 'completada' AND NOT EXISTS (
      SELECT 1 FROM schedules sc WHERE sc.station_id = e.station_id AND sc.brigade_id = e.brigade_id AND sc.status <> 'cancelada'
        AND sc.original_date = ${limaDay(sql`e.started_at`)})
    ORDER BY e.started_at`)).rows as {
      unitCode: string; stationCode: string; methodCode: string; brigadeName: string; specialistName: string;
      executedOn: string; plannedOn: string | null; originalOn: string | null; rescheduled: boolean;
    }[];
  addTable(wb, 'Desviaciones', [
    { header: 'Unidad', width: 16, value: (d) => d.unitCode },
    { header: 'Estación', value: (d) => d.stationCode },
    { header: 'Método', value: (d) => d.methodCode },
    { header: 'Brigada', width: 20, value: (d) => d.brigadeName },
    { header: 'Especialista', width: 26, value: (d) => d.specialistName },
    { header: 'Fecha original', width: 14, value: (d) => d.originalOn?.split(', ').map(ddmmyyyy).join(', ') },
    { header: 'Fecha programada', width: 14, value: (d) => d.plannedOn?.split(', ').map(ddmmyyyy).join(', ') },
    { header: 'Ejecutada', width: 12, value: (d) => ddmmyyyy(d.executedOn) },
    { header: 'Tipo', width: 30, value: (d) => (d.rescheduled ? 'En fecha reprogramada (aprobada)' : 'Fuera de fecha (desviación)') },
  ], deviations, 'Unidades completadas en una fecha distinta a la original');

  const alerts = (await db.execute(sql`
    SELECT ${ISO(sql`i.occurred_at`)} AS "occurredAt", i.type, i.status, i.launched_from AS origin, b.name AS "brigadeName", s.code AS "stationCode",
      su.code AS "unitCode", u.full_name AS "reportedBy", i.description, i.proposed_action AS "proposedAction",
      i.coordination_decision AS decision, i.coordination_response AS response, ru.full_name AS "resolvedBy", ${ISO(sql`i.resolved_at`)} AS "resolvedAt",
      (SELECT count(*) FROM incident_messages im WHERE im.incident_id = i.id)::int AS messages,
      i.is_critical AS critical, i.critical_reason AS "criticalReason", fo.full_name AS "followUpOwner",
      (SELECT f.body FROM incident_follow_ups f WHERE f.incident_id = i.id ORDER BY f.created_at DESC LIMIT 1) AS "lastFollowUp"
    FROM incidents i JOIN users u ON u.id = i.reported_by_id
    LEFT JOIN brigades b ON b.id = i.brigade_id LEFT JOIN stations s ON s.id = i.station_id
    LEFT JOIN sampling_units su ON su.id = i.sampling_unit_id LEFT JOIN users ru ON ru.id = i.resolved_by_id
    LEFT JOIN users fo ON fo.id = i.follow_up_owner_id
    WHERE i.project_id = ${projectId} ORDER BY i.is_critical DESC, i.occurred_at DESC`)).rows as {
      occurredAt: string; type: IncidentType; status: IncidentStatus; origin: string | null; brigadeName: string | null; stationCode: string | null;
      unitCode: string | null; reportedBy: string; description: string; proposedAction: string | null; decision: IncidentDecision | null;
      response: string | null; resolvedBy: string | null; resolvedAt: string | null; messages: number;
      critical: boolean; criticalReason: string | null; followUpOwner: string | null; lastFollowUp: string | null;
    }[];
  addTable(wb, 'Alertas', [
    { header: 'Fecha y hora', width: 18, value: (a) => limaDateTime(a.occurredAt) },
    { header: 'Tipo', width: 22, value: (a) => INCIDENT_TYPE_LABELS[a.type] },
    { header: 'Estado', width: 14, value: (a) => INCIDENT_STATUS_LABELS[a.status] },
    { header: 'Crítica', width: 10, value: (a) => (a.critical ? 'Sí' : null) },
    { header: 'Motivo crítico', width: 30, value: (a) => a.criticalReason },
    { header: 'Responsable del seguimiento', width: 26, value: (a) => a.followUpOwner },
    { header: 'Último avance', width: 40, value: (a) => a.lastFollowUp },
    { header: 'Brigada', width: 20, value: (a) => a.brigadeName },
    { header: 'Estación', value: (a) => a.stationCode },
    { header: 'Unidad', width: 16, value: (a) => a.unitCode },
    { header: 'Reportó', width: 26, value: (a) => a.reportedBy },
    { header: 'Descripción', width: 50, value: (a) => a.description },
    { header: 'Acción propuesta', width: 30, value: (a) => a.proposedAction },
    { header: 'Decisión', width: 16, value: (a) => (a.decision ? INCIDENT_DECISION_LABELS[a.decision] : null) },
    { header: 'Respuesta de coordinación', width: 40, value: (a) => a.response },
    { header: 'Atendió', width: 24, value: (a) => a.resolvedBy },
    { header: 'Fecha de atención', width: 18, value: (a) => limaDateTime(a.resolvedAt) },
    { header: 'Mensajes', value: (a) => a.messages },
  ], alerts);

  const reschedules = (await db.execute(sql`
    SELECT s.code AS "stationCode", b.name AS "brigadeName",
      to_char(r.from_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "fromDate", to_char(r.to_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "toDate",
      r.reason, r.status, au.full_name AS "approvedByName"
    FROM reschedules r JOIN schedules sc ON sc.id = r.schedule_id JOIN stations s ON s.id = sc.station_id JOIN brigades b ON b.id = sc.brigade_id
    LEFT JOIN users au ON au.id = r.approved_by_id
    WHERE sc.project_id = ${projectId} ORDER BY r.created_at`)).rows as DailyReport['reschedules'];
  addTable(wb, 'Reprogramaciones', reschedCols, reschedules);

  const ROLE = { jefe: 'Jefe de brigada', miembro: 'Especialista', supervisor: 'Supervisor', logistico: 'Logístico' } as const;
  addTable(wb, 'Sincronización', [
    { header: 'Brigada', width: 22, value: (x) => x.b.name },
    { header: 'Integrante', width: 28, value: (x) => x.m.fullName },
    { header: 'Rol', width: 16, value: (x) => ROLE[x.m.role] },
    { header: 'Teléfono', width: 14, value: (x) => x.m.phone },
    { header: 'Última sincronización', width: 20, value: (x) => limaDateTime(x.m.lastSyncAt) },
    { header: 'Última descarga de paquete', width: 20, value: (x) => limaDateTime(x.m.lastDownloadAt) },
    { header: 'Versión de la app', width: 12, value: (x) => x.m.appVersion },
    { header: 'Unidades completadas', width: 12, value: (x) => x.m.unitsDone },
  ], t.brigades.flatMap((b) => b.members.map((m) => ({ b, m }))));
  return { wb, filename: `Reporte consolidado ${p.code} ${date}.xlsx` };
}

/** Excel de registros históricos con los filtros de Registros de campo: una hoja de unidades y una por método con sus formularios. */
export async function recordsWorkbook(projectId: string, f: Omit<RecordsQuery, 'page'>) {
  const p = await project(projectId);
  const cond = recordsWhere(projectId, f);
  const rows = (await db.execute(sql`
    SELECT su.code AS "unitCode", e.status, ${ISO(sql`e.started_at`)} AS "startedAt", ${ISO(sql`e.finished_at`)} AS "finishedAt",
      s.code AS "stationCode", s.vegetation_unit AS "vegetationUnit", s.influence_area AS "influenceArea",
      m.id AS "methodId", m.code AS "methodCode", m.name AS "methodName", COALESCE(e.form_data->'schemaSnapshot', m.form_schema) AS "formSchema", sp.name AS "specialtyName",
      COALESCE(e.form_data->'header','{}'::jsonb) AS "formHeader", COALESCE(e.form_data->'contexts','{}'::jsonb) AS "formContexts",
      b.name AS "brigadeName", u.full_name AS "specialistName",
      ST_Y(e.start_geom) AS lat, ST_X(e.start_geom) AS lng, e.start_accuracy AS accuracy, e.observations,
      COALESCE(e.form_data->'records', '[]'::jsonb) AS "formRecords",
      (SELECT count(*) FROM attachments a WHERE a.owner_type = 'execution' AND a.owner_id = e.id AND a.kind IN ('foto', 'foto_metodo'))::int AS photos,
      (SELECT count(*) FROM attachments a WHERE a.owner_type = 'execution' AND a.owner_id = e.id AND a.kind = 'audio')::int AS audios
    ${RECORDS_FROM} WHERE ${cond}
    ORDER BY sp.name, m.sort_order, m.code, e.started_at, su.code`)).rows as {
      unitCode: string; status: keyof typeof EXECUTION_STATUS_LABELS; startedAt: string; finishedAt: string | null; stationCode: string;
      vegetationUnit: string | null; influenceArea: string | null; methodId: string; methodCode: string; methodName: string;
      formSchema: { fields: FormField[]; revision?: string }; formHeader: Record<string, unknown>; formContexts: Record<string, Record<string, unknown>>; specialtyName: string; brigadeName: string | null; specialistName: string;
      lat: number | null; lng: number | null; accuracy: number | null; observations: string | null;
      formRecords: { id: string; values: Record<string, unknown>; contextId?:string; group?:string }[]; photos: number; audios: number;
    }[];
  const utm = (lat: number | null, lng: number | null) => (lat == null || lng == null ? null : formatUtm(latLngToUtm(lat, lng)));
  const wb = workbook();
  addTable(wb, 'Unidades', [
    { header: 'Unidad', width: 16, value: (r) => r.unitCode },
    { header: 'Especialidad', width: 16, value: (r) => r.specialtyName },
    { header: 'Método', width: 26, value: (r) => `${r.methodCode} · ${r.methodName}` },
    { header: 'Estación', value: (r) => r.stationCode },
    { header: 'Unidad de vegetación', width: 24, value: (r) => r.vegetationUnit },
    { header: 'Área', value: (r) => r.influenceArea },
    { header: 'Brigada', width: 20, value: (r) => r.brigadeName },
    { header: 'Especialista', width: 26, value: (r) => r.specialistName },
    { header: 'Estado', width: 14, value: (r) => EXECUTION_STATUS_LABELS[r.status] },
    { header: 'Inicio', width: 18, value: (r) => limaDateTime(r.startedAt) },
    { header: 'Fin', width: 18, value: (r) => limaDateTime(r.finishedAt) },
    { header: 'UTM inicio', width: 26, value: (r) => utm(r.lat, r.lng) },
    { header: 'Precisión (m)', value: (r) => (r.accuracy == null ? null : Math.round(r.accuracy)) },
    { header: 'Registros', value: (r) => r.formRecords.length },
    { header: 'Fotos', value: (r) => r.photos },
    { header: 'Audios', value: (r) => r.audios },
    { header: 'Observaciones', width: 40, value: (r) => r.observations },
  ], rows, `Registros de campo ${p.code} · ${rows.length} unidades`);

  // Una hoja por método con los campos de su formulario (p. ej. especies e individuos).
  const byMethod = new Map<string, typeof rows>();
  for (const r of rows) {
    const versionKey=r.methodId+canonicalFormJson(r.formSchema);
    byMethod.set(versionKey,[...(byMethod.get(versionKey)??[]),r]);
  }
  for (const list of byMethod.values()) {
    const fields = list[0]!.formSchema.fields ?? [];
    const extraKeys=[...new Set(list.flatMap((r)=>[
      ...Object.keys(r.formHeader),...Object.values(r.formContexts).flatMap(Object.keys),...r.formRecords.flatMap((rec)=>Object.keys(rec.values)),
    ]))].filter((key)=>!fields.some((fd)=>fd.key===key));
    const extraLabels: Record<string,string>={field_date:'Fecha de campo',field_start:'Hora de campo: inicio',field_end:'Hora de campo: término',hostExecutionId:'Evaluación del hospedero',hostCoordinates:'Coordenadas del hospedero'};
    const recs = list.flatMap((r) => [
      ...(Object.keys(r.formHeader).length ? [{r,rec:{id:'cabecera',values:r.formHeader},i:0,scope:'cabecera'}] : []),
      ...Object.entries(r.formContexts).map(([key,values])=>({r,rec:{id:key,values:{...r.formHeader,...values}},i:0,scope:'subunidad'})),
      ...r.formRecords.map((rec,i)=>({r,rec:{...rec,values:{...r.formHeader,...r.formContexts[rec.contextId??'unidad'],...rec.values}},i:i+1,scope:rec.group??'registro'})),
    ]);
    addTable(wb, `${list[0]!.methodCode} ${list[0]!.methodName}`, [
      { header: 'Unidad', width: 16, value: (x) => x.r.unitCode },
      { header: 'N°', value: (x) => x.i || null },
      { header: 'Nivel / grupo', value: (x) => x.scope },
      { header: 'Identificador', value: (x) => x.rec.id },
      { header: 'Versión formulario', value: (x) => x.r.formSchema.revision ?? 'original' },
      { header: 'Estación', value: (x) => x.r.stationCode },
      { header: 'Especialista', width: 26, value: (x) => x.r.specialistName },
      ...fields.map((fd) => ({
        header: fd.label, width: fd.type === 'textarea' ? 40 : fd.type === 'species' ? 28 : fd.type === 'coords' ? 26 : undefined,
        value: (x: (typeof recs)[number]) => cell(fd, x.rec.values[fd.key], utm),
      })),
      ...extraKeys.map((key)=>({header:extraLabels[key]??key,width:24,value:(x:(typeof recs)[number])=>{
        const value=x.rec.values[key];
        return value==null?null:typeof value==='object'?JSON.stringify(value):String(value);
      }})),
    ], recs);
  }
  const tag = f.from || f.to ? ` ${f.from ?? ''}${f.to && f.to !== f.from ? `_${f.to}` : ''}` : '';
  return { wb, filename: `Registros ${p.code}${tag}.xlsx` };
}

function cell(f: FormField, v: unknown, utm: (lat: number | null, lng: number | null) => string | null) {
  if (v == null || v === '') return null;
  if (f.type === 'coords' && typeof v === 'object') {
    const c = v as { lat?: number; lng?: number; utm?: string };
    return c.utm ?? utm(c.lat ?? null, c.lng ?? null);
  }
  if (f.type === 'number' && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (f.type === 'date' && typeof v === 'string') return v.length > 10 ? limaDateTime(v) : ddmmyyyy(v);
  if (Array.isArray(v)) return v.map((x)=>f.optionLabels?.[String(x)]??String(x)).join(', ');
  if (f.type === 'select') return f.optionLabels?.[String(v)] ?? String(v);
  return v;
}
