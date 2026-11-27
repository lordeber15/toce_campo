import { z } from 'zod';

/** JSONB changes object-key order; compare schema content, not serialization order. */
export function canonicalFormJson(value: unknown): string {
  const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
  return JSON.stringify(canonical(value));
}

/** Declarative comparisons only: never evaluate spreadsheet text as JavaScript. */
const atom = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const formConditionSchema = z.union([
  z.object({ '==': z.tuple([z.object({ var: z.string().regex(/^[a-z0-9_]+$/) }).strict(), atom]) }).strict(),
  z.object({ '!=': z.tuple([z.object({ var: z.string().regex(/^[a-z0-9_]+$/) }).strict(), atom]) }).strict(),
  z.object({ in: z.tuple([z.object({ var: z.string().regex(/^[a-z0-9_]+$/) }).strict(), z.array(atom).max(200)]) }).strict(),
  z.object({ in: z.tuple([atom, z.object({ var: z.string().regex(/^[a-z0-9_]+$/) }).strict()]) }).strict(),
]);
export type FormCondition = z.infer<typeof formConditionSchema>;
export const formFieldSchema = z.object({
  key: z.string().min(1).max(80).regex(/^[a-z0-9_]+$/).refine((s) => !['__proto__', 'constructor', 'prototype'].includes(s)),
  label: z.string().min(1).max(160),
  type: z.enum(['text', 'number', 'select', 'date', 'coords', 'textarea', 'species', 'multiselect', 'species_list', 'relation', 'time']),
  required: z.boolean().optional(), options: z.array(z.string().min(1).max(160)).max(200).optional(),
  optionLabels: z.record(z.string(), z.string().max(200)).optional(), auto: z.boolean().optional(),
  level: z.enum(['estacion_metodo', 'unidad', 'subunidad', 'registro']).optional(),
  group: z.string().max(80).optional(), unit: z.string().max(80).optional(),
  visibleIf: formConditionSchema.optional(), origin: z.string().max(60).optional(),
  min: z.number().optional(), max: z.number().optional(), note: z.string().max(2000).optional(),
}).strict();
export const formSchemaValidator = z.object({
  fields: z.array(formFieldSchema).max(100),
  version: z.literal(2).optional(), revision: z.string().max(100).optional(),
  methodCode: z.string().max(30).optional(), unitLabel: z.string().max(160).optional(),
  groups: z.string().max(300).optional(), note: z.string().max(2000).optional(),
  rules: z.array(z.array(z.string().max(4000)).max(20)).max(200).optional(),
}).strict().superRefine((s, ctx) => {
  const keys = new Set<string>();
  for (const [i, f] of s.fields.entries()) {
    if (keys.has(f.key)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'key'], message: 'Clave repetida' });
    keys.add(f.key);
    if (['select', 'multiselect'].includes(f.type) && (!f.options?.length || new Set(f.options).size !== f.options.length))
      ctx.addIssue({ code: 'custom', path: ['fields', i, 'options'], message: 'Lista vacía o valores repetidos' });
    if (f.min != null && f.max != null && f.min > f.max)
      ctx.addIssue({ code: 'custom', path: ['fields', i], message: 'Mínimo mayor al máximo' });
  }
  for (const [i, f] of s.fields.entries()) {
    const ref = f.visibleIf && conditionVariable(f.visibleIf);
    if (ref && (!keys.has(ref) || ref === f.key)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'visibleIf'], message: 'Condición con referencia inválida' });
    const chain=new Set([f.key]);let cursor=ref;
    while(cursor){if(chain.has(cursor)){ctx.addIssue({code:'custom',path:['fields',i,'visibleIf'],message:'Dependencia circular'});break;}chain.add(cursor);const dependency=s.fields.find((x)=>x.key===cursor)?.visibleIf;cursor=dependency?conditionVariable(dependency):undefined;}
  }
});

export function isFormFieldVisible(field: { visibleIf?: FormCondition }, values: Record<string, unknown>): boolean {
  if (!field.visibleIf) return true;
  const [op, [variable, expected]] = Object.entries(field.visibleIf)[0]!;
  if (op === 'in' && expected && !Array.isArray(expected) && typeof expected === 'object') {
    const selected = values[expected.var];
    return Array.isArray(selected) && selected.includes(variable);
  }
  const actual = values[(variable as {var:string}).var];
  if (actual == null) return false;
  return op === 'in' ? (expected as unknown[]).includes(actual) : op === '==' ? actual === expected : actual !== expected;
}

function conditionVariable(condition: FormCondition): string | undefined {
  const pair = Object.values(condition)[0];
  const variable = pair.find((x: unknown) => x && typeof x === 'object' && !Array.isArray(x) && 'var' in x);
  return variable?.var;
}

export function validateFormValues(fields: z.infer<typeof formFieldSchema>[], values: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (!isFormFieldVisible(f, values)) continue;
    const v = values[f.key];
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) { if (f.required) errors[f.key] = 'Obligatorio'; continue; }
    if (f.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v) || (f.min != null && v < f.min) || (f.max != null && v > f.max))) errors[f.key] = 'Número fuera del rango permitido';
    if (f.type === 'select' && !f.options?.includes(String(v))) errors[f.key] = 'Opción inválida';
    if (f.type === 'multiselect' && (!Array.isArray(v) || v.some((x) => !f.options?.includes(String(x))))) errors[f.key] = 'Opciones inválidas';
    if (f.type === 'time' && (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))) errors[f.key] = 'Usa HH:MM';
    if (f.type === 'date' && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v)) errors[f.key] = 'Usa una fecha válida: AAAA-MM-DD';
    if (f.type === 'coords') {
      const c=v as {lat?:unknown;lng?:unknown};
      if(!c||typeof c.lat!=='number'||typeof c.lng!=='number'||!Number.isFinite(c.lat)||!Number.isFinite(c.lng)||Math.abs(c.lat)>90||Math.abs(c.lng)>180)errors[f.key]='Indica latitud y longitud válidas';
    }
  }
  return errors;
}

/** Hide dependent fields transitively (e.g. Otra superficie after Sin vegetación changes). */
export function visibleFormValues(fields: z.infer<typeof formFieldSchema>[], values: Record<string, unknown>) {
  const result = { ...values };
  for (let pass = 0; pass < fields.length; pass++) {
    let changed = false;
    for (const f of fields) if (f.key in result && !isFormFieldVisible(f, result)) { delete result[f.key]; changed = true; }
    if (!changed) break;
  }
  return result;
}

export function formContexts(schema: z.infer<typeof formSchemaValidator>): { id: string; label: string; values: Record<string, unknown> }[] {
  const fields = schema.fields;
  const point = fields.find((f) => f.level === 'subunidad' && f.origin === 'Calculado' && ['numero_punto','numero_lectura'].includes(f.key));
  if (point) return Array.from({ length: point.max ?? 100 }, (_,i) => ({ id: String(i+1), label: `Lectura ${i+1}`, values: { [point.key]: i+1, ...(fields.some((f) => f.key === 'distancia') ? { distancia: (i+1)*0.5 } : {}) } }));
  const section = fields.find((f) => f.key === 'seccion');
  if (section) return (section.options ?? []).map((o) => ({ id: o, label: section.optionLabels?.[o] ?? o, values: { seccion: o } }));
  const division = fields.find((f) => f.key === 'subdivision'), category = fields.find((f) => f.key === 'categoria');
  if (division && category) return (division.options ?? []).flatMap((d) => (category.options ?? []).map((c) => ({ id: `${d}_${c}`, label: `${d} · ${category.optionLabels?.[c] ?? c}`, values: { subdivision: d, categoria: c } })));
  return [{ id: 'unidad', label: 'Unidad de muestreo', values: {} }];
}

export function formAllowsRecords(values: Record<string, unknown>) {
  return !['resultado','resultado_busqueda','resultado_seccion','resultado_categoria','estado_punto','estado_lectura','hospederos'].some((key) =>
    ['sin_registros','sin_hallazgos','no_realizada','no_evaluado','sin_vegetacion','ausentes'].includes(String(values[key])));
}

export function list20Position(species: unknown, records: { values: Record<string, unknown> }[]): number | undefined {
  if (typeof species !== 'string' || !species.trim()) return undefined;
  const norm = (s: unknown) => String(s ?? '').trim().toLocaleLowerCase();
  const names = [...new Set(records.map((r) => norm(r.values.especie)).filter(Boolean))];
  const index = names.indexOf(norm(species));
  return index < 0 ? names.length + 1 : index + 1;
}

/** Recompute distinct-species positions after edits or deletions, retaining repeated detections. */
export function renumberList20<T extends { values: Record<string, unknown> }>(records: T[]): T[] {
  const seen: T[] = [];
  return records.map((record) => {
    const next = {...record, values:{...record.values, posicion_lista:list20Position(record.values.especie,seen)}};
    seen.push(next);
    return next;
  });
}
