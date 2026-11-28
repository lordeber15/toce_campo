import { and, inArray, sql } from 'drizzle-orm';
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
 * - Al reducir no borra: deja fuera de plan las últimas sin trabajo de campo (applyUnits).
 * - Métodos abiertos (isOpenEnded: RO, clase EVENTO) no generan unidades por adelantado.
 * - removeMissing: quita los métodos de la estación que no vienen en la lista (si no tienen trabajo de campo).
 * Devuelve cuántas unidades creó.
 */
export async function syncStationMethodsBulk(tx: Tx, sets: StationMethodsSet[], opts: { removeMissing: boolean; warnings?: string[] }) {
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

  return applyUnits(tx, [...smFor.values()].filter((x) => !methodById.get(x.methodId)!.isOpenEnded).map((c) => ({ ...c, methodCode: methodById.get(c.methodId)!.code })), opts.warnings);
}

type UnitTarget = { id: string; units: number; stationId: string; stationCode: string; methodId: string; methodCode: string };

/**
 * Deja cada método de estación con `units` unidades activas, SIN BORRAR NUNCA:
 * - Al bajar, las sobrantes sin trabajo de campo (las últimas) pasan a "fuera de plan" (retired_at).
 *   Las que ya tienen trabajo se conservan y se avisa en `warnings`.
 * - Al subir, primero se reactivan las fuera de plan (mismo código) y luego se crean las nuevas.
 * Devuelve cuántas unidades se crearon o reactivaron.
 */
export async function applyUnits(tx: Tx, targets: UnitTarget[], warnings?: string[]) {
  if (!targets.length) return 0;
  const existing = (
    await Promise.all(
      chunk(targets.map((c) => c.id)).map((ids) =>
        tx
          .select({
            id: samplingUnits.id, smId: samplingUnits.stationMethodId, seq: samplingUnits.seq, code: samplingUnits.code,
            planned: sql<boolean>`${samplingUnits.clientId} IS NULL`, retired: sql<boolean>`${samplingUnits.retiredAt} IS NOT NULL`,
            used: sql<boolean>`${usedUnitSql}`,
          })
          .from(samplingUnits)
          .where(inArray(samplingUnits.stationMethodId, ids)),
      ),
    )
  ).flat();
  const unitsBySm = new Map<string, typeof existing>();
  for (const u of existing) unitsBySm.set(u.smId, [...(unitsBySm.get(u.smId) ?? []), u]);

  const toAdd: (typeof samplingUnits.$inferInsert)[] = [];
  const toRetire: string[] = [];
  const toRevive: string[] = [];
  for (const c of targets) {
    const all = unitsBySm.get(c.id) ?? [];
    const planned = all.filter((u) => u.planned);
    const active = planned.filter((u) => !u.retired);
    // La numeración sigue después de todas (incluidas las fuera de plan y las creadas en campo).
    const maxSeq = all.reduce((a, u) => Math.max(a, u.seq), 0);
    if (c.units > active.length) {
      let need = c.units - active.length;
      const revive = planned.filter((u) => u.retired).sort((a, b) => a.seq - b.seq).slice(0, need);
      toRevive.push(...revive.map((u) => u.id));
      need -= revive.length;
      for (let seq = maxSeq + 1; need > 0; seq++, need--) {
        toAdd.push({ stationMethodId: c.id, stationId: c.stationId, methodId: c.methodId, seq, code: unitCode(c.stationCode, c.methodCode, seq) });
      }
    } else if (c.units < active.length) {
      const excess = active.length - c.units;
      const free = active.filter((u) => !u.used).sort((a, b) => b.seq - a.seq).slice(0, excess);
      toRetire.push(...free.map((u) => u.id));
      if (free.length < excess) {
        const used = active.filter((u) => u.used).length;
        warnings?.push(`${c.stationCode} ${c.methodCode}: quedan ${active.length - free.length} en vez de ${c.units} (${used} con trabajo de campo)`);
      }
    }
  }
  for (const part of chunk(toRetire)) await tx.update(samplingUnits).set({ retiredAt: new Date() }).where(inArray(samplingUnits.id, part));
  for (const part of chunk(toRevive)) await tx.update(samplingUnits).set({ retiredAt: null }).where(inArray(samplingUnits.id, part));
  for (const part of chunk(toAdd)) await tx.insert(samplingUnits).values(part);
  return toAdd.length + toRevive.length;
}

/**
 * Cambia la cantidad de unidades de un método en todas las estaciones que lo tienen
 * (o solo en las de una brigada). Devuelve cuántas estaciones cambiaron y los avisos.
 */
export async function setMethodUnits(tx: Tx, methodId: string, units: number, scope: { brigadeId?: string } = {}) {
  const [m] = await tx.select({ code: methods.code, isOpenEnded: methods.isOpenEnded }).from(methods).where(sql`${methods.id} = ${methodId}`);
  if (!m || m.isOpenEnded) return { stations: 0, warnings: [] as string[] };
  // De una brigada: los asignados a ella, o sin brigada en estaciones que ella tiene programadas.
  const brigadeCond = scope.brigadeId
    ? sql`AND (sm.brigade_id = ${scope.brigadeId} OR (sm.brigade_id IS NULL AND EXISTS (
        SELECT 1 FROM schedules sc WHERE sc.station_id = sm.station_id AND sc.brigade_id = ${scope.brigadeId})))`
    : sql``;
  const rows = (await tx.execute(sql`
    SELECT sm.id, sm.station_id AS "stationId", s.code AS "stationCode", sm.units_required AS "unitsRequired"
    FROM station_methods sm JOIN stations s ON s.id = sm.station_id
    WHERE sm.method_id = ${methodId} AND s.deleted_at IS NULL ${brigadeCond}`)).rows as { id: string; stationId: string; stationCode: string; unitsRequired: number }[];
  if (!rows.length) return { stations: 0, warnings: [] as string[] };
  const changed = rows.filter((r) => r.unitsRequired !== units).map((r) => r.id);
  for (const part of chunk(changed)) await tx.update(stationMethods).set({ unitsRequired: units }).where(inArray(stationMethods.id, part));
  const warnings: string[] = [];
  // Se aplica a todas (también corrige estaciones cuyas unidades no calzaban con lo requerido).
  await applyUnits(tx, rows.map((r) => ({ id: r.id, units, stationId: r.stationId, stationCode: r.stationCode, methodId, methodCode: m.code })), warnings);
  return { stations: changed.length, warnings };
}

/** Sincroniza los métodos de una estación (reemplazo completo de la lista). */
export async function syncStationMethods(tx: Tx, stationId: string, stationCode: string, items: StationMethodItem[]) {
  if (new Set(items.map((i) => i.methodId)).size !== items.length) throw badRequest('Método repetido');
  return syncStationMethodsBulk(tx, [{ stationId, stationCode, items }], { removeMissing: true });
}
