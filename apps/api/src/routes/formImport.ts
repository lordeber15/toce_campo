import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ADMIN_ROLES,canonicalFormJson } from '@toce/shared';
import { schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict } from '../lib/http.js';
import { planFormImport } from '../lib/formImport.js';

const body = z.object({ fileBase64: z.string().min(1).max(7 * 1024 * 1024) });
const formImport: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { methods, specialties } = schema;
  const catalog = (db: Pick<typeof app.db, 'select'>) => db.select({
    ...getTableColumns(methods), specialtyCode: specialties.code, specialtyName: specialties.name,
  }).from(methods).innerJoin(specialties, eq(methods.specialtyId, specialties.id)).where(eq(methods.isActive, true)).orderBy(methods.id);
  const decode = (s: string) => {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length % 4) throw badRequest('Archivo base64 inválido');
    return Buffer.from(s, 'base64');
  };
  const parse = async (s: string, db: Pick<typeof app.db,'select'>) => {
    try { return await planFormImport(decode(s), await catalog(db)); }
    catch (e) { throw badRequest((e as Error).message); }
  };
  r.post('/import/forms/validate', { onRequest: app.requireRoles(...ADMIN_ROLES), schema: { body } }, async (req) => parse(req.body.fileBase64, app.db));
  r.post('/import/forms/commit', {
    onRequest: app.requireRoles(...ADMIN_ROLES),
    schema: { body: body.extend({ fingerprint: z.string().length(64), compatibleMobileConfirmed: z.literal(true) }) },
  }, async (req) => app.db.transaction(async (tx) => {
    // Serialise catalog edits and the snapshot backfill within this transaction.
    await tx.execute(sql`LOCK TABLE methods IN SHARE ROW EXCLUSIVE MODE`);
    const plan = await parse(req.body.fileBase64, tx);
    if (plan.errors.length) throw badRequest(plan.errors.join('\n'));
    if (plan.fingerprint !== req.body.fingerprint) throw conflict('Cambió el archivo o el catálogo desde la vista previa. Valida nuevamente.');
    let updated = 0;
    for (const item of plan.items) {
      if (canonicalFormJson(item.before) === canonicalFormJson(item.after)) continue;
      // Historic executions retain their original field definitions and all values.
      await tx.execute(sql`UPDATE executions SET form_data = jsonb_set(form_data, '{schemaSnapshot}', ${JSON.stringify(item.before)}::jsonb)
        WHERE method_id = ${item.id} AND NOT (form_data ? 'schemaSnapshot')`);
      await tx.update(methods).set({ formSchema: item.after }).where(eq(methods.id, item.id));
      await audit(req, 'method', item.id, 'import_form', { before: item.before, after: item.after }, tx);
      updated++;
    }
    return { updated, revision: plan.items[0]?.after.revision };
  }));
};
export default formImport;
