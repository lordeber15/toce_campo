import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ADMIN_ROLES, INCIDENT_DECISION_LABELS, INCIDENT_MOMENT_LABELS, INCIDENT_ORIGIN_LABELS, INCIDENT_STATUS_LABELS, INCIDENT_STATUSES,
  INCIDENT_TYPE_LABELS, INCIDENT_TYPES,
  type IncidentDecision, type IncidentMessageKind, type IncidentMoment, type IncidentOrigin, type IncidentStatus, type IncidentType,
} from '@toce/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { ErrorBox, NoProject } from '../components/Dialog';

type Row = {
  id: string; type: IncidentType; moment: IncidentMoment | null; status: IncidentStatus; description: string; proposedAction: string | null;
  occurredAt: string; coordinationDecision: IncidentDecision | null; updatedAt: string; reportedBy: string; brigadeName: string | null;
  stationCode: string | null; methodCode: string | null; unitCode: string | null; files: number; messages: number; lastReplyAt: string | null;
  launchedFrom: IncidentOrigin | null; fieldResolved: boolean;
};
type Message = { id: string; authorId: string; authorName: string; body: string; kind: IncidentMessageKind; sentAt: string };
type FileRow = { id: string; kind: string; mimeType: string; takenAt: string; uploadStatus: string; durationSec: number | null };
type Detail = Row & {
  methodologicalDeviation: string | null; fieldCorrectiveAction: string | null; resolutionNotes: string | null; lat: number | null; lng: number | null; coordinationResponse: string | null; correctiveAction: string | null;
  resolvedAt: string | null; resolvedByName: string | null; reportedById: string; reporterPhone: string | null; stationId: string | null;
  influenceArea: string | null; vegetationUnit: string | null; methodName: string | null; unitStatus: string | null; scheduleId: string | null;
  messages: Message[]; files: FileRow[]; reschedules: { fromDate: string; toDate: string; reason: string; approvedByName: string | null }[];
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
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(type ? { type } : {}) }).toString();
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
        <div className="card stat"><div className="label">Mostradas</div><div className="value">{rows.length}</div></div>
      </div>
      <div className="split" style={{ gridTemplateColumns: 'minmax(300px, 420px) 1fr' }}>
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
          </div>
          <div className="list scroll-y" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            {rows.map((r) => (
              <button key={r.id} className="list-item" aria-current={r.id === selected} onClick={() => setSelected(r.id)} style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{INCIDENT_TYPE_LABELS[r.type]}</strong>
                    <span className={STATUS_CHIP[r.status]}>{statusLabel(r)}</span>
                    {originOf(r.launchedFrom) !== 'especialista' && <span className="chip">{ORIGIN_LABELS[originOf(r.launchedFrom)]}</span>}
                    {r.lastReplyAt && r.status === 'en_revision' && <span className="chip chip-warn">Respondió</span>}
                  </div>
                  <small>{[r.stationCode, r.unitCode ?? r.methodCode, r.brigadeName].filter(Boolean).join(' · ') || 'Sin estación'}</small>
                  <small style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.description}</small>
                  <small>{r.reportedBy} · {when(r.occurredAt)}{r.files ? ` · ${r.files} evidencia${r.files > 1 ? 's' : ''}` : ''}</small>
                </div>
              </button>
            ))}
            {list.isSuccess && !rows.length && <div className="empty">No hay alertas{status || type ? ' con estos filtros' : ''}.</div>}
          </div>
        </div>
        {selected ? <AlertDetail id={selected} /> : <div className="card empty">Selecciona una alerta.</div>}
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
              <p key={i} style={{ margin: '4px 0' }}>{fmtDate(r.fromDate)} → <strong>{fmtDate(r.toDate)}</strong> · {r.reason}{r.approvedByName ? ` (aprobó ${r.approvedByName})` : ''}</p>
            ))}
          </div>
        )}
      </div>

      <Thread detail={d} onSent={refresh} disabled={closed} />
      {admin && !closed && <DecisionForm detail={d} onDone={refresh} />}
      {admin && !closed && d.schedules.length > 0 && <RescheduleForm detail={d} onDone={refresh} />}
      {admin && (d.status === 'resuelta' || d.status === 'rechazada') && <CloseButton id={d.id} onDone={refresh} />}
    </div>
  );
}

function Evidence({ file }: { file: FileRow }) {
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
    <a href={url.data.url} target="_blank" rel="noreferrer" title="Ver en tamaño completo">
      <img src={url.data.url} alt={`Evidencia ${when(file.takenAt)}`} style={{ width: 200, height: 150, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
    </a>
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

function RescheduleForm({ detail, onDone }: { detail: Detail; onDone: () => void }) {
  const initial = detail.schedules.find((s) => s.id === detail.scheduleId) ?? detail.schedules[0]!;
  const [scheduleId, setScheduleId] = useState(initial.id);
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState(detail.type === 'lluvia_intensa' ? 'Lluvia intensa' : '');
  const [reopen, setReopen] = useState(true);
  const save = useMutation({
    mutationFn: () => api<{ reopened: number }>(`/incidents/${detail.id}/reschedule`, { method: 'POST', body: JSON.stringify({ scheduleId, newDate, reason, reopenUnits: reopen }) }),
    onSuccess: () => { setNewDate(''); onDone(); },
  });
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="section-title" style={{ margin: 0 }}>Reprogramar visita</div>
      <div className="grid-2">
        <label className="field">
          <span className="label">Visita programada</span>
          <select className="input" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
            {detail.schedules.map((s) => <option key={s.id} value={s.id}>{fmtDate(s.plannedDate)} · {s.brigadeName}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Nueva fecha</span>
          <input className="input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        </label>
      </div>
      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sustento de la reprogramación" />
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
        <input type="checkbox" checked={reopen} onChange={(e) => setReopen(e.target.checked)} /> Volver a dejar pendientes las unidades no realizadas de la estación
      </label>
      <p className="hint" style={{ margin: 0 }}>Se guarda la fecha original, la nueva, el motivo y quién aprobó. La brigada lo verá al actualizar su paquete de trabajo.</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={!newDate || reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>Reprogramar</button>
      </div>
      <ErrorBox error={save.error} />
    </div>
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
