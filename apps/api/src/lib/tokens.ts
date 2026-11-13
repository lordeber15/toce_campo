import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const randomToken = () => randomBytes(48).toString('base64url');

/** "15m" | "30d" | "12h" -> milisegundos */
export function ttlToMs(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) throw new Error(`TTL inválido: ${ttl}`);
  const n = Number(m[1]);
  return n * { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7 }[m[2] as 's' | 'm' | 'h' | 'd'];
}
