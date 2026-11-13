import type { AuthResponse, AuthUser } from '@toce/shared';

const API = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/api';
const RT_KEY = 'toce.rt';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onLogout: (() => void) | null = null;

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: { path: string; message: string }[]) {
    super(message);
  }
}

export function setLogoutHandler(fn: () => void) {
  onLogout = fn;
}

function storeSession(r: AuthResponse) {
  accessToken = r.accessToken;
  try { localStorage.setItem(RT_KEY, r.refreshToken); } catch { /* almacenamiento no disponible */ }
}

export function clearSession() {
  accessToken = null;
  try { localStorage.removeItem(RT_KEY); } catch { /* noop */ }
}

async function raw(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  return fetch(API + path, { ...init, headers });
}

async function tryRefresh(): Promise<boolean> {
  let rt: string | null = null;
  try { rt = localStorage.getItem(RT_KEY); } catch { /* noop */ }
  if (!rt) return false;
  refreshing ??= (async () => {
    const res = await raw('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: rt }) });
    if (!res.ok) { clearSession(); return false; }
    storeSession(await res.json());
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init);
  if (res.status === 401 && path !== '/auth/login' && (await tryRefresh())) res = await raw(path, init);
  if (res.status === 401 && path !== '/auth/login') { clearSession(); onLogout?.(); }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Error de conexión', data?.issues);
  return data as T;
}

export async function login(dni: string, password: string): Promise<AuthUser> {
  const r = await api<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ dni, password }) });
  storeSession(r);
  return r.user;
}

export async function restoreSession(): Promise<AuthUser | null> {
  if (!(await tryRefresh())) return null;
  return api<AuthUser>('/auth/me');
}

export async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* noop */ }
  clearSession();
}
