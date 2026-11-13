import { useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADMIN_ROLES } from '@toce/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { pick, readTable } from '../lib/tabular';
import { Dialog, ErrorBox } from '../components/Dialog';

type Specialty = { id: string; name: string };
type Sp = { id: string; scientificName: string; commonName: string | null; family: string | null; order: string | null; conservationStatus: string | null; isActive: boolean };
const PAGE = 50;

export function SpeciesPage() {
  const { can } = useAuth();
  const isAdmin = can(...ADMIN_ROLES);
  const qc = useQueryClient();
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: () => api<Specialty[]>('/specialties') });
  const [specId, setSpecId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Sp | 'new' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const spec = specId ?? specialties.data?.[0]?.id ?? null;
  const specName = specialties.data?.find((s) => s.id === spec)?.name ?? '';

  const list = useQuery({
    queryKey: ['species', spec, q, page],
    enabled: !!spec,
    placeholderData: keepPreviousData,
    queryFn: () => api<{ items: Sp[]; total: number }>(`/species?${new URLSearchParams({ specialtyId: spec!, q, limit: String(PAGE), offset: String(page * PAGE), includeInactive: 'true' })}`),
  });
  const toggle = useMutation({
    mutationFn: (s: Sp) => api(`/species/${s.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !s.isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['species'] }),
  });
  const total = list.data?.total ?? 0;

  return (
    <>
      <div className="page-head">
        <div><h1>Catálogo de especies</h1><p>Lista que aparece en el campo “Especie” del formulario, por especialidad.</p></div>
        {isAdmin && spec && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setImportOpen(true)}>Importar Excel / CSV</button>
            <button className="btn btn-primary" onClick={() => setEditing('new')}>Nueva especie</button>
          </div>
        )}
      </div>
      <div className="tabs" role="tablist">
        {(specialties.data ?? []).map((s) => <button key={s.id} role="tab" aria-selected={s.id === spec} onClick={() => { setSpecId(s.id); setPage(0); }}>{s.name}</button>)}
      </div>
      <div className="card">
        <div className="toolbar">
          <input className="input" placeholder="Buscar por nombre científico, común o familia" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Buscar especie" />
          <span className="muted" style={{ alignSelf: 'center' }}>{total.toLocaleString('es-PE')} especies</span>
        </div>
        {!list.data?.items.length ? <div className="empty">{q ? 'Sin resultados.' : `Aún no hay especies de ${specName}. Impórtalas desde Excel.`}</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nombre científico</th><th>Nombre común</th><th>Familia</th><th>Orden</th><th>Estado de conservación</th><th /></tr></thead>
              <tbody>
                {list.data.items.map((s) => (
                  <tr key={s.id} style={{ opacity: s.isActive ? 1 : 0.5 }}>
                    <td><i>{s.scientificName}</i></td><td>{s.commonName ?? '—'}</td><td>{s.family ?? '—'}</td><td>{s.order ?? '—'}</td><td>{s.conservationStatus ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {isAdmin && <><button className="btn btn-sm" onClick={() => setEditing(s)}>Editar</button>{' '}<button className="btn btn-sm" onClick={() => toggle.mutate(s)}>{s.isActive ? 'Ocultar' : 'Mostrar'}</button></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE && (
          <div className="toolbar" style={{ borderTop: '1px solid var(--border)', borderBottom: 0, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
            <span className="muted" style={{ alignSelf: 'center' }}>{page + 1} / {Math.ceil(total / PAGE)}</span>
            <button className="btn btn-sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Siguiente</button>
          </div>
        )}
      </div>
      {editing && spec && <SpeciesDialog specialtyId={spec} sp={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['species'] }); }} />}
      {importOpen && spec && <ImportSpeciesDialog specialtyId={spec} specialtyName={specName} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); qc.invalidateQueries({ queryKey: ['species'] }); }} />}
    </>
  );
}

function SpeciesDialog({ specialtyId, sp, onClose, onSaved }: { specialtyId: string; sp: Sp | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ scientificName: sp?.scientificName ?? '', commonName: sp?.commonName ?? '', family: sp?.family ?? '', order: sp?.order ?? '', conservationStatus: sp?.conservationStatus ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = { specialtyId, scientificName: f.scientificName.trim(), commonName: f.commonName || null, family: f.family || null, order: f.order || null, conservationStatus: f.conservationStatus || null };
      return sp ? api(`/species/${sp.id}`, { method: 'PATCH', body: JSON.stringify(body) }) : api('/species', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: onSaved,
  });
  return (
    <Dialog title={sp ? 'Editar especie' : 'Nueva especie'} onClose={onClose} onSubmit={() => save.mutate()}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!f.scientificName || save.isPending}>Guardar</button></>}>
      <ErrorBox error={save.error} />
      <div className="field"><label htmlFor="sp-sci">Nombre científico</label><input id="sp-sci" className="input" value={f.scientificName} onChange={set('scientificName')} required /></div>
      <div className="grid-2">
        <div className="field"><label htmlFor="sp-com">Nombre común</label><input id="sp-com" className="input" value={f.commonName} onChange={set('commonName')} /></div>
        <div className="field"><label htmlFor="sp-cons">Estado de conservación</label><input id="sp-cons" className="input" value={f.conservationStatus} onChange={set('conservationStatus')} placeholder="VU, EN, CR…" /></div>
        <div className="field"><label htmlFor="sp-fam">Familia</label><input id="sp-fam" className="input" value={f.family} onChange={set('family')} /></div>
        <div className="field"><label htmlFor="sp-ord">Orden</label><input id="sp-ord" className="input" value={f.order} onChange={set('order')} /></div>
      </div>
    </Dialog>
  );
}

type Row = { scientificName: string; commonName: string | null; family: string | null; order: string | null; conservationStatus: string | null };

function ImportSpeciesDialog({ specialtyId, specialtyName, onClose, onDone }: { specialtyId: string; specialtyName: string; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file?: File) {
    if (!file) return;
    setError(null);
    try {
      const data = await readTable(file);
      const r = data
        .map((x) => ({
          scientificName: pick(x, 'nombre_cientifico', 'especie', 'scientific_name', 'species', 'nombre'),
          commonName: pick(x, 'nombre_comun', 'common_name', 'comun') || null,
          family: pick(x, 'familia', 'family') || null,
          order: pick(x, 'orden', 'order') || null,
          conservationStatus: pick(x, 'estado_de_conservacion', 'estado_conservacion', 'categoria', 'iucn', 'conservacion') || null,
        }))
        .filter((x) => x.scientificName.length >= 2);
      if (!r.length) throw new Error('No se encontró la columna "Nombre científico" o "Especie"');
      setRows(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo');
    }
  }

  const save = useMutation({
    mutationFn: () => api<{ inserted: number; updated: number; duplicatesInFile: number }>('/species/import', { method: 'POST', body: JSON.stringify({ specialtyId, rows }) }),
    onSuccess: (r) => setResult(`${r.inserted} nuevas, ${r.updated} actualizadas${r.duplicatesInFile ? `, ${r.duplicatesInFile} repetidas en el archivo` : ''}.`),
  });

  return (
    <Dialog wide title={`Importar especies de ${specialtyName}`} onClose={result ? onDone : onClose} onSubmit={() => (result ? onDone() : save.mutate())}
      footer={result ? <button className="btn btn-primary">Listo</button> : <><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!rows?.length || save.isPending}>Importar {rows?.length ?? 0}</button></>}>
      <ErrorBox error={save.error ?? error} />
      {result ? <div className="ok-text" style={{ fontSize: 15 }}>{result}</div> : (
        <>
          <p className="hint">Columnas reconocidas: <b>Nombre científico</b> (o <b>Especie</b>), <b>Nombre común</b>, <b>Familia</b>, <b>Orden</b>, <b>Estado de conservación</b> (o <b>Categoría</b>). Las especies existentes se actualizan.</p>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" className="drop" onClick={() => fileRef.current?.click()}>{rows ? `${rows.length} especies leídas · elegir otro archivo` : 'Elegir archivo .xlsx o .csv'}</button>
          {!!rows?.length && (
            <div className="scroll-y" style={{ maxHeight: 260 }}>
              <table><thead><tr><th>Nombre científico</th><th>Común</th><th>Familia</th><th>Estado</th></tr></thead>
                <tbody>{rows.slice(0, 100).map((r, i) => <tr key={i}><td><i>{r.scientificName}</i></td><td>{r.commonName ?? '—'}</td><td>{r.family ?? '—'}</td><td>{r.conservationStatus ?? '—'}</td></tr>)}</tbody>
              </table>
              {rows.length > 100 && <p className="hint" style={{ padding: 8 }}>… y {rows.length - 100} más</p>}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
