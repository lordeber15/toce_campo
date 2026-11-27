import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { FormSchema } from '@toce/shared';
import { api } from '../lib/api';
import { ErrorBox } from '../components/Dialog';

type Plan = {
  fingerprint: string; errors: string[]; warnings: string[];
  items: { id: string; code: string; specialty: string; before: FormSchema; after: FormSchema }[];
};
export function FormImportPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [base64, setBase64] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  async function validate() {
    if (!file) return;
    setBusy(true); setError(null); setPlan(null); setDone(null); setConfirmed(false);
    try {
      if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 5 * 1024 * 1024) throw new Error('Selecciona un .xlsx de hasta 5 MB.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]!);
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
      });
      const preview = await api<Plan>('/import/forms/validate', { method: 'POST', body: JSON.stringify({ fileBase64: data }) });
      setBase64(data); setPlan(preview);
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!plan || plan.errors.length || !confirmed) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ updated: number }>('/import/forms/commit', { method: 'POST', body: JSON.stringify({ fileBase64: base64, fingerprint: plan.fingerprint, compatibleMobileConfirmed: true }) });
      setDone(result.updated); setPlan(null); setBase64(''); setConfirmed(false);
      await qc.invalidateQueries({ queryKey: ['methods-admin'] });
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-head"><div><h1>Carga de formularios</h1><p>Configuración por método: Metodos, Campos, Opciones y Reglas.</p></div><Link to="/metodos" className="btn">Ver métodos</Link></div>
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <label htmlFor="forms-file">Excel de formularios</label>{' '}
      <input id="forms-file" type="file" accept=".xlsx" disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPlan(null); setError(null); setDone(null); setConfirmed(false); setBase64(''); }} />
      <p>Los formularios pertenecen al catálogo compartido de métodos. Los registros anteriores conservarán su definición original.</p>
      <button className="btn btn-primary" disabled={!file || busy} onClick={() => void validate()}>{busy ? 'Procesando…' : 'Validar y previsualizar'}</button>
    </div>
    {!!error && <ErrorBox error={error} />}
    {done != null && <div className="card" role="status" style={{ padding: 20 }}><strong>{done} formularios actualizados.</strong> Actualiza el paquete de trabajo en los dispositivos con la aplicación compatible.</div>}
    {plan && <>
      {plan.errors.length > 0 && <div className="card" role="alert" style={{ padding: 20 }}><h2>Corrige el Excel antes de guardar</h2><ul>{plan.errors.map((e,i) => <li key={i}>{e}</li>)}</ul></div>}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}><h2>{plan.items.length} métodos · {plan.items.reduce((n,i) => n+i.after.fields.length,0)} campos</h2>
        <ul>{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        {plan.items.map((item) => <details key={item.id} style={{ marginBottom: 14 }}><summary><strong>{item.code}</strong> · {item.specialty} · {item.before.fields.length} → {item.after.fields.length} campos</summary>
          <p>{item.after.note}</p><div className="table-wrap"><table><thead><tr><th>Campo</th><th>Nivel / grupo</th><th>Tipo</th><th>Opciones / condición</th></tr></thead><tbody>{item.after.fields.map((f) => <tr key={f.key}><td>{f.label}{f.required ? ' *' : ''}<small>{f.unit}</small></td><td>{f.level} / {f.group}</td><td>{f.type}</td><td>{f.options?.map((o) => f.optionLabels?.[o] ?? o).join(', ')}{f.visibleIf && <pre>{JSON.stringify(f.visibleIf)}</pre>}</td></tr>)}</tbody></table></div>
        </details>)}
        <label style={{ display: 'flex', gap: 10, marginBottom: 14 }}><input type="checkbox" checked={confirmed} disabled={busy || !!plan.errors.length} onChange={(e) => setConfirmed(e.target.checked)} />La versión móvil compatible ya está instalada; revisé los métodos y campos de esta importación.</label>
        <button className="btn btn-primary" disabled={busy || !confirmed || !!plan.errors.length || !plan.items.length} onClick={() => void commit()}>Guardar {plan.items.length} formularios</button>
      </div>
    </>}
  </>;
}
