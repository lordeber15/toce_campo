import { z } from 'zod';


/**
 * Carga masiva por plantilla Excel (solo web).
 * POST /api/import/template/validate  -> TemplateValidation (no escribe nada)
 * POST /api/import/template/commit    -> TemplateCommitResult (400 con TemplateValidation si hay errores)
 */

/** Hojas de la plantilla, tal como se llaman en el Excel. */
export const TEMPLATE_SHEETS = {
  project: '1. Proyecto',
  users: '2. Usuarios',
  lists: 'Listas',
  brigades: '3. Brigadas',
  members: '4. Integrantes',
  stations: '5. Estaciones',
  methods: '6. Métodos',
  stationMethods: '7. Estación–Método',
  schedule: '8. Cronograma',
} as const;

/** Cambio elegido por el usuario cuando la plantilla y las capas KMZ no coinciden. Queda bloqueado. */
export const templateOverrideSchema = z.object({
  stationCode: z.string().trim().min(1).max(40),
  field: z.enum(['influenceArea', 'vegetationUnit']),
  /** 'declared' = lo de la plantilla (queda bloqueado), 'computed' = lo de las capas (no se bloquea), o un valor propio (bloqueado). */
  choice: z.enum(['declared', 'computed', 'custom']),
  /** Solo con choice = 'custom'. Para influenceArea: Huella | AID | AII | fuera. */
  value: z.string().trim().max(300).nullish(),
});
export type TemplateOverride = z.infer<typeof templateOverrideSchema>;

export const templateFileSchema = z.object({
  /** Contenido del .xlsx en base64 (se acepta también un data URL). */
  fileBase64: z.string().min(10),
  fileName: z.string().max(255).optional(),
});

export const templateCommitSchema = templateFileSchema.extend({
  overrides: z.array(templateOverrideSchema).max(5000).default([]),
});

export type TemplateIssue = { sheet: string; row: number | null; column: string | null; message: string };

export type TemplateCount = { total: number; new: number; update: number };

export type TemplateSummary = {
  project: TemplateCount;
  specialties: TemplateCount;
  users: TemplateCount;
  brigades: TemplateCount;
  members: TemplateCount;
  stations: TemplateCount;
  methods: TemplateCount;
  stationMethods: TemplateCount;
  schedules: TemplateCount;
};

/** Diferencia entre lo declarado en la plantilla y lo que calculan las capas KMZ del proyecto. */
export type TemplateDifference = {
  stationCode: string;
  field: 'influenceArea' | 'vegetationUnit';
  declared: string | null;
  computed: string | null;
};

export type TemplateValidation = {
  ok: boolean;
  summary: TemplateSummary;
  errors: TemplateIssue[];
  warnings: TemplateIssue[];
  differences: TemplateDifference[];
  /** Proyecto existente con el mismo código (si ya existe). */
  projectId: string | null;
  projectCode: string | null;
};

export type TemplateCommitResult = {
  ok: true;
  projectId: string;
  summary: TemplateSummary;
  warnings: TemplateIssue[];
  /** Unidades de muestreo creadas en esta carga. */
  unitsCreated: number;
  /** Programaciones antiguas (sin trabajo de campo) quitadas porque ya no están en la plantilla. */
  schedulesRemoved: number;
};



/** Tipos de actividad del cronograma. Solo 'estacion' tiene estación. */
export const ACTIVITY_TYPES = ['estacion', 'movilizacion', 'desmovilizacion', 'descanso', 'otro'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  estacion: 'Estación',
  movilizacion: 'Movilización',
  desmovilizacion: 'Desmovilización',
  descanso: 'Descanso',
  otro: 'Otro',
};

/** Permisos de especialidad: qué otras especialidades ve (y puede asumir) quien tiene esta. */
export const specialtyAccessSchema = z.object({
  grantIds: z.array(z.string().uuid()).max(100),
});
