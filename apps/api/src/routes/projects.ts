import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ADMIN_ROLES, WEB_ROLES, layersImportSchema, projectSchema } from '@toce/shared';
import { schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { classifyStations } from '../lib/geo.js';
import { conflict, idParam, isUniqueViolation, notFound } from '../lib/http.js';

const { projects, projectLayers } = schema;

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
    { onRequest: app.authenticate, schema: { params: idParam, querystring: z.object({ tolerance: z.coerce.number().min(0).max(0.01).default(0.00002) }) } },
    async (req) => {
      const rows = await app.db.execute(sql`
        SELECT id, kind, name, code, color, source_file AS "sourceFile",
          ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, ${req.query.tolerance}), 6)::json AS geometry,
          round((ST_Area(geom::geography) / 10000)::numeric, 2)::float AS "areaHa"
        FROM project_layers WHERE project_id = ${req.params.id}
        ORDER BY CASE kind WHEN 'huella' THEN 1 WHEN 'aii' THEN 2 WHEN 'aid' THEN 3 WHEN 'uv' THEN 4 WHEN 'superposicion' THEN 5 ELSE 6 END, name`);
      return {
        type: 'FeatureCollection',
        features: rows.rows.map(({ geometry, ...props }) => ({ type: 'Feature', id: props.id, geometry, properties: props })),
      };
    },
  );

  r.post('/projects/:id/layers', { onRequest: write, schema: { params: idParam, body: layersImportSchema } }, async (req, reply) => {
    const projectId = req.params.id;
    const [p] = await app.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
    if (!p) throw notFound('Proyecto');
    const ids = await app.db.transaction(async (tx) => {
      const out: string[] = [];
      let replaced = 0;
      if (req.body.replaceSameSource && req.body.sourceFile) {
        const old = await tx.execute(sql`SELECT id FROM project_layers WHERE project_id = ${projectId} AND source_file = ${req.body.sourceFile}`);
        replaced = old.rows.length;
        if (replaced) {
          await tx.execute(sql`UPDATE stations SET vegetation_layer_id = NULL WHERE vegetation_layer_id IN (SELECT id FROM project_layers WHERE project_id = ${projectId} AND source_file = ${req.body.sourceFile})`);
          await tx.execute(sql`DELETE FROM project_layers WHERE project_id = ${projectId} AND source_file = ${req.body.sourceFile}`);
        }
      }
      for (const f of req.body.features) {
        const res = await tx.execute(sql`
          INSERT INTO project_layers (project_id, kind, name, code, color, geom, properties, source_file)
          VALUES (${projectId}, ${f.kind}, ${f.name}, ${f.code ?? null}, ${f.color ?? null},
            ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), 4326))),
              CASE WHEN ${f.geometry.type} ILIKE '%polygon%' THEN 3 WHEN ${f.geometry.type} ILIKE '%line%' THEN 2 ELSE 1 END),
            ${JSON.stringify(f.properties ?? {})}::jsonb, ${req.body.sourceFile ?? null})
          RETURNING id`);
        out.push((res.rows[0] as { id: string }).id);
      }
      await classifyStations(tx, projectId);
      await audit(req, 'project_layers', projectId, 'import', { after: { count: out.length, replaced, sourceFile: req.body.sourceFile } }, tx);
      return { out, replaced };
    });
    return reply.code(201).send({ imported: ids.out.length, replaced: ids.replaced });
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
      const [l] = await tx.delete(projectLayers).where(and(eq(projectLayers.id, req.params.id), eq(projectLayers.projectId, req.params.projectId))).returning({ id: projectLayers.id, name: projectLayers.name });
      if (!l) throw notFound('Capa');
      await classifyStations(tx, req.params.projectId);
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
