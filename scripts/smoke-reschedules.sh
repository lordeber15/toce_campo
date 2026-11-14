#!/usr/bin/env bash
# Prueba las reprogramaciones (5.5): propuesta del supervisor, evidencia, aprobación por coordinación (con ajuste de fecha),
# rechazo, registro y aprobación directa, historial, permisos, tablero y paquete de trabajo del teléfono.
# Crea su propia visita (a 20 días) y al final la borra con todo lo suyo.
set -u
B=${API:-http://localhost:4000/api}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"Toce2026\"}" | js 'p.accessToken'; }
psql() { node "$ROOT/scripts/lib/sql.cjs" "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
post() { curl -s -X POST "$B$1" -H "authorization: Bearer $2" -H 'content-type: application/json' -d "$3"; }
postc() { code -X POST "$B$1" -H "authorization: Bearer $2" -H 'content-type: application/json' -d "$3"; }
day() { node -e "const d=new Date(Date.now()-5*3600e3);d.setUTCDate(d.getUTCDate()+$1);console.log(d.toISOString().slice(0,10))"; }

COO=$(token 10000001); JP=$(token 10000002); SUP=$(token 10000003); ANA=$(token 20000001)
ANA_ID=$(psql "select id from users where dni='20000001'")
ROW=$(psql "select b.project_id, b.id, sc.station_id from schedules sc join brigades b on b.id = sc.brigade_id
  join brigade_members bm on bm.brigade_id = b.id and bm.user_id = '$ANA_ID' and bm.left_at is null
  where b.is_active limit 1")
PROJ=${ROW%%|*}; REST=${ROW#*|}; BRIG=${REST%%|*}; ST=${REST#*|}
[ -n "$ST" ] || { echo "El especialista 20000001 no tiene visitas programadas"; exit 1; }
D0=$(day 20); D1=$(day 23); D2=$(day 24); D3=$(day 26)

SCH=""
cleanup() {
  if [ -n "$SCH" ]; then
    psql "delete from attachments where owner_type='reschedule' and owner_id in (select id from reschedules where schedule_id='$SCH')" >/dev/null
    psql "delete from schedules where id='$SCH'" >/dev/null
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

BODY="{\"brigadeId\":\"$BRIG\",\"plannedDate\":\"$D0\",\"stationIds\":[\"$ST\"],\"notes\":\"PRUEBA reprogramación\"}"
post "/projects/$PROJ/schedules" "$COO" "$BODY" >/dev/null
SCH=$(psql "select id from schedules where brigade_id='$BRIG' and station_id='$ST' and planned_date='$D0' and notes='PRUEBA reprogramación'")
[ -n "$SCH" ] || { echo "No se pudo crear la visita de prueba"; exit 1; }
PEND0=$(curl -s "$B/projects/$PROJ/tracking" -H "authorization: Bearer $COO" | js 'p.metrics.pendingReschedules')

echo "Propuesta"
check "la visita aparece en las opciones" "$(curl -s "$B/projects/$PROJ/reschedules/options" -H "authorization: Bearer $SUP" | js "p.visits.some(v=>v.id==='$SCH' && !v.pending)")" true
BODY="{\"scheduleId\":\"$SCH\",\"newDate\":\"$D1\",\"reason\":\"Lluvia intensa\",\"approve\":true}"
check "el supervisor no aprueba: 403" "$(postc "/projects/$PROJ/reschedules" "$SUP" "$BODY")" 403
BODY="{\"scheduleId\":\"$SCH\",\"newDate\":\"$D0\",\"reason\":\"Misma fecha\"}"
check "misma fecha: 400" "$(postc "/projects/$PROJ/reschedules" "$SUP" "$BODY")" 400
BODY="{\"scheduleId\":\"$SCH\",\"newDate\":\"$D1\",\"reason\":\"Lluvia intensa\",\"justification\":\"Parte del SENAMHI\",\"reopenUnits\":false}"
R1=$(post "/projects/$PROJ/reschedules" "$SUP" "$BODY")
ID1=$(echo "$R1" | js 'p.id')
check "queda por aprobar" "$(echo "$R1" | js 'p.status')" propuesta
check "el cronograma no cambia todavía" "$(psql "select to_char(planned_date,'YYYY-MM-DD') from schedules where id='$SCH'")" "$D0"
check "otra propuesta para la misma visita: 409" "$(postc "/projects/$PROJ/reschedules" "$COO" "$BODY")" 409
check "el tablero la cuenta como pendiente" "$(curl -s "$B/projects/$PROJ/tracking" -H "authorization: Bearer $COO" | js 'p.metrics.pendingReschedules')" "$((PEND0+1))"
check "filtro por estado" "$(curl -s "$B/projects/$PROJ/reschedules?status=propuesta" -H "authorization: Bearer $COO" | js "p.some(r=>r.id==='$ID1')")" true

echo "Evidencia"
printf '%%PDF-1.4\n%% parte de lluvia\n' > "$TMP/parte.pdf"
FID=$(curl -s -X PUT "$B/reschedules/$ID1/files?name=Parte%20de%20lluvia.pdf" -H "authorization: Bearer $SUP" -H 'content-type: application/pdf' --data-binary @"$TMP/parte.pdf" | js 'p.id')
check "se adjunta" "$(curl -s "$B/reschedules/$ID1" -H "authorization: Bearer $COO" | js 'p.fileList.map(f=>f.name).join()')" "Parte de lluvia.pdf"
check "se descarga" "$(code "$(curl -s "$B/reschedule-files/$FID/url" -H "authorization: Bearer $COO" | js 'p.url')")" 200

echo "Aprobación"
check "el supervisor no aprueba la propuesta: 403" "$(postc "/reschedules/$ID1/approve" "$SUP" '{}')" 403
BODY="{\"newDate\":\"$D2\",\"note\":\"Se aprueba un día después por disponibilidad de movilidad\"}"
post "/reschedules/$ID1/approve" "$COO" "$BODY" >/dev/null
check "cronograma actualizado con la fecha ajustada" "$(psql "select to_char(planned_date,'YYYY-MM-DD') || ':' || to_char(original_date,'YYYY-MM-DD') from schedules where id='$SCH'")" "$D2:$D0"
D=$(curl -s "$B/reschedules/$ID1" -H "authorization: Bearer $COO")
check "conserva fecha original, nueva, motivo y quién aprobó" \
  "$(echo "$D" | js 'p.originalDate+":"+p.fromDate+":"+p.toDate+":"+p.reason+":"+p.decidedByName+":"+(p.decidedAt!==null)')" \
  "$D0:$D0:$D2:Lluvia intensa:Carla Coordinadora:true"
check "historial de cambios" "$(echo "$D" | js 'p.log.map(l=>l.action).join()')" "Propuesta registrada,Evidencia adjunta,Aprobada"
check "no se decide dos veces: 409" "$(postc "/reschedules/$ID1/reject" "$JP" '{"note":"tarde"}')" 409
WP=$(curl -s "$B/work-package" -H "authorization: Bearer $ANA")
check "el teléfono recibe la nueva fecha y la anterior" \
  "$(echo "$WP" | js "const s=p.schedules.find(x=>x.id==='$SCH'); s.plannedDate+':'+s.originalDate+':'+s.lastReschedule.fromDate+':'+s.lastReschedule.reason")" \
  "$D2:$D0:$D0:Lluvia intensa"

echo "Rechazo"
BODY="{\"scheduleId\":\"$SCH\",\"newDate\":\"$D3\",\"reason\":\"Cambio de ruta\",\"reopenUnits\":false}"
ID2=$(post "/projects/$PROJ/reschedules" "$SUP" "$BODY" | js 'p.id')
check "rechazo sin sustento: 400" "$(postc "/reschedules/$ID2/reject" "$JP" '{"note":""}')" 400
post "/reschedules/$ID2/reject" "$JP" '{"note":"La ruta actual es viable"}' >/dev/null
check "rechazada; el cronograma sigue igual" "$(curl -s "$B/reschedules/$ID2" -H "authorization: Bearer $COO" | js 'p.status+":"+p.decisionNotes+":"+p.currentDate')" "rechazada:La ruta actual es viable:$D2"

echo "Registro y aprobación directa"
BODY="{\"scheduleId\":\"$SCH\",\"newDate\":\"$D3\",\"reason\":\"Acceso bloqueado por huaico\",\"reopenUnits\":false,\"approve\":true}"
R3=$(post "/projects/$PROJ/reschedules" "$COO" "$BODY")
check "aprobada en un paso" "$(echo "$R3" | js 'p.status+":"+p.fromDate+":"+p.toDate')" "aprobada:$D2:$D3"
check "historial de la visita: 3 cambios" "$(curl -s "$B/reschedules/$(echo "$R3" | js 'p.id')" -H "authorization: Bearer $COO" | js 'p.visitHistory.map(h=>h.status).join()')" "aprobada,rechazada,aprobada"
check "ya no queda pendiente en el tablero" "$(curl -s "$B/projects/$PROJ/tracking" -H "authorization: Bearer $COO" | js 'p.metrics.pendingReschedules')" "$PEND0"
check "auditoría del cronograma" "$(psql "select count(*) from audit_logs where entity='schedule' and entity_id='$SCH' and action='reschedule'")" 2

echo "Permisos"
check "el especialista no ve la bandeja: 403" "$(code "$B/projects/$PROJ/reschedules" -H "authorization: Bearer $ANA")" 403
check "el especialista no propone: 403" "$(postc "/projects/$PROJ/reschedules" "$ANA" "$BODY")" 403

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas de reprogramaciones pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
