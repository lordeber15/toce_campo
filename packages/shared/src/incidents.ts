import { z } from 'zod';

/** Alertas / incidencias de campo (Sprint 1.5). El teléfono genera el clientId para trabajar offline. */

export const INCIDENT_TYPES = [
  'metodologica', 'climatica', 'lluvia_intensa', 'tecnica', 'imposibilidad', 'logistica', 'seguridad', 'otra',
  // Logísticas (Sprint 1.6)
  'accidente_movilidad', 'desperfecto_mecanico', 'hospedaje', 'equipos',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  metodologica: 'Metodológica',
  climatica: 'Condiciones climáticas',
  lluvia_intensa: 'Lluvia intensa',
  tecnica: 'Problema técnico',
  imposibilidad: 'Imposibilidad de completar',
  logistica: 'Logística',
  seguridad: 'Seguridad',
  otra: 'Otra situación',
  accidente_movilidad: 'Accidente de movilidad',
  desperfecto_mecanico: 'Desperfecto mecánico',
  hospedaje: 'Problema de hospedaje',
  equipos: 'Problema con equipos',
};

/** Tipos que ofrece cada formulario del teléfono. */
export const SPECIALIST_INCIDENT_TYPES: IncidentType[] = ['metodologica', 'climatica', 'lluvia_intensa', 'tecnica', 'imposibilidad', 'logistica', 'seguridad', 'otra'];
export const SUPERVISOR_INCIDENT_TYPES: IncidentType[] = ['metodologica', 'tecnica', 'seguridad', 'climatica', 'logistica', 'otra'];
export const LOGISTICS_INCIDENT_TYPES: IncidentType[] = ['accidente_movilidad', 'desperfecto_mecanico', 'hospedaje', 'equipos', 'logistica', 'seguridad', 'otra'];
export const isLogisticsIncident = (t: IncidentType) => (['accidente_movilidad', 'desperfecto_mecanico', 'hospedaje', 'equipos', 'logistica'] as IncidentType[]).includes(t);

export const INCIDENT_ORIGINS = ['mi_jornada', 'estacion', 'unidad', 'supervision', 'logistica'] as const;
export type IncidentOrigin = (typeof INCIDENT_ORIGINS)[number];
export const INCIDENT_ORIGIN_LABELS: Record<IncidentOrigin, string> = {
  mi_jornada: 'Especialista · Mi jornada',
  estacion: 'Especialista · estación',
  unidad: 'Especialista · unidad',
  supervision: 'Supervisión de campo',
  logistica: 'Logística',
};

export const INCIDENT_MOMENTS = ['antes', 'durante', 'posterior'] as const;
export type IncidentMoment = (typeof INCIDENT_MOMENTS)[number];
export const INCIDENT_MOMENT_LABELS: Record<IncidentMoment, string> = {
  antes: 'Antes de ejecutar',
  durante: 'Durante la ejecución',
  posterior: 'Posterior',
};

export const INCIDENT_STATUSES = ['abierta', 'en_revision', 'resuelta', 'rechazada', 'cerrada'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  abierta: 'Abierta',
  en_revision: 'En revisión',
  resuelta: 'Resuelta',
  rechazada: 'Rechazada',
  cerrada: 'Cerrada',
};

export const INCIDENT_DECISIONS = ['aprobada', 'rechazada', 'info_adicional'] as const;
export type IncidentDecision = (typeof INCIDENT_DECISIONS)[number];
export const INCIDENT_DECISION_LABELS: Record<IncidentDecision, string> = {
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  info_adicional: 'Se pide más información',
};

export const INCIDENT_MESSAGE_KINDS = ['comentario', 'solicitud_info', 'respuesta', 'decision'] as const;
export type IncidentMessageKind = (typeof INCIDENT_MESSAGE_KINDS)[number];

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });

/** Alerta enviada desde el teléfono (crear o actualizar; idempotente por clientId). */
export const incidentSyncSchema = z.object({
  clientId: uuid,
  projectId: uuid.nullish(),
  brigadeId: uuid.nullish(),
  stationId: uuid.nullish(),
  methodId: uuid.nullish(),
  samplingUnitId: uuid.nullish(),
  scheduleId: uuid.nullish(),
  type: z.enum(INCIDENT_TYPES),
  moment: z.enum(INCIDENT_MOMENTS).nullish(),
  launchedFrom: z.enum(INCIDENT_ORIGINS).nullish(),
  description: z.string().trim().min(3, 'Describe la situación').max(4000),
  proposedAction: z.string().trim().max(2000).nullish(),
  /** La unidad no se pudo realizar (se marca como "no realizada"). */
  unitNotDone: z.boolean().optional(),
  /** Supervisor: desviación metodológica observada, acción correctiva aplicada y cómo se resolvió. */
  methodologicalDeviation: z.string().trim().max(4000).nullish(),
  correctiveAction: z.string().trim().max(4000).nullish(),
  resolutionNotes: z.string().trim().max(4000).nullish(),
  occurredAt: isoDateTime,
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  clientUpdatedAt: isoDateTime,
});
export type IncidentSync = z.infer<typeof incidentSyncSchema>;

export const incidentMessageSchema = z.object({
  clientId: uuid,
  body: z.string().trim().min(1).max(4000),
  sentAt: isoDateTime,
});

/** Respuesta de coordinación (web). */
export const incidentDecisionSchema = z.object({
  decision: z.enum(INCIDENT_DECISIONS),
  response: z.string().trim().min(3, 'Escribe la respuesta').max(4000),
  correctiveAction: z.string().trim().max(2000).nullish(),
});

/** Reprogramación de una visita a partir de una alerta (web). */
export const rescheduleSchema = z.object({
  scheduleId: uuid,
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  reason: z.string().trim().min(3, 'Indica el sustento').max(2000),
  /** Vuelve a dejar pendientes las unidades "no realizadas" de esa estación para la nueva fecha. */
  reopenUnits: z.boolean().default(true),
});

export type IncidentMessageDto = {
  id: string;
  clientId: string;
  authorId: string;
  authorName: string;
  body: string;
  kind: IncidentMessageKind;
  sentAt: string;
};

/** Estado de una alerta propia que el teléfono descarga para ver la respuesta de coordinación. */
export type MyIncidentDto = {
  id: string;
  clientId: string;
  status: IncidentStatus;
  coordinationDecision: IncidentDecision | null;
  coordinationResponse: string | null;
  correctiveAction: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  updatedAt: string;
  messages: IncidentMessageDto[];
  reschedules: { fromDate: string; toDate: string; reason: string; approvedByName: string | null }[];
};

/** Alerta de una brigada que supervisa el usuario (registrada por otra persona). Se guarda en el teléfono. */
export type BrigadeIncidentDto = MyIncidentDto & {
  type: IncidentType;
  moment: IncidentMoment | null;
  launchedFrom: IncidentOrigin | null;
  description: string;
  proposedAction: string | null;
  methodologicalDeviation: string | null;
  resolutionNotes: string | null;
  occurredAt: string;
  reportedById: string;
  reportedByName: string;
  brigadeId: string | null;
  stationId: string | null;
  stationCode: string | null;
  unitCode: string | null;
  methodCode: string | null;
  files: number;
};
