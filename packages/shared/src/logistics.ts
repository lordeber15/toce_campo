import { z } from 'zod';

/**
 * Logística de campo (Sprint 1.6): movilidad, apoyos locales, viáticos, muestras y equipos.
 * El responsable logístico registra todo en el teléfono sin conexión; cada registro lleva un
 * clientId generado en el teléfono y se envía/actualiza por "último cambio gana".
 */

export const LOGISTICS_ENTITIES = ['vehicle', 'support', 'expense', 'sample', 'equipment'] as const;
export type LogisticsEntity = (typeof LOGISTICS_ENTITIES)[number];
export const LOGISTICS_ENTITY_LABELS: Record<LogisticsEntity, { one: string; many: string }> = {
  vehicle: { one: 'Movilidad', many: 'Movilidad' },
  support: { one: 'Apoyo local', many: 'Apoyos locales' },
  expense: { one: 'Gasto', many: 'Viáticos y comprobantes' },
  sample: { one: 'Muestra', many: 'Muestras y envíos' },
  equipment: { one: 'Equipo', many: 'Equipos' },
};

export const VEHICLE_STATUSES = ['programada', 'en_ruta', 'llegada', 'averiada', 'accidente', 'finalizada'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  programada: 'Programada',
  en_ruta: 'En ruta',
  llegada: 'Llegó',
  averiada: 'Averiada',
  accidente: 'Accidente',
  finalizada: 'Finalizada',
};

export const EXPENSE_CATEGORIES = ['alimentacion', 'hospedaje', 'transporte', 'combustible', 'materiales', 'apoyo_local', 'otro'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  alimentacion: 'Alimentación',
  hospedaje: 'Hospedaje',
  transporte: 'Transporte',
  combustible: 'Combustible',
  materiales: 'Materiales',
  apoyo_local: 'Pago a apoyo local',
  otro: 'Otro',
};

export const SAMPLE_STATUSES = ['recolectada', 'almacenada', 'pendiente', 'enviada', 'recibida', 'perdida'] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];
export const SAMPLE_STATUS_LABELS: Record<SampleStatus, string> = {
  recolectada: 'Recolectada',
  almacenada: 'Almacenada',
  pendiente: 'Pendiente de envío',
  enviada: 'Enviada',
  recibida: 'Recibida',
  perdida: 'Perdida',
};
/** Muestras que aún no salen de campo. */
export const SAMPLE_PENDING: SampleStatus[] = ['recolectada', 'almacenada', 'pendiente'];

export const EQUIPMENT_STATUSES = ['operativo', 'defectuoso', 'en_reparacion', 'perdido'] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  operativo: 'Operativo',
  defectuoso: 'Defectuoso',
  en_reparacion: 'En reparación',
  perdido: 'Perdido',
};

/** Sugerencias para marcar con un toque (también se puede escribir otro). */
export const EPP_ITEMS = ['Casco', 'Botas', 'Chaleco', 'Guantes', 'Poncho', 'Lentes', 'Repelente', 'Linterna'];
export const SUPPORT_DOCUMENTS = ['Copia de DNI', 'Contrato', 'SCTR', 'Declaración jurada', 'Constancia de pago'];
export const VEHICLE_MATERIALS = ['Llanta de repuesto', 'Gata', 'Botiquín', 'Extintor', 'Cadenas', 'Herramientas', 'Combustible extra', 'Soga'];

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');
const text = (max: number) => z.string().trim().max(max).nullish();
const tags = z.array(z.string().trim().min(1).max(80)).max(40).default([]);

/** Campos comunes a todos los registros logísticos. */
const base = {
  clientId: uuid,
  brigadeId: uuid,
  clientUpdatedAt: isoDateTime,
};

export const vehicleSchema = z.object({
  ...base,
  description: z.string().trim().min(2, 'Describe la movilidad').max(200),
  plate: text(20),
  driverName: text(120),
  driverPhone: text(30),
  status: z.enum(VEHICLE_STATUSES),
  arrivedAt: isoDateTime.nullish(),
  missingMaterials: tags,
  defectiveMaterials: tags,
  notes: text(2000),
});

export const supportSchema = z.object({
  ...base,
  fullName: z.string().trim().min(3, 'Escribe el nombre').max(160),
  dni: z.string().trim().regex(/^\d{8}$/, 'El DNI tiene 8 dígitos').nullish().or(z.literal('')),
  phone: text(30),
  community: text(160),
  eppItems: tags,
  documentsDelivered: tags,
  availableFrom: isoDate.nullish(),
  availableTo: isoDate.nullish(),
  isAvailable: z.boolean().default(true),
  notes: text(2000),
});

export const expenseSchema = z.object({
  ...base,
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().min(2, 'Describe el gasto').max(300),
  amount: z.number().positive('El monto debe ser mayor que cero').max(1_000_000),
  currency: z.string().length(3).default('PEN'),
  expenseDate: isoDate,
  receiptNumber: text(60),
  vendor: text(160),
});

export const sampleSchema = z.object({
  ...base,
  code: z.string().trim().min(1, 'Escribe el código de la muestra').max(60),
  description: text(500),
  quantity: z.number().int().min(1).max(100000).default(1),
  stationId: uuid.nullish(),
  status: z.enum(SAMPLE_STATUSES),
  shippedAt: isoDateTime.nullish(),
  carrier: text(120),
  trackingCode: text(80),
  destination: text(200),
  notes: text(2000),
});

export const equipmentSchema = z.object({
  ...base,
  name: z.string().trim().min(2, 'Escribe el nombre del equipo').max(160),
  serial: text(80),
  quantity: z.number().int().min(1).max(100000).default(1),
  status: z.enum(EQUIPMENT_STATUSES),
  notes: text(2000),
});

export const LOGISTICS_SCHEMAS = {
  vehicle: vehicleSchema,
  support: supportSchema,
  expense: expenseSchema,
  sample: sampleSchema,
  equipment: equipmentSchema,
} as const;

export type VehicleData = z.infer<typeof vehicleSchema>;
export type SupportData = z.infer<typeof supportSchema>;
export type ExpenseData = z.infer<typeof expenseSchema>;
export type SampleData = z.infer<typeof sampleSchema>;
export type EquipmentData = z.infer<typeof equipmentSchema>;
export type LogisticsData = {
  vehicle: VehicleData;
  support: SupportData;
  expense: ExpenseData;
  sample: SampleData;
  equipment: EquipmentData;
};

/** Registro tal como lo devuelve el servidor (para restaurar en otro teléfono o tras reinstalar). */
export type LogisticsRecordDto<E extends LogisticsEntity = LogisticsEntity> = {
  entity: E;
  id: string;
  data: LogisticsData[E];
  registeredByName: string;
  files: number;
};

export type LogisticsSyncResult = { id: string; clientId: string; applied: boolean };
