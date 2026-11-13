import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLES, ROLE_LABELS, type Role } from '@toce/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

type UserRow = {
  id: string; dni: string; fullName: string; email: string | null; phone: string | null;
  roles: Role[]; specialtyId: string | null; specialtyName: string | null; isActive: boolean; lastLoginAt: string | null;
};
type Specialty = { id: string; code: string; name: string };

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Lima' }) : '—';

export function UsersPage() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);

  const users = useQuery({
    queryKey: ['users', q, showInactive],
    queryFn: () => api<UserRow[]>(`/users?${new URLSearchParams({ ...(q && { q }), ...(showInactive && { includeInactive: 'true' }) })}`),
  });
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: () => api<Specialty[]>('/specialties') });

  const toggle = useMutation({
    mutationFn: (u: UserRow) => api(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !u.isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Usuarios</h1>
          <p>Especialistas, jefes de brigada, supervisores, logísticos y coordinación.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>Nuevo usuario</button>
      </div>

      <div className="card">
        <div className="toolbar">
          <input className="input" placeholder="Buscar por nombre o DNI" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar inactivos
          </label>
        </div>
        {users.isLoading ? (
          <div className="empty">Cargando…</div>
        ) : users.isError ? (
          <div className="empty">No se pudo cargar la lista.</div>
        ) : !users.data?.length ? (
          <div className="empty">No hay usuarios que coincidan.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>DNI</th><th>Nombre</th><th>Roles</th><th>Especialidad</th><th>Estado</th><th>Último ingreso</th><th /></tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{u.dni}</td>
                    <td>{u.fullName}</td>
                    <td>{u.roles.map((r) => <span key={r} className="chip">{ROLE_LABELS[r]}</span>)}</td>
                    <td className={u.specialtyName ? '' : 'muted'}>{u.specialtyName ?? '—'}</td>
                    <td><span className={'chip ' + (u.isActive ? 'chip-ok' : 'chip-off')}>{u.isActive ? 'Activo' : 'Inactivo'}</span></td>
                    <td className="muted">{fmtDate(u.lastLoginAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm" onClick={() => setEditing(u)}>Editar</button>{' '}
                      {u.id !== me!.id && (
                        <button className={'btn btn-sm' + (u.isActive ? ' btn-danger' : '')} disabled={toggle.isPending} onClick={() => toggle.mutate(u)}>
                          {u.isActive ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <UserDialog
          user={editing === 'new' ? null : editing}
          specialties={specialties.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['users'] }); }}
        />
      )}
    </>
  );
}

function UserDialog({ user, specialties, onClose, onSaved }: { user: UserRow | null; specialties: Specialty[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    dni: user?.dni ?? '',
    fullName: user?.fullName ?? '',
    phone: user?.phone ?? '',
    email: user?.email ?? '',
    password: '',
    roles: user?.roles ?? (['especialista'] as Role[]),
    specialtyId: user?.specialtyId ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const needsSpecialty = form.roles.includes('especialista');

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        dni: form.dni.trim(), fullName: form.fullName.trim(), roles: form.roles,
        specialtyId: needsSpecialty && form.specialtyId ? form.specialtyId : null,
        ...(form.phone && { phone: form.phone }), ...(form.email && { email: form.email }),
        ...(form.password && { password: form.password }),
      };
      return user ? api(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(body) }) : api('/users', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? (e.issues?.map((i) => i.message).join('. ') || e.message) : 'Error al guardar'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.roles.length) return setError('Selecciona al menos un rol');
    if (needsSpecialty && !form.specialtyId) return setError('Un especialista debe tener especialidad');
    if (!user && form.password.length < 6) return setError('La contraseña inicial debe tener al menos 6 caracteres');
    save.mutate();
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const toggleRole = (r: Role) => setForm({ ...form, roles: form.roles.includes(r) ? form.roles.filter((x) => x !== r) : [...form.roles, r] });

  return (
    <div className="overlay" onClick={onClose}>
      <form className="card dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">{user ? 'Editar usuario' : 'Nuevo usuario'}</h2>
        {error && <div className="alert-error" role="alert">{error}</div>}
        <div className="grid-2">
          <div className="field"><label htmlFor="u-dni">DNI</label><input id="u-dni" className="input" value={form.dni} onChange={set('dni')} inputMode="numeric" required /></div>
          <div className="field"><label htmlFor="u-name">Nombre completo</label><input id="u-name" className="input" value={form.fullName} onChange={set('fullName')} required /></div>
          <div className="field"><label htmlFor="u-phone">Teléfono</label><input id="u-phone" className="input" value={form.phone} onChange={set('phone')} /></div>
          <div className="field"><label htmlFor="u-email">Correo</label><input id="u-email" className="input" type="email" value={form.email} onChange={set('email')} /></div>
        </div>
        <div className="field">
          <label>Roles</label>
          <div className="checks">
            {ROLES.map((r) => (
              <label key={r}><input type="checkbox" checked={form.roles.includes(r)} onChange={() => toggleRole(r)} />{ROLE_LABELS[r]}</label>
            ))}
          </div>
        </div>
        {needsSpecialty && (
          <div className="field">
            <label htmlFor="u-spec">Especialidad</label>
            <select id="u-spec" className="input" value={form.specialtyId} onChange={set('specialtyId')}>
              <option value="">Seleccionar…</option>
              {specialties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="u-pwd">{user ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}</label>
          <input id="u-pwd" className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
          <span className="muted" style={{ fontSize: 12 }}>El usuario deberá cambiarla en su primer ingreso.</span>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  );
}
