import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  INCIDENT_STATUS_LABELS, RESCHEDULE_APPROVER_ROLES, RESCHEDULE_STATUS_LABELS, RESCHEDULE_STATUSES,
  type IncidentStatus, type RescheduleDetail, type RescheduleOptionIncident, type RescheduleOptions, type RescheduleRow, type RescheduleStatus,
} from '@toce/shared';
import { api } from '../lib/api';
import { FileLink, FilePicker, fileProblem, uploadFiles } from '../components/Attachments';
import { BrigadeSelect } from '../components/Filters';
import { RescheduleForm, incidentTypeLabel, rescheduleDay } from '../components/RescheduleForm';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { ErrorBox, NoProject } from '../components/Dialog';

const STATUS_CHIP: Record<RescheduleStatus, string> = { propuesta: 'chip chip-warn', aprobada: 'chip chip-ok', rechazada: 'chip' };
const day = rescheduleDay;
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const VISIT_STATUS: Record<string, string> = { planificada: 'Planificada', en_curso: 'En curso', no_realizada: 'No realizada', reprogramada: 'Reprogramada' };
const incType = incidentTypeLabel;
const uploadUrl = (rescheduleId: string) => (f: File) => `/reschedules/${rescheduleId}/files?name=${encodeURIComponent(f.name)}`;
type Draft = { incident?: RescheduleOptionIncident };

/** Reprogramaciones (5.5): propuestas, aprobación por coordinación, evidencias e historial de cada visita. */
export function ReschedulesPage() {
  const { project } = useProject();
  const { can } = useAuth();
  const approver = can(...RESCHEDULE_APPROVER_ROLES);
  const [status, setStatus] = useState<RescheduleStatus | ''>('');
  const [brigadeId, setBrigadeId] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(brigadeId ? { brigadeId } : {}), ...(q ? { q } : {}) }).toString();
  const list = useQuery({
    queryKey: ['reschedules', project?.id, qs],
    enabled: !!project,
    queryFn: () => api<RescheduleRow[]>(`/projects/${project!.id}/reschedules${qs ? `?${qs}` : ''}`),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const options = useQuery({
    queryKey: ['reschedule-options', project?.id],
    enabled: !!project,
    queryFn: () => api<RescheduleOptions>(`/projects/${project!.id}/reschedules/options`),
  });
  const rows = list.data ?? [];
  useEffect(() => {
    if (!selected && rows.length) setSelected(rows[0]!.id);
  }, [rows, selected]);
  if (!project) return <NoProject />;
  const requests = options.data?.incidents.filter((i) => i.needsReschedule) ?? [];
  const pending = rows.filter((r) => r.status === 'propuesta').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reprogramaciones</h1>
          <p>
            Cambios de fecha de las visitas de {project.code}: {approver ? 'revisa las propuestas, decide la nueva fecha y aprueba' : 'propón una nueva fecha para que coordinación la apruebe'}.
            El cronograma y los paquetes de trabajo se actualizan al aprobar.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setDraft({})} disabled={!options.data}>{approver ? 'Nueva reprogramación' : 'Proponer reprogramación'}</button>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', marginBottom: 16 }}>
        <div className="card stat"><div className="label">Por aprobar</div><div className="value" style={{ color: pending ? 'var(--warn)' : undefined }}>{pending}</div></div>
        <div className="card stat"><div className="label">Pedidos desde campo</div><div className="value" style={{ color: requests.length ? 'var(--warn)' : undefined }}>{requests.length}</div></div>
        <div className="card stat"><div className="label">Aprobadas</div><div className="value">{rows.filter((r) => r.status === 'aprobada').length}</div></div>
        <div className="card stat"><div className="label">Rechazadas</div><div className="value">{rows.filter((r) => r.status === 'rechazada').length}</div></div>
      </div>

      {requests.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Alertas que piden reprogramar</div>
          <div className="list">
            {requests.map((i) => (
              <div key={i.id} className="list-item" style={{ alignItems: 'center' }}>
                <div className="grow">
                  <strong>{incType(i.type)}</strong>{i.stationCode ? ` · ${i.stationCode}` : ''}
                  <small style={{ display: 'block' }}>{i.reportedByName} · {when(i.occurredAt)} · {i.description}</small>
                </div>
                <button className="btn btn-sm" onClick={() => setDraft({ incident: i })}>{approver ? 'Reprogramar' : 'Proponer'}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="split" style={{ '--split-cols': 'minmax(300px, 420px) 1fr' } as React.CSSProperties}>
        <div className="card">
          <div className="toolbar" style={{ flexWrap: 'wrap' }}>
            <select className="input" value={status} onChange={(e) => { setStatus(e.target.value as RescheduleStatus | ''); setSelected(null); }} aria-label="Estado">
              <option value="">Todos los estados</option>
              {RESCHEDULE_STATUSES.map((s) => <option key={s} value={s}>{RESCHEDULE_STATUS_LABELS[s]}</option>)}
            </select>
            <BrigadeSelect value={brigadeId} onChange={(v) => { setBrigadeId(v); setSelected(null); }} brigades={options.data?.brigades ?? []} />
            <input className="input" type="search" value={text} onChange={(e) => { setText(e.target.value); setSelected(null); }} placeholder="Buscar estación, brigada, motivo o persona" aria-label="Buscar" />
          </div>
          <div className="list scroll-y" style={{ maxHeight: 'calc(100vh - 300px)', opacity: list.isPlaceholderData ? 0.6 : 1 }}>
            {rows.map((r) => (
              <button key={r.id} className="list-item" aria-current={r.id === selected} onClick={() => setSelected(r.id)} style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{r.stationCode}</strong>
                    <span>{day(r.fromDate)} → {day(r.toDate)}</span>
                    <span className={STATUS_CHIP[r.status]}>{RESCHEDULE_STATUS_LABELS[r.status]}</span>
                  </div>
                  <small>{r.brigadeName} · {r.reason}</small>
                  <small>
                    {r.status === 'propuesta' ? `Propuso ${r.proposedByName ?? '—'} · ${when(r.createdAt)}` : `${r.status === 'aprobada' ? 'Aprobó' : 'Rechazó'} ${r.decidedByName ?? '—'}${r.decidedAt ? ` · ${when(r.decidedAt)}` : ''}`}
                    {r.files ? ` · ${r.files} evidencia${r.files === 1 ? '' : 's'}` : ''}
                  </small>
                </div>
              </button>
            ))}
            {list.isSuccess && !rows.length && <div className="empty">No hay reprogramaciones{status || brigadeId || q ? ' con estos filtros' : ''}.</div>}
          </div>
          <ErrorBox error={list.error} />
        </div>
        {selected ? <RescheduleView id={selected} approver={approver} /> : <div className="card empty">Selecciona una reprogramación.</div>}
      </div>

      {draft && options.data && (
        <NewRescheduleDialog
          projectId={project.id}
          options={options.data}
          incident={draft.incident}
          approver={approver}
          onClose={() => setDraft(null)}
          onCreated={(id) => { setDraft(null); setSelected(id); }}
        />
      )}
    </>
  );
}

/** Alta de una reprogramación desde esta página (con brigada, alerta vinculada, sustento y evidencias). */
function NewRescheduleDialog({ projectId, options, incident, approver, onClose, onCreated }: {
  projectId: string; options: RescheduleOptions; incident?: RescheduleOptionIncident; approver: boolean;
  onClose: () => void; onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  // Con una alerta: sus visitas (misma estación y, si la tiene, misma brigada).
  const visits = options.visits.filter((v) => !incident || (v.stationId === incident.stationId && (!incident.brigadeId || v.brigadeId === incident.brigadeId)));
  return (
    <RescheduleForm
      variant="dialog"
      visits={visits}
      brigades={options.brigades}
      incidents={options.incidents}
      incident={incident}
      initialReason={incident?.type === 'lluvia_intensa' ? 'Lluvia intensa' : incident ? incType(incident.type) : ''}
      approver={approver}
      details
      onClose={onClose}
      submit={async (v, approve) => {
        const r = await api<{ id: string }>(`/projects/${projectId}/reschedules`, {
          method: 'POST',
          body: JSON.stringify({ scheduleId: v.scheduleId, newDate: v.newDate, reason: v.reason, justification: v.justification, incidentId: v.incidentId, reopenUnits: v.reopenUnits, approve }),
        });
        await uploadFiles(uploadUrl(r.id), v.files);
        return r;
      }}
      onDone={(r) => {
        void qc.invalidateQueries({ queryKey: ['reschedules'] });
        void qc.invalidateQueries({ queryKey: ['reschedule-options'] });
        onCreated((r as { id: string }).id);
      }}
    />
  );
}

function RescheduleView({ id, approver }: { id: string; approver: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['reschedule', id], queryFn: () => api<RescheduleDetail>(`/reschedules/${id}`), refetchInterval: 60_000 });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['reschedule', id] });
    void qc.invalidateQueries({ queryKey: ['reschedules'] });
    void qc.invalidateQueries({ queryKey: ['reschedule-options'] });
  };
  const [files, setFiles] = useState<File[]>([]);
  const problem = fileProblem(files);
  const upload = useMutation({ mutationFn: () => uploadFiles(uploadUrl(id), files), onSuccess: () => { setFiles([]); refresh(); } });
  if (q.isLoading) return <div className="card empty">Cargando…</div>;
  if (q.error || !q.data) return <div className="card" style={{ padding: 16 }}><ErrorBox error={q.error} /></div>;
  const d = q.data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ flex: 1, margin: 0 }}>{d.stationCode} · {d.brigadeName}</h2>
          <span className={STATUS_CHIP[d.status]}>{RESCHEDULE_STATUS_LABELS[d.status]}</span>
        </div>
        <dl className="kv">
          <dt>Fecha original</dt><dd>{day(d.originalDate)}</dd>
          {d.fromDate !== d.originalDate && <><dt>Fecha anterior</dt><dd>{day(d.fromDate)}</dd></>}
          <dt>{d.status === 'propuesta' ? 'Fecha propuesta' : 'Fecha reprogramada'}</dt><dd><strong>{day(d.toDate)}</strong></dd>
          <dt>Fecha vigente</dt><dd>{day(d.currentDate)}{d.scheduleStatus !== 'planificada' ? ` · ${VISIT_STATUS[d.scheduleStatus] ?? d.scheduleStatus}` : ''}</dd>
          <dt>Motivo</dt><dd>{d.reason}</dd>
          <dt>Sustento</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{d.justification || '—'}</dd>
          <dt>Propuso</dt><dd>{d.proposedByName ?? '—'} · {when(d.createdAt)}</dd>
          {d.status !== 'propuesta' && <><dt>{d.status === 'aprobada' ? 'Aprobó' : 'Rechazó'}</dt><dd>{d.decidedByName ?? '—'}{d.decidedAt ? ` · ${when(d.decidedAt)}` : ''}</dd></>}
          {d.decisionNotes && <><dt>Nota de la decisión</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{d.decisionNotes}</dd></>}
          <dt>Unidades no realizadas</dt><dd>{d.reopenUnits ? 'Vuelven a pendiente al aprobar' : 'Se mantienen'}</dd>
          {d.incidentId && (
            <>
              <dt>Alerta</dt>
              <dd>
                {incType(d.incidentType ?? '')}{d.incidentStatus ? ` · ${INCIDENT_STATUS_LABELS[d.incidentStatus as IncidentStatus] ?? d.incidentStatus}` : ''}
                {d.incidentDescription ? ` · ${d.incidentDescription}` : ''} · <Link to="/alertas">ver alertas</Link>
              </dd>
            </>
          )}
        </dl>
      </div>

      {d.status === 'propuesta' && approver && <DecisionBox detail={d} onDone={refresh} />}
      {d.status === 'propuesta' && !approver && <div className="card" style={{ padding: 14 }}><span className="hint">Esperando la aprobación de coordinación.</span></div>}

      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="section-title" style={{ margin: 0 }}>Evidencias ({d.fileList.length})</div>
        {d.fileList.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{d.fileList.map((f) => <FileLink key={f.id} file={f} endpoint="/reschedule-files/" />)}</div>}
        <FilePicker files={files} onChange={setFiles} label="Agregar evidencias" />
        {files.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-sm" disabled={!!problem || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? 'Subiendo…' : 'Subir'}</button>
          </div>
        )}
        <ErrorBox error={problem ? new Error(problem) : upload.error} />
      </div>

      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="section-title" style={{ margin: 0 }}>Historial de la visita</div>
        <div className="table-wrap">
        <table>
          <thead><tr><th>Registrada</th><th>Cambio</th><th>Motivo</th><th>Estado</th><th>Decidió</th></tr></thead>
          <tbody>
            {d.visitHistory.map((h) => (
              <tr key={h.id} style={h.id === d.id ? { background: 'var(--primary-soft)' } : undefined}>
                <td>{when(h.createdAt)}</td>
                <td>{day(h.fromDate)} → {day(h.toDate)}</td>
                <td className="wrap">{h.reason}</td>
                <td><span className={STATUS_CHIP[h.status]}>{RESCHEDULE_STATUS_LABELS[h.status]}</span></td>
                <td>{h.decidedByName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="section-title" style={{ marginBottom: 0 }}>Registro de cambios</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {d.log.map((l, i) => (
            <li key={i}><span className="hint">{when(l.at)}</span> · <strong>{l.action}</strong>{l.userName ? ` · ${l.userName}` : ''}{l.detail ? ` · ${l.detail}` : ''}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DecisionBox({ detail, onDone }: { detail: RescheduleDetail; onDone: () => void }) {
  const [newDate, setNewDate] = useState(detail.toDate);
  const [reopen, setReopen] = useState(detail.reopenUnits);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (action: 'approve' | 'reject') =>
      api(`/reschedules/${detail.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'approve' ? { newDate, reopenUnits: reopen, note: note || null } : { note }),
      }),
    onSuccess: onDone,
  });
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="section-title" style={{ margin: 0 }}>Decisión</div>
      <div className="grid-2">
        <label className="field">
          <span className="label">Nueva fecha</span>
          <input className="input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          {newDate !== detail.toDate && <span className="hint">Se cambia la fecha propuesta ({day(detail.toDate)}).</span>}
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, alignSelf: 'end', paddingBottom: 8 }}>
          <input type="checkbox" checked={reopen} onChange={(e) => setReopen(e.target.checked)} /> Volver a dejar pendientes las unidades no realizadas
        </label>
      </div>
      <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} placeholder="Sustento de la decisión (obligatorio para rechazar)" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" disabled={note.trim().length < 3 || decide.isPending} onClick={() => decide.mutate('reject')}>Rechazar</button>
        <button className="btn btn-primary" disabled={!newDate || newDate === detail.currentDate || decide.isPending} onClick={() => decide.mutate('approve')}>
          {decide.isPending ? 'Guardando…' : 'Aprobar y actualizar cronograma'}
        </button>
      </div>
      <ErrorBox error={decide.error} />
    </div>
  );
}
