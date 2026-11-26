import { useCallback, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { TRACK_GAP_SECONDS, TRACK_MAX_ACTIVE, TRACK_POINTS_BATCH, type TrackSync } from '@toce/shared';
import { ApiError, api } from './api';
import { getDb } from './db';

/**
 * Tracking GPS por estación (EM). Una sola lectura de GPS en segundo plano (también con la pantalla
 * apagada) alimenta a todas las EM con tracking activo (hasta 2 a la vez). Todo se guarda primero en
 * SQLite y se envía al servidor con la cola de subida (lib/field.tsx → pushTracks).
 *
 * La tarea se define al cargar este módulo: debe importarse desde la raíz de la app (app/_layout.tsx)
 * para que Android pueda entregar posiciones aunque la app se haya cerrado.
 */

export const TRACK_TASK = 'toce-gps-tracking';
/** Lecturas con peor precisión se descartan (en metros). */
const MAX_ACCURACY_M = 100;

export type LocalTrackSession = {
  clientId: string;
  stationId: string;
  scheduleId: string | null;
  brigadeId: string | null;
  startedAt: string;
  startLat: number | null;
  startLng: number | null;
  endedAt: string | null;
  endLat: number | null;
  endLng: number | null;
  pointCount: number;
  lastPointAt: string | null;
  synced: boolean;
};

type SessionRow = {
  client_id: string; user_id: string; station_id: string; schedule_id: string | null; brigade_id: string | null; started_at: string;
  start_lat: number | null; start_lng: number | null; start_accuracy: number | null; ended_at: string | null; end_lat: number | null;
  end_lng: number | null; end_accuracy: number | null; updated_at: string; synced_at: string | null;
};

// ---------------------------------------------------------------------------
// Avisos de cambio (las pantallas se actualizan cuando llegan puntos o cambia un tramo)

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function onTrackingChange(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

// ---------------------------------------------------------------------------
// Tarea en segundo plano

async function savePoints(locations: Location.LocationObject[]) {
  const db = await getDb();
  const active = await db.getAllAsync<{ client_id: string; started_at: string }>('SELECT client_id, started_at FROM track_sessions WHERE ended_at IS NULL');
  if (!active.length) return;
  for (const l of locations) {
    if (l.coords.accuracy != null && l.coords.accuracy > MAX_ACCURACY_M) continue;
    const at = new Date(l.timestamp).toISOString();
    for (const s of active) {
      if (at < s.started_at) continue;
      await db.runAsync(
        'INSERT OR IGNORE INTO track_points (session_client_id, at, lat, lng, accuracy, altitude) VALUES (?, ?, ?, ?, ?, ?)',
        s.client_id, at, l.coords.latitude, l.coords.longitude, l.coords.accuracy ?? null, l.coords.altitude ?? null);
    }
  }
  emit();
}

if (!TaskManager.isTaskDefined(TRACK_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TRACK_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    await savePoints(data.locations).catch(() => {});
  });
}

/** Enciende o apaga la lectura de GPS según haya tramos activos (también al abrir la app tras un cierre). */
export async function syncLocationUpdates(): Promise<void> {
  const db = await getDb();
  const n = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM track_sessions WHERE ended_at IS NULL'))?.n ?? 0;
  const running = await Location.hasStartedLocationUpdatesAsync(TRACK_TASK).catch(() => false);
  if (n > 0 && !running) {
    const bg = await Location.getBackgroundPermissionsAsync();
    if (!bg.granted) return;
    await Location.startLocationUpdatesAsync(TRACK_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 15_000,
      distanceInterval: 5,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Fitness,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'TOCE · Tracking activo',
        notificationBody: 'Registrando tu recorrido en la estación de muestreo.',
        notificationColor: '#1F5C45',
        killServiceOnDestroy: false,
      },
    });
  } else if (n === 0 && running) {
    await Location.stopLocationUpdatesAsync(TRACK_TASK).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Activar / desactivar

export class TrackingError extends Error {}

async function currentPosition(): Promise<Location.LocationObject | null> {
  const timeout = new Promise<null>((res) => setTimeout(() => res(null), 12_000));
  const fix = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null), timeout]);
  return fix ?? (await Location.getLastKnownPositionAsync().catch(() => null));
}

/** Pide ubicación "todo el tiempo" (necesaria para seguir con la pantalla apagada). */
async function ensurePermissions() {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) throw new TrackingError('Sin permiso de ubicación. Actívalo en los ajustes del teléfono.');
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) {
    throw new TrackingError('Para registrar el recorrido con la pantalla apagada, en Ubicación elige "Permitir todo el tiempo".');
  }
}

export async function startTracking(p: { userId: string; stationId: string; scheduleId: string | null; brigadeId: string | null }) {
  const db = await getDb();
  const active = await db.getAllAsync<{ station_id: string }>('SELECT station_id FROM track_sessions WHERE user_id = ? AND ended_at IS NULL', p.userId);
  if (active.some((a) => a.station_id === p.stationId)) return;
  if (active.length >= TRACK_MAX_ACTIVE) {
    throw new TrackingError(`Ya tienes ${TRACK_MAX_ACTIVE} EM con tracking activo. Desactiva una para activar esta.`);
  }
  await ensurePermissions();
  const fix = await currentPosition();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO track_sessions (client_id, user_id, station_id, schedule_id, brigade_id, started_at, start_lat, start_lng, start_accuracy, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Crypto.randomUUID(), p.userId, p.stationId, p.scheduleId, p.brigadeId, now,
    fix?.coords.latitude ?? null, fix?.coords.longitude ?? null, fix?.coords.accuracy ?? null, now);
  if (fix) await savePoints([{ ...fix, timestamp: Date.parse(now) }]);
  await syncLocationUpdates();
  emit();
}

export async function stopTracking(clientId: string) {
  const db = await getDb();
  const fix = await currentPosition();
  const prev = await db.getFirstAsync<{ updated_at: string }>('SELECT updated_at FROM track_sessions WHERE client_id = ?', clientId);
  const now = new Date(Math.max(Date.now(), prev ? Date.parse(prev.updated_at) + 1 : 0)).toISOString();
  if (fix) await savePoints([{ ...fix, timestamp: Date.now() }]);
  await db.runAsync(
    `UPDATE track_sessions SET ended_at = ?, end_lat = ?, end_lng = ?, end_accuracy = ?, updated_at = ? WHERE client_id = ? AND ended_at IS NULL`,
    now, fix?.coords.latitude ?? null, fix?.coords.longitude ?? null, fix?.coords.accuracy ?? null, now, clientId);
  await syncLocationUpdates();
  emit();
}

// ---------------------------------------------------------------------------
// Lectura

const SESSION_SELECT = `
  SELECT s.*, (SELECT COUNT(*) FROM track_points p WHERE p.session_client_id = s.client_id) AS point_count,
    (SELECT MAX(at) FROM track_points p WHERE p.session_client_id = s.client_id) AS last_point_at,
    (SELECT COUNT(*) FROM track_points p WHERE p.session_client_id = s.client_id AND p.synced = 0) AS unsynced
  FROM track_sessions s`;

const toSession = (r: SessionRow & { point_count: number; last_point_at: string | null; unsynced: number }): LocalTrackSession => ({
  clientId: r.client_id, stationId: r.station_id, scheduleId: r.schedule_id, brigadeId: r.brigade_id, startedAt: r.started_at,
  startLat: r.start_lat, startLng: r.start_lng, endedAt: r.ended_at, endLat: r.end_lat, endLng: r.end_lng,
  pointCount: r.point_count, lastPointAt: r.last_point_at, synced: r.synced_at === r.updated_at && !r.unsynced,
});

/** Segundos de un tramo (hasta ahora si sigue activo). */
export const sessionSeconds = (s: Pick<LocalTrackSession, 'startedAt' | 'endedAt'>, now = Date.now()) =>
  Math.max(0, Math.round(((s.endedAt ? Date.parse(s.endedAt) : now) - Date.parse(s.startedAt)) / 1000));

/** Tramos del usuario en una estación y lo que acumulan; se actualiza solo. */
export function useStationTracking(userId: string | null, stationId: string) {
  const [sessions, setSessions] = useState<LocalTrackSession[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!userId) return;
    const db = await getDb();
    const rows = await db.getAllAsync<SessionRow & { point_count: number; last_point_at: string | null; unsynced: number }>(
      `${SESSION_SELECT} WHERE s.user_id = ? AND s.station_id = ? ORDER BY s.started_at`, userId, stationId);
    const n = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM track_sessions WHERE user_id = ? AND ended_at IS NULL', userId);
    setSessions(rows.map(toSession));
    setActiveCount(n?.n ?? 0);
    setNow(Date.now());
  }, [userId, stationId]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- lee SQLite (asíncrono)
    return onTrackingChange(() => void load());
  }, [load]);

  const active = sessions.find((s) => !s.endedAt) ?? null;
  // Con un tramo activo el contador avanza cada 30 s.
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, [active]);

  const totalSec = sessions.reduce((a, s) => a + sessionSeconds(s, now), 0);
  // Hueco actual: tracking activo pero sin lecturas recientes.
  const silentSec = active ? Math.round((now - Date.parse(active.lastPointAt ?? active.startedAt)) / 1000) : 0;
  return { sessions, active, activeCount, totalSec, stalled: silentSec > TRACK_GAP_SECONDS, reload: load };
}

/** Recorridos del usuario para el mapa (todas sus EM). */
export async function myTrackLines(userId: string) {
  const db = await getDb();
  const sessions = await db.getAllAsync<SessionRow & { point_count: number; last_point_at: string | null; unsynced: number }>(
    `${SESSION_SELECT} WHERE s.user_id = ? ORDER BY s.started_at`, userId);
  const pts = await db.getAllAsync<{ session_client_id: string; lat: number; lng: number }>(
    `SELECT p.session_client_id, p.lat, p.lng FROM track_points p JOIN track_sessions s ON s.client_id = p.session_client_id
     WHERE s.user_id = ? ORDER BY p.session_client_id, p.at`, userId);
  const by = new Map<string, [number, number][]>();
  for (const p of pts) {
    const l = by.get(p.session_client_id);
    if (l) l.push([p.lng, p.lat]);
    else by.set(p.session_client_id, [[p.lng, p.lat]]);
  }
  return sessions.map((r) => ({ ...toSession(r), line: by.get(r.client_id) ?? [] }));
}

// ---------------------------------------------------------------------------
// Envío al servidor (lo llama la cola de subida)

/** Sube tramos nuevos o cambiados y sus puntos pendientes, por lotes. Devuelve cuántos tramos se enviaron. */
export async function pushTracks(userId: string, deviceId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<SessionRow>(
    `SELECT s.* FROM track_sessions s WHERE s.user_id = ? AND (s.synced_at IS NULL OR s.synced_at <> s.updated_at
       OR EXISTS (SELECT 1 FROM track_points p WHERE p.session_client_id = s.client_id AND p.synced = 0))
     ORDER BY s.started_at`, userId);
  let sent = 0;
  for (const r of rows) {
    try {
      for (let first = true; ; first = false) {
        const pts = await db.getAllAsync<{ at: string; lat: number; lng: number; accuracy: number | null; altitude: number | null }>(
          'SELECT at, lat, lng, accuracy, altitude FROM track_points WHERE session_client_id = ? AND synced = 0 ORDER BY at LIMIT ?',
          r.client_id, TRACK_POINTS_BATCH);
        if (!first && !pts.length) break;
        const body: TrackSync = {
          clientId: r.client_id, stationId: r.station_id, scheduleId: r.schedule_id, brigadeId: r.brigade_id,
          startedAt: r.started_at, startLat: r.start_lat, startLng: r.start_lng, startAccuracy: r.start_accuracy,
          endedAt: r.ended_at, endLat: r.end_lat, endLng: r.end_lng, endAccuracy: r.end_accuracy,
          deviceId, clientUpdatedAt: r.updated_at, points: pts,
        };
        await api('/field/tracks', { method: 'POST', body: JSON.stringify(body) }, 30000);
        if (pts.length) {
          await db.runAsync(
            `UPDATE track_points SET synced = 1 WHERE session_client_id = ? AND synced = 0 AND at <= ?`, r.client_id, pts[pts.length - 1]!.at);
        }
        if (pts.length < TRACK_POINTS_BATCH) break;
      }
      await db.runAsync('UPDATE track_sessions SET synced_at = ?, sync_error = NULL WHERE client_id = ?', r.updated_at, r.client_id);
      sent++;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err; // sin red: se reintenta luego
      await db.runAsync('UPDATE track_sessions SET sync_error = ? WHERE client_id = ?', err.message, r.client_id);
    }
  }
  if (sent) emit();
  return sent;
}
