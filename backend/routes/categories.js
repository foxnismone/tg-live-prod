/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Rutas de Categorías
 * ============================================================
 *   GET    /api/v1/categories              → Listado
 *   GET    /api/v1/categories/:id         → Detalle
 *   GET    /api/v1/categories/slug/:slug  → Por slug
 *   POST   /api/v1/categories             → Crear (admin)
 *   PUT    /api/v1/categories/:id         → Actualizar (admin)
 *   DELETE /api/v1/categories/:id         → Eliminar (admin)
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

// ─── GET /api/v1/categories ────────────────────────────────
router.get("/", sanitize, (req, res) => {
  try {
    const categories = db.prepare(
      `SELECT id, name, slug, description, image_url, sort_order, is_active, parent_id,
              (SELECT COUNT(*) FROM products WHERE category_id = categories.id AND is_active = 1) as product_count,
              created_at
       FROM categories
       WHERE is_active = 1
       ORDER BY sort_order ASC, name ASC`
    ).all();

    res.json({ categories });
  } catch (err) {
    console.error("Error en GET /categories:", err);
    res.status(500).json({ error: "Error al obtener categorías", code: "CATEGORIES_ERROR" });
  }
});

// ─── GET /api/v1/categories/:id ────────────────────────────
router.get("/:id", sanitize, (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const category = db.prepare(
      `SELECT id, name, slug, description, image_url, sort_order, is_active, parent_id, created_at
       FROM categories WHERE id = ?`
    ).get(id);

    if (!category) {
      return res.status(404).json({ error: "Categoría no encontrada", code: "NOT_FOUND" });
    }

    // Subcategorías
    const subcategories = db.prepare(
      `SELECT id, name, slug, description, image_url, sort_order, is_active, parent_id
       FROM categories WHERE parent_id = ? AND is_active = 1 ORDER BY sort_order ASC, name ASC`
    ).all(id);

    // Productos de la categoría
    const products = db.prepare(
      `SELECT id, sku, name, slug, price, stock_quantity, stock_status, image_url,
              is_featured, is_new, views, total_sales, rating_avg, rating_count
       FROM products WHERE category_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 20`
    ).all(id);

    // Categorías padre (breadcrumbs)
    let breadcrumbs = [];
    if (category.parent_id) {
      breadcrumbs = db.prepare(
        `SELECT id, name, slug FROM categories WHERE id = ?`
      ).get(category.parent_id);
    }

    res.json({
      category: {
        ...category,
        subcategories: subcategories.map(c => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
        })),
        products: products.map(p => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          slug: p.slug,
          price: p.price,
          imageUrl: p.image_url,
          stockStatus: p.stock_status,
          isFeatured: p.is_featured === 1,
          isNew: p.is_new === 1,
          rating: p.rating_avg,
          reviewCount: p.rating_count,
        })),
        breadcrumbs: breadcrumbs ? [{ id: breadcrumbs.id, name: breadcrumbs.name, slug: breadcrumbs.slug }] : [],
      },
    });
  } catch (err) {
    console.error("Error en GET /categories/:id:", err);
    res.status(500).json({ error: "Error", code: "CATEGORY_ERROR" });
  }
});

// ─── GET /api/v1/categories/slug/:slug ─────────────────────
router.get("/slug/:slug", sanitize, (req, res) => {
  try {
    const { slug } = req.params;
    const category = db.prepare(
      `SELECT id, name, slug, description, image_url, sort_order, is_active, parent_id, created_at
       FROM categories WHERE slug = ? AND is_active = 1`
    ).get(slug);

    if (!category) {
      return res.status(404).json({ error: "Categoría no encontrada", code: "NOT_FOUND" });
    }

    // Resolver recursiveamente (subcategorías y products)
    const subcategories = db.prepare(
      `SELECT id, name, slug, description, sort_order, is_active, parent_id
       FROM categories WHERE parent_id = ? AND is_active = 1 ORDER BY sort_order ASC, name ASC`
    ).all(category.id);

    res.json({ category: { ...category, subcategories } });
  } catch (err) {
    console.error("Error en slug:", err);
    res.status(500).json({ error: "Error", code: "CATEGORY_ERROR" });
  }
});

// ─── POST /api/v1/categories — Crear ───────────────────────
router.post("/", authenticateToken, requireRole("admin"), sanitize, [
  body("name").trim().isLength({ min: 2, max: 100 }).withMessage("Nombre requerido (2-100 caracteres)"),
  body("slug").optional().trim().isLength({ min: 2, max: 100 }),
  body("description").optional().trim().isLength({ max: 500 }),
  body("parentId").optional().isInt(),
  body("imageUrl").optional().isURL(),
  body("sortOrder").optional().isInt({ min: 0 }),
  validate,
], (req, res) => {
  try {
    const { name, slug, description, parentId, imageUrl, sortOrder } = req.body;

    // Generar slug único si no se proporciona
    const finalSlug = slug || slugify(name);
    const slugCheck = db.prepare("SELECT id FROM categories WHERE slug = ?").get(finalSlug);
    if (slugCheck) {
      return res.status(409).json({ error: `Slug '${finalSlug}' ya existe`, code: "SLUG_EXISTS" });
    }

    // Validar parentId
    if (parentId) {
      const parent = db.prepare("SELECT id FROM categories WHERE id = ?").get(parentId);
      if (!parent) {
        return res.status(400).json({ error: "Categoría padre no existe", code: "PARENT_NOT_FOUND" });
      }
    }

    const result = db.prepare(
      `INSERT INTO categories (name, slug, description, parent_id, image_url, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(name, finalSlug, description || null, parentId || null, imageUrl || null, sortOrder || 0);

    const newCategory = db.prepare(
      "SELECT id, name, slug, description, image_url, sort_order, is_active, parent_id, created_at FROM categories WHERE id = ?"
    ).get(result.lastInsertRowid);

    res.status(201).json({
      message: "Categoría creada",
      category: newCategory,
    });
  } catch (err) {
    console.error("Error al crear categoría:", err);
    res.status(500).json({ error: "Error al crear categoría", code: "CREATE_ERROR" });
  }
});

// ─── PUT /api/v1/categories/:id ────────────────────────────
router.put("/:id", authenticateToken, requireRole("admin"), sanitize, [
  body("name").optional().trim().isLength({ min: 2, max: 100 }),
  body("slug").optional().trim().isLength({ min: 2, max: 100 }),
  body("description").optional().trim().isLength({ max: 500 }),
  body("parentId").optional().isInt(),
  body("imageUrl").optional().isURL(),
  body("sortOrder").optional().isInt({ min: 0 }),
  body("isActive").optional().isBoolean(),
  validate,
], (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const category = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
    if (!category) {
      return res.status(404).json({ error: "Categoría no encontrada", code: "NOT_FOUND" });
    }

    const { name, slug, description, parentId, imageUrl, sortOrder, isActive } = req.body;

    const updates = [];
    const values = [];

    if (name !== undefined && name !== category.name) {
      updates.push("name = ?");
      values.push(name);
    }
    if (slug !== undefined && slug !== category.slug) {
      const existing = db.prepare("SELECT id FROM categories WHERE slug = ? AND id != ?").get(slug, id);
      if (existing) {
        return res.status(409).json({ error: `Slug '${slug}' ya existe`, code: "SLUG_EXISTS" });
      }
      updates.push("slug = ?");
      values.push(slug);
    }
    if (description !== undefined) {
      updates.push("description = ?");
      values.push(description || null);
    }
    if (parentId !== undefined) {
      if (parentId && parentId === id) {
        return res.status(400).json({ error: "Una categoría no puede ser su propia categoría padre", code: "INVALID_PARENT" });
      }
      updates.push("parent_id = ?");
      values.push(parentId || null);
    }
    if (imageUrl !== undefined) {
      updates.push("image_url = ?");
      values.push(imageUrl || null);
    }
    if (sortOrder !== undefined) {
      updates.push("sort_order = ?");
      values.push(sortOrder);
    }
    if (isActive !== undefined) {
      updates.push("is_active = ?");
      values.push(isActive ? 1 : 0);
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE categories SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    const updated = db.prepare(
      "SELECT id, name, slug, description, image_url, sort_order, is_active, parent_id, updated_at FROM categories WHERE id = ?"
    ).get(id);

    res.json({
      message: "Categoría actualizada",
      category: updated,
    });
  } catch (err) {
    console.error("Error al actualizar categoría:", err);
    res.status(500).json({ error: "Error", code: "UPDATE_ERROR" });
  }
});

// ─── DELETE /api/v1/categories/:id ─────────────────────────
router.delete("/:id", authenticateToken, requireRole("admin"), sanitize, (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const category = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
    if (!category) {
      return res.status(404).json({ error: "Categoría no encontrada", code: "NOT_FOUND" });
    }

    // Verificar que no tenga productos activos
    const productCount = db.prepare(
      "SELECT COUNT(*) as c FROM products WHERE category_id = ? AND is_active = 1"
    ).get(id);
    if (productCount.c > 0) {
      return res.status(400).json({
        error: `No se puede eliminar: ${productCount.c} productos activos en esta categoría`,
        code: "CATEGORY_HAS_PRODUCTS",
      });
    }

    // Verificar que no sea categoría padre de otras categorías
    const childCategories = db.prepare(
      "SELECT COUNT(*) as c FROM categories WHERE parent_id = ?"
    ).get(id);
    if (childCategories.c > 0) {
      return res.status(400).json({
        error: `No se puede eliminar: ${childCategories.c} subcategorías dependen de esta`,
        code: "CATEGORY_HAS_CHILDREN",
      });
    }

    db.prepare("DELETE FROM categories WHERE id = ?").run(id);

    res.json({ message: "Categoría eliminada", categoryId: id });
  } catch (err) {
    console.error("Error al eliminar categoría:", err);
    res.status(500).json({ error: "Error", code: "DELETE_ERROR" });
  }
});

// Helper local
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

module.exports = router;
