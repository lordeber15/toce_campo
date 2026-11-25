import { useEffect, useState } from 'react';
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
      { to: '/mapa-fotos', label: 'Mapa de fotos', roles: VIEWERS },
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

/** Grupo del menú que se pliega o despliega con su título. */
function NavSection({ id, title, folded, onToggle, children }: {
  id: string; title: string; folded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  const open = !folded;
  return (
    <div className={'nav-group' + (open ? '' : ' collapsed')}>
      <button type="button" className="nav-title nav-toggle" onClick={onToggle} aria-expanded={open} aria-controls={`nav-${id}`}
        title={open ? 'Plegar' : 'Desplegar'}>
        <span>{title}</span>
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
  // Al entrar a una página de un grupo plegado, ese grupo se abre (después se puede volver a plegar).
  const [seenPath, setSeenPath] = useState(pathname);
  // Menú de hamburguesa (pantallas angostas): se cierra al navegar o con Escape.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setMenuOpen(false);
    const group = pathname.startsWith('/mis-registros') || pathname.startsWith('/mi-brigada/')
      ? 'mi-trabajo'
      : NAV.find((g) => g.title && g.items.some((i) => isActive(i.to)))?.title?.toLowerCase();
    if (group && folded.includes(group)) {
      const next = folded.filter((x) => x !== group);
      setFolded(next);
      saveFolded(next);
    }
  }
  const link = (i: Item) => i.soon ? (
    <span key={i.to} className="nav-link" aria-disabled="true" title="Disponible en la Fase 2">
      {i.label}<span className="nav-soon">Fase 2</span>
    </span>
  ) : (
    <NavLink key={i.to} to={i.to} end className={({ isActive: a }) => 'nav-link' + (a ? ' active' : '')}>{i.label}</NavLink>
  );
  return (
    <div className={'shell' + (menuOpen ? ' menu-open' : '')}>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Abrir menú" aria-expanded={menuOpen} aria-controls="sidebar">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
        <div className="brand"><span className="brand-mark"><LeafIcon /></span>TOCE</div>
      </header>
      <button type="button" className="nav-backdrop" aria-label="Cerrar menú" tabIndex={-1} onClick={() => setMenuOpen(false)} />
      <aside className="sidebar" id="sidebar">
        <div className="sidebar-head">
          <div className="brand"><span className="brand-mark"><LeafIcon /></span>TOCE</div>
          <button type="button" className="icon-btn sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
        {projects.length > 0 && (
          <div className="project-switch">
            <select className="input" value={project?.id ?? ''} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto activo">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </div>
        )}
        <NavSection id="mi-trabajo" title="Mi trabajo" folded={folded.includes('mi-trabajo')} onToggle={() => toggle('mi-trabajo')}>
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
            <NavSection key={gi} id={id} title={group.title} folded={folded.includes(id)} onToggle={() => toggle(id)}>
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
