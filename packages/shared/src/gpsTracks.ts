import { z } from 'zod';

/**
 * Tracking GPS por estación de muestreo (EM): el especialista lo activa y desactiva desde la EM;
 * cada tramo (sesión) guarda dónde y cuándo se activó y se desactivó, más los puntos del recorrido.
 * Mínimo acumulado por especialista y EM: 2 h (si al cerrar no llega, se genera una alerta automática).
 */

/** Tiempo mínimo de tracking por EM y especialista. */
export const TRACK_MIN_SECONDS = 2 * 3600;
/** EM con tracking activo al mismo tiempo en un teléfono. */
export const TRACK_MAX_ACTIVE = 2;
/** Sin puntos durante más de este tiempo con el tracking activo = hueco en el recorrido. */
export const TRACK_GAP_SECONDS = 5 * 60;
/** Puntos por envío al servidor. */
export const TRACK_POINTS_BATCH = 500;

const isoDateTime = z.string().datetime({ offset: true });
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const trackPointSchema = z.object({
  at: isoDateTime,
  lat,
  lng,
  accuracy: z.number().nonnegative().nullish(),
  altitude: z.number().nullish(),
});
export type TrackPoint = z.infer<typeof trackPointSchema>;

/** Envío idempotente de un tramo de tracking (por clientId) con un lote de sus puntos. */
export const trackSyncSchema = z.object({
  clientId: z.string().uuid(),
  stationId: z.string().uuid(),
  scheduleId: z.string().uuid().nullish(),
  brigadeId: z.string().uuid().nullish(),
  startedAt: isoDateTime,
  startLat: lat.nullish(),
  startLng: lng.nullish(),
  startAccuracy: z.number().nonnegative().nullish(),
  endedAt: isoDateTime.nullish(),
  endLat: lat.nullish(),
  endLng: lng.nullish(),
  endAccuracy: z.number().nonnegative().nullish(),
  deviceId: z.string().max(200).nullish(),
  clientUpdatedAt: isoDateTime,
  points: z.array(trackPointSchema).max(2000).default([]),
});
export type TrackSync = z.infer<typeof trackSyncSchema>;

export const trackQuerySchema = z.object({
  brigadeId: z.string().uuid().optional(),
  stationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type TrackQuery = z.infer<typeof trackQuerySchema>;

/** Un tramo de tracking (de activar a desactivar) con su recorrido. */
export type TrackSessionDto = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  start: { lat: number; lng: number } | null;
  end: { lat: number; lng: number } | null;
  durationSec: number;
  pointCount: number;
  /** Tiempo sin puntos dentro del tramo (huecos de más de TRACK_GAP_SECONDS). */
  gapSec: number;
  gaps: number;
  /** Recorrido [lng, lat]. */
  line: [number, number][];
};

/** Tracking de un especialista en una EM: tramos y total acumulado. */
export type TrackGroupDto = {
  stationId: string;
  stationCode: string;
  userId: string;
  userName: string;
  brigadeId: string | null;
  brigadeName: string | null;
  totalSec: number;
  active: boolean;
  sessions: TrackSessionDto[];
};

/** "1 h 25 min", "40 min". */
export function formatTrackDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}
