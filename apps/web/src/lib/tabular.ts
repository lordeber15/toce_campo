import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';

/** Normaliza un encabezado: minúsculas, sin tildes, solo a-z0-9 y _. */
export const normHeader = (h: string) =>
  h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Lee CSV o Excel (.xlsx) y devuelve filas como objetos con encabezados normalizados. */
export async function readTable(file: File): Promise<Record<string, string>[]> {
  let rows: unknown[][];
  if (/\.xlsx$/i.test(file.name)) {
    rows = (await readSheet(file)) as unknown[][];
  } else if (/\.(csv|txt)$/i.test(file.name)) {
    const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: true, delimitersToGuess: [',', ';', '\t', '|'] });
    rows = parsed.data;
  } else {
    throw new Error('Formato no soportado. Usa .xlsx o .csv');
  }
  const [header, ...body] = rows;
  if (!header) throw new Error('El archivo está vacío');
  const keys = header.map((h) => normHeader(String(h ?? '')));
  return body
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] == null ? '' : String(r[i]).trim()])))
    .filter((o) => Object.values(o).some((v) => v !== ''));
}

/** Busca el primer valor no vacío entre varios nombres de columna posibles. */
export const pick = (row: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (row[k]) return row[k];
  return '';
};
