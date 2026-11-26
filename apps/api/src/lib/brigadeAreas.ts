import { sql } from 'drizzle-orm';
import type { db } from '../db/index.js';
import { reclassifyBrigadePhotos } from './geo.js';

type Exec = Pick<typeof db, 'execute'>;

/**
 * Polígono de trabajo de cada brigada, derivado de sus capas KMZ ("Mapa y capas", project_layers.brigade_id):
 * unión de los polígonos (simplificados a ~2 m, como en el teléfono). Sin polígonos propios queda en NULL
 * y sus fotos no se verifican. Recalcula también si cada foto de esas brigadas quedó dentro o fuera.
 * Se llama después de importar, reasignar o borrar capas, con las brigadas afectadas (antes y después).
 */
export async function syncBrigadeAreas(exec: Exec, brigadeIds: (string | null | undefined)[]) {
  const ids = [...new Set(brigadeIds.filter((i): i is string => !!i))];
  if (!ids.length) return;
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  await exec.execute(sql`
    UPDATE brigades b SET area_geom = s.geom, area_name = s.name, area_source_file = s.files, updated_at = now()
    FROM (
      SELECT t.id,
        CASE WHEN u.geom IS NULL OR ST_IsEmpty(u.geom) THEN NULL ELSE u.geom END AS geom,
        CASE WHEN u.geom IS NULL OR ST_IsEmpty(u.geom) THEN NULL ELSE coalesce(u.name, t.name) END AS name,
        CASE WHEN u.geom IS NULL OR ST_IsEmpty(u.geom) THEN NULL ELSE u.files END AS files
      FROM brigades t
      LEFT JOIN (
        SELECT l.brigade_id,
          -- Simplificar puede dejar anillos inválidos (huecos fuera de su contorno): se reparan antes de unir,
          -- y la unión usa una grilla de ~1 cm para que GEOS no falle con topologías de KMZ reales.
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_UnaryUnion(ST_Collect(
            ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(l.geom, 0.00002)), 3)), 0.0000001)), 3)) AS geom,
          nullif(string_agg(DISTINCT coalesce(l.source_title, regexp_replace(coalesce(l.source_file, ''), '[.]km[lz]$', '', 'i')), ', '), '') AS name,
          string_agg(DISTINCT l.source_file, ', ') AS files
        FROM project_layers l
        WHERE l.brigade_id IN (${list}) AND ST_Dimension(l.geom) = 2
        GROUP BY l.brigade_id
      ) u ON u.brigade_id = t.id
      WHERE t.id IN (${list})
    ) s
    WHERE b.id = s.id`);
  for (const id of ids) await reclassifyBrigadePhotos(exec, id);
}

/** Brigadas de las capas que cumplen `where` (para recalcular su polígono después de cambiarlas). */
export async function layerBrigades(exec: Exec, where: ReturnType<typeof sql>): Promise<string[]> {
  const rows = await exec.execute(sql`SELECT DISTINCT brigade_id AS id FROM project_layers WHERE brigade_id IS NOT NULL AND ${where}`);
  return (rows.rows as { id: string }[]).map((r) => r.id);
}
