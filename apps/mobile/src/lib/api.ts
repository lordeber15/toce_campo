import type { AuthResponse } from '@toce/shared';
import { API_URL } from './config';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
/** Error de red: no hay conexión o el servidor no responde. */
export class OfflineError extends Error {
  constructor() {
    super('Sin conexión con el servidor');
  }
}

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };
export const hasAccessToken = () => accessToken !== null;
export const getAccessToken = () => accessToken;

/** Renueva el token de acceso (lo registra AuthProvider). Devuelve false si no se pudo. */
let refresher: (() => Promise<boolean>) | null = null;
let refreshing: Promise<boolean> | null = null;
export const setRefreshHandler = (fn: (() => Promise<boolean>) | null) => { refresher = fn; };
/** Renueva el token una sola vez aunque varias llamadas lo pidan a la vez. */
export const refreshAccessToken = (): Promise<boolean> => {
  if (!refresher) return Promise.resolve(false);
  refreshing ??= refresher().finally(() => { refreshing = null; });
  return refreshing;
};

export async function api<T>(path: string, init: RequestInit = {}, timeoutMs = 12000): Promise<T> {
  try {
    return await request<T>(path, init, timeoutMs);
  } catch (e) {
    // El token de acceso dura 15 min: si venció, se renueva una vez y se reintenta.
    if (e instanceof ApiError && e.status === 401 && accessToken && refresher && !path.startsWith('/auth/')) {
      if (await refreshAccessToken()) return request<T>(path, init, timeoutMs);
    }
    throw e;
  }
}

async function request<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(API_URL + path, { ...init, headers, signal: ctrl.signal });
  } catch {
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Error ${res.status}`);
  return data as T;
}

export const loginRequest = (dni: string, password: string, deviceId: string, deviceName: string) =>
  api<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ dni, password, deviceId, deviceName }) });

export const refreshRequest = (refreshToken: string) =>
  api<AuthResponse>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }, 8000);

export const logoutRequest = () => api('/auth/logout', { method: 'POST' }, 5000);

/** ¿El servidor responde? (no basta con tener Wi-Fi: puede no haber salida a internet). */
export async function pingServer(timeoutMs = 3000): Promise<boolean> {
  try {
    await api('/health', {}, timeoutMs);
    return true;
  } catch {
    return false;
  }
}
