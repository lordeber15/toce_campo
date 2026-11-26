#!/usr/bin/env bash
# Prueba la carga masiva por plantilla (POST /import/template/validate y /commit) contra el API local
# con la plantilla real de docs/plantillas. Importa dos veces (idempotencia), prueba las diferencias con capas KMZ
# y los bloqueos, y al final deja la base como estaba (scripts/sql/smoke-import-cleanup.sql). Se puede repetir.
#   bash scripts/smoke-import.sh [plantilla.xlsx]
set -u
B=${API:-http://localhost:4000/api}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
FILE=${1:-$ROOT/docs/plantillas/EIAd_TOCE_Carga_Masiva_Cierre_QA_Reglas_APP_2026-11-25.xlsx}
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1 ($2)" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
psql() { if [ -n "${USE_DOCKER:-}" ]; then docker exec -i toce-postgres psql -U toce -d "${DB_NAME:-toce}" -tAq ${1:+-c "$1"}; else node "$ROOT/scripts/lib/sql.cjs" "$@"; fi; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"$2\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).accessToken??"")}catch{console.log("")}})'; }
# Evalúa una expresión JS sobre la respuesta (variable o).
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# Cuerpo JSON { fileName, fileBase64, overrides }.
body() { node -e 'const fs=require("fs");fs.writeFileSync(process.argv[2],JSON.stringify({fileName:"plantilla.xlsx",fileBase64:fs.readFileSync(process.argv[1]).toString("base64"),overrides:JSON.parse(process.argv[3]||"[]")}))' "$FILE" "$1" "${2:-[]}"; }
api() { curl -s -X POST "$B$1" -H "authorization: Bearer $ADM" -H 'content-type: application/json' --data-binary "@$2"; }
cleanup() { psql < "$ROOT/scripts/sql/smoke-import-cleanup.sql"; }

[ -f "$FILE" ] || { echo "No se encontró la plantilla: $FILE"; exit 1; }
# Si una corrida anterior se cortó, deshace lo que dejó.
if [ "$(psql "select to_regclass('smoke_import_pre_meta') is not null")" = "t" ]; then echo "Limpiando una corrida anterior..."; cleanup >/dev/null; fi
if [ "$(psql "select count(*) from projects where upper(code) = 'EIAD TOCE'")" != "0" ]; then
  echo "Ya existe el proyecto EIAD TOCE (no lo creó esta prueba): no se ejecuta para no tocarlo"; exit 1
fi
COUNTS="select (select count(*) from projects)||','||(select count(*) from users)||','||(select count(*) from specialties)||','||(select count(*) from specialty_access)||','||(select count(*) from methods)||','||(select count(*) from schedules)||','||(select md5(string_agg(row_to_json(m)::text, '' order by id)) from methods m)"
BEFORE=$(psql "$COUNTS")
# Foto previa para dejar todo como estaba.
psql "CREATE TABLE smoke_import_pre_meta AS SELECT now() AS taken_at;
  CREATE TABLE smoke_import_pre_methods AS SELECT * FROM methods;
  CREATE TABLE smoke_import_pre_specialties AS SELECT id FROM specialties;
  CREATE TABLE smoke_import_pre_access AS SELECT * FROM specialty_access;
  CREATE TABLE smoke_import_pre_users AS SELECT id FROM users;" >/dev/null

ADM=$(token 10000001 Toce2026)
SPEC=$(token 20000001 Toce2026)
body "$TMP/body.json"

echo "Permisos y archivo"
check "validar sin sesión" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/import/template/validate -H 'content-type: application/json' --data-binary @$TMP/body.json)" 401
check "especialista no puede importar" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/import/template/validate -H "authorization: Bearer $SPEC" -H 'content-type: application/json' --data-binary @$TMP/body.json)" 403
echo '{"fileBase64":"bm8gZXMgdW4gZXhjZWwgZGUgdmVyZGFk"}' > "$TMP/bad.json"
check "archivo que no es Excel" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/import/template/validate -H "authorization: Bearer $ADM" -H 'content-type: application/json' --data-binary @$TMP/bad.json)" 400

echo "Validación (no escribe)"
V=$(api /import/template/validate "$TMP/body.json")
check "0 errores" "$(echo "$V" | js 'o.errors.length')" 0
check "resumen" "$(echo "$V" | js 'const s=o.summary;[s.project.new,s.users.new,s.brigades.new,s.members.total,s.stations.new,s.methods.total,s.stationMethods.new,s.schedules.new].join()')" "1,75,9,66,97,33,2258,142"
check "advertencias: 5 nombres en mayúsculas" "$(echo "$V" | js 'o.warnings.filter(w=>w.message.startsWith("Nombre en mayúsculas")).map(w=>w.row).join()')" "13,20,38,48,70"
check "advertencias: códigos con espacios" "$(echo "$V" | js 'o.warnings.filter(w=>w.message.includes("tiene espacios")).length')" 2
check "proyecto nuevo: sin diferencias ni projectId" "$(echo "$V" | js 'o.differences.length+":"+o.projectId')" "0:null"
check "validar no crea nada" "$(psql "select count(*) from projects where upper(code) = 'EIAD TOCE'")" 0

echo "Carga"
C=$(api /import/template/commit "$TMP/body.json")
check "commit ok" "$(echo "$C" | js 'o.ok')" true
P=$(echo "$C" | js 'o.projectId')
q() { psql "$1"; }
check "proyecto (código en mayúsculas, zona 17)" "$(q "select code||':'||utm_zone||':'||start_date||':'||end_date from projects where id='$P'")" "EIAD TOCE:17:2026-12-01:2027-01-31"
check "75 usuarios de la plantilla" "$(q "select count(*) from users where created_at >= (select taken_at from smoke_import_pre_meta)")" 75
check "roles: 66 especialistas, 9 jefes" "$(q "select count(*) filter (where 'especialista'=any(roles))||','||count(*) filter (where 'jefe_brigada'=any(roles)) from users where created_at >= (select taken_at from smoke_import_pre_meta)")" "66,9"
check "9 brigadas con código y región" "$(q "select count(*) from brigades where project_id='$P' and code is not null and region is not null")" 9
check "brigadas Mixta = sin especialidad" "$(q "select count(*) from brigades where project_id='$P' and specialty_id is null")" 9
check "66 integrantes con vigencia" "$(q "select count(*) from brigade_members m join brigades b on b.id=m.brigade_id where b.project_id='$P' and m.valid_from is not null")" 66
check "97 estaciones (37 Huella / 32 AID / 28 AII)" "$(q "select count(*)||':'||count(*) filter (where influence_area='Huella')||'/'||count(*) filter (where influence_area='AID')||'/'||count(*) filter (where influence_area='AII') from stations where project_id='$P'")" "97:37/32/28"
check "2258 métodos por estación con brigada" "$(q "select count(*)||':'||count(sm.brigade_id) from station_methods sm join stations s on s.id=sm.station_id where s.project_id='$P'")" "2258:2258"
UNITS=$(q "select count(*) from sampling_units u join stations s on s.id=u.station_id where s.project_id='$P'")
check "unidades creadas = suma de unidades requeridas" "$UNITS" "$(q "select sum(sm.units_required) from station_methods sm join stations s on s.id=sm.station_id where s.project_id='$P'")"
check "unidades reportadas por la API" "$(echo "$C" | js 'o.unitsCreated')" "$UNITS"
check "métodos EVENTO/ECF sin unidades (abiertos)" "$(q "select count(*) from sampling_units u join methods m on m.id=u.method_id join stations s on s.id=u.station_id where s.project_id='$P' and m.code in ('ROA','ROH','ROM','ECF')")" 0
check "142 actividades (108 estación)" "$(q "select count(*)||':'||count(*) filter (where activity_type='estacion')||':'||count(*) filter (where station_id is null) from schedules where project_id='$P'")" "142:108:34"
check "EM-04 R y sus unidades" "$(q "select code from sampling_units where code like 'EM-04 R-PI%' order by seq limit 1")" "EM-04 R-PI01"
# EM-27: 17 S 717327 E 9109390 N. Debe coincidir con PostGIS (EPSG:32717 -> 4326).
check "coordenadas EM-27 = PostGIS" "$(q "select ST_DWithin(s.geom::geography, ST_Transform(ST_SetSRID(ST_MakePoint(717327, 9109390), 32717), 4326)::geography, 0.01) from stations s where s.project_id='$P' and s.code='EM-27'")" t
check "lat/lng en el Perú" "$(q "select bool_and(ST_Y(geom) between -18.5 and 0.1 and ST_X(geom) between -81.5 and -68.5) from stations where project_id='$P'")" t
check "nombre en mayúsculas normalizado" "$(q "select full_name from users where full_name ilike 'ricardo lenin%'")" "Ricardo Lenin Perez Saavedra Carruitero"
check "especialidades nuevas + accesos" "$(q "select count(*) from specialties where created_at >= (select taken_at from smoke_import_pre_meta)")" 13
check "acceso Mamíferos" "$(q "select string_agg(g.name, ', ' order by g.name) from specialty_access a join specialties s on s.id=a.specialty_id join specialties g on g.id=a.granted_id where s.name='Mamíferos'")" "Fauna transversal, Mamíferos mayores, Mamíferos menores terrestres, Mamíferos menores voladores"
check "auditoría" "$(q "select count(*) from audit_logs where entity_id='$P' and action='template_import'")" 1

echo "Usuarios nuevos"
check "cambio de contraseña obligatorio" "$(q "select must_change_password from users where dni='47178890'")" t
AV=$(token 47178890 47178890)
[ -n "$AV" ] && echo "  OK   login con DNI como contraseña" || { echo "  FAIL login con DNI como contraseña"; FAILS=$((FAILS+1)); }
WP=$(curl -s "$B/work-package?deviceId=smoke-import" -H "authorization: Bearer $AV")
check "paquete: su brigada" "$(echo "$WP" | js 'o.brigades.map(b=>b.code).join()')" "COSTA 1"
check "paquete: solo visitas a estaciones" "$(echo "$WP" | js 'o.schedules.length>0 && o.schedules.every(s=>s.stationId)')" true
check "paquete: Aves ve Aves + Fauna transversal" "$(echo "$WP" | js '[...new Set(o.methods.map(m=>m.specialtyName))].sort().join()')" "Aves,Fauna transversal"
JEFE=$(token 45107669 45107669)
check "paquete: jefe sin especialidad ve todo lo de su brigada" "$(curl -s "$B/work-package?deviceId=smoke-import" -H "authorization: Bearer $JEFE" | js 'new Set(o.methods.map(m=>m.specialtyName)).size>=8')" true
BOT=$(token 71254111 71254111)
check "paquete: perfil botánico" "$(curl -s "$B/work-package?deviceId=smoke-import" -H "authorization: Bearer $BOT" | js 'o.methods.every(m=>["Flora y vegetación","Recursos forestales","Epífitas","Agrostología","Bofedales"].includes(m.specialtyName))')" true
check "cronograma web: actividades con includeActivities" "$(curl -s "$B/projects/$P/schedules?includeActivities=true" -H "authorization: Bearer $ADM" | js 'o.length+":"+o.filter(x=>!x.stationId).length')" "142:34"
check "cronograma web: por defecto solo estaciones" "$(curl -s "$B/projects/$P/schedules" -H "authorization: Bearer $ADM" | js 'o.length')" 108

echo "Segunda carga (idempotente)"
C2=$(api /import/template/commit "$TMP/body.json")
check "commit ok" "$(echo "$C2" | js 'o.ok+":"+o.unitsCreated+":"+o.schedulesRemoved')" "true:0:0"
check "todo se actualiza, nada nuevo" "$(echo "$C2" | js 'Object.values(o.summary).map(c=>c.new).reduce((a,b)=>a+b,0)')" 0
check "mismos conteos" "$(q "select (select count(*) from users)||','||(select count(*) from brigades where project_id='$P')||','||(select count(*) from stations where project_id='$P')||','||(select count(*) from station_methods sm join stations s on s.id=sm.station_id where s.project_id='$P')||','||(select count(*) from sampling_units u join stations s on s.id=u.station_id where s.project_id='$P')||','||(select count(*) from schedules where project_id='$P')||','||(select count(*) from specialties)||','||(select count(*) from methods)")" "$(q "select (select count(*) from users)||','||9||','||97||','||2258||','||$UNITS||','||142||','||(select count(*) from specialties)||','||(select count(*) from methods)")"
check "contraseña de usuario existente no cambia" "$( [ -n "$(token 47178890 47178890)" ] && echo si)" si

echo "Diferencias con capas KMZ y bloqueos"
# Capa AID que contiene EM-27 (AII en la plantilla) y BL-01; UV que contiene BL-01 con otro nombre.
q "INSERT INTO project_layers (project_id, kind, name, geom) SELECT '$P', 'aid', 'AID prueba', ST_Buffer(ST_Collect(geom)::geography, 300)::geometry FROM stations WHERE project_id='$P' AND code IN ('EM-27','BL-01');
   INSERT INTO project_layers (project_id, kind, name, code, geom) SELECT '$P', 'uv', 'Cardonal prueba', 'UV-X', ST_Buffer(geom::geography, 300)::geometry FROM stations WHERE project_id='$P' AND code = 'BL-01'" >/dev/null
V2=$(api /import/template/validate "$TMP/body.json")
check "proyecto existente" "$(echo "$V2" | js 'o.projectId')" "$P"
check "diferencia EM-27: AII declarado, AID calculado" "$(echo "$V2" | js 'const d=o.differences.find(d=>d.stationCode==="EM-27"&&d.field==="influenceArea");d.declared+">"+d.computed')" "AII>AID"
check "diferencia de UV en BL-01" "$(echo "$V2" | js 'const d=o.differences.find(d=>d.stationCode==="BL-01"&&d.field==="vegetationUnit");d.computed')" "Cardonal prueba (UV-X)"
check "estaciones fuera de AID: calculado fuera" "$(echo "$V2" | js 'o.differences.find(d=>d.stationCode==="EM-31"&&d.field==="influenceArea").computed')" fuera
OV='[{"stationCode":"EM-27","field":"influenceArea","choice":"computed"},{"stationCode":"BL-01","field":"vegetationUnit","choice":"custom","value":"Cardonal corregido"}]'
body "$TMP/body2.json" "$OV"
C3=$(api /import/template/commit "$TMP/body2.json")
check "commit con correcciones" "$(echo "$C3" | js 'o.ok')" true
st() { q "select influence_area||'|'||influence_locked||'|'||coalesce(vegetation_unit,'-')||'|'||vegetation_locked from stations where project_id='$P' and code='$1'"; }
check "EM-27: se aceptó lo calculado (sin bloqueo)" "$(st EM-27 | cut -d'|' -f1,2)" "AID|false"
check "BL-01: UV propia, bloqueada" "$(st BL-01 | cut -d'|' -f3,4)" "Cardonal corregido|true"
check "EM-31: sin elección manda la plantilla (bloqueado)" "$(st EM-31 | cut -d'|' -f1,2)" "AII|true"
# Reclasificar con las capas (PATCH de la estación) no pisa lo bloqueado.
ID31=$(q "select id from stations where project_id='$P' and code='EM-31'")
IDBL=$(q "select id from stations where project_id='$P' and code='BL-01'")
curl -s -o /dev/null -X PATCH $B/stations/$ID31 -H "authorization: Bearer $ADM" -H 'content-type: application/json' -d '{"name":null}'
curl -s -o /dev/null -X PATCH $B/stations/$IDBL -H "authorization: Bearer $ADM" -H 'content-type: application/json' -d '{"name":null}'
check "reclasificación respeta bloqueo de área (EM-31)" "$(st EM-31 | cut -d'|' -f1)" AII
check "reclasificación respeta bloqueo de UV (BL-01)" "$(st BL-01 | cut -d'|' -f3)" "Cardonal corregido"
check "Huella tiene prioridad sobre AID" "$(q "INSERT INTO project_layers (project_id, kind, name, geom) SELECT '$P', 'huella', 'Huella prueba', ST_Buffer(geom::geography, 50)::geometry FROM stations WHERE project_id='$P' AND code='EM-27';
  SELECT 1" >/dev/null; curl -s -o /dev/null -X PATCH $B/stations/$(q "select id from stations where project_id='$P' and code='EM-27'") -H "authorization: Bearer $ADM" -H 'content-type: application/json' -d '{"name":null}'; st EM-27 | cut -d'|' -f1)" Huella
check "override con área no válida" "$(body "$TMP/body3.json" '[{"stationCode":"EM-27","field":"influenceArea","choice":"custom","value":"XYZ"}]'; curl -s -o /dev/null -w '%{http_code}' -X POST $B/import/template/commit -H "authorization: Bearer $ADM" -H 'content-type: application/json' --data-binary @$TMP/body3.json)" 400

echo "Especialidades (accesos)"
MAM=$(q "select id from specialties where name='Mamíferos'")
AVE=$(q "select id from specialties where name='Aves'")
check "GET /specialties trae grantIds" "$(curl -s $B/specialties -H "authorization: Bearer $ADM" | js "o.find(s=>s.id==='$MAM').grantIds.length")" 4
check "PATCH /specialties/:id cambia accesos" "$(curl -s -X PATCH $B/specialties/$MAM -H "authorization: Bearer $ADM" -H 'content-type: application/json' -d "{\"grantIds\":[\"$AVE\"]}" | js 'o.grantIds.length')" 1
check "especialista no puede editar accesos" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $B/specialties/$MAM -H "authorization: Bearer $SPEC" -H 'content-type: application/json' -d '{"grantIds":[]}')" 403

echo "Limpieza"
cleanup >/dev/null
check "base como estaba" "$(psql "$COUNTS")" "$BEFORE"
echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas de carga masiva pasaron" || { echo "$FAILS prueba(s) fallaron"; exit 1; }
