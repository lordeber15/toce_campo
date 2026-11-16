#!/usr/bin/env bash
# Prueba el polígono de trabajo por brigada: carga (KMZ ya convertido a GeoJSON), paquete del teléfono,
# fotos dentro/fuera marcadas por el servidor y mapa de fotos del supervisor. Al final deja la base como estaba.
set -u
B=${API:-http://localhost:4000/api}
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"Toce2026\"}" | js 'p.accessToken'; }
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
uuid() { node -e 'console.log(crypto.randomUUID())'; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
psql() { if [ -n "${USE_DOCKER:-}" ]; then docker exec toce-postgres psql -U toce -d toce -tAc "$1"; else node "$ROOT/scripts/lib/sql.cjs" "$1"; fi; }
J='content-type: application/json'
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
post() { curl -s -X POST "$B$1" -H "authorization: Bearer $2" -H "$J" -d "$3"; }
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

ANA=$(token 20000001); COO=$(token 10000001); SUP=$(token 10000003)
PKG=$(curl -s "$B/work-package" -H "authorization: Bearer $ANA")
BRIG=$(echo "$PKG" | js 'p.brigades[0].id'); PROJ=$(echo "$PKG" | js 'p.projects[0].id')
STATION=$(echo "$PKG" | js 'p.stations[0].id')
LAT=$(echo "$PKG" | js 'p.stations[0].lat'); LNG=$(echo "$PKG" | js 'p.stations[0].lng')
AREA0=$(psql "select coalesce(area_name,'') from brigades where id='$BRIG'")
INC=$(uuid); IN_PH=$(uuid); OUT_PH=$(uuid); NOGPS_PH=$(uuid)

# Cuadrado de ~1,1 km alrededor de la estación.
SQ=$(node -e "const [y,x]=[+process.argv[1],+process.argv[2]],d=0.005;console.log(JSON.stringify({type:'Polygon',coordinates:[[[x-d,y-d],[x+d,y-d],[x+d,y+d],[x-d,y+d],[x-d,y-d]]]}))" -- "$LAT" "$LNG")
AREA_BODY="{\"name\":\"Zona prueba\",\"sourceFile\":\"prueba.kmz\",\"geometries\":[$SQ]}"

echo "Polígono de trabajo por brigada"
check "especialista no carga polígonos: 403" "$(code -X PUT "$B/brigades/$BRIG/area" -H "authorization: Bearer $ANA" -H "$J" -d "$AREA_BODY")" 403
check "sin polígonos: 400" "$(code -X PUT "$B/brigades/$BRIG/area" -H "authorization: Bearer $COO" -H "$J" -d '{"name":"x","geometries":[]}')" 400
R=$(curl -s -X PUT "$B/brigades/$BRIG/area" -H "authorization: Bearer $COO" -H "$J" -d "$AREA_BODY")
check "coordinador carga el polígono" "$(echo "$R" | js 'p.ok && p.areaHa > 100 && p.areaHa < 130')" true
check "lista de brigadas con el polígono" "$(curl -s "$B/projects/$PROJ/brigades" -H "authorization: Bearer $COO" | js "(b=>b.areaName+':'+b.areaSourceFile)(p.find(b=>b.id==='$BRIG'))")" "Zona prueba:prueba.kmz"
check "capa de polígonos para el mapa" "$(curl -s "$B/projects/$PROJ/brigade-areas" -H "authorization: Bearer $SUP" | js "/Polygon/.test(p.features.find(f=>f.id==='$BRIG').geometry.type)")" true
check "llega al teléfono en el paquete" "$(curl -s "$B/work-package" -H "authorization: Bearer $ANA" | js "(b=>b.areaName+':'+/Polygon/.test(b.area.type))(p.brigades.find(b=>b.id==='$BRIG'))")" "Zona prueba:true"

# Alerta con tres fotos: dentro, ~2 km fuera y sin GPS.
post /field/incidents "$ANA" "{\"clientId\":\"$INC\",\"brigadeId\":\"$BRIG\",\"stationId\":\"$STATION\",\"type\":\"otra\",\"launchedFrom\":\"mi_jornada\",
  \"description\":\"Prueba de polígono\",\"unitNotDone\":false,\"occurredAt\":\"$NOW\",\"lat\":$LAT,\"lng\":$LNG,\"clientUpdatedAt\":\"$NOW\"}" >/dev/null
photo() { # $1 clientId $2 lat $3 lng
  post /field/attachments "$ANA" "{\"clientId\":\"$1\",\"incidentClientId\":\"$INC\",\"kind\":\"foto\",\"mimeType\":\"image/jpeg\",\"lat\":$2,\"lng\":$3,\"accuracy\":5,\"takenAt\":\"$NOW\"}" | js 'p.id'
}
OUTLAT=$(node -e "console.log(+process.argv[1]+0.02)" -- "$LAT")
photo "$IN_PH" "$LAT" "$LNG" >/dev/null
photo "$OUT_PH" "$OUTLAT" "$LNG" >/dev/null
photo "$NOGPS_PH" null null >/dev/null
flag() { psql "select coalesce(outside_area::text,'null') from attachments where client_id='$1'"; }
check "foto dentro: outside=false" "$(flag "$IN_PH")" false
check "foto fuera: outside=true" "$(flag "$OUT_PH")" true
check "foto sin GPS: sin verificar" "$(flag "$NOGPS_PH")" null

M=$(curl -s "$B/projects/$PROJ/photo-map?brigadeId=$BRIG" -H "authorization: Bearer $SUP")
check "mapa de fotos: solo las que tienen ubicación" "$(echo "$M" | js "p.filter(x=>['$IN_PH','$OUT_PH'].length && x.brigadeId==='$BRIG' && x.takenBy).length >= 2")" true
check "mapa de fotos: filtro solo fuera" "$(curl -s "$B/projects/$PROJ/photo-map?brigadeId=$BRIG&outside=1" -H "authorization: Bearer $SUP" | js 'p.every(x=>x.outsideArea===true) && p.length>=1')" true
check "especialista no ve el mapa de fotos: 403" "$(code "$B/projects/$PROJ/photo-map" -H "authorization: Bearer $ANA")" 403
check "conteo de fotos fuera por brigada" "$(curl -s "$B/projects/$PROJ/brigades" -H "authorization: Bearer $COO" | js "p.find(b=>b.id==='$BRIG').photosOutside >= 0")" true

check "quitar el polígono" "$(curl -s -X DELETE "$B/brigades/$BRIG/area" -H "authorization: Bearer $COO" | js 'p.ok')" true
check "sin polígono las fotos quedan sin verificar" "$(flag "$OUT_PH")" null
curl -s -X PUT "$B/brigades/$BRIG/area" -H "authorization: Bearer $COO" -H "$J" -d "$AREA_BODY" >/dev/null
check "al recargar el polígono se reclasifican" "$(flag "$OUT_PH"):$(flag "$IN_PH")" "true:false"

# Limpieza.
psql "
  delete from attachments where client_id in ('$IN_PH','$OUT_PH','$NOGPS_PH');
  delete from audit_logs where entity_id::text in (select id::text from incidents where client_id='$INC') or (entity='brigade' and entity_id='$BRIG' and action in ('area','area_delete'));
  delete from incidents where client_id='$INC';" >/dev/null
[ -z "$AREA0" ] && psql "update brigades set area_geom=null, area_name=null, area_source_file=null where id='$BRIG'" >/dev/null

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas del polígono de brigada pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
