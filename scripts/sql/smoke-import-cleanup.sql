-- Deshace la carga de la plantilla de prueba (scripts/smoke-import.sh) usando la foto previa (tablas smoke_import_pre_*).
-- Borra el proyecto importado (en cascada: brigadas, estaciones, métodos por estación, unidades, cronograma),
-- los usuarios, métodos y especialidades creados después de la foto, y restaura los métodos y accesos que existían.
BEGIN;
CREATE TEMP TABLE imp_users ON COMMIT DROP AS
  SELECT id FROM users WHERE id NOT IN (SELECT id FROM smoke_import_pre_users)
    AND created_at >= (SELECT taken_at FROM smoke_import_pre_meta);
CREATE TEMP TABLE imp_projects ON COMMIT DROP AS SELECT id FROM projects WHERE upper(code) = 'EIAD TOCE';

DELETE FROM work_package_downloads WHERE project_id IN (SELECT id FROM imp_projects) OR user_id IN (SELECT id FROM imp_users);
DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM imp_users) OR entity_id IN (SELECT id FROM imp_projects);
DELETE FROM projects WHERE id IN (SELECT id FROM imp_projects);
DELETE FROM users WHERE id IN (SELECT id FROM imp_users);

DELETE FROM methods WHERE id NOT IN (SELECT id FROM smoke_import_pre_methods);
UPDATE methods m SET
  name = p.name, description = p.description, instructions = p.instructions, is_open_ended = p.is_open_ended,
  default_units_required = p.default_units_required, method_class = p.method_class, requires_track = p.requires_track,
  photos_per_unit = p.photos_per_unit, schedule_start = p.schedule_start, schedule_end = p.schedule_end,
  schedule_text = p.schedule_text, guideline = p.guideline, min_duration_min = p.min_duration_min, requirements = p.requirements,
  photo_slots = p.photo_slots, method_photo_required = p.method_photo_required, method_photo_instructions = p.method_photo_instructions,
  form_schema = p.form_schema, sort_order = p.sort_order, is_active = p.is_active, updated_at = p.updated_at
FROM smoke_import_pre_methods p WHERE p.id = m.id;

DELETE FROM specialty_access a WHERE NOT EXISTS (
  SELECT 1 FROM smoke_import_pre_access p WHERE p.specialty_id = a.specialty_id AND p.granted_id = a.granted_id);
DELETE FROM specialties WHERE id NOT IN (SELECT id FROM smoke_import_pre_specialties)
  AND created_at >= (SELECT taken_at FROM smoke_import_pre_meta);

DROP TABLE smoke_import_pre_methods, smoke_import_pre_specialties, smoke_import_pre_access, smoke_import_pre_users, smoke_import_pre_meta;
COMMIT;
SELECT (SELECT count(*) FROM projects WHERE upper(code) = 'EIAD TOCE') || ' proyectos de prueba, ' || (SELECT count(*) FROM methods) || ' métodos, '
  || (SELECT count(*) FROM specialties) || ' especialidades, ' || (SELECT count(*) FROM specialty_access) || ' accesos';
