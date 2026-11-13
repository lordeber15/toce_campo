import {
  pgTable, text, boolean, uuid, integer, date, timestamp, jsonb, index, uniqueIndex, pgEnum, time,
} from 'drizzle-orm/pg-core';
import type { FormSchema, PhotoSlot } from '@toce/shared';
import { id, createdAt, updatedAt, deletedAt, pointGeom, anyGeom } from './_common.js';
import { specialties, users } from './core.js';

export const projectStatusEnum = pgEnum('project_status', ['planificado', 'en_curso', 'cerrado']);

export const projects = pgTable('projects', {
  id: id(),
  code: text('code').notNull().unique(), // TOKE
  name: text('name').notNull(),
  client: text('client'),
  description: text('description'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  status: projectStatusEnum('status').notNull().default('planificado'),
  /** Centro y zoom sugerido para el mapa. */
  centerLat: text('center_lat'),
  centerLng: text('center_lng'),
  utmZone: integer('utm_zone'), // p. ej. 18 (Perú: 17, 18, 19)
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

/** Capas vectoriales importadas desde KMZ: huella, AID, AII, UV, etc. */
export const layerKindEnum = pgEnum('layer_kind', ['huella', 'aid', 'aii', 'uv', 'superposicion', 'otro']);

export const projectLayers = pgTable(
  'project_layers',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: layerKindEnum('kind').notNull(),
    name: text('name').notNull(), // "Bosque montano (BAPa)", "AID", ...
    code: text('code'), // UV-03, ACR...
    color: text('color'),
    geom: anyGeom('geom').notNull(),
    properties: jsonb('properties').$type<Record<string, unknown>>(),
    sourceFile: text('source_file'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('project_layers_project_idx').on(t.projectId), index('project_layers_geom_idx').using('gist', t.geom)],
);

export const brigades = pgTable(
  'brigades',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // Sierra 2, Herpeto 1, Flora 1
    specialtyId: uuid('specialty_id').references(() => specialties.id),
    leaderId: uuid('leader_id').references(() => users.id), // jefe de brigada
    logisticianId: uuid('logistician_id').references(() => users.id),
    supervisorId: uuid('supervisor_id').references(() => users.id),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('brigades_project_idx').on(t.projectId), uniqueIndex('brigades_project_name_idx').on(t.projectId, t.name)],
);

export const brigadeMembers = pgTable(
  'brigade_members',
  {
    id: id(),
    brigadeId: uuid('brigade_id')
      .notNull()
      .references(() => brigades.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: createdAt(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('brigade_members_unique_idx').on(t.brigadeId, t.userId), index('brigade_members_user_idx').on(t.userId)],
);

/** Métodos de muestreo: PC, L20, ABS, RO, CT, SH, TH, VES, CD, PF, PT, TL, TV, CH, PP, EP ... */
export const methods = pgTable(
  'methods',
  {
    id: id(),
    specialtyId: uuid('specialty_id')
      .notNull()
      .references(() => specialties.id),
    code: text('code').notNull(), // PC
    name: text('name').notNull(), // Puntos de conteo
    description: text('description'),
    instructions: text('instructions'),
    /** Si true, las unidades se crean al vuelo sin límite (registros oportunos). */
    isOpenEnded: boolean('is_open_ended').notNull().default(false),
    defaultUnitsRequired: integer('default_units_required').notNull().default(1),
    scheduleStart: time('schedule_start'), // horario de ejecución sugerido
    scheduleEnd: time('schedule_end'),
    minDurationMin: integer('min_duration_min'),
    requirements: text('requirements').array().notNull().default([]),
    photoSlots: jsonb('photo_slots').$type<PhotoSlot[]>().notNull().default([]),
    methodPhotoRequired: boolean('method_photo_required').notNull().default(true),
    methodPhotoInstructions: text('method_photo_instructions'),
    formSchema: jsonb('form_schema').$type<FormSchema>().notNull().default({ fields: [] }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('methods_specialty_code_idx').on(t.specialtyId, t.code)],
);

export const stationStatusEnum = pgEnum('station_status', ['planificada', 'en_ejecucion', 'ejecutada', 'cancelada']);

/** Estaciones de monitoreo (EM-23, EM-41, EM-35A, ...). */
export const stations = pgTable(
  'stations',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    code: text('code').notNull(), // EM-23
    name: text('name'),
    geom: pointGeom('geom').notNull(),
    altitude: integer('altitude'),
    vegetationUnit: text('vegetation_unit'), // Bosque montano 1 (BAPa)
    vegetationLayerId: uuid('vegetation_layer_id').references(() => projectLayers.id),
    influenceArea: text('influence_area'), // AID | AII | fuera
    overlap: text('overlap'), // EF: San Pedro de Chonta / ACR / ninguna
    accessNotes: text('access_notes'),
    status: stationStatusEnum('status').notNull().default('planificada'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('stations_project_code_idx').on(t.projectId, t.code),
    index('stations_geom_idx').using('gist', t.geom),
  ],
);

/** Métodos habilitados por estación con esfuerzo previsto (unidades requeridas). */
export const stationMethods = pgTable(
  'station_methods',
  {
    id: id(),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    methodId: uuid('method_id')
      .notNull()
      .references(() => methods.id),
    unitsRequired: integer('units_required').notNull().default(1),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('station_methods_unique_idx').on(t.stationId, t.methodId)],
);

export const unitStatusEnum = pgEnum('unit_status', [
  'pendiente',
  'en_ejecucion',
  'fotos_ok', // fotos tomadas, formulario pendiente
  'completada',
  'no_realizada',
]);

/** Unidades de muestreo: EM-23-PC01 ... generadas automáticamente. */
export const samplingUnits = pgTable(
  'sampling_units',
  {
    id: id(),
    stationMethodId: uuid('station_method_id')
      .notNull()
      .references(() => stationMethods.id, { onDelete: 'cascade' }),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    methodId: uuid('method_id')
      .notNull()
      .references(() => methods.id),
    seq: integer('seq').notNull(), // 1..N
    code: text('code').notNull(), // EM-23-PC01
    status: unitStatusEnum('status').notNull().default('pendiente'),
    /** Para unidades abiertas creadas en campo (RO): id generado en el cliente. */
    clientId: uuid('client_id'),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sampling_units_code_idx').on(t.stationId, t.code),
    uniqueIndex('sampling_units_client_idx').on(t.clientId),
    index('sampling_units_station_idx').on(t.stationId),
  ],
);

export const scheduleStatusEnum = pgEnum('schedule_status', [
  'planificada',
  'en_curso',
  'ejecutada',
  'no_realizada',
  'reprogramada',
  'cancelada',
]);

/** Cronograma: brigada -> estación en una fecha. Varias estaciones por día permitidas. */
export const schedules = pgTable(
  'schedules',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    brigadeId: uuid('brigade_id')
      .notNull()
      .references(() => brigades.id, { onDelete: 'cascade' }),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    plannedDate: date('planned_date').notNull(),
    originalDate: date('original_date').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    status: scheduleStatusEnum('status').notNull().default('planificada'),
    notes: text('notes'),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('schedules_brigade_date_idx').on(t.brigadeId, t.plannedDate),
    index('schedules_station_idx').on(t.stationId),
  ],
);
