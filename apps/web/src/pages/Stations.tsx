import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeatureCollection } from 'geojson';
import { ADMIN_ROLES, formatUtm, latLngToUtm, utmToLatLng } from '@toce/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { pick, readTable } from '../lib/tabular';
import { MapLegend, MapView } from '../components/MapView';
import { Dialog, ErrorBox, NoProject } from '../components/Dialog';

export type StationMethod = { methodId: string; code: string; name: string; specialtyId: string; specialtyCode: string; isOpenEnded: boolean; unitsRequired: number; unitsDone: number };
export type Station = {
  id: string; code: string; name: string | null; lat: number; lng: number; altitude: number | null;
  vegetationUnit: string | null; influenceArea: string | null; overlap: string | null; accessNotes: string | null; status: string;
  methods: StationMethod[]; units: number; schedules: number;
};
type Specialty = { id: string; code: string; name: string };
type Method = { id: string; code: string; name: string; specialtyId: string; isOpenEnded: boolean; defaultUnitsRequired: number };
type Unit = { id: string; code: string; status: string; methodCode: string; specialtyCode: string };

const UNIT_STATUS: Record<string, string> = { pendiente: 'Pendiente', en_ejecucion: 'En ejecución', fotos_ok: 'Fotos OK', completada: 'Completada', no_realizada: 'No realizada' };

export function StationsPage() {
  const { project } = useProject();
  const { can } = useAuth();
  const isAdmin = can(...ADMIN_ROLES);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Station | 'new' | null>(null);
  const [editingMethods, setEditingMethods] = useState<Station | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const stations = useQuery({ queryKey: ['stations', project?.id], enabled: !!project, queryFn: () => api<Station[]>(`/projects/${project!.id}/stations`) });
  const layers = useQuery({ queryKey: ['layers', project?.id], enabled: !!project, queryFn: () => api<FeatureCollection>(`/projects/${project!.id}/layers`) });
  const del = useMutation({
    mutationFn: (id: string) => api(`/stations/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setSelected(null); qc.invalidateQueries({ queryKey: ['stations'] }); qc.invalidateQueries({ queryKey: ['projects'] }); },
    onError: (e) => alert(e instanceof Error ? e.message : 'Error'),
  });

  if (!project) return <NoProject />;
  const list = (stations.data ?? []).filter((s) => !q || `${s.code} ${s.name ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const current = stations.data?.find((s) => s.id === selected) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Estaciones de monitoreo</h1>
          <p>{stations.data?.length ?? 0} estaciones en {project.code}. Cada estación tiene métodos de una o varias especialidades.</p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setImportOpen(true)}>Importar Excel / CSV</button>
            <button className="btn btn-primary" onClick={() => setEditing('new')}>Nueva estación</button>
          </div>
        )}
      </div>
      <div className="split">
        <div className="card" style={{ padding: 12 }}>
          <MapView
            layers={layers.data}
            stations={(stations.data ?? []).map((s) => ({ id: s.id, code: s.code, lat: s.lat, lng: s.lng, selected: s.id === selected, color: s.id === selected ? '#E03131' : s.methods.length ? '#1F5C45' : '#868E96' }))}
            onStationClick={setSelected}
            height={560}
            fitKey={`${project.id}|${stations.data?.length ?? 0}|${layers.data?.features.length ?? 0}`}
          />
          <MapLegend />
        </div>
        <div className="card">
          {current ? (
            <StationDetail
              station={current}
              isAdmin={isAdmin}
              onBack={() => setSelected(null)}
              onEdit={() => setEditing(current)}
              onMethods={() => setEditingMethods(current)}
              onDelete={() => confirm(`¿Eliminar la estación ${current.code}?`) && del.mutate(current.id)}
            />
          ) : (
            <>
              <div className="toolbar"><input className="input" placeholder="Buscar estación" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar estación" /></div>
              <div className="list scroll-y" style={{ maxHeight: 560 }}>
                {stations.isLoading && <div className="empty">Cargando…</div>}
                {!stations.isLoading && !list.length && <div className="empty">No hay estaciones. Créalas aquí o impórtalas desde un KMZ en Mapa y capas.</div>}
                {list.map((s) => (
                  <button key={s.id} className="list-item" onClick={() => setSelected(s.id)}>
                    <div className="grow">
                      <strong>{s.code}</strong> {s.name && <span className="muted">· {s.name}</span>}
                      <small>{[s.influenceArea, s.vegetationUnit].filter(Boolean).join(' · ') || 'Sin clasificar'}</small>
                    </div>
                    <span className="chip">{s.methods.length ? `${s.methods.length} métodos · ${s.units} u.` : 'Sin métodos'}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {editing && (
        <StationDialog
          projectId={project.id}
          utmZone={project.utmZone ?? 18}
          station={editing === 'new' ? null : editing}
          layers={layers.data}
          onClose={() => setEditing(null)}
          onSaved={(id) => { setEditing(null); setSelected(id); qc.invalidateQueries({ queryKey: ['stations'] }); qc.invalidateQueries({ queryKey: ['projects'] }); }}
        />
      )}
      {editingMethods && <MethodsDialog station={editingMethods} onClose={() => setEditingMethods(null)} onSaved={() => { setEditingMethods(null); qc.invalidateQueries({ queryKey: ['stations'] }); qc.invalidateQueries({ queryKey: ['units'] }); }} />}
      {importOpen && <ImportStationsDialog projectId={project.id} utmZone={project.utmZone ?? 18} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); qc.invalidateQueries({ queryKey: ['stations'] }); qc.invalidateQueries({ queryKey: ['projects'] }); }} />}
    </>
  );
}

function StationDetail({ station: s, isAdmin, onBack, onEdit, onMethods, onDelete }: { station: Station; isAdmin: boolean; onBack: () => void; onEdit: () => void; onMethods: () => void; onDelete: () => void }) {
  const units = useQuery({ queryKey: ['units', s.id], queryFn: () => api<Unit[]>(`/stations/${s.id}/units`) });
  const utm = latLngToUtm(s.lat, s.lng);
  const bySpec = groupBy(s.methods, (m) => m.specialtyCode);
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-sm" onClick={onBack}>← Lista</button>
        <h2 style={{ flex: 1 }}>{s.code}</h2>
        {isAdmin && <><button className="btn btn-sm" onClick={onEdit}>Editar</button><button className="btn btn-sm btn-danger" onClick={onDelete}>Eliminar</button></>}
      </div>
      <dl className="kv">
        {s.name && <><dt>Nombre</dt><dd>{s.name}</dd></>}
        <dt>UTM</dt><dd>{formatUtm(utm)}</dd>
        <dt>Geográficas</dt><dd>{s.lat.toFixed(6)}, {s.lng.toFixed(6)}</dd>
        {s.altitude != null && <><dt>Altitud</dt><dd>{s.altitude} m s.n.m.</dd></>}
        <dt>Ubicación</dt><dd>{s.influenceArea ?? '—'}</dd>
        <dt>Unidad de vegetación</dt><dd>{s.vegetationUnit ?? '—'}</dd>
        <dt>Superposición</dt><dd>{s.overlap ?? '—'}</dd>
        {s.accessNotes && <><dt>Acceso</dt><dd>{s.accessNotes}</dd></>}
      </dl>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div className="section-title" style={{ flex: 1 }}>Esfuerzo de muestreo</div>
        {isAdmin && <button className="btn btn-sm" onClick={onMethods}>Configurar métodos</button>}
      </div>
      {!s.methods.length && <div className="hint">Sin métodos habilitados.</div>}
      {Object.entries(bySpec).map(([spec, ms]) => (
        <div key={spec}>
          <div className="hint" style={{ fontWeight: 600 }}>{spec}</div>
          {ms.map((m) => (
            <div key={m.methodId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
              <span><strong>{m.code}</strong> {m.name}</span>
              <span className="muted">{m.isOpenEnded ? 'Abiertos' : `${m.unitsDone}/${m.unitsRequired}`}</span>
            </div>
          ))}
        </div>
      ))}
      {!!units.data?.length && (
        <>
          <div className="section-title">Unidades de muestreo ({units.data.length})</div>
          <div className="pill-list">
            {units.data.map((u) => <span key={u.id} className={'chip' + (u.status === 'completada' ? ' chip-ok' : '')} title={UNIT_STATUS[u.status]}>{u.code}</span>)}
          </div>
        </>
      )}
    </div>
  );
}

function StationDialog({ projectId, utmZone, station, layers, onClose, onSaved }: {
  projectId: string; utmZone: number; station: Station | null; layers?: FeatureCollection; onClose: () => void; onSaved: (id: string) => void;
}) {
  const initUtm = station ? latLngToUtm(station.lat, station.lng) : null;
  const [mode, setMode] = useState<'utm' | 'geo'>('utm');
  const [f, setF] = useState({
    code: station?.code ?? '', name: station?.name ?? '', altitude: station?.altitude?.toString() ?? '', accessNotes: station?.accessNotes ?? '',
    lat: station?.lat.toFixed(6) ?? '', lng: station?.lng.toFixed(6) ?? '',
    zone: String(initUtm?.zone ?? utmZone), east: initUtm?.easting.toString() ?? '', north: initUtm?.northing.toString() ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const coords = useMemo(() => {
    if (mode === 'geo') {
      const lat = Number(f.lat), lng = Number(f.lng);
      return f.lat && f.lng && isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
    }
    const e = Number(f.east), n = Number(f.north);
    return f.east && f.north && e > 100000 && e < 900000 && n > 0 && n < 10000000 ? utmToLatLng(Number(f.zone), 'S', e, n) : null;
  }, [mode, f]);

  const setFromMap = (lat: number, lng: number) => {
    const u = latLngToUtm(lat, lng);
    setF({ ...f, lat: lat.toFixed(6), lng: lng.toFixed(6), zone: String(u.zone), east: String(u.easting), north: String(u.northing) });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!coords) throw new Error('Coordenadas inválidas');
      const body = { code: f.code.trim(), name: f.name || null, lat: coords.lat, lng: coords.lng, altitude: f.altitude ? Math.round(Number(f.altitude)) : null, accessNotes: f.accessNotes || null };
      if (station) { await api(`/stations/${station.id}`, { method: 'PATCH', body: JSON.stringify(body) }); return station.id; }
      return (await api<{ id: string }>(`/projects/${projectId}/stations`, { method: 'POST', body: JSON.stringify(body) })).id;
    },
    onSuccess: onSaved,
  });

  return (
    <Dialog
      wide
      title={station ? `Editar ${station.code}` : 'Nueva estación'}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={save.isPending || !coords || !f.code}>{save.isPending ? 'Guardando…' : 'Guardar'}</button></>}
    >
      <ErrorBox error={save.error} />
      <div className="grid-3">
        <div className="field"><label htmlFor="s-code">Código</label><input id="s-code" className="input" value={f.code} onChange={set('code')} placeholder="EM-23" required /></div>
        <div className="field"><label htmlFor="s-name">Nombre (opcional)</label><input id="s-name" className="input" value={f.name} onChange={set('name')} /></div>
        <div className="field"><label htmlFor="s-alt">Altitud (m)</label><input id="s-alt" className="input" inputMode="numeric" value={f.altitude} onChange={set('altitude')} /></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="section-title" style={{ margin: 0 }}>Coordenadas</span>
        <div className="segmented" role="group" aria-label="Sistema de coordenadas">
          <button type="button" aria-pressed={mode === 'utm'} onClick={() => setMode('utm')}>UTM WGS84</button>
          <button type="button" aria-pressed={mode === 'geo'} onClick={() => setMode('geo')}>Geográficas</button>
        </div>
        <span className="hint">o haz clic en el mapa</span>
      </div>
      {mode === 'utm' ? (
        <div className="grid-3">
          <div className="field"><label htmlFor="s-zone">Zona</label><select id="s-zone" className="input" value={f.zone} onChange={set('zone')}>{[17, 18, 19].map((z) => <option key={z} value={z}>{z}S</option>)}</select></div>
          <div className="field"><label htmlFor="s-e">Este (m)</label><input id="s-e" className="input" inputMode="numeric" value={f.east} onChange={set('east')} placeholder="488842" /></div>
          <div className="field"><label htmlFor="s-n">Norte (m)</label><input id="s-n" className="input" inputMode="numeric" value={f.north} onChange={set('north')} placeholder="8828136" /></div>
        </div>
      ) : (
        <div className="grid-2">
          <div className="field"><label htmlFor="s-lat">Latitud</label><input id="s-lat" className="input" value={f.lat} onChange={set('lat')} placeholder="-10.601000" /></div>
          <div className="field"><label htmlFor="s-lng">Longitud</label><input id="s-lng" className="input" value={f.lng} onChange={set('lng')} placeholder="-75.102000" /></div>
        </div>
      )}
      <MapView layers={layers} stations={[]} pick={coords} onMapClick={setFromMap} height={260} fitKey={station?.id ?? 'new'} />
      <div className="field"><label htmlFor="s-acc">Indicaciones de acceso</label><textarea id="s-acc" className="input" value={f.accessNotes} onChange={set('accessNotes')} /></div>
      <p className="hint">AID/AII, unidad de vegetación y superposición se calculan con las capas del proyecto al guardar.</p>
    </Dialog>
  );
}

function MethodsDialog({ station, onClose, onSaved }: { station: Station; onClose: () => void; onSaved: () => void }) {
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: () => api<Specialty[]>('/specialties') });
  const methods = useQuery({ queryKey: ['methods'], queryFn: () => api<Method[]>('/methods') });
  const [sel, setSel] = useState<Map<string, number>>(() => new Map(station.methods.map((m) => [m.methodId, m.unitsRequired])));
  const save = useMutation({
    mutationFn: () => api(`/stations/${station.id}/methods`, { method: 'PUT', body: JSON.stringify({ methods: [...sel].map(([methodId, unitsRequired]) => ({ methodId, unitsRequired })) }) }),
    onSuccess: onSaved,
  });
  const toggle = (m: Method) => {
    const next = new Map(sel);
    if (next.has(m.id)) next.delete(m.id); else next.set(m.id, m.isOpenEnded ? 0 : m.defaultUnitsRequired);
    setSel(next);
  };
  const totalUnits = (methods.data ?? []).filter((m) => sel.has(m.id) && !m.isOpenEnded).reduce((a, m) => a + (sel.get(m.id) ?? 0), 0);

  return (
    <Dialog
      wide
      title={`Métodos de ${station.code}`}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      footer={<><span className="hint" style={{ marginRight: 'auto' }}>Se generarán {totalUnits} unidades de muestreo</span><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</button></>}
    >
      <ErrorBox error={save.error} />
      <p className="hint">Marca los métodos que se ejecutarán aquí y el número de unidades (esfuerzo). Cada especialista verá solo los de su especialidad.</p>
      <div className="grid-2">
        {(specialties.data ?? []).map((sp) => (
          <div key={sp.id}>
            <div className="section-title">{sp.name}</div>
            {(methods.data ?? []).filter((m) => m.specialtyId === sp.id).map((m) => (
              <label key={m.id} className="method-row">
                <input type="checkbox" checked={sel.has(m.id)} onChange={() => toggle(m)} />
                <span><strong>{m.code}</strong> {m.name}</span>
                {m.isOpenEnded ? <span className="hint">Abiertos</span> : (
                  <input
                    type="number" min={1} max={500} className="input" disabled={!sel.has(m.id)}
                    value={sel.get(m.id) ?? m.defaultUnitsRequired}
                    onChange={(e) => setSel(new Map(sel).set(m.id, Math.max(1, Number(e.target.value) || 1)))}
                    aria-label={`Unidades de ${m.code}`}
                  />
                )}
              </label>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function ImportStationsDialog({ projectId, utmZone, onClose, onDone }: { projectId: string; utmZone: number; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<{ code: string; name: string | null; lat: number; lng: number; altitude: number | null }[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file?: File) {
    if (!file) return;
    try {
      const data = await readTable(file);
      const ok: NonNullable<typeof rows> = [];
      const errs: string[] = [];
      data.forEach((r, i) => {
        const code = pick(r, 'codigo', 'code', 'estacion', 'cod');
        const e = Number(pick(r, 'este', 'easting', 'x', 'utm_este', 'e').replace(',', '.'));
        const n = Number(pick(r, 'norte', 'northing', 'y', 'utm_norte', 'n').replace(',', '.'));
        const lat = Number(pick(r, 'latitud', 'lat').replace(',', '.'));
        const lng = Number(pick(r, 'longitud', 'lng', 'lon').replace(',', '.'));
        const zone = Number(pick(r, 'zona', 'zone').replace(/\D/g, '')) || utmZone;
        const alt = pick(r, 'altitud', 'altura', 'cota', 'alt');
        let c: { lat: number; lng: number } | null = null;
        if (e && n) c = utmToLatLng(zone, 'S', e, n);
        else if (lat && lng) c = { lat, lng };
        if (!code) errs.push(`Fila ${i + 2}: falta el código`);
        else if (!c) errs.push(`Fila ${i + 2} (${code}): faltan coordenadas (Este/Norte o Latitud/Longitud)`);
        else ok.push({ code: code.toUpperCase(), name: pick(r, 'nombre', 'name', 'descripcion') || null, lat: c.lat, lng: c.lng, altitude: alt ? Math.round(Number(alt.replace(',', '.'))) || null : null });
      });
      setRows(ok);
      setErrors(errs);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'No se pudo leer el archivo']);
    }
  }

  const save = useMutation({
    mutationFn: () => api<{ created: number; updated: number }>(`/projects/${projectId}/stations/import`, { method: 'POST', body: JSON.stringify({ stations: rows }) }),
    onSuccess: (r) => setResult(`${r.created} estaciones nuevas y ${r.updated} actualizadas.`),
  });

  return (
    <Dialog
      wide
      title="Importar estaciones"
      onClose={result ? onDone : onClose}
      onSubmit={() => (result ? onDone() : save.mutate())}
      footer={result ? <button className="btn btn-primary">Listo</button> : <><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!rows?.length || save.isPending}>Importar {rows?.length ?? 0}</button></>}
    >
      <ErrorBox error={save.error} />
      {result ? <div className="ok-text" style={{ fontSize: 15 }}>{result}</div> : (
        <>
          <p className="hint">Columnas reconocidas: <b>Código</b>, <b>Este</b> y <b>Norte</b> (UTM, zona {utmZone}S por defecto o columna <b>Zona</b>) o <b>Latitud</b>/<b>Longitud</b>, y opcionalmente <b>Nombre</b> y <b>Altitud</b>. Las estaciones con el mismo código se actualizan.</p>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" className="drop" onClick={() => fileRef.current?.click()}>{rows ? `${rows.length} estaciones listas · elegir otro archivo` : 'Elegir archivo .xlsx o .csv'}</button>
          {errors.length > 0 && <div className="alert-error">{errors.slice(0, 8).map((e) => <div key={e}>{e}</div>)}{errors.length > 8 && <div>… y {errors.length - 8} más</div>}</div>}
          {!!rows?.length && (
            <div className="scroll-y" style={{ maxHeight: 240 }}>
              <table><thead><tr><th>Código</th><th>Nombre</th><th>UTM</th><th>Altitud</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.code}><td>{r.code}</td><td>{r.name ?? '—'}</td><td className="muted">{formatUtm(latLngToUtm(r.lat, r.lng))}</td><td>{r.altitude ?? '—'}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, x) => { (acc[key(x)] ??= []).push(x); return acc; }, {});
}
