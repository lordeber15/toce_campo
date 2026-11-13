#!/usr/bin/env bash
# Prueba las consultas (Sprint 2.2): lista de registros de campo con filtros, búsqueda, detalle con
# formulario y archivos, y permisos. Solo lee; necesita al menos un registro sincronizado desde el teléfono.
set -u
B=${API:-http://localhost:4000/api}
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"Toce2026\"}" | js 'p.accessToken'; }
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
psql() { docker exec toce-postgres psql -U toce -d toce -tAc "$1"; }

COO=$(token 10000001); JP=$(token 10000002); ANA=$(token 20000001)
PROJ=$(psql "select id from projects where deleted_at is null order by created_at limit 1")
L=$(curl -s "$B/projects/$PROJ/records" -H "authorization: Bearer $COO")
[ "$(echo "$L" | js 'p.total')" -gt 0 ] 2>/dev/null || { echo "No hay registros de campo: sincroniza al menos una unidad desde el teléfono"; exit 1; }

echo "Consultas"
check "total coincide con la base" "$(echo "$L" | js 'p.total')" "$(psql "select count(*) from executions e join stations s on s.id=e.station_id where s.project_id='$PROJ' and s.deleted_at is null")"
check "orden: más reciente primero" "$(echo "$L" | js 'p.rows.every((r,i,a)=>!i||a[i-1].startedAt>=r.startedAt)')" true
check "fechas en ISO" "$(echo "$L" | js 'p.rows.every(r=>/^\d{4}-\d\d-\d\dT.*Z$/.test(r.startedAt))')" true

R=$(echo "$L" | js 'JSON.stringify(p.rows[0])')
ST=$(echo "$R" | js 'p.stationId'); ID=$(echo "$R" | js 'p.id')
check "filtro por estación" "$(curl -s "$B/projects/$PROJ/records?stationId=$ST" -H "authorization: Bearer $COO" | js "p.rows.every(r=>r.stationId==='$ST') && p.total>0")" true
DAY=$(echo "$R" | js 'new Date(p.startedAt).toLocaleDateString("en-CA",{timeZone:"America/Lima"})')
check "filtro por fecha (día de Lima)" "$(curl -s "$B/projects/$PROJ/records?from=$DAY&to=$DAY" -H "authorization: Bearer $COO" | js "p.rows.some(r=>r.id==='$ID')")" true
check "fecha fuera de rango: vacío" "$(curl -s "$B/projects/$PROJ/records?to=2000-01-01" -H "authorization: Bearer $COO" | js 'p.total')" 0
CODE=$(echo "$R" | js 'p.unitCode')
check "búsqueda por código de unidad" "$(curl -s "$B/projects/$PROJ/records?q=$CODE" -H "authorization: Bearer $COO" | js "p.rows.some(r=>r.id==='$ID')")" true
check "comodín % no coincide con todo" "$(curl -s "$B/projects/$PROJ/records?q=%25" -H "authorization: Bearer $COO" | js 'p.total')" 0
check "filtros solo con valores usados" "$(curl -s "$B/projects/$PROJ/records/filters" -H "authorization: Bearer $COO" | js "p.stations.some(s=>s.id==='$ST') && p.methods.length>0")" true

WITH=$(echo "$L" | js 'p.rows.find(r=>r.records>0)?.id ?? ""')
if [ -n "$WITH" ]; then
  D=$(curl -s "$B/records/$WITH" -H "authorization: Bearer $JP")
  check "detalle: registros y campos del formulario" "$(echo "$D" | js 'p.formRecords.length===p.records && p.formSchema.fields.length>0')" true
  SP=$(echo "$D" | js 'p.formRecords.map(r=>r.values.especie).find(Boolean) ?? ""')
  [ -n "$SP" ] && check "búsqueda por especie anotada" "$(curl -s "$B/projects/$PROJ/records" -G --data-urlencode "q=$SP" -H "authorization: Bearer $COO" | js "p.rows.some(r=>r.id==='$WITH')")" true
fi
WF=$(echo "$L" | js 'p.rows.find(r=>r.photos>0)?.id ?? ""')
if [ -n "$WF" ]; then
  D=$(curl -s "$B/records/$WF" -H "authorization: Bearer $JP")
  check "detalle: fotos y audios" "$(echo "$D" | js 'p.attachments.filter(a=>a.kind.startsWith("foto")).length')" "$(echo "$L" | js "p.rows.find(r=>r.id==='$WF').photos")"
  A=$(echo "$D" | js 'p.attachments.find(a=>a.uploadStatus==="subido")?.id ?? ""')
  [ -n "$A" ] && check "foto descargable (jefe de proyecto)" "$(curl -s -o /dev/null -w '%{http_code}' "$(curl -s "$B/field/attachments/$A/url" -H "authorization: Bearer $JP" | js 'p.url')")" 200
fi
check "registro inexistente: 404" "$(curl -s -o /dev/null -w '%{http_code}' "$B/records/00000000-0000-0000-0000-000000000000" -H "authorization: Bearer $COO")" 404
check "especialista no consulta: 403" "$(curl -s -o /dev/null -w '%{http_code}' "$B/projects/$PROJ/records" -H "authorization: Bearer $ANA")" 403

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas de consultas pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
