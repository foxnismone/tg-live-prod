/**
 * ============================================================
 * CONFIG — Configuración compartida (SIN dependencias circulares)
 * ============================================================
 * server.js, routes/* y middleware/* importan este módulo.
 * Antes cada ruta hacía require("../server").config, lo que creaba
 * una dependencia circular: server.js → routes → server.js.
 * Resultado: en el arranque las rutas recibían un objeto vacío y
 * Express fallaba con "Router.use() requires a middleware function".
 * ============================================================
 */

"use strict";

const path = require("path");
const dotenv = require("dotenv");

const projectRoot = path.resolve(__dirname, "..", "..");

let envConfig = {};
try {
  envConfig = dotenv.config({ path: path.resolve(projectRoot, ".env") }).parsed || {};
} catch (_) {
  console.warn("⚠  No se encontró .env — usando valores por defecto");
}

function env(key, fallback) {
  const v = envConfig[key] !== undefined ? envConfig[key] : process.env[key];
  return (v === undefined || v === "") ? fallback : v;
}

const config = {
  // Servidor
  port: parseInt(env("PORT", "3000"), 10),
  host: env("HOST", "0.0.0.0"),
  nodeEnv: env("NODE_ENV", "development"),

  // Seguridad
  jwtSecret: env("JWT_SECRET", "dev-secret-change-in-production-" + Date.now()),
  jwtExpiresIn: env("JWT_EXPIRES_IN", "7d"),
  jwtRefreshExp: env("JWT_REFRESH_EXPIRES_IN", "30d"),

  // Base de datos
  dbPath: env("DB_PATH", path.resolve(projectRoot, "data", "ecommerce.db")),
  dbWal: env("DB_WAL_MODE", "true") !== "false",

  // Uploads
  uploadDir: env("UPLOAD_DIR", path.resolve(projectRoot, "uploads")),
  uploadMaxSizeMB: parseInt(env("UPLOAD_MAX_SIZE_MB", "10"), 10),
  allowedImageTypes: env("ALLOWED_IMAGE_TYPES", "jpg,jpeg,png,webp,avif,gif"),
  thumbnailMaxW: parseInt(env("THUMBNAIL_MAX_WIDTH", "400"), 10),
  thumbnailMaxH: parseInt(env("THUMBNAIL_MAX_HEIGHT", "400"), 10),

  // Stripe
  stripeSecretKey: env("STRIPE_SECRET_KEY", ""),
  stripePublishableKey: env("STRIPE_PUBLISHABLE_KEY", ""),
  stripeWebhookSecret: env("STRIPE_WEBHOOK_SECRET", ""),
  stripeCurrency: env("STRIPE_CURRENCY", "usd"),

  // IA
  aiApiUrl: env("AI_API_URL", ""),
  aiApiKey: env("AI_API_KEY", ""),
  aiModel: env("AI_MODEL", "gpt-4o-mini"),
  aiTemperature: parseFloat(env("AI_TEMPERATURE", "0.7")),
  aiMaxTokens: parseInt(env("AI_MAX_TOKENS", "2000"), 10),
  aiPromptTpl: env("AI_PROMPT_TEMPLATE", ""),

  // Chat
  whatsappEnabled: env("WHATSAPP_ENABLED", "false") === "true",
  whatsappToken: env("WHATSAPP_TOKEN", ""),
  whatsappPhoneId: env("WHATSAPP_PHONE_NUMBER_ID", ""),
  whatsappVerifyTok: env("WHATSAPP_VERIFY_TOKEN", ""),
  chatWebEnabled: env("CHAT_WEB_ENABLED", "true") !== "false",

  // Email
  emailService: env("EMAIL_SERVICE", ""),
  emailUser: env("EMAIL_USER", ""),
  emailPass: env("EMAIL_PASS", ""),
  emailFrom: env("EMAIL_FROM", "noreply@localhost"),
  emailReplyTo: env("EMAIL_REPLY_TO", ""),

  // Admin
  adminName: env("ADMIN_NAME", "Admin"),
  adminEmail: env("ADMIN_EMAIL", "admin@tecnogamer.local"),
  adminPassword: env("ADMIN_PASSWORD_CIPHER", ""),

  // CORS
  corsOrigin: env("CORS_ORIGIN", "*"),
  corsMethods: env("CORS_METHODS", "GET,POST,PUT,DELETE,OPTIONS"),

  // Rate limiting
  rateLimitWindowsMs: parseInt(env("RATE_LIMIT_WINDOW_MS", "900000"), 10),
  rateLimitMaxReqs: parseInt(env("RATE_LIMIT_MAX_REQUESTS", "100"), 10),

  // Logging / sitio
  logLevel: env("LOG_LEVEL", "info"),
  siteUrl: env("SITE_URL", "http://localhost:3000"),
  siteName: env("SITE_NAME", "TecnoGamer"),

  // Backup
  backupDir: env("BACKUP_DIR", path.resolve(projectRoot, "backups")),
  backupRetention: parseInt(env("BACKUP_RETENTION_DAYS", "30"), 10),
};

module.exports = config;
module.exports.config = config;
