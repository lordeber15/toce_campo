import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WorkPackage, WorkPackageUnchanged, WpMethod, WpSchedule, WpStation, WpStationMethod, WpUnit } from '@toce/shared';
import { ApiError, OfflineError, api, hasAccessToken } from './api';
import { useAuth } from './auth';
import { getDb } from './db';
import { getDeviceId } from './secure';
import { useFieldOverlay } from './field';

/** Con conexión, el paquete se vuelve a pedir si tiene más de este tiempo. */
const AUTO_REFRESH_MS = 10 * 60 * 1000;

type Ctx = {
  pkg: WorkPackage | null;
  downloadedAt: string | null;
  /** true mientras se lee el paquete guardado en el teléfono. */
  loading: boolean;
  syncing: boolean;
  error: string | null;
  download: () => Promise<void>;
};

const WorkPackageContext = createContext<Ctx | null>(null);

/** Fecha de hoy en Lima (AAAA-MM-DD), según el reloj del teléfono. */
export function todayLima(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function WorkPackageProvider({ children }: { children: ReactNode }) {
  const { user, status, online } = useAuth();
  const [pkg, setPkg] = useState<WorkPackage | null>(null);
  const [downloadedAt, setDownloadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const userId = user?.id ?? null;

  // Carga el paquete guardado del usuario actual. Un usuario por teléfono: se borra el de otros.
  useEffect(() => {
    let cancelled = false;
    setPkg(null);
    setDownloadedAt(null);
    setError(null);
    if (!userId) return setLoading(false);
    setLoading(true);
    (async () => {
      const db = await getDb();
      await db.runAsync('DELETE FROM work_package WHERE user_id <> ?', userId);
      const row = await db.getFirstAsync<{ data: string; downloaded_at: string }>(
        'SELECT data, downloaded_at FROM work_package WHERE user_id = ?', userId);
      if (cancelled) return;
      if (row) {
        const saved = JSON.parse(row.data) as WorkPackage;
        setPkg({ ...saved, layers: saved.layers ?? [] });
        // Paquete de una versión anterior de la app (sin capas): se vuelve a descargar apenas haya conexión.
        setDownloadedAt(saved.layers ? row.downloaded_at : null);
        if (!saved.layers) await db.runAsync("UPDATE work_package SET version = '' WHERE user_id = ?", userId);
      }
    })()
      .catch(() => !cancelled && setError('No se pudo leer el paquete guardado en el teléfono.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [userId]);

  const download = useCallback(async () => {
    if (!userId) return;
    inFlight.current ??= (async () => {
      setSyncing(true);
      setError(null);
      try {
        const db = await getDb();
        const current = await db.getFirstAsync<{ version: string }>('SELECT version FROM work_package WHERE user_id = ?', userId);
        const deviceId = await getDeviceId();
        const qs = `deviceId=${encodeURIComponent(deviceId)}${current ? `&version=${current.version}` : ''}`;
        const res = await api<WorkPackage | WorkPackageUnchanged>(`/work-package?${qs}`, {}, 30000);
        const now = new Date().toISOString();
        if ('unchanged' in res) {
          await db.runAsync('UPDATE work_package SET downloaded_at = ? WHERE user_id = ?', now, userId);
        } else {
          await db.runAsync(
            `INSERT INTO work_package (user_id, version, generated_at, downloaded_at, data) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, generated_at = excluded.generated_at,
               downloaded_at = excluded.downloaded_at, data = excluded.data`,
            userId, res.version, res.generatedAt, now, JSON.stringify(res));
          setPkg(res);
        }
        setDownloadedAt(now);
      } catch (e) {
        if (e instanceof OfflineError) setError('Sin conexión con el servidor. Se usa el último paquete descargado.');
        else if (e instanceof ApiError) setError(e.message);
        else setError('No se pudo guardar el paquete en el teléfono.');
      } finally {
        setSyncing(false);
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [userId]);

  // Descarga automática al entrar con conexión, si no hay paquete o ya pasó un rato.
  useEffect(() => {
    if (loading || status !== 'unlocked' || !online || !hasAccessToken()) return;
    const age = downloadedAt ? Date.now() - new Date(downloadedAt).getTime() : Infinity;
    if (age > AUTO_REFRESH_MS) void download();
  }, [loading, status, online, downloadedAt, download]);

  return (
    <WorkPackageContext.Provider value={{ pkg, downloadedAt, loading, syncing, error, download }}>
      {children}
    </WorkPackageContext.Provider>
  );
}

export function useWorkPackage() {
  const ctx = useContext(WorkPackageContext);
  if (!ctx) throw new Error('useWorkPackage fuera de WorkPackageProvider');
  return ctx;
}

/** Avance de un método en una estación. */
export type MethodProgress = { stationMethod: WpStationMethod; method: WpMethod; units: WpUnit[]; done: number };
export type StationDay = { schedule: WpSchedule; station: WpStation; brigadeName: string; methods: MethodProgress[] };

const DONE = new Set(['completada', 'no_realizada']);
export const isUnitDone = (u: WpUnit) => DONE.has(u.status);

/** Índices y consultas sobre el paquete para las pantallas (con lo registrado en el teléfono encima). */
export function usePackageIndex() {
  const { pkg } = useWorkPackage();
  const overlay = useFieldOverlay();
  return useMemo(() => {
    if (!pkg) return null;
    const known = new Set(pkg.units.map((u) => u.id));
    // Unidades creadas en campo: se muestran hasta que el paquete descargado ya las trae.
    const fresh = overlay.newUnits.filter((u) => !(u.serverId && known.has(u.serverId))).map(({ serverId: _s, ...u }) => u);
    const allUnits = [...pkg.units, ...fresh].map((u) => {
      const st = overlay.statusByUnit.get(u.id);
      return st && st !== u.status ? { ...u, status: st } : u;
    });
    const units = new Map(allUnits.map((u) => [u.id, u]));
    // La pantalla abierta con el id local sigue encontrando la unidad cuando ya llegó con el id del servidor.
    for (const u of overlay.newUnits) if (u.serverId && units.has(u.serverId)) units.set(u.id, units.get(u.serverId)!);
    const stations = new Map(pkg.stations.map((s) => [s.id, s]));
    const methods = new Map(pkg.methods.map((m) => [m.id, m]));
    const brigades = new Map(pkg.brigades.map((b) => [b.id, b]));
    const projects = new Map(pkg.projects.map((p) => [p.id, p]));

    const methodsAt = (stationId: string): MethodProgress[] =>
      pkg.stationMethods
        .filter((sm) => sm.stationId === stationId && methods.has(sm.methodId))
        .map((sm) => {
          const units = allUnits.filter((u) => u.stationMethodId === sm.id).sort((a, b) => a.seq - b.seq);
          return { stationMethod: sm, method: methods.get(sm.methodId)!, units, done: units.filter(isUnitDone).length };
        });

    const day = (date: string): StationDay[] =>
      pkg.schedules
        .filter((s) => s.plannedDate === date && stations.has(s.stationId))
        .map((schedule) => ({
          schedule,
          station: stations.get(schedule.stationId)!,
          brigadeName: brigades.get(schedule.brigadeId)?.name ?? '',
          methods: methodsAt(schedule.stationId),
        }));

    const dates = [...new Set(pkg.schedules.map((s) => s.plannedDate))].sort();
    return { pkg, stations, methods, brigades, projects, units, methodsAt, day, dates };
  }, [pkg, overlay]);
}
