import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { FeatureCollection } from 'geojson';
import { TRACK_MIN_SECONDS, formatTrackDuration, formatUtm, latLngToUtm, type TrackGroupDto } from '@toce/shared';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import { ErrorBox, NoProject } from '../components/Dialog';
import { BRIGADE_AREA_COLOR, MapView, type MapTrack } from '../components/MapView';

type BrigadeOpt = { id: string; name: string };

const PALETTE = ['#7048E8', '#1C7ED6', '#D6336C', '#0CA678', '#F08C00', '#495057', '#AE3EC9', '#E8590C'];
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const utm = (p: { lat: number; lng: number } | null) => (p ? formatUtm(latLngToUtm(p.lat, p.lng)) : 'sin GPS');
const groupKey = (g: TrackGroupDto) => `${g.stationId}|${g.userId}`;

/** Recorridos de tracking GPS de los especialistas por EM, con el total frente al mínimo de 2 h. */
export function GpsTracksPage() {
  const { project } = useProject();
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries([...params].filter(([, v]) => v)) as { brigadeId?: string; from?: string; to?: string };
  const [selected, setSelected] = useState<string | null>(null);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
    setSelected(null);
  };

  const brigades = useQuery({ queryKey: ['brigades', project?.id], enabled: !!project, queryFn: () => api<BrigadeOpt[]>(`/projects/${project!.id}/brigades`) });
  const areas = useQuery({ queryKey: ['brigade-areas', project?.id], enabled: !!project, queryFn: () => api<FeatureCollection>(`/projects/${project!.id}/brigade-areas`) });
  const tracks = useQuery({
    queryKey: ['gps-tracks', project?.id, filters],
    enabled: !!project,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    queryFn: () => api<TrackGroupDto[]>(`/projects/${project!.id}/tracks?${new URLSearchParams(filters)}`),
  });

  const groups = useMemo(() => tracks.data ?? [], [tracks.data]);
  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) if (!m.has(g.stationId)) m.set(g.stationId, PALETTE[m.size % PALETTE.length]!);
    return m;
  }, [groups]);
  const mapTracks = useMemo<MapTrack[]>(() => groups.flatMap((g) => g.sessions.map((s) => ({
    id: `${groupKey(g)}|${s.id}`,
    color: colorOf.get(g.stationId)!,
    line: s.line.map(([lng, lat]) => [lat, lng] as [number, number]),
    start: s.start ? [s.start.lat, s.start.lng] as [number, number] : null,
    end: s.end ? [s.end.lat, s.end.lng] as [number, number] : null,
    label: `${g.stationCode} · ${g.userName} · ${when(s.startedAt)}`,
    selected: selected === groupKey(g),
  }))), [groups, colorOf, selected]);
  const visibleAreas = useMemo<FeatureCollection | null>(() => {
    if (!areas.data) return null;
    return filters.brigadeId ? { ...areas.data, features: areas.data.features.filter((f) => f.id === filters.brigadeId) } : areas.data;
  }, [areas.data, filters.brigadeId]);

  if (!project) return <NoProject />;
  const below = groups.filter((g) => !g.active && g.totalSec < TRACK_MIN_SECONDS).length;
  const sel = groups.find((g) => groupKey(g) === selected) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tracking GPS</h1>
          <p>Recorridos de los especialistas en cada estación de {project.code}: dónde activaron y desactivaron el tracking y el total frente al mínimo de 2 h.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <select className="input" value={filters.brigadeId ?? ''} onChange={(e) => set('brigadeId', e.target.value)} aria-label="Brigada" style={{ maxWidth: 220 }}>
            <option value="">Brigada: todas</option>
            {(brigades.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Desde <input className="input" type="date" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} style={{ width: 150 }} />
          </label>
          <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Hasta <input className="input" type="date" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} style={{ width: 150 }} />
          </label>
          {Object.keys(filters).length > 0 && <button className="btn btn-sm" onClick={() => { setParams({}, { replace: true }); setSelected(null); }}>Quitar filtros</button>}
        </div>
        <ErrorBox error={tracks.error ?? areas.error} />
      </div>

      <div className="photo-map-grid">
        <div className="card" style={{ padding: 12, opacity: tracks.isPlaceholderData ? 0.7 : 1 }}>
          <MapView areas={visibleAreas} tracks={mapTracks} onTrackClick={(id) => setSelected(id.split('|').slice(0, 2).join('|'))} height={600}
            fitKey={`${filters.brigadeId ?? ''}|${filters.from ?? ''}|${filters.to ?? ''}|${groups.length}|${areas.data?.features.length ?? 0}`} />
          <div className="legend">
            <span><i style={{ borderColor: BRIGADE_AREA_COLOR, borderStyle: 'dashed', background: BRIGADE_AREA_COLOR + '22' }} />Polígono de la brigada</span>
            <span><i style={{ borderColor: '#fff', background: '#2F9E44', borderRadius: 7 }} />Activado</span>
            <span><i style={{ borderColor: '#fff', background: '#E03131', borderRadius: 7 }} />Desactivado</span>
            <span>Un color por estación</span>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          {sel ? (
            <GroupPanel g={sel} color={colorOf.get(sel.stationId)!} onClose={() => setSelected(null)} />
          ) : (
            <>
              <div className="section-title" style={{ marginTop: 0 }}>{groups.length} EM con tracking</div>
              {below > 0 && <p style={{ margin: '0 0 8px', fontSize: 14 }}><span className="chip chip-warn">{below} bajo el mínimo de 2 h</span></p>}
              {groups.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 520, overflow: 'auto' }}>
                  {groups.map((g) => (
                    <button key={groupKey(g)} type="button" className="link-btn" style={{ textAlign: 'left', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }} onClick={() => setSelected(groupKey(g))}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: colorOf.get(g.stationId), flex: 'none' }} />
                      <span style={{ flex: 1 }}>{g.stationCode} · <span className="hint">{g.userName}</span></span>
                      <TotalChip g={g} />
                    </button>
                  ))}
                </div>
              ) : <p className="hint" style={{ margin: 0 }}>Sin tracking con estos filtros. Los recorridos llegan cuando el teléfono del especialista se sincroniza.</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function TotalChip({ g }: { g: TrackGroupDto }) {
  const ok = g.totalSec >= TRACK_MIN_SECONDS;
  const cls = ok ? 'chip chip-ok' : g.active ? 'chip chip-off' : 'chip chip-warn';
  return <span className={cls}>{formatTrackDuration(g.totalSec)}{g.active ? ' · activo' : ''}</span>;
}

function GroupPanel({ g, color, onClose }: { g: TrackGroupDto; color: string; onClose: () => void }) {
  const gaps = g.sessions.reduce((a, s) => a + s.gapSec, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: 6, background: color }} />
        <strong style={{ flex: 1 }}>{g.stationCode}</strong>
        <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>
      <dl className="kv">
        <dt>Especialista</dt><dd>{g.userName}</dd>
        {g.brigadeName && <><dt>Brigada</dt><dd>{g.brigadeName}</dd></>}
        <dt>Total</dt><dd><TotalChip g={g} /> <span className="hint">mínimo {formatTrackDuration(TRACK_MIN_SECONDS)}</span></dd>
        {gaps > 0 && <><dt>Sin señal</dt><dd>{formatTrackDuration(gaps)} en huecos del recorrido</dd></>}
      </dl>
      <div className="section-title" style={{ margin: 0 }}>Historial ({g.sessions.length} tramo{g.sessions.length === 1 ? '' : 's'})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflow: 'auto' }}>
        {g.sessions.map((s) => (
          <div key={s.id} style={{ fontSize: 13, borderTop: '1px solid var(--border, #DBE2D8)', paddingTop: 8 }}>
            <div><span style={{ color: '#2F9E44' }}>▶</span> {when(s.startedAt)} · {utm(s.start)}</div>
            <div>{s.endedAt ? <><span style={{ color: '#E03131' }}>■</span> {when(s.endedAt)} · {utm(s.end)}</> : <em>En curso</em>}</div>
            <div className="hint">
              {formatTrackDuration(s.durationSec)} · {s.pointCount} puntos{s.gaps ? ` · ${s.gaps} hueco${s.gaps === 1 ? '' : 's'} (${formatTrackDuration(s.gapSec)})` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
