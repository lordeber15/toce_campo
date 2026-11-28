import { photoDownloadName } from '@toce/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { Readable } from 'node:stream';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  LOGISTICS_ENTITIES, WEB_ROLES, attachmentMetaSchema, executionSyncSchema, hasAnyRole, unitCode,
  type AttachmentMetaResult, type ExecutionSyncResult, type ExecutionFormData, type FormSchema, validateFormValues, canonicalFormJson,
} from '@toce/shared';
import { db } from '../db/index.js';
import { HttpError, badRequest, conflict, idParam, notFound } from '../lib/http.js';
import { LOGISTICS_TABLES } from './logistics.js';
import { classifyPhotos } from '../lib/geo.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const UNIT_STATUS_BY_EXECUTION = {
  en_curso: 'en_ejecucion',
  fotos_ok: 'fotos_ok',
  completada: 'completada',
  no_realizada: 'no_realizada',
} as const;

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac' };

/** El usuario participa en una brigada activa programada en la estación (o es de gestión web). */
export async function canWorkStation(userId: string, roles: string[], stationId: string): Promise<boolean> {
  if (hasAnyRole(roles as never, WEB_ROLES)) return true;
  const r = await db.execute(sql`
    SELECT 1 FROM schedules sc JOIN brigades b ON b.id = sc.brigade_id AND b.is_active
    WHERE sc.station_id = ${stationId} AND (
      b.leader_id = ${userId} OR b.supervisor_id = ${userId} OR b.logistician_id = ${userId}
      OR EXISTS (SELECT 1 FROM brigade_members bm WHERE bm.brigade_id = b.id AND bm.user_id = ${userId} AND bm.left_at IS NULL))
    LIMIT 1`);
  return r.rows.length > 0;
}

/**
 * Crea (una sola vez, por clientId) una unidad hecha en campo con el siguiente correlativo:
 * registros de un método abierto o unidades adicionales a las programadas (en cualquier método).
 */
async function ensureOpenUnit(tx: Tx, userId: string, stationId: string, methodId: string, u: { clientId: string; stationMethodId: string }) {
  const existing = (await tx.execute(sql`SELECT id, code FROM sampling_units WHERE client_id = ${u.clientId}`)).rows[0] as
    | { id: string; code: string }
    | undefined;
  if (existing) return existing;
  const sm = (await tx.execute(sql`
    SELECT sm.id, s.code AS "stationCode", m.code AS "methodCode"
    FROM station_methods sm JOIN stations s ON s.id = sm.station_id JOIN methods m ON m.id = sm.method_id
    WHERE sm.id = ${u.stationMethodId} AND sm.station_id = ${stationId} AND sm.method_id = ${methodId}
    FOR UPDATE OF sm`)).rows[0] as { id: string; stationCode: string; methodCode: string } | undefined;
  if (!sm) throw badRequest('El método no está habilitado en la estación');
  const next = (await tx.execute(sql`
    SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM sampling_units WHERE station_method_id = ${sm.id}`)).rows[0] as { seq: number };
  const seq = Number(next.seq);
  const code = unitCode(sm.stationCode, sm.methodCode, seq);
  const row = (await tx.execute(sql`
    INSERT INTO sampling_units (station_method_id, station_id, method_id, seq, code, client_id, created_by_id)
    VALUES (${sm.id}, ${stationId}, ${methodId}, ${seq}, ${code}, ${u.clientId}, ${userId})
    RETURNING id, code`)).rows[0] as { id: string; code: string };
  return row;
}

/**
 * Sincronización del registro de campo:
 * - POST /field/executions: crea o actualiza la ejecución de una unidad (idempotente por clientId).
 * - POST /field/attachments: registra los datos de una foto o nota de voz.
 * - PUT  /field/attachments/:clientId/content?variant=compressed|original: sube el archivo a MinIO.
 * - GET  /field/attachments/:id/url: enlace temporal para ver el archivo.
 */
const fieldRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/field/station-forms', { onRequest: app.authenticate, schema: {body:z.object({
    clientId:z.string().uuid(),stationMethodId:z.string().uuid(),fieldDate:z.iso.date(),
    values:z.record(z.string(),z.unknown()),updatedAt:z.string().datetime({offset:true}),
  })}}, async(req)=>{
    const e=req.body;
    return db.transaction(async(tx)=>{
      const sm=(await tx.execute(sql`SELECT sm.station_id AS "stationId",m.form_schema AS "formSchema" FROM station_methods sm JOIN methods m ON m.id=sm.method_id WHERE sm.id=${e.stationMethodId} FOR SHARE OF m`)).rows[0] as {stationId:string;formSchema:FormSchema}|undefined;
      if(!sm) throw notFound('Método de la estación');
      if(!(await canWorkStation(req.user.sub,req.user.roles,sm.stationId))) throw new HttpError(403,'No tienes programación en esta estación');
      const prior=(await tx.execute(sql`SELECT specialist_id AS owner,station_method_id AS "stationMethodId",schema_snapshot AS "schemaSnapshot" FROM station_method_forms WHERE client_id=${e.clientId} FOR UPDATE`)).rows[0] as {owner:string;stationMethodId:string;schemaSnapshot:FormSchema}|undefined;
      if(prior&&prior.owner!==req.user.sub)throw new HttpError(403,'Este registro pertenece a otro especialista');
      if(prior&&prior.stationMethodId!==e.stationMethodId)throw conflict('Este registro pertenece a otro método o estación');
      const schema=prior?.schemaSnapshot??sm.formSchema;
      const fields=schema.fields.filter((f)=>f.level==='estacion_metodo');
      if(!fields.length||Object.keys(e.values).some((k)=>!fields.some((f)=>f.key===k)))throw badRequest('Campos de estación-método inválidos');
      const errors=validateFormValues(fields,e.values);
      if(Object.keys(errors).length)throw badRequest(Object.values(errors).join(', '));
      await tx.execute(sql`INSERT INTO station_method_forms(client_id,station_method_id,specialist_id,field_date,"values",schema_snapshot,updated_at)
        VALUES(${e.clientId},${e.stationMethodId},${req.user.sub},${e.fieldDate},${JSON.stringify(e.values)}::jsonb,${JSON.stringify(schema)}::jsonb,${e.updatedAt})
        ON CONFLICT(client_id) DO UPDATE SET "values"=EXCLUDED."values",field_date=EXCLUDED.field_date,updated_at=EXCLUDED.updated_at
        WHERE station_method_forms.updated_at <= EXCLUDED.updated_at AND station_method_forms.specialist_id=EXCLUDED.specialist_id`);
      return {saved:true};
    });
  });

  // Los archivos llegan como cuerpo binario y se envían a MinIO en streaming (sin cargarlos en memoria).
  app.addContentTypeParser(['image/jpeg', 'audio/mp4', 'audio/m4a', 'audio/aac', 'application/octet-stream'], (_req, payload, done) =>
    done(null, payload),
  );

  r.post(
    '/field/executions',
    { onRequest: app.authenticate, schema: { body: executionSyncSchema } },
    async (req): Promise<ExecutionSyncResult> => {
      const e = req.body;
      const userId = req.user.sub;
      if (!(await canWorkStation(userId, req.user.roles, e.stationId))) throw new HttpError(403, 'No tienes programación en esta estación');

      return db.transaction(async (tx) => {
        const method = (await tx.execute(sql`SELECT form_schema AS "formSchema" FROM methods WHERE id = ${e.methodId} FOR SHARE`)).rows[0] as { formSchema: FormSchema } | undefined;
        if (!method) throw notFound('Método');
        let unit: { id: string; code: string };
        if (e.newUnit) {
          unit = await ensureOpenUnit(tx, userId, e.stationId, e.methodId, e.newUnit);
        } else {
          const u = (await tx.execute(sql`
            SELECT id, code FROM sampling_units WHERE id = ${e.samplingUnitId!} AND station_id = ${e.stationId} AND method_id = ${e.methodId}`))
            .rows[0] as { id: string; code: string } | undefined;
          if (!u) throw notFound('Unidad de muestreo');
          unit = u;
          // Trabajo de una unidad que se dejó fuera de plan mientras el teléfono no tenía señal: se reactiva, no se pierde.
          await tx.execute(sql`UPDATE sampling_units SET retired_at = NULL, updated_at = now() WHERE id = ${u.id} AND retired_at IS NOT NULL`);
        }

        const geom = e.startLat != null && e.startLng != null ? sql`ST_SetSRID(ST_MakePoint(${e.startLng}, ${e.startLat}), 4326)` : sql`NULL`;
        const prev = (await tx.execute(sql`
          SELECT id, specialist_id AS "specialistId", client_updated_at AS "clientUpdatedAt", form_data AS "formData"
          FROM executions WHERE client_id = ${e.clientId} FOR UPDATE`)).rows[0] as
          | { id: string; specialistId: string; clientUpdatedAt: string | Date; formData: ExecutionFormData }
          | undefined;

        if (prev && prev.specialistId !== userId) throw new HttpError(403, 'Este registro pertenece a otro especialista');
        // Última escritura gana, según la hora del teléfono: un reenvío antiguo no pisa uno más nuevo.
        if (prev && new Date(prev.clientUpdatedAt).getTime() > new Date(e.clientUpdatedAt).getTime()) {
          const st = (await tx.execute(sql`SELECT status FROM sampling_units WHERE id = ${unit.id}`)).rows[0] as { status: string };
          return { id: prev.id, clientId: e.clientId, samplingUnitId: unit.id, unitCode: unit.code, unitStatus: st.status, applied: false };
        }

        const pinned = prev?.formData.schemaSnapshot;
        if (pinned && e.formData.schemaSnapshot && canonicalFormJson(pinned) !== canonicalFormJson(e.formData.schemaSnapshot)) throw conflict('Esta evaluación usa otro formulario. Conserva su versión original.');
        if (!pinned && !e.formData.schemaSnapshot && method.formSchema.version === 2) throw conflict('Actualiza la aplicación y el paquete de trabajo antes de sincronizar este formulario.');
        const formData = { ...prev?.formData, ...e.formData, schemaSnapshot: pinned ?? e.formData.schemaSnapshot ?? method.formSchema };
        const values = sql`
          ${unit.id}, ${e.stationId}, ${e.methodId}, ${e.scheduleId ?? null}, ${userId}, ${e.brigadeId ?? null},
          ${e.status}, ${e.startedAt}, ${e.finishedAt ?? null}, ${geom}, ${e.startAccuracy ?? null},
          ${JSON.stringify(formData)}::jsonb, ${e.formCompletedAt ?? null}, ${e.observations ?? null}, ${e.deviceId ?? null}, ${e.clientUpdatedAt}`;
        const row = (await tx.execute(sql`
          INSERT INTO executions (client_id, sampling_unit_id, station_id, method_id, schedule_id, specialist_id, brigade_id,
            status, started_at, finished_at, start_geom, start_accuracy, form_data, form_completed_at, observations, device_id, client_updated_at)
          VALUES (${e.clientId}, ${values})
          ON CONFLICT (client_id) DO UPDATE SET
            status = EXCLUDED.status, finished_at = EXCLUDED.finished_at, start_geom = COALESCE(EXCLUDED.start_geom, executions.start_geom),
            start_accuracy = COALESCE(EXCLUDED.start_accuracy, executions.start_accuracy), form_data = EXCLUDED.form_data,
            form_completed_at = EXCLUDED.form_completed_at, observations = EXCLUDED.observations,
            client_updated_at = EXCLUDED.client_updated_at, synced_at = now(), updated_at = now()
          RETURNING id`)).rows[0] as { id: string };

        // Una unidad puede tener varias evaluaciones: queda completada si alguna lo está (una nueva
        // evaluación no baja el avance); si no, toma el estado de la evaluación más reciente.
        const agg = (await tx.execute(sql`
          SELECT bool_or(status = 'completada') AS done, (array_agg(status ORDER BY started_at DESC, client_updated_at DESC))[1] AS latest
          FROM executions WHERE sampling_unit_id = ${unit.id}`)).rows[0] as { done: boolean | null; latest: keyof typeof UNIT_STATUS_BY_EXECUTION | null } | undefined;
        const unitStatus = agg?.done ? 'completada' : UNIT_STATUS_BY_EXECUTION[agg?.latest ?? e.status];
        await tx.execute(sql`UPDATE sampling_units SET status = ${unitStatus}, updated_at = now() WHERE id = ${unit.id}`);
        // La estación pasa a "en ejecución" con el primer registro.
        await tx.execute(sql`UPDATE stations SET status = 'en_ejecucion', updated_at = now() WHERE id = ${e.stationId} AND status = 'planificada'`);

        return { id: row.id, clientId: e.clientId, samplingUnitId: unit.id, unitCode: unit.code, unitStatus, applied: true };
      });
    },
  );

  r.post(
    '/field/attachments',
    { onRequest: app.authenticate, schema: { body: attachmentMetaSchema } },
    async (req): Promise<AttachmentMetaResult> => {
      const a = req.body;
      const userId = req.user.sub;
      // Dueño: ejecución de una unidad o alerta. Debe estar sincronizado antes que sus archivos.
      type Owner = {
        type: 'execution' | 'incident' | 'logistics' | 'inquiry_message'; id: string; by: string; stationId: string | null; unitId: string | null; projectId: string;
        folder?: string;
      };
      let owner: Owner | undefined;
      if (a.executionClientId) {
        owner = (await db.execute(sql`
          SELECT 'execution' AS type, e.id, e.specialist_id AS "by", e.station_id AS "stationId", e.sampling_unit_id AS "unitId", s.project_id AS "projectId"
          FROM executions e JOIN stations s ON s.id = e.station_id WHERE e.client_id = ${a.executionClientId}`)).rows[0] as Owner | undefined;
        if (!owner) throw conflict('Primero se debe sincronizar el registro de la unidad');
      } else if (a.inquiryReplyClientId) {
        // Foto de una respuesta a coordinación: va con el mensaje (y la consulta) ya sincronizados.
        owner = (await db.execute(sql`
          SELECT 'inquiry_message' AS type, im.id, im.author_id AS "by", q.station_id AS "stationId", NULL::uuid AS "unitId",
            q.project_id AS "projectId", q.id::text AS folder
          FROM inquiry_messages im JOIN inquiries q ON q.id = im.inquiry_id WHERE im.client_id = ${a.inquiryReplyClientId}`)).rows[0] as Owner | undefined;
        if (!owner) throw conflict('Primero se debe sincronizar la respuesta');
      } else if (a.logisticsClientId) {
        // Registro logístico: se busca en las tablas de logística por su clientId.
        const union = sql.join(
          LOGISTICS_ENTITIES.map((e) => {
            const t = LOGISTICS_TABLES[e];
            return sql`SELECT 'logistics' AS type, id, registered_by_id AS "by", ${e === 'sample' ? sql`station_id` : sql`NULL::uuid`} AS "stationId",
              NULL::uuid AS "unitId", project_id AS "projectId", ${t.folder} AS folder FROM ${sql.raw(t.table)} WHERE client_id = ${a.logisticsClientId!}`;
          }),
          sql` UNION ALL `,
        );
        owner = (await db.execute(union)).rows[0] as Owner | undefined;
        if (!owner) throw conflict('Primero se debe sincronizar el registro logístico');
      } else {
        owner = (await db.execute(sql`
          SELECT 'incident' AS type, id, reported_by_id AS "by", station_id AS "stationId", sampling_unit_id AS "unitId", project_id AS "projectId"
          FROM incidents WHERE client_id = ${a.incidentClientId!}`)).rows[0] as Owner | undefined;
        if (!owner) throw conflict('Primero se debe sincronizar la alerta');
      }
      if (owner.by !== userId) throw new HttpError(403, 'Este registro pertenece a otro usuario');

      const prev = (await db.execute(sql`
        SELECT id, upload_status AS "uploadStatus", original_upload_status AS "originalUploadStatus", uploaded_by_id AS "by"
        FROM attachments WHERE client_id = ${a.clientId}`)).rows[0] as (AttachmentMetaResult & { by: string }) | undefined;
      if (prev) {
        if (prev.by !== userId) throw new HttpError(403, 'Archivo de otro usuario');
        return { id: prev.id, clientId: a.clientId, uploadStatus: prev.uploadStatus, originalUploadStatus: prev.originalUploadStatus };
      }

      // Ruta en MinIO: <proyecto>/<estación>/<unidad>/fotos|audios|originales  o  <proyecto>/<estación|general>/alertas/<alerta>/...
      const keys = (await db.execute(sql`
        SELECT p.code AS "project", s.code AS "station", u.code AS "unit"
        FROM projects p LEFT JOIN stations s ON s.id = ${owner.stationId} LEFT JOIN sampling_units u ON u.id = ${owner.unitId}
        WHERE p.id = ${owner.projectId}`)).rows[0] as { project: string; station: string | null; unit: string | null };
      const folder = a.kind === 'audio' ? 'audios' : a.kind === 'comprobante' ? 'comprobantes' : 'fotos';
      const ext = EXT[a.mimeType] ?? 'bin';
      const base = owner.type === 'execution'
        ? `${keys.project}/${keys.station}/${keys.unit}`
        : owner.type === 'logistics'
          ? `${keys.project}/logistica/${owner.folder}/${a.logisticsClientId}`
          : owner.type === 'inquiry_message'
            ? `${keys.project}/consultas/${owner.folder}`
            : `${keys.project}/${keys.station ?? 'general'}/alertas/${a.incidentClientId}`;
      const objectKey = `${base}/${folder}/${a.clientId}.${ext}`;
      // Las notas de voz no tienen copia comprimida: el original es el mismo archivo.
      const originalKey = a.kind === 'audio' ? null : `${base}/originales/${a.clientId}.${ext}`;
      const ex = owner;
      const geom = a.lat != null && a.lng != null ? sql`ST_SetSRID(ST_MakePoint(${a.lng}, ${a.lat}), 4326)` : sql`NULL`;

      const row = (await db.execute(sql`
        INSERT INTO attachments (client_id, owner_type, owner_id, kind, slot_key, object_key, original_object_key, mime_type,
          size_bytes, original_size_bytes, width, height, duration_sec, geom, accuracy, altitude, taken_at, uploaded_by_id,
          project_id, station_id, sampling_unit_id, original_upload_status, caption)
        VALUES (${a.clientId}, ${ex.type}, ${ex.id}, ${a.kind}, ${a.slotKey ?? null}, ${objectKey}, ${originalKey}, ${a.mimeType},
          ${a.sizeBytes ?? null}, ${a.originalSizeBytes ?? null}, ${a.width ?? null}, ${a.height ?? null}, ${a.durationSec ?? null},
          ${geom}, ${a.accuracy ?? null}, ${a.altitude ?? null}, ${a.takenAt}, ${userId},
          ${ex.projectId}, ${ex.stationId}, ${ex.unitId}, ${a.kind === 'audio' ? 'subido' : 'pendiente'}, ${a.caption ?? null})
        ON CONFLICT (client_id) DO NOTHING
        RETURNING id, upload_status AS "uploadStatus", original_upload_status AS "originalUploadStatus"`)).rows[0] as
        | Omit<AttachmentMetaResult, 'clientId'>
        | undefined;
      if (!row) throw conflict('Archivo registrado en paralelo; reintenta');
      // Dentro o fuera del polígono de la brigada (lo decide el servidor, no el teléfono).
      if (a.kind === 'foto' || a.kind === 'foto_metodo') await classifyPhotos(db, sql`a.id = ${row.id}`);
      if (ex.type === 'inquiry_message') await db.execute(sql`UPDATE inquiries SET updated_at = now() WHERE id = ${ex.folder!}::uuid`);
      return { ...row, clientId: a.clientId };
    },
  );

  r.put(
    '/field/attachments/:clientId/content',
    {
      onRequest: app.authenticate,
      schema: {
        params: z.object({ clientId: z.string().uuid() }),
        querystring: z.object({ variant: z.enum(['compressed', 'original']).default('compressed') }),
      },
    },
    async (req) => {
      const { clientId } = req.params;
      const { variant } = req.query;
      const a = (await db.execute(sql`
        SELECT id, kind, mime_type AS "mimeType", object_key AS "objectKey", original_object_key AS "originalKey", uploaded_by_id AS "by"
        FROM attachments WHERE client_id = ${clientId}`)).rows[0] as
        | { id: string; kind: string; mimeType: string; objectKey: string; originalKey: string | null; by: string }
        | undefined;
      if (!a) throw notFound('Archivo');
      if (a.by !== req.user.sub) throw new HttpError(403, 'Archivo de otro usuario');
      const key = variant === 'original' ? a.originalKey : a.objectKey;
      if (!key) throw badRequest('Este archivo no tiene versión original separada');

      const body = req.body as Readable | undefined;
      const declared = req.headers['content-length'] ? Number(req.headers['content-length']) : undefined;
      if (!body || typeof body.pipe !== 'function' || declared === 0) throw badRequest('Archivo vacío');

      // Sin content-length (envío por partes) MinIO sube en multipart sin conocer el tamaño.
      await app.minio.putObject(app.minioBucket, key, body, declared, { 'Content-Type': a.mimeType });
      const stat = await app.minio.statObject(app.minioBucket, key);
      if (!stat.size) throw badRequest('Archivo vacío');
      if (variant === 'original') {
        await db.execute(sql`UPDATE attachments SET original_upload_status = 'subido', original_size_bytes = ${stat.size}, updated_at = now() WHERE id = ${a.id}`);
      } else {
        await db.execute(sql`UPDATE attachments SET upload_status = 'subido', size_bytes = ${stat.size}, updated_at = now() WHERE id = ${a.id}`);
      }
      return { ok: true, variant, size: stat.size };
    },
  );

  r.get(
    '/field/attachments/:id/url',
    {
      onRequest: app.authenticate,
      schema: { params: idParam, querystring: z.object({ variant: z.enum(['compressed', 'original']).default('compressed') }) },
    },
    async (req) => {
      const a = (await db.execute(sql`
        SELECT a.object_key AS "objectKey", a.original_object_key AS "originalKey", a.uploaded_by_id AS "by", a.station_id AS "stationId",
          a.upload_status AS "up", a.original_upload_status AS "oup", a.kind, a.mime_type AS "mimeType", s.code AS station,
          su.code AS unit, m.code AS "methodCode", m.name AS "methodName", a.id,
          to_char(a.taken_at AT TIME ZONE 'America/Lima', 'YYYYMMDD-HH24MISS') AS taken
        FROM attachments a LEFT JOIN stations s ON s.id = a.station_id
        LEFT JOIN sampling_units su ON su.id = a.sampling_unit_id
        LEFT JOIN station_methods sm ON sm.id = su.station_method_id
        LEFT JOIN methods m ON m.id = sm.method_id
        WHERE a.id = ${req.params.id}`)).rows[0] as
        | { objectKey: string; originalKey: string | null; by: string; stationId: string; up: string; oup: string;
          kind: string; mimeType: string; station: string | null; unit: string | null; methodCode: string | null; methodName: string | null; id: string; taken: string }
        | undefined;
      if (!a) throw notFound('Archivo');
      if (a.by !== req.user.sub && !(await canWorkStation(req.user.sub, req.user.roles, a.stationId))) throw new HttpError(403, 'Sin acceso');
      const original = req.query.variant === 'original' && a.originalKey;
      if ((original ? a.oup : a.up) !== 'subido') throw conflict('El archivo aún no se ha subido');
      const filename = a.mimeType === 'image/jpeg' ? photoDownloadName(a, !!original) : `${a.id}.${EXT[a.mimeType] ?? 'bin'}`;
      const url = await app.minioSign.presignedGetObject(app.minioBucket, original ? a.originalKey! : a.objectKey, 15 * 60, {
        'response-content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      });
      return { url, filename };
    },
  );
};

export default fieldRoutes;
