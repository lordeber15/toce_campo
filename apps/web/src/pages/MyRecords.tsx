import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import {
  EXECUTION_STATUS_LABELS, INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS, INQUIRY_MESSAGE_KIND_LABELS, INQUIRY_STATUS_LABELS,
  LOGISTICS_ENTITY_LABELS,
  type ExecutionStatus, type IncidentStatus, type IncidentType, type InquiryFile, type LogisticsEntity, type MyFile,
  type MyIncident, type MyInquiryDto, type MyJournal, type MyLogisticsRow, type MyOverview,
} from '@toce/shared';
import { api, download } from '../lib/api';
import { MediaViewer } from '../components/MediaViewer';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { ErrorBox, NoProject } from '../components/Dialog';

type Tab = 'jornadas' | 'alertas' | 'consultas' | 'logistica';
const STATUS_CHIP: Record<ExecutionStatus, string> = { completada: 'chip chip-ok', no_realizada: 'chip chip-off', en_curso: 'chip chip-warn', fotos_ok: 'chip chip-warn' };
const limaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const shift = (d: string, days: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
const longDay = (d: string) => {
  const t = new Date(`${d}T12:00:00-05:00`).toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const hour = (iso: string) => new Date(iso).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false });
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits: 1 })} MB`);

const RANGES = [
  { key: '7', label: '7 días', days: 7 },
  { key: '30', label: '30 días', days: 30 },
  { key: 'all', label: 'Todo', days: null },
] as const;

/**
 * Mis registros: lo que la persona cargó desde su teléfono, ordenado como en la app (día → estación → método → unidad),
 * con sus alertas, consultas y logística, y descargas para armar informes. El jefe de brigada puede ver toda su brigada.
 */
export function MyRecordsPage() {
  const { project } = useProject();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('jornadas');
  const [scope, setScope] = useState('');
  const [range, setRange] = useState<(typeof RANGES)[number]['key'] | 'custom'>('7');
  const today = limaToday();
  const [from, setFrom] = useState(shift(today, -6));
  const [to, setTo] = useState(today);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const overview = useQuery({ queryKey: ['me-overview'], queryFn: () => api<MyOverview>('/me/overview'), staleTime: 5 * 60_000 });
  const led = (overview.data?.ledBrigades ?? []).filter((b) => b.projectId === project?.id);
  const brigadeId = led.some((b) => b.id === scope) ? scope : '';
  const qs = project ? new URLSearchParams({
    projectId: project.id,
    ...(brigadeId ? { brigadeId } : {}),
    ...(range === 'all' ? {} : { from, to }),
  }).toString() : '';
  const journal = useQuery({
    queryKey: ['me-journal', qs],
    enabled: !!project,
    queryFn: () => api<MyJournal>(`/me/journal?${qs}`),
    placeholderData: keepPreviousData,
  });
  if (!project) return <NoProject />;
  const t = journal.data?.totals;
  const isLogistics = !!user?.roles.includes('logistico');
  const tabs: { key: Tab; label: string }[] = [
    { key: 'jornadas', label: 'Jornadas' },
    { key: 'alertas', label: brigadeId ? 'Alertas de la brigada' : 'Mis alertas' },
    { key: 'consultas', label: 'Consultas de coordinación' },
    ...(isLogistics || brigadeId ? [{ key: 'logistica' as const, label: 'Logística' }] : []),
  ];
  const pickRange = (k: (typeof RANGES)[number]['key']) => {
    setRange(k);
    const days = RANGES.find((r) => r.key === k)!.days;
    if (days) { setFrom(shift(today, -(days - 1))); setTo(today); }
  };

  const zip = async () => {
    setErr(null);
    try {
      const c = await api<{ ready: number; pending: number; bytes: number; max: number }>(`/me/evidence/count?${qs}`);
      if (!c.ready) { setMsg('No hay fotos ni audios subidos en este período.'); return; }
      if (c.ready > c.max) { setMsg(`Son ${c.ready} archivos; acorta el período para bajar como máximo ${c.max}.`); return; }
      setMsg(`Descargando ${c.ready} archivo${c.ready === 1 ? '' : 's'} (${mb(c.bytes)})${c.pending ? `; ${c.pending} siguen en el teléfono` : ''}. Quedan en carpetas Brigada / Especialista / Estación / Método / Unidad.`);
      await download(`/me/evidence.zip?${qs}`);
    } catch (e) { setErr(e); }
  };
  const excel = async () => {
    setErr(null);
    try { await download(`/me/records.xlsx?${qs}`); } catch (e) { setErr(e); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{brigadeId ? `Registros de ${led.find((b) => b.id === brigadeId)?.name}` : 'Mis registros'}</h1>
          <p>Lo que se cargó desde el teléfono en {project.code}, ordenado como en la app. Solo lectura: las correcciones se hacen desde el teléfono.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => void excel()} disabled={!t?.units}>Excel de registros</button>
          <button className="btn btn-primary" onClick={() => void zip()} disabled={!t?.photos && !t?.audios}>Fotos y audios (ZIP)</button>
        </div>
      </div>

      {(msg || !!err) && (
        <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          {msg && <span className="grow">{msg}</span>}
          <ErrorBox error={err} />
          <button className="icon-btn" onClick={() => { setMsg(null); setErr(null); }} aria-label="Cerrar aviso">×</button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          {led.length > 0 && (
            <div className="segmented" role="group" aria-label="Ver">
              <button type="button" aria-pressed={!brigadeId} onClick={() => setScope('')}>Lo mío</button>
              {led.map((b) => <button key={b.id} type="button" aria-pressed={brigadeId === b.id} onClick={() => setScope(b.id)}>Brigada {b.name}</button>)}
            </div>
          )}
          <div className="segmented" role="group" aria-label="Período">
            {RANGES.map((r) => <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => pickRange(r.key)}>{r.label}</button>)}
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="hint">Desde</span>
            <input className="input" type="date" value={range === 'all' ? '' : from} max={to} onChange={(e) => { setFrom(e.target.value); setRange('custom'); }} />
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="hint">Hasta</span>
            <input className="input" type="date" value={range === 'all' ? '' : to} min={from} onChange={(e) => { setTo(e.target.value); setRange('custom'); }} />
          </label>
          {brigadeId && <Link to={`/mi-brigada/${brigadeId}`} className="btn btn-sm" style={{ marginLeft: 'auto' }}>Avance de la brigada →</Link>}
        </div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', marginBottom: 16 }}>
        <div className="card stat"><div className="label">Unidades</div><div className="value">{t?.units ?? '—'}</div></div>
        <div className="card stat"><div className="label">Completadas</div><div className="value">{t?.completed ?? '—'}</div></div>
        <div className="card stat"><div className="label">No realizadas</div><div className="value" style={{ color: t?.notDone ? 'var(--danger)' : undefined }}>{t?.notDone ?? '—'}</div></div>
        <div className="card stat"><div className="label">Registros</div><div className="value">{t?.records ?? '—'}</div></div>
        <div className="card stat"><div className="label">Fotos</div><div className="value">{t?.photos ?? '—'}</div></div>
        <div className="card stat"><div className="label">Audios</div><div className="value">{t?.audios ?? '—'}</div></div>
        {!!t?.pendingFiles && <div className="card stat"><div className="label">Aún en el teléfono</div><div className="value" style={{ color: 'var(--warn)' }}>{t.pendingFiles}</div></div>}
      </div>

      <div className="segmented" role="tablist" aria-label="Secciones" style={{ marginBottom: 12 }}>
        {tabs.map((x) => <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} aria-pressed={tab === x.key} onClick={() => setTab(x.key)}>{x.label}</button>)}
      </div>

      {tab === 'jornadas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: journal.isPlaceholderData ? 0.6 : 1 }}>
          <ErrorBox error={journal.error} />
          {journal.data?.days.map((d) => (
            <div key={d.date} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{longDay(d.date)}</h2>
                <span className="hint">{d.stations.length} estación{d.stations.length === 1 ? '' : 'es'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {d.stations.map((s) => (
                  <div key={s.stationId} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                    <strong>{s.code}</strong>{s.name ? <span className="hint"> · {s.name}</span> : null}
                    {s.methods.map((m) => (
                      <div key={m.methodId} style={{ marginTop: 8 }}>
                        <div className="hint" style={{ marginBottom: 6 }}>{m.code} · {m.name}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {m.units.map((u) => (
                            <button
                              key={u.id}
                              className="card"
                              onClick={() => navigate(`/mis-registros/${u.id}`, { state: { back: '/mis-registros' } })}
                              style={{ padding: '8px 10px', textAlign: 'left', cursor: 'pointer', boxShadow: 'none', minWidth: 170 }}
                            >
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <strong style={{ fontSize: 14 }}>{u.unitCode}</strong>
                                <span className={STATUS_CHIP[u.status]}>{EXECUTION_STATUS_LABELS[u.status]}</span>
                              </div>
                              <small className="hint" style={{ display: 'block' }}>
                                {hour(u.startedAt)}{u.finishedAt ? `–${hour(u.finishedAt)}` : ''}
                                {u.records ? ` · ${u.records} reg.` : ''}{u.photos ? ` · ${u.photos} fotos` : ''}{u.audios ? ` · ${u.audios} audios` : ''}
                              </small>
                              {brigadeId && <small className="hint" style={{ display: 'block' }}>{u.specialistName}</small>}
                              {u.pendingFiles > 0 && <small style={{ color: 'var(--warn)', display: 'block' }}>{u.pendingFiles} archivo{u.pendingFiles === 1 ? '' : 's'} aún en el teléfono</small>}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {journal.isSuccess && !journal.data.days.length && (
            <div className="card empty">No hay registros sincronizados {range === 'all' ? '' : 'en este período'}. Lo que registres en el teléfono aparece aquí al sincronizar.</div>
          )}
        </div>
      )}
      {tab === 'alertas' && <IncidentsTab qs={qs} brigade={!!brigadeId} />}
      {tab === 'consultas' && <InquiriesTab />}
      {tab === 'logistica' && <LogisticsTab qs={qs} brigade={!!brigadeId} />}
    </>
  );
}

/** Abre un archivo propio (o de la brigada) en un visor. */
function FileChip({ file, label, path }: { file: { id: string; kind?: string; uploaded: boolean }; label: string; path?: string }) {
  const [open, setOpen] = useState(false);
  if (!file.uploaded) return <span className="chip chip-warn">{label} · en el teléfono</span>;
  return (
    <>
      <button type="button" className="chip" style={{ cursor: 'pointer', border: 0 }} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <MediaViewer
          title={label}
          kind={file.kind}
          queryKey={['my-file', file.id, path ?? '']}
          load={() => api<{ url: string }>(path ?? `/me/files/${file.id}/url`).then((r) => r.url)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const fileLabel = (f: MyFile, i: number) => (f.kind === 'audio' ? `Audio ${i + 1}` : f.kind === 'comprobante' ? `Comprobante ${i + 1}` : `Foto ${i + 1}`);

function IncidentsTab({ qs, brigade }: { qs: string; brigade: boolean }) {
  const q = useQuery({ queryKey: ['me-incidents', qs], queryFn: () => api<MyIncident[]>(`/me/incidents?${qs}`) });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <div className="card empty">Cargando…</div>;
  if (!q.data.length) return <div className="card empty">No hay alertas en este período.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {q.data.map((i) => (
        <div key={i.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{INCIDENT_TYPE_LABELS[i.type as IncidentType] ?? i.type}</strong>
            <span className="chip">{INCIDENT_STATUS_LABELS[i.status as IncidentStatus] ?? i.status}</span>
            <span className="hint">{[i.unitCode ?? i.stationCode, i.methodCode].filter(Boolean).join(' · ')} · {when(i.occurredAt)}{brigade ? ` · ${i.reportedByName}` : ''}</span>
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{i.description}</div>
          {i.proposedAction && <div><span className="hint">Acción propuesta:</span> {i.proposedAction}</div>}
          {i.coordinationResponse && (
            <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 10 }}>
              <span className="hint">Coordinación{i.resolvedByName ? ` (${i.resolvedByName})` : ''}:</span> {i.coordinationResponse}
              {i.correctiveAction && <div><span className="hint">Acción correctiva:</span> {i.correctiveAction}</div>}
            </div>
          )}
          {i.reschedules.map((r, k) => (
            <div key={k} className="hint">Reprogramación {r.status === 'propuesta' ? 'por aprobar' : r.status}: {r.fromDate.split('-').reverse().join('/')} → {r.toDate.split('-').reverse().join('/')} · {r.reason}</div>
          ))}
          {i.files.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{i.files.map((f, k) => <FileChip key={f.id} file={f} label={fileLabel(f, k)} />)}</div>}
        </div>
      ))}
    </div>
  );
}

function InquiriesTab() {
  const q = useQuery({ queryKey: ['me-inquiries'], queryFn: () => api<MyInquiryDto[]>('/field/inquiries/mine') });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <div className="card empty">Cargando…</div>;
  if (!q.data.length) return <div className="card empty">No tienes consultas de coordinación. Se responden desde el teléfono.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {q.data.map((x) => (
        <div key={x.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{x.subject}</strong>
            <span className="chip">{INQUIRY_STATUS_LABELS[x.status]}</span>
            <span className="hint">{[x.brigadeName, x.stationCode, x.methodCode].filter(Boolean).join(' · ')} · {x.createdByName} · {when(x.createdAt)}</span>
          </div>
          {x.thread.map((m) => (
            <div key={m.id} style={{ background: m.kind === 'respuesta' ? 'var(--primary-soft)' : 'var(--surface-2)', borderRadius: 8, padding: '6px 10px' }}>
              <div className="hint" style={{ fontSize: 12 }}>{m.onBehalfOfName ?? m.authorName} · {INQUIRY_MESSAGE_KIND_LABELS[m.kind]} · {when(m.sentAt)}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
              {m.files.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {m.files.map((f: InquiryFile) => (
                    <FileChip key={f.id} file={{ id: f.id, uploaded: f.uploadStatus === 'subido' }} label={f.name ?? (f.kind === 'foto' ? 'Foto' : 'Archivo')} path={`/inquiry-files/${f.id}/url`} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Resumen legible de un registro logístico según su tipo. */
function logisticsSummary(r: MyLogisticsRow) {
  const d = r.data as Record<string, string | number | null | undefined>;
  const parts = r.entity === 'vehicle' ? [d.description, d.plate, d.status]
    : r.entity === 'support' ? [d.fullName, d.dni ? `DNI ${d.dni}` : null, d.community]
      : r.entity === 'expense' ? [d.category, d.description, d.amount != null ? `${d.currency ?? 'PEN'} ${Number(d.amount).toFixed(2)}` : null, d.receiptNumber]
        : r.entity === 'sample' ? [d.code, d.description, d.status]
          : [d.name, d.serial, d.status, d.receptionStatus === 'por_recibir' ? 'por recibir' : d.receptionStatus === 'recibido' ? 'recibido' : d.receptionStatus === 'incompleto' ? 'recibido incompleto' : null];
  return parts.filter((p) => p != null && p !== '').join(' · ') || 'Registro';
}

function LogisticsTab({ qs, brigade }: { qs: string; brigade: boolean }) {
  const q = useQuery({ queryKey: ['me-logistics', qs], queryFn: () => api<MyLogisticsRow[]>(`/me/logistics?${qs}`) });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <div className="card empty">Cargando…</div>;
  if (!q.data.length) return <div className="card empty">No hay registros de logística en este período.</div>;
  const groups = Object.entries(LOGISTICS_ENTITY_LABELS) as [LogisticsEntity, { many: string }][];
  const total = (e: string) => q.data.filter((r) => r.entity === 'expense' && e === 'expense').reduce((a, r) => a + Number((r.data as { amount?: number }).amount ?? 0), 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {groups.map(([entity, l]) => {
        const rows = q.data.filter((r) => r.entity === entity);
        if (!rows.length) return null;
        return (
          <div key={entity} className="card" style={{ padding: 16 }}>
            <div className="section-title" style={{ marginTop: 0 }}>
              {l.many} ({rows.length}){entity === 'expense' ? ` · total ${total('expense').toFixed(2)}` : ''}
            </div>
            <div className="list">
              {rows.map((r) => (
                <div key={r.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div>{logisticsSummary(r)}</div>
                    <small>{when(r.updatedAt)}{r.brigadeName ? ` · ${r.brigadeName}` : ''}{brigade ? ` · ${r.registeredByName}` : ''}</small>
                    {r.files.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>{r.files.map((f, k) => <FileChip key={f.id} file={f} label={fileLabel(f, k)} />)}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
