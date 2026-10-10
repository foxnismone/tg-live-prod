/**
 * ============================================================
 * RUTAS ADMIN — Taller / reparaciones
 * ============================================================
 * Gestión de órdenes de trabajo y alertas desde el panel de operador.
 * Todas requieren autenticación de admin u operador.
 *
 *   GET    /api/v1/admin/repairs                 → listar órdenes (filtros)
 *   GET    /api/v1/admin/repairs/stats           → estadísticas
 *   GET    /api/v1/admin/repairs/:id             → detalle + eventos
 *   POST   /api/v1/admin/repairs                 → crear orden
 *   PUT    /api/v1/admin/repairs/:id             → actualizar orden
 *   POST   /api/v1/admin/repairs/:id/events      → añadir evento
 *   DELETE /api/v1/admin/repairs/:id             → desactivar orden
 *   GET    /api/v1/admin/repairs-alerts          → alertas
 *   POST   /api/v1/admin/repairs-alerts/:id/read → marcar leída
 *   GET    /api/v1/admin/repairs-lookups/:id     → historial de consultas
 *   GET    /api/v1/admin/repair-keys             → claves de API
 *   POST   /api/v1/admin/repair-keys             → crear clave
 *   DELETE /api/v1/admin/repair-keys/:id         → revocar clave
 * ============================================================
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../config/database");
const {
  normalizeRut, isValidRut, formatRut,
  normalizeSerial, normalizeWorkOrder,
} = require("../utils/rut");

const { STATUS_META } = require("./repairs");
const { generateApiKey } = require("./repairs-api");

const VALID_STATUSES = Object.keys(STATUS_META);
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];

/* ─── Generador de número de orden ───────────────────────── */
function generateWorkOrder() {
  const year = new Date().getFullYear();
  const prefix = `OT-${year}-`;
  const last = db.prepare(
    `SELECT work_order FROM repair_orders WHERE work_order LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`);

  let next = 1;
  if (last) {
    const parsed = parseInt(last.work_order.slice(prefix.length), 10);
    if (!Number.isNaN(parsed)) next = parsed + 1;
  }

  let candidate = `${prefix}${String(next).padStart(6, "0")}`;
  while (db.prepare("SELECT 1 FROM repair_orders WHERE work_order = ?").get(candidate)) {
    next++;
    candidate = `${prefix}${String(next).padStart(6, "0")}`;
  }
  return candidate;
}

/* ─── Serialización ──────────────────────────────────────── */
function serialize(r, { withRut = true } = {}) {
  return {
    id: r.id,
    workOrder: r.work_order,
    rut: withRut ? formatRut(r.rut) : undefined,
    serialNumber: r.serial_number,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    customerPhone: r.customer_phone,
    deviceType: r.device_type,
    deviceBrand: r.device_brand,
    deviceModel: r.device_model,
    reportedIssue: r.reported_issue,
    diagnosis: r.diagnosis,
    status: r.status,
    statusLabel: STATUS_META[r.status]?.label || r.status,
    statusIcon: STATUS_META[r.status]?.icon || "•",
    priority: r.priority,
    technician: r.technician,
    estimatedCost: r.estimated_cost,
    finalCost: r.final_cost,
    warrantyDays: r.warranty_days,
    receivedAt: r.received_at,
    promisedAt: r.promised_at,
    deliveredAt: r.delivered_at,
    externalRef: r.external_ref,
    source: r.source,
    isActive: !!r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ══════════════════════════════════════════════════════════
   GET /api/v1/admin/repairs — Listar
   ══════════════════════════════════════════════════════════ */
router.get("/repairs", (req, res) => {
  try {
    const { status, search, priority, limit = 50, offset = 0, includeInactive } = req.query;
    const conditions = [];
    const params = [];

    if (includeInactive !== "true") conditions.push("is_active = 1");

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Estado inválido", code: "INVALID_STATUS", valid: VALID_STATUSES });
      }
      conditions.push("status = ?");
      params.push(status);
    }
    if (priority && VALID_PRIORITIES.includes(priority)) {
      conditions.push("priority = ?");
      params.push(priority);
    }
    if (search) {
      conditions.push(`(work_order LIKE ? OR rut LIKE ? OR serial_number LIKE ?
                        OR customer_name LIKE ? OR device_model LIKE ?)`);
      const like = `%${String(search).trim()}%`;
      const likeRut = `%${normalizeRut(search)}%`;
      params.push(like, likeRut, like.toUpperCase(), like, like);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const lim = Math.min(Number(limit) || 50, 200);
    const off = Math.max(Number(offset) || 0, 0);

    const rows = db.prepare(
      `SELECT * FROM repair_orders ${where}
       ORDER BY
         CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         updated_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, lim, off);

    const total = db.prepare(`SELECT COUNT(*) AS c FROM repair_orders ${where}`).get(...params).c;

    res.json({
      repairs: rows.map(r => serialize(r)),
      pagination: { total, limit: lim, offset: off },
    });
  } catch (err) {
    console.error("Error listando reparaciones:", err);
    res.status(500).json({ error: "Error al listar órdenes", code: "REPAIRS_LIST_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/v1/admin/repairs/stats — Estadísticas
   ══════════════════════════════════════════════════════════ */
router.get("/repairs/stats", (req, res) => {
  try {
    const byStatus = db.prepare(
      `SELECT status, COUNT(*) AS c FROM repair_orders WHERE is_active = 1 GROUP BY status`
    ).all();

    const stats = {
      total: db.prepare("SELECT COUNT(*) AS c FROM repair_orders WHERE is_active = 1").get().c,
      active: db.prepare(
        `SELECT COUNT(*) AS c FROM repair_orders
         WHERE is_active = 1 AND status NOT IN ('delivered','cancelled','unrepairable')`
      ).get().c,
      ready: db.prepare(
        "SELECT COUNT(*) AS c FROM repair_orders WHERE is_active = 1 AND status = 'ready'"
      ).get().c,
      urgent: db.prepare(
        `SELECT COUNT(*) AS c FROM repair_orders
         WHERE is_active = 1 AND priority IN ('urgent','high')
           AND status NOT IN ('delivered','cancelled','unrepairable')`
      ).get().c,
      deliveredThisMonth: db.prepare(
        `SELECT COUNT(*) AS c FROM repair_orders
         WHERE status = 'delivered' AND delivered_at >= date('now','start of month')`
      ).get().c,
      unreadAlerts: db.prepare("SELECT COUNT(*) AS c FROM repair_alerts WHERE is_read = 0").get().c,
      lookupsToday: db.prepare(
        "SELECT COUNT(*) AS c FROM repair_lookups WHERE created_at >= date('now')"
      ).get().c,
      failedLookupsToday: db.prepare(
        "SELECT COUNT(*) AS c FROM repair_lookups WHERE success = 0 AND created_at >= date('now')"
      ).get().c,
      byStatus: byStatus.reduce((acc, r) => {
        acc[r.status] = { count: r.c, label: STATUS_META[r.status]?.label || r.status };
        return acc;
      }, {}),
      revenue: {
        estimated: db.prepare(
          `SELECT COALESCE(SUM(estimated_cost),0) AS s FROM repair_orders
           WHERE is_active = 1 AND status NOT IN ('delivered','cancelled')`
        ).get().s,
        final: db.prepare(
          `SELECT COALESCE(SUM(final_cost),0) AS s FROM repair_orders
           WHERE status = 'delivered' AND delivered_at >= date('now','start of month')`
        ).get().s,
      },
    };

    res.json({ stats });
  } catch (err) {
    console.error("Error en stats de reparaciones:", err);
    res.status(500).json({ error: "Error al obtener estadísticas", code: "REPAIR_STATS_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/v1/admin/repairs/:id — Detalle
   ══════════════════════════════════════════════════════════ */
router.get("/repairs/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const row = db.prepare("SELECT * FROM repair_orders WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: "Orden no encontrada", code: "NOT_FOUND" });

    const events = db.prepare(
      `SELECT * FROM repair_events WHERE repair_id = ? ORDER BY created_at ASC`
    ).all(id);

    const lookups = db.prepare(
      `SELECT success, ip_address, created_at FROM repair_lookups
       WHERE repair_id = ? ORDER BY created_at DESC LIMIT 50`
    ).all(id);

    res.json({
      repair: serialize(row),
      events: events.map(e => ({
        id: e.id,
        status: e.status,
        statusLabel: STATUS_META[e.status]?.label || e.status,
        note: e.note,
        internalNote: e.internal_note,
        technician: e.technician,
        createdBy: e.created_by,
        date: e.created_at,
      })),
      lookups: lookups.map(l => ({
        success: !!l.success,
        ip: l.ip_address,
        date: l.created_at,
      })),
      lookupCount: lookups.length,
    });
  } catch (err) {
    console.error("Error obteniendo reparación:", err);
    res.status(500).json({ error: "Error al obtener la orden", code: "REPAIR_GET_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   POST /api/v1/admin/repairs — Crear
   ══════════════════════════════════════════════════════════ */
router.post("/repairs", (req, res) => {
  try {
    const b = req.body || {};
    const rut = normalizeRut(b.rut);
    const serial = normalizeSerial(b.serialNumber);
    const customerName = String(b.customerName || "").trim().slice(0, 200);

    const errors = [];
    if (!rut) errors.push("El RUT es obligatorio.");
    else if (!isValidRut(rut)) errors.push("El RUT no es válido (dígito verificador incorrecto).");
    if (!serial) errors.push("El número de serie es obligatorio.");
    if (!customerName) errors.push("El nombre del cliente es obligatorio.");

    if (errors.length) {
      return res.status(400).json({ error: "Datos incompletos.", code: "VALIDATION_ERROR", details: errors });
    }

    const status = VALID_STATUSES.includes(b.status) ? b.status : "received";
    const priority = VALID_PRIORITIES.includes(b.priority) ? b.priority : "normal";

    let workOrder;
    let repairId;

    const tx = db.transaction(() => {
      workOrder = b.workOrder ? normalizeWorkOrder(b.workOrder) : generateWorkOrder();

      if (db.prepare("SELECT 1 FROM repair_orders WHERE work_order = ?").get(workOrder)) {
        throw new Error("DUPLICATE_WORK_ORDER");
      }

      const result = db.prepare(
        `INSERT INTO repair_orders
           (work_order, rut, serial_number, customer_name, customer_email, customer_phone,
            device_type, device_brand, device_model, reported_issue, diagnosis,
            status, priority, technician, estimated_cost, final_cost, warranty_days,
            promised_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`
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
        b.promisedAt || null
      );

      repairId = Number(result.lastInsertRowid);

      db.prepare(
        `INSERT INTO repair_events (repair_id, status, note, technician, created_by)
         VALUES (?, ?, ?, ?, 'operator')`
      ).run(
        repairId, status,
        b.note ? String(b.note).slice(0, 1000) : "Orden creada.",
        b.technician ? String(b.technician).slice(0, 120) : null
      );
    });

    try {
      tx();
    } catch (err) {
      if (err.message === "DUPLICATE_WORK_ORDER") {
        return res.status(409).json({
          error: "Ya existe una orden con ese número.",
          code: "DUPLICATE_WORK_ORDER",
        });
      }
      throw err;
    }

    const saved = db.prepare("SELECT * FROM repair_orders WHERE id = ?").get(repairId);
    res.status(201).json({ message: "Orden creada.", repair: serialize(saved) });
  } catch (err) {
    console.error("Error creando reparación:", err);
    res.status(500).json({ error: "Error al crear la orden", code: "REPAIR_CREATE_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   PUT /api/v1/admin/repairs/:id — Actualizar
   ══════════════════════════════════════════════════════════ */
router.put("/repairs/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const existing = db.prepare("SELECT * FROM repair_orders WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ error: "Orden no encontrada", code: "NOT_FOUND" });

    const b = req.body || {};

    // Lista blanca de campos editables
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
      estimatedCost: ["estimated_cost", "num"],
      finalCost: ["final_cost", "num"],
      warrantyDays: ["warranty_days", "num"],
      promisedAt: ["promised_at", "str", 30],
      priority: ["priority", "enum", VALID_PRIORITIES],
      status: ["status", "enum", VALID_STATUSES],
    };

    const updates = [];
    const values = [];
    let statusChanged = false;

    for (const [field, [col, type, extra]] of Object.entries(ALLOWED)) {
      if (b[field] === undefined) continue;

      let value;
      if (type === "num") value = Number(b[field]) || 0;
      else if (type === "enum") {
        if (!extra.includes(b[field])) {
          return res.status(400).json({ error: `Valor inválido para ${field}.`, code: "INVALID_VALUE", valid: extra });
        }
        value = b[field];
        if (field === "status" && value !== existing.status) statusChanged = true;
      } else value = String(b[field]).slice(0, extra);

      updates.push(`${col} = ?`);
      values.push(value);
    }

    if (!updates.length) {
      return res.status(400).json({ error: "No hay campos para actualizar.", code: "NO_FIELDS" });
    }

    updates.push("updated_at = datetime('now')");
    if (b.status === "delivered") updates.push("delivered_at = datetime('now')");
    values.push(id);

    const tx = db.transaction(() => {
      db.prepare(`UPDATE repair_orders SET ${updates.join(", ")} WHERE id = ?`).run(...values);

      // Si cambió el estado, registrar el evento automáticamente
      if (statusChanged) {
        db.prepare(
          `INSERT INTO repair_events (repair_id, status, note, technician, created_by)
           VALUES (?, ?, ?, ?, 'operator')`
        ).run(
          id, b.status,
          b.note ? String(b.note).slice(0, 1000) : null,
          b.technician ? String(b.technician).slice(0, 120) : null
        );
      }
    });

    tx();

    const updated = db.prepare("SELECT * FROM repair_orders WHERE id = ?").get(id);
    res.json({ message: "Orden actualizada.", repair: serialize(updated) });
  } catch (err) {
    console.error("Error actualizando reparación:", err);
    res.status(500).json({ error: "Error al actualizar la orden", code: "REPAIR_UPDATE_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   POST /api/v1/admin/repairs/:id/events — Añadir evento
   ══════════════════════════════════════════════════════════ */
router.post("/repairs/:id/events", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const repair = db.prepare("SELECT * FROM repair_orders WHERE id = ?").get(id);
    if (!repair) return res.status(404).json({ error: "Orden no encontrada", code: "NOT_FOUND" });

    const b = req.body || {};
    const status = VALID_STATUSES.includes(b.status) ? b.status : repair.status;

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO repair_events (repair_id, status, note, internal_note, technician, created_by)
         VALUES (?, ?, ?, ?, ?, 'operator')`
      ).run(
        id, status,
        b.note ? String(b.note).slice(0, 1000) : null,
        b.internalNote ? String(b.internalNote).slice(0, 1000) : null,
        b.technician ? String(b.technician).slice(0, 120) : null
      );

      const updates = ["status = ?", "updated_at = datetime('now')"];
      const values = [status];

      if (b.technician) { updates.push("technician = ?"); values.push(String(b.technician).slice(0, 120)); }
      if (b.diagnosis) { updates.push("diagnosis = ?"); values.push(String(b.diagnosis).slice(0, 2000)); }
      if (b.finalCost !== undefined) { updates.push("final_cost = ?"); values.push(Number(b.finalCost) || 0); }
      if (status === "delivered") updates.push("delivered_at = datetime('now')");

      values.push(id);
      db.prepare(`UPDATE repair_orders SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    });

    tx();

    const updated = db.prepare("SELECT * FROM repair_orders WHERE id = ?").get(id);
    res.json({ message: "Evento registrado.", repair: serialize(updated) });
  } catch (err) {
    console.error("Error añadiendo evento:", err);
    res.status(500).json({ error: "Error al registrar el evento", code: "REPAIR_EVENT_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   DELETE /api/v1/admin/repairs/:id — Desactivar (soft delete)
   ══════════════════════════════════════════════════════════ */
router.delete("/repairs/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const result = db.prepare(
      "UPDATE repair_orders SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Orden no encontrada", code: "NOT_FOUND" });
    }

    res.json({ message: "Orden desactivada.", id });
  } catch (err) {
    console.error("Error desactivando reparación:", err);
    res.status(500).json({ error: "Error al desactivar la orden", code: "REPAIR_DELETE_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   ALERTAS
   ══════════════════════════════════════════════════════════ */
router.get("/repairs-alerts", (req, res) => {
  try {
    const onlyUnread = req.query.unread !== "false";
    const sql = `
      SELECT a.*, r.work_order, r.customer_name, r.customer_phone, r.customer_email, r.status
      FROM repair_alerts a
      LEFT JOIN repair_orders r ON a.repair_id = r.id
      ${onlyUnread ? "WHERE a.is_read = 0" : ""}
      ORDER BY
        CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
        a.created_at DESC
      LIMIT 200`;

    const rows = db.prepare(sql).all();

    res.json({
      alerts: rows.map(a => ({
        id: a.id,
        repairId: a.repair_id,
        type: a.type,
        severity: a.severity,
        message: a.message,
        data: a.data ? JSON.parse(a.data) : null,
        isRead: !!a.is_read,
        workOrder: a.work_order || null,
        customerName: a.customer_name || null,
        customerPhone: a.customer_phone || null,
        customerEmail: a.customer_email || null,
        repairStatus: a.status || null,
        createdAt: a.created_at,
      })),
      unreadCount: db.prepare("SELECT COUNT(*) AS c FROM repair_alerts WHERE is_read = 0").get().c,
    });
  } catch (err) {
    console.error("Error obteniendo alertas:", err);
    res.status(500).json({ error: "Error al obtener alertas", code: "ALERTS_ERROR" });
  }
});

router.post("/repairs-alerts/:id/read", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }
    const r = db.prepare("UPDATE repair_alerts SET is_read = 1 WHERE id = ?").run(id);
    if (r.changes === 0) return res.status(404).json({ error: "Alerta no encontrada", code: "NOT_FOUND" });
    res.json({ message: "Alerta marcada como leída." });
  } catch (err) {
    console.error("Error marcando alerta:", err);
    res.status(500).json({ error: "Error al marcar la alerta", code: "ALERT_READ_ERROR" });
  }
});

router.post("/repairs-alerts/read-all", (req, res) => {
  try {
    const r = db.prepare("UPDATE repair_alerts SET is_read = 1 WHERE is_read = 0").run();
    res.json({ message: `${r.changes} alerta(s) marcada(s) como leída(s).`, count: r.changes });
  } catch (err) {
    console.error("Error marcando alertas:", err);
    res.status(500).json({ error: "Error al marcar las alertas", code: "ALERTS_READ_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   HISTORIAL DE CONSULTAS (auditoría del cliente)
   ══════════════════════════════════════════════════════════ */
router.get("/repairs-lookups", (req, res) => {
  try {
    const { repairId, hours = 24, limit = 200 } = req.query;

    // OJO: `created_at` existe en repair_lookups Y en repair_orders, así que
    // en el JOIN hay que cualificarlo (l.created_at) o SQLite lanza
    // "ambiguous column name: created_at" y el endpoint devuelve 500.
    const conditions = [`l.created_at >= datetime('now', '-${Math.min(Number(hours) || 24, 720)} hours')`];
    const params = [];

    if (repairId) {
      conditions.push("l.repair_id = ?");
      params.push(Number(repairId));
    }

    const rows = db.prepare(
      `SELECT l.*, r.work_order, r.customer_name
       FROM repair_lookups l
       LEFT JOIN repair_orders r ON l.repair_id = r.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY l.created_at DESC LIMIT ?`
    ).all(...params, Math.min(Number(limit) || 200, 500));

    res.json({
      lookups: rows.map(l => ({
        id: l.id,
        repairId: l.repair_id,
        workOrder: l.work_order || null,
        customerName: l.customer_name || null,
        success: !!l.success,
        ipAddress: l.ip_address,
        userAgent: l.user_agent,
        createdAt: l.created_at,
      })),
      total: rows.length,
    });
  } catch (err) {
    console.error("Error obteniendo consultas:", err);
    res.status(500).json({ error: "Error al obtener consultas", code: "LOOKUPS_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   CLAVES DE API DEL TALLER
   ══════════════════════════════════════════════════════════ */
router.get("/repair-keys", (req, res) => {
  try {
    const rows = db.prepare(
      `SELECT id, name, key_prefix, scopes, is_active, last_used_at, created_at
       FROM repair_api_keys ORDER BY id DESC`
    ).all();

    res.json({
      keys: rows.map(k => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.key_prefix,
        scopes: k.scopes,
        isActive: !!k.is_active,
        lastUsedAt: k.last_used_at,
        createdAt: k.created_at,
      })),
    });
  } catch (err) {
    console.error("Error listando claves:", err);
    res.status(500).json({ error: "Error al listar claves", code: "KEYS_ERROR" });
  }
});

router.post("/repair-keys", (req, res) => {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 120);
    if (!name) {
      return res.status(400).json({ error: "El nombre es obligatorio.", code: "VALIDATION_ERROR" });
    }

    const VALID_SCOPES = ["repairs:read", "repairs:write"];
    let scopes = VALID_SCOPES;
    if (Array.isArray(req.body?.scopes) && req.body.scopes.length) {
      scopes = req.body.scopes.filter(s => VALID_SCOPES.includes(s));
      if (!scopes.length) {
        return res.status(400).json({ error: "Scopes inválidos.", code: "INVALID_SCOPES", valid: VALID_SCOPES });
      }
    }

    const { key, prefix, hash } = generateApiKey();

    db.prepare(
      "INSERT INTO repair_api_keys (name, key_hash, key_prefix, scopes) VALUES (?, ?, ?, ?)"
    ).run(name, hash, prefix, scopes.join(","));

    // El secreto se devuelve UNA vez. El servidor solo guarda el hash.
    res.status(201).json({
      message: "Clave creada. Guárdala ahora: no se puede recuperar.",
      key,
      keyPrefix: prefix,
      name,
      scopes,
    });
  } catch (err) {
    console.error("Error creando clave:", err);
    res.status(500).json({ error: "Error al crear la clave", code: "KEY_CREATE_ERROR" });
  }
});

router.delete("/repair-keys/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }
    const r = db.prepare("UPDATE repair_api_keys SET is_active = 0 WHERE id = ?").run(id);
    if (r.changes === 0) return res.status(404).json({ error: "Clave no encontrada", code: "NOT_FOUND" });
    res.json({ message: "Clave revocada.", id });
  } catch (err) {
    console.error("Error revocando clave:", err);
    res.status(500).json({ error: "Error al revocar la clave", code: "KEY_REVOKE_ERROR" });
  }
});

module.exports = router;
