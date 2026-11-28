import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import { OfflineManager } from '@maplibre/maplibre-react-native';
import type { WpBrigade, WpProject } from '@toce/shared';
import { api } from './api';
import { API_URL } from './config';

/**
 * Imagen satelital offline por brigada: el servidor arma un solo archivo (PMTiles, WebP) con el KMZ
 * completo de la brigada y franjas alrededor de sus líneas, puntos y estaciones; el teléfono lo baja
 * y MapLibre lo lee directo, sin internet. Reemplaza los paquetes satelitales de MapLibre (rectángulo
 * completo, mucho más pesados).
 */

type ServerStatus =
  | { status: 'ready'; url: string; version: string; bytes: number; tiles: number; maxZoom: number; reduced: boolean; builtAt: string }
  | { status: 'building'; done: number; total: number; maxZoom?: number; reduced?: boolean }
  | { status: 'none' | 'tooBig' | 'error'; message: string; done?: number; total?: number };

type LocalMeta = { version: string; bytes: number; maxZoom: number; reduced: boolean; downloadedAt: string };

export type SatState =
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'preparing'; done: number; total: number }
  | { status: 'downloading'; written: number; total: number }
  | { status: 'complete'; bytes: number; downloadedAt: string; maxZoom: number; reduced: boolean; outdated: boolean }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

const dir = () => {
  const d = new Directory(Paths.document, 'satelite');
  if (!d.exists) d.create({ intermediates: true });
  return d;
};
const packFile = (brigadeId: string) => new File(dir(), `${brigadeId}.pmtiles`);
const metaFile = (brigadeId: string) => new File(dir(), `${brigadeId}.json`);

function readLocal(brigadeId: string): LocalMeta | null {
  try {
    const f = packFile(brigadeId);
    const m = metaFile(brigadeId);
    if (!f.exists || !m.exists) return null;
    return JSON.parse(m.textSync()) as LocalMeta;
  } catch {
    return null;
  }
}

/** Fuentes locales para el estilo: `pmtiles://file:///…` por cada brigada descargada. */
export function localSatelliteSources(brigadeIds: string[]): { id: string; url: string; maxZoom: number }[] {
  return brigadeIds.flatMap((id) => {
    const meta = readLocal(id);
    return meta ? [{ id, url: `pmtiles://${packFile(id).uri}`, maxZoom: meta.maxZoom }] : [];
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let cleaned = false;

/** Satélite offline de las brigadas del usuario en el proyecto (las que tienen KMZ, polígono o estaciones). */
export function useSatellitePacks(project: WpProject | undefined, brigades: WpBrigade[]) {
  const mine = useMemo(
    () => brigades.filter((b) => b.projectId === project?.id && b.bounds),
    [brigades, project?.id],
  );
  const key = mine.map((b) => b.id).join(',');
  const [st, setSt] = useState<Record<string, SatState>>({});
  const [rev, setRev] = useState(0);
  const running = useRef(false);
  const set = useCallback((id: string, s: SatState) => setSt((cur) => ({ ...cur, [id]: s })), []);

  // Estado inicial: lo que ya está en el teléfono; con señal, se compara con la versión del servidor.
  useEffect(() => {
    let alive = true;
    const next: Record<string, SatState> = {};
    for (const b of mine) {
      const m = readLocal(b.id);
      next[b.id] = m ? { status: 'complete', bytes: m.bytes, downloadedAt: m.downloadedAt, maxZoom: m.maxZoom, reduced: m.reduced, outdated: false } : { status: 'none' };
    }
    // Lectura de archivos locales (síncrona y barata): el estado se fija una vez por cambio de brigadas.
    setSt(next); // eslint-disable-line react-hooks/set-state-in-effect
    void (async () => {
      for (const b of mine) {
        const m = readLocal(b.id);
        try {
          const s = await api<ServerStatus>(`/basemap/satellite/brigade/${b.id}`, {}, 30000);
          if (!alive) return;
          if ((s.status === 'tooBig' || s.status === 'none') && !m) set(b.id, { status: 'unavailable', message: s.message });
          else if (m && s.status === 'ready' && s.version !== m.version) set(b.id, { ...(next[b.id] as Extract<SatState, { status: 'complete' }>), outdated: true });
          else if (m && s.status === 'building') set(b.id, { ...(next[b.id] as Extract<SatState, { status: 'complete' }>), outdated: true });
        } catch { /* sin señal: queda lo local */ }
      }
    })();
    // Los paquetes satelitales anteriores (rectángulo completo en MapLibre) ya no se usan: se liberan.
    if (!cleaned) {
      cleaned = true;
      void OfflineManager.getPacks().then(async (packs) => {
        for (const p of packs) if ((p.metadata as { layer?: string } | undefined)?.layer === 'sat') await OfflineManager.deletePack(p.id).catch(() => undefined);
      }).catch(() => undefined);
    }
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Baja (o actualiza) el archivo de una brigada: espera a que el servidor lo arme y lo descarga. */
  const fetchOne = useCallback(async (b: WpBrigade) => {
    const local = readLocal(b.id);
    for (;;) {
      const s = await api<ServerStatus>(`/basemap/satellite/brigade/${b.id}`, {}, 30000);
      if (s.status === 'building') { set(b.id, { status: 'preparing', done: s.done, total: s.total }); await sleep(4000); continue; }
      if (s.status !== 'ready') {
        set(b.id, s.status === 'error' ? { status: 'error', message: s.message } : { status: 'unavailable', message: s.message });
        return;
      }
      if (local && local.version === s.version) {
        set(b.id, { status: 'complete', bytes: local.bytes, downloadedAt: local.downloadedAt, maxZoom: local.maxZoom, reduced: local.reduced, outdated: false });
        return;
      }
      set(b.id, { status: 'downloading', written: 0, total: s.bytes });
      const part = new File(dir(), `${b.id}.part`);
      if (part.exists) part.delete();
      let last = 0;
      await File.downloadFileAsync(s.url, part, {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => {
          // Se actualiza la pantalla cada ~1 MB.
          if (bytesWritten - last < 1024 * 1024 && bytesWritten < totalBytes) return;
          last = bytesWritten;
          set(b.id, { status: 'downloading', written: bytesWritten, total: totalBytes > 0 ? totalBytes : s.bytes });
        },
      });
      if ((part.size ?? 0) !== s.bytes) { part.delete(); throw new Error('La descarga del satélite quedó incompleta. Vuelve a intentarlo.'); }
      const final = packFile(b.id);
      if (final.exists) final.delete();
      part.move(final);
      const meta: LocalMeta = { version: s.version, bytes: s.bytes, maxZoom: s.maxZoom, reduced: s.reduced, downloadedAt: new Date().toISOString() };
      const m = metaFile(b.id);
      if (m.exists) m.delete();
      m.create();
      m.write(JSON.stringify(meta));
      set(b.id, { status: 'complete', bytes: meta.bytes, downloadedAt: meta.downloadedAt, maxZoom: meta.maxZoom, reduced: meta.reduced, outdated: false });
      setRev((r) => r + 1);
      return;
    }
  }, [set]);

  /** Descarga lo que falta o está desactualizado. Requiere conexión. */
  const download = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (const b of mine) {
        try { await fetchOne(b); } catch (e) { set(b.id, { status: 'error', message: e instanceof Error ? e.message : 'No se pudo descargar el satélite' }); }
      }
    } finally {
      running.current = false;
    }
  }, [key, fetchOne, set]); // eslint-disable-line react-hooks/exhaustive-deps

  const sources = useMemo(() => localSatelliteSources(mine.map((b) => b.id)), [key, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return { brigades: mine, states: st, download, sources };
}

// ---------------------------------------------------------------------------
// Estilo satelital: el del servidor (imagen de Esri + calles y nombres) guardado en el teléfono,
// con los archivos de las brigadas encima de la imagen en línea.

const styleFile = () => new File(dir(), 'style.json');
const SATELLITE_STYLE_URL = `${API_URL}/basemap/satellite.json`;
type Style = { version: 8; sources: Record<string, unknown>; layers: { id: string }[]; [k: string]: unknown };

const FALLBACK: Style = {
  version: 8,
  sources: {
    esri: {
      type: 'raster', tileSize: 256, maxzoom: 18,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [{ id: 'fondo', type: 'background', paint: { 'background-color': '#1f2a24' } } as never, { id: 'satelite', type: 'raster', source: 'esri' } as never],
};

function readSavedStyle(): Style | null {
  try {
    const f = styleFile();
    return f.exists ? (JSON.parse(f.textSync()) as Style) : null;
  } catch {
    return null;
  }
}

/** Estilo satelital listo para el mapa (funciona sin señal con lo guardado). */
export function useSatelliteStyle(sources: { id: string; url: string; maxZoom: number }[], online: boolean) {
  const [base, setBase] = useState<Style>(() => readSavedStyle() ?? FALLBACK);
  useEffect(() => {
    if (!online) return;
    let alive = true;
    fetch(SATELLITE_STYLE_URL)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => {
        const s = JSON.parse(text) as Style;
        const f = styleFile();
        if (f.exists) f.delete();
        f.create();
        f.write(text);
        if (alive) setBase(s);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [online]);

  const srcKey = sources.map((s) => s.url).join('|');
  return useMemo(() => {
    const extraSources = Object.fromEntries(sources.map((s) => [`sat-${s.id}`, {
      type: 'raster', url: s.url, tileSize: 256, attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    }]));
    const extraLayers = sources.map((s) => ({ id: `sat-${s.id}`, type: 'raster', source: `sat-${s.id}` }));
    // Encima de la imagen en línea y debajo de las calles y nombres.
    const at = base.layers.findIndex((l) => l.id === 'satelite');
    const layers = at >= 0 ? [...base.layers.slice(0, at + 1), ...extraLayers, ...base.layers.slice(at + 1)] : [...base.layers, ...extraLayers];
    return { ...base, sources: { ...base.sources, ...extraSources }, layers };
  }, [base, srcKey]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const formatMbSat = (bytes: number) => `${(bytes / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits: 0 })} MB`;
