import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  EXECUTION_STATUSES, EXECUTION_STATUS_LABELS, INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS, formatUtm, latLngToUtm,
  type ExecutionStatus, type FormField, type IncidentStatus, type IncidentType, type RecordAttachment, type RecordDetail,
  type RecordFilterOptions, type RecordsPage,
} from '@toce/shared';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import { ErrorBox, NoProject } from '../components/Dialog';

const STATUS_CHIP: Record<ExecutionStatus, string> = {
  en_curso: 'chip chip-warn', fotos_ok: 'chip chip-warn', completada: 'chip chip-ok', no_realizada: 'chip chip-off',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const hour = (iso: string) => new Date(iso).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false });
const d8 = (d: string) => d.split('-').reverse().join('/');
const minutes = (a: string, b: string | null) => (b ? Math.round((Date.parse(b) - Date.parse(a)) / 60000) : null);

const FILTER_KEYS = ['specialtyId', 'methodId', 'stationId', 'brigadeId', 'specialistId', 'status', 'from', 'to', 'q'] as const;

/** Consultas (5.3): todos los registros de campo del proyecto con filtros; abre la ficha de cada unidad. */
export function RecordsPage() {
  const { project } = useProject();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [text, setText] = useState(params.get('q') ?? '');
  const page = Number(params.get('page') ?? '1') || 1;
  const filters = Object.fromEntries(FILTER_KEYS.flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : [])));
  const qs = new URLSearchParams({ ...filters, page: String(page) }).toString();

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k === 'specialtyId') next.delete('methodId');
    next.delete('page');
    setParams(next, { replace: true });
  };
  // Búsqueda de texto con pausa para no consultar en cada tecla.
  useEffect(() => {
    if (text === (params.get('q') ?? '')) return;
    const t = setTimeout(() => set('q', text.trim()), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const options = useQuery({
    queryKey: ['record-filters', project?.id],
    enabled: !!project,
    queryFn: () => api<RecordFilterOptions>(`/projects/${project!.id}/records/filters`),
  });
  const list = useQuery({
    queryKey: ['records', project?.id, qs],
    enabled: !!project,
    queryFn: () => api<RecordsPage>(`/projects/${project!.id}/records?${qs}`),
    placeholderData: keepPreviousData,
  });
  if (!project) return <NoProject />;
  const o = options.data;
  const specialtyCode = o?.specialties.find((s) => s.id === filters.specialtyId)?.code;
  const methods = (o?.methods ?? []).filter((m) => !specialtyCode || m.specialtyCode === specialtyCode);
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const active = Object.keys(filters).length > 0;
  const goPage = (p: number) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n, { replace: true }); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Consultas</h1>
          <p>Registros de campo de {project.code}: formularios, fotos y notas de voz de cada unidad de muestreo.</p>
        </div>
      </div>
      <div className="card">
        <div className="toolbar">
          <input className="input" type="search" placeholder="Buscar unidad, especie, especialista…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Buscar" style={{ maxWidth: 260 }} />
          <Select label="Especialidad" value={filters.specialtyId} onChange={(v) => set('specialtyId', v)} options={(o?.specialties ?? []).map((s) => [s.id, s.name])} />
          <Select label="Método" value={filters.methodId} onChange={(v) => set('methodId', v)} options={methods.map((m) => [m.id, `${m.code} · ${m.name}`])} />
          <Select label="Estación" value={filters.stationId} onChange={(v) => set('stationId', v)} options={(o?.stations ?? []).map((s) => [s.id, s.code])} />
          <Select label="Brigada" value={filters.brigadeId} onChange={(v) => set('brigadeId', v)} options={(o?.brigades ?? []).map((b) => [b.id, b.name])} />
          <Select label="Especialista" value={filters.specialistId} onChange={(v) => set('specialistId', v)} options={(o?.specialists ?? []).map((s) => [s.id, s.name])} />
          <Select label="Estado" value={filters.status} onChange={(v) => set('status', v)} options={EXECUTION_STATUSES.map((s) => [s, EXECUTION_STATUS_LABELS[s]])} />
          <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Desde <input className="input" type="date" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} style={{ width: 150 }} />
          </label>
          <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Hasta <input className="input" type="date" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} style={{ width: 150 }} />
          </label>
          {active && <button className="btn btn-sm" onClick={() => { setText(''); setParams({}, { replace: true }); }}>Quitar filtros</button>}
        </div>
        <ErrorBox error={list.error ?? options.error} />
        {data && !data.rows.length ? (
          <div className="empty">{active ? 'Ningún registro coincide con los filtros.' : 'Aún no hay registros de campo sincronizados en este proyecto.'}</div>
        ) : !data ? (
          <div className="empty">Cargando registros…</div>
        ) : (
          <div className="table-wrap" style={{ opacity: list.isPlaceholderData ? 0.6 : 1 }}>
            <table>
              <thead>
                <tr>
                  <th>Unidad</th><th>Método</th><th>Fecha</th><th>Especialista</th><th>Brigada</th><th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Registros</th><th style={{ textAlign: 'right' }}>Fotos</th><th style={{ textAlign: 'right' }}>Audios</th><th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const open = () => navigate(`/consultas/${r.id}`, { state: { back: `/consultas?${params}` } });
                  return (
                    <tr key={r.id} className="clickable-row" onClick={open} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open()}>
                      <td><strong>{r.unitCode}</strong></td>
                      <td><span className="chip">{r.specialtyCode}</span>{r.methodCode} · {r.methodName}</td>
                      <td>{when(r.startedAt)}</td>
                      <td>{r.specialistName}</td>
                      <td>{r.brigadeName ?? '—'}</td>
                      <td><span className={STATUS_CHIP[r.status]}>{EXECUTION_STATUS_LABELS[r.status]}</span></td>
                      <td style={{ textAlign: 'right' }}>{r.records}</td>
                      <td style={{ textAlign: 'right' }}>{r.photos}</td>
                      <td style={{ textAlign: 'right' }}>{r.audios}</td>
                      <td className="hint">
                        {r.pendingFiles > 0 && <span title="Archivos que aún están en el teléfono">{r.pendingFiles} por subir</span>}
                        {r.incidents > 0 && <span className="chip chip-off" style={{ marginLeft: 6 }}>{r.incidents} alerta{r.incidents > 1 ? 's' : ''}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <div className="toolbar" style={{ borderTop: '1px solid var(--border)', borderBottom: 0, alignItems: 'center' }}>
            <span className="hint">{data.total} registro{data.total === 1 ? '' : 's'}{pages > 1 ? ` · página ${page} de ${pages}` : ''}</span>
            <span style={{ flex: 1 }} />
            {pages > 1 && (
              <>
                <button className="btn btn-sm" disabled={page <= 1} onClick={() => goPage(page - 1)}>Anterior</button>
                <button className="btn btn-sm" disabled={page >= pages} onClick={() => goPage(page + 1)}>Siguiente</button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Select({ label, value, onChange, options }: { label: string; value?: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label} style={{ maxWidth: 200 }}>
      <option value="">{label}: todos</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

/** Ficha de una unidad de muestreo ejecutada: contexto, ubicación, formulario, fotos, audios y alertas. */
export function RecordDetailPage() {
  const { id } = useParams();
  const back = (useLocation().state as { back?: string } | null)?.back ?? '/consultas';
  const q = useQuery({ queryKey: ['record', id], queryFn: () => api<RecordDetail>(`/records/${id}`) });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <div className="card empty">Cargando registro…</div>;
  const d = q.data;
  const fields = d.formSchema.fields ?? [];
  const photos = d.attachments.filter((a) => a.kind === 'foto' || a.kind === 'foto_metodo');
  const audios = d.attachments.filter((a) => a.kind === 'audio');
  const slotLabel = (a: RecordAttachment) =>
    a.kind === 'foto_metodo' ? 'Foto del método' : d.photoSlots.find((s) => s.key === a.slotKey)?.label ?? a.slotKey ?? 'Foto';
  const dur = minutes(d.startedAt, d.finishedAt);
  const offDate = !!d.plannedDate && limaDate(d.startedAt) !== d.plannedDate;

  return (
    <>
      <div className="page-head">
        <div>
          <p><Link to={back} className="back-link">← Consultas</Link></p>
          <h1>{d.unitCode}</h1>
          <p>{d.methodCode} · {d.methodName} · <span className={STATUS_CHIP[d.status]}>{EXECUTION_STATUS_LABELS[d.status]}</span></p>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start', marginBottom: 16 }}>
        <div className="card" style={{ padding: 18 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Ejecución</div>
          <dl className="kv">
            <dt>Especialista</dt><dd>{d.specialistName} <span className="hint">DNI {d.specialistDni}</span></dd>
            <dt>Brigada</dt><dd>{d.brigadeName ?? '—'}</dd>
            <dt>Inicio</dt><dd>{when(d.startedAt)}</dd>
            <dt>Fin</dt><dd>{d.finishedAt ? `${hour(d.finishedAt)}${dur != null ? ` (${dur} min)` : ''}` : '—'}</dd>
            {d.plannedDate && (
              <>
                <dt>Programada</dt>
                <dd>
                  {d8(d.plannedDate)}{d.originalDate && d.originalDate !== d.plannedDate ? ` (original ${d8(d.originalDate)})` : ''}
                  {offDate && <span className="chip chip-warn" style={{ marginLeft: 6 }}>ejecutada en otra fecha</span>}
                </dd>
              </>
            )}
            <dt>Formulario</dt><dd>{d.formCompletedAt ? `completado ${when(d.formCompletedAt)}` : 'sin completar'}</dd>
            <dt>Sincronizado</dt><dd>{when(d.syncedAt)}</dd>
          </dl>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Ubicación</div>
          <dl className="kv">
            <dt>Estación</dt><dd><strong>{d.stationCode}</strong>{d.station.influenceArea ? ` · ${d.station.influenceArea}` : ''}</dd>
            <dt>Vegetación</dt><dd>{d.station.vegetationUnit ?? '—'}</dd>
            <dt>Estación (UTM)</dt><dd>{utm(d.station.lat, d.station.lng)}</dd>
            <dt>Inicio (UTM)</dt>
            <dd>
              {d.startLat != null && d.startLng != null ? (
                <>
                  {utm(d.startLat, d.startLng)}{d.startAccuracy != null ? ` ±${Math.round(d.startAccuracy)} m` : ''}{' '}
                  <a href={`https://www.openstreetmap.org/?mlat=${d.startLat}&mlon=${d.startLng}#map=16/${d.startLat}/${d.startLng}`} target="_blank" rel="noreferrer" className="hint">ver mapa</a>
                </>
              ) : 'sin GPS'}
            </dd>
            {d.distanceToStationM != null && (
              <>
                <dt>Distancia a la estación</dt>
                <dd>
                  {fmtDistance(d.distanceToStationM)}
                  {d.distanceToStationM > 1000 && <span className="chip chip-warn" style={{ marginLeft: 6 }}>lejos de la estación</span>}
                </dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {d.observations && (
        <div className="card" style={{ padding: 18, marginBottom: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Observaciones</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.observations}</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ margin: 0, padding: '14px 18px' }}>Registros del formulario ({d.formRecords.length})</div>
        {d.formRecords.length === 0 ? (
          <div className="empty" style={{ padding: 20 }}>Sin registros en el formulario.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th>{fields.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
              <tbody>
                {d.formRecords.map((rec, i) => (
                  <tr key={rec.id}>
                    <td className="hint">{i + 1}</td>
                    {fields.map((f) => <td key={f.key} className={f.type === 'textarea' ? 'wrap' : undefined}>{fieldValue(f, rec.values[f.key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>Fotos ({photos.length})</div>
        {photos.length === 0 ? <span className="hint">Sin fotos.</span> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            {photos.map((a) => <Photo key={a.id} file={a} label={slotLabel(a)} />)}
          </div>
        )}
        {audios.length > 0 && (
          <>
            <div className="section-title">Notas de voz ({audios.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {audios.map((a) => <Audio key={a.id} file={a} />)}
            </div>
          </>
        )}
      </div>

      {d.incidentList.length > 0 && (
        <div className="card" style={{ padding: 18 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Alertas de esta unidad</div>
          {d.incidentList.map((i) => (
            <p key={i.id} style={{ margin: '6px 0' }}>
              <span className="chip">{INCIDENT_STATUS_LABELS[i.status as IncidentStatus]}</span>
              <strong>{INCIDENT_TYPE_LABELS[i.type as IncidentType]}</strong> · {when(i.occurredAt)} — {i.description}{' '}
              <Link to="/alertas" className="hint">ver en Alertas</Link>
            </p>
          ))}
        </div>
      )}
    </>
  );
}

const limaDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const fmtDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 })} km` : `${m} m`);

const utm = (lat: number, lng: number) => formatUtm(latLngToUtm(lat, lng));

/** Valor de un campo del formulario tal como lo anotó el especialista. */
function fieldValue(f: FormField, v: unknown) {
  if (v == null || v === '') return <span className="hint">—</span>;
  if (f.type === 'coords' && typeof v === 'object') {
    const c = v as { lat?: number; lng?: number; utm?: string; accuracy?: number | null };
    const text = c.utm ?? (c.lat != null && c.lng != null ? utm(c.lat, c.lng) : '');
    return `${text}${c.accuracy != null ? ` ±${Math.round(c.accuracy)} m` : ''}`;
  }
  if (f.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.length > 10 ? when(v) : d8(v);
  if (f.type === 'species') return <em>{String(v)}</em>;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function useFileUrl(file: RecordAttachment, variant: 'compressed' | 'original' = 'compressed', enabled = true) {
  return useQuery({
    queryKey: ['file-url', file.id, variant],
    enabled: enabled && file.uploadStatus === 'subido',
    queryFn: () => api<{ url: string }>(`/field/attachments/${file.id}/url?variant=${variant}`),
    staleTime: 10 * 60_000,
  });
}

function Photo({ file, label }: { file: RecordAttachment; label: string }) {
  const url = useFileUrl(file);
  const [wantOriginal, setWantOriginal] = useState(false);
  const original = useFileUrl(file, 'original', wantOriginal && file.hasOriginal);
  useEffect(() => { if (original.data) window.open(original.data.url, '_blank', 'noopener'); }, [original.data]);
  const box = { width: 220, height: 165, borderRadius: 8, border: '1px solid var(--border)' };
  return (
    <figure style={{ margin: 0, width: 220 }}>
      {file.uploadStatus !== 'subido' ? (
        <div className="card empty" style={{ ...box, padding: 16, fontSize: 13, display: 'grid', placeItems: 'center' }}>Aún en el teléfono (se sube con conexión)</div>
      ) : url.data ? (
        <a href={url.data.url} target="_blank" rel="noreferrer" title="Ver en tamaño completo">
          <img src={url.data.url} alt={`${label}, ${when(file.takenAt)}`} style={{ ...box, objectFit: 'cover' }} loading="lazy" />
        </a>
      ) : <div className="card" style={box} />}
      <figcaption style={{ fontSize: 13, marginTop: 4 }}>
        <strong>{label}</strong> <span className="hint">{hour(file.takenAt)}</span>
        {file.lat != null && file.lng != null && <div className="hint">{utm(file.lat, file.lng)}{file.accuracy != null ? ` ±${Math.round(file.accuracy)} m` : ''}</div>}
        {file.caption && <div>{file.caption}</div>}
        {file.hasOriginal && (
          <button className="link-btn" style={{ fontSize: 12, padding: 0 }} onClick={() => (original.data ? window.open(original.data.url, '_blank', 'noopener') : setWantOriginal(true))}>
            Original en alta resolución
          </button>
        )}
      </figcaption>
    </figure>
  );
}

function Audio({ file }: { file: RecordAttachment }) {
  const url = useFileUrl(file);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {file.uploadStatus !== 'subido' ? <span className="hint">Nota de voz aún en el teléfono</span>
        : url.data ? <audio controls src={url.data.url} style={{ width: 300 }} preload="none" /> : <span className="hint">Cargando…</span>}
      <span className="hint">{hour(file.takenAt)}{file.durationSec ? ` · ${file.durationSec} s` : ''}</span>
    </div>
  );
}
