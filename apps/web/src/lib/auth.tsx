import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { hasAnyRole, type AuthUser, type Role } from '@toce/shared';
import * as apiLib from './api';

type Ctx = {
  user: AuthUser | null;
  loading: boolean;
  login: (dni: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
};
const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiLib.setLogoutHandler(() => setUser(null));
    apiLib.restoreSession().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  const value: Ctx = {
    user,
    loading,
    login: async (dni, password) => setUser(await apiLib.login(dni, password)),
    logout: async () => { await apiLib.logout(); setUser(null); },
    can: (...roles) => !!user && hasAnyRole(user.roles, roles),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
