import {
  pgTable, text, uuid, integer, timestamp, jsonb, index, uniqueIndex, pgEnum, boolean, bigint, doublePrecision,
} from 'drizzle-orm/pg-core';
import { id, createdAt, updatedAt, pointGeom } from './_common.js';
import { users } from './core.js';
import { brigades, methods, projects, samplingUnits, schedules, stations } from './project.js';

export const executionStatusEnum = pgEnum('execution_status', ['en_curso', 'fotos_ok', 'completada', 'no_realizada']);

/** Ejecución de una unidad de muestreo por un especialista. */
export const executions = pgTable(
  'executions',
  {
    id: id(),
    clientId: uuid('client_id').notNull(), // idempotencia del sync
    samplingUnitId: uuid('sampling_unit_id')
      .notNull()
      .references(() => samplingUnits.id, { onDelete: 'cascade' }),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    methodId: uuid('method_id')
      .notNull()
      .references(() => methods.id),
    scheduleId: uuid('schedule_id').references(() => schedules.id),
    specialistId: uuid('specialist_id')
      .notNull()
      .references(() => users.id),
    brigadeId: uuid('brigade_id').references(() => brigades.id),
    status: executionStatusEnum('status').notNull().default('en_curso'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    startGeom: pointGeom('start_geom'),
    startAccuracy: doublePrecision('start_accuracy'),
    /** Datos del formulario reducido (según form_schema del método). */
    formData: jsonb('form_data').$type<Record<string, unknown>>().notNull().default({}),
    formCompletedAt: timestamp('form_completed_at', { withTimezone: true }),
    observations: text('observations'),
    deviceId: text('device_id'),
    clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('executions_client_idx').on(t.clientId),
    index('executions_unit_idx').on(t.samplingUnitId),
    index('executions_specialist_idx').on(t.specialistId),
  ],
);

export const attachmentKindEnum = pgEnum('attachment_kind', ['foto', 'foto_metodo', 'audio', 'documento', 'comprobante']);
export const attachmentOwnerEnum = pgEnum('attachment_owner', [
  'execution',
  'incident',
  'alert_message',
  'inquiry_message',
  'logistics',
  'station',
]);
export const uploadStatusEnum = pgEnum('upload_status', ['pendiente', 'subido', 'error']);

/** Fotos, audios y documentos. Ruta en MinIO organizada automáticamente. */
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    ownerType: attachmentOwnerEnum('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    kind: attachmentKindEnum('kind').notNull(),
    slotKey: text('slot_key'), // norte | sur | frontal | ... | metodo
    /** Copia comprimida (uso en web/app). */
    objectKey: text('object_key').notNull(),
    /** Original en alta resolución. */
    originalObjectKey: text('original_object_key'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    originalSizeBytes: bigint('original_size_bytes', { mode: 'number' }),
    width: integer('width'),
    height: integer('height'),
    durationSec: integer('duration_sec'),
    geom: pointGeom('geom'),
    accuracy: doublePrecision('accuracy'),
    altitude: doublePrecision('altitude'),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull(),
    uploadedById: uuid('uploaded_by_id')
      .notNull()
      .references(() => users.id),
    projectId: uuid('project_id').references(() => projects.id),
    stationId: uuid('station_id').references(() => stations.id),
    samplingUnitId: uuid('sampling_unit_id').references(() => samplingUnits.id),
    uploadStatus: uploadStatusEnum('upload_status').notNull().default('pendiente'),
    originalUploadStatus: uploadStatusEnum('original_upload_status').notNull().default('pendiente'),
    caption: text('caption'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('attachments_client_idx').on(t.clientId),
    index('attachments_owner_idx').on(t.ownerType, t.ownerId),
    index('attachments_unit_idx').on(t.samplingUnitId),
  ],
);

export const incidentTypeEnum = pgEnum('incident_type', [
  'metodologica',
  'climatica',
  'lluvia_intensa',
  'tecnica',
  'imposibilidad',
  'logistica',
  'seguridad',
  'otra',
  'accidente_movilidad',
  'desperfecto_mecanico',
  'hospedaje',
  'equipos',
]);
export const incidentMomentEnum = pgEnum('incident_moment', ['antes', 'durante', 'posterior']);
export const incidentStatusEnum = pgEnum('incident_status', ['abierta', 'en_revision', 'resuelta', 'rechazada', 'cerrada']);

/** Incidencias / alertas registradas en campo (especialista, supervisor, logístico). */
export const incidents = pgTable(
  'incidents',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    brigadeId: uuid('brigade_id').references(() => brigades.id),
    stationId: uuid('station_id').references(() => stations.id),
    methodId: uuid('method_id').references(() => methods.id),
    samplingUnitId: uuid('sampling_unit_id').references(() => samplingUnits.id),
    scheduleId: uuid('schedule_id').references(() => schedules.id),
    reportedById: uuid('reported_by_id')
      .notNull()
      .references(() => users.id),
    type: incidentTypeEnum('type').notNull(),
    moment: incidentMomentEnum('moment'),
    launchedFrom: text('launched_from'), // mi_jornada | metodo | supervisor | logistica
    description: text('description').notNull(),
    proposedAction: text('proposed_action'),
    /** Supervisor: desviación metodológica y acción correctiva. */
    methodologicalDeviation: text('methodological_deviation'),
    /** Acción correctiva aplicada en campo (supervisor); la de coordinación va en corrective_action. */
    fieldCorrectiveAction: text('field_corrective_action'),
    correctiveAction: text('corrective_action'),
    resolutionNotes: text('resolution_notes'),
    status: incidentStatusEnum('status').notNull().default('abierta'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    geom: pointGeom('geom'),
    resolvedById: uuid('resolved_by_id').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    coordinationResponse: text('coordination_response'),
    coordinationDecision: text('coordination_decision'), // aprobada | rechazada | info_adicional
    clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('incidents_client_idx').on(t.clientId),
    index('incidents_project_status_idx').on(t.projectId, t.status),
    index('incidents_brigade_idx').on(t.brigadeId),
  ],
);

/** Hilo de trazabilidad de una incidencia/alerta (comentarios, solicitudes, respuestas). */
export const incidentMessages = pgTable(
  'incident_messages',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    kind: text('kind').notNull().default('comentario'), // comentario | solicitud_info | respuesta | decision
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('incident_messages_client_idx').on(t.clientId), index('incident_messages_incident_idx').on(t.incidentId)],
);

export const rescheduleStatusEnum = pgEnum('reschedule_status', ['propuesta', 'aprobada', 'rechazada']);

/** Reprogramaciones con historial completo. */
export const reschedules = pgTable(
  'reschedules',
  {
    id: id(),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => schedules.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id').references(() => incidents.id),
    fromDate: timestamp('from_date', { withTimezone: true }).notNull(),
    toDate: timestamp('to_date', { withTimezone: true }).notNull(),
    newBrigadeId: uuid('new_brigade_id').references(() => brigades.id),
    newStationId: uuid('new_station_id').references(() => stations.id),
    reason: text('reason').notNull(),
    justification: text('justification'),
    status: rescheduleStatusEnum('status').notNull().default('propuesta'),
    proposedById: uuid('proposed_by_id').references(() => users.id),
    approvedById: uuid('approved_by_id').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('reschedules_schedule_idx').on(t.scheduleId)],
);

export const inquiryStatusEnum = pgEnum('inquiry_status', ['abierta', 'respondida', 'cerrada']);

/** Consultas coordinador/jefe de proyecto <-> campo (incluye llamadas registradas a mano). */
export const inquiries = pgTable(
  'inquiries',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    brigadeId: uuid('brigade_id').references(() => brigades.id),
    targetUserId: uuid('target_user_id').references(() => users.id),
    stationId: uuid('station_id').references(() => stations.id),
    methodId: uuid('method_id').references(() => methods.id),
    incidentId: uuid('incident_id').references(() => incidents.id),
    subject: text('subject').notNull(),
    channel: text('channel').notNull().default('app'), // app | telefono | whatsapp | radio | presencial
    status: inquiryStatusEnum('status').notNull().default('abierta'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('inquiries_project_idx').on(t.projectId), index('inquiries_target_idx').on(t.targetUserId)],
);

export const inquiryMessages = pgTable(
  'inquiry_messages',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    inquiryId: uuid('inquiry_id')
      .notNull()
      .references(() => inquiries.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('inquiry_messages_client_idx').on(t.clientId), index('inquiry_messages_inquiry_idx').on(t.inquiryId)],
);

/** Versión del paquete de trabajo descargado por cada dispositivo. */
export const workPackageDownloads = pgTable(
  'work_package_downloads',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: text('device_id'),
    projectId: uuid('project_id').references(() => projects.id),
    fromDate: timestamp('from_date', { withTimezone: true }),
    toDate: timestamp('to_date', { withTimezone: true }),
    version: text('version').notNull(),
    downloadedAt: createdAt(),
  },
  (t) => [index('work_package_downloads_user_idx').on(t.userId)],
);

/** Bitácora de sincronización (push) por dispositivo. */
export const syncLogs = pgTable(
  'sync_logs',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: text('device_id'),
    direction: text('direction').notNull(), // push | pull
    received: integer('received').notNull().default(0),
    applied: integer('applied').notNull().default(0),
    conflicts: integer('conflicts').notNull().default(0),
    errors: integer('errors').notNull().default(0),
    detail: jsonb('detail').$type<unknown>(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ok: boolean('ok').notNull().default(true),
  },
  (t) => [index('sync_logs_user_idx').on(t.userId, t.startedAt)],
);
