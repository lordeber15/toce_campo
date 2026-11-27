import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { canonicalFormJson, formSchemaValidator, type FormSchema } from '@toce/shared';
import { cellValue, fold, readWorkbook } from './templateImport.js';

export type FormTarget = { id: string; code: string; specialtyCode: string; specialtyName: string; formSchema: FormSchema };
export type FormImportItem = { id: string; code: string; specialty: string; before: FormSchema; after: FormSchema };
export type FormImportPlan = { fingerprint: string; items: FormImportItem[]; errors: string[]; warnings: string[] };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const forbiddenKeys = ['__proto__', 'constructor', 'prototype'];

/** Parse configuration, never evaluation records. No mutations or code execution. */
export async function planFormImport(buffer: Buffer, targets: FormTarget[]): Promise<FormImportPlan> {
  if (buffer.length > 5 * 1024 * 1024) throw new Error('El Excel de formularios supera 5 MB');
  // Bound expansion before ExcelJS reads the archive.
  const zip = await JSZip.loadAsync(buffer);
  if (Object.keys(zip.files).length > 300) throw new Error('El archivo contiene demasiadas entradas ZIP');
  let expanded = 0;
  for (const entry of Object.values(zip.files)) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    expanded += size;
    if (expanded > 30 * 1024 * 1024) throw new Error('El contenido descomprimido supera 30 MB');
  }
  const wb = await readWorkbook(buffer);
  const errors: string[] = [], warnings: string[] = [], items: FormImportItem[] = [];
  function rows(name: string, headers: string[]) {
    const ws = wb.getWorksheet(name);
    if (!ws) { errors.push(`Falta la hoja ${name}`); return []; }
    if (ws.rowCount > 5000) { errors.push(`${name}: demasiadas filas`); return []; }
    const columns = new Map<string, number>();
    ws.getRow(1).eachCell((c, i) => {
      const key = String(cellValue(c.value) ?? '');
      if (columns.has(key)) errors.push(`${name}: cabecera repetida ${key}`);
      columns.set(key, i);
    });
    for (const key of headers) if (!columns.has(key)) errors.push(`${name}: falta la columna ${key}`);
    const result: { row: number; v: Record<string, string> }[] = [];
    for (let i = 2; i <= ws.rowCount; i++) {
      const v: Record<string, string> = {};
      for (const key of headers) {
        const col = columns.get(key);
        const raw = col ? ws.getRow(i).getCell(col).value : null;
        if (raw && typeof raw === 'object' && ('formula' in raw || 'sharedFormula' in raw)) errors.push(`${name}!${i}: no se admiten fórmulas en la configuración`);
        v[key] = String(cellValue(raw) ?? '');
      }
      if (Object.values(v).some(Boolean)) result.push({ row: i, v });
    }
    return result;
  }
  const methods = rows('Metodos', ['Codigo','Especialidad','Metodo','Unidad_formulario','Grupos','Cantidad_campos','Nota']);
  const fields = rows('Campos', ['Codigo_metodo','Orden','Clave','Etiqueta','Tipo','Nivel','Grupo','Lista_id','Unidad_medida','Visible_si','Origen','Obligatorio','Minimo','Maximo','Nota']);
  const options = rows('Opciones', ['Lista_id','Orden','Valor','Etiqueta']);
  const rules = rows('Reglas', ['Id','Ambito','Regla']);
  if (!methods.length) errors.push('No hay métodos para importar');
  if (methods.length > 100 || fields.length > 2000 || options.length > 2000 || rules.length > 200) errors.push('Se excedió el tamaño permitido de la plantilla');
  const lists = new Map<string, { order: number; value: string; label: string }[]>();
  for (const { row, v } of options) {
    const list = lists.get(v.Lista_id!) ?? [];
    if (!v.Lista_id || !v.Valor || !v.Etiqueta || forbiddenKeys.includes(v.Valor)) errors.push(`Opciones!${row}: lista, valor o etiqueta inválidos`);
    if (!Number.isInteger(Number(v.Orden)) || Number(v.Orden) < 1 || list.some((x) => x.order === Number(v.Orden) || x.value === v.Valor)) errors.push(`Opciones!${row}: orden o valor repetido/inválido`);
    list.push({ order: Number(v.Orden), value: v.Valor!, label: v.Etiqueta! });
    lists.set(v.Lista_id!, list);
  }
  const codes = new Set<string>();
  for (const { row, v } of methods) {
    const code = v.Codigo!;
    if (codes.has(code)) { errors.push(`Metodos!${row}: código repetido ${code}; Campos debe identificar un único método`); continue; }
    codes.add(code);
    const matches = targets.filter((t) => t.code === code && [t.specialtyCode,t.specialtyName].some((s) => fold(s) === fold(v.Especialidad!)));
    if (matches.length !== 1) { errors.push(`Metodos!${row}: ${code} / ${v.Especialidad} no identifica exactamente un método activo`); continue; }
    const target = matches[0]!;
    const selected = fields.filter((f) => f.v.Codigo_metodo === code).sort((a,b) => Number(a.v.Orden) - Number(b.v.Orden));
    if (selected.length !== Number(v.Cantidad_campos) || !selected.length) errors.push(`Metodos!${row}: Cantidad_campos no coincide para ${code}`);
    const orders = new Set<number>();
    const parsedFields = selected.map(({ row: n, v: f }) => {
      const order = Number(f.Orden);
      if (!Number.isInteger(order) || order < 1 || orders.has(order)) errors.push(`Campos!${n}: orden inválido/repetido`);
      orders.add(order);
      if (!['Sí','No','Condicional'].includes(f.Obligatorio!)) errors.push(`Campos!${n}: Obligatorio debe ser Sí, No o Condicional`);
      if (!['estacion_metodo','unidad','subunidad','registro'].includes(f.Nivel!)) errors.push(`Campos!${n}: nivel inválido`);
      if (!['Especialista','Compartido','Reutilizado','Calculado','Precargado'].includes(f.Origen!)) errors.push(`Campos!${n}: origen inválido`);
      let condition: unknown;
      if (f.Visible_si) { try { condition = JSON.parse(f.Visible_si); } catch { errors.push(`Campos!${n}: Visible_si no es JSON válido`); } }
      const list = f.Lista_id ? lists.get(f.Lista_id)?.sort((a,b) => a.order-b.order) : undefined;
      if (f.Lista_id && !list) errors.push(`Campos!${n}: lista ${f.Lista_id} inexistente`);
      return {
        key: f.Clave, label: f.Etiqueta, type: f.Tipo, level: f.Nivel, group: f.Grupo,
        origin: f.Origen, required: f.Obligatorio !== 'No', unit: f.Unidad_medida,
        ...(list ? { options: list.map((x) => x.value), optionLabels: Object.fromEntries(list.map((x) => [x.value,x.label])) } : {}),
        ...(condition ? { visibleIf: condition } : {}),
        ...(f.Minimo !== '' ? { min: Number(f.Minimo) } : {}), ...(f.Maximo !== '' ? { max: Number(f.Maximo) } : {}),
        note: f.Nota,
      };
    });
    const parsed = formSchemaValidator.safeParse({
      version: 2, revision: hash(buffer.toString('base64')).slice(0,32), methodCode: code,
      unitLabel: v.Unidad_formulario, groups: v.Grupos, note: v.Nota, fields: parsedFields,
      rules: rules.map((r) => [r.v.Id!, r.v.Ambito!, r.v.Regla!]),
    });
    if (!parsed.success) { for (const e of parsed.error.issues) errors.push(`${code}: ${e.path.join('.')} — ${e.message}`); }
    else items.push({ id: target.id, code, specialty: target.specialtyName, before: target.formSchema, after: parsed.data });
  }
  for (const f of fields) if (!codes.has(f.v.Codigo_metodo!)) errors.push(`Campos!${f.row}: método no declarado ${f.v.Codigo_metodo}`);
  warnings.push('El catálogo de métodos es compartido por los proyectos. Solo se actualizarán los formularios de la lista; se conservarán cantidades, esfuerzo, horarios y métodos excluidos.');
  warnings.push('Instalar la versión móvil compatible antes de activar estos formularios y actualizar el paquete de trabajo de cada dispositivo.');
  return { fingerprint: hash(hash(buffer.toString('base64')) + canonicalFormJson(items.map((i) => [i.id,i.before]))), items, errors, warnings };
}
