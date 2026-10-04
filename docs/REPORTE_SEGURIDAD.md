# Reporte de seguridad — TecnoGamer

**Fecha:** 2026-10-02
**Alcance:** API REST, storefront, panel de operador, base de datos, flujo de pago
**Metodología:** Revisión contra OWASP Top 10:2025 + pruebas automatizadas de intrusión

---

## 1. Veredicto

| Categoría | Estado |
|-----------|--------|
| Autenticación y sesiones | ✅ Correcto |
| Control de acceso (A01) | ✅ Correcto |
| Inyección (A05) | ✅ Correcto |
| Configuración (A02) | ✅ Correcto |
| Criptografía (A04) | ✅ Correcto |
| Datos de tarjeta | ✅ Nunca tocan el servidor |
| Logging y auditoría (A09) | ⚠️ Parcial |

**Resultado de las pruebas de seguridad: 0 vulnerabilidades explotables detectadas.**
Las 3 debilidades encontradas durante la auditoría fueron **corregidas** (ver §4).

---

## 2. Controles implementados y verificados

### A01 — Broken Access Control ✅

| Control | Verificación |
|---------|-------------|
| Denegar por defecto | Todas las rutas admin exigen `authenticateToken` + `requireRole("admin")` |
| Separación de roles | Probado: un cliente autenticado recibe **403** en `/admin/dashboard` y al crear productos |
| Propiedad del recurso | El chat verifica `isOwner` / `isGuestOwn`; un usuario no puede leer sesiones ajenas |
| Sin acceso anónimo a admin | Probado: **401** sin token en dashboard, productos, usuarios |
| Token falsificado rechazado | Probado: firma inválida → **401** |

### A02 — Security Misconfiguration ✅

Cabeceras verificadas en cada respuesta:

```
Content-Security-Policy: default-src 'self'; script-src 'self' https://js.stripe.com; ...
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Cross-Origin-Opener-Policy: same-origin
```

- `X-Powered-By` **oculto** (no revela Express).
- Mensajes de error genéricos; **sin stack traces** en las respuestas.
- Rutas de API inexistentes → **404 JSON**, nunca HTML con detalles.

### A04 — Cryptographic Failures ✅

| Elemento | Implementación |
|----------|---------------|
| Contraseñas | **bcrypt** con coste 12 y salt por usuario |
| Tokens de sesión | **JWT HS256** firmado; access 7 d / refresh 30 d |
| Unicidad de token | `jti` aleatorio de 128 bits por token |
| Refresh tokens | Almacenados con hash, invalidados al rotar |
| Secretos | Solo desde variables de entorno; `.env` fuera de control de versiones |

### A05 — Injection ✅

| Vector | Defensa | Prueba |
|--------|---------|--------|
| SQL | **100 % consultas parametrizadas** (`?`) | `'; DROP TABLE products;--` → neutralizado, tabla intacta |
| XSS | Saneado de entrada + escapado de salida (`esc()`) + CSP sin `unsafe-eval` | `<script>alert(1)</script>` → saneado |
| Path traversal | Nombres de archivo regenerados con UUID; extensión validada contra lista blanca | — |
| Subida maliciosa | Solo JPG/PNG/WEBP/AVIF/GIF; máx 10 MB; reprocesado con Sharp | — |
| Prototype pollution | Tipos validados con `express-validator`; `{$ne: null}` → **400** | Probado |

### A07 — Authentication Failures ✅

| Control | Valor |
|---------|-------|
| Fuerza bruta | **10 intentos fallidos / 15 min / IP** en login |
| Registro y recuperación | **20 / 15 min / IP** |
| Política de contraseña | Mínimo 8 caracteres, mayúscula, número |
| Límite global | 100 req / 15 min / IP (configurable) |
| Enumeración de usuarios | Respuesta idéntica para email inexistente y contraseña errónea |

### A09 — Logging y auditoría ⚠️

**Implementado:**
- Tabla `audit_logs` (usuario, acción, entidad, IP, user-agent).
- Registro de peticiones HTTP con Morgan.
- Log de accesos fallidos con IP.

**Pendiente:** alertas automáticas ante patrones sospechosos (ver §6).

### A10 — Mishandling of Exceptional Conditions ✅

- Manejador de errores global con respuestas genéricas.
- `uncaughtException` y `unhandledRejection` capturados.
- Timeouts en el cliente (15 s) con `AbortController`.
- Validación de tipos antes de tocar la base de datos.
- Payload de 10 000 caracteres → rechazado sin caída.

---

## 3. Protección de datos de pago

El diseño **cumple SAQ A** de PCI-DSS:

```
Cliente ──► Pasarela (Stripe) ──► Confirmación
   │              │
   │              └─ Los datos de tarjeta NUNCA salen del iframe del proveedor
   │
   └─ Nuestro servidor solo recibe: id de sesión, importe, email
```

- **No se almacena** número de tarjeta, CVC ni fecha de caducidad.
- **No se transmite** por nuestros servidores.
- El webhook valida la firma de Stripe antes de dar un pago por bueno.
- La CSP permite `js.stripe.com` únicamente en `script-src` y `frame-src`.

---

## 4. Debilidades encontradas y corregidas

| # | Severidad | Debilidad | Riesgo | Corrección aplicada |
|---|-----------|-----------|--------|---------------------|
| 1 | 🔴 Alta | `authLimiter` definido pero **nunca aplicado** al login | Fuerza bruta / credential stuffing sin límite | Aplicado a `/auth/login`, `/auth/register` y rutas de recuperación |
| 2 | 🔴 Alta | Catálogo público sin filtro `is_active` | Productos retirados seguían a la venta | Filtro obligatorio salvo para `admin`/`vendor` |
| 3 | 🟠 Media | `COEP: require-corp` rompía recursos legítimos | Falso sentido de seguridad con funcionalidad rota | Retirado COEP; COOP + CORP mantenidos |
| 4 | 🟠 Media | JWT sin `jti` → tokens duplicados en el mismo segundo | Colisión de sesión y fallo de login | `jti` aleatorio de 128 bits |
| 5 | 🟡 Baja | Chat accesible sin verificación de propiedad tras abrirlo a invitados | Un invitado podía leer sesiones ajenas de invitado | Verificación `isGuestOwn` + `isOwner` |

---

## 5. Pruebas de intrusión ejecutadas

Todas automatizadas en `tools/api-tests.js` y `tools/e2e-tests.js`.

| Prueba | Resultado |
|--------|-----------|
| SQLi en búsqueda (`' OR 1=1--`, `'; DROP TABLE`) | ✅ Neutralizado |
| XSS en formularios (`<script>`, `onerror=`) | ✅ Saneado |
| Acceso a admin sin token | ✅ 401 |
| Acceso a admin con rol de cliente | ✅ 403 |
| Token JWT falsificado | ✅ 401 |
| Payload JSON no válido | ✅ 400 |
| Tipos maliciosos (`{$ne:null}`, objetos anidados) | ✅ 400 |
| Contraseña de 10 000 caracteres | ✅ Rechazado, servidor estable |
| Límite de paginación desmesurado | ✅ Acotado |
| Enumeración de usuarios | ✅ Respuesta uniforme |
| Fuerza bruta en login | ✅ 429 tras 10 intentos |
| Fuga de stack trace en errores | ✅ Sin fugas |
| Escalada de privilegios vía `role` en el body | ✅ Ignorado (el rol sale del token) |

---

## 6. Recomendaciones para producción

### Obligatorias antes de publicar

1. **`JWT_SECRET` aleatorio de 256 bits.** El valor de desarrollo es público.
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **HTTPS obligatorio** con certificado válido. HSTS ya está configurado; falta el certificado (Let's Encrypt vía Caddy/Nginx).
3. **Cambiar la contraseña del admin** desde el primer acceso.
4. **Restringir CORS** al dominio real: `CORS_ORIGIN=https://tudominio.com`.
5. **`NODE_ENV=production`** para activar los límites de tasa reales y ocultar errores.

### Recomendadas

6. **Rate limiting distribuido** con `rate-limit-redis` si se escala a varias instancias (el actual es en memoria).
7. **Backups automáticos** con `cron` llamando a `POST /api/v1/admin/backup`, cifrados y fuera del servidor.
8. **Alertas** sobre `audit_logs`: avisar ante picos de 401/403 o múltiples IPs por cuenta.
9. **Rotación de refresh tokens** con detección de reutilización.
10. **CSP con nonces** en lugar de `'unsafe-inline'` para estilos.
11. **Escaneo de dependencias** en CI: `npm audit --audit-level=high`.
12. **WAF** (Cloudflare o similar) delante del sitio.
13. **2FA** para cuentas de operador.

---

## 7. Cómo reproducir la auditoría

```bash
# Arrancar el servidor
node backend/server.js

# Suite de API + seguridad (61 pruebas)
node tools/api-tests.js

# Flujos completos de usuario y operador (54 pruebas)
node tools/e2e-tests.js
```

Los informes se generan en `tools/test-report.json` y `tools/e2e-report.json`.
