import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  ADMIN_ROLES, LOGISTICS_ENTITIES, LOGISTICS_SCHEMAS, WEB_ROLES, hasAnyRole,
  type LogisticsEntity, type LogisticsRecordDto, type LogisticsSyncResult,
} from '@toce/shared';
import { db } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, notFound, projectParam } from '../lib/http.js';

type Kind = 'text' | 'num' | 'int' | 'bool' | 'date' | 'ts' | 'arr' | 'uuid';
type Col = [key: string, column: string, kind: Kind];

/** Tabla y columnas de cada registro logístico (clave del JSON ↔ columna). Nombres fijos, nunca del usuario. */
export const LOGISTICS_TABLES: Record<LogisticsEntity, { table: string; folder: string; cols: Col[] }> = {
  vehicle: {
    table: 'logistics_vehicles', folder: 'movilidad',
    cols: [
      ['description', 'description', 'text'], ['plate', 'plate', 'text'], ['driverName', 'driver_name', 'text'],
      ['driverPhone', 'driver_phone', 'text'], ['status', 'status', 'text'], ['arrivedAt', 'arrived_at', 'ts'],
      ['missingMaterials', 'missing_materials', 'arr'], ['defectiveMaterials', 'defective_materials', 'arr'], ['notes', 'notes', 'text'],
    ],
  },
  support: {
    table: 'logistics_support_staff', folder: 'apoyos',
    cols: [
      ['fullName', 'full_name', 'text'], ['dni', 'dni', 'text'], ['phone', 'phone', 'text'], ['community', 'community', 'text'],
      ['eppItems', 'epp_items', 'arr'], ['documentsDelivered', 'documents_delivered', 'arr'], ['availableFrom', 'available_from', 'date'],
      ['availableTo', 'available_to', 'date'], ['isAvailable', 'is_available', 'bool'], ['notes', 'notes', 'text'],
    ],
  },
  expense: {
    table: 'logistics_expenses', folder: 'viaticos',
    cols: [
      ['category', 'category', 'text'], ['description', 'description', 'text'], ['amount', 'amount', 'num'], ['currency', 'currency', 'text'],
      ['expenseDate', 'expense_date', 'date'], ['receiptNumber', 'receipt_number', 'text'], ['vendor', 'vendor', 'text'],
    ],
  },
  sample: {
    table: 'logistics_samples', folder: 'muestras',
    cols: [
      ['code', 'code', 'text'], ['description', 'description', 'text'], ['quantity', 'quantity', 'int'], ['stationId', 'station_id', 'uuid'],
      ['status', 'status', 'text'], ['shippedAt', 'shipped_at', 'ts'], ['carrier', 'carrier', 'text'], ['trackingCode', 'tracking_code', 'text'],
      ['destination', 'destination', 'text'], ['notes', 'notes', 'text'],
    ],
  },
  equipment: {
    table: 'logistics_equipment', folder: 'equipos',
    cols: [
      ['name', 'name', 'text'], ['serial', 'serial', 'text'], ['quantity', 'quantity', 'int'], ['status', 'status', 'text'], ['notes', 'notes', 'text'],
    ],
  },
};

/** Valor SQL de un campo (los arreglos van como JSON para no depender del formato de arrays del driver). */
function value(kind: Kind, v: unknown): SQL {
  if (v === undefined || v === null || v === '') return kind === 'arr' ? sql`'{}'::text[]` : kind === 'bool' ? sql`false` : sql`NULL`;
  if (kind === 'arr') return sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(v)}::jsonb))`;
  if (kind === 'date') return sql`${v}::date`;
  if (kind === 'ts') return sql`${v}::timestamptz`;
  if (kind === 'uuid') return sql`${v}::uuid`;
  return sql`${v}`;
}

/** Expresión SELECT que devuelve cada columna con la forma del JSON del teléfono. */
function selectData(entity: LogisticsEntity, alias = 't'): SQL {
  const parts = LOGISTICS_TABLES[entity].cols.map(([key, col, kind]) => {
    const c = `${alias}.${col}`;
    const expr = kind === 'date' ? `to_char(${c}, 'YYYY-MM-DD')` : kind === 'num' ? `${c}::float8` : kind === 'ts' ? `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` : c;
    return `'${key}', ${expr}`;
  });
  return sql.raw(`jsonb_build_object('clientId', ${alias}.client_id, 'brigadeId', ${alias}.brigade_id,
    'clientUpdatedAt', to_char(${alias}.client_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ${parts.join(', ')})`);
}

/** ¿Puede el usuario registrar logística de la brigada? (su logístico o supervisor, o gestión). */
async function canLog(userId: string, roles: string[], brigadeId: string) {
  if (hasAnyRole(roles as never, ADMIN_ROLES)) return true;
  const r = await db.execute(sql`
    SELECT 1 FROM brigades WHERE id = ${brigadeId} AND is_active AND (logistician_id = ${userId} OR supervisor_id = ${userId})`);
  return r.rows.length > 0;
}

/**
 * Logística de campo.
 * Teléfono: POST /field/logistics/:entity (crear/actualizar, idempotente por clientId) y GET /field/logistics.
 * Web: GET /projects/:projectId/logistics (lectura para coordinación y jefatura).
 */
const logisticsRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/field/logistics/:entity',
    { onRequest: app.authenticate, schema: { params: z.object({ entity: z.enum(LOGISTICS_ENTITIES) }) } },
    async (req): Promise<LogisticsSyncResult> => {
      const entity = req.params.entity;
      const parsed = LOGISTICS_SCHEMAS[entity].safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join('; '));
      const d = parsed.data as Record<string, unknown> & { clientId: string; brigadeId: string; clientUpdatedAt: string };
      const userId = req.user.sub;
      const { table, cols } = LOGISTICS_TABLES[entity];

      const brigade = (await db.execute(sql`SELECT project_id AS "projectId" FROM brigades WHERE id = ${d.brigadeId}`)).rows[0] as
        | { projectId: string }
        | undefined;
      if (!brigade) throw notFound('Brigada');
      if (!(await canLog(userId, req.user.roles, d.brigadeId))) throw new HttpError(403, 'No eres responsable logístico de esta brigada');
      if (entity === 'sample' && d.stationId) {
        const st = (await db.execute(sql`SELECT project_id AS "p" FROM stations WHERE id = ${d.stationId as string}`)).rows[0] as { p: string } | undefined;
        if (!st || st.p !== brigade.projectId) throw badRequest('La estación no es del proyecto de la brigada');
      }

      return db.transaction(async (tx) => {
        const prev = (await tx.execute(sql`
          SELECT id, brigade_id AS "brigadeId", client_updated_at AS "cu" FROM ${sql.raw(table)} WHERE client_id = ${d.clientId} FOR UPDATE`)).rows[0] as
          | { id: string; brigadeId: string | null; cu: Date | string }
          | undefined;
        if (prev && prev.brigadeId && prev.brigadeId !== d.brigadeId && !(await canLog(userId, req.user.roles, prev.brigadeId))) {
          throw new HttpError(403, 'Este registro es de otra brigada');
        }
        // Último cambio gana: un envío más antiguo que lo guardado no sobrescribe.
        if (prev && new Date(prev.cu).getTime() >= new Date(d.clientUpdatedAt).getTime()) return { id: prev.id, clientId: d.clientId, applied: false };

        const extra: [string, SQL][] = [];
        if (entity === 'support') extra.push(['epp_delivered', sql`${((d.eppItems as string[]) ?? []).length > 0}`]);
        if (entity === 'expense') extra.push(['has_receipt', sql`${!!d.receiptNumber}`]);

        const names = [...cols.map(([, c]) => c), ...extra.map(([c]) => c)];
        const values = [...cols.map(([k, , kind]) => value(kind, d[k])), ...extra.map(([, v]) => v)];
        const row = (await tx.execute(sql`
          INSERT INTO ${sql.raw(table)} (client_id, project_id, brigade_id, registered_by_id, client_updated_at, ${sql.raw(names.join(', '))})
          VALUES (${d.clientId}, ${brigade.projectId}, ${d.brigadeId}, ${userId}, ${d.clientUpdatedAt}, ${sql.join(values, sql`, `)})
          ON CONFLICT (client_id) DO UPDATE SET brigade_id = EXCLUDED.brigade_id, project_id = EXCLUDED.project_id,
            client_updated_at = EXCLUDED.client_updated_at, updated_at = now(),
            ${sql.raw(names.map((c) => `${c} = EXCLUDED.${c}`).join(', '))}
          RETURNING id`)).rows[0] as { id: string };
        await audit(req, `logistics_${entity}`, row.id, prev ? 'update' : 'create', { after: d }, tx);
        return { id: row.id, clientId: d.clientId, applied: true };
      });
    },
  );

  /** Registros de las brigadas donde el usuario es logístico (para restaurarlos en el teléfono). */
  r.get('/field/logistics', { onRequest: app.authenticate }, async (req): Promise<LogisticsRecordDto[]> => {
    const out: LogisticsRecordDto[] = [];
    for (const entity of LOGISTICS_ENTITIES) {
      const { table } = LOGISTICS_TABLES[entity];
      const rows = (await db.execute(sql`
        SELECT t.id, ${selectData(entity)} AS data, u.full_name AS "registeredByName",
          (SELECT count(*)::int FROM attachments a WHERE a.owner_type = 'logistics' AND a.owner_id = t.id) AS files
        FROM ${sql.raw(table)} t
        JOIN brigades b ON b.id = t.brigade_id AND b.is_active AND (b.logistician_id = ${req.user.sub} OR b.supervisor_id = ${req.user.sub})
        JOIN projects p ON p.id = b.project_id AND p.deleted_at IS NULL AND p.status <> 'cerrado'
        JOIN users u ON u.id = t.registered_by_id
        ORDER BY t.created_at`)).rows as Omit<LogisticsRecordDto, 'entity'>[];
      for (const row of rows) out.push({ entity, ...row } as LogisticsRecordDto);
    }
    return out;
  });

  r.get(
    '/projects/:projectId/logistics',
    { onRequest: app.requireRoles(...WEB_ROLES, 'jefe_proyecto'), schema: { params: projectParam } },
    async (req) => {
      const result = {} as Record<LogisticsEntity, unknown[]>;
      for (const entity of LOGISTICS_ENTITIES) {
        const { table } = LOGISTICS_TABLES[entity];
        result[entity] = (await db.execute(sql`
          SELECT t.id, ${selectData(entity)} AS data, b.name AS "brigadeName", u.full_name AS "registeredByName", t.updated_at AS "updatedAt",
            ${entity === 'sample' ? sql`(SELECT code FROM stations WHERE id = t.station_id)` : sql`NULL`} AS "stationCode",
            COALESCE((SELECT json_agg(json_build_object('id', a.id, 'kind', a.kind, 'uploaded', a.upload_status = 'subido') ORDER BY a.taken_at)
              FROM attachments a WHERE a.owner_type = 'logistics' AND a.owner_id = t.id), '[]'::json) AS files
          FROM ${sql.raw(table)} t
          LEFT JOIN brigades b ON b.id = t.brigade_id
          JOIN users u ON u.id = t.registered_by_id
          WHERE t.project_id = ${req.params.projectId}
          ORDER BY t.updated_at DESC
          LIMIT 1000`)).rows;
      }
      return result;
    },
  );
};

export default logisticsRoutes;
