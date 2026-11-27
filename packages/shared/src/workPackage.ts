import type { FormSchema, PhotoSlot } from './specialties.js';

/**
 * Paquete de trabajo: todo lo que el teléfono necesita para trabajar sin conexión.
 * Lo genera GET /api/work-package y se guarda completo en el teléfono.
 */

/** Días hacia atrás y hacia adelante (desde hoy, hora de Lima) que incluye el paquete. */
export const WORK_PACKAGE_DAYS_BACK = 7;
export const WORK_PACKAGE_DAYS_AHEAD = 30;

/** Rol de la persona dentro de una brigada. */
export type BrigadeRole = 'jefe' | 'miembro' | 'supervisor' | 'logistico';

export type WpProject = {
  id: string;
  code: string;
  name: string;
  utmZone: number | null;
  /**
   * [oeste, sur, este, norte] de la zona de trabajo del usuario en el proyecto: la unión de los `bounds`
   * de sus brigadas (ya no todo el proyecto). Sirve para encuadrar el mapa. Paquetes antiguos traen el
   * extent del proyecto completo; las apps viejas descargan el mapa offline con esta caja.
   */
  bounds: [number, number, number, number] | null;
};

/** Caja [oeste, sur, este, norte] en grados WGS84. */
export type WpBounds = [number, number, number, number];

/** Margen (grados, ~4 km) que se agrega alrededor de la zona de una brigada para el mapa offline y el recorte de capas. */
export const WORK_AREA_MARGIN_DEG = 0.04;

/** Geometría GeoJSON (WGS84). */
export type WpGeometry =
  | { type: 'Point' | 'MultiPoint' | 'LineString' | 'MultiLineString' | 'Polygon' | 'MultiPolygon'; coordinates: unknown }
  | { type: 'GeometryCollection'; geometries: WpGeometry[] };

export type LayerKind = 'huella' | 'aid' | 'aii' | 'uv' | 'superposicion' | 'otro';

/** Capa del proyecto (KMZ), simplificada para el teléfono. */
export type WpLayer = {
  id: string;
  projectId: string;
  kind: LayerKind;
  name: string;
  code: string | null;
  color: string | null;
  geometry: WpGeometry;
  /**
   * Brigada dueña de la capa (KMZ de la brigada). null/undefined = capa general del proyecto, ya recortada
   * a la zona de las brigadas del usuario. Paquetes antiguos no lo traen.
   */
  brigadeId?: string | null;
};

export type WpBrigade = {
  id: string;
  projectId: string;
  /** Código corto (SIERRA 1); paquetes antiguos no lo traen. */
  code?: string | null;
  name: string;
  specialtyCode: string | null;
  specialtyName: string | null;
  myRoles: BrigadeRole[];
  leaderId: string | null;
  leaderName: string | null;
  members: { id: string; fullName: string; phone: string | null; specialtyCode: string | null }[];
  /** Polígono de trabajo asignado a la brigada (KMZ), simplificado. null si no se cargó. */
  areaName: string | null;
  area: WpGeometry | null;
  /**
   * Zona de trabajo de la brigada (sin margen): extent de sus capas KMZ o, si no tiene, de sus estaciones
   * (programadas o con métodos asignados a la brigada). El teléfono descarga un mapa offline por brigada con
   * esta caja + WORK_AREA_MARGIN_DEG. null = sin zona. Paquetes antiguos no lo traen (undefined).
   */
  bounds?: WpBounds | null;
  /** De dónde salió `bounds`: 'kmz' (capas de la brigada) o 'estaciones'. */
  boundsSource?: 'kmz' | 'estaciones' | null;
};

export type WpSchedule = {
  id: string;
  brigadeId: string;
  stationId: string;
  plannedDate: string; // AAAA-MM-DD
  sortOrder: number;
  status: string;
  notes: string | null;
  /** Fecha del cronograma original (paquetes antiguos no lo traen). */
  originalDate?: string;
  /** Último cambio de fecha aprobado. */
  lastReschedule?: { fromDate: string; reason: string } | null;
};

export type WpStation = {
  id: string;
  projectId: string;
  code: string;
  name: string | null;
  lat: number;
  lng: number;
  altitude: number | null;
  influenceArea: string | null;
  vegetationUnit: string | null;
  overlap: string | null;
  accessNotes: string | null;
  status: string;
};

export type WpMethod = {
  id: string;
  specialtyCode: string;
  code: string;
  name: string;
  description: string | null;
  instructions: string | null;
  isOpenEnded: boolean;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  minDurationMin: number | null;
  requirements: string[];
  photoSlots: PhotoSlot[];
  methodPhotoRequired: boolean;
  methodPhotoInstructions: string | null;
  formSchema: FormSchema;
  /** Datos de la plantilla de carga masiva (paquetes antiguos no los traen). */
  methodClass?: 'todas' | 'condicional' | 'evento' | 'atributo' | 'transversal' | null;
  requiresTrack?: boolean;
  photosPerUnit?: number | null;
  scheduleText?: string | null;
  /** Directriz compacta (condición de aplicación). */
  guideline?: string | null;
  specialtyName?: string;
};

export type WpStationMethod = {
  id: string;
  stationId: string;
  methodId: string;
  unitsRequired: number;
  notes: string | null;
  /** Brigada que ejecuta el método en la estación (null = cualquiera). Paquetes antiguos no lo traen. */
  brigadeId?: string | null;
};

export type WpUnit = { id: string; stationMethodId: string; stationId: string; methodId: string; seq: number; code: string; status: string };

export type WpSpecies = {
  id: string;
  specialtyCode: string;
  scientificName: string;
  commonName: string | null;
  family: string | null;
  order: string | null;
  conservationStatus: string | null;
};

export type WorkPackage = {
  formHosts?: { id:string; executionId:string; stationId:string; code:string; header:Record<string,unknown>; lat:number|null; lng:number|null }[];
  stationForms?: { clientId:string; stationMethodId:string; fieldDate:string; values:Record<string,unknown>; updatedAt:string }[];
  version: string;
  generatedAt: string;
  today: string; // AAAA-MM-DD en America/Lima
  from: string;
  to: string;
  projects: WpProject[];
  brigades: WpBrigade[];
  schedules: WpSchedule[];
  stations: WpStation[];
  methods: WpMethod[];
  stationMethods: WpStationMethod[];
  units: WpUnit[];
  species: WpSpecies[];
  layers: WpLayer[];
};

/** Respuesta cuando el teléfono ya tiene la misma versión. */
export type WorkPackageUnchanged = { unchanged: true; version: string; generatedAt: string };
