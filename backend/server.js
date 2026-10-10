/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Servidor Backend Principal
 * ============================================================
 * Stack: Node.js + Express + SQLite (WAL mode) + Stripe
 * Seguridad: Helmet, Rate Limiting, CORS estricto, JWT, bcrypt
 * 
 * Características:
 *   - API REST completa para productos, categorías, carrito, pedidos
 *   - Sistema de autenticación con JWT (access + refresh tokens)
 *   - Integración con Stripe para pagos seguros (SAQ A compliant)
 *   - Generación de descripciones con IA (OpenAI compatible)
 *   - Chat de ventas (web + WhatsApp Business API)
 *   - Control de inventario en tiempo real
 *   - Subida segura de imágenes con Sharp
 *   - Auditoría y logs estructurados
 *   - Backups automáticos
 *   - Multi-plataforma (API-first para web, PWA, mobile, chat)
 * 
 * Ejecutar:
 *   npm install
 *   cp .env.example .env  (y editar)
 *   npm run db:seed        (crear datos demo)
 *   npm start              (servidor en :3000)
 * ============================================================
 */

"use strict";

const path = require("path");
const config = require("./config");

// ─── Garantizar directorios esenciales ───────────────────────
const fs = require("fs");
[
  path.dirname(config.dbPath),
  config.uploadDir,
  config.backupDir,
].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁  Creado: ${dir}`);
  }
});

// ─── Dependencias ────────────────────────────────────────────
const express       = require("express");
const helmet        = require("helmet");
const cors          = require("cors");
const rateLimit     = require("express-rate-limit");
const morgan        = require("morgan");
const compression   = require("compression");
const bodyParser    = require("body-parser");

// Librerías locales
const db         = require("./config/database");
const authRoutes  = require("./routes/auth");
const productRoutes  = require("./routes/products");
const categoryRoutes = require("./routes/categories");
const cartRoutes     = require("./routes/cart");
const orderRoutes    = require("./routes/orders");
const inventoryRoutes = require("./routes/inventory");
const aiRoutes       = require("./routes/ai");
const chatRoutes     = require("./routes/chat");
const uploadRoutes   = require("./routes/uploads");
const adminRoutes    = require("./routes/admin");
const webhookRoutes  = require("./routes/webhooks");
const chatWebRoutes   = require("./routes/chat-web");
const configRoutes    = require("./routes/config");
const repairRoutes    = require("./routes/repairs");
const repairApiRoutes = require("./routes/repairs-api");
const { errorHandler, notFound } = require("./middleware/errorHandler");
const { securityHeaders } = require("./middleware/securityHeaders");

// ─── App ─────────────────────────────────────────────────────
const app = express();

// ¿Entorno de producción? Se usa para alternar el endurecimiento
// (límites de tasa reales, trust proxy, caché de estáticos).
const isProd = config.nodeEnv === "production";

// Detrás de un proxy inverso (Nginx/Caddy) la IP real llega en X-Forwarded-For.
// Sin esto, el rate limiting contaría todas las peticiones como si vinieran del
// proxy y bloquearía a todos los usuarios a la vez.
if (isProd) {
  app.set("trust proxy", 1);
}

// ─── Seguridad: Helmet ───────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'",
        "https://js.stripe.com",
        "https://*.whatsapp.com",
        "https://connect.facebook.net",
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'",
        "https://api.stripe.com",
        "https://api.openai.com",
        "https://graph.facebook.com",
        "https://whatsapp.com",
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "https://js.stripe.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// ─── CORS ────────────────────────────────────────────────────
// En producción, restringir al dominio real. En desarrollo, permitir todo.
const corsOptions = {
  origin: config.corsOrigin === "*" ? "*" : (req, callback) => {
    const origin = req.headers.origin || "";
    const allowed = config.corsOrigin.split(",").map(o => o.trim());
    if (allowed.includes(origin) || allowed.includes("*")) {
      callback(null, { origin, credentials: true });
    } else {
      callback(new Error("CORS no permitido"), false);
    }
  },
  credentials: true,
  methods: config.corsMethods,
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
  maxAge: 86400,
  maxAge: 86400,
};

app.use(cors(corsOptions));

// ─── Rate Limiting ───────────────────────────────────────────
// En producción se aplican los límites reales; en desarrollo se relajan
// para permitir pruebas repetidas sin bloquear al operador.

const globalLimiter = rateLimit({
  windowMs: config.rateLimitWindowsMs,
  max: isProd ? config.rateLimitMaxReqs : 100000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiadas solicitudes. Intenta de nuevo más tarde.",
    retryAfter: Math.ceil(config.rateLimitWindowsMs / 1000),
  },
  skip: (req) => {
    // Excluir endpoints de webhook de Stripe
    return req.path.startsWith("/api/webhooks/");
  },
});

app.use(globalLimiter);

// Rate limiter más estricto para rutas sensibles (recuperación de contraseña, etc.)
const strictLimiter = rateLimit({
  windowMs: isProd ? 15 * 60 * 1000 : 60 * 1000,
  max: isProd ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos.", code: "RATE_LIMITED" },
});

// Rate limiter estricto para autenticación (anti fuerza bruta / credential stuffing)
// Producción: 10 intentos fallidos por IP cada 15 minutos.
// En desarrollo se permite omitirlo con la cabecera X-Load-Test para que la
// suite de pruebas sea re-ejecutable. En producción el bypass NUNCA aplica.
const authLimiter = rateLimit({
  windowMs: isProd ? 15 * 60 * 1000 : 60 * 1000,
  max: isProd ? 10 : 25,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // solo cuentan los intentos fallidos
  skip: (req) => !isProd && req.get("x-load-test") === "1",
  message: {
    error: "Demasiados intentos de inicio de sesión. Intenta más tarde.",
    code: "AUTH_RATE_LIMITED",
  },
});

// ─── Compression ─────────────────────────────────────────────
// Umbral 1KB: no comprimir respuestas pequeñas (el overhead supera el ahorro).
// Nivel 6: mejor relación compresión/CPU para JSON de API.
app.use(compression({
  threshold: 1024,
  level: 6,
  filter: (req, res) => {
    // No comprimir imágenes ni recursos ya comprimidos
    const type = res.getHeader("Content-Type") || "";
    if (/image\/(png|jpe?g|webp|avif|gif)|application\/zip|font\//.test(type)) return false;
    return compression.filter(req, res);
  },
}));

// ─── Body Parser ─────────────────────────────────────────────
app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "1mb" }));

// ─── Logging ─────────────────────────────────────────────────
const morganFormat = config.nodeEnv === "production" ? "combined" : "dev";
app.use(morgan(morganFormat, {
  skip: (req) => req.path.startsWith("/api/webhooks/"),
}));

// ─── Health Check ────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: config.siteName,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv,
  });
});

// ─── Sistema de Info ─────────────────────────────────────────
app.get("/api/system/info", (req, res) => {
  res.json({
    name: config.siteName,
    version: "1.0.0",
    environment: config.nodeEnv,
    features: {
      stripe: !!config.stripeSecretKey,
      aiDescriptions: !!(config.aiApiUrl && config.aiApiKey),
      whatsappChat: config.whatsappEnabled,
      webChat: config.chatWebEnabled,
      inventory: true,
      backups: true,
    },
    stripePublishableKey: config.stripePublishableKey || null,
    chatWeb: {
      enabled: config.chatWebEnabled,
      greetMessage: config.chatWebEnabled
        ? (process.env.CHAT_WEB_GREET_MESSAGE || "Hola! 👋 ¿En qué puedo ayudarte?")
        : null,
      supportUrl: process.env.CHAT_WEB_SUPPORT_URL || null,
    },
  });
});

// ─── Rutas API ────────────────────────────────────────────────
// Prefijo /api/v1 para versionado
const apiPrefix = "/api/v1";

app.use(`${apiPrefix}/auth/login`, authLimiter);
app.use(`${apiPrefix}/auth/register`, authLimiter);
app.use(`${apiPrefix}/auth/forgot-password`, strictLimiter);
app.use(`${apiPrefix}/auth/reset-password`, strictLimiter);
app.use(`${apiPrefix}/auth`, authRoutes);
app.use(`${apiPrefix}/products`, productRoutes);
app.use(`${apiPrefix}/categories`, categoryRoutes);
app.use(`${apiPrefix}/cart`, cartRoutes);
app.use(`${apiPrefix}/orders`, orderRoutes);
app.use(`${apiPrefix}/inventory`, inventoryRoutes);
app.use(`${apiPrefix}/ai`, aiRoutes);
app.use(`${apiPrefix}/chat`, chatRoutes);
app.use(`${apiPrefix}/upload`, uploadRoutes);
app.use(`${apiPrefix}/admin`, adminRoutes);
app.use(`${apiPrefix}/webhooks`, webhookRoutes);
app.use(`${apiPrefix}/chat-web`, chatWebRoutes);
app.use(`${apiPrefix}/config`, configRoutes);
app.use(`${apiPrefix}/repairs`, repairRoutes);
app.use(`${apiPrefix}/repairs-api`, repairApiRoutes);

// Stripe checkout session builder (endpoint público para frontend)
app.post(`${apiPrefix}/checkout/create-session`, async (req, res) => {
  const { items, customerEmail, metadata } = req.body;

  if (!config.stripeSecretKey || config.stripeSecretKey.startsWith("sk_test_XXXXXXXX")) {
    return res.status(503).json({
      error: "Pasarela de pago no configurada. Configure STRIPE_SECRET_KEY en .env",
    });
  }

  try {
    const stripe = require("stripe")(config.stripeSecretKey);

    const lineItems = items.map(item => ({
      price_data: {
        currency: config.stripeCurrency,
        product_data: {
          name: item.name,
          images: item.images || [],
          description: item.description || undefined,
        },
        unit_amount: Math.round((item.price || 0) * 100),
      },
      quantity: item.quantity || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      customer_email: customerEmail || undefined,
      success_url: `${config.siteUrl || "https://tudominio.com"}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${config.siteUrl || "https://tudominio.com"}/checkout/cancel`,
      metadata: metadata || {},
      payment_intent_data: {
        application_fee_amount: undefined,
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("❌  Error Stripe checkout:", err.message);
    res.status(500).json({ error: "Error al crear la sesión de pago" });
  }
});

// ─── Servir frontend estático ────────────────────────────────
// El storefront se sirve ANTES del handler 404, tanto en desarrollo
// como en producción, para que la web sea accesible de inmediato.
const frontendDist = path.resolve(__dirname, "..", "frontend", "dist");
const frontendSrc  = path.resolve(__dirname, "..", "frontend");
const staticRoot = fs.existsSync(frontendDist) ? frontendDist : frontendSrc;

if (fs.existsSync(staticRoot)) {
  app.use(express.static(staticRoot, {
    maxAge: config.nodeEnv === "production" ? "7d" : 0,
    etag: true,
    index: "index.html",
  }));
  console.log(`📦  Frontend servido desde ${path.basename(staticRoot)}/`);
}

// ─── Servir uploads ──────────────────────────────────────────
app.use("/uploads", express.static(config.uploadDir, { maxAge: "1d" }));

// ─── SPA fallback (solo rutas no-API) ────────────────────────
app.get(/^\/(?!api|uploads|health).*/, (req, res, next) => {
  const indexPath = path.resolve(staticRoot, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  next();
});

// ─── Middleware de error handling ────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Inicialización ──────────────────────────────────────────
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║     E-COMMERCE FULLSTACK  v1.0.0   —  Servidor Principal      ║
║     ${config.siteName.padEnd(50)}   ║
╠═══════════════════════════════════════════════════════════════╣
║  🌐  Servidor:     http://${config.host}:${config.port}                               ║
║  📦  DB:           SQLite ${config.dbWal ? "+ WAL" : ""}  (${config.dbPath.split("/").pop()})                               ║
║  🔐  JWT:          ${config.jwtExpiresIn} access / ${config.jwtRefreshExp} refresh                     ║
║  💳  Stripe:       ${config.stripeSecretKey ? "✅ Configurado" : "❌ No configurado"}                                         ║
║  🤖  IA Descrip.   ${!!(config.aiApiUrl && config.aiApiKey) ? "✅ Activo" : "❌ No configurado"}                                         ║
║  💬  WhatsApp Chat: ${config.whatsappEnabled ? "✅ Habilitado" : "○ Desactivado"}                                     ║
║  💬  Web Chat:     ${config.chatWebEnabled ? "✅ Habilitado" : "❌ Desactivado"}                                       ║
║  📊  Environment:  ${config.nodeEnv.padEnd(47)}   ║
╚═══════════════════════════════════════════════════════════════╝
  `);

  // Conectar base de datos
  try {
    await db.initialize();
    console.log("✅  Base de datos conectada y tablas verificadas");
  } catch (err) {
    console.error("❌  Error de base de datos fatal:", err.message);
    if (config.nodeEnv === "production") {
      process.exit(1);
    }
  }

  // Iniciar servidor
  const server = app.listen(config.port, config.host, () => {
    console.log(`\n🚀  Servidor corriendo en http://${config.host}:${config.port}`);
    console.log(`🔗  Documentación API: http://${config.host}:${config.port}/api-docs (si disponible)\n`);
  });

  // Manejo de señales
  const shutdown = (signal) => {
    console.log(`\n🛑  Señal recibida (${signal}). Cerrando servidor...`);
    server.close(() => {
      console.log("✅  Servidor cerrado correctamente");
      db.close();
      process.exit(0);
    });
    setTimeout(() => {
      console.error("⚠  Forzando cierre tras 10s...");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  // Manejo de errores no capturados
  process.on("uncaughtException", (err) => {
    console.error("❌  Exception no capturado:", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("❌  Promesa rechazada no manejada:", reason);
  });
}

main().catch(err => {
  console.error("❌  Error al iniciar el servidor:", err);
  process.exit(1);
});

// ─── Exportar para testing ───────────────────────────────────
module.exports = { app, config };
