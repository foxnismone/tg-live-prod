/**
 * ============================================================
 * RUTAS PÚBLICAS — Seguimiento de reparaciones (taller)
 * ============================================================
 * El cliente consulta el estado de su equipo con TRES datos que
 * deben coincidir exactamente:
 *
 *   1. Número de orden de trabajo  (OT-2026-000123)
 *   2. RUT del cliente             (12.345.678-9)
 *   3. Número de serie del equipo  (SN-ABC123)
 *
 * Los tres son necesarios: con solo la orden, cualquiera que vea un
 * papel podría leer el historial. El nombre completo se usa como
 * cuarto factor opcional de refuerzo.
 *
 * Endpoints:
 *   POST /api/v1/repairs/track        → consulta del cliente
 *   GET  /api/v1/repairs/status/:ot   → (uso interno) estado resumido
 *   POST /api/v1/repairs/feedback     → el cliente pide que lo contacten
 *
 * Módulo configurable: si `repair_enabled` = '0', todo responde 404.
 * ============================================================
 */

"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const router = express.Router();

const db = require("../config/database");
const {
  normalizeRut, isValidRut, formatRut,
  normalizeSerial, normalizeWorkOrder, normalizeName,
  hashRut,
} = require("../utils/rut");

const isProd = process.env.NODE_ENV === "production";

/* ─── Estados legibles para el cliente ────────────────────── */
const STATUS_META = {
  received:      { label: "Recibido",              icon: "📥", step: 1, desc: "Registramos tu equipo en el taller." },
  diagnosing:    { label: "En diagnóstico",        icon: "🔍", step: 2, desc: "Un técnico está evaluando la falla." },
  waiting_parts: { label: "Esperando repuestos",   icon: "📦", step: 3, desc: "El diagnóstico está listo y esperamos los repuestos." },
  in_repair:     { label: "En reparación",         icon: "🔧", step: 4, desc: "El técnico está trabajando en tu equipo." },
  testing:       { label: "En pruebas",            icon: "🧪", step: 5, desc: "Verificamos que todo funcione antes de entregarlo." },
  ready:         { label: "Listo para retiro",     icon: "✅", step: 6, desc: "Tu equipo está listo. Puedes venir a retirarlo." },
  delivered:     { label: "Entregado",             icon: "🎉", step: 7, desc: "Equipo entregado al cliente." },
  cancelled:     { label: "Cancelado",             icon: "🚫", step: 0, desc: "La orden fue cancelada." },
  unrepairable:  { label: "No reparable",          icon: "⚠️", step: 0, desc: "El equipo no puede repararse. Te contactaremos." },
};

const TOTAL_STEPS = 7;

/* ─── ¿Está activo el módulo? ─────────────────────────────── */
function moduleEnabled() {
  try {
    const row = db.prepare("SELECT value FROM site_settings WHERE key = 'repair_enabled'").get();
    return !row || row.value === "1" || row.value === "true";
  } catch (_) {
    return true;
  }
}

/* ─── Rate limiting de consultas ──────────────────────────── */
// Consultar un estado es barato, pero el endpoint es público y acepta
// RUT: sin límite sirve para enumerar órdenes. 10 consultas cada 10 min
// por IP es holgado para un cliente legítimo.
const trackLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: isProd ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !isProd && req.get("x-load-test") === "1",
  message: {
    error: "Demasiadas consultas seguidas. Espera unos minutos antes de volver a intentar.",
    code: "REPAIR_RATE_LIMITED",
  },
});

/* ─── Detección de consultas excesivas (alertas al equipo) ── */
/**
 * Cuenta las consultas recientes de una misma orden y, si superan el
 * umbral, genera una alerta para que el equipo contacte al cliente.
 *
 * IMPORTANTE: las comparaciones de fecha usan datetime('now', ...) de
 * SQLite, NO fechas ISO de JavaScript. SQLite guarda 'YYYY-MM-DD HH:MM:SS'
 * (con espacio) y JS genera 'YYYY-MM-DDTHH:MM:SS.sssZ' (con T). Como el
 * espacio (0x20) es menor que la T (0x54), comparar strings mezclados
 * hace que la condición sea SIEMPRE falsa cuando es el mismo día:
 * la alerta existente nunca se encontraba y se duplicaba en cada consulta.
 */
function checkFrequentLookups(repairId, workOrder) {
  try {
    const recent = db.prepare(
      `SELECT COUNT(*) AS c FROM repair_lookups
       WHERE repair_id = ? AND success = 1
         AND created_at >= datetime('now', '-24 hours')`
    ).get(repairId).c;

    // Avisar al equipo a partir de la 4ª consulta en 24 h.
    const THRESHOLD = 4;
    if (recent < THRESHOLD) return;

    // Una sola alerta por orden y día: si ya existe, actualizar el conteo
    // en vez de crear otra (evita 10 alertas idénticas del mismo caso).
    const existing = db.prepare(
      `SELECT id FROM repair_alerts
       WHERE repair_id = ? AND type = 'frequent_lookup'
         AND created_at >= datetime('now', '-24 hours')
       ORDER BY id DESC LIMIT 1`
    ).get(repairId);

    const severity = recent >= 10 ? "critical" : recent >= 6 ? "warning" : "info";
    const message = `El cliente de la orden ${workOrder} consultó ${recent} veces en 24 h. Conviene contactarlo.`;
    const data = JSON.stringify({ lookups24h: recent, workOrder });

    if (existing) {
      db.prepare(
        `UPDATE repair_alerts SET message = ?, data = ?, severity = ? WHERE id = ?`
      ).run(message, data, severity, existing.id);
      return;
    }

    db.prepare(
      `INSERT INTO repair_alerts (repair_id, type, severity, message, data)
       VALUES (?, 'frequent_lookup', ?, ?, ?)`
    ).run(repairId, severity, message, data);
  } catch (err) {
    console.error("Error generando alerta de consultas:", err.message);
  }
}

/* ─── Detección de intentos fallidos (posible enumeración) ── */
function checkManyFailures(ip, workOrder) {
  try {
    // Misma regla: comparar con datetime() de SQLite, nunca con ISO de JS.
    const fails = db.prepare(
      `SELECT COUNT(*) AS c FROM repair_lookups
       WHERE success = 0 AND ip_address = ?
         AND created_at >= datetime('now', '-1 hour')`
    ).get(ip).c;

    if (fails < 8) return;

    // Una alerta por IP cada 6 h; si existe, se actualiza el conteo.
    const existing = db.prepare(
      `SELECT id FROM repair_alerts
       WHERE type = 'many_failures' AND data LIKE ?
         AND created_at >= datetime('now', '-6 hours')
       ORDER BY id DESC LIMIT 1`
    ).get(`%"ip":"${ip}"%`);

    const severity = fails >= 30 ? "critical" : "warning";
    const message = `Se detectaron ${fails} consultas fallidas desde la IP ${ip} en 1 hora. Posible intento de enumeración de órdenes.`;
    const data = JSON.stringify({ ip, failures1h: fails, lastWorkOrder: workOrder });

    if (existing) {
      db.prepare(
        `UPDATE repair_alerts SET message = ?, data = ?, severity = ? WHERE id = ?`
      ).run(message, data, severity, existing.id);
      return;
    }

    db.prepare(
      `INSERT INTO repair_alerts (repair_id, type, severity, message, data)
       VALUES (NULL, 'many_failures', ?, ?, ?)`
    ).run(severity, message, data);
  } catch (err) {
    console.error("Error generando alerta de fallos:", err.message);
  }
}

/* ─── Registro de cada consulta ───────────────────────────── */
function logLookup({ repairId, workOrder, rut, success, req }) {
  try {
    db.prepare(
      `INSERT INTO repair_lookups (repair_id, work_order, rut_hash, success, ip_address, user_agent, referrer)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      repairId || null,
      workOrder || null,
      rut ? hashRut(rut, process.env.JWT_SECRET || "tg-salt") : null,
      success ? 1 : 0,
      req.ip || null,
      (req.get("user-agent") || "").slice(0, 300),
      (req.get("referer") || "").slice(0, 300) || null
    );
  } catch (err) {
    console.error("Error registrando consulta:", err.message);
  }
}

/* ─── Construcción de la respuesta pública ────────────────── */
function buildTimeline(repairId) {
  const events = db.prepare(
    `SELECT status, note, technician, created_at
     FROM repair_events
     WHERE repair_id = ? AND internal_note IS NULL OR (repair_id = ? AND note IS NOT NULL)
     ORDER BY created_at ASC`
  ).all(repairId, repairId);

  // Filtrar: solo eventos con nota visible o cambio de estado
  return events
    .filter(e => e.status || e.note)
    .map(e => ({
      status: e.status,
      label: STATUS_META[e.status]?.label || e.status,
      icon: STATUS_META[e.status]?.icon || "•",
      note: e.note || null,
      technician: e.technician || null,
      date: e.created_at,
    }));
}

function buildProgress(status) {
  const meta = STATUS_META[status] || STATUS_META.received;
  return {
    step: meta.step,
    total: TOTAL_STEPS,
    percent: meta.step > 0 ? Math.round((meta.step / TOTAL_STEPS) * 100) : 0,
    label: meta.label,
    icon: meta.icon,
    description: meta.desc,
  };
}

/* ══════════════════════════════════════════════════════════
   POST /api/v1/repairs/track — Consulta del cliente
   ══════════════════════════════════════════════════════════ */
router.post("/track", trackLimiter, (req, res) => {
  if (!moduleEnabled()) {
    return res.status(404).json({ error: "Módulo no disponible", code: "MODULE_DISABLED" });
  }

  const ip = req.ip || "desconocida";

  try {
    const rawWorkOrder = req.body?.workOrder;
    const rawRut = req.body?.rut;
    const rawSerial = req.body?.serialNumber;
    const rawName = req.body?.customerName;

    /* ─── Validación de formato ─── */
    const workOrder = normalizeWorkOrder(rawWorkOrder);
    const rut = normalizeRut(rawRut);
    const serial = normalizeSerial(rawSerial);

    const missing = [];
    if (!workOrder) missing.push("número de orden");
    if (!rut) missing.push("RUT");
    if (!serial) missing.push("número de serie");

    if (missing.length) {
      return res.status(400).json({
        error: `Falta completar: ${missing.join(", ")}.`,
        code: "MISSING_FIELDS",
        missing,
      });
    }

    if (!isValidRut(rut)) {
      // No registrar como fallo de seguridad: puede ser un error de tipeo.
      return res.status(400).json({
        error: "El RUT no es válido. Revísalo (ejemplo: 12.345.678-9).",
        code: "INVALID_RUT",
      });
    }

    /* ─── Búsqueda ─── */
    // Los TRES datos deben coincidir. La comparación de RUT y serie es
    // exacta sobre valores normalizados.
    const repair = db.prepare(
      `SELECT * FROM repair_orders
       WHERE work_order = ? AND rut = ? AND serial_number = ? AND is_active = 1`
    ).get(workOrder, rut, serial);

    if (!repair) {
      logLookup({ repairId: null, workOrder, rut, success: false, req });
      checkManyFailures(ip, workOrder);

      // Mensaje genérico: no revelar CUÁL dato falló (evita enumeración).
      return res.status(404).json({
        error: "No encontramos una orden con esos datos. Verifica el número de orden, el RUT y el número de serie.",
        code: "NOT_FOUND",
      });
    }

    /* ─── Cuarto factor opcional: nombre completo ─── */
    // Si el cliente envía su nombre, debe coincidir (tolerante a orden y acentos).
    if (rawName && String(rawName).trim()) {
      const given = normalizeName(rawName);
      const stored = normalizeName(repair.customer_name);
      if (given && stored && given !== stored) {
        logLookup({ repairId: null, workOrder, rut, success: false, req });
        return res.status(404).json({
          error: "No encontramos una orden con esos datos. Verifica el número de orden, el RUT y el número de serie.",
          code: "NOT_FOUND",
        });
      }
    }

    /* ─── Registro y alertas ─── */
    logLookup({ repairId: repair.id, workOrder, rut, success: true, req });
    checkFrequentLookups(repair.id, repair.work_order);

    /* ─── Respuesta: solo lo que el cliente debe ver ─── */
    // Nunca se exponen notas internas, costos internos ni datos de otros.
    const timeline = buildTimeline(repair.id);

    res.json({
      repair: {
        workOrder: repair.work_order,
        customerName: repair.customer_name,
        rutMasked: maskRut(repair.rut),
        device: {
          type: repair.device_type,
          brand: repair.device_brand,
          model: repair.device_model,
          serialNumber: maskSerial(repair.serial_number),
        },
        reportedIssue: repair.reported_issue,
        diagnosis: repair.diagnosis,
        status: repair.status,
        statusLabel: STATUS_META[repair.status]?.label || repair.status,
        statusIcon: STATUS_META[repair.status]?.icon || "•",
        progress: buildProgress(repair.status),
        priority: repair.priority,
        technician: repair.technician,
        estimatedCost: repair.estimated_cost || 0,
        finalCost: repair.final_cost || 0,
        warrantyDays: repair.warranty_days || 0,
        receivedAt: repair.received_at,
        promisedAt: repair.promised_at,
        deliveredAt: repair.delivered_at,
        lastUpdate: repair.updated_at,
        timeline,
      },
    });
  } catch (err) {
    console.error("Error en /repairs/track:", err);
    res.status(500).json({
      error: "No pudimos consultar tu orden en este momento. Intenta más tarde.",
      code: "REPAIR_TRACK_ERROR",
    });
  }
});

/* ─── Enmascarado de datos en la respuesta ────────────────── */
// El cliente ya conoce sus datos (los escribió), pero enmascararlos
// evita que queden en el historial del navegador o en capturas.
function maskRut(rut) {
  const r = normalizeRut(rut);
  if (r.length < 3) return "•••";
  return `•••.${r.slice(-4, -1)}-${r.slice(-1)}`;
}
function maskSerial(serial) {
  const s = normalizeSerial(serial);
  if (s.length <= 4) return "••••";
  return `${"•".repeat(Math.min(6, s.length - 4))}${s.slice(-4)}`;
}

/* ══════════════════════════════════════════════════════════
   POST /api/v1/repairs/feedback — "Avísenme / tengo una duda"
   ══════════════════════════════════════════════════════════ */
router.post("/feedback", trackLimiter, (req, res) => {
  if (!moduleEnabled()) {
    return res.status(404).json({ error: "Módulo no disponible", code: "MODULE_DISABLED" });
  }

  try {
    const workOrder = normalizeWorkOrder(req.body?.workOrder);
    const rut = normalizeRut(req.body?.rut);
    const serial = normalizeSerial(req.body?.serialNumber);
    const message = String(req.body?.message || "").slice(0, 1000);
    const contactPreference = ["email", "phone", "whatsapp"].includes(req.body?.contactPreference)
      ? req.body.contactPreference
      : "phone";

    if (!workOrder || !rut || !serial) {
      return res.status(400).json({ error: "Faltan datos de la orden.", code: "MISSING_FIELDS" });
    }

    const repair = db.prepare(
      `SELECT id, work_order, customer_name FROM repair_orders
       WHERE work_order = ? AND rut = ? AND serial_number = ? AND is_active = 1`
    ).get(workOrder, rut, serial);

    if (!repair) {
      return res.status(404).json({ error: "No encontramos esa orden.", code: "NOT_FOUND" });
    }

    db.prepare(
      `INSERT INTO repair_alerts (repair_id, type, severity, message, data)
       VALUES (?, 'cost_question', 'info', ?, ?)`
    ).run(
      repair.id,
      `El cliente ${repair.customer_name} pidió contacto sobre la orden ${repair.work_order}.`,
      JSON.stringify({ message, contactPreference, workOrder: repair.work_order })
    );

    res.json({
      message: "Recibimos tu solicitud. Te contactaremos a la brevedad.",
      code: "FEEDBACK_RECEIVED",
    });
  } catch (err) {
    console.error("Error en /repairs/feedback:", err);
    res.status(500).json({ error: "No pudimos registrar tu solicitud.", code: "FEEDBACK_ERROR" });
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/v1/repairs/info — Datos públicos del taller
   ══════════════════════════════════════════════════════════ */
router.get("/info", (req, res) => {
  if (!moduleEnabled()) {
    return res.status(404).json({ error: "Módulo no disponible", code: "MODULE_DISABLED" });
  }

  try {
    const rows = db.prepare(
      `SELECT key, value FROM site_settings
       WHERE key IN ('repair_enabled','repair_name','repair_phone','repair_hours',
                     'repair_address','repair_warranty_days','repair_intro')`
    ).all();

    const s = {};
    for (const r of rows) s[r.key] = r.value;

    res.json({
      enabled: true,
      name: s.repair_name || "Taller TecnoGamer",
      phone: s.repair_phone || "",
      hours: s.repair_hours || "",
      address: s.repair_address || "",
      warrantyDays: Number(s.repair_warranty_days || 90),
      intro: s.repair_intro || "",
      statuses: Object.entries(STATUS_META).map(([k, v]) => ({
        key: k, label: v.label, icon: v.icon, step: v.step,
      })),
    });
  } catch (err) {
    console.error("Error en /repairs/info:", err);
    res.status(500).json({ error: "Error al obtener información", code: "REPAIR_INFO_ERROR" });
  }
});

module.exports = router;
module.exports.STATUS_META = STATUS_META;
