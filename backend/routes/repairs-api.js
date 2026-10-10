/**
 * ============================================================
 * API PARA SOFTWARE DE TALLER EXTERNO
 * ============================================================
 * Permite que un programa de gestión de taller (o un script) cree
 * órdenes y suba cambios de estado sin usar la sesión de un operador.
 *
 * AUTENTICACIÓN: cabecera  X-API-Key: tgrep_<prefijo>_<secreto>
 * Las claves se guardan hasheadas (SHA-256). El secreto solo se muestra
 * UNA VEZ, al crearla.
 *
 * Endpoints (todos requieren API key):
 *   GET    /api/v1/repairs-api/orders            → listar órdenes
 *   GET    /api/v1/repairs-api/orders/:ot        → detalle de una orden
 *   POST   /api/v1/repairs-api/orders            → crear/actualizar orden (upsert por externalRef)
 *   POST   /api/v1/repairs-api/orders/:ot/events → añadir evento de estado
 *   PUT    /api/v1/repairs-api/orders/:ot        → actualizar campos
 *   GET    /api/v1/repairs-api/alerts            → alertas pendientes
 *   POST   /api/v1/repairs-api/alerts/:id/read   → marcar alerta leída
 * ============================================================
 */

"use strict";

const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const db = require("../config/database");
const {
  normalizeRut, isValidRut, normalizeSerial,
  normalizeWorkOrder, safeEqual,
} = require("../utils/rut");

const isProd = process.env.NODE_ENV === "production";

const { STATUS_META } = require("./repairs");

/* ─── Estados válidos ─────────────────────────────────────── */
const VALID_STATUSES = Object.keys(STATUS_META);
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];

/* ─── Generación y verificación de claves de API ──────────── */
function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Crea una clave nueva. Devuelve el secreto en claro UNA vez.
 * Formato: tgrep_<8 chars prefijo>_<48 chars secreto>
 */
function generateApiKey() {
  const prefix = crypto.randomBytes(4).toString("hex");
  const secret = crypto.randomBytes(24).toString("hex");
  const key = `tgrep_${prefix}_${secret}`;
  return { key, prefix, hash: hashKey(key) };
}

/* ─── Middleware de autenticación por API key ─────────────── */
function authenticateApiKey(requiredScope) {
  return (req, res, next) => {
    try {
      const header = req.get("x-api-key") || "";
      if (!header) {
        return res.status(401).json({
          error: "Falta la cabecera X-API-Key.",
          code: "API_KEY_REQUIRED",
        });
      }

      const hash = hashKey(header.trim());
      const row = db.prepare(
        "SELECT * FROM repair_api_keys WHERE key_hash = ? AND is_active = 1"
      ).get(hash);

      if (!row) {
        return res.status(401).json({ error: "Clave de API inválida.", code: "INVALID_API_KEY" });
      }

      // Comparación en tiempo constante (defensa extra)
      if (!safeEqual(row.key_hash, hash)) {
        return res.status(401).json({ error: "Clave de API inválida.", code: "INVALID_API_KEY" });
      }

      // Verificar scope
      const scopes = String(row.scopes || "").split(",").map(s => s.trim());
      if (requiredScope && !scopes.includes(requiredScope)) {
        return res.status(403).json({
          error: `La clave no tiene el permiso requerido: ${requiredScope}.`,
          code: "INSUFFICIENT_SCOPE",
        });
      }

      // Registrar uso
      db.prepare("UPDATE repair_api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);

      req.apiKey = { id: row.id, name: row.name, scopes };
      next();
    } catch (err) {
      console.error("Error autenticando API key:", err);
      res.status(500).json({ error: "Error de autenticación", code: "AUTH_ERROR" });
    }
  };
}

/* ─── Rate limit propio de la API ─────────────────────────── */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProd ? 120 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !isProd && req.get("x-load-test") === "1",
  keyGenerator: (req) => req.apiKey?.id ? `key:${req.apiKey.id}` : (req.ip || "unknown"),
  message: { error: "Demasiadas peticiones a la API.", code: "API_RATE_LIMITED" },
});

router.use(apiLimiter);

/* ─── Helpers ─────────────────────────────────────────────── */
function serializeOrder(r) {
  return {
    id: r.id,
    workOrder: r.work_order,
    externalRef: r.external_ref,
    rut: r.rut,
    serialNumber: r.serial_number,
    customer: { name: r.customer_name, email: r.customer_email, phone: r.customer_phone },
    device: {
      type: r.device_type, brand: r.device_brand,
      model: r.device_model, serialNumber: r.serial_number,
    },
    reportedIssue: r.reported_issue,
    diagnosis: r.diagnosis,
    status: r.status,
    statusLabel: STATUS_META[r.status]?.label || r.status,
    priority: r.priority,
    technician: r.technician,
    estimatedCost: r.estimated_cost,
    finalCost: r.final_cost,
    warrantyDays: r.warranty_days,
    receivedAt: r.received_at,
    promisedAt: r.promised_at,
    deliveredAt: r.delivered_at,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function generateWorkOrder(db) {
  const year = new Date().getFullYear();
  const prefix = `OT-${year}-`;
  const last = db.prepare(
    `SELECT work_order FROM repair_orders
     WHERE work_order LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`);

  let next = 1;
  if (last) {
    const parsed = parseInt(last.work_order.slice(prefix.length), 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }

  // Bucle anti-colisión
  let candidate = `${prefix}${String(next).padStart(6, "0")}`;
  while (db.prepare("SELECT 1 FROM repair_orders WHERE work_order = ?").get(candidate)) {
    next++;
    candidate = `${prefix}${String(next).padStart(6, "0")}`;
  }
  return candidate;
}

/* ══════════════════════════════════════════════════════════
   GET /api/v1/repairs-api/orders — Listar órdenes
   ══════════════════════════════════════════════════════════ */
router.get("/orders", authenticateApiKey("repairs:read"), (req, res) => {
  try {
    const { status, since, limit = 100, offset = 0 } = req.query;
    const conditions = ["is_active = 1"];
    const params = [];

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Estado inválido.", code: "INVALID_STATUS", valid: VALID_STATUSES });
      }
      conditions.push("status = ?");
      params.push(status);
    }
    if (since) {
      conditions.push("updated_at >= ?");
      params.push(String(since));
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const lim = Math.min(Number(limit) || 100, 500);
    const off = Math.max(Number(offset) || 0, 0);

    const rows = db.prepare(
      `SELECT * FROM repair_orders ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    ).all(...params, lim, off);

    const total = db.prepare(`SELECT COUNT(*) AS c FROM repair_orders ${where}`).get(...params).c;

    res.json({
      orders: rows.map(serializeOrder),
      pagination: { total, limit: lim, offset: off },
    });
  } catch (err) {
    console.error("Error listando órdenes:", err);
    res.status(500).json({ error: "Error al listar órdenes", code: "LIST_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/v1/repairs-api/orders/:ot — Detalle
   ══════════════════════════════════════════════════════════ */
router.get("/orders/:ot", authenticateApiKey("repairs:read"), (req, res) => {
  try {
    const ot = normalizeWorkOrder(req.params.ot);
    const row = db.prepare("SELECT * FROM repair_orders WHERE work_order = ?").get(ot);

    if (!row) {
      return res.status(404).json({ error: "Orden no encontrada.", code: "NOT_FOUND" });
    }

    const events = db.prepare(
      `SELECT status, note, internal_note, technician, created_by, created_at
       FROM repair_events WHERE repair_id = ? ORDER BY created_at ASC`
    ).all(row.id);

    res.json({
      order: serializeOrder(row),
      events: events.map(e => ({
        status: e.status,
        note: e.note,
        internalNote: e.internal_note,
        technician: e.technician,
        createdBy: e.created_by,
        date: e.created_at,
      })),
    });
  } catch (err) {
    console.error("Error obteniendo orden:", err);
    res.status(500).json({ error: "Error al obtener la orden", code: "GET_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   POST /api/v1/repairs-api/orders — Crear o actualizar (upsert)
   ══════════════════════════════════════════════════════════ */
router.post("/orders", authenticateApiKey("repairs:write"), (req, res) => {
  try {
    const b = req.body || {};

    const externalRef = b.externalRef ? String(b.externalRef).slice(0, 120) : null;
    const rut = normalizeRut(b.rut);
    const serial = normalizeSerial(b.serialNumber);
    const customerName = String(b.customerName || "").trim().slice(0, 200);
    const status = VALID_STATUSES.includes(b.status) ? b.status : "received";
    const priority = VALID_PRIORITIES.includes(b.priority) ? b.priority : "normal";

    /* ─── Validaciones ─── */
    const errors = [];
    if (!rut) errors.push("rut es obligatorio");
    else if (!isValidRut(rut)) errors.push("rut no es válido (dígito verificador incorrecto)");
    if (!serial) errors.push("serialNumber es obligatorio");
    if (!customerName) errors.push("customerName es obligatorio");

    if (errors.length) {
      return res.status(400).json({ error: "Datos inválidos.", code: "VALIDATION_ERROR", details: errors });
    }

    /* ─── Buscar existente por externalRef o por (rut + serie) ─── */
    let existing = null;
    if (externalRef) {
      existing = db.prepare("SELECT * FROM repair_orders WHERE external_ref = ?").get(externalRef);
    }
    if (!existing) {
      existing = db.prepare(
        "SELECT * FROM repair_orders WHERE rut = ? AND serial_number = ? AND status NOT IN ('delivered','cancelled') AND is_active = 1"
      ).get(rut, serial);
    }

    let repairId;
    let workOrder;

    const tx = db.transaction(() => {
      if (existing) {
        repairId = existing.id;
        workOrder = existing.work_order;

        db.prepare(
          `UPDATE repair_orders SET
             customer_name = ?, customer_email = ?, customer_phone = ?,
             device_type = ?, device_brand = ?, device_model = ?,
             reported_issue = COALESCE(?, reported_issue),
             diagnosis = COALESCE(?, diagnosis),
             status = ?, priority = ?, technician = COALESCE(?, technician),
             estimated_cost = ?, final_cost = ?, warranty_days = ?,
             promised_at = COALESCE(?, promised_at),
             external_ref = COALESCE(?, external_ref),
             source = 'api',
             updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          customerName,
          b.customerEmail ? String(b.customerEmail).slice(0, 200) : existing.customer_email,
          b.customerPhone ? String(b.customerPhone).slice(0, 40) : existing.customer_phone,
          b.deviceType ? String(b.deviceType).slice(0, 80) : existing.device_type,
          b.deviceBrand ? String(b.deviceBrand).slice(0, 80) : existing.device_brand,
          b.deviceModel ? String(b.deviceModel).slice(0, 120) : existing.device_model,
          b.reportedIssue ? String(b.reportedIssue).slice(0, 2000) : null,
          b.diagnosis ? String(b.diagnosis).slice(0, 2000) : null,
          status, priority,
          b.technician ? String(b.technician).slice(0, 120) : null,
          Number(b.estimatedCost) || 0,
          Number(b.finalCost) || 0,
          Number(b.warrantyDays) || existing.warranty_days || 90,
          b.promisedAt || null,
          externalRef,
          repairId
        );
      } else {
        workOrder = generateWorkOrder(db);

        const result = db.prepare(
          `INSERT INTO repair_orders
             (work_order, rut, serial_number, customer_name, customer_email, customer_phone,
              device_type, device_brand, device_model, reported_issue, diagnosis,
              status, priority, technician, estimated_cost, final_cost, warranty_days,
              promised_at, external_ref, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')`
        ).run(
          workOrder, rut, serial, customerName,
          b.customerEmail ? String(b.customerEmail).slice(0, 200) : null,
          b.customerPhone ? String(b.customerPhone).slice(0, 40) : null,
          b.deviceType ? String(b.deviceType).slice(0, 80) : null,
          b.deviceBrand ? String(b.deviceBrand).slice(0, 80) : null,
          b.deviceModel ? String(b.deviceModel).slice(0, 120) : null,
          b.reportedIssue ? String(b.reportedIssue).slice(0, 2000) : null,
          b.diagnosis ? String(b.diagnosis).slice(0, 2000) : null,
          status, priority,
          b.technician ? String(b.technician).slice(0, 120) : null,
          Number(b.estimatedCost) || 0,
          Number(b.finalCost) || 0,
          Number(b.warrantyDays) || 90,
          b.promisedAt || null,
          externalRef
        );

        repairId = Number(result.lastInsertRowid);
      }

      // Registrar el evento de estado
      db.prepare(
        `INSERT INTO repair_events (repair_id, status, note, internal_note, technician, created_by)
         VALUES (?, ?, ?, ?, ?, 'api')`
      ).run(
        repairId, status,
        b.note ? String(b.note).slice(0, 1000) : null,
        b.internalNote ? String(b.internalNote).slice(0, 1000) : null,
        b.technician ? String(b.technician).slice(0, 120) : null
      );
    });

    tx();

    const saved = db.prepare("SELECT * FROM repair_orders WHERE id = ?").get(repairId);

    res.status(existing ? 200 : 201).json({
      message: existing ? "Orden actualizada." : "Orden creada.",
      created: !existing,
      order: serializeOrder(saved),
    });
  } catch (err) {
    console.error("Error en upsert de orden:", err);
    res.status(500).json({ error: "Error al guardar la orden", code: "UPSERT_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   POST /api/v1/repairs-api/orders/:ot/events — Añadir evento
   ══════════════════════════════════════════════════════════ */
router.post("/orders/:ot/events", authenticateApiKey("repairs:write"), (req, res) => {
  try {
    const ot = normalizeWorkOrder(req.params.ot);
    const b = req.body || {};

    const repair = db.prepare("SELECT * FROM repair_orders WHERE work_order = ?").get(ot);
    if (!repair) {
      return res.status(404).json({ error: "Orden no encontrada.", code: "NOT_FOUND" });
    }

    const status = VALID_STATUSES.includes(b.status) ? b.status : null;
    if (!status) {
      return res.status(400).json({
        error: "Estado inválido o faltante.",
        code: "INVALID_STATUS",
        valid: VALID_STATUSES,
      });
    }

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO repair_events (repair_id, status, note, internal_note, technician, created_by)
         VALUES (?, ?, ?, ?, ?, 'api')`
      ).run(
        repair.id, status,
        b.note ? String(b.note).slice(0, 1000) : null,
        b.internalNote ? String(b.internalNote).slice(0, 1000) : null,
        b.technician ? String(b.technician).slice(0, 120) : null
      );

      // Actualizar estado de la orden
      const updates = ["status = ?", "updated_at = datetime('now')"];
      const values = [status];

      if (b.diagnosis) { updates.push("diagnosis = ?"); values.push(String(b.diagnosis).slice(0, 2000)); }
      if (b.finalCost !== undefined) { updates.push("final_cost = ?"); values.push(Number(b.finalCost) || 0); }
      if (b.technician) { updates.push("technician = ?"); values.push(String(b.technician).slice(0, 120)); }
      if (status === "delivered") { updates.push("delivered_at = datetime('now')"); }

      values.push(repair.id);
      db.prepare(`UPDATE repair_orders SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    });

    tx();

    const updated = db.prepare("SELECT * FROM repair_orders WHERE id = ?").get(repair.id);
    res.json({ message: "Evento registrado.", order: serializeOrder(updated) });
  } catch (err) {
    console.error("Error añadiendo evento:", err);
    res.status(500).json({ error: "Error al registrar el evento", code: "EVENT_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   PUT /api/v1/repairs-api/orders/:ot — Actualizar campos
   ══════════════════════════════════════════════════════════ */
router.put("/orders/:ot", authenticateApiKey("repairs:write"), (req, res) => {
  try {
    const ot = normalizeWorkOrder(req.params.ot);
    const b = req.body || {};

    const repair = db.prepare("SELECT * FROM repair_orders WHERE work_order = ?").get(ot);
    if (!repair) {
      return res.status(404).json({ error: "Orden no encontrada.", code: "NOT_FOUND" });
    }

    // Lista blanca de campos editables por la API
    const ALLOWED = {
      customerName: ["customer_name", "str", 200],
      customerEmail: ["customer_email", "str", 200],
      customerPhone: ["customer_phone", "str", 40],
      deviceType: ["device_type", "str", 80],
      deviceBrand: ["device_brand", "str", 80],
      deviceModel: ["device_model", "str", 120],
      reportedIssue: ["reported_issue", "str", 2000],
      diagnosis: ["diagnosis", "str", 2000],
      technician: ["technician", "str", 120],
      estimatedCost: ["estimated_cost", "num", 0],
      finalCost: ["final_cost", "num", 0],
      warrantyDays: ["warranty_days", "num", 0],
      promisedAt: ["promised_at", "str", 30],
      priority: ["priority", "enum", VALID_PRIORITIES],
      status: ["status", "enum", VALID_STATUSES],
    };

    const updates = [];
    const values = [];

    for (const [field, [col, type, extra]] of Object.entries(ALLOWED)) {
      if (b[field] === undefined) continue;

      let value;
      if (type === "num") value = Number(b[field]) || 0;
      else if (type === "enum") {
        if (!extra.includes(b[field])) {
          return res.status(400).json({
            error: `Valor inválido para ${field}.`, code: "INVALID_VALUE", valid: extra,
          });
        }
        value = b[field];
      } else value = String(b[field]).slice(0, extra);

      updates.push(`${col} = ?`);
      values.push(value);
    }

    if (!updates.length) {
      return res.status(400).json({ error: "No hay campos para actualizar.", code: "NO_FIELDS" });
    }

    updates.push("updated_at = datetime('now')");
    values.push(repair.id);

    db.prepare(`UPDATE repair_orders SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    const updated = db.prepare("SELECT * FROM repair_orders WHERE id = ?").get(repair.id);
    res.json({ message: "Orden actualizada.", order: serializeOrder(updated) });
  } catch (err) {
    console.error("Error actualizando orden:", err);
    res.status(500).json({ error: "Error al actualizar la orden", code: "UPDATE_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/v1/repairs-api/alerts — Alertas pendientes
   ══════════════════════════════════════════════════════════ */
router.get("/alerts", authenticateApiKey("repairs:read"), (req, res) => {
  try {
    const onlyUnread = req.query.unread !== "false";
    const sql = onlyUnread
      ? `SELECT a.*, r.work_order, r.customer_name, r.customer_phone
         FROM repair_alerts a LEFT JOIN repair_orders r ON a.repair_id = r.id
         WHERE a.is_read = 0 ORDER BY a.created_at DESC LIMIT 200`
      : `SELECT a.*, r.work_order, r.customer_name, r.customer_phone
         FROM repair_alerts a LEFT JOIN repair_orders r ON a.repair_id = r.id
         ORDER BY a.created_at DESC LIMIT 200`;

    const rows = db.prepare(sql).all();

    res.json({
      alerts: rows.map(a => ({
        id: a.id,
        type: a.type,
        severity: a.severity,
        message: a.message,
        data: a.data ? JSON.parse(a.data) : null,
        isRead: !!a.is_read,
        workOrder: a.work_order || null,
        customerName: a.customer_name || null,
        customerPhone: a.customer_phone || null,
        createdAt: a.created_at,
      })),
      unreadCount: db.prepare("SELECT COUNT(*) AS c FROM repair_alerts WHERE is_read = 0").get().c,
    });
  } catch (err) {
    console.error("Error obteniendo alertas:", err);
    res.status(500).json({ error: "Error al obtener alertas", code: "ALERTS_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   POST /api/v1/repairs-api/alerts/:id/read — Marcar leída
   ══════════════════════════════════════════════════════════ */
router.post("/alerts/:id/read", authenticateApiKey("repairs:read"), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido.", code: "INVALID_ID" });
    }

    const result = db.prepare("UPDATE repair_alerts SET is_read = 1 WHERE id = ?").run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Alerta no encontrada.", code: "NOT_FOUND" });
    }

    res.json({ message: "Alerta marcada como leída." });
  } catch (err) {
    console.error("Error marcando alerta:", err);
    res.status(500).json({ error: "Error al marcar la alerta", code: "ALERT_READ_ERROR" });
  }
});

module.exports = router;
module.exports.generateApiKey = generateApiKey;
module.exports.hashKey = hashKey;
