import { z } from 'zod';

/** Repositorio de documentos y evidencias (6): todos los archivos del proyecto en un solo lugar. */

export const FILE_ORIGINS = ['execution', 'incident', 'inquiry_message', 'logistics', 'reschedule', 'document', 'station', 'alert_message'] as const;
export type FileOrigin = (typeof FILE_ORIGINS)[number];
export const FILE_ORIGIN_LABELS: Record<FileOrigin, string> = {
  execution: 'Registro de campo',
  incident: 'Alerta',
  alert_message: 'Alerta',
  inquiry_message: 'Consulta',
  logistics: 'Logística',
  reschedule: 'Reprogramación',
  document: 'Documento del proyecto',
  station: 'Estación',
};
/** Orígenes que se muestran como filtro (alert_message y station se agrupan). */
export const FILE_ORIGIN_FILTERS = ['execution', 'incident', 'inquiry_message', 'logistics', 'reschedule', 'document'] as const;

/** Tipo de archivo tal como se agrupa en el repositorio. */
export const FILE_TYPES = ['foto', 'audio', 'documento', 'comprobante'] as const;
export type FileType = (typeof FILE_TYPES)[number];
export const FILE_TYPE_LABELS: Record<FileType, string> = { foto: 'Fotos', audio: 'Audios', documento: 'Documentos', comprobante: 'Comprobantes' };

export const DOCUMENT_CATEGORIES = ['acta', 'informe', 'permiso', 'plano', 'formato', 'otro'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  acta: 'Acta',
  informe: 'Informe',
  permiso: 'Permiso o autorización',
  plano: 'Plano o mapa',
  formato: 'Formato de campo',
  otro: 'Otro',
};

export const FILES_PAGE_SIZE = 60;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const filesQuerySchema = z.object({
  origin: z.enum(FILE_ORIGIN_FILTERS).optional(),
  type: z.enum(FILE_TYPES).optional(),
  brigadeId: uuid.optional(),
  personId: uuid.optional(),
  stationId: uuid.optional(),
  methodId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Busca en código de unidad, nombre del archivo, estación, persona y método. */
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type FilesQuery = z.infer<typeof filesQuerySchema>;

export const documentUploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(DOCUMENT_CATEGORIES).default('otro'),
  brigadeId: uuid.optional(),
  stationId: uuid.optional(),
});

export type FileRow = {
  id: string;
  origin: FileOrigin;
  type: FileType;
  /** Rótulo legible (p. ej. "norte", "nota de voz", nombre del documento). */
  label: string;
  mimeType: string;
  sizeBytes: number | null;
  takenAt: string;
  uploaded: boolean;
  hasOriginal: boolean;
  brigadeName: string | null;
  personName: string | null;
  stationCode: string | null;
  methodCode: string | null;
  methodName: string | null;
  unitCode: string | null;
  uploadedByName: string;
  lat: number | null;
  lng: number | null;
  /** Para documentos subidos en la web: se pueden borrar. */
  canDelete: boolean;
  /** Miniatura (solo fotos ya subidas). */
  thumbUrl: string | null;
};

export type FilesPage = {
  rows: FileRow[];
  total: number;
  bytes: number;
  pending: number;
  page: number;
  pageSize: number;
  byType: Record<FileType, number>;
};

export type FilesFacets = {
  brigades: { id: string; name: string }[];
  people: { id: string; fullName: string }[];
  stations: { id: string; code: string }[];
  methods: { id: string; code: string; name: string }[];
};
