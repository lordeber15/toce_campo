import { and, inArray, isNull, sql } from 'drizzle-orm';
import { unitCode } from '@toce/shared';
import { db, schema } from '../db/index.js';
import { badRequest, conflict } from './http.js';

const { stationMethods, samplingUnits, methods } = schema;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Unidades que ya tienen trabajo de campo y no se pueden borrar ni recodificar. */
export const usedUnitSql = sql`(${samplingUnits.status} <> 'pendiente' OR EXISTS (SELECT 1 FROM executions e WHERE e.sampling_unit_id = ${samplingUnits.id}))`;

export type StationMethodItem = {
  methodId: string;
  unitsRequired: number;
  /** undefined = no tocar; null = sin brigada asignada. */
  brigadeId?: string | null;
  notes?: string | null;
};
export type StationMethodsSet = { stationId: string; stationCode: string; items: StationMethodItem[] };

const chunk = <T,>(a: T[], n = 1000) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/**
 * Sincroniza los métodos de varias estaciones y sus unidades de muestreo (en lote).
 * - Crea unidades faltantes (EM-23-PC01..N), siguiendo el correlativo.
 * - Al reducir, borra solo las últimas unidades sin trabajo de campo (si no, error 409).
 * - Métodos abiertos (isOpenEnded: RO, clase EVENTO) no generan unidades por adelantado.
 * - removeMissing: quita los métodos de la estación que no vienen en la lista (si no tienen trabajo de campo).
 * Devuelve cuántas unidades creó.
 */
export async function syncStationMethodsBulk(tx: Tx, sets: StationMethodsSet[], opts: { removeMissing: boolean }) {
  for (const s of sets) {
    if (new Set(s.items.map((i) => i.methodId)).size !== s.items.length) throw badRequest(`Método repetido en ${s.stationCode}`);
  }
  const methodIds = [...new Set(sets.flatMap((s) => s.items.map((i) => i.methodId)))];
  const ms = methodIds.length ? await tx.select({ id: methods.id, code: methods.code, isOpenEnded: methods.isOpenEnded }).from(methods).where(inArray(methods.id, methodIds)) : [];
  if (ms.length !== methodIds.length) throw badRequest('Algún método no existe');
  const methodById = new Map(ms.map((m) => [m.id, m]));

  const stationIds = sets.map((s) => s.stationId);
  if (!stationIds.length) return 0;
  const current = (
    await Promise.all(chunk(stationIds).map((ids) => tx.select().from(stationMethods).where(inArray(stationMethods.stationId, ids))))
  ).flat();
  const key = (stationId: string, methodId: string) => `${stationId}|${methodId}`;
  const currentByKey = new Map(current.map((c) => [key(c.stationId, c.methodId), c]));

  // Quitar métodos que ya no están.
  if (opts.removeMissing) {
    const wanted = new Set(sets.flatMap((s) => s.items.map((i) => key(s.stationId, i.methodId))));
    const gone = current.filter((c) => !wanted.has(key(c.stationId, c.methodId)));
    if (gone.length) {
      const used = await tx
        .select({ code: samplingUnits.code })
        .from(samplingUnits)
        .where(and(inArray(samplingUnits.stationMethodId, gone.map((g) => g.id)), usedUnitSql))
        .limit(3);
      if (used.length) throw conflict(`No se puede quitar el método: tiene unidades con trabajo de campo (${used.map((u) => u.code).join(', ')})`);
      await tx.delete(samplingUnits).where(inArray(samplingUnits.stationMethodId, gone.map((g) => g.id)));
      await tx.delete(stationMethods).where(inArray(stationMethods.id, gone.map((g) => g.id)));
    }
  }

  // Altas y cambios de station_methods.
  const toInsert: (typeof stationMethods.$inferInsert)[] = [];
  const smFor = new Map<string, { id: string; units: number; stationId: string; stationCode: string; methodId: string }>();
  for (const s of sets) {
    for (const it of s.items) {
      const m = methodById.get(it.methodId)!;
      const units = m.isOpenEnded ? 0 : it.unitsRequired;
      const cur = currentByKey.get(key(s.stationId, it.methodId));
      if (!cur) {
        toInsert.push({ stationId: s.stationId, methodId: it.methodId, unitsRequired: units, brigadeId: it.brigadeId ?? null, notes: it.notes ?? null });
        continue;
      }
      const patch: Partial<typeof stationMethods.$inferInsert> = {};
      if (cur.unitsRequired !== units) patch.unitsRequired = units;
      if (it.brigadeId !== undefined && cur.brigadeId !== it.brigadeId) patch.brigadeId = it.brigadeId;
      if (it.notes !== undefined && cur.notes !== it.notes) patch.notes = it.notes;
      if (Object.keys(patch).length) await tx.update(stationMethods).set(patch).where(sql`${stationMethods.id} = ${cur.id}`);
      smFor.set(key(s.stationId, it.methodId), { id: cur.id, units, stationId: s.stationId, stationCode: s.stationCode, methodId: it.methodId });
    }
  }
  const codeByStation = new Map(sets.map((s) => [s.stationId, s.stationCode]));
  for (const part of chunk(toInsert)) {
    const rows = await tx.insert(stationMethods).values(part).returning({ id: stationMethods.id, stationId: stationMethods.stationId, methodId: stationMethods.methodId, unitsRequired: stationMethods.unitsRequired });
    for (const r of rows) smFor.set(key(r.stationId, r.methodId), { id: r.id, units: r.unitsRequired, stationId: r.stationId, stationCode: codeByStation.get(r.stationId)!, methodId: r.methodId });
  }

  // Unidades: crear las que faltan y quitar las últimas sobrantes.
  const closed = [...smFor.values()].filter((x) => !methodById.get(x.methodId)!.isOpenEnded);
  const existing = closed.length
    ? (
        await Promise.all(
          chunk(closed.map((c) => c.id)).map((ids) =>
            tx
              .select({ id: samplingUnits.id, smId: samplingUnits.stationMethodId, seq: samplingUnits.seq, code: samplingUnits.code, used: sql<boolean>`${usedUnitSql}` })
              .from(samplingUnits)
              .where(and(inArray(samplingUnits.stationMethodId, ids), isNull(samplingUnits.clientId))),
          ),
        )
      ).flat()
    : [];
  const unitsBySm = new Map<string, typeof existing>();
  for (const u of existing) unitsBySm.set(u.smId, [...(unitsBySm.get(u.smId) ?? []), u]);

  const toAdd: (typeof samplingUnits.$inferInsert)[] = [];
  const toRemove: string[] = [];
  for (const c of closed) {
    const m = methodById.get(c.methodId)!;
    const ex = unitsBySm.get(c.id) ?? [];
    const maxSeq = ex.reduce((a, u) => Math.max(a, u.seq), 0);
    if (c.units > ex.length) {
      for (let seq = maxSeq + 1, n = 0; n < c.units - ex.length; seq++, n++) {
        toAdd.push({ stationMethodId: c.id, stationId: c.stationId, methodId: c.methodId, seq, code: unitCode(c.stationCode, m.code, seq) });
      }
    } else if (c.units < ex.length) {
      // Solo se quitan las últimas unidades (sin dejar huecos en la numeración).
      const removable = [...ex].sort((a, b) => b.seq - a.seq).slice(0, ex.length - c.units);
      const blocked = removable.filter((u) => u.used);
      if (blocked.length) {
        throw conflict(`${c.stationCode} ${m.code}: no se puede bajar a ${c.units} unidades porque ${blocked.map((u) => u.code).join(', ')} ya tiene trabajo de campo`);
      }
      toRemove.push(...removable.map((u) => u.id));
    }
  }
  for (const part of chunk(toRemove)) await tx.delete(samplingUnits).where(inArray(samplingUnits.id, part));
  for (const part of chunk(toAdd)) await tx.insert(samplingUnits).values(part);
  return toAdd.length;
}

/** Sincroniza los métodos de una estación (reemplazo completo de la lista). */
export async function syncStationMethods(tx: Tx, stationId: string, stationCode: string, items: StationMethodItem[]) {
  if (new Set(items.map((i) => i.methodId)).size !== items.length) throw badRequest('Método repetido');
  return syncStationMethodsBulk(tx, [{ stationId, stationCode, items }], { removeMissing: true });
}
