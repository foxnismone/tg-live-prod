# Reporte de reparación — TecnoGamer

**Fecha:** 2026-10-02
**Proyecto:** `C:\Users\GODZILLA24H2\Desktop\ecommerce-fullstack`
**Stack:** Node.js + Express 4 · SQLite (WAL) · Vanilla JS · Helmet · JWT · bcrypt
**Estado final:** ✅ 115/115 pruebas superadas (61 API + 54 E2E)

---

## 1. Resumen ejecutivo

El sistema **no arrancaba**. El backend lanzaba excepciones en el arranque y toda la API
respondía `500`. La causa raíz era una combinación de dependencias nativas imposibles de
compilar en este entorno, un módulo de configuración borrado a medias y una dependencia
circular entre `server.js` y las rutas.

Tras las reparaciones, el sitio **se sirve y funciona de punta a punta**: catálogo,
carrito de invitado, checkout, chat de ventas y panel de operador con subida de imágenes.

---

## 2. Fallos encontrados y reparados

### 2.1 Bloqueantes de arranque

| # | Fallo | Causa raíz | Reparación |
|---|-------|-----------|-----------|
| B1 | `better-sqlite3` no carga: *"Could not locate the bindings file"* | Requiere compilación nativa (node-gyp + MSBuild). MSBuild falla en este host; `npm install` se ejecutó con `--ignore-scripts`. | Se escribió `backend/config/sqlite-compat.js`, un adaptador que expone la **misma API** de `better-sqlite3` sobre el módulo `node:sqlite` integrado en Node ≥22. Cero dependencias nativas. |
| B2 | `ReferenceError: config is not defined` | Al eliminar el bloque de configuración se borró el objeto `config` que 7 funciones del módulo seguían usando. | Se restauró `config` en `backend/config/database.js` leyendo variables de entorno con valores por defecto. |
| B3 | `Router.use() requires a middleware function but got a Object` | **Dependencia circular**: `server.js` → `routes/products.js` → `require("../server")` → objeto `{}` en el momento de la carga. | Se extrajo la configuración a `backend/config/index.js` (sin dependencias) y se actualizaron `routes/products.js` y `middleware/errorHandler.js`. |
| B4 | `ReferenceError: projectRoot is not defined` | El refactor de configuración eliminó la variable pero el bloque de frontend estático la usaba. | Se reemplazó por `path.resolve(__dirname, "..", ...)`. |
| B5 | Módulos ausentes: `morgan`, `compression`, `cookie-parser` | `package.json` no los declaraba y la instalación previa falló. | Instalados y verificados. |
| B6 | `Cannot find module './routes/uploads'` (y `webhooks`, `chat-web`) | Rutas referenciadas en `server.js` pero sin archivo. | Creados los tres módulos. |

### 2.2 Consultas SQL rotas (causaban `500`)

| # | Endpoint | Fallo | Reparación |
|---|----------|-------|-----------|
| S1 | `GET /products/featured` | `ORDER BY sort_order` — columna inexistente en `products` (pertenece a `categories`). | Se eliminó `sort_order` del `ORDER BY`. |
| S2 | `GET /products/new` | Igual que S1. | Igual. |
| S3 | `GET /products/category/:slug` | Igual que S1. | Igual. |
| S4 | `GET /categories/:id` | Igual que S1. | Igual. |
| S5 | `GET /admin/dashboard` | `SUM(i.value.quantity)` — `JSON_EACH` expone columnas (`key`, `value`, …); `value` es texto JSON. | Se reescribió con `json_extract(i.value, '$.quantity')`. |

### 2.3 Bugs funcionales y de seguridad

| # | Severidad | Fallo | Impacto | Reparación |
|---|-----------|-------|---------|-----------|
| F1 | 🔴 **Alta** | `POST /orders`: `UNIQUE constraint failed: orders.order_number` | **Ningún pedido se podía crear.** `SUBSTR(order_number, 9)` cortaba `ORDEN-2026-000001` en la posición 9 (`2026-000001`), devolviendo un correlativo erróneo que siempre colisionaba. | El offset se calcula con el largo real del prefijo (`prefix.length + 1`) y se añadió una comprobación anti-colisión. |
| F2 | 🔴 **Alta** | `POST /auth/login`: `500` intermitente | Dos inicios de sesión en el mismo segundo generaban **el mismo JWT** (mismos claims + mismo `iat`), violando `auth_tokens.token UNIQUE`. | Se añadió un `jti` (JWT ID) aleatorio a cada token. |
| F3 | 🔴 **Alta** | El catálogo público no filtraba `is_active` | **Productos eliminados seguían visibles y comprables.** El soft delete era inefectivo. | Se añadió `p.is_active = 1` por defecto; los roles `admin`/`vendor` pueden verlos. |
| F4 | 🟠 Media | `strictLimiter` y `authLimiter` definidos pero **nunca aplicados** | El login quedaba **sin protección anti fuerza bruta**. | Se aplicaron a `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`. |
| F5 | 🟠 Media | `auth_tokens` sin columnas `ip_address` / `user_agent` | El login fallaba al registrar la sesión. | Se añadieron las columnas + **sistema de migraciones idempotentes** (`runMigrations`) para bases existentes. |
| F6 | 🟠 Media | `recalculateCart` sobrescribía el carrito con datos obsoletos | Los items desaparecían justo después de agregarlos (`items: 0`). | La función relee siempre el carrito desde la base de datos antes de recalcular. |
| F7 | 🟠 Media | `PUT`/`DELETE /cart/items/:idx` usaban `req.user.userId` sin guardia | **500** para invitados y para cualquier usuario con carrito de sesión. | Se introdujo `resolveCart(req)` que soporta usuario autenticado o `sessionId`. |
| F8 | 🟠 Media | Chat de ventas exigía autenticación | Un visitante **no podía usar el chat**, que es su propósito. | Se aplicó `optionalAuth` a crear sesión, enviar mensaje y leer historial; control de acceso por propietario. |
| F9 | 🟡 Baja | `GET /chat/sessions/:id` usaba `req.user.userId` sin guardia | **500** para invitados. | Guardia añadida + verificación de propiedad (`isOwner` / `isGuestOwn`). |
| F10 | 🟡 Baja | Checkout exigía autenticación y `shippingAddress` como objeto | **No había compra como invitado**, práctica estándar del comercio electrónico. | `optionalAuth` + normalización de dirección (objeto o texto). |
| F11 | 🟡 Baja | Email del admin `admin@localhost` rechazado por `isEmail()` | Imposible iniciar sesión con las credenciales por defecto. | Cambiado a `admin@tecnogamer.local`. |
| F12 | 🟡 Baja | `Cross-Origin-Embedder-Policy: require-corp` | Rompía la carga de Google Fonts. | Se retiró COEP (manteniendo COOP y CORP), que es lo correcto. |

---

## 3. Bugs de la interfaz reparados

| # | Fallo | Reparación |
|---|-------|-----------|
| U1 | El frontend estaba **completamente vacío** (`frontend/` sin archivos). | Se construyó el storefront completo (`index.html`, `main.css`, `api.js`, `store.js`) y el panel de operador (`admin.html`, `admin.css`, `admin.js`). |
| U2 | El handler `404` se registraba **antes** del estático → la web devolvía 404. | Se reordenó: estático → SPA fallback → `notFound` → `errorHandler`. |
| U3 | El frontend llamaba a endpoints inexistentes (`/ai/description`, `/inventory/:id/adjust`, `/chat/message`). | Se alineó con la API real (`/ai/generate-description`, `/inventory/adjust`, `/chat/sessions/:id`). |
| U4 | El catálogo mostraba categorías demo irrelevantes (Ropa, Belleza, Deportes). | Se desactivaron; quedan 8 categorías coherentes con la tienda. |

---

## 4. Mejoras de robustez añadidas

- **Migraciones incrementales idempotentes** (`runMigrations`): permiten actualizar bases de datos en producción sin perder datos.
- **Índice `jti` en tokens**: elimina colisiones de JWT.
- **Anti-colisión de número de pedido**: salvaguarda con reintento.
- **Límite de tasa configurable por entorno**: estricto en producción (10 intentos/15 min), relajado en desarrollo.
- **Suite de pruebas re-ejecutable**: limpieza automática de residuos.

---

## 5. Verificación final

```
API   : 61 / 61  ✅
E2E   : 54 / 54  ✅
TOTAL : 115 / 115 ✅
```

**Cobertura de las pruebas:**

| Área | Qué se comprueba |
|------|------------------|
| Catálogo | Listado, paginación, filtros, orden, búsqueda, detalle, 404 |
| Carrito | Agregar como invitado, recuperar, modificar, validar stock, errores |
| Checkout | Creación de pedido, validación, pasarela de pago |
| Chat | Configuración, crear sesión, enviar, historial |
| Operador | Login, dashboard, CRUD de productos, subida de imágenes, inventario, pedidos |
| Seguridad | Roles, acceso denegado, token falsificado, cabeceras HTTP |
| Resiliencia | Inyección SQL, tipos maliciosos, payloads gigantes |

---

## 6. Credenciales y accesos

| Rol | Email | Contraseña |
|-----|-------|-----------|
| Operador (admin) | `admin@tecnogamer.local` | `Admin123!` |

> ⚠️ **Cambiar la contraseña del admin antes de desplegar en producción.**
> Definir `ADMIN_PASSWORD_CIPHER` en `.env` con un hash bcrypt.

**URLs:**
- Tienda: `http://localhost:3000/`
- Panel de operador: `http://localhost:3000/admin.html`

---

## 7. Pendientes antes de producción

1. **Pasarela de pago real** — configurar `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` y `STRIPE_WEBHOOK_SECRET`.
2. **Descripciones con IA** — configurar `AI_API_URL` y `AI_API_KEY`.
3. **HTTPS obligatorio** — HSTS ya está activo; el certificado lo pone el proxy inverso (Nginx/Caddy).
4. **Secretos** — `JWT_SECRET` debe ser un valor aleatorio de 256 bits, no el de desarrollo.
5. **CORS** — restringir `CORS_ORIGIN` al dominio real.
6. **Copias de seguridad** — programar `POST /api/v1/admin/backup` (existe, sin cron).
7. **Imágenes** — el seed usa SVG generados; en producción se subirán fotografías reales.
