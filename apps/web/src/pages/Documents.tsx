import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS, FILE_ORIGIN_FILTERS, FILE_ORIGIN_LABELS, FILE_TYPES, FILE_TYPE_LABELS,
  type DocumentCategory, type FileRow, type FileType, type FilesFacets, type FilesPage,
} from '@toce/shared';
import { api, download } from '../lib/api';
import { useProject } from '../lib/project';
import { Dialog, ErrorBox, NoProject } from '../components/Dialog';
import { FilePicker, fileProblem, uploadFiles } from '../components/Attachments';
import { BrigadeSelect, DateRange } from '../components/Filters';

type Filters = {
  origin: string; type: string; brigadeId: string; personId: string; stationId: string; methodId: string; from: string; to: string; q: string;
};
const EMPTY: Filters = { origin: '', type: '', brigadeId: '', personId: '', stationId: '', methodId: '', from: '', to: '', q: '' };
const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits: 1 })} MB`);
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const ICON: Record<FileType, string> = { foto: '🖼', audio: '🎧', documento: '📄', comprobante: '🧾' };
const qsOf = (f: Filters, extra: Record<string, string> = {}) =>
  new URLSearchParams(Object.fromEntries(Object.entries({ ...f, ...extra }).filter(([, v]) => v))).toString();

/** Documentos y evidencias (6): todo lo que se generó en el proyecto, filtrable y descargable en carpetas ordenadas. */
export function DocumentsPage() {
  const { project } = useProject();
  const [f, setF] = useState<Filters>(EMPTY);
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [open, setOpen] = useState<FileRow | null>(null);
  const [uploading, setUploading] = useState(false);
  const [zipMsg, setZipMsg] = useState<string | null>(null);
  const [zipErr, setZipErr] = useState<unknown>(null);
  useEffect(() => {
    const t = setTimeout(() => { setF((x) => ({ ...x, q: text.trim() })); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [text]);
  const set = (k: keyof Filters, v: string) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };
  const qs = qsOf(f);
  const list = useQuery({
    queryKey: ['files', project?.id, qs, page],
    enabled: !!project,
    queryFn: () => api<FilesPage>(`/projects/${project!.id}/files?${qsOf(f, { page: String(page) })}`),
    placeholderData: keepPreviousData,
  });
  const facets = useQuery({
    queryKey: ['files-facets', project?.id],
    enabled: !!project,
    queryFn: () => api<FilesFacets>(`/projects/${project!.id}/files/facets`),
  });
  if (!project) return <NoProject />;
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const filtered = Object.values(f).some(Boolean);

  const zip = async () => {
    setZipErr(null);
    try {
      const c = await api<{ ready: number; pending: number; bytes: number; max: number }>(`/projects/${project.id}/files/count${qs ? `?${qs}` : ''}`);
      if (!c.ready) { setZipMsg('No hay archivos subidos con estos filtros.'); return; }
      if (c.ready > c.max) { setZipMsg(`Son ${c.ready} archivos; filtra para bajar como máximo ${c.max} por vez.`); return; }
      setZipMsg(`Descargando ${c.ready} archivo${c.ready === 1 ? '' : 's'} (${mb(c.bytes)})${c.pending ? `; ${c.pending} siguen en los teléfonos y se listan en LEEME.txt` : ''}.`);
      await download(`/projects/${project.id}/files.zip${qs ? `?${qs}` : ''}`);
    } catch (e) {
      setZipErr(e);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Documentos y evidencias</h1>
          <p>Todos los archivos de {project.code} en un solo lugar: fotos, audios, comprobantes y documentos de campo, alertas, consultas, logística y reprogramaciones.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setUploading(true)}>Subir documento</button>
          <button className="btn btn-primary" onClick={() => void zip()} disabled={!d?.total}>Descargar en carpetas (ZIP)</button>
        </div>
      </div>
      {(zipMsg || zipErr) && (
        <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          {zipMsg && <span className="grow">{zipMsg} Las carpetas quedan como Proyecto / Brigada / Persona / Estación / Método / Unidad / Tipo.</span>}
          <ErrorBox error={zipErr} />
          <button className="icon-btn" onClick={() => { setZipMsg(null); setZipErr(null); }} aria-label="Cerrar aviso">×</button>
        </div>
      )}

      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', marginBottom: 16 }}>
        <button className="card stat" style={{ textAlign: 'left', cursor: 'pointer', outline: !f.type ? '2px solid var(--primary)' : undefined }} onClick={() => set('type', '')}>
          <div className="label">{filtered ? 'Encontrados' : 'Archivos'}</div><div className="value">{d?.total ?? '—'}</div>
          {d && <small className="hint">{mb(d.bytes)}</small>}
        </button>
        {FILE_TYPES.map((t) => (
          <button key={t} className="card stat" style={{ textAlign: 'left', cursor: 'pointer', outline: f.type === t ? '2px solid var(--primary)' : undefined }} onClick={() => set('type', f.type === t ? '' : t)} aria-pressed={f.type === t}>
            <div className="label">{FILE_TYPE_LABELS[t]}</div><div className="value">{d?.byType[t] ?? '—'}</div>
          </button>
        ))}
        {!!d?.pending && (
          <div className="card stat"><div className="label">Aún en teléfonos</div><div className="value" style={{ color: 'var(--warn)' }}>{d.pending}</div></div>
        )}
      </div>

      <div className="card">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <select className="input" value={f.origin} onChange={(e) => set('origin', e.target.value)} aria-label="Origen">
            <option value="">Todos los orígenes</option>
            {FILE_ORIGIN_FILTERS.map((o) => <option key={o} value={o}>{FILE_ORIGIN_LABELS[o]}</option>)}
          </select>
          <BrigadeSelect value={f.brigadeId} onChange={(v) => set('brigadeId', v)} brigades={facets.data?.brigades ?? []} />
          <select className="input" value={f.personId} onChange={(e) => set('personId', e.target.value)} aria-label="Persona">
            <option value="">Todas las personas</option>
            {facets.data?.people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
          <select className="input" value={f.stationId} onChange={(e) => set('stationId', e.target.value)} aria-label="Estación">
            <option value="">Todas las estaciones</option>
            {facets.data?.stations.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
          </select>
          <select className="input" value={f.methodId} onChange={(e) => set('methodId', e.target.value)} aria-label="Método">
            <option value="">Todos los métodos</option>
            {facets.data?.methods.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
          </select>
          <DateRange from={f.from} to={f.to} onFrom={(v) => set('from', v)} onTo={(v) => set('to', v)} />
          <input className="input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar unidad, nombre, estación o persona" aria-label="Buscar" style={{ minWidth: 220 }} />
          {filtered && <button className="btn btn-sm" onClick={() => { setF(EMPTY); setText(''); setPage(1); }}>Limpiar filtros</button>}
          <div className="segmented" role="group" aria-label="Vista" style={{ marginLeft: 'auto' }}>
            <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Miniaturas</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>Lista</button>
          </div>
        </div>

        <div style={{ opacity: list.isPlaceholderData ? 0.6 : 1 }}>
          {view === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, padding: 16 }}>
              {d?.rows.map((r) => (
                <button key={r.id} onClick={() => setOpen(r)} className="card" style={{ padding: 0, overflow: 'hidden', textAlign: 'left', cursor: 'pointer', boxShadow: 'none' }} title={r.label}>
                  <div style={{ aspectRatio: '4 / 3', background: 'var(--surface-2)', display: 'grid', placeItems: 'center', fontSize: 34 }}>
                    {r.thumbUrl ? <img src={r.thumbUrl} alt={r.label} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span aria-hidden>{ICON[r.type]}</span>}
                  </div>
                  <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.unitCode ?? r.label}</strong>
                    <small className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.unitCode ? r.label : [r.stationCode, FILE_ORIGIN_LABELS[r.origin]].filter(Boolean).join(' · ')}
                    </small>
                    <small className="hint">{when(r.takenAt)}{!r.uploaded ? ' · en el teléfono' : ''}</small>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Archivo</th><th>Origen</th><th>Brigada</th><th>Persona</th><th>Estación</th><th>Método</th><th>Unidad</th><th>Fecha</th><th style={{ textAlign: 'right' }}>Tamaño</th></tr>
                </thead>
                <tbody>
                  {d?.rows.map((r) => (
                    <tr key={r.id} onClick={() => setOpen(r)} style={{ cursor: 'pointer' }}>
                      <td>{ICON[r.type]} {r.label}{!r.uploaded && <span className="chip chip-warn" style={{ marginLeft: 6 }}>En el teléfono</span>}</td>
                      <td>{FILE_ORIGIN_LABELS[r.origin]}</td>
                      <td>{r.brigadeName ?? '—'}</td>
                      <td>{r.personName ?? '—'}</td>
                      <td>{r.stationCode ?? '—'}</td>
                      <td>{r.methodCode ?? '—'}</td>
                      <td>{r.unitCode ?? '—'}</td>
                      <td>{when(r.takenAt)}</td>
                      <td style={{ textAlign: 'right' }}>{r.sizeBytes ? mb(r.sizeBytes) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.isSuccess && !d?.rows.length && (
            <div className="empty" style={{ padding: 24 }}>{filtered ? 'No hay archivos con estos filtros.' : 'Aún no hay archivos. Las fotos y audios de campo aparecen aquí cuando los teléfonos los suben.'}</div>
          )}
        </div>
        {d && pages > 1 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', padding: 12 }}>
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
            <span className="hint">Página {page} de {pages}</span>
            <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Siguiente</button>
          </div>
        )}
        <ErrorBox error={list.error} />
      </div>

      {open && <Preview file={open} onClose={() => setOpen(null)} />}
      {uploading && facets.data && <UploadDialog projectId={project.id} facets={facets.data} onClose={() => setUploading(false)} />}
    </>
  );
}

function Preview({ file, onClose }: { file: FileRow; onClose: () => void }) {
  const qc = useQueryClient();
  const url = useQuery({
    queryKey: ['file-url', file.id],
    enabled: file.uploaded,
    queryFn: () => api<{ url: string }>(`/files/${file.id}/url`),
    staleTime: 10 * 60_000,
  });
  const [error, setError] = useState<unknown>(null);
  const get = async (original: boolean) => {
    setError(null);
    const w = window.open('', '_blank'); // antes del await para que el navegador no la bloquee
    try {
      const { url: u } = await api<{ url: string }>(`/files/${file.id}/url?download=1${original ? '&original=1' : ''}`);
      if (w) w.location.href = u; else window.location.assign(u);
    } catch (e) {
      w?.close();
      setError(e);
    }
  };
  const del = useMutation({
    mutationFn: () => api(`/documents/${file.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['files'] });
      void qc.invalidateQueries({ queryKey: ['files-facets'] });
      onClose();
    },
  });
  const src = url.data?.url;
  const isPdf = file.mimeType === 'application/pdf';

  return (
    <Dialog
      title={file.unitCode ? `${file.unitCode} · ${file.label}` : file.label}
      wide
      onClose={onClose}
      footer={<>
        {file.canDelete && (
          <button type="button" className="btn" style={{ marginRight: 'auto' }} disabled={del.isPending}
            onClick={() => confirm(`¿Borrar “${file.label}”? No se puede deshacer.`) && del.mutate()}>Borrar documento</button>
        )}
        {file.hasOriginal && <button type="button" className="btn" onClick={() => void get(true)}>Original (alta resolución)</button>}
        <button type="button" className="btn btn-primary" disabled={!file.uploaded} onClick={() => void get(false)}>Descargar</button>
      </>}
    >
      <div style={{ background: 'var(--surface-2)', borderRadius: 10, display: 'grid', placeItems: 'center', minHeight: 160, overflow: 'hidden' }}>
        {!file.uploaded ? <p className="hint" style={{ padding: 24 }}>Este archivo aún está en el teléfono; aparecerá cuando se sincronice.</p>
          : !src ? <p className="hint" style={{ padding: 24 }}>{url.isError ? 'No se pudo cargar.' : 'Cargando…'}</p>
            : file.type === 'foto' ? <img src={src} alt={file.label} style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }} />
              : file.type === 'audio' ? <audio src={src} controls style={{ width: '90%', margin: 24 }} />
                : isPdf ? <iframe src={src} title={file.label} style={{ width: '100%', height: '60vh', border: 0 }} />
                  : <p style={{ padding: 24, fontSize: 40 }} aria-hidden>{ICON[file.type]}</p>}
      </div>
      <dl className="kv" style={{ marginTop: 14 }}>
        <dt>Origen</dt><dd>{FILE_ORIGIN_LABELS[file.origin]}</dd>
        <dt>Brigada</dt><dd>{file.brigadeName ?? '—'}</dd>
        <dt>Persona</dt><dd>{file.personName ?? '—'}</dd>
        <dt>Estación</dt><dd>{file.stationCode ?? '—'}</dd>
        <dt>Método</dt><dd>{file.methodCode ? `${file.methodCode} · ${file.methodName ?? ''}` : '—'}</dd>
        <dt>Unidad</dt><dd>{file.unitCode ?? '—'}</dd>
        <dt>Fecha</dt><dd>{when(file.takenAt)}</dd>
        {file.lat != null && file.lng != null && <><dt>GPS</dt><dd>{file.lat.toFixed(6)}, {file.lng.toFixed(6)}</dd></>}
        <dt>Subió</dt><dd>{file.uploadedByName}</dd>
        <dt>Tamaño</dt><dd>{file.sizeBytes ? mb(file.sizeBytes) : '—'}</dd>
      </dl>
      <ErrorBox error={error ?? del.error} />
    </Dialog>
  );
}

function UploadDialog({ projectId, facets, onClose }: { projectId: string; facets: FilesFacets; onClose: () => void }) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState<DocumentCategory>('acta');
  const [brigadeId, setBrigadeId] = useState('');
  const [stationId, setStationId] = useState('');
  const problem = fileProblem(files);
  const save = useMutation({
    mutationFn: async () => {
      await uploadFiles((x) => `/projects/${projectId}/documents?${new URLSearchParams({ name: x.name, category, ...(brigadeId ? { brigadeId } : {}), ...(stationId ? { stationId } : {}) })}`, files);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['files'] });
      void qc.invalidateQueries({ queryKey: ['files-facets'] });
      onClose();
    },
  });
  return (
    <Dialog
      title="Subir documentos del proyecto"
      onClose={onClose}
      onSubmit={() => files.length && !problem && !save.isPending && save.mutate()}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={!files.length || !!problem || save.isPending}>
          {save.isPending ? 'Subiendo…' : `Subir ${files.length || ''}`.trim()}
        </button>
      </>}
    >
      <p className="hint" style={{ marginTop: 0 }}>Actas, permisos, informes o formatos escaneados. Se ordenan solos por brigada y estación en el ZIP.</p>
      <div className="grid-2">
        <label className="field">
          <span className="label">Tipo de documento</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
            {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{DOCUMENT_CATEGORY_LABELS[c]}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Brigada (opcional)</span>
          <select className="input" value={brigadeId} onChange={(e) => setBrigadeId(e.target.value)}>
            <option value="">General del proyecto</option>
            {facets.brigades.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Estación (opcional)</span>
          <select className="input" value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">—</option>
            {facets.stations.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
          </select>
        </label>
      </div>
      <FilePicker files={files} onChange={setFiles} label="Elegir archivos" />
      <ErrorBox error={problem ? new Error(problem) : save.error} />
    </Dialog>
  );
}
