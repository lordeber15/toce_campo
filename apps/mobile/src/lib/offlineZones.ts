import { useSyncExternalStore } from 'react';
import { OfflineManager, type OfflinePack, type OfflinePackStatus } from '@maplibre/maplibre-react-native';
import type { WpBounds } from '@toce/shared';
import { SATELLITE_STYLE_URL, tileCount } from './basemap';

/**
 * Zonas satelitales que el usuario elige a mano ("Descargar esta zona"), además de las de su brigada.
 * Cada zona es un paquete offline de MapLibre: las teselas que se repiten entre zonas (o con el mapa
 * de la brigada) se guardan una sola vez, y al borrar una zona solo se eliminan las que nadie más usa.
 */
export const ZONE_MIN_ZOOM = 12;
export const ZONE_MAX_ZOOM = 18;
/** Si pasa de aquí no se descarga: hay que acercar el zoom (~700 MB). */
export const ZONE_MAX_TILES = 40000;
/** Supuesto para estimar el peso antes de descargar. */
const KB_PER_TILE = 30;

export type ZoneEstimate = { tiles: number; mb: number; tooBig: boolean };
export function estimateZone(b: WpBounds): ZoneEstimate {
  const tiles = tileCount(b, ZONE_MAX_ZOOM, ZONE_MIN_ZOOM);
  return { tiles, mb: Math.round((tiles * KB_PER_TILE) / 1024), tooBig: tiles > ZONE_MAX_TILES };
}

export type ZoneStatus = 'descargando' | 'pausada' | 'completa' | 'error';
export type ManualZone = {
  id: string;
  name: string;
  bounds: WpBounds;
  minZoom: number;
  maxZoom: number;
  tiles: number;
  createdAt: string;
  status: ZoneStatus;
  /** Teselas ya bajadas y peso real que ocupa la zona. */
  done: number;
  bytes: number;
  error?: string;
};

type Meta = { kind: 'manual'; name: string; bounds: number[]; minZoom: number; maxZoom: number; tiles: number; createdAt: string };
const isManual = (p: OfflinePack) => (p.metadata as Partial<Meta> | undefined)?.kind === 'manual';

// Estado compartido entre el mapa y la pantalla de zonas (MapLibre admite un solo listener por paquete).
let zones: ManualZone[] = [];
let loaded = false;
const subs = new Set<() => void>();
const emit = () => { zones = [...zones]; subs.forEach((f) => f()); };
const patch = (id: string, p: Partial<ManualZone>) => {
  const i = zones.findIndex((z) => z.id === id);
  if (i < 0) return;
  zones[i] = { ...zones[i]!, ...p };
  emit();
};
// La barra de progreso se actualiza cada ~10 teselas para no saturar la pantalla.
const lastDone = new Map<string, number>();

const onProgress = (p: OfflinePack, s: OfflinePackStatus) => {
  const complete = s.state === 'complete' || s.percentage >= 100;
  const prev = lastDone.get(p.id) ?? -100;
  if (!complete && s.completedTileCount - prev < 10) return;
  lastDone.set(p.id, s.completedTileCount);
  patch(p.id, { status: complete ? 'completa' : s.state === 'active' ? 'descargando' : 'pausada', done: s.completedTileCount, bytes: s.completedResourceSize });
};
// Un error suelto (sin señal un momento, tesela inexistente) no frena la descarga: MapLibre sigue y reintenta después.
const onError = (p: OfflinePack, e: { message: string }) => patch(p.id, { error: e.message });
const listen = (id: string) => void OfflineManager.addListener(id, onProgress, onError).catch(() => undefined);

async function toZone(p: OfflinePack): Promise<ManualZone> {
  const m = p.metadata as unknown as Meta;
  const s = await p.status().catch(() => null);
  const complete = !!s && (s.state === 'complete' || s.percentage >= 100);
  return {
    id: p.id, name: m.name, bounds: m.bounds as WpBounds, minZoom: m.minZoom, maxZoom: m.maxZoom, tiles: m.tiles, createdAt: m.createdAt,
    status: complete ? 'completa' : s?.state === 'active' ? 'descargando' : 'pausada',
    done: s?.completedTileCount ?? 0, bytes: s?.completedResourceSize ?? 0,
  };
}

/** Vuelve a leer las zonas guardadas en el teléfono. */
export async function loadZones() {
  const packs = (await OfflineManager.getPacks()).filter(isManual);
  zones = await Promise.all(packs.map(toZone));
  for (const z of zones) if (z.status !== 'completa') listen(z.id);
  loaded = true;
  emit();
}

/** Descarga una zona nueva con la imagen satelital entre z12 y z18. */
export async function createZone(name: string, bounds: WpBounds): Promise<void> {
  const est = estimateZone(bounds);
  if (est.tooBig) throw new Error('La zona es muy grande: acerca el mapa.');
  const meta: Meta = { kind: 'manual', name, bounds, minZoom: ZONE_MIN_ZOOM, maxZoom: ZONE_MAX_ZOOM, tiles: est.tiles, createdAt: new Date().toISOString() };
  const pack = await OfflineManager.createPack(
    { mapStyle: SATELLITE_STYLE_URL, bounds, minZoom: ZONE_MIN_ZOOM, maxZoom: ZONE_MAX_ZOOM, metadata: meta },
    onProgress,
    onError,
  );
  zones = [{ ...(await toZone(pack)), status: 'descargando' }, ...zones];
  emit();
}

/** Detiene la descarga; lo ya bajado queda guardado y se puede continuar después. */
export async function pauseZone(id: string) {
  const p = await OfflineManager.getPack(id);
  await p.pause();
  patch(id, { status: 'pausada' });
}

export async function resumeZone(id: string) {
  const p = await OfflineManager.getPack(id);
  listen(id);
  patch(id, { status: 'descargando', error: undefined });
  await p.resume();
}

/** Borra la zona: MapLibre conserva las teselas que usa otra zona o el mapa de la brigada. */
export async function deleteZone(id: string) {
  OfflineManager.removeListener(id);
  await OfflineManager.deletePack(id);
  zones = zones.filter((z) => z.id !== id);
  emit();
}

/** Peso real de todos los mapas guardados (brigada y zonas). Aproximado: una tesela compartida cuenta en cada paquete. */
export async function totalOfflineBytes(): Promise<number> {
  const packs = await OfflineManager.getPacks();
  const st = await Promise.all(packs.map((p) => p.status().catch(() => null)));
  return st.reduce((n, s) => n + (s?.completedResourceSize ?? 0), 0);
}

/** Zonas manuales, de la más nueva a la más antigua. */
export function useOfflineZones(): ManualZone[] {
  const list = useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (!loaded) void loadZones().catch(() => undefined);
      return () => { subs.delete(f); };
    },
    () => zones,
  );
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
