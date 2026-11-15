import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WEB_ROLES, type MyOverview } from '@toce/shared';
import { api } from './api';
import { useAuth } from './auth';

export type Project = {
  id: string; code: string; name: string; client: string | null; status: string;
  startDate: string | null; endDate: string | null; utmZone: number | null;
  brigades: number; stations: number; schedules: number; layers: number;
};

const KEY = 'toce.projectId';
type Ctx = { projects: Project[]; project: Project | null; setProjectId: (id: string) => void; loading: boolean };
const ProjectContext = createContext<Ctx | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const staff = can(...WEB_ROLES, 'jefe_proyecto');
  // Coordinación ve todos los proyectos; el personal de campo, solo en los que participa.
  const q = useQuery({
    queryKey: ['projects', staff],
    queryFn: async () => (staff ? api<Project[]>('/projects')
      : (await api<MyOverview>('/me/overview')).projects.map((p) => ({
        ...p, client: null, status: 'activo', startDate: null, endDate: null, utmZone: null, brigades: 0, stations: 0, schedules: 0, layers: 0,
      }))),
  });
  const [projectId, setId] = useState<string | null>(() => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  });
  const projects = q.data ?? [];
  const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;

  useEffect(() => {
    if (project && project.id !== projectId) setId(project.id);
  }, [project, projectId]);

  const setProjectId = (id: string) => {
    setId(id);
    try { localStorage.setItem(KEY, id); } catch { /* noop */ }
  };
  return <ProjectContext.Provider value={{ projects, project, setProjectId, loading: q.isLoading }}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject fuera de ProjectProvider');
  return ctx;
}
