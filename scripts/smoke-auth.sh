#!/usr/bin/env bash
# Prueba rápida de autenticación y permisos contra el API local.
set -u
B=${API:-http://localhost:4000/api}
j() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const v=o[process.argv[1]];console.log(typeof v==="object"?JSON.stringify(v):v)})' "$1"; }
post() { curl -s -X POST "$B$1" -H 'content-type: application/json' ${3:+-H "authorization: Bearer $3"} -d "$2"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check() { [ $# -eq 3 ] && [ "$2" = "$3" ] && echo "  OK   $1 ($2)" || { echo "  FAIL $1: esperado $3, obtenido $2"; FAILS=$((FAILS+1)); }; }
FAILS=0

check "health" "$(code $B/health)" 200
check "login con contraseña mala" "$(code -X POST $B/auth/login -H 'content-type: application/json' -d '{"dni":"20000001","password":"mala"}')" 401

L=$(post /auth/login '{"dni":"20000001","password":"Toce2026","deviceId":"device-AAAA-1111"}')
AT=$(echo "$L" | j accessToken); RT=$(echo "$L" | j refreshToken)
echo "  user: $(echo "$L" | j user)"
check "/auth/me" "$(code $B/auth/me -H "authorization: Bearer $AT")" 200
check "especialista no puede listar usuarios" "$(code $B/users -H "authorization: Bearer $AT")" 403
check "sin token -> 401 antes que validación" "$(code -X POST $B/users -H 'content-type: application/json' -d '{}')" 401

R2=$(post /auth/refresh "{\"refreshToken\":\"$RT\"}"); RT2=$(echo "$R2" | j refreshToken)
[ -n "$RT2" ] && [ "$RT2" != "undefined" ] && echo "  OK   refresh rota token" || { echo "  FAIL refresh"; FAILS=$((FAILS+1)); }
check "reintento con token anterior dentro de la gracia (señal débil)" "$(code -X POST $B/auth/refresh -H 'content-type: application/json' -d "{\"refreshToken\":\"$RT\"}")" 200
LG=$(post /auth/login '{"dni":"20000002","password":"Toce2026"}'); LAT=$(echo "$LG" | j accessToken); LRT=$(echo "$LG" | j refreshToken)
curl -s -o /dev/null -X POST $B/auth/logout -H "authorization: Bearer $LAT"
check "token de sesión cerrada (logout) se rechaza" "$(code -X POST $B/auth/refresh -H 'content-type: application/json' -d "{\"refreshToken\":\"$LRT\"}")" 401

post /auth/login '{"dni":"20000002","password":"Toce2026","deviceId":"device-AAAA-1111"}' >/dev/null
check "otro usuario en mismo dispositivo revoca sesión previa" "$(code -X POST $B/auth/refresh -H 'content-type: application/json' -d "{\"refreshToken\":\"$RT2\"}")" 401

C=$(post /auth/login '{"dni":"10000001","password":"Toce2026"}' | j accessToken)
check "coordinador lista usuarios" "$(code $B/users -H "authorization: Bearer $C")" 200
DNI=3$(date +%s | tail -c 8)
NEWUSER="{\"dni\":\"$DNI\",\"fullName\":\"Prueba Uno\",\"password\":\"secreto1\",\"roles\":[\"especialista\"]}"
CREATED=$(curl -s -X POST $B/users -H "authorization: Bearer $C" -H 'content-type: application/json' -d "$NEWUSER" | j id)
[ -n "$CREATED" ] && [ "$CREATED" != "undefined" ] && echo "  OK   crear usuario" || { echo "  FAIL crear usuario"; FAILS=$((FAILS+1)); }
check "DNI duplicado" "$(code -X POST $B/users -H "authorization: Bearer $C" -H 'content-type: application/json' -d "$NEWUSER")" 409
check "validación de datos" "$(code -X POST $B/users -H "authorization: Bearer $C" -H 'content-type: application/json' -d '{"dni":"x","fullName":"a","password":"1","roles":[]}')" 400
check "eliminar usuario de prueba" "$(code -X DELETE $B/users/$CREATED -H "authorization: Bearer $C")" 200
check "catálogo de métodos" "$(code $B/methods -H "authorization: Bearer $C")" 200

echo; [ $FAILS -eq 0 ] && echo "Todas las pruebas pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
