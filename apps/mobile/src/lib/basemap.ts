import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OfflineManager, type OfflinePack } from '@maplibre/maplibre-react-native';
import { WORK_AREA_MARGIN_DEG, type WpBounds, type WpBrigade, type WpProject } from '@toce/shared';
import { API_URL } from './config';

/** Estilo del mapa base OSM servido por nuestro API (ver apps/api/src/routes/basemap.ts). */
export const BASEMAP_STYLE_URL = `${API_URL}/basemap/style.json`;
/** El servidor tiene teselas hasta z15; el mapa amplía más allá sin perder las capas. */
const MIN_ZOOM = 8;
const MAX_ZOOM = 15;
/** Si la zona es grande se baja el detalle máximo, pero no por debajo de este zoom (por debajo no sirve en campo). */
const MIN_DETAIL_ZOOM = 12;
/** Límite de teselas guardadas en el teléfono (MapLibre lo aplica al total de paquetes). */
const TILE_LIMIT = 30000;
/** Reserva para no rozar el límite (teselas de estilo, redondeos). */
const TILE_BUDGET = Math.floor(TILE_LIMIT * 0.95);

OfflineManager.setTileCountLimit(TILE_LIMIT);

/**
 * Mapa offline por brigada: cada integrante descarga solo la zona de su brigada (su KMZ o, si no tiene,
 * sus estaciones; `WpBrigade.bounds`) + margen. Con varias brigadas se guarda un paquete por brigada
 * (no la unión: un supervisor de 9 brigadas tendría todo el proyecto); las teselas que se repiten entre
 * paquetes se guardan una sola vez. Paquetes antiguos sin `bounds` por brigada: una zona con `project.bounds`.
 */
export type BasemapZone = {
  /** Clave del paquete offline: brigade:<id> o project:<id> (paquete de trabajo antiguo). */
  key: string;
  projectId: string;
  brigadeId: string | null;
  label: string;
  bounds: WpBounds;
  maxZoom: number;
  tiles: number;
  /** El detalle máximo se redujo para no pasar el límite de teselas. */
  reduced: boolean;
  /** Ni con el detalle mínimo entra en el límite: no se descarga. */
  tooBig: boolean;
};

type ZoneStatus =
  | { status: 'none' }
  | { status: 'downloading'; percent: number; bytes: number }
  | { status: 'complete'; bytes: number; downloadedAt: string | null }
  | { status: 'error'; message: string };

export type BasemapState =
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'downloading'; percent: number; bytes: number }
  | { status: 'complete'; bytes: number; downloadedAt: string | null }
  | { status: 'error'; message: string };

type Meta = { projectId: string; zoneKey?: string; brigadeId?: string | null; bounds: number[]; maxZoom?: number; downloadedAt?: string };

const sameBounds = (a: number[] | undefined, b: number[]) => !!a && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < 1e-6);
const metaOf = (p: OfflinePack) => (p.metadata ?? {}) as Partial<Meta>;
/** Clave de un paquete guardado; los de versiones anteriores (todo el proyecto) no tienen zoneKey. */
const keyOf = (p: OfflinePack) => metaOf(p).zoneKey ?? `project:${metaOf(p).projectId ?? ''}`;

const lng2x = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
/** Teselas de una caja entre MIN_ZOOM y maxZoom. */
export function tileCount(b: WpBounds, maxZoom: number): number {
  let n = 0;
  for (let z = MIN_ZOOM; z <= maxZoom; z++) n += (lng2x(b[2], z) - lng2x(b[0], z) + 1) * (lat2y(b[1], z) - lat2y(b[3], z) + 1);
  return n;
}

const withMargin = (b: WpBounds): WpBounds =>
  [b[0] - WORK_AREA_MARGIN_DEG, b[1] - WORK_AREA_MARGIN_DEG, b[2] + WORK_AREA_MARGIN_DEG, b[3] + WORK_AREA_MARGIN_DEG];

/** Zonas offline del usuario en un proyecto, con el detalle ajustado al límite de teselas. */
export function planZones(project: WpProject | undefined, brigades: WpBrigade[]): BasemapZone[] {
  if (!project) return [];
  const mine = brigades.filter((b) => b.projectId === project.id);
  // Paquete de trabajo nuevo: las brigadas traen `bounds` (aunque sea null). Uno antiguo no lo trae.
  const modern = mine.some((b) => b.bounds !== undefined);
  const raw = modern
    ? mine.filter((b) => b.bounds).map((b) => ({ key: `brigade:${b.id}`, brigadeId: b.id as string | null, label: b.name, bounds: withMargin(b.bounds!) }))
    : project.bounds ? [{ key: `project:${project.id}`, brigadeId: null, label: project.code, bounds: withMargin(project.bounds) }] : [];
  // Brigadas con la misma zona (p. ej. las mismas estaciones): un solo paquete.
  const zones: typeof raw = [];
  for (const z of raw) {
    const same = zones.find((x) => sameBounds(x.bounds, z.bounds));
    if (same) same.label = `${same.label}, ${z.label}`;
    else zones.push({ ...z });
  }
  // Reparte el límite: cada zona, de la más chica a la más grande, toma el mayor detalle que entra en su parte.
  const order = [...zones].sort((a, b) => tileCount(a.bounds, MAX_ZOOM) - tileCount(b.bounds, MAX_ZOOM));
  let left = TILE_BUDGET;
  const out = new Map<string, BasemapZone>();
  order.forEach((z, i) => {
    const share = left / (order.length - i);
    let maxZoom = MAX_ZOOM;
    while (maxZoom > MIN_DETAIL_ZOOM && tileCount(z.bounds, maxZoom) > share) maxZoom--;
    const tiles = tileCount(z.bounds, maxZoom);
    const tooBig = tiles > share;
    if (!tooBig) left -= tiles;
    out.set(z.key, { ...z, projectId: project.id, maxZoom, tiles, reduced: maxZoom < MAX_ZOOM, tooBig });
  });
  return zones.map((z) => out.get(z.key)!);
}

function aggregate(zones: BasemapZone[], st: Record<string, ZoneStatus | undefined>): BasemapState {
  const list = zones.filter((z) => !z.tooBig).map((z) => st[z.key]);
  if (!list.length) return { status: 'none' };
  if (list.some((s) => !s)) return { status: 'checking' };
  const all = list as ZoneStatus[];
  const err = all.find((s): s is Extract<ZoneStatus, { status: 'error' }> => s.status === 'error');
  if (err) return { status: 'error', message: err.message };
  const bytes = all.reduce((n, s) => n + (s.status === 'downloading' || s.status === 'complete' ? s.bytes : 0), 0);
  if (all.some((s) => s.status === 'downloading')) {
    const percent = Math.floor(all.reduce((n, s) => n + (s.status === 'complete' ? 100 : s.status === 'downloading' ? s.percent : 0), 0) / all.length);
    return { status: 'downloading', percent, bytes };
  }
  if (all.every((s) => s.status === 'complete')) {
    const dates = all.map((s) => (s.status === 'complete' ? s.downloadedAt : null)).filter((d): d is string => !!d).sort();
    return { status: 'complete', bytes, downloadedAt: dates[0] ?? null };
  }
  return { status: 'none' };
}

/** Mapa offline de las brigadas del usuario en el proyecto: estado, descarga (reanudable) y actualización. */
export function useBasemap(project: WpProject | undefined, brigades: WpBrigade[] = []) {
  const zones = useMemo(() => planZones(project, brigades), [project, brigades]);
  const zonesKey = zones.map((z) => `${z.key}@${z.bounds.join(',')}@${z.maxZoom}`).join('|');
  const [status, setStatus] = useState<Record<string, ZoneStatus>>({});
  const packs = useRef(new Map<string, OfflinePack>());
  const setZone = useCallback((key: string, s: ZoneStatus) => setStatus((cur) => ({ ...cur, [key]: s })), []);

  const listeners = useCallback((key: string) => ({
    progress: (_p: OfflinePack, s: { state: string; percentage: number; completedResourceSize: number }) => {
      if (s.state === 'complete' || s.percentage >= 100) setZone(key, { status: 'complete', bytes: s.completedResourceSize, downloadedAt: new Date().toISOString() });
      else setZone(key, { status: 'downloading', percent: Math.floor(s.percentage), bytes: s.completedResourceSize });
    },
    error: (_p: OfflinePack, e: { message: string }) => setZone(key, { status: 'error', message: e.message || 'No se pudo descargar el mapa' }),
  }), [setZone]);

  /** Borra los paquetes de este proyecto que ya no corresponden (mapa de todo el proyecto, brigadas que ya no son tuyas). */
  const deleteStale = useCallback(async (all: OfflinePack[]) => {
    if (!project) return;
    const keep = new Set(zones.filter((z) => !z.tooBig).map((z) => z.key));
    for (const p of all) {
      if (metaOf(p).projectId !== project.id || keep.has(keyOf(p))) continue;
      OfflineManager.removeListener(p.id);
      await OfflineManager.deletePack(p.id).catch(() => undefined);
    }
  }, [project?.id, zonesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    const next: Record<string, ZoneStatus> = {};
    packs.current.clear();
    try {
      const all = await OfflineManager.getPacks();
      for (const z of zones) {
        if (z.tooBig) continue;
        const pack = all.find((p) => keyOf(p) === z.key);
        if (!pack) { next[z.key] = { status: 'none' }; continue; }
        packs.current.set(z.key, pack);
        const l = listeners(z.key);
        await OfflineManager.addListener(pack.id, l.progress, l.error);
        const meta = metaOf(pack);
        const st = await pack.status();
        if (st.state === 'complete' || st.percentage >= 100) {
          // Si la zona cambió (otro KMZ, nuevas estaciones o menos detalle), hay que volver a descargar.
          const same = sameBounds(meta.bounds, z.bounds) && (meta.maxZoom ?? MAX_ZOOM) === z.maxZoom;
          next[z.key] = same ? { status: 'complete', bytes: st.completedResourceSize, downloadedAt: meta.downloadedAt ?? null } : { status: 'none' };
        } else {
          next[z.key] = { status: 'downloading', percent: Math.floor(st.percentage), bytes: st.completedResourceSize };
        }
      }
      // Con todo lo actual descargado, se liberan los paquetes viejos (p. ej. el de todo el proyecto).
      if (zones.length && Object.values(next).every((s) => s.status === 'complete')) await deleteStale(all);
    } catch (e) {
      for (const z of zones) next[z.key] ??= { status: 'error', message: e instanceof Error ? e.message : 'Error del mapa offline' };
    }
    setStatus(next);
  }, [zonesKey, listeners, deleteStale]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // refresh consulta los paquetes offline (asíncrono): el estado cambia después, no durante el efecto.
    void refresh(); // eslint-disable-line react-hooks/set-state-in-effect
    const current = packs.current;
    return () => {
      for (const p of current.values()) OfflineManager.removeListener(p.id);
    };
  }, [refresh]);

  /** Crea el paquete offline de una zona (borra antes el que tenga otra caja o detalle). */
  const createZonePack = useCallback(async (z: BasemapZone) => {
    const l = listeners(z.key);
    setZone(z.key, { status: 'downloading', percent: 0, bytes: 0 });
    try {
      const existing = packs.current.get(z.key);
      if (existing) await OfflineManager.deletePack(existing.id).catch(() => undefined);
      const m: Meta = { projectId: z.projectId, zoneKey: z.key, brigadeId: z.brigadeId, bounds: z.bounds, maxZoom: z.maxZoom, downloadedAt: new Date().toISOString() };
      packs.current.set(z.key, await OfflineManager.createPack(
        { mapStyle: BASEMAP_STYLE_URL, bounds: z.bounds, minZoom: MIN_ZOOM, maxZoom: z.maxZoom, metadata: m },
        l.progress,
        l.error,
      ));
    } catch (e) {
      setZone(z.key, { status: 'error', message: `${z.label}: ${e instanceof Error ? e.message : 'No se pudo descargar el mapa'}` });
    }
  }, [listeners, setZone]);

  /** Descarga (o reanuda) las zonas que faltan. Requiere conexión con el servidor. */
  const download = useCallback(async () => {
    try {
      // Primero se liberan los paquetes viejos (p. ej. el de todo el proyecto): cuentan para el límite de teselas.
      await deleteStale(await OfflineManager.getPacks());
    } catch { /* sigue: a lo sumo el límite se alcanza antes */ }
    for (const z of zones) {
      if (z.tooBig || status[z.key]?.status === 'complete') continue;
      const existing = packs.current.get(z.key);
      const meta = existing ? metaOf(existing) : null;
      if (existing && meta && sameBounds(meta.bounds, z.bounds) && (meta.maxZoom ?? MAX_ZOOM) === z.maxZoom) {
        try {
          const l = listeners(z.key);
          setZone(z.key, { status: 'downloading', percent: 0, bytes: 0 });
          await OfflineManager.addListener(existing.id, l.progress, l.error);
          await existing.resume();
          continue;
        } catch { /* no se pudo reanudar: se crea de nuevo */ }
      }
      await createZonePack(z);
    }
  }, [zonesKey, status, listeners, deleteStale, setZone, createZonePack]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Borra y vuelve a descargar todas las zonas (mapa actualizado). */
  const redownload = useCallback(async () => {
    for (const z of zones) if (!z.tooBig) await createZonePack(z);
  }, [zonesKey, createZonePack]); // eslint-disable-line react-hooks/exhaustive-deps

  const state = aggregate(zones, status);
  /** Avisos para el usuario: zonas con menos detalle o que no entran en el límite (nunca se falla en silencio). */
  const notes = project && !zones.length
    ? ['Tu brigada aún no tiene zona de trabajo (KMZ ni estaciones): no hay mapa offline que descargar.']
    : zones.flatMap((z) =>
    z.tooBig ? [`${z.label}: la zona es demasiado grande para guardarla sin conexión (revisa su KMZ o sus estaciones).`]
      : z.reduced ? [`${z.label}: zona grande, el mapa offline llega hasta el zoom ${z.maxZoom}.`] : []);
  const bounds = zones.length
    ? ([Math.min(...zones.map((z) => z.bounds[0])), Math.min(...zones.map((z) => z.bounds[1])), Math.max(...zones.map((z) => z.bounds[2])), Math.max(...zones.map((z) => z.bounds[3]))] as WpBounds)
    : null;
  return { state, zones, notes, download, redownload, bounds };
}

export const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits: 1 })} MB`;
