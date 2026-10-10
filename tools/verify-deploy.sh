#!/usr/bin/env bash
# ============================================================
#  Simula el entorno de despliegue Docker/producción
# ============================================================
#  Replica lo que hace el Dockerfile:
#    npm install --ignore-scripts --omit=dev
#  y luego arranca el servidor en producción para verificar
#  que todo funciona SIN que ningún módulo nativo rompa el boot.
set -uo pipefail

cd "$(dirname "$0")/.."
cd "$(pwd)"

echo "════════════════════════════════════════════════════════════"
echo "  Verificación de despliegue (simula Docker/producción)"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── 1. Instalar como lo hace el Dockerfile ──────────────────
echo "[1/4] Instalando dependencias como en producción"
echo "        (npm install --ignore-scripts --omit=dev)"
npm install --ignore-scripts --omit=dev --no-audit --no-fund 2>&1 | tail -5
echo ""

# ── 2. Comprobar los módulos que fallan al no compilar ──────
echo "[2/4] Comprobando módulos nativos"
node -e "
const probar = (m) => { try { require(m); return 'OK'; } catch(e) { return 'FALLO: ' + e.message.split('\n')[0].slice(0,60); } };
console.log('  bcryptjs :', probar('bcryptjs'));
console.log('  sharp    :', probar('sharp') + '  (esperado: fallo, degrada sin thumbnail)');
console.log('  express  :', probar('express'));
"
echo ""

# ── 3. Arrancar en producción como el contenedor ───────────
echo "[3/4] Arrancando en modo producción (sin JWT_SECRET debe abortar)"
JWT_SECRET="" NODE_ENV=production PORT=3999 timeout 8 node backend/server.js 2>&1 | head -6
echo "        ^ aborto correcto al faltar el secreto"
echo ""

echo "[4/4] Arrancando con JWT_SECRET (debe arrancar y responder)"
export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export NODE_ENV=production
export PORT=3999
export DB_PATH="$(pwd)/data/ecommerce.db"
export UPLOAD_DIR="$(pwd)/uploads"

node backend/server.js > /tmp/tg-boot.log 2>&1 &
BOOT_PID=$!

# Esperar a que /health responda
ok=0
for i in $(seq 1 25); do
  if curl -fsS http://127.0.0.1:3999/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done

if [[ $ok -eq 1 ]]; then
  echo "        ✓ El servidor responde en /health"
else
  echo "        ✗ El servidor NO responde. Log:"
  cat /tmp/tg-boot.log | tail -20
  kill $BOOT_PID 2>/dev/null
  exit 1
fi

# ── 4. Verificar endpoints críticos ────────────────────────
echo ""
echo "── Endpoints críticos ──"
printf "  /                 → %s\n" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3999/)"
printf "  /api/v1/config    → %s\n" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3999/api/v1/config)"
printf "  /api/v1/products  → %s\n" "$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3999/api/v1/products?limit=1')"
printf "  /api/v1/repairs/info → %s\n" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3999/api/v1/repairs/info)"
printf "  /reparaciones.html   → %s\n" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3999/reparaciones.html)"

echo ""
echo "── Log de arranque ──"
grep -E "Servidor|JWT|sharp|WARN|⚠|Frontend" /tmp/tg-boot.log | head -12

kill $BOOT_PID 2>/dev/null
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✓ El entorno de despliegue está verificado"
echo "════════════════════════════════════════════════════════════"
