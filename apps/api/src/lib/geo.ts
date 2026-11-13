import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

type Exec = Pick<typeof db, 'execute'>;

/**
 * Recalcula los atributos espaciales de las estaciones a partir de las capas del proyecto:
 * - influence_area: AID si cae dentro de una capa AID; AII si cae en AII; "fuera" si hay capas y no cae en ninguna.
 * - vegetation_unit / vegetation_layer_id: la capa UV que la contiene.
 * - overlap: nombres de las capas de superposición que la contienen ("Sin superposición" si no hay).
 * Solo toca un atributo si el proyecto tiene capas de ese tipo (si no, se respeta lo ingresado a mano).
 */
export async function classifyStations(exec: Exec, projectId: string, stationId?: string) {
  const only = stationId ? sql`AND s.id = ${stationId}` : sql``;
  await exec.execute(sql`
    WITH kinds AS (
      SELECT
        bool_or(kind IN ('aid','aii')) AS has_area,
        bool_or(kind = 'uv') AS has_uv,
        bool_or(kind = 'superposicion') AS has_overlap
      FROM project_layers WHERE project_id = ${projectId}
    ),
    calc AS (
      SELECT s.id,
        CASE
          WHEN EXISTS (SELECT 1 FROM project_layers l WHERE l.project_id = s.project_id AND l.kind = 'aid' AND ST_Intersects(l.geom, s.geom)) THEN 'AID'
          WHEN EXISTS (SELECT 1 FROM project_layers l WHERE l.project_id = s.project_id AND l.kind = 'aii' AND ST_Intersects(l.geom, s.geom)) THEN 'AII'
          ELSE 'fuera'
        END AS area,
        (SELECT l.id FROM project_layers l WHERE l.project_id = s.project_id AND l.kind = 'uv' AND ST_Intersects(l.geom, s.geom) ORDER BY ST_Area(l.geom) LIMIT 1) AS uv_id,
        (SELECT string_agg(l.name, ', ' ORDER BY l.name) FROM project_layers l WHERE l.project_id = s.project_id AND l.kind = 'superposicion' AND ST_Intersects(l.geom, s.geom)) AS overlaps
      FROM stations s WHERE s.project_id = ${projectId} AND s.deleted_at IS NULL ${only}
    )
    UPDATE stations s SET
      influence_area = CASE WHEN k.has_area THEN c.area ELSE s.influence_area END,
      vegetation_layer_id = CASE WHEN k.has_uv THEN c.uv_id ELSE s.vegetation_layer_id END,
      vegetation_unit = CASE WHEN k.has_uv THEN (SELECT coalesce(l.name || coalesce(' (' || l.code || ')', ''), 'Sin unidad de vegetación') FROM (SELECT 1) x LEFT JOIN project_layers l ON l.id = c.uv_id) ELSE s.vegetation_unit END,
      overlap = CASE WHEN k.has_overlap THEN coalesce(c.overlaps, 'Sin superposición') ELSE s.overlap END,
      updated_at = now()
    FROM calc c, kinds k
    WHERE s.id = c.id
  `);
}
