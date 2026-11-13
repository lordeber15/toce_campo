#!/usr/bin/env bash
# Prueba el mapa base OSM servido por el API (Sprint 1.4). Requiere conexión a internet la primera vez
# (lee teselas de la compilación pública de Protomaps y las guarda en MinIO).
set -u
B=${API:-http://localhost:4000/api}/basemap
FAILS=0
check() { [ "$2" = "$3" ] && echo "  OK   $1" || { echo "  FAIL $1: esperado [$3], obtenido [$2]"; FAILS=$((FAILS+1)); }; }
code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

echo "Mapa base"
STYLE=$(curl -s "$B/style.json")
check "estilo con fuente de teselas propia" "$(echo "$STYLE" | node -pe 'const p=JSON.parse(require("fs").readFileSync(0));p.sources.protomaps.tiles[0].includes("/api/basemap/tiles/")&&p.layers.length>20')" true
check "estilo sin dependencias externas" "$(echo "$STYLE" | node -pe 'const p=JSON.parse(require("fs").readFileSync(0));[p.glyphs,p.sprite].every(u=>u.includes("/api/basemap/"))')" true
# Tesela z14 de la zona del proyecto de ejemplo (EM-23).
check "tesela de la zona del proyecto" "$(code "$B/tiles/14/4773/8677.mvt")" 200
check "tesela lejos de los proyectos: vacía" "$(code "$B/tiles/14/4000/4000.mvt")" 204
check "zoom general en cualquier zona" "$(code "$B/tiles/3/2/4.mvt")" 200
check "zoom mayor al máximo: rechazado" "$(code "$B/tiles/16/1/1.mvt")" 400
check "fuente" "$(code "$B/fonts/Noto%20Sans%20Regular/0-255.pbf")" 200
check "fuente no permitida" "$(code "$B/fonts/..%2F..%2Fetc/0-255.pbf")" 400
check "íconos" "$(code "$B/sprites/light@2x.json")" 200
check "íconos no permitidos" "$(code "$B/sprites/dark.png")" 400

echo
[ $FAILS -eq 0 ] && echo "Todas las pruebas del mapa base pasaron" || { echo "$FAILS pruebas fallaron"; exit 1; }
