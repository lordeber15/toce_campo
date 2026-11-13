import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  EQUIPMENT_STATUS_LABELS, EXPENSE_CATEGORY_LABELS, LOGISTICS_ENTITIES, LOGISTICS_ENTITY_LABELS, SAMPLE_PENDING, SAMPLE_STATUS_LABELS,
  VEHICLE_STATUS_LABELS,
  type EquipmentData, type ExpenseData, type LogisticsData, type LogisticsEntity, type SampleData, type SupportData, type VehicleData,
} from '@toce/shared';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import { ErrorBox, NoProject } from '../components/Dialog';

type FileRef = { id: string; kind: string; uploaded: boolean };
type Rec<E extends LogisticsEntity> = {
  id: string; data: LogisticsData[E]; brigadeName: string | null; registeredByName: string; updatedAt: string; stationCode: string | null; files: FileRef[];
};
type Payload = { [E in LogisticsEntity]: Rec<E>[] };

const money = (n: number) => `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const d8 = (d: string | null | undefined) => (d ? d.split('-').reverse().join('/') : '—');
const list = (xs: string[]) => (xs.length ? xs.join(', ') : '—');

/** Logística registrada en campo por los responsables logísticos (solo lectura). Se actualiza cada minuto. */
export function LogisticsPage() {
  const { project } = useProject();
  const [tab, setTab] = useState<LogisticsEntity>('vehicle');
  const [brigade, setBrigade] = useState('');
  const q = useQuery({
    queryKey: ['logistics', project?.id],
    enabled: !!project,
    queryFn: () => api<Payload>(`/projects/${project!.id}/logistics`),
    refetchInterval: 60_000,
  });
  if (!project) return <NoProject />;
  const data = q.data;
  const by = <E extends LogisticsEntity>(e: E): Rec<E>[] => ((data?.[e] ?? []) as Rec<E>[]).filter((r) => !brigade || r.brigadeName === brigade);
  const brigades = [...new Set(LOGISTICS_ENTITIES.flatMap((e) => (data?.[e] ?? []).map((r) => r.brigadeName)).filter((b): b is string => !!b))].sort();

  const vehicles = by('vehicle');
  const support = by('support');
  const expenses = by('expense');
  const samples = by('sample');
  const equipment = by('equipment');
  const total = expenses.reduce((a, r) => a + r.data.amount, 0);
  const noReceipt = expenses.filter((r) => !r.data.receiptNumber && !r.files.length).length;
  const pending = samples.filter((r) => SAMPLE_PENDING.includes(r.data.status)).length;
  const badEquip = equipment.filter((r) => r.data.status !== 'operativo').length;
  const badVeh = vehicles.filter((r) => r.data.status === 'averiada' || r.data.status === 'accidente').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Logística</h1>
          <p>Movilidad, apoyos locales, viáticos, muestras y equipos registrados en campo para {project.code}. Las incidencias logísticas llegan a Alertas.</p>
        </div>
      </div>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', marginBottom: 16 }}>
        <Stat label="Movilidades" value={`${vehicles.filter((r) => r.data.status === 'llegada').length}/${vehicles.length}`} hint={badVeh ? `${badVeh} con problema` : 'llegaron'} warn={badVeh > 0} />
        <Stat label="Apoyos disponibles" value={`${support.filter((r) => r.data.isAvailable).length}`} hint={`de ${support.length} registrados`} />
        <Stat label="Viáticos" value={money(total)} hint={noReceipt ? `${noReceipt} sin comprobante` : `${expenses.length} gastos`} warn={noReceipt > 0} />
        <Stat label="Muestras por enviar" value={`${pending}`} hint={`${samples.length} registradas`} warn={pending > 0} />
        <Stat label="Equipos con problemas" value={`${badEquip}`} hint={`${equipment.length} registrados`} warn={badEquip > 0} />
      </div>

      <div className="card">
        <div className="toolbar">
          <select className="input" value={brigade} onChange={(e) => setBrigade(e.target.value)} aria-label="Brigada">
            <option value="">Todas las brigadas</option>
            {brigades.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="tabs" role="tablist" style={{ padding: '0 12px', marginBottom: 0 }}>
          {LOGISTICS_ENTITIES.map((e) => (
            <button key={e} role="tab" aria-selected={tab === e} onClick={() => setTab(e)}>
              {LOGISTICS_ENTITY_LABELS[e].many} ({by(e).length})
            </button>
          ))}
        </div>
        {q.error ? <div style={{ padding: 16 }}><ErrorBox error={q.error} /></div> : (
          <div className="table-wrap">
            {tab === 'vehicle' && (
              <Table head={['Brigada', 'Movilidad', 'Placa', 'Conductor', 'Estado', 'Llegada', 'Faltantes', 'Defectuosos', 'Fotos']} empty={!vehicles.length}>
                {vehicles.map((r) => {
                  const v: VehicleData = r.data;
                  return (
                    <tr key={r.id}>
                      <td>{r.brigadeName}</td><td>{v.description}</td><td>{v.plate ?? '—'}</td>
                      <td>{[v.driverName, v.driverPhone].filter(Boolean).join(' · ') || '—'}</td>
                      <td><span className={v.status === 'averiada' || v.status === 'accidente' ? 'chip chip-off' : v.status === 'llegada' ? 'chip chip-ok' : 'chip'}>{VEHICLE_STATUS_LABELS[v.status]}</span></td>
                      <td>{dt(v.arrivedAt)}</td><td className="wrap">{list(v.missingMaterials)}</td><td className="wrap">{list(v.defectiveMaterials)}</td>
                      <td><Files files={r.files} /></td>
                    </tr>
                  );
                })}
              </Table>
            )}
            {tab === 'support' && (
              <Table head={['Brigada', 'Nombre', 'DNI', 'Comunidad', 'EPP entregado', 'Documentos', 'Disponible', 'Fotos']} empty={!support.length}>
                {support.map((r) => {
                  const v: SupportData = r.data;
                  return (
                    <tr key={r.id}>
                      <td>{r.brigadeName}</td><td>{v.fullName}{v.phone ? <small className="hint"> · {v.phone}</small> : null}</td><td>{v.dni || '—'}</td>
                      <td>{v.community ?? '—'}</td>
                      <td className="wrap">{v.eppItems.length ? list(v.eppItems) : <span className="chip chip-warn">Sin EPP</span>}</td>
                      <td className="wrap">{list(v.documentsDelivered)}</td>
                      <td>
                        <span className={v.isAvailable ? 'chip chip-ok' : 'chip'}>{v.isAvailable ? 'Sí' : 'No'}</span>
                        {(v.availableFrom || v.availableTo) && <small className="hint"> {d8(v.availableFrom)} – {d8(v.availableTo)}</small>}
                      </td>
                      <td><Files files={r.files} /></td>
                    </tr>
                  );
                })}
              </Table>
            )}
            {tab === 'expense' && (
              <Table
                head={['Fecha', 'Brigada', 'Tipo', 'Detalle', 'Proveedor', 'Comprobante', 'Monto']}
                empty={!expenses.length}
                foot={expenses.length ? <tr><td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>Total</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(total)}</td></tr> : null}
              >
                {expenses.map((r) => {
                  const v: ExpenseData = r.data;
                  return (
                    <tr key={r.id}>
                      <td>{d8(v.expenseDate)}</td><td>{r.brigadeName}</td><td>{EXPENSE_CATEGORY_LABELS[v.category]}</td>
                      <td className="wrap">{v.description}</td><td>{v.vendor ?? '—'}</td>
                      <td>
                        {v.receiptNumber ?? ''} <Files files={r.files} />
                        {!v.receiptNumber && !r.files.length && <span className="chip chip-warn">Sin comprobante</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(v.amount)}</td>
                    </tr>
                  );
                })}
              </Table>
            )}
            {tab === 'sample' && (
              <Table head={['Código', 'Brigada', 'Estación', 'Cant.', 'Estado', 'Destino', 'Transporte / guía', 'Enviada']} empty={!samples.length}>
                {samples.map((r) => {
                  const v: SampleData = r.data;
                  return (
                    <tr key={r.id}>
                      <td><strong>{v.code}</strong>{v.description ? <small className="hint"> · {v.description}</small> : null}</td>
                      <td>{r.brigadeName}</td><td>{r.stationCode ?? '—'}</td><td>{v.quantity}</td>
                      <td><span className={v.status === 'perdida' ? 'chip chip-off' : SAMPLE_PENDING.includes(v.status) ? 'chip chip-warn' : 'chip chip-ok'}>{SAMPLE_STATUS_LABELS[v.status]}</span></td>
                      <td>{v.destination ?? '—'}</td><td>{[v.carrier, v.trackingCode].filter(Boolean).join(' · ') || '—'}</td><td>{dt(v.shippedAt)}</td>
                    </tr>
                  );
                })}
              </Table>
            )}
            {tab === 'equipment' && (
              <Table head={['Brigada', 'Equipo', 'Serie', 'Cant.', 'Estado', 'Observaciones', 'Fotos']} empty={!equipment.length}>
                {equipment.map((r) => {
                  const v: EquipmentData = r.data;
                  return (
                    <tr key={r.id}>
                      <td>{r.brigadeName}</td><td>{v.name}</td><td>{v.serial ?? '—'}</td><td>{v.quantity}</td>
                      <td><span className={v.status === 'operativo' ? 'chip chip-ok' : v.status === 'en_reparacion' ? 'chip chip-warn' : 'chip chip-off'}>{EQUIPMENT_STATUS_LABELS[v.status]}</span></td>
                      <td className="wrap">{v.notes ?? '—'}</td><td><Files files={r.files} /></td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="hint" style={{ color: warn ? 'var(--warn)' : undefined }}>{hint}</div>
    </div>
  );
}

function Table({ head, children, empty, foot }: { head: string[]; children: ReactNode; empty: boolean; foot?: ReactNode }) {
  if (empty) return <div className="empty">Aún no hay registros.</div>;
  return (
    <table>
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
      {foot && <tfoot>{foot}</tfoot>}
    </table>
  );
}

/** Miniaturas de fotos y comprobantes (enlace a la foto completa). */
function Files({ files }: { files: FileRef[] }) {
  if (!files.length) return <span className="hint">—</span>;
  return <span style={{ display: 'inline-flex', gap: 4, verticalAlign: 'middle' }}>{files.map((f) => <Thumb key={f.id} file={f} />)}</span>;
}

function Thumb({ file }: { file: FileRef }) {
  const url = useQuery({
    queryKey: ['file-url', file.id],
    enabled: file.uploaded,
    queryFn: () => api<{ url: string }>(`/field/attachments/${file.id}/url`),
    staleTime: 10 * 60_000,
  });
  if (!file.uploaded) return <span className="chip" title="La foto se sube cuando el teléfono tenga conexión">En el teléfono</span>;
  if (!url.data) return <span style={{ display: 'inline-block', width: 40, height: 40, borderRadius: 6, background: 'var(--surface-2)' }} />;
  return (
    <a href={url.data.url} target="_blank" rel="noreferrer" title={file.kind === 'comprobante' ? 'Ver comprobante' : 'Ver foto'}>
      <img src={url.data.url} alt={file.kind === 'comprobante' ? 'Comprobante' : 'Foto'} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }} />
    </a>
  );
}
