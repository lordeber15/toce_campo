import type { FastifyRequest } from 'fastify';
import { db, schema } from '../db/index.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function audit(
  req: FastifyRequest,
  entity: string,
  entityId: string | null,
  action: string,
  data?: { before?: unknown; after?: unknown },
  tx: Tx | typeof db = db,
) {
  await tx.insert(schema.auditLogs).values({
    userId: req.user?.sub ?? null,
    entity,
    entityId,
    action,
    before: data?.before,
    after: data?.after,
    ipAddress: req.ip,
  });
}
