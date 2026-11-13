import JSZip from 'jszip';
import { kmlWithFolders, type Folder, type Root } from '@tmcw/togeojson';
import type { Feature, Geometry } from 'geojson';

export type LayerKind = 'huella' | 'aid' | 'aii' | 'uv' | 'superposicion' | 'otro';
export type ParsedFeature = {
  name: string;
  folder: string;
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

function walk(node: Root | Folder, path: string[], out: ParsedFeature[]) {
  for (const child of node.children) {
    if (child.type === 'folder') {
      walk(child, [...path, String(child.meta?.name ?? '')].filter(Boolean), out);
      continue;
    }
    const f = child as Feature;
    if (!f.geometry) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const name = String(props.name ?? '').trim() || '(sin nombre)';
    const folder = path.join(' / ');
    const isPoint = f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint';
    out.push({ name, folder, geometry: f.geometry, properties: props, kind: guessKind(`${folder} ${name}`), isPoint });
  }
}

/** Lee un .kmz o .kml y devuelve sus elementos con el tipo sugerido. */
export async function parseKmlFile(file: File): Promise<ParsedFeature[]> {
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
  return out;
}

/** Extrae un código de estación tipo "EM-23", "EM23", "EM 35A" desde un nombre. */
export function stationCodeFrom(name: string): string | null {
  const m = /\bEM[\s_-]?(\d+[A-Z]?)\b/i.exec(name);
  return m ? `EM-${m[1]!.toUpperCase()}` : null;
}
