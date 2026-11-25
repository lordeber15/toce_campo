import JSZip from 'jszip';
import { kmlWithFolders, type Folder, type Root } from '@tmcw/togeojson';
import type { Feature, Geometry } from 'geojson';

export type LayerKind = 'huella' | 'aid' | 'aii' | 'uv' | 'superposicion' | 'otro';
export type ParsedFeature = {
  name: string;
  folder: string;
  /** Carpetas de la raíz a la hoja. */
  folderPath: string[];
  /** Color del estilo del KMZ (#rrggbb) si lo trae. */
  color: string | null;
  geometry: Geometry;
  properties: Record<string, unknown>;
  kind: LayerKind;
  isPoint: boolean;
};

/** Adivina el tipo de capa por nombre de carpeta / elemento. Siempre editable por el usuario. */
export function guessKind(text: string): LayerKind {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/huella|footprint|componente/.test(t)) return 'huella';
  if (/\baid\b|influencia directa|area de influencia directa/.test(t)) return 'aid';
  if (/\baii\b|\bai\b|influencia indirecta/.test(t)) return 'aii';
  if (/\buv\b|vegetacion|cobertura|formacion vegetal|bosque|pajonal|matorral|herbazal/.test(t)) return 'uv';
  if (/\banp\b|\bacr\b|\bacp\b|reserva|concesion|zona de amortiguamiento|\bef\b|superposicion|comunidad/.test(t)) return 'superposicion';
  return 'otro';
}

/**
 * Quita la altitud (la API la descarta con ST_Force2D) y redondea a 7 decimales (~1 cm).
 * Un KMZ de pocos MB se expande a decenas de MB de JSON sin esto.
 */
function compactCoords(c: unknown): unknown {
  if (Array.isArray(c) && typeof c[0] === 'number') return [Math.round(c[0] * 1e7) / 1e7, Math.round((c[1] as number) * 1e7) / 1e7];
  return Array.isArray(c) ? c.map(compactCoords) : c;
}
function compact(g: Geometry): Geometry {
  if (g.type === 'GeometryCollection') return { ...g, geometries: g.geometries.map(compact) };
  return { ...g, coordinates: compactCoords(g.coordinates) } as Geometry;
}

/**
 * Tipo sugerido mirando primero lo más específico (el nombre, luego la carpeta más profunda):
 * así "Áreas de influencia y huella / AID" queda como AID y no como huella.
 */
function guessKindFrom(name: string, path: string[]): LayerKind {
  for (const t of [name, ...[...path].reverse()]) {
    const k = guessKind(t);
    if (k !== 'otro') return k;
  }
  return 'otro';
}

/** Claves internas de togeojson que no aportan al usuario. */
const NOISE = new Set(['styleUrl', 'styleHash', 'styleMap', 'visibility']);

function walk(node: Root | Folder, path: string[], out: ParsedFeature[]) {
  for (const child of node.children) {
    if (child.type === 'folder') {
      walk(child, [...path, String(child.meta?.name ?? '').trim()].filter(Boolean), out);
      continue;
    }
    const f = child as Feature;
    if (!f.geometry) continue;
    const raw = (f.properties ?? {}) as Record<string, unknown>;
    const props = Object.fromEntries(Object.entries(raw).filter(([k, v]) => !NOISE.has(k) && v !== '' && v != null));
    const name = String(raw.name ?? '').trim() || '(sin nombre)';
    const isPoint = f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint';
    // Color del estilo del KMZ (togeojson lo entrega como #rrggbb).
    const color = [raw.fill, raw.stroke, raw['marker-color']].find((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) ?? null;
    out.push({
      name, folder: path.join(' / '), folderPath: path, geometry: compact(f.geometry), properties: props,
      kind: guessKindFrom(name, path), isPoint, color,
    });
  }
}

export type ParsedKml = { title: string | null; features: ParsedFeature[] };

/** Lee un .kmz o .kml y devuelve sus elementos con el tipo sugerido. */
export async function parseKmlFile(file: File): Promise<ParsedFeature[]> {
  return (await parseKmlDocument(file)).features;
}

/** Igual que parseKmlFile, más el nombre del documento (raíz del árbol de capas). */
export async function parseKmlDocument(file: File): Promise<ParsedKml> {
  let text: string;
  if (/\.kmz$/i.test(file.name)) {
    const zip = await JSZip.loadAsync(file);
    const kmlEntry = Object.values(zip.files).find((f) => /\.kml$/i.test(f.name) && !f.dir);
    if (!kmlEntry) throw new Error('El KMZ no contiene un archivo .kml');
    text = await kmlEntry.async('text');
  } else {
    text = await file.text();
  }
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  if (dom.querySelector('parsererror')) throw new Error('El archivo KML no es válido');
  const out: ParsedFeature[] = [];
  walk(kmlWithFolders(dom), [], out);
  if (!out.length) throw new Error('No se encontraron elementos con geometría');
  const doc = Array.from(dom.getElementsByTagName('Document'))[0];
  const nameEl = doc ? Array.from(doc.childNodes).find((c) => c.nodeType === 1 && (c as Element).localName === 'name') : undefined;
  return { title: nameEl?.textContent?.trim() || null, features: out };
}

/** Extrae un código de estación tipo "EM-23", "EM23", "EM 35A" desde un nombre. */
export function stationCodeFrom(name: string): string | null {
  const m = /\bEM[\s_-]?(\d+[A-Z]?)\b/i.exec(name);
  return m ? `EM-${m[1]!.toUpperCase()}` : null;
}
