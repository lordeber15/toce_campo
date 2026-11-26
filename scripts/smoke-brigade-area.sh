#!/usr/bin/env bash
# Prueba la zona de trabajo por brigada, que sale de los KMZ asignados a la brigada en "Mapa y capas":
# - el polígono de la brigada = unión de los polígonos de sus capas (se recalcula al importar, reasignar o borrar);
# - el paquete del teléfono trae la zona (bounds) de cada brigada y solo la parte de las capas generales que cae en ella;
# - otra brigada no recibe el KMZ de la primera; la versión del paquete es estable;
# - fotos dentro/fuera del polígono marcadas por el servidor y mapa de fotos del supervisor.
# Al final deja la base como estaba. Usa los datos de ejemplo (pnpm db:seed).
set -u
B=${API:-http://localhost:4000/api}
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"Toce2026\"}" | js 'p.accessToken'; }
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
uuid() { node -e 'console.log(crypto.randomUUID())'; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
psql() { if [ -n "${USE_DOCKER:-}" ]; then docker exec toce-postgres psql -U toce -d "${DB_NAME:-toce}" -tAc "$1"; else node "$ROOT/scripts/lib/sql.cjs" "$1"; fi; }
J='content-type: application/json'
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
post() { curl -s -X POST "$B$1" -H "authorization: Bearer $2" -H "$J" -d "$3"; }
send() { curl -s -X "$1" "$B$2" -H "authorization: Bearer $3" -H "$J" -d "$4"; }
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
START=$(psql "select now()")
# Caja [o,s,e,n] de una geometría GeoJSON (para ver cuánto se recortó).
BBOX='const bb=(g)=>{const b=[1e9,1e9,-1e9,-1e9];const w=(c)=>{if(typeof c[0]==="number"){b[0]=Math.min(b[0],c[0]);b[1]=Math.min(b[1],c[1]);b[2]=Math.max(b[2],c[0]);b[3]=Math.max(b[3],c[1]);}else c.forEach(w)};w(g.coordinates);return b};'

ANA=$(token 20000001); MAR=$(token 20000003); COO=$(token 10000001); SUP=$(token 10000003)
PKG=$(curl -s "$B/work-package" -H "authorization: Bearer $ANA")
BRIG=$(echo "$PKG" | js 'p.brigades[0].id'); PROJ=$(echo "$PKG" | js 'p.projects[0].id')
STATION=$(echo "$PKG" | js 'p.stations[0].id')
LAT=$(echo "$PKG" | js 'p.stations[0].lat'); LNG=$(echo "$PKG" | js 'p.stations[0].lng')
MBRIG=$(curl -s "$B/work-package" -H "authorization: Bearer $MAR" | js 'p.brigades[0].id')
INC=$(uuid); IN_PH=$(uuid); OUT_PH=$(uuid); NOGPS_PH=$(uuid)

# Capas generales: un polígono de ~440 km alrededor del proyecto, una línea que lo cruza y un polígono lejano.
GEN=$(node -e "const [y,x]=[+process.argv[1],+process.argv[2]];const sq=(cx,cy,d)=>({type:'Polygon',coordinates:[[[cx-d,cy-d],[cx+d,cy-d],[cx+d,cy+d],[cx-d,cy+d],[cx-d,cy-d]]]});
console.log(JSON.stringify({sourceFile:'smoke-general.kmz',sourceTitle:'Smoke general',features:[
 {kind:'otro',name:'Smoke grande',folderPath:['Smoke'],geometry:sq(x,y,2)},
 {kind:'otro',name:'Smoke linea',folderPath:['Smoke'],geometry:{type:'LineString',coordinates:[[x-2,y],[x+2,y]]}},
 {kind:'otro',name:'Smoke lejana',folderPath:['Smoke'],geometry:sq(x,y+3,0.01)}]}))" -- "$LAT" "$LNG")
# KMZ de la brigada: cuadrado de ~1,1 km alrededor de la estación y un punto (torre).
BRK=$(node -e "const [y,x]=[+process.argv[1],+process.argv[2]],d=0.005;
console.log(JSON.stringify({sourceFile:'smoke-brigada.kmz',sourceTitle:'Zona prueba',brigadeId:process.argv[3],features:[
 {kind:'otro',name:'Smoke zona',folderPath:['Zona'],geometry:{type:'Polygon',coordinates:[[[x-d,y-d],[x+d,y-d],[x+d,y+d],[x-d,y+d],[x-d,y-d]]]}},
 {kind:'otro',name:'Smoke torre',folderPath:['Torres'],geometry:{type:'Point',coordinates:[x+0.001,y]}}]}))" -- "$LAT" "$LNG" "$BRIG")

echo "Zona de trabajo por brigada (KMZ en Mapa y capas)"
check "ya no se carga el polígono en Brigadas: PUT /area 404" "$(code -X PUT "$B/brigades/$BRIG/area" -H "authorization: Bearer $COO" -H "$J" -d '{"name":"x","geometries":[]}')" 404
check "ni se borra: DELETE /area 404" "$(code -X DELETE "$B/brigades/$BRIG/area" -H "authorization: Bearer $COO")" 404
check "capas generales importadas" "$(post "/projects/$PROJ/layers" "$COO" "$GEN" | js 'p.imported')" 3
check "especialista no importa KMZ: 403" "$(code -X POST "$B/projects/$PROJ/layers" -H "authorization: Bearer $ANA" -H "$J" -d "$BRK")" 403
check "KMZ de la brigada importado" "$(post "/projects/$PROJ/layers" "$COO" "$BRK" | js 'p.imported')" 2
BL=$(curl -s "$B/projects/$PROJ/brigades" -H "authorization: Bearer $COO")
check "la brigada toma el polígono de su KMZ" "$(echo "$BL" | js "(b=>b.areaName+':'+b.areaSourceFile+':'+(b.areaHa>100&&b.areaHa<130)+':'+b.layers)(p.find(b=>b.id==='$BRIG'))")" "Zona prueba:smoke-brigada.kmz:true:2"
check "brigade-areas lo devuelve" "$(curl -s "$B/projects/$PROJ/brigade-areas" -H "authorization: Bearer $SUP" | js "/Polygon/.test(p.features.find(f=>f.id==='$BRIG').geometry.type)")" true
check "otra brigada sin KMZ: sin polígono" "$(echo "$BL" | js "p.find(b=>b.id==='$MBRIG').areaHa")" null

P1=$(curl -s "$B/work-package" -H "authorization: Bearer $ANA")
check "paquete: polígono y zona de la brigada" "$(echo "$P1" | js "(b=>b.areaName+':'+/Polygon/.test(b.area.type)+':'+b.boundsSource+':'+(b.bounds[2]-b.bounds[0]<0.02))(p.brigades.find(b=>b.id==='$BRIG'))")" "Zona prueba:true:kmz:true"
check "zona del proyecto = la de la brigada (no todo el proyecto)" "$(echo "$P1" | js 'p.projects[0].bounds[2]-p.projects[0].bounds[0] < 0.02')" true
check "recibe el KMZ de su brigada completo" "$(echo "$P1" | js "p.layers.filter(l=>l.brigadeId==='$BRIG').map(l=>l.name).sort().join()")" "Smoke torre,Smoke zona"
check "capa general recortada a su zona (de 4° a menos de 0,13°)" "$(echo "$P1" | js "$BBOX (l=>{const b=bb(l.geometry);return (b[2]-b[0])<0.13&&(b[3]-b[1])<0.13&&(b[2]-b[0])>0.09})(p.layers.find(l=>l.name==='Smoke grande'))")" true
check "línea general recortada" "$(echo "$P1" | js "$BBOX (l=>{const b=bb(l.geometry);return l.geometry.type+':'+((b[2]-b[0])<0.13)})(p.layers.find(l=>l.name==='Smoke linea'))")" "LineString:true"
check "capa general fuera de su zona no llega" "$(echo "$P1" | js 'p.layers.some(l=>l.name==="Smoke lejana")')" false
check "el paquete sigue trayendo sus estaciones" "$(echo "$P1" | js 'p.stations.length>0')" true

P2=$(curl -s "$B/work-package" -H "authorization: Bearer $MAR")
check "otra brigada no recibe el KMZ de la primera" "$(echo "$P2" | js "p.layers.some(l=>l.brigadeId==='$BRIG' || l.name==='Smoke zona')")" false
check "otra brigada sin KMZ: zona = sus estaciones" "$(echo "$P2" | js "(b=>b.boundsSource+':'+(b.bounds[2]-b.bounds[0]<0.01))(p.brigades[0])")" "estaciones:true"
check "otra brigada recibe la capa general recortada a su zona" "$(echo "$P2" | js "$BBOX (l=>{const b=bb(l.geometry);return (b[2]-b[0])<0.11})(p.layers.find(l=>l.name==='Smoke grande'))")" true

V1=$(echo "$P1" | js 'p.version'); V2=$(curl -s "$B/work-package" -H "authorization: Bearer $ANA" | js 'p.version')
check "versión estable entre dos descargas" "$V2" "$V1"
check "misma versión responde sin cambios" "$(curl -s "$B/work-package?version=$V1" -H "authorization: Bearer $ANA" | js 'p.unchanged')" true

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
check "mapa de fotos: las que tienen ubicación" "$(echo "$M" | js "p.filter(x=>x.brigadeId==='$BRIG' && x.takenBy).length >= 2")" true
check "mapa de fotos: filtro solo fuera" "$(curl -s "$B/projects/$PROJ/photo-map?brigadeId=$BRIG&outside=1" -H "authorization: Bearer $SUP" | js 'p.every(x=>x.outsideArea===true) && p.length>=1')" true
check "especialista no ve el mapa de fotos: 403" "$(code "$B/projects/$PROJ/photo-map" -H "authorization: Bearer $ANA")" 403
check "conteo de fotos fuera por brigada" "$(curl -s "$B/projects/$PROJ/brigades" -H "authorization: Bearer $COO" | js "p.find(b=>b.id==='$BRIG').photosOutside >= 0")" true

# Reasignar el KMZ a "General" quita el polígono; volver a asignarlo lo recalcula.
check "KMZ pasado a General" "$(send PATCH "/projects/$PROJ/layer-groups" "$COO" '{"sourceFile":"smoke-brigada.kmz","brigadeId":null}' | js 'p.updated')" 2
check "sin KMZ propio la brigada queda sin polígono" "$(curl -s "$B/projects/$PROJ/brigade-areas" -H "authorization: Bearer $SUP" | js "p.features.some(f=>f.id==='$BRIG')")" false
check "sin polígono las fotos quedan sin verificar" "$(flag "$OUT_PH")" null
check "como capa general llega recortada (sin brigada)" "$(curl -s "$B/work-package" -H "authorization: Bearer $ANA" | js 'p.layers.filter(l=>l.name==="Smoke zona").map(l=>l.brigadeId).join()')" ""
BODY="{\"sourceFile\":\"smoke-brigada.kmz\",\"brigadeId\":\"$BRIG\"}"
send PATCH "/projects/$PROJ/layer-groups" "$COO" "$BODY" >/dev/null
check "al volver a asignarlo se reclasifican las fotos" "$(flag "$OUT_PH"):$(flag "$IN_PH")" "true:false"
DEL='{"sourceFile":"smoke-brigada.kmz","folderPath":[]}'
check "borrar el KMZ de la brigada" "$(send DELETE "/projects/$PROJ/layer-groups" "$COO" "$DEL" | js 'p.deleted')" 2
check "al borrarlo la brigada queda sin polígono" "$(curl -s "$B/projects/$PROJ/brigades" -H "authorization: Bearer $COO" | js "p.find(b=>b.id==='$BRIG').areaHa")" null
check "y la zona vuelve a ser la de sus estaciones" "$(curl -s "$B/work-package" -H "authorization: Bearer $ANA" | js "p.brigades.find(b=>b.id==='$BRIG').boundsSource")" estaciones

# Limpieza.
DEL='{"sourceFile":"smoke-general.kmz","folderPath":[]}'
send DELETE "/projects/$PROJ/layer-groups" "$COO" "$DEL" >/dev/null
psql "
  delete from attachments where client_id in ('$IN_PH','$OUT_PH','$NOGPS_PH');
  delete from audit_logs where entity_id::text in (select id::text from incidents where client_id='$INC')
    or (entity='project_layers' and entity_id='$PROJ' and at >= '$START');
  delete from incidents where client_id='$INC';
  delete from work_package_downloads where created_at >= '$START' and device_id is null
    and user_id in (select id from users where dni in ('20000001','20000003'));" >/dev/null 2>&1 || true

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas de la zona de brigada pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
