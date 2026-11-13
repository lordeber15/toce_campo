import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { LeafIcon } from '../components/icons';

export function LoginPage() {
  const { login } = useAuth();
  const [dni, setDni] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(dni.trim(), password);
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
          <h1>Plataforma de Campo</h1>
          <p>Planificación, seguimiento y control de las brigadas de evaluación y muestreo ambiental.</p>
        </div>
        <span style={{ fontSize: 12, color: '#9fcbb6' }}>Coordinación · Supervisión · Jefatura de proyecto</span>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={onSubmit} noValidate>
          <div>
            <h2>Ingresar</h2>
            <p className="sub">Usa tu DNI y contraseña.</p>
          </div>
          {error && <div className="alert-error" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="dni">DNI</label>
            <input id="dni" className="input" inputMode="numeric" autoComplete="username" value={dni} onChange={(e) => setDni(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="pwd">Contraseña</label>
            <input id="pwd" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy || !dni || !password}>
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </section>
    </div>
  );
}
