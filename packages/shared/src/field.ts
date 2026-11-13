import { z } from 'zod';

/**
 * Registro de campo (Sprint 1.3): ejecución de una unidad de muestreo con sus fotos,
 * registros del formulario y notas de voz. El teléfono genera los ids (clientId) para
 * poder trabajar offline y reenviar sin duplicar.
 */

export const EXECUTION_STATUSES = ['en_curso', 'fotos_ok', 'completada', 'no_realizada'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/** Un registro del formulario (p. ej. una especie observada en el punto de conteo). */
export const fieldRecordSchema = z.object({
  id: uuid,
  values: z.record(z.string(), z.unknown()),
  createdAt: isoDateTime,
  updatedAt: isoDateTime.optional(),
});
export type FieldRecord = z.infer<typeof fieldRecordSchema>;

export const executionFormDataSchema = z.object({
  records: z.array(fieldRecordSchema).max(500).default([]),
});
export type ExecutionFormData = z.infer<typeof executionFormDataSchema>;

export const executionSyncSchema = z
  .object({
    clientId: uuid,
    /** Unidad existente (programada). */
    samplingUnitId: uuid.nullish(),
    /** Unidad nueva creada en campo (métodos de registro abierto, p. ej. registros oportunos). */
    newUnit: z.object({ clientId: uuid, stationMethodId: uuid }).nullish(),
    stationId: uuid,
    methodId: uuid,
    scheduleId: uuid.nullish(),
    brigadeId: uuid.nullish(),
    status: z.enum(EXECUTION_STATUSES),
    startedAt: isoDateTime,
    finishedAt: isoDateTime.nullish(),
    startLat: lat.nullish(),
    startLng: lng.nullish(),
    startAccuracy: z.number().min(0).max(100000).nullish(),
    formData: executionFormDataSchema,
    formCompletedAt: isoDateTime.nullish(),
    observations: z.string().max(4000).nullish(),
    deviceId: z.string().max(100).nullish(),
    clientUpdatedAt: isoDateTime,
  })
  .refine((e) => !!e.samplingUnitId !== !!e.newUnit, 'Indica la unidad existente o la unidad nueva (solo una)');
export type ExecutionSync = z.infer<typeof executionSyncSchema>;

export type ExecutionSyncResult = {
  id: string;
  clientId: string;
  samplingUnitId: string;
  unitCode: string;
  unitStatus: string;
  /** false si el servidor ya tenía una versión más reciente (no se sobrescribe). */
  applied: boolean;
};

export const ATTACHMENT_KINDS_FIELD = ['foto', 'foto_metodo', 'audio', 'documento', 'comprobante'] as const;

export const attachmentMetaSchema = z.object({
  clientId: uuid,
  /** Dueño del archivo: la ejecución de una unidad, una alerta o un registro logístico (solo uno). */
  executionClientId: uuid.nullish(),
  incidentClientId: uuid.nullish(),
  logisticsClientId: uuid.nullish(),
  kind: z.enum(ATTACHMENT_KINDS_FIELD),
  slotKey: z.string().max(40).nullish(),
  mimeType: z.enum(['image/jpeg', 'audio/mp4', 'audio/m4a', 'audio/aac']),
  sizeBytes: z.number().int().min(0).nullish(),
  originalSizeBytes: z.number().int().min(0).nullish(),
  width: z.number().int().min(0).nullish(),
  height: z.number().int().min(0).nullish(),
  durationSec: z.number().int().min(0).nullish(),
  lat: lat.nullish(),
  lng: lng.nullish(),
  accuracy: z.number().min(0).max(100000).nullish(),
  altitude: z.number().min(-500).max(9000).nullish(),
  takenAt: isoDateTime,
  caption: z.string().max(500).nullish(),
}).refine(
  (a) => [a.executionClientId, a.incidentClientId, a.logisticsClientId].filter(Boolean).length === 1,
  'Indica la ejecución, la alerta o el registro logístico (solo uno)',
);
export type AttachmentMeta = z.infer<typeof attachmentMetaSchema>;

export type AttachmentVariant = 'compressed' | 'original';
export type AttachmentMetaResult = {
  id: string;
  clientId: string;
  uploadStatus: 'pendiente' | 'subido' | 'error';
  originalUploadStatus: 'pendiente' | 'subido' | 'error';
};

/** Lado mayor de la copia comprimida de las fotos (px) y su calidad JPEG. */
export const PHOTO_COMPRESSED_MAX = 1600;
export const PHOTO_COMPRESSED_QUALITY = 72;
