#!/usr/bin/env bash
# Prueba el seguimiento de avance (Sprint 2.1): carga el avance de ejemplo, verifica los indicadores del
# proyecto y de una brigada, la desviación del cronograma y los permisos. Al final deja la base como estaba.
set -u
B=${API:-http://localhost:4000/api}
DIR=$(cd "$(dirname "$0")" && pwd)
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
token() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"dni\":\"$1\",\"password\":\"Toce2026\"}" | js 'p.accessToken'; }
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
psql() { docker exec toce-postgres psql -U toce -d toce -tAc "$1"; }

"$DIR/demo-avance.sh" >/dev/null || { echo "No se pudo cargar el avance de ejemplo"; exit 1; }
trap '"$DIR/demo-avance.sh" --limpiar >/dev/null' EXIT

COO=$(token 10000001); JP=$(token 10000002); ANA=$(token 20000001)
PROJ=$(psql "select id from projects where deleted_at is null order by created_at limit 1")
T=$(curl -s "$B/projects/$PROJ/tracking" -H "authorization: Bearer $COO")

echo "Seguimiento de avance"
check "tablero del proyecto con brigadas y curva" "$(echo "$T" | js 'p.brigades.length>0 && p.curve.length>1')" true
check "unidades del proyecto = suma de brigadas" "$(echo "$T" | js 'p.metrics.unitsRequired===p.brigades.reduce((a,b)=>a+b.metrics.unitsRequired,0) && p.metrics.unitsDone===p.brigades.reduce((a,b)=>a+b.metrics.unitsDone,0)')" true
check "avance = completadas / requeridas" "$(echo "$T" | js 'p.metrics.progressPct===Math.round(p.metrics.unitsDone/p.metrics.unitsRequired*1000)/10')" true
check "completadas coinciden con la base" "$(echo "$T" | js 'p.metrics.unitsDone')" "$(psql "
  select count(*) from sampling_units su join station_methods sm on sm.id=su.station_method_id join methods m on m.id=su.method_id and not m.is_open_ended
  where su.status='completada' and exists (select 1 from schedules sc join brigades b on b.id=sc.brigade_id
    where sc.station_id=su.station_id and sc.status<>'cancelada' and (b.specialty_id is null or b.specialty_id=m.specialty_id))")"
check "desviación: ejecutadas fuera de fecha (día siguiente)" "$(echo "$T" | js 'p.metrics.offDateUnits>0 && p.metrics.deviationPct===Math.round(p.metrics.offDateUnits/p.metrics.executedUnits*1000)/10')" true
check "reprogramada con aprobación no cuenta como desviación" "$(echo "$T" | js 'p.metrics.rescheduledUnits>0')" true
check "estaciones atrasadas detectadas" "$(echo "$T" | js 'p.metrics.stationsLate>0 && p.brigades.some(b=>b.flag==="atrasada")')" true
check "curva: completado acumulado = completadas" "$(echo "$T" | js 'p.curve.filter(c=>c.done!=null).pop().done===p.metrics.executedUnits')" true
check "curva: programado final = requeridas" "$(echo "$T" | js 'p.curve[p.curve.length-1].planned===p.metrics.unitsRequired')" true

BRIG=$(echo "$T" | js 'p.brigades[0].id')
D=$(curl -s "$B/brigades/$BRIG/tracking" -H "authorization: Bearer $JP")
check "vista de brigada (jefe de proyecto)" "$(echo "$D" | js "p.brigade.id==='$BRIG' && p.brigade.members.length>0 && Array.isArray(p.alerts)")" true
check "brigada coincide con el tablero" "$(echo "$D" | js 'p.brigade.metrics.unitsDone')" "$(echo "$T" | js "p.brigades.find(b=>b.id==='$BRIG').metrics.unitsDone")"
check "última sincronización del equipo" "$(echo "$D" | js 'p.brigade.members.some(m=>m.lastSyncAt && !isNaN(Date.parse(m.lastSyncAt)))')" true
PAST=$(TZ=America/Lima date -v-30d +%Y-%m-%d)
check "fecha de corte en el pasado: nada vencido" "$(curl -s "$B/projects/$PROJ/tracking?date=$PAST" -H "authorization: Bearer $COO" | js 'p.metrics.stationsDue+":"+p.metrics.stationsLate')" "0:0"
check "especialista no ve el tablero: 403" "$(curl -s -o /dev/null -w '%{http_code}' "$B/projects/$PROJ/tracking" -H "authorization: Bearer $ANA")" 403

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas de seguimiento pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
