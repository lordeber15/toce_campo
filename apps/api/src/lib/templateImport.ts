import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  TEMPLATE_SHEETS, distanceMeters, utmToLatLng,
  type ActivityType, type BrigadeRegion, type InfluenceArea, type MethodClass, type Role,
  type TemplateCount, type TemplateIssue, type TemplateSummary,
} from '@toce/shared';

/**
 * Carga masiva por plantilla (lectura y validación, sin base de datos).
 * 1) readWorkbook: abre el .xlsx (también los escritos por OpenXML SDK con prefijos de namespace).
 * 2) parseTemplate: toma las filas de cada hoja por nombre de columna.
 * 3) validateTemplate: valida contra el contexto de la base (usuarios, códigos existentes) y arma el plan a guardar.
 */

// ───────────────────────────── Lectura del archivo ─────────────────────────────

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/**
 * Reescribe un .xlsx para que exceljs lo entienda: quita el prefijo del namespace principal (`<x:sheet>` -> `<sheet>`),
 * convierte destinos absolutos de relaciones (`/xl/styles.xml`) en relativos y descarta comentarios/dibujos VML
 * (exceljs falla con nombres de partes no estándar y no los necesitamos).
 */
export async function normalizeXlsx(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name]!.dir || !/\.(xml|rels)$/i.test(name)) continue;
    let s = (await zip.file(name)!.async('string')).replace(/^﻿/, '');
    if (name.endsWith('.rels')) {
      const base = '/' + name.replace(/_rels\/[^/]+$/, '');
      s = s.replace(/Target="\/([^"]+)"/g, (_, t: string) => `Target="${path.posix.relative(base, '/' + t)}"`);
      s = s.replace(/<Relationship\b[^>]*Type="[^"]*\/(comments|vmlDrawing)"[^>]*\/>/g, '');
    }
    const m = s.match(new RegExp(`xmlns:(\\w+)="${MAIN_NS.replace(/[./]/g, '\\$&')}"`));
    if (m) {
      const p = m[1]!;
      s = s.replace(new RegExp(`<(/?)${p}:`, 'g'), '<$1').replace(`xmlns:${p}="${MAIN_NS}"`, `xmlns="${MAIN_NS}"`);
    }
    s = s.replace(/<(\w+:)?legacyDrawing\b[^>]*\/>/g, '');
    zip.file(name, s);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Abre el libro; si exceljs no puede (archivos de OpenXML SDK), lo normaliza y reintenta. */
export async function readWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const load = async (b: Buffer) => {
    const wb = new ExcelJS.Workbook();
    // exceljs tipa el buffer de forma distinta según la versión de @types/node.
    await wb.xlsx.load(b as unknown as ArrayBuffer);
    return wb;
  };
  try {
    return await load(buf);
  } catch {
    try {
      return await load(await normalizeXlsx(buf));
    } catch (e) {
      throw new Error(`No se pudo leer el Excel: ${(e as Error).message}`);
    }
  }
}

// ───────────────────────────── Utilidades ─────────────────────────────

export type Cell = string | number | boolean | Date | null;

/** Valor simple de una celda (fórmulas: el valor calculado guardado; texto enriquecido: el texto). */
export function cellValue(v: ExcelJS.CellValue | undefined): Cell {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v || 'formula' in v || 'sharedFormula' in v) return cellValue((v as { result?: ExcelJS.CellValue }).result);
    if ('richText' in v) return cellValue(v.richText.map((t) => t.text).join(''));
    if ('text' in v) return cellValue((v as { text: ExcelJS.CellValue }).text);
    if ('error' in v) return null;
  }
  return null;
}

/** Minúsculas sin tildes ni espacios extra (para comparar nombres). */
export const fold = (v: string) =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

const str = (c: Cell): string | null => {
  if (c == null) return null;
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  const s = String(c).trim();
  return s === '' ? null : s;
};

const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos', 'di', 'van', 'von', 'el']);

/** "RICARDO PEREZ DE LA CRUZ" -> "Ricardo Perez de la Cruz". Solo si el nombre está todo en mayúsculas. */
export function properCaseName(name: string): string | null {
  if (!/\p{L}/u.test(name) || name !== name.toUpperCase() || name === name.toLowerCase()) return null;
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && PARTICLES.has(w) ? w : w.replace(/(^|[-'])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())))
    .join(' ');
}

/** Fecha AAAA-MM-DD desde Date, número de serie de Excel o texto (AAAA-MM-DD o DD/MM/AAAA). */
export function parseDate(c: Cell): string | null | undefined {
  if (c == null) return null;
  const ymd = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1990 || y > 2100) return undefined;
    return dt.toISOString().slice(0, 10);
  };
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return undefined;
    // exceljs entrega las fechas como medianoche UTC; si trae hora local, se redondea al día más cercano.
    const r = new Date(c.getTime() + 12 * 3600 * 1000);
    return c.getUTCHours() === 0 ? c.toISOString().slice(0, 10) : r.toISOString().slice(0, 10);
  }
  if (typeof c === 'number') {
    if (c < 30000 || c > 80000) return undefined;
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86400000);
    return dt.toISOString().slice(0, 10);
  }
  const s = String(c).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return ymd(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return ymd(+m[3]!, +m[2]!, +m[1]!);
  return undefined;
}

/** Sí / No. null = vacío; undefined = valor no válido. */
export function parseYesNo(c: Cell): boolean | null | undefined {
  if (c == null) return null;
  if (typeof c === 'boolean') return c;
  const s = fold(String(c));
  if (['si', 's', 'yes', 'x', 'true', '1'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return undefined;
}

/** Número (acepta coma decimal). null = vacío; undefined = no numérico. */
export function parseNumber(c: Cell): number | null | undefined {
  if (c == null) return null;
  if (typeof c === 'number') return Number.isFinite(c) ? c : undefined;
  if (typeof c !== 'string') return undefined;
  const s = c.replace(/\s/g, '').replace(/,(\d+)$/, '.$1');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  return Number(s);
}

/** "17 S" -> { zone: 17, hemisphere: 'S' }. Perú: zonas 17, 18 y 19 sur. */
export function parseZone(c: Cell): { zone: number; hemisphere: 'S' } | null | undefined {
  if (c == null) return null;
  const m = /^\s*(\d{2})\s*([SL])?\s*$/i.exec(String(c));
  if (!m) return undefined;
  const zone = Number(m[1]);
  if (![17, 18, 19].includes(zone)) return undefined;
  return { zone, hemisphere: 'S' };
}

/** DNI de una referencia "45107669 · Nombre" (o solo el DNI). */
export function parsePersonRef(c: Cell): { dni: string; name: string | null } | null {
  const s = str(typeof c === 'number' ? String(c).padStart(8, '0') : c);
  if (!s) return null;
  const m = /^\s*([0-9]{6,12})\s*(?:[·•|\-–—]\s*(.*))?$/.exec(s);
  if (!m) return { dni: s.split(/[·•]/)[0]!.trim(), name: null };
  return { dni: m[1]!, name: m[2]?.trim() || null };
}

/** Código de especialidad generado: "Flora y vegetación" -> "FLORA-Y-VEGETACION" (máx. 30). */
export function specialtyCode(name: string, taken: Set<string>): string {
  const base = fold(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'ESP';
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base.slice(0, 27)}-${i}`;
  taken.add(code);
  return code;
}

/** Primer rango "06:00–10:00" de un horario en texto (para schedule_start / schedule_end). */
export function parseScheduleRange(text: string | null): { start: string; end: string } | null {
  if (!text) return null;
  const m = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/.exec(text);
  if (!m) return null;
  const hh = (h: string, mm: string) => (+h <= 24 && +mm < 60 ? `${String(+h % 24).padStart(2, '0')}:${mm}` : null);
  const start = hh(m[1]!, m[2]!);
  const end = hh(m[3]!, m[4]!);
  return start && end ? { start, end } : null;
}

// ───────────────────────────── Reglas de acceso por especialidad ─────────────────────────────

const BOTANY = ['Flora y vegetación', 'Recursos forestales', 'Epífitas', 'Agrostología', 'Bofedales'];
const MAMMALS = ['Mamíferos menores terrestres', 'Mamíferos menores voladores', 'Mamíferos mayores', 'Fauna transversal'];

/**
 * Accesos por defecto (hoja 0, reglas de acceso): especialidad -> otras que también ve.
 * Se cargan al importar solo para especialidades que aún no tienen accesos configurados.
 */
export const DEFAULT_ACCESS: Record<string, string[]> = {
  'Flora y vegetación': BOTANY,
  'Recursos forestales': BOTANY,
  'Epífitas': BOTANY,
  'Mixta': BOTANY,
  'Mamíferos': MAMMALS,
  'Aves': ['Fauna transversal'],
  'Anfibios y reptiles': ['Fauna transversal'],
  'Artrópodos': ['Fauna transversal'],
  'Mamíferos menores terrestres': ['Fauna transversal'],
  'Mamíferos menores voladores': ['Fauna transversal'],
  'Mamíferos mayores': ['Fauna transversal'],
};

/** Especialidad que en brigadas significa "todas" (se guarda como brigada sin especialidad). */
export const MIXED_SPECIALTY = 'Mixta';

// ───────────────────────────── Hojas y columnas ─────────────────────────────

type Row = { row: number; get: (col: string) => Cell };
export type Sheet = { name: string; found: boolean; rows: Row[]; missingColumns: string[] };

const COLUMNS = {
  project: ['Código', 'Nombre', 'Cliente', 'Fecha inicio', 'Fecha fin', 'Zona UTM principal', 'Descripción'],
  users: ['DNI', 'Nombre completo', 'Correo', 'Teléfono', 'Especialidad', 'Especialista', 'Jefe de brigada', 'Supervisor', 'Logístico', 'Coordinador', 'Jefe de proyecto'],
  lists: ['Especialidades', 'Clases', 'Actividad', 'Región', 'AID/AII'],
  brigades: ['Código', 'Nombre', 'Proyecto', 'Región', 'Especialidad', 'Jefe de brigada', 'Supervisor', 'Logístico', 'Observaciones'],
  members: ['Brigada', 'Especialista', 'Desde', 'Hasta'],
  stations: ['Código', 'Proyecto', 'Zona UTM', 'Este', 'Norte', 'Altitud', 'AID/AII', 'Unidad de vegetación', 'ZA/EF', 'Nombre', 'Indicaciones de acceso'],
  methods: ['Código', 'Nombre', 'Especialidad', 'Unidades por defecto', 'Fotos por unidad', 'Clase', 'Track', 'Horario', 'Condición de aplicación'],
  stationMethods: ['Estación', 'Método', 'Brigada', 'Unidades requeridas', 'Observación'],
  schedule: ['Fecha', 'Brigada', 'Tipo de actividad', 'Estación', 'Detalle operativo'],
} as const satisfies Record<keyof typeof TEMPLATE_SHEETS, readonly string[]>;

/** Columnas sin las que la hoja no se puede leer. */
const REQUIRED_COLUMNS: Partial<Record<keyof typeof TEMPLATE_SHEETS, string[]>> = {
  project: ['Código', 'Nombre', 'Fecha inicio', 'Fecha fin'],
  users: ['DNI', 'Nombre completo'],
  brigades: ['Código', 'Nombre', 'Proyecto', 'Especialidad', 'Jefe de brigada'],
  members: ['Brigada', 'Especialista'],
  stations: ['Código', 'Proyecto', 'Zona UTM', 'Este', 'Norte', 'AID/AII'],
  methods: ['Código', 'Nombre', 'Especialidad', 'Clase', 'Track'],
  stationMethods: ['Estación', 'Método', 'Brigada'],
  schedule: ['Fecha', 'Brigada', 'Tipo de actividad'],
};

function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  const want = fold(name);
  const prefix = /^(\d+)\./.exec(name)?.[1];
  return (
    wb.worksheets.find((w) => fold(w.name) === want) ??
    (prefix ? wb.worksheets.find((w) => new RegExp(`^${prefix}\\.`).test(w.name.trim())) : undefined)
  );
}

function readSheet(wb: ExcelJS.Workbook, key: keyof typeof TEMPLATE_SHEETS): Sheet {
  const name = TEMPLATE_SHEETS[key];
  const ws = findSheet(wb, name);
  if (!ws) return { name, found: false, rows: [], missingColumns: [] };
  const header = ws.getRow(1);
  const heads: { col: number; text: string }[] = [];
  header.eachCell({ includeEmpty: false }, (cell, col) => {
    const t = str(cellValue(cell.value));
    if (t) heads.push({ col, text: fold(t) });
  });
  const colIndex = new Map<string, number>();
  for (const c of COLUMNS[key]) {
    const f = fold(c);
    const hit = heads.find((h) => h.text === f) ?? heads.find((h) => h.text.startsWith(f));
    if (hit) colIndex.set(c, hit.col);
  }
  const missingColumns = (REQUIRED_COLUMNS[key] ?? []).filter((c) => !colIndex.has(c));
  const rows: Row[] = [];
  const last = ws.actualRowCount ? ws.rowCount : 0;
  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r);
    const get = (col: string) => {
      const i = colIndex.get(col);
      return i ? cellValue(row.getCell(i).value) : null;
    };
    if ((COLUMNS[key] as readonly string[]).every((c) => get(c) == null)) continue;
    rows.push({ row: r, get });
  }
  return { name: ws.name, found: true, rows, missingColumns };
}

export type ParsedTemplate = { [K in keyof typeof TEMPLATE_SHEETS]: Sheet };

export function parseTemplate(wb: ExcelJS.Workbook): ParsedTemplate {
  return Object.fromEntries(Object.keys(TEMPLATE_SHEETS).map((k) => [k, readSheet(wb, k as keyof typeof TEMPLATE_SHEETS)])) as ParsedTemplate;
}

/** Código de proyecto de la plantilla (para cargar el contexto antes de validar). */
export const templateProjectCode = (p: ParsedTemplate) => str(p.project.rows[0]?.get('Código') ?? null);

// ───────────────────────────── Plan (datos normalizados) ─────────────────────────────

export type PlanProject = { code: string; name: string; client: string | null; startDate: string; endDate: string; utmZone: number | null; description: string | null };
export type PlanUser = { row: number; dni: string; fullName: string; email: string | null; phone: string | null; specialty: string | null; roles: Role[] };
export type PlanBrigade = {
  row: number; code: string; name: string; region: BrigadeRegion | null; specialty: string | null;
  leaderDni: string; supervisorDni: string | null; logisticianDni: string | null; notes: string | null;
};
export type PlanMember = { row: number; brigadeCode: string; dni: string; validFrom: string | null; validTo: string | null };
export type PlanStation = {
  row: number; code: string; name: string | null; zone: number; easting: number; northing: number; lat: number; lng: number;
  altitude: number | null; influenceArea: InfluenceArea; vegetationUnit: string | null; overlap: string | null; accessNotes: string | null;
};
export type PlanMethod = {
  row: number; code: string; name: string; specialty: string; defaultUnits: number | null; photosPerUnit: number | null;
  methodClass: MethodClass; requiresTrack: boolean; scheduleText: string | null; scheduleStart: string | null; scheduleEnd: string | null;
  guideline: string | null; isOpenEnded: boolean;
};
export type PlanStationMethod = { row: number; stationCode: string; methodCode: string; brigadeCode: string; unitsRequired: number; notes: string | null };
export type PlanSchedule = { row: number; date: string; brigadeCode: string; activityType: ActivityType; stationCode: string | null; detail: string | null; sortOrder: number };

export type Plan = {
  project: PlanProject;
  /** Nombres de especialidad a asegurar (hoja Listas + las usadas). */
  specialties: string[];
  users: PlanUser[];
  brigades: PlanBrigade[];
  members: PlanMember[];
  stations: PlanStation[];
  methods: PlanMethod[];
  stationMethods: PlanStationMethod[];
  schedules: PlanSchedule[];
};

/** Lo que ya existe en la base (lo arma la ruta antes de validar). */
export type TemplateContext = {
  /** Usuarios existentes por DNI. */
  users: Map<string, { fullName: string; roles: Role[]; specialty: string | null }>;
  project: { id: string; code: string } | null;
  /** Nombres de especialidades existentes. */
  specialties: string[];
  /** Accesos existentes: nombre de especialidad -> nombres que ve. */
  access: Map<string, string[]>;
  /** Claves existentes (en mayúsculas o plegadas, según la función key*). */
  brigadeCodes: Set<string>;
  stationCodes: Set<string>;
  methodKeys: Set<string>;
  memberKeys: Set<string>;
  stationMethodKeys: Set<string>;
  scheduleKeys: Set<string>;
  /** Usuarios activos con rol coordinador en la base. */
  coordinators: number;
};

export const emptyContext = (): TemplateContext => ({
  users: new Map(), project: null, specialties: [], access: new Map(), brigadeCodes: new Set(), stationCodes: new Set(),
  methodKeys: new Set(), memberKeys: new Set(), stationMethodKeys: new Set(), scheduleKeys: new Set(), coordinators: 0,
});

export const keyMethod = (specialty: string, code: string) => `${fold(specialty)}|${code.toUpperCase()}`;
export const keyMember = (brigadeCode: string, dni: string) => `${brigadeCode.toUpperCase()}|${dni}`;
export const keyStationMethod = (stationCode: string, specialty: string, methodCode: string) => `${stationCode.toUpperCase()}|${keyMethod(specialty, methodCode)}`;
export const keySchedule = (s: { brigadeCode: string; date: string; activityType: ActivityType; stationCode: string | null; detail: string | null }) =>
  s.activityType === 'estacion'
    ? `${s.brigadeCode.toUpperCase()}|${s.date}|estacion|${(s.stationCode ?? '').toUpperCase()}`
    : `${s.brigadeCode.toUpperCase()}|${s.date}|${s.activityType}|${fold(s.detail ?? '')}`;

export type ValidationOutput = {
  ok: boolean;
  errors: TemplateIssue[];
  warnings: TemplateIssue[];
  summary: TemplateSummary;
  plan: Plan | null;
};

const AREA_VALUES: Record<string, InfluenceArea> = { aid: 'AID', aii: 'AII', huella: 'Huella', fuera: 'fuera' };
const CLASS_VALUES: Record<string, MethodClass> = { todas: 'todas', condicional: 'condicional', evento: 'evento', atributo: 'atributo', transversal: 'transversal' };
const ACTIVITY_VALUES: Record<string, ActivityType> = {
  estacion: 'estacion', movilizacion: 'movilizacion', desmovilizacion: 'desmovilizacion', descanso: 'descanso', otro: 'otro',
};
const REGION_VALUES: Record<string, BrigadeRegion> = { costa: 'COSTA', sierra: 'SIERRA', selva: 'SELVA' };
const ROLE_COLUMNS: [string, Role][] = [
  ['Especialista', 'especialista'], ['Jefe de brigada', 'jefe_brigada'], ['Supervisor', 'supervisor'],
  ['Logístico', 'logistico'], ['Coordinador', 'coordinador'], ['Jefe de proyecto', 'jefe_proyecto'],
];
const NONE = new Set(['—', '–', '-', 'ninguna', 'ninguno', 'n/a', 'na', 'sin superposicion']);

// ───────────────────────────── Validación ─────────────────────────────

export function validateTemplate(p: ParsedTemplate, ctx: TemplateContext): ValidationOutput {
  const errors: TemplateIssue[] = [];
  const warnings: TemplateIssue[] = [];
  const err = (sheet: string, row: number | null, column: string | null, message: string) => errors.push({ sheet, row, column, message });
  const warn = (sheet: string, row: number | null, column: string | null, message: string) => warnings.push({ sheet, row, column, message });

  for (const s of Object.values(p)) {
    if (!s.found) {
      if (s.name !== TEMPLATE_SHEETS.lists) err(s.name, null, null, `Falta la hoja "${s.name}"`);
      continue;
    }
    for (const c of s.missingColumns) err(s.name, 1, c, `Falta la columna "${c}"`);
  }

  /** Texto obligatorio. */
  const req = (s: Sheet, r: Row, col: string) => {
    const v = str(r.get(col));
    if (v == null) err(s.name, r.row, col, `${col} es obligatorio`);
    return v;
  };

  // ── 1. Proyecto
  const PS = p.project;
  let project: PlanProject | null = null;
  if (PS.found) {
    if (PS.rows.length === 0) err(PS.name, 2, null, 'Falta la fila del proyecto');
    if (PS.rows.length > 1) err(PS.name, PS.rows[1]!.row, null, 'Solo se admite un proyecto por plantilla');
    const r = PS.rows[0];
    if (r) {
      const code = req(PS, r, 'Código');
      const name = req(PS, r, 'Nombre');
      const startDate = parseDate(r.get('Fecha inicio'));
      const endDate = parseDate(r.get('Fecha fin'));
      if (startDate == null) err(PS.name, r.row, 'Fecha inicio', startDate === null ? 'Fecha inicio es obligatoria' : 'Fecha inicio no es una fecha válida');
      if (endDate == null) err(PS.name, r.row, 'Fecha fin', endDate === null ? 'Fecha fin es obligatoria' : 'Fecha fin no es una fecha válida');
      if (startDate && endDate && startDate > endDate) err(PS.name, r.row, 'Fecha fin', 'Fecha inicio es posterior a Fecha fin');
      const zoneText = str(r.get('Zona UTM principal'));
      let utmZone: number | null = null;
      if (zoneText) {
        const z = /(\d{2})/.exec(zoneText);
        if (!z || ![17, 18, 19].includes(Number(z[1]))) err(PS.name, r.row, 'Zona UTM principal', `Zona UTM no válida: "${zoneText}" (17 S, 18 S o 19 S)`);
        else utmZone = Number(z[1]);
      }
      if (code && code.length > 40) err(PS.name, r.row, 'Código', 'Código de proyecto demasiado largo (máx. 40)');
      if (code && name && startDate && endDate) {
        project = { code: code.toUpperCase(), name, client: str(r.get('Cliente')), startDate, endDate, utmZone, description: str(r.get('Descripción')) };
      }
    }
  }
  const projectMatches = (v: string | null) => !!v && !!project && fold(v) === fold(project.code);

  // ── Listas: especialidades
  const listSpecialties = p.lists.rows.map((r) => str(r.get('Especialidades'))).filter((x): x is string => !!x);
  const specialtyNames = new Map<string, string>(); // plegado -> nombre
  for (const n of [...ctx.specialties, ...listSpecialties]) if (!specialtyNames.has(fold(n))) specialtyNames.set(fold(n), n);
  const knownInLists = new Set([...ctx.specialties, ...listSpecialties].map(fold));
  const usedSpecialties = new Set<string>();
  /** Nombre canónico de una especialidad; las desconocidas se crearán (advertencia, una vez). */
  const warnedSpecialty = new Set<string>();
  const specialty = (sheet: string, row: number, col: string, v: string) => {
    const f = fold(v);
    if (!specialtyNames.has(f)) specialtyNames.set(f, v.trim());
    if (!knownInLists.has(f) && !warnedSpecialty.has(f)) {
      warnedSpecialty.add(f);
      warn(sheet, row, col, `La especialidad "${v}" no está en la hoja Listas ni en el sistema: se creará`);
    }
    const name = specialtyNames.get(f)!;
    usedSpecialties.add(name);
    return name;
  };

  // ── 2. Usuarios
  const US = p.users;
  const users = new Map<string, PlanUser>();
  for (const r of US.rows) {
    const rawDni = r.get('DNI');
    let dni = str(rawDni);
    if (typeof rawDni === 'number' && dni && dni.length < 8) dni = dni.padStart(8, '0');
    let fullName = req(US, r, 'Nombre completo');
    if (dni == null) {
      err(US.name, r.row, 'DNI', 'DNI es obligatorio');
      continue;
    }
    if (!/^\d{8}$/.test(dni)) err(US.name, r.row, 'DNI', `DNI "${dni}" no tiene 8 dígitos`);
    if (users.has(dni)) err(US.name, r.row, 'DNI', `DNI ${dni} duplicado (fila ${users.get(dni)!.row})`);
    if (fullName) {
      const fixed = properCaseName(fullName);
      if (fixed) {
        warn(US.name, r.row, 'Nombre completo', `Nombre en mayúsculas: se guardará como "${fixed}"`);
        fullName = fixed;
      }
    }
    const roles: Role[] = [];
    for (const [col, role] of ROLE_COLUMNS) {
      const yn = parseYesNo(r.get(col));
      if (yn === undefined) err(US.name, r.row, col, `Valor no válido en ${col}: "${str(r.get(col))}" (Sí / No)`);
      if (yn) roles.push(role);
    }
    if (!roles.length) err(US.name, r.row, null, 'El usuario no tiene ningún rol (marca "Sí" en al menos uno)');
    const specText = str(r.get('Especialidad'));
    const spec = specText ? specialty(US.name, r.row, 'Especialidad', specText) : null;
    if (roles.includes('especialista') && !spec) err(US.name, r.row, 'Especialidad', 'Especialidad es obligatoria para un especialista');
    const email = str(r.get('Correo'));
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err(US.name, r.row, 'Correo', `Correo no válido: "${email}"`);
    if (!users.has(dni)) users.set(dni, { row: r.row, dni, fullName: fullName ?? '', email, phone: str(r.get('Teléfono')), specialty: spec, roles });
  }

  /** Persona referenciada ("DNI · Nombre"): debe existir en la hoja 2 o en el sistema y tener el rol. */
  const person = (s: Sheet, r: Row, col: string, role: Role | null, required: boolean) => {
    const ref = parsePersonRef(r.get(col));
    if (!ref) {
      if (required) err(s.name, r.row, col, `${col} es obligatorio`);
      return null;
    }
    const u = users.get(ref.dni);
    const ex = ctx.users.get(ref.dni);
    if (!u && !ex) {
      err(s.name, r.row, col, `El DNI ${ref.dni} no está en la hoja "${US.name}" ni en el sistema`);
      return null;
    }
    const roles = new Set([...(u?.roles ?? []), ...(ex?.roles ?? [])]);
    if (role && !roles.has(role)) {
      const label = ROLE_COLUMNS.find(([, x]) => x === role)![0];
      err(s.name, r.row, col, `${u?.fullName ?? ex!.fullName} (${ref.dni}) no tiene el rol "${label}"`);
    }
    const realName = u?.fullName ?? ex!.fullName;
    if (ref.name && fold(ref.name) !== fold(realName)) {
      warn(s.name, r.row, col, `"${ref.name}" no coincide con el nombre del DNI ${ref.dni}: "${realName}"`);
    }
    return ref.dni;
  };

  // ── 3. Brigadas
  const BS = p.brigades;
  const brigades = new Map<string, PlanBrigade>();
  for (const r of BS.rows) {
    const code = req(BS, r, 'Código')?.toUpperCase() ?? null;
    const name = req(BS, r, 'Nombre');
    const proj = req(BS, r, 'Proyecto');
    if (proj && project && !projectMatches(proj)) err(BS.name, r.row, 'Proyecto', `El proyecto "${proj}" no es el de la hoja "${PS.name}" (${project.code})`);
    const regionText = str(r.get('Región'));
    const region = regionText ? REGION_VALUES[fold(regionText)] : null;
    if (regionText && !region) err(BS.name, r.row, 'Región', `Región no válida: "${regionText}" (COSTA, SIERRA o SELVA)`);
    const specText = req(BS, r, 'Especialidad');
    const spec = specText ? specialty(BS.name, r.row, 'Especialidad', specText) : null;
    const leaderDni = person(BS, r, 'Jefe de brigada', 'jefe_brigada', true);
    const supervisorDni = person(BS, r, 'Supervisor', 'supervisor', false);
    const logisticianDni = person(BS, r, 'Logístico', 'logistico', false);
    if (!code) continue;
    if (brigades.has(code)) {
      err(BS.name, r.row, 'Código', `Código de brigada ${code} duplicado (fila ${brigades.get(code)!.row})`);
      continue;
    }
    if ([...brigades.values()].some((b) => name && fold(b.name) === fold(name))) err(BS.name, r.row, 'Nombre', `Nombre de brigada "${name}" duplicado`);
    brigades.set(code, {
      row: r.row, code, name: name ?? code, region: region ?? null, specialty: spec && fold(spec) === fold(MIXED_SPECIALTY) ? null : spec,
      leaderDni: leaderDni ?? '', supervisorDni, logisticianDni, notes: str(r.get('Observaciones')),
    });
  }
  const brigadeRef = (s: Sheet, r: Row, col: string) => {
    const v = req(s, r, col)?.toUpperCase() ?? null;
    if (v && !brigades.has(v) && !ctx.brigadeCodes.has(v)) {
      err(s.name, r.row, col, `La brigada "${v}" no está en la hoja "${BS.name}"`);
      return null;
    }
    return v;
  };

  // ── 4. Integrantes
  const MS = p.members;
  const members: PlanMember[] = [];
  for (const r of MS.rows) {
    const brigadeCode = brigadeRef(MS, r, 'Brigada');
    const dni = person(MS, r, 'Especialista', 'especialista', true);
    const from = parseDate(r.get('Desde'));
    const to = parseDate(r.get('Hasta'));
    if (from === undefined) err(MS.name, r.row, 'Desde', 'Desde no es una fecha válida');
    if (to === undefined) err(MS.name, r.row, 'Hasta', 'Hasta no es una fecha válida');
    if (from && to && from > to) err(MS.name, r.row, 'Hasta', `Desde (${from}) es posterior a Hasta (${to})`);
    if (project && ((from && (from < project.startDate || from > project.endDate)) || (to && (to > project.endDate || to < project.startDate)))) {
      warn(MS.name, r.row, 'Desde', `Fechas fuera de la vigencia del proyecto (${project.startDate} a ${project.endDate})`);
    }
    if (!brigadeCode || !dni) continue;
    const dup = members.find((m) => m.brigadeCode === brigadeCode && m.dni === dni);
    if (dup) {
      err(MS.name, r.row, 'Especialista', `El DNI ${dni} ya está en la brigada ${brigadeCode} (fila ${dup.row})`);
      continue;
    }
    const f = from ?? null;
    const t = to ?? null;
    const clash = members.find(
      (m) => m.dni === dni && m.brigadeCode !== brigadeCode && (m.validFrom ?? '0000') <= (t ?? '9999') && (f ?? '0000') <= (m.validTo ?? '9999'),
    );
    if (clash) err(MS.name, r.row, 'Especialista', `El DNI ${dni} también está en ${clash.brigadeCode} (fila ${clash.row}) en fechas que se cruzan`);
    members.push({ row: r.row, brigadeCode, dni, validFrom: f, validTo: t });
  }
  for (const b of brigades.values()) if (!members.some((m) => m.brigadeCode === b.code)) warn(BS.name, b.row, null, `La brigada ${b.code} no tiene integrantes`);
  for (const u of users.values()) {
    if (u.roles.includes('especialista') && !members.some((m) => m.dni === u.dni)) warn(US.name, u.row, null, `El especialista ${u.fullName} (${u.dni}) no está en ninguna brigada`);
  }

  // ── 5. Estaciones
  const SS = p.stations;
  const stations = new Map<string, PlanStation>();
  for (const r of SS.rows) {
    const code = req(SS, r, 'Código')?.toUpperCase() ?? null;
    const proj = req(SS, r, 'Proyecto');
    if (proj && project && !projectMatches(proj)) err(SS.name, r.row, 'Proyecto', `El proyecto "${proj}" no es el de la hoja "${PS.name}" (${project.code})`);
    const zone = parseZone(r.get('Zona UTM'));
    if (zone === null) err(SS.name, r.row, 'Zona UTM', 'Zona UTM es obligatoria');
    if (zone === undefined) err(SS.name, r.row, 'Zona UTM', `Zona UTM no válida: "${str(r.get('Zona UTM'))}" (17 S, 18 S o 19 S)`);
    const e = parseNumber(r.get('Este'));
    const n = parseNumber(r.get('Norte'));
    if (e == null) err(SS.name, r.row, 'Este (m)', e === null ? 'Este (m) es obligatorio' : `Este (m) no es numérico: "${str(r.get('Este'))}"`);
    else if (e < 100000 || e > 900000) err(SS.name, r.row, 'Este (m)', `Este (m) fuera de rango UTM: ${e}`);
    if (n == null) err(SS.name, r.row, 'Norte (m)', n === null ? 'Norte (m) es obligatorio' : `Norte (m) no es numérico: "${str(r.get('Norte'))}"`);
    else if (n < 7000000 || n > 10000000) err(SS.name, r.row, 'Norte (m)', `Norte (m) fuera de rango UTM sur: ${n}`);
    const alt = parseNumber(r.get('Altitud'));
    if (alt === undefined) err(SS.name, r.row, 'Altitud (m)', `Altitud no es numérica: "${str(r.get('Altitud'))}"`);
    const areaText = req(SS, r, 'AID/AII');
    const area = areaText ? AREA_VALUES[fold(areaText)] : undefined;
    if (areaText && !area) err(SS.name, r.row, 'AID/AII', `Valor no válido: "${areaText}" (AID, AII, Huella o Fuera)`);
    let lat = NaN;
    let lng = NaN;
    if (zone && e != null && n != null && e >= 100000 && e <= 900000 && n >= 7000000 && n <= 10000000) {
      ({ lat, lng } = utmToLatLng(zone.zone, zone.hemisphere, e, n));
      if (lat < -18.5 || lat > 0.1 || lng < -81.5 || lng > -68.5) {
        err(SS.name, r.row, 'Este (m)', `Las coordenadas caen fuera del Perú (${lat.toFixed(4)}, ${lng.toFixed(4)}). Revisa la zona UTM`);
        lat = NaN;
      }
    }
    if (!code) continue;
    if (/\s/.test(code)) warn(SS.name, r.row, 'Código', `El código "${code}" tiene espacios; las unidades se llamarán ${code}-XX01`);
    if (code.length > 40) err(SS.name, r.row, 'Código', 'Código demasiado largo (máx. 40)');
    if (stations.has(code)) {
      err(SS.name, r.row, 'Código', `Código de estación ${code} duplicado (fila ${stations.get(code)!.row})`);
      continue;
    }
    if (!Number.isFinite(lat) || !area || !zone) continue;
    const overlapText = str(r.get('ZA/EF'));
    stations.set(code, {
      row: r.row, code, name: str(r.get('Nombre')), zone: zone.zone, easting: e!, northing: n!, lat, lng,
      altitude: alt == null ? null : Math.round(alt), influenceArea: area, vegetationUnit: str(r.get('Unidad de vegetación')),
      overlap: overlapText && !NONE.has(fold(overlapText)) ? overlapText : null, accessNotes: str(r.get('Indicaciones de acceso')),
    });
  }
  // Estaciones a menos de 100 m entre sí.
  const list = [...stations.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      if (Math.abs(a.lat - b.lat) > 0.002) continue;
      const d = distanceMeters(a.lat, a.lng, b.lat, b.lng);
      if (d < 100) warn(SS.name, b.row, 'Este (m)', `${b.code} está a ${Math.round(d)} m de ${a.code}`);
    }
  }
  const stationRef = (s: Sheet, r: Row, col: string, required: boolean) => {
    const v = (required ? req(s, r, col) : str(r.get(col)))?.toUpperCase() ?? null;
    if (v && !stations.has(v) && !ctx.stationCodes.has(v)) {
      err(s.name, r.row, col, `La estación "${v}" no está en la hoja "${SS.name}"`);
      return null;
    }
    return v;
  };

  // ── 6. Métodos
  const MT = p.methods;
  const methods = new Map<string, PlanMethod>();
  for (const r of MT.rows) {
    const code = req(MT, r, 'Código')?.toUpperCase() ?? null;
    const name = req(MT, r, 'Nombre');
    const specText = req(MT, r, 'Especialidad');
    const spec = specText ? specialty(MT.name, r.row, 'Especialidad', specText) : null;
    const units = parseNumber(r.get('Unidades por defecto'));
    if (units === undefined || (units != null && (!Number.isInteger(units) || units < 0))) {
      err(MT.name, r.row, 'Unidades por defecto', `Unidades por defecto no válidas: "${str(r.get('Unidades por defecto'))}" (entero ≥ 0)`);
    }
    const photos = parseNumber(r.get('Fotos por unidad'));
    if (photos === undefined || (photos != null && (!Number.isInteger(photos) || photos < 0))) {
      err(MT.name, r.row, 'Fotos por unidad', `Fotos por unidad no válidas: "${str(r.get('Fotos por unidad'))}" (entero ≥ 0)`);
    }
    const classText = req(MT, r, 'Clase');
    const cls = classText ? CLASS_VALUES[fold(classText)] : undefined;
    if (classText && !cls) err(MT.name, r.row, 'Clase', `Clase no válida: "${classText}" (TODAS, CONDICIONAL, EVENTO, ATRIBUTO o TRANSVERSAL)`);
    const track = parseYesNo(r.get('Track'));
    if (track === null) err(MT.name, r.row, 'Track', 'Track es obligatorio (Sí / No)');
    if (track === undefined) err(MT.name, r.row, 'Track', `Valor no válido en Track: "${str(r.get('Track'))}" (Sí / No)`);
    if (!code) continue;
    if (/\s/.test(code)) warn(MT.name, r.row, 'Código', `El código de método "${code}" tiene espacios`);
    if (code.length > 10) err(MT.name, r.row, 'Código', 'Código de método demasiado largo (máx. 10)');
    if (methods.has(code)) {
      err(MT.name, r.row, 'Código', `Código de método ${code} duplicado (fila ${methods.get(code)!.row})`);
      continue;
    }
    if (!spec || !name || !cls || track == null) continue;
    const scheduleText = str(r.get('Horario'));
    const range = parseScheduleRange(scheduleText);
    methods.set(code, {
      row: r.row, code, name, specialty: spec, defaultUnits: units == null || units === undefined ? null : units,
      photosPerUnit: photos ?? null, methodClass: cls, requiresTrack: track, scheduleText, scheduleStart: range?.start ?? null,
      scheduleEnd: range?.end ?? null, guideline: str(r.get('Condición de aplicación')), isOpenEnded: cls === 'evento',
    });
  }

  // ── 7. Estación–Método
  const SM = p.stationMethods;
  const stationMethods: PlanStationMethod[] = [];
  const smSeen = new Map<string, number>();
  for (const r of SM.rows) {
    const stationCode = stationRef(SM, r, 'Estación', true);
    const methodCode = req(SM, r, 'Método')?.toUpperCase() ?? null;
    const m = methodCode ? methods.get(methodCode) : undefined;
    if (methodCode && !m) err(SM.name, r.row, 'Método', `El método "${methodCode}" no está en la hoja "${MT.name}"`);
    const brigadeCode = brigadeRef(SM, r, 'Brigada');
    const units = parseNumber(r.get('Unidades requeridas'));
    if (units === undefined || (units != null && (!Number.isInteger(units) || units < 0 || units > 500))) {
      err(SM.name, r.row, 'Unidades requeridas', `Unidades requeridas no válidas: "${str(r.get('Unidades requeridas'))}" (entero de 0 a 500)`);
      continue;
    }
    if (!stationCode || !m || !brigadeCode) continue;
    const k = `${stationCode}|${m.code}`;
    if (smSeen.has(k)) {
      err(SM.name, r.row, 'Método', `La combinación ${stationCode} + ${m.code} está repetida (fila ${smSeen.get(k)})`);
      continue;
    }
    smSeen.set(k, r.row);
    stationMethods.push({ row: r.row, stationCode, methodCode: m.code, brigadeCode, unitsRequired: units ?? m.defaultUnits ?? 0, notes: str(r.get('Observación')) });
  }

  // Método sin unidades por defecto ni unidades en ninguna estación (ECF, cualitativo): abierto, como EVENTO.
  // Sus códigos (EM-36-ECF01) se crean en campo solo cuando se ejecuta.
  for (const m of methods.values()) {
    const rows = stationMethods.filter((x) => x.methodCode === m.code);
    if (m.defaultUnits == null && rows.length && rows.every((x) => x.unitsRequired === 0)) m.isOpenEnded = true;
  }

  // Brigada sin nadie que pueda ver/asumir la especialidad del método (reglas de acceso).
  const accessOf = (spec: string) => {
    const set = new Set([fold(spec)]);
    const existing = ctx.access.get(spec) ?? [...ctx.access].find(([k]) => fold(k) === fold(spec))?.[1];
    const grants = existing && existing.length ? existing : DEFAULT_ACCESS[Object.keys(DEFAULT_ACCESS).find((k) => fold(k) === fold(spec)) ?? ''] ?? [];
    for (const g of grants) set.add(fold(g));
    return set;
  };
  const userSpecialty = (dni: string) => (users.has(dni) ? users.get(dni)!.specialty : ctx.users.get(dni)?.specialty ?? null);
  const uncovered = new Map<string, { brigade: string; specialty: string; stations: Set<string>; row: number }>();
  for (const sm of stationMethods) {
    const m = methods.get(sm.methodCode)!;
    const team = members.filter((x) => x.brigadeCode === sm.brigadeCode).map((x) => userSpecialty(x.dni));
    if (team.some((s) => s == null)) continue; // alguien sin especialidad ve todo
    if (team.some((s) => accessOf(s!).has(fold(m.specialty)))) continue;
    const k = `${sm.brigadeCode}|${m.specialty}`;
    const u = uncovered.get(k) ?? { brigade: sm.brigadeCode, specialty: m.specialty, stations: new Set(), row: sm.row };
    u.stations.add(sm.stationCode);
    uncovered.set(k, u);
  }
  for (const u of uncovered.values()) {
    const st = [...u.stations];
    warn(SM.name, u.row, 'Brigada', `Ningún integrante de ${u.brigade} tiene acceso a ${u.specialty} (${st.length} estaciones: ${st.slice(0, 5).join(', ')}${st.length > 5 ? '…' : ''})`);
  }

  // ── 8. Cronograma
  const CS = p.schedule;
  const schedules: PlanSchedule[] = [];
  const schedSeen = new Map<string, number>();
  const order = new Map<string, number>();
  for (const r of CS.rows) {
    const date = parseDate(r.get('Fecha'));
    if (date == null) err(CS.name, r.row, 'Fecha', date === null ? 'Fecha es obligatoria' : 'Fecha no es una fecha válida');
    else if (project && (date < project.startDate || date > project.endDate)) {
      err(CS.name, r.row, 'Fecha', `La fecha ${date} está fuera de la vigencia del proyecto (${project.startDate} a ${project.endDate})`);
    }
    const brigadeCode = brigadeRef(CS, r, 'Brigada');
    const typeText = req(CS, r, 'Tipo de actividad');
    const type = typeText ? ACTIVITY_VALUES[fold(typeText)] : undefined;
    if (typeText && !type) err(CS.name, r.row, 'Tipo de actividad', `Tipo de actividad no válido: "${typeText}"`);
    const stationCode = stationRef(CS, r, 'Estación', false);
    if (type === 'estacion' && !str(r.get('Estación'))) err(CS.name, r.row, 'Estación', 'Una actividad ESTACIÓN necesita la estación');
    if (!date || !brigadeCode || !type || (type === 'estacion' && !stationCode)) continue;
    const s = { row: r.row, date, brigadeCode, activityType: type, stationCode: stationCode ?? null, detail: str(r.get('Detalle operativo')), sortOrder: 0 };
    const k = keySchedule(s);
    if (schedSeen.has(k)) {
      warn(CS.name, r.row, null, `Actividad repetida (igual a la fila ${schedSeen.get(k)}): se carga una sola vez`);
      continue;
    }
    schedSeen.set(k, r.row);
    const dayKey = `${brigadeCode}|${date}`;
    s.sortOrder = order.get(dayKey) ?? 0;
    order.set(dayKey, s.sortOrder + 1);
    schedules.push(s);
  }
  const scheduled = new Set(schedules.filter((s) => s.activityType === 'estacion').map((s) => s.stationCode));
  const withMethods = new Map<string, number>();
  for (const sm of stationMethods) if (!withMethods.has(sm.stationCode)) withMethods.set(sm.stationCode, sm.row);
  for (const [code] of withMethods) {
    if (!scheduled.has(code)) warn(SS.name, stations.get(code)?.row ?? null, 'Código', `La estación ${code} tiene métodos pero no tiene fecha en el cronograma`);
  }

  // ── Avisos generales
  const coordinators = [...users.values()].filter((u) => u.roles.includes('coordinador')).length;
  if (!coordinators && !ctx.coordinators) warn(US.name, null, 'Coordinador', 'No hay ningún usuario con rol Coordinador: crea un coordinador después de importar');
  const updUsers = [...users.keys()].filter((d) => ctx.users.has(d));
  if (updUsers.length) warn(US.name, null, 'DNI', `${updUsers.length} usuarios ya existen y se actualizarán (su contraseña no cambia): ${updUsers.slice(0, 8).join(', ')}${updUsers.length > 8 ? '…' : ''}`);
  const updStations = [...stations.keys()].filter((c) => ctx.stationCodes.has(c));
  if (updStations.length) warn(SS.name, null, 'Código', `${updStations.length} estaciones ya existen y se actualizarán: ${updStations.slice(0, 8).join(', ')}${updStations.length > 8 ? '…' : ''}`);

  // ── Resumen
  const count = (keys: string[], exists: (k: string) => boolean): TemplateCount => {
    const upd = keys.filter(exists).length;
    return { total: keys.length, new: keys.length - upd, update: upd };
  };
  const allSpecialties = [...new Set([...listSpecialties.map((n) => specialtyNames.get(fold(n))!), ...usedSpecialties])];
  const existingSpec = new Set(ctx.specialties.map(fold));
  const summary: TemplateSummary = {
    project: count(project ? [project.code] : [], () => !!ctx.project),
    specialties: count(allSpecialties, (n) => existingSpec.has(fold(n))),
    users: count([...users.keys()], (d) => ctx.users.has(d)),
    brigades: count([...brigades.keys()], (c) => ctx.brigadeCodes.has(c)),
    members: count(members.map((m) => keyMember(m.brigadeCode, m.dni)), (k) => ctx.memberKeys.has(k)),
    stations: count([...stations.keys()], (c) => ctx.stationCodes.has(c)),
    methods: count([...methods.values()].map((m) => keyMethod(m.specialty, m.code)), (k) => ctx.methodKeys.has(k)),
    stationMethods: count(
      stationMethods.map((sm) => keyStationMethod(sm.stationCode, methods.get(sm.methodCode)!.specialty, sm.methodCode)),
      (k) => ctx.stationMethodKeys.has(k),
    ),
    schedules: count(schedules.map(keySchedule), (k) => ctx.scheduleKeys.has(k)),
  };

  const ok = errors.length === 0 && !!project;
  return {
    ok,
    errors,
    warnings,
    summary,
    plan: ok
      ? {
          project: project!, specialties: allSpecialties, users: [...users.values()], brigades: [...brigades.values()], members,
          stations: [...stations.values()], methods: [...methods.values()], stationMethods, schedules,
        }
      : null,
  };
}
