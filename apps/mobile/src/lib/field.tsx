import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { File, UploadType } from 'expo-file-system';
import type {
  AttachmentMetaResult, BrigadeIncidentDto, ExecutionFormData, ExecutionStatus, ExecutionSync, ExecutionSyncResult, IncidentMoment,
  IncidentOrigin, IncidentSync, IncidentType, LogisticsData, LogisticsEntity, LogisticsRecordDto, MyIncidentDto, WpUnit,
} from '@toce/shared';
import { ApiError, OfflineError, api, getAccessToken, hasAccessToken, refreshAccessToken } from './api';
import { useAuth } from './auth';
import { API_URL } from './config';
import { getDb } from './db';
import { deleteLocalFiles } from './photo';
import { getDeviceId } from './secure';

/**
 * Registro de campo en el teléfono: ejecuciones de unidades, alertas, fotos, notas de voz y
 * mensajes con coordinación. Todo se guarda primero en SQLite y archivos locales; una cola los
 * sube al servidor cuando hay conexión (datos → fotos comprimidas → originales) y luego se
 * descargan las respuestas de coordinación a las alertas.
 */

export type LocalExecution = {
  clientId: string;
  unitId: string | null;
  newUnitClientId: string | null;
  stationMethodId: string;
  stationId: string;
  methodId: string;
  scheduleId: string | null;
  brigadeId: string | null;
  unitCode: string;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  startLat: number | null;
  startLng: number | null;
  startAccuracy: number | null;
  formData: ExecutionFormData;
  observations: string | null;
  updatedAt: string;
  syncedAt: string | null;
  syncError: string | null;
};

export type OwnerType = 'execution' | 'incident' | 'logistics';

export type LocalAttachment = {
  clientId: string;
  /** Id local del dueño: la ejecución o la alerta (según ownerType). */
  executionClientId: string;
  ownerType: OwnerType;
  kind: 'foto' | 'foto_metodo' | 'audio' | 'comprobante';
  slotKey: string | null;
  mimeType: string;
  path: string;
  originalPath: string | null;
  sizeBytes: number | null;
  originalSizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  altitude: number | null;
  takenAt: string;
  replaced: number;
  metaSynced: number;
  uploaded: number;
  originalUploaded: number;
  /** El archivo local se liberó (ya está en el servidor). */
  freed: number;
  syncError: string | null;
};

export type NewAttachment = Omit<LocalAttachment, 'replaced' | 'metaSynced' | 'uploaded' | 'originalUploaded' | 'syncError' | 'freed' | 'ownerType'> & {
  ownerType?: OwnerType;
};

export type LocalIncident = {
  clientId: string;
  projectId: string | null;
  brigadeId: string | null;
  stationId: string | null;
  methodId: string | null;
  unitId: string | null;
  unitCode: string | null;
  scheduleId: string | null;
  type: IncidentType;
  moment: IncidentMoment | null;
  launchedFrom: IncidentOrigin | null;
  description: string;
  proposedAction: string | null;
  unitNotDone: boolean;
  /** Supervisor: desviación metodológica, acción correctiva aplicada y cómo se resolvió. */
  methodologicalDeviation: string | null;
  correctiveAction: string | null;
  resolutionNotes: string | null;
  occurredAt: string;
  lat: number | null;
  lng: number | null;
  updatedAt: string;
  syncedAt: string | null;
  syncError: string | null;
  /** Estado y respuesta de coordinación (null hasta la primera sincronización). */
  remote: MyIncidentDto | null;
  seenAt: string | null;
  /** Mensajes escritos en el teléfono que aún no se envían. */
  outbox: { clientId: string; body: string; sentAt: string }[];
  /** Hay novedades de coordinación que el usuario no ha visto. */
  unread: boolean;
};

export type IncidentDraft = Omit<LocalIncident, 'updatedAt' | 'syncedAt' | 'syncError' | 'remote' | 'seenAt' | 'outbox' | 'unread' | 'methodologicalDeviation' | 'correctiveAction' | 'resolutionNotes'>
  & Partial<Pick<LocalIncident, 'methodologicalDeviation' | 'correctiveAction' | 'resolutionNotes'>>;

/** Alerta de otra persona en una brigada que supervisa el usuario (descargada del servidor). */
export type BrigadeIncident = BrigadeIncidentDto & {
  outbox: { clientId: string; body: string; sentAt: string }[];
  unread: boolean;
};

/** Registro logístico guardado en el teléfono. */
export type LocalLogistics<E extends LogisticsEntity = LogisticsEntity> = {
  clientId: string;
  entity: E;
  brigadeId: string;
  data: LogisticsData[E];
  updatedAt: string;
  syncedAt: string | null;
  syncError: string | null;
  /** Archivos que el servidor ya tiene (p. ej. registrados desde otro teléfono) y fotos en el teléfono. */
  remoteFiles: number;
  localFiles: number;
};
/** Datos de un registro sin los campos que pone el teléfono. */
export type LogisticsInput<E extends LogisticsEntity> = Omit<LogisticsData[E], 'clientUpdatedAt'>;

export type StartParams = {
  unitId: string | null;
  newUnitClientId?: string | null;
  stationMethodId: string;
  stationId: string;
  methodId: string;
  scheduleId: string | null;
  brigadeId: string | null;
  unitCode: string;
  position: { lat: number; lng: number; accuracy: number | null } | null;
};

export type SyncSummary = { executions: number; files: number; bytes: number };
/** Resultado de la última sincronización con envíos (para "Se enviaron N registros"). */
export type SyncReport = { at: string; records: number; files: number; responses: number };

type Ctx = {
  /** Ejecuciones del usuario, por unidad (id del servidor o id local de la unidad nueva). */
  byUnit: Map<string, LocalExecution>;
  executions: LocalExecution[];
  incidents: LocalIncident[];
  unreadIncidents: number;
  /** Supervisor: alertas de sus brigadas registradas por otras personas. */
  brigadeIncidents: BrigadeIncident[];
  unreadBrigadeIncidents: number;
  logistics: LocalLogistics[];
  rev: number;
  pending: SyncSummary;
  syncing: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastReport: SyncReport | null;
  start: (p: StartParams) => Promise<LocalExecution>;
  update: (clientId: string, patch: Partial<Pick<LocalExecution, 'status' | 'finishedAt' | 'formData' | 'observations'>>) => Promise<void>;
  attachmentsOf: (ownerClientId: string) => Promise<LocalAttachment[]>;
  addAttachment: (a: NewAttachment, replaceSlot?: boolean) => Promise<void>;
  removeAttachment: (clientId: string) => Promise<boolean>;
  saveIncident: (draft: IncidentDraft) => Promise<void>;
  sendIncidentMessage: (incidentClientId: string, body: string) => Promise<void>;
  markIncidentSeen: (incidentClientId: string) => Promise<void>;
  markBrigadeIncidentSeen: (incidentClientId: string) => Promise<void>;
  saveLogistics: <E extends LogisticsEntity>(entity: E, input: LogisticsInput<E>) => Promise<void>;
  /** Archivos ya enviados con más de 30 días que se pueden borrar del teléfono. */
  retentionCandidates: () => Promise<{ count: number; bytes: number }>;
  freeUploadedFiles: () => Promise<{ count: number; bytes: number }>;
  syncNow: () => Promise<void>;
};

const FieldContext = createContext<Ctx | null>(null);

const UNIT_STATUS: Record<ExecutionStatus, WpUnit['status']> = {
  en_curso: 'en_ejecucion',
  fotos_ok: 'fotos_ok',
  completada: 'completada',
  no_realizada: 'no_realizada',
};

/** Días que se conservan en el teléfono los archivos ya enviados (acordado con el usuario). */
export const RETENTION_DAYS = 30;

type ExecRow = {
  client_id: string; unit_id: string | null; new_unit_client_id: string | null; station_method_id: string; station_id: string;
  method_id: string; schedule_id: string | null; brigade_id: string | null; unit_code: string; status: ExecutionStatus;
  started_at: string; finished_at: string | null; start_lat: number | null; start_lng: number | null; start_accuracy: number | null;
  form_data: string; observations: string | null; updated_at: string; synced_at: string | null; sync_error: string | null;
};

const toExecution = (r: ExecRow): LocalExecution => ({
  clientId: r.client_id, unitId: r.unit_id, newUnitClientId: r.new_unit_client_id, stationMethodId: r.station_method_id,
  stationId: r.station_id, methodId: r.method_id, scheduleId: r.schedule_id, brigadeId: r.brigade_id, unitCode: r.unit_code,
  status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, startLat: r.start_lat, startLng: r.start_lng,
  startAccuracy: r.start_accuracy, formData: JSON.parse(r.form_data) as ExecutionFormData, observations: r.observations,
  updatedAt: r.updated_at, syncedAt: r.synced_at, syncError: r.sync_error,
});

type IncRow = {
  client_id: string; project_id: string | null; brigade_id: string | null; station_id: string | null; method_id: string | null;
  unit_id: string | null; unit_code: string | null; schedule_id: string | null; type: IncidentType; moment: IncidentMoment | null;
  launched_from: LocalIncident['launchedFrom']; description: string; proposed_action: string | null; unit_not_done: number;
  occurred_at: string; lat: number | null; lng: number | null; updated_at: string; synced_at: string | null; sync_error: string | null;
  remote: string | null; seen_at: string | null;
  methodological_deviation: string | null; corrective_action: string | null; resolution_notes: string | null;
};

type LogRow = {
  client_id: string; entity: LogisticsEntity; brigade_id: string; data: string; updated_at: string; synced_at: string | null;
  sync_error: string | null; remote_files: number;
};
const toLogistics = (r: LogRow & { local_files?: number }): LocalLogistics => ({
  clientId: r.client_id, entity: r.entity, brigadeId: r.brigade_id, data: JSON.parse(r.data) as LogisticsData[LogisticsEntity],
  updatedAt: r.updated_at, syncedAt: r.synced_at, syncError: r.sync_error, remoteFiles: r.remote_files, localFiles: r.local_files ?? 0,
});

/** ¿Hay algo de coordinación posterior a la última vez que se vio? */
function hasNews(remote: MyIncidentDto | null, seenAt: string | null, userId: string): boolean {
  if (!remote) return false;
  const since = seenAt ? new Date(seenAt).getTime() : 0;
  const fromCoord = remote.messages.filter((m) => m.authorId !== userId).map((m) => new Date(m.sentAt).getTime());
  // La resolución cuenta como novedad solo si la dio coordinación (no la "resuelta en campo" del propio supervisor).
  const resolved = remote.resolvedAt && remote.coordinationDecision ? new Date(remote.resolvedAt).getTime() : 0;
  const latest = Math.max(0, ...fromCoord, resolved);
  return latest > since;
}

/** Columnas de attachments con alias en camelCase (p = prefijo de tabla, p. ej. 'a.'). */
const attCols = (p = '') =>
  [
    ['client_id', 'clientId'], ['execution_client_id', 'executionClientId'], ['owner_type', 'ownerType'], ['kind', 'kind'],
    ['slot_key', 'slotKey'], ['mime_type', 'mimeType'], ['path', 'path'], ['original_path', 'originalPath'], ['size_bytes', 'sizeBytes'],
    ['original_size_bytes', 'originalSizeBytes'], ['width', 'width'], ['height', 'height'], ['duration_sec', 'durationSec'],
    ['lat', 'lat'], ['lng', 'lng'], ['accuracy', 'accuracy'], ['altitude', 'altitude'], ['taken_at', 'takenAt'],
    ['replaced', 'replaced'], ['meta_synced', 'metaSynced'], ['uploaded', 'uploaded'], ['original_uploaded', 'originalUploaded'],
    ['freed', 'freed'], ['sync_error', 'syncError'],
  ].map(([c, a]) => `${p}${c} AS ${a}`).join(', ');
const ATT_COLS = attCols();

/** Archivos del usuario (de sus ejecuciones, sus alertas o sus registros logísticos). */
const MY_FILES = `(
  (a.owner_type = 'execution' AND a.execution_client_id IN (SELECT client_id FROM executions WHERE user_id = $u))
  OR (a.owner_type = 'incident' AND a.execution_client_id IN (SELECT client_id FROM incidents WHERE user_id = $u))
  OR (a.owner_type = 'logistics' AND a.execution_client_id IN (SELECT client_id FROM logistics WHERE user_id = $u)))`;

/** Cada cuánto se reintenta la subida mientras la app está abierta y desbloqueada. */
const SYNC_INTERVAL_MS = 60 * 1000;

/** onScheduleChanged: coordinación reprogramó algo y hay que actualizar el paquete de trabajo. */
export function FieldProvider({ children, onScheduleChanged }: { children: ReactNode; onScheduleChanged?: () => void }) {
  const { user, status, online } = useAuth();
  const roles = user?.roles;
  const pulls = useMemo(() => ({
    brigadeIncidents: !!roles?.includes('supervisor'),
    logistics: !!roles?.includes('logistico'),
  }), [roles]);
  const scheduleChanged = useRef(onScheduleChanged);
  scheduleChanged.current = onScheduleChanged;
  const userId = user?.id ?? null;
  const [executions, setExecutions] = useState<LocalExecution[]>([]);
  const [incidents, setIncidents] = useState<LocalIncident[]>([]);
  const [brigadeIncidents, setBrigadeIncidents] = useState<BrigadeIncident[]>([]);
  const [logistics, setLogistics] = useState<LocalLogistics[]>([]);
  const [rev, setRev] = useState(0);
  const [pending, setPending] = useState<SyncSummary>({ executions: 0, files: 0, bytes: 0 });
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    if (!userId) {
      setExecutions([]);
      setIncidents([]);
      setBrigadeIncidents([]);
      setLogistics([]);
      return;
    }
    const db = await getDb();
    const rows = await db.getAllAsync<ExecRow>('SELECT * FROM executions WHERE user_id = ? ORDER BY started_at', userId);
    setExecutions(rows.map(toExecution));

    const inc = await db.getAllAsync<IncRow>('SELECT * FROM incidents WHERE user_id = ? ORDER BY occurred_at DESC', userId);
    const out = await db.getAllAsync<{ client_id: string; incident_client_id: string; body: string; sent_at: string }>(
      'SELECT client_id, incident_client_id, body, sent_at FROM incident_messages_out WHERE synced = 0 ORDER BY sent_at');
    setIncidents(inc.map((r) => {
      const remote = r.remote ? (JSON.parse(r.remote) as MyIncidentDto) : null;
      return {
        clientId: r.client_id, projectId: r.project_id, brigadeId: r.brigade_id, stationId: r.station_id, methodId: r.method_id,
        unitId: r.unit_id, unitCode: r.unit_code, scheduleId: r.schedule_id, type: r.type, moment: r.moment, launchedFrom: r.launched_from,
        description: r.description, proposedAction: r.proposed_action, unitNotDone: !!r.unit_not_done, occurredAt: r.occurred_at,
        methodologicalDeviation: r.methodological_deviation, correctiveAction: r.corrective_action, resolutionNotes: r.resolution_notes,
        lat: r.lat, lng: r.lng, updatedAt: r.updated_at, syncedAt: r.synced_at, syncError: r.sync_error, remote, seenAt: r.seen_at,
        outbox: out.filter((m) => m.incident_client_id === r.client_id).map((m) => ({ clientId: m.client_id, body: m.body, sentAt: m.sent_at })),
        unread: hasNews(remote, r.seen_at, userId),
      };
    }));

    const bi = await db.getAllAsync<{ client_id: string; data: string; seen_at: string | null }>(
      'SELECT client_id, data, seen_at FROM brigade_incidents WHERE user_id = ?', userId);
    setBrigadeIncidents(bi.map((r) => {
      const d = JSON.parse(r.data) as BrigadeIncidentDto;
      return {
        ...d,
        outbox: out.filter((m) => m.incident_client_id === r.client_id).map((m) => ({ clientId: m.client_id, body: m.body, sentAt: m.sent_at })),
        // Nueva para el supervisor si nunca la abrió o si hay mensajes de otros desde entonces.
        unread: !r.seen_at || hasNews(d, r.seen_at, userId),
      };
    }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));

    const lg = await db.getAllAsync<LogRow & { local_files: number }>(
      `SELECT l.*, (SELECT COUNT(*) FROM attachments a WHERE a.owner_type = 'logistics' AND a.execution_client_id = l.client_id AND a.replaced = 0) AS local_files
       FROM logistics l WHERE l.user_id = ? ORDER BY l.updated_at DESC`, userId);
    setLogistics(lg.map(toLogistics));

    const files = MY_FILES.replaceAll('$u', '?');
    const p = await db.getFirstAsync<{ ex: number; files: number; bytes: number | null }>(
      `SELECT
         (SELECT COUNT(*) FROM executions WHERE user_id = ? AND (synced_at IS NULL OR synced_at <> updated_at))
         + (SELECT COUNT(*) FROM incidents WHERE user_id = ? AND (synced_at IS NULL OR synced_at <> updated_at))
         + (SELECT COUNT(*) FROM logistics WHERE user_id = ? AND (synced_at IS NULL OR synced_at <> updated_at))
         + (SELECT COUNT(*) FROM incident_messages_out WHERE synced = 0) AS ex,
         (SELECT COUNT(*) FROM attachments a WHERE ${files}
            AND (a.meta_synced = 0 OR a.uploaded = 0 OR (a.original_path IS NOT NULL AND a.original_uploaded = 0))) AS files,
         (SELECT SUM(CASE WHEN a.uploaded = 0 THEN COALESCE(a.size_bytes, 0) ELSE 0 END
                   + CASE WHEN a.original_path IS NOT NULL AND a.original_uploaded = 0 THEN COALESCE(a.original_size_bytes, 0) ELSE 0 END)
            FROM attachments a WHERE ${files}) AS bytes`,
      userId, userId, userId, userId, userId, userId, userId, userId, userId);
    setPending({ executions: p?.ex ?? 0, files: p?.files ?? 0, bytes: p?.bytes ?? 0 });
    setRev((v) => v + 1);
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const syncNow = useCallback(async () => {
    if (!userId || !hasAccessToken()) return;
    inFlight.current ??= (async () => {
      setSyncing(true);
      try {
        const report = await pushAll(userId, reload, pulls);
        setLastSyncAt(report.at);
        setLastSyncError(null);
        if (report.records || report.files || report.responses) setLastReport(report);
        // Coordinación reprogramó algo: el cronograma cambió, se actualiza el paquete de trabajo.
        if (report.rescheduled) scheduleChanged.current?.();
      } catch (e) {
        setLastSyncError(e instanceof OfflineError ? null : e instanceof Error ? e.message : 'Error al sincronizar');
      } finally {
        setSyncing(false);
        inFlight.current = null;
        await reload();
      }
    })();
    return inFlight.current;
  }, [userId, reload, pulls]);

  /** Programa una subida poco después de un cambio (agrupa varios cambios seguidos). */
  const scheduleSync = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void syncNow(), 1500);
  }, [syncNow]);

  // Subida al recuperar conexión, al volver a la app y periódicamente.
  useEffect(() => {
    if (status !== 'unlocked' || !online) return;
    void syncNow();
    const iv = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void syncNow());
    return () => {
      clearInterval(iv);
      sub.remove();
    };
  }, [status, online, syncNow]);

  const start = useCallback(async (p: StartParams) => {
    if (!userId) throw new Error('Sin sesión');
    const db = await getDb();
    const now = new Date().toISOString();
    const clientId = Crypto.randomUUID();
    await db.runAsync(
      `INSERT INTO executions (client_id, user_id, unit_id, new_unit_client_id, station_method_id, station_id, method_id, schedule_id,
         brigade_id, unit_code, status, started_at, start_lat, start_lng, start_accuracy, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_curso', ?, ?, ?, ?, ?)`,
      clientId, userId, p.unitId, p.newUnitClientId ?? null, p.stationMethodId, p.stationId, p.methodId, p.scheduleId, p.brigadeId,
      p.unitCode, now, p.position?.lat ?? null, p.position?.lng ?? null, p.position?.accuracy ?? null, now);
    await reload();
    scheduleSync();
    const row = await db.getFirstAsync<ExecRow>('SELECT * FROM executions WHERE client_id = ?', clientId);
    return toExecution(row!);
  }, [userId, reload, scheduleSync]);

  const update = useCallback<Ctx['update']>(async (clientId, patch) => {
    const db = await getDb();
    const sets: string[] = [];
    const args: (string | null)[] = [];
    if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status); }
    if (patch.finishedAt !== undefined) { sets.push('finished_at = ?'); args.push(patch.finishedAt); }
    if (patch.formData !== undefined) { sets.push('form_data = ?'); args.push(JSON.stringify(patch.formData)); }
    if (patch.observations !== undefined) { sets.push('observations = ?'); args.push(patch.observations); }
    if (!sets.length) return;
    // updated_at estrictamente creciente: el servidor descarta envíos más antiguos.
    const prev = await db.getFirstAsync<{ updated_at: string }>('SELECT updated_at FROM executions WHERE client_id = ?', clientId);
    const now = nextStamp(prev?.updated_at);
    await db.runAsync(`UPDATE executions SET ${sets.join(', ')}, updated_at = ? WHERE client_id = ?`, ...args, now, clientId);
    await reload();
    scheduleSync();
  }, [reload, scheduleSync]);

  const attachmentsOf = useCallback(async (ownerClientId: string) => {
    const db = await getDb();
    return db.getAllAsync<LocalAttachment>(
      `SELECT ${ATT_COLS} FROM attachments WHERE execution_client_id = ? AND replaced = 0 ORDER BY taken_at`, ownerClientId);
  }, []);

  const addAttachment = useCallback<Ctx['addAttachment']>(async (a, replaceSlot) => {
    const db = await getDb();
    if (replaceSlot && a.kind !== 'audio' && a.slotKey) {
      // Foto repetida del mismo lado: la anterior se descarta si aún no se envió; si ya se envió, queda en el servidor.
      const old = await db.getAllAsync<LocalAttachment>(
        `SELECT ${ATT_COLS} FROM attachments WHERE execution_client_id = ? AND kind = ? AND IFNULL(slot_key, '') = ? AND replaced = 0`,
        a.executionClientId, a.kind, a.slotKey);
      for (const o of old) {
        if (o.metaSynced) {
          await db.runAsync('UPDATE attachments SET replaced = 1 WHERE client_id = ?', o.clientId);
        } else {
          await db.runAsync('DELETE FROM attachments WHERE client_id = ?', o.clientId);
          deleteLocalFiles(o.path, o.originalPath);
        }
      }
    }
    await db.runAsync(
      `INSERT INTO attachments (client_id, execution_client_id, owner_type, kind, slot_key, mime_type, path, original_path, size_bytes,
         original_size_bytes, width, height, duration_sec, lat, lng, accuracy, altitude, taken_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.clientId, a.executionClientId, a.ownerType ?? 'execution', a.kind, a.slotKey, a.mimeType, a.path, a.originalPath, a.sizeBytes,
      a.originalSizeBytes, a.width, a.height, a.durationSec, a.lat, a.lng, a.accuracy, a.altitude, a.takenAt);
    await reload();
    scheduleSync();
  }, [reload, scheduleSync]);

  const removeAttachment = useCallback(async (clientId: string) => {
    const db = await getDb();
    const a = await db.getFirstAsync<LocalAttachment>(`SELECT ${ATT_COLS} FROM attachments WHERE client_id = ?`, clientId);
    if (!a) return true;
    if (a.metaSynced) return false; // ya está en el servidor
    await db.runAsync('DELETE FROM attachments WHERE client_id = ?', clientId);
    deleteLocalFiles(a.path, a.originalPath);
    await reload();
    return true;
  }, [reload]);

  const saveIncident = useCallback(async (d: IncidentDraft) => {
    if (!userId) throw new Error('Sin sesión');
    const db = await getDb();
    const prev = await db.getFirstAsync<{ updated_at: string }>('SELECT updated_at FROM incidents WHERE client_id = ?', d.clientId);
    const now = nextStamp(prev?.updated_at);
    await db.runAsync(
      `INSERT INTO incidents (client_id, user_id, project_id, brigade_id, station_id, method_id, unit_id, unit_code, schedule_id, type, moment,
         launched_from, description, proposed_action, unit_not_done, occurred_at, lat, lng, updated_at,
         methodological_deviation, corrective_action, resolution_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET type = excluded.type, moment = excluded.moment, description = excluded.description,
         proposed_action = excluded.proposed_action, unit_not_done = excluded.unit_not_done, updated_at = excluded.updated_at,
         station_id = excluded.station_id, method_id = excluded.method_id, brigade_id = excluded.brigade_id, project_id = excluded.project_id,
         methodological_deviation = excluded.methodological_deviation, corrective_action = excluded.corrective_action,
         resolution_notes = excluded.resolution_notes`,
      d.clientId, userId, d.projectId, d.brigadeId, d.stationId, d.methodId, d.unitId, d.unitCode, d.scheduleId, d.type, d.moment,
      d.launchedFrom, d.description, d.proposedAction, d.unitNotDone ? 1 : 0, d.occurredAt, d.lat, d.lng, now,
      d.methodologicalDeviation ?? null, d.correctiveAction ?? null, d.resolutionNotes ?? null);
    await reload();
    scheduleSync();
  }, [userId, reload, scheduleSync]);

  const sendIncidentMessage = useCallback(async (incidentClientId: string, body: string) => {
    const db = await getDb();
    await db.runAsync('INSERT INTO incident_messages_out (client_id, incident_client_id, body, sent_at) VALUES (?, ?, ?, ?)',
      Crypto.randomUUID(), incidentClientId, body.trim(), new Date().toISOString());
    await reload();
    scheduleSync();
  }, [reload, scheduleSync]);

  const markIncidentSeen = useCallback(async (incidentClientId: string) => {
    const db = await getDb();
    await db.runAsync('UPDATE incidents SET seen_at = ? WHERE client_id = ?', new Date().toISOString(), incidentClientId);
    await reload();
  }, [reload]);

  const markBrigadeIncidentSeen = useCallback(async (incidentClientId: string) => {
    if (!userId) return;
    const db = await getDb();
    await db.runAsync('UPDATE brigade_incidents SET seen_at = ? WHERE user_id = ? AND client_id = ?', new Date().toISOString(), userId, incidentClientId);
    await reload();
  }, [userId, reload]);

  const saveLogistics = useCallback(async <E extends LogisticsEntity>(entity: E, input: LogisticsInput<E>) => {
    if (!userId) throw new Error('Sin sesión');
    const db = await getDb();
    const { clientId, brigadeId } = input as { clientId: string; brigadeId: string };
    const prev = await db.getFirstAsync<{ updated_at: string }>('SELECT updated_at FROM logistics WHERE client_id = ?', clientId);
    const now = nextStamp(prev?.updated_at);
    const data = JSON.stringify({ ...input, clientUpdatedAt: now });
    await db.runAsync(
      `INSERT INTO logistics (client_id, user_id, entity, brigade_id, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET brigade_id = excluded.brigade_id, data = excluded.data, updated_at = excluded.updated_at, sync_error = NULL`,
      clientId, userId, entity, brigadeId, data, now);
    await reload();
    scheduleSync();
  }, [userId, reload, scheduleSync]);

  const retentionQuery = useCallback(async () => {
    const db = await getDb();
    const limit = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
    return db.getAllAsync<LocalAttachment>(
      `SELECT ${ATT_COLS} FROM attachments WHERE freed = 0 AND meta_synced = 1 AND uploaded = 1
         AND (original_path IS NULL OR original_uploaded = 1) AND taken_at < ?`, limit);
  }, []);

  const retentionCandidates = useCallback(async () => {
    const rows = await retentionQuery();
    return { count: rows.length, bytes: rows.reduce((s, r) => s + (r.sizeBytes ?? 0) + (r.originalSizeBytes ?? 0), 0) };
  }, [retentionQuery]);

  const freeUploadedFiles = useCallback(async () => {
    const db = await getDb();
    const rows = await retentionQuery();
    for (const r of rows) {
      deleteLocalFiles(r.path, r.originalPath);
      await db.runAsync('UPDATE attachments SET freed = 1 WHERE client_id = ?', r.clientId);
    }
    await reload();
    return { count: rows.length, bytes: rows.reduce((s, r) => s + (r.sizeBytes ?? 0) + (r.originalSizeBytes ?? 0), 0) };
  }, [retentionQuery, reload]);

  const byUnit = useMemo(() => {
    const m = new Map<string, LocalExecution>();
    for (const e of executions) {
      if (e.newUnitClientId) m.set(e.newUnitClientId, e);
      if (e.unitId) m.set(e.unitId, e);
    }
    return m;
  }, [executions]);

  const unreadIncidents = incidents.filter((i) => i.unread).length;
  const unreadBrigadeIncidents = brigadeIncidents.filter((i) => i.unread).length;

  return (
    <FieldContext.Provider
      value={{
        byUnit, executions, incidents, unreadIncidents, brigadeIncidents, unreadBrigadeIncidents, logistics, rev, pending, syncing,
        lastSyncAt, lastSyncError, lastReport, start, update, attachmentsOf, addAttachment, removeAttachment, saveIncident,
        sendIncidentMessage, markIncidentSeen, markBrigadeIncidentSeen, saveLogistics, retentionCandidates, freeUploadedFiles, syncNow,
      }}
    >
      {children}
    </FieldContext.Provider>
  );
}

/** Marca de tiempo estrictamente creciente respecto a la anterior. */
function nextStamp(prev?: string) {
  return new Date(Math.max(Date.now(), prev ? new Date(prev).getTime() + 1 : 0)).toISOString();
}

export function useField() {
  const ctx = useContext(FieldContext);
  if (!ctx) throw new Error('useField fuera de FieldProvider');
  return ctx;
}

/**
 * Lo registrado en el teléfono que aún no refleja el paquete de trabajo:
 * estado de cada unidad y unidades nuevas de métodos abiertos.
 */
export function useFieldOverlay() {
  const ctx = useContext(FieldContext);
  return useMemo(() => {
    const statusByUnit = new Map<string, WpUnit['status']>();
    /** Unidades creadas en campo; serverId cuando ya se sincronizaron. */
    const newUnits: (WpUnit & { serverId: string | null })[] = [];
    // Unidades declaradas "no realizadas" en una alerta (salvo que coordinación ya las reprogramara).
    for (const i of ctx?.incidents ?? []) {
      if (i.unitNotDone && i.unitId && !i.remote?.reschedules.length) statusByUnit.set(i.unitId, 'no_realizada');
    }
    for (const e of ctx?.executions ?? []) {
      const st = UNIT_STATUS[e.status];
      if (e.unitId) statusByUnit.set(e.unitId, st);
      if (e.newUnitClientId) {
        statusByUnit.set(e.newUnitClientId, st);
        newUnits.push({
          id: e.newUnitClientId, serverId: e.unitId, stationMethodId: e.stationMethodId, stationId: e.stationId, methodId: e.methodId,
          seq: Number(e.unitCode.match(/(\d+)\D*$/)?.[1] ?? 0), code: e.unitCode, status: st,
        });
      }
    }
    return { statusByUnit, newUnits };
  }, [ctx?.executions, ctx?.incidents]);
}

// ---------------------------------------------------------------------------
// Cola de subida

async function pushAll(
  userId: string,
  reload: () => Promise<void>,
  pulls: { brigadeIncidents: boolean; logistics: boolean },
): Promise<SyncReport & { rescheduled: boolean }> {
  const db = await getDb();
  const deviceId = await getDeviceId();
  const report = { at: new Date().toISOString(), records: 0, files: 0, responses: 0, rescheduled: false };

  // 1) Datos de las unidades.
  const execs = await db.getAllAsync<ExecRow>(
    'SELECT * FROM executions WHERE user_id = ? AND (synced_at IS NULL OR synced_at <> updated_at) ORDER BY updated_at', userId);
  for (const r of execs) {
    const e = toExecution(r);
    const body: ExecutionSync = {
      clientId: e.clientId,
      samplingUnitId: e.unitId,
      newUnit: e.unitId ? null : { clientId: e.newUnitClientId!, stationMethodId: e.stationMethodId },
      stationId: e.stationId, methodId: e.methodId, scheduleId: e.scheduleId, brigadeId: e.brigadeId,
      status: e.status, startedAt: e.startedAt, finishedAt: e.finishedAt,
      startLat: e.startLat, startLng: e.startLng, startAccuracy: e.startAccuracy,
      formData: e.formData, formCompletedAt: e.formData.records.length ? e.updatedAt : null,
      observations: e.observations, deviceId, clientUpdatedAt: e.updatedAt,
    };
    try {
      const res = await api<ExecutionSyncResult>('/field/executions', { method: 'POST', body: JSON.stringify(body) }, 20000);
      await db.runAsync(
        'UPDATE executions SET synced_at = ?, sync_error = NULL, unit_id = ?, unit_code = ? WHERE client_id = ?',
        e.updatedAt, res.samplingUnitId, res.unitCode, e.clientId);
      report.records++;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err; // sin red: se reintenta luego
      await db.runAsync('UPDATE executions SET sync_error = ? WHERE client_id = ?', err.message, e.clientId);
    }
  }

  // 2) Alertas.
  const incs = await db.getAllAsync<IncRow>(
    'SELECT * FROM incidents WHERE user_id = ? AND (synced_at IS NULL OR synced_at <> updated_at) ORDER BY updated_at', userId);
  for (const r of incs) {
    const body: IncidentSync = {
      clientId: r.client_id, projectId: r.project_id, brigadeId: r.brigade_id, stationId: r.station_id, methodId: r.method_id,
      samplingUnitId: r.unit_id, scheduleId: r.schedule_id, type: r.type, moment: r.moment, launchedFrom: r.launched_from,
      description: r.description, proposedAction: r.proposed_action, unitNotDone: !!r.unit_not_done, occurredAt: r.occurred_at,
      methodologicalDeviation: r.methodological_deviation, correctiveAction: r.corrective_action, resolutionNotes: r.resolution_notes,
      lat: r.lat, lng: r.lng, clientUpdatedAt: r.updated_at,
    };
    try {
      await api('/field/incidents', { method: 'POST', body: JSON.stringify(body) }, 15000);
      await db.runAsync('UPDATE incidents SET synced_at = ?, sync_error = NULL WHERE client_id = ?', r.updated_at, r.client_id);
      report.records++;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      await db.runAsync('UPDATE incidents SET sync_error = ? WHERE client_id = ?', err.message, r.client_id);
    }
  }

  // 2b) Registros logísticos.
  const logs = await db.getAllAsync<LogRow>(
    'SELECT * FROM logistics WHERE user_id = ? AND (synced_at IS NULL OR synced_at <> updated_at) ORDER BY updated_at', userId);
  for (const r of logs) {
    try {
      await api(`/field/logistics/${r.entity}`, { method: 'POST', body: r.data }, 15000);
      await db.runAsync('UPDATE logistics SET synced_at = ?, sync_error = NULL WHERE client_id = ?', r.updated_at, r.client_id);
      report.records++;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      await db.runAsync('UPDATE logistics SET sync_error = ? WHERE client_id = ?', err.message, r.client_id);
    }
  }

  // 3) Mensajes a coordinación: la alerta propia ya debe estar en el servidor (las de la brigada ya lo están).
  const msgs = await db.getAllAsync<{ client_id: string; incident_client_id: string; body: string; sent_at: string }>(
    `SELECT m.client_id, m.incident_client_id, m.body, m.sent_at FROM incident_messages_out m
     LEFT JOIN incidents i ON i.client_id = m.incident_client_id
     WHERE m.synced = 0 AND (i.client_id IS NULL OR i.synced_at IS NOT NULL) ORDER BY m.sent_at`);
  for (const m of msgs) {
    try {
      await api(`/field/incidents/${m.incident_client_id}/messages`, {
        method: 'POST', body: JSON.stringify({ clientId: m.client_id, body: m.body, sentAt: m.sent_at }),
      }, 15000);
      await db.runAsync('UPDATE incident_messages_out SET synced = 1 WHERE client_id = ?', m.client_id);
      report.records++;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }
  await reload();

  // 4) Datos de fotos y audios (requiere que su unidad o alerta ya esté en el servidor).
  const metas = await db.getAllAsync<LocalAttachment>(
    `SELECT ${attCols('a.')} FROM attachments a
     LEFT JOIN executions e ON a.owner_type = 'execution' AND e.client_id = a.execution_client_id
     LEFT JOIN incidents i ON a.owner_type = 'incident' AND i.client_id = a.execution_client_id
     LEFT JOIN logistics l ON a.owner_type = 'logistics' AND l.client_id = a.execution_client_id
     WHERE a.meta_synced = 0 AND ((e.user_id = ? AND e.synced_at IS NOT NULL) OR (i.user_id = ? AND i.synced_at IS NOT NULL)
       OR (l.user_id = ? AND l.synced_at IS NOT NULL))
     ORDER BY a.taken_at`, userId, userId, userId);
  for (const a of metas) {
    try {
      await api<AttachmentMetaResult>('/field/attachments', {
        method: 'POST',
        body: JSON.stringify({
          clientId: a.clientId,
          ...(a.ownerType === 'incident'
            ? { incidentClientId: a.executionClientId }
            : a.ownerType === 'logistics' ? { logisticsClientId: a.executionClientId } : { executionClientId: a.executionClientId }),
          kind: a.kind, slotKey: a.slotKey, mimeType: a.mimeType,
          sizeBytes: a.sizeBytes, originalSizeBytes: a.originalSizeBytes, width: a.width, height: a.height, durationSec: a.durationSec,
          lat: a.lat, lng: a.lng, accuracy: a.accuracy, altitude: a.altitude, takenAt: a.takenAt,
        }),
      }, 15000);
      await db.runAsync('UPDATE attachments SET meta_synced = 1, sync_error = NULL WHERE client_id = ?', a.clientId);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      await db.runAsync('UPDATE attachments SET sync_error = ? WHERE client_id = ?', err.message, a.clientId);
    }
  }

  // 5) Copias comprimidas y audios; 6) originales (los más pesados, al final).
  for (const variant of ['compressed', 'original'] as const) {
    const files = await db.getAllAsync<LocalAttachment>(
      variant === 'compressed'
        ? `SELECT ${ATT_COLS} FROM attachments WHERE meta_synced = 1 AND uploaded = 0 AND freed = 0 ORDER BY taken_at`
        : `SELECT ${ATT_COLS} FROM attachments WHERE meta_synced = 1 AND uploaded = 1 AND original_path IS NOT NULL AND original_uploaded = 0 AND freed = 0 ORDER BY taken_at`);
    for (const a of files) {
      const path = variant === 'compressed' ? a.path : a.originalPath!;
      const ok = await uploadFile(path, `${API_URL}/field/attachments/${a.clientId}/content?variant=${variant}`, a.mimeType);
      if (ok === true) {
        await db.runAsync(
          `UPDATE attachments SET ${variant === 'compressed' ? 'uploaded' : 'original_uploaded'} = 1, sync_error = NULL WHERE client_id = ?`,
          a.clientId);
        if (variant === 'compressed') report.files++;
      } else {
        await db.runAsync('UPDATE attachments SET sync_error = ? WHERE client_id = ?', ok, a.clientId);
      }
      await reload();
    }
  }

  // 7) Respuestas de coordinación a mis alertas.
  const mine = await api<MyIncidentDto[]>('/field/incidents/mine', {}, 20000);
  const local = await db.getAllAsync<{ client_id: string; remote: string | null }>('SELECT client_id, remote FROM incidents WHERE user_id = ?', userId);
  const prevById = new Map(local.map((l) => [l.client_id, l.remote ? (JSON.parse(l.remote) as MyIncidentDto) : null]));
  for (const m of mine) {
    if (!prevById.has(m.clientId)) continue; // alerta registrada desde otro teléfono
    const before = prevById.get(m.clientId);
    const json = JSON.stringify(m);
    if (before && JSON.stringify(before) === json) continue;
    await db.runAsync('UPDATE incidents SET remote = ? WHERE client_id = ?', json, m.clientId);
    if (!before || before.updatedAt !== m.updatedAt) report.responses++;
    if ((before?.reschedules.length ?? 0) < m.reschedules.length) report.rescheduled = true;
  }

  // 8) Supervisor: alertas de sus brigadas (registradas por otras personas).
  if (pulls.brigadeIncidents) {
    const list = await api<BrigadeIncidentDto[]>('/field/incidents/brigades', {}, 20000);
    await db.withTransactionAsync(async () => {
      const keep = new Set(list.map((x) => x.clientId));
      const existing = await db.getAllAsync<{ client_id: string }>('SELECT client_id FROM brigade_incidents WHERE user_id = ?', userId);
      for (const e of existing) if (!keep.has(e.client_id)) await db.runAsync('DELETE FROM brigade_incidents WHERE user_id = ? AND client_id = ?', userId, e.client_id);
      for (const x of list) {
        await db.runAsync(
          `INSERT INTO brigade_incidents (user_id, client_id, data) VALUES (?, ?, ?)
           ON CONFLICT(user_id, client_id) DO UPDATE SET data = excluded.data`, userId, x.clientId, JSON.stringify(x));
      }
    });
  }

  // 9) Logístico: restaura lo registrado desde otro teléfono o antes de reinstalar (sin pisar cambios por enviar).
  if (pulls.logistics) {
    const list = await api<LogisticsRecordDto[]>('/field/logistics', {}, 20000);
    const local = new Map((await db.getAllAsync<{ client_id: string; updated_at: string; synced_at: string | null }>(
      'SELECT client_id, updated_at, synced_at FROM logistics WHERE user_id = ?', userId)).map((l) => [l.client_id, l]));
    for (const x of list) {
      const d = x.data as { clientId: string; brigadeId: string; clientUpdatedAt: string };
      const l = local.get(d.clientId);
      const dirty = l && l.synced_at !== l.updated_at;
      if (l && (dirty || new Date(l.updated_at).getTime() >= new Date(d.clientUpdatedAt).getTime())) {
        await db.runAsync('UPDATE logistics SET remote_files = ? WHERE client_id = ?', x.files, d.clientId);
        continue;
      }
      await db.runAsync(
        `INSERT INTO logistics (client_id, user_id, entity, brigade_id, data, updated_at, synced_at, remote_files) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(client_id) DO UPDATE SET brigade_id = excluded.brigade_id, data = excluded.data, updated_at = excluded.updated_at,
           synced_at = excluded.synced_at, remote_files = excluded.remote_files, sync_error = NULL`,
        d.clientId, userId, x.entity, d.brigadeId, JSON.stringify(x.data), d.clientUpdatedAt, d.clientUpdatedAt, x.files);
    }
  }
  return report;
}

/** Sube un archivo como cuerpo binario. true si se subió; texto del error si el servidor lo rechazó. Sin red: lanza OfflineError. */
async function uploadFile(path: string, url: string, mimeType: string, retried = false): Promise<true | string> {
  const file = new File(path);
  if (!file.exists) return 'El archivo ya no está en el teléfono';
  let res: { status: number; body: string };
  try {
    res = await file.upload(url, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers: { authorization: `Bearer ${getAccessToken() ?? ''}`, 'content-type': mimeType },
    });
  } catch {
    throw new OfflineError();
  }
  if (res.status === 401 && !retried && (await refreshAccessToken())) return uploadFile(path, url, mimeType, true);
  if (res.status >= 200 && res.status < 300) return true;
  if (res.status >= 500) throw new OfflineError(); // servidor con problemas: reintentar luego
  try {
    return (JSON.parse(res.body) as { error?: string }).error ?? `Error ${res.status}`;
  } catch {
    return `Error ${res.status}`;
  }
}
