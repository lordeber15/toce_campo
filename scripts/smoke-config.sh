#!/usr/bin/env bash
# Prueba las reglas de configuración (Sprint 1.1) contra el API local. Crea un proyecto temporal "ZZTEST".
set -u
B=${API:-http://localhost:4000/api}
FAILS=0
j() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const v=process.argv[1].split(".").reduce((a,k)=>a?.[k],o);console.log(typeof v==="object"?JSON.stringify(v):v)})' "$1"; }
req() {
  local args=(-s -X "$1" "$B$2" -H "authorization: Bearer $T" -w '\n%{http_code}')
  [ $# -ge 3 ] && args+=(-H 'content-type: application/json' --data-binary "$3")
  curl "${args[@]}"
}
body() { echo "$1" | sed '$d'; }
status() { echo "$1" | tail -n1; }
check() { [ $# -eq 3 ] && [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }

T=$(curl -s -X POST $B/auth/login -H 'content-type: application/json' -d '{"dni":"10000001","password":"Toce2026"}' | j accessToken)
SP=$(curl -s $B/specialties -H "authorization: Bearer $T")
AVE=$(echo "$SP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(x=>x.code==="AVE").id))')
FLO=$(echo "$SP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(x=>x.code==="FLO").id))')
M=$(curl -s "$B/methods?specialtyId=$AVE" -H "authorization: Bearer $T")
PC=$(echo "$M" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(x=>x.code==="PC").id))')
RO=$(echo "$M" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(x=>x.code==="RO").id))')

# limpieza previa
docker exec toce-postgres psql -U toce -d toce -qc "delete from projects where code='ZZTEST'" >/dev/null

R=$(req POST /projects '{"code":"zztest","name":"Proyecto de prueba","utmZone":18}'); check "crear proyecto" "$(status "$R")" 201
P=$(body "$R" | j id)
R=$(req POST /projects '{"code":"ZZTEST","name":"Otro"}'); check "código duplicado" "$(status "$R")" 409

# Capas: AID cuadrado alrededor de (-75.10,-10.60), UV más pequeño, superposición
POLY() { echo "{\"type\":\"Polygon\",\"coordinates\":[[[$1,$2],[$3,$2],[$3,$4],[$1,$4],[$1,$2]]]}"; }
LAYERS="{\"sourceFile\":\"prueba.kmz\",\"features\":[
 {\"kind\":\"aid\",\"name\":\"AID\",\"geometry\":$(POLY -75.11 -10.61 -75.09 -10.59)},
 {\"kind\":\"aii\",\"name\":\"AII\",\"geometry\":$(POLY -75.20 -10.70 -75.00 -10.50)},
 {\"kind\":\"uv\",\"name\":\"Bosque montano\",\"code\":\"BAPa\",\"geometry\":$(POLY -75.105 -10.605 -75.095 -10.595)},
 {\"kind\":\"superposicion\",\"name\":\"ACR Chonta\",\"geometry\":$(POLY -75.12 -10.62 -75.10 -10.60)}]}"
R=$(req POST /projects/$P/layers "$LAYERS"); check "importar capas" "$(status "$R")" 201

R=$(req POST /projects/$P/stations "{\"code\":\"em-01\",\"lat\":-10.601,\"lng\":-75.101,\"methods\":[{\"methodId\":\"$PC\",\"unitsRequired\":10},{\"methodId\":\"$RO\",\"unitsRequired\":5}]}")
check "crear estación con métodos" "$(status "$R")" 201
S1=$(body "$R" | j id)
ST=$(body "$(req GET /projects/$P/stations)")
check "clasificación AID automática" "$(echo "$ST" | j 0.influenceArea)" "AID"
check "unidad de vegetación automática" "$(echo "$ST" | j 0.vegetationUnit)" "Bosque montano (BAPa)"
check "superposición automática" "$(echo "$ST" | j 0.overlap)" "ACR Chonta"
check "10 unidades PC, 0 de RO" "$(echo "$ST" | j 0.units)" "10"
U=$(body "$(req GET /stations/$S1/units)")
check "código de unidad" "$(echo "$U" | j 0.code)" "EM-01-PC01"

R=$(req POST /projects/$P/stations '{"code":"EM-02","lat":-10.65,"lng":-75.15}'); S2=$(body "$R" | j id)
check "estación fuera del AID cae en AII" "$(body "$(req GET /projects/$P/stations)" | j 1.influenceArea)" "AII"

R=$(req PUT /stations/$S1/methods "{\"methods\":[{\"methodId\":\"$PC\",\"unitsRequired\":8},{\"methodId\":\"$RO\",\"unitsRequired\":0}]}"); check "bajar a 8 unidades" "$(status "$R")" 200
check "quedan 8" "$(body "$(req GET /stations/$S1/units)" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))')" "8"
# Simula trabajo de campo en PC08 y verifica que no se pueda borrar
docker exec toce-postgres psql -U toce -d toce -qc "update sampling_units set status='completada' where code='EM-01-PC08' and station_id='$S1'" >/dev/null
R=$(req PUT /stations/$S1/methods "{\"methods\":[{\"methodId\":\"$PC\",\"unitsRequired\":7}]}"); check "no baja si la unidad tiene trabajo de campo" "$(status "$R")" 409
R=$(req PATCH /stations/$S1 '{"code":"EM-99"}'); check "no cambia código con trabajo de campo" "$(status "$R")" 409
R=$(req PUT /stations/$S1/methods "{\"methods\":[{\"methodId\":\"$PC\",\"unitsRequired\":12},{\"methodId\":\"$RO\",\"unitsRequired\":0}]}"); check "subir a 12 continúa la numeración" "$(status "$R")" 200
check "última unidad" "$(body "$(req GET /stations/$S1/units)" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).map(u=>u.code).sort();console.log(a[a.length-1])})')" "EM-01-PC12"

# Brigadas
R=$(req POST /projects/$P/brigades "{\"name\":\"Aves Test\",\"specialtyId\":\"$AVE\",\"leaderId\":null,\"memberIds\":[]}"); check "crear brigada" "$(status "$R")" 201
BA=$(body "$R" | j id)
FLOUSER=$(docker exec toce-postgres psql -U toce -d toce -tAc "select id from users where dni='20000006'")
AVEUSER=$(docker exec toce-postgres psql -U toce -d toce -tAc "select id from users where dni='20000002'")
R=$(req PATCH /brigades/$BA "{\"memberIds\":[\"$FLOUSER\"]}"); check "rechaza especialista de otra especialidad" "$(status "$R")" 400
R=$(req PATCH /brigades/$BA "{\"memberIds\":[\"$AVEUSER\"],\"leaderId\":\"$AVEUSER\"}"); check "agrega especialista de Aves" "$(status "$R")" 200
R=$(req POST /projects/$P/brigades "{\"name\":\"Aves Test 2\",\"specialtyId\":\"$AVE\",\"memberIds\":[\"$AVEUSER\"]}")
check "un especialista no puede estar en dos brigadas" "$(status "$R")" 409

# Cronograma
R=$(req POST /projects/$P/schedules "{\"brigadeId\":\"$BA\",\"plannedDate\":\"2026-12-01\",\"stationIds\":[\"$S1\"]}"); check "programar estación con métodos de la especialidad" "$(status "$R")" 201
R=$(req POST /projects/$P/schedules "{\"brigadeId\":\"$BA\",\"plannedDate\":\"2026-12-01\",\"stationIds\":[\"$S1\"]}"); check "duplicado mismo día" "$(status "$R")" 409
R=$(req POST /projects/$P/schedules "{\"brigadeId\":\"$BA\",\"plannedDate\":\"2026-12-02\",\"stationIds\":[\"$S2\"]}"); check "rechaza estación sin métodos de Aves" "$(status "$R")" 400
R=$(req DELETE /stations/$S1); check "no elimina estación programada" "$(status "$R")" 409

# Especies
R=$(req POST /species/import "{\"specialtyId\":\"$AVE\",\"rows\":[{\"scientificName\":\"Zzz testus\",\"commonName\":\"Prueba\"},{\"scientificName\":\"Zzz testus\"},{\"scientificName\":\"Zzz otherus\",\"family\":\"Testidae\"}]}")
check "importar especies (2 nuevas, 1 duplicada en archivo)" "$(body "$R" | j inserted)/$(body "$R" | j duplicatesInFile)" "2/1"
R=$(req POST /species/import "{\"specialtyId\":\"$AVE\",\"rows\":[{\"scientificName\":\"Zzz testus\",\"family\":\"Testidae\"}]}")
check "reimportar actualiza" "$(body "$R" | j updated)" "1"
check "buscar especie" "$(body "$(req GET "/species?specialtyId=$AVE&q=testus")" | j total)" "1"
docker exec toce-postgres psql -U toce -d toce -qc "delete from species where scientific_name like 'Zzz %'" >/dev/null

# Método: editor de formulario
R=$(req PATCH /methods/$PC '{"formSchema":{"fields":[{"key":"a","label":"A","type":"text"},{"key":"a","label":"B","type":"text"}]}}'); check "formulario con claves repetidas se rechaza" "$(status "$R")" 400
R=$(req PATCH /methods/$PC '{"formSchema":{"fields":[{"key":"a","label":"A","type":"select","options":[]}]}}'); check "lista sin opciones se rechaza" "$(status "$R")" 400

# Permisos
TE=$(curl -s -X POST $B/auth/login -H 'content-type: application/json' -d '{"dni":"10000002","password":"Toce2026"}' | j accessToken)
check "jefe de proyecto puede ver estaciones" "$(curl -s -o /dev/null -w '%{http_code}' $B/projects/$P/stations -H "authorization: Bearer $TE")" 200
check "jefe de proyecto no puede crear estaciones" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/projects/$P/stations -H "authorization: Bearer $TE" -H 'content-type: application/json' -d '{"code":"X1","lat":0,"lng":0}')" 403

docker exec toce-postgres psql -U toce -d toce -qc "delete from projects where code='ZZTEST'" >/dev/null
echo; [ $FAILS -eq 0 ] && echo "Todas las pruebas de configuración pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
