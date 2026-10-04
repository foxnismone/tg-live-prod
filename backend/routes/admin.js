/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Rutas de Admin / Dashboard
 * ============================================================
 *   GET    /api/v1/admin/dashboard      → KPIs del dashboard
 *   GET    /api/v1/admin/orders         → Gestión de pedidos
 *   PUT    /api/v1/admin/orders/:id/status → Cambiar estado
 *   GET    /api/v1/admin/products       → Gestión de productos (admin)
 *   GET    /api/v1/admin/users          → Listado de usuarios (admin)
 *   PUT    /api/v1/admin/users/:id      → Cambiar rol / estado
 *   GET    /api/v1/admin/coupons        → Gestión de cupones
 *   POST   /api/v1/admin/coupons        → Crear cupón
 *   PUT    /api/v1/admin/coupons/:id    → Actualizar cupón
 *   DELETE /api/v1/admin/coupons/:id    → Eliminar cupón
 *   POST   /api/v1/admin/backup         → Crear backup de DB
 *   GET    /api/v1/admin/settings       → Configuración del sitio
 *   PUT    /api/v1/admin/settings       → Actualizar configuración
 * ============================================================
 */

"use strict";

const express = require("express");
const db      = require("../config/database");
const fs      = require("fs");
const path    = require("path");
const {
  authenticateToken,
  requireRole,
  validate,
  sanitize,
} = require("../middleware/errorHandler");
const { body, query } = require("express-validator");

const router = express.Router();

// ─── Todos los endpoints requieren admin ────────────────────
router.use(authenticateToken, requireRole("admin"));

// ─── GET /api/v1/admin/dashboard — KPIs ────────────────────
router.get("/dashboard", sanitize, (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Pedidos
    const ordersToday = db.prepare(
      `SELECT COUNT(*) as c, COALESCE(SUM(total), 0) as revenue
       FROM orders WHERE status NOT IN ('cancelled', 'pending') AND date(created_at) >= ?`
    ).get(startOfDay.toISOString());

    const ordersMonth = db.prepare(
      `SELECT COUNT(*) as c, COALESCE(SUM(total), 0) as revenue
       FROM orders WHERE status NOT IN ('cancelled', 'pending') AND date(created_at) >= ?`
    ).get(startOfMonth.toISOString());

    const ordersYear = db.prepare(
      `SELECT COUNT(*) as c, COALESCE(SUM(total), 0) as revenue
       FROM orders WHERE status NOT IN ('cancelled', 'pending') AND date(created_at) >= ?`
    ).get(startOfYear.toISOString());

    // Pedidos por día (últimos 7 días)
    const ordersByDay = db.prepare(
      `SELECT date(created_at) as day, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue
       FROM orders
       WHERE date(created_at) >= date('now', '-7 days')
       GROUP BY date(created_at)
       ORDER BY day ASC`
    ).all();

    // Pedidos pendientes de procesar
    const pendingOrders = db.prepare(
      `SELECT o.id, o.order_number, o.status, o.total, o.customer_name, o.created_at,
              (SELECT COUNT(*) FROM JSON_EACH(o.items)) as items_count
       FROM orders o WHERE o.status IN ('pending', 'confirmed') ORDER BY o.created_at ASC LIMIT 10`
    ).all();

    // Productos recién añadidos
    const newProducts = db.prepare(
      `SELECT id, sku, name, price, stock_quantity, stock_status, is_featured, created_at
       FROM products WHERE is_active = 1 ORDER BY created_at DESC LIMIT 5`
    ).all();

    // Reviews pendientes
    const pendingReviews = db.prepare(
      `SELECT r.id, r.rating, r.title, r.content, r.created_at, p.name as product_name, p.slug as product_slug
       FROM reviews r JOIN products p ON r.product_id = p.id
       WHERE r.status = 'pending' ORDER BY r.created_at ASC LIMIT 10`
    ).all();

    // Usuarios registrados hoy
    const usersToday = db.prepare(
      `SELECT COUNT(*) as c FROM users WHERE date(created_at) = date('now')`
    ).get();

    // Top productos por ventas
    // JSON_EACH expone columnas (key, value, type, ...). El campo `value`
    // es texto JSON, así que se accede con json_extract, no con i.value.x
    const topProducts = db.prepare(
      `SELECT p.id, p.name, p.sku,
              SUM(json_extract(i.value, '$.quantity')) as qty,
              SUM(json_extract(i.value, '$.quantity') * json_extract(i.value, '$.price')) as revenue
       FROM orders o, JSON_EACH(o.items) i
       JOIN products p ON p.id = json_extract(i.value, '$.productId')
       WHERE o.status NOT IN ('cancelled')
       GROUP BY p.id
       ORDER BY qty DESC LIMIT 5`
    ).all();

    // Resumen de inventario
    const inventorySummary = db.prepare(
      `SELECT
        COUNT(*) as total_products,
        SUM(stock_quantity) as total_units,
        SUM(CASE WHEN stock_status = 'low_stock' THEN 1 ELSE 0 END) as low_stock,
        SUM(CASE WHEN stock_status = 'out_of_stock' THEN 1 ELSE 0 END) as out_of_stock,
        COALESCE(SUM(stock_quantity * price), 0) as total_value
       FROM products WHERE is_active = 1`
    ).get();

    // Rating promedio
    const ratingAvg = db.prepare(
      "SELECT AVG(rating_avg) as avg, SUM(rating_count) as total_reviews FROM products WHERE rating_count > 0"
    ).get();

    res.json({
      dashboard: {
        period: {
          today: { orders: ordersToday.c, revenue: ordersToday.revenue },
          month: { orders: ordersMonth.c, revenue: ordersMonth.revenue },
          year: { orders: ordersYear.c, revenue: ordersYear.revenue },
        },
        ordersByDay: ordersByDay.map(o => ({
          day: o.day,
          orders: o.orders,
          revenue: o.revenue,
        })),
        pendingOrders: pendingOrders.map(o => ({
          id: o.id,
          orderNumber: o.order_number,
          status: o.status,
          total: o.total,
          customerName: o.customer_name,
          itemsCount: o.items_count,
          createdAt: o.created_at,
        })),
        newProducts: newProducts.map(p => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          price: p.price,
          stock: p.stock_quantity,
          stockStatus: p.stock_status,
          isFeatured: p.is_featured === 1,
          createdAt: p.created_at,
        })),
        pendingReviews: pendingReviews.map(r => ({
          id: r.id,
          rating: r.rating,
          title: r.title,
          content: r.content,
          productName: r.product_name,
          productSlug: r.product_slug,
          createdAt: r.created_at,
        })),
        usersToday: usersToday.c,
        topProducts: topProducts.map(p => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          imageUrl: p.image_url,
          quantitySold: p.qty,
          revenue: p.revenue,
        })),
        inventory: {
          totalProducts: inventorySummary.total_products,
          totalUnits: inventorySummary.total_units,
          lowStock: inventorySummary.low_stock,
          outOfStock: inventorySummary.out_of_stock,
          totalValue: inventorySummary.total_value,
        },
        ratings: {
          average: ratingAvg.avg || 0,
          totalReviews: ratingAvg.total_reviews || 0,
        },
      },
    });
  } catch (err) {
    console.error("Error en dashboard:", err);
    res.status(500).json({ error: "Error", code: "DASHBOARD_ERROR" });
  }
});

// ─── GET /api/v1/admin/orders — Gestión de pedidos ──────────
router.get("/orders", sanitize, (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const paymentStatus = req.query.paymentStatus || null;
    const fromDate = req.query.fromDate || null;
    const toDate = req.query.toDate || null;
    const search = req.query.search || null;

    let where = "WHERE 1=1";
    const params = [];

    if (status) {
      where += " AND o.status = ?";
      params.push(status);
    }
    if (paymentStatus) {
      where += " AND o.payment_status = ?";
      params.push(paymentStatus);
    }
    if (fromDate) {
      where += " AND date(o.created_at) >= date(?)";
      params.push(fromDate);
    }
    if (toDate) {
      where += " AND date(o.created_at) <= date(?)";
      params.push(toDate);
    }
    if (search) {
      where += " AND (o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM orders o ${where}`
    ).get(...params);

    const orders = db.prepare(
      `SELECT o.*, u.name as user_name, u.email as user_email
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
      orders: orders.map(o => ({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        paymentStatus: o.payment_status,
        customerName: o.customer_name,
        customerEmail: o.customer_email,
        customerPhone: o.customer_phone,
        userId: o.user_id,
        userName: o.user_name,
        userEmail: o.user_email,
        items: JSON.parse(o.items || "[]"),
        subtotal: o.subtotal,
        discountTotal: o.discount_total || 0,
        taxTotal: o.tax_total || 0,
        shippingTotal: o.shipping_total || 0,
        total: o.total,
        currency: o.currency,
        paymentMethod: o.payment_method,
        stripeSessionId: o.stripe_session_id,
        trackingNumber: o.tracking_number,
        carrier: o.carrier,
        notes: o.notes,
        shippingAddress: o.shipping_address ? JSON.parse(o.shipping_address) : null,
        createdAt: o.created_at,
        updatedAt: o.updated_at,
        paidAt: o.paid_at,
        shippedAt: o.shipped_at,
        deliveredAt: o.delivered_at,
      })),
      pagination: {
        page,
        limit,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limit),
      },
    });
  } catch (err) {
    console.error("Error en admin orders:", err);
    res.status(500).json({ error: "Error", code: "ORDERS_ERROR" });
  }
});

// ─── PUT /api/v1/admin/orders/:id/status — Cambiar estado ──
router.put("/orders/:id/status", sanitize, [
  body("status").isIn(["confirmed", "processing", "shipped", "delivered", "cancelled"])
    .withMessage("status inválido"),
  body("notes").optional().trim().isLength({ max: 500 }),
  body("trackingNumber").optional().trim(),
  body("carrier").optional().trim(),
  validate,
], (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) throw new Error("ID inválido");

    const { status, notes, trackingNumber, carrier } = req.body;

    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    if (!order) throw new Error("Pedido no encontrado");

    const oldStatus = order.status;

    // Actualizar estado
    const updates = ["status = ?", "updated_at = datetime('now')"];
    const values = [status];

    if (status === "shipped") {
      updates.push("shipped_at = datetime('now')");
      if (trackingNumber) updates.push("tracking_number = ?");
      if (carrier) updates.push("carrier = ?");
      if (trackingNumber) values.push(trackingNumber);
      if (carrier) values.push(carrier);
    }
    if (status === "delivered") {
      updates.push("delivered_at = datetime('now')");
    }
    if (status === "cancelled") {
      updates.push("cancelled_at = datetime('now')");

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
        ).run(item.productId, item.quantity, `Cancelación orden ${order.order_number}`, notes || "Cancelación por admin");
      }
    }

    if (notes) updates.push("notes = ?");
    values.push(notes);

    values.push(id);
    db.prepare(`UPDATE orders SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    return {
      id,
      orderNumber: order.order_number,
      oldStatus,
      newStatus: status,
      trackingNumber,
      carrier,
      notes,
    };
  });

  try {
    const result = transaction();
    res.json({
      message: `Estado del pedido actualizado: ${result.oldStatus} → ${result.newStatus}`,
      order: result,
    });
  } catch (err) {
    console.error("Error al cambiar estado:", err);
    if (err.message.includes("Pedido no encontrado")) {
      res.status(404).json({ error: err.message, code: "NOT_FOUND" });
    } else {
      res.status(500).json({ error: "Error", code: "STATUS_ERROR" });
    }
  }
});

// ─── GET /api/v1/admin/products — Gestión de productos ──────
router.get("/products", sanitize, (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const stockStatus = req.query.stockStatus || null;
    const categorySlug = req.query.category || null;
    const search = req.query.search || null;

    let where = "WHERE p.is_active = 1";
    const params = [];

    if (status === "all") {
      where = "";
    }
    if (stockStatus) {
      where += (where ? " AND " : "WHERE ") + "p.stock_status = ?";
      params.push(stockStatus);
    }
    if (categorySlug) {
      const cat = db.prepare("SELECT id FROM categories WHERE slug = ?").get(categorySlug);
      if (cat) {
        where += " AND p.category_id = ?";
        params.push(cat.id);
      }
    }
    if (search) {
      where += " AND (p.name LIKE ? OR p.sku LIKE ? OR p.description LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM products p ${where}`).get(...params);

    const products = db.prepare(
      `SELECT p.*, c.name as category_name, c.slug as category_slug,
              (SELECT COUNT(*) FROM product_images WHERE product_id = p.id) as image_count,
              (SELECT COUNT(*) FROM product_variants WHERE product_id = p.id) as variant_count
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
      products: products.map(p => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        slug: p.slug,
        description: p.description ? p.description.substring(0, 200) + (p.description.length > 200 ? "..." : "") : null,
        descriptionAi: p.description_ai ? p.description_ai.substring(0, 100) + "..." : null,
        category: p.category_name ? { id: p.category_id, name: p.category_name, slug: p.category_slug } : null,
        price: p.price,
        compareAtPrice: p.compare_at_price,
        stockQuantity: p.stock_quantity,
        stockStatus: p.stock_status,
        trackInventory: p.track_inventory === 1,
        isFeatured: p.is_featured === 1,
        isNew: p.is_new === 1,
        isNew: p.is_new === 1,
        isActive: p.is_active === 1,
        views: p.views,
        totalSales: p.total_sales,
        ratingAvg: p.rating_avg,
        ratingCount: p.rating_count,
        imageCount: p.image_count,
        variantCount: p.variant_count,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
      pagination: {
        page,
        limit,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limit),
      },
    });
  } catch (err) {
    console.error("Error en admin products:", err);
    res.status(500).json({ error: "Error", code: "PRODUCTS_ERROR" });
  }
});

// ─── GET /api/v1/admin/users — Listado de usuarios ──────────
router.get("/users", sanitize, (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const role = req.query.role || null;
    const status = req.query.status || null;
    const search = req.query.search || null;
    const sort = req.query.sort || "created_at-desc";

    let where = "WHERE 1=1";
    const params = [];

    if (role) {
      where += " AND u.role = ?";
      params.push(role);
    }
    if (status) {
      where += " AND u.status = ?";
      params.push(status);
    }
    if (search) {
      where += " AND (u.email LIKE ? OR u.name LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s);
    }

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM users u ${where}`).get(...params);

    let orderBy = "u.created_at DESC";
    const sortMap = {
      "name-asc": "u.name ASC",
      "name-desc": "u.name DESC",
      "email-asc": "u.email ASC",
      "created_at-desc": "u.created_at DESC",
      "created_at-asc": "u.created_at ASC",
      "last_login-desc": "u.last_login DESC",
    };
    if (sortMap[sort]) orderBy = sortMap[sort];

    const users = db.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.status, u.phone, u.avatar_url,
              u.last_login, u.created_at,
              (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as order_count,
              (SELECT COALESCE(SUM(total), 0) FROM orders WHERE user_id = u.id AND status NOT IN ('cancelled')) as total_spent
       FROM users u
       ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        phone: u.phone,
        avatarUrl: u.avatar_url,
        lastLogin: u.last_login,
        orderCount: u.order_count,
        totalSpent: u.total_spent,
        createdAt: u.created_at,
      })),
      pagination: {
        page,
        limit,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limit),
      },
    });
  } catch (err) {
    console.error("Error en admin users:", err);
    res.status(500).json({ error: "Error", code: "USERS_ERROR" });
  }
});

// ─── PUT /api/v1/admin/users/:id — Cambiar rol / estado ────
router.put("/users/:id", sanitize, [
  body("role").optional().isIn(["customer", "vendor", "admin"]).withMessage("role inválido"),
  body("status").optional().isIn(["active", "suspended", "deleted"]).withMessage("status inválido"),
  body("email").optional().isEmail().normalizeEmail(),
  body("name").optional().trim().isLength({ min: 2, max: 100 }),
  body("phone").optional().trim().isLength({ max: 20 }),
  body("notes").optional().trim().isLength({ max: 500 }),
  validate,
], (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) throw new Error("ID inválido");

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!user) throw new Error("Usuario no encontrado");

    const { role, status, email, name, phone, notes } = req.body;

    const updates = [];
    const values = [];

    if (role) { updates.push("role = ?"); values.push(role); }
    if (status) { updates.push("status = ?"); values.push(status); }
    if (email && email !== user.email) {
      const existing = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, id);
      if (existing) throw new Error("Email ya en uso por otro usuario");
      updates.push("email = ?");
      values.push(email);
    }
    if (name !== undefined) { updates.push("name = ?"); values.push(name); }
    if (phone !== undefined) { updates.push("phone = ?"); values.push(phone); }
    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    // Log de auditoría
    if (role || status || email) {
      db.prepare(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
         VALUES (?, 'update_user', 'user', ?, ?)`
      ).run(req.user.userId, id, JSON.stringify({ role, status, email, name, phone }));
    }

    const updated = db.prepare(
      "SELECT id, email, name, role, status, phone, avatar_url, last_login, created_at FROM users WHERE id = ?"
    ).get(id);

    return {
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        status: updated.status,
        phone: updated.phone,
        avatarUrl: updated.avatar_url,
        lastLogin: updated.last_login,
        createdAt: updated.created_at,
      },
    };
  });

  try {
    const result = transaction();
    res.json({ message: "Usuario actualizado", ...result });
  } catch (err) {
    console.error("Error al actualizar usuario:", err);
    if (err.message.includes("Usuario no encontrado")) {
      res.status(404).json({ error: err.message, code: "NOT_FOUND" });
    } else if (err.message.includes("Email ya en uso")) {
      res.status(409).json({ error: err.message, code: "EMAIL_EXISTS" });
    } else {
      res.status(500).json({ error: "Error", code: "USER_ERROR" });
    }
  }
});

// ─── GET /api/v1/admin/coupons ──────────────────────────────
router.get("/coupons", sanitize, (req, res) => {
  try {
    const coupons = db.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.status NOT IN ('cancelled') AND json_extract(o.notes, '$.coupon_code') = c.code) as used_count
       FROM coupons c ORDER BY c.created_at DESC`
    ).all();

    res.json({
      coupons: coupons.map(c => ({
        id: c.id,
        code: c.code,
        description: c.description,
        discountType: c.discount_type,
        discountValue: c.discount_value,
        minOrderTotal: c.min_order_total,
        maxDiscount: c.max_discount,
        usageLimit: c.usage_limit,
        usageCount: c.usage_count,
        usedCount: c.used_count,
        validFrom: c.valid_from,
        validUntil: c.valid_until,
        isActive: c.is_active === 1,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
    });
  } catch (err) {
    console.error("Error en admin coupons:", err);
    res.status(500).json({ error: "Error", code: "COUPONS_ERROR" });
  }
});

// ─── POST /api/v1/admin/coupons — Crear cupón ──────────────
router.post("/coupons", sanitize, [
  body("code").trim().isLength({ min: 3, max: 30 }).withMessage("code requerido (3-30 caracteres)"),
  body("description").optional().trim().isLength({ max: 200 }),
  body("discountType").isIn(["percentage", "fixed", "shipping"]).withMessage("discountType inválido"),
  body("discountValue").isFloat({ min: 0, max: 100 }).withMessage("discountValue debe ser >= 0"),
  body("minOrderTotal").optional().isFloat({ min: 0 }),
  body("maxDiscount").optional().isFloat({ min: 0 }),
  body("usageLimit").optional().isInt({ min: 1 }),
  body("validFrom").optional().isISO8601(),
  body("validUntil").optional().isISO8601(),
  validate,
], (req, res) => {
  try {
    const {
      code, description, discountType, discountValue,
      minOrderTotal, maxDiscount, usageLimit, validFrom, validUntil,
    } = req.body;

    // Verificar que el código no existe
    const existing = db.prepare("SELECT id FROM coupons WHERE LOWER(code) = LOWER(?)").get(code);
    if (existing) {
      return res.status(409).json({ error: `El código '${code}' ya existe`, code: "COUPON_EXISTS" });
    }

    // Si es porcentaje, max 100
    if (discountType === "percentage" && discountValue > 100) {
      return res.status(400).json({ error: "El descuento porcentual no puede exceder 100%", code: "INVALID_VALUE" });
    }

    const result = db.prepare(
      `INSERT INTO coupons (code, description, discount_type, discount_value, min_order_total,
       max_discount, usage_limit, valid_from, valid_until, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      code.toUpperCase(),
      description || null,
      discountType,
      discountValue,
      minOrderTotal || null,
      maxDiscount || null,
      usageLimit || null,
      validFrom || null,
      validUntil || null,
    );

    res.status(201).json({
      message: "Cupón creado exitosamente",
      coupon: {
        id: result.lastInsertRowid,
        code: code.toUpperCase(),
        discountType,
        discountValue,
        minOrderTotal,
        maxDiscount,
        usageLimit,
        usageCount: 0,
        validFrom,
        validUntil,
        isActive: true,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("Error al crear cupón:", err);
    if (err.message.includes("ya existe")) {
      res.status(409).json({ error: err.message, code: "COUPON_EXISTS" });
    } else {
      res.status(500).json({ error: "Error", code: "COUPON_ERROR" });
    }
  }
});

// ─── PUT /api/v1/admin/coupons/:id ─────────────────────────
router.put("/coupons/:id", sanitize, [
  body("code").optional().trim().isLength({ min: 3, max: 30 }),
  body("description").optional().trim().isLength({ max: 200 }),
  body("discountType").optional().isIn(["percentage", "fixed", "shipping"]),
  body("discountValue").optional().isFloat({ min: 0, max: 100 }),
  body("minOrderTotal").optional().isFloat({ min: 0 }),
  body("maxDiscount").optional().isFloat({ min: 0 }),
  body("usageLimit").optional().isInt({ min: 1 }),
  body("validFrom").optional().isISO8601(),
  body("validUntil").optional().isISO8601(),
  body("isActive").optional().isBoolean(),
  validate,
], (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const coupon = db.prepare("SELECT * FROM coupons WHERE id = ?").get(id);
    if (!coupon) {
      return res.status(404).json({ error: "Cupón no encontrado", code: "NOT_FOUND" });
    }

    const {
      code, description, discountType, discountValue,
      minOrderTotal, maxDiscount, usageLimit, validFrom, validUntil, isActive,
    } = req.body;

    const updates = [];
    const values = [];

    if (code && code.toUpperCase() !== coupon.code) {
      const existing = db.prepare("SELECT id FROM coupons WHERE LOWER(code) = LOWER(?) AND id != ?").get(code, id);
      if (existing) {
        return res.status(409).json({ error: `El código '${code}' ya existe`, code: "COUPON_EXISTS" });
      }
      updates.push("code = ?");
      values.push(code.toUpperCase());
    }
    if (description !== undefined) { updates.push("description = ?"); values.push(description || null); }
    if (discountType) { updates.push("discount_type = ?"); values.push(discountType); }
    if (discountValue !== undefined) {
      if (discountType === "percentage" && discountValue > 100) {
        return res.status(400).json({ error: "Porcentaje no puede exceder 100%", code: "INVALID_VALUE" });
      }
      updates.push("discount_value = ?");
      values.push(discountValue);
    }
    if (minOrderTotal !== undefined) { updates.push("min_order_total = ?"); values.push(minOrderTotal || null); }
    if (maxDiscount !== undefined) { updates.push("max_discount = ?"); values.push(maxDiscount || null); }
    if (usageLimit !== undefined) { updates.push("usage_limit = ?"); values.push(usageLimit || null); }
    if (validFrom !== undefined) { updates.push("valid_from = ?"); values.push(validFrom || null); }
    if (validUntil !== undefined) { updates.push("valid_until = ?"); values.push(validUntil || null); }
    if (isActive !== undefined) { updates.push("is_active = ?"); values.push(isActive ? 1 : 0); }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE coupons SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    const updated = db.prepare("SELECT * FROM coupons WHERE id = ?").get(id);

    res.json({
      message: "Cupón actualizado",
      coupon: {
        id: updated.id,
        code: updated.code,
        description: updated.description,
        discountType: updated.discount_type,
        discountValue: updated.discount_value,
        minOrderTotal: updated.min_order_total,
        maxDiscount: updated.max_discount,
        usageLimit: updated.usage_limit,
        usageCount: updated.usage_count,
        validFrom: updated.valid_from,
        validUntil: updated.valid_until,
        isActive: updated.is_active === 1,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Error", code: "COUPON_ERROR" });
  }
});

// ─── DELETE /api/v1/admin/coupons/:id ───────────────────────
router.delete("/coupons/:id", sanitize, (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const coupon = db.prepare("SELECT * FROM coupons WHERE id = ?").get(id);
    if (!coupon) {
      return res.status(404).json({ error: "Cupón no encontrado", code: "NOT_FOUND" });
    }

    db.prepare("DELETE FROM coupons WHERE id = ?").run(id);

    res.json({ message: "Cupón eliminado", couponCode: coupon.code });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Error", code: "COUPON_ERROR" });
  }
});

// ─── POST /api/v1/admin/cleanup-test-data — Limpiar residuo de pruebas ─
// Elimina productos, pedidos, usuarios, carritos y sesiones de chat creados
// por las suites automatizadas. Solo disponible fuera de producción: en un
// entorno real estos borrados deben ser una decisión manual y consciente.
router.post("/cleanup-test-data", sanitize, (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({
      error: "Operación no disponible en producción",
      code: "FORBIDDEN_IN_PRODUCTION",
    });
  }

  try {
    const deleted = {};

    // db.transaction(fn) DEVUELVE la función envuelta: hay que invocarla.
    // Si solo se pasa la función, el BEGIN/COMMIT nunca se ejecuta y la
    // limpieza se queda silenciosamente sin hacer.
    db.transaction(() => {
      // 1. Mensajes y sesiones de chat de prueba
      db.prepare(
        `DELETE FROM chat_messages WHERE session_id IN (
           SELECT session_id FROM chat_sessions
           WHERE session_id LIKE 'e2e-%' OR session_id LIKE 'diag-%'
              OR session_id LIKE 'test-%' OR session_id LIKE 'session-%')`
      ).run();
      deleted.chatSessions = db.prepare(
        `DELETE FROM chat_sessions
         WHERE session_id LIKE 'e2e-%' OR session_id LIKE 'diag-%'
            OR session_id LIKE 'test-%' OR session_id LIKE 'session-%'`
      ).run().changes;

      // 2. Carritos de prueba
      deleted.carts = db.prepare(
        `DELETE FROM carts
         WHERE session_id LIKE 'e2e-%' OR session_id LIKE 'diag-%'
            OR session_id LIKE 'test-%' OR session_id LIKE 'session-%'`
      ).run().changes;

      // 3. Productos de prueba y sus dependencias
      db.prepare(
        `DELETE FROM product_images WHERE product_id IN (
           SELECT id FROM products WHERE name LIKE '%E2E%' OR name LIKE '%TEST%'
             OR sku LIKE 'E2E-%' OR sku LIKE 'TEST-%')`
      ).run();
      db.prepare(
        `DELETE FROM product_variants WHERE product_id IN (
           SELECT id FROM products WHERE name LIKE '%E2E%' OR name LIKE '%TEST%'
             OR sku LIKE 'E2E-%' OR sku LIKE 'TEST-%')`
      ).run();
      db.prepare(
        `DELETE FROM inventory_logs WHERE product_id IN (
           SELECT id FROM products WHERE name LIKE '%E2E%' OR name LIKE '%TEST%'
             OR sku LIKE 'E2E-%' OR sku LIKE 'TEST-%')`
      ).run();
      deleted.products = db.prepare(
        `DELETE FROM products
         WHERE name LIKE '%E2E%' OR name LIKE '%TEST%'
            OR sku LIKE 'E2E-%' OR sku LIKE 'TEST-%'`
      ).run().changes;

      // 4. Pagos y pedidos de prueba
      db.prepare(
        `DELETE FROM payments WHERE order_id IN (
           SELECT id FROM orders WHERE customer_email LIKE '%example.com'
             OR customer_email LIKE '%e2e%' OR customer_email LIKE '%test%')`
      ).run();
      deleted.orders = db.prepare(
        `DELETE FROM orders
         WHERE customer_email LIKE '%example.com' OR customer_email LIKE '%e2e%'
            OR customer_email LIKE '%test%'`
      ).run().changes;

      // 5. Usuarios de prueba (nunca el admin)
      deleted.users = db.prepare(
        `DELETE FROM users
         WHERE role != 'admin' AND (
           email LIKE 'cliente.e2e.%' OR email LIKE '%e2e%@%'
           OR email LIKE '%@example.com' OR email LIKE '%test%@%')`
      ).run().changes;
    })();  // ← invocar la transacción

    res.json({ message: "Residuo de pruebas eliminado", deleted });
  } catch (err) {
    console.error("Error en cleanup-test-data:", err);
    res.status(500).json({ error: "Error al limpiar los datos de prueba", code: "CLEANUP_ERROR" });
  }
});

// ─── POST /api/v1/admin/backup — Crear backup ──────────────
router.post("/backup", sanitize, (req, res) => {
  const backupDir = process.env.BACKUP_DIR || path.resolve(__dirname, "..", "..", "backups");

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  try {
    const backupPath = path.join(backupDir, `backup-${Date.now()}.db`);
    const backup = new (require("../config/sqlite-compat"))(backupPath);
    backup.pragma("journal_mode = DELETE");
    db.raw.backup(backup);
    backup.close();

    // Limpiar backups viejos
    const retention = parseInt(process.env.BACKUP_RETENTION_DAYS || "30", 10);
    const cutoff = Date.now() - retention * 24 * 60 * 60 * 1000;
    fs.readdirSync(backupDir)
      .filter(f => f.startsWith("backup-") && f.endsWith(".db"))
      .forEach(f => {
        const fp = path.join(backupDir, f);
        try {
          const stat = fs.statSync(fp);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(fp);
          }
        } catch (_) {}
      });

    const size = fs.statSync(backupPath).size;

    res.json({
      message: "Backup creado exitosamente",
      backupPath: `backups/${path.basename(backupPath)}`,
      sizeBytes: size,
      sizeMB: (size / 1024 / 1024).toFixed(2),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error en backup:", err);
    res.status(500).json({ error: "Error al crear backup", code: "BACKUP_ERROR" });
  }
});

// ─── GET /api/v1/admin/settings — Configuración del sitio ───
router.get("/settings", sanitize, (req, res) => {
  try {
    const settings = db.prepare("SELECT key, value, updated_at FROM site_settings ORDER BY key").all();

    res.json({
      settings: settings.reduce((acc, s) => {
        acc[s.key] = s.value;
        return acc;
      }, {}),
      updatedAt: settings.length > 0 ? settings[settings.length - 1].updated_at : null,
    });
  } catch (err) {
    console.error("Error en settings:", err);
    res.status(500).json({ error: "Error", code: "SETTINGS_ERROR" });
  }
});

// ─── PUT /api/v1/admin/settings — Actualizar ────────────────
router.put("/settings", sanitize, [
  body("settings").isObject().withMessage("settings debe ser un objeto"),
  validate,
], (req, res) => {
  try {
    const { settings } = req.body;
    const results = [];
    let errors = 0;

    for (const [key, value] of Object.entries(settings)) {
      try {
        db.prepare(
          `INSERT INTO site_settings (key, value, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        ).run(key, String(value));

        results.push({ key, success: true });
      } catch (err) {
        errors++;
        results.push({ key, success: false, error: err.message });
      }
    }

    res.json({
      message: `Configuración actualizada: ${results.filter(r => r.success).length} exitosos, ${errors} errores`,
      results,
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Error", code: "SETTINGS_ERROR" });
  }
});

module.exports = router;
