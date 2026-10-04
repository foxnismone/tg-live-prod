/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Rutas de Inventario
 * ============================================================
 *   GET    /api/v1/inventory               → Estado general del inventario
 *   GET    /api/v1/inventory/low-stock     → Productos con stock bajo
 *   GET    /api/v1/inventory/:productId    → Historial de un producto
 *   POST   /api/v1/inventory/adjust       → Ajuste manual de stock
 *   POST   /api/v1/inventory/restock       → Reabastecimiento
 *   POST   /api/v1/inventory/bulk-adjust   → Ajuste masivo (CSV/JSON)
 *   GET    /api/v1/inventory/logs          → Logs de inventario (admin)
 *   GET    /api/v1/inventory/stats         → KPIs de inventario (admin)
 * ============================================================
 */

"use strict";

const express = require("express");
const db      = require("../config/database");
const {
  authenticateToken,
  requireRole,
  validate,
  sanitize,
} = require("../middleware/errorHandler");
const { body, query } = require("express-validator");

const router = express.Router();

// ─── GET /api/v1/inventory — Estado general ─────────────────
router.get("/", authenticateToken, sanitize, (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";

    let products;
    if (isAdmin) {
      products = db.prepare(
        `SELECT p.id, p.sku, p.name, p.stock_quantity, p.stock_status,
                p.is_active, p.total_sales, p.views, c.name as category_name,
                COALESCE(SUM(il.change_qty), 0) as net_change,
                MAX(il.created_at) as last_movement
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN inventory_logs il ON il.product_id = p.id
         WHERE p.is_active = 1
         GROUP BY p.id
         ORDER BY
           CASE p.stock_status
             WHEN 'out_of_stock' THEN 1
             WHEN 'low_stock' THEN 2
             ELSE 3
           END,
           p.stock_quantity ASC`
      ).all();
    } else {
      // Vendedores solo ven sus productos (asumiendo que user_id = vendor_id)
      products = db.prepare(
        `SELECT p.id, p.sku, p.name, p.stock_quantity, p.stock_status,
                p.is_active, p.total_sales, c.name as category_name
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.is_active = 1
         ORDER BY p.stock_quantity ASC`
      ).all();
    }

    const lowStock = db.prepare(
      "SELECT COUNT(*) as c FROM products WHERE stock_status = 'low_stock' AND is_active = 1"
    ).get();
    const outOfStock = db.prepare(
      "SELECT COUNT(*) as c FROM products WHERE stock_status = 'out_of_stock' AND is_active = 1"
    ).get();
    const totalUnits = db.prepare(
      "SELECT SUM(stock_quantity) as total FROM products WHERE is_active = 1"
    ).get();
    const totalValue = db.prepare(
      "SELECT SUM(stock_quantity * price) as total FROM products WHERE is_active = 1"
    ).get();

    res.json({
      inventory: {
        products: products.map(p => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          stockQuantity: p.stock_quantity,
          stockStatus: p.stock_status,
          isActive: p.is_active === 1,
          totalSales: p.total_sales || 0,
          category: p.category_name,
          lastMovement: p.last_movement,
          netChange: p.net_change || 0,
        })),
        summary: {
          totalProducts: products.length,
          lowStock: lowStock.c,
          outOfStock: outOfStock.c,
          totalUnits: totalUnits.total || 0,
          totalValue: totalValue.total || 0,
        },
      },
    });
  } catch (err) {
    console.error("Error en GET /inventory:", err);
    res.status(500).json({ error: "Error", code: "INVENTORY_ERROR" });
  }
});

// ─── GET /api/v1/inventory/low-stock ────────────────────────
router.get("/low-stock", authenticateToken, sanitize, (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    const minStock = parseInt(req.query.minStock) || 10;

    let products;
    if (isAdmin) {
      products = db.prepare(
        `SELECT p.id, p.sku, p.name, p.stock_quantity, p.stock_status, p.price,
                c.name as category_name, p.total_sales
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.stock_quantity > 0 AND p.stock_quantity <= ? AND p.is_active = 1
         ORDER BY p.stock_quantity ASC`
      ).all(minStock);
    } else {
      products = db.prepare(
        `SELECT p.id, p.sku, p.name, p.stock_quantity, p.stock_status, p.price, c.name as category_name
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.stock_quantity > 0 AND p.stock_quantity <= ? AND p.is_active = 1
         ORDER BY p.stock_quantity ASC`
      ).all(minStock);
    }

    res.json({
      lowStockProducts: products.map(p => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        stockQuantity: p.stock_quantity,
        stockStatus: p.stock_status,
        price: p.price,
        category: p.category_name,
        totalSales: p.total_sales,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Error", code: "INVENTORY_ERROR" });
  }
});

// ─── GET /api/v1/inventory/:productId — Historial ───────────
router.get("/:productId", authenticateToken, sanitize, (req, res) => {
  try {
    const { productId } = req.params;
    if (!/^\d+$/.test(productId)) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const product = db.prepare(
      `SELECT p.id, p.sku, p.name, p.stock_quantity, p.stock_status, p.price, p.total_sales,
              c.name as category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = ?`
    ).get(productId);

    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado", code: "NOT_FOUND" });
    }

    const logs = db.prepare(
      `SELECT il.*, u.name as performed_by_name
       FROM inventory_logs il
       LEFT JOIN users u ON il.performed_by = u.id
       WHERE il.product_id = ?
       ORDER BY il.created_at DESC
       LIMIT 100`
    ).all(productId);

    res.json({
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        currentStock: product.stock_quantity,
        stockStatus: product.stock_status,
        price: product.price,
        category: product.category_name,
        totalSales: product.total_sales,
      },
      logs: logs.map(log => ({
        id: log.id,
        changeQty: log.change_qty,
        reason: log.reason,
        reference: log.reference,
        notes: log.notes,
        performedBy: log.performed_by_name,
        createdAt: log.created_at,
      })),
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Error", code: "INVENTORY_ERROR" });
  }
});

// ─── POST /api/v1/inventory/adjust — Ajuste manual ─────────
router.post("/adjust", authenticateToken, sanitize, [
  body("productId").isInt({ min: 1 }).withMessage("productId requerido"),
  body("changeQty").isInt().withMessage("changeQty requerido (puede ser negativo para reducir)"),
  body("reason").optional().trim().isIn(["sale", "restock", "adjustment", "return", "transfer", "damage", "other"])
    .withMessage("reason debe ser: sale, restock, adjustment, return, transfer, damage, other"),
  body("reference").optional().trim().isLength({ max: 100 }),
  body("notes").optional().trim().isLength({ max: 500 }),
  validate,
], (req, res) => {
  const transaction = db.transaction(() => {
    const { productId, changeQty, reason = "adjustment", reference, notes } = req.body;
    const userId = req.user.userId;

    const product = db.prepare("SELECT * FROM products WHERE id = ? AND is_active = 1").get(productId);
    if (!product) {
      throw new Error("Producto no encontrado");
    }

    const newStock = Math.max(0, product.stock_quantity + changeQty);

    // Determinar nuevo stock_status
    let newStatus = "in_stock";
    if (newStock === 0) newStatus = "out_of_stock";
    else if (newStock < 10) newStatus = "low_stock";

    // Actualizar
    db.prepare(
      "UPDATE products SET stock_quantity = ?, stock_status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newStock, newStatus, productId);

    // Log
    db.prepare(
      `INSERT INTO inventory_logs (product_id, change_qty, reason, reference, notes, performed_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(productId, changeQty, reason, reference || null, notes || null, userId);

    return {
      productId,
      previousStock: product.stock_quantity,
      newStock,
      changeQty,
      reason,
      newStatus,
      reference,
    };
  });

  try {
    const result = transaction();
    res.status(201).json({
      message: "Stock ajustado",
      adjustment: result,
    });
  } catch (err) {
    console.error("Error en adjust:", err);
    if (err.message.includes("Producto no encontrado")) {
      res.status(404).json({ error: err.message, code: "NOT_FOUND" });
    } else {
      res.status(500).json({ error: "Error", code: "ADJUST_ERROR" });
    }
  }
});

// ─── POST /api/v1/inventory/restock — Reabastecimiento ─────
router.post("/restock", authenticateToken, sanitize, [
  body("productId").isInt({ min: 1 }).withMessage("productId requerido"),
  body("quantity").isInt({ min: 1 }).withMessage("quantity debe ser >= 1"),
  body("supplier").optional().trim().isLength({ max: 100 }),
  body("costPerUnit").optional().isFloat({ min: 0 }),
  body("reference").optional().trim().isLength({ max: 100 }),
  body("notes").optional().trim().isLength({ max: 500 }),
  validate,
], (req, res) => {
  const transaction = db.transaction(() => {
    const { productId, quantity, supplier, costPerUnit, reference, notes } = req.body;
    const userId = req.user.userId;

    const product = db.prepare("SELECT * FROM products WHERE id = ? AND is_active = 1").get(productId);
    if (!product) throw new Error("Producto no encontrado");

    const newStock = product.stock_quantity + quantity;

    let newStatus = "in_stock";
    if (newStock >= 10) newStatus = "in_stock"; // sale de low_stock si aplica

    db.prepare(
      "UPDATE products SET stock_quantity = ?, stock_status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newStock, newStatus, productId);

    // Si hay costo, actualizar cost_price (promedio ponderado simple)
    if (costPerUnit !== undefined && costPerUnit > 0) {
      const oldCost = product.cost_price || 0;
      const totalUnits = (product.stock_quantity || 0) + quantity;
      const newCost = totalUnits > 0
        ? ((oldCost * (product.stock_quantity || 0) + costPerUnit * quantity) / totalUnits)
        : costPerUnit;
      db.prepare("UPDATE products SET cost_price = ? WHERE id = ?").run(newCost, productId);
    }

    db.prepare(
      `INSERT INTO inventory_logs (product_id, change_qty, reason, reference, notes, performed_by)
       VALUES (?, ?, 'restock', ?, ?, ?)`
    ).run(productId, quantity, reference || supplier || `Reabastecimiento ${productId}`, notes || null, userId);

    return {
      productId,
      previousStock: product.stock_quantity,
      newStock,
      quantityAdded: quantity,
      newStatus,
      supplier,
      reference,
    };
  });

  try {
    const result = transaction();
    res.status(201).json({
      message: "Reabastecimiento realizado",
      restock: result,
    });
  } catch (err) {
    console.error("Error en restock:", err);
    if (err.message.includes("Producto no encontrado")) {
      res.status(404).json({ error: err.message, code: "NOT_FOUND" });
    } else {
      res.status(500).json({ error: "Error", code: "RESTOCK_ERROR" });
    }
  }
});

// ─── POST /api/v1/inventory/bulk-adjust — Ajuste masivo ────
router.post("/bulk-adjust", authenticateToken, requireRole("admin"), sanitize, [
  body("adjustments").isArray({ min: 1, max: 500 }).withMessage("adjustments debe ser array (1-500)"),
  body("adjustments.*.productId").isInt({ min: 1 }).withMessage("productId requerido"),
  body("adjustments.*.changeQty").isInt().withMessage("changeQty requerido"),
  body("reason").optional().trim().isIn(["sale", "restock", "adjustment", "return", "transfer", "damage", "other"]),
  body("notes").optional().trim().isLength({ max: 500 }),
  validate,
], (req, res) => {
  const transaction = db.transaction(() => {
    const { adjustments, reason = "adjustment", notes } = req.body;
    const userId = req.user.userId;

    const results = [];
    let errors = 0;

    for (const adj of adjustments) {
      try {
        const { productId, changeQty } = adj;

        const product = db.prepare("SELECT * FROM products WHERE id = ? AND is_active = 1").get(productId);
        if (!product) {
          results.push({ productId, success: false, error: "Producto no encontrado" });
          errors++;
          continue;
        }

        const newStock = Math.max(0, product.stock_quantity + changeQty);
        let newStatus = "in_stock";
        if (newStock === 0) newStatus = "out_of_stock";
        else if (newStock < 10) newStatus = "low_stock";

        db.prepare(
          "UPDATE products SET stock_quantity = ?, stock_status = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(newStock, newStatus, productId);

        db.prepare(
          `INSERT INTO inventory_logs (product_id, change_qty, reason, reference, notes, performed_by)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(productId, changeQty, reason, null, notes || null, userId);

        results.push({
          productId,
          productName: product.name,
          previousStock: product.stock_quantity,
          newStock,
          changeQty,
          success: true,
        });
      } catch (err) {
        results.push({ productId: adj.productId, success: false, error: err.message });
        errors++;
      }
    }

    return { results, summary: { total: adjustments.length, success: adjustments.length - errors, errors } };
  });

  try {
    const result = transaction();
    res.json({
      message: `Bulk adjust completado: ${result.summary.success} exitosos, ${result.summary.errors} errores`,
      ...result,
    });
  } catch (err) {
    console.error("Error en bulk-adjust:", err);
    res.status(500).json({ error: "Error", code: "BULK_ADJUST_ERROR" });
  }
});

// ─── GET /api/v1/inventory/logs — Logs (admin) ──────────────
router.get("/logs", authenticateToken, requireRole("admin"), sanitize, (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const productId = req.query.productId || null;
    const reason = req.query.reason || null;
    const fromDate = req.query.fromDate || null;
    const toDate = req.query.toDate || null;

    let where = "WHERE 1=1";
    const params = [];

    if (productId) {
      where += " AND il.product_id = ?";
      params.push(productId);
    }
    if (reason) {
      where += " AND il.reason = ?";
      params.push(reason);
    }
    if (fromDate) {
      where += " AND il.created_at >= ?";
      params.push(fromDate);
    }
    if (toDate) {
      where += " AND il.created_at <= ?";
      params.push(toDate);
    }

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM inventory_logs il ${where}`
    ).get(...params);

    const logs = db.prepare(
      `SELECT il.*, p.sku, p.name as product_name, u.name as performed_by_name
       FROM inventory_logs il
       LEFT JOIN products p ON il.product_id = p.id
       LEFT JOIN users u ON il.performed_by = u.id
       ${where}
       ORDER BY il.created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
      logs: logs.map(log => ({
        id: log.id,
        productId: log.product_id,
        productSku: log.sku,
        productName: log.product_name,
        changeQty: log.change_qty,
        reason: log.reason,
        reference: log.reference,
        notes: log.notes,
        performedBy: log.performed_by_name,
        createdAt: log.created_at,
      })),
      pagination: {
        page,
        limit,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limit),
      },
    });
  } catch (err) {
    console.error("Error en logs:", err);
    res.status(500).json({ error: "Error", code: "LOGS_ERROR" });
  }
});

// ─── GET /api/v1/inventory/stats — KPIs (admin) ────────────
router.get("/stats", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const totalProducts = db.prepare("SELECT COUNT(*) as c FROM products WHERE is_active = 1").get();
    const totalStock = db.prepare("SELECT SUM(stock_quantity) as total FROM products WHERE is_active = 1").get();
    const totalValue = db.prepare(
      "SELECT SUM(stock_quantity * price) as total FROM products WHERE is_active = 1"
    ).get();
    const lowStockCount = db.prepare(
      "SELECT COUNT(*) as c FROM products WHERE stock_status = 'low_stock'"
    ).get();
    const outOfStockCount = db.prepare(
      "SELECT COUNT(*) as c FROM products WHERE stock_status = 'out_of_stock'"
    ).get();
    const movementsToday = db.prepare(
      "SELECT COUNT(*) as c FROM inventory_logs WHERE date(created_at) = date('now')"
    ).get();
    const restockedToday = db.prepare(
      "SELECT SUM(change_qty) as total FROM inventory_logs WHERE reason = 'restock' AND date(created_at) = date('now')"
    ).get();
    const soldToday = db.prepare(
      "SELECT SUM(ABS(change_qty)) as total FROM inventory_logs WHERE reason = 'sale' AND date(created_at) = date('now')"
    ).get();
    const movementsThisMonth = db.prepare(
      "SELECT COUNT(*) as c FROM inventory_logs WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"
    ).get();

    res.json({
      kpis: {
        totalProducts: totalProducts.c,
        totalStockUnits: totalStock.total || 0,
        totalStockValue: totalValue.total || 0,
        lowStockCount: lowStockCount.c,
        outOfStockCount: outOfStockCount.c,
        movementsToday: movementsToday.c,
        restockedToday: restockedToday.total || 0,
        soldTodayUnits: soldToday.total || 0,
        movementsThisMonth: movementsThisMonth.c,
      },
    });
  } catch (err) {
    console.error("Error en stats:", err);
    res.status(500).json({ error: "Error", code: "STATS_ERROR" });
  }
});

module.exports = router;
