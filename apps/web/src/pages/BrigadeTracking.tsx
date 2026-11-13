import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import {
  BRIGADE_FLAG_LABELS, INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS, STATION_STATUS_LABELS,
  type BrigadeTracking as Brigade, type IncidentStatus, type IncidentType, type MemberTracking, type StationStatus,
} from '@toce/shared';
import { api } from '../lib/api';
import { ErrorBox } from '../components/Dialog';
import { ProgressBar, ProgressChart } from '../components/ProgressChart';
import { FLAG_CHIP, MetricTiles, since } from './Tracking';

type Detail = {
  today: string;
  curve: { date: string; planned: number; done: number | null }[];
  brigade: Brigade;
  alerts: { id: string; type: IncidentType; status: IncidentStatus; description: string; occurredAt: string; reportedBy: string; stationCode: string | null; unitCode: string | null }[];
  reschedules: { id: string; stationCode: string; fromDate: string; toDate: string; reason: string; status: string; approvedByName: string | null; approvedAt: string | null }[];
};

const ROLE: Record<MemberTracking['role'], string> = { jefe: 'Jefe de brigada', miembro: 'Especialista', supervisor: 'Supervisor', logistico: 'Logístico' };
const STATUS_CHIP: Record<StationStatus, string> = {
  pendiente: 'chip', en_curso: 'chip chip-warn', ejecutada: 'chip chip-ok', cerrada_incompleta: 'chip chip-warn', atrasada: 'chip chip-off', sin_unidades: 'chip',
};
const d8 = (d: string) => d.split('-').reverse().join('/');
const when = (iso: string) => new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/** Vista individual de una brigada (5.2): equipo, avance por estación, pendientes, desviaciones, sincronización y alertas. */
export function BrigadeTrackingPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['brigade-tracking', id], queryFn: () => api<Detail>(`/brigades/${id}/tracking`), refetchInterval: 60_000 });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <div className="card empty">Calculando avance…</div>;
  const { brigade: b, curve, today, alerts, reschedules } = q.data;
  const pending = b.stations.filter((s) => s.firstDate <= today && s.done + s.notDone < s.required);

  return (
    <>
      <div className="page-head">
        <div>
          <p><Link to="/seguimiento" className="back-link">← Avance de brigadas</Link></p>
          <h1 style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{b.name} <span className={FLAG_CHIP[b.flag]}>{BRIGADE_FLAG_LABELS[b.flag]}</span></h1>
          <p>
            {[b.specialtyName, b.leaderName && `Jefe: ${b.leaderName}`, b.supervisorName && `Supervisor: ${b.supervisorName}`, b.logisticianName && `Logístico: ${b.logisticianName}`]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      <MetricTiles m={b.metrics} />

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(320px, 1fr)', marginBottom: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <div className="section-title">Avance acumulado de la brigada</div>
          <ProgressChart data={curve} today={today} height={220} />
        </div>
        <div className="card">
          <div className="toolbar"><strong>Equipo y sincronización</strong></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Integrante</th><th>Unidades</th><th>Última sincronización</th></tr></thead>
              <tbody>
                {b.members.map((m) => {
                  const s = since(m.lastSyncAt);
                  const field = m.role === 'jefe' || m.role === 'miembro';
                  return (
                    <tr key={`${m.id}-${m.role}`}>
                      <td>
                        {m.fullName}
                        <small className="hint" style={{ display: 'block' }}>{[ROLE[m.role], m.specialtyCode, m.phone].filter(Boolean).join(' · ')}</small>
                      </td>
                      <td>{field ? m.unitsDone : '—'}</td>
                      <td style={{ color: s.stale && field ? 'var(--warn)' : undefined }}>
                        {s.text}
                        {m.lastDownloadAt && <small className="hint" style={{ display: 'block' }}>Paquete: {since(m.lastDownloadAt).text}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar"><strong>Avance por estación</strong><span className="hint">Unidades completadas por método (los registros abiertos no cuentan para el avance).</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Estación</th><th>Fecha</th><th>Estado</th><th>Avance</th><th>Métodos</th><th>No realizadas</th><th>Fuera de fecha</th><th>Alertas</th></tr></thead>
            <tbody>
              {b.stations.map((s) => (
                <tr key={s.stationId}>
                  <td><strong>{s.code}</strong>{s.influenceArea && <small className="hint"> · {s.influenceArea}</small>}</td>
                  <td>
                    {d8(s.firstDate)}{s.lastDate !== s.firstDate ? ` – ${d8(s.lastDate)}` : ''}
                    {s.rescheduled && <small className="hint" style={{ display: 'block' }}>Original: {d8(s.originalDate)}</small>}
                  </td>
                  <td>
                    <span className={STATUS_CHIP[s.status]}>{STATION_STATUS_LABELS[s.status]}</span>
                    {s.late && s.status !== 'atrasada' && <span className="chip chip-off">Atrasada</span>}
                  </td>
                  <td><ProgressBar value={s.required ? Math.round((s.done / s.required) * 1000) / 10 : null} /><small className="hint" style={{ display: 'block' }}>{s.done}/{s.required} unidades</small></td>
                  <td>
                    <span className="method-chips">
                      {s.methods.map((m) => (
                        <span key={m.methodId} className={`chip${!m.openEnded && m.done >= m.required ? ' chip-ok' : ''}`} title={m.openEnded ? 'Registro abierto' : `${m.done} de ${m.required} completadas`}>
                          {m.code} {m.openEnded ? `${m.done} reg.` : `${m.done}/${m.required}`}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td style={{ color: s.notDone ? 'var(--danger)' : undefined }}>{s.notDone}</td>
                  <td>{s.offDateUnits}{s.rescheduledUnits ? <small className="hint"> · {s.rescheduledUnits} reprog.</small> : null}</td>
                  <td>{s.alerts ? <span className="chip chip-off">{s.alerts}</span> : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!b.stations.length && <div className="empty">La brigada no tiene estaciones programadas.</div>}
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <div className="card">
          <div className="toolbar"><strong>Actividades pendientes</strong><span className="hint">De estaciones con fecha vencida o de hoy</span></div>
          <div className="list">
            {pending.map((s) => (
              <div key={s.stationId} className="list-item" style={{ cursor: 'default' }}>
                <div className="grow">
                  <strong>{s.code}</strong> <span className="hint">· {d8(s.firstDate)}{s.late ? ' · atrasada' : ''}</span>
                  <small>
                    {s.methods.filter((m) => !m.openEnded && m.done + m.notDone < m.required)
                      .map((m) => `${m.code}: faltan ${m.required - m.done - m.notDone}`).join(' · ')}
                  </small>
                </div>
              </div>
            ))}
            {!pending.length && <div className="empty">Sin pendientes a la fecha.</div>}
          </div>
        </div>
        <div className="card">
          <div className="toolbar"><strong>Alertas relacionadas</strong><Link to="/alertas" className="hint" style={{ marginLeft: 'auto' }}>Ir a Alertas →</Link></div>
          <div className="list">
            {alerts.map((a) => (
              <div key={a.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                <div className="grow">
                  <strong>{INCIDENT_TYPE_LABELS[a.type]}</strong> <span className={a.status === 'abierta' ? 'chip chip-off' : a.status === 'en_revision' ? 'chip chip-warn' : 'chip'}>{INCIDENT_STATUS_LABELS[a.status]}</span>
                  <small>{[a.stationCode, a.unitCode].filter(Boolean).join(' · ') || 'General'} · {a.reportedBy} · {when(a.occurredAt)}</small>
                  <small style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.description}</small>
                </div>
              </div>
            ))}
            {!alerts.length && <div className="empty">Sin alertas.</div>}
          </div>
          {reschedules.length > 0 && (
            <>
              <div className="toolbar" style={{ borderTop: '1px solid var(--border)' }}><strong>Reprogramaciones</strong></div>
              <div className="list">
                {reschedules.map((r) => (
                  <div key={r.id} className="list-item" style={{ cursor: 'default' }}>
                    <div className="grow">
                      <strong>{r.stationCode}</strong> {d8(r.fromDate)} → <strong>{d8(r.toDate)}</strong>
                      <small>{r.reason}{r.approvedByName ? ` · aprobó ${r.approvedByName}` : ''}{r.approvedAt ? `, ${when(r.approvedAt)}` : ''}</small>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
