import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ADMIN_ROLES, WEB_ROLES, layerGroupSchema, layerGroupUpdateSchema, layersImportSchema, projectSchema, type LayerTreeLeaf,
} from '@toce/shared';
import { schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { classifyStations } from '../lib/geo.js';
import { layerBrigades, syncBrigadeAreas } from '../lib/brigadeAreas.js';
import { badRequest, conflict, idParam, isUniqueViolation, notFound } from '../lib/http.js';

const { projects, projectLayers, brigades } = schema;

/** text[] de Postgres desde un arreglo JS (drizzle expande los arreglos como listas de parámetros). */
const textArray = (a: string[]) => sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(a)}::jsonb))::text[]`;

const projectsRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.requireRoles(...WEB_ROLES, 'jefe_proyecto');
  const write = app.requireRoles(...ADMIN_ROLES);

  r.get('/projects', { onRequest: read }, async () => {
    const rows = await app.db.execute(sql`
      SELECT p.id, p.code, p.name, p.client, p.status, p.start_date AS "startDate", p.end_date AS "endDate", p.utm_zone AS "utmZone",
        (SELECT count(*)::int FROM brigades b WHERE b.project_id = p.id AND b.is_active) AS brigades,
        (SELECT count(*)::int FROM stations s WHERE s.project_id = p.id AND s.deleted_at IS NULL) AS stations,
        (SELECT count(*)::int FROM schedules sc WHERE sc.project_id = p.id) AS schedules,
        (SELECT count(*)::int FROM project_layers l WHERE l.project_id = p.id) AS layers
      FROM projects p WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC`);
    return rows.rows;
  });

  r.get('/projects/:id', { onRequest: read, schema: { params: idParam } }, async (req) => {
    const [p] = await app.db.select().from(projects).where(and(eq(projects.id, req.params.id), isNull(projects.deletedAt)));
    if (!p) throw notFound('Proyecto');
    return p;
  });

  r.post('/projects', { onRequest: write, schema: { body: projectSchema } }, async (req, reply) => {
    try {
      const [p] = await app.db.insert(projects).values({ ...req.body, code: req.body.code.toUpperCase() }).returning();
      await audit(req, 'project', p!.id, 'create', { after: req.body });
      return reply.code(201).send(p);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Ya existe un proyecto con ese código');
      throw e;
    }
  });

  r.patch('/projects/:id', { onRequest: write, schema: { params: idParam, body: projectSchema.partial() } }, async (req) => {
    const body = { ...req.body, ...(req.body.code && { code: req.body.code.toUpperCase() }) };
    try {
      const [p] = await app.db.update(projects).set(body).where(eq(projects.id, req.params.id)).returning();
      if (!p) throw notFound('Proyecto');
      await audit(req, 'project', p.id, 'update', { after: body });
      return p;
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Ya existe un proyecto con ese código');
      throw e;
    }
  });

  // ---------- Capas (KMZ -> GeoJSON en el navegador -> aquí) ----------

  r.get(
    '/projects/:id/layers',
    {
      onRequest: app.authenticate,
      schema: {
        params: idParam,
        querystring: z.object({
          tolerance: z.coerce.number().min(0).max(0.01).default(0.00002),
          /** Solo las capas de un KMZ ('' = las importadas sin archivo). */
          source: z.string().max(200).optional(),
          /** Solo una carpeta hoja: ruta como arreglo JSON (["Componentes", "Torres (147)"]). */
          folder: z.string().max(3000).optional(),
        }),
      },
    },
    async (req) => {
      const { source, folder } = req.query;
      let path: string[] | null = null;
      if (folder !== undefined) {
        try { path = z.array(z.string()).parse(JSON.parse(folder)); } catch { throw badRequest('Carpeta inválida'); }
      }
      const bySource = sql`${source === undefined ? sql`` : source === '' ? sql`AND source_file IS NULL` : sql`AND source_file = ${source}`}
        ${path ? sql`AND folder_path = ${textArray(path)}` : sql``}`;
      const rows = await app.db.execute(sql`
        SELECT id, kind, name, code, color, source_file AS "sourceFile", folder_path AS "folderPath", properties,
          ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, ${req.query.tolerance}), 6)::json AS geometry,
          round((ST_Area(geom::geography) / 10000)::numeric, 2)::float AS "areaHa"
        FROM project_layers WHERE project_id = ${req.params.id} ${bySource}
        ORDER BY CASE kind WHEN 'uv' THEN 1 WHEN 'aii' THEN 2 WHEN 'aid' THEN 3 WHEN 'superposicion' THEN 4 WHEN 'huella' THEN 5 ELSE 6 END, sort_order, name`);
      return {
        type: 'FeatureCollection',
        features: rows.rows.map(({ geometry, ...props }) => ({ type: 'Feature', id: props.id, geometry, properties: props })),
      };
    },
  );

  /** Árbol de capas: una fila por carpeta hoja de cada KMZ, en el orden del archivo (sin geometrías). */
  r.get('/projects/:id/layer-tree', { onRequest: read, schema: { params: idParam } }, async (req) => {
    const rows = await app.db.execute(sql`
      SELECT l.source_file AS "sourceFile", max(l.source_title) AS "sourceTitle",
        l.brigade_id AS "brigadeId", b.name AS "brigadeName", l.folder_path AS "folderPath",
        mode() WITHIN GROUP (ORDER BY l.kind) AS kind,
        count(*)::int AS count,
        count(*) FILTER (WHERE GeometryType(l.geom) LIKE '%POINT%')::int AS points,
        count(*) FILTER (WHERE GeometryType(l.geom) LIKE '%LINE%')::int AS lines,
        count(*) FILTER (WHERE GeometryType(l.geom) LIKE '%POLYGON%')::int AS polygons,
        mode() WITHIN GROUP (ORDER BY l.color) AS color
      FROM project_layers l LEFT JOIN brigades b ON b.id = l.brigade_id
      WHERE l.project_id = ${req.params.id}
      GROUP BY l.source_file, l.brigade_id, b.name, l.folder_path
      ORDER BY min(l.created_at), l.source_file, min(l.sort_order)`);
    return rows.rows as LayerTreeLeaf[];
  });

  // Capas KMZ grandes (miles de polígonos) superan el límite general de 20 MB.
  r.post('/projects/:id/layers', { onRequest: write, bodyLimit: 100 * 1024 * 1024, schema: { params: idParam, body: layersImportSchema } }, async (req, reply) => {
    const projectId = req.params.id;
    const [p] = await app.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
    if (!p) throw notFound('Proyecto');
    const { sourceFile = null, sourceTitle = null, brigadeId = null } = req.body;
    if (brigadeId) {
      const [b] = await app.db.select({ id: brigades.id }).from(brigades).where(and(eq(brigades.id, brigadeId), eq(brigades.projectId, projectId)));
      if (!b) throw notFound('Brigada');
    }
    const ids = await app.db.transaction(async (tx) => {
      let replaced = 0;
      const affected: string[] = [brigadeId ?? ''];
      if (req.body.replaceSameSource && sourceFile) {
        affected.push(...(await layerBrigades(tx, sql`project_id = ${projectId} AND source_file = ${sourceFile}`)));
        const old = await tx.execute(sql`SELECT id FROM project_layers WHERE project_id = ${projectId} AND source_file = ${sourceFile}`);
        replaced = old.rows.length;
        if (replaced) {
          await tx.execute(sql`UPDATE stations SET vegetation_layer_id = NULL WHERE vegetation_layer_id IN (SELECT id FROM project_layers WHERE project_id = ${projectId} AND source_file = ${sourceFile})`);
          await tx.execute(sql`DELETE FROM project_layers WHERE project_id = ${projectId} AND source_file = ${sourceFile}`);
        }
      }
      // Por lotes: miles de elementos en un solo INSERT por lote en vez de uno por fila.
      const BATCH = 200;
      let imported = 0;
      for (let i = 0; i < req.body.features.length; i += BATCH) {
        const values = req.body.features.slice(i, i + BATCH).map((f, j) => sql`(
          ${projectId}::uuid, ${f.kind}::layer_kind, ${f.name}, ${f.code ?? null}, ${f.color ?? null},
          ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), 4326))),
            CASE WHEN ${f.geometry.type} ILIKE '%polygon%' THEN 3 WHEN ${f.geometry.type} ILIKE '%line%' THEN 2 ELSE 1 END),
          ${JSON.stringify(f.properties ?? {})}::jsonb, ${sourceFile}, ${sourceTitle}, ${textArray(f.folderPath)}, ${i + j}, ${brigadeId}::uuid)`);
        const res = await tx.execute(sql`
          INSERT INTO project_layers (project_id, kind, name, code, color, geom, properties, source_file, source_title, folder_path, sort_order, brigade_id)
          VALUES ${sql.join(values, sql`, `)}`);
        imported += res.rowCount ?? values.length;
      }
      await classifyStations(tx, projectId);
      // El polígono de la brigada sale de sus capas: se recalcula (y con él, las fotos dentro/fuera).
      await syncBrigadeAreas(tx, affected);
      await audit(req, 'project_layers', projectId, 'import', { after: { count: imported, replaced, sourceFile, brigadeId } }, tx);
      return { imported, replaced };
    });
    return reply.code(201).send(ids);
  });

  /** Condición SQL de un grupo del árbol: un KMZ y, opcionalmente, una carpeta con todo lo que tiene dentro. */
  const groupWhere = (projectId: string, g: { sourceFile: string | null; folderPath: string[] }) => sql`
    project_id = ${projectId}
    AND ${g.sourceFile === null ? sql`source_file IS NULL` : sql`source_file = ${g.sourceFile}`}
    ${g.folderPath.length ? sql`AND folder_path[1:${g.folderPath.length}] = ${textArray(g.folderPath)}` : sql``}`;

  r.patch('/projects/:id/layer-groups', { onRequest: write, schema: { params: idParam, body: layerGroupUpdateSchema } }, async (req) => {
    const projectId = req.params.id;
    const { kind, brigadeId } = req.body;
    if (brigadeId) {
      const [b] = await app.db.select({ id: brigades.id }).from(brigades).where(and(eq(brigades.id, brigadeId), eq(brigades.projectId, projectId)));
      if (!b) throw notFound('Brigada');
    }
    const sets = [
      ...(kind ? [sql`kind = ${kind}`] : []),
      ...(brigadeId !== undefined ? [sql`brigade_id = ${brigadeId}`] : []),
    ];
    if (!sets.length) return { updated: 0 };
    return app.db.transaction(async (tx) => {
      const before = brigadeId !== undefined ? await layerBrigades(tx, groupWhere(projectId, req.body)) : [];
      const res = await tx.execute(sql`UPDATE project_layers SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE ${groupWhere(projectId, req.body)}`);
      if (!res.rowCount) throw notFound('Grupo de capas');
      if (kind) await classifyStations(tx, projectId);
      if (brigadeId !== undefined) await syncBrigadeAreas(tx, [...before, brigadeId]);
      await audit(req, 'project_layers', projectId, 'update', { after: req.body }, tx);
      return { updated: res.rowCount };
    });
  });

  r.delete('/projects/:id/layer-groups', { onRequest: write, schema: { params: idParam, body: layerGroupSchema } }, async (req) => {
    const projectId = req.params.id;
    return app.db.transaction(async (tx) => {
      const where = groupWhere(projectId, req.body);
      const before = await layerBrigades(tx, where);
      await tx.execute(sql`UPDATE stations SET vegetation_layer_id = NULL WHERE vegetation_layer_id IN (SELECT id FROM project_layers WHERE ${where})`);
      const res = await tx.execute(sql`DELETE FROM project_layers WHERE ${where}`);
      if (!res.rowCount) throw notFound('Grupo de capas');
      await classifyStations(tx, projectId);
      await syncBrigadeAreas(tx, before);
      await audit(req, 'project_layers', projectId, 'delete', { before: { ...req.body, count: res.rowCount } }, tx);
      return { deleted: res.rowCount };
    });
  });

  r.patch(
    '/projects/:projectId/layers/:id',
    {
      onRequest: write,
      schema: {
        params: z.object({ projectId: z.string().uuid(), id: z.string().uuid() }),
        body: z.object({ kind: layersImportSchema.shape.features.element.shape.kind.optional(), name: z.string().min(1).max(200).optional(), code: z.string().max(40).nullish(), color: z.string().max(20).nullish() }),
      },
    },
    async (req) => {
      const [l] = await app.db.update(projectLayers).set(req.body).where(and(eq(projectLayers.id, req.params.id), eq(projectLayers.projectId, req.params.projectId))).returning({ id: projectLayers.id });
      if (!l) throw notFound('Capa');
      await classifyStations(app.db, req.params.projectId);
      return { ok: true };
    },
  );

  r.delete('/projects/:projectId/layers/:id', { onRequest: write, schema: { params: z.object({ projectId: z.string().uuid(), id: z.string().uuid() }) } }, async (req) => {
    await app.db.transaction(async (tx) => {
      await tx.update(schema.stations).set({ vegetationLayerId: null }).where(eq(schema.stations.vegetationLayerId, req.params.id));
      const [l] = await tx.delete(projectLayers).where(and(eq(projectLayers.id, req.params.id), eq(projectLayers.projectId, req.params.projectId))).returning({ id: projectLayers.id, name: projectLayers.name, brigadeId: projectLayers.brigadeId });
      if (!l) throw notFound('Capa');
      await classifyStations(tx, req.params.projectId);
      await syncBrigadeAreas(tx, [l.brigadeId]);
      await audit(req, 'project_layers', req.params.id, 'delete', { before: l }, tx);
    });
    return { ok: true };
  });

  r.get('/projects/:id/layers/summary', { onRequest: read, schema: { params: idParam } }, async (req) => {
    return app.db
      .select({ kind: projectLayers.kind, count: sql<number>`count(*)::int` })
      .from(projectLayers)
      .where(eq(projectLayers.projectId, req.params.id))
      .groupBy(projectLayers.kind)
      .orderBy(asc(projectLayers.kind));
  });
};
export default projectsRoutes;
