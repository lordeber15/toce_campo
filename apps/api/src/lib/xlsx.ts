import ExcelJS from 'exceljs';

export type Col<T> = { header: string; width?: number; value: (row: T) => unknown; numFmt?: string };

/** Libro con propiedades básicas. */
export function workbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TOCE';
  wb.created = new Date();
  return wb;
}

/** Nombre de hoja válido para Excel (máx. 31, sin []:*?/\) y único dentro del libro. */
export function sheetName(wb: ExcelJS.Workbook, name: string) {
  const base = name.replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Hoja';
  let n = base;
  for (let i = 2; wb.getWorksheet(n); i++) n = `${base.slice(0, 28)} ${i}`;
  return n;
}

/** Hoja de tabla: encabezado en negrita con fondo, fila fija, filtro automático y anchos. */
export function addTable<T>(wb: ExcelJS.Workbook, name: string, cols: Col<T>[], rows: T[], title?: string) {
  const ws = wb.addWorksheet(sheetName(wb, name));
  let headerRow = 1;
  if (title) {
    ws.addRow([title]).font = { bold: true, size: 13 };
    ws.addRow([]);
    headerRow = 3;
  }
  const head = ws.addRow(cols.map((c) => c.header));
  head.font = { bold: true, color: { argb: 'FF1F2937' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  for (const r of rows) ws.addRow(cols.map((c) => normalize(c.value(r))));
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? Math.min(48, Math.max(10, c.header.length + 2));
    if (c.numFmt) col.numFmt = c.numFmt;
  });
  ws.views = [{ state: 'frozen', ySplit: headerRow }];
  if (rows.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: cols.length } };
  return ws;
}

/** Hoja de pares etiqueta / valor (resúmenes). */
export function addKeyValues(wb: ExcelJS.Workbook, name: string, title: string, pairs: [string, unknown][]) {
  const ws = wb.addWorksheet(sheetName(wb, name));
  ws.addRow([title]).font = { bold: true, size: 13 };
  ws.addRow([]);
  for (const [k, v] of pairs) {
    const row = ws.addRow([k, normalize(v)]);
    row.getCell(1).font = { color: { argb: 'FF4B5563' } };
  }
  ws.getColumn(1).width = 44;
  ws.getColumn(2).width = 28;
  return ws;
}

/** Valores que Excel entiende: números, texto, fechas; objetos como texto. */
function normalize(v: unknown): ExcelJS.CellValue {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v instanceof Date) return v;
  return JSON.stringify(v);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Hora de Lima legible (dd/mm/aaaa hh:mm) a partir de un ISO. */
export const limaDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '') : null;
export const ddmmyyyy = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : null);
