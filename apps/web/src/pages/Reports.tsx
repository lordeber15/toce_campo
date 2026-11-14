import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  BRIGADE_FLAG_LABELS, EXECUTION_STATUS_LABELS, INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS, STATION_STATUS_LABELS,
  type DailyReport,
} from '@toce/shared';
import { api, download } from '../lib/api';
import { useProject } from '../lib/project';
import { ErrorBox, NoProject } from '../components/Dialog';
import { ProgressBar } from '../components/ProgressChart';
import { FLAG_CHIP, MetricTiles, since } from './Tracking';

const limaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const d8 = (d: string) => d.split('-').reverse().join('/');
const hour = (iso: string) => new Date(iso).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false });
const RESCHEDULE = { propuesta: 'Propuesta', aprobada: 'Aprobada', rechazada: 'Rechazada' } as const;

/** Reportes (5.6): reporte diario en pantalla y en Excel, y reporte consolidado del proyecto en Excel. */
export function ReportsPage() {
  const { project } = useProject();
  const [date, setDate] = useState(limaToday);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({
    queryKey: ['daily-report', project?.id, date],
    enabled: !!project && !!date,
    queryFn: () => api<DailyReport>(`/projects/${project!.id}/reports/daily?date=${date}`),
    placeholderData: keepPreviousData,
  });
  if (!project) return <NoProject />;
  const get = async (kind: 'daily' | 'consolidated') => {
    setBusy(kind); setError(null);
    try { await download(`/projects/${project.id}/reports/${kind}.xlsx?date=${date}`); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const r = q.data;
  const isToday = date === limaToday();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reportes</h1>
          <p>Reporte diario de {project.code} y reporte consolidado del proyecto, para ver aquí o descargar en Excel.</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Fecha <input className="input" type="date" value={date} max={limaToday()} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 160 }} />
            </label>
            <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => get('daily')}>{busy === 'daily' ? 'Preparando…' : 'Reporte diario (Excel)'}</button>
            <button className="btn btn-sm" disabled={!!busy} onClick={() => get('consolidated')}>{busy === 'consolidated' ? 'Preparando…' : 'Consolidado (Excel)'}</button>
          </div>
          <span className="hint">El consolidado toma la fecha como corte: avance por brigada y estación, desviaciones, alertas, reprogramaciones y sincronización.</span>
          <ErrorBox error={error} />
        </div>
      </div>

      <ErrorBox error={q.error} />
      {!r ? <div className="card empty">Preparando el reporte…</div> : (
        <div style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
          <div className="section-title">Día {d8(r.date)}{isToday ? ' (hoy)' : ''}</div>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', marginBottom: 16 }}>
            <Tile label="Estaciones del día" value={`${r.day.stationsExecuted}/${r.day.stationsPlanned}`} hint="ejecutadas / programadas" />
            <Tile label="Unidades ejecutadas" value={`${r.day.units}`} hint={`${r.day.unitsCompleted} completadas`} />
            <Tile label="Registros" value={`${r.day.records}`} hint="anotados en formularios" />
            <Tile label="Fotos" value={`${r.day.photos}`} />
            <Tile label="Incidencias" value={`${r.day.incidents}`} warn={r.day.incidents > 0} />
            <Tile label="Reprogramaciones" value={`${r.reschedules.length}`} hint="propuestas o aprobadas ese día" />
          </div>

          <div className="section-title">Avance acumulado del proyecto</div>
          <p className="hint" style={{ marginTop: -4 }}>Con todo lo sincronizado hasta ahora; “a la fecha” y “atrasadas” se calculan al {d8(r.date)}.</p>
          <MetricTiles m={r.metrics} brigades={r.metrics.brigades} />

          <Section title="Brigadas" count={r.brigades.length}>
            <table>
              <thead><tr><th>Brigada</th><th>Estado</th><th>Avance</th><th>Cumplimiento a la fecha</th><th style={{ textAlign: 'right' }}>Estaciones del día</th><th style={{ textAlign: 'right' }}>Unidades del día</th><th>Última sincronización</th></tr></thead>
              <tbody>
                {r.brigades.map((b) => {
                  const s = since(b.lastSyncAt);
                  return (
                    <tr key={b.id}>
                      <td><Link to={`/seguimiento/${b.id}`}><strong>{b.name}</strong></Link> <span className="hint">{b.specialtyCode}</span></td>
                      <td><span className={FLAG_CHIP[b.flag]}>{BRIGADE_FLAG_LABELS[b.flag]}</span></td>
                      <td><ProgressBar value={b.progressPct} /></td>
                      <td><ProgressBar value={b.compliancePct} tone={b.compliancePct != null && b.compliancePct < 80 ? 'warn' : undefined} /></td>
                      <td style={{ textAlign: 'right' }}>{b.stationsToday}</td>
                      <td style={{ textAlign: 'right' }}>{b.unitsToday}</td>
                      <td style={{ color: s.stale ? 'var(--danger)' : undefined }}>{s.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          <Section title="Estaciones programadas en el día" count={r.stations.length} empty="No había estaciones programadas este día.">
            <table>
              <thead><tr><th>Brigada</th><th>Estación</th><th>Estado</th><th style={{ textAlign: 'right' }}>Completadas</th><th style={{ textAlign: 'right' }}>No realizadas</th><th style={{ textAlign: 'right' }}>Completadas en el día</th></tr></thead>
              <tbody>
                {r.stations.map((s, i) => (
                  <tr key={i}>
                    <td>{s.brigadeName}</td>
                    <td><strong>{s.stationCode}</strong>{s.originalDate && <span className="hint"> · reprogramada desde {d8(s.originalDate)}</span>}</td>
                    <td>{STATION_STATUS_LABELS[s.status]}</td>
                    <td style={{ textAlign: 'right' }}>{s.done}/{s.required}</td>
                    <td style={{ textAlign: 'right' }}>{s.notDone || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{s.doneToday}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Unidades de muestreo registradas" count={r.units.length} empty="No se registraron unidades este día.">
            <table>
              <thead><tr><th>Unidad</th><th>Método</th><th>Brigada</th><th>Especialista</th><th>Hora</th><th>Estado</th><th style={{ textAlign: 'right' }}>Registros</th><th style={{ textAlign: 'right' }}>Fotos</th></tr></thead>
              <tbody>
                {r.units.map((u) => (
                  <tr key={u.id}>
                    <td><Link to={`/registros/${u.id}`} state={{ back: '/reportes' }}><strong>{u.unitCode}</strong></Link></td>
                    <td>{u.methodCode}</td>
                    <td>{u.brigadeName ?? '—'}</td>
                    <td>{u.specialistName}</td>
                    <td>{hour(u.startedAt)}</td>
                    <td>{EXECUTION_STATUS_LABELS[u.status]}</td>
                    <td style={{ textAlign: 'right' }}>{u.records}</td>
                    <td style={{ textAlign: 'right' }}>{u.photos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Incidencias" count={r.incidents.length} empty="Sin incidencias este día.">
            <table>
              <thead><tr><th>Hora</th><th>Tipo</th><th>Estado</th><th>Brigada</th><th>Estación</th><th>Reportó</th><th>Descripción</th></tr></thead>
              <tbody>
                {r.incidents.map((i) => (
                  <tr key={i.id}>
                    <td>{hour(i.occurredAt)}</td>
                    <td>{INCIDENT_TYPE_LABELS[i.type]}</td>
                    <td>{INCIDENT_STATUS_LABELS[i.status]}</td>
                    <td>{i.brigadeName ?? '—'}</td>
                    <td>{i.stationCode ?? '—'}</td>
                    <td>{i.reportedBy}</td>
                    <td className="wrap">{i.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Reprogramaciones" count={r.reschedules.length} empty="Sin reprogramaciones este día.">
            <table>
              <thead><tr><th>Estación</th><th>Brigada</th><th>Fecha</th><th>Estado</th><th>Aprobó</th><th>Motivo</th></tr></thead>
              <tbody>
                {r.reschedules.map((x, i) => (
                  <tr key={i}>
                    <td><strong>{x.stationCode}</strong></td>
                    <td>{x.brigadeName}</td>
                    <td>{d8(x.fromDate)} → {d8(x.toDate)}</td>
                    <td>{RESCHEDULE[x.status]}</td>
                    <td>{x.approvedByName ?? '—'}</td>
                    <td className="wrap">{x.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Actividades pendientes" count={r.pending.length} empty="No hay estaciones pendientes a esta fecha.">
            <table>
              <thead><tr><th>Brigada</th><th>Estación</th><th>Fecha programada</th><th style={{ textAlign: 'right' }}>Unidades pendientes</th><th /></tr></thead>
              <tbody>
                {r.pending.map((p, i) => (
                  <tr key={i}>
                    <td>{p.brigadeName}</td>
                    <td><strong>{p.stationCode}</strong></td>
                    <td>{d8(p.firstDate)}</td>
                    <td style={{ textAlign: 'right' }}>{p.pendingUnits}</td>
                    <td>{p.late && <span className="chip chip-off">Atrasada</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
      )}
    </>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-title" style={{ margin: 0, padding: '14px 18px' }}>{title} ({count})</div>
      {count === 0 ? <div className="empty" style={{ padding: 20 }}>{empty}</div> : <div className="table-wrap">{children}</div>}
    </div>
  );
}

function Tile({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value" style={{ color: warn ? 'var(--danger)' : undefined }}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
