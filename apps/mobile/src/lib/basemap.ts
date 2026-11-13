import { useCallback, useEffect, useRef, useState } from 'react';
import { OfflineManager, type OfflinePack } from '@maplibre/maplibre-react-native';
import type { WpProject } from '@toce/shared';
import { API_URL } from './config';

/** Estilo del mapa base OSM servido por nuestro API (ver apps/api/src/routes/basemap.ts). */
export const BASEMAP_STYLE_URL = `${API_URL}/basemap/style.json`;
/** El servidor tiene teselas hasta z15; el mapa amplía más allá sin perder las capas. */
const MIN_ZOOM = 8;
const MAX_ZOOM = 15;
/** Margen alrededor de estaciones y capas (grados, ~4 km). */
const MARGIN = 0.04;

OfflineManager.setTileCountLimit(30000);

export type BasemapState =
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'downloading'; percent: number; bytes: number }
  | { status: 'complete'; bytes: number; downloadedAt: string | null }
  | { status: 'error'; message: string };

type Meta = { projectId: string; bounds: number[]; downloadedAt?: string };

const sameBounds = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < 1e-6);

/** Zona offline del proyecto: estado, descarga (reanudable) y actualización. */
export function useBasemap(project: WpProject | undefined) {
  const [state, setState] = useState<BasemapState>({ status: 'checking' });
  const packRef = useRef<OfflinePack | null>(null);
  const bounds = project?.bounds
    ? ([project.bounds[0] - MARGIN, project.bounds[1] - MARGIN, project.bounds[2] + MARGIN, project.bounds[3] + MARGIN] as [number, number, number, number])
    : null;
  const key = bounds?.join(',') ?? '';

  const onProgress = useCallback((_p: OfflinePack, s: { state: string; percentage: number; completedResourceSize: number }) => {
    if (s.state === 'complete' || s.percentage >= 100) setState({ status: 'complete', bytes: s.completedResourceSize, downloadedAt: new Date().toISOString() });
    else setState({ status: 'downloading', percent: Math.floor(s.percentage), bytes: s.completedResourceSize });
  }, []);
  const onError = useCallback((_p: OfflinePack, e: { message: string }) => {
    setState({ status: 'error', message: e.message || 'No se pudo descargar el mapa' });
  }, []);

  const refresh = useCallback(async () => {
    if (!project || !bounds) return setState({ status: 'none' });
    try {
      const packs = await OfflineManager.getPacks();
      const pack = packs.find((p) => (p.metadata as Meta | undefined)?.projectId === project.id);
      packRef.current = pack ?? null;
      if (!pack) return setState({ status: 'none' });
      await OfflineManager.addListener(pack.id, onProgress, onError);
      const meta = pack.metadata as Meta;
      const st = await pack.status();
      if (st.state === 'complete' || st.percentage >= 100) {
        // Si la zona del proyecto creció (nuevas estaciones o capas), hay que volver a descargar.
        if (!sameBounds(meta.bounds, bounds)) return setState({ status: 'none' });
        setState({ status: 'complete', bytes: st.completedResourceSize, downloadedAt: meta.downloadedAt ?? null });
      } else {
        setState({ status: 'downloading', percent: Math.floor(st.percentage), bytes: st.completedResourceSize });
      }
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Error del mapa offline' });
    }
  }, [project?.id, key, onProgress, onError]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void refresh();
    return () => {
      if (packRef.current) OfflineManager.removeListener(packRef.current.id);
    };
  }, [refresh]);

  /** Descarga (o reanuda) la zona del proyecto. Requiere conexión con el servidor. */
  const download = useCallback(async () => {
    if (!project || !bounds) return;
    setState({ status: 'downloading', percent: 0, bytes: 0 });
    try {
      const existing = packRef.current;
      if (existing && sameBounds((existing.metadata as Meta).bounds, bounds)) {
        await OfflineManager.addListener(existing.id, onProgress, onError);
        await existing.resume();
        return;
      }
      if (existing) await OfflineManager.deletePack(existing.id);
      const meta: Meta = { projectId: project.id, bounds, downloadedAt: new Date().toISOString() };
      packRef.current = await OfflineManager.createPack(
        { mapStyle: BASEMAP_STYLE_URL, bounds, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, metadata: meta },
        onProgress,
        onError,
      );
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : 'No se pudo descargar el mapa' });
    }
  }, [project?.id, key, onProgress, onError]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Borra y vuelve a descargar (mapa actualizado). */
  const redownload = useCallback(async () => {
    if (packRef.current) await OfflineManager.deletePack(packRef.current.id).catch(() => undefined);
    packRef.current = null;
    await download();
  }, [download]);

  return { state, download, redownload, bounds };
}

export const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits: 1 })} MB`;
