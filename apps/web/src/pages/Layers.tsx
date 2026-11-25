import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Feature, FeatureCollection } from 'geojson';
import { ADMIN_ROLES, LAYER_KINDS, LAYER_KIND_LABELS, type LayerTreeLeaf } from '@toce/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { parseKmlDocument, stationCodeFrom, type ParsedFeature } from '../lib/kmz';
import { MapView } from '../components/MapView';
import { LayerTree, leafId, useLayerVisibility } from '../components/LayerTree';
import { Dialog, ErrorBox, NoProject } from '../components/Dialog';

type Station = { id: string; code: string; lat: number; lng: number };
type Brigade = { id: string; name: string };

export function LayersPage() {
  const { project } = useProject();
  const { can } = useAuth();
  const admin = can(...ADMIN_ROLES);
  const qc = useQueryClient();
  const [importing, setImporting] = useState<{ file: string; title: string | null; features: ParsedFeature[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pid = project?.id;

  const tree = useQuery({ queryKey: ['layer-tree', pid], enabled: !!pid, queryFn: () => api<LayerTreeLeaf[]>(`/projects/${pid}/layer-tree`) });
  const leaves = useMemo(() => tree.data ?? [], [tree.data]);
  const { visible, set } = useLayerVisibility(pid, leaves);
  const areas = useQuery({ queryKey: ['brigade-areas', pid], enabled: !!pid, queryFn: () => api<FeatureCollection>(`/projects/${pid}/brigade-areas`) });
  const stations = useQuery({ queryKey: ['stations', pid], enabled: !!pid, queryFn: () => api<Station[]>(`/projects/${pid}/stations`) });
  const brigades = useQuery({ queryKey: ['brigades', pid], enabled: !!pid, queryFn: () => api<Brigade[]>(`/projects/${pid}/brigades`) });

  // Solo se descargan las carpetas encendidas; cada una queda en caché al apagarla y volverla a prender.
  const shown = leaves.filter((l) => visible.has(leafId(l)));
  const parts = useQueries({
    queries: shown.map((l) => ({
      queryKey: ['layers', pid, l.sourceFile, l.folderPath],
      staleTime: 5 * 60_000,
      queryFn: () => {
        const q = new URLSearchParams({ source: l.sourceFile ?? '', folder: JSON.stringify(l.folderPath) });
        return api<FeatureCollection>(`/projects/${pid}/layers?${q}`);
      },
    })),
  });
  const loading = new Set(shown.filter((_, i) => parts[i]?.isPending).map(leafId));
  const loadedCount = parts.filter((p) => p.data).length;
  // Encuadre: una vez por proyecto, cuando termina la primera carga (después no se mueve al prender/apagar).
  const [fitted, setFitted] = useState<string | null>(null);
  if (pid && fitted !== pid && tree.isSuccess && loading.size === 0 && loadedCount === shown.length) setFitted(pid);
  // Cambia solo cuando cambia qué carpetas están cargadas (no en cada render).
  const partsKey = parts.map((p, i) => `${leafId(shown[i]!)}@${p.dataUpdatedAt}`).join('|');
  const layers = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: parts.flatMap((p): Feature[] => p.data?.features ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [partsKey]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['layer-tree'] });
    qc.invalidateQueries({ queryKey: ['layers'] });
    qc.invalidateQueries({ queryKey: ['stations'] });
    qc.invalidateQueries({ queryKey: ['projects'] });
  };
  const patch = useMutation({
    mutationFn: (body: { sourceFile: string | null; folderPath?: string[]; kind?: string; brigadeId?: string | null }) =>
      api(`/projects/${pid}/layer-groups`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (sourceFile: string | null) => api(`/projects/${pid}/layer-groups`, { method: 'DELETE', body: JSON.stringify({ sourceFile, folderPath: [] }) }),
    onSuccess: refresh,
  });

  if (!project) return <NoProject />;
  const total = leaves.reduce((s, l) => s + l.count, 0);

  async function onFile(file?: File) {
    if (!file) return;
    setParseError(null);
    setReading(true);
    try {
      const doc = await parseKmlDocument(file);
      setImporting({ file: file.name, title: doc.title, features: doc.features });
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'No se pudo leer el archivo');
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mapa y capas</h1>
          <p>Capas de cada KMZ de {project.code} con sus carpetas. Activa o desactiva lo que quieras ver; las estaciones se clasifican automáticamente con estas capas.</p>
        </div>
        {admin && (
          <>
            <input ref={fileRef} type="file" accept=".kmz,.kml" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button className="btn btn-primary" disabled={reading} onClick={() => fileRef.current?.click()}>{reading ? 'Leyendo archivo…' : 'Importar KMZ / KML'}</button>
          </>
        )}
      </div>
      {parseError && <div className="alert-error" style={{ marginBottom: 12 }}>{parseError}</div>}
      <ErrorBox error={patch.error ?? remove.error ?? tree.error} />
      <div className="split">
        <div className="card" style={{ padding: 12 }}>
          <MapView layers={layers} areas={areas.data} stations={stations.data ?? []} height={620} fitKey={`${pid}|${fitted === pid}`} />
        </div>
        <div className="card">
          <div className="toolbar" style={{ alignItems: 'center' }}>
            <strong style={{ flex: 1 }}>{total.toLocaleString('es-PE')} elementos</strong>
            {leaves.length > 0 && (
              <>
                <button type="button" className="btn btn-sm" onClick={() => set(leaves.map(leafId), true)}>Mostrar todo</button>
                <button type="button" className="btn btn-sm" onClick={() => set(leaves.map(leafId), false)}>Ocultar todo</button>
              </>
            )}
          </div>
          <div className="scroll-y" style={{ maxHeight: 620 }}>
            {tree.isPending ? <div className="empty">Cargando capas…</div> : (
              <LayerTree
                leaves={leaves}
                visible={visible}
                onToggle={set}
                loading={loading}
                brigades={brigades.data ?? []}
                admin={admin ? {
                  setKind: (sourceFile, folderPath, kind) => patch.mutate({ sourceFile, folderPath, kind }),
                  setBrigade: (sourceFile, brigadeId) => patch.mutate({ sourceFile, brigadeId }),
                  remove: (sourceFile, title) => confirm(`¿Eliminar todas las capas de "${title}"?`) && remove.mutate(sourceFile),
                } : undefined}
              />
            )}
          </div>
        </div>
      </div>
      {importing && (
        <ImportDialog
          projectId={project.id}
          file={importing.file}
          title={importing.title}
          initial={importing.features}
          brigades={brigades.data ?? []}
          existingCodes={new Set((stations.data ?? []).map((s) => s.code))}
          onClose={() => setImporting(null)}
          onDone={() => { setImporting(null); refresh(); }}
        />
      )}
    </>
  );
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Brigada cuyo nombre aparece en el título o el nombre del archivo ("Brigada Costa 1" -> Costa 1). */
function guessBrigade(brigades: Brigade[], text: string): string {
  const hay = ` ${norm(text)} `;
  const hits = brigades.filter((b) => norm(b.name) && hay.includes(` ${norm(b.name)} `));
  return hits.sort((a, b) => b.name.length - a.name.length)[0]?.id ?? '';
}

type Folder = { key: string; path: string[]; include: boolean; kind: ParsedFeature['kind']; count: number; points: number; lines: number; polygons: number };
type Pt = { i: number; name: string; folder: string; asStation: boolean; code: string };

function ImportDialog({ projectId, file, title, initial, brigades, existingCodes, onClose, onDone }: {
  projectId: string; file: string; title: string | null; initial: ParsedFeature[]; brigades: Brigade[];
  existingCodes: Set<string>; onClose: () => void; onDone: () => void;
}) {
  const [brigadeId, setBrigadeId] = useState(() => guessBrigade(brigades, `${title ?? ''} ${file.replace(/[_.]/g, ' ')}`));
  // Una fila por carpeta hoja (en el orden del archivo); el tipo se elige por carpeta.
  const [folders, setFolders] = useState<Folder[]>(() => {
    const by = new Map<string, Folder>();
    const kinds = new Map<string, Map<string, number>>();
    for (const f of initial) {
      const key = JSON.stringify(f.folderPath);
      let x = by.get(key);
      if (!x) { x = { key, path: f.folderPath, include: true, kind: f.kind, count: 0, points: 0, lines: 0, polygons: 0 }; by.set(key, x); kinds.set(key, new Map()); }
      x.count++;
      const t = f.geometry.type;
      if (t.includes('Point')) x.points++; else if (t.includes('Line')) x.lines++; else x.polygons++;
      const k = kinds.get(key)!;
      k.set(f.kind, (k.get(f.kind) ?? 0) + 1);
    }
    for (const [key, x] of by) x.kind = [...kinds.get(key)!].sort((a, b) => b[1] - a[1])[0]![0] as Folder['kind'];
    return [...by.values()];
  });
  // Puntos con código EM: se proponen como estaciones (y no se guardan además como capa).
  const [pts, setPts] = useState<Pt[]>(() => initial.flatMap((f, i) => {
    if (!f.isPoint || f.geometry.type !== 'Point') return [];
    const code = stationCodeFrom(f.name);
    return code ? [{ i, name: f.name, folder: f.folder, asStation: true, code }] : [];
  }));
  const [result, setResult] = useState<string | null>(null);
  const updFolder = (key: string, patch: Partial<Folder>) => setFolders((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const updPt = (i: number, patch: Partial<Pt>) => setPts((ps) => ps.map((p) => (p.i === i ? { ...p, ...patch } : p)));

  const asStation = useMemo(() => new Set(pts.filter((p) => p.asStation && p.code).map((p) => p.i)), [pts]);
  const folderBy = useMemo(() => new Map(folders.map((f) => [f.key, f])), [folders]);
  const layerFeats = useMemo(
    () => initial.map((f, i) => ({ f, i, folder: folderBy.get(JSON.stringify(f.folderPath))! })).filter(({ i, folder }) => folder.include && !asStation.has(i)),
    [initial, folderBy, asStation],
  );

  const preview = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: layerFeats.map(({ f, i, folder }) => ({ type: 'Feature', id: i, geometry: f.geometry, properties: { kind: folder.kind, name: f.name, color: f.color, folderPath: f.folderPath } })),
  }), [layerFeats]);
  const previewStations = pts
    .filter((p) => p.asStation && p.code)
    .map((p) => { const [lng, lat] = (initial[p.i]!.geometry as { coordinates: number[] }).coordinates as [number, number]; return { id: String(p.i), code: p.code, lat, lng }; });

  const save = useMutation({
    mutationFn: async () => {
      let msg = '';
      if (layerFeats.length) {
        const r = await api<{ imported: number; replaced: number }>(`/projects/${projectId}/layers`, {
          method: 'POST',
          body: JSON.stringify({
            sourceFile: file,
            sourceTitle: title,
            brigadeId: brigadeId || null,
            features: layerFeats.map(({ f, folder }) => {
              const { name: _n, ...properties } = f.properties;
              return { kind: folder.kind, name: f.name.slice(0, 200), color: f.color, folderPath: f.folderPath, geometry: f.geometry, properties };
            }),
          }),
        });
        msg += `${r.imported.toLocaleString('es-PE')} elementos importados${r.replaced ? ` (reemplazan ${r.replaced.toLocaleString('es-PE')} de la importación anterior de este archivo)` : ''}. `;
      }
      const sts = pts.filter((p) => p.asStation && p.code);
      if (sts.length) {
        const r = await api<{ created: number; updated: number }>(`/projects/${projectId}/stations/import`, {
          method: 'POST',
          body: JSON.stringify({ stations: sts.map((s) => { const f = initial[s.i]!; const [lng, lat] = (f.geometry as { coordinates: number[] }).coordinates as [number, number]; return { code: s.code, name: f.name !== s.code ? f.name : null, lat, lng }; }) }),
        });
        msg += `${r.created} estaciones nuevas, ${r.updated} actualizadas.`;
      }
      return msg || 'Nada que importar.';
    },
    onSuccess: setResult,
  });

  const types = (f: Folder) => [f.polygons && `${f.polygons} áreas`, f.lines && `${f.lines} líneas`, f.points && `${f.points} puntos`].filter(Boolean).join(' · ');

  return (
    <Dialog
      wide
      title={`Importar ${title ?? file}`}
      onClose={result ? onDone : onClose}
      onSubmit={() => (result ? onDone() : save.mutate())}
      footer={result
        ? <button className="btn btn-primary">Listo</button>
        : <><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Importando…' : 'Importar'}</button></>}
    >
      <ErrorBox error={save.error} />
      {result ? <div className="ok-text" style={{ fontSize: 15 }}>{result}</div> : (
        <>
          <MapView layers={preview} stations={previewStations} height={260} />
          <label className="field" style={{ marginTop: 12 }}>
            <span>Brigada</span>
            <select className="input" value={brigadeId} onChange={(e) => setBrigadeId(e.target.value)}>
              <option value="">Todo el proyecto (lo reciben todas las brigadas)</option>
              {brigades.map((b) => <option key={b.id} value={b.id}>Brigada {b.name}</option>)}
            </select>
          </label>
          <p className="hint">En el teléfono, solo los integrantes de la brigada reciben este KMZ. Se guardan las carpetas tal como vienen en el archivo; revisa el tipo sugerido de cada una.</p>
          <div className="section-title">Carpetas ({folders.length})</div>
          <div className="scroll-y" style={{ maxHeight: 260 }}>
            <table>
              <tbody>
                {folders.map((f) => (
                  <tr key={f.key}>
                    <td style={{ width: 28 }}><input type="checkbox" checked={f.include} onChange={(e) => updFolder(f.key, { include: e.target.checked })} aria-label={`Incluir ${f.path.join(' / ')}`} /></td>
                    <td>{f.path[f.path.length - 1] ?? '(sin carpeta)'}<div className="hint">{f.path.slice(0, -1).join(' / ') || '—'} · {types(f)}</div></td>
                    <td style={{ width: 230 }}>
                      <select className="input" value={f.kind} onChange={(e) => updFolder(f.key, { kind: e.target.value as Folder['kind'] })} aria-label={`Tipo de ${f.path.join(' / ')}`}>
                        {LAYER_KINDS.map((k) => <option key={k} value={k}>{LAYER_KIND_LABELS[k]}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pts.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 12 }}>Estaciones detectadas ({pts.length})</div>
              <div className="scroll-y" style={{ maxHeight: 200 }}>
                <table>
                  <tbody>
                    {pts.map((p) => (
                      <tr key={p.i}>
                        <td style={{ width: 28 }}><input type="checkbox" checked={p.asStation} onChange={(e) => updPt(p.i, { asStation: e.target.checked })} aria-label={`Crear estación ${p.name}`} /></td>
                        <td>{p.name}<div className="hint">{p.folder || '—'}</div></td>
                        <td style={{ width: 160 }}><input className="input" value={p.code} placeholder="Código EM" onChange={(e) => updPt(p.i, { code: e.target.value.toUpperCase() })} aria-label="Código de estación" /></td>
                        <td style={{ width: 120 }} className="hint">{!p.asStation ? 'Como capa' : p.code && existingCodes.has(p.code) ? 'Se actualizará' : p.code ? 'Nueva' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
