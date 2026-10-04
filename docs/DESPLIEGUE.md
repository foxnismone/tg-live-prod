# Guía de despliegue a producción — TecnoGamer

---

## 1. Antes de desplegar (obligatorio)

### 1.1 Generar secretos reales

```bash
# JWT_SECRET — 256 bits aleatorios
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Contraseña del admin (hash bcrypt)
node -e "console.log(require('bcryptjs').hashSync('TU_CLAVE_SEGURA', 12))"
```

Editar `.env`:

```env
NODE_ENV=production
PORT=3000
HOST=127.0.0.1

JWT_SECRET=<el valor generado arriba>
ADMIN_EMAIL=tu-correo-real@tudominio.com
ADMIN_PASSWORD_CIPHER=<el hash bcrypt>

# Pasarela de pago
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Descripciones con IA
AI_API_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini

# Dominio y CORS
SITE_URL=https://tudominio.com
SITE_NAME=TecnoGamer
CORS_ORIGIN=https://tudominio.com

# Email
EMAIL_SERVICE=smtp
EMAIL_USER=no-reply@tudominio.com
EMAIL_PASS=<clave-de-aplicacion>
EMAIL_FROM=no-reply@tudominio.com
```

### 1.2 Verificar que el `.env` no se sube al repositorio

```bash
grep -q "^\.env$" .gitignore || echo ".env" >> .gitignore
```

---

## 2. Despliegue con systemd (VPS Linux)

### 2.1 Servicio

`/etc/systemd/system/tecnogamer.service`:

```ini
[Unit]
Description=TecnoGamer E-Commerce
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/tecnogamer
ExecStart=/usr/bin/node backend/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Endurecimiento del proceso
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/www/tecnogamer/data /var/www/tecnogamer/uploads /var/www/tecnogamer/backups

Environment=NODE_ENV=production
EnvironmentFile=/var/www/tecnogamer/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tecnogamer
sudo systemctl status tecnogamer
```

### 2.2 Proxy inverso con Caddy (TLS automático)

`/etc/caddy/Caddyfile`:

```
tudominio.com {
    encode zstd gzip

    # Cabeceras de seguridad (Helmet ya las pone; aquí se refuerzan)
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        -Server
    }

    # Límite de tamaño de subida
    request_body {
        max_size 12MB
    }

    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

> **Importante:** al usar proxy inverso, configurar `app.set("trust proxy", 1)` para que el
> rate limiting vea la IP real del cliente y no la del proxy.

### 2.3 Alternativa con Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name tudominio.com;

    ssl_certificate     /etc/letsencrypt/live/tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tudominio.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 12M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads/ {
        alias /var/www/tecnogamer/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}

server {
    listen 80;
    server_name tudominio.com;
    return 301 https://$host$request_uri;
}
```

---

## 3. Despliegue con Docker

`Dockerfile`:

```dockerfile
FROM node:22-alpine

WORKDIR /app

# Solo dependencias de producción, sin scripts nativos
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .

# El usuario no-root es obligatorio en producción
RUN mkdir -p data uploads backups && \
    chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/server.js"]
```

`docker-compose.yml`:

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
      - ./backups:/app/backups
    expose:
      - "3000"

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on:
      - app

volumes:
  caddy_data:
```

---

## 4. Copias de seguridad

### Manual

```bash
curl -X POST https://tudominio.com/api/v1/admin/backup \
  -H "Authorization: Bearer <token-admin>"
```

### Automática (cron diario a las 03:00)

```cron
0 3 * * * /usr/bin/node /var/www/tecnogamer/tools/backup.js >> /var/log/tecnogamer-backup.log 2>&1
```

**Regla de oro:** guardar una copia **fuera del servidor** (S3, Backblaze, rsync a otra máquina).
Una copia que vive en el mismo disco no protege contra el fallo de ese disco.

---

## 5. Verificación post-despliegue

```bash
# 1. Salud
curl -s https://tudominio.com/health | jq

# 2. Cabeceras de seguridad
curl -sI https://tudominio.com/ | grep -iE "strict-transport|content-security|x-frame|x-content-type"

# 3. Que no se filtre el servidor
curl -sI https://tudominio.com/ | grep -i "x-powered-by" || echo "✅ X-Powered-By oculto"

# 4. HTTPS forzado
curl -sI http://tudominio.com/ | grep -i location

# 5. Suite completa contra producción
node tools/api-tests.js https://tudominio.com
node tools/e2e-tests.js https://tudominio.com

# 6. Auditoría de dependencias
npm audit --audit-level=high

# 7. Rendimiento
npx lighthouse https://tudominio.com --only-categories=performance,accessibility,best-practices,seo
```

**Lista de comprobación final:**

- [ ] HTTPS activo y renovación automática del certificado
- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` aleatorio y distinto del de desarrollo
- [ ] Contraseña del admin cambiada
- [ ] `CORS_ORIGIN` restringido al dominio real
- [ ] Pasarela de pago con claves de producción
- [ ] Webhook de pago con la firma verificada
- [ ] Copias de seguridad automáticas + copia externa
- [ ] Logs centralizados
- [ ] Monitorización de disponibilidad
- [ ] `npm audit` sin vulnerabilidades altas
- [ ] Las 115 pruebas pasan contra producción

---

## 6. Escalado

**Cuando el tráfico crezca:**

1. **Rate limiting compartido** — el actual es en memoria; con varias instancias usar Redis:
   ```bash
   npm install rate-limit-redis ioredis
   ```

2. **PostgreSQL** — el esquema es estándar. Cambiar el driver en `config/database.js`
   y ajustar los `AUTOINCREMENT` a `SERIAL`.

3. **Carrito en Redis** — hoy vive en SQLite; con muchas sesiones concurrentes conviene Redis.

4. **Imágenes en CDN** — mover `uploads/` a S3/R2 y servir por CDN.

5. **Réplicas** — el servidor es sin estado (salvo el rate limit), así que escala horizontalmente
   tras poner el limitador en Redis.

---

## 7. Monitorización mínima

| Qué | Herramienta sugerida |
|-----|---------------------|
| Disponibilidad | UptimeRobot, Better Stack |
| Errores | Sentry |
| Logs | journald + Loki, o Papertrail |
| Métricas | Prometheus + Grafana |
| Alertas | Aviso ante 5xx, caída o pico de 401/403 |

---

## 8. Rollback

```bash
# Con systemd
sudo systemctl stop tecnogamer
git checkout <commit-anterior>
npm ci --omit=dev --ignore-scripts
# Restaurar la copia de seguridad de la base de datos si hubo migración
cp backups/backup-<fecha>.db data/ecommerce.db
sudo systemctl start tecnogamer
```

**Antes de cada despliegue:** crear copia de seguridad y verificar que se puede restaurar.
Una copia que nunca se ha restaurado no es una copia de seguridad, es una esperanza.
