#!/usr/bin/env bash
# ============================================================
# TecnoGamer — Arranque del servidor (desarrollo/producción)
# ============================================================
# Uso:  bash start.sh [dev|prod]
# ============================================================
set -e
cd "$(dirname "$0")"

MODE="${1:-dev}"

if [ "$MODE" = "prod" ]; then
  export NODE_ENV=production
  echo "▶  Modo PRODUCCIÓN"
else
  export NODE_ENV=development
  echo "▶  Modo DESARROLLO"
fi

# Liberar el puerto si está ocupado por un node previo
PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)
PORT="${PORT:-3000}"

echo "🔌  Puerto: $PORT"
echo "🚀  Iniciando servidor..."
exec node backend/server.js
