#!/usr/bin/env bash
# Prueba alertas e incidencias (Sprint 1.5): registro desde el teléfono, respuesta de coordinación,
# conversación y reprogramación. Al final deja la base como estaba.
set -u
B=${API:-http://localhost:4000/api}
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"Toce2026\"}" | js 'p.accessToken'; }
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
uuid() { node -e 'console.log(crypto.randomUUID())'; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
psql() { if [ -n "${USE_DOCKER:-}" ]; then docker exec toce-postgres psql -U toce -d toce -tAc "$1"; else node "$ROOT/scripts/lib/sql.cjs" "$1"; fi; }
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

ANA=$(token 20000001); COO=$(token 10000001); JP=$(token 10000002); FLO=$(token 20000006); SUP=$(token 10000003)
PKG=$(curl -s "$B/work-package" -H "authorization: Bearer $ANA")
UNIT=$(echo "$PKG" | js 'JSON.stringify(p.units.find(u=>u.status==="pendiente"))')
UNIT_ID=$(echo "$UNIT" | js 'p.id'); STATION=$(echo "$UNIT" | js 'p.stationId'); METHOD=$(echo "$UNIT" | js 'p.methodId')
SCHED=$(echo "$PKG" | js "p.schedules.find(s=>s.stationId==='$STATION').id")
BRIG=$(echo "$PKG" | js 'p.brigades[0].id'); PROJ=$(echo "$PKG" | js 'p.projects[0].id')
DATE0=$(psql "select to_char(planned_date,'YYYY-MM-DD') from schedules where id='$SCHED'")
STATION_STATUS=$(psql "select status from stations where id='$STATION'")
INC=$(uuid); INC2=$(uuid)

incident() { # $1 clientUpdatedAt $2 descripción
  echo "{\"clientId\":\"$INC\",\"brigadeId\":\"$BRIG\",\"stationId\":\"$STATION\",\"methodId\":\"$METHOD\",\"samplingUnitId\":\"$UNIT_ID\",\"scheduleId\":\"$SCHED\",
   \"type\":\"lluvia_intensa\",\"moment\":\"durante\",\"launchedFrom\":\"unidad\",\"description\":\"$2\",\"proposedAction\":\"Reprogramar\",
   \"unitNotDone\":true,\"occurredAt\":\"$NOW\",\"lat\":-10.61,\"lng\":-75.108,\"clientUpdatedAt\":\"$1\"}"
}
post() { curl -s -X POST "$B$1" -H "authorization: Bearer $2" -H 'content-type: application/json' -d "$3"; }

echo "Alertas e incidencias"
R=$(post /field/incidents "$ANA" "$(incident "$NOW" 'Lluvia intensa, no se completa el punto')")
check "registra la alerta" "$(echo "$R" | js 'p.status+":"+p.applied')" "abierta:true"
INC_ID=$(echo "$R" | js 'p.id')
check "unidad marcada como no realizada" "$(psql "select status from sampling_units where id='$UNIT_ID'")" no_realizada
R=$(post /field/incidents "$ANA" "$(incident "$NOW" 'Reenvío')")
check "reenvío idempotente" "$(psql "select count(*)||':'||max(description) from incidents where client_id='$INC'")" "1:Lluvia intensa, no se completa el punto"
LATER=$(date -u -v+1M +%Y-%m-%dT%H:%M:%S.000Z)
post /field/incidents "$ANA" "$(incident "$LATER" 'Lluvia intensa desde las 7:00')" >/dev/null
check "edición más reciente se aplica" "$(psql "select description from incidents where client_id='$INC'")" "Lluvia intensa desde las 7:00"
check "otro especialista sin programación: 403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/field/incidents -H "authorization: Bearer $FLO" -H 'content-type: application/json' -d "$(incident "$NOW" "Intento ajeno" | sed "s/$INC/$INC2/")")" 403
check "alerta de Mi jornada sin estación (solo brigada)" "$(post /field/incidents "$ANA" "{\"clientId\":\"$INC2\",\"brigadeId\":\"$BRIG\",\"type\":\"logistica\",\"moment\":\"antes\",\"launchedFrom\":\"mi_jornada\",\"description\":\"Camioneta averiada\",\"occurredAt\":\"$NOW\",\"clientUpdatedAt\":\"$NOW\"}" | js 'p.status')" abierta

R=$(post /field/attachments "$ANA" "{\"clientId\":\"$(uuid)\",\"incidentClientId\":\"$INC\",\"kind\":\"foto\",\"mimeType\":\"image/jpeg\",\"takenAt\":\"$NOW\"}")
check "evidencia fotográfica de la alerta" "$(echo "$R" | js 'p.uploadStatus')" pendiente
check "ruta de la evidencia en MinIO" "$(psql "select object_key like '%/alertas/$INC/fotos/%' from attachments where owner_id='$INC_ID'")" t

L=$(curl -s "$B/projects/$PROJ/incidents?status=abierta" -H "authorization: Bearer $COO")
check "bandeja de coordinación" "$(echo "$L" | js "p.filter(i=>i.id==='$INC_ID').map(i=>i.stationCode+':'+i.files).join()")" "$(echo "$PKG" | js "p.stations.find(s=>s.id==='$STATION').code"):1"
check "especialista no ve la bandeja: 403" "$(curl -s -o /dev/null -w '%{http_code}' "$B/projects/$PROJ/incidents" -H "authorization: Bearer $ANA")" 403

post "/incidents/$INC_ID/messages" "$COO" '{"body":"¿Cuántos puntos faltan?","kind":"solicitud_info"}' >/dev/null
check "pedir información la pone en revisión" "$(psql "select status from incidents where id='$INC_ID'")" en_revision
post "/field/incidents/$INC/messages" "$ANA" "{\"clientId\":\"$(uuid)\",\"body\":\"Faltan PC04 a PC06\",\"sentAt\":\"$NOW\"}" >/dev/null
check "jefe de proyecto no decide: 403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/incidents/$INC_ID/decision" -H "authorization: Bearer $JP" -H 'content-type: application/json' -d '{"decision":"aprobada","response":"ok ok"}')" 403
R=$(post "/incidents/$INC_ID/decision" "$COO" '{"decision":"aprobada","response":"Se reprograma la estación","correctiveAction":"Mantener esfuerzo"}')
check "coordinación aprueba" "$(echo "$R" | js 'p.status')" resuelta

NEW=$(date -v+3d +%Y-%m-%d)
R=$(post "/incidents/$INC_ID/reschedule" "$COO" "{\"scheduleId\":\"$SCHED\",\"newDate\":\"$NEW\",\"reason\":\"Lluvia intensa\",\"reopenUnits\":true}")
check "reprograma la visita" "$(echo "$R" | js 'p.toDate+":"+(p.reopened>=1)')" "$NEW:true"
check "cronograma actualizado" "$(psql "select to_char(planned_date,'YYYY-MM-DD') from schedules where id='$SCHED'")" "$NEW"
check "unidad vuelve a pendiente" "$(psql "select status from sampling_units where id='$UNIT_ID'")" pendiente
check "historial conserva fecha original" "$(psql "select to_char(from_date at time zone 'America/Lima','YYYY-MM-DD')||'>'||to_char(to_date at time zone 'America/Lima','YYYY-MM-DD') from reschedules where incident_id='$INC_ID'")" "$DATE0>$NEW"

MINE=$(curl -s "$B/field/incidents/mine" -H "authorization: Bearer $ANA")
check "el teléfono recibe respuesta y conversación" "$(echo "$MINE" | js "const i=p.find(x=>x.clientId==='$INC');i.status+':'+i.coordinationDecision+':'+i.messages.length+':'+i.reschedules.length")" "resuelta:aprobada:4:1"
check "el paquete trae la nueva fecha" "$(curl -s "$B/work-package" -H "authorization: Bearer $ANA" | js "p.schedules.find(s=>s.id==='$SCHED').plannedDate")" "$NEW"
echo "Alertas críticas y seguimiento (jefe de proyecto)"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
crit() { curl -s "$B/projects/$PROJ/tracking" -H "authorization: Bearer $JP" | js 'p.metrics.criticalAlerts'; }
CRIT0=$(crit)
J='content-type: application/json'
check "especialista no marca crítica: 403" "$(code -X POST "$B/incidents/$INC_ID/critical" -H "authorization: Bearer $ANA" -H "$J" -d '{"critical":true,"reason":"Urgente"}')" 403
check "supervisor no marca crítica: 403" "$(code -X POST "$B/incidents/$INC_ID/critical" -H "authorization: Bearer $SUP" -H "$J" -d '{"critical":true,"reason":"Urgente"}')" 403
check "marcar sin motivo: 400" "$(code -X POST "$B/incidents/$INC_ID/critical" -H "authorization: Bearer $JP" -H "$J" -d '{"critical":true}')" 400
check "jefe de proyecto marca crítica" "$(post "/incidents/$INC_ID/critical" "$JP" '{"critical":true,"reason":"Riesgo de perder la estación"}' | js 'p.ok')" true
D=$(curl -s "$B/incidents/$INC_ID" -H "authorization: Bearer $COO")
check "detalle: crítica, quién y por qué" "$(echo "$D" | js 'p.isCritical+":"+p.criticalByName+":"+p.criticalReason')" "true:Jorge Jefe de Proyecto:Riesgo de perder la estación"
check "queda auditado" "$(psql "select count(*) from audit_logs where entity_id='$INC_ID' and action='mark_critical'")" 1
check "filtro de críticas" "$(curl -s "$B/projects/$PROJ/incidents?critical=1" -H "authorization: Bearer $JP" | js "p.length>0 && p.every(x=>x.isCritical) && p.some(x=>x.id==='$INC_ID')")" true
check "contador en Avance sube" "$(crit)" "$((CRIT0 + 1))"
BODY=$(printf '{"ownerId":"%s"}' "$(uuid)")
check "responsable ajeno al proyecto: 400" "$(code -X PUT "$B/incidents/$INC_ID/follow-up" -H "authorization: Bearer $JP" -H "$J" -d "$BODY")" 400
SUP_ID=$(psql "select id from users where dni='10000003'")
DUE=$(date -v+2d +%Y-%m-%d)
BODY=$(printf '{"ownerId":"%s","dueDate":"%s"}' "$SUP_ID" "$DUE")
check "asigna responsable y fecha" "$(code -X PUT "$B/incidents/$INC_ID/follow-up" -H "authorization: Bearer $JP" -H "$J" -d "$BODY")" 200
check "supervisor no reasigna: 403" "$(code -X PUT "$B/incidents/$INC_ID/follow-up" -H "authorization: Bearer $SUP" -H "$J" -d '{"ownerId":null}')" 403
check "nota de avance muy corta: 400" "$(code -X POST "$B/incidents/$INC_ID/follow-ups" -H "authorization: Bearer $SUP" -H "$J" -d '{"body":"ok"}')" 400
check "el responsable registra avance" "$(code -X POST "$B/incidents/$INC_ID/follow-ups" -H "authorization: Bearer $SUP" -H "$J" -d '{"body":"Se coordinó el cambio de fecha con la brigada"}')" 201
check "especialista no registra avances: 403" "$(code -X POST "$B/incidents/$INC_ID/follow-ups" -H "authorization: Bearer $ANA" -H "$J" -d '{"body":"Avance del campo"}')" 403
D=$(curl -s "$B/incidents/$INC_ID" -H "authorization: Bearer $JP")
check "detalle: responsable, fecha y avances" "$(echo "$D" | js 'p.followUpOwnerName+":"+p.followUpDueDate+":"+p.followUps.length+":"+p.followUps[0].authorName')" "Sofía Supervisora:$DUE:1:Sofía Supervisora"
check "los avances no llegan al teléfono" "$(curl -s "$B/field/incidents/mine" -H "authorization: Bearer $ANA" | js "p.find(x=>x.clientId==='$INC').messages.some(m=>m.body.includes('cambio de fecha'))")" false

check "cierre" "$(post "/incidents/$INC_ID/close" "$COO" '{}' | js 'p.ok')" true
check "cerrada: ya no cuenta como crítica" "$(crit)" "$CRIT0"
check "cerrada: no admite avances (409)" "$(code -X POST "$B/incidents/$INC_ID/follow-ups" -H "authorization: Bearer $JP" -H "$J" -d '{"body":"Otro avance"}')" 409
check "cerrada: no se desmarca (409)" "$(code -X POST "$B/incidents/$INC_ID/critical" -H "authorization: Bearer $JP" -H "$J" -d '{"critical":false}')" 409

# Limpieza: devuelve la programación, borra alertas, archivos y auditoría de prueba.
psql "
  update schedules set planned_date='$DATE0', status='planificada' where id='$SCHED';
  update sampling_units set status='pendiente' where id='$UNIT_ID';
  update stations set status='$STATION_STATUS' where id='$STATION';
  delete from reschedules where incident_id in (select id from incidents where client_id in ('$INC','$INC2'));
  delete from attachments where owner_type='incident' and owner_id in (select id from incidents where client_id in ('$INC','$INC2'));
  delete from audit_logs where entity_id::text in (select id::text from incidents where client_id in ('$INC','$INC2')) or (entity='schedule' and entity_id='$SCHED' and action='reschedule');
  delete from incidents where client_id in ('$INC','$INC2');" >/dev/null

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas de alertas pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
