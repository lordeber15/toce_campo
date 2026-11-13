#!/usr/bin/env bash
# Prueba el Sprint 1.6: supervisor de campo (incidencias con desviación, acción correctiva y solución;
# alertas de sus brigadas) y responsable logístico (movilidad, apoyos, viáticos, muestras, equipos e
# incidencias logísticas). Al final deja la base como estaba.
# Ojo (bash 3.2 de macOS): los JSON literales van en variables; dentro de "$(...)" se expanden las llaves.
set -u
B=${API:-http://localhost:4000/api}
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"Toce2026\"}" | js 'p.accessToken'; }
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
uuid() { node -e 'console.log(crypto.randomUUID())'; }
psql() { docker exec toce-postgres psql -U toce -d toce -tAc "$1"; }
post() { curl -s -X POST "$B$1" -H "authorization: Bearer $2" -H 'content-type: application/json' -d "$3"; }
code() { curl -s -o /dev/null -w '%{http_code}' -X POST "$B$1" -H "authorization: Bearer $2" -H 'content-type: application/json' -d "$3"; }
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
LATER=$(date -u -v+1M +%Y-%m-%dT%H:%M:%S.000Z)
TODAY=$(TZ=America/Lima date +%Y-%m-%d)

ANA=$(token 20000001); COO=$(token 10000001); SOF=$(token 10000003); LUI=$(token 10000004)
PKG=$(curl -s "$B/work-package" -H "authorization: Bearer $SOF")
BRIG=$(echo "$PKG" | js 'p.brigades.find(b=>b.myRoles.includes("supervisor")).id')
PROJ=$(echo "$PKG" | js 'p.projects[0].id')
STATION=$(echo "$PKG" | js "p.schedules.find(s=>s.brigadeId==='$BRIG').stationId")
S1=$(uuid); S2=$(uuid); A1=$(uuid); L1=$(uuid)
V=$(uuid); P=$(uuid); E=$(uuid); M=$(uuid); Q=$(uuid); F=$(uuid)

echo "Supervisor de campo"
check "paquete del supervisor con sus brigadas" "$(echo "$PKG" | js 'p.brigades.length>0 && p.schedules.length>0 && p.units.length>0')" true

sup() { # $1 clientId $2 stamp $3 solución
  echo "{\"clientId\":\"$1\",\"brigadeId\":\"$BRIG\",\"stationId\":\"$STATION\",\"type\":\"metodologica\",\"moment\":\"durante\",\"launchedFrom\":\"supervision\",
   \"description\":\"Trampas Sherman a 5 m en lugar de 10 m\",\"methodologicalDeviation\":\"Distancia entre trampas menor a la del protocolo\",
   \"correctiveAction\":\"Se reubicaron las trampas a 10 m\",\"resolutionNotes\":$3,\"occurredAt\":\"$NOW\",\"clientUpdatedAt\":\"$2\"}"
}
R=$(post /field/incidents "$SOF" "$(sup "$S1" "$NOW" '"Se corrigió con el especialista y se reinició el transecto"')")
check "incidencia documentada y resuelta en campo" "$(echo "$R" | js 'p.status')" resuelta
check "guarda desviación, acción y solución" "$(psql "select (methodological_deviation is not null)::text||':'||field_corrective_action||':'||(resolved_by_id=(select id from users where dni='10000003'))::text from incidents where client_id='$S1'")" "true:Se reubicaron las trampas a 10 m:true"
R=$(post /field/incidents "$SOF" "$(sup "$S2" "$NOW" null)")
check "sin solución queda abierta" "$(echo "$R" | js 'p.status')" abierta
R=$(post /field/incidents "$SOF" "$(sup "$S2" "$LATER" '"Resuelto al día siguiente"')")
check "luego registra cómo se resolvió" "$(echo "$R" | js 'p.status+":"+p.applied')" "resuelta:true"

A_UNIT=$(curl -s "$B/work-package" -H "authorization: Bearer $ANA" | js "JSON.stringify(p)")
A_BRIG=$(echo "$A_UNIT" | js "p.brigades.find(b=>b.id==='$BRIG')?.id ?? p.brigades[0].id")
post /field/incidents "$ANA" "{\"clientId\":\"$A1\",\"brigadeId\":\"$A_BRIG\",\"type\":\"tecnica\",\"moment\":\"antes\",\"launchedFrom\":\"mi_jornada\",\"description\":\"GPS sin señal\",\"occurredAt\":\"$NOW\",\"clientUpdatedAt\":\"$NOW\"}" >/dev/null
BI=$(curl -s "$B/field/incidents/brigades" -H "authorization: Bearer $SOF")
check "supervisor ve alertas de su brigada" "$(echo "$BI" | js "p.filter(i=>i.clientId==='$A1').map(i=>i.reportedByName+':'+i.type).join()")" "$(psql "select full_name from users where dni='20000001'"):tecnica"
check "no ve las suyas en esa lista" "$(echo "$BI" | js "p.some(i=>i.clientId==='$S1')")" false
MSG=$(uuid); BODY="{\"clientId\":\"$MSG\",\"body\":\"Se prestó GPS de respaldo\",\"sentAt\":\"$NOW\"}"
check "deja nota de supervisión en la alerta" "$(post "/field/incidents/$A1/messages" "$SOF" "$BODY" | js 'p.ok')" true
check "nota queda como comentario" "$(psql "select kind from incident_messages where client_id='$MSG'")" comentario
check "el especialista la recibe" "$(curl -s "$B/field/incidents/mine" -H "authorization: Bearer $ANA" | js "p.find(i=>i.clientId==='$A1').messages[0].body")" "Se prestó GPS de respaldo"
BODY="{\"clientId\":\"$(uuid)\",\"body\":\"Nota\",\"sentAt\":\"$NOW\"}"
check "logístico no escribe en alertas ajenas: 403" "$(code "/field/incidents/$A1/messages" "$LUI" "$BODY")" 403

S1_ID=$(psql "select id from incidents where client_id='$S1'")
D=$(curl -s "$B/incidents/$S1_ID" -H "authorization: Bearer $COO")
check "web muestra lo documentado por el supervisor" "$(echo "$D" | js 'p.launchedFrom+":"+!!p.methodologicalDeviation+":"+p.fieldCorrectiveAction+":"+p.resolvedByName')" "supervision:true:Se reubicaron las trampas a 10 m:Sofía Supervisora"
post "/incidents/$S1_ID/decision" "$COO" '{"decision":"aprobada","response":"Conforme","correctiveAction":"Reforzar capacitación"}' >/dev/null
check "coordinación responde sin borrar la acción de campo" "$(psql "select field_corrective_action||'|'||corrective_action from incidents where id='$S1_ID'")" "Se reubicaron las trampas a 10 m|Reforzar capacitación"

echo "Responsable logístico"
veh() { echo "{\"clientId\":\"$V\",\"brigadeId\":\"$BRIG\",\"description\":\"Camioneta 4x4\",\"plate\":\"ABC-123\",\"driverName\":\"Juan Pérez\",\"status\":\"$1\",\"arrivedAt\":$2,\"missingMaterials\":[\"Botiquín\"],\"defectiveMaterials\":[],\"clientUpdatedAt\":\"$3\"}"; }
check "registra movilidad" "$(post /field/logistics/vehicle "$LUI" "$(veh en_ruta null "$NOW")" | js 'p.applied')" true
check "reenvío idempotente" "$(post /field/logistics/vehicle "$LUI" "$(veh en_ruta null "$NOW")" | js 'p.applied')" false
post /field/logistics/vehicle "$LUI" "$(veh llegada "\"$LATER\"" "$LATER")" >/dev/null
check "confirma llegada" "$(psql "select status||':'||(arrived_at is not null)::text||':'||array_to_string(missing_materials,',') from logistics_vehicles where client_id='$V'")" "llegada:true:Botiquín"
BODY="{\"clientId\":\"$P\",\"brigadeId\":\"$BRIG\",\"fullName\":\"Pedro Quispe\",\"dni\":\"123\",\"clientUpdatedAt\":\"$NOW\"}"
check "DNI inválido: 400" "$(code /field/logistics/support "$LUI" "$BODY")" 400
post /field/logistics/support "$LUI" "{\"clientId\":\"$P\",\"brigadeId\":\"$BRIG\",\"fullName\":\"Pedro Quispe\",\"dni\":\"45678912\",\"community\":\"CC Huancapallac\",\"eppItems\":[\"Casco\",\"Botas\"],\"documentsDelivered\":[\"Copia de DNI\"],\"isAvailable\":true,\"clientUpdatedAt\":\"$NOW\"}" >/dev/null
check "apoyo local con EPP" "$(psql "select dni||':'||epp_delivered::text||':'||array_length(epp_items,1) from logistics_support_staff where client_id='$P'")" "45678912:true:2"
post /field/logistics/expense "$LUI" "{\"clientId\":\"$E\",\"brigadeId\":\"$BRIG\",\"category\":\"combustible\",\"description\":\"Gasolina 10 gal\",\"amount\":185.5,\"expenseDate\":\"$TODAY\",\"receiptNumber\":\"B001-123\",\"clientUpdatedAt\":\"$NOW\"}" >/dev/null
check "gasto con comprobante" "$(psql "select amount||':'||has_receipt::text from logistics_expenses where client_id='$E'")" "185.50:true"
post /field/logistics/sample "$LUI" "{\"clientId\":\"$M\",\"brigadeId\":\"$BRIG\",\"code\":\"M-001\",\"quantity\":3,\"stationId\":\"$STATION\",\"status\":\"pendiente\",\"clientUpdatedAt\":\"$NOW\"}" >/dev/null
post /field/logistics/equipment "$LUI" "{\"clientId\":\"$Q\",\"brigadeId\":\"$BRIG\",\"name\":\"GPS Garmin\",\"serial\":\"G-77\",\"status\":\"defectuoso\",\"clientUpdatedAt\":\"$NOW\"}" >/dev/null
check "muestra y equipo" "$(psql "select (select status from logistics_samples where client_id='$M')||':'||(select status from logistics_equipment where client_id='$Q')")" "pendiente:defectuoso"
BODY="{\"clientId\":\"$F\",\"logisticsClientId\":\"$E\",\"kind\":\"comprobante\",\"mimeType\":\"image/jpeg\",\"takenAt\":\"$NOW\"}"; R=$(post /field/attachments "$LUI" "$BODY")
check "foto del comprobante" "$(echo "$R" | js 'p.uploadStatus')" pendiente
check "ruta del comprobante en MinIO" "$(psql "select object_key like '%/logistica/viaticos/$E/comprobantes/%' from attachments where client_id='$F'")" t
check "especialista no registra logística: 403" "$(code /field/logistics/vehicle "$ANA" "$(veh en_ruta null "$LATER")")" 403

PULL=$(curl -s "$B/field/logistics" -H "authorization: Bearer $LUI")
check "el teléfono recupera sus registros" "$(echo "$PULL" | js "['$V','$P','$E','$M','$Q'].filter(id=>p.some(r=>r.data.clientId===id)).length")" 5
check "datos restaurados tal cual" "$(echo "$PULL" | js "const v=p.find(r=>r.data.clientId==='$V').data, e=p.find(r=>r.data.clientId==='$E');v.status+':'+v.missingMaterials.join()+':'+e.data.amount+':'+e.files")" "llegada:Botiquín:185.5:1"

BODY="{\"clientId\":\"$L1\",\"brigadeId\":\"$BRIG\",\"type\":\"accidente_movilidad\",\"launchedFrom\":\"logistica\",\"description\":\"Despiste leve en la trocha, sin heridos\",\"occurredAt\":\"$NOW\",\"clientUpdatedAt\":\"$NOW\"}"; R=$(post /field/incidents "$LUI" "$BODY")
check "incidencia logística genera alerta" "$(echo "$R" | js 'p.status')" abierta
check "coordinación la ve en su bandeja" "$(curl -s "$B/projects/$PROJ/incidents?type=accidente_movilidad" -H "authorization: Bearer $COO" | js "p.some(i=>i.launchedFrom==='logistica')")" true
W=$(curl -s "$B/projects/$PROJ/logistics" -H "authorization: Bearer $COO")
check "web: logística del proyecto" "$(echo "$W" | js "p.vehicle.length>0 && p.expense.find(x=>x.data.clientId==='$E').files.length")" 1
check "especialista no ve la logística web: 403" "$(curl -s -o /dev/null -w '%{http_code}' "$B/projects/$PROJ/logistics" -H "authorization: Bearer $ANA")" 403

# Limpieza.
IDS="'$S1','$S2','$A1','$L1'"
LOG="'$V','$P','$E','$M','$Q'"
psql "
  delete from attachments where client_id='$F';
  delete from audit_logs where entity_id::text in (select id::text from incidents where client_id in ($IDS))
    or entity like 'logistics_%' and after->>'clientId' in ($LOG);
  delete from incidents where client_id in ($IDS);
  delete from logistics_vehicles where client_id='$V'; delete from logistics_support_staff where client_id='$P';
  delete from logistics_expenses where client_id='$E'; delete from logistics_samples where client_id='$M';
  delete from logistics_equipment where client_id='$Q';" >/dev/null

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas de supervisión y logística pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
