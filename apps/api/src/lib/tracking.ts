import { sql } from 'drizzle-orm';
import type { BrigadeTracking, StationTracking, TrackingMetrics, ProjectTracking, MemberTracking } from '@toce/shared';
import { db } from '../db/index.js';

/**
 * Seguimiento del avance (Fase 2). Todo se calcula a partir de lo sincronizado:
 *
 * - Unidad de trabajo = brigada × estación (una estación con varias fechas se cuenta una vez). Sus unidades
 *   requeridas son las de los métodos de la especialidad de la brigada (los registros abiertos no cuentan).
 * - Avance = unidades completadas / requeridas. Cumplimiento a la fecha = lo mismo sobre lo programado hasta hoy.
 * - Desviación = unidades ejecutadas fuera de su fecha programada: ni la original ni una reprogramación
 *   aprobada (las ejecutadas en la fecha reprogramada se informan aparte).
 * - Atrasada = visita con fecha pasada que aún tiene unidades sin cerrar (completada o no realizada).
 */

type GroupRow = {
  brigadeId: string; stationId: string; code: string; name: string | null; influenceArea: string | null;
  firstDate: string; lastDate: string; originalDates: string[]; plannedDates: string[]; scheduleIds: string[];
};
type MethodRow = {
  brigadeId: string; stationId: string; methodId: string; methodCode: string; openEnded: boolean; required: number;
  done: number; notDone: number; inProgress: number; created: number;
};
type ExecRow = { brigadeId: string | null; stationId: string; methodId: string; day: string; specialistId: string; status: string };

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

function metrics(stations: StationTracking[], today: string, extra: { activeAlerts: number; pendingReschedules: number }): TrackingMetrics {
  const due = stations.filter((s) => s.firstDate <= today);
  const sum = (xs: StationTracking[], k: 'required' | 'done' | 'notDone') => xs.reduce((a, s) => a + s[k], 0);
  const executed = stations.reduce((a, s) => a + s.executedUnits, 0);
  const offDate = stations.reduce((a, s) => a + s.offDateUnits, 0);
  return {
    stationsPlanned: stations.length,
    stationsDue: due.length,
    stationsExecuted: stations.filter((s) => s.status === 'ejecutada').length,
    stationsInProgress: stations.filter((s) => s.status === 'en_curso').length,
    stationsLate: stations.filter((s) => s.late).length,
    unitsRequired: sum(stations, 'required'),
    unitsDue: sum(due, 'required'),
    unitsDone: sum(stations, 'done'),
    unitsNotDone: sum(stations, 'notDone'),
    unitsDoneDue: sum(due, 'done'),
    executedUnits: executed,
    offDateUnits: offDate,
    rescheduledUnits: stations.reduce((a, s) => a + s.rescheduledUnits, 0),
    progressPct: pct(sum(stations, 'done'), sum(stations, 'required')),
    compliancePct: pct(sum(due, 'done'), sum(due, 'required')),
    deviationPct: pct(offDate, executed),
    ...extra,
  };
}

/** Avance del proyecto completo (o de una brigada) a la fecha de corte `today` (AAAA-MM-DD, hora de Lima). */
export async function computeTracking(projectId: string, opts: { today?: string; brigadeId?: string } = {}): Promise<ProjectTracking> {
  const today = opts.today
    ?? ((await db.execute(sql`SELECT to_char((now() AT TIME ZONE 'America/Lima')::date, 'YYYY-MM-DD') AS d`)).rows[0] as { d: string }).d;
  const bFilter = opts.brigadeId ? sql`AND b.id = ${opts.brigadeId}` : sql``;

  const brigades = (await db.execute(sql`
    SELECT b.id, b.name, sp.name AS "specialtyName", sp.code AS "specialtyCode", lu.full_name AS "leaderName",
      su.full_name AS "supervisorName", gu.full_name AS "logisticianName", b.is_active AS "isActive"
    FROM brigades b
    LEFT JOIN specialties sp ON sp.id = b.specialty_id
    LEFT JOIN users lu ON lu.id = b.leader_id
    LEFT JOIN users su ON su.id = b.supervisor_id
    LEFT JOIN users gu ON gu.id = b.logistician_id
    WHERE b.project_id = ${projectId} ${bFilter}
    ORDER BY b.name`)).rows as Omit<BrigadeTracking, 'metrics' | 'stations' | 'members' | 'lastSyncAt' | 'flag'>[];

  const groups = (await db.execute(sql`
    SELECT sc.brigade_id AS "brigadeId", sc.station_id AS "stationId", s.code, s.name, s.influence_area AS "influenceArea",
      to_char(min(sc.planned_date), 'YYYY-MM-DD') AS "firstDate", to_char(max(sc.planned_date), 'YYYY-MM-DD') AS "lastDate",
      array_agg(DISTINCT to_char(sc.original_date, 'YYYY-MM-DD')) AS "originalDates",
      array_agg(DISTINCT to_char(sc.planned_date, 'YYYY-MM-DD')) AS "plannedDates",
      array_agg(sc.id) AS "scheduleIds"
    FROM schedules sc
    JOIN brigades b ON b.id = sc.brigade_id ${bFilter}
    JOIN stations s ON s.id = sc.station_id AND s.deleted_at IS NULL
    WHERE sc.project_id = ${projectId} AND sc.status <> 'cancelada'
    GROUP BY sc.brigade_id, sc.station_id, s.code, s.name, s.influence_area
    ORDER BY min(sc.planned_date), s.code`)).rows as GroupRow[];

  const methods = (await db.execute(sql`
    SELECT g.brigade_id AS "brigadeId", g.station_id AS "stationId", m.id AS "methodId", m.code AS "methodCode", m.is_open_ended AS "openEnded",
      sm.units_required AS required,
      count(su.id) FILTER (WHERE su.status = 'completada')::int AS done,
      count(su.id) FILTER (WHERE su.status = 'no_realizada')::int AS "notDone",
      count(su.id) FILTER (WHERE su.status IN ('en_ejecucion', 'fotos_ok'))::int AS "inProgress",
      count(su.id)::int AS created
    FROM (SELECT DISTINCT sc.brigade_id, sc.station_id FROM schedules sc WHERE sc.project_id = ${projectId} AND sc.status <> 'cancelada') g
    JOIN brigades b ON b.id = g.brigade_id ${bFilter}
    JOIN station_methods sm ON sm.station_id = g.station_id
    JOIN methods m ON m.id = sm.method_id AND (b.specialty_id IS NULL OR m.specialty_id = b.specialty_id)
    LEFT JOIN sampling_units su ON su.station_method_id = sm.id
    GROUP BY g.brigade_id, g.station_id, m.id, m.code, m.is_open_ended, m.sort_order, sm.units_required
    ORDER BY m.sort_order, m.code`)).rows as MethodRow[];

  // Última ejecución de cada unidad (día en hora de Lima) para la desviación y la curva de avance.
  const execs = (await db.execute(sql`
    SELECT DISTINCT ON (su.id) e.brigade_id AS "brigadeId", su.station_id AS "stationId", su.method_id AS "methodId",
      to_char((e.started_at AT TIME ZONE 'America/Lima')::date, 'YYYY-MM-DD') AS day, e.specialist_id AS "specialistId", su.status
    FROM sampling_units su
    JOIN executions e ON e.sampling_unit_id = su.id
    JOIN stations s ON s.id = su.station_id AND s.project_id = ${projectId}
    WHERE su.status = 'completada'
    ORDER BY su.id, e.started_at DESC`)).rows as ExecRow[];

  const incidents = (await db.execute(sql`
    SELECT i.brigade_id AS "brigadeId", i.station_id AS "stationId",
      (i.status IN ('abierta', 'en_revision')) AS active,
      (i.status IN ('abierta', 'en_revision') AND NOT EXISTS (SELECT 1 FROM reschedules r WHERE r.incident_id = i.id)
        AND (i.proposed_action ILIKE '%reprogram%' OR EXISTS (
          SELECT 1 FROM sampling_units su WHERE su.id = i.sampling_unit_id AND su.status = 'no_realizada'))) AS "needsReschedule"
    FROM incidents i WHERE i.project_id = ${projectId}`)).rows as { brigadeId: string | null; stationId: string | null; active: boolean; needsReschedule: boolean }[];

  const memberRows = (await db.execute(sql`
    SELECT x.brigade_id AS "brigadeId", u.id, u.full_name AS "fullName", sp.code AS "specialtyCode", x.role, u.phone,
      to_char((GREATEST(
        (SELECT max(e.synced_at) FROM executions e WHERE e.specialist_id = u.id),
        (SELECT max(i.updated_at) FROM incidents i WHERE i.reported_by_id = u.id),
        (SELECT max(w.created_at) FROM work_package_downloads w WHERE w.user_id = u.id))) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastSyncAt",
      to_char((SELECT max(w.created_at) FROM work_package_downloads w WHERE w.user_id = u.id) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastDownloadAt",
      (SELECT s.app_version FROM sessions s WHERE s.user_id = u.id AND s.platform <> 'web' ORDER BY s.last_used_at DESC NULLS LAST LIMIT 1) AS "appVersion",
      (SELECT count(*)::int FROM executions e JOIN sampling_units su ON su.id = e.sampling_unit_id
         WHERE e.specialist_id = u.id AND su.status = 'completada' AND e.brigade_id = x.brigade_id) AS "unitsDone"
    FROM (
      SELECT b.id AS brigade_id, bm.user_id, CASE WHEN bm.user_id = b.leader_id THEN 'jefe' ELSE 'miembro' END AS role
        FROM brigades b JOIN brigade_members bm ON bm.brigade_id = b.id AND bm.left_at IS NULL WHERE b.project_id = ${projectId} ${bFilter}
      UNION SELECT b.id, b.leader_id, 'jefe' FROM brigades b WHERE b.project_id = ${projectId} AND b.leader_id IS NOT NULL ${bFilter}
      UNION SELECT b.id, b.supervisor_id, 'supervisor' FROM brigades b WHERE b.project_id = ${projectId} AND b.supervisor_id IS NOT NULL ${bFilter}
      UNION SELECT b.id, b.logistician_id, 'logistico' FROM brigades b WHERE b.project_id = ${projectId} AND b.logistician_id IS NOT NULL ${bFilter}
    ) x
    JOIN users u ON u.id = x.user_id AND u.deleted_at IS NULL
    LEFT JOIN specialties sp ON sp.id = u.specialty_id
    ORDER BY CASE x.role WHEN 'jefe' THEN 0 WHEN 'miembro' THEN 1 WHEN 'supervisor' THEN 2 ELSE 3 END, u.full_name`)).rows as (MemberTracking & { brigadeId: string })[];

  // ---- por estación
  const key = (b: string | null, s: string) => `${b}|${s}`;
  const methodsByGroup = new Map<string, MethodRow[]>();
  for (const m of methods) methodsByGroup.set(key(m.brigadeId, m.stationId), [...(methodsByGroup.get(key(m.brigadeId, m.stationId)) ?? []), m]);
  const groupOfExec = (e: ExecRow) => {
    if (e.brigadeId) return key(e.brigadeId, e.stationId);
    // Ejecución sin brigada: la brigada programada en esa estación con ese método.
    const g = groups.find((x) => x.stationId === e.stationId && methodsByGroup.get(key(x.brigadeId, x.stationId))?.some((m) => m.methodId === e.methodId));
    return g ? key(g.brigadeId, g.stationId) : null;
  };
  const execsByGroup = new Map<string, ExecRow[]>();
  for (const e of execs) {
    const k = groupOfExec(e);
    if (k) execsByGroup.set(k, [...(execsByGroup.get(k) ?? []), e]);
  }

  const stations: (StationTracking & { brigadeId: string })[] = groups.map((g) => {
    const ms = (methodsByGroup.get(key(g.brigadeId, g.stationId)) ?? []);
    const req = ms.filter((m) => !m.openEnded);
    const required = req.reduce((a, m) => a + m.required, 0);
    const done = req.reduce((a, m) => a + Math.min(m.done, m.required), 0);
    const notDone = req.reduce((a, m) => a + m.notDone, 0);
    const inProgress = req.reduce((a, m) => a + m.inProgress, 0);
    const ex = (execsByGroup.get(key(g.brigadeId, g.stationId)) ?? []).filter((e) => req.some((m) => m.methodId === e.methodId));
    // Fuera de fecha: ni en la fecha original ni en una reprogramación aprobada (estas se informan aparte).
    const offDate = ex.filter((e) => !g.originalDates.includes(e.day) && !g.plannedDates.includes(e.day));
    const rescheduled = ex.filter((e) => !g.originalDates.includes(e.day) && g.plannedDates.includes(e.day));
    const closed = done + notDone >= required && required > 0;
    const late = g.lastDate < today && !closed;
    const status: StationTracking['status'] = required === 0
      ? 'sin_unidades'
      : done >= required ? 'ejecutada'
        : closed ? 'cerrada_incompleta'
          : done + notDone + inProgress > 0 ? 'en_curso'
            : late ? 'atrasada' : 'pendiente';
    const alerts = incidents.filter((i) => i.active && i.stationId === g.stationId && (!i.brigadeId || i.brigadeId === g.brigadeId)).length;
    return {
      brigadeId: g.brigadeId, stationId: g.stationId, code: g.code, name: g.name, influenceArea: g.influenceArea,
      firstDate: g.firstDate, lastDate: g.lastDate, originalDate: [...g.originalDates].sort()[0]!, rescheduled: g.plannedDates.some((d) => !g.originalDates.includes(d)),
      scheduleIds: g.scheduleIds, required, done, notDone, inProgress, executedUnits: ex.length, offDateUnits: offDate.length,
      rescheduledUnits: rescheduled.length, late, status, alerts,
      openRecords: ms.filter((m) => m.openEnded).reduce((a, m) => a + m.done, 0),
      methods: ms.map((m) => ({ methodId: m.methodId, code: m.methodCode, openEnded: m.openEnded, required: m.required, done: m.done, notDone: m.notDone, inProgress: m.inProgress })),
    };
  });

  const brigadeList: BrigadeTracking[] = brigades.map((b) => {
    const st = stations.filter((s) => s.brigadeId === b.id);
    const inc = incidents.filter((i) => i.brigadeId === b.id);
    const m = metrics(st, today, { activeAlerts: inc.filter((i) => i.active).length, pendingReschedules: inc.filter((i) => i.needsReschedule).length });
    const members = memberRows.filter((x) => x.brigadeId === b.id).map(({ brigadeId: _b, ...x }) => x);
    const field = members.filter((x) => x.role === 'jefe' || x.role === 'miembro');
    const lastSyncAt = field.map((x) => x.lastSyncAt).filter(Boolean).sort().pop() ?? null;
    const flag: BrigadeTracking['flag'] = !st.length
      ? 'sin_programacion'
      : m.stationsLate > 0 ? 'atrasada'
        : m.compliancePct != null && m.compliancePct < 80 ? 'en_riesgo'
          : 'al_dia';
    return { ...b, metrics: m, stations: st.map(({ brigadeId: _b, ...s }) => s), members, lastSyncAt, flag };
  });

  // ---- curva de avance: unidades programadas (cronograma original) vs completadas, acumuladas por día.
  const plannedByDay = new Map<string, number>();
  for (const s of stations) plannedByDay.set(s.originalDate, (plannedByDay.get(s.originalDate) ?? 0) + s.required);
  const doneByDay = new Map<string, number>();
  for (const s of stations) {
    for (const e of execsByGroup.get(key(s.brigadeId, s.stationId)) ?? []) {
      if (s.methods.some((m) => m.methodId === e.methodId && !m.openEnded)) doneByDay.set(e.day, (doneByDay.get(e.day) ?? 0) + 1);
    }
  }
  const days = [...new Set([...plannedByDay.keys(), ...doneByDay.keys(), today])].sort();
  const curve: ProjectTracking['curve'] = [];
  if (days.length) {
    let p = 0, d = 0;
    for (let t = new Date(`${days[0]}T12:00:00Z`); t <= new Date(`${days[days.length - 1]}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1)) {
      const day = t.toISOString().slice(0, 10);
      p += plannedByDay.get(day) ?? 0;
      d += doneByDay.get(day) ?? 0;
      curve.push({ date: day, planned: p, done: day <= today ? d : null });
    }
  }

  const all = metrics(stations, today, {
    activeAlerts: incidents.filter((i) => i.active && (!opts.brigadeId || i.brigadeId === opts.brigadeId)).length,
    pendingReschedules: incidents.filter((i) => i.needsReschedule && (!opts.brigadeId || i.brigadeId === opts.brigadeId)).length,
  });
  return { today, metrics: { ...all, brigades: brigades.length }, brigades: brigadeList, curve };
}
