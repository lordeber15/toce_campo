#!/usr/bin/env bash
# Prueba el paquete de trabajo (Sprint 1.2) contra el API local con los datos de ejemplo (pnpm db:seed).
# Solo lee datos: no modifica nada salvo el registro de descargas, que limpia al final.
set -u
B=${API:-http://localhost:4000/api}
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"Toce2026\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).accessToken))'; }
# Evalúa una expresión JS sobre el paquete (variable p).
pk() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

echo "Paquete de trabajo"
check "sin sesión responde 401" "$(curl -s -o /dev/null -w '%{http_code}' $B/work-package)" 401

ANA=$(curl -s "$B/work-package?deviceId=smoke-wp" -H "authorization: Bearer $(token 20000001)")
check "jefa de brigada: su brigada" "$(echo "$ANA" | pk 'p.brigades.map(b=>b.name+":"+b.myRoles).join()')" "Sierra 2:jefe"
check "jefa de brigada: incluye a los miembros" "$(echo "$ANA" | pk 'p.brigades[0].members.length')" 2
check "solo métodos de Aves" "$(echo "$ANA" | pk '[...new Set(p.methods.map(m=>m.specialtyCode))].join()')" AVE
check "programación en la ventana de días" "$(echo "$ANA" | pk 'p.schedules.length>0 && p.schedules.every(s=>s.plannedDate>=p.from && s.plannedDate<=p.to)')" true
check "unidades solo de sus métodos" "$(echo "$ANA" | pk 'p.units.every(u=>p.methods.some(m=>m.id===u.methodId))')" true
check "estaciones con coordenadas" "$(echo "$ANA" | pk 'p.stations.every(s=>typeof s.lat==="number"&&typeof s.lng==="number")')" true
check "formularios incluidos" "$(echo "$ANA" | pk 'p.methods.every(m=>Array.isArray(m.formSchema.fields))')" true

check "capas del proyecto incluidas" "$(echo "$ANA" | pk 'p.layers.length>0 && p.layers.every(l=>l.geometry && l.geometry.type)')" true
check "zona del mapa del proyecto" "$(echo "$ANA" | pk 'p.projects.every(x=>Array.isArray(x.bounds)&&x.bounds.length===4)')" true
# La verificación offline (packages/shared/src/areas.ts) debe dar lo mismo que el servidor para cada estación.
CMP=$(echo "$ANA" | (cd "$(dirname "$0")/.." && npx tsx -e '
  import { classifyPoint } from "./packages/shared/src/areas.ts";
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const p = JSON.parse(s);
    const bad = p.stations.filter((st) => {
      const c = classifyPoint(p.layers.filter((l) => l.projectId === st.projectId), st.lat, st.lng);
      return c.influence !== st.influenceArea || (c.vegetation || "Sin unidad de vegetación") !== st.vegetationUnit;
    });
    console.log(bad.length ? "difiere: " + bad.map((b) => b.code).join(",") : "igual");
  });'))
check "verificación de área offline = servidor" "$CMP" igual

V=$(echo "$ANA" | pk 'p.version')
check "misma versión responde sin cambios" "$(curl -s "$B/work-package?version=$V" -H "authorization: Bearer $(token 20000001)" | pk 'p.unchanged')" true

FLO=$(curl -s "$B/work-package" -H "authorization: Bearer $(token 20000006)")
check "especialista de Flora: solo Flora" "$(echo "$FLO" | pk '[...new Set(p.methods.map(m=>m.specialtyCode))].join()')" FLO
check "Flora no recibe unidades de Aves" "$(echo "$FLO" | pk 'p.units.some(u=>u.code.includes("-PC"))')" false

COO=$(curl -s "$B/work-package" -H "authorization: Bearer $(token 10000001)")
check "coordinador sin brigada: paquete vacío" "$(echo "$COO" | pk 'p.brigades.length+p.schedules.length')" 0

docker exec toce-postgres psql -U toce -d toce -qc "delete from work_package_downloads where device_id = 'smoke-wp'" >/dev/null

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas del paquete de trabajo pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
