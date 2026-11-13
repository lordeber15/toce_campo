import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { WEB_ROLES } from '@toce/shared';
import { db } from '../db/index.js';
import { computeTracking } from '../lib/tracking.js';
import { idParam, notFound, projectParam } from '../lib/http.js';

const dateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/**
 * Seguimiento del avance (Fase 2): tablero del proyecto y vista por brigada.
 * Lectura para coordinación, supervisión y jefatura de proyecto.
 */
const trackingRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.requireRoles(...WEB_ROLES, 'jefe_proyecto');

  r.get('/projects/:projectId/tracking', { onRequest: read, schema: { params: projectParam, querystring: dateQuery } }, async (req) =>
    computeTracking(req.params.projectId, { today: req.query.date }));

  r.get('/brigades/:id/tracking', { onRequest: read, schema: { params: idParam, querystring: dateQuery } }, async (req) => {
    const b = (await db.execute(sql`SELECT project_id AS "projectId" FROM brigades WHERE id = ${req.params.id}`)).rows[0] as { projectId: string } | undefined;
    if (!b) throw notFound('Brigada');
    const t = await computeTracking(b.projectId, { today: req.query.date, brigadeId: req.params.id });
    const brigade = t.brigades[0]!;
    const alerts = (await db.execute(sql`
      SELECT i.id, i.type, i.status, i.description, i.occurred_at AS "occurredAt", u.full_name AS "reportedBy", s.code AS "stationCode",
        su.code AS "unitCode", i.launched_from AS "launchedFrom"
      FROM incidents i JOIN users u ON u.id = i.reported_by_id
      LEFT JOIN stations s ON s.id = i.station_id LEFT JOIN sampling_units su ON su.id = i.sampling_unit_id
      WHERE i.brigade_id = ${req.params.id}
      ORDER BY CASE WHEN i.status IN ('abierta', 'en_revision') THEN 0 ELSE 1 END, i.occurred_at DESC
      LIMIT 50`)).rows;
    const reschedules = (await db.execute(sql`
      SELECT r.id, s.code AS "stationCode", to_char(r.from_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "fromDate",
        to_char(r.to_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "toDate", r.reason, r.status, au.full_name AS "approvedByName",
        r.approved_at AS "approvedAt", r.incident_id AS "incidentId"
      FROM reschedules r JOIN schedules sc ON sc.id = r.schedule_id JOIN stations s ON s.id = sc.station_id
      LEFT JOIN users au ON au.id = r.approved_by_id
      WHERE sc.brigade_id = ${req.params.id} ORDER BY r.created_at DESC`)).rows;
    return { today: t.today, curve: t.curve, brigade, alerts, reschedules };
  });
};

export default trackingRoutes;
