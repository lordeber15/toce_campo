CREATE INDEX "project_layers_brigade_idx" ON "project_layers" USING btree ("brigade_id");--> statement-breakpoint
-- El polígono de la brigada ahora se deriva de sus capas KMZ (Mapa y capas). Las brigadas que tenían un
-- polígono cargado desde la página Brigadas y ninguna capa propia lo conservan como capa de la brigada.
INSERT INTO "project_layers" ("project_id", "kind", "name", "geom", "properties", "source_file", "source_title", "folder_path", "sort_order", "brigade_id")
SELECT b."project_id", 'otro', coalesce(b."area_name", 'Área de trabajo ' || b."name"), b."area_geom", '{}'::jsonb,
  'Área de trabajo ' || b."name" || coalesce(' - ' || b."area_source_file", ''),
  coalesce(b."area_name", 'Área de trabajo ' || b."name"), '{}'::text[], 0, b."id"
FROM "brigades" b
WHERE b."area_geom" IS NOT NULL AND NOT ST_IsEmpty(b."area_geom")
  AND NOT EXISTS (SELECT 1 FROM "project_layers" l WHERE l."brigade_id" = b."id");
--> statement-breakpoint
-- Recalcula el polígono derivado de las brigadas que ya tenían capas KMZ propias.
UPDATE "brigades" b SET
  "area_geom" = s.geom, "area_name" = s.name, "area_source_file" = s.files, "updated_at" = now()
FROM (
  SELECT t.id,
    CASE WHEN u.geom IS NULL OR ST_IsEmpty(u.geom) THEN NULL ELSE u.geom END AS geom,
    CASE WHEN u.geom IS NULL OR ST_IsEmpty(u.geom) THEN NULL ELSE u.name END AS name,
    CASE WHEN u.geom IS NULL OR ST_IsEmpty(u.geom) THEN NULL ELSE u.files END AS files
  FROM "brigades" t
  LEFT JOIN (
    SELECT l."brigade_id",
      ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(ST_CollectionExtract(ST_SimplifyPreserveTopology(l."geom", 0.00002), 3))), 3)) AS geom,
      nullif(string_agg(DISTINCT coalesce(l."source_title", regexp_replace(coalesce(l."source_file", ''), '[.]km[lz]$', '', 'i')), ', '), '') AS name,
      string_agg(DISTINCT l."source_file", ', ') AS files
    FROM "project_layers" l WHERE l."brigade_id" IS NOT NULL AND ST_Dimension(l."geom") = 2
    GROUP BY l."brigade_id"
  ) u ON u."brigade_id" = t.id
  WHERE EXISTS (SELECT 1 FROM "project_layers" l WHERE l."brigade_id" = t.id)
) s
WHERE b.id = s.id;--> statement-breakpoint
-- Fotos de ejecuciones y alertas de esas brigadas: dentro / fuera del polígono recalculado.
UPDATE "attachments" a SET "outside_area" = (
  SELECT CASE WHEN b."area_geom" IS NULL OR a."geom" IS NULL THEN NULL ELSE NOT ST_Intersects(b."area_geom", a."geom") END
  FROM "brigades" b WHERE b.id = CASE a."owner_type"
    WHEN 'execution' THEN (SELECT e."brigade_id" FROM "executions" e WHERE e.id = a."owner_id")
    WHEN 'incident' THEN (SELECT i."brigade_id" FROM "incidents" i WHERE i.id = a."owner_id")
  END)
WHERE a."kind" IN ('foto', 'foto_metodo') AND a."owner_type" IN ('execution', 'incident');
