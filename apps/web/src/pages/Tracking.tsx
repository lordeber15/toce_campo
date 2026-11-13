import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { BRIGADE_FLAG_LABELS, type BrigadeFlag, type BrigadeTracking, type ProjectTracking, type TrackingMetrics } from '@toce/shared';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import { ErrorBox, NoProject } from '../components/Dialog';
import { ProgressBar, ProgressChart } from '../components/ProgressChart';

export const FLAG_CHIP: Record<BrigadeFlag, string> = { al_dia: 'chip chip-ok', en_riesgo: 'chip chip-warn', atrasada: 'chip chip-off', sin_programacion: 'chip' };
const FLAG_ORDER: Record<BrigadeFlag, number> = { atrasada: 0, en_riesgo: 1, al_dia: 2, sin_programacion: 3 };

export const pctText = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('es-PE', { maximumFractionDigits: 1 })} %`);

/** "hace 3 h", "hace 2 días"; más de 24 h sin sincronizar se marca. */
export function since(iso: string | null): { text: string; stale: boolean } {
  if (!iso) return { text: 'Nunca', stale: true };
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  const stale = mins > 24 * 60;
  if (mins < 1) return { text: 'hace un momento', stale };
  if (mins < 60) return { text: `hace ${mins} min`, stale };
  if (mins < 48 * 60) return { text: `hace ${Math.round(mins / 60)} h`, stale };
  return { text: `hace ${Math.round(mins / 1440)} días`, stale };
}

/** Indicadores del documento de requerimientos (5.1). */
export function MetricTiles({ m, brigades }: { m: TrackingMetrics; brigades?: number }) {
  return (
    <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', marginBottom: 16 }}>
      {brigades != null && <Tile label="Brigadas" value={`${brigades}`} />}
      <Tile label="Estaciones ejecutadas" value={`${m.stationsExecuted}/${m.stationsPlanned}`} hint={`${m.stationsDue} programadas a la fecha`} />
      <Tile label="Unidades completadas" value={`${m.unitsDone}/${m.unitsRequired}`} hint={m.unitsNotDone ? `${m.unitsNotDone} no realizadas` : 'unidades de muestreo'} />
      <Tile label="Avance" value={pctText(m.progressPct)} hint="sobre todo lo programado" />
      <Tile label="Cumplimiento a la fecha" value={pctText(m.compliancePct)} hint="sobre lo programado hasta hoy" warn={m.compliancePct != null && m.compliancePct < 80} />
      <Tile
        label="Desviación del cronograma"
        value={pctText(m.deviationPct)}
        hint={`${m.offDateUnits} de ${m.executedUnits} fuera de fecha${m.rescheduledUnits ? ` · ${m.rescheduledUnits} en fecha reprogramada` : ''}`}
        warn={(m.deviationPct ?? 0) > 10}
      />
      <Tile label="Estaciones atrasadas" value={`${m.stationsLate}`} warn={m.stationsLate > 0} hint="fecha vencida sin cerrar" />
      <Tile label="Alertas activas" value={`${m.activeAlerts}`} warn={m.activeAlerts > 0} link="/alertas" />
      <Tile label="Reprogramaciones pendientes" value={`${m.pendingReschedules}`} warn={m.pendingReschedules > 0} hint="unidades no realizadas sin nueva fecha" link="/alertas" />
    </div>
  );
}

function Tile({ label, value, hint, warn, link }: { label: string; value: string; hint?: string; warn?: boolean; link?: string }) {
  const body = (
    <>
      <div className="label">{label}</div>
      <div className="value" style={{ color: warn ? 'var(--danger)' : undefined }}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </>
  );
  return link ? <Link to={link} className="card stat" style={{ color: 'inherit', textDecoration: 'none' }}>{body}</Link> : <div className="card stat">{body}</div>;
}

/** Dashboard de seguimiento: indicadores del proyecto, curva de avance y brigadas ordenadas por atraso. */
export function TrackingPage() {
  const { project } = useProject();
  const [date, setDate] = useState('');
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['tracking', project?.id, date],
    enabled: !!project,
    queryFn: () => api<ProjectTracking>(`/projects/${project!.id}/tracking${date ? `?date=${date}` : ''}`),
    refetchInterval: 60_000,
  });
  if (!project) return <NoProject />;
  const t = q.data;
  const brigades = [...(t?.brigades ?? [])].sort((a, b) => FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag] || (a.metrics.compliancePct ?? 101) - (b.metrics.compliancePct ?? 101));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Avance de brigadas</h1>
          <p>Calculado con lo sincronizado desde los teléfonos de {project.code}. Se actualiza cada minuto.</p>
        </div>
        <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          Fecha de corte
          <input type="date" className="input" value={date || t?.today || ''} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
        </label>
      </div>
      {q.error && <ErrorBox error={q.error} />}
      {t && (
        <>
          <MetricTiles m={t.metrics} brigades={t.metrics.brigades} />
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div className="section-title">Avance acumulado del proyecto (unidades de muestreo)</div>
            <ProgressChart data={t.curve} today={t.today} />
          </div>
          <div className="card">
            <div className="toolbar"><strong>Brigadas</strong><span className="hint">Primero las que tienen atraso o bajo cumplimiento. Clic para ver el detalle.</span></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Brigada</th><th>Estado</th><th>Avance</th><th>Cumpl. a la fecha</th><th>Estaciones</th>
                    <th>Atrasadas</th><th>Desviación</th><th>Alertas</th><th>Última sincr.</th>
                  </tr>
                </thead>
                <tbody>
                  {brigades.map((b) => <BrigadeRow key={b.id} b={b} onOpen={() => navigate(`/seguimiento/${b.id}`)} />)}
                </tbody>
              </table>
              {!brigades.length && <div className="empty">El proyecto aún no tiene brigadas.</div>}
            </div>
          </div>
        </>
      )}
      {q.isLoading && <div className="card empty">Calculando avance…</div>}
    </>
  );
}

function BrigadeRow({ b, onOpen }: { b: BrigadeTracking; onOpen: () => void }) {
  const m = b.metrics;
  const sync = since(b.lastSyncAt);
  return (
    <tr className="clickable-row" onClick={onOpen} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <td><strong>{b.name}</strong>{b.specialtyName && <small className="hint"> · {b.specialtyName}</small>}</td>
      <td><span className={FLAG_CHIP[b.flag]}>{BRIGADE_FLAG_LABELS[b.flag]}</span></td>
      <td><ProgressBar value={m.progressPct} /></td>
      <td><ProgressBar value={m.compliancePct} tone={m.compliancePct != null && m.compliancePct < 80 ? (m.compliancePct < 50 ? 'danger' : 'warn') : undefined} /></td>
      <td>{m.stationsExecuted}/{m.stationsPlanned}{m.stationsInProgress ? <small className="hint"> · {m.stationsInProgress} en curso</small> : null}</td>
      <td style={{ color: m.stationsLate ? 'var(--danger)' : undefined, fontWeight: m.stationsLate ? 600 : undefined }}>{m.stationsLate}</td>
      <td>{pctText(m.deviationPct)}</td>
      <td>{m.activeAlerts ? <span className="chip chip-off">{m.activeAlerts}</span> : '0'}</td>
      <td style={{ color: sync.stale ? 'var(--warn)' : undefined }}>{sync.text}</td>
    </tr>
  );
}
