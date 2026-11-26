import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  INFLUENCE_AREAS, TEMPLATE_SHEETS,
  type TemplateCommitResult, type TemplateDifference, type TemplateIssue, type TemplateOverride, type TemplateSummary, type TemplateValidation,
} from '@toce/shared';
import { api, ApiError } from '../lib/api';
import { useProject } from '../lib/project';
import { ErrorBox } from '../components/Dialog';

/** Filas del resumen, en el orden de las hojas de la plantilla. */
const SUMMARY_ROWS: { key: keyof TemplateSummary; label: string; sheet: string }[] = [
  { key: 'project', label: 'Proyecto', sheet: TEMPLATE_SHEETS.project },
  { key: 'users', label: 'Usuarios', sheet: TEMPLATE_SHEETS.users },
  { key: 'specialties', label: 'Especialidades', sheet: `${TEMPLATE_SHEETS.users} / ${TEMPLATE_SHEETS.lists}` },
  { key: 'brigades', label: 'Brigadas', sheet: TEMPLATE_SHEETS.brigades },
  { key: 'members', label: 'Integrantes', sheet: TEMPLATE_SHEETS.members },
  { key: 'stations', label: 'Estaciones', sheet: TEMPLATE_SHEETS.stations },
  { key: 'methods', label: 'Métodos', sheet: TEMPLATE_SHEETS.methods },
  { key: 'stationMethods', label: 'Métodos por estación', sheet: TEMPLATE_SHEETS.stationMethods },
  { key: 'schedules', label: 'Actividades del cronograma', sheet: TEMPLATE_SHEETS.schedule },
];
const FIELD_LABEL: Record<TemplateDifference['field'], string> = { influenceArea: 'Área de influencia', vegetationUnit: 'Unidad de vegetación' };
const areaText = (v: string | null) => (v == null || v === '' ? '—' : v === 'fuera' ? 'Fuera del área' : v);

type Choice = { choice: TemplateOverride['choice']; value: string };
const diffKey = (d: Pick<TemplateDifference, 'stationCode' | 'field'>) => `${d.stationCode}|${d.field}`;

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(file);
  });
}

function groupBySheet(items: TemplateIssue[]) {
  const m = new Map<string, TemplateIssue[]>();
  for (const i of items) m.set(i.sheet, [...(m.get(i.sheet) ?? []), i]);
  return [...m];
}

/** Carga masiva por plantilla Excel: valida, muestra lo que cambiará y las diferencias con las capas KMZ, y confirma. */
export function BulkImportPage() {
  const qc = useQueryClient();
  const { setProjectId } = useProject();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number; base64: string } | null>(null);
  const [busy, setBusy] = useState<'reading' | 'validating' | 'committing' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [validation, setValidation] = useState<TemplateValidation | null>(null);
  const [choices, setChoices] = useState<Map<string, Choice>>(new Map());
  const [result, setResult] = useState<TemplateCommitResult | null>(null);
  const [over, setOver] = useState(false);

  async function validate(f: { name: string; base64: string }) {
    setBusy('validating');
    setError(null);
    try {
      const v = await api<TemplateValidation>('/import/template/validate', { method: 'POST', body: JSON.stringify({ fileBase64: f.base64, fileName: f.name }) });
      setValidation(v);
      setChoices(new Map());
    } catch (e) {
      setValidation(null);
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function onFile(f?: File) {
    if (!f) return;
    setResult(null);
    setValidation(null);
    if (!/\.xlsx$/i.test(f.name)) { setError(new Error(`“${f.name}” no es un Excel .xlsx. Usa la plantilla de carga masiva.`)); return; }
    if (f.size > 70 * 1024 * 1024) { setError(new Error('El archivo supera los 70 MB.')); return; }
    setBusy('reading');
    try {
      const loaded = { name: f.name, size: f.size, base64: await readBase64(f) };
      setFile(loaded);
      await validate(loaded);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  const overrides = useMemo<TemplateOverride[]>(() => (validation?.differences ?? []).map((d) => {
    const c = choices.get(diffKey(d)) ?? { choice: 'declared', value: '' };
    return { stationCode: d.stationCode, field: d.field, choice: c.choice, ...(c.choice === 'custom' ? { value: c.value.trim() || null } : {}) };
  }), [validation, choices]);
  const customMissing = overrides.some((o) => o.choice === 'custom' && !o.value);

  async function commit() {
    if (!file || !validation) return;
    setBusy('committing');
    setError(null);
    try {
      const r = await api<TemplateCommitResult>('/import/template/commit', {
        method: 'POST', body: JSON.stringify({ fileBase64: file.base64, fileName: file.name, overrides }),
      });
      // Primero se recarga la lista de proyectos para que el proyecto nuevo exista al activarlo.
      await qc.invalidateQueries();
      await qc.refetchQueries({ queryKey: ['projects'] });
      setProjectId(r.projectId);
      setResult(r);
      setValidation(null);
    } catch (e) {
      setError(e);
      // La plantilla cambió de estado (p. ej. otro usuario cargó algo): se vuelve a validar para mostrar los errores.
      if (e instanceof ApiError && e.status === 400) await validate(file);
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setFile(null);
    setValidation(null);
    setResult(null);
    setError(null);
    setChoices(new Map());
    if (fileRef.current) fileRef.current.value = '';
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!busy) void onFile(e.dataTransfer.files[0]);
  };

  if (result) return <ImportDone result={result} onAgain={reset} />;

  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const differences = validation?.differences ?? [];
  const canCommit = !!validation && errors.length === 0 && !busy && !customMissing;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Carga masiva</h1>
          <p>Proyecto, usuarios, brigadas, estaciones, métodos y cronograma desde la plantilla Excel. Primero se valida; nada se guarda hasta que confirmes.</p>
        </div>
      </div>

      <ol className="import-steps" aria-label="Pasos">
        <li className={validation || file ? 'done' : 'current'}>Elegir la plantilla</li>
        <li className={validation ? (errors.length ? 'blocked' : 'done') : busy === 'validating' ? 'current' : ''}>Revisar la validación</li>
        <li className={validation && !errors.length ? 'current' : ''}>Confirmar la carga</li>
      </ol>

      <div className="import-grid">
        <div className="card import-file">
          <div className="section-title" style={{ marginTop: 0 }}>Plantilla</div>
          <p className="hint" style={{ marginTop: 0 }}>
            Usa la plantilla de carga masiva de TOCE (.xlsx) con sus hojas en este orden. Si un dato ya existe (mismo DNI, código de brigada o de estación) se actualiza;
            lo que no está se crea.
          </p>
          <div className="pill-list" style={{ marginBottom: 14 }}>
            {Object.values(TEMPLATE_SHEETS).filter((s) => s !== TEMPLATE_SHEETS.lists).map((s) => <span key={s} className="chip">{s}</span>)}
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
            onChange={(e) => void onFile(e.target.files?.[0])} />
          <button
            type="button"
            className={'drop' + (over ? ' over' : '')}
            disabled={!!busy}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            {busy === 'reading' || busy === 'validating' ? (
              <span className="busy-line"><span className="spinner" aria-hidden="true" />{busy === 'reading' ? 'Leyendo el archivo…' : 'Validando la plantilla… puede tardar unos segundos'}</span>
            ) : file ? (
              <><strong style={{ color: 'var(--text)' }}>{file.name}</strong><br /><span className="hint">{(file.size / 1024).toLocaleString('es-PE', { maximumFractionDigits: 0 })} KB · elegir otro archivo</span></>
            ) : (
              <><strong>Elegir la plantilla .xlsx</strong><br /><span className="hint">o arrástrala aquí</span></>
            )}
          </button>
          {file && validation && !busy && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-sm" onClick={() => void validate(file)}>Validar de nuevo</button>
              <button type="button" className="btn btn-sm" onClick={reset}>Quitar</button>
            </div>
          )}
          <p className="hint" style={{ marginBottom: 0 }}>
            Las capas KMZ se suben después en <Link to="/capas">Mapa y capas</Link>. Si el proyecto ya tiene capas, aquí verás en qué estaciones no coinciden con la plantilla.
          </p>
        </div>

        <div className="import-result">
          <ErrorBox error={error} />
          {!validation && !busy && !error && (
            <div className="card empty">Elige la plantilla para ver qué se va a cargar.</div>
          )}
          {validation && (
            <>
              <div className={'card import-banner ' + (errors.length ? 'is-error' : 'is-ok')} role="status">
                <strong>
                  {errors.length
                    ? `${errors.length} error${errors.length === 1 ? '' : 'es'} que impiden la carga`
                    : 'La plantilla no tiene errores'}
                </strong>
                <span>
                  {errors.length
                    ? 'Corrígelos en el Excel y vuelve a subirlo. No se guardó nada.'
                    : validation.projectId
                      ? `Se actualizará el proyecto existente ${validation.projectCode}.`
                      : `Se creará el proyecto ${validation.projectCode ?? ''}.`}
                  {warnings.length ? ` ${warnings.length} advertencia${warnings.length === 1 ? '' : 's'} para revisar.` : ''}
                </span>
              </div>

              <div className="card">
                <div className="section-title" style={{ margin: 0, padding: '14px 16px 6px' }}>Resumen por hoja</div>
                <div className="table-wrap">
                  <table className="import-summary">
                    <thead><tr><th>Dato</th><th>Hoja</th><th className="num">Total</th><th className="num">Nuevos</th><th className="num">Se actualizan</th></tr></thead>
                    <tbody>
                      {SUMMARY_ROWS.map((r) => {
                        const c = validation.summary[r.key];
                        return (
                          <tr key={r.key} data-key={r.key}>
                            <td><strong>{r.label}</strong></td>
                            <td className="muted">{r.sheet}</td>
                            <td className="num">{c.total.toLocaleString('es-PE')}</td>
                            <td className="num">{c.new ? <span className="chip chip-ok">{c.new.toLocaleString('es-PE')}</span> : '—'}</td>
                            <td className="num">{c.update ? c.update.toLocaleString('es-PE') : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {errors.length > 0 && <IssueGroups title="Errores" kind="error" items={errors} />}
              {differences.length > 0 && (
                <Differences differences={differences} choices={choices} setChoices={setChoices} />
              )}
              {warnings.length > 0 && <IssueGroups title="Advertencias" kind="warn" items={warnings} collapsible />}

              <div className="card import-confirm">
                <div className="grow">
                  {errors.length
                    ? <span className="hint">Corrige los errores para poder confirmar.</span>
                    : customMissing
                      ? <span className="hint">Escribe el valor propio en las diferencias marcadas como “Otro”.</span>
                      : <span className="hint">Se guardará todo en una sola operación{differences.length ? `, con tus ${differences.length} elecciones de diferencias` : ''}. Si algo falla, no se guarda nada.</span>}
                </div>
                <button type="button" className="btn btn-primary" disabled={!canCommit} onClick={() => void commit()}>
                  {busy === 'committing' ? <><span className="spinner spinner-light" aria-hidden="true" />Cargando…</> : 'Confirmar carga'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function IssueGroups({ title, kind, items, collapsible }: { title: string; kind: 'error' | 'warn'; items: TemplateIssue[]; collapsible?: boolean }) {
  const groups = groupBySheet(items);
  const body = (
    <div className="issue-groups">
      {groups.map(([sheet, list]) => (
        <div key={sheet}>
          <div className="issue-sheet">{sheet} <span className={'chip ' + (kind === 'error' ? 'chip-off' : 'chip-warn')}>{list.length}</span></div>
          <div className="table-wrap">
            <table className="issue-table">
              <thead><tr><th className="num">Fila</th><th>Columna</th><th>Detalle</th></tr></thead>
              <tbody>
                {list.map((i, n) => (
                  <tr key={n}>
                    <td className="num">{i.row ?? '—'}</td>
                    <td>{i.column ?? '—'}</td>
                    <td className="wrap">{i.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
  const head = <>{title} ({items.length})<span className="hint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{kind === 'error' ? ' · bloquean la carga' : ' · no bloquean la carga'}</span></>;
  if (collapsible) {
    return (
      <details className={'card issues issues-' + kind}>
        <summary className="section-title">{head}</summary>
        {body}
      </details>
    );
  }
  return (
    <div className={'card issues issues-' + kind}>
      <div className="section-title" style={{ margin: 0 }}>{head}</div>
      {body}
    </div>
  );
}

/** Plantilla vs capas KMZ: por cada estación se elige lo declarado, lo calculado o un valor propio (queda fijado). */
function Differences({ differences, choices, setChoices }: {
  differences: TemplateDifference[]; choices: Map<string, Choice>; setChoices: (m: Map<string, Choice>) => void;
}) {
  const get = (d: TemplateDifference) => choices.get(diffKey(d)) ?? { choice: 'declared' as const, value: '' };
  const put = (d: TemplateDifference, c: Choice) => setChoices(new Map(choices).set(diffKey(d), c));
  const all = (choice: 'declared' | 'computed') => setChoices(new Map(differences.map((d) => [diffKey(d), { choice, value: '' }])));
  return (
    <div className="card">
      <div className="diff-head">
        <div className="grow">
          <div className="section-title" style={{ margin: 0 }}>Diferencias con las capas KMZ ({differences.length})</div>
          <span className="hint">
            La plantilla dice una cosa y las capas del proyecto otra. Elige qué queda en cada estación. Lo de la plantilla o un valor propio queda fijado
            (las capas ya no lo cambian); lo de las capas se sigue recalculando.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" onClick={() => all('declared')}>Todo de la plantilla</button>
          <button type="button" className="btn btn-sm" onClick={() => all('computed')}>Todo de las capas</button>
        </div>
      </div>
      <div className="table-wrap diff-scroll">
        <table className="diff-table">
          <thead><tr><th>Estación</th><th>Plantilla</th><th>Capas KMZ</th><th>Queda</th></tr></thead>
          <tbody>
            {differences.map((d) => {
              const c = get(d);
              const fmt = d.field === 'influenceArea' ? areaText : (v: string | null) => v ?? '—';
              return (
                <tr key={diffKey(d)}>
                  <td><strong>{d.stationCode}</strong><small className="hint" style={{ display: 'block' }}>{FIELD_LABEL[d.field]}</small></td>
                  <td className={'diff-val' + (c.choice === 'declared' ? ' diff-picked' : '')}>{fmt(d.declared)}</td>
                  <td className={'diff-val' + (c.choice === 'computed' ? ' diff-picked' : '')}>{fmt(d.computed)}</td>
                  <td>
                    <div className="diff-choice">
                      <div className="segmented" role="group" aria-label={`Qué queda en ${d.stationCode}`}>
                        <button type="button" aria-pressed={c.choice === 'declared'} onClick={() => put(d, { choice: 'declared', value: '' })}>Plantilla</button>
                        <button type="button" aria-pressed={c.choice === 'computed'} onClick={() => put(d, { choice: 'computed', value: '' })}>Capas</button>
                        <button type="button" aria-pressed={c.choice === 'custom'} onClick={() => put(d, { choice: 'custom', value: c.value || (d.field === 'influenceArea' ? '' : d.declared ?? '') })}>Otro</button>
                      </div>
                      {c.choice === 'custom' && (d.field === 'influenceArea' ? (
                        <select className="input input-sm" value={c.value} onChange={(e) => put(d, { choice: 'custom', value: e.target.value })} aria-label={`Área de ${d.stationCode}`}>
                          <option value="">Elige…</option>
                          {INFLUENCE_AREAS.map((a) => <option key={a} value={a}>{areaText(a)}</option>)}
                        </select>
                      ) : (
                        <input className="input input-sm" value={c.value} onChange={(e) => put(d, { choice: 'custom', value: e.target.value })} placeholder="Unidad de vegetación" aria-label={`Unidad de vegetación de ${d.stationCode}`} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportDone({ result, onAgain }: { result: TemplateCommitResult; onAgain: () => void }) {
  const { project } = useProject();
  const noCoordinator = result.warnings.some((w) => w.message.includes('rol Coordinador'));
  const s = result.summary;
  const newUsers = s.users.new;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Carga masiva</h1>
          <p>Carga terminada{project ? ` · proyecto activo: ${project.code} · ${project.name}` : ''}.</p>
        </div>
        <button type="button" className="btn" onClick={onAgain}>Cargar otra plantilla</button>
      </div>
      <div className="card import-banner is-ok" role="status">
        <strong>Se cargó la plantilla</strong>
        <span>
          {s.stations.total} estaciones, {s.brigades.total} brigadas, {s.users.total} usuarios y {s.schedules.total} actividades del cronograma.
          {result.unitsCreated ? ` Se crearon ${result.unitsCreated.toLocaleString('es-PE')} unidades de muestreo.` : ''}
          {result.schedulesRemoved ? ` Se quitaron ${result.schedulesRemoved} programaciones antiguas sin trabajo de campo.` : ''}
        </span>
      </div>

      <div className="import-grid">
        <div className="card">
          <div className="section-title" style={{ margin: 0, padding: '14px 16px 6px' }}>Lo que se guardó</div>
          <div className="table-wrap">
            <table className="import-summary">
              <thead><tr><th>Dato</th><th className="num">Total</th><th className="num">Nuevos</th><th className="num">Actualizados</th></tr></thead>
              <tbody>
                {SUMMARY_ROWS.map((r) => (
                  <tr key={r.key} data-key={r.key}>
                    <td><strong>{r.label}</strong></td>
                    <td className="num">{s[r.key].total.toLocaleString('es-PE')}</td>
                    <td className="num">{s[r.key].new ? s[r.key].new.toLocaleString('es-PE') : '—'}</td>
                    <td className="num">{s[r.key].update ? s[r.key].update.toLocaleString('es-PE') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {newUsers > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <div className="section-title" style={{ marginTop: 0 }}>Acceso de los usuarios nuevos</div>
              <p style={{ margin: 0 }}>
                Los {newUsers} usuarios nuevos ingresan con su <strong>DNI como usuario y como contraseña</strong>. En su primer ingreso (web o app) deben cambiarla.
                Los usuarios que ya existían conservan su contraseña.
              </p>
            </div>
          )}
          {noCoordinator && (
            <div className="card import-banner is-warn">
              <strong>Falta un coordinador</strong>
              <span>La plantilla no trae ningún usuario con rol Coordinador. <Link to="/usuarios">Crea uno en Usuarios</Link> para que alguien apruebe reprogramaciones y responda alertas.</span>
            </div>
          )}
          <div className="card">
            <div className="section-title" style={{ margin: 0, padding: '14px 16px 6px' }}>Siguientes pasos</div>
            <div className="list">
              <Link to="/capas" className="list-item next-step">
                <span className="step-num">1</span>
                <div className="grow">Subir el KMZ general<small>Huella, AID, AII, unidades de vegetación y superposiciones del proyecto (Mapa y capas).</small></div>
                <span className="muted">→</span>
              </Link>
              <Link to="/capas" className="list-item next-step">
                <span className="step-num">2</span>
                <div className="grow">Subir el KMZ de cada brigada<small>En Mapa y capas, al importar elige la brigada dueña del archivo: solo sus integrantes lo reciben en el teléfono.</small></div>
                <span className="muted">→</span>
              </Link>
              <Link to="/estaciones" className="list-item next-step">
                <span className="step-num">3</span>
                <div className="grow">Revisar estaciones y cronograma<small>{s.stations.total} estaciones y {s.schedules.total} actividades cargadas.</small></div>
                <span className="muted">→</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
