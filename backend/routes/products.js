/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Rutas de Productos / Catálogo
 * ============================================================
 * Endpoints:
 *   GET    /api/v1/products                    → Listado (con filtros, paginación, búsqueda)
 *   GET    /api/v1/products/:id                → Detalle de producto (con imágenes, variantes)
 *   GET    /api/v1/products/slug/:slug         → Por slug
 *   GET    /api/v1/products/featured           → Productos destacados
 *   GET    /api/v1/products/new                → Productos nuevos
 *   GET    /api/v1/products/category/:catSlug  → Por categoría
 *   POST   /api/v1/products                    → Crear producto (admin)
 *   PUT    /api/v1/products/:id                → Actualizar (admin)
 *   DELETE /api/v1/products/:id                → Eliminar (admin, soft delete)
 *   POST   /api/v1/products/:id/images         → Subir imágenes
 *   DELETE /api/v1/products/:id/images/:imgId  → Eliminar imagen
 *   POST   /api/v1/products/bulk               → Crear/actualizar múltiples (CSV/JSON)
 *   GET    /api/v1/products/stats              → Estadísticas del catálogo (admin)
 * ============================================================
 */

"use strict";

const express       = require("express");
const multer        = require("multer");
const sharp         = require("sharp");
const path          = require("path");
const fs            = require("fs");
const { body, query, validationResult } = require("express-validator");
const db            = require("../config/database");
const { cacheGet, cacheSet, cacheInvalidate } = db;
const {
  authenticateToken,
  optionalAuth,
  requireRole,
  validate,
  sanitize,
  auditLog,
} = require("../middleware/errorHandler");

const router = express.Router();

// ─── Configuración de Uploads ───────────────────────────────
const config = require("../config");

const uploadDir  = config.uploadDir || path.resolve(__dirname, "..", "..", "uploads");
const productsDir = path.join(uploadDir, "products");

if (!fs.existsSync(productsDir)) {
  fs.mkdirSync(productsDir, { recursive: true });
}

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, productsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uuid = require("crypto").randomBytes(8).toString("hex");
    cb(null, `product-${uuid}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (config.uploadMaxSizeMB || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = (config.allowedImageTypes || "jpg,jpeg,png,webp,avif,gif")
      .split(",").map(t => t.trim().toLowerCase());
    const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido. Tipos: ${allowed.join(", ")}`));
    }
  },
}).array("images", 20); // máximo 20 imágenes por request

// ─── Helpers ─────────────────────────────────────────────────
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

let slugCounter = {};

function generateUniqueSlug(name, existingSlug) {
  const base = slugify(name);
  let slug = base;
  if (existingSlug) {
    slug = existingSlug;
  }
  // Asegurar unicidad
  let attempt = 0;
  while (db.prepare("SELECT id FROM products WHERE slug = ?").get(slug)) {
    attempt++;
    slug = `${base}-${attempt}`;
  }
  return slug;
}

function generateUniqueSku(prefix = "PROD") {
  const max = db.prepare("SELECT MAX(CAST(SUBSTR(sku, 6) AS INTEGER)) as m FROM products WHERE sku LIKE ?").get(`${prefix}-%`);
  const num = (max?.m || 0) + 1;
  return `${prefix}-${String(num).padStart(3, "0")}`;
}

function formatProduct(row) {
  if (!row) return null;
  const images = db.prepare(
    "SELECT id, url, alt_text, sort_order, is_primary FROM product_images WHERE product_id = ? ORDER BY sort_order ASC"
  ).all(row.id);

  const variants = db.prepare(
    "SELECT id, sku, name, price, stock_qty, attributes, is_active, created_at FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY id"
  ).all(row.id);

  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    description: row.description,
    descriptionAi: row.description_ai,
    categoryId: row.category_id,
    category: row.category ? {
      id: row.category.id,
      name: row.category.name,
      slug: row.category.slug,
    } : null,
    price: row.price,
    compareAtPrice: row.compare_at_price,
    stockQuantity: row.stock_quantity,
    stockStatus: row.stock_status,
    trackInventory: row.track_inventory,
    weight: row.weight,
    dimensions: row.dimensions ? JSON.parse(row.dimensions) : null,
    tags: row.tags ? JSON.parse(row.tags) : [],
    attributes: row.attributes ? JSON.parse(row.attributes) : {},
    isActive: row.is_active === 1,
    isFeatured: row.is_featured === 1,
    isNew: row.is_new === 1,
    requiresShipping: row.requires_shipping === 1,
    taxCategory: row.tax_category,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    views: row.views,
    totalSales: row.total_sales,
    ratingAvg: row.rating_avg,
    ratingCount: row.rating_count,
    // Modelo de precios estilo retail chileno (patrón pc Factory):
    //   price       → precio con tarjeta de crédito (referencia alta)
    //   cashPrice   → precio con transferencia/débito (gancho principal)
    //   installments→ cuotas sin interés ofrecidas
    cashPrice: row.cash_price != null ? row.cash_price : row.price,
    installments: row.installments || 0,
    installmentValue: (row.installments || 0) > 0
      ? Math.round((row.cash_price != null ? row.cash_price : row.price) / row.installments)
      : null,
    pickupAvailable: row.pickup_available === 1,
    storeStock: row.store_stock ? JSON.parse(row.store_stock) : null,
    discountPercent: row.compare_at_price && row.compare_at_price > row.price
      ? Math.round((1 - row.price / row.compare_at_price) * 100)
      : 0,
    images: images.map(img => ({
      id: img.id,
      url: img.url,
      alt: img.alt_text,
      sortOrder: img.sort_order,
      isPrimary: img.is_primary === 1,
    })),
    variants: variants.map(v => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      price: v.price,
      stockQty: v.stock_qty,
      attributes: v.attributes ? JSON.parse(v.attributes) : {},
      isActive: v.is_active === 1,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── GET /api/v1/products — Listado avanzado con filtros ───
router.get("/", optionalAuth, sanitize, [
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  query("category").optional().trim(),
  query("search").optional().trim(),
  query("minPrice").optional().isFloat({ min: 0 }).toFloat(),
  query("maxPrice").optional().isFloat({ min: 0 }).toFloat(),
  query("inStock").optional().isBoolean(),
  query("featured").optional().isBoolean(),
  query("new").optional().isBoolean(),
  query("sort").optional().trim(),
  query("tags").optional().trim(),
  validate,
], (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      category,
      search,
      minPrice,
      maxPrice,
      inStock,
      featured,
      new: isNew,
      sort = "created_at-desc",
      tags,
    } = req.query;

    // Caché: clave única por combinación de filtros
    const cacheKey = `products:${page}:${limit}:${category || ""}:${search || ""}:${minPrice || ""}:${maxPrice || ""}:${inStock || ""}:${featured || ""}:${isNew || ""}:${sort}:${tags || ""}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    // El catálogo público SOLO muestra productos activos.
    // Sin este filtro, los productos eliminados (soft delete: is_active = 0)
    // seguirían apareciendo en la tienda y se podrían comprar.
    const isAdminRequest = req.user && ["admin", "vendor"].includes(req.user.role);
    if (!isAdminRequest) {
      conditions.push("p.is_active = 1");
    }

    if (category) {
      // Buscar por slug de categoría
      const cat = db.prepare("SELECT id FROM categories WHERE slug = ?").get(category);
      if (cat) {
        conditions.push("p.category_id = ?");
        params.push(cat.id);
      }
    }

    if (search) {
      conditions.push("(p.name LIKE ? OR p.slug LIKE ? OR p.description LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    if (minPrice !== undefined) {
      conditions.push("p.price >= ?");
      params.push(minPrice);
    }
    if (maxPrice !== undefined) {
      conditions.push("p.price <= ?");
      params.push(maxPrice);
    }
    if (inStock === "true") {
      conditions.push("p.stock_status IN ('in_stock', 'low_stock')");
    }
    if (inStock === "false") {
      conditions.push("p.stock_status = 'out_of_stock'");
    }
    if (featured === "true") {
      conditions.push("p.is_featured = 1");
    }
    if (isNew === "true") {
      conditions.push("p.is_new = 1");
    }
    if (tags) {
      const tagList = tags.split(",").map(t => t.trim());
      for (const tag of tagList) {
        conditions.push("tags LIKE ?");
        params.push(`%"${tag}"%`);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Determinar ORDER BY
    let orderBy = "p.created_at DESC";
    const sortMap = {
      "price-asc":     "p.price ASC",
      "price-desc":    "p.price DESC",
      "name-asc":      "p.name ASC",
      "name-desc":     "p.name DESC",
      "rating-desc":   "p.rating_avg DESC",
      "sales-desc":    "p.total_sales DESC",
      "newest":        "p.created_at DESC",
      "oldest":        "p.created_at ASC",
      "created_at-desc": "p.created_at DESC",
    };
    if (sortMap[sort]) orderBy = sortMap[sort];

    // Contar total
    const countRow = db.prepare(`SELECT COUNT(*) as total FROM products p ${where}`).get(...params);
    const total = countRow.total;
    const totalPages = Math.ceil(total / limit);

    // Obtener productos
    const rows = db.prepare(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    // Formatear cada producto
    const products = rows.map(row => {
      const category = row.category_slug ? { id: row.category_id, name: row.category_name, slug: row.category_slug } : null;
      const prod = formatProduct({ ...row, category });
      return prod;
    });

    const result = {
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };

    // Almacenar en caché (TTL 30s para mantener coherencia con la BD)
    cacheSet(cacheKey, result, 30000);

    res.json(result);
  } catch (err) {
    console.error("Error en GET /products:", err);
    res.status(500).json({ error: "Error al obtener productos", code: "PRODUCTS_ERROR" });
  }
});

// ─── GET /api/v1/products/featured ──────────────────────────
router.get("/featured", sanitize, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 8, 20);
    const rows = db.prepare(
      "SELECT * FROM products WHERE is_featured = 1 AND is_active = 1 ORDER BY created_at DESC LIMIT ?"
    ).all(limit);

    const products = rows.map(row => formatProduct(row));
    res.json({ products });
  } catch (err) {
    console.error("Error en /products/featured:", err.message);
    res.status(500).json({ error: "Error al obtener productos destacados" });
  }
});

// ─── GET /api/v1/products/new — Productos nuevos ────────────
router.get("/new", sanitize, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 8, 20);
    const rows = db.prepare(
      "SELECT * FROM products WHERE is_new = 1 AND is_active = 1 ORDER BY created_at DESC LIMIT ?"
    ).all(limit);

    const products = rows.map(row => formatProduct(row));
    res.json({ products });
  } catch (err) {
    console.error("Error en /products/new:", err.message);
    res.status(500).json({ error: "Error al obtener productos nuevos" });
  }
});

// ─── GET /api/v1/products/category/:catSlug ─────────────────
router.get("/category/:catSlug", sanitize, (req, res) => {
  try {
    const { catSlug } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 12));

    const cat = db.prepare("SELECT id, name FROM categories WHERE slug = ? AND is_active = 1").get(catSlug);
    if (!cat) {
      return res.status(404).json({ error: "Categoría no encontrada", code: "CATEGORY_NOT_FOUND" });
    }

    const offset = (page - 1) * limit;
    const countRow = db.prepare(
      "SELECT COUNT(*) as total FROM products WHERE category_id = ? AND is_active = 1"
    ).get(cat.id);

    const rows = db.prepare(
      "SELECT * FROM products WHERE category_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(cat.id, limit, offset);

    const products = rows.map(row => formatProduct(row));

    res.json({
      category: { id: cat.id, name: cat.name, slug: catSlug },
      products,
      pagination: {
        page,
        limit,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limit),
      },
    });
  } catch (err) {
    console.error("Error en category:", err);
    res.status(500).json({ error: "Error", code: "CATEGORY_ERROR" });
  }
});

// ─── GET /api/v1/products/slug/:slug ────────────────────────
router.get("/slug/:slug", sanitize, (req, res) => {
  try {
    const { slug } = req.params;
    const row = db.prepare(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.slug = ? AND p.is_active = 1`
    ).get(slug);

    if (!row) {
      return res.status(404).json({ error: "Producto no encontrado", code: "PRODUCT_NOT_FOUND" });
    }

    // Incrementar vistas
    db.prepare("UPDATE products SET views = views + 1 WHERE id = ?").run(row.id);

    const product = formatProduct(row);
    if (product) product.category = {
      id: row.category_id,
      name: row.category_name,
      slug: row.category_slug,
    };

    res.json({ product });
  } catch (err) {
    console.error("Error en slug:", err);
    res.status(500).json({ error: "Error", code: "PRODUCT_ERROR" });
  }
});

// ─── GET /api/v1/products/:id — Detalle completo ───────────
router.get("/:id", sanitize, (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const row = db.prepare(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = ? AND p.is_active = 1`
    ).get(id);

    if (!row) {
      return res.status(404).json({ error: "Producto no encontrado", code: "PRODUCT_NOT_FOUND" });
    }

    // Incrementar vistas
    db.prepare("UPDATE products SET views = views + 1 WHERE id = ?").run(id);

    const product = formatProduct(row);
    if (product) product.category = {
      id: row.category_id,
      name: row.category_name,
      slug: row.category_slug,
    };

    res.json({ product });
  } catch (err) {
    console.error("Error en GET /products/:id:", err);
    res.status(500).json({ error: "Error", code: "PRODUCT_ERROR" });
  }
});

// ─── POST /api/v1/products — Crear producto (admin) ────────
router.post("/", authenticateToken, requireRole("admin", "vendor"), sanitize, [
  body("name").trim().isLength({ min: 3, max: 150 }).withMessage("Nombre requerido (3-150 caracteres)"),
  body("sku").optional().trim().isLength({ min: 3, max: 50 }).withMessage("SKU inválido"),
  body("price").isFloat({ min: 0 }).withMessage("Precio debe ser >= 0"),
  body("categoryId").optional().isInt().withMessage("categoryId inválido"),
  body("description").optional().trim().isLength({ max: 10000 }),
  body("stockQuantity").optional().isInt({ min: 0 }).toInt(),
  body("weight").optional().isFloat({ min: 0 }),
  body("compareAtPrice").optional().isFloat({ min: 0 }),
  body("cashPrice").optional({ nullable: true }).isFloat({ min: 0 })
    .withMessage("cashPrice debe ser un número positivo"),
  body("installments").optional().isInt({ min: 0, max: 24 })
    .withMessage("installments debe estar entre 0 y 24").toInt(),
  body("pickupAvailable").optional().isBoolean(),
  body("tags").optional().isArray(),
  body("attributes").optional().isObject(),
  body("isFeatured").optional().isBoolean(),
  body("isNew").optional().isBoolean(),
  body("seoTitle").optional().trim().isLength({ max: 70 }),
  body("seoDescription").optional().trim().isLength({ max: 160 }),
  validate,
], (req, res) => {
  const transaction = db.transaction(() => {
    // Lista blanca de campos permitidos (protección contra Mass Assignment)
    const ALLOWED_FIELDS = [
      'name', 'sku', 'price', 'categoryId', 'description', 'stockQuantity',
      'weight', 'compareAtPrice', 'tags', 'attributes', 'isFeatured', 'isNew',
      'seoTitle', 'seoDescription', 'dimensions',
      'cashPrice', 'installments', 'pickupAvailable',
    ];

    const body = {};
    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) body[field] = req.body[field];
    }

    const {
      name, sku, price, categoryId, description, stockQuantity,
      weight, compareAtPrice, tags, attributes, isFeatured, isNew,
      seoTitle, seoDescription, dimensions,
      cashPrice, installments, pickupAvailable,
    } = body;

    // Generar SKU si no se proporciona
    const finalSku = sku || generateUniqueSku();

    // Verificar que SKU no exista
    if (db.prepare("SELECT id FROM products WHERE sku = ?").get(finalSku)) {
      throw new Error(`SKU '${finalSku}' ya existe`);
    }

    // Generar slug único
    const slug = generateUniqueSlug(name);
    const finalSkuCheck = db.prepare("SELECT id FROM products WHERE sku = ?").get(finalSku);
    if (finalSkuCheck) {
      throw new Error(`SKU '${finalSku}' ya existe`);
    }

    // Determinar stock_status
    const stockQty = stockQuantity !== undefined ? stockQuantity : 0;
    let stockStatus = "in_stock";
    if (stockQty === 0) stockStatus = "out_of_stock";
    else if (stockQty < 10) stockStatus = "low_stock";

    // Insertar producto
    const result = db.prepare(
      `INSERT INTO products (sku, name, slug, description, category_id, price, compare_at_price, cost_price,
       cash_price, installments, pickup_available,
       stock_quantity, stock_status, weight, tags, attributes, is_featured, is_new,
       seo_title, seo_description, dimensions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      finalSku,
      name,
      slug,
      description || null,
      categoryId || null,
      price,
      compareAtPrice || null,
      null, // cost_price
      // Precio de transferencia: si no se indica, iguala al de crédito
      cashPrice != null && cashPrice > 0 ? cashPrice : price,
      installments || 0,
      pickupAvailable === false ? 0 : 1,
      stockQty,
      stockStatus,
      weight || null,
      tags ? JSON.stringify(tags) : null,
      attributes ? JSON.stringify(attributes) : null,
      isFeatured ? 1 : 0,
      isNew ? 1 : 0,
      seoTitle || null,
      seoDescription || null,
      dimensions ? JSON.stringify(dimensions) : null,
    );

    // Crear categoría si no existe
    if (categoryId) {
      const cat = db.prepare("SELECT id FROM categories WHERE id = ?").get(categoryId);
      if (!cat) {
        throw new Error("Categoría no existe");
      }
    }

    const newProduct = db.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid);

    // Invalidar caché de listados
    cacheInvalidate("products:");

    return formatProduct(newProduct);
  });

  try {
    const product = transaction();
    res.status(201).json({ message: "Producto creado", product });
  } catch (err) {
    console.error("Error al crear producto:", err);
    if (err.message.includes("SKU")) {
      res.status(409).json({ error: err.message, code: "SKU_EXISTS" });
    } else {
      res.status(500).json({ error: "Error al crear producto", code: "CREATE_ERROR" });
    }
  }
});

// ─── PUT /api/v1/products/:id — Actualizar producto ────────
router.put("/:id", authenticateToken, requireRole("admin", "vendor"), sanitize, [
  body("name").optional().trim().isLength({ min: 3, max: 150 }),
  body("sku").optional().trim().isLength({ min: 3, max: 50 }),
  body("price").optional().isFloat({ min: 0 }),
  body("categoryId").optional().isInt(),
  body("description").optional().trim().isLength({ max: 10000 }),
  body("stockQuantity").optional().isInt({ min: 0 }).toInt(),
  body("weight").optional().isFloat({ min: 0 }),
  body("compareAtPrice").optional().isFloat({ min: 0 }),
  body("cashPrice").optional({ nullable: true }).isFloat({ min: 0 })
    .withMessage("cashPrice debe ser un número positivo"),
  body("installments").optional().isInt({ min: 0, max: 24 })
    .withMessage("installments debe estar entre 0 y 24").toInt(),
  body("pickupAvailable").optional().isBoolean(),
  body("tags").optional().isArray(),
  body("attributes").optional().isObject(),
  body("isFeatured").optional().isBoolean(),
  body("isNew").optional().isBoolean(),
  body("seoTitle").optional().trim().isLength({ max: 70 }),
  body("seoDescription").optional().trim().isLength({ max: 160 }),
  body("isActive").optional().isBoolean(),
  body("dimensions").optional().isObject(),
  validate,
], (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) throw new Error("ID inválido");

    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!product) throw new Error("Producto no encontrado");

    // Lista blanca de campos permitidos (protección contra Mass Assignment)
    const ALLOWED_FIELDS = [
      'name', 'sku', 'price', 'categoryId', 'description', 'stockQuantity',
      'weight', 'compareAtPrice', 'tags', 'attributes', 'isFeatured', 'isNew',
      'seoTitle', 'seoDescription', 'isActive', 'dimensions',
      'cashPrice', 'installments', 'pickupAvailable',
    ];

    // Filtrar solo los campos permitidos del body
    const body = {};
    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) {
        body[field] = req.body[field];
      }
    }

    const {
      name, sku, price, categoryId, description, stockQuantity,
      weight, compareAtPrice, tags, attributes, isFeatured, isNew,
      seoTitle, seoDescription, isActive, dimensions,
      cashPrice, installments, pickupAvailable,
    } = body;

    const updates = [];
    const values = [];

    if (name !== undefined && name !== product.name) {
      const newSlug = generateUniqueSlug(name, product.slug);
      updates.push("name = ?, slug = ?");
      values.push(name, newSlug);
    }
    if (sku !== undefined && sku !== product.sku) {
      const existing = db.prepare("SELECT id FROM products WHERE sku = ? AND id != ?").get(sku, id);
      if (existing) throw new Error(`SKU '${sku}' ya existe`);
      updates.push("sku = ?");
      values.push(sku);
    }
    if (price !== undefined) { updates.push("price = ?"); values.push(price); }
    if (categoryId !== undefined) { updates.push("category_id = ?"); values.push(categoryId || null); }
    if (description !== undefined) { updates.push("description = ?"); values.push(description || null); }
    if (stockQuantity !== undefined) {
      const diff = stockQuantity - product.stock_quantity;
      updates.push("stock_quantity = ?, stock_status = ?");
      values.push(stockQuantity,
        stockQuantity === 0 ? "out_of_stock" : stockQuantity < 10 ? "low_stock" : "in_stock"
      );
      // Log de inventario
      if (diff !== 0) {
        db.prepare(
          `INSERT INTO inventory_logs (product_id, change_qty, reason, reference, notes)
           VALUES (?, ?, 'adjustment', ?, ?)`
        ).run(id, diff, `Ajuste manual ${id}`, `Cambio por actualización del producto`);
      }
    }
    if (weight !== undefined) { updates.push("weight = ?"); values.push(weight || null); }
    if (compareAtPrice !== undefined) { updates.push("compare_at_price = ?"); values.push(compareAtPrice || null); }
    if (cashPrice !== undefined) { updates.push("cash_price = ?"); values.push(cashPrice || null); }
    if (installments !== undefined) { updates.push("installments = ?"); values.push(installments || 0); }
    if (pickupAvailable !== undefined) { updates.push("pickup_available = ?"); values.push(pickupAvailable ? 1 : 0); }
    if (tags !== undefined) { updates.push("tags = ?"); values.push(tags ? JSON.stringify(tags) : null); }
    if (attributes !== undefined) { updates.push("attributes = ?"); values.push(attributes ? JSON.stringify(attributes) : null); }
    if (isFeatured !== undefined) { updates.push("is_featured = ?"); values.push(isFeatured ? 1 : 0); }
    if (isNew !== undefined) { updates.push("is_new = ?"); values.push(isNew ? 1 : 0); }
    if (seoTitle !== undefined) { updates.push("seo_title = ?"); values.push(seoTitle || null); }
    if (seoDescription !== undefined) { updates.push("seo_description = ?"); values.push(seoDescription || null); }
    if (isActive !== undefined) { updates.push("is_active = ?"); values.push(isActive ? 1 : 0); }
    if (dimensions !== undefined) { updates.push("dimensions = ?"); values.push(dimensions ? JSON.stringify(dimensions) : null); }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    const updatedProduct = db.prepare("SELECT * FROM products WHERE id = ?").get(id);

    // Invalidar caché de listados
    cacheInvalidate("products:");

    return formatProduct(updatedProduct);
  });

  try {
    const updated = transaction();
    res.json({ message: "Producto actualizado", product: updated });
  } catch (err) {
    console.error("Error al actualizar producto:", err);
    if (err.message.includes("SKU")) {
      res.status(409).json({ error: err.message, code: "SKU_EXISTS" });
    } else if (err.message.includes("Producto no encontrado")) {
      res.status(404).json({ error: err.message, code: "NOT_FOUND" });
    } else {
      res.status(500).json({ error: "Error al actualizar producto", code: "UPDATE_ERROR" });
    }
  }
});

// ─── DELETE /api/v1/products/:id — Eliminar (soft delete) ──
router.delete("/:id", authenticateToken, requireRole("admin"), sanitize, (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado", code: "NOT_FOUND" });
    }

    // Soft delete: desactivar
    db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);

    // Invalidar caché de listados
    cacheInvalidate("products:");

    res.json({ message: "Producto desactivado", productId: id });
  } catch (err) {
    console.error("Error al eliminar producto:", err);
    res.status(500).json({ error: "Error", code: "DELETE_ERROR" });
  }
});

// ─── POST /api/v1/products/:id/images — Subir imágenes ─────
router.post("/:id/images", authenticateToken, requireRole("admin", "vendor"), (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message, code: "UPLOAD_ERROR" });
    }

    try {
      const { id } = req.params;
      if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
      }

      const product = db.prepare("SELECT id FROM products WHERE id = ?").get(id);
      if (!product) {
        return res.status(404).json({ error: "Producto no encontrado", code: "NOT_FOUND" });
      }

      const files = req.files;
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No se enviaron imágenes", code: "NO_FILES" });
      }

      const results = [];
      const lastImage = db.prepare(
        "SELECT MAX(sort_order) as max_order FROM product_images WHERE product_id = ?"
      ).get(id);
      let sortOrder = (lastImage?.max_order || -1) + 1;

      for (const file of files) {
        // Crear thumbnail con Sharp
        const thumbName = `thumb-${path.basename(file.filename)}`;
        const thumbPath = path.join(productsDir, thumbName);

        await sharp(file.path)
          .resize(config.thumbnailMaxW || 400, config.thumbnailMaxH || 400, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 85 })
          .toFile(thumbPath);

        // Insertar en BD
        const thumbUrl = `/uploads/products/${thumbName}`;
        const result = db.prepare(
          `INSERT INTO product_images (product_id, url, alt_text, sort_order, is_primary)
           VALUES (?, ?, ?, ?, 0)`
        ).run(id, thumbUrl, null, sortOrder);

        results.push({
          id: result.lastInsertRowid,
          url: thumbUrl,
          sortOrder,
        });

        sortOrder++;
      }

      res.status(201).json({
        message: `Imágenes subidas: ${results.length}`,
        images: results,
      });
    } catch (err) {
      console.error("Error al subir imágenes:", err);
      res.status(500).json({ error: "Error al procesar imágenes", code: "IMAGE_ERROR" });
    }
  });
});

// ─── DELETE /api/v1/products/:id/images/:imgId ─────────────
router.delete("/:id/images/:imgId", authenticateToken, requireRole("admin", "vendor"), (req, res) => {
  try {
    const { id, imgId } = req.params;
    if (!/^\d+$/.test(id) || !/^\d+$/.test(imgId)) {
      return res.status(400).json({ error: "ID inválido", code: "INVALID_ID" });
    }

    const image = db.prepare(
      "SELECT url FROM product_images WHERE id = ? AND product_id = ?"
    ).get(imgId, id);

    if (!image) {
      return res.status(404).json({ error: "Imagen no encontrada", code: "NOT_FOUND" });
    }

    // Eliminar archivo físico
    const imagePath = path.join(uploadDir, image.url.replace("/uploads/", ""));
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    // Eliminar thumbnail
    const thumbName = `thumb-${path.basename(image.url)}`;
    const thumbPath = path.join(productsDir, thumbName);
    if (fs.existsSync(thumbPath)) {
      fs.unlinkSync(thumbPath);
    }

    // Eliminar de BD
    db.prepare("DELETE FROM product_images WHERE id = ?").run(imgId);

    res.json({ message: "Imagen eliminada", imageId: imgId });
  } catch (err) {
    console.error("Error al eliminar imagen:", err);
    res.status(500).json({ error: "Error", code: "DELETE_ERROR" });
  }
});

// ─── POST /api/v1/products/bulk — Importar/Actualizar en bulk ─
router.post("/bulk", authenticateToken, requireRole("admin"), sanitize, [
  body("action").isIn(["create", "update", "sync"]).withMessage("action debe ser create, update o sync"),
  body("products").isArray({ min: 1 }).withMessage("products debe ser un array no vacío"),
  body("products.*.name").optional().trim().isLength({ min: 3, max: 150 }),
  body("products.*.price").optional().isFloat({ min: 0 }),
  body(" products.*.stockQuantity").optional().isInt({ min: 0 }).toInt(),
  validate,
], (req, res) => {
  try {
    const { action, products } = req.body;
    const results = [];
    let errors = 0;

    for (const p of products) {
      try {
        if (action === "create") {
          // Crear nuevo
          const sku = p.sku || generateUniqueSku();
          const existing = db.prepare("SELECT id FROM products WHERE sku = ?").get(sku);
          if (existing) {
            results.push({ success: false, error: `SKU ${sku} ya existe`, sku });
            errors++;
            continue;
          }
          const slug = generateUniqueSlug(p.name);
          const stockQty = p.stockQuantity !== undefined ? p.stockQuantity : 0;
          const stockStatus = stockQty === 0 ? "out_of_stock" : stockQty < 10 ? "low_stock" : "in_stock";

          const result = db.prepare(
            `INSERT INTO products (sku, name, slug, description, category_id, price,
             stock_quantity, stock_status, is_featured, is_new, tags, attributes, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
          ).run(
            sku,
            p.name,
            slug,
            p.description || null,
            p.categoryId || null,
            p.price || 0,
            stockQty,
            stockStatus,
            p.isFeatured ? 1 : 0,
            p.isNew ? 1 : 0,
            p.tags ? JSON.stringify(p.tags) : null,
            p.attributes ? JSON.stringify(p.attributes) : null,
          );

          results.push({ success: true, id: result.lastInsertRowid, sku });
        } else if (action === "update") {
          if (!p.id && !p.sku) {
            results.push({ success: false, error: "id o sku requerido para actualizar" });
            errors++;
            continue;
          }
          const productId = p.id ? parseInt(p.id) : db.prepare("SELECT id FROM products WHERE sku = ?").get(p.sku)?.id;
          if (!productId) {
            results.push({ success: false, error: "Producto no encontrado", sku: p.sku });
            errors++;
            continue;
          }

          const updates = [];
          const values = [];
          if (p.name !== undefined) { updates.push("name = ?, slug = ?"); values.push(p.name, generateUniqueSlug(p.name)); }
          if (p.price !== undefined) { updates.push("price = ?"); values.push(p.price); }
          if (p.stockQuantity !== undefined) {
            const diff = p.stockQuantity - (db.prepare("SELECT stock_quantity FROM products WHERE id = ?").get(productId)?.stock_quantity || 0);
            updates.push("stock_quantity = ?");
            values.push(p.stockQuantity);
            if (diff !== 0) {
              db.prepare(
                `INSERT INTO inventory_logs (product_id, change_qty, reason, reference, notes)
                 VALUES (?, ?, 'adjustment', ?, ?)`
              ).run(productId, diff, `Bulk sync`, `Actualización masiva`);
            }
          }
          if (p.isActive !== undefined) { updates.push("is_active = ?"); values.push(p.isActive ? 1 : 0); }
          if (p.attributes !== undefined) { updates.push("attributes = ?"); values.push(JSON.stringify(p.attributes)); }
          if (p.tags !== undefined) { updates.push("tags = ?"); values.push(JSON.stringify(p.tags)); }

          if (updates.length > 0) {
            updates.push("updated_at = datetime('now')");
            values.push(productId);
            db.prepare(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`).run(...values);
          }
          results.push({ success: true, id: productId });
        } else if (action === "sync") {
          // Sync = actualizar stock y precio desde origen externo
          if (!p.sku) {
            results.push({ success: false, error: "sku requerido para sync" });
            errors++;
            continue;
          }
          const productId = db.prepare("SELECT id FROM products WHERE sku = ?").get(p.sku)?.id;
          if (!productId) {
            results.push({ success: false, error: `Producto con SKU ${p.sku} no encontrado`, sku: p.sku });
            errors++;
            continue;
          }

          const updates = [];
          const values = [];
          if (p.price !== undefined) { updates.push("price = ?"); values.push(p.price); }
          if (p.stockQuantity !== undefined) {
            const current = db.prepare("SELECT stock_quantity FROM products WHERE id = ?").get(productId)?.stock_quantity || 0;
            const diff = p.stockQuantity - current;
            updates.push("stock_quantity = ?");
            values.push(p.stockQuantity);
            if (diff !== 0) {
              db.prepare(
                `INSERT INTO inventory_logs (product_id, change_qty, reason, reference, notes)
                 VALUES (?, ?, 'adjustment', ?, ?)`
              ).run(productId, diff, "sync externo", `Sincronización desde ${p.source || "externo"}`);
            }
          }
          if (p.isActive !== undefined) { updates.push("is_active = ?"); values.push(p.isActive ? 1 : 0); }
          if (p.name !== undefined) { updates.push("name = ?, slug = ?"); values.push(p.name, generateUniqueSlug(p.name)); }

          if (updates.length > 0) {
            updates.push("updated_at = datetime('now')");
            values.push(productId);
            db.prepare(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`).run(...values);
          }
          results.push({ success: true, id: productId, sku: p.sku });
        }
      } catch (err) {
        results.push({ success: false, error: err.message, sku: p.sku || p.id });
        errors++;
      }
    }

    res.json({
      message: `Bulk ${action} completado: ${results.filter(r => r.success).length} exitosos, ${errors} errores`,
      results,
      summary: {
        total: products.length,
        success: results.filter(r => r.success).length,
        errors,
      },
    });
  } catch (err) {
    console.error("Error en bulk:", err);
    res.status(500).json({ error: "Error en bulk operation", code: "BULK_ERROR" });
  }
});

// ─── GET /api/v1/products/stats — Estadísticas (admin) ─────
router.get("/stats", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const total = db.prepare("SELECT COUNT(*) as c FROM products WHERE is_active = 1").get();
    const lowStock = db.prepare("SELECT COUNT(*) as c FROM products WHERE stock_status = 'low_stock'").get();
    const outOfStock = db.prepare("SELECT COUNT(*) as c FROM products WHERE stock_status = 'out_of_stock'").get();
    const featured = db.prepare("SELECT COUNT(*) as c FROM products WHERE is_featured = 1").get();
    const totalStock = db.prepare("SELECT SUM(stock_quantity) as total FROM products WHERE is_active = 1").get();
    const totalValue = db.prepare(
      "SELECT SUM(price * stock_quantity) as total FROM products WHERE is_active = 1"
    ).get();
    const categories = db.prepare(
      "SELECT c.id, c.name, c.slug, COUNT(p.id) as product_count FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1 GROUP BY c.id ORDER BY product_count DESC"
    ).all();

    res.json({
      totalProducts: total.c,
      lowStock,
      outOfStock,
      featured: featured.c,
      totalStock: totalStock.total || 0,
      totalValue: totalValue.total || 0,
      categories: categories.map(c => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        productCount: c.product_count,
      })),
    });
  } catch (err) {
    console.error("Error en stats:", err);
    res.status(500).json({ error: "Error", code: "STATS_ERROR" });
  }
});

// ─── Exportar ────────────────────────────────────────────────
module.exports = router;
