/**
 * ============================================================
 * RUTAS PÚBLICAS — Configuración del sitio
 * ============================================================
 * Expone SOLO la configuración que el frontend necesita para
 * renderizar la tienda. Nunca datos sensibles (keys, secretos).
 *
 *   GET /api/v1/config          → Configuración pública completa
 *   GET /api/v1/config/stores   → Tiendas activas (módulo desconectable)
 *
 * Módulos configurables:
 *   - store_enabled  → muestra/oculta toda la sección de tienda física
 *   - store_pickup_enabled → habilita retiro en tienda en el checkout
 *   - payment_gateway_enabled → '0' = carrito es orden de compra;
 *                               '1' = carrito es carro de compra (pago online)
 * ============================================================
 */

"use strict";

const express = require("express");
const router = express.Router();
const db = require("../config/database");
const config = require("../config");

// Claves de site_settings que SÍ se pueden exponer al público.
// Cualquier clave fuera de esta lista nunca sale del servidor.
const PUBLIC_SETTINGS = new Set([
  "site_name",
  "site_description",
  "currency",
  "locale",
  "contact_email",
  "support_phone",
  "address",
  "about_text",
  "shipping_flat_rate",
  "free_shipping_threshold",
  "tax_rate_default",
  "return_policy_days",
  "chat_welcome_message",
  "store_enabled",
  "store_name",
  "store_address",
  "store_hours",
  "store_phone",
  "store_pickup_enabled",
  "store_pickup_ready_minutes",
  "payment_gateway_enabled",
  "payment_gateway_provider",
  "cart_mode",
  // Módulo de taller (se exponen aquí para que el frontend sepa si mostrarlo)
  "repair_enabled",
]);

function readSettings() {
  const rows = db.prepare("SELECT key, value FROM site_settings").all();
  const out = {};
  for (const r of rows) {
    if (PUBLIC_SETTINGS.has(r.key)) out[r.key] = r.value;
  }
  return out;
}

const bool = (v) => v === "1" || v === "true";

// ─── GET /api/v1/config ──────────────────────────────────────
router.get("/", (req, res) => {
  try {
    const s = readSettings();

    // El modo del carrito se DERIVA de si la pasarela está activa.
    // Si no hay pasarela integrada, el carrito es una orden de compra
    // (el cliente envía su pedido y el operador lo confirma).
    const gatewayEnabled = bool(s.payment_gateway_enabled);
    const cartMode = gatewayEnabled ? "cart" : "purchase_order";

    res.json({
      site: {
        name: s.site_name || config.siteName,
        description: s.site_description || "",
        currency: s.currency || "CLP",
        locale: s.locale || "es-CL",
        contactEmail: s.contact_email || "",
        supportPhone: s.support_phone || "",
        address: s.address || "",
        aboutText: s.about_text || "",
      },
      commerce: {
        shippingFlatRate: Number(s.shipping_flat_rate || 0),
        freeShippingThreshold: Number(s.free_shipping_threshold || 0),
        taxRateDefault: Number(s.tax_rate_default || 0),
        returnPolicyDays: Number(s.return_policy_days || 0),
      },
      // ─── Módulos configurables ───
      modules: {
        store: {
          enabled: bool(s.store_enabled),
          pickupEnabled: bool(s.store_pickup_enabled),
          name: s.store_name || "",
          address: s.store_address || "",
          hours: s.store_hours || "",
          phone: s.store_phone || "",
          pickupReadyMinutes: Number(s.store_pickup_ready_minutes || 90),
        },
        payment: {
          gatewayEnabled,
          provider: s.payment_gateway_provider || null,
          cartMode, // 'purchase_order' | 'cart'
        },
        chat: {
          enabled: config.chatWebEnabled,
          welcomeMessage: config.chatWebEnabled ? (s.chat_welcome_message || "") : null,
        },
        repairs: {
          enabled: bool(s.repair_enabled),
        },
      },
    });
  } catch (err) {
    console.error("Error en GET /config:", err);
    res.status(500).json({ error: "Error al obtener la configuración", code: "CONFIG_ERROR" });
  }
});

// ─── GET /api/v1/config/stores ───────────────────────────────
// Devuelve [] si el módulo de tienda está desconectado.
router.get("/stores", (req, res) => {
  try {
    const s = readSettings();
    if (!bool(s.store_enabled)) {
      return res.json({ stores: [], moduleEnabled: false });
    }

    const onlyPickup = req.query.pickup === "true";
    const sql = onlyPickup
      ? "SELECT * FROM stores WHERE is_active = 1 AND is_pickup = 1 ORDER BY sort_order, name"
      : "SELECT * FROM stores WHERE is_active = 1 ORDER BY sort_order, name";

    const rows = db.prepare(sql).all();
    res.json({
      moduleEnabled: true,
      pickupEnabled: bool(s.store_pickup_enabled),
      stores: rows.map(r => ({
        id: r.id,
        code: r.code,
        name: r.name,
        address: r.address,
        city: r.city,
        region: r.region,
        phone: r.phone,
        hours: r.hours,
        latitude: r.latitude,
        longitude: r.longitude,
        isPickup: !!r.is_pickup,
      })),
    });
  } catch (err) {
    console.error("Error en GET /config/stores:", err);
    res.status(500).json({ error: "Error al obtener tiendas", code: "STORES_ERROR" });
  }
});

module.exports = router;
