import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Project = {
  id: string; code: string; name: string; client: string | null; status: string;
  startDate: string | null; endDate: string | null; utmZone: number | null;
  brigades: number; stations: number; schedules: number; layers: number;
};

const KEY = 'toce.projectId';
type Ctx = { projects: Project[]; project: Project | null; setProjectId: (id: string) => void; loading: boolean };
const ProjectContext = createContext<Ctx | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const q = useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects') });
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
