import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Accelerometer, Magnetometer } from 'expo-sensors';
import * as Location from 'expo-location';
import { rearCameraBearing, type Vector3 } from '@toce/shared';

type Sample = Vector3 & { at: number };
/** Lee el rumbo del eje óptico trasero. No confunde brújula con dirección de movimiento GPS. */
export function usePhotoCompass(enabled: boolean) {
  const samples = useRef<{ up?: Sample; magnetic?: Sample; accuracy?: number }>({});
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    let cancelled = false;
    const subscriptions: { remove(): void }[] = [];
    const add = (sub: { remove(): void }) => { if (cancelled) sub.remove(); else subscriptions.push(sub); };
    void (async () => {
      const available = await Promise.all([Accelerometer.isAvailableAsync(), Magnetometer.isAvailableAsync()]);
      if (cancelled || available.some((v) => !v)) return;
      const permission = await Accelerometer.requestPermissionsAsync();
      if (cancelled || !permission.granted) return;
      Accelerometer.setUpdateInterval(200); Magnetometer.setUpdateInterval(200);
      add(Accelerometer.addListener((v) => {
        // CoreMotion iOS informa gravedad hacia abajo; Android aceleración de soporte hacia arriba.
        const sign = Platform.OS === 'ios' ? -1 : 1;
        samples.current.up = { x: sign*v.x, y: sign*v.y, z: sign*v.z, at: Date.now() };
      }));
      add(Magnetometer.addListener((v) => { samples.current.magnetic = { ...v, at: Date.now() }; }));
      add(await Location.watchHeadingAsync((h) => { samples.current.accuracy = h.accuracy; }));
    })().catch(() => { samples.current = {}; });
    return () => { cancelled = true; subscriptions.forEach((sub) => sub.remove()); samples.current = {}; };
  }, [enabled]);
  return () => {
    const { up, magnetic, accuracy } = samples.current;
    if (!up || !magnetic || accuracy == null || accuracy < 2 || Date.now()-up.at > 2000 || Date.now()-magnetic.at > 2000) return null;
    return rearCameraBearing(up, magnetic);
  };
}
