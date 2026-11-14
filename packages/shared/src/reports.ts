import type { ExecutionStatus } from './field.js';
import type { IncidentStatus, IncidentType } from './incidents.js';
import type { BrigadeFlag, StationStatus, TrackingMetrics } from './tracking.js';

/**
 * Reportes (Sprint 2.3). El reporte diario resume un día (hora de Lima); el consolidado y la
 * exportación de registros se descargan en Excel, y las evidencias en un ZIP ordenado por carpetas.
 */

export type DailyBrigade = {
  id: string;
  name: string;
  specialtyCode: string | null;
  flag: BrigadeFlag;
  progressPct: number | null;
  compliancePct: number | null;
  /** Unidades ejecutadas ese día (completadas o no realizadas). */
  unitsToday: number;
  stationsToday: number;
  lastSyncAt: string | null;
};

export type DailyStation = {
  brigadeName: string;
  stationCode: string;
  /** Fecha original si la visita fue reprogramada a este día. */
  originalDate: string | null;
  status: StationStatus;
  required: number;
  done: number;
  notDone: number;
  doneToday: number;
};

export type DailyUnit = {
  id: string;
  unitCode: string;
  stationCode: string;
  methodCode: string;
  brigadeName: string | null;
  specialistName: string;
  status: ExecutionStatus;
  startedAt: string;
  records: number;
  photos: number;
};

export type DailyIncident = {
  id: string;
  type: IncidentType;
  status: IncidentStatus;
  brigadeName: string | null;
  stationCode: string | null;
  reportedBy: string;
  occurredAt: string;
  description: string;
};

export type DailyReschedule = {
  stationCode: string;
  brigadeName: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: 'propuesta' | 'aprobada' | 'rechazada';
  approvedByName: string | null;
};

export type DailyPending = {
  brigadeName: string;
  stationCode: string;
  firstDate: string;
  pendingUnits: number;
  late: boolean;
};

export type DailyReport = {
  date: string;
  projectCode: string;
  projectName: string;
  metrics: TrackingMetrics & { brigades: number };
  /** Totales del día. */
  day: { stationsPlanned: number; stationsExecuted: number; units: number; unitsCompleted: number; records: number; photos: number; incidents: number };
  brigades: DailyBrigade[];
  stations: DailyStation[];
  units: DailyUnit[];
  incidents: DailyIncident[];
  reschedules: DailyReschedule[];
  pending: DailyPending[];
};

/** Máximo de archivos por descarga de evidencias (si hay más, se pide filtrar). */
export const EVIDENCE_MAX_FILES = 3000;
