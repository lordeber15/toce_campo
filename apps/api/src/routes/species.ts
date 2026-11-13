import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ADMIN_ROLES, speciesImportSchema, speciesSchema } from '@toce/shared';
import { schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { conflict, idParam, isUniqueViolation, notFound } from '../lib/http.js';

const { species } = schema;

const speciesRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const write = app.requireRoles(...ADMIN_ROLES);

  r.get(
    '/species',
    {
      onRequest: app.authenticate,
      schema: {
        querystring: z.object({
          specialtyId: z.string().uuid(),
          q: z.string().optional(),
          includeInactive: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (req) => {
      const { specialtyId, q, includeInactive, limit, offset } = req.query;
      const where = and(
        eq(species.specialtyId, specialtyId),
        includeInactive ? undefined : eq(species.isActive, true),
        q ? or(ilike(species.scientificName, `%${q}%`), ilike(species.commonName, `%${q}%`), ilike(species.family, `%${q}%`)) : undefined,
      );
      const [items, [{ total }]] = await Promise.all([
        app.db.select().from(species).where(where).orderBy(asc(species.scientificName)).limit(limit).offset(offset),
        app.db.select({ total: sql<number>`count(*)::int` }).from(species).where(where),
      ]);
      return { items, total };
    },
  );

  r.post('/species', { onRequest: write, schema: { body: speciesSchema } }, async (req, reply) => {
    try {
      const [s] = await app.db.insert(species).values(req.body).returning();
      await audit(req, 'species', s!.id, 'create', { after: req.body });
      return reply.code(201).send(s);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Esa especie ya está en el catálogo');
      throw e;
    }
  });

  r.patch('/species/:id', { onRequest: write, schema: { params: idParam, body: speciesSchema.partial() } }, async (req) => {
    try {
      const [s] = await app.db.update(species).set(req.body).where(eq(species.id, req.params.id)).returning();
      if (!s) throw notFound('Especie');
      await audit(req, 'species', s.id, 'update', { after: req.body });
      return s;
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Esa especie ya está en el catálogo');
      throw e;
    }
  });

  /** Importa/actualiza en lote (por nombre científico dentro de la especialidad). */
  r.post('/species/import', { onRequest: write, schema: { body: speciesImportSchema } }, async (req) => {
    const { specialtyId, rows } = req.body;
    const seen = new Set<string>();
    const unique = rows.filter((r) => {
      const k = r.scientificName.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const result = await app.db.transaction(async (tx) => {
      let inserted = 0;
      for (let i = 0; i < unique.length; i += 500) {
        const chunk = unique.slice(i, i + 500);
        const res = await tx
          .insert(species)
          .values(chunk.map((r) => ({ ...r, specialtyId, isActive: true })))
          .onConflictDoUpdate({
            target: [species.specialtyId, species.scientificName],
            set: {
              commonName: sql`coalesce(excluded.common_name, ${species.commonName})`,
              family: sql`coalesce(excluded.family, ${species.family})`,
              order: sql`coalesce(excluded.order_name, ${species.order})`,
              conservationStatus: sql`coalesce(excluded.conservation_status, ${species.conservationStatus})`,
              isActive: true,
              updatedAt: new Date(),
            },
          })
          .returning({ inserted: sql<boolean>`(xmax = 0)` });
        inserted += res.filter((x) => x.inserted).length;
      }
      await audit(req, 'species', null, 'import', { after: { specialtyId, rows: unique.length } }, tx);
      return { inserted, updated: unique.length - inserted, duplicatesInFile: rows.length - unique.length };
    });
    return result;
  });
};
export default speciesRoutes;
