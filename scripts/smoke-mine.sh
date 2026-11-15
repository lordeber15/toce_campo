#!/usr/bin/env bash
# Prueba "Mis registros" (web para el personal de campo) y el tablero del jefe de brigada:
# cada uno ve solo lo suyo, el jefe ve su brigada, descargas Excel/ZIP con ticket y permisos. Solo lee.
set -u
B=${API:-http://localhost:4000/api}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"Toce2026\"}" | js 'p.accessToken'; }
psql() { if [ -n "${USE_DOCKER:-}" ]; then docker exec toce-postgres psql -U toce -d toce -tAc "$1"; else node "$ROOT/scripts/lib/sql.cjs" "$1"; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
get() { curl -s "$B$1" -H "authorization: Bearer $2"; }
ticket() { curl -s -X POST "$B/download-ticket" -H "authorization: Bearer $2" -H 'content-type: application/json' -d "{\"path\":\"$1\"}" | js 'p.ticket'; }
trap 'rm -rf "$TMP"' EXIT

ANA=$(token 20000001); AND=$(token 20000002); OTRO=$(token 20000003); COO=$(token 10000001)
ANA_ID=$(psql "select id from users where dni='20000001'")
BRIG=$(psql "select id from brigades where leader_id='$ANA_ID' and is_active limit 1")
PROJ=$(psql "select project_id from brigades where id='$BRIG'")
[ -n "$BRIG" ] || { echo "20000001 no es jefe de ninguna brigada (correr pnpm db:seed)"; exit 1; }

echo "Resumen"
O=$(get /me/overview "$ANA")
check "proyectos donde participa" "$(echo "$O" | js "p.projects.some(x=>x.id==='$PROJ')")" true
check "el jefe ve su brigada" "$(echo "$O" | js "p.ledBrigades.map(b=>b.id).join()")" "$BRIG"
check "un integrante no dirige brigadas" "$(get /me/overview "$AND" | js 'p.ledBrigades.length')" 0

echo "Jornadas"
MINE=$(psql "select count(*) from executions e join stations s on s.id=e.station_id where s.project_id='$PROJ' and e.specialist_id='$ANA_ID'")
ALL=$(psql "select count(*) from executions e join stations s on s.id=e.station_id where s.project_id='$PROJ' and e.brigade_id='$BRIG'")
J=$(get "/me/journal?projectId=$PROJ" "$ANA")
check "lo propio: todas sus unidades" "$(echo "$J" | js 'p.totals.units')" "$MINE"
check "ordenado día → estación → método → unidad" "$(echo "$J" | js 'p.days.every(d=>d.stations.every(s=>s.methods.every(m=>m.units.length>0)))')" true
check "solo sus registros" "$(echo "$J" | js "p.days.flatMap(d=>d.stations.flatMap(s=>s.methods.flatMap(m=>m.units))).every(u=>u.specialistName.startsWith('Ana'))")" true
check "el jefe ve toda su brigada" "$(get "/me/journal?projectId=$PROJ&brigadeId=$BRIG" "$ANA" | js 'p.totals.units')" "$ALL"
check "un integrante no ve la brigada: 403" "$(code "$B/me/journal?projectId=$PROJ&brigadeId=$BRIG" -H "authorization: Bearer $AND")" 403
check "jefe de otra brigada: 403" "$(code "$B/me/journal?projectId=$PROJ&brigadeId=$BRIG" -H "authorization: Bearer $OTRO")" 403
check "coordinación sí puede pedirla" "$(code "$B/me/journal?projectId=$PROJ&brigadeId=$BRIG" -H "authorization: Bearer $COO")" 200
check "rango de fechas" "$(get "/me/journal?projectId=$PROJ&from=2000-01-01&to=2000-01-02" "$ANA" | js 'p.totals.units')" 0

echo "Ficha y archivos"
REC=$(echo "$J" | js 'p.days[0]?.stations[0]?.methods[0]?.units[0]?.id ?? ""')
if [ -n "$REC" ]; then
  check "su ficha" "$(get "/me/records/$REC" "$ANA" | js 'p.unitCode.length>0 && Array.isArray(p.formRecords)')" true
  check "otra persona no la ve: 403" "$(code "$B/me/records/$REC" -H "authorization: Bearer $AND")" 403
  FILE=$(psql "select id from attachments where owner_type='execution' and upload_status='subido' and owner_id='$REC' limit 1")
  if [ -n "$FILE" ]; then
    check "abre su foto" "$(code "$(get "/me/files/$FILE/url" "$ANA" | js 'p.url')")" 200
    check "otra persona no abre su foto: 403" "$(code "$B/me/files/$FILE/url" -H "authorization: Bearer $AND")" 403
  fi
fi
OTHER_REC=$(psql "select e.id from executions e where e.brigade_id='$BRIG' and e.specialist_id<>'$ANA_ID' limit 1")
[ -n "$OTHER_REC" ] && check "el jefe ve la ficha de un integrante" "$(code "$B/me/records/$OTHER_REC" -H "authorization: Bearer $ANA")" 200

echo "Alertas y logística"
check "mis alertas" "$(get "/me/incidents?projectId=$PROJ" "$ANA" | js "Array.isArray(p) && p.every(i=>i.reportedByName.startsWith('Ana'))")" true
check "logística de la brigada (jefe)" "$(get "/me/logistics?projectId=$PROJ&brigadeId=$BRIG" "$ANA" | js 'Array.isArray(p)')" true

echo "Descargas"
TK=$(ticket /me/records.xlsx "$ANA")
check "Excel de sus registros" "$(curl -s -o "$TMP/r.xlsx" -w '%{http_code}:%{content_type}' "$B/me/records.xlsx?projectId=$PROJ&ticket=$TK")" \
  "200:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
READY=$(get "/me/evidence/count?projectId=$PROJ" "$ANA" | js 'p.ready')
if [ "$READY" -gt 0 ]; then
  TK=$(ticket /me/evidence.zip "$ANA")
  curl -s -o "$TMP/e.zip" "$B/me/evidence.zip?projectId=$PROJ&ticket=$TK"
  check "ZIP con sus fotos y audios" "$(unzip -Z1 "$TMP/e.zip" | grep -vc 'LEEME.txt$')" "$READY"
  check "solo en su carpeta" "$(unzip -Z1 "$TMP/e.zip" | grep -v 'LEEME.txt$' | grep -vc '/Ana Aves')" 0
fi
TK=$(ticket "/projects/$PROJ/records.xlsx" "$AND")
check "un integrante no baja el Excel de coordinación: 403" "$(code "$B/projects/$PROJ/records.xlsx?ticket=$TK")" 403

echo "Tablero de la brigada"
check "el jefe ve el avance de su brigada" "$(get "/brigades/$BRIG/tracking" "$ANA" | js "p.brigade.id==='$BRIG'")" true
check "un integrante no: 403" "$(code "$B/brigades/$BRIG/tracking" -H "authorization: Bearer $AND")" 403
check "jefe de otra brigada no: 403" "$(code "$B/brigades/$BRIG/tracking" -H "authorization: Bearer $OTRO")" 403
check "el personal de campo no ve el tablero del proyecto: 403" "$(code "$B/projects/$PROJ/tracking" -H "authorization: Bearer $ANA")" 403

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas de mis registros pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
