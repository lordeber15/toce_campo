import type { WpGeometry, WpLayer } from './workPackage.js';

/**
 * Verificación espacial en el teléfono (sin conexión): en qué capas del proyecto cae un punto.
 * Misma regla que el servidor al clasificar estaciones: AID tiene prioridad sobre AII;
 * la unidad de vegetación es la de menor área que lo contiene.
 */

type Ring = [number, number][];

/** Punto dentro de un anillo (ray casting). Coordenadas [lng, lat]. */
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polígono con huecos: dentro del exterior y fuera de cada hueco. */
const inPolygon = (lng: number, lat: number, rings: Ring[]) =>
  rings.length > 0 && inRing(lng, lat, rings[0]!) && !rings.slice(1).some((h) => inRing(lng, lat, h));

export function pointInGeometry(lng: number, lat: number, g: WpGeometry): boolean {
  switch (g.type) {
    case 'Polygon':
      return inPolygon(lng, lat, g.coordinates as Ring[]);
    case 'MultiPolygon':
      return (g.coordinates as Ring[][]).some((p) => inPolygon(lng, lat, p));
    case 'GeometryCollection':
      return g.geometries.some((x) => pointInGeometry(lng, lat, x));
    default:
      return false; // puntos y líneas no "contienen"
  }
}

/** Área aproximada de un anillo en grados² (solo para comparar tamaños). */
function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] + r[i]![0]) * (r[j]![1] - r[i]![1]);
  return Math.abs(a / 2);
}
function geometryArea(g: WpGeometry): number {
  if (g.type === 'Polygon') return ringArea((g.coordinates as Ring[])[0] ?? []);
  if (g.type === 'MultiPolygon') return (g.coordinates as Ring[][]).reduce((s, p) => s + ringArea(p[0] ?? []), 0);
  if (g.type === 'GeometryCollection') return g.geometries.reduce((s, x) => s + geometryArea(x), 0);
  return 0;
}

export type PointAreas = {
  /** null si el proyecto no tiene capas AID/AII. */
  influence: 'AID' | 'AII' | 'fuera' | null;
  /** null si no hay capas UV; '' si las hay pero el punto no cae en ninguna. */
  vegetation: string | null;
  overlaps: string[];
  inFootprint: boolean;
};

export function classifyPoint(layers: WpLayer[], lat: number, lng: number): PointAreas {
  const has = (k: WpLayer['kind']) => layers.some((l) => l.kind === k);
  const hits = layers.filter((l) => pointInGeometry(lng, lat, l.geometry));
  const hit = (k: WpLayer['kind']) => hits.filter((l) => l.kind === k);

  const influence = has('aid') || has('aii') ? (hit('aid').length ? 'AID' : hit('aii').length ? 'AII' : 'fuera') : null;
  const uv = hit('uv').sort((a, b) => geometryArea(a.geometry) - geometryArea(b.geometry))[0];
  return {
    influence,
    vegetation: has('uv') ? (uv ? `${uv.name}${uv.code ? ` (${uv.code})` : ''}` : '') : null,
    overlaps: hit('superposicion').map((l) => l.name).sort(),
    inFootprint: hit('huella').length > 0,
  };
}
