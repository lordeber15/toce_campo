import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { LeafIcon } from '../components/icons';

/** Cambio de contraseña obligatorio en el primer ingreso (la contraseña inicial es el DNI). */
export function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = next && next.length < 6 ? 'La nueva contraseña debe tener al menos 6 caracteres.'
    : next && next === user?.dni ? 'La nueva contraseña no puede ser tu DNI.'
      : repeat && next !== repeat ? 'Las contraseñas no coinciden.' : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (problem || !current || !next || next !== repeat) return;
    setError(null);
    setBusy(true);
    try {
      await changePassword(current, next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login-hero">
        <div className="brand"><span className="brand-mark"><LeafIcon /></span>TOCE</div>
        <div>
          <h1>Crea tu contraseña</h1>
          <p>Es tu primer ingreso: la contraseña inicial es tu DNI. Elige una nueva para proteger tu cuenta; la usarás en la web y en la app TOCE Campo.</p>
        </div>
        <span style={{ fontSize: 12, color: '#9fcbb6' }}>{user?.fullName}</span>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={onSubmit} noValidate aria-labelledby="cp-title">
          <div>
            <h2 id="cp-title">Cambiar contraseña</h2>
            <p className="sub">Debes cambiarla antes de continuar.</p>
          </div>
          {(error || problem) && <div className="alert-error" role="alert">{error ?? problem}</div>}
          <div className="field">
            <label htmlFor="cp-current">Contraseña actual</label>
            <input id="cp-current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="cp-new">Nueva contraseña</label>
            <input id="cp-new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={6} />
          </div>
          <div className="field">
            <label htmlFor="cp-repeat">Repite la nueva contraseña</label>
            <input id="cp-repeat" className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy || !current || !next || next !== repeat || !!problem}>
            {busy ? 'Guardando…' : 'Guardar y continuar'}
          </button>
          <button className="btn" type="button" onClick={() => void logout()}>Salir</button>
        </form>
      </section>
    </div>
  );
}
