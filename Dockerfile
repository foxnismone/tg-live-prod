# ============================================================
#  TecnoGamer — Imagen de producción
# ============================================================
#  Portable: sirve para Oracle Cloud, Koyeb, Fly.io, Cloud Run,
#  Railway, SnapDeploy o cualquier host que acepte contenedores.
#
#  Build:  docker build -t tecnogamer .
#  Run:    docker run -d -p 3000:3000 \
#            -v tecnogamer-data:/app/data \
#            -v tecnogamer-uploads:/app/uploads \
#            -e JWT_SECRET="$(openssl rand -hex 32)" \
#            tecnogamer
# ============================================================

FROM node:24-bookworm-slim

# ─── Dependencias del sistema ────────────────────────────────
# curl  → healthcheck del contenedor
# tini  → manejo correcto de señales (PID 1)
# Se usa Debian (glibc) en vez de Alpine (musl) porque `sharp` trae
# binarios nativos precompilados para glibc: en musl hay que depender
# de los paquetes linuxmusl y de la detección de libc de npm, que es
# más frágil entre versiones.
#
# Node 24 (no 22): `node:sqlite` es estable desde Node 23/24. En Node 22
# exige el flag --experimental-sqlite y emite un warning en cada arranque.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ─── Dependencias de Node ────────────────────────────────────
# Se copian primero los manifiestos para aprovechar la caché de capas:
# si el código cambia pero package.json no, npm install no se repite.
COPY package.json package-lock.json* ./

# `--ignore-scripts` evita que `better-sqlite3` intente compilar con
# node-gyp y rompa la instalación (el proyecto usa node:sqlite).
# PERO `sharp` SÍ necesita su script de instalación para colocar el
# binario nativo de libvips: se re-habilita explícitamente para él.
RUN npm install --ignore-scripts --omit=dev --no-audit --no-fund \
 && npm rebuild sharp \
 && npm cache clean --force

# Verificar que las dependencias nativas críticas carguen de verdad.
# Un fallo aquí debe romper el build, no aparecer en producción.
RUN node -e "require('sharp'); console.log('sharp OK')" \
 && node -e "require('node:sqlite'); console.log('node:sqlite OK')" \
 && node -e "require('bcryptjs'); console.log('bcryptjs OK')" \
 && node -e "require('jsonwebtoken'); console.log('jsonwebtoken OK')"

# ─── Código de la aplicación ─────────────────────────────────
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY scripts/ ./scripts/
COPY tools/ ./tools/
COPY docs/ ./docs/

# ─── Directorios de datos persistentes ───────────────────────
# Estos dos se montan como volúmenes en producción. Si no se montan,
# los datos viven dentro del contenedor y se pierden al recrearlo.
RUN mkdir -p /app/data /app/uploads /app/backups /app/logs

# ─── Usuario sin privilegios ─────────────────────────────────
# Nunca ejecutar Node como root dentro del contenedor.
RUN chown -R node:node /app
USER node

# ─── Entorno ─────────────────────────────────────────────────
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/ecommerce.db \
    UPLOAD_DIR=/app/uploads \
    BACKUP_DIR=/app/backups

EXPOSE 3000

# ─── Healthcheck ─────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "backend/server.js"]
