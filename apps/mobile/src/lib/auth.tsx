import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Device from 'expo-device';
import type { AuthUser } from '@toce/shared';
import { ApiError, OfflineError, loginRequest, logoutRequest, pingServer, refreshRequest, setAccessToken, setRefreshHandler } from './api';
import { PIN_MAX_ATTEMPTS } from './config';
import * as store from './secure';

/**
 * signedOut: sin sesión en el teléfono -> DNI + contraseña (requiere conexión).
 * needsPin:  primer ingreso hecho, falta crear el PIN para uso offline.
 * reauth:    hay sesión y el servidor responde -> contraseña (DNI ya fijado).
 * locked:    hay sesión y NO hay conexión con el servidor -> PIN o biometría.
 * unlocked:  dentro de la app.
 */
export type AuthStatus = 'loading' | 'signedOut' | 'needsPin' | 'reauth' | 'locked' | 'unlocked';
type Biometry = { available: boolean; label: string };

type Ctx = {
  status: AuthStatus;
  user: AuthUser | null;
  /** true si el último intento de contacto con el servidor funcionó. */
  online: boolean;
  notice: string | null;
  biometry: Biometry;
  biometricEnabled: boolean;
  attemptsLeft: number;
  signIn: (dni: string, password: string) => Promise<void>;
  /** Con conexión: reingreso con contraseña del usuario ya registrado en el teléfono. */
  reauthWithPassword: (password: string) => Promise<void>;
  /** Vuelve a comprobar la conexión y muestra la pantalla de contraseña o de PIN. */
  checkConnectionAndLock: () => Promise<boolean>;
  /** Pasa directo a la pantalla de PIN (p. ej. señal muy débil). */
  usePinInstead: () => void;
  setupPin: (pin: string, enableBiometric: boolean) => Promise<void>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  lock: () => void;
  signOut: () => Promise<void>;
  clearNotice: () => void;
};

const AuthContext = createContext<Ctx | null>(null);
/** Bloquea la app si estuvo en segundo plano más de este tiempo. */
const BACKGROUND_LOCK_MS = 2 * 60 * 1000;

async function detectBiometry(): Promise<Biometry> {
  try {
    const [hw, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    return { available: hw && enrolled, label: face ? (Platform.OS === 'ios' ? 'Face ID' : 'reconocimiento facial') : 'huella' };
  } catch {
    return { available: false, label: 'huella' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [online, setOnline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [biometry, setBiometry] = useState<Biometry>({ available: false, label: 'huella' });
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(PIN_MAX_ATTEMPTS);
  const backgroundAt = useRef<number | null>(null);
  const statusRef = useRef<AuthStatus>('loading');
  statusRef.current = status;

  const forceSignOut = useCallback(async (msg: string) => {
    await store.wipeAuth();
    setAccessToken(null);
    setUser(null);
    setNotice(msg);
    setStatus('signedOut');
  }, []);

  /** Tras desbloquear: si hay red, renueva el token y valida que el usuario siga activo. */
  const refreshInBackground = useCallback(async (): Promise<boolean> => {
    const session = await store.getSession();
    if (!session) return false;
    try {
      const r = await refreshRequest(session.refreshToken);
      await store.saveSession({ refreshToken: r.refreshToken, user: r.user, savedAt: new Date().toISOString() });
      setAccessToken(r.accessToken);
      setUser(r.user);
      setOnline(true);
      return true;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await forceSignOut(
          e.status === 403
            ? 'Tu usuario fue desactivado. Comunícate con coordinación.'
            : 'Tu sesión fue cerrada en el servidor. Ingresa nuevamente con tu DNI y contraseña.',
        );
      } else {
        setOnline(false); // sin red: se sigue trabajando offline
      }
      return false;
    }
  }, [forceSignOut]);

  // Las llamadas al API renuevan el token vencido con la sesión guardada.
  useEffect(() => {
    setRefreshHandler(refreshInBackground);
    return () => setRefreshHandler(null);
  }, [refreshInBackground]);

  useEffect(() => {
    (async () => {
      setBiometry(await detectBiometry());
      const [session, pin] = await Promise.all([store.getSession(), store.getPin()]);
      if (!session) return setStatus('signedOut');
      setUser(session.user);
      if (!pin) return setStatus('needsPin');
      setBiometricEnabled(pin.biometric);
      setAttemptsLeft(PIN_MAX_ATTEMPTS - pin.failed);
      const reachable = await pingServer();
      setOnline(reachable);
      setStatus(reachable ? 'reauth' : 'locked');
    })();
  }, []);

  const checkConnectionAndLock = useCallback(async () => {
    const reachable = await pingServer();
    setOnline(reachable);
    setStatus(reachable ? 'reauth' : 'locked');
    return reachable;
  }, []);

  // Bloqueo automático al volver de segundo plano.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') backgroundAt.current = Date.now();
      if (s === 'active' && backgroundAt.current && Date.now() - backgroundAt.current > BACKGROUND_LOCK_MS) {
        if (statusRef.current === 'unlocked') void checkConnectionAndLock();
      }
      if (s === 'active') backgroundAt.current = null;
    });
    return () => sub.remove();
  }, [checkConnectionAndLock]);

  const signIn = async (dni: string, password: string) => {
    const deviceId = await store.getDeviceId();
    const deviceName = [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || Platform.OS;
    try {
      const r = await loginRequest(dni, password, deviceId, deviceName);
      const prev = await store.getSession();
      const pin = await store.getPin();
      const sameUser = prev?.user.id === r.user.id;
      // Un usuario activo por dispositivo: si cambia el usuario se descarta el PIN del anterior.
      if (!sameUser) await store.wipeAuth();
      await store.saveSession({ refreshToken: r.refreshToken, user: r.user, savedAt: new Date().toISOString() });
      setAccessToken(r.accessToken);
      setUser(r.user);
      setOnline(true);
      setNotice(null);
      if (sameUser && pin) {
        if (pin.failed) await store.savePin({ ...pin, failed: 0 });
        setAttemptsLeft(PIN_MAX_ATTEMPTS);
        setStatus('unlocked');
      } else {
        setStatus('needsPin');
      }
    } catch (e) {
      if (e instanceof OfflineError) throw new Error('Necesitas conexión a internet para el primer ingreso.');
      throw e;
    }
  };

  const reauthWithPassword = async (password: string) => {
    if (!user) return setStatus('signedOut');
    try {
      await signIn(user.dni, password);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Necesitas conexión')) {
        // Se cayó la señal entre la comprobación y el envío: pasar a PIN.
        setOnline(false);
        setNotice('Se perdió la conexión. Ingresa con tu PIN.');
        setStatus('locked');
        return;
      }
      throw e;
    }
  };

  const setupPin = async (pin: string, enableBiometric: boolean) => {
    const salt = store.newSalt();
    await store.savePin({ salt, hash: await store.hashPin(pin, salt), failed: 0, biometric: enableBiometric });
    setBiometricEnabled(enableBiometric);
    setAttemptsLeft(PIN_MAX_ATTEMPTS);
    setStatus('unlocked');
  };

  const onUnlocked = async () => {
    const pin = await store.getPin();
    if (pin && pin.failed) await store.savePin({ ...pin, failed: 0 });
    setAttemptsLeft(PIN_MAX_ATTEMPTS);
    setStatus('unlocked');
    void refreshInBackground();
  };

  const unlockWithPin = async (entered: string) => {
    const pin = await store.getPin();
    if (!pin) {
      setStatus('needsPin');
      return false;
    }
    if ((await store.hashPin(entered, pin.salt)) === pin.hash) {
      await onUnlocked();
      return true;
    }
    const failed = pin.failed + 1;
    if (failed >= PIN_MAX_ATTEMPTS) {
      await forceSignOut('Demasiados intentos con PIN incorrecto. Ingresa con tu DNI y contraseña (requiere conexión).');
      return false;
    }
    await store.savePin({ ...pin, failed });
    setAttemptsLeft(PIN_MAX_ATTEMPTS - failed);
    return false;
  };

  const unlockWithBiometric = async () => {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Desbloquear TOCE Campo',
      cancelLabel: 'Usar PIN',
      disableDeviceFallback: true,
    });
    if (r.success) await onUnlocked();
    return r.success;
  };

  const signOut = async () => {
    try { await logoutRequest(); } catch { /* sin red: igual se cierra localmente */ }
    await store.wipeAuth();
    setAccessToken(null);
    setUser(null);
    setNotice(null);
    setStatus('signedOut');
  };

  return (
    <AuthContext.Provider
      value={{
        status, user, online, notice, biometry, biometricEnabled, attemptsLeft,
        signIn, reauthWithPassword, checkConnectionAndLock, setupPin,
        usePinInstead: () => setStatus('locked'), unlockWithPin, unlockWithBiometric, signOut,
        lock: () => void checkConnectionAndLock(),
        clearNotice: () => setNotice(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
