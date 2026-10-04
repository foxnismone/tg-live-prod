# Mapa mental — TecnoGamer: e-commerce desde cero

**Objetivo:** tienda online de hardware, gaming y tecnología — con pasarela de pago,
galería de productos, multi-plataforma, venta por chat, control de inventario,
descripciones asistidas por IA y seguridad de grado producción.

---

## 1. Arquitectura

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENTES                                   │
│  Navegador (SPA)   Móvil (PWA)   Chat web   WhatsApp (futuro)     │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼───────────────────────────────────────┐
│                     PROXY INVERSO (producción)                    │
│     Caddy / Nginx · TLS · HTTP/2 · compresión · WAF               │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────────┐
│                  API REST  ·  Node.js + Express                   │
│                                                                   │
│  Seguridad      Helmet · CORS · Rate limit · JWT · bcrypt        │
│  Rutas          auth · products · categories · cart · orders     │
│                 inventory · ai · chat · admin · webhooks         │
│  Validación     express-validator · saneado de entrada           │
│  Estáticos      frontend/ (storefront + panel) · uploads/        │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────────┐
│                     DATOS  ·  SQLite (WAL)                        │
│  19 tablas · migraciones idempotentes · consultas parametrizadas  │
│  → escalable a PostgreSQL sin cambiar las consultas               │
└───────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────────┐
│                    SERVICIOS EXTERNOS                             │
│  Stripe (pagos) · OpenAI/Anthropic (IA) · WhatsApp (chat)        │
│  SMTP (email) · Almacenamiento de imágenes                        │
└───────────────────────────────────────────────────────────────────┘
```

---

## 2. Fases del desarrollo

### Fase 0 — Investigación
- Estudiar tiendas de referencia (PC Factory, PcComponentes) para UX y estrategia.
- Definir la arquitectura: API-first, para servir web, móvil y chat desde el mismo backend.
- Establecer el modelo de seguridad antes de escribir código.

### Fase 1 — Cimientos
- Estructura de carpetas y configuración centralizada (sin dependencias circulares).
- Base de datos: 19 tablas + índices + sistema de migraciones.
- Adaptador de SQLite sin compilación nativa.
- Middleware: seguridad, validación, errores, auditoría.

### Fase 2 — API REST
- **Catálogo:** listado con paginación, filtros (categoría, precio, stock, etiquetas), orden y búsqueda.
- **Productos:** CRUD, variantes, imágenes, SKU único, soft delete.
- **Carrito:** funciona con y sin registro (invitado por `sessionId`), valida stock y precio en cada operación.
- **Pedidos:** checkout de invitado, correlativo único, estados.
- **Autenticación:** registro, login, refresh, roles, recuperación.
- **Inventario:** ajustes con historial y motivo.
- **IA:** generación de descripciones.
- **Chat:** sesiones y mensajes.
- **Admin:** dashboard, usuarios, cupones, copias de seguridad, ajustes.

### Fase 3 — Storefront
- Sistema de diseño oscuro, accesible (WCAG AA), mobile-first.
- Catálogo con filtros y carga progresiva.
- Detalle de producto en modal.
- Carrito lateral y checkout con validación accesible.
- Chat de ventas flotante.
- Estados de carga, vacío y error bien resueltos.

### Fase 4 — Panel de operador
- Login con token.
- Dashboard con métricas de negocio y avisos de stock.
- CRUD de productos con **subida de imágenes por arrastrar y soltar**.
- Ajuste rápido de inventario.
- Pedidos, chat y configuración del sistema.

### Fase 5 — Pruebas
- 61 pruebas de API y seguridad.
- 54 pruebas end-to-end de los flujos reales.
- Corrección de **17 fallos** (ver `REPORTE_REPARACION.md`).

### Fase 6 — Endurecimiento
- Auditoría contra OWASP Top 10:2025.
- Corrección de 5 debilidades de seguridad.
- Documentación de despliegue.

---

## 3. Modelo de datos

```
users ──┬── carts ──── (items JSON)
        ├── orders ───┬── payments
        │             └── inventory_logs
        ├── auth_tokens
        ├── reviews
        └── chat_sessions ─── chat_messages

categories ──┬── products ──┬── product_images
             │              ├── product_variants
             │              └── inventory_logs
             └── (subcategorías vía parent_id)

coupons · tax_rates · site_settings · audit_logs · schema_versions
```

**Decisión clave:** los items del carrito y del pedido se guardan como JSON.
Simplifica el prototipo y permite migrar a tablas relacionales cuando el volumen lo exija.

---

## 4. Seguridad en capas

| Capa | Controles |
|------|-----------|
| Red | TLS 1.3, HSTS, WAF, límite de conexiones |
| Aplicación | Helmet, CSP, CORS, rate limit, validación, saneado |
| Identidad | bcrypt (12), JWT con `jti`, refresh rotativo, roles, bloqueo por fuerza bruta |
| Datos | Consultas parametrizadas, soft delete, migraciones, backups |
| Pago | Tokenización en la pasarela; cero datos de tarjeta en el servidor |
| Operación | Auditoría, logs, cabeceras, errores genéricos |

---

## 5. Inventario del proyecto

```
ecommerce-fullstack/
├── backend/
│   ├── server.js                  Servidor principal
│   ├── config/
│   │   ├── index.js               Configuración centralizada
│   │   ├── database.js            Esquema, semilla y migraciones
│   │   └── sqlite-compat.js       Adaptador node:sqlite
│   ├── middleware/
│   │   ├── errorHandler.js        Errores, auth, roles, validación
│   │   └── securityHeaders.js     Cabeceras de seguridad
│   └── routes/
│       ├── auth.js                Registro, login, refresh
│       ├── products.js            Catálogo y CRUD
│       ├── categories.js          Categorías
│       ├── cart.js                Carrito (invitado y registrado)
│       ├── orders.js              Pedidos
│       ├── inventory.js           Inventario
│       ├── ai.js                  Descripciones con IA
│       ├── chat.js                Chat de ventas
│       ├── admin.js               Panel
│       ├── uploads.js             Subida de archivos
│       ├── webhooks.js            Webhooks de pago
│       └── chat-web.js            Chat web
├── frontend/
│   ├── index.html                 Storefront
│   ├── admin.html                 Panel de operador
│   └── assets/
│       ├── css/main.css           Sistema de diseño
│       ├── css/admin.css          Estilos del panel
│       ├── js/api.js              Cliente HTTP
│       ├── js/store.js            Lógica de la tienda
│       └── js/admin.js            Lógica del panel
├── scripts/
│   └── seed-catalog.js            Catálogo real (36 productos)
├── tools/
│   ├── api-tests.js               61 pruebas de API y seguridad
│   ├── e2e-tests.js               54 pruebas end-to-end
│   └── *.json                     Informes generados
├── docs/
│   ├── REPORTE_REPARACION.md      17 fallos reparados
│   ├── REPORTE_SEGURIDAD.md       Auditoría OWASP
│   ├── MAPA_MENTAL.md             Este documento
│   └── DESPLIEGUE.md              Guía de producción
├── uploads/products/              Imágenes
├── data/                          Base de datos
├── .env                           Configuración
└── package.json
```

---

## 6. Decisiones técnicas y su porqué

| Decisión | Motivo |
|----------|--------|
| **SQLite en lugar de PostgreSQL** | Cero configuración para arrancar. Las consultas son estándar: migrar es cambiar el driver. |
| **Adaptador `node:sqlite`** | Evita compilación nativa. Misma API que `better-sqlite3`. |
| **Vanilla JS en lugar de React/Vue** | Sin paso de compilación, arranque instantáneo, cero dependencias que auditar. |
| **API-first** | El mismo backend sirve web, móvil, chat y futuras integraciones. |
| **Carrito de invitado** | Reduce el abandono: obligar a registrarse pierde ~25 % de las compras. |
| **Datos de tarjeta fuera del servidor** | Cumplimiento PCI-DSS SAQ A con mínimo esfuerzo y máximo rigor. |
| **Migraciones idempotentes** | Permite actualizar producción sin perder datos. |
| **Pruebas automatizadas** | Cada corrección queda verificada y las regresiones se detectan solas. |

---

## 7. Cómo arrancar

```bash
cd ecommerce-fullstack

# 1. Dependencias
npm install --ignore-scripts

# 2. Configuración
#    (ya existe .env; ajustar los secretos antes de producción)

# 3. Catálogo de ejemplo (opcional; idempotente)
node scripts/seed-catalog.js

# 4. Arrancar
node backend/server.js

# 5. Verificar
node tools/api-tests.js      # 61 pruebas
node tools/e2e-tests.js      # 54 pruebas
```

**Accesos:**
- Tienda → `http://localhost:3000/`
- Panel → `http://localhost:3000/admin.html`
- Operador → `admin@tecnogamer.local` / `Admin123!`

---

## 8. Hoja de ruta

| Prioridad | Tarea |
|-----------|-------|
| Alta | Conectar la pasarela de pago real (Stripe) |
| Alta | Desplegar con HTTPS y `NODE_ENV=production` |
| Alta | Cambiar el secreto JWT y la contraseña del admin |
| Media | Configurar el generador de descripciones con IA |
| Media | PWA instalable (service worker + manifiesto) |
| Media | Backups automáticos programados |
| Media | Panel de reportes de ventas con gráficos |
| Baja | Integración con WhatsApp Business |
| Baja | Variantes de producto en la interfaz |
| Baja | Programa de afiliados |
| Baja | Recomendaciones basadas en historial |
