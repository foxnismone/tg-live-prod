/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Rutas de Pedidos / Orders
 * ============================================================
 *   GET    /api/v1/orders               → Listado de pedidos (usuario o admin)
 *   GET    /api/v1/orders/:id           → Detalle del pedido
 *   POST   /api/v1/orders               → Crear pedido desde carrito
 *   POST   /api/v1/orders/:id/cancel   → Cancelar pedido
 *   GET    /api/v1/orders/order-number/:orderNumber → Por número de orden
 *   GET    /api/v1/orders/stats         → Estadísticas (admin)
 * ============================================================
 */

"use strict";

const express = require("express");
const db      = require("../config/database");
const {
  authenticateToken,
  optionalAuth,
  requireRole,
  validate,
  sanitize,
  auditLog,
} = require("../middleware/errorHandler");
const { body, query } = require("express-validator");

const router = express.Router();

// ─── Generar número de orden único ──────────────────────────
function generateOrderNumber() {
  const year = new Date().getFullYear();
  const prefix = `ORDEN-${year}-`;

  // El número correlativo empieza justo después del prefijo.
  // Calcular la posición con el largo real del prefijo evita el bug clásico
  // de un offset fijo: `SUBSTR(order_number, 9)` cortaba mal "ORDEN-2026-000001"
  // (el número empieza en la posición 12), devolvía siempre el mismo valor
  // y provocaba violaciones de la restricción UNIQUE.
  const max = db.prepare(
    "SELECT MAX(CAST(SUBSTR(order_number, ?) AS INTEGER)) as m FROM orders WHERE order_number LIKE ?"
  ).get(prefix.length + 1, `${prefix}%`);

  let num = (max?.m || 0) + 1;

  // Salvaguarda ante cualquier colisión (pedidos concurrentes)
  let candidate = `${prefix}${String(num).padStart(6, "0")}`;
  let guard = 0;
  while (db.prepare("SELECT 1 FROM orders WHERE order_number = ?").get(candidate) && guard < 10000) {
    num += 1;
    candidate = `${prefix}${String(num).padStart(6, "0")}`;
    guard += 1;
  }
  return candidate;
}

// ─── GET /api/v1/orders — Listado ──────────────────────────
router.get("/", authenticateToken, sanitize, (req, res) => {
  try {
    const userId = req.user.userId;
    const isAdmin = req.user.role === "admin";

    let where = "";
    const params = [];

    if (!isAdmin) {
      where = "WHERE o.user_id = ?";
      params.push(userId);
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;

    let countWhere = where;
    if (status) {
      countWhere += (where ? " AND " : "WHERE ") + "o.status = ?";
      params.push(status);
    }

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM orders o ${countWhere}`
    ).get(...params);

    let orderWhere = where;
    if (status) {
      orderWhere += (where ? " AND " : "WHERE ") + "o.status = ?";
      params.push(status);
    }

    const rows = db.prepare(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.subtotal, o.total,
              o.currency, o.customer_name, o.customer_email, o.created_at, o.updated_at,
              (SELECT COUNT(*) FROM JSON_EACH(o.items)) as items_count
       FROM orders o
       ${orderWhere}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const orders = rows.map(row => ({
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      paymentStatus: row.payment_status,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      itemsCount: row.items_count,
      subtotal: row.subtotal,
      total: row.total,
      currency: row.currency,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({
      orders,
      pagination: {
        page,
        limit,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limit),
      },
    });
  } catch (err) {
    console.error("Error en GET /orders:", err);
    res.status(500).json({ error: "Error al obtener pedidos", code: "ORDERS_ERROR" });
  }
});

// ─── GET /api/v1/orders/:id — Detalle ──────────────────────
router.get("/:id", authenticateToken, sanitize, (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const userId = req.user.userId;
    const isAdmin = req.user.role === "admin";

    let order;
    if (isAdmin) {
      order = db.prepare(
        `SELECT * FROM orders WHERE id = ?`
      ).get(id);
    } else {
      order = db.prepare(
        `SELECT * FROM orders WHERE id = ? AND user_id = ?`
      ).get(id, userId);
    }

    if (!order) {
      return res.status(404).json({ error: "Pedido no encontrado", code: "NOT_FOUND" });
    }

    // Verificar que el usuario puede ver el pedido (si no es admin, debe ser suyo)
    if (!isAdmin && (order.user_id !== userId)) {
      return res.status(403).json({ error: "No tienes acceso a este pedido", code: "FORBIDDEN" });
    }

    const items = JSON.parse(order.items || "[]");
    const shippingAddress = order.shipping_address ? JSON.parse(order.shipping_address) : null;
    const billingAddress = order.billing_address ? JSON.parse(order.billing_address) : null;

    res.json({
      order: {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        paymentStatus: order.payment_status,
        paymentMethod: order.payment_method,
        paymentIntentId: order.payment_intent_id,
        stripeSessionId: order.stripe_session_id,
        customerName: order.customer_name,
        customerEmail: order.customer_email,
        customerPhone: order.customer_phone,
        shippingAddress,
        billingAddress,
        items,
        subtotal: order.subtotal,
        discountTotal: order.discount_total || 0,
        taxTotal: order.tax_total || 0,
        shippingTotal: order.shipping_total || 0,
        total: order.total,
        currency: order.currency,
        notes: order.notes,
        trackingNumber: order.tracking_number,
        carrier: order.carrier,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        paidAt: order.paid_at,
        shippedAt: order.shipped_at,
        deliveredAt: order.delivered_at,
      },
    });
  } catch (err) {
    console.error("Error en GET /orders/:id:", err);
    res.status(500).json({ error: "Error", code: "ORDER_ERROR" });
  }
});

// ─── GET /api/v1/orders/order-number/:orderNumber ─────────
router.get("/order-number/:orderNumber", authenticateToken, sanitize, (req, res) => {
  try {
    const { orderNumber } = req.params;
    const userId = req.user.userId;
    const isAdmin = req.user.role === "admin";

    let order;
    if (isAdmin) {
      order = db.prepare("SELECT * FROM orders WHERE order_number = ?").get(orderNumber);
    } else {
      order = db.prepare(
        "SELECT * FROM orders WHERE order_number = ? AND user_id = ?"
      ).get(orderNumber, userId);
    }

    if (!order) {
      return res.status(404).json({ error: "Pedido no encontrado", code: "NOT_FOUND" });
    }

    if (!isAdmin && order.user_id !== userId) {
      return res.status(403).json({ error: "No tienes acceso", code: "FORBIDDEN" });
    }

    const items = JSON.parse(order.items || "[]");
    res.json({
      order: {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        paymentStatus: order.payment_status,
        customerName: order.customer_name,
        customerEmail: order.customer_email,
        items,
        subtotal: order.subtotal,
        total: order.total,
        currency: order.currency,
        createdAt: order.created_at,
      },
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Error", code: "ORDER_ERROR" });
  }
});

// ─── POST /api/v1/orders — Crear pedido ────────────────────
router.post("/", optionalAuth, sanitize, [
  body("customerName").trim().isLength({ min: 2, max: 100 }).withMessage("Nombre requerido (2-100 caracteres)"),
  body("customerEmail").isEmail().normalizeEmail().withMessage("Email inválido"),
  body("customerPhone").optional().trim().isLength({ max: 20 }),
  body("shippingAddress").exists().withMessage("shippingAddress requerido"),
  body("billingAddress").optional().isObject(),
  body("items").optional().isArray(),
  body("note").optional().trim().isLength({ max: 1000 }),
  validate,
], (req, res) => {
  const transaction = db.transaction(() => {
    const {
      customerName, customerEmail, customerPhone,
      shippingAddress, billingAddress,
      items: orderItems, note,
    } = req.body;

    const userId = req.user ? req.user.userId : null;
    const guestSessionId = req.body.sessionId || null;

    // La dirección puede llegar como objeto estructurado o como texto plano.
    // Se normaliza a objeto para almacenarla de forma consistente.
    const normAddress = (addr) => {
      if (!addr) return null;
      if (typeof addr === "object") return addr;
      return { line1: String(addr).trim(), raw: String(addr).trim() };
    };
    const shippingAddr = normAddress(shippingAddress);
    const billingAddr = normAddress(billingAddress);

    // Carrito: del usuario autenticado o del invitado (por sessionId)
    let cart = null;
    if (userId) {
      cart = db.prepare(
        `SELECT * FROM carts WHERE user_id = ? AND session_id LIKE 'cart-%'`
      ).get(userId);
    }
    if (!cart && guestSessionId) {
      cart = db.prepare("SELECT * FROM carts WHERE session_id = ?").get(guestSessionId);
    }

    // Los items pueden venir del carrito o directamente en el cuerpo de la
    // petición (checkout de una sola página). Si el carrito existe pero está
    // vacío, se priorizan los items enviados por el cliente.
    const hasClientItems = Array.isArray(orderItems) && orderItems.length > 0;
    let cartItems = [];
    if (cart && cart.items && cart.items !== "[]") {
      try {
        const parsed = JSON.parse(cart.items);
        if (Array.isArray(parsed)) cartItems = parsed;
      } catch (_) { cartItems = []; }
    }

    if (cartItems.length === 0 && !hasClientItems) {
      throw new Error("El carrito está vacío. Agrega productos antes de crear el pedido.");
    }

    // Usar items del body si se proporcionan, sino del carrito
    const finalItems = hasClientItems
      ? orderItems
      : cartItems.map(item => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          price: item.price,
          name: item.name,
          sku: item.sku,
        }));

    // Recalcular precios actuales y validar stock
    const validatedItems = [];
    let subtotal = 0;

    for (const item of finalItems) {
      const product = db.prepare(
        "SELECT id, price, stock_quantity, sku, name, stock_status FROM products WHERE id = ? AND is_active = 1"
      ).get(item.productId);

      if (!product) {
        throw new Error(`Producto ID ${item.productId} no encontrado o inactivo`);
      }
      if (product.stock_status === "out_of_stock") {
        throw new Error(`Producto "${product.name}" está agotado`);
      }

      let price = item.price || product.price;
      let qty = item.quantity || 1;
      let availableQty = product.stock_quantity;

      if (item.variantId) {
        const variant = db.prepare(
          "SELECT price, stock_qty FROM product_variants WHERE id = ? AND is_active = 1"
        ).get(item.variantId);
        if (!variant) throw new Error("Variante no encontrada");
        price = variant.price;
        availableQty = variant.stock_qty;
      }

      qty = Math.min(qty, availableQty, 999);
      if (qty <= 0) {
        throw new Error(`Sin stock disponible para "${product.name}"`);
      }

      validatedItems.push({
        productId: product.id,
        variantId: item.variantId || null,
        quantity: qty,
        price: price,
        name: product.name,
        sku: item.variantId
          ? (db.prepare("SELECT sku FROM product_variants WHERE id = ?").get(item.variantId)?.sku || product.sku)
          : product.sku,
        image: null,
      });
      subtotal += price * qty;
    }

    // Calcular impuestos y envío
    const taxRate = parseFloat(
      db.prepare("SELECT value FROM site_settings WHERE key = 'tax_rate_default'").get()?.value || "0"
    ) || 0;
    const taxTotal = subtotal * (taxRate / 100);

    const freeShippingThreshold = parseFloat(
      db.prepare("SELECT value FROM site_settings WHERE key = 'free_shipping_threshold'").get()?.value || "75"
    ) || 75;
    const flatRateShipping = parseFloat(
      db.prepare("SELECT value FROM site_settings WHERE key = 'shipping_flat_rate'").get()?.value || "5.99"
    ) || 5.99;

    const shippingTotal = subtotal >= freeShippingThreshold ? 0 : flatRateShipping;

    const total = subtotal + taxTotal + shippingTotal;

    // Generar número de orden
    const orderNumber = generateOrderNumber();

    // Validar que no existaEmail con orden pendiente (opcional, prevenir duplicados)
    const pendingOrder = db.prepare(
      `SELECT id FROM orders WHERE customer_email = ? AND status IN ('pending', 'confirmed') LIMIT 1`
    ).get(customerEmail);
    if (pendingOrder) {
      console.warn(`⚠  Existe pedido pendiente para ${customerEmail} (ID: ${pendingOrder.id})`);
      // Aquí podríamos rechazar o permitir — por ahora permitimos pero logueamos
    }

    // Crear el pedido
    const result = db.prepare(
      `INSERT INTO orders (
        order_number, user_id, customer_name, customer_email, customer_phone,
        shipping_address, billing_address, items, subtotal, tax_total, shipping_total,
        total, currency, status, payment_status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid', ?)`
    ).run(
      orderNumber,
      userId,
      customerName,
      customerEmail,
      customerPhone || null,
      JSON.stringify(shippingAddr),
      billingAddr ? JSON.stringify(billingAddr) : null,
      JSON.stringify(validatedItems),
      subtotal,
      taxTotal,
      shippingTotal,
      total,
      "USD",
      note || null,
    );

    const orderId = result.lastInsertRowid;

    // Reducir stock de cada producto (y log de inventario)
    for (const item of validatedItems) {
      if (item.variantId) {
        db.prepare(
          "UPDATE product_variants SET stock_qty = MAX(0, stock_qty - ?) WHERE id = ?"
        ).run(item.quantity, item.variantId);
      } else {
        db.prepare(
          "UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?) WHERE id = ?"
        ).run(item.quantity, item.productId);
      }

      // Log de inventario
      db.prepare(
        `INSERT INTO inventory_logs (product_id, change_qty, reason, reference, notes)
         VALUES (?, ?, 'sale', ?, ?)`
      ).run(
        item.productId,
        -item.quantity,
        `Orden ${orderNumber}`,
        `Venta en orden ${orderNumber}`
      );
    }

    // Actualizar total_sales del producto
    for (const item of validatedItems) {
      db.prepare(
        "UPDATE products SET total_sales = total_sales + ? WHERE id = ?"
      ).run(item.quantity, item.productId);
    }

    // Vaciar carrito
    db.prepare("UPDATE carts SET items = '[]', subtotal = 0, updated_at = datetime('now') WHERE id = ?")
      .run(cart.id);

    // Obtener el pedido creado
    const created = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    const createdItems = JSON.parse(created.items);

    return {
      orderId: orderId,
      orderNumber: created.order_number,
      status: created.status,
      paymentStatus: created.payment_status,
      customerName: created.customer_name,
      customerEmail: created.customer_email,
      items: createdItems,
      subtotal: created.subtotal,
      taxTotal: created.tax_total,
      shippingTotal: created.shipping_total,
      total: created.total,
      currency: created.currency,
    };
  });

  try {
    const order = transaction();
    res.status(201).json({
      message: "Pedido creado exitosamente",
      order,
      nextStep: "Procesar pago para confirmar el pedido",
    });
  } catch (err) {
    console.error("Error al crear pedido:", err);
    if (err.message.includes("Vacío") || err.message.includes("agotado") || err.message.includes("no encontrado")) {
      res.status(400).json({ error: err.message, code: "ORDER_VALIDATION_ERROR" });
    } else {
      res.status(500).json({ error: "Error al crear pedido", code: "CREATE_ORDER_ERROR" });
    }
  }
});

// ─── POST /api/v1/orders/:id/cancel — Cancelar pedido ─────
router.post("/:id/cancel", authenticateToken, sanitize, [
  body("reason").optional().trim().isLength({ max: 500 }),
  validate,
], (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) throw new Error("ID inválido");

    const userId = req.user.userId;
    const isAdmin = req.user.role === "admin";

    let order;
    if (isAdmin) {
      order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    } else {
      order = db.prepare(
        "SELECT * FROM orders WHERE id = ? AND user_id = ?"
      ).get(id, userId);
    }

    if (!order) throw new Error("Pedido no encontrado");
    if (!isAdmin && order.user_id !== userId) throw new Error("No tienes permisos");

    if (order.status === "cancelled") {
      throw new Error("El pedido ya está cancelado");
    }
    if (order.status === "delivered" || order.status === "refunded") {
      throw new Error("No se puede cancelar un pedido entregado o reembolsado");
    }

    // Restaurar stock
    const items = JSON.parse(order.items || "[]");
    for (const item of items) {
      if (item.variantId) {
        db.prepare("UPDATE product_variants SET stock_qty = stock_qty + ? WHERE id = ?").run(item.quantity, item.variantId);
      } else {
        db.prepare("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?").run(item.quantity, item.productId);
      }

      db.prepare(
        `INSERT INTO inventory_logs (product_id, change_qty, reason, reference, notes)
         VALUES (?, ?, 'return', ?, ?)`
      ).run(item.productId, item.quantity, `Cancelación orden ${order.order_number}`, req.body.reason || "Cancelación por cliente");
    }

    // Actualizar pedido
    db.prepare(
      `UPDATE orders SET status = 'cancelled', cancelled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(id);

    return { id, orderNumber: order.order_number, status: "cancelled" };
  });

  try {
    const result = transaction();
    res.json({
      message: "Pedido cancelado exitosamente",
      order: result,
    });
  } catch (err) {
    console.error("Error al cancelar:", err);
    if (err.message.includes("no encontrado") || err.message.includes("permisos")) {
      res.status(404).json({ error: err.message, code: "NOT_FOUND" });
    } else if (err.message.includes("cancelado") || err.message.includes("entregado")) {
      res.status(400).json({ error: err.message, code: "CANCEL_ERROR" });
    } else {
      res.status(500).json({ error: "Error", code: "CANCEL_ERROR" });
    }
  }
});

// ─── GET /api/v1/orders/stats — Estadísticas (admin) ──────
router.get("/stats", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const totalOrders = db.prepare("SELECT COUNT(*) as c FROM orders").get();
    const today = db.prepare(
      "SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')"
    ).get();
    const pending = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get();
    const confirmed = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'confirmed'").get();
    const processing = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'processing'").get();
    const shipped = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'shipped'").get();
    const delivered = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'delivered'").get();
    const cancelled = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'cancelled'").get();

    const totalRevenue = db.prepare(
      "SELECT SUM(total) as total FROM orders WHERE status NOT IN ('cancelled', 'pending')"
    ).get();
    const todayRevenue = db.prepare(
      "SELECT SUM(total) as total FROM orders WHERE date(created_at) = date('now') AND status NOT IN ('cancelled', 'pending')"
    ).get();

    const topProducts = db.prepare(
      `SELECT p.id, p.name, p.sku, SUM(json_extract(i.value, '$.quantity')) as qty_sold,
              SUM(json_extract(i.value, '$.quantity') * json_extract(i.value, '$.price')) as revenue,
              p.image_url
       FROM orders o
       JOIN JSON_EACH(o.items) i
       JOIN products p ON p.id = json_extract(i.value, '$.productId')
       WHERE o.status NOT IN ('cancelled')
       GROUP BY json_extract(i.value, '$.productId')
       ORDER BY qty_sold DESC
       LIMIT 10`
    ).all();

    res.json({
      orders: {
        total: totalOrders.c,
        today: today.c,
        pending,
        confirmed,
        processing,
        shipped,
        delivered,
        cancelled,
      },
      revenue: {
        total: totalRevenue.total || 0,
        today: todayRevenue.total || 0,
      },
      topProducts: topProducts.map(p => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        quantitySold: p.qty_sold,
        revenue: p.revenue,
        imageUrl: p.image_url,
      })),
    });
  } catch (err) {
    console.error("Error en stats:", err);
    res.status(500).json({ error: "Error", code: "STATS_ERROR" });
  }
});

module.exports = router;
