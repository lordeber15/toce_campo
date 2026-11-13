import { pgTable, text, uuid, integer, timestamp, jsonb, index, uniqueIndex, pgEnum, numeric, date, boolean } from 'drizzle-orm/pg-core';
import { id, createdAt, updatedAt } from './_common.js';
import { users } from './core.js';
import { brigades, projects, stations } from './project.js';

export const vehicleStatusEnum = pgEnum('vehicle_status', ['programada', 'en_ruta', 'llegada', 'averiada', 'accidente', 'finalizada']);

/** Movilidades asignadas a brigadas. */
export const logisticsVehicles = pgTable(
  'logistics_vehicles',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    brigadeId: uuid('brigade_id').references(() => brigades.id),
    plate: text('plate'),
    description: text('description').notNull(),
    driverName: text('driver_name'),
    driverPhone: text('driver_phone'),
    status: vehicleStatusEnum('status').notNull().default('programada'),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    notes: text('notes'),
    missingMaterials: text('missing_materials').array().notNull().default([]),
    defectiveMaterials: text('defective_materials').array().notNull().default([]),
    registeredById: uuid('registered_by_id').notNull().references(() => users.id),
    clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('logistics_vehicles_client_idx').on(t.clientId), index('logistics_vehicles_brigade_idx').on(t.brigadeId)],
);

/** Apoyos locales por brigada. */
export const logisticsSupportStaff = pgTable(
  'logistics_support_staff',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    brigadeId: uuid('brigade_id').references(() => brigades.id),
    fullName: text('full_name').notNull(),
    dni: text('dni'),
    phone: text('phone'),
    community: text('community'),
    eppDelivered: boolean('epp_delivered').notNull().default(false),
    eppItems: text('epp_items').array().notNull().default([]),
    documentsDelivered: text('documents_delivered').array().notNull().default([]),
    availableFrom: date('available_from'),
    availableTo: date('available_to'),
    isAvailable: boolean('is_available').notNull().default(true),
    notes: text('notes'),
    registeredById: uuid('registered_by_id').notNull().references(() => users.id),
    clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('logistics_support_client_idx').on(t.clientId), index('logistics_support_brigade_idx').on(t.brigadeId)],
);

export const expenseCategoryEnum = pgEnum('expense_category', ['alimentacion', 'hospedaje', 'transporte', 'combustible', 'materiales', 'apoyo_local', 'otro']);

/** Viáticos y comprobantes. */
export const logisticsExpenses = pgTable(
  'logistics_expenses',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    brigadeId: uuid('brigade_id').references(() => brigades.id),
    category: expenseCategoryEnum('category').notNull(),
    description: text('description').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('PEN'),
    expenseDate: date('expense_date').notNull(),
    receiptNumber: text('receipt_number'),
    vendor: text('vendor'),
    hasReceipt: boolean('has_receipt').notNull().default(false),
    registeredById: uuid('registered_by_id').notNull().references(() => users.id),
    clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('logistics_expenses_client_idx').on(t.clientId), index('logistics_expenses_brigade_idx').on(t.brigadeId)],
);

export const sampleStatusEnum = pgEnum('sample_status', ['recolectada', 'almacenada', 'enviada', 'recibida', 'pendiente', 'perdida']);

/** Muestras y envíos. */
export const logisticsSamples = pgTable(
  'logistics_samples',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    brigadeId: uuid('brigade_id').references(() => brigades.id),
    stationId: uuid('station_id').references(() => stations.id),
    code: text('code').notNull(),
    description: text('description'),
    quantity: integer('quantity').notNull().default(1),
    status: sampleStatusEnum('status').notNull().default('recolectada'),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    carrier: text('carrier'),
    trackingCode: text('tracking_code'),
    destination: text('destination'),
    notes: text('notes'),
    registeredById: uuid('registered_by_id').notNull().references(() => users.id),
    clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('logistics_samples_client_idx').on(t.clientId), index('logistics_samples_brigade_idx').on(t.brigadeId)],
);

/** Equipos (inventario simple) e incidencias de equipos. */
export const logisticsEquipment = pgTable(
  'logistics_equipment',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    brigadeId: uuid('brigade_id').references(() => brigades.id),
    name: text('name').notNull(),
    serial: text('serial'),
    quantity: integer('quantity').notNull().default(1),
    status: text('status').notNull().default('operativo'), // operativo | defectuoso | perdido | en_reparacion
    notes: text('notes'),
    extra: jsonb('extra').$type<Record<string, unknown>>(),
    registeredById: uuid('registered_by_id').notNull().references(() => users.id),
    clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('logistics_equipment_client_idx').on(t.clientId)],
);
