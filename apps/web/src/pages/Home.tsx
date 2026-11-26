import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ADMIN_ROLES, ROLE_LABELS, WEB_ROLES, type LayerTreeLeaf, type Role } from '@toce/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { useBrigades } from '../components/Filters';

type Step = { key: string; done: boolean | null; to: string; label: string; detail: string; linked: boolean };

export function HomePage() {
  const { user, can } = useAuth();
  const { project } = useProject();
  const admin = can(...ADMIN_ROLES);
  const staff = can(...WEB_ROLES, 'jefe_proyecto');
  const pid = staff ? project?.id : undefined;
  // Preparación: carga masiva -> KMZ general -> KMZ por brigada -> coordinador.
  const tree = useQuery({ queryKey: ['layer-tree', pid], enabled: !!pid, queryFn: () => api<LayerTreeLeaf[]>(`/projects/${pid}/layer-tree`) });
  const brigades = useBrigades(pid);
  const users = useQuery({
    queryKey: ['users', 'coordinators'],
    enabled: admin,
    queryFn: () => api<{ roles: Role[]; isActive: boolean }[]>('/users'),
    staleTime: 60_000,
  });
  const leaves = tree.data ?? [];
  const generalLayers = leaves.filter((l) => !l.brigadeId).reduce((n, l) => n + l.count, 0);
  const activeBrigades = (brigades.data ?? []).filter((b) => b.isActive);
  const withKmz = new Set(leaves.flatMap((l) => (l.brigadeId ? [l.brigadeId] : [])));
  const brigadesWithKmz = activeBrigades.filter((b) => withKmz.has(b.id)).length;
  const coordinators = users.data?.filter((u) => u.isActive && u.roles.includes('coordinador')).length;
  const steps: Step[] = project
    ? [
        {
          key: 'import', done: project.stations > 0 && project.brigades > 0, to: '/carga-masiva', linked: admin,
          label: 'Carga masiva con la plantilla Excel',
          detail: `${project.stations} estaciones · ${project.brigades} brigadas · ${project.schedules} programaciones`,
        },
        {
          key: 'kmz', done: tree.data ? generalLayers > 0 : null, to: '/capas', linked: true,
          label: 'Subir el KMZ general (Mapa y capas)',
          detail: tree.data ? (generalLayers ? `${generalLayers.toLocaleString('es-PE')} elementos en las capas del proyecto` : 'Huella, AID, AII y unidades de vegetación') : '…',
        },
        {
          key: 'kmz-brigade', done: brigades.data && tree.data ? activeBrigades.length > 0 && brigadesWithKmz === activeBrigades.length : null, to: '/capas', linked: true,
          label: 'Subir el KMZ de cada brigada (Mapa y capas)',
          detail: brigades.data ? `${brigadesWithKmz} de ${activeBrigades.length} brigadas con KMZ` : '…',
        },
        {
          key: 'coordinator', done: coordinators == null ? null : coordinators > 0, to: '/usuarios', linked: admin,
          label: 'Crear el coordinador (Usuarios)',
          detail: coordinators == null ? 'Lo crea un administrador' : `${coordinators} coordinador${coordinators === 1 ? '' : 'es'} activo${coordinators === 1 ? '' : 's'}`,
        },
      ]
    : [];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hola, {user!.fullName.split(' ')[0]}</h1>
          <p>{user!.roles.map((r) => ROLE_LABELS[r]).join(' · ')}{project && ` · Proyecto ${project.code}`}</p>
        </div>
      </div>
      {staff && project ? (
        <>
          <div className="stats">
            <div className="card stat"><div className="label">Estaciones</div><div className="value">{project.stations}</div></div>
            <div className="card stat"><div className="label">Brigadas</div><div className="value">{project.brigades}</div></div>
            <div className="card stat"><div className="label">Programaciones</div><div className="value">{project.schedules}</div></div>
            <div className="card stat"><div className="label">Capas</div><div className="value">{project.layers}</div></div>
          </div>
          {project.schedules > 0 && (
            <Link to="/seguimiento" className="card" style={{ display: 'block', padding: 16, marginBottom: 16, color: 'inherit', textDecoration: 'none' }}>
              <strong>Avance de brigadas →</strong>
              <div className="hint">Avance, cumplimiento, desviación del cronograma, atrasos y última sincronización de cada brigada.</div>
            </Link>
          )}
          <div className="card">
            <div className="toolbar"><strong>Preparación del proyecto</strong></div>
            <div className="list">
              {steps.map((s, i) => {
                const body = (
                  <>
                    <span className="step-num">{i + 1}</span>
                    <div className="grow">{s.label}<small>{s.detail}</small></div>
                    {s.done != null && <span className={'chip ' + (s.done ? 'chip-ok' : '')}>{s.done ? 'Listo' : 'Pendiente'}</span>}
                    {s.linked && <span className="muted">→</span>}
                  </>
                );
                return s.linked
                  ? <Link key={s.key} to={s.to} className="list-item" style={{ color: 'inherit', textDecoration: 'none' }}>{body}</Link>
                  : <div key={s.key} className="list-item" style={{ cursor: 'default' }}>{body}</div>;
              })}
            </div>
          </div>
        </>
      ) : staff ? (
        <div className="card empty">
          Aún no hay proyectos. {admin ? <>Empieza con la <Link to="/carga-masiva">carga masiva</Link>: la plantilla Excel crea el proyecto, los usuarios, las brigadas, las estaciones y el cronograma.</> : 'Coordinación debe cargar la plantilla del proyecto.'}
        </div>
      ) : (
        <div className="card empty">
          Tu trabajo de campo se registra en la app móvil <strong>TOCE Campo</strong>: ahí ves tus estaciones del día, los métodos
          y las unidades, incluso sin conexión.
        </div>
      )}
    </>
  );
}
