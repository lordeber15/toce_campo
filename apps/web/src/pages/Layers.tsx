import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeatureCollection } from 'geojson';
import { ADMIN_ROLES, LAYER_KINDS, LAYER_KIND_LABELS } from '@toce/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { parseKmlFile, stationCodeFrom, type ParsedFeature } from '../lib/kmz';
import { KIND_STYLE, MapLegend, MapView } from '../components/MapView';
import { Dialog, ErrorBox, NoProject } from '../components/Dialog';

type LayerProps = { id: string; kind: string; name: string; code: string | null; areaHa: number; sourceFile: string | null };
type Station = { id: string; code: string; lat: number; lng: number };

export function LayersPage() {
  const { project } = useProject();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [importing, setImporting] = useState<{ file: string; features: ParsedFeature[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const layers = useQuery({ queryKey: ['layers', project?.id], enabled: !!project, queryFn: () => api<FeatureCollection>(`/projects/${project!.id}/layers`) });
  const stations = useQuery({ queryKey: ['stations', project?.id], enabled: !!project, queryFn: () => api<Station[]>(`/projects/${project!.id}/stations`) });
  const del = useMutation({
    mutationFn: (id: string) => api(`/projects/${project!.id}/layers/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['layers'] }); qc.invalidateQueries({ queryKey: ['stations'] }); },
  });
  const changeKind = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: string }) => api(`/projects/${project!.id}/layers/${id}`, { method: 'PATCH', body: JSON.stringify({ kind }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['layers'] }); qc.invalidateQueries({ queryKey: ['stations'] }); },
  });

  if (!project) return <NoProject />;
  const items = (layers.data?.features ?? []).map((f) => f.properties as LayerProps);

  async function onFile(file?: File) {
    if (!file) return;
    setParseError(null);
    try {
      setImporting({ file: file.name, features: await parseKmlFile(file) });
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'No se pudo leer el archivo');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mapa y capas</h1>
          <p>Huella, AID, AII, unidades de vegetación y superposiciones de {project.code}. Las estaciones se clasifican automáticamente con estas capas.</p>
        </div>
        {can(...ADMIN_ROLES) && (
          <>
            <input ref={fileRef} type="file" accept=".kmz,.kml" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>Importar KMZ / KML</button>
          </>
        )}
      </div>
      {parseError && <div className="alert-error" style={{ marginBottom: 12 }}>{parseError}</div>}
      <div className="split">
        <div className="card" style={{ padding: 12 }}>
          <MapView layers={layers.data} stations={stations.data ?? []} height={560} />
          <MapLegend />
        </div>
        <div className="card">
          <div className="toolbar"><strong>{items.length} capas</strong></div>
          <div className="scroll-y" style={{ maxHeight: 560 }}>
            {!items.length && <div className="empty">Importa un KMZ con las capas del proyecto.</div>}
            {items.map((l) => (
              <div key={l.id} className="list-item" style={{ cursor: 'default' }}>
                <i style={{ width: 12, height: 12, borderRadius: 3, background: KIND_STYLE[l.kind]?.color, flex: 'none' }} />
                <div className="grow">
                  <div>{l.name}{l.code ? ` (${l.code})` : ''}</div>
                  <small>{l.areaHa ? `${l.areaHa.toLocaleString('es-PE')} ha · ` : ''}{l.sourceFile ?? ''}</small>
                </div>
                {can(...ADMIN_ROLES) ? (
                  <>
                    <select className="input" style={{ width: 210, height: 32 }} value={l.kind} onChange={(e) => changeKind.mutate({ id: l.id, kind: e.target.value })} aria-label={`Tipo de ${l.name}`}>
                      {LAYER_KINDS.map((k) => <option key={k} value={k}>{KIND_STYLE[k]?.label}</option>)}
                    </select>
                    <button className="icon-btn" title="Eliminar capa" aria-label={`Eliminar ${l.name}`} onClick={() => confirm(`¿Eliminar la capa "${l.name}"?`) && del.mutate(l.id)}>×</button>
                  </>
                ) : <span className="chip">{KIND_STYLE[l.kind]?.label}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
      {importing && (
        <ImportDialog
          projectId={project.id}
          file={importing.file}
          initial={importing.features}
          existingCodes={new Set((stations.data ?? []).map((s) => s.code))}
          onClose={() => setImporting(null)}
          onDone={() => { setImporting(null); qc.invalidateQueries({ queryKey: ['layers'] }); qc.invalidateQueries({ queryKey: ['stations'] }); qc.invalidateQueries({ queryKey: ['projects'] }); }}
        />
      )}
    </>
  );
}

type Row = ParsedFeature & { include: boolean; asStation: boolean; code: string };

function ImportDialog({ projectId, file, initial, existingCodes, onClose, onDone }: {
  projectId: string; file: string; initial: ParsedFeature[]; existingCodes: Set<string>; onClose: () => void; onDone: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((f) => {
      const code = f.isPoint ? stationCodeFrom(f.name) ?? '' : '';
      return { ...f, include: true, asStation: f.isPoint && !!code, code };
    }),
  );
  const [result, setResult] = useState<string | null>(null);
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const preview = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: rows.filter((r) => r.include && !r.isPoint).map((r, i) => ({ type: 'Feature', id: i, geometry: r.geometry, properties: { kind: r.kind, name: r.name } })),
  }), [rows]);
  const previewStations = rows
    .filter((r) => r.include && r.isPoint && r.asStation && r.geometry.type === 'Point')
    .map((r, i) => { const [lng, lat] = (r.geometry as { coordinates: number[] }).coordinates as [number, number]; return { id: String(i), code: r.code || r.name, lat, lng }; });

  const polygons = rows.filter((r) => !r.isPoint);
  const points = rows.filter((r) => r.isPoint);

  const save = useMutation({
    mutationFn: async () => {
      const feats = rows.filter((r) => r.include && !r.isPoint);
      const sts = rows.filter((r) => r.include && r.isPoint && r.asStation && r.code && r.geometry.type === 'Point');
      let msg = '';
      if (feats.length) {
        const r = await api<{ imported: number; replaced: number }>(`/projects/${projectId}/layers`, {
          method: 'POST',
          body: JSON.stringify({ sourceFile: file, features: feats.map((f) => ({ kind: f.kind, name: f.name, geometry: f.geometry, properties: { folder: f.folder } })) }),
        });
        msg += `${r.imported} capas importadas${r.replaced ? ` (reemplazan ${r.replaced} de la importación anterior de este archivo)` : ''}. `;
      }
      if (sts.length) {
        const r = await api<{ created: number; updated: number }>(`/projects/${projectId}/stations/import`, {
          method: 'POST',
          body: JSON.stringify({ stations: sts.map((s) => { const [lng, lat] = (s.geometry as { coordinates: number[] }).coordinates as [number, number]; return { code: s.code, name: s.name !== s.code ? s.name : null, lat, lng }; }) }),
        });
        msg += `${r.created} estaciones nuevas, ${r.updated} actualizadas.`;
      }
      return msg || 'Nada que importar.';
    },
    onSuccess: setResult,
  });

  return (
    <Dialog
      wide
      title={`Importar ${file}`}
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
          <p className="hint">Revisa el tipo sugerido de cada elemento. Los puntos con código EM se pueden crear como estaciones.</p>
          {polygons.length > 0 && (
            <>
              <div className="section-title">Áreas y líneas ({polygons.length})</div>
              <div className="scroll-y" style={{ maxHeight: 240 }}>
                <table>
                  <tbody>
                    {rows.map((r, i) => !r.isPoint && (
                      <tr key={i}>
                        <td style={{ width: 28 }}><input type="checkbox" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label={`Incluir ${r.name}`} /></td>
                        <td>{r.name}<div className="hint">{r.folder || '—'} · {r.geometry.type}</div></td>
                        <td style={{ width: 230 }}>
                          <select className="input" value={r.kind} onChange={(e) => update(i, { kind: e.target.value as Row['kind'] })} aria-label={`Tipo de ${r.name}`}>
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
          {points.length > 0 && (
            <>
              <div className="section-title">Puntos ({points.length})</div>
              <div className="scroll-y" style={{ maxHeight: 200 }}>
                <table>
                  <tbody>
                    {rows.map((r, i) => r.isPoint && (
                      <tr key={i}>
                        <td style={{ width: 28 }}><input type="checkbox" checked={r.include && r.asStation} onChange={(e) => update(i, { asStation: e.target.checked, include: e.target.checked })} aria-label={`Crear estación ${r.name}`} /></td>
                        <td>{r.name}<div className="hint">{r.folder || '—'}</div></td>
                        <td style={{ width: 160 }}><input className="input" value={r.code} placeholder="Código EM" onChange={(e) => update(i, { code: e.target.value.toUpperCase() })} aria-label="Código de estación" /></td>
                        <td style={{ width: 120 }} className="hint">{r.code && existingCodes.has(r.code) ? 'Se actualizará' : r.code ? 'Nueva' : ''}</td>
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
