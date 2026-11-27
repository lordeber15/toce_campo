/** Política de fotografías aprobada para TOCE. Sin dependencias nativas. */
export const PHOTO_MAX_PIXELS = 12_000_000;
export const PHOTO_JPEG_QUALITY = 100;
export const PHOTO_POLICY_KEY = 'toce.photo.12mp.v1';

export function boundedDimensions(width: number, height: number) {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0)) throw new Error('Dimensiones de foto inválidas');
  const scale = Math.min(1, Math.sqrt(PHOTO_MAX_PIXELS / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/** Hasta 12 MP. Acepta capturas nominales de 12 MP (p. ej. 4032x3024) y las limita al guardar. */
export function selectPictureSize(sizes: string[]): string | undefined {
  const parsed = sizes.flatMap((value) => {
    const m = /^(\d+)x(\d+)$/.exec(value);
    return m && +m[1]! > 0 && +m[2]! > 0 ? [{ value, pixels: +m[1]! * +m[2]! }] : [];
  }).sort((a, b) => b.pixels - a.pixels);
  const nominal = parsed.filter((s) => s.pixels >= PHOTO_MAX_PIXELS && s.pixels <= PHOTO_MAX_PIXELS * 1.05).at(-1);
  return nominal?.value ?? parsed.find((s) => s.pixels <= PHOTO_MAX_PIXELS)?.value ?? parsed.at(-1)?.value;
}

/** Solo formato visible: no modifica identificadores de la base de datos. Conserva sufijos R/D. */
export function photoUnitCode(station: string, method: string, code: string) {
  const compact = (s: string) => s.replace(/[\s_-]/g, '').toUpperCase();
  const st = compact(station), raw = compact(code), met = compact(method);
  const tail = st && raw.startsWith(st) ? raw.slice(st.length) : raw;
  const match = met && tail.startsWith(met) ? /^(\d+)$/.exec(tail.slice(met.length)) : null;
  if (match) return `${st}-${met}${match[1]!.padStart(2, '0')}`;
  // No inventar correlativos para códigos provisionales o métodos cualitativos.
  return code;
}

export function fileStem(s: string) {
  return s.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '_').replace(/[. ]+$/, '').slice(0, 150) || 'Foto';
}

export function compassLabel(degrees: number) {
  const d = ((Math.round(degrees) % 360) + 360) % 360;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return `${directions[Math.round(d / 45) % 8]} ${d}°`;
}

export type Vector3 = { x: number; y: number; z: number };
const dot = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vector3, b: Vector3): Vector3 => ({ x: a.y*b.z-a.z*b.y, y: a.z*b.x-a.x*b.z, z: a.x*b.y-a.y*b.x });
const norm = (v: Vector3) => Math.sqrt(dot(v, v));
const unit = (v: Vector3) => { const n=norm(v); return {x:v.x/n,y:v.y/n,z:v.z/n}; };

/** Azimut magnético del eje óptico trasero (-Z), independiente de portrait/landscape.
 * up: acelerómetro con gravedad positiva hacia arriba. No usar GPS course/heading.
 */
export function rearCameraBearing(up: Vector3, magnetic: Vector3): number | null {
  if (![up.x,up.y,up.z,magnetic.x,magnetic.y,magnetic.z].every(Number.isFinite)) return null;
  const g = norm(up), m = norm(magnetic);
  if (g < 0.85 || g > 1.15 || m < 15 || m > 100) return null;
  const u = unit(up), east = cross(magnetic, u);
  if (norm(east) < 5) return null;
  const e = unit(east), n = cross(u, e);
  // Una cámara apuntando al cielo/suelo no tiene rumbo horizontal estable.
  if (Math.hypot(e.z, n.z) < 0.25) return null;
  return (Math.atan2(-e.z, -n.z) * 180 / Math.PI + 360) % 360;
}

/** Ajusta líneas sin truncar UV, identificadores ni coordenadas. */
export function wrapPhotoText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = []; let line = '';
  for (const word of text.split(/\s+/)) {
    const trial = line ? `${line} ${word}` : word;
    if (measure(trial) <= maxWidth) { line = trial; continue; }
    if (line) { lines.push(line); line = ''; }
    let part = '';
    for (const ch of word) {
      if (part && measure(part + ch) > maxWidth) { lines.push(part); part = ''; }
      part += ch;
    }
    line = part;
  }
  if (line) lines.push(line);
  return lines;
}

export function photoDownloadName(info: {
  kind: string; station?: string | null; methodCode?: string | null; methodName?: string | null;
  unit?: string | null; taken: string; id: string;
}, original = false) {
  const station = (info.station ?? '').replace(/[\s_-]/g, '');
  const unit = info.unit && info.station && info.methodCode
    ? photoUnitCode(info.station, info.methodCode, info.unit) : info.unit ?? station;
  const subject = info.kind === 'foto_metodo' ? `${station}_${info.methodName ?? 'Metodo'}_METODO` : `${unit || 'Foto'}_UNIDAD`;
  return `${fileStem(subject)}_${fileStem(info.taken)}_${info.id.slice(0, 8)}${original ? '_SIN_ROTULO' : ''}.jpg`;
}

/** Comentario JPEG estándar: conserva metadatos también tras reducir o rotular con Skia. */
export function jpegWithPhotoMetadata(jpeg: Uint8Array, metadata: Record<string, unknown>): Uint8Array {
  if (jpeg[0] !== 255 || jpeg[1] !== 216) throw new Error('La salida no es un JPEG válido');
  const body = new TextEncoder().encode(JSON.stringify(metadata));
  if (body.length > 65533) throw new Error('Metadatos de fotografía demasiado largos');
  const length = body.length + 2;
  const result = new Uint8Array(jpeg.length + body.length + 4);
  result.set(jpeg.subarray(0,2));
  result.set([255,254,length >> 8,length & 255],2);
  result.set(body,6); result.set(jpeg.subarray(2),6+body.length);
  return result;
}
