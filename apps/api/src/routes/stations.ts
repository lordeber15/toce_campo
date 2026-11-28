import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ADMIN_ROLES, WEB_ROLES, stationMethodsSchema, stationSchema } from '@toce/shared';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { classifyStations } from '../lib/geo.js';
import { conflict, idParam, isUniqueViolation, notFound, projectParam } from '../lib/http.js';
import { syncStationMethods, usedUnitSql } from '../lib/stationMethods.js';

const { stations, samplingUnits } = schema;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const stationsRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.requireRoles(...WEB_ROLES, 'jefe_proyecto');
  const write = app.requireRoles(...ADMIN_ROLES);

  r.get('/projects/:projectId/stations', { onRequest: read, schema: { params: projectParam } }, async (req) => {
    const rows = await app.db.execute(sql`
      SELECT s.id, s.code, s.name, ST_Y(s.geom) AS lat, ST_X(s.geom) AS lng, s.altitude,
        s.vegetation_unit AS "vegetationUnit", s.influence_area AS "influenceArea", s.overlap, s.access_notes AS "accessNotes", s.status,
        s.influence_locked AS "influenceLocked", s.vegetation_locked AS "vegetationLocked",
        coalesce((SELECT json_agg(json_build_object(
            'methodId', m.id, 'code', m.code, 'name', m.name, 'specialtyId', m.specialty_id, 'specialtyCode', sp.code,
            'isOpenEnded', m.is_open_ended, 'unitsRequired', sm.units_required, 'brigadeId', sm.brigade_id,
            'unitsDone', (SELECT count(*) FROM sampling_units u WHERE u.station_method_id = sm.id AND u.status = 'completada'))
          ORDER BY sp.sort_order, m.sort_order)
          FROM station_methods sm JOIN methods m ON m.id = sm.method_id JOIN specialties sp ON sp.id = m.specialty_id
          WHERE sm.station_id = s.id), '[]') AS methods,
        (SELECT count(*)::int FROM sampling_units u WHERE u.station_id = s.id AND u.retired_at IS NULL) AS units,
        (SELECT count(*)::int FROM schedules sc WHERE sc.station_id = s.id) AS schedules
      FROM stations s WHERE s.project_id = ${req.params.projectId} AND s.deleted_at IS NULL
      ORDER BY s.code`);
    return rows.rows;
  });

  r.get('/stations/:id/units', { onRequest: read, schema: { params: idParam } }, async (req) => {
    const rows = await app.db.execute(sql`
      SELECT u.id, u.code, u.seq, u.status, m.code AS "methodCode", m.name AS "methodName", sp.code AS "specialtyCode"
      FROM sampling_units u JOIN methods m ON m.id = u.method_id JOIN specialties sp ON sp.id = m.specialty_id
      WHERE u.station_id = ${req.params.id} AND u.retired_at IS NULL ORDER BY sp.sort_order, m.sort_order, u.seq`);
    return rows.rows;
  });

  const createBody = stationSchema.extend({ methods: stationMethodsSchema.shape.methods.optional() });

  async function createStation(tx: Tx, projectId: string, body: z.infer<typeof createBody>) {
    const { methods: ms, lat, lng, ...data } = body;
    // Libera el código si existía una estación eliminada con el mismo código.
    await tx.execute(sql`UPDATE stations SET code = code || '~' || extract(epoch from now())::bigint
      WHERE project_id = ${projectId} AND code = ${data.code.toUpperCase()} AND deleted_at IS NOT NULL`);
    const [s] = await tx.insert(stations).values({ ...data, code: data.code.toUpperCase(), projectId, geom: { x: lng, y: lat } }).returning({ id: stations.id, code: stations.code });
    if (ms?.length) await syncStationMethods(tx, s!.id, s!.code, ms);
    await classifyStations(tx, projectId, s!.id);
    return s!;
  }

  r.post('/projects/:projectId/stations', { onRequest: write, schema: { params: projectParam, body: createBody } }, async (req, reply) => {
    try {
      const s = await app.db.transaction(async (tx) => {
        const s = await createStation(tx, req.params.projectId, req.body);
        await audit(req, 'station', s.id, 'create', { after: req.body }, tx);
        return s;
      });
      return reply.code(201).send(s);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict(`Ya existe la estación ${req.body.code.toUpperCase()} en el proyecto`);
      throw e;
    }
  });

  /** Importación masiva (desde puntos de un KMZ o una planilla). Las existentes (mismo código) se actualizan. */
  r.post(
    '/projects/:projectId/stations/import',
    { onRequest: write, schema: { params: projectParam, body: z.object({ stations: z.array(stationSchema).min(1).max(2000) }) } },
    async (req) => {
      const projectId = req.params.projectId;
      return app.db.transaction(async (tx) => {
        let created = 0;
        let updated = 0;
        for (const st of req.body.stations) {
          const code = st.code.toUpperCase();
          const [ex] = await tx.select({ id: stations.id }).from(stations).where(and(eq(stations.projectId, projectId), eq(stations.code, code)));
          const { lat, lng, ...data } = st;
          if (ex) {
            await tx.update(stations).set({ ...data, code, geom: { x: lng, y: lat }, deletedAt: null }).where(eq(stations.id, ex.id));
            updated++;
          } else {
            await tx.insert(stations).values({ ...data, code, projectId, geom: { x: lng, y: lat } });
            created++;
          }
        }
        await classifyStations(tx, projectId);
        await audit(req, 'station', null, 'import', { after: { projectId, created, updated } }, tx);
        return { created, updated };
      });
    },
  );

  /** influenceLocked / vegetationLocked: si true, las capas KMZ ya no cambian ese dato. */
  const patchBody = stationSchema.partial().extend({ influenceLocked: z.boolean().optional(), vegetationLocked: z.boolean().optional() });

  r.patch('/stations/:id', { onRequest: write, schema: { params: idParam, body: patchBody } }, async (req) => {
    try {
      return await app.db.transaction(async (tx) => {
        const [cur] = await tx.select().from(stations).where(and(eq(stations.id, req.params.id), isNull(stations.deletedAt)));
        if (!cur) throw notFound('Estación');
        const { lat, lng, ...data } = req.body;
        const patch: Record<string, unknown> = { ...data };
        if (data.code) patch.code = data.code.toUpperCase();
        if (lat !== undefined || lng !== undefined) patch.geom = { x: lng ?? cur.geom.x, y: lat ?? cur.geom.y };

        // Cambio de código: recodifica unidades si ninguna tiene trabajo de campo.
        if (patch.code && patch.code !== cur.code) {
          const [used] = await tx.select({ code: samplingUnits.code }).from(samplingUnits).where(and(eq(samplingUnits.stationId, cur.id), usedUnitSql)).limit(1);
          if (used) throw conflict('No se puede cambiar el código: la estación ya tiene unidades con trabajo de campo');
          await tx.execute(sql`
            UPDATE sampling_units u SET code = ${patch.code as string} || '-' || m.code || lpad(u.seq::text, 2, '0')
            FROM methods m WHERE m.id = u.method_id AND u.station_id = ${cur.id}`);
        }
        await tx.update(stations).set(patch).where(eq(stations.id, cur.id));
        await classifyStations(tx, cur.projectId, cur.id);
        await audit(req, 'station', cur.id, 'update', { before: { ...cur, geom: undefined }, after: req.body }, tx);
        return { ok: true };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Ya existe una estación con ese código');
      throw e;
    }
  });

  r.put('/stations/:id/methods', { onRequest: write, schema: { params: idParam, body: stationMethodsSchema } }, async (req) => {
    return app.db.transaction(async (tx) => {
      const [s] = await tx.select({ id: stations.id, code: stations.code }).from(stations).where(and(eq(stations.id, req.params.id), isNull(stations.deletedAt)));
      if (!s) throw notFound('Estación');
      await syncStationMethods(tx, s.id, s.code, req.body.methods);
      await audit(req, 'station_methods', s.id, 'update', { after: req.body.methods }, tx);
      const [{ count }] = (await tx.execute(sql`SELECT count(*)::int AS count FROM sampling_units WHERE station_id = ${s.id}`)).rows as [{ count: number }];
      return { ok: true, units: count };
    });
  });

  r.delete('/stations/:id', { onRequest: write, schema: { params: idParam } }, async (req) => {
    return app.db.transaction(async (tx) => {
      const [used] = await tx.select({ code: samplingUnits.code }).from(samplingUnits).where(and(eq(samplingUnits.stationId, req.params.id), usedUnitSql)).limit(1);
      if (used) throw conflict('La estación tiene trabajo de campo registrado; no se puede eliminar');
      const [sch] = (await tx.execute(sql`SELECT count(*)::int AS n FROM schedules WHERE station_id = ${req.params.id}`)).rows as [{ n: number }];
      if (sch.n) throw conflict(`La estación está en el cronograma (${sch.n} programaciones). Quítala del cronograma primero.`);
      const [s] = await tx.update(stations).set({ deletedAt: new Date() }).where(and(eq(stations.id, req.params.id), isNull(stations.deletedAt))).returning({ id: stations.id });
      if (!s) throw notFound('Estación');
      await audit(req, 'station', s.id, 'delete', undefined, tx);
      return { ok: true };
    });
  });
};
export default stationsRoutes;
