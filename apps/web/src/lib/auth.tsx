import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { hasAnyRole, type AuthUser, type Role } from '@toce/shared';
import * as apiLib from './api';

type Ctx = {
  user: AuthUser | null;
  loading: boolean;
  /** Debe cambiar su contraseña antes de seguir (usuarios nuevos o cargados por plantilla: contraseña = DNI). */
  mustChangePassword: boolean;
  login: (dni: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  can: (...roles: Role[]) => boolean;
};
const AuthContext = createContext<Ctx | null>(null);

/** Se recuerda en la pestaña para que recargar la página no saltee el cambio de contraseña. */
const MUST_KEY = 'toce.mustChangePassword';
const readMust = () => { try { return sessionStorage.getItem(MUST_KEY); } catch { return null; } };
const writeMust = (userId: string | null) => {
  try { if (userId) sessionStorage.setItem(MUST_KEY, userId); else sessionStorage.removeItem(MUST_KEY); } catch { /* noop */ }
};
/** La API marca mustChangePassword en la base; si /auth la devuelve se usa, si no, contraseña = DNI (inicial de la carga masiva). */
const flagged = (u: AuthUser) => (u as AuthUser & { mustChangePassword?: boolean }).mustChangePassword === true;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mustChange, setMustChange] = useState(false);

  useEffect(() => {
    apiLib.setLogoutHandler(() => setUser(null));
    apiLib.restoreSession()
      .then((u) => { setUser(u); setMustChange(!!u && (flagged(u) || readMust() === u.id)); })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value: Ctx = {
    user,
    loading,
    mustChangePassword: !!user && mustChange,
    login: async (dni, password) => {
      const u = await apiLib.login(dni, password);
      const must = flagged(u) || password === dni;
      writeMust(must ? u.id : null);
      setMustChange(must);
      setUser(u);
    },
    logout: async () => { await apiLib.logout(); writeMust(null); setMustChange(false); setUser(null); },
    changePassword: async (currentPassword, newPassword) => {
      await apiLib.api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      writeMust(null);
      setMustChange(false);
    },
    can: (...roles) => !!user && hasAnyRole(user.roles, roles),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
