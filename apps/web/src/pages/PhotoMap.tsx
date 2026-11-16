import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { FeatureCollection } from 'geojson';
import { formatUtm, latLngToUtm, type PhotoMapPoint } from '@toce/shared';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import { ErrorBox, NoProject } from '../components/Dialog';
import { BRIGADE_AREA_COLOR, MapView, PHOTO_COLORS, type MapPhoto } from '../components/MapView';
import { MediaViewer } from '../components/MediaViewer';

type BrigadeOpt = { id: string; name: string; isActive: boolean; areaHa: number | null };

const when = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const slotText = (p: PhotoMapPoint) =>
  p.kind === 'foto_metodo' ? 'Foto del método' : p.slotKey === 'adicional' ? 'Foto adicional' : p.slotKey ? `Foto ${p.slotKey}` : 'Foto';
const where = (p: PhotoMapPoint) => [p.unitCode ?? p.stationCode, p.brigadeName].filter(Boolean).join(' · ') || OWNER_LABEL[p.ownerType];
const OWNER_LABEL: Record<PhotoMapPoint['ownerType'], string> = {
  execution: 'Unidad de muestreo', incident: 'Alerta', logistics: 'Logística', inquiry_message: 'Consulta',
};

/** Mapa de fotos: dónde tomó cada foto la brigada y si quedó dentro o fuera de su polígono de trabajo. */
export function PhotoMapPage() {
  const { project } = useProject();
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries([...params].filter(([, v]) => v)) as { brigadeId?: string; from?: string; to?: string; outside?: string };
  const [selected, setSelected] = useState<string | null>(null);
  const [viewer, setViewer] = useState<PhotoMapPoint | null>(null);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
    setSelected(null);
  };

  const brigades = useQuery({ queryKey: ['brigades', project?.id], enabled: !!project, queryFn: () => api<BrigadeOpt[]>(`/projects/${project!.id}/brigades`) });
  const areas = useQuery({ queryKey: ['brigade-areas', project?.id], enabled: !!project, queryFn: () => api<FeatureCollection>(`/projects/${project!.id}/brigade-areas`) });
  const photos = useQuery({
    queryKey: ['photo-map', project?.id, filters],
    enabled: !!project,
    placeholderData: keepPreviousData,
    queryFn: () => api<PhotoMapPoint[]>(`/projects/${project!.id}/photo-map?${new URLSearchParams(filters)}`),
  });

  const visibleAreas = useMemo<FeatureCollection | null>(() => {
    if (!areas.data) return null;
    return filters.brigadeId ? { ...areas.data, features: areas.data.features.filter((f) => f.id === filters.brigadeId) } : areas.data;
  }, [areas.data, filters.brigadeId]);

  const list = photos.data ?? [];
  const points = useMemo<MapPhoto[]>(
    () => list.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, outside: p.outsideArea, label: `${where(p)} · ${when(p.takenAt)}`, selected: p.id === selected })),
    [list, selected],
  );
  const counts = useMemo(() => ({
    outside: list.filter((p) => p.outsideArea === true).length,
    inside: list.filter((p) => p.outsideArea === false).length,
    unknown: list.filter((p) => p.outsideArea == null).length,
  }), [list]);
  const sel = list.find((p) => p.id === selected) ?? null;

  if (!project) return <NoProject />;
  const active = Object.keys(filters).length > 0;
  const noAreas = brigades.data && !brigades.data.some((b) => b.areaHa != null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mapa de fotos</h1>
          <p>Dónde se tomó cada foto de {project.code} y si quedó dentro o fuera del polígono de trabajo de su brigada.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <select className="input" value={filters.brigadeId ?? ''} onChange={(e) => set('brigadeId', e.target.value)} aria-label="Brigada" style={{ maxWidth: 220 }}>
            <option value="">Brigada: todas</option>
            {(brigades.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}{b.areaHa == null ? ' (sin polígono)' : ''}</option>)}
          </select>
          <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Desde <input className="input" type="date" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} style={{ width: 150 }} />
          </label>
          <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Hasta <input className="input" type="date" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} style={{ width: 150 }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
            <input type="checkbox" checked={!!filters.outside} onChange={(e) => set('outside', e.target.checked ? '1' : '')} /> Solo fuera del polígono
          </label>
          {active && <button className="btn btn-sm" onClick={() => { setParams({}, { replace: true }); setSelected(null); }}>Quitar filtros</button>}
        </div>
        <ErrorBox error={photos.error ?? areas.error} />
        {noAreas && (
          <div className="hint" style={{ padding: '0 18px 12px' }}>
            Ninguna brigada tiene polígono de trabajo. Cárgalo en <Link to="/brigadas">Brigadas</Link> para verificar las fotos.
          </div>
        )}
      </div>

      <div className="photo-map-grid">
        <div className="card" style={{ padding: 12, opacity: photos.isPlaceholderData ? 0.7 : 1 }}>
          <MapView areas={visibleAreas} photos={points} onPhotoClick={setSelected} height={600} fitKey={`${filters.brigadeId ?? ''}|${filters.from ?? ''}|${filters.to ?? ''}|${filters.outside ?? ''}|${areas.data?.features.length ?? 0}`} />
          <div className="legend">
            <span><i style={{ borderColor: BRIGADE_AREA_COLOR, borderStyle: 'dashed', background: BRIGADE_AREA_COLOR + '22' }} />Polígono de la brigada</span>
            <span><i style={{ borderColor: '#fff', background: PHOTO_COLORS.inside, borderRadius: 7 }} />Dentro ({counts.inside})</span>
            <span><i style={{ borderColor: '#fff', background: PHOTO_COLORS.outside, borderRadius: 7 }} />Fuera ({counts.outside})</span>
            <span><i style={{ borderColor: '#fff', background: PHOTO_COLORS.unknown, borderRadius: 7 }} />Sin verificar ({counts.unknown})</span>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          {sel ? (
            <PhotoPanel photo={sel} onOpen={() => setViewer(sel)} onClose={() => setSelected(null)} />
          ) : (
            <>
              <div className="section-title" style={{ marginTop: 0 }}>{list.length} foto{list.length === 1 ? '' : 's'} con ubicación</div>
              {counts.outside > 0 ? (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: 14 }}><span className="chip chip-warn">{counts.outside} fuera del polígono</span></p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 460, overflow: 'auto' }}>
                    {list.filter((p) => p.outsideArea).slice(0, 100).map((p) => (
                      <button key={p.id} type="button" className="link-btn" style={{ textAlign: 'left', fontSize: 13 }} onClick={() => setSelected(p.id)}>
                        {where(p)} · <span className="hint">{when(p.takenAt)} · {p.takenBy}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="hint" style={{ margin: 0 }}>{list.length ? 'Ninguna foto fuera del polígono con estos filtros.' : 'Sin fotos con estos filtros.'}</p>
              )}
              <p className="hint" style={{ marginBottom: 0 }}>Toca un punto del mapa para ver la foto.</p>
            </>
          )}
        </div>
      </div>

      {viewer && (
        <MediaViewer
          title={`${slotText(viewer)} · ${where(viewer)}`}
          kind="foto"
          queryKey={['photo-map-file', viewer.id]}
          load={() => api<{ url: string }>(`/field/attachments/${viewer.id}/url?variant=compressed`).then((r) => r.url)}
          loadOriginal={() => api<{ url: string }>(`/field/attachments/${viewer.id}/url?variant=original`).then((r) => r.url)}
          caption={<>{when(viewer.takenAt)} · {formatUtm(latLngToUtm(viewer.lat, viewer.lng))} · {viewer.takenBy}</>}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}

function PhotoPanel({ photo: p, onOpen, onClose }: { photo: PhotoMapPoint; onOpen: () => void; onClose: () => void }) {
  const url = useQuery({
    queryKey: ['file-url', p.id, 'compressed'],
    enabled: p.uploaded,
    queryFn: () => api<{ url: string }>(`/field/attachments/${p.id}/url?variant=compressed`),
    staleTime: 10 * 60_000,
  });
  const status = p.outsideArea === true
    ? <span className="chip chip-warn" style={{ background: '#FFE3E3', color: '#C92A2A' }}>Fuera del polígono</span>
    : p.outsideArea === false ? <span className="chip chip-ok">Dentro del polígono</span>
      : <span className="chip chip-off">Sin verificar</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ flex: 1 }}>{slotText(p)}</strong>
        <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>
      {p.uploaded ? (
        url.data ? (
          <button type="button" onClick={onOpen} title="Ver en tamaño completo" style={{ padding: 0, border: 0, background: 'none', cursor: 'zoom-in' }}>
            <img src={url.data.url} alt={`${slotText(p)}, ${when(p.takenAt)}`} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 8, display: 'block' }} />
          </button>
        ) : <div className="card" style={{ width: '100%', aspectRatio: '4 / 3' }} />
      ) : <div className="card empty" style={{ padding: 16, fontSize: 13 }}>Aún en el teléfono (se sube con conexión)</div>}
      <div>{status}</div>
      <dl className="kv">
        <dt>Dónde</dt><dd>{where(p)}</dd>
        <dt>Tomada por</dt><dd>{p.takenBy}</dd>
        <dt>Fecha</dt><dd>{when(p.takenAt)}</dd>
        <dt>UTM</dt><dd>{formatUtm(latLngToUtm(p.lat, p.lng))}{p.accuracy != null ? ` ±${Math.round(p.accuracy)} m` : ''}</dd>
      </dl>
      {p.executionId && <Link to={`/registros/${p.executionId}`} state={{ back: '/mapa-fotos' }} className="btn btn-sm">Ver registro de la unidad</Link>}
    </div>
  );
}
