import { z } from 'zod';
import type { ExecutionStatus, FieldRecord } from './field.js';
import type { FormSchema, PhotoSlot } from './specialties.js';

/**
 * Consultas (Sprint 2.2): búsqueda de los registros de campo (ejecuciones de unidades de muestreo)
 * con sus formularios, fotos y notas de voz, para revisión desde la web.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RECORD_PAGE_SIZE = 50;

export const recordsQuerySchema = z.object({
  stationId: z.string().uuid().optional(),
  methodId: z.string().uuid().optional(),
  brigadeId: z.string().uuid().optional(),
  specialistId: z.string().uuid().optional(),
  specialtyId: z.string().uuid().optional(),
  status: z.enum(['en_curso', 'fotos_ok', 'completada', 'no_realizada']).optional(),
  /** Rango de fechas de ejecución (hora de Lima), ambos inclusive. */
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Texto libre: código de unidad, especialista, especie u otro valor del formulario, observaciones. */
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type RecordsQuery = z.infer<typeof recordsQuerySchema>;

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  en_curso: 'En curso',
  fotos_ok: 'Fotos tomadas',
  completada: 'Completada',
  no_realizada: 'No realizada',
};

export type RecordRow = {
  id: string;
  unitCode: string;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  stationId: string;
  stationCode: string;
  methodCode: string;
  methodName: string;
  specialtyCode: string;
  brigadeName: string | null;
  specialistName: string;
  /** Registros del formulario (p. ej. especies anotadas). */
  records: number;
  photos: number;
  audios: number;
  /** Archivos que siguen en el teléfono (no subidos). */
  pendingFiles: number;
  incidents: number;
  syncedAt: string;
};

export type RecordsPage = { total: number; page: number; pageSize: number; rows: RecordRow[] };

export type RecordFilterOptions = {
  stations: { id: string; code: string }[];
  methods: { id: string; code: string; name: string; specialtyCode: string }[];
  brigades: { id: string; name: string }[];
  specialists: { id: string; name: string }[];
  specialties: { id: string; code: string; name: string }[];
};

export type RecordAttachment = {
  id: string;
  kind: 'foto' | 'foto_metodo' | 'audio' | 'documento' | 'comprobante';
  slotKey: string | null;
  mimeType: string;
  takenAt: string;
  uploadStatus: 'pendiente' | 'subido' | 'error';
  hasOriginal: boolean;
  durationSec: number | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  caption: string | null;
};

export type RecordDetail = RecordRow & {
  observations: string | null;
  formCompletedAt: string | null;
  startLat: number | null;
  startLng: number | null;
  startAccuracy: number | null;
  deviceId: string | null;
  plannedDate: string | null;
  originalDate: string | null;
  station: { lat: number; lng: number; vegetationUnit: string | null; influenceArea: string | null; utmZone: number | null };
  /** Distancia (m) entre el punto de inicio y la estación. */
  distanceToStationM: number | null;
  specialistDni: string;
  formSchema: FormSchema;
  photoSlots: PhotoSlot[];
  formRecords: FieldRecord[];
  attachments: RecordAttachment[];
  incidentList: { id: string; type: string; status: string; description: string; occurredAt: string }[];
};
