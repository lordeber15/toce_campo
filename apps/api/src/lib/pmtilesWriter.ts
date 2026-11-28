import { createHash } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { gzipSync } from 'node:zlib';
import { zxyToTileId } from 'pmtiles';

/**
 * Escritor mínimo de PMTiles v3 (un solo archivo con todas las teselas e índice).
 * Especificación: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 * MapLibre Native lo lee desde el teléfono con `pmtiles://file://…`, sin internet.
 */

export type PmHeaderInfo = {
  tileType: 'webp' | 'jpeg' | 'png';
  minZoom: number;
  maxZoom: number;
  bounds: [number, number, number, number];
  metadata?: Record<string, unknown>;
};

type Entry = { tileId: number; offset: number; length: number; runLength: number };

const TILE_TYPE = { png: 2, jpeg: 3, webp: 4 } as const;
const HEADER_BYTES = 127;
const ROOT_MAX = 16384 - HEADER_BYTES;

function varints(nums: number[]): Buffer {
  const out: number[] = [];
  for (let n of nums) {
    // Números enteros no negativos (pueden pasar de 2^32: no usar operadores de bits).
    while (n >= 0x80) {
      out.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    out.push(n);
  }
  return Buffer.from(out);
}

function serializeDirectory(entries: Entry[]): Buffer {
  const nums: number[] = [entries.length];
  let last = 0;
  for (const e of entries) { nums.push(e.tileId - last); last = e.tileId; }
  for (const e of entries) nums.push(e.runLength);
  for (const e of entries) nums.push(e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    nums.push(i > 0 && prev && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  });
  return gzipSync(varints(nums));
}

/** Raíz que entra en los primeros 16 KB; si no entra, se reparte en directorios hoja. */
function buildDirectories(entries: Entry[]): { root: Buffer; leaves: Buffer } {
  const direct = serializeDirectory(entries);
  if (direct.length <= ROOT_MAX) return { root: direct, leaves: Buffer.alloc(0) };
  for (let leafSize = 4096; ; leafSize *= 2) {
    const rootEntries: Entry[] = [];
    const parts: Buffer[] = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const leaf = serializeDirectory(entries.slice(i, i + leafSize));
      rootEntries.push({ tileId: entries[i]!.tileId, offset, length: leaf.length, runLength: 0 });
      parts.push(leaf);
      offset += leaf.length;
    }
    const root = serializeDirectory(rootEntries);
    if (root.length <= ROOT_MAX) return { root, leaves: Buffer.concat(parts) };
  }
}

const u64 = (buf: Buffer, pos: number, n: number) => buf.writeBigUInt64LE(BigInt(n), pos);
const e7 = (deg: number) => Math.round(deg * 1e7);

/**
 * Construye el archivo en disco: las teselas se agregan en orden de tileId (ver `tileIdOf`) y se
 * escriben a un temporal, así no quedan todas en memoria. Las teselas idénticas se guardan una vez.
 */
export class PmtilesBuilder {
  private entries: Entry[] = [];
  private seen = new Map<string, { offset: number; length: number }>();
  private dataLen = 0;
  private count = 0;
  private lastId = -1;
  private readonly dataPath: string;
  private fd: number;

  constructor(private readonly outPath: string) {
    this.dataPath = `${outPath}.data`;
    this.fd = openSync(this.dataPath, 'w');
  }

  add(z: number, x: number, y: number, data: Buffer) {
    const tileId = zxyToTileId(z, x, y);
    if (tileId <= this.lastId) throw new Error('Las teselas deben agregarse en orden de tileId');
    this.lastId = tileId;
    this.count++;
    const key = createHash('sha1').update(data).digest('base64');
    let at = this.seen.get(key);
    if (!at) {
      at = { offset: this.dataLen, length: data.length };
      this.seen.set(key, at);
      writeSync(this.fd, data);
      this.dataLen += data.length;
    }
    const prev = this.entries[this.entries.length - 1];
    // Teselas seguidas con el mismo contenido: una sola entrada con runLength.
    if (prev && prev.offset === at.offset && prev.tileId + prev.runLength === tileId) prev.runLength++;
    else this.entries.push({ tileId, offset: at.offset, length: at.length, runLength: 1 });
  }

  get tiles() { return this.count; }

  /** Escribe cabecera + índice + datos en `outPath` y devuelve su tamaño. */
  async finish(info: PmHeaderInfo): Promise<number> {
    closeSync(this.fd);
    const { root, leaves } = buildDirectories(this.entries);
    const metadata = gzipSync(Buffer.from(JSON.stringify(info.metadata ?? {})));
    const rootOff = HEADER_BYTES;
    const metaOff = rootOff + root.length;
    const leafOff = metaOff + metadata.length;
    const dataOff = leafOff + leaves.length;

    const h = Buffer.alloc(HEADER_BYTES);
    h.write('PMTiles', 0, 'ascii');
    h.writeUInt8(3, 7);
    u64(h, 8, rootOff); u64(h, 16, root.length);
    u64(h, 24, metaOff); u64(h, 32, metadata.length);
    u64(h, 40, leafOff); u64(h, 48, leaves.length);
    u64(h, 56, dataOff); u64(h, 64, this.dataLen);
    u64(h, 72, this.count); u64(h, 80, this.entries.length); u64(h, 88, this.seen.size);
    h.writeUInt8(1, 96); // clustered: los datos siguen el orden de tileId
    h.writeUInt8(2, 97); // índice comprimido con gzip
    h.writeUInt8(1, 98); // teselas sin comprimir (ya son imágenes)
    h.writeUInt8(TILE_TYPE[info.tileType], 99);
    h.writeUInt8(info.minZoom, 100);
    h.writeUInt8(info.maxZoom, 101);
    const [w, s, e, n] = info.bounds;
    h.writeInt32LE(e7(w), 102); h.writeInt32LE(e7(s), 106); h.writeInt32LE(e7(e), 110); h.writeInt32LE(e7(n), 114);
    h.writeUInt8(info.minZoom, 118);
    h.writeInt32LE(e7((w + e) / 2), 119); h.writeInt32LE(e7((s + n) / 2), 123);

    writeFileSync(this.outPath, Buffer.concat([h, root, metadata, leaves]));
    await pipeline(createReadStream(this.dataPath), createWriteStream(this.outPath, { flags: 'a' }));
    rmSync(this.dataPath, { force: true });
    return dataOff + this.dataLen;
  }

  /** Descarta el trabajo (error o cancelación). */
  abort() {
    try { closeSync(this.fd); } catch { /* ya cerrado */ }
    rmSync(this.dataPath, { force: true });
    rmSync(this.outPath, { force: true });
  }
}

export const tileIdOf = (z: number, x: number, y: number) => zxyToTileId(z, x, y);
