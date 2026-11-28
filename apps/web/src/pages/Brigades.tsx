import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADMIN_ROLES, BRIGADE_REGIONS, type BrigadeRegion, type Role } from '@toce/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { Dialog, ErrorBox, NoProject } from '../components/Dialog';

type Member = { id: string; fullName: string; dni: string; specialtyId: string | null; validFrom: string | null; validTo: string | null };
type Brigade = {
  id: string; code: string | null; name: string; region: BrigadeRegion | null; notes: string | null;
  isActive: boolean; specialtyId: string | null; specialtyName: string | null;
  leaderId: string | null; leaderName: string | null; logisticianId: string | null; logisticianName: string | null;
  supervisorId: string | null; supervisorName: string | null; members: Member[]; schedules: number;
  /** Zona de trabajo: derivada de los KMZ asignados a la brigada en "Mapa y capas". */
  areaName: string | null; areaSourceFile: string | null; areaHa: number | null; layers: number; photosOutside: number;
};
type Candidate = { id: string; fullName: string; dni: string; roles: Role[]; specialtyId: string | null; brigadeId: string | null };
type Specialty = { id: string; name: string };

const REGION_LABEL: Record<BrigadeRegion, string> = { COSTA: 'Costa', SIERRA: 'Sierra', SELVA: 'Selva' };
/** AAAA-MM-DD -> dd/mm/aaaa */
const dmy = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : null);
const validity = (m: Member) => {
  const from = dmy(m.validFrom);
  const to = dmy(m.validTo);
  if (!from && !to) return null;
  return from && to ? `${from} – ${to}` : from ? `desde ${from}` : `hasta ${to}`;
};

export function BrigadesPage() {
  const { project } = useProject();
  const { can } = useAuth();
  const isAdmin = can(...ADMIN_ROLES);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Brigade | 'new' | null>(null);
  const [unitsFor, setUnitsFor] = useState<Brigade | null>(null);
  const brigades = useQuery({ queryKey: ['brigades', project?.id], enabled: !!project, queryFn: () => api<Brigade[]>(`/projects/${project!.id}/brigades`) });
  const deactivate = useMutation({
    mutationFn: (id: string) => api(`/brigades/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brigades'] }),
  });
  if (!project) return <NoProject />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Brigadas</h1>
          <p>
            Equipos de {project.code}: especialidad, jefe de brigada, logístico, supervisor y especialistas. Normalmente llegan con
            la <Link to="/carga-masiva">carga masiva</Link>; aquí se ajustan. La zona de trabajo de cada brigada es su KMZ en <Link to="/capas">Mapa y capas</Link>.
          </p>
        </div>
        {isAdmin && <button className="btn" onClick={() => setEditing('new')}>Nueva brigada</button>}
      </div>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {(brigades.data ?? []).map((b) => (
          <div key={b.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, opacity: b.isActive ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ flex: 1 }}>
                {b.name}
                {b.code && b.code !== b.name.toUpperCase() && <span className="hint" style={{ marginLeft: 6, fontWeight: 500 }}>{b.code}</span>}
              </h3>
              {b.region && <span className="chip">{REGION_LABEL[b.region]}</span>}
              <span className="chip">{b.specialtyName ?? 'Mixta'}</span>
              {!b.isActive && <span className="chip chip-off">Inactiva</span>}
            </div>
            <dl className="kv">
              <dt>Jefe de brigada</dt><dd>{b.leaderName ?? '—'}</dd>
              <dt>Logístico</dt><dd>{b.logisticianName ?? '—'}</dd>
              <dt>Supervisor</dt><dd>{b.supervisorName ?? '—'}</dd>
              <dt>Programaciones</dt><dd>{b.schedules}</dd>
              {b.code && <><dt>Código</dt><dd>{b.code}</dd></>}
            </dl>
            {b.notes && <p className="hint" style={{ margin: 0 }}>{b.notes}</p>}
            <div>
              <div className="section-title">Especialistas ({b.members.length})</div>
              <div className="pill-list">
                {b.members.map((m) => {
                  const v = validity(m);
                  return <span key={m.id} className="chip" title={v ? `Vigencia en la brigada: ${v}` : undefined}>{m.fullName}{v && <span className="hint"> · {v}</span>}</span>;
                })}
                {!b.members.length && <span className="hint">Sin miembros</span>}
              </div>
            </div>
            <div>
              <div className="section-title">Zona de trabajo</div>
              {b.areaHa != null ? (
                <p style={{ margin: 0, fontSize: 14 }}>
                  <strong>{b.areaName}</strong> · {b.areaHa.toLocaleString('es-PE')} ha
                  {b.photosOutside > 0 && <span className="chip chip-warn" style={{ marginLeft: 6 }}>{b.photosOutside} foto{b.photosOutside === 1 ? '' : 's'} fuera</span>}
                </p>
              ) : (
                <span className="hint">
                  {b.layers > 0 ? 'Su KMZ no tiene polígonos: las fotos no se verifican.' : 'Sin KMZ asignado: las fotos no se verifican y el mapa del teléfono cubre solo sus estaciones.'}
                </span>
              )}
              <div className="hint" style={{ marginTop: 4 }}>
                {isAdmin ? <>Se asigna en <Link to="/capas">Mapa y capas</Link>: importa el KMZ y elige esta brigada.</> : <>Se gestiona en <Link to="/capas">Mapa y capas</Link>.</>}
              </div>
            </div>
            {isAdmin && b.isActive && (
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button className="btn btn-sm" onClick={() => setEditing(b)}>Editar</button>
                <button className="btn btn-sm" onClick={() => setUnitsFor(b)}>Unidades por método</button>
                <button className="btn btn-sm btn-danger" onClick={() => confirm(`¿Desactivar ${b.name}?`) && deactivate.mutate(b.id)}>Desactivar</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {brigades.data && !brigades.data.length && <div className="card empty">Aún no hay brigadas en este proyecto.</div>}
      {unitsFor && <BrigadeUnitsDialog brigade={unitsFor} onClose={() => setUnitsFor(null)} />}
      {editing && <BrigadeDialog projectId={project.id} brigade={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['brigades'] }); qc.invalidateQueries({ queryKey: ['projects'] }); }} />}
    </>
  );
}

type BrigadeMethod = {
  id: string; code: string; name: string; specialtyName: string; defaultUnits: number;
  stations: number; minUnits: number; maxUnits: number; unitsWithWork: number;
};

/** Cantidad de unidades por método solo en las estaciones de esta brigada (no toca a las demás brigadas). */
function BrigadeUnitsDialog({ brigade, onClose }: { brigade: Brigade; onClose: () => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['brigade-methods', brigade.id], queryFn: () => api<BrigadeMethod[]>(`/brigades/${brigade.id}/methods`) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ code: string; stations: number; warnings: string[] } | null>(null);
  const apply = useMutation({
    mutationFn: ({ m, units }: { m: BrigadeMethod; units: number }) =>
      api<{ stations: number; warnings: string[] }>(`/brigades/${brigade.id}/methods/${m.id}/units`, { method: 'PUT', body: JSON.stringify({ units }) })
        .then((r) => ({ ...r, code: m.code })),
    onSuccess: (r) => {
      setResult(r);
      setDraft({});
      qc.invalidateQueries({ queryKey: ['brigade-methods', brigade.id] });
      qc.invalidateQueries({ queryKey: ['stations'] });
    },
  });
  const current = (m: BrigadeMethod) => (m.minUnits === m.maxUnits ? String(m.minUnits) : `${m.minUnits}–${m.maxUnits}`);

  return (
    <Dialog wide title={`Unidades por método · ${brigade.name}`} onClose={onClose}
      footer={<button type="button" className="btn" onClick={onClose}>Cerrar</button>}>
      <p className="hint" style={{ marginTop: 0 }}>
        Cambia la cantidad solo en las estaciones de esta brigada. No se borra nada: las unidades sobrantes quedan fuera de plan y
        las que ya tienen trabajo de campo se conservan. Los especialistas lo verán al actualizar el paquete en la app.
      </p>
      <ErrorBox error={apply.error} />
      {result && (
        <div className="ok-text">
          {result.code}: aplicado a {result.stations} estacion{result.stations === 1 ? '' : 'es'}.
          {result.warnings.length > 0 && <span className="hint" style={{ color: 'var(--warn)' }}> Se conservaron unidades con trabajo: {result.warnings.slice(0, 6).join(' · ')}{result.warnings.length > 6 ? ' …' : ''}</span>}
        </div>
      )}
      {list.isLoading && <p className="hint">Cargando…</p>}
      {list.data && !list.data.length && <p className="hint">Esta brigada no tiene métodos con unidades programadas.</p>}
      {!!list.data?.length && (
        <div className="table-wrap"><table>
          <thead>
            <tr><th>Método</th><th>Estaciones</th><th>Unidades actuales</th><th>Con trabajo</th><th>Nueva cantidad</th><th /></tr>
          </thead>
          <tbody>
            {list.data.map((m) => {
              const v = draft[m.id] ?? '';
              const n = Number(v);
              const valid = v !== '' && Number.isInteger(n) && n >= 0 && n <= 500;
              return (
                <tr key={m.id}>
                  <td><strong>{m.code}</strong> · {m.name}<div className="hint">{m.specialtyName}</div></td>
                  <td>{m.stations}</td>
                  <td>{current(m)}</td>
                  <td>{m.unitsWithWork}</td>
                  <td>
                    <input
                      type="number" min={0} max={500} className="input" style={{ width: 90 }} aria-label={`Nueva cantidad de ${m.code}`}
                      placeholder={String(m.maxUnits)} value={v} onChange={(e) => setDraft({ ...draft, [m.id]: e.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button" className="btn btn-sm btn-primary" disabled={!valid || apply.isPending}
                      onClick={() => apply.mutate({ m, units: n })}
                    >
                      Aplicar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </Dialog>
  );
}

function BrigadeDialog({ projectId, brigade, onClose, onSaved }: { projectId: string; brigade: Brigade | null; onClose: () => void; onSaved: () => void }) {
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: () => api<Specialty[]>('/specialties') });
  const candidates = useQuery({ queryKey: ['brigade-candidates', projectId], queryFn: () => api<Candidate[]>(`/projects/${projectId}/brigade-candidates`) });
  const [f, setF] = useState({
    name: brigade?.name ?? '', code: brigade?.code ?? '', region: brigade?.region ?? '', notes: brigade?.notes ?? '',
    specialtyId: brigade?.specialtyId ?? '', leaderId: brigade?.leaderId ?? '',
    logisticianId: brigade?.logisticianId ?? '', supervisorId: brigade?.supervisorId ?? '',
  });
  const [members, setMembers] = useState<Set<string>>(new Set(brigade?.members.map((m) => m.id)));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const all = candidates.data ?? [];
  // Integrantes actuales (de la carga masiva o de antes): siempre se muestran, aunque no coincidan con la especialidad.
  const current = new Set(brigade?.members.map((m) => m.id));
  const fits = (c: Candidate) => !f.specialtyId || c.specialtyId === f.specialtyId;
  const specialists = all.filter((c) => (c.roles.includes('especialista') && fits(c)) || current.has(c.id));
  const [removedBySpec, setRemovedBySpec] = useState<string[]>([]);
  const changeSpecialty = (specialtyId: string) => {
    // Conserva a los que siguen calzando con la nueva especialidad; avisa quiénes salen.
    const keep = new Set<string>();
    const out: string[] = [];
    for (const id of members) {
      const c = all.find((x) => x.id === id);
      if (!c || !specialtyId || c.specialtyId === specialtyId || !c.roles.includes('especialista')) keep.add(id);
      else out.push(c.fullName);
    }
    setMembers(keep);
    setRemovedBySpec(out);
    setF({ ...f, specialtyId, leaderId: keep.has(f.leaderId) ? f.leaderId : '' });
  };
  const withRole = (r: Role) => all.filter((c) => c.roles.includes(r));
  const leaders = specialists.filter((c) => members.has(c.id));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(), code: f.code.trim() || null, region: (f.region || null) as BrigadeRegion | null, notes: f.notes.trim() || null,
        specialtyId: f.specialtyId || null, leaderId: f.leaderId || null,
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
      {!brigade && <p className="hint" style={{ marginTop: 0 }}>Las brigadas suelen crearse con la carga masiva; usa este formulario para casos puntuales.</p>}
      <div className="grid-3">
        <div className="field"><label htmlFor="b-name">Nombre</label><input id="b-name" className="input" value={f.name} onChange={set('name')} placeholder="Sierra 2" required /></div>
        <div className="field"><label htmlFor="b-code">Código</label><input id="b-code" className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="SIERRA 2" maxLength={30} /><span className="hint">Único en el proyecto.</span></div>
        <div className="field"><label htmlFor="b-region">Región</label>
          <select id="b-region" className="input" value={f.region} onChange={set('region')}>
            <option value="">—</option>
            {BRIGADE_REGIONS.map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
          </select>
        </div>
      </div>
      <div className="grid-2">
        <div className="field"><label htmlFor="b-spec">Especialidad</label>
          <select id="b-spec" className="input" value={f.specialtyId} onChange={(e) => changeSpecialty(e.target.value)}>
            <option value="">Mixta (varias especialidades)</option>
            {(specialties.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="b-notes">Notas</label><input id="b-notes" className="input" value={f.notes} onChange={set('notes')} maxLength={2000} /></div>
      </div>
      <div className="field">
        <label>Especialistas</label>
        <div className="pill-list">
          {specialists.map((c) => {
            // Los integrantes actuales pueden estar en otra brigada en otras fechas (carga masiva): no se bloquean.
            const elsewhere = c.brigadeId && c.brigadeId !== brigade?.id && !current.has(c.id);
            const other = !fits(c);
            return (
              <button
                key={c.id} type="button" className="pill" aria-pressed={members.has(c.id)} disabled={!!elsewhere}
                title={elsewhere ? 'Ya pertenece a otra brigada' : other ? `${c.dni} · otra especialidad` : c.dni}
                onClick={() => toggle(c.id)}
              >
                {c.fullName}{other ? ' · otra especialidad' : ''}
              </button>
            );
          })}
          {!specialists.length && <span className="hint">No hay especialistas de esa especialidad. Créalos en Usuarios.</span>}
        </div>
        {removedBySpec.length > 0 && (
          <span className="hint" style={{ color: 'var(--warn)' }}>
            Por el cambio de especialidad salen: {removedBySpec.join(', ')}. Vuelve a la especialidad anterior o márcalos si debían quedarse.
          </span>
        )}
        {brigade && brigade.members.some(validity) && (
          <span className="hint">
            Vigencia (de la carga masiva, solo lectura): {brigade.members.filter(validity).map((m) => `${m.fullName} ${validity(m)}`).join(' · ')}
          </span>
        )}
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
