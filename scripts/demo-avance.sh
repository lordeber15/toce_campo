#!/usr/bin/env bash
# Carga un avance de ejemplo (visitas repartidas en los últimos días y unidades ejecutadas, algunas fuera de
# fecha) para ver el tablero "Avance de brigadas" con datos. Con --limpiar lo deshace y deja todo como estaba.
# Ojo: mientras está cargado, los teléfonos verán esas unidades como completadas.
set -eu
DIR=$(cd "$(dirname "$0")" && pwd)
if [ "${1:-}" = "--limpiar" ]; then
  docker exec -i toce-postgres psql -U toce -d toce -tAq < "$DIR/sql/demo-avance-limpiar.sql"
else
  if [ "$(docker exec toce-postgres psql -U toce -d toce -tAc "select to_regclass('demo21_backup') is not null")" = "t" ]; then
    echo "El avance de ejemplo ya está cargado (usa --limpiar para quitarlo)"; exit 1
  fi
  docker exec -i toce-postgres psql -U toce -d toce -tAq < "$DIR/sql/demo-avance.sql"
fi
