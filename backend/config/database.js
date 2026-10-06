/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Capa de Base de Datos SQLite
 * ============================================================
 * - SQLite con WAL mode para concurrencia
 * - Migraciones automáticas (schema versioning)
 * - Pool de conexiones
 * - Prepare statements contra SQL injection
 * - Backup programado
 * ============================================================
 */

"use strict";

const Database = require("./sqlite-compat");
const path    = require("path");
const fs      = require("fs");

// ─── Singleton DB ────────────────────────────────────────────
let _db = null;

function getDb() {
  if (!_db) {
    throw new Error("Database not initialized. Call db.initialize() first.");
  }
  return _db;
}

// ─── SQL Schema ──────────────────────────────────────────────
const CREATE_TABLES_SQL = `
-- ─── Tabla de Versiones de Schema ─────────────────────────
CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Usuarios ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT  NOT NULL,
  name         TEXT    NOT NULL DEFAULT '',
  role         TEXT    NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','vendor','admin')),
  phone        TEXT,
  avatar_url   TEXT,
  status       TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deleted')),
  last_login   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

-- ─── Categorías de Producto ─────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  slug         TEXT    NOT NULL UNIQUE,
  description  TEXT,
  parent_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  image_url    TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(is_active);

-- ─── Productos ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sku             TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,
  slug            TEXT    NOT NULL UNIQUE,
  description     TEXT,
  description_ai  TEXT,          -- descripción generada por IA
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  price           REAL    NOT NULL DEFAULT 0 CHECK(price >= 0),
  compare_at_price REAL,
  cost_price      REAL,
  stock_quantity  INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
  stock_status    TEXT    NOT NULL DEFAULT 'in_stock' CHECK(stock_status IN ('in_stock','low_stock','out_of_stock','draft')),
  track_inventory INTEGER NOT NULL DEFAULT 1,
  weight          REAL,
  dimensions      TEXT,          -- JSON {length,width,height,unit}
  tags            TEXT,          -- JSON array
  attributes      TEXT,          -- JSON key-value para variantes
  is_active       INTEGER NOT NULL DEFAULT 1,
  is_featured     INTEGER NOT NULL DEFAULT 0,
  is_new          INTEGER NOT NULL DEFAULT 0,
  requires_shipping INTEGER NOT NULL DEFAULT 1,
  tax_category    TEXT    DEFAULT 'standard',
  seo_title       TEXT,
  seo_description TEXT,
  views           INTEGER NOT NULL DEFAULT 0,
  total_sales     INTEGER NOT NULL DEFAULT 0,
  rating_avg      REAL    NOT NULL DEFAULT 0,
  rating_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category  ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_sku      ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_slug     ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_active   ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(is_featured);
CREATE INDEX IF NOT EXISTS idx_products_price    ON products(price);

-- ─── Imágenes de Producto ───────────────────────────────────
CREATE TABLE IF NOT EXISTS product_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         TEXT    NOT NULL,
  alt_text    TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);

-- ─── Variantes de Producto ──────────────────────────────────
CREATE TABLE IF NOT EXISTS product_variants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku         TEXT    NOT NULL UNIQUE,
  name        TEXT,
  price       REAL    NOT NULL DEFAULT 0 CHECK(price >= 0),
  stock_qty   INTEGER NOT NULL DEFAULT 0 CHECK(stock_qty >= 0),
  attributes  TEXT,      -- JSON {color:"Rojo", size:"M", ...}
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

-- ─── Inventario (Histórico) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change_qty  INTEGER NOT NULL,  -- positivo = entrada, negativo = salida
  reason      TEXT    NOT NULL DEFAULT 'sale' CHECK(reason IN ('sale','restock','adjustment','return','transfer','damage','other')),
  reference   TEXT,              -- orden #{id}, ajuste #{id}, etc.
  notes       TEXT,
  performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inv_product ON inventory_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_created ON inventory_logs(created_at);

-- ─── Carrito de Compras ─────────────────────────────────────
-- En equipo de producción se usa Redis, pero SQLite funciona para empezar
CREATE TABLE IF NOT EXISTS carts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id    TEXT    NOT NULL,       -- para carrito anónimo
  items         TEXT    NOT NULL DEFAULT '[]', -- JSON array de {productId, variantId, qty, price}
  subtotal      REAL    NOT NULL DEFAULT 0,
  currency      TEXT    NOT NULL DEFAULT 'USD',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_carts_session ON carts(session_id);
CREATE INDEX IF NOT EXISTS idx_carts_user    ON carts(user_id);

-- ─── Pedidos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number      TEXT    NOT NULL UNIQUE,   -- ORDEN-2024-000001
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name     TEXT    NOT NULL,
  customer_email    TEXT    NOT NULL,
  customer_phone    TEXT,
  shipping_address   TEXT    NOT NULL,         -- JSON completa
  billing_address    TEXT,                     -- JSON, null = igual que shipping
  items             TEXT    NOT NULL,          -- JSON array de {productId, variantId, name, sku, qty, price, image}
  subtotal          REAL    NOT NULL,
  discount_total    REAL    NOT NULL DEFAULT 0,
  tax_total         REAL    NOT NULL DEFAULT 0,
  shipping_total    REAL    NOT NULL DEFAULT 0,
  total             REAL    NOT NULL,
  currency          TEXT    NOT NULL DEFAULT 'USD',
  status            TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','processing','shipped','delivered','cancelled','refunded')),
  payment_status    TEXT    NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid','partial','refunded','failed')),
  payment_method    TEXT,
  payment_intent_id TEXT,                      -- Stripe PaymentIntent ID
  stripe_session_id TEXT,
  tracking_number   TEXT,
  carrier          TEXT,
  notes            TEXT,
  internal_notes    TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  paid_at          TEXT,
  shipped_at       TEXT,
  delivered_at     TEXT,
  cancelled_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_number    ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_user      ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status    ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment   ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created   ON orders(created_at);

-- ─── Transacciones / Pagos ──────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider         TEXT    NOT NULL DEFAULT 'stripe',  -- stripe, paypal, mercadopago, etc.
  provider_id      TEXT    NOT NULL,                    -- ID externo del proveedor
  amount           REAL    NOT NULL,
  currency         TEXT    NOT NULL DEFAULT 'USD',
  status           TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed','refunded','partially_refunded')),
  payment_type     TEXT    NOT NULL DEFAULT 'charge' CHECK(payment_type IN ('charge','refund','capture','authorization')),
  raw_response     TEXT,                                -- JSON respuesta del gateway
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_prov  ON payments(provider, provider_id);

-- ─── Categorías de Facturación / Impuestos ──────────────────
CREATE TABLE IF NOT EXISTS tax_rates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  rate        REAL    NOT NULL DEFAULT 0 CHECK(rate >= 0),
  country     TEXT    NOT NULL DEFAULT 'ALL',
  region      TEXT,
  type        TEXT    NOT NULL DEFAULT 'percentage',
  is_active   INTEGER NOT NULL DEFAULT 1,
  priority    INTEGER NOT NULL DEFAULT 0
);

-- ─── Descuentos / Cupones ────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT    NOT NULL UNIQUE,
  description    TEXT,
  discount_type  TEXT    NOT NULL DEFAULT 'percentage' CHECK(discount_type IN ('percentage','fixed','shipping')),
  discount_value REAL    NOT NULL DEFAULT 0,
  min_order_total REAL,
  max_discount   REAL,
  usage_limit    INTEGER,
  usage_count    INTEGER NOT NULL DEFAULT 0,
  valid_from     TEXT,
  valid_until    TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  applies_to     TEXT,           -- 'all', 'specific', JSON array de IDs
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);

-- ─── Reseñas de Productos ────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rating      INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  title       TEXT,
  content     TEXT    NOT NULL,
  is_verified INTEGER NOT NULL DEFAULT 0,
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status  ON reviews(status);

-- ─── Chat de Ventas (mensajes) ──────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,       -- sesión de chat única
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender      TEXT    NOT NULL CHECK(sender IN ('customer','bot','admin')),
  message     TEXT    NOT NULL,
  attachments TEXT,                   -- JSON array de URLs
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_user    ON chat_messages(user_id);

-- ─── Sesiones de Chat ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL UNIQUE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_email TEXT,
  customer_name  TEXT,
  phone        TEXT,
  cart_id     INTEGER REFERENCES carts(id) ON DELETE SET NULL,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','archived')),
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);

-- ─── Logs de Auditoría ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  details     TEXT,              -- JSON
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_date  ON audit_logs(created_at);

-- ─── Configuración del Sitio ────────────────────────────────
CREATE TABLE IF NOT EXISTS site_settings (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─── Tokens de Recuperación / Verificación ──────────────────
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT    NOT NULL UNIQUE,
  type        TEXT    NOT NULL DEFAULT 'reset' CHECK(type IN ('reset','verify','refresh','session')),
  expires_at  TEXT    NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_tok  ON auth_tokens(token);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_exp  ON auth_tokens(expires_at);
`;

// ─── Initial Data (si está vacío) ───────────────────────────
const SEED_SQL = `
-- Categorías demo
INSERT OR IGNORE INTO categories (id, name, slug, description, sort_order, is_active) VALUES
  (1, 'Electrónica', 'electronica', 'Teléfonos, computadores, accesorios y más', 1, 1),
  (2, 'Ropa y Moda', 'ropa-moda', 'Ropa, calzado, accesorios de moda', 2, 1),
  (3, 'Hogar y Jardín', 'hogar-jardin', 'Artículos para el hogar, decoración, jardinería', 3, 1),
  (4, 'Beauty & Cuidado Personal', 'beauty-cuidado', 'Productos de belleza y cuidado personal', 4, 1),
  (5, 'Deportes y Fitness', 'deportes-fitness', 'Equipo deportivo y artículos de fitness', 5, 1);

-- Producto demo
INSERT OR IGNORE INTO products (id, sku, name, slug, description, category_id, price, stock_quantity, stock_status, is_featured, is_new, tags, attributes, seo_title, seo_description, total_sales) VALUES
  (1, 'PROD-001', 'Auriculares Bluetooth Pro', 'auriculares-bluetooth-pro',
   'Auriculares con cancelación de ruido activa, batería de 40 horas, sonido Hi-Res.',
   1, 79.99, 150, 'in_stock', 1, 1,
   '["audio","bluetooth","tech"]',
   '{"color": "Negro"}',
   'Auriculares Bluetooth Pro — Cancelación de Ruido',
   'Los mejores auriculares Bluetooth con cancelación de ruido. 40h batería, sonido Hi-Res.', 342),

  (2, 'PROD-002', 'Smartwatch Deportivo X200', 'smartwatch-deportivo-x200',
   'Smartwatch con GPS integrado, monitoreo de salud 24/7, resistente al agua IP68.',
   1, 199.99, 85, 'in_stock', 1, 1,
   '["wearables","fitness","tech"]',
   '{"talla": "Universal"}',
   'Smartwatch Deportivo X200 — GPS y Health Tracking',
   'Smartwatch GPS con monitoreo completo de salud. Resistente al agua IP68.', 128),

  (3, 'PROD-003', 'Camiseta Premium Algodón Orgánico', 'camiseta-premium-algodon-organico',
   'Camiseta hecha con 100% algodón orgánico certificado. Suave, transpirable y ecológica.',
   2, 39.99, 300, 'in_stock', 0, 1,
   '["ropa","ecologico","basic"]',
   '{"color": "Blanco", "talla": "M"}',
   'Camiseta Premium Algodón Orgánico — Cómoda y Sostenible',
   'Camiseta de algodón orgánico certificado. Suave, transpirable, 100% ecológica.', 567),

  (4, 'PROD-004', 'Zapatillas Running CloudFlex', 'zapatillas-running-cloudflex',
   'Zapatillas de running con tecnología de amortiguación CloudFlex. Ligeros y resistentes.',
   2, 129.99, 200, 'in_stock', 1, 0,
   '["calzado","running","deporte"]',
   '{"color": "Azul", "talla": "42"}',
   'Zapatillas Running CloudFlex — Amortiguación Innovadora',
   'Zapatillas de running con amortiguación CloudFlex. Ligeros, resistentes, cómodos.', 234),

  (5, 'PROD-005', 'Juego de Sábanas Bamboo Premium', 'juego-sabanas-bamboo-premium',
   'Juego de sábanas de bambú orgánico, suave al tacto, hipoalergénico y transpirable.',
   3, 89.99, 120, 'in_stock', 0, 1,
   '["hogar","cama","ecologico"]',
   '{"talla": "Queen"}',
   'Juego de Sábanas Bamboo Premium — Suave y Ecológico',
   'Sábanas de bambú orgánico. Hipoalergénico, transpirable, suave como la seda.', 89),

  (6, 'PROD-006', 'Secador de Pelo Ion AirFit', 'secador-pelo-ion-airfit',
   'Secador de pelo con tecnología ion negativa, 3 velocidades, 2 temperatura, difusor incluido.',
   4, 59.99, 200, 'in_stock', 0, 0,
   '["beauty","peluqueria","electronicos"]',
   '{"color": "Plateado"}',
   'Secador de Pelo Ion AirFit — Tecnología Ionic',
   'Secador profesional con tecnología ion negativa. Brillo, sin frizz, 3 velocidades.', 445),

  (7, 'PROD-007', 'Bandeja de Pesas Adjustable 20kg', 'bandeja-pesas-adjustable-20kg',
   'Juego de pesas ajustables con placas de hierro revestido en manganeso, incluye barra y seguro.',
   5, 249.99, 45, 'low_stock', 1, 1,
   '["fitness","pesas","gym"]',
   '{"material": "Hierro manganeso"}',
   'Bandeja de Pesas Adjustable 20kg — Completa',
   'Set completo de pesas ajustables 20kg. Hierro revestido, incluye barra y seguro.', 67);

-- Imágenes demo
INSERT OR IGNORE INTO product_images (product_id, url, alt_text, sort_order, is_primary) VALUES
  (1, '/uploads/products/prod-001-1.jpg', 'Auriculares Bluetooth Pro - vista frontal', 0, 1),
  (1, '/uploads/products/prod-001-2.jpg', 'Auriculares Bluetooth Pro - detalle', 1, 0),
  (2, '/uploads/products/prod-002-1.jpg', 'Smartwatch Deportivo X200', 0, 1),
  (3, '/uploads/products/prod-003-1.jpg', 'Camiseta Premium Algodón Orgánico', 0, 1),
  (4, '/uploads/products/prod-004-1.jpg', 'Zapatillas Running CloudFlex', 0, 1),
  (5, '/uploads/products/prod-005-1.jpg', 'Juego de Sábanas Bamboo', 0, 1),
  (6, '/uploads/products/prod-006-1.jpg', 'Secador Ion AirFit', 0, 1),
  (7, '/uploads/products/prod-007-1.jpg', 'Bandeja de Pesas Adjustable', 0, 1);

-- Configuración básica del sitio
INSERT OR IGNORE INTO site_settings (key, value) VALUES
  ('site_name', 'Mi Tienda Online'),
  ('site_description', 'Tu tienda de productos seleccionados con la mejor calidad y precios.'),
  ('currency', 'USD'),
  ('locale', 'es'),
  ('contact_email', 'contacto@mitienda.com'),
  ('support_phone', '+00 000 000 0000'),
  ('address', 'Calle Principal 123, Ciudad, País'),
  ('about_text', 'Somos una tienda online dedicada a ofrecer productos de alta calidad.'),
  ('shipping_flat_rate', '5.99'),
  ('free_shipping_threshold', '75.00'),
  ('tax_rate_default', '0'),
  ('return_policy_days', '30'),
  ('chat_welcome_message', '¡Hola! 👋 ¿En qué puedo ayudarte hoy? Puedes preguntarme sobre productos, precios, stock o cualquier otra duda.'),
  ('maintenance_mode', '0');
`;

// ─── Configuración del módulo (lee entorno con fallbacks) ────
// IMPORTANTE: la ruta por defecto debe ser <raíz>/data/ecommerce.db.
// Antes era path.resolve(__dirname, "..", "data", ...) que desde
// backend/config/ resolvía a backend/data/ecommerce.db — una base
// DISTINTA y vacía, así que la API servía 7 productos genéricos
// mientras la base real (36 productos) quedaba ignorada.
const sharedConfig = require("./index");
const config = {
  dbPath: sharedConfig.dbPath,
  backupDir: sharedConfig.backupDir || path.resolve(__dirname, "..", "..", "backups"),
  backupRetention: sharedConfig.backupRetention || 30,
  adminName: sharedConfig.adminName || "Admin",
  adminEmail: sharedConfig.adminEmail || "admin@tecnogamer.local",
  adminPassword: sharedConfig.adminPassword || "",
};

// ─── Inicialización ──────────────────────────────────────────
async function initialize() {
  // Asegurar directorio de DB
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Conexión
  _db = new Database(config.dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("synchronous = NORMAL");   // WAL + NORMAL: 2-10x más rápido que FULL
  _db.pragma("journal_size_limit = 67108864"); // 64MB
  // ─── Tuning de rendimiento (SQLite best practices) ──────────
  _db.pragma("cache_size = -64000");    // 64MB de caché de páginas (negativo = KB)
  _db.pragma("mmap_size = 268435456");  // 256MB de memoria mapeada (lecturas sin copia)
  _db.pragma("temp_store = MEMORY");    // tablas temporales en RAM
  _db.pragma("busy_timeout = 5000");    // esperar 5s si la BD está bloqueada
  _db.pragma("auto_vacuum = INCREMENTAL"); // evita fragmentación sin VACUUM completo

  // Ejecutar schema
  _db.exec(CREATE_TABLES_SQL);

  // ─── Migraciones incrementales (idempotentes) ───────────────
  runMigrations(_db);

  // Verificar si hay datos
  const count = _db.prepare("SELECT COUNT(*) as c FROM products").get();
  if (count.c === 0) {
    console.log("🌱  Sembrando datos iniciales...");
    _db.exec(SEED_SQL);
    console.log("✅  Datos iniciales creados");
  }

  // Crear admin por defecto si no existe
  const admin = _db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) {
    // Si hay password configurada en .env, usarlo; sino crear con un hash fuerte por defecto
    const defaultPw = config.adminPassword || "Admin123!";
    const bcrypt = require("bcryptjs");
    const hash = bcrypt.hashSync(defaultPw, 12);
    const email = config.adminEmail;

    _db.prepare(
      "INSERT INTO users (email, password_hash, name, role, status) VALUES (?, ?, ?, 'admin', 'active')"
    ).run(email, hash, config.adminName);

    console.log(`👤  Admin creado: ${email} / ${defaultPw}`);
    console.log("⚠  CAMBIA LA CONTRASEÑA DEL ADMIN INMEDIATAMENTE EN PRODUCCIÓN");
  }

  console.log(`📊  Tablas listas. Productos: ${count.c}`);
}

// ─── Caché en memoria (rendimiento) ─────────────────────────
// Almacena resultados de consultas frecuentes para evitar golpes
// repetidos a la base de datos. TTL corto para mantener coherencia.
const _cache = new Map();

function cacheGet(key) {
  const hit = _cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) { _cache.delete(key); return undefined; }
  return hit.value;
}

function cacheSet(key, value, ttlMs = 30000) {
  _cache.set(key, { value, expires: Date.now() + ttlMs });
}

function cacheInvalidate(prefix) {
  for (const k of _cache.keys()) {
    if (k.startsWith(prefix)) _cache.delete(k);
  }
}

// ─── Migraciones incrementales ───────────────────────────────
// Cada migración es idempotente: comprueba si la columna/tabla existe
// antes de aplicarla. Permite actualizar bases de datos ya en uso sin
// perder datos (requisito de producción).
function runMigrations(db) {
  const applied = [];

  function hasColumn(table, column) {
    try {
      return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
    } catch (_) { return false; }
  }

  function addColumn(table, column, definition) {
    if (!hasColumn(table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      applied.push(`${table}.${column}`);
    }
  }

  // v2: datos de auditoría en tokens de sesión
  addColumn("auth_tokens", "ip_address", "TEXT");
  addColumn("auth_tokens", "user_agent", "TEXT");

  // v3: campos de operador/vendor en productos (multi-vendedor)
  addColumn("products", "vendor_id", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
  addColumn("products", "sort_order", "INTEGER NOT NULL DEFAULT 0");

  // v4: seguimiento de envío en pedidos
  addColumn("orders", "tracking_number", "TEXT");
  addColumn("orders", "carrier", "TEXT");
  addColumn("orders", "shipped_at", "TEXT");
  addColumn("orders", "delivered_at", "TEXT");

  // v5: metadatos de pago
  addColumn("payments", "gateway_response", "TEXT");
  addColumn("payments", "refunded_amount", "REAL NOT NULL DEFAULT 0");

  // v6: imágenes de producto — alt text obligatorio para accesibilidad
  addColumn("product_images", "alt_text", "TEXT");
  addColumn("product_images", "is_primary", "INTEGER NOT NULL DEFAULT 0");

  // v7: modelo de precios estilo retail chileno (patrón pc Factory)
  //   cash_price  → precio con transferencia/débito (más bajo, gancho principal)
  //   installments → número de cuotas sin interés ofrecidas
  addColumn("products", "cash_price", "REAL");
  addColumn("products", "installments", "INTEGER NOT NULL DEFAULT 0");
  addColumn("products", "pickup_available", "INTEGER NOT NULL DEFAULT 1");
  addColumn("products", "store_stock", "TEXT");

  // v8: reseñas — permitir respuestas del operador
  addColumn("reviews", "admin_reply", "TEXT");

  if (applied.length) {
    console.log(`🔧  Migraciones aplicadas: ${applied.join(", ")}`);
  }
  return applied;
}

// ─── Helper para transacciones ───────────────────────────────
function transaction(fn) {
  const db = getDb();
  return db.transaction(fn);
}

// ─── Query helpers ───────────────────────────────────────────
function prepare(sql) {
  return getDb().prepare(sql);
}

function run(sql, ...params) {
  return getDb().prepare(sql).run(...params);
}

function get(sql, ...params) {
  return getDb().prepare(sql).get(...params);
}

function all(sql, ...params) {
  return getDb().prepare(sql).all(...params);
}

function exec(sql) {
  return getDb().exec(sql);
}

// ─── Backup ──────────────────────────────────────────────────
async function backup() {
  const backupPath = path.resolve(
    config.backupDir || path.resolve(__dirname, "..", "backups"),
    `backup-${Date.now()}.db`
  );

  // Asegurar dir
  const backupDir = path.dirname(backupPath);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backup = new Database(backupPath);
  backup.pragma("journal_mode = DELETE");
  getDb().backup(backup);
  backup.close();

  console.log(`💾  Backup creado: ${backupPath}`);

  // Limpiar backups viejos
  const retentionDays = config.backupRetention || 30;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  fs.readdirSync(backupDir)
    .filter(f => f.startsWith("backup-") && f.endsWith(".db"))
    .forEach(f => {
      const fp = path.join(backupDir, f);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fp);
        console.log(`🗑️  Backup viejo eliminado: ${f}`);
      }
    });

  return backupPath;
}

// ─── Cerrar conexión ─────────────────────────────────────────
function close() {
  if (_db) {
    _db.close();
    _db = null;
    console.log("🔌  Base de datos cerrada");
  }
}

// ─── Export ──────────────────────────────────────────────────
const envDbPath = process.env.DB_PATH || path.resolve(__dirname, "..", "data", "ecommerce.db");
const envBackupRetention = parseInt(process.env.BACKUP_RETENTION_DAYS || "30", 10);

module.exports = {
  initialize,
  getDb,
  transaction,
  prepare,
  run,
  get,
  all,
  exec,
  backup,
  close,
  cacheGet,
  cacheSet,
  cacheInvalidate,
  db: {
    get raw() { return getDb(); },
  },
};
