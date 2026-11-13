import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const id = () => uuid('id').primaryKey().defaultRandom();
export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const deletedAt = () => timestamp('deleted_at', { withTimezone: true });
export const nowSql = sql`now()`;

import { customType } from 'drizzle-orm/pg-core';

export type XY = { x: number; y: number };

/** Lee un punto desde EWKB hex (lo que devuelve PostGIS). */
function parseEwkbPoint(hex: string): XY {
  const buf = Buffer.from(hex, 'hex');
  const le = buf[0] === 1;
  const type = le ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  let off = 5;
  if (type & 0x20000000) off += 4; // trae SRID
  const x = le ? buf.readDoubleLE(off) : buf.readDoubleBE(off);
  const y = le ? buf.readDoubleLE(off + 8) : buf.readDoubleBE(off + 8);
  return { x, y };
}

/** Punto WGS84 (SRID 4326). x = longitud, y = latitud. */
export const pointGeom = customType<{ data: XY; driverData: string }>({
  dataType: () => 'geometry(Point,4326)',
  toDriver: (v) => `SRID=4326;POINT(${v.x} ${v.y})`,
  fromDriver: (v) => parseEwkbPoint(v),
});

/**
 * Geometría cualquiera WGS84 (polígonos, líneas, multi*). Se escribe/lee con funciones SQL
 * (ST_GeomFromGeoJSON / ST_AsGeoJSON); el valor en TS es el EWKB crudo.
 */
export const anyGeom = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(Geometry,4326)',
});
