import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  WORK_PACKAGE_DAYS_AHEAD, WORK_PACKAGE_DAYS_BACK,
  type BrigadeRole, type WorkPackage, type WpBrigade, type WpMethod, type WpProject, type WpSchedule,
  type WpLayer, type WpSpecies, type WpStation, type WpStationMethod, type WpUnit,
} from '@toce/shared';
import { schema } from '../db/index.js';

const list = (ids: string[]): SQL => sql.join(ids.map((i) => sql`${i}`), sql`, `);

type BrigadeRow = Omit<WpBrigade, 'members' | 'myRoles'> & {
  specialtyId: string | null;
  isLeader: boolean;
  isMember: boolean;
  isSupervisor: boolean;
  isLogistician: boolean;
};

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
        SELECT b.id, b.project_id AS "projectId", b.name, b.specialty_id AS "specialtyId",
          sp.code AS "specialtyCode", sp.name AS "specialtyName", b.leader_id AS "leaderId", lu.full_name AS "leaderName",
          (b.leader_id = ${userId}) AS "isLeader",
          EXISTS (SELECT 1 FROM brigade_members bm WHERE bm.brigade_id = b.id AND bm.user_id = ${userId} AND bm.left_at IS NULL) AS "isMember",
          (b.supervisor_id = ${userId}) AS "isSupervisor",
          (b.logistician_id = ${userId}) AS "isLogistician"
        FROM brigades b
        JOIN projects p ON p.id = b.project_id AND p.deleted_at IS NULL AND p.status <> 'cerrado'
        LEFT JOIN specialties sp ON sp.id = b.specialty_id
        LEFT JOIN users lu ON lu.id = b.leader_id
        WHERE b.is_active AND (
          b.leader_id = ${userId} OR b.supervisor_id = ${userId} OR b.logistician_id = ${userId}
          OR EXISTS (SELECT 1 FROM brigade_members bm WHERE bm.brigade_id = b.id AND bm.user_id = ${userId} AND bm.left_at IS NULL))
        ORDER BY b.name`)).rows as BrigadeRow[];

      const brigadeIds = brigadeRows.map((b) => b.id);
      const projectIds = [...new Set(brigadeRows.map((b) => b.projectId))];

      const members = brigadeIds.length
        ? ((await db.execute(sql`
            SELECT bm.brigade_id AS "brigadeId", u.id, u.full_name AS "fullName", u.phone, sp.code AS "specialtyCode"
            FROM brigade_members bm JOIN users u ON u.id = bm.user_id LEFT JOIN specialties sp ON sp.id = u.specialty_id
            WHERE bm.brigade_id IN (${list(brigadeIds)}) AND bm.left_at IS NULL AND u.deleted_at IS NULL
            ORDER BY u.full_name`)).rows as ({ brigadeId: string } & WpBrigade['members'][number])[])
        : [];

      const brigades: WpBrigade[] = brigadeRows.map(({ specialtyId: _s, isLeader, isMember, isSupervisor, isLogistician, ...b }) => {
        const myRoles: BrigadeRole[] = [];
        if (isLeader) myRoles.push('jefe');
        if (isMember && !isLeader) myRoles.push('miembro');
        if (isSupervisor) myRoles.push('supervisor');
        if (isLogistician) myRoles.push('logistico');
        return { ...b, myRoles, members: members.filter((m) => m.brigadeId === b.id).map(({ brigadeId: _b, ...m }) => m) };
      });

      const projects: WpProject[] = projectIds.length
        ? ((await db.execute(sql`
            SELECT p.id, p.code, p.name, p.utm_zone AS "utmZone",
              (SELECT CASE WHEN e IS NULL THEN NULL ELSE json_build_array(ST_XMin(e), ST_YMin(e), ST_XMax(e), ST_YMax(e)) END
               FROM (SELECT ST_Extent(g)::geometry AS e FROM (
                 SELECT geom AS g FROM stations WHERE project_id = p.id AND deleted_at IS NULL
                 UNION ALL SELECT geom FROM project_layers WHERE project_id = p.id) x) b) AS bounds
            FROM projects p WHERE p.id IN (${list(projectIds)}) ORDER BY p.code`)).rows as WpProject[])
        : [];

      const schedules: WpSchedule[] = brigadeIds.length
        ? ((await db.execute(sql`
            SELECT sc.id, sc.brigade_id AS "brigadeId", sc.station_id AS "stationId",
              to_char(sc.planned_date, 'YYYY-MM-DD') AS "plannedDate", sc.sort_order AS "sortOrder", sc.status, sc.notes
            FROM schedules sc JOIN stations s ON s.id = sc.station_id AND s.deleted_at IS NULL
            WHERE sc.brigade_id IN (${list(brigadeIds)}) AND sc.status <> 'cancelada'
              AND sc.planned_date BETWEEN ${days.from}::date AND ${days.to}::date
            ORDER BY sc.planned_date, sc.sort_order, s.code`)).rows as WpSchedule[])
        : [];

      const stationIds = [...new Set(schedules.map((s) => s.stationId))];
      const stations: WpStation[] = stationIds.length
        ? ((await db.execute(sql`
            SELECT id, project_id AS "projectId", code, name, ST_Y(geom) AS lat, ST_X(geom) AS lng, altitude,
              influence_area AS "influenceArea", vegetation_unit AS "vegetationUnit", overlap, access_notes AS "accessNotes", status
            FROM stations WHERE id IN (${list(stationIds)}) ORDER BY code`)).rows as WpStation[])
        : [];

      // Métodos visibles en cada estación: los de la especialidad de la brigada programada allí.
      // Brigada sin especialidad: la especialidad del usuario; si tampoco tiene, todos los métodos.
      const specialtyByBrigade = new Map(brigadeRows.map((b) => [b.id, b.specialtyId ?? me?.specialtyId ?? null]));
      const pairs = new Map<string, Set<string | null>>();
      for (const s of schedules) {
        const set = pairs.get(s.stationId) ?? new Set<string | null>();
        set.add(specialtyByBrigade.get(s.brigadeId) ?? null);
        pairs.set(s.stationId, set);
      }
      const pairConds = [...pairs].map(([stationId, specs]) =>
        specs.has(null)
          ? sql`sm.station_id = ${stationId}`
          : sql`(sm.station_id = ${stationId} AND m.specialty_id IN (${list([...specs] as string[])}))`,
      );

      const stationMethods: (WpStationMethod & { specialtyId: string })[] = pairConds.length
        ? ((await db.execute(sql`
            SELECT sm.id, sm.station_id AS "stationId", sm.method_id AS "methodId", sm.units_required AS "unitsRequired",
              sm.notes, m.specialty_id AS "specialtyId"
            FROM station_methods sm JOIN methods m ON m.id = sm.method_id AND m.is_active
            WHERE ${sql.join(pairConds, sql` OR `)}
            ORDER BY sm.station_id, m.sort_order, m.code`)).rows as (WpStationMethod & { specialtyId: string })[])
        : [];

      const methodIds = [...new Set(stationMethods.map((sm) => sm.methodId))];
      const methods: WpMethod[] = methodIds.length
        ? ((await db.execute(sql`
            SELECT m.id, sp.code AS "specialtyCode", m.code, m.name, m.description, m.instructions, m.is_open_ended AS "isOpenEnded",
              to_char(m.schedule_start, 'HH24:MI') AS "scheduleStart", to_char(m.schedule_end, 'HH24:MI') AS "scheduleEnd",
              m.min_duration_min AS "minDurationMin", m.requirements, m.photo_slots AS "photoSlots",
              m.method_photo_required AS "methodPhotoRequired", m.method_photo_instructions AS "methodPhotoInstructions",
              m.form_schema AS "formSchema"
            FROM methods m JOIN specialties sp ON sp.id = m.specialty_id
            WHERE m.id IN (${list(methodIds)}) ORDER BY sp.sort_order, m.sort_order, m.code`)).rows as WpMethod[])
        : [];

      const smIds = stationMethods.map((sm) => sm.id);
      const units: WpUnit[] = smIds.length
        ? ((await db.execute(sql`
            SELECT id, station_method_id AS "stationMethodId", station_id AS "stationId", method_id AS "methodId", seq, code, status
            FROM sampling_units WHERE station_method_id IN (${list(smIds)}) ORDER BY station_id, method_id, seq`)).rows as WpUnit[])
        : [];

      const specialtyIds = [...new Set(stationMethods.map((sm) => sm.specialtyId))];
      const species: WpSpecies[] = specialtyIds.length
        ? ((await db.execute(sql`
            SELECT s.id, sp.code AS "specialtyCode", s.scientific_name AS "scientificName", s.common_name AS "commonName",
              s.family, s.order_name AS "order", s.conservation_status AS "conservationStatus"
            FROM species s JOIN specialties sp ON sp.id = s.specialty_id
            WHERE s.specialty_id IN (${list(specialtyIds)}) AND s.is_active
            ORDER BY sp.code, s.scientific_name`)).rows as WpSpecies[])
        : [];

      // Capas KMZ simplificadas (~2 m) para dibujarlas y verificar el área de influencia sin conexión.
      const layers: WpLayer[] = projectIds.length
        ? ((await db.execute(sql`
            SELECT id, project_id AS "projectId", kind, name, code, color,
              ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.00002), 6)::json AS geometry
            FROM project_layers WHERE project_id IN (${list(projectIds)})
            ORDER BY CASE kind WHEN 'uv' THEN 1 WHEN 'aii' THEN 2 WHEN 'aid' THEN 3 WHEN 'superposicion' THEN 4 WHEN 'huella' THEN 5 ELSE 6 END, name`)).rows as WpLayer[])
        : [];

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
