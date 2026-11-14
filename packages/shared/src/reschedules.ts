import { z } from 'zod';

/** Reprogramaciones (5.5): propuesta → aprobada | rechazada. */
export const RESCHEDULE_STATUSES = ['propuesta', 'aprobada', 'rechazada'] as const;
export type RescheduleStatus = (typeof RESCHEDULE_STATUSES)[number];
export const RESCHEDULE_STATUS_LABELS: Record<RescheduleStatus, string> = {
  propuesta: 'Por aprobar',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
};

/** Quién aprueba o rechaza (el supervisor solo propone). */
export const RESCHEDULE_APPROVER_ROLES = ['coordinador', 'jefe_proyecto'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');

export const rescheduleCreateSchema = z.object({
  scheduleId: z.string().uuid(),
  newDate: isoDate,
  /** Motivo (lluvia, acceso, etc.). */
  reason: z.string().trim().min(3, 'Indica el motivo').max(2000),
  /** Sustento de la modificación. */
  justification: z.string().trim().max(4000).nullish(),
  incidentId: z.string().uuid().nullish(),
  /** Al aprobar, las unidades "no realizadas" de la estación vuelven a pendiente. */
  reopenUnits: z.boolean().default(true),
  /** Coordinación puede registrar y aprobar en un solo paso. */
  approve: z.boolean().default(false),
});
export type RescheduleCreate = z.infer<typeof rescheduleCreateSchema>;

export const rescheduleApproveSchema = z.object({
  /** Permite ajustar la fecha propuesta al aprobar. */
  newDate: isoDate.optional(),
  reopenUnits: z.boolean().optional(),
  note: z.string().trim().max(4000).nullish(),
});

export const rescheduleRejectSchema = z.object({
  note: z.string().trim().min(3, 'Indica por qué se rechaza').max(4000),
});

export type RescheduleFile = { id: string; kind: string; name: string | null; mimeType: string; sizeBytes: number | null };

export type RescheduleRow = {
  id: string;
  status: RescheduleStatus;
  scheduleId: string;
  brigadeId: string;
  brigadeName: string;
  stationId: string;
  stationCode: string;
  /** Fecha del cronograma original (antes de cualquier reprogramación). */
  originalDate: string;
  /** Fecha que tenía la visita cuando se pidió el cambio. */
  fromDate: string;
  /** Fecha reprogramada. */
  toDate: string;
  reason: string;
  incidentId: string | null;
  incidentType: string | null;
  proposedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
  files: number;
};

export type RescheduleHistoryItem = {
  at: string;
  action: string;
  userName: string | null;
  detail: string | null;
};

export type RescheduleDetail = RescheduleRow & {
  justification: string | null;
  decisionNotes: string | null;
  reopenUnits: boolean;
  scheduleStatus: string;
  /** Fecha vigente de la visita en el cronograma. */
  currentDate: string;
  incidentDescription: string | null;
  incidentStatus: string | null;
  fileList: RescheduleFile[];
  /** Otras reprogramaciones de la misma visita (más antigua primero). */
  visitHistory: Pick<RescheduleRow, 'id' | 'status' | 'fromDate' | 'toDate' | 'reason' | 'decidedByName' | 'decidedAt' | 'createdAt'>[];
  /** Registro de cambios de esta reprogramación. */
  log: RescheduleHistoryItem[];
};

export type RescheduleOptionVisit = {
  id: string;
  plannedDate: string;
  originalDate: string;
  status: string;
  brigadeId: string;
  brigadeName: string;
  stationId: string;
  stationCode: string;
  /** Ya tiene una propuesta esperando aprobación. */
  pending: boolean;
};

export type RescheduleOptionIncident = {
  id: string;
  type: string;
  description: string;
  status: string;
  brigadeId: string | null;
  stationId: string | null;
  stationCode: string | null;
  reportedByName: string;
  occurredAt: string;
  /** La alerta pide reprogramar y aún no tiene reprogramación. */
  needsReschedule: boolean;
};

export type RescheduleOptions = {
  brigades: { id: string; name: string }[];
  visits: RescheduleOptionVisit[];
  incidents: RescheduleOptionIncident[];
};
