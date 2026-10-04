# Análisis de Hosting Gratuito para Producción — TecnoGamer

**Fecha:** 2026-10-03
**Objetivo:** Identificar opciones de hosting gratuito para desplegar el sitio de forma completa y segura, con evaluación de viabilidad para producción.

---

## 1. Resumen ejecutivo

| Plataforma | Gratis | SSL | Base de datos | Cold start | Tarjeta | Veredicto |
|---|---|---|---|---|---|---|
| **Render** | ✅ 750 h/mes | ✅ Auto | ✅ PostgreSQL | ❌ 30-60 s | ❌ No | **Mejor opción gratuita** |
| **Railway** | ✅ $1/mes crédito | ✅ Auto | ✅ PostgreSQL | ❌ Al agotar crédito | ❌ No (trial) | Buena para prototipos |
| **SnapDeploy** | ✅ 4 contenedores | ✅ Auto | ❌ Solo archivos | ✅ No | ❌ No | Buena para demos |
| **Fly.io** | ❌ Desde oct 2024 | ✅ Auto | ✅ PostgreSQL | ✅ No | ✅ Sí | Ya no tiene tier gratuito |
| **Vercel** | ✅ Hobby | ✅ Auto | ✅ Serverless | ✅ No | ❌ No | Solo frontend estático |
| **Netlify** | ✅ 100 GB/mes | ✅ Auto | ❌ Solo archivos | ✅ No | ❌ No | Solo frontend estático |
| **GitHub Pages** | ✅ Ilimitado | ✅ Auto | ❌ Solo archivos | ✅ No | ❌ No | Solo frontend estático |
| **Cloudflare Pages** | ✅ Ilimitado | ✅ Auto | ❌ Solo archivos | ✅ No | ❌ No | Solo frontend estático |

**Conclusión:** Para un despliegue **completo** (frontend + API + base de datos) con HTTPS y sin cold starts, **Render** es la mejor opción gratuita. Para un despliegue **solo frontend** (estático), **Cloudflare Pages** o **Vercel** son superiores.

---

## 2. Análisis detallado de cada plataforma

### 2.1 Render — ✅ Recomendado para producción gratuita

**Ventajas:**
- Tier gratuito de 750 horas/mes (suficiente para un sitio con tráfico moderado)
- HTTPS automático con certificado Let's Encrypt
- PostgreSQL gestionado incluido (migra desde SQLite sin cambios)
- Despliegue automático desde GitHub
- Sin cold start en planes de pago ($7/mes)
- Dominio personalizado incluido
- Variables de entorno gestionadas
- Logs y métricas incluidos

**Limitaciones:**
- **Cold start de 30-60 segundos** en el tier gratuito tras 15 minutos de inactividad
- 512 MB de RAM en el tier gratuito (suficiente para Node.js + SQLite)
- 5 GB de ancho de banda en el workspace Hobby
- El tier gratuito se duerme tras 15 minutos sin tráfico

**Precio:** Gratis (750 h/mes) → $7/mes (Starter, sin cold start)

**Veredicto:** ✅ **Mejor opción gratuita para producción.** El cold start es molesto pero aceptable para un sitio en lanzamiento. Cuando el tráfico crezca, el plan de $7/mes lo elimina.

---

### 2.2 Railway — Buena para prototipos

**Ventajas:**
- Interfaz excelente, muy fácil de usar
- PostgreSQL gestionado incluido
- Despliegue automático desde GitHub
- Variables de entorno gestionadas
- Soporte para múltiples servicios

**Limitaciones:**
- El tier gratuito solo tiene $1/mes de crédito (se agota rápido)
- Requiere tarjeta de crédito para planes de pago
- El crédito se agota en lugar de dormir el servicio

**Precio:** $1/mes crédito (gratis) → $5/mes (Hobby)

**Veredicto:** 🟡 Buena para prototipos y MVPs, pero el crédito gratuito se agota rápidamente.

---

### 2.3 SnapDeploy — Buena para demos

**Ventajas:**
- 4 contenedores gratis con 512 MB cada uno
- 100 horas/mes de contenedor
- 10 despliegues al día
- HTTPS automático
- Sin tarjeta de crédito
- Sin cold start

**Limitaciones:**
- No incluye base de datos gestionada (solo archivos)
- Requiere Dockerfile o package.json con start script
- Menos conocida que Render o Railway

**Precio:** Gratis (4 contenedores) → $12/mes (Always-On)

**Veredicto:** 🟡 Buena para demos y sitios estáticos, pero la falta de base de datos gestionada la hace menos ideal para este proyecto.

---

### 2.4 Fly.io — Ya no tiene tier gratuito

**Ventajas:**
- Despliegue en 30+ regiones globales
- Sin cold start
- PostgreSQL gestionado
- Volúmenes persistentes
- Excelente rendimiento

**Limitaciones:**
- **Eliminó el tier gratuito en octubre de 2024**
- Requiere tarjeta de crédito
- Más complejo de configurar (Docker)

**Precio:** ~$1.94/mes (256 MB shared)

**Veredicto:** ❌ No es gratis, pero es excelente si decides pagar.

---

### 2.5 Vercel — Solo frontend

**Ventajas:**
- Tier gratuito Hobby muy generoso
- HTTPS automático
- Despliegue automático desde GitHub
- Sin cold start
- Excelente rendimiento (edge network)
- Dominio personalizado

**Limitaciones:**
- **No soporta backend Node.js** (solo serverless functions)
- No incluye base de datos
- Las serverless functions tienen límite de ejecución

**Precio:** Gratis (Hobby) → $20/mes (Pro)

**Veredicto:** ❌ No apto para este proyecto (requiere backend Node.js + SQLite).

---

### 2.6 Cloudflare Pages — Solo frontend

**Ventajas:**
- Ancho de banda ilimitado
- HTTPS automático
- Despliegue automático desde GitHub
- Sin cold start
- CDN global incluido
- Muy rápido

**Limitaciones:**
- **No soporta backend Node.js** (solo estático)
- No incluye base de datos
- Build time limitado a 15 minutos

**Precio:** Gratis (ilimitado)

**Veredicto:** ❌ No apto para este proyecto, pero excelente si se separa el frontend.

---

### 2.7 GitHub Pages — Solo frontend

**Ventajas:**
- Ilimitado en el tier gratuito
- HTTPS automático
- Despliegue automático desde GitHub
- Sin cold start

**Limitaciones:**
- **Solo contenido estático** (HTML, CSS, JS)
- No soporta backend
- No incluye base de datos
- Límite de 1 GB por repositorio

**Precio:** Gratis (ilimitado)

**Veredicto:** ❌ No apto para este proyecto.

---

## 3. Comparativa de seguridad

| Plataforma | HTTPS | WAF | DDoS | Backups | PCI-DSS |
|---|---|---|---|---|---|
| Render | ✅ Auto | ✅ Incluido | ✅ Incluido | ✅ Diarios | ❌ No |
| Railway | ✅ Auto | ✅ Incluido | ✅ Incluido | ✅ Diarios | ❌ No |
| SnapDeploy | ✅ Auto | ✅ Incluido | ✅ Incluido | ❌ Manual | ❌ No |
| Fly.io | ✅ Auto | ✅ Incluido | ✅ Incluido | ✅ Diarios | ❌ No |
| Vercel | ✅ Auto | ✅ Incluido | ✅ Incluido | ❌ Manual | ❌ No |
| Cloudflare Pages | ✅ Auto | ✅ Incluido | ✅ Incluido | ❌ Manual | ❌ No |

**Nota:** Ninguna plataforma gratuita es compatible con PCI-DSS por defecto. Para procesar pagos con tarjeta, se requiere un proveedor de pagos externo (Stripe, MercadoPago) que tokenice los datos, lo cual ya está implementado en este proyecto.

---

## 4. Recomendación final

### Para desarrollo y pruebas
**Render** es la mejor opción gratuita:
- Tier gratuito de 750 h/mes
- PostgreSQL gestionado incluido
- HTTPS automático
- Despliegue automático desde GitHub

### Para producción con tráfico moderado
**Render Starter ($7/mes)**:
- Elimina el cold start
- 1 GB de RAM
- 100 GB de ancho de banda
- Sin límite de horas

### Para producción con tráfico alto
**Fly.io** o **Railway Pro**:
- Escalado automático
- Múltiples regiones
- Mayor rendimiento

### Alternativa: separar frontend y backend
- **Frontend:** Cloudflare Pages (gratis, ilimitado, CDN global)
- **Backend:** Render (gratis, 750 h/mes)
- **Base de datos:** Render PostgreSQL (gratis)

---

## 5. Pasos para desplegar en Render

### 5.1 Preparar el repositorio

```bash
# 1. Crear repositorio en GitHub
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/tu-usuario/tecnogamer.git
git push -u origin main
```

### 5.2 Crear el servicio en Render

1. Ir a https://render.com/
2. Crear cuenta con GitHub
3. New → Web Service
4. Conectar el repositorio
5. Configurar:
   - **Name:** tecnogamer
   - **Environment:** Node
   - **Build Command:** `npm install --ignore-scripts`
   - **Start Command:** `node backend/server.js`
   - **Instance Type:** Free

### 5.3 Configurar variables de entorno

En el dashboard de Render, añadir:
```
NODE_ENV=production
JWT_SECRET=<valor-aleatorio-de-256-bits>
DB_PATH=/var/lib/postgresql/data/tecnogamer.db
```

### 5.4 Configurar la base de datos

1. New → PostgreSQL
2. Nombre: `tecnogamer-db`
3. Instance Type: Free
4. Copiar la **Internal Database URL**
5. Añadirla como variable de entorno `DATABASE_URL`

### 5.5 Migrar de SQLite a PostgreSQL

El código actual usa SQLite. Para PostgreSQL, cambiar el driver en `backend/config/database.js`:

```javascript
// Antes (SQLite)
const Database = require("./sqlite-compat");

// Después (PostgreSQL)
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

**Nota:** Las consultas SQL son estándar y no requieren cambios. Solo cambia el driver.

---

## 6. Checklist de seguridad para producción

- [ ] HTTPS activo (automático en Render)
- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` aleatorio de 256 bits
- [ ] Contraseña del admin cambiada
- [ ] `CORS_ORIGIN` restringido al dominio real
- [ ] Pasarela de pago con claves de producción
- [ ] Webhook de pago con firma verificada
- [ ] Backups automáticos activados
- [ ] Logs centralizados
- [ ] Monitorización de disponibilidad
- [ ] `npm audit` sin vulnerabilidades altas
- [ ] Las 123 pruebas pasan contra producción

---

## 7. Costos estimados

| Escenario | Plataforma | Costo mensual |
|---|---|---|
| Desarrollo/pruebas | Render Free | $0 |
| Producción (tráfico bajo) | Render Starter | $7 |
| Producción (tráfico medio) | Render Starter + PostgreSQL | $7 |
| Producción (tráfico alto) | Fly.io o Railway Pro | $20-50 |
| Solo frontend | Cloudflare Pages | $0 |
| Solo backend | Render Free | $0 |

---

## 8. Conclusión

**Render es la mejor opción gratuita para desplegar TecnoGamer en producción.** Ofrece todo lo necesario (frontend, API, base de datos, HTTPS) sin costo, con la única limitación del cold start en el tier gratuito. Cuando el tráfico crezca, el plan de $7/mes elimina esa limitación.

Para un despliegue **solo frontend**, **Cloudflare Pages** es superior (ancho de banda ilimitado, CDN global, sin cold start).

La separación frontend/backend es una buena estrategia para maximizar los recursos gratuitos: frontend en Cloudflare Pages (gratis) y backend en Render (gratis).
