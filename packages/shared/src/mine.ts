import { z } from 'zod';
import type { ExecutionStatus } from './field.js';

/**
 * "Mis registros" (web): cada persona ve lo que cargó desde su teléfono, ordenado como en la app
 * (jornada → estación → método → unidad). El jefe de brigada puede ver además toda su brigada.
 */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const myQuerySchema = z.object({
  projectId: uuid,
  /** Brigada completa (solo su jefe o coordinación); sin ella, lo propio. */
  brigadeId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type MyQuery = z.infer<typeof myQuerySchema>;

export type MyOverview = {
  projects: { id: string; code: string; name: string }[];
  /** Brigadas activas donde la persona es jefe de brigada. */
  ledBrigades: { id: string; name: string; projectId: string; projectCode: string }[];
};

export type JournalUnit = {
  id: string;
  unitCode: string;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  specialistName: string;
  records: number;
  photos: number;
  audios: number;
  pendingFiles: number;
  incidents: number;
};
export type JournalMethod = { methodId: string; code: string; name: string; units: JournalUnit[] };
export type JournalStation = { stationId: string; code: string; name: string | null; methods: JournalMethod[] };
export type JournalDay = { date: string; stations: JournalStation[] };

export type MyJournal = {
  days: JournalDay[];
  totals: { units: number; completed: number; notDone: number; records: number; photos: number; audios: number; pendingFiles: number };
};

export type MyFile = { id: string; kind: string; uploaded: boolean };

export type MyIncident = {
  id: string;
  type: string;
  status: string;
  description: string;
  proposedAction: string | null;
  occurredAt: string;
  reportedByName: string;
  stationCode: string | null;
  unitCode: string | null;
  methodCode: string | null;
  coordinationResponse: string | null;
  correctiveAction: string | null;
  resolvedByName: string | null;
  files: MyFile[];
  reschedules: { fromDate: string; toDate: string; reason: string; status: string }[];
};

export type MyLogisticsRow = {
  entity: string;
  id: string;
  data: Record<string, unknown>;
  brigadeName: string | null;
  registeredByName: string;
  updatedAt: string;
  files: MyFile[];
};
