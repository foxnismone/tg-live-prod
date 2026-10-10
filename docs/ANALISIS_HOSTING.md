# Análisis de Proveedores de Hosting

Evaluación de opciones gratuitas para publicar TecnoGamer, con la razón técnica de cada descarte.

---

## ⚠️ InfinityFree — DESCARTADO (imposible técnicamente)

No es cuestión de configuración: **el plan gratuito no ejecuta Node.js**.

| Requisito del proyecto | InfinityFree (gratis) |
|---|---|
| Node.js / Express | ❌ **No existe.** Solo PHP 8.3 |
| npm y dependencias | ❌ Sin SSH ni npm en el servidor |
| SQLite (`node:sqlite`) | ❌ Solo MySQL/MariaDB |
| API para software de taller | ❌ **Prohibido por sus términos** |
| Cron / tareas programadas | ❌ Deshabilitado desde agosto 2023 |
| SMTP / email | ❌ Solo en planes pagados |
| Clientes no-navegador | ❌ El bot protection bloquea APIs |

Cita del foro oficial de InfinityFree:

> *"Our hosting doesn't support Node.js. Our hosting is free hosting, and free hosting does not support Node.js. **So if you are asking how to publish your Node.js app here, then the answer is: you can't do it, because it's not possible.**"*

**El bloqueo más grave para este proyecto:** sus términos **prohíben alojar una API, base de datos o archivos para una aplicación**. El módulo de taller existe precisamente para que un software externo suba estados vía API — eso violaría las condiciones de uso.

Además, Node.js solo está disponible en el hosting **premium de iFastNet** (otra empresa), no en InfinityFree.

**Coste de adaptarse:** reescribir ~4.000 líneas de backend de Node a PHP, migrar SQLite a MySQL y perder JWT, multer y sharp. No es viable.

---

## 🎯 La decisión clave: ¿dónde viven los datos?

El sitio guarda **órdenes de trabajo, consultas de clientes, productos y fotos**. Eso exige **disco persistente**.

> **Disco efímero = pérdida de datos.** En un hosting con disco efímero, cada despliegue o reinicio borra la base SQLite y las imágenes. Se perderían las órdenes de taller de los clientes.

---

## Comparativa

| Plataforma | Gratis | Tarjeta | Disco persistente | Cold start | Veredicto |
|---|---|---|---|---|---|
| **Oracle Cloud Always Free** | ✅ para siempre | Solo verificación | ✅ **Sí** | Ninguno | ⭐ **Recomendada** |
| **Render Free + Neon** | ✅ | ❌ No pide | ✅ (en Neon) | ~60 s | Buena, requiere migrar a PostgreSQL |
| **Render Free** | ✅ 750 h/mes | ❌ No pide | ❌ **Efímero** | ~60 s | ⚠️ Solo demo |
| **SnapDeploy** | ✅ 100 h/mes | ❌ No pide | ❌ Efímero | ~60 s | Solo demo |
| **Koyeb** | ✅ 1 servicio | ⚠️ Retención $29 | ❌ Efímero | Variable | Solo demo |
| **Railway** | $1/mes crédito | ❌ No pide | ✅ | Ninguno | Se agota el crédito |
| **Fly.io** | ❌ Ya no tiene tier gratis | — | — | — | Desde ~$2/mes |
| **InfinityFree** | ✅ | — | — | — | ❌ **No soporta Node** |

---

## ⭐ Opción recomendada: Oracle Cloud Always Free

Gratis **sin caducidad**, con disco persistente real. La pega: hay que administrar una VM Linux — el script `deploy-oracle.sh` lo automatiza por completo.

### Paso 1 — Crear la VM

1. Cuenta en https://www.oracle.com/cloud/free/ (pide tarjeta solo para verificar identidad, **no cobra**)
2. **Compute → Instances → Create Instance**
3. Imagen: **Ubuntu 24.04**
4. Shape: **VM.Standard.E2.1.Micro** (marcado *Always Free*)
5. Descarga la clave SSH y guarda la IP pública

### Paso 2 — Abrir los puertos (imprescindible)

En **Networking → Virtual Cloud Networks → Security Lists → Default Security List**, añade reglas de entrada:

| Puerto | Protocolo | Origen |
|---|---|---|
| 80 | TCP | 0.0.0.0/0 |
| 443 | TCP | 0.0.0.0/0 |

Sin esto el sitio no será accesible desde internet, aunque el servicio funcione.

### Paso 3 — Desplegar

```bash
ssh -i tu-clave.key ubuntu@TU-IP

curl -fsSL https://raw.githubusercontent.com/foxnismone/tg-live-prod/master/deploy-oracle.sh -o deploy.sh
sudo bash deploy.sh
```

El script instala Node 22, Nginx, Certbot, configura el cortafuegos, genera un `JWT_SECRET` aleatorio, crea el servicio systemd y verifica que `/health` responda.

### Paso 4 — Con dominio propio (HTTPS automático)

```bash
sudo DOMAIN=tudominio.cl bash deploy.sh
```

Certbot solicita el certificado y configura la redirección a HTTPS.

### Actualizar tras cambios en el código

```bash
sudo bash /opt/tecnogamer/deploy-oracle.sh
```

---

## 🐳 Alternativa: Docker

El proyecto incluye `Dockerfile` y `docker-compose.yml` **portables** — funcionan en Koyeb, Fly.io, Cloud Run, Railway o cualquier VPS.

```bash
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export SITE_URL=https://tudominio.cl
export CORS_ORIGIN=https://tudominio.cl

docker compose up -d          # levantar
docker compose logs -f        # ver logs
docker compose up -d --build  # actualizar
```

Los datos viven en **volúmenes nombrados** (`tecnogamer-data`, `tecnogamer-uploads`), así que sobreviven a reinicios y actualizaciones.

---

## Render (rápido, con advertencia)

`render.yaml` ya está configurado. Conecta el repositorio en https://dashboard.render.com/web/new

| Ajuste | Valor |
|---|---|
| Build Command | `npm install --ignore-scripts` |
| Start Command | `node backend/server.js` |
| Plan | Free |
| `JWT_SECRET` | `generateValue: true` |
| `SITE_URL` / `CORS_ORIGIN` | tu URL de Render |

**⚠️ Advertencia crítica:** el disco de Render Free es **efímero**. Cada despliegue o reinicio borra `data/` y `uploads/`. Sirve para demostrar el sitio, **no para uso real**.

**Solución intermedia:** Render Free para la aplicación + PostgreSQL gratuito de Neon para los datos. Requiere migrar de SQLite a PostgreSQL.

---

## Verificación post-despliegue

```bash
curl -I https://tudominio.cl/health              # espera 200
curl -o /dev/null -w "%{http_code}\n" https://tudominio.cl/
curl -o /dev/null -w "%{http_code}\n" https://tudominio.cl/reparaciones.html
curl -o /dev/null -w "%{http_code}\n" https://tudominio.cl/admin.html
curl https://tudominio.cl/api/v1/config | head -c 300
```

---

## Lista de verificación antes de abrir al público

- [ ] `JWT_SECRET` aleatorio de 64 caracteres (el script lo genera)
- [ ] `NODE_ENV=production` (activa HSTS y bloquea stack traces)
- [ ] `CORS_ORIGIN` apunta al dominio real, **no** `*`
- [ ] HTTPS activo con redirección desde HTTP
- [ ] Contraseña del admin cambiada (la inicial aparece en los logs del primer arranque)
- [ ] Copias de seguridad automáticas activas
- [ ] Puertos 80/443 abiertos en el cortafuegos **y** en el panel del proveedor
- [ ] `SITE_URL` correcto (se usa en los enlaces de recuperación de contraseña)
