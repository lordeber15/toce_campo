#!/usr/bin/env bash
# Prueba el repositorio de documentos y evidencias (6): listado unificado con contexto por origen, filtros,
# vista previa, carga y borrado de documentos del proyecto, ZIP con carpetas ordenadas y permisos.
# Crea un documento y una consulta con adjunto; al final los borra.
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

COO=$(token 10000001); ANA=$(token 20000001)
ANA_ID=$(psql "select id from users where dni='20000001'")
ROW=$(psql "select b.project_id, b.id, sc.station_id from schedules sc join brigades b on b.id = sc.brigade_id
  join brigade_members bm on bm.brigade_id = b.id and bm.user_id = '$ANA_ID' and bm.left_at is null where b.is_active limit 1")
PROJ=${ROW%%|*}; REST=${ROW#*|}; BRIG=${REST%%|*}; ST=${REST#*|}
BNAME=$(psql "select name from brigades where id='$BRIG'"); SCODE=$(psql "select code from stations where id='$ST'")
PCODE=$(psql "select code from projects where id='$PROJ'")

DOC=""; INQ=""
cleanup() {
  [ -n "$DOC" ] && curl -s -X DELETE "$B/documents/$DOC" -H "authorization: Bearer $COO" >/dev/null
  if [ -n "$INQ" ]; then
    psql "delete from attachments where owner_type='inquiry_message' and owner_id in (select id from inquiry_messages where inquiry_id='$INQ')" >/dev/null
    psql "delete from inquiries where id='$INQ'" >/dev/null
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

printf '%%PDF-1.4\n%% acta de prueba\n' > "$TMP/acta.pdf"

echo "Documentos del proyecto"
check "tipo no admitido: 415" "$(code -X PUT "$B/projects/$PROJ/documents?name=x.exe" -H "authorization: Bearer $COO" -H 'content-type: application/x-msdownload' --data-binary @"$TMP/acta.pdf")" 415
check "estación de otro proyecto: 400" "$(code -X PUT "$B/projects/$PROJ/documents?name=a.pdf&stationId=00000000-0000-0000-0000-000000000000" -H "authorization: Bearer $COO" -H 'content-type: application/pdf' --data-binary @"$TMP/acta.pdf")" 400
DOC=$(curl -s -X PUT "$B/projects/$PROJ/documents?name=PRUEBA%20Acta%20de%20inicio.pdf&category=acta&brigadeId=$BRIG&stationId=$ST" \
  -H "authorization: Bearer $COO" -H 'content-type: application/pdf' --data-binary @"$TMP/acta.pdf" | js 'p.id')
L=$(get "/projects/$PROJ/files?origin=document&q=PRUEBA" "$COO")
check "aparece con brigada y estación" "$(echo "$L" | js "const r=p.rows.find(x=>x.id==='$DOC'); [r.origin,r.type,r.label,r.brigadeName,r.stationCode,r.canDelete].join('|')")" \
  "document|documento|PRUEBA Acta de inicio.pdf|$BNAME|$SCODE|true"
check "filtro por tipo" "$(get "/projects/$PROJ/files?type=foto&q=PRUEBA" "$COO" | js 'p.total')" 0
check "vista previa" "$(code "$(get "/files/$DOC/url" "$COO" | js 'p.url')")" 200
check "descarga con su nombre" "$(curl -s -D - -o /dev/null "$(get "/files/$DOC/url?download=1" "$COO" | js 'p.url')" | grep -i '^content-disposition' | grep -c 'attachment')" 1

echo "Otros orígenes"
O=$(get "/projects/$PROJ/inquiries/options" "$COO")
BODY="{\"brigadeId\":\"$BRIG\",\"targetUserId\":\"$ANA_ID\",\"stationId\":\"$ST\",\"subject\":\"PRUEBA documentos\",\"body\":\"Envía el acta\"}"
C=$(curl -s -X POST "$B/projects/$PROJ/inquiries" -H "authorization: Bearer $COO" -H 'content-type: application/json' -d "$BODY")
INQ=$(echo "$C" | js 'p.id'); MSG=$(echo "$C" | js 'p.messageId')
curl -s -X PUT "$B/inquiry-messages/$MSG/files?name=PRUEBA%20foto%20consulta.pdf" -H "authorization: Bearer $COO" -H 'content-type: application/pdf' --data-binary @"$TMP/acta.pdf" >/dev/null
check "adjunto de consulta con su contexto" "$(get "/projects/$PROJ/files?origin=inquiry_message&q=PRUEBA%20foto" "$COO" | js "const r=p.rows[0]; [r.origin,r.brigadeName,r.stationCode,r.personName!==null,r.canDelete].join('|')")" \
  "inquiry_message|$BNAME|$SCODE|true|false"
F=$(get "/projects/$PROJ/files?origin=execution" "$COO")
if [ "$(echo "$F" | js 'p.total')" -gt 0 ]; then
  check "evidencias de campo con método y unidad" "$(echo "$F" | js 'p.rows.every(r=>r.unitCode && r.methodCode && r.stationCode && r.personName)')" true
  check "miniaturas de fotos subidas" "$(echo "$F" | js 'p.rows.filter(r=>r.type==="foto"&&r.uploaded).every(r=>r.thumbUrl)')" true
fi
check "filtros disponibles" "$(get "/projects/$PROJ/files/facets" "$COO" | js "p.brigades.some(b=>b.id==='$BRIG') && p.stations.some(s=>s.id==='$ST')")" true
check "filtro por estación" "$(get "/projects/$PROJ/files?stationId=$ST&q=PRUEBA" "$COO" | js 'p.total')" 2

echo "ZIP organizado"
check "conteo antes de descargar" "$(get "/projects/$PROJ/files/count?q=PRUEBA" "$COO" | js 'p.ready')" 2
TK=$(curl -s -X POST "$B/download-ticket" -H "authorization: Bearer $COO" -H 'content-type: application/json' -d "{\"path\":\"/projects/$PROJ/files.zip\"}" | js 'p.ticket')
curl -s -o "$TMP/d.zip" "$B/projects/$PROJ/files.zip?q=PRUEBA&ticket=$TK"
LIST=$(unzip -Z1 "$TMP/d.zip")
check "documento en Proyecto/Brigada/Persona/Estación/Origen/Tipo" "$(echo "$LIST" | grep -c "^$PCODE/$BNAME/[^/]*/$SCODE/Documento del proyecto/Documentos/PRUEBA Acta de inicio_.*\.pdf$")" 1
check "adjunto de consulta en su carpeta" "$(echo "$LIST" | grep -c "^$PCODE/$BNAME/[^/]*/$SCODE/Consulta/Documentos/PRUEBA foto consulta_.*\.pdf$")" 1
check "incluye LEEME" "$(echo "$LIST" | grep -c "^$PCODE/LEEME.txt$")" 1
check "sin ticket: 401" "$(code "$B/projects/$PROJ/files.zip")" 401

echo "Borrado y permisos"
EX=$(echo "$F" | js 'p.rows[0]?.id ?? ""')
[ -n "$EX" ] && check "las evidencias de campo no se borran: 404" "$(code -X DELETE "$B/documents/$EX" -H "authorization: Bearer $COO")" 404
check "el especialista no ve el repositorio: 403" "$(code "$B/projects/$PROJ/files" -H "authorization: Bearer $ANA")" 403
check "el especialista no sube documentos: 403" "$(code -X PUT "$B/projects/$PROJ/documents?name=a.pdf" -H "authorization: Bearer $ANA" -H 'content-type: application/pdf' --data-binary @"$TMP/acta.pdf")" 403
check "borrar documento" "$(code -X DELETE "$B/documents/$DOC" -H "authorization: Bearer $COO")" 200
check "ya no aparece" "$(get "/projects/$PROJ/files?origin=document&q=PRUEBA" "$COO" | js 'p.total')" 0
check "queda en la auditoría" "$(psql "select string_agg(action, ',' order by at) from audit_logs where entity='document' and entity_id='$DOC'")" "upload,delete"
DOC=""

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas de documentos pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
