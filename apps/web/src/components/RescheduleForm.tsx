import { useMemo, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { INCIDENT_TYPE_LABELS, type IncidentType, type RescheduleOptionIncident } from '@toce/shared';
import { Dialog, ErrorBox } from './Dialog';
import { FilePicker, fileProblem } from './Attachments';

export const rescheduleDay = (d: string) =>
  new Date(`${d}T12:00:00-05:00`).toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'short', day: '2-digit', month: 'short' });
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
export const incidentTypeLabel = (t: string) => INCIDENT_TYPE_LABELS[t as IncidentType] ?? t;
const VISIT_STATUS: Record<string, string> = { planificada: 'Planificada', en_curso: 'En curso', no_realizada: 'No realizada', reprogramada: 'Reprogramada' };

/** Visita que se puede reprogramar. */
export type RescheduleVisit = {
  id: string; plannedDate: string; originalDate?: string; status: string; brigadeId?: string; brigadeName: string;
  stationId?: string; stationCode?: string; pending?: boolean;
};

export type RescheduleValues = {
  scheduleId: string; newDate: string; reason: string; justification: string | null; incidentId: string | null; reopenUnits: boolean; files: File[];
};

/**
 * Formulario único de reprogramación. Lo usan Reprogramaciones (diálogo: elige brigada, visita, alerta vinculada,
 * sustento y evidencias) y la ficha de una alerta (tarjeta: solo las visitas de esa alerta). Cada página decide a qué
 * endpoint enviar con `submit`; `approve` es true cuando quien aprueba registra y aprueba en un paso.
 */
export function RescheduleForm({
  variant, visits, brigades, incidents, incident, initialScheduleId, initialReason = '', approver, pendingNote, details,
  submit, onDone, onClose,
}: {
  variant: 'dialog' | 'card';
  visits: RescheduleVisit[];
  /** Filtro de brigada (solo si se pasa). */
  brigades?: { id: string; name: string }[];
  /** Alertas que se pueden vincular (solo si se pasa). */
  incidents?: RescheduleOptionIncident[];
  /** Alerta de origen (se muestra arriba y queda vinculada). */
  incident?: RescheduleOptionIncident;
  initialScheduleId?: string;
  initialReason?: string;
  approver: boolean;
  /** Aviso cuando la visita ya tiene una propuesta pendiente. */
  pendingNote?: ReactNode;
  /** Sustento y evidencias (lo guarda el endpoint de Reprogramaciones). */
  details?: boolean;
  submit: (v: RescheduleValues, approve: boolean) => Promise<unknown>;
  onDone: (result: unknown) => void;
  onClose?: () => void;
}) {
  const [brigadeId, setBrigadeId] = useState(incident?.brigadeId ?? '');
  const shown = useMemo(() => visits.filter((v) => !brigadeId || !v.brigadeId || v.brigadeId === brigadeId), [visits, brigadeId]);
  const [scheduleId, setScheduleId] = useState(() => initialScheduleId ?? shown.find((v) => !v.pending)?.id ?? '');
  const visit = visits.find((v) => v.id === scheduleId);
  const [incidentId, setIncidentId] = useState(incident?.id ?? '');
  const linkable = (incidents ?? []).filter((i) => !visit || (i.stationId === visit.stationId && (!i.brigadeId || i.brigadeId === visit.brigadeId)));
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState(initialReason);
  const [justification, setJustification] = useState('');
  const [reopen, setReopen] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const problem = details ? fileProblem(files) : null;
  const save = useMutation({
    mutationFn: (approve: boolean) => submit({
      scheduleId, newDate, reason, justification: justification || null, incidentId: incidentId || null, reopenUnits: reopen, files,
    }, approve),
    onSuccess: (r) => { setNewDate(''); setFiles([]); onDone(r); },
  });
  const ok = !!scheduleId && !visit?.pending && !!newDate && newDate !== visit?.plannedDate && reason.trim().length >= 3 && !problem;
  const primary = save.isPending ? 'Guardando…' : approver ? (variant === 'dialog' ? 'Aprobar y actualizar cronograma' : 'Reprogramar') : 'Enviar propuesta';

  const fields = (
    <>
      {incident && variant === 'dialog' && (
        <p className="hint" style={{ marginTop: 0 }}>
          Alerta: <strong>{incidentTypeLabel(incident.type)}</strong>{incident.stationCode ? ` en ${incident.stationCode}` : ''} · {incident.reportedByName} · {incident.description}
        </p>
      )}
      {pendingNote}
      <div className="grid-2">
        {brigades && (
          <label className="field">
            <span className="label">Brigada</span>
            <select className="input" value={brigadeId} onChange={(e) => { setBrigadeId(e.target.value); setScheduleId(''); }}>
              <option value="">Todas</option>
              {brigades.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span className="label">{brigades ? 'Visita' : 'Visita programada'}</span>
          <select className="input" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} required>
            {variant === 'dialog' && <option value="">Elige…</option>}
            {shown.map((v) => (
              <option key={v.id} value={v.id} disabled={v.pending}>
                {rescheduleDay(v.plannedDate)}{v.stationCode ? ` · ${v.stationCode}` : ''} · {v.brigadeName}
                {v.status !== 'planificada' ? ` · ${VISIT_STATUS[v.status] ?? v.status}` : ''}{v.pending ? ' · ya tiene propuesta' : ''}
              </option>
            ))}
          </select>
          {visit?.originalDate && visit.originalDate !== visit.plannedDate && <span className="hint">Fecha original del cronograma: {rescheduleDay(visit.originalDate)}</span>}
          {!shown.length && <span className="hint">No hay visitas por ejecutar{incident ? ' de esta alerta' : ''}.</span>}
        </label>
        <label className="field">
          <span className="label">Nueva fecha</span>
          <input className="input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} required />
        </label>
        {incidents && (
          <label className="field">
            <span className="label">Alerta vinculada (opcional)</span>
            <select className="input" value={incidentId} onChange={(e) => setIncidentId(e.target.value)}>
              <option value="">—</option>
              {linkable.map((i) => <option key={i.id} value={i.id}>{incidentTypeLabel(i.type)} · {i.stationCode ?? 'sin estación'} · {when(i.occurredAt)}</option>)}
            </select>
          </label>
        )}
      </div>
      <label className="field">
        <span className="label">Motivo</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} placeholder="Ej. Lluvia intensa, acceso bloqueado" required />
      </label>
      {details && (
        <label className="field">
          <span className="label">Sustento (opcional)</span>
          <textarea className="input" rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} maxLength={4000} placeholder="Por qué se elige la nueva fecha, coordinaciones realizadas, etc." />
        </label>
      )}
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
        <input type="checkbox" checked={reopen} onChange={(e) => setReopen(e.target.checked)} /> Al aprobar, volver a dejar pendientes las unidades no realizadas de la estación
      </label>
      {details && <FilePicker files={files} onChange={setFiles} />}
      {variant === 'card' && (
        <p className="hint" style={{ margin: 0 }}>
          {approver
            ? 'Se guarda la fecha original, la nueva, el motivo y quién aprobó. La brigada lo verá al actualizar su paquete de trabajo.'
            : 'Queda por aprobar: coordinación la revisa y, al aprobarla, se actualiza el cronograma.'}
        </p>
      )}
      <ErrorBox error={problem ? new Error(problem) : save.error} />
    </>
  );

  if (variant === 'dialog') {
    return (
      <Dialog
        title={approver ? 'Nueva reprogramación' : 'Proponer reprogramación'}
        wide
        onClose={onClose ?? (() => undefined)}
        onSubmit={() => ok && !save.isPending && save.mutate(approver)}
        footer={<>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          {approver && <button type="button" className="btn" disabled={!ok || save.isPending} onClick={() => save.mutate(false)}>Guardar como propuesta</button>}
          <button type="submit" className="btn btn-primary" disabled={!ok || save.isPending}>{primary}</button>
        </>}
      >
        {fields}
      </Dialog>
    );
  }
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="section-title" style={{ margin: 0 }}>{approver ? 'Reprogramar visita' : 'Proponer reprogramación'}</div>
      {fields}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-primary" disabled={!ok || save.isPending} onClick={() => save.mutate(approver)}>{primary}</button>
      </div>
    </div>
  );
}
