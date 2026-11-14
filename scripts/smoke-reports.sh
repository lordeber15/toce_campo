#!/usr/bin/env bash
# Prueba los reportes (Sprint 2.3): reporte diario, Excel diario y consolidado, exportación de registros,
# ZIP de evidencias y tickets de descarga. Carga el avance de ejemplo y al final deja la base como estaba.
set -u
B=${API:-http://localhost:4000/api}
DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"Toce2026\"}" | js 'p.accessToken'; }
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
psql() { docker exec toce-postgres psql -U toce -d toce -tAc "$1"; }
# Hojas de un Excel: "Hoja:filas|Hoja:filas"
sheets() { (cd "$DIR/../apps/api" && node --input-type=module -e "
  import ExcelJS from 'exceljs'; const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile('$1');
  console.log(wb.worksheets.map((w) => w.name + ':' + w.rowCount).join('|'));"); }

"$DIR/demo-avance.sh" >/dev/null || { echo "No se pudo cargar el avance de ejemplo"; exit 1; }
trap '"$DIR/demo-avance.sh" --limpiar >/dev/null; rm -rf "$TMP"' EXIT

COO=$(token 10000001); JP=$(token 10000002); ANA=$(token 20000001)
PROJ=$(psql "select id from projects where deleted_at is null order by created_at limit 1")
TODAY=$(TZ=America/Lima date +%Y-%m-%d)
get() { curl -s -o "$TMP/$2" -w '%{http_code} %{content_type}' "$B$1" -H "authorization: Bearer $COO"; }

echo "Reporte diario"
D=$(curl -s "$B/projects/$PROJ/reports/daily?date=$TODAY" -H "authorization: Bearer $JP")
check "unidades del día coinciden con la base" "$(echo "$D" | js 'p.units.length')" "$(psql "select count(*) from executions e join stations s on s.id=e.station_id
  where s.project_id='$PROJ' and s.deleted_at is null and (e.started_at at time zone 'America/Lima')::date = '$TODAY'")"
check "estaciones programadas del día" "$(echo "$D" | js 'p.stations.length')" "$(psql "select count(*) from schedules sc join stations s on s.id=sc.station_id and s.deleted_at is null
  where sc.project_id='$PROJ' and sc.planned_date='$TODAY' and sc.status<>'cancelada'")"
check "pendientes: fecha cumplida y unidades sin cerrar" "$(echo "$D" | js "p.pending.every(x=>x.firstDate<='$TODAY' && x.pendingUnits>0)")" true
check "avance acumulado incluido" "$(echo "$D" | js 'p.brigades.length===p.metrics.brigades && p.metrics.unitsRequired>0')" true
YDAY=$(TZ=America/Lima date -v-1d +%Y-%m-%d)
check "día anterior: incidencias de ese día" "$(curl -s "$B/projects/$PROJ/reports/daily?date=$YDAY" -H "authorization: Bearer $COO" | js "p.incidents.every(i=>new Date(i.occurredAt).toLocaleDateString('en-CA',{timeZone:'America/Lima'})==='$YDAY')")" true

echo "Excel"
check "diario: descarga xlsx" "$(get "/projects/$PROJ/reports/daily.xlsx?date=$TODAY" daily.xlsx)" "200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
check "diario: hojas" "$(sheets "$TMP/daily.xlsx" | sed -E 's/:[0-9]+//g')" "Resumen|Brigadas|Estaciones del día|Unidades|Incidencias|Reprogramaciones|Pendientes"
check "diario: una fila por unidad del día" "$(sheets "$TMP/daily.xlsx" | tr '|' '\n' | grep '^Unidades:' | cut -d: -f2)" "$(( $(echo "$D" | js 'p.units.length') + 1 ))"
check "consolidado: descarga xlsx" "$(get "/projects/$PROJ/reports/consolidated.xlsx?date=$TODAY" cons.xlsx | cut -d' ' -f1)" 200
S=$(sheets "$TMP/cons.xlsx")
check "consolidado: hojas" "$(echo "$S" | sed -E 's/:[0-9]+//g')" "Resumen|Por brigada|Por estación|Desviaciones|Alertas|Reprogramaciones|Sincronización"
T=$(curl -s "$B/projects/$PROJ/tracking?date=$TODAY" -H "authorization: Bearer $COO")
check "consolidado: una fila por brigada" "$(echo "$S" | tr '|' '\n' | grep '^Por brigada:' | cut -d: -f2)" "$(( $(echo "$T" | js 'p.brigades.length') + 1 ))"
check "consolidado: desviaciones = fuera de fecha + reprogramadas" "$(echo "$S" | tr '|' '\n' | grep '^Desviaciones:' | cut -d: -f2)" "$(( $(echo "$T" | js 'p.metrics.offDateUnits + p.metrics.rescheduledUnits') + 3 ))"
check "consolidado: alertas del proyecto" "$(echo "$S" | tr '|' '\n' | grep '^Alertas:' | cut -d: -f2)" "$(( $(psql "select count(*) from incidents where project_id='$PROJ'") + 1 ))"

echo "Registros y evidencias"
check "registros: descarga xlsx" "$(get "/projects/$PROJ/records.xlsx" rec.xlsx | cut -d' ' -f1)" 200
NREC=$(curl -s "$B/projects/$PROJ/records" -H "authorization: Bearer $COO" | js 'p.total')
check "registros: una fila por unidad" "$(sheets "$TMP/rec.xlsx" | tr '|' '\n' | grep '^Unidades:' | cut -d: -f2)" "$((NREC + 3))"
check "registros: filtro sin resultados" "$(get "/projects/$PROJ/records.xlsx?to=2000-01-01" empty.xlsx | cut -d' ' -f1):$(sheets "$TMP/empty.xlsx")" "200:Unidades:3"
C=$(curl -s "$B/projects/$PROJ/evidence/count" -H "authorization: Bearer $COO")
READY=$(echo "$C" | js 'p.ready')
if [ "$READY" -gt 0 ]; then
  check "evidencias: descarga zip" "$(get "/projects/$PROJ/evidence.zip" ev.zip)" "200 application/zip"
  check "evidencias: archivos + LEEME" "$(unzip -Z1 "$TMP/ev.zip" | wc -l | tr -d ' ')" "$((READY + 1))"
  check "evidencias: carpetas proyecto/brigada/especialista/estación/método/unidad/tipo" "$(unzip -Z1 "$TMP/ev.zip" | grep -v LEEME | awk -F/ 'NF!=8' | wc -l | tr -d ' ')" 0
else
  echo "  --   sin fotos subidas: se omite el ZIP"
fi
check "evidencias: sin resultados → 400" "$(curl -s -o /dev/null -w '%{http_code}' "$B/projects/$PROJ/evidence.zip?to=2000-01-01" -H "authorization: Bearer $COO")" 400

echo "Tickets y permisos"
P1="/projects/$PROJ/reports/consolidated.xlsx"
TK=$(curl -s -X POST $B/download-ticket -H "authorization: Bearer $JP" -H 'content-type: application/json' -d "{\"path\":\"$P1\"}" | js 'p.ticket')
check "ticket abre su descarga sin cabecera" "$(curl -s -o /dev/null -w '%{http_code}' "$B$P1?ticket=$TK")" 200
check "ticket no sirve para otra ruta" "$(curl -s -o /dev/null -w '%{http_code}' "$B/projects/$PROJ/records.xlsx?ticket=$TK")" 401
check "ticket no sirve como sesión" "$(curl -s -o /dev/null -w '%{http_code}' "$B/projects/$PROJ/reports/daily" -H "authorization: Bearer $TK")" 401
check "descarga sin sesión ni ticket: 401" "$(curl -s -o /dev/null -w '%{http_code}' "$B$P1")" 401
check "especialista no ve reportes: 403" "$(curl -s -o /dev/null -w '%{http_code}' "$B/projects/$PROJ/reports/daily" -H "authorization: Bearer $ANA")" 403
check "especialista no pide tickets: 403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/download-ticket -H "authorization: Bearer $ANA" -H 'content-type: application/json' -d "{\"path\":\"$P1\"}")" 403

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas de reportes pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
