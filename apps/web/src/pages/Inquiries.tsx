import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  INQUIRY_CHANNEL_LABELS, INQUIRY_CHANNELS, INQUIRY_FILE_MAX_BYTES, INQUIRY_FILE_TYPES, INQUIRY_MESSAGE_KIND_LABELS,
  INQUIRY_STATUS_LABELS, INQUIRY_STATUSES,
  type InquiryChannel, type InquiryDetail, type InquiryFile, type InquiryOptions, type InquiryRow, type InquiryStatus,
} from '@toce/shared';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import { Dialog, ErrorBox, NoProject } from '../components/Dialog';

const STATUS_CHIP: Record<InquiryStatus, string> = { abierta: 'chip chip-warn', respondida: 'chip chip-ok', cerrada: 'chip' };
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const OTHER_CHANNELS = INQUIRY_CHANNELS.filter((c) => c !== 'app');
const ACCEPT = INQUIRY_FILE_TYPES.join(',');
const mb = (b: number) => `${(b / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits: 1 })} MB`;

/** Revisa tipo y tamaño antes de subir. */
function fileProblem(files: File[]) {
  const bad = files.find((f) => !(INQUIRY_FILE_TYPES as readonly string[]).includes(f.type));
  if (bad) return `“${bad.name}” no es un tipo admitido (fotos, PDF, audio, Excel o Word).`;
  const big = files.find((f) => f.size > INQUIRY_FILE_MAX_BYTES);
  if (big) return `“${big.name}” pesa ${mb(big.size)}; el máximo es ${mb(INQUIRY_FILE_MAX_BYTES)}.`;
  return null;
}

async function uploadAll(messageId: string, files: File[]) {
  for (const f of files) {
    await api(`/inquiry-messages/${messageId}/files?name=${encodeURIComponent(f.name)}`, { method: 'PUT', body: f, headers: { 'content-type': f.type } });
  }
}

/** Consultas (5.4): preguntas de coordinación a campo, respuestas, llamadas registradas, adjuntos e historial. */
export function InquiriesPage() {
  const { project } = useProject();
  const [status, setStatus] = useState<InquiryStatus | ''>('');
  const [brigadeId, setBrigadeId] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(brigadeId ? { brigadeId } : {}), ...(q ? { q } : {}) }).toString();
  const list = useQuery({
    queryKey: ['inquiries', project?.id, qs],
    enabled: !!project,
    queryFn: () => api<InquiryRow[]>(`/projects/${project!.id}/inquiries${qs ? `?${qs}` : ''}`),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const options = useQuery({
    queryKey: ['inquiry-options', project?.id],
    enabled: !!project,
    queryFn: () => api<InquiryOptions>(`/projects/${project!.id}/inquiries/options`),
  });
  const rows = list.data ?? [];
  useEffect(() => {
    if (!selected && rows.length) setSelected(rows[0]!.id);
  }, [rows, selected]);
  if (!project) return <NoProject />;
  const waiting = rows.filter((r) => r.status === 'abierta').length;
  const answered = rows.filter((r) => r.status === 'respondida').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Consultas</h1>
          <p>Preguntas a las brigadas de {project.code}: lo que se responde desde el teléfono y lo conversado por llamada, WhatsApp o radio.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={!options.data}>Nueva consulta</button>
      </div>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', marginBottom: 16 }}>
        <div className="card stat"><div className="label">Esperando respuesta</div><div className="value" style={{ color: waiting ? 'var(--warn)' : undefined }}>{waiting}</div></div>
        <div className="card stat"><div className="label">Respondidas por revisar</div><div className="value" style={{ color: answered ? 'var(--primary)' : undefined }}>{answered}</div></div>
        <div className="card stat"><div className="label">Mostradas</div><div className="value">{rows.length}</div></div>
      </div>
      <div className="split" style={{ gridTemplateColumns: 'minmax(300px, 420px) 1fr' }}>
        <div className="card">
          <div className="toolbar" style={{ flexWrap: 'wrap' }}>
            <select className="input" value={status} onChange={(e) => { setStatus(e.target.value as InquiryStatus | ''); setSelected(null); }} aria-label="Estado">
              <option value="">Todos los estados</option>
              {INQUIRY_STATUSES.map((s) => <option key={s} value={s}>{INQUIRY_STATUS_LABELS[s]}</option>)}
            </select>
            <select className="input" value={brigadeId} onChange={(e) => { setBrigadeId(e.target.value); setSelected(null); }} aria-label="Brigada">
              <option value="">Todas las brigadas</option>
              {options.data?.brigades.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <input className="input" type="search" value={text} onChange={(e) => { setText(e.target.value); setSelected(null); }} placeholder="Buscar asunto, persona, estación o texto" aria-label="Buscar" />
          </div>
          <div className="list scroll-y" style={{ maxHeight: 'calc(100vh - 300px)', opacity: list.isPlaceholderData ? 0.6 : 1 }}>
            {rows.map((r) => (
              <button key={r.id} className="list-item" aria-current={r.id === selected} onClick={() => setSelected(r.id)} style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{r.subject}</strong>
                    <span className={STATUS_CHIP[r.status]}>{INQUIRY_STATUS_LABELS[r.status]}</span>
                    {r.channel !== 'app' && <span className="chip">{INQUIRY_CHANNEL_LABELS[r.channel]}</span>}
                  </div>
                  <small>{[r.targetName, r.brigadeName, r.stationCode, r.methodCode].filter(Boolean).join(' · ')}</small>
                  <small>
                    {r.createdByName} · {when(r.createdAt)} · {r.messages} mensaje{r.messages === 1 ? '' : 's'}
                    {r.files ? ` · ${r.files} adjunto${r.files === 1 ? '' : 's'}` : ''}
                  </small>
                </div>
              </button>
            ))}
            {list.isSuccess && !rows.length && <div className="empty">No hay consultas{status || brigadeId || q ? ' con estos filtros' : '. Registra la primera con “Nueva consulta”'}.</div>}
          </div>
          <ErrorBox error={list.error} />
        </div>
        {selected ? <InquiryView id={selected} /> : <div className="card empty">Selecciona una consulta.</div>}
      </div>
      {creating && options.data && (
        <NewInquiryDialog projectId={project.id} options={options.data} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelected(id); }} />
      )}
    </>
  );
}

function NewInquiryDialog({ projectId, options, onClose, onCreated }: {
  projectId: string; options: InquiryOptions; onClose: () => void; onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [brigadeId, setBrigadeId] = useState(options.brigades[0]?.id ?? '');
  const brigade = options.brigades.find((b) => b.id === brigadeId);
  const [targetUserId, setTarget] = useState('');
  const [stationId, setStationId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [channel, setChannel] = useState<InquiryChannel>('app');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [response, setResponse] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const methods = useMemo(
    () => options.methods.filter((m) => !brigade?.specialtyId || m.specialtyId === brigade.specialtyId),
    [options.methods, brigade?.specialtyId],
  );
  const person = brigade?.people.find((p) => p.id === targetUserId);
  const problem = fileProblem(files);
  const save = useMutation({
    mutationFn: async () => {
      const r = await api<{ id: string; messageId: string; responseId: string | null }>(`/projects/${projectId}/inquiries`, {
        method: 'POST',
        body: JSON.stringify({
          brigadeId, targetUserId, stationId: stationId || null, methodId: methodId || null, subject, channel, body,
          response: channel !== 'app' && response.trim() ? response : null,
        }),
      });
      // Lo recibido por otro medio (fotos de WhatsApp, actas) va con la respuesta; si no, con la consulta.
      await uploadAll(r.responseId ?? r.messageId, files);
      return r;
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['inquiries'] });
      onCreated(r.id);
    },
  });
  const ok = brigadeId && targetUserId && subject.trim().length >= 3 && body.trim() && !problem;

  return (
    <Dialog
      title="Nueva consulta"
      wide
      onClose={onClose}
      onSubmit={() => ok && !save.isPending && save.mutate()}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={!ok || save.isPending}>{save.isPending ? 'Guardando…' : channel === 'app' ? 'Enviar al teléfono' : 'Registrar'}</button>
      </>}
    >
      <div className="grid-2">
        <label className="field">
          <span className="label">Brigada</span>
          <select className="input" value={brigadeId} onChange={(e) => { setBrigadeId(e.target.value); setTarget(''); setStationId(''); setMethodId(''); }} required>
            {options.brigades.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Persona consultada</span>
          <select className="input" value={targetUserId} onChange={(e) => setTarget(e.target.value)} required>
            <option value="">Elige…</option>
            {brigade?.people.map((p) => <option key={p.id} value={p.id}>{p.fullName} · {p.role}</option>)}
          </select>
          {person?.phone && <span className="hint">Teléfono: {person.phone}</span>}
        </label>
        <label className="field">
          <span className="label">Estación (opcional)</span>
          <select className="input" value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">—</option>
            {brigade?.stations.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Método (opcional)</span>
          <select className="input" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
            <option value="">—</option>
            {methods.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
          </select>
        </label>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <span className="label">Medio</span>
        <div className="segmented" role="group" aria-label="Medio" style={{ flexWrap: 'wrap' }}>
          {INQUIRY_CHANNELS.map((c) => (
            <button key={c} type="button" aria-pressed={channel === c} onClick={() => setChannel(c)}>{c === 'app' ? 'Enviar por la app' : INQUIRY_CHANNEL_LABELS[c]}</button>
          ))}
        </div>
        <span className="hint">
          {channel === 'app'
            ? 'Le llega al teléfono la próxima vez que sincronice; puede responder aunque esté sin señal.'
            : 'Para dejar constancia de lo conversado fuera de la app (por ejemplo, cuando en campo no hay datos).'}
        </span>
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        <span className="label">Asunto</span>
        <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder="Ej. Esfuerzo de muestreo en EST-03" required />
      </label>
      <label className="field" style={{ marginTop: 12 }}>
        <span className="label">{channel === 'app' ? 'Consulta' : 'Qué se preguntó'}</span>
        <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} required />
      </label>
      {channel !== 'app' && (
        <label className="field" style={{ marginTop: 12 }}>
          <span className="label">Respuesta recibida (opcional)</span>
          <textarea className="input" rows={3} value={response} onChange={(e) => setResponse(e.target.value)} maxLength={4000} placeholder="Si ya respondió, anótalo aquí; si no, queda esperando respuesta." />
        </label>
      )}
      <FilePicker files={files} onChange={setFiles} />
      <ErrorBox error={problem ? new Error(problem) : save.error} />
    </Dialog>
  );
}

function FilePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
      <input ref={ref} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
      <button type="button" className="btn btn-sm" onClick={() => ref.current?.click()}>Adjuntar evidencias</button>
      {files.map((f, i) => (
        <span key={i} className="chip" style={{ gap: 4 }}>
          {f.name} ({mb(f.size)})
          <button type="button" className="icon-btn" style={{ width: 18, height: 18, fontSize: 14 }} onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Quitar ${f.name}`}>×</button>
        </span>
      ))}
      {!files.length && <span className="hint">Fotos, PDF, audio, Excel o Word; hasta 25 MB cada uno.</span>}
    </div>
  );
}

function InquiryView({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['inquiry', id], queryFn: () => api<InquiryDetail>(`/inquiries/${id}`), refetchInterval: 60_000 });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['inquiry', id] });
    void qc.invalidateQueries({ queryKey: ['inquiries'] });
  };
  const toggle = useMutation({
    mutationFn: (action: 'close' | 'reopen') => api(`/inquiries/${id}/${action}`, { method: 'POST', body: '{}' }),
    onSuccess: refresh,
  });
  if (q.isLoading) return <div className="card empty">Cargando…</div>;
  if (q.error || !q.data) return <div className="card" style={{ padding: 16 }}><ErrorBox error={q.error} /></div>;
  const d = q.data;
  const closed = d.status === 'cerrada';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ flex: 1, margin: 0 }}>{d.subject}</h2>
          <span className={STATUS_CHIP[d.status]}>{INQUIRY_STATUS_LABELS[d.status]}</span>
        </div>
        <dl className="kv">
          <dt>Consultado</dt><dd>{d.targetName ?? '—'}{d.targetPhone ? ` · ${d.targetPhone}` : ''}</dd>
          <dt>Brigada</dt><dd>{d.brigadeName ?? '—'}</dd>
          <dt>Estación</dt><dd>{d.stationCode ?? '—'}</dd>
          <dt>Método</dt><dd>{d.methodCode ? `${d.methodCode} · ${d.methodName ?? ''}` : '—'}</dd>
          <dt>Registró</dt><dd>{d.createdByName} · {when(d.createdAt)} · {INQUIRY_CHANNEL_LABELS[d.channel]}</dd>
          {closed && d.closedAt && <><dt>Cerró</dt><dd>{d.closedByName} · {when(d.closedAt)}</dd></>}
        </dl>
      </div>

      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="section-title" style={{ margin: 0 }}>Historial ({d.thread.length})</div>
        {d.thread.map((m) => {
          const field = m.kind === 'respuesta';
          return (
            <div key={m.id} style={{ alignSelf: field ? 'flex-start' : 'flex-end', maxWidth: '85%', background: field ? 'var(--surface-2)' : 'var(--primary-soft)', borderRadius: 10, padding: '8px 12px' }}>
              <div className="hint" style={{ fontSize: 12 }}>
                {m.onBehalfOfName ?? m.authorName} · {when(m.sentAt)} · {INQUIRY_MESSAGE_KIND_LABELS[m.kind]}
                {m.channel !== 'app' ? ` · ${INQUIRY_CHANNEL_LABELS[m.channel]}` : field ? ' · desde la app' : ''}
                {m.onBehalfOfName ? ` · registró ${m.authorName}` : ''}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
              {m.files.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {m.files.map((f) => <FileLink key={f.id} file={f} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!closed && <Composer detail={d} onSent={refresh} />}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <ErrorBox error={toggle.error} />
        {closed
          ? <button className="btn" disabled={toggle.isPending} onClick={() => toggle.mutate('reopen')}>Reabrir consulta</button>
          : <button className="btn" disabled={toggle.isPending} onClick={() => confirm('¿Cerrar la consulta? Queda en el historial y se puede reabrir.') && toggle.mutate('close')}>Cerrar consulta</button>}
      </div>
    </div>
  );
}

function FileLink({ file }: { file: InquiryFile }) {
  const [error, setError] = useState<unknown>(null);
  const open = async () => {
    // La pestaña se abre antes de pedir el enlace para que el navegador no la bloquee.
    const w = window.open('', '_blank');
    try {
      const { url } = await api<{ url: string }>(`/inquiry-files/${file.id}/url`);
      if (w) w.location.href = url; else window.location.assign(url);
    } catch (e) {
      w?.close();
      setError(e);
    }
  };
  const icon = file.kind === 'foto' ? '🖼' : file.kind === 'audio' ? '🎧' : '📄';
  return (
    <>
      <button type="button" className="chip" onClick={() => void open()} title="Abrir" style={{ cursor: 'pointer', border: 0 }}>
        {icon} {file.name ?? (file.kind === 'foto' ? 'Foto de campo' : 'archivo')}{file.sizeBytes ? ` (${mb(file.sizeBytes)})` : ''}
      </button>
      <ErrorBox error={error} />
    </>
  );
}

type Action = 'solicitud_info' | 'respuesta' | 'seguimiento';
const ACTIONS: { key: Action; label: string; hint: string; placeholder: string }[] = [
  { key: 'solicitud_info', label: 'Pedir más información', hint: 'Queda esperando respuesta.', placeholder: 'Qué información falta' },
  { key: 'respuesta', label: 'Registrar respuesta recibida', hint: 'Lo que respondió por otro medio; queda como respuesta de la persona consultada.', placeholder: 'Qué respondió' },
  { key: 'seguimiento', label: 'Seguimiento', hint: 'Nota del historial (p. ej. “Llamé y no contestó”); no cambia el estado.', placeholder: 'Qué se hizo' },
];

function Composer({ detail, onSent }: { detail: InquiryDetail; onSent: () => void }) {
  // Respondida: lo habitual es repreguntar. Esperando: por app se deja seguimiento; por otro medio, se anota la respuesta.
  const [action, setAction] = useState<Action>(detail.status === 'respondida' ? 'solicitud_info' : detail.channel === 'app' ? 'seguimiento' : 'respuesta');
  const [channel, setChannel] = useState<InquiryChannel>(detail.channel === 'app' && action === 'respuesta' ? 'telefono' : detail.channel);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const a = ACTIONS.find((x) => x.key === action)!;
  const needsOther = action === 'respuesta';
  const problem = fileProblem(files);
  const send = useMutation({
    mutationFn: async () => {
      const r = await api<{ id: string }>(`/inquiries/${detail.id}/messages`, { method: 'POST', body: JSON.stringify({ kind: action, channel, body }) });
      await uploadAll(r.id, files);
    },
    onSuccess: () => { setBody(''); setFiles([]); onSent(); },
  });
  const pick = (k: Action) => {
    setAction(k);
    if (k === 'respuesta' && channel === 'app') setChannel('telefono');
  };

  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="segmented" role="group" aria-label="Acción" style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}>
        {ACTIONS.map((x) => <button key={x.key} type="button" aria-pressed={action === x.key} onClick={() => pick(x.key)}>{x.label}</button>)}
      </div>
      <span className="hint">{a.hint}</span>
      <label className="field">
        <span className="label">Medio</span>
        <select className="input" value={channel} onChange={(e) => setChannel(e.target.value as InquiryChannel)} style={{ maxWidth: 260 }}>
          {(needsOther ? OTHER_CHANNELS : INQUIRY_CHANNELS).map((c) => <option key={c} value={c}>{c === 'app' ? 'Enviar por la app' : INQUIRY_CHANNEL_LABELS[c]}</option>)}
        </select>
      </label>
      <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={a.placeholder} maxLength={4000} />
      <FilePicker files={files} onChange={setFiles} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={!body.trim() || !!problem || send.isPending} onClick={() => send.mutate()}>{send.isPending ? 'Guardando…' : 'Guardar'}</button>
      </div>
      <ErrorBox error={problem ? new Error(problem) : send.error} />
    </div>
  );
}
