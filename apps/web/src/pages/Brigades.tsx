import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADMIN_ROLES, type Role } from '@toce/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { Dialog, ErrorBox, NoProject } from '../components/Dialog';

type Member = { id: string; fullName: string; dni: string; specialtyId: string | null };
type Brigade = {
  id: string; name: string; isActive: boolean; specialtyId: string | null; specialtyName: string | null;
  leaderId: string | null; leaderName: string | null; logisticianId: string | null; logisticianName: string | null;
  supervisorId: string | null; supervisorName: string | null; members: Member[]; schedules: number;
};
type Candidate = { id: string; fullName: string; dni: string; roles: Role[]; specialtyId: string | null; brigadeId: string | null };
type Specialty = { id: string; name: string };

export function BrigadesPage() {
  const { project } = useProject();
  const { can } = useAuth();
  const isAdmin = can(...ADMIN_ROLES);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Brigade | 'new' | null>(null);
  const brigades = useQuery({ queryKey: ['brigades', project?.id], enabled: !!project, queryFn: () => api<Brigade[]>(`/projects/${project!.id}/brigades`) });
  const deactivate = useMutation({
    mutationFn: (id: string) => api(`/brigades/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brigades'] }),
  });
  if (!project) return <NoProject />;

  return (
    <>
      <div className="page-head">
        <div><h1>Brigadas</h1><p>Equipos de {project.code}: especialidad, jefe de brigada, logístico, supervisor y especialistas.</p></div>
        {isAdmin && <button className="btn btn-primary" onClick={() => setEditing('new')}>Nueva brigada</button>}
      </div>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {(brigades.data ?? []).map((b) => (
          <div key={b.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, opacity: b.isActive ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ flex: 1 }}>{b.name}</h3>
              <span className="chip">{b.specialtyName ?? 'Mixta'}</span>
              {!b.isActive && <span className="chip chip-off">Inactiva</span>}
            </div>
            <dl className="kv">
              <dt>Jefe de brigada</dt><dd>{b.leaderName ?? '—'}</dd>
              <dt>Logístico</dt><dd>{b.logisticianName ?? '—'}</dd>
              <dt>Supervisor</dt><dd>{b.supervisorName ?? '—'}</dd>
              <dt>Programaciones</dt><dd>{b.schedules}</dd>
            </dl>
            <div>
              <div className="section-title">Especialistas ({b.members.length})</div>
              <div className="pill-list">{b.members.map((m) => <span key={m.id} className="chip">{m.fullName}</span>)}{!b.members.length && <span className="hint">Sin miembros</span>}</div>
            </div>
            {isAdmin && b.isActive && (
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button className="btn btn-sm" onClick={() => setEditing(b)}>Editar</button>
                <button className="btn btn-sm btn-danger" onClick={() => confirm(`¿Desactivar ${b.name}?`) && deactivate.mutate(b.id)}>Desactivar</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {brigades.data && !brigades.data.length && <div className="card empty">Aún no hay brigadas en este proyecto.</div>}
      {editing && <BrigadeDialog projectId={project.id} brigade={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['brigades'] }); qc.invalidateQueries({ queryKey: ['projects'] }); }} />}
    </>
  );
}

function BrigadeDialog({ projectId, brigade, onClose, onSaved }: { projectId: string; brigade: Brigade | null; onClose: () => void; onSaved: () => void }) {
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: () => api<Specialty[]>('/specialties') });
  const candidates = useQuery({ queryKey: ['brigade-candidates', projectId], queryFn: () => api<Candidate[]>(`/projects/${projectId}/brigade-candidates`) });
  const [f, setF] = useState({
    name: brigade?.name ?? '', specialtyId: brigade?.specialtyId ?? '', leaderId: brigade?.leaderId ?? '',
    logisticianId: brigade?.logisticianId ?? '', supervisorId: brigade?.supervisorId ?? '',
  });
  const [members, setMembers] = useState<Set<string>>(new Set(brigade?.members.map((m) => m.id)));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const all = candidates.data ?? [];
  const specialists = all.filter((c) => c.roles.includes('especialista') && (!f.specialtyId || c.specialtyId === f.specialtyId));
  const withRole = (r: Role) => all.filter((c) => c.roles.includes(r));
  const leaders = specialists.filter((c) => members.has(c.id));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(), specialtyId: f.specialtyId || null, leaderId: f.leaderId || null,
        logisticianId: f.logisticianId || null, supervisorId: f.supervisorId || null, memberIds: [...members],
      };
      return brigade
        ? api(`/brigades/${brigade.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api(`/projects/${projectId}/brigades`, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: onSaved,
  });

  const toggle = (id: string) => {
    const n = new Set(members);
    if (n.has(id)) { n.delete(id); if (f.leaderId === id) setF({ ...f, leaderId: '' }); } else n.add(id);
    setMembers(n);
  };

  return (
    <Dialog
      wide
      title={brigade ? `Editar ${brigade.name}` : 'Nueva brigada'}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={save.isPending || !f.name}>{save.isPending ? 'Guardando…' : 'Guardar'}</button></>}
    >
      <ErrorBox error={save.error} />
      <div className="grid-2">
        <div className="field"><label htmlFor="b-name">Nombre</label><input id="b-name" className="input" value={f.name} onChange={set('name')} placeholder="Sierra 2" required /></div>
        <div className="field"><label htmlFor="b-spec">Especialidad</label>
          <select id="b-spec" className="input" value={f.specialtyId} onChange={(e) => { setF({ ...f, specialtyId: e.target.value, leaderId: '' }); setMembers(new Set()); }}>
            <option value="">Mixta (varias especialidades)</option>
            {(specialties.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Especialistas</label>
        <div className="pill-list">
          {specialists.map((c) => {
            const elsewhere = c.brigadeId && c.brigadeId !== brigade?.id;
            return (
              <button key={c.id} type="button" className="pill" aria-pressed={members.has(c.id)} disabled={!!elsewhere} title={elsewhere ? 'Ya pertenece a otra brigada' : c.dni} onClick={() => toggle(c.id)}>
                {c.fullName}
              </button>
            );
          })}
          {!specialists.length && <span className="hint">No hay especialistas de esa especialidad. Créalos en Usuarios.</span>}
        </div>
      </div>
      <div className="grid-3">
        <div className="field"><label htmlFor="b-lead">Jefe de brigada</label>
          <select id="b-lead" className="input" value={f.leaderId} onChange={set('leaderId')}>
            <option value="">—</option>{leaders.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
          </select>
          <span className="hint">Debe ser miembro de la brigada.</span>
        </div>
        <div className="field"><label htmlFor="b-log">Logístico</label>
          <select id="b-log" className="input" value={f.logisticianId} onChange={set('logisticianId')}>
            <option value="">—</option>{withRole('logistico').map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="b-sup">Supervisor de campo</label>
          <select id="b-sup" className="input" value={f.supervisorId} onChange={set('supervisorId')}>
            <option value="">—</option>{withRole('supervisor').map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
          </select>
        </div>
      </div>
    </Dialog>
  );
}
