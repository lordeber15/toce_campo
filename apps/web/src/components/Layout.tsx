import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
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

/** Grupos plegados del menú (se recuerdan en este navegador). */
const FOLDED_KEY = 'toce.nav.folded';
function readFolded(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveFolded(v: string[]) {
  try { localStorage.setItem(FOLDED_KEY, JSON.stringify(v)); } catch { /* sin almacenamiento: solo dura la sesión */ }
}

/** Grupo del menú que se pliega; el que contiene la página actual siempre queda abierto. */
function NavSection({ id, title, active, count, folded, onToggle, children }: {
  id: string; title: string; active: boolean; count: number; folded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  const open = active || !folded;
  return (
    <div className={'nav-group' + (open ? '' : ' collapsed')}>
      <button type="button" className="nav-title nav-toggle" onClick={onToggle} aria-expanded={open} aria-controls={`nav-${id}`} disabled={active}
        title={active ? 'Contiene la página actual' : open ? 'Plegar' : 'Desplegar'}>
        <span>{title}</span>
        {!open && <span className="nav-count">{count}</span>}
        <svg className="nav-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div id={`nav-${id}`} className="nav-items">{children}</div>
    </div>
  );
}

export function Layout() {
  const { user, logout, can } = useAuth();
  const { projects, project, setProjectId } = useProject();
  // "Mi trabajo": lo cargado desde el teléfono y, para el jefe de brigada, el tablero de su brigada.
  const me = useQuery({ queryKey: ['me-overview'], queryFn: () => api<MyOverview>('/me/overview'), staleTime: 5 * 60_000 });
  const led = (me.data?.ledBrigades ?? []).filter((b) => !project || b.projectId === project.id);
  const { pathname } = useLocation();
  const [folded, setFolded] = useState<string[]>(readFolded);
  const toggle = (id: string) => setFolded((prev) => {
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    saveFolded(next);
    return next;
  });
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));
  const link = (i: Item) => i.soon ? (
    <span key={i.to} className="nav-link" aria-disabled="true" title="Disponible en la Fase 2">
      {i.label}<span className="nav-soon">Fase 2</span>
    </span>
  ) : (
    <NavLink key={i.to} to={i.to} end className={({ isActive: a }) => 'nav-link' + (a ? ' active' : '')}>{i.label}</NavLink>
  );
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
        <NavSection
          id="mi-trabajo" title="Mi trabajo" count={1 + led.length} folded={folded.includes('mi-trabajo')} onToggle={() => toggle('mi-trabajo')}
          active={isActive('/mis-registros') || pathname.startsWith('/mi-brigada/')}
        >
          <NavLink to="/mis-registros" className={({ isActive: a }) => 'nav-link' + (a ? ' active' : '')}>Mis registros</NavLink>
          {led.map((b) => (
            <NavLink key={b.id} to={`/mi-brigada/${b.id}`} className={({ isActive: a }) => 'nav-link' + (a ? ' active' : '')}>Mi brigada · {b.name}</NavLink>
          ))}
        </NavSection>
        {NAV.map((group, gi) => {
          const items = group.items.filter((i) => !i.roles || can(...i.roles));
          if (!items.length) return null;
          if (!group.title) return <div key={gi} className="nav-group">{items.map(link)}</div>;
          const id = group.title.toLowerCase();
          return (
            <NavSection key={gi} id={id} title={group.title} count={items.length} folded={folded.includes(id)} onToggle={() => toggle(id)}
              active={items.some((i) => isActive(i.to))}>
              {items.map(link)}
            </NavSection>
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
