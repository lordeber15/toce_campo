import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Feature, FeatureCollection } from 'geojson';
import { Link } from 'react-router';
import { ADMIN_ROLES, LAYER_KINDS, LAYER_KIND_LABELS, type LayerTreeLeaf } from '@toce/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { parseKmlDocument, stationCodeFrom, type ParsedFeature } from '../lib/kmz';
import { MapView } from '../components/MapView';
import { LayerTree, leafId, useLayerVisibility } from '../components/LayerTree';
import { Dialog, ErrorBox, NoProject } from '../components/Dialog';

type Station = { id: string; code: string; lat: number; lng: number };
type Brigade = { id: string; name: string; isActive?: boolean };

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
    // El polígono de cada brigada sale de sus KMZ: cambia al importar, reasignar o borrar.
    qc.invalidateQueries({ queryKey: ['brigades'] });
    qc.invalidateQueries({ queryKey: ['brigade-areas'] });
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
  // Grupos del árbol: capas generales y, aparte, el KMZ de cada brigada (su zona de trabajo).
  const groups = groupLeaves(leaves);
  const adminActions = admin ? {
    setKind: (sourceFile: string | null, folderPath: string[], kind: string) => patch.mutate({ sourceFile, folderPath, kind }),
    setBrigade: (sourceFile: string | null, brigadeId: string | null) => patch.mutate({ sourceFile, brigadeId }),
    remove: (sourceFile: string | null, title: string) => confirm(`¿Eliminar todas las capas de "${title}"?`) && remove.mutate(sourceFile),
  } : undefined;
  const activeBrigades = (brigades.data ?? []).filter((b) => b.isActive !== false);

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
          <p>
            Capas de cada KMZ de {project.code} con sus carpetas. Un KMZ <strong>general</strong> es de todo el proyecto (cada teléfono recibe solo la parte de la zona de su brigada);
            un KMZ asignado a una <strong>brigada</strong> es su zona de trabajo: define su polígono (fotos dentro/fuera) y el mapa offline de sus integrantes.
            Las estaciones vienen de la <Link to="/carga-masiva">carga masiva</Link> y se clasifican con estas capas.
          </p>
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
          <MapView layers={layers} stations={stations.data ?? []} height={620} fitKey={`${pid}|${fitted === pid}`} />
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
            {tree.isPending ? <div className="empty">Cargando capas…</div> : !leaves.length ? (
              <div className="empty">Importa un KMZ con las capas del proyecto.</div>
            ) : groups.map((g) => {
              const ids = g.leaves.map(leafId);
              const on = ids.filter((id) => visible.has(id)).length;
              return (
                <section key={g.key} aria-label={g.title} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 12px 0 6px' }}>
                    <label className="ltree-label">
                      <input type="checkbox" checked={on === ids.length} ref={(el) => { if (el) el.indeterminate = on > 0 && on < ids.length; }}
                        onChange={() => set(ids, on !== ids.length)} />
                      <span className="section-title" style={{ margin: 0 }}>{g.title}</span>
                    </label>
                    <span className="hint">{g.hint}</span>
                  </div>
                  <LayerTree leaves={g.leaves} visible={visible} onToggle={set} loading={loading} brigades={brigades.data ?? []} admin={adminActions} />
                </section>
              );
            })}
          </div>
        </div>
      </div>
      {importing && (
        <ImportDialog
          projectId={project.id}
          file={importing.file}
          title={importing.title}
          initial={importing.features}
          brigades={activeBrigades}
          onClose={() => setImporting(null)}
          onDone={() => { setImporting(null); refresh(); }}
        />
      )}
    </>
  );
}

/** Capas generales primero; después un grupo por brigada (en orden alfabético). */
function groupLeaves(leaves: LayerTreeLeaf[]) {
  const general = leaves.filter((l) => !l.brigadeId);
  const byBrigade = new Map<string, { name: string; leaves: LayerTreeLeaf[] }>();
  for (const l of leaves) {
    if (!l.brigadeId) continue;
    const g = byBrigade.get(l.brigadeId) ?? { name: l.brigadeName ?? 'Brigada', leaves: [] };
    g.leaves.push(l);
    byBrigade.set(l.brigadeId, g);
  }
  return [
    ...(general.length ? [{ key: 'general', title: 'Capas generales', hint: 'Todo el proyecto; cada brigada recibe la parte de su zona.', leaves: general }] : []),
    ...[...byBrigade].sort((a, b) => a[1].name.localeCompare(b[1].name, 'es')).map(([id, g]) => ({
      key: id, title: `Brigada ${g.name}`, hint: 'Zona de trabajo: polígono y mapa offline de la brigada.', leaves: g.leaves,
    })),
  ];
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Brigada cuyo nombre aparece en el título o el nombre del archivo ("Brigada Costa 1" -> Costa 1). */
function guessBrigade(brigades: Brigade[], text: string): string {
  const hay = ` ${norm(text)} `;
  const hits = brigades.filter((b) => norm(b.name) && hay.includes(` ${norm(b.name)} `));
  return hits.sort((a, b) => b.name.length - a.name.length)[0]?.id ?? '';
}

type Folder = {
  key: string; path: string[]; include: boolean; kind: ParsedFeature['kind']; count: number; points: number; lines: number; polygons: number;
  /** Todos sus elementos son puntos con código de estación (EM-…): duplicarían las estaciones de la carga masiva. */
  stationPoints: boolean;
};

function ImportDialog({ projectId, file, title, initial, brigades, onClose, onDone }: {
  projectId: string; file: string; title: string | null; initial: ParsedFeature[]; brigades: Brigade[];
  onClose: () => void; onDone: () => void;
}) {
  const [brigadeId, setBrigadeId] = useState(() => guessBrigade(brigades, `${title ?? ''} ${file.replace(/[_.]/g, ' ')}`));
  // Una fila por carpeta hoja (en el orden del archivo); el tipo se elige por carpeta.
  // Los puntos se guardan como elementos de la capa (torres, acopios...). Las estaciones ya no se crean desde el KMZ
  // (vienen de la carga masiva): las carpetas que solo traen puntos EM-… quedan desmarcadas por defecto.
  const [folders, setFolders] = useState<Folder[]>(() => {
    const by = new Map<string, Folder>();
    const kinds = new Map<string, Map<string, number>>();
    const emPoints = new Map<string, number>();
    for (const f of initial) {
      const key = JSON.stringify(f.folderPath);
      let x = by.get(key);
      if (!x) { x = { key, path: f.folderPath, include: true, kind: f.kind, count: 0, points: 0, lines: 0, polygons: 0, stationPoints: false }; by.set(key, x); kinds.set(key, new Map()); }
      x.count++;
      const t = f.geometry.type;
      if (t.includes('Point')) x.points++; else if (t.includes('Line')) x.lines++; else x.polygons++;
      if (f.isPoint && stationCodeFrom(f.name)) emPoints.set(key, (emPoints.get(key) ?? 0) + 1);
      const k = kinds.get(key)!;
      k.set(f.kind, (k.get(f.kind) ?? 0) + 1);
    }
    for (const [key, x] of by) {
      x.kind = [...kinds.get(key)!].sort((a, b) => b[1] - a[1])[0]![0] as Folder['kind'];
      x.stationPoints = (emPoints.get(key) ?? 0) === x.count;
      if (x.stationPoints) x.include = false;
    }
    return [...by.values()];
  });
  const [result, setResult] = useState<string | null>(null);
  const updFolder = (key: string, patch: Partial<Folder>) => setFolders((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const folderBy = useMemo(() => new Map(folders.map((f) => [f.key, f])), [folders]);
  const layerFeats = useMemo(
    () => initial.map((f, i) => ({ f, i, folder: folderBy.get(JSON.stringify(f.folderPath))! })).filter(({ folder }) => folder.include),
    [initial, folderBy],
  );

  const preview = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: layerFeats.map(({ f, i, folder }) => ({ type: 'Feature', id: i, geometry: f.geometry, properties: { kind: folder.kind, name: f.name, color: f.color, folderPath: f.folderPath } })),
  }), [layerFeats]);
  const polygons = layerFeats.filter(({ f }) => /Polygon/.test(f.geometry.type)).length;

  const save = useMutation({
    mutationFn: async () => {
      if (!layerFeats.length) return 'Nada que importar.';
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
      const b = brigades.find((x) => x.id === brigadeId);
      return `${r.imported.toLocaleString('es-PE')} elementos importados${r.replaced ? ` (reemplazan ${r.replaced.toLocaleString('es-PE')} de la importación anterior de este archivo)` : ''}.`
        + (b ? ` Zona de trabajo de la brigada ${b.name} actualizada.` : '');
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
        : <><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={save.isPending || !layerFeats.length}>{save.isPending ? 'Importando…' : 'Importar'}</button></>}
    >
      <ErrorBox error={save.error} />
      {result ? <div className="ok-text" style={{ fontSize: 15 }}>{result}</div> : (
        <>
          <MapView layers={preview} height={260} />
          <label className="field" style={{ marginTop: 12 }}>
            <span>Uso del KMZ</span>
            <select className="input" value={brigadeId} onChange={(e) => setBrigadeId(e.target.value)}>
              <option value="">General: capas de todo el proyecto</option>
              {brigades.map((b) => <option key={b.id} value={b.id}>Zona de trabajo de la brigada {b.name}</option>)}
            </select>
          </label>
          <p className="hint">
            {brigadeId
              ? <>Solo los integrantes de la brigada reciben este KMZ. Sus {polygons ? `${polygons.toLocaleString('es-PE')} polígonos forman` : 'polígonos formarían'} el polígono de trabajo (las fotos fuera de él se advierten) y su extensión es el mapa offline del teléfono.{!polygons && ' Este KMZ no tiene polígonos: las fotos no se verificarán.'}</>
              : 'Cada teléfono recibe solo la parte que cae en la zona de su brigada.'}
            {' '}Se guardan las carpetas tal como vienen en el archivo; revisa el tipo sugerido de cada una.
          </p>
          <div className="section-title">Carpetas ({folders.length})</div>
          <div className="scroll-y" style={{ maxHeight: 300 }}>
            <table>
              <tbody>
                {folders.map((f) => (
                  <tr key={f.key}>
                    <td style={{ width: 28 }}><input type="checkbox" checked={f.include} onChange={(e) => updFolder(f.key, { include: e.target.checked })} aria-label={`Incluir ${f.path.join(' / ')}`} /></td>
                    <td>
                      {f.path[f.path.length - 1] ?? '(sin carpeta)'}
                      <div className="hint">{f.path.slice(0, -1).join(' / ') || '—'} · {types(f)}</div>
                      {f.stationPoints && <div className="hint">Puntos de estaciones (EM): las estaciones vienen de la carga masiva; márcala solo si quieres verlos como capa.</div>}
                    </td>
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
        </>
      )}
    </Dialog>
  );
}
