import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import * as Device from 'expo-device';
import type { AuthUser } from '@toce/shared';
import { ApiError, OfflineError, loginRequest, logoutRequest, refreshRequest, setAccessToken, setRefreshHandler } from './api';
import * as store from './secure';

/**
 * signedOut: sin sesión en el teléfono -> DNI + contraseña (requiere conexión).
 * unlocked:  dentro de la app. La sesión queda abierta (también sin conexión)
 *            hasta que el usuario la cierre o el servidor la revoque.
 */
export type AuthStatus = 'loading' | 'signedOut' | 'unlocked';

type Ctx = {
  status: AuthStatus;
  user: AuthUser | null;
  /** true si el último intento de contacto con el servidor funcionó. */
  online: boolean;
  notice: string | null;
  signIn: (dni: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearNotice: () => void;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [online, setOnline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const forceSignOut = useCallback(async (msg: string) => {
    await store.wipeAuth();
    setAccessToken(null);
    setUser(null);
    setNotice(msg);
    setStatus('signedOut');
  }, []);

  /** Si hay red, renueva el token y valida que el usuario siga activo. Sin red no hace nada. */
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
        setOnline(false); // sin red: se sigue trabajando offline con la sesión guardada
      }
      return false;
    }
  }, [forceSignOut]);

  // Las llamadas al API renuevan el token vencido con la sesión guardada.
  useEffect(() => {
    setRefreshHandler(refreshInBackground);
    return () => setRefreshHandler(null);
  }, [refreshInBackground]);

  // Al abrir la app: si hay sesión guardada se entra directo, sin PIN ni contraseña.
  useEffect(() => {
    (async () => {
      const session = await store.getSession();
      if (!session) return setStatus('signedOut');
      setUser(session.user);
      setStatus('unlocked');
      void refreshInBackground();
    })();
  }, [refreshInBackground]);

  // Al volver de segundo plano se intenta renovar el token (si hay red).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refreshInBackground();
    });
    return () => sub.remove();
  }, [refreshInBackground]);

  const signIn = async (dni: string, password: string) => {
    const deviceId = await store.getDeviceId();
    const deviceName = [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || Platform.OS;
    try {
      const r = await loginRequest(dni, password, deviceId, deviceName);
      await store.wipeAuth(); // un usuario activo por dispositivo
      await store.saveSession({ refreshToken: r.refreshToken, user: r.user, savedAt: new Date().toISOString() });
      setAccessToken(r.accessToken);
      setUser(r.user);
      setOnline(true);
      setNotice(null);
      setStatus('unlocked');
    } catch (e) {
      if (e instanceof OfflineError) throw new Error('Necesitas conexión a internet para el primer ingreso.');
      throw e;
    }
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
    <AuthContext.Provider value={{ status, user, online, notice, signIn, signOut, clearNotice: () => setNotice(null) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
