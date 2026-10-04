#!/usr/bin/env bash
# ============================================================
# WATCHDOG — Mantiene el servidor TecnoGamer siempre activo
# ============================================================
# Comprueba cada 10 segundos que /health responda 200.
# Si no, reinicia el servidor. Log en /tmp/tecnogamer-watchdog.log
# ============================================================
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
LOG="/tmp/tecnogamer-watchdog.log"

echo "$(date '+%Y-%m-%d %H:%M:%S') 🐕 watchdog iniciado (puerto $PORT)" >> "$LOG"

while true; do
  code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/health" 2>/dev/null)

  if [ "$code" != "200" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') ⚠️  health=$code → reiniciando servidor" >> "$LOG"
    # Matar cualquier node previo en ese puerto
    MSYS2_ARG_CONV_EXCL='*' taskkill /F /IM node.exe > /dev/null 2>&1
    sleep 2
    node backend/server.js >> "$LOG" 2>&1 &
    sleep 5
    code2=$(curl -s -m 3 -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/health" 2>/dev/null)
    echo "$(date '+%Y-%m-%d %H:%M:%S') ✅ servidor reiniciado (health=$code2)" >> "$LOG"
  fi

  sleep 10
done
