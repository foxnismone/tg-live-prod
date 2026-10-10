# Módulo de Taller — Seguimiento de Reparaciones

Sistema de seguimiento de equipos en reparación, con integración para software de taller externo, auditoría de consultas y alertas automáticas al equipo.

---

## 1. Cómo funciona

```
   ┌─────────────────────┐
   │  Software de taller │  (o el panel de operador)
   │  externo            │
   └──────────┬──────────┘
              │ API key (X-API-Key)
              ▼
   ┌─────────────────────────────────────────┐
   │  /api/v1/repairs-api/*                  │
   │  · crea órdenes de trabajo              │
   │  · sube cambios de estado (eventos)     │
   └──────────┬──────────────────────────────┘
              │
              ▼
   ┌─────────────────────────────────────────┐
   │  Base de datos                          │
   │  repair_orders   · la orden             │
   │  repair_events   · historial de estados │
   │  repair_lookups  · cada consulta        │
   │  repair_alerts   · avisos al equipo     │
   │  repair_api_keys · claves (hasheadas)   │
   └──────────┬──────────────────────────────┘
              │
              ▼
   ┌─────────────────────┐        ┌──────────────────────┐
   │  Cliente            │        │  Panel de operador   │
   │  /reparaciones.html │        │  admin → Taller      │
   │  OT + RUT + serie   │        │  órdenes + alertas   │
   └─────────────────────┘        └──────────────────────┘
```

---

## 2. Consulta del cliente

**URL:** `/reparaciones.html`

El cliente debe aportar **los tres datos** y los tres deben coincidir:

| Dato | Ejemplo | Notas |
|---|---|---|
| Orden de trabajo | `OT-2026-000123` | Acepta espacios y minúsculas |
| RUT | `12.345.678-5` | Valida dígito verificador; acepta con o sin puntos |
| Número de serie | `SN-ABC-123` | Se normaliza (guiones, mayúsculas) |

**Privacidad:** la respuesta nunca devuelve el RUT ni el serie en claro —
se enmascaran (`•••.678-5`, `•••••T001`). Las notas internas del taller tampoco
salen nunca al cliente.

**Si algún dato no coincide**, la respuesta es un `404` genérico que no revela
*cuál* dato falló. Esto evita que alguien enumere órdenes probando combinaciones.

---

## 3. Estados del flujo

| # | Estado | Etiqueta | Icono |
|---|---|---|---|
| 1 | `received` | Recibido | 📥 |
| 2 | `diagnosing` | En diagnóstico | 🔍 |
| 3 | `waiting_parts` | Esperando repuestos | 📦 |
| 4 | `in_repair` | En reparación | 🔧 |
| 5 | `testing` | En pruebas | ✅ |
| 6 | `ready` | Listo para retiro | 🎉 |
| 7 | `delivered` | Entregado | 📤 |

Además existen `cancelled` y `unrepairable` como estados terminales alternativos.

El progreso se calcula automáticamente (`step / total`) y se muestra al cliente
como porcentaje y barra.

---

## 4. API para el software de taller

### Autenticación

Todas las llamadas llevan la cabecera `X-API-Key`. Las claves se crean desde el
panel de operador (**Taller → Claves de API**) y **se muestran una sola vez**:
en la base solo queda el hash SHA-256.

Formato: `tgrep_<prefijo8>_<48 hex>`

| Scope | Permite |
|---|---|
| `repairs:read` | Consultar órdenes y alertas |
| `repairs:write` | Crear órdenes y subir eventos |

### Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/v1/repairs-api/orders` | Lista órdenes (filtros: `status`, `limit`) |
| `GET` | `/api/v1/repairs-api/orders/:ot` | Detalle de una orden |
| `POST` | `/api/v1/repairs-api/orders` | Crea una orden (o la actualiza si envía `externalRef`) |
| `POST` | `/api/v1/repairs-api/orders/:ot/events` | Sube un cambio de estado |
| `PUT` | `/api/v1/repairs-api/orders/:ot` | Actualiza datos de la orden |
| `GET` | `/api/v1/repairs-api/alerts` | Alertas generadas |
| `POST` | `/api/v1/repairs-api/alerts/:id/read` | Marca una alerta como leída |

### Ejemplo: crear una orden

```bash
curl -X POST https://tusitio.com/api/v1/repairs-api/orders \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tgrep_xxxxxxxx_yyyyyyyy..." \
  -d '{
    "workOrder": "OT-2026-000123",
    "rut": "12.345.678-5",
    "serialNumber": "SN-ABC-123",
    "customerName": "Juan Pérez González",
    "customerEmail": "juan@example.com",
    "customerPhone": "+56 9 1234 5678",
    "deviceType": "Notebook",
    "deviceBrand": "ASUS",
    "deviceModel": "ROG Zephyrus G14",
    "reportedIssue": "No enciende",
    "estimatedCost": 85000
  }'
```

### Ejemplo: subir un cambio de estado

```bash
curl -X POST https://tusitio.com/api/v1/repairs-api/orders/OT-2026-000123/events \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tgrep_xxxxxxxx_yyyyyyyy..." \
  -d '{
    "status": "in_repair",
    "note": "Repuesto recibido. Reparación en curso.",
    "technician": "Carlos Muñoz"
  }'
```

**Idempotencia:** si el software externo envía `externalRef` (su propio ID),
un segundo `POST` con el mismo `externalRef` **actualiza** la orden existente en
vez de duplicarla.

---

## 5. Auditoría de consultas

Cada consulta del cliente se registra en `repair_lookups`:

| Campo | Contenido |
|---|---|
| `repair_id` | La orden consultada (`NULL` si no coincidió) |
| `work_order` | Lo que el cliente escribió |
| `rut_hash` | RUT hasheado — **nunca en claro** |
| `success` | Si los datos coincidieron |
| `ip_address` | IP de origen |
| `user_agent` | Navegador |
| `created_at` | Fecha y hora |

Esto permite medir frecuencia de consulta, detectar patrones anómalos y auditar
accesos.

---

## 6. Alertas automáticas

El sistema genera avisos para el equipo cuando detecta:

| Tipo | Disparador | Severidad |
|---|---|---|
| `frequent_lookup` | Muchas consultas exitosas de la misma orden en poco tiempo (cliente ansioso) | warning |
| `many_failures` | Muchas consultas fallidas desde la misma IP (posible enumeración) | critical |
| `overdue` | Orden pasada de la fecha prometida | warning |
| `no_update` | Orden sin cambios de estado en varios días | info |
| `cost_question` | El cliente pregunta por el costo | info |

Las alertas aparecen en el panel de operador (**Taller**) con un contador en el
menú lateral.

---

## 7. Módulo configurable y desconectable

Como el resto de módulos del sitio, el taller se puede activar o desactivar
desde **Panel → Configuración → Módulos**. Al desactivarlo:

- `/api/v1/repairs/info` y `/api/v1/repairs/track` devuelven `404`
- La página `/reparaciones.html` muestra un aviso de módulo desactivado

Ajustes disponibles:

| Clave | Descripción |
|---|---|
| `repair_enabled` | Activa/desactiva todo el módulo |
| `repair_name` | Nombre del taller |
| `repair_phone` | Teléfono de contacto |
| `repair_hours` | Horario de atención |
| `repair_address` | Dirección |
| `repair_warranty_days` | Días de garantía por defecto |
| `repair_intro` | Texto de introducción en la página de consulta |

---

## 8. Seguridad implementada

| Medida | Detalle |
|---|---|
| **Triple factor de consulta** | OT + RUT + serie deben coincidir |
| **Validación de RUT** | Dígito verificador real (módulo 11) |
| **Enmascarado de datos** | RUT y serie nunca se devuelven en claro |
| **Error genérico** | Un `404` no revela qué dato falló |
| **Claves hasheadas** | Solo SHA-256 en la base; se muestran una vez |
| **Scopes** | Una clave de solo lectura no puede escribir |
| **Rate limiting** | Límite estricto en el endpoint público de consulta |
| **RUT hasheado en logs** | La auditoría no almacena RUT en claro |
| **Notas internas aisladas** | `internal_note` nunca llega al cliente |
| **Consultas parametrizadas** | Sin inyección SQL |

---

## 9. Pruebas

```bash
node tools/repairs-tests.js
```

**86 pruebas** que cubren: información pública, claves de API, autenticación,
creación de órdenes, validaciones, subida de estados, consulta del cliente,
normalización de formatos, privacidad, auditoría, alertas, gestión desde el
panel, módulo desconectable y entradas maliciosas (SQLi, XSS, payloads gigantes).
