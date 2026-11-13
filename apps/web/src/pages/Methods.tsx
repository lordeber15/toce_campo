import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADMIN_ROLES, type FormField, type FormFieldType, type PhotoSlot } from '@toce/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Dialog, ErrorBox } from '../components/Dialog';

type Specialty = { id: string; code: string; name: string };
type Method = {
  id: string; specialtyId: string; code: string; name: string; description: string | null; instructions: string | null;
  isOpenEnded: boolean; defaultUnitsRequired: number; scheduleStart: string | null; scheduleEnd: string | null; minDurationMin: number | null;
  requirements: string[]; photoSlots: PhotoSlot[]; methodPhotoRequired: boolean; methodPhotoInstructions: string | null;
  formSchema: { fields: FormField[] }; isActive: boolean; stationCount: number;
};

const TYPES: Record<FormFieldType, string> = {
  text: 'Texto', number: 'Número', select: 'Lista', date: 'Fecha', coords: 'Coordenadas', textarea: 'Texto largo', species: 'Especie (catálogo)',
};
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'campo';

export function MethodsPage() {
  const { can } = useAuth();
  const isAdmin = can(...ADMIN_ROLES);
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: () => api<Specialty[]>('/specialties') });
  const [specId, setSpecId] = useState<string | null>(null);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const spec = specId ?? specialties.data?.[0]?.id ?? null;
  const methods = useQuery({
    queryKey: ['methods-admin', spec],
    enabled: !!spec,
    queryFn: () => api<Method[]>(`/methods?specialtyId=${spec}&includeInactive=true`),
  });
  const current = methods.data?.find((m) => m.id === methodId) ?? methods.data?.[0] ?? null;

  return (
    <>
      <div className="page-head">
        <div><h1>Métodos y formularios</h1><p>Lo que ve cada especialista en campo: unidades, fotos requeridas y campos del formulario reducido.</p></div>
        {isAdmin && spec && <button className="btn btn-primary" onClick={() => setCreating(true)}>Nuevo método</button>}
      </div>
      <div className="tabs" role="tablist">
        {(specialties.data ?? []).map((s) => (
          <button key={s.id} role="tab" aria-selected={s.id === spec} onClick={() => { setSpecId(s.id); setMethodId(null); }}>{s.name}</button>
        ))}
      </div>
      <div className="split" style={{ gridTemplateColumns: 'minmax(220px, 300px) 1fr' }}>
        <div className="card list">
          {(methods.data ?? []).map((m) => (
            <button key={m.id} className="list-item" aria-current={m.id === current?.id} onClick={() => setMethodId(m.id)}>
              <div className="grow">
                <strong>{m.code}</strong> {m.name}
                <small>{m.isOpenEnded ? 'Unidades abiertas' : `${m.defaultUnitsRequired} unidades por defecto`} · {m.formSchema.fields.length} campos · {m.stationCount} estaciones</small>
              </div>
              {!m.isActive && <span className="chip chip-off">Inactivo</span>}
            </button>
          ))}
        </div>
        {current ? <MethodEditor key={current.id} method={current} readOnly={!isAdmin} /> : <div className="card empty">Sin métodos.</div>}
      </div>
      {creating && spec && <NewMethodDialog specialtyId={spec} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setMethodId(id); }} />}
    </>
  );
}

function MethodEditor({ method, readOnly }: { method: Method; readOnly: boolean }) {
  const qc = useQueryClient();
  const [m, setM] = useState<Method>(method);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setM(method); setDirty(false); }, [method]);
  const upd = (patch: Partial<Method>) => { setM({ ...m, ...patch }); setDirty(true); setSaved(false); };

  const save = useMutation({
    mutationFn: () =>
      api(`/methods/${m.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: m.name, description: m.description || null, instructions: m.instructions || null, isOpenEnded: m.isOpenEnded,
          defaultUnitsRequired: m.defaultUnitsRequired, scheduleStart: m.scheduleStart || null, scheduleEnd: m.scheduleEnd || null,
          minDurationMin: m.minDurationMin, requirements: m.requirements.filter(Boolean), photoSlots: m.photoSlots,
          methodPhotoRequired: m.methodPhotoRequired, methodPhotoInstructions: m.methodPhotoInstructions || null,
          formSchema: m.formSchema, isActive: m.isActive,
        }),
      }),
    onSuccess: () => { setDirty(false); setSaved(true); qc.invalidateQueries({ queryKey: ['methods-admin'] }); qc.invalidateQueries({ queryKey: ['methods'] }); },
  });

  const fields = m.formSchema.fields;
  const setFields = (fs: FormField[]) => upd({ formSchema: { fields: fs } });
  const updField = (i: number, patch: Partial<FormField>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const fs = [...fields];
    [fs[i], fs[j]] = [fs[j]!, fs[i]!];
    setFields(fs);
  };
  const addField = () => {
    let key = 'campo_nuevo', n = 1;
    while (fields.some((f) => f.key === key)) key = `campo_nuevo_${++n}`;
    setFields([...fields, { key, label: 'Campo nuevo', type: 'text' }]);
  };
  const slots = m.photoSlots;
  const setSlots = (s: PhotoSlot[]) => upd({ photoSlots: s });

  return (
    <fieldset disabled={readOnly} className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16, border: '1px solid var(--border)', margin: 0, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ flex: 1 }}>{m.code} · {m.name}</h2>
        <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={m.isActive} onChange={(e) => upd({ isActive: e.target.checked })} /> Activo</label>
        {!readOnly && <button type="button" className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Guardando…' : 'Guardar cambios'}</button>}
      </div>
      {saved && <div className="ok-text">Cambios guardados. Los especialistas los recibirán en su próxima descarga del paquete de trabajo.</div>}
      <ErrorBox error={save.error} />

      <div className="section-title">General</div>
      <div className="grid-2">
        <div className="field"><label htmlFor="m-name">Nombre</label><input id="m-name" className="input" value={m.name} onChange={(e) => upd({ name: e.target.value })} /></div>
        <div className="field"><label htmlFor="m-units">Unidades por defecto</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input id="m-units" type="number" min={0} className="input" style={{ width: 100 }} disabled={m.isOpenEnded} value={m.defaultUnitsRequired} onChange={(e) => upd({ defaultUnitsRequired: Number(e.target.value) || 0 })} />
            <label className="hint" style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={m.isOpenEnded} onChange={(e) => upd({ isOpenEnded: e.target.checked })} /> Abiertas (se crean en campo, p. ej. RO)</label>
          </div>
        </div>
      </div>
      <div className="grid-3">
        <div className="field"><label htmlFor="m-hs">Horario desde</label><input id="m-hs" type="time" className="input" value={m.scheduleStart?.slice(0, 5) ?? ''} onChange={(e) => upd({ scheduleStart: e.target.value || null })} /></div>
        <div className="field"><label htmlFor="m-he">Horario hasta</label><input id="m-he" type="time" className="input" value={m.scheduleEnd?.slice(0, 5) ?? ''} onChange={(e) => upd({ scheduleEnd: e.target.value || null })} /></div>
        <div className="field"><label htmlFor="m-dur">Duración mínima (min)</label><input id="m-dur" type="number" min={0} className="input" value={m.minDurationMin ?? ''} onChange={(e) => upd({ minDurationMin: e.target.value ? Number(e.target.value) : null })} /></div>
      </div>
      <div className="field"><label htmlFor="m-ins">Instrucciones para el especialista</label><textarea id="m-ins" className="input" value={m.instructions ?? ''} onChange={(e) => upd({ instructions: e.target.value })} /></div>
      <div className="field">
        <label htmlFor="m-req">Requisitos obligatorios (uno por línea)</label>
        <textarea id="m-req" className="input" value={m.requirements.join('\n')} onChange={(e) => upd({ requirements: e.target.value.split('\n') })} />
      </div>

      <div className="section-title">Fotos de la unidad</div>
      <div className="pill-list">
        {slots.map((s, i) => (
          <span key={i} className="st-chip" style={{ padding: '4px 4px 4px 10px' }}>
            <input className="input" style={{ height: 26, width: 120, padding: '0 6px' }} value={s.label} aria-label="Nombre de la foto"
              onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, label: e.target.value, key: slug(e.target.value) } : x)))} />
            {!readOnly && <button type="button" aria-label={`Quitar ${s.label}`} onClick={() => setSlots(slots.filter((_, j) => j !== i))}>×</button>}
          </span>
        ))}
        {!readOnly && <button type="button" className="cal-add" onClick={() => setSlots([...slots, { key: `foto_${slots.length + 1}`, label: `Foto ${slots.length + 1}`, required: true }])}>+ Foto</button>}
        {!slots.length && <span className="hint">Sin fotos obligatorias por unidad.</span>}
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={m.methodPhotoRequired} onChange={(e) => upd({ methodPhotoRequired: e.target.checked })} /> Exigir foto del método (especialista aplicando el método)</label>
      {m.methodPhotoRequired && <textarea className="input" aria-label="Instrucciones de la foto del método" value={m.methodPhotoInstructions ?? ''} onChange={(e) => upd({ methodPhotoInstructions: e.target.value })} />}

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div className="section-title" style={{ flex: 1 }}>Formulario reducido ({fields.length} campos)</div>
        {!readOnly && <button type="button" className="btn btn-sm" onClick={addField}>+ Campo</button>}
      </div>
      <div>
        {fields.map((f, i) => (
          <div key={i} className="field-row">
            <span className="handle">{i + 1}</span>
            <input className="input" value={f.label} aria-label="Etiqueta" onChange={(e) => updField(i, { label: e.target.value })} />
            <select className="input" value={f.type} aria-label="Tipo" onChange={(e) => updField(i, { type: e.target.value as FormFieldType, options: e.target.value === 'select' ? f.options ?? ['Opción 1'] : undefined })}>
              {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="hint" style={{ display: 'flex', gap: 4 }}><input type="checkbox" checked={!!f.required} onChange={(e) => updField(i, { required: e.target.checked })} /> Obligatorio</label>
            <span style={{ display: 'flex', gap: 2 }}>
              <button type="button" className="icon-btn" aria-label="Subir" onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="icon-btn" aria-label="Bajar" onClick={() => move(i, 1)}>↓</button>
            </span>
            <button type="button" className="icon-btn" aria-label={`Eliminar ${f.label}`} onClick={() => setFields(fields.filter((_, j) => j !== i))}>×</button>
            {f.type === 'select' && (
              <div className="opts">
                <input className="input" aria-label={`Opciones de ${f.label}`} value={(f.options ?? []).join(', ')}
                  onChange={(e) => updField(i, { options: e.target.value.split(',').map((x) => x.trimStart()) })}
                  onBlur={(e) => updField(i, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                <span className="hint">Opciones separadas por coma</span>
              </div>
            )}
            {f.auto && <div className="opts hint">Se completa automáticamente en campo.</div>}
          </div>
        ))}
      </div>
      <p className="hint">Los registros ya guardados conservan sus datos aunque quites un campo.</p>
    </fieldset>
  );
}

function NewMethodDialog({ specialtyId, onClose, onCreated }: { specialtyId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () => api<{ id: string }>('/methods', {
      method: 'POST',
      body: JSON.stringify({
        specialtyId, code: code.trim().toUpperCase(), name: name.trim(),
        formSchema: { fields: [{ key: 'fecha', label: 'Fecha', type: 'date', auto: true, required: true }, { key: 'especie', label: 'Especie', type: 'species', required: true }, { key: 'n_individuos', label: 'Número de individuos', type: 'number', required: true }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }] },
      }),
    }),
    onSuccess: (m) => { qc.invalidateQueries({ queryKey: ['methods-admin'] }); qc.invalidateQueries({ queryKey: ['methods'] }); onCreated(m.id); },
  });
  return (
    <Dialog title="Nuevo método" onClose={onClose} onSubmit={() => save.mutate()}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!code || !name || save.isPending}>Crear</button></>}>
      <ErrorBox error={save.error} />
      <div className="grid-2">
        <div className="field"><label htmlFor="nm-code">Código</label><input id="nm-code" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="PC" /></div>
        <div className="field"><label htmlFor="nm-name">Nombre</label><input id="nm-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Puntos de conteo" /></div>
      </div>
      <p className="hint">El código forma parte del código de cada unidad (EM-23-<b>{code || 'PC'}</b>01).</p>
    </Dialog>
  );
}
