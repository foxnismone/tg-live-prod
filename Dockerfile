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

FROM node:22-alpine

# ─── Dependencias del sistema ────────────────────────────────
# curl  → healthcheck del contenedor
# tini  → manejo correcto de señales (PID 1)
RUN apk add --no-cache curl tini

WORKDIR /app

# ─── Dependencias de Node ────────────────────────────────────
# Se copian primero los manifiestos para aprovechar la caché de capas:
# si el código cambia pero package.json no, npm install no se repite.
COPY package.json package-lock.json* ./

# --ignore-scripts evita que un módulo nativo (better-sqlite3) rompa
# la instalación completa: el proyecto usa el adaptador node:sqlite.
# --omit=dev deja fuera las dependencias de desarrollo.
RUN npm install --ignore-scripts --omit=dev && npm cache clean --force

# ─── Código de la aplicación ─────────────────────────────────
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY scripts/ ./scripts/
COPY tools/ ./tools/ 2>/dev/null || true

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

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "backend/server.js"]
