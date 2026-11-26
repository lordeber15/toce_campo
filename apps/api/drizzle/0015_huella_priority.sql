-- Prioridad espacial Huella > AID > AII (classifyStations): reclasifica las estaciones ya clasificadas con capas
-- que caen dentro de la huella del proyecto. Solo en proyectos con capas AID/AII y sin bloqueo manual.
UPDATE stations s SET influence_area = 'Huella', updated_at = now()
WHERE s.deleted_at IS NULL
  AND NOT s.influence_locked
  AND s.influence_area IS DISTINCT FROM 'Huella'
  AND EXISTS (SELECT 1 FROM project_layers l WHERE l.project_id = s.project_id AND l.kind IN ('aid', 'aii'))
  AND EXISTS (SELECT 1 FROM project_layers l WHERE l.project_id = s.project_id AND l.kind = 'huella' AND ST_Intersects(l.geom, s.geom));
