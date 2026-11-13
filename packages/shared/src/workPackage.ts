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
  /** [oeste, sur, este, norte] de estaciones y capas; zona del mapa offline. */
  bounds: [number, number, number, number] | null;
};

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
};

export type WpBrigade = {
  id: string;
  projectId: string;
  name: string;
  specialtyCode: string | null;
  specialtyName: string | null;
  myRoles: BrigadeRole[];
  leaderId: string | null;
  leaderName: string | null;
  members: { id: string; fullName: string; phone: string | null; specialtyCode: string | null }[];
};

export type WpSchedule = {
  id: string;
  brigadeId: string;
  stationId: string;
  plannedDate: string; // AAAA-MM-DD
  sortOrder: number;
  status: string;
  notes: string | null;
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
};

export type WpStationMethod = { id: string; stationId: string; methodId: string; unitsRequired: number; notes: string | null };

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
