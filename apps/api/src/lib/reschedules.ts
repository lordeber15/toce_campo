import type { FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import type { RescheduleCreate } from '@toce/shared';
import { db } from '../db/index.js';
import { audit } from './audit.js';
import { badRequest, conflict, notFound } from './http.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Las fechas se guardan al mediodía de Lima para que no cambien de día con la zona horaria. */
export const dayTs = (d: string) => `${d}T12:00:00-05:00`;
export const fmtDay = (d: string) => d.split('-').reverse().join('/');

type Visit = { id: string; plannedDate: string; stationId: string; brigadeId: string; projectId: string; specialtyId: string | null; status: string };

/** Visita bloqueada para el cambio de fecha. */
export async function lockVisit(tx: Tx, scheduleId: string): Promise<Visit> {
  const v = (await tx.execute(sql`
    SELECT sc.id, to_char(sc.planned_date, 'YYYY-MM-DD') AS "plannedDate", sc.station_id AS "stationId", sc.brigade_id AS "brigadeId",
      sc.project_id AS "projectId", b.specialty_id AS "specialtyId", sc.status
    FROM schedules sc JOIN brigades b ON b.id = sc.brigade_id WHERE sc.id = ${scheduleId} FOR UPDATE OF sc`)).rows[0] as Visit | undefined;
  if (!v) throw notFound('Programación');
  return v;
}

function checkVisit(v: Visit, newDate: string) {
  if (v.status === 'cancelada') throw conflict('La visita está cancelada');
  if (v.status === 'ejecutada') throw conflict('La visita ya se ejecutó completa');
  if (v.plannedDate === newDate) throw badRequest('La nueva fecha es igual a la programada');
}

/** Cambia la fecha en el cronograma (y opcionalmente reabre las unidades no realizadas). Devuelve cuántas se reabrieron. */
async function applyToSchedule(tx: Tx, v: Visit, newDate: string, reopenUnits: boolean) {
  const dup = await tx.execute(sql`
    SELECT 1 FROM schedules WHERE brigade_id = ${v.brigadeId} AND station_id = ${v.stationId} AND planned_date = ${newDate}::date AND id <> ${v.id}`);
  if (dup.rows.length) throw conflict('La brigada ya tiene esa estación programada en la nueva fecha');
  await tx.execute(sql`UPDATE schedules SET planned_date = ${newDate}::date, status = 'planificada', updated_at = now() WHERE id = ${v.id}`);
  if (!reopenUnits) return 0;
  // Unidades "no realizadas" de la estación (de la especialidad de la brigada) vuelven a pendiente.
  const res = await tx.execute(sql`
    UPDATE sampling_units su SET status = 'pendiente', updated_at = now()
    FROM methods m WHERE m.id = su.method_id AND su.station_id = ${v.stationId} AND su.status = 'no_realizada'
      ${v.specialtyId ? sql`AND m.specialty_id = ${v.specialtyId}` : sql``}
    RETURNING su.id`);
  return res.rows.length;
}

/** Deja constancia en la conversación de la alerta vinculada. */
async function noteOnIncident(tx: Tx, incidentId: string | null, authorId: string, body: string) {
  if (!incidentId) return;
  await tx.execute(sql`
    INSERT INTO incident_messages (client_id, incident_id, author_id, body, kind, sent_at)
    VALUES (gen_random_uuid(), ${incidentId}, ${authorId}, ${body}, 'decision', now())`);
  await tx.execute(sql`UPDATE incidents SET updated_at = now() WHERE id = ${incidentId}`);
}

const reopenedText = (n: number) => (n ? ` (${n} unidad${n > 1 ? 'es' : ''} vuelve${n > 1 ? 'n' : ''} a pendiente)` : '');

/**
 * Registra una reprogramación. Con `approve` se aprueba en el acto y se actualiza el cronograma;
 * si no, queda por aprobar. `proposedById` permite atribuirla a quien la pidió desde campo.
 */
export async function createReschedule(
  tx: Tx,
  req: FastifyRequest,
  projectId: string,
  b: RescheduleCreate,
  opts: { proposedById?: string } = {},
) {
  const v = await lockVisit(tx, b.scheduleId);
  if (v.projectId !== projectId) throw badRequest('La visita no es de este proyecto');
  checkVisit(v, b.newDate);
  if (b.incidentId) {
    const inc = (await tx.execute(sql`SELECT project_id AS "projectId" FROM incidents WHERE id = ${b.incidentId}`)).rows[0] as { projectId: string } | undefined;
    if (!inc || inc.projectId !== projectId) throw badRequest('La alerta no es de este proyecto');
  }
  const pending = await tx.execute(sql`SELECT 1 FROM reschedules WHERE schedule_id = ${v.id} AND status = 'propuesta'`);
  if (pending.rows.length) throw conflict('Esta visita ya tiene una reprogramación por aprobar');

  const me = req.user.sub;
  const row = (await tx.execute(sql`
    INSERT INTO reschedules (schedule_id, incident_id, from_date, to_date, reason, justification, status, reopen_units,
      proposed_by_id, approved_by_id, approved_at)
    VALUES (${v.id}, ${b.incidentId ?? null}, ${dayTs(v.plannedDate)}, ${dayTs(b.newDate)}, ${b.reason}, ${b.justification || null},
      ${b.approve ? 'aprobada' : 'propuesta'}, ${b.reopenUnits}, ${opts.proposedById ?? me},
      ${b.approve ? me : null}, ${b.approve ? sql`now()` : null})
    RETURNING id`)).rows[0] as { id: string };

  let reopened = 0;
  if (b.approve) {
    reopened = await applyToSchedule(tx, v, b.newDate, b.reopenUnits);
    await noteOnIncident(tx, b.incidentId ?? null, me, `Reprogramado del ${fmtDay(v.plannedDate)} al ${fmtDay(b.newDate)}. ${b.reason}${reopenedText(reopened)}`);
    await audit(req, 'schedule', v.id, 'reschedule', { before: { plannedDate: v.plannedDate }, after: { plannedDate: b.newDate, rescheduleId: row.id, reopened } }, tx);
  } else {
    await noteOnIncident(tx, b.incidentId ?? null, me, `Se propuso reprogramar del ${fmtDay(v.plannedDate)} al ${fmtDay(b.newDate)}. ${b.reason}`);
  }
  await audit(req, 'reschedule', row.id, b.approve ? 'create:aprobada' : 'create', { after: { ...b, fromDate: v.plannedDate } }, tx);
  return { id: row.id, status: b.approve ? 'aprobada' : 'propuesta', fromDate: v.plannedDate, toDate: b.newDate, reopened };
}

type Pending = { id: string; scheduleId: string; incidentId: string | null; toDate: string; reason: string; reopenUnits: boolean; status: string; projectId: string };

async function lockPending(tx: Tx, id: string) {
  const r = (await tx.execute(sql`
    SELECT r.id, r.schedule_id AS "scheduleId", r.incident_id AS "incidentId", to_char(r.to_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "toDate",
      r.reason, r.reopen_units AS "reopenUnits", r.status, sc.project_id AS "projectId"
    FROM reschedules r JOIN schedules sc ON sc.id = r.schedule_id WHERE r.id = ${id} FOR UPDATE OF r`)).rows[0] as Pending | undefined;
  if (!r) throw notFound('Reprogramación');
  if (r.status !== 'propuesta') throw conflict('Esta reprogramación ya fue decidida');
  return r;
}

export async function approveReschedule(tx: Tx, req: FastifyRequest, id: string, b: { newDate?: string; reopenUnits?: boolean; note?: string | null }) {
  const r = await lockPending(tx, id);
  const v = await lockVisit(tx, r.scheduleId);
  const newDate = b.newDate ?? r.toDate;
  const reopen = b.reopenUnits ?? r.reopenUnits;
  checkVisit(v, newDate);
  const reopened = await applyToSchedule(tx, v, newDate, reopen);
  // La fecha "anterior" es la vigente al aprobar (pudo cambiar desde la propuesta).
  await tx.execute(sql`
    UPDATE reschedules SET status = 'aprobada', from_date = ${dayTs(v.plannedDate)}, to_date = ${dayTs(newDate)}, reopen_units = ${reopen},
      approved_by_id = ${req.user.sub}, approved_at = now(), decision_notes = ${b.note || null}, updated_at = now()
    WHERE id = ${r.id}`);
  await noteOnIncident(tx, r.incidentId, req.user.sub,
    `Reprogramación aprobada: del ${fmtDay(v.plannedDate)} al ${fmtDay(newDate)}.${b.note ? ` ${b.note}` : ''}${reopenedText(reopened)}`);
  await audit(req, 'schedule', v.id, 'reschedule', { before: { plannedDate: v.plannedDate }, after: { plannedDate: newDate, rescheduleId: r.id, reopened } }, tx);
  await audit(req, 'reschedule', r.id, 'approve', { before: { toDate: r.toDate }, after: { toDate: newDate, reopenUnits: reopen, note: b.note ?? null } }, tx);
  return { ok: true, fromDate: v.plannedDate, toDate: newDate, reopened };
}

export async function rejectReschedule(tx: Tx, req: FastifyRequest, id: string, note: string) {
  const r = await lockPending(tx, id);
  await tx.execute(sql`
    UPDATE reschedules SET status = 'rechazada', approved_by_id = ${req.user.sub}, approved_at = now(), decision_notes = ${note}, updated_at = now()
    WHERE id = ${r.id}`);
  await noteOnIncident(tx, r.incidentId, req.user.sub, `Reprogramación rechazada: ${note}`);
  await audit(req, 'reschedule', r.id, 'reject', { after: { note } }, tx);
  return { ok: true };
}
