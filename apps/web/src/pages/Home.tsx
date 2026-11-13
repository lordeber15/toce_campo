import { Link } from 'react-router';
import { ROLE_LABELS, WEB_ROLES } from '@toce/shared';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';

export function HomePage() {
  const { user, can } = useAuth();
  const { project } = useProject();
  const steps = project
    ? [
        { done: project.layers > 0, to: '/capas', label: 'Importar capas del proyecto (KMZ)', detail: `${project.layers} capas` },
        { done: project.stations > 0, to: '/estaciones', label: 'Crear estaciones y configurar métodos', detail: `${project.stations} estaciones` },
        { done: project.brigades > 0, to: '/brigadas', label: 'Armar brigadas', detail: `${project.brigades} brigadas` },
        { done: project.schedules > 0, to: '/cronograma', label: 'Programar el cronograma', detail: `${project.schedules} programaciones` },
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
      {can(...WEB_ROLES, 'jefe_proyecto') && project ? (
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
              {steps.map((s) => (
                <Link key={s.to} to={s.to} className="list-item" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span className={'chip ' + (s.done ? 'chip-ok' : '')}>{s.done ? 'Listo' : 'Pendiente'}</span>
                  <div className="grow">{s.label}<small>{s.detail}</small></div>
                  <span className="muted">→</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="card empty">
          Tu trabajo de campo se registra en la app móvil <strong>TOCE Campo</strong>: ahí ves tus estaciones del día, los métodos
          y las unidades, incluso sin conexión.
        </div>
      )}
    </>
  );
}
