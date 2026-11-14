import { z } from 'zod';

/**
 * Consultas (5.4): coordinación o jefatura pregunta a una persona de campo sobre una brigada,
 * estación o método. Se responde desde el teléfono (también sin conexión: se envía al sincronizar)
 * o coordinación registra lo conversado por teléfono, WhatsApp, radio o en persona.
 */

export const INQUIRY_STATUSES = ['abierta', 'respondida', 'cerrada'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  abierta: 'Esperando respuesta',
  respondida: 'Respondida',
  cerrada: 'Cerrada',
};

export const INQUIRY_CHANNELS = ['app', 'telefono', 'whatsapp', 'radio', 'presencial', 'otro'] as const;
export type InquiryChannel = (typeof INQUIRY_CHANNELS)[number];
export const INQUIRY_CHANNEL_LABELS: Record<InquiryChannel, string> = {
  app: 'App',
  telefono: 'Llamada telefónica',
  whatsapp: 'WhatsApp',
  radio: 'Radio',
  presencial: 'En persona',
  otro: 'Otro medio',
};

/**
 * consulta: la pregunta inicial · solicitud_info: coordinación pide más información ·
 * respuesta: lo que contesta campo · seguimiento: nota de coordinación (p. ej. "llamé y no contestó").
 */
export const INQUIRY_MESSAGE_KINDS = ['consulta', 'solicitud_info', 'respuesta', 'seguimiento'] as const;
export type InquiryMessageKind = (typeof INQUIRY_MESSAGE_KINDS)[number];
export const INQUIRY_MESSAGE_KIND_LABELS: Record<InquiryMessageKind, string> = {
  consulta: 'Consulta',
  solicitud_info: 'Pide más información',
  respuesta: 'Respuesta',
  seguimiento: 'Seguimiento',
};

/** Tamaño máximo de un archivo adjunto desde la web. */
export const INQUIRY_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const INQUIRY_FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/aac', 'audio/ogg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

const uuid = z.string().uuid();
const body = z.string().trim().min(1, 'Escribe el mensaje').max(4000);

/** Nueva consulta (web). Si se hizo por otro medio, se puede registrar de una vez la respuesta recibida. */
export const inquiryCreateSchema = z.object({
  brigadeId: uuid,
  targetUserId: uuid,
  stationId: uuid.nullish(),
  methodId: uuid.nullish(),
  subject: z.string().trim().min(3, 'Indica el asunto').max(200),
  channel: z.enum(INQUIRY_CHANNELS).default('app'),
  body,
  response: z.string().trim().max(4000).nullish(),
});
export type InquiryCreate = z.infer<typeof inquiryCreateSchema>;

/** Mensaje desde la web: pedir información, registrar la respuesta recibida por otro medio o dejar un seguimiento. */
export const inquiryMessageSchema = z.object({
  kind: z.enum(['solicitud_info', 'respuesta', 'seguimiento']),
  channel: z.enum(INQUIRY_CHANNELS).default('app'),
  body,
});

/** Respuesta escrita en el teléfono (idempotente por clientId). */
export const inquiryReplySchema = z.object({
  clientId: uuid,
  body,
  sentAt: z.string().datetime({ offset: true }),
});

export type InquiryFile = { id: string; kind: string; mimeType: string; name: string | null; sizeBytes: number | null; uploadStatus: string };

export type InquiryMessageDto = {
  id: string;
  clientId: string;
  kind: InquiryMessageKind;
  channel: InquiryChannel;
  authorId: string;
  authorName: string;
  /** Respuesta registrada por coordinación en nombre de esta persona. */
  onBehalfOfName: string | null;
  body: string;
  sentAt: string;
  files: InquiryFile[];
};

export type InquiryRow = {
  id: string;
  subject: string;
  status: InquiryStatus;
  channel: InquiryChannel;
  brigadeId: string | null;
  brigadeName: string | null;
  targetUserId: string | null;
  targetName: string | null;
  stationCode: string | null;
  methodCode: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  messages: number;
  files: number;
  lastMessageAt: string | null;
  lastKind: InquiryMessageKind | null;
};

export type InquiryDetail = InquiryRow & {
  projectId: string;
  targetPhone: string | null;
  stationId: string | null;
  methodId: string | null;
  methodName: string | null;
  closedByName: string | null;
  closedAt: string | null;
  thread: InquiryMessageDto[];
};

/** Opciones para registrar una consulta: brigadas con su gente, estaciones programadas y métodos. */
export type InquiryOptions = {
  brigades: {
    id: string;
    name: string;
    specialtyId: string | null;
    people: { id: string; fullName: string; phone: string | null; role: string }[];
    stations: { id: string; code: string }[];
  }[];
  methods: { id: string; code: string; name: string; specialtyId: string | null }[];
};

/** Consulta dirigida al usuario del teléfono. */
export type MyInquiryDto = {
  id: string;
  subject: string;
  status: InquiryStatus;
  brigadeName: string | null;
  stationCode: string | null;
  methodCode: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  thread: InquiryMessageDto[];
};
