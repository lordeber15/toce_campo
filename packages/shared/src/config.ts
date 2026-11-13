import { z } from 'zod';

const uuid = z.string().uuid();
const optText = z.string().trim().max(500).nullish();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');

export const projectSchema = z.object({
  code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/, 'Solo letras, números, - y _'),
  name: z.string().trim().min(3).max(160),
  client: optText,
  description: z.string().max(4000).nullish(),
  startDate: isoDate.nullish(),
  endDate: isoDate.nullish(),
  status: z.enum(['planificado', 'en_curso', 'cerrado']).optional(),
  utmZone: z.number().int().min(1).max(60).nullish(),
});

export const brigadeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  specialtyId: uuid.nullish(),
  leaderId: uuid.nullish(),
  logisticianId: uuid.nullish(),
  supervisorId: uuid.nullish(),
  memberIds: z.array(uuid).default([]),
  isActive: z.boolean().optional(),
});

export const stationSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9-]+$/, 'Solo letras, números y guiones'),
  name: optText,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  altitude: z.number().int().nullish(),
  vegetationUnit: optText,
  influenceArea: z.enum(['AID', 'AII', 'fuera']).nullish(),
  overlap: optText,
  accessNotes: z.string().max(2000).nullish(),
});

export const stationMethodsSchema = z.object({
  methods: z.array(z.object({ methodId: uuid, unitsRequired: z.number().int().min(0).max(500) })),
});

export const scheduleSchema = z.object({
  brigadeId: uuid,
  stationId: uuid,
  plannedDate: isoDate,
  sortOrder: z.number().int().min(0).optional(),
  notes: z.string().max(1000).nullish(),
});

export const speciesSchema = z.object({
  specialtyId: uuid,
  scientificName: z.string().trim().min(2).max(200),
  commonName: optText,
  family: optText,
  order: optText,
  conservationStatus: optText,
  isActive: z.boolean().optional(),
});

export const speciesImportSchema = z.object({
  specialtyId: uuid,
  rows: z.array(speciesSchema.omit({ specialtyId: true, isActive: true })).min(1).max(20000),
});

const formFieldSchema = z.object({
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/, 'Clave: minúsculas, números y _'),
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'number', 'select', 'date', 'coords', 'textarea', 'species']),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  auto: z.boolean().optional(),
});

export const methodUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().max(2000).nullish(),
  instructions: z.string().max(4000).nullish(),
  isOpenEnded: z.boolean().optional(),
  defaultUnitsRequired: z.number().int().min(0).max(500).optional(),
  scheduleStart: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullish(),
  scheduleEnd: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullish(),
  minDurationMin: z.number().int().min(0).max(1440).nullish(),
  requirements: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  photoSlots: z
    .array(z.object({ key: z.string().regex(/^[a-z0-9_]+$/), label: z.string().trim().min(1).max(40), required: z.boolean() }))
    .max(12)
    .optional(),
  methodPhotoRequired: z.boolean().optional(),
  methodPhotoInstructions: z.string().max(1000).nullish(),
  formSchema: z
    .object({ fields: z.array(formFieldSchema).max(40) })
    .refine((f) => new Set(f.fields.map((x) => x.key)).size === f.fields.length, 'Hay campos con la misma clave')
    .refine((f) => f.fields.every((x) => x.type !== 'select' || (x.options && x.options.length > 0)), 'Las listas necesitan al menos una opción')
    .optional(),
  isActive: z.boolean().optional(),
});

export const methodCreateSchema = methodUpdateSchema.extend({
  specialtyId: uuid,
  code: z.string().trim().min(1).max(10).regex(/^[A-Z0-9]+$/, 'Código en mayúsculas (p. ej. PC)'),
  name: z.string().trim().min(2).max(120),
});

export const LAYER_KINDS = ['huella', 'aid', 'aii', 'uv', 'superposicion', 'otro'] as const;
export const LAYER_KIND_LABELS: Record<(typeof LAYER_KINDS)[number], string> = {
  huella: 'Huella del proyecto',
  aid: 'AID (Área de Influencia Directa)',
  aii: 'AII (Área de Influencia Indirecta)',
  uv: 'UV (Unidad de Vegetación)',
  superposicion: 'Superposición (ANP, ACR, EF…)',
  otro: 'Otra capa',
};

export const layersImportSchema = z.object({
  sourceFile: z.string().trim().max(200).optional(),
  /** Reemplaza las capas importadas antes desde un archivo con el mismo nombre. */
  replaceSameSource: z.boolean().default(true),
  features: z
    .array(
      z.object({
        kind: z.enum(LAYER_KINDS),
        name: z.string().trim().min(1).max(200),
        code: z.string().trim().max(40).nullish(),
        color: z.string().max(20).nullish(),
        geometry: z.object({ type: z.string(), coordinates: z.unknown() }).passthrough(),
        properties: z.record(z.string(), z.unknown()).nullish(),
      }),
    )
    .min(1)
    .max(5000),
});

/** Código de unidad: EM-23 + PC + 01 -> EM-23-PC01 */
export function unitCode(stationCode: string, methodCode: string, seq: number): string {
  return `${stationCode}-${methodCode}${String(seq).padStart(2, '0')}`;
}
