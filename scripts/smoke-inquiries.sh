#!/usr/bin/env bash
# Prueba las consultas (5.4): registrar una consulta, respuesta desde el teléfono (y reenvío sin duplicar),
# pedir más información, llamada registrada por coordinación, adjuntos, cierre, reapertura y permisos.
# Crea sus propias consultas y al final las borra.
set -u
B=${API:-http://localhost:4000/api}
TMP=$(mktemp -d)
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"Toce2026\"}" | js 'p.accessToken'; }
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
psql() { docker exec toce-postgres psql -U toce -d toce -tAc "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
post() { curl -s -X POST "$B$1" -H "authorization: Bearer $2" -H 'content-type: application/json' -d "$3"; }

COO=$(token 10000001); JP=$(token 10000002); ANA=$(token 20000001)
PROJ=$(psql "select id from projects where deleted_at is null order by created_at limit 1")
ANA_ID=$(psql "select id from users where dni='20000001'")
cleanup() {
  psql "delete from attachments where owner_type='inquiry_message' and owner_id in (select m.id from inquiry_messages m join inquiries q on q.id=m.inquiry_id where q.subject like 'PRUEBA %')" >/dev/null
  psql "delete from inquiries where subject like 'PRUEBA %'" >/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

O=$(curl -s "$B/projects/$PROJ/inquiries/options" -H "authorization: Bearer $COO")
BRIG=$(echo "$O" | js "p.brigades.find(b=>b.people.some(x=>x.id==='$ANA_ID'))?.id ?? ''")
[ -n "$BRIG" ] || { echo "El especialista 20000001 no está en ninguna brigada del proyecto"; exit 1; }
ST=$(echo "$O" | js "p.brigades.find(b=>b.id==='$BRIG').stations[0]?.id ?? ''")
OTHER=$(psql "select id from users where dni='10000001'")

echo "Registrar consulta"
check "opciones: personas y estaciones de la brigada" "$(echo "$O" | js "p.brigades.find(b=>b.id==='$BRIG').stations.length>0 && p.methods.length>0")" true
check "persona fuera de la brigada: 400" "$(code -X POST "$B/projects/$PROJ/inquiries" -H "authorization: Bearer $COO" -H 'content-type: application/json' \
  -d "{\"brigadeId\":\"$BRIG\",\"targetUserId\":\"$OTHER\",\"subject\":\"PRUEBA x\",\"body\":\"hola\"}")" 400
C=$(post "/projects/$PROJ/inquiries" "$COO" "{\"brigadeId\":\"$BRIG\",\"targetUserId\":\"$ANA_ID\",\"stationId\":\"$ST\",\"subject\":\"PRUEBA esfuerzo\",\"body\":\"¿Cuántas unidades hiciste?\"}")
ID=$(echo "$C" | js 'p.id')
D=$(curl -s "$B/inquiries/$ID" -H "authorization: Bearer $JP")
check "queda esperando respuesta" "$(echo "$D" | js 'p.status')" abierta
check "primer mensaje: la consulta" "$(echo "$D" | js 'p.thread.map(m=>m.kind).join()')" consulta
check "aparece en la bandeja" "$(curl -s "$B/projects/$PROJ/inquiries?brigadeId=$BRIG" -H "authorization: Bearer $COO" | js "p.some(r=>r.id==='$ID' && r.messages===1)")" true
check "búsqueda por texto del mensaje" "$(curl -s "$B/projects/$PROJ/inquiries" -G --data-urlencode "q=cuántas unidades" -H "authorization: Bearer $COO" | js "p.some(r=>r.id==='$ID')")" true

echo "Teléfono"
M=$(curl -s "$B/field/inquiries/mine" -H "authorization: Bearer $ANA")
check "el especialista la recibe" "$(echo "$M" | js "p.find(q=>q.id==='$ID')?.thread.length")" 1
CID=$(node -e 'console.log(crypto.randomUUID())')
REPLY="{\"clientId\":\"$CID\",\"body\":\"Hice 3 de 4\",\"sentAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
post "/field/inquiries/$ID/messages" "$ANA" "$REPLY" >/dev/null
check "responde: pasa a respondida" "$(curl -s "$B/inquiries/$ID" -H "authorization: Bearer $COO" | js 'p.status')" respondida
post "/inquiries/$ID/messages" "$COO" '{"kind":"solicitud_info","body":"¿Por qué faltó una?"}' >/dev/null
check "pedir información: vuelve a esperar" "$(curl -s "$B/inquiries/$ID" -H "authorization: Bearer $COO" | js 'p.status')" abierta
post "/field/inquiries/$ID/messages" "$ANA" "$REPLY" >/dev/null
D=$(curl -s "$B/inquiries/$ID" -H "authorization: Bearer $COO")
check "reenvío del teléfono no duplica ni cambia el estado" "$(echo "$D" | js 'p.thread.length + ":" + p.status')" "3:abierta"
check "otra persona no responde: 403" "$(code -X POST "$B/field/inquiries/$ID/messages" -H "authorization: Bearer $JP" -H 'content-type: application/json' \
  -d "{\"clientId\":\"$(node -e 'console.log(crypto.randomUUID())')\",\"body\":\"x\",\"sentAt\":\"2026-01-01T00:00:00Z\"}")" 403

echo "Comunicaciones por otro medio"
check "respuesta sin indicar el medio: 400" "$(code -X POST "$B/inquiries/$ID/messages" -H "authorization: Bearer $COO" -H 'content-type: application/json' -d '{"kind":"respuesta","channel":"app","body":"x"}')" 400
MID=$(post "/inquiries/$ID/messages" "$COO" '{"kind":"respuesta","channel":"telefono","body":"Por llamada: la lluvia impidió la cuarta"}' | js 'p.id')
D=$(curl -s "$B/inquiries/$ID" -H "authorization: Bearer $COO")
check "llamada registrada en nombre del especialista" "$(echo "$D" | js 'const m=p.thread.at(-1); m.channel+":"+(m.onBehalfOfName!==null)+":"+p.status')" "telefono:true:respondida"
post "/inquiries/$ID/messages" "$COO" '{"kind":"seguimiento","channel":"whatsapp","body":"Envió fotos por WhatsApp"}' >/dev/null
check "seguimiento no cambia el estado" "$(curl -s "$B/inquiries/$ID" -H "authorization: Bearer $COO" | js 'p.status')" respondida
P=$(post "/projects/$PROJ/inquiries" "$JP" "{\"brigadeId\":\"$BRIG\",\"targetUserId\":\"$ANA_ID\",\"subject\":\"PRUEBA llamada\",\"channel\":\"radio\",\"body\":\"¿Llegaron a la estación?\",\"response\":\"Sí, a las 8\"}")
check "consulta por radio con respuesta: ya respondida" "$(curl -s "$B/inquiries/$(echo "$P" | js 'p.id')" -H "authorization: Bearer $COO" | js 'p.status + ":" + p.thread.length')" "respondida:2"

echo "Adjuntos"
printf '%%PDF-1.4\n%% prueba\n' > "$TMP/acta.pdf"
check "tipo no admitido: 415" "$(code -X PUT "$B/inquiry-messages/$MID/files?name=x.exe" -H "authorization: Bearer $COO" -H 'content-type: application/x-msdownload' --data-binary @"$TMP/acta.pdf")" 415
F=$(curl -s -X PUT "$B/inquiry-messages/$MID/files?name=Acta%20de%20campo.pdf" -H "authorization: Bearer $COO" -H 'content-type: application/pdf' --data-binary @"$TMP/acta.pdf")
FID=$(echo "$F" | js 'p.id')
D=$(curl -s "$B/inquiries/$ID" -H "authorization: Bearer $COO")
check "adjunto en el mensaje" "$(echo "$D" | js "p.thread.find(m=>m.id==='$MID').files.map(f=>f.name+':'+f.kind).join()")" "Acta de campo.pdf:documento"
check "el especialista lo descarga" "$(code "$(curl -s "$B/inquiry-files/$FID/url" -H "authorization: Bearer $ANA" | js 'p.url')")" 200
check "lo ve en su teléfono" "$(curl -s "$B/field/inquiries/mine" -H "authorization: Bearer $ANA" | js "p.find(q=>q.id==='$ID').thread.flatMap(m=>m.files).length")" 1

echo "Foto desde el teléfono"
PH=$(node -e 'console.log(crypto.randomUUID())')
META="{\"clientId\":\"$PH\",\"inquiryReplyClientId\":\"$CID\",\"kind\":\"foto\",\"mimeType\":\"image/jpeg\",\"takenAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"lat\":-12.05,\"lng\":-77.04}"
check "otra persona no adjunta a mi respuesta: 403" "$(code -X POST "$B/field/attachments" -H "authorization: Bearer $JP" -H 'content-type: application/json' -d "$META")" 403
post "/field/attachments" "$ANA" "$META" >/dev/null
printf '\xff\xd8\xff\xe0 foto de prueba' > "$TMP/f.jpg"
curl -s -X PUT "$B/field/attachments/$PH/content?variant=compressed" -H "authorization: Bearer $ANA" -H 'content-type: image/jpeg' --data-binary @"$TMP/f.jpg" >/dev/null
D=$(curl -s "$B/inquiries/$ID" -H "authorization: Bearer $COO")
check "la foto queda en la respuesta del teléfono" "$(echo "$D" | js "p.thread.find(m=>m.clientId==='$CID').files.map(f=>f.kind+':'+f.uploadStatus).join()")" "foto:subido"
FPH=$(echo "$D" | js "p.thread.find(m=>m.clientId==='$CID').files[0].id")
check "coordinación la abre" "$(code "$(curl -s "$B/inquiry-files/$FPH/url" -H "authorization: Bearer $COO" | js 'p.url')")" 200
check "guardada en la carpeta de la consulta" "$(psql "select object_key like '%/consultas/$ID/fotos/$PH.jpg' from attachments where client_id='$PH'")" t

echo "Cierre"
post "/inquiries/$ID/close" "$COO" '{}' >/dev/null
check "cerrada: no admite mensajes de la web" "$(code -X POST "$B/inquiries/$ID/messages" -H "authorization: Bearer $COO" -H 'content-type: application/json' -d '{"kind":"seguimiento","body":"x"}')" 409
post "/field/inquiries/$ID/messages" "$ANA" "{\"clientId\":\"$(node -e 'console.log(crypto.randomUUID())')\",\"body\":\"Escrito sin señal\",\"sentAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >/dev/null
check "respuesta tardía del teléfono se guarda; sigue cerrada" "$(curl -s "$B/inquiries/$ID" -H "authorization: Bearer $COO" | js 'p.status + ":" + p.thread.some(m=>m.body==="Escrito sin señal")')" "cerrada:true"
post "/inquiries/$ID/reopen" "$COO" '{}' >/dev/null
check "reabrir: vuelve a respondida" "$(curl -s "$B/inquiries/$ID" -H "authorization: Bearer $COO" | js 'p.status + ":" + (p.closedAt===null)')" "respondida:true"
check "filtro por estado" "$(curl -s "$B/projects/$PROJ/inquiries?status=cerrada" -H "authorization: Bearer $COO" | js "p.some(r=>r.id==='$ID')")" false
check "historial auditado" "$(psql "select string_agg(action, ',' order by at) from audit_logs where entity='inquiry' and entity_id='$ID'")" "create,close,reopen"

echo "Permisos"
check "especialista no ve la bandeja: 403" "$(code "$B/projects/$PROJ/inquiries" -H "authorization: Bearer $ANA")" 403
check "especialista no crea consultas: 403" "$(code -X POST "$B/projects/$PROJ/inquiries" -H "authorization: Bearer $ANA" -H 'content-type: application/json' -d '{}')" 403

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas de consultas pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
