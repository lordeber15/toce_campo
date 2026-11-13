import * as SQLite from 'expo-sqlite';

/**
 * Base de datos local del teléfono. Guarda el paquete de trabajo y, en los
 * siguientes sprints, los registros de campo y la cola de subida.
 * Cada migración se aplica una sola vez (PRAGMA user_version).
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS work_package (
     user_id TEXT PRIMARY KEY NOT NULL,
     version TEXT NOT NULL,
     generated_at TEXT NOT NULL,
     downloaded_at TEXT NOT NULL,
     data TEXT NOT NULL
   );`,
  // Sprint 1.3: registro de campo y cola de subida.
  `CREATE TABLE IF NOT EXISTS executions (
     client_id TEXT PRIMARY KEY NOT NULL,
     user_id TEXT NOT NULL,
     unit_id TEXT,                 -- unidad programada (id del servidor)
     new_unit_client_id TEXT,      -- unidad creada en campo (registro abierto)
     station_method_id TEXT NOT NULL,
     station_id TEXT NOT NULL,
     method_id TEXT NOT NULL,
     schedule_id TEXT,
     brigade_id TEXT,
     unit_code TEXT NOT NULL,      -- provisional en unidades nuevas hasta sincronizar
     status TEXT NOT NULL,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     start_lat REAL, start_lng REAL, start_accuracy REAL,
     form_data TEXT NOT NULL DEFAULT '{"records":[]}',
     observations TEXT,
     updated_at TEXT NOT NULL,
     synced_at TEXT,
     sync_error TEXT
   );
   CREATE UNIQUE INDEX IF NOT EXISTS executions_unit_idx ON executions (user_id, unit_id) WHERE unit_id IS NOT NULL;
   CREATE TABLE IF NOT EXISTS attachments (
     client_id TEXT PRIMARY KEY NOT NULL,
     execution_client_id TEXT NOT NULL,
     kind TEXT NOT NULL,           -- foto | foto_metodo | audio
     slot_key TEXT,
     mime_type TEXT NOT NULL,
     path TEXT NOT NULL,           -- copia comprimida con sello (o el audio)
     original_path TEXT,           -- foto original
     size_bytes INTEGER, original_size_bytes INTEGER, width INTEGER, height INTEGER, duration_sec INTEGER,
     lat REAL, lng REAL, accuracy REAL, altitude REAL,
     taken_at TEXT NOT NULL,
     replaced INTEGER NOT NULL DEFAULT 0,   -- foto reemplazada por otra del mismo lado
     meta_synced INTEGER NOT NULL DEFAULT 0,
     uploaded INTEGER NOT NULL DEFAULT 0,
     original_uploaded INTEGER NOT NULL DEFAULT 0,
     sync_error TEXT
   );
   CREATE INDEX IF NOT EXISTS attachments_exec_idx ON attachments (execution_client_id);`,
  // Sprint 1.5: alertas, mensajes con coordinación y limpieza de archivos ya enviados.
  `ALTER TABLE attachments ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'execution'; -- execution | incident (execution_client_id = id del dueño)
   ALTER TABLE attachments ADD COLUMN freed INTEGER NOT NULL DEFAULT 0;             -- archivo local liberado (sigue en el servidor)
   CREATE TABLE IF NOT EXISTS incidents (
     client_id TEXT PRIMARY KEY NOT NULL,
     user_id TEXT NOT NULL,
     project_id TEXT,
     brigade_id TEXT,
     station_id TEXT,
     method_id TEXT,
     unit_id TEXT,
     unit_code TEXT,
     schedule_id TEXT,
     type TEXT NOT NULL,
     moment TEXT,
     launched_from TEXT,
     description TEXT NOT NULL,
     proposed_action TEXT,
     unit_not_done INTEGER NOT NULL DEFAULT 0,
     occurred_at TEXT NOT NULL,
     lat REAL, lng REAL,
     updated_at TEXT NOT NULL,
     synced_at TEXT,
     sync_error TEXT,
     remote TEXT,          -- estado y respuesta de coordinación (JSON del servidor)
     seen_at TEXT          -- última vez que el usuario vio la alerta
   );
   CREATE TABLE IF NOT EXISTS incident_messages_out (
     client_id TEXT PRIMARY KEY NOT NULL,
     incident_client_id TEXT NOT NULL,
     body TEXT NOT NULL,
     sent_at TEXT NOT NULL,
     synced INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);`,
  // Sprint 1.6: supervisión (desviación, acción correctiva, solución; alertas de la brigada) y logística.
  `ALTER TABLE incidents ADD COLUMN methodological_deviation TEXT;
   ALTER TABLE incidents ADD COLUMN corrective_action TEXT;
   ALTER TABLE incidents ADD COLUMN resolution_notes TEXT;
   CREATE TABLE IF NOT EXISTS brigade_incidents (   -- alertas de otras personas en brigadas que supervisa
     user_id TEXT NOT NULL,
     client_id TEXT NOT NULL,
     data TEXT NOT NULL,         -- JSON del servidor
     seen_at TEXT,
     PRIMARY KEY (user_id, client_id)
   );
   CREATE TABLE IF NOT EXISTS logistics (
     client_id TEXT PRIMARY KEY NOT NULL,
     user_id TEXT NOT NULL,
     entity TEXT NOT NULL,       -- vehicle | support | expense | sample | equipment
     brigade_id TEXT NOT NULL,
     data TEXT NOT NULL,         -- JSON con los campos del registro
     updated_at TEXT NOT NULL,
     synced_at TEXT,
     sync_error TEXT,
     remote_files INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX IF NOT EXISTS logistics_entity_idx ON logistics (user_id, entity);`,
];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync('toce.db');
    await db.execAsync('PRAGMA journal_mode = WAL;');
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const current = row?.user_version ?? 0;
    for (let v = current; v < MIGRATIONS.length; v++) {
      await db.withTransactionAsync(async () => {
        await db.execAsync(MIGRATIONS[v]!);
        await db.execAsync(`PRAGMA user_version = ${v + 1}`);
      });
    }
    return db;
  })().catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}
