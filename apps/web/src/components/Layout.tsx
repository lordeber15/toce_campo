import { NavLink, Outlet } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { MyOverview } from '@toce/shared';
import { api } from '../lib/api';
import { ADMIN_ROLES, ROLE_LABELS, WEB_ROLES, type Role } from '@toce/shared';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { LeafIcon } from './icons';

type Item = { to: string; label: string; roles?: Role[]; soon?: boolean };
const VIEWERS: Role[] = [...WEB_ROLES, 'jefe_proyecto'];
const NAV: { title?: string; items: Item[] }[] = [
  { items: [{ to: '/', label: 'Inicio', roles: VIEWERS }] },
  {
    title: 'Seguimiento',
    items: [
      { to: '/seguimiento', label: 'Avance de brigadas', roles: VIEWERS },
      { to: '/alertas', label: 'Alertas', roles: VIEWERS },
      { to: '/consultas', label: 'Consultas', roles: VIEWERS },
      { to: '/reprogramaciones', label: 'Reprogramaciones', roles: VIEWERS },
      { to: '/logistica', label: 'Logística', roles: VIEWERS },
    ],
  },
  {
    title: 'Información',
    items: [
      { to: '/registros', label: 'Registros de campo', roles: VIEWERS },
      { to: '/documentos', label: 'Documentos y evidencias', roles: VIEWERS },
      { to: '/reportes', label: 'Reportes', roles: VIEWERS },
    ],
  },
  {
    title: 'Planificación',
    items: [
      { to: '/cronograma', label: 'Cronograma', roles: VIEWERS },
      { to: '/estaciones', label: 'Estaciones', roles: VIEWERS },
      { to: '/capas', label: 'Mapa y capas', roles: VIEWERS },
      { to: '/brigadas', label: 'Brigadas', roles: VIEWERS },
    ],
  },
  {
    title: 'Configuración',
    items: [
      { to: '/metodos', label: 'Métodos y formularios', roles: VIEWERS },
      { to: '/especies', label: 'Especies', roles: VIEWERS },
      { to: '/proyectos', label: 'Proyectos', roles: VIEWERS },
      { to: '/usuarios', label: 'Usuarios', roles: ADMIN_ROLES },
    ],
  },
];

export function Layout() {
  const { user, logout, can } = useAuth();
  const { projects, project, setProjectId } = useProject();
  // "Mi trabajo": lo cargado desde el teléfono y, para el jefe de brigada, el tablero de su brigada.
  const me = useQuery({ queryKey: ['me-overview'], queryFn: () => api<MyOverview>('/me/overview'), staleTime: 5 * 60_000 });
  const led = (me.data?.ledBrigades ?? []).filter((b) => !project || b.projectId === project.id);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><LeafIcon /></span>TOCE</div>
        {projects.length > 0 && (
          <div className="project-switch">
            <select className="input" value={project?.id ?? ''} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto activo">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </div>
        )}
        <div className="nav-group">
          <div className="nav-title">Mi trabajo</div>
          <NavLink to="/mis-registros" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Mis registros</NavLink>
          {led.map((b) => (
            <NavLink key={b.id} to={`/mi-brigada/${b.id}`} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Mi brigada · {b.name}</NavLink>
          ))}
        </div>
        {NAV.map((group, gi) => {
          const items = group.items.filter((i) => !i.roles || can(...i.roles));
          if (!items.length) return null;
          return (
            <div key={gi} className="nav-group">
              {group.title && <div className="nav-title">{group.title}</div>}
              {items.map((i) =>
                i.soon ? (
                  <span key={i.to} className="nav-link" aria-disabled="true" title="Disponible en la Fase 2">
                    {i.label}<span className="nav-soon">Fase 2</span>
                  </span>
                ) : (
                  <NavLink key={i.to} to={i.to} end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>{i.label}</NavLink>
                ),
              )}
            </div>
          );
        })}
        <div className="sidebar-foot">
          <div className="me">
            <strong>{user!.fullName}</strong>
            <span>{user!.roles.map((r) => ROLE_LABELS[r]).join(' · ')}</span>
          </div>
          <button className="btn btn-sm" onClick={logout}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}
