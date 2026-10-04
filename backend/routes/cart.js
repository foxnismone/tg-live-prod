/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Rutas de Carrito de Compras
 * ============================================================
 *   GET    /api/v1/cart              → Ver carrito actual
 *   POST   /api/v1/cart              → Crear/actualizar carrito (reemplazar todo)
 *   POST   /api/v1/cart/items        → Agregar item al carrito
 *   PUT    /api/v1/cart/items/:idx   → Actualizar qty de item
 *   DELETE /api/v1/cart/items/:idx   → Remover item del carrito
 *   DELETE /api/v1/cart              → Vaciar carrito
 *   GET    /api/v1/cart/summary      → Subtotal, impuestos, envío estimado
 * ============================================================
 */

"use strict";

const express = require("express");
const db      = require("../config/database");
const {
  authenticateToken,
  optionalAuth,
  validate,
  sanitize,
} = require("../middleware/errorHandler");
const { body, query } = require("express-validator");

const router = express.Router();

// ─── Obtener carrito por session_id o user_id ──────────────
function getCart(sessionId = null, userId = null) {
  let cart = null;
  if (userId) {
    cart = db.prepare(
      `SELECT * FROM carts WHERE user_id = ? AND session_id LIKE 'cart-%'`
    ).get(userId);
  }
  if (!cart && sessionId) {
    cart = db.prepare(
      "SELECT * FROM carts WHERE session_id = ?"
    ).get(sessionId);
  }
  return cart;
}

function recalculateCart(cart) {
  if (!cart) return { items: [], subtotal: 0 };

  // Releer SIEMPRE desde la base de datos: el objeto `cart` en memoria
  // puede tener los items previos al último UPDATE, y usarlo sobrescribiría
  // el carrito recién modificado con datos obsoletos.
  const fresh = db.prepare("SELECT * FROM carts WHERE id = ?").get(cart.id);
  if (!fresh) return { items: [], subtotal: 0 };

  if (!fresh.items || fresh.items === "[]") {
    db.prepare("UPDATE carts SET items = '[]', subtotal = 0, updated_at = datetime('now') WHERE id = ?")
      .run(fresh.id);
    return { items: [], subtotal: 0 };
  }

  let items;
  try {
    items = JSON.parse(fresh.items);
  } catch (_) {
    items = [];
  }
  if (!Array.isArray(items)) items = [];

  let subtotal = 0;

  // Validar cada item (precio y stock actuales del producto)
  const validItems = [];
  for (const item of items) {
    const product = db.prepare(
      "SELECT id, price, stock_quantity, stock_status, name, sku FROM products WHERE id = ? AND is_active = 1"
    ).get(item.productId);
    if (!product) continue;                       // producto eliminado o inactivo
    if (product.stock_status === "out_of_stock") continue;

    let availQty = product.stock_quantity;
    let itemPrice = product.price;

    if (item.variantId) {
      const variant = db.prepare(
        "SELECT price, stock_qty FROM product_variants WHERE id = ? AND is_active = 1"
      ).get(item.variantId);
      if (variant) { availQty = variant.stock_qty; itemPrice = variant.price; }
    }

    const maxQty = Math.min(item.quantity, availQty, 999);
    if (maxQty <= 0) continue;

    validItems.push({
      ...item,
      quantity: maxQty,
      price: itemPrice,
      availableStock: availQty,
    });
    subtotal += itemPrice * maxQty;
  }

  // Persistir el resultado ya validado
  db.prepare(
    "UPDATE carts SET items = ?, subtotal = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(validItems), subtotal, fresh.id);

  return { items: validItems, subtotal };
}

// ─── GET /api/v1/cart — Ver carrito ────────────────────────
router.get("/", sanitize, (req, res) => {
  try {
    let cart = null;

    if (req.user) {
      cart = getCart(null, req.user.userId);
    }

    if (!cart && req.query.sessionId) {
      cart = getCart(req.query.sessionId);
    }

    if (!cart) {
      // Crear carrito anónimo temporal
      const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newCart = db.prepare(
        `INSERT INTO carts (session_id, items, subtotal) VALUES (?, '[]', 0)`
      ).run(sessionId);
      cart = db.prepare("SELECT * FROM carts WHERE id = ?").get(newCart.lastInsertRowid);
    }

    const { items, subtotal } = recalculateCart(cart);

    res.json({
      cart: {
        id: cart.id,
        sessionId: cart.session_id,
        userId: cart.user_id || null,
        items,
        subtotal,
        currency: cart.currency || "USD",
        updatedAt: cart.updated_at,
      },
    });
  } catch (err) {
    console.error("Error en GET /cart:", err);
    res.status(500).json({ error: "Error al obtener carrito", code: "CART_ERROR" });
  }
});

// ─── POST /api/v1/cart — Reemplazar carrito completo ──────
router.post("/", optionalAuth, sanitize, [
  body("items").isArray({ min: 0, max: 100 }).withMessage("items debe ser un array"),
  body("currency").optional().trim().isLength({ min: 2, max: 5 }),
  validate,
], (req, res) => {
  try {
    const { items, currency } = req.body;
    const userId = req.user.userId;
    const currencyCode = (currency || "USD").toUpperCase();

    // Obtener o crear carrito del usuario
    let cart = db.prepare(
      `SELECT * FROM carts WHERE user_id = ? AND session_id LIKE 'cart-%'`
    ).get(userId);

    if (!cart) {
      const sessionId = `cart-${userId}`;
      const result = db.prepare(
        `INSERT INTO carts (user_id, session_id, items, subtotal, currency) VALUES (?, ?, '[]', 0, ?)`
      ).run(userId, sessionId, currencyCode);
      cart = db.prepare("SELECT * FROM carts WHERE id = ?").get(result.lastInsertRowid);
    }

    // Validar y construir items
    const validItems = [];
    let subtotal = 0;

    for (const itemInput of items) {
      const { productId, variantId, quantity, price } = itemInput;

      if (!productId || !/^\d+$/.test(productId)) continue;
      if (!quantity || quantity < 1) continue;
      if (quantity > 999) continue;

      const product = db.prepare(
        "SELECT id, price, stock_quantity, stock_status, name, sku FROM products WHERE id = ? AND is_active = 1"
      ).get(productId);

      if (!product) continue;
      if (product.stock_status === "out_of_stock") continue;

      let itemPrice;
      let availableQty;

      if (variantId && /^\d+$/.test(variantId)) {
        const variant = db.prepare(
          "SELECT id, price, stock_qty FROM product_variants WHERE id = ? AND is_active = 1 AND product_id = ?"
        ).get(variantId, productId);
        if (!variant) continue;
        itemPrice = variant.price;
        availableQty = variant.stock_qty;
      } else {
        itemPrice = product.price;
        availableQty = product.stock_quantity;
      }

      const qty = Math.min(quantity, availableQty, 999);
      if (qty <= 0) continue;

      validItems.push({
        productId: parseInt(productId),
        variantId: variantId && /^\d+$/.test(variantId) ? parseInt(variantId) : null,
        quantity: qty,
        price: itemPrice,
        name: product.name,
        sku: product.sku,
        image: null, // se puede añadir si se necesita
      });
      subtotal += itemPrice * qty;
    }

    // Guardar
    db.prepare(
      "UPDATE carts SET items = ?, subtotal = ?, currency = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(validItems), subtotal, currencyCode, cart.id);

    const { items: savedItems, subtotal: savedSubtotal } = recalculateCart(cart);

    res.status(201).json({
      message: "Carrito actualizado",
      cart: {
        id: cart.id,
        sessionId: cart.session_id,
        userId: cart.user_id,
        items: savedItems,
        subtotal: savedSubtotal,
        currency: cart.currency,
        updatedAt: cart.updated_at,
      },
    });
  } catch (err) {
    console.error("Error en POST /cart:", err);
    res.status(500).json({ error: "Error al actualizar carrito", code: "CART_ERROR" });
  }
});

// ─── POST /api/v1/cart/items — Agregar item ────────────────
router.post("/items", optionalAuth, sanitize, [
  body("productId").isInt({ min: 1 }).withMessage("productId requerido"),
  body("variantId").optional().isInt({ min: 1 }),
  body("quantity").optional().isInt({ min: 1, max: 999 }).toInt(),
  validate,
], (req, res) => {
  try {
    const { productId, variantId, quantity = 1, sessionId } = req.body;
    const userId = req.user ? req.user.userId : null;

    // Carrito: por usuario autenticado o por sessionId (invitado)
    let cart = null;
    if (userId) {
      cart = db.prepare(
        `SELECT * FROM carts WHERE user_id = ? AND session_id LIKE 'cart-%'`
      ).get(userId);
    } else if (sessionId) {
      cart = db.prepare("SELECT * FROM carts WHERE session_id = ?").get(sessionId);
    }

    if (!cart) {
      const sid = userId ? `cart-${userId}` : (sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);
      const result = db.prepare(
        `INSERT INTO carts (user_id, session_id, items, subtotal) VALUES (?, ?, '[]', 0)`
      ).run(userId, sid);
      cart = db.prepare("SELECT * FROM carts WHERE id = ?").get(result.lastInsertRowid);
    }

    const items = JSON.parse(cart.items || "[]");

    // Validar producto
    const product = db.prepare(
      "SELECT id, price, stock_quantity, stock_status, name, sku FROM products WHERE id = ? AND is_active = 1"
    ).get(productId);

    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado", code: "PRODUCT_NOT_FOUND" });
    }
    if (product.stock_status === "out_of_stock") {
      return res.status(400).json({ error: "Producto sin stock", code: "OUT_OF_STOCK" });
    }

    let itemPrice = product.price;
    let availableQty = product.stock_quantity;

    if (variantId && /^\d+$/.test(variantId)) {
      const variant = db.prepare(
        "SELECT id, price, stock_qty FROM product_variants WHERE id = ? AND is_active = 1 AND product_id = ?"
      ).get(variantId, productId);
      if (!variant) {
        return res.status(404).json({ error: "Variante no encontrada", code: "VARIANT_NOT_FOUND" });
      }
      itemPrice = variant.price;
      availableQty = variant.stock_qty;
    }

    const qty = Math.min(quantity, availableQty, 999);
    if (qty <= 0) {
      return res.status(400).json({ error: "Sin stock disponible", code: "NO_STOCK" });
    }

    // Buscar si ya existe en carrito
    const existingIdx = items.findIndex(
      i => i.productId === productId && i.variantId === (variantId || null)
    );

    if (existingIdx >= 0) {
      const existing = items[existingIdx];
      const newQty = Math.min(existing.quantity + qty, availableQty, 999);
      items[existingIdx].quantity = newQty;
    } else {
      items.push({
        productId: parseInt(productId),
        variantId: variantId && /^\d+$/.test(variantId) ? parseInt(variantId) : null,
        quantity: qty,
        price: itemPrice,
        name: product.name,
        sku: product.sku,
        image: null,
      });
    }

    // Recalcular subtotal y guardar
    let subtotal = 0;
    for (const item of items) {
      subtotal += item.price * item.quantity;
    }

    db.prepare(
      "UPDATE carts SET items = ?, subtotal = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(items), subtotal, cart.id);

    const { items: savedItems, subtotal: savedSubtotal } = recalculateCart(cart);

    res.status(201).json({
      message: "Item agregado al carrito",
      cart: {
        id: cart.id,
        sessionId: cart.session_id,
        items: savedItems,
        subtotal: savedSubtotal,
        currency: cart.currency || "USD",
      },
    });
  } catch (err) {
    console.error("Error en POST /cart/items:", err);
    res.status(500).json({ error: "Error", code: "CART_ERROR" });
  }
});

// ─── Resolver carrito del usuario o del invitado ────────────
// Un invitado no tiene user_id: se identifica por sessionId del body/query.
function resolveCart(req) {
  const userId = req.user ? req.user.userId : null;
  const sessionId = (req.body && req.body.sessionId) || (req.query && req.query.sessionId) || null;

  if (userId) {
    const byUser = db.prepare(
      "SELECT * FROM carts WHERE user_id = ? AND session_id LIKE 'cart-%'"
    ).get(userId);
    if (byUser) return byUser;
  }
  if (sessionId) {
    return db.prepare("SELECT * FROM carts WHERE session_id = ?").get(sessionId);
  }
  return null;
}

// ─── PUT /api/v1/cart/items/:idx — Actualizar qty ─────────
router.put("/items/:idx", optionalAuth, sanitize, [
  body("quantity").isInt({ min: 0, max: 999 }).toInt().withMessage("quantity entre 0 y 999"),
  validate,
], (req, res) => {
  try {
    const { idx } = req.params;
    const { quantity } = req.body;

    if (!/^\d+$/.test(idx)) {
      return res.status(400).json({ error: "Índice inválido", code: "INVALID_IDX" });
    }

    const cart = resolveCart(req);
    if (!cart) {
      return res.status(404).json({ error: "Carrito no encontrado", code: "CART_NOT_FOUND" });
    }

    const items = JSON.parse(cart.items || "[]");
    const idxNum = parseInt(idx);

    if (idxNum < 0 || idxNum >= items.length) {
      return res.status(404).json({ error: "Ítem no encontrado en el carrito", code: "ITEM_NOT_FOUND" });
    }

    const item = items[idxNum];
    const targetQty = Math.max(0, Math.min(quantity, 999));

    // Validar stock del producto
    const product = db.prepare("SELECT price, stock_quantity, stock_status FROM products WHERE id = ? AND is_active = 1").get(item.productId);
    if (!product) {
      items.splice(idxNum, 1);
    } else if (product.stock_status === "out_of_stock") {
      items.splice(idxNum, 1);
    } else {
      const availQty = item.variantId
        ? (db.prepare("SELECT stock_qty FROM product_variants WHERE id = ? AND is_active = 1").get(item.variantId)?.stock_qty || 0)
        : product.stock_quantity;
      item.quantity = Math.min(targetQty, availQty, 999);
      if (item.quantity <= 0) {
        items.splice(idxNum, 1);
      }
    }

    // Recalcular subtotal
    let subtotal = 0;
    for (const i of items) subtotal += i.price * i.quantity;

    db.prepare(
      "UPDATE carts SET items = ?, subtotal = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(items), subtotal, cart.id);

    const { items: savedItems, subtotal: savedSubtotal } = recalculateCart(cart);

    res.json({
      message: "Carrito actualizado",
      cart: {
        id: cart.id,
        sessionId: cart.session_id,
        items: savedItems,
        subtotal: savedSubtotal,
        currency: cart.currency || "USD",
      },
    });
  } catch (err) {
    console.error("Error en PUT /cart/items/:idx:", err);
    res.status(500).json({ error: "Error", code: "CART_ERROR" });
  }
});

// ─── DELETE /api/v1/cart/items/:idx — Remover item ─────────
router.delete("/items/:idx", optionalAuth, sanitize, (req, res) => {
  try {
    const { idx } = req.params;

    if (!/^\d+$/.test(idx)) {
      return res.status(400).json({ error: "Índice inválido", code: "INVALID_IDX" });
    }

    const cart = resolveCart(req);
    if (!cart) {
      return res.status(404).json({ error: "Carrito no encontrado", code: "CART_NOT_FOUND" });
    }

    const items = JSON.parse(cart.items || "[]");
    const idxNum = parseInt(idx);

    if (idxNum < 0 || idxNum >= items.length) {
      return res.status(404).json({ error: "Ítem no encontrado", code: "ITEM_NOT_FOUND" });
    }

    items.splice(idxNum, 1);

    let subtotal = 0;
    for (const i of items) subtotal += i.price * i.quantity;

    db.prepare(
      "UPDATE carts SET items = ?, subtotal = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(items), subtotal, cart.id);

    const { items: savedItems, subtotal: savedSubtotal } = recalculateCart(cart);

    res.json({
      message: "Item eliminado",
      cart: {
        id: cart.id,
        sessionId: cart.session_id,
        items: savedItems,
        subtotal: savedSubtotal,
        currency: cart.currency || "USD",
      },
    });
  } catch (err) {
    console.error("Error en DELETE /cart/items/:idx:", err);
    res.status(500).json({ error: "Error", code: "CART_ERROR" });
  }
});

// ─── DELETE /api/v1/cart — Vaciar carrito ──────────────────
router.delete("/", optionalAuth, (req, res) => {
  try {
    const userId = req.user.userId;

    const cart = db.prepare(
      `SELECT id FROM carts WHERE user_id = ? AND session_id LIKE 'cart-%'`
    ).get(userId);

    if (cart) {
      db.prepare("UPDATE carts SET items = '[]', subtotal = 0, updated_at = datetime('now') WHERE id = ?")
        .run(cart.id);
    }

    res.json({ message: "Carrito vaciado" });
  } catch (err) {
    console.error("Error en DELETE /cart:", err);
    res.status(500).json({ error: "Error", code: "CART_ERROR" });
  }
});

// ─── GET /api/v1/cart/summary — Resumen con impuestos/envío ─
router.get("/summary", sanitize, (req, res) => {
  try {
    let cart = null;

    if (req.user) {
      cart = db.prepare(
        `SELECT * FROM carts WHERE user_id = ? AND session_id LIKE 'cart-%'`
      ).get(req.user.userId);
    }
    if (!cart && req.query.sessionId) {
      cart = db.prepare("SELECT * FROM carts WHERE session_id = ?").get(req.query.sessionId);
    }

    if (!cart) {
      return res.json({
        summary: {
          subtotal: 0,
          itemsCount: 0,
          tax: 0,
          shipping: 0,
          freeShippingThreshold: 75,
          shippingDiscount: 0,
          total: 0,
          currency: "USD",
        },
      });
    }

    const { items, subtotal } = recalculateCart(cart);
    const itemsCount = items.reduce((sum, i) => sum + i.quantity, 0);

    // Configuración de envío desde site_settings
    const freeShippingThreshold = parseFloat(
      db.prepare("SELECT value FROM site_settings WHERE key = 'free_shipping_threshold'").get()?.value || "75"
    ) || 75;

    const flatRateShipping = parseFloat(
      db.prepare("SELECT value FROM site_settings WHERE key = 'shipping_flat_rate'").get()?.value || "5.99"
    ) || 5.99;

    const taxRate = parseFloat(
      db.prepare("SELECT value FROM site_settings WHERE key = 'tax_rate_default'").get()?.value || "0"
    ) || 0;

    const shipping =
      subtotal >= freeShippingThreshold ? 0 : flatRateShipping;
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax + shipping;

    res.json({
      summary: {
        subtotal,
        itemsCount,
        tax,
        taxRate,
        shipping,
        freeShippingThreshold,
        shippingDiscount: subtotal >= freeShippingThreshold ? flatRateShipping : 0,
        total,
        currency: cart.currency || "USD",
      },
    });
  } catch (err) {
    console.error("Error en GET /cart/summary:", err);
    res.status(500).json({ error: "Error", code: "SUMMARY_ERROR" });
  }
});

module.exports = router;
