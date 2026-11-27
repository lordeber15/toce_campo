import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  WORK_AREA_MARGIN_DEG, WORK_PACKAGE_DAYS_AHEAD, WORK_PACKAGE_DAYS_BACK,
  type BrigadeRole, type WpBounds, type WorkPackage, type WpBrigade, type WpMethod, type WpProject, type WpSchedule,
  type WpLayer, type WpSpecies, type WpStation, type WpStationMethod, type WpUnit,
} from '@toce/shared';
import { schema } from '../db/index.js';

const list = (ids: string[]): SQL => sql.join(ids.map((i) => sql`${i}`), sql`, `);

type BrigadeRow = Omit<WpBrigade, 'members' | 'myRoles' | 'bounds' | 'boundsSource'> & {
  specialtyId: string | null;
  kmzBounds: WpBounds | null;
  stationBounds: WpBounds | null;
  isLeader: boolean;
  isMember: boolean;
  isSupervisor: boolean;
  isLogistician: boolean;
};

/** Caja [o, s, e, n] de un extent de PostGIS (NULL si no hay geometrías), redondeada a ~1 cm. */
const bbox = (extent: SQL) => sql`(SELECT CASE WHEN e IS NULL THEN NULL ELSE json_build_array(
  round(ST_XMin(e)::numeric, 7), round(ST_YMin(e)::numeric, 7), round(ST_XMax(e)::numeric, 7), round(ST_YMax(e)::numeric, 7)) END
  FROM (SELECT (${extent})::geometry AS e) x)`;

/** Unión de cajas (null si no hay ninguna). */
function unionBounds(list: WpBounds[]): WpBounds | null {
  if (!list.length) return null;
  return [
    Math.min(...list.map((b) => b[0])), Math.min(...list.map((b) => b[1])),
    Math.max(...list.map((b) => b[2])), Math.max(...list.map((b) => b[3])),
  ];
}

/** Las capas generales se recortan un poco más allá del mapa offline (margen + ~1 km). */
const CLIP_MARGIN_DEG = WORK_AREA_MARGIN_DEG + 0.01;

/**
 * Paquete de trabajo del usuario conectado: sus brigadas activas, el cronograma de
 * los próximos días, las estaciones, los métodos de su especialidad, las unidades
 * de muestreo y el catálogo de especies. El teléfono lo guarda para trabajar offline.
 */
const workPackageRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/work-package',
    {
      onRequest: app.authenticate,
      schema: {
        querystring: z.object({
          deviceId: z.string().max(100).optional(),
          /** Versión que ya tiene el teléfono: si no cambió, se responde { unchanged: true }. */
          version: z.string().max(80).optional(),
        }),
      },
    },
    async (req) => {
      const userId = req.user.sub;
      const db = app.db;

      const days = (await db.execute(sql`
        SELECT to_char(d, 'YYYY-MM-DD') AS today,
          to_char(d - ${WORK_PACKAGE_DAYS_BACK}::int, 'YYYY-MM-DD') AS "from",
          to_char(d + ${WORK_PACKAGE_DAYS_AHEAD}::int, 'YYYY-MM-DD') AS "to"
        FROM (SELECT (now() AT TIME ZONE 'America/Lima')::date AS d) x`)).rows[0] as { today: string; from: string; to: string };

      const me = (await db.execute(sql`SELECT specialty_id AS "specialtyId" FROM users WHERE id = ${userId}`)).rows[0] as
        | { specialtyId: string | null }
        | undefined;

      // Brigadas activas donde participa (como miembro, jefe, supervisor o logístico) en proyectos abiertos.
      const brigadeRows = (await db.execute(sql`
        SELECT b.id, b.project_id AS "projectId", b.code, b.name, b.specialty_id AS "specialtyId",
          sp.code AS "specialtyCode", sp.name AS "specialtyName", b.leader_id AS "leaderId", lu.full_name AS "leaderName",
          (b.leader_id = ${userId}) AS "isLeader",
          EXISTS (SELECT 1 FROM brigade_members bm WHERE bm.brigade_id = b.id AND bm.user_id = ${userId} AND bm.left_at IS NULL) AS "isMember",
          (b.supervisor_id = ${userId}) AS "isSupervisor",
          (b.logistician_id = ${userId}) AS "isLogistician",
          b.area_name AS "areaName",
          ST_AsGeoJSON(ST_SimplifyPreserveTopology(b.area_geom, 0.00002), 6)::json AS area,
          -- Zona de la brigada: sus capas KMZ; si no tiene, sus estaciones (programadas o con métodos asignados).
          ${bbox(sql`SELECT ST_Extent(l.geom) FROM project_layers l WHERE l.brigade_id = b.id`)} AS "kmzBounds",
          ${bbox(sql`SELECT ST_Extent(s.geom) FROM stations s WHERE s.deleted_at IS NULL AND s.id IN (
              SELECT sc.station_id FROM schedules sc WHERE sc.brigade_id = b.id AND sc.status <> 'cancelada'
              UNION SELECT sm.station_id FROM station_methods sm WHERE sm.brigade_id = b.id)`)} AS "stationBounds"
        FROM brigades b
        JOIN projects p ON p.id = b.project_id AND p.deleted_at IS NULL AND p.status <> 'cerrado'
        LEFT JOIN specialties sp ON sp.id = b.specialty_id
        LEFT JOIN users lu ON lu.id = b.leader_id
        WHERE b.is_active AND (
          b.leader_id = ${userId} OR b.supervisor_id = ${userId} OR b.logistician_id = ${userId}
          OR EXISTS (SELECT 1 FROM brigade_members bm WHERE bm.brigade_id = b.id AND bm.user_id = ${userId} AND bm.left_at IS NULL))
        ORDER BY b.name, b.id`)).rows as BrigadeRow[];
      const num = (b: WpBounds | null) => (b ? (b.map(Number) as WpBounds) : null);
      for (const b of brigadeRows) { b.kmzBounds = num(b.kmzBounds); b.stationBounds = num(b.stationBounds); }

      const brigadeIds = brigadeRows.map((b) => b.id);
      const projectIds = [...new Set(brigadeRows.map((b) => b.projectId))];

      const members = brigadeIds.length
        ? ((await db.execute(sql`
            SELECT bm.brigade_id AS "brigadeId", u.id, u.full_name AS "fullName", u.phone, sp.code AS "specialtyCode"
            FROM brigade_members bm JOIN users u ON u.id = bm.user_id LEFT JOIN specialties sp ON sp.id = u.specialty_id
            WHERE bm.brigade_id IN (${list(brigadeIds)}) AND bm.left_at IS NULL AND u.deleted_at IS NULL
            ORDER BY u.full_name, u.id`)).rows as ({ brigadeId: string } & WpBrigade['members'][number])[])
        : [];

      const brigades: WpBrigade[] = brigadeRows.map(({ specialtyId: _s, isLeader, isMember, isSupervisor, isLogistician, kmzBounds, stationBounds, ...b }) => {
        const myRoles: BrigadeRole[] = [];
        if (isLeader) myRoles.push('jefe');
        if (isMember && !isLeader) myRoles.push('miembro');
        if (isSupervisor) myRoles.push('supervisor');
        if (isLogistician) myRoles.push('logistico');
        return {
          ...b, myRoles, members: members.filter((m) => m.brigadeId === b.id).map(({ brigadeId: _b, ...m }) => m),
          bounds: kmzBounds ?? stationBounds, boundsSource: kmzBounds ? 'kmz' : stationBounds ? 'estaciones' : null,
        };
      });
      // Zona de trabajo del usuario en cada proyecto = unión de las zonas de sus brigadas (no todo el proyecto).
      const zones = new Map(projectIds.map((pid) => [pid, brigades.filter((b) => b.projectId === pid && b.bounds).map((b) => b.bounds!)]));

      const projects: WpProject[] = projectIds.length
        ? ((await db.execute(sql`
            SELECT p.id, p.code, p.name, p.utm_zone AS "utmZone"
            FROM projects p WHERE p.id IN (${list(projectIds)}) ORDER BY p.code`)).rows as Omit<WpProject, 'bounds'>[])
            .map((p) => ({ ...p, bounds: unionBounds(zones.get(p.id) ?? []) }))
        : [];

      const schedules: WpSchedule[] = brigadeIds.length
        ? ((await db.execute(sql`
            SELECT sc.id, sc.brigade_id AS "brigadeId", sc.station_id AS "stationId",
              to_char(sc.planned_date, 'YYYY-MM-DD') AS "plannedDate", sc.sort_order AS "sortOrder", sc.status, sc.notes,
              to_char(sc.original_date, 'YYYY-MM-DD') AS "originalDate",
              (SELECT json_build_object('fromDate', to_char(r.from_date AT TIME ZONE 'America/Lima', 'YYYY-MM-DD'), 'reason', r.reason)
                FROM reschedules r WHERE r.schedule_id = sc.id AND r.status = 'aprobada' ORDER BY r.approved_at DESC LIMIT 1) AS "lastReschedule"
            FROM schedules sc JOIN stations s ON s.id = sc.station_id AND s.deleted_at IS NULL
            WHERE sc.brigade_id IN (${list(brigadeIds)}) AND sc.status <> 'cancelada' AND sc.activity_type = 'estacion'
              AND sc.planned_date BETWEEN ${days.from}::date AND ${days.to}::date
            ORDER BY sc.planned_date, sc.sort_order, s.code, sc.id`)).rows as WpSchedule[])
        : [];

      const stationIds = [...new Set(schedules.map((s) => s.stationId))];
      const stations: WpStation[] = stationIds.length
        ? ((await db.execute(sql`
            SELECT id, project_id AS "projectId", code, name, ST_Y(geom) AS lat, ST_X(geom) AS lng, altitude,
              influence_area AS "influenceArea", vegetation_unit AS "vegetationUnit", overlap, access_notes AS "accessNotes", status
            FROM stations WHERE id IN (${list(stationIds)}) ORDER BY code, id`)).rows as WpStation[])
        : [];

      // Métodos visibles en cada estación (por cada brigada programada allí):
      // - solo los asignados a esa brigada o sin brigada asignada (station_methods.brigade_id);
      // - de la especialidad de la brigada; brigada sin especialidad (mixta): la del usuario;
      //   en ambos casos más las especialidades a las que da acceso (specialty_access: perfil botánico, Mamíferos, ABS...);
      // - si ni la brigada ni el usuario tienen especialidad (jefe de brigada, supervisor), todos los métodos.
      const grants = new Map<string, string[]>();
      for (const g of (await db.execute(sql`SELECT specialty_id AS "s", granted_id AS "g" FROM specialty_access`)).rows as { s: string; g: string }[]) {
        grants.set(g.s, [...(grants.get(g.s) ?? []), g.g]);
      }
      const access = (spec: string | null) => (spec ? [spec, ...(grants.get(spec) ?? [])] : null);
      const allowedByBrigade = new Map(brigadeRows.map((b) => [b.id, access(b.specialtyId ?? me?.specialtyId ?? null)]));
      const pairs = new Map<string, Map<string, string[] | null>>();
      for (const s of schedules) {
        const byBrigade = pairs.get(s.stationId) ?? new Map<string, string[] | null>();
        byBrigade.set(s.brigadeId, allowedByBrigade.get(s.brigadeId) ?? null);
        pairs.set(s.stationId, byBrigade);
      }
      const pairConds = [...pairs].flatMap(([stationId, byBrigade]) =>
        [...byBrigade].map(([brigadeId, specs]) =>
          sql`(sm.station_id = ${stationId} AND (sm.brigade_id IS NULL OR sm.brigade_id = ${brigadeId})${
            specs ? sql` AND m.specialty_id IN (${list(specs)})` : sql``
          })`,
        ),
      );

      const stationMethods: (WpStationMethod & { specialtyId: string })[] = pairConds.length
        ? ((await db.execute(sql`
            SELECT sm.id, sm.station_id AS "stationId", sm.method_id AS "methodId", sm.units_required AS "unitsRequired",
              sm.notes, sm.brigade_id AS "brigadeId", m.specialty_id AS "specialtyId"
            FROM station_methods sm JOIN methods m ON m.id = sm.method_id AND m.is_active
            WHERE ${sql.join(pairConds, sql` OR `)}
            ORDER BY sm.station_id, m.sort_order, m.code, sm.id`)).rows as (WpStationMethod & { specialtyId: string })[])
        : [];

      const methodIds = [...new Set(stationMethods.map((sm) => sm.methodId))];
      const methods: WpMethod[] = methodIds.length
        ? ((await db.execute(sql`
            SELECT m.id, sp.code AS "specialtyCode", m.code, m.name, m.description, m.instructions, m.is_open_ended AS "isOpenEnded",
              to_char(m.schedule_start, 'HH24:MI') AS "scheduleStart", to_char(m.schedule_end, 'HH24:MI') AS "scheduleEnd",
              m.min_duration_min AS "minDurationMin", m.requirements, m.photo_slots AS "photoSlots",
              m.method_photo_required AS "methodPhotoRequired", m.method_photo_instructions AS "methodPhotoInstructions",
              m.form_schema AS "formSchema", m.method_class AS "methodClass", m.requires_track AS "requiresTrack",
              m.photos_per_unit AS "photosPerUnit", m.schedule_text AS "scheduleText", m.guideline, sp.name AS "specialtyName"
            FROM methods m JOIN specialties sp ON sp.id = m.specialty_id
            WHERE m.id IN (${list(methodIds)}) ORDER BY sp.sort_order, m.sort_order, m.code, m.id`)).rows as WpMethod[])
        : [];

      const smIds = stationMethods.map((sm) => sm.id);
      const units: WpUnit[] = smIds.length
        ? ((await db.execute(sql`
            SELECT id, station_method_id AS "stationMethodId", station_id AS "stationId", method_id AS "methodId", seq, code, status
            FROM sampling_units WHERE station_method_id IN (${list(smIds)}) ORDER BY station_id, method_id, seq, id`)).rows as WpUnit[])
        : [];

      const specialtyIds = [...new Set(stationMethods.map((sm) => sm.specialtyId))];
      const formHosts = smIds.length ? (await db.execute(sql`
        SELECT DISTINCT ON (su.id) su.id, e.client_id AS "executionId", su.station_id AS "stationId", su.code,
          e.form_data->'header' AS header, ST_Y(e.start_geom) AS lat, ST_X(e.start_geom) AS lng
        FROM sampling_units su JOIN methods m ON m.id=su.method_id JOIN executions e ON e.sampling_unit_id=su.id
        WHERE su.station_method_id IN (${list(smIds)}) AND m.code='EPV' AND e.form_data ? 'header'
        ORDER BY su.id,e.client_updated_at DESC`)).rows as NonNullable<WorkPackage['formHosts']> : [];
      const stationForms = smIds.length ? (await db.execute(sql`
        SELECT client_id AS "clientId",station_method_id AS "stationMethodId",field_date AS "fieldDate","values",
          updated_at AS "updatedAt" FROM station_method_forms WHERE station_method_id IN (${list(smIds)}) AND specialist_id=${userId}
        ORDER BY updated_at,client_id`)).rows as NonNullable<WorkPackage['stationForms']> : [];
      const species: WpSpecies[] = specialtyIds.length
        ? ((await db.execute(sql`
            SELECT s.id, sp.code AS "specialtyCode", s.scientific_name AS "scientificName", s.common_name AS "commonName",
              s.family, s.order_name AS "order", s.conservation_status AS "conservationStatus"
            FROM species s JOIN specialties sp ON sp.id = s.specialty_id
            WHERE s.specialty_id IN (${list(specialtyIds)}) AND s.is_active
            ORDER BY sp.code, s.scientific_name, s.id`)).rows as WpSpecies[])
        : [];

      // Capas KMZ simplificadas (~2 m) para dibujarlas y verificar el área de influencia sin conexión.
      // - KMZ de las brigadas del usuario: completos (son su zona de trabajo). Los de otras brigadas no se envían.
      // - Capas generales (sin brigada: UV, AID, AII, Huella, superposición...): solo lo que cae en la zona de
      //   sus brigadas (+ margen), recortado antes de simplificar; las que no tocan la zona no se envían.
      //   Si ninguna de sus brigadas tiene zona (sin KMZ ni estaciones), no recibe capas generales del proyecto.
      const layers: WpLayer[] = [];
      for (const pid of projectIds) {
        const boxes = (zones.get(pid) ?? []).map((z) =>
          sql`ST_MakeEnvelope(${z[0] - CLIP_MARGIN_DEG}, ${z[1] - CLIP_MARGIN_DEG}, ${z[2] + CLIP_MARGIN_DEG}, ${z[3] + CLIP_MARGIN_DEG}, 4326)`);
        const mine = brigadeIds.length ? sql`l.brigade_id IN (${list(brigadeIds)})` : sql`false`;
        // Una sola caja: ST_ClipByBox2D (rápido y tolera geometrías inválidas); varias: intersección con su unión.
        const clip = boxes.length === 1 ? sql`ST_ClipByBox2D(l.geom, r.g)` : sql`ST_Intersection(l.geom, r.g)`;
        const rows = (await db.execute(sql`
          WITH r AS (SELECT ${boxes.length ? sql`ST_SetSRID(ST_Union(ARRAY[${sql.join(boxes, sql`, `)}]), 4326)` : sql`NULL::geometry`} AS g)
          SELECT id, "projectId", kind, name, code, color, "brigadeId",
            ST_AsGeoJSON(ST_SimplifyPreserveTopology(g, 0.00002), 6)::json AS geometry
          FROM (
            SELECT l.id, l.project_id AS "projectId", l.kind, l.name, l.code, l.color, l.brigade_id AS "brigadeId", l.sort_order,
              CASE WHEN l.brigade_id IS NOT NULL OR ST_CoveredBy(l.geom, r.g) THEN l.geom
                ELSE ST_CollectionExtract(${clip}, ST_Dimension(l.geom) + 1) END AS g
            FROM project_layers l, r
            WHERE l.project_id = ${pid}
              AND (${mine} OR (l.brigade_id IS NULL AND r.g IS NOT NULL AND l.geom && r.g AND ST_Intersects(l.geom, r.g)))
          ) x
          WHERE NOT ST_IsEmpty(g)
          ORDER BY CASE kind WHEN 'uv' THEN 1 WHEN 'aii' THEN 2 WHEN 'aid' THEN 3 WHEN 'superposicion' THEN 4 WHEN 'huella' THEN 5 ELSE 6 END,
            name, id`)).rows as WpLayer[];
        layers.push(...rows);
      }

      const body = {
        today: days.today,
        from: days.from,
        to: days.to,
        projects,
        brigades,
        schedules,
        stations,
        methods,
        stationMethods: stationMethods.map(({ specialtyId: _s, ...sm }) => sm),
        units,
        species,
        layers,
        formHosts,
        stationForms,
      };
      const version = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
      const generatedAt = new Date().toISOString();

      // Registro de descargas (una fila por proyecto) para saber qué tiene cada teléfono.
      const rows = (projectIds.length ? projectIds : [null]).map((projectId) => ({
        userId, deviceId: req.query.deviceId ?? null, projectId,
        fromDate: new Date(`${days.from}T00:00:00-05:00`), toDate: new Date(`${days.to}T23:59:59-05:00`), version,
      }));
      await db.insert(schema.workPackageDownloads).values(rows);

      if (req.query.version === version) return { unchanged: true as const, version, generatedAt };
      return { version, generatedAt, ...body } satisfies WorkPackage;
    },
  );
};

export default workPackageRoutes;
