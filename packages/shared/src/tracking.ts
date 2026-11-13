/** Seguimiento del avance de brigadas (Fase 2). Lo calcula el servidor con lo sincronizado. */

export type TrackingMetrics = {
  /** Estaciones (brigada × estación) programadas en total, hasta hoy, ejecutadas, en curso y atrasadas. */
  stationsPlanned: number;
  stationsDue: number;
  stationsExecuted: number;
  stationsInProgress: number;
  stationsLate: number;
  /** Unidades de muestreo requeridas (total y hasta hoy), completadas y no realizadas. */
  unitsRequired: number;
  unitsDue: number;
  unitsDone: number;
  unitsNotDone: number;
  unitsDoneDue: number;
  /** Unidades ejecutadas, las hechas fuera de su fecha programada y las hechas en una fecha reprogramada con aprobación. */
  executedUnits: number;
  offDateUnits: number;
  rescheduledUnits: number;
  /** Porcentajes (null si no hay base). */
  progressPct: number | null;
  compliancePct: number | null;
  deviationPct: number | null;
  activeAlerts: number;
  pendingReschedules: number;
};

export type StationStatus = 'pendiente' | 'en_curso' | 'ejecutada' | 'cerrada_incompleta' | 'atrasada' | 'sin_unidades';
export const STATION_STATUS_LABELS: Record<StationStatus, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  ejecutada: 'Ejecutada',
  cerrada_incompleta: 'Cerrada con unidades no realizadas',
  atrasada: 'Atrasada',
  sin_unidades: 'Sin unidades',
};

export type StationTracking = {
  stationId: string;
  code: string;
  name: string | null;
  influenceArea: string | null;
  firstDate: string;
  lastDate: string;
  originalDate: string;
  rescheduled: boolean;
  scheduleIds: string[];
  required: number;
  done: number;
  notDone: number;
  inProgress: number;
  executedUnits: number;
  offDateUnits: number;
  rescheduledUnits: number;
  /** Registros de métodos abiertos (no cuentan para el avance). */
  openRecords: number;
  late: boolean;
  status: StationStatus;
  alerts: number;
  methods: { methodId: string; code: string; openEnded: boolean; required: number; done: number; notDone: number; inProgress: number }[];
};

export type MemberTracking = {
  id: string;
  fullName: string;
  specialtyCode: string | null;
  role: 'jefe' | 'miembro' | 'supervisor' | 'logistico';
  phone: string | null;
  /** Último envío o descarga desde su teléfono. */
  lastSyncAt: string | null;
  lastDownloadAt: string | null;
  appVersion: string | null;
  unitsDone: number;
};

export type BrigadeFlag = 'al_dia' | 'en_riesgo' | 'atrasada' | 'sin_programacion';
export const BRIGADE_FLAG_LABELS: Record<BrigadeFlag, string> = {
  al_dia: 'Al día',
  en_riesgo: 'En riesgo',
  atrasada: 'Con atraso',
  sin_programacion: 'Sin programación',
};

export type BrigadeTracking = {
  id: string;
  name: string;
  specialtyName: string | null;
  specialtyCode: string | null;
  leaderName: string | null;
  supervisorName: string | null;
  logisticianName: string | null;
  isActive: boolean;
  metrics: TrackingMetrics;
  stations: StationTracking[];
  members: MemberTracking[];
  /** Última sincronización de un integrante de campo. */
  lastSyncAt: string | null;
  flag: BrigadeFlag;
};

export type ProjectTracking = {
  today: string;
  metrics: TrackingMetrics & { brigades: number };
  brigades: BrigadeTracking[];
  /** Unidades acumuladas por día: programadas (cronograma original) y completadas (null en días futuros). */
  curve: { date: string; planned: number; done: number | null }[];
};
