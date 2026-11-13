import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export type Position = { lat: number; lng: number; accuracy: number | null; altitude: number | null; at: number };
export type PositionState =
  | { status: 'waiting'; position: null }
  | { status: 'denied'; position: null }
  | { status: 'ok'; position: Position };

/**
 * Posición del teléfono mientras la pantalla está abierta (solo en primer plano).
 * El GPS funciona sin internet, así que la distancia a las estaciones también.
 */
export function usePosition(): PositionState {
  const [state, setState] = useState<PositionState>({ status: 'waiting', position: null });

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (perm.status !== 'granted') return setState({ status: 'denied', position: null });
      const toPos = (l: Location.LocationObject): Position => ({
        lat: l.coords.latitude, lng: l.coords.longitude, accuracy: l.coords.accuracy ?? null, altitude: l.coords.altitude ?? null, at: l.timestamp,
      });
      // Última posición conocida para mostrar algo de inmediato; luego se afina.
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last && !cancelled) setState({ status: 'ok', position: toPos(last) });
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 5000 },
        (l) => setState({ status: 'ok', position: toPos(l) }),
      );
      if (cancelled) sub.remove();
    })().catch(() => !cancelled && setState({ status: 'denied', position: null }));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  return state;
}

/** "350 m" o "2,4 km". */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toLocaleString('es-PE', { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`;
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
/** Rumbo aproximado desde la posición actual hacia el destino (N, NE, E...). */
export function bearingLabel(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(toLng - fromLng)) * Math.cos(toRad(toLat));
  const x = Math.cos(toRad(fromLat)) * Math.sin(toRad(toLat)) - Math.sin(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.cos(toRad(toLng - fromLng));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return DIRS[Math.round(deg / 45) % 8]!;
}
