import * as SecureStore from './secureStore';
import * as Crypto from 'expo-crypto';
import type { AuthUser } from '@toce/shared';

/**
 * Todo lo sensible vive en SecureStore (Keychain en iOS, Keystore en Android),
 * cifrado por el sistema operativo y ligado al dispositivo.
 */
const K = {
  deviceId: 'toce.deviceId',
  session: 'toce.session',
  pin: 'toce.pin',
} as const;

export type StoredSession = { refreshToken: string; user: AuthUser; savedAt: string };
export type StoredPin = { salt: string; hash: string; failed: number; biometric: boolean };

const getJson = async <T,>(k: string): Promise<T | null> => {
  const v = await SecureStore.getItemAsync(k);
  if (!v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
};
const setJson = (k: string, v: unknown) => SecureStore.setItemAsync(k, JSON.stringify(v));

export async function getDeviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync(K.deviceId);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(K.deviceId, id);
  }
  return id;
}

export const getSession = () => getJson<StoredSession>(K.session);
export const saveSession = (s: StoredSession) => setJson(K.session, s);
export const getPin = () => getJson<StoredPin>(K.pin);
export const savePin = (p: StoredPin) => setJson(K.pin, p);

/** Borra sesión y PIN (no el deviceId). */
export async function wipeAuth() {
  await SecureStore.deleteItemAsync(K.session);
  await SecureStore.deleteItemAsync(K.pin);
}

/** Hash del PIN con sal aleatoria e iteraciones (el bloqueo a 5 intentos es la defensa principal). */
export async function hashPin(pin: string, salt: string): Promise<string> {
  let h = `${salt}:${pin}`;
  for (let i = 0; i < 300; i++) {
    h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}${h}`);
  }
  return h;
}

export function newSalt(): string {
  return Crypto.randomUUID().replace(/-/g, '');
}
