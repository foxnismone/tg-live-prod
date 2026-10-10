#!/usr/bin/env bash
# ============================================================
#  TecnoGamer — Instalación en un servidor Linux (Oracle Cloud,
#  Ubuntu 22.04/24.04 o Debian 12)
# ============================================================
#  Uso:
#    1. Crear una VM "Always Free" en Oracle Cloud (Ubuntu 24.04)
#    2. Abrir los puertos 80 y 443 en la Security List
#    3. Copiar este script y ejecutarlo:
#         sudo bash deploy-oracle.sh
#
#  Instala: Node 22, Nginx (proxy inverso + HTTPS),
#           Certbot (certificado SSL), PM2 (mantiene el proceso vivo)
#           y un servicio systemd para arrancar al reiniciar.
# ============================================================

set -euo pipefail

# ─── Configuración ───────────────────────────────────────────
APP_DIR="${APP_DIR:-/opt/tecnogamer}"
DOMAIN="${DOMAIN:-}"
REPO_URL="${REPO_URL:-https://github.com/foxnismone/tg-live-prod.git}"
BRANCH="${BRANCH:-master}"

log()  { printf "\n\033[1;32m▶ %s\033[0m\n" "$*"; }
warn() { printf "\n\033[1;33m⚠ %s\033[0m\n" "$*"; }
die()  { printf "\n\033[1;31m✖ %s\033[0m\n" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Ejecuta con sudo:  sudo bash deploy-oracle.sh"

# ─── 1. Dependencias del sistema ─────────────────────────────
log "Instalando dependencias del sistema"
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx ufw

# ─── 2. Node.js 22 (NodeSource) ──────────────────────────────
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
  log "Instalando Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
log "Node $(node -v) · npm $(npm -v)"

# ─── 3. Código de la aplicación ──────────────────────────────
if [[ -d "$APP_DIR/.git" ]]; then
  log "Actualizando código existente en $APP_DIR"
  git -C "$APP_DIR" fetch --all --quiet
  git -C "$APP_DIR" reset --hard "origin/$BRANCH" --quiet
else
  log "Clonando el repositorio en $APP_DIR"
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ─── 4. Dependencias de Node ─────────────────────────────────
# --ignore-scripts: better-sqlite3 no compila en todos los hosts y el
# proyecto usa el adaptador sobre node:sqlite integrado en Node 22+.
log "Instalando dependencias de Node"
npm install --ignore-scripts --omit=dev --no-audit --no-fund

# ─── 5. Variables de entorno ─────────────────────────────────
ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Generando .env con un JWT_SECRET aleatorio"
  JWT="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  SITE="http://${DOMAIN:-$(curl -fsS ifconfig.me 2>/dev/null || echo localhost)}"

  cat > "$ENV_FILE" <<EOF
# Generado por deploy-oracle.sh — NO subir al repositorio
NODE_ENV=production
PORT=3000
HOST=127.0.0.1

# Secreto de firma de sesiones (generado aleatoriamente)
JWT_SECRET=$JWT
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# Rutas de datos persistentes (sobreviven a reinicios y despliegues)
DB_PATH=$APP_DIR/data/ecommerce.db
UPLOAD_DIR=$APP_DIR/uploads
BACKUP_DIR=$APP_DIR/backups
LOG_LEVEL=info

# Sitio
SITE_URL=$SITE
SITE_NAME=TecnoGamer
CORS_ORIGIN=$SITE

# Límites
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=2000

# Módulos (el panel de operador puede cambiarlos después)
CHAT_WEB_ENABLED=true
WHATSAPP_ENABLED=false
EOF
  chmod 600 "$ENV_FILE"
else
  warn "$ENV_FILE ya existe — no se toca"
fi

# ─── 6. Directorios de datos ─────────────────────────────────
log "Preparando directorios de datos persistentes"
mkdir -p "$APP_DIR/data" "$APP_DIR/uploads" "$APP_DIR/backups" "$APP_DIR/logs"

# ─── 7. Servicio systemd ─────────────────────────────────────
log "Creando el servicio systemd"
cat > /etc/systemd/system/tecnogamer.service <<EOF
[Unit]
Description=TecnoGamer E-Commerce
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$(command -v node) $APP_DIR/backend/server.js
Restart=always
RestartSec=10
StandardOutput=append:$APP_DIR/logs/app.log
StandardError=append:$APP_DIR/logs/error.log

# Endurecimiento
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable tecnogamer --quiet
systemctl restart tecnogamer
sleep 4

# ─── 8. Verificación del servicio ────────────────────────────
log "Verificando que el servicio responda"
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    log "Servicio OK — /health responde"
    break
  fi
  [[ $i -eq 20 ]] && die "El servicio no responde. Revisa: journalctl -u tecnogamer -n 50"
  sleep 2
done

# ─── 9. Nginx como proxy inverso ─────────────────────────────
log "Configurando Nginx"
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/tecnogamer <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME;

    client_max_body_size 15M;

    # Cabeceras de seguridad (el backend también las envía)
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/tecnogamer /etc/nginx/sites-enabled/tecnogamer
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ─── 10. Cortafuegos ─────────────────────────────────────────
log "Configurando el cortafuegos (UFW)"
ufw allow 22/tcp   >/dev/null 2>&1 || true
ufw allow 80/tcp   >/dev/null 2>&1 || true
ufw allow 443/tcp  >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

# ─── 11. HTTPS (solo si hay dominio real) ────────────────────
if [[ -n "$DOMAIN" && "$DOMAIN" != "_" ]]; then
  log "Solicitando certificado SSL para $DOMAIN"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
          --register-unsafely-without-email --redirect || \
    warn "Certbot falló. Asegúrate de que el dominio apunte a esta IP y reintenta:
         sudo certbot --nginx -d $DOMAIN"
else
  warn "Sin dominio configurado — se omite HTTPS.
       Para activarlo más tarde:
         sudo DOMAIN=tudominio.cl certbot --nginx -d tudominio.cl"
fi

# ─── Resumen ─────────────────────────────────────────────────
IP="$(curl -fsS ifconfig.me 2>/dev/null || echo 'TU-IP-PUBLICA')"
cat <<EOF

════════════════════════════════════════════════════════════
  ✅  TecnoGamer desplegado
════════════════════════════════════════════════════════════

  URL          http://${DOMAIN:-$IP}
  Tienda       /                     (catálogo)
  Taller       /reparaciones.html    (seguimiento)
  Panel        /admin.html           (operador)

  Datos        $APP_DIR/data/ecommerce.db
  Imágenes     $APP_DIR/uploads
  Copias       $APP_DIR/backups
  Logs         $APP_DIR/logs/

  Credenciales del panel:
    Revisa el correo admin en el primer arranque:
      grep -i "admin" $APP_DIR/logs/app.log | head

  Comandos útiles:
    systemctl status tecnogamer      estado del servicio
    systemctl restart tecnogamer     reiniciar
    journalctl -u tecnogamer -f      ver logs en vivo
    bash $APP_DIR/deploy-oracle.sh   actualizar (re-ejecutar)

  ⚠  RECUERDA en la consola de Oracle Cloud:
     abre los puertos 80 y 443 en la Security List de la VCN,
     o el sitio no será accesible desde internet.

════════════════════════════════════════════════════════════
EOF
