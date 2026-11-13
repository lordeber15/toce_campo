import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADMIN_ROLES } from '@toce/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { Dialog, ErrorBox, NoProject } from '../components/Dialog';
import type { Station } from './Stations';

type Brigade = { id: string; name: string; isActive: boolean; specialtyId: string | null; specialtyName: string | null };
type Sched = { id: string; plannedDate: string; originalDate: string; status: string; brigadeId: string; stationId: string; stationCode: string; sortOrder: number };

const TZ = 'America/Lima';
const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
function addDays(isoDate: string, n: number) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(isoDate: string) {
  const d = new Date(isoDate + 'T12:00:00Z');
  return addDays(isoDate, -((d.getUTCDay() + 6) % 7));
}
const dayLabel = (isoDate: string) =>
  new Date(isoDate + 'T12:00:00Z').toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const STATUS_LABEL: Record<string, string> = { planificada: 'Planificada', en_curso: 'En curso', ejecutada: 'Ejecutada', no_realizada: 'No realizada', reprogramada: 'Reprogramada', cancelada: 'Cancelada' };

export function SchedulePage() {
  const { project } = useProject();
  const { can } = useAuth();
  const isAdmin = can(...ADMIN_ROLES);
  const qc = useQueryClient();
  const today = iso(new Date());
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [adding, setAdding] = useState<{ brigade: Brigade; date: string } | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const brigades = useQuery({ queryKey: ['brigades', project?.id], enabled: !!project, queryFn: () => api<Brigade[]>(`/projects/${project!.id}/brigades`) });
  const stations = useQuery({ queryKey: ['stations', project?.id], enabled: !!project, queryFn: () => api<Station[]>(`/projects/${project!.id}/stations`) });
  const scheds = useQuery({
    queryKey: ['schedules', project?.id, weekStart],
    enabled: !!project,
    queryFn: () => api<Sched[]>(`/projects/${project!.id}/schedules?from=${days[0]}&to=${days[6]}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
    onError: (e) => alert(e instanceof Error ? e.message : 'Error'),
  });

  if (!project) return <NoProject />;
  const active = (brigades.data ?? []).filter((b) => b.isActive);
  const cell = (bId: string, d: string) => (scheds.data ?? []).filter((s) => s.brigadeId === bId && s.plannedDate === d).sort((a, b) => a.sortOrder - b.sortOrder);
  const weekTotal = scheds.data?.length ?? 0;

  return (
    <>
      <div className="page-head">
        <div><h1>Cronograma</h1><p>Estaciones programadas por brigada y día. Una brigada puede tener varias estaciones en un día.</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-sm" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semana anterior">←</button>
          <button className="btn btn-sm" onClick={() => setWeekStart(mondayOf(today))}>Hoy</button>
          <button className="btn btn-sm" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Semana siguiente">→</button>
          <input type="date" className="input" style={{ width: 160, height: 30 }} value={weekStart} onChange={(e) => e.target.value && setWeekStart(mondayOf(e.target.value))} aria-label="Ir a la semana" />
        </div>
      </div>
      <p className="hint" style={{ marginTop: -8, marginBottom: 12 }}>Semana del {dayLabel(days[0]!)} al {dayLabel(days[6]!)} · {weekTotal} programaciones</p>
      {!active.length ? <div className="card empty">Primero crea brigadas.</div> : (
        <div className="cal" style={{ gridTemplateColumns: `180px repeat(7, minmax(120px, 1fr))` }}>
          <div className="cal-head" />
          {days.map((d) => <div key={d} className={'cal-head' + (d === today ? ' today' : '')}>{dayLabel(d)}</div>)}
          {active.map((b) => (
            <Row key={b.id}>
              <div className="cal-brig">{b.name}<small>{b.specialtyName ?? 'Mixta'}</small></div>
              {days.map((d) => (
                <div key={d} className="cal-cell">
                  {cell(b.id, d).map((s) => (
                    <span key={s.id} className={'st-chip' + (s.status !== 'planificada' ? ' done' : '')} title={`${STATUS_LABEL[s.status]}${s.originalDate !== s.plannedDate ? ` · original ${s.originalDate}` : ''}`}>
                      {s.stationCode}
                      {isAdmin && s.status === 'planificada' && <button aria-label={`Quitar ${s.stationCode}`} onClick={() => remove.mutate(s.id)}>×</button>}
                    </span>
                  ))}
                  {isAdmin && <button className="cal-add" onClick={() => setAdding({ brigade: b, date: d })} aria-label={`Programar ${b.name} el ${d}`}>+ Estación</button>}
                </div>
              ))}
            </Row>
          ))}
        </div>
      )}
      {adding && (
        <AddDialog
          projectId={project.id}
          brigade={adding.brigade}
          date={adding.date}
          stations={stations.data ?? []}
          already={new Set(cell(adding.brigade.id, adding.date).map((s) => s.stationId))}
          onClose={() => setAdding(null)}
          onSaved={() => { setAdding(null); qc.invalidateQueries({ queryKey: ['schedules'] }); qc.invalidateQueries({ queryKey: ['stations'] }); }}
        />
      )}
    </>
  );
}

/** Fragmento que mantiene la grilla CSS (cada hijo es una celda). */
function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function AddDialog({ projectId, brigade, date, stations, already, onClose, onSaved }: {
  projectId: string; brigade: Brigade; date: string; stations: Station[]; already: Set<string>; onClose: () => void; onSaved: () => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const eligible = stations.filter((s) => s.methods.some((m) => !brigade.specialtyId || m.specialtyId === brigade.specialtyId));
  const others = stations.length - eligible.length;
  const list = eligible.filter((s) => !q || s.code.toLowerCase().includes(q.toLowerCase()));
  const save = useMutation({
    mutationFn: () => api(`/projects/${projectId}/schedules`, { method: 'POST', body: JSON.stringify({ brigadeId: brigade.id, plannedDate: date, stationIds: sel }) }),
    onSuccess: onSaved,
  });
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  return (
    <Dialog
      title={`${brigade.name} · ${dayLabel(date)}`}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!sel.length || save.isPending}>Programar {sel.length || ''}</button></>}
    >
      <ErrorBox error={save.error} />
      <input className="input" placeholder="Buscar estación" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar estación" />
      <p className="hint">
        Estaciones con métodos de {brigade.specialtyName ?? 'cualquier especialidad'}. El orden de selección es el orden de visita.
        {others > 0 && ` ${others} estaciones no tienen métodos de esta especialidad.`}
      </p>
      <div className="pill-list">
        {list.map((s) => {
          const idx = sel.indexOf(s.id);
          return (
            <button key={s.id} type="button" className="pill" aria-pressed={idx >= 0} disabled={already.has(s.id)} onClick={() => toggle(s.id)} title={already.has(s.id) ? 'Ya programada ese día' : s.vegetationUnit ?? ''}>
              {idx >= 0 ? `${idx + 1}. ` : ''}{s.code}
            </button>
          );
        })}
        {!list.length && <span className="hint">No hay estaciones elegibles. Configura métodos en Estaciones.</span>}
      </div>
    </Dialog>
  );
}
