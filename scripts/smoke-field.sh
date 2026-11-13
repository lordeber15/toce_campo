#!/usr/bin/env bash
# Prueba la sincronización del registro de campo (Sprint 1.3) contra el API local con los datos de ejemplo.
# Crea una ejecución, sus fotos y una nota de voz de prueba, y al final deja todo como estaba.
set -u
B=${API:-http://localhost:4000/api}
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"Toce2026\"}" | js 'p.accessToken'; }
# Evalúa una expresión JS sobre el JSON de la entrada estándar (variable p).
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
uuid() { node -e 'console.log(crypto.randomUUID())'; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ANA=$(token 20000001)
FLO=$(token 20000006)
H="authorization: Bearer $ANA"
PKG=$(curl -s "$B/work-package" -H "$H")
# Primera unidad pendiente de un método con fotos (p. ej. punto de conteo).
UNIT=$(echo "$PKG" | js 'JSON.stringify(p.units.find(u=>u.status==="pendiente"&&p.methods.find(m=>m.id===u.methodId).photoSlots.length))')
UNIT_ID=$(echo "$UNIT" | js 'p.id'); STATION=$(echo "$UNIT" | js 'p.stationId'); METHOD=$(echo "$UNIT" | js 'p.methodId'); CODE=$(echo "$UNIT" | js 'p.code')
OPEN_SM=$(echo "$PKG" | js 'const m=p.methods.find(m=>m.isOpenEnded);const sm=m&&p.stationMethods.find(s=>s.methodId===m.id);sm?sm.id+" "+sm.stationId+" "+m.id:""')
STATION_STATUS=$(docker exec toce-postgres psql -U toce -d toce -tAc "select status from stations where id='$STATION'")
EX=$(uuid); PH=$(uuid); AU=$(uuid); REC=$(uuid)
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

execution() { # $1 clientUpdatedAt $2 status
  cat <<EOF
{"clientId":"$EX","samplingUnitId":"$UNIT_ID","stationId":"$STATION","methodId":"$METHOD","status":"$2",
 "startedAt":"$NOW","startLat":-10.61,"startLng":-75.108,"startAccuracy":6,"clientUpdatedAt":"$1",
 "formData":{"records":[{"id":"$REC","values":{"especie":"Turdus chiguanco","n_individuos":3},"createdAt":"$NOW"}]}}
EOF
}

echo "Registro de campo ($CODE)"
check "sin sesión responde 401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/field/executions)" 401

R=$(curl -s -X POST $B/field/executions -H "$H" -H 'content-type: application/json' -d "$(execution "$NOW" en_curso)")
check "inicia la unidad" "$(echo "$R" | js 'p.unitCode+":"+p.unitStatus+":"+p.applied')" "$CODE:en_ejecucion:true"
R=$(curl -s -X POST $B/field/executions -H "$H" -H 'content-type: application/json' -d "$(execution "$NOW" en_curso)")
check "reenvío idempotente (misma ejecución)" "$(docker exec toce-postgres psql -U toce -d toce -tAc "select count(*) from executions where client_id='$EX'")" 1

LATER=$(date -u -v+1M +%Y-%m-%dT%H:%M:%S.000Z)
R=$(curl -s -X POST $B/field/executions -H "$H" -H 'content-type: application/json' -d "$(execution "$LATER" completada)")
check "cierra la unidad" "$(echo "$R" | js 'p.unitStatus')" completada
R=$(curl -s -X POST $B/field/executions -H "$H" -H 'content-type: application/json' -d "$(execution "$NOW" en_curso)")
check "un envío más antiguo no sobrescribe" "$(echo "$R" | js 'p.unitStatus+":"+p.applied')" "completada:false"
check "guarda los registros del formulario" "$(docker exec toce-postgres psql -U toce -d toce -tAc "select form_data->'records'->0->'values'->>'especie' from executions where client_id='$EX'")" "Turdus chiguanco"

R=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/field/executions -H "authorization: Bearer $FLO" -H 'content-type: application/json' -d "$(execution "$LATER" completada)")
check "otro especialista sin programación: 403" "$R" 403

ORPHAN=$(uuid)
R=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/field/attachments -H "$H" -H 'content-type: application/json' \
  -d "{\"clientId\":\"$(uuid)\",\"executionClientId\":\"$ORPHAN\",\"kind\":\"foto\",\"mimeType\":\"image/jpeg\",\"takenAt\":\"$NOW\"}")
check "foto de una ejecución no sincronizada: 409" "$R" 409

R=$(curl -s -X POST $B/field/attachments -H "$H" -H 'content-type: application/json' \
  -d "{\"clientId\":\"$PH\",\"executionClientId\":\"$EX\",\"kind\":\"foto\",\"slotKey\":\"norte\",\"mimeType\":\"image/jpeg\",\"width\":4,\"height\":4,\"lat\":-10.61,\"lng\":-75.108,\"accuracy\":5,\"takenAt\":\"$NOW\"}")
check "registra la foto" "$(echo "$R" | js 'p.uploadStatus+":"+p.originalUploadStatus')" "pendiente:pendiente"
PH_ID=$(echo "$R" | js 'p.id')
R=$(curl -s -X POST $B/field/attachments -H "$H" -H 'content-type: application/json' \
  -d "{\"clientId\":\"$PH\",\"executionClientId\":\"$EX\",\"kind\":\"foto\",\"slotKey\":\"norte\",\"mimeType\":\"image/jpeg\",\"takenAt\":\"$NOW\"}")
check "reenvío de la foto devuelve la misma" "$(echo "$R" | js 'p.id')" "$PH_ID"

head -c 2048 /dev/urandom > "$TMP/c.jpg"; head -c 6000 /dev/urandom > "$TMP/o.jpg"
R=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$B/field/attachments/$PH/content" -H "authorization: Bearer $FLO" -H 'content-type: image/jpeg' --data-binary @"$TMP/c.jpg")
check "otro usuario no puede subir el archivo: 403" "$R" 403
R=$(curl -s -X PUT "$B/field/attachments/$PH/content?variant=compressed" -H "$H" -H 'content-type: image/jpeg' --data-binary @"$TMP/c.jpg")
check "sube la copia comprimida" "$(echo "$R" | js 'p.size')" 2048
R=$(curl -s -X PUT "$B/field/attachments/$PH/content?variant=original" -H "$H" -H 'content-type: image/jpeg' --data-binary @"$TMP/o.jpg")
check "sube el original" "$(echo "$R" | js 'p.size')" 6000
check "estados de subida" "$(docker exec toce-postgres psql -U toce -d toce -tAc "select upload_status||':'||original_upload_status||':'||object_key from attachments where client_id='$PH'")" \
  "subido:subido:$(docker exec toce-postgres psql -U toce -d toce -tAc "select p.code||'/'||s.code from stations s join projects p on p.id=s.project_id where s.id='$STATION'")/$CODE/fotos/$PH.jpg"

URL=$(curl -s "$B/field/attachments/$PH_ID/url?variant=original" -H "$H" | js 'p.url')
curl -s "$URL" -o "$TMP/back.jpg"
check "el original descargado es idéntico" "$(cmp -s "$TMP/o.jpg" "$TMP/back.jpg" && echo si || echo no)" si

R=$(curl -s -X POST $B/field/attachments -H "$H" -H 'content-type: application/json' \
  -d "{\"clientId\":\"$AU\",\"executionClientId\":\"$EX\",\"kind\":\"audio\",\"mimeType\":\"audio/mp4\",\"durationSec\":12,\"takenAt\":\"$NOW\"}")
check "nota de voz sin copia original aparte" "$(echo "$R" | js 'p.originalUploadStatus')" subido
R=$(curl -s -X PUT "$B/field/attachments/$AU/content" -H "$H" -H 'content-type: audio/mp4' -H 'transfer-encoding: chunked' --data-binary @"$TMP/c.jpg")
check "sube la nota de voz (envío por partes, sin tamaño)" "$(echo "$R" | js 'p.ok+":"+p.size')" "true:2048"

if [ -n "$OPEN_SM" ]; then
  read -r SM OST OM <<<"$OPEN_SM"
  EX2=$(uuid); NU=$(uuid)
  BODY="{\"clientId\":\"$EX2\",\"newUnit\":{\"clientId\":\"$NU\",\"stationMethodId\":\"$SM\"},\"stationId\":\"$OST\",\"methodId\":\"$OM\",\"status\":\"completada\",\"startedAt\":\"$NOW\",\"clientUpdatedAt\":\"$NOW\",\"formData\":{\"records\":[]}}"
  C1=$(curl -s -X POST $B/field/executions -H "$H" -H 'content-type: application/json' -d "$BODY" | js 'p.unitCode')
  C2=$(curl -s -X POST $B/field/executions -H "$H" -H 'content-type: application/json' -d "$BODY" | js 'p.unitCode')
  check "registro abierto crea su unidad (una sola vez)" "$([ -n "$C1" ] && [ "$C1" = "$C2" ] && echo si || echo "no $C1 $C2")" si
  docker exec toce-postgres psql -U toce -d toce -qc "delete from executions where client_id='$EX2'; delete from sampling_units where client_id='$NU'" >/dev/null
fi

# Limpieza: archivos en MinIO, filas y estados.
KEYS=$(docker exec toce-postgres psql -U toce -d toce -tAc "select object_key from attachments where client_id in ('$PH','$AU') union all select original_object_key from attachments where client_id='$PH'")
ROOT=$(cd "$(dirname "$0")/.." && pwd)
(cd "$ROOT" && set -a && . ./.env && set +a && node -e '
  const { Client } = require("minio");
  const c = new Client({ endPoint: process.env.MINIO_ENDPOINT, port: +process.env.MINIO_PORT, useSSL: false,
    accessKey: process.env.MINIO_ROOT_USER, secretKey: process.env.MINIO_ROOT_PASSWORD });
  c.removeObjects(process.env.MINIO_BUCKET, process.argv.slice(1)).catch((e) => console.error("  (no se pudo limpiar MinIO)", e.message));
' $KEYS)
docker exec toce-postgres psql -U toce -d toce -qc "
  delete from attachments where client_id in ('$PH','$AU');
  delete from executions where client_id='$EX';
  update sampling_units set status='pendiente' where id='$UNIT_ID';
  update stations set status='$STATION_STATUS' where id='$STATION';" >/dev/null

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas del registro de campo pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
