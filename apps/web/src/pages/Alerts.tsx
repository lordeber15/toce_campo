import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import {
  ADMIN_ROLES, INCIDENT_DECISION_LABELS, INCIDENT_MOMENT_LABELS, INCIDENT_ORIGIN_LABELS, INCIDENT_STATUS_LABELS, INCIDENT_STATUSES,
  COORDINATION_CHANNEL_LABELS, CRITICAL_MARKER_ROLES, INCIDENT_TYPE_LABELS, INCIDENT_TYPES, RESCHEDULE_APPROVER_ROLES, type IncidentCoordinationDto,
  type IncidentFollowUpDto,
  type IncidentDecision, type IncidentMessageKind, type IncidentMoment, type IncidentOrigin, type IncidentStatus, type IncidentType,
} from '@toce/shared';
import { api } from '../lib/api';
import { MediaViewer } from '../components/MediaViewer';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { ErrorBox, NoProject } from '../components/Dialog';
import { RescheduleForm } from '../components/RescheduleForm';

type Row = {
  id: string; type: IncidentType; moment: IncidentMoment | null; status: IncidentStatus; description: string; proposedAction: string | null;
  occurredAt: string; coordinationDecision: IncidentDecision | null; updatedAt: string; reportedBy: string; brigadeName: string | null;
  stationCode: string | null; methodCode: string | null; unitCode: string | null; files: number; messages: number; lastReplyAt: string | null;
  launchedFrom: IncidentOrigin | null; fieldResolved: boolean;
  isCritical: boolean; followUpOwnerName: string | null; followUpDueDate: string | null;
};
type Message = { id: string; authorId: string; authorName: string; body: string; kind: IncidentMessageKind; sentAt: string };
type FileRow = { id: string; kind: string; mimeType: string; takenAt: string; uploadStatus: string; durationSec: number | null };
type Detail = Row & {
  methodologicalDeviation: string | null; fieldCorrectiveAction: string | null; resolutionNotes: string | null; lat: number | null; lng: number | null; coordinationResponse: string | null; correctiveAction: string | null;
  resolvedAt: string | null; resolvedByName: string | null; reportedById: string; reporterPhone: string | null; stationId: string | null;
  influenceArea: string | null; vegetationUnit: string | null; methodName: string | null; unitStatus: string | null; scheduleId: string | null;
  messages: Message[]; files: FileRow[]; reschedules: { fromDate: string; toDate: string; reason: string; status: string; approvedByName: string | null }[];
  coordinations: IncidentCoordinationDto[];
  criticalReason: string | null; criticalAt: string | null; criticalByName: string | null; followUpOwnerId: string | null;
  followUps: IncidentFollowUpDto[]; assignees: { id: string; fullName: string }[];
  schedules: { id: string; plannedDate: string; status: string; brigadeName: string }[];
};

const STATUS_CHIP: Record<IncidentStatus, string> = {
  abierta: 'chip chip-off', en_revision: 'chip chip-warn', resuelta: 'chip chip-ok', rechazada: 'chip', cerrada: 'chip',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDate = (d: string) => d.split('-').reverse().join('/');

/** Quién origina la alerta: especialistas, supervisión o logística. */
type Origin = 'especialista' | 'supervision' | 'logistica';
const originOf = (o: IncidentOrigin | null): Origin => (o === 'supervision' ? 'supervision' : o === 'logistica' ? 'logistica' : 'especialista');
const ORIGIN_LABELS: Record<Origin, string> = { especialista: 'Especialistas', supervision: 'Supervisión', logistica: 'Logística' };
const statusLabel = (r: Pick<Row, 'status' | 'fieldResolved'>) => (r.fieldResolved ? 'Resuelta en campo' : INCIDENT_STATUS_LABELS[r.status]);

/** Bandeja de alertas de campo: revisar evidencias, conversar, responder y reprogramar. */
export function AlertsPage() {
  const { project } = useProject();
  const [status, setStatus] = useState<IncidentStatus | ''>('');
  const [type, setType] = useState<IncidentType | ''>('');
  const [origin, setOrigin] = useState<Origin | ''>('');
  const [selected, setSelected] = useState<string | null>(null);
  // ?critica=1: solo las alertas marcadas como críticas (enlace desde Avance).
  const [params, setParams] = useSearchParams();
  const critical = params.get('critica') === '1';
  const setCritical = (on: boolean) => { setParams(on ? { critica: '1' } : {}, { replace: true }); setSelected(null); };
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(type ? { type } : {}), ...(critical ? { critical: '1' } : {}) }).toString();
  const list = useQuery({
    queryKey: ['incidents', project?.id, qs],
    enabled: !!project,
    queryFn: () => api<Row[]>(`/projects/${project!.id}/incidents${qs ? `?${qs}` : ''}`),
    refetchInterval: 60_000,
  });
  const rows = (list.data ?? []).filter((r) => !origin || originOf(r.launchedFrom) === origin);
  useEffect(() => {
    if (!selected && rows.length) setSelected(rows[0]!.id);
  }, [rows, selected]);
  if (!project) return <NoProject />;
  const open = rows.filter((r) => r.status === 'abierta').length;
  const review = rows.filter((r) => r.status === 'en_revision').length;
  const criticalOpen = rows.filter((r) => r.isCritical && r.status !== 'cerrada').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alertas</h1>
          <p>Incidencias registradas en campo por las brigadas de {project.code}. Se actualiza cada minuto.</p>
        </div>
      </div>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', marginBottom: 16 }}>
        <div className="card stat"><div className="label">Abiertas</div><div className="value" style={{ color: open ? 'var(--danger)' : undefined }}>{open}</div></div>
        <div className="card stat"><div className="label">En revisión</div><div className="value">{review}</div></div>
        <button type="button" className="card stat" onClick={() => setCritical(!critical)} aria-pressed={critical}
          style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', outline: critical ? '2px solid var(--danger)' : undefined }}
          title={critical ? 'Ver todas las alertas' : 'Ver solo las críticas'}>
          <div className="label">Críticas sin cerrar</div>
          <div className="value" style={{ color: criticalOpen ? 'var(--danger)' : undefined }}>{criticalOpen}</div>
          <div className="hint">{critical ? 'Mostrando solo críticas' : 'Clic para filtrar'}</div>
        </button>
        <div className="card stat"><div className="label">Mostradas</div><div className="value">{rows.length}</div></div>
      </div>
      <div className="split" style={{ '--split-cols': 'minmax(300px, 420px) 1fr' } as React.CSSProperties}>
        <div className="card">
          <div className="toolbar">
            <select className="input" value={status} onChange={(e) => { setStatus(e.target.value as IncidentStatus | ''); setSelected(null); }} aria-label="Estado">
              <option value="">Todos los estados</option>
              {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{INCIDENT_STATUS_LABELS[s]}</option>)}
            </select>
            <select className="input" value={type} onChange={(e) => { setType(e.target.value as IncidentType | ''); setSelected(null); }} aria-label="Tipo">
              <option value="">Todos los tipos</option>
              {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_TYPE_LABELS[t]}</option>)}
            </select>
            <select className="input" value={origin} onChange={(e) => { setOrigin(e.target.value as Origin | ''); setSelected(null); }} aria-label="Origen">
              <option value="">Todo origen</option>
              {(Object.keys(ORIGIN_LABELS) as Origin[]).map((o) => <option key={o} value={o}>{ORIGIN_LABELS[o]}</option>)}
            </select>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} /> Solo críticas
            </label>
          </div>
          <div className="list scroll-y" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            {rows.map((r) => (
              <button key={r.id} className="list-item" aria-current={r.id === selected} onClick={() => setSelected(r.id)} style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {r.isCritical && <span className="chip chip-off" style={{ fontWeight: 700 }}>Crítica</span>}
                    <strong>{INCIDENT_TYPE_LABELS[r.type]}</strong>
                    <span className={STATUS_CHIP[r.status]}>{statusLabel(r)}</span>
                    {originOf(r.launchedFrom) !== 'especialista' && <span className="chip">{ORIGIN_LABELS[originOf(r.launchedFrom)]}</span>}
                    {r.lastReplyAt && r.status === 'en_revision' && <span className="chip chip-warn">Respondió</span>}
                  </div>
                  <small>{[r.stationCode, r.unitCode ?? r.methodCode, r.brigadeName].filter(Boolean).join(' · ') || 'Sin estación'}</small>
                  <small style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.description}</small>
                  <small>{r.reportedBy} · {when(r.occurredAt)}{r.files ? ` · ${r.files} evidencia${r.files > 1 ? 's' : ''}` : ''}</small>
                  {r.followUpOwnerName && <small>Responsable: {r.followUpOwnerName}{r.followUpDueDate ? ` · para el ${fmtDate(r.followUpDueDate)}` : ''}</small>}
                </div>
              </button>
            ))}
            {list.isSuccess && !rows.length && <div className="empty">No hay alertas{status || type || critical ? ' con estos filtros' : ''}.</div>}
          </div>
        </div>
        {selected ? <AlertDetail key={selected} id={selected} /> : <div className="card empty">Selecciona una alerta.</div>}
      </div>
    </>
  );
}

function AlertDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const admin = can(...ADMIN_ROLES);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['incident', id], queryFn: () => api<Detail>(`/incidents/${id}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['incident', id] });
    void qc.invalidateQueries({ queryKey: ['incidents'] });
  };
  if (q.isLoading) return <div className="card empty">Cargando…</div>;
  if (q.error || !q.data) return <div className="card" style={{ padding: 16 }}><ErrorBox error={q.error} /></div>;
  const d = q.data;
  const closed = d.status === 'cerrada';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ flex: 1, margin: 0 }}>{INCIDENT_TYPE_LABELS[d.type]}</h2>
          {d.isCritical && <span className="chip chip-off" style={{ fontWeight: 700 }}>Crítica</span>}
          <span className={STATUS_CHIP[d.status]}>{statusLabel(d)}</span>
        </div>
        <dl className="kv">
          <dt>Registrada por</dt><dd>{d.reportedBy}{d.reporterPhone ? ` · ${d.reporterPhone}` : ''}{d.launchedFrom ? ` · ${INCIDENT_ORIGIN_LABELS[d.launchedFrom]}` : ''}</dd>
          <dt>Fecha y hora</dt><dd>{when(d.occurredAt)}{d.moment ? ` · ${INCIDENT_MOMENT_LABELS[d.moment]}` : ''}</dd>
          <dt>Brigada</dt><dd>{d.brigadeName ?? '—'}</dd>
          <dt>Estación</dt><dd>{d.stationCode ? `${d.stationCode}${d.influenceArea ? ` · ${d.influenceArea}` : ''}${d.vegetationUnit ? ` · ${d.vegetationUnit}` : ''}` : '—'}</dd>
          <dt>Método / unidad</dt><dd>{[d.methodCode && `${d.methodCode} ${d.methodName ?? ''}`, d.unitCode && `${d.unitCode}${d.unitStatus === 'no_realizada' ? ' (no realizada)' : ''}`].filter(Boolean).join(' · ') || '—'}</dd>
          {d.lat != null && d.lng != null && <><dt>Ubicación</dt><dd>{d.lat.toFixed(5)}, {d.lng.toFixed(5)}</dd></>}
        </dl>
        <div>
          <div className="section-title">Situación</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.description}</p>
        </div>
        {d.proposedAction && (
          <div>
            <div className="section-title">Acción propuesta</div>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.proposedAction}</p>
          </div>
        )}
        {d.methodologicalDeviation && (
          <div>
            <div className="section-title">Desviación metodológica</div>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.methodologicalDeviation}</p>
          </div>
        )}
        {d.fieldCorrectiveAction && (
          <div>
            <div className="section-title">Acción correctiva aplicada en campo</div>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.fieldCorrectiveAction}</p>
          </div>
        )}
        {d.resolutionNotes && (
          <div className="card" style={{ padding: 12, background: 'var(--primary-soft)', boxShadow: 'none' }}>
            <div className="section-title" style={{ color: 'var(--primary)' }}>Cómo se resolvió en campo</div>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.resolutionNotes}</p>
            {d.fieldResolved && d.resolvedByName && <p className="hint" style={{ margin: '6px 0 0' }}>{d.resolvedByName}{d.resolvedAt ? `, ${when(d.resolvedAt)}` : ''}</p>}
          </div>
        )}
        {d.files.length > 0 && (
          <div>
            <div className="section-title">Evidencias ({d.files.length})</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {d.files.map((f) => <Evidence key={f.id} file={f} />)}
            </div>
          </div>
        )}
        {d.coordinationDecision && (
          <div className="card" style={{ padding: 12, background: 'var(--surface-2)', boxShadow: 'none' }}>
            <strong>{INCIDENT_DECISION_LABELS[d.coordinationDecision]}</strong>
            {d.resolvedByName && <span className="hint"> · {d.resolvedByName}{d.resolvedAt ? `, ${when(d.resolvedAt)}` : ''}</span>}
            <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{d.coordinationResponse}</p>
            {d.correctiveAction && <p style={{ margin: '6px 0 0' }}><span className="hint">Acción correctiva:</span> {d.correctiveAction}</p>}
          </div>
        )}
        {d.reschedules.length > 0 && (
          <div>
            <div className="section-title">Reprogramaciones</div>
            {d.reschedules.map((r, i) => (
              <p key={i} style={{ margin: '4px 0' }}>
                {fmtDate(r.fromDate)} → <strong>{fmtDate(r.toDate)}</strong> · {r.reason}
                {r.status === 'propuesta' ? <span className="chip chip-warn" style={{ marginLeft: 6 }}>Por aprobar</span>
                  : r.status === 'rechazada' ? <span className="chip" style={{ marginLeft: 6 }}>Rechazada{r.approvedByName ? ` por ${r.approvedByName}` : ''}</span>
                    : r.approvedByName ? ` (aprobó ${r.approvedByName})` : ''}
              </p>
            ))}
            <Link to="/reprogramaciones" className="hint">Ver en Reprogramaciones</Link>
          </div>
        )}
      </div>

      {d.coordinations.length > 0 && (
        <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="section-title" style={{ margin: 0 }}>Coordinaciones en campo ({d.coordinations.length})</div>
          {d.coordinations.map((c) => (
            <div key={c.id} style={{ borderLeft: '3px solid var(--primary)', paddingLeft: 10 }}>
              <div className="hint" style={{ fontSize: 12 }}>{when(c.occurredAt)} · {COORDINATION_CHANNEL_LABELS[c.channel] ?? c.channel} · registró {c.authorName}</div>
              <strong>Con {c.withWhom}</strong>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.agreement}</div>
            </div>
          ))}
        </div>
      )}

      <FollowUp detail={d} onDone={refresh} closed={closed} />
      <Thread detail={d} onSent={refresh} disabled={closed} />
      {admin && !closed && <DecisionForm detail={d} onDone={refresh} />}
      {admin && !closed && d.schedules.length > 0 && <IncidentReschedule key={d.id} detail={d} onDone={refresh} />}
      {admin && (d.status === 'resuelta' || d.status === 'rechazada') && <CloseButton id={d.id} onDone={refresh} />}
    </div>
  );
}

function Evidence({ file }: { file: FileRow }) {
  const [open, setOpen] = useState(false);
  const load = () => api<{ url: string }>(`/field/attachments/${file.id}/url`).then((r) => r.url);
  const url = useQuery({
    queryKey: ['file-url', file.id],
    enabled: file.uploadStatus === 'subido',
    queryFn: () => api<{ url: string }>(`/field/attachments/${file.id}/url`),
    staleTime: 10 * 60_000,
  });
  if (file.uploadStatus !== 'subido') return <div className="card empty" style={{ width: 160, padding: 16, fontSize: 13 }}>Archivo aún en el teléfono (se sube con conexión)</div>;
  if (!url.data) return <div className="card" style={{ width: 160, height: 120 }} />;
  if (file.mimeType.startsWith('audio/')) return <audio controls src={url.data.url} style={{ width: 260 }} />;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Ver en tamaño completo" style={{ padding: 0, border: 0, background: 'none', cursor: 'zoom-in' }}>
        <img src={url.data.url} alt={`Evidencia ${when(file.takenAt)}`} style={{ width: 200, height: 150, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} />
      </button>
      {open && <MediaViewer title={`Evidencia · ${when(file.takenAt)}`} kind="foto" mimeType={file.mimeType} queryKey={['incident-file', file.id]} load={load} onClose={() => setOpen(false)} />}
    </>
  );
}

function Thread({ detail, onSent, disabled }: { detail: Detail; onSent: () => void; disabled: boolean }) {
  const [body, setBody] = useState('');
  const [ask, setAsk] = useState(false);
  const send = useMutation({
    mutationFn: () => api(`/incidents/${detail.id}/messages`, { method: 'POST', body: JSON.stringify({ body, kind: ask ? 'solicitud_info' : 'comentario' }) }),
    onSuccess: () => { setBody(''); setAsk(false); onSent(); },
  });
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="section-title" style={{ margin: 0 }}>Conversación ({detail.messages.length})</div>
      {detail.messages.map((m) => {
        const field = m.authorId === detail.reportedById;
        return (
          <div key={m.id} style={{ alignSelf: field ? 'flex-start' : 'flex-end', maxWidth: '85%', background: field ? 'var(--surface-2)' : 'var(--primary-soft)', borderRadius: 10, padding: '8px 12px' }}>
            <div className="hint" style={{ fontSize: 12 }}>
              {m.authorName} · {when(m.sentAt)}{m.kind === 'solicitud_info' ? ' · pide información' : m.kind === 'decision' ? ' · decisión' : ''}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
          </div>
        );
      })}
      {!detail.messages.length && <span className="hint">Sin mensajes. Lo que escribas aquí le llega al especialista cuando su teléfono se conecte.</span>}
      {!disabled && (
        <>
          <textarea className="input" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escribe un mensaje o registra una llamada (“Llamé al jefe de brigada: …”)" />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
              <input type="checkbox" checked={ask} onChange={(e) => setAsk(e.target.checked)} /> Pedir más información
            </label>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" disabled={!body.trim() || send.isPending} onClick={() => send.mutate()}>Enviar</button>
          </div>
          <ErrorBox error={send.error} />
        </>
      )}
    </div>
  );
}

function DecisionForm({ detail, onDone }: { detail: Detail; onDone: () => void }) {
  const [decision, setDecision] = useState<IncidentDecision>('aprobada');
  const [response, setResponse] = useState('');
  const [corrective, setCorrective] = useState(detail.correctiveAction ?? '');
  const save = useMutation({
    mutationFn: () => api(`/incidents/${detail.id}/decision`, { method: 'POST', body: JSON.stringify({ decision, response, correctiveAction: corrective || null }) }),
    onSuccess: () => { setResponse(''); onDone(); },
  });
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="section-title" style={{ margin: 0 }}>Respuesta de coordinación</div>
      <div className="segmented" role="group" aria-label="Decisión">
        {(['aprobada', 'rechazada', 'info_adicional'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={decision === k} onClick={() => setDecision(k)}>{INCIDENT_DECISION_LABELS[k]}</button>
        ))}
      </div>
      <textarea className="input" rows={3} value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Instrucciones para la brigada (p. ej. “Se aprueba ajustar el esfuerzo a 3 unidades”)" />
      {decision !== 'info_adicional' && (
        <input className="input" value={corrective} onChange={(e) => setCorrective(e.target.value)} placeholder="Acción correctiva (opcional)" />
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={response.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>Registrar respuesta</button>
      </div>
      <ErrorBox error={save.error} />
    </div>
  );
}

/** Reprogramar desde la alerta: mismo formulario que Reprogramaciones, limitado a las visitas de la alerta. */
function IncidentReschedule({ detail, onDone }: { detail: Detail; onDone: () => void }) {
  const { can } = useAuth();
  // El supervisor propone; coordinación o la jefatura aprueban (en ese caso se aplica en el acto).
  const approver = can(...RESCHEDULE_APPROVER_ROLES);
  const pending = detail.reschedules.some((r) => r.status === 'propuesta');
  const initial = detail.schedules.find((s) => s.id === detail.scheduleId) ?? detail.schedules[0]!;
  return (
    <RescheduleForm
      variant="card"
      visits={detail.schedules}
      initialScheduleId={initial.id}
      initialReason={detail.type === 'lluvia_intensa' ? 'Lluvia intensa' : ''}
      approver={approver}
      pendingNote={pending && <p className="hint" style={{ margin: 0 }}>Ya hay una propuesta por aprobar; se revisa en Reprogramaciones.</p>}
      submit={(v) => api<{ reopened: number }>(`/incidents/${detail.id}/reschedule`, {
        method: 'POST', body: JSON.stringify({ scheduleId: v.scheduleId, newDate: v.newDate, reason: v.reason, reopenUnits: v.reopenUnits }),
      })}
      onDone={onDone}
    />
  );
}

function CloseButton({ id, onDone }: { id: string; onDone: () => void }) {
  const close = useMutation({ mutationFn: () => api(`/incidents/${id}/close`, { method: 'POST', body: '{}' }), onSuccess: onDone });
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <button className="btn" onClick={() => confirm('¿Cerrar la alerta? Ya no se podrá responder.') && close.mutate()}>Cerrar alerta</button>
    </div>
  );
}

/** Jefe de proyecto / coordinación: alerta crítica, responsable del seguimiento y notas de avance hasta el cierre. */
function FollowUp({ detail: d, onDone, closed }: { detail: Detail; onDone: () => void; closed: boolean }) {
  const { can } = useAuth();
  const marker = can(...CRITICAL_MARKER_ROLES);
  const [reason, setReason] = useState('');
  const [marking, setMarking] = useState(false);
  const [ownerId, setOwnerId] = useState(d.followUpOwnerId ?? '');
  const [dueDate, setDueDate] = useState(d.followUpDueDate ?? '');
  const [note, setNote] = useState('');
  const mark = useMutation({
    mutationFn: (critical: boolean) => api(`/incidents/${d.id}/critical`, { method: 'POST', body: JSON.stringify({ critical, reason: critical ? reason : null }) }),
    onSuccess: () => { setReason(''); setMarking(false); onDone(); },
  });
  const assign = useMutation({
    mutationFn: () => api(`/incidents/${d.id}/follow-up`, { method: 'PUT', body: JSON.stringify({ ownerId: ownerId || null, dueDate: dueDate || null }) }),
    onSuccess: onDone,
  });
  const addNote = useMutation({
    mutationFn: () => api(`/incidents/${d.id}/follow-ups`, { method: 'POST', body: JSON.stringify({ body: note }) }),
    onSuccess: () => { setNote(''); onDone(); },
  });
  const ownerChanged = ownerId !== (d.followUpOwnerId ?? '') || dueDate !== (d.followUpDueDate ?? '');
  // Sin marca crítica ni seguimiento, solo quien puede marcar ve esta sección.
  if (!marker && !d.isCritical && !d.followUpOwnerName && !d.followUps.length) return null;

  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, borderLeft: d.isCritical ? '4px solid var(--danger)' : undefined }}>
      <div className="section-title" style={{ margin: 0 }}>Seguimiento{d.isCritical ? ' de alerta crítica' : ''}</div>

      {d.isCritical ? (
        <div>
          <strong style={{ color: 'var(--danger)' }}>Crítica</strong>
          <span className="hint"> · marcó {d.criticalByName ?? '—'}{d.criticalAt ? `, ${when(d.criticalAt)}` : ''}</span>
          {d.criticalReason && <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{d.criticalReason}</p>}
          {marker && !closed && (
            <button className="btn btn-sm" style={{ marginTop: 8 }} disabled={mark.isPending}
              onClick={() => confirm('¿Quitar la marca de crítica? Queda registrado quién lo hizo.') && mark.mutate(false)}>Quitar marca crítica</button>
          )}
        </div>
      ) : marker && !closed && (
        marking ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="¿Por qué es crítica? (p. ej. “Riesgo de perder la campaña en la estación”)" autoFocus />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" onClick={() => setMarking(false)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" disabled={reason.trim().length < 3 || mark.isPending} onClick={() => mark.mutate(true)}>Marcar como crítica</button>
            </div>
          </div>
        ) : (
          <div><button className="btn btn-sm" onClick={() => setMarking(true)}>Marcar como crítica</button></div>
        )
      )}
      <ErrorBox error={mark.error} />

      <div className="grid-2">
        <label className="field">
          <span className="label">Responsable del seguimiento</span>
          {marker && !closed ? (
            <select className="input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Sin asignar</option>
              {d.assignees.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
          ) : <span>{d.followUpOwnerName ?? 'Sin asignar'}</span>}
        </label>
        <label className="field">
          <span className="label">Fecha comprometida</span>
          {marker && !closed ? (
            <input className="input" type="date" value={dueDate} disabled={!ownerId} onChange={(e) => setDueDate(e.target.value)} />
          ) : <span>{d.followUpDueDate ? fmtDate(d.followUpDueDate) : '—'}</span>}
        </label>
      </div>
      {marker && !closed && ownerChanged && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary btn-sm" disabled={assign.isPending} onClick={() => assign.mutate()}>Guardar responsable</button>
        </div>
      )}
      <ErrorBox error={assign.error} />

      <div className="section-title" style={{ margin: '4px 0 0' }}>Avances ({d.followUps.length})</div>
      {d.followUps.map((f) => (
        <div key={f.id} style={{ borderLeft: '3px solid var(--border)', paddingLeft: 10 }}>
          <div className="hint" style={{ fontSize: 12 }}>{when(f.createdAt)} · {f.authorName}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{f.body}</div>
        </div>
      ))}
      {!d.followUps.length && <span className="hint">Sin avances registrados. Son notas internas: no llegan al teléfono.</span>}
      {!closed && (
        <>
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Registra el avance (p. ej. “Se coordinó con logística el cambio de vehículo”)" />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-sm" disabled={note.trim().length < 3 || addNote.isPending} onClick={() => addNote.mutate()}>Registrar avance</button>
          </div>
          <ErrorBox error={addNote.error} />
        </>
      )}
    </div>
  );
}
