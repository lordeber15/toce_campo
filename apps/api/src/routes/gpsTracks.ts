import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { sql, type SQL } from 'drizzle-orm';
import {
  TRACK_GAP_SECONDS, WEB_ROLES, trackQuerySchema, trackSyncSchema,
  type TrackGroupDto, type TrackSessionDto,
} from '@toce/shared';
import { db } from '../db/index.js';
import { HttpError, notFound, projectParam } from '../lib/http.js';
import { canWorkStation } from './field.js';
import { iso } from './records.js';

/**
 * Tracking GPS por estación de muestreo:
 * - POST /field/tracks: el teléfono envía un tramo (activar → desactivar) con un lote de puntos. Idempotente.
 * - GET  /projects/:projectId/tracks: recorridos por especialista y EM, con total acumulado (web).
 */
const gpsTracksRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.requireRoles(...WEB_ROLES, 'jefe_proyecto');

  r.post('/field/tracks', { onRequest: app.authenticate, schema: { body: trackSyncSchema } }, async (req) => {
    const t = req.body;
    const userId = req.user.sub;
    const st = (await db.execute(sql`SELECT project_id AS "projectId" FROM stations WHERE id = ${t.stationId} AND deleted_at IS NULL`))
      .rows[0] as { projectId: string } | undefined;
    if (!st) throw notFound('Estación');
    if (!(await canWorkStation(userId, req.user.roles, t.stationId))) throw new HttpError(403, 'No tienes programación en esta estación');

    const point = (la?: number | null, ln?: number | null) =>
      la != null && ln != null ? sql`ST_SetSRID(ST_MakePoint(${ln}, ${la}), 4326)` : sql`NULL`;

    return db.transaction(async (tx) => {
      const prev = (await tx.execute(sql`
        SELECT id, user_id AS "userId", client_updated_at AS "clientUpdatedAt" FROM track_sessions WHERE client_id = ${t.clientId} FOR UPDATE`))
        .rows[0] as { id: string; userId: string; clientUpdatedAt: string | Date } | undefined;
      if (prev && prev.userId !== userId) throw new HttpError(403, 'Este tracking pertenece a otro usuario');

      let id = prev?.id;
      if (!prev) {
        id = ((await tx.execute(sql`
          INSERT INTO track_sessions (client_id, user_id, project_id, station_id, schedule_id, brigade_id, started_at, start_geom, start_accuracy,
            ended_at, end_geom, end_accuracy, device_id, client_updated_at)
          VALUES (${t.clientId}, ${userId}, ${st.projectId}, ${t.stationId}, ${t.scheduleId ?? null}, ${t.brigadeId ?? null}, ${t.startedAt},
            ${point(t.startLat, t.startLng)}, ${t.startAccuracy ?? null}, ${t.endedAt ?? null}, ${point(t.endLat, t.endLng)}, ${t.endAccuracy ?? null},
            ${t.deviceId ?? null}, ${t.clientUpdatedAt})
          RETURNING id`)).rows[0] as { id: string }).id;
      } else if (new Date(prev.clientUpdatedAt).getTime() <= new Date(t.clientUpdatedAt).getTime()) {
        // Última escritura gana (hora del teléfono): un reenvío antiguo no reabre un tramo ya cerrado.
        await tx.execute(sql`
          UPDATE track_sessions SET ended_at = ${t.endedAt ?? null}, end_geom = COALESCE(${point(t.endLat, t.endLng)}, end_geom),
            end_accuracy = COALESCE(${t.endAccuracy ?? null}, end_accuracy), client_updated_at = ${t.clientUpdatedAt}, updated_at = now()
          WHERE id = ${id!}`);
      }

      let received = 0;
      if (t.points.length) {
        const res = await tx.execute(sql`
          INSERT INTO track_points (session_id, recorded_at, geom, accuracy, altitude)
          SELECT ${id!}, (p->>'at')::timestamptz, ST_SetSRID(ST_MakePoint((p->>'lng')::float8, (p->>'lat')::float8), 4326),
            (p->>'accuracy')::float8, (p->>'altitude')::float8
          FROM jsonb_array_elements(${JSON.stringify(t.points)}::jsonb) p
          ON CONFLICT (session_id, recorded_at) DO NOTHING`);
        received = res.rowCount ?? 0;
      }
      return { id: id!, clientId: t.clientId, received };
    });
  });

  r.get(
    '/projects/:projectId/tracks',
    { onRequest: read, schema: { params: projectParam, querystring: trackQuerySchema } },
    async (req): Promise<TrackGroupDto[]> => {
      const q = req.query;
      const where: SQL[] = [sql`t.project_id = ${req.params.projectId}`];
      if (q.brigadeId) where.push(sql`t.brigade_id = ${q.brigadeId}`);
      if (q.stationId) where.push(sql`t.station_id = ${q.stationId}`);
      if (q.userId) where.push(sql`t.user_id = ${q.userId}`);
      if (q.from) where.push(sql`(t.started_at AT TIME ZONE 'America/Lima')::date >= ${q.from}::date`);
      if (q.to) where.push(sql`(t.started_at AT TIME ZONE 'America/Lima')::date <= ${q.to}::date`);

      const sessions = (await db.execute(sql`
        SELECT t.id, t.station_id AS "stationId", s.code AS "stationCode", t.user_id AS "userId", u.full_name AS "userName",
          t.brigade_id AS "brigadeId", b.name AS "brigadeName",
          ${iso(sql`t.started_at`)} AS "startedAt", CASE WHEN t.ended_at IS NULL THEN NULL ELSE ${iso(sql`t.ended_at`)} END AS "endedAt",
          ST_Y(t.start_geom) AS "startLat", ST_X(t.start_geom) AS "startLng", ST_Y(t.end_geom) AS "endLat", ST_X(t.end_geom) AS "endLng"
        FROM track_sessions t
        JOIN stations s ON s.id = t.station_id
        JOIN users u ON u.id = t.user_id
        LEFT JOIN brigades b ON b.id = t.brigade_id
        WHERE ${sql.join(where, sql` AND `)}
        ORDER BY s.code, u.full_name, t.started_at
        LIMIT 3000`)).rows as {
        id: string; stationId: string; stationCode: string; userId: string; userName: string; brigadeId: string | null; brigadeName: string | null;
        startedAt: string; endedAt: string | null; startLat: number | null; startLng: number | null; endLat: number | null; endLng: number | null;
      }[];
      if (!sessions.length) return [];

      const ids = sessions.map((s) => s.id);
      const pts = (await db.execute(sql`
        SELECT session_id AS "sessionId", extract(epoch FROM recorded_at)::float8 AS t, ST_X(geom) AS lng, ST_Y(geom) AS lat
        FROM track_points WHERE session_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        ORDER BY session_id, recorded_at`)).rows as { sessionId: string; t: number; lng: number; lat: number }[];
      const bySession = new Map<string, { t: number; lng: number; lat: number }[]>();
      for (const p of pts) {
        const list = bySession.get(p.sessionId);
        if (list) list.push(p);
        else bySession.set(p.sessionId, [p]);
      }

      const now = Date.now() / 1000;
      const groups = new Map<string, TrackGroupDto>();
      for (const s of sessions) {
        const start = new Date(s.startedAt).getTime() / 1000;
        const end = s.endedAt ? new Date(s.endedAt).getTime() / 1000 : now;
        const list = bySession.get(s.id) ?? [];
        // Huecos: tramos sin lecturas de GPS (incluye el inicio y el final del tramo).
        const times = [start, ...list.map((p) => p.t), end];
        let gapSec = 0;
        let gaps = 0;
        for (let i = 1; i < times.length; i++) {
          const d = times[i]! - times[i - 1]!;
          if (d > TRACK_GAP_SECONDS) { gapSec += d; gaps++; }
        }
        const session: TrackSessionDto = {
          id: s.id, startedAt: s.startedAt, endedAt: s.endedAt,
          start: s.startLat != null && s.startLng != null ? { lat: s.startLat, lng: s.startLng } : null,
          end: s.endLat != null && s.endLng != null ? { lat: s.endLat, lng: s.endLng } : null,
          durationSec: Math.max(0, Math.round(end - start)), pointCount: list.length, gapSec: Math.round(gapSec), gaps,
          line: list.map((p) => [p.lng, p.lat]),
        };
        const key = `${s.stationId}|${s.userId}`;
        let g = groups.get(key);
        if (!g) {
          g = { stationId: s.stationId, stationCode: s.stationCode, userId: s.userId, userName: s.userName, brigadeId: s.brigadeId,
            brigadeName: s.brigadeName, totalSec: 0, active: false, sessions: [] };
          groups.set(key, g);
        }
        g.sessions.push(session);
        g.totalSec += session.durationSec;
        if (!s.endedAt) g.active = true;
      }
      return [...groups.values()];
    },
  );
};

export default gpsTracksRoutes;
