import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useProject, type Project } from '../lib/project';
import { Dialog, ErrorBox } from '../components/Dialog';
import { ADMIN_ROLES } from '@toce/shared';

const STATUS: Record<string, string> = { planificado: 'Planificado', en_curso: 'En curso', cerrado: 'Cerrado' };

export function ProjectsPage() {
  const { projects, project, setProjectId } = useProject();
  const { can } = useAuth();
  const [editing, setEditing] = useState<Project | 'new' | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Proyectos</h1>
          <p>El proyecto activo se usa en estaciones, brigadas, cronograma y capas.</p>
        </div>
        {can(...ADMIN_ROLES) && <button className="btn btn-primary" onClick={() => setEditing('new')}>Nuevo proyecto</button>}
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Código</th><th>Nombre</th><th>Estado</th><th>Fechas</th><th>Brigadas</th><th>Estaciones</th><th>Capas</th><th /></tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.code}</strong></td>
                <td>{p.name}{p.client && <div className="hint">{p.client}</div>}</td>
                <td><span className={'chip' + (p.status === 'en_curso' ? ' chip-ok' : '')}>{STATUS[p.status]}</span></td>
                <td className="muted">{p.startDate ?? '—'} → {p.endDate ?? '—'}</td>
                <td>{p.brigades}</td><td>{p.stations}</td><td>{p.layers}</td>
                <td style={{ textAlign: 'right' }}>
                  {project?.id === p.id ? <span className="ok-text">Activo</span> : <button className="btn btn-sm" onClick={() => setProjectId(p.id)}>Activar</button>}{' '}
                  {can(...ADMIN_ROLES) && <button className="btn btn-sm" onClick={() => setEditing(p)}>Editar</button>}
                </td>
              </tr>
            ))}
            {!projects.length && <tr><td colSpan={8} className="empty">Aún no hay proyectos.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <ProjectDialog project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); setProjectId(id); }} />}
    </>
  );
}

function ProjectDialog({ project, onClose, onSaved }: { project: Project | null; onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: project?.code ?? '', name: project?.name ?? '', client: project?.client ?? '', status: project?.status ?? 'planificado',
    startDate: project?.startDate ?? '', endDate: project?.endDate ?? '', utmZone: String(project?.utmZone ?? 18),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, client: f.client || null, startDate: f.startDate || null, endDate: f.endDate || null, utmZone: Number(f.utmZone) || null };
      return project
        ? api<Project>(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api<Project>('/projects', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['projects'] }); onSaved(p.id); },
  });
  return (
    <Dialog
      title={project ? 'Editar proyecto' : 'Nuevo proyecto'}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</button></>}
    >
      <ErrorBox error={save.error} />
      <div className="grid-2">
        <div className="field"><label htmlFor="p-code">Código</label><input id="p-code" className="input" value={f.code} onChange={set('code')} placeholder="TOKE" required /></div>
        <div className="field"><label htmlFor="p-status">Estado</label>
          <select id="p-status" className="input" value={f.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
      </div>
      <div className="field"><label htmlFor="p-name">Nombre</label><input id="p-name" className="input" value={f.name} onChange={set('name')} required /></div>
      <div className="field"><label htmlFor="p-client">Cliente</label><input id="p-client" className="input" value={f.client} onChange={set('client')} /></div>
      <div className="grid-3">
        <div className="field"><label htmlFor="p-start">Inicio</label><input id="p-start" type="date" className="input" value={f.startDate} onChange={set('startDate')} /></div>
        <div className="field"><label htmlFor="p-end">Fin</label><input id="p-end" type="date" className="input" value={f.endDate} onChange={set('endDate')} /></div>
        <div className="field"><label htmlFor="p-zone">Zona UTM</label>
          <select id="p-zone" className="input" value={f.utmZone} onChange={set('utmZone')}>{[17, 18, 19].map((z) => <option key={z} value={z}>{z}S</option>)}</select>
        </div>
      </div>
    </Dialog>
  );
}
