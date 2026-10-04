/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Middleware de Manejo de Errores
 * ============================================================
 */

"use strict";

// ─── Error Handler Global ────────────────────────────────────
function errorHandler(err, req, res, _next) {
  // Log del error
  const isDev = process.env.NODE_ENV !== "production";
  const timestamp = new Date().toISOString();

  if (isDev) {
    console.error(`❌ [${timestamp}] ${req.method} ${req.originalUrl}`);
    console.error("   ", err.stack || err.message);
  } else {
    // En producción, log solo lo esencial
    console.error(`❌ [${timestamp}] ${req.method} ${req.originalUrl} — ${err.message}`);
  }

  // Errores conocidos
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "JSON inválido en el cuerpo de la request",
      code: "BAD_JSON",
    });
  }

  if (err.name === "ValidationError" || err.type === "validation") {
    return res.status(400).json({
      error: "Error de validación",
      details: err.details || err.message,
      code: "VALIDATION_ERROR",
    });
  }

  // Errores de JWT
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return res.status(401).json({
      error: "Token inválido o expirado",
      code: "AUTH_ERROR",
    });
  }

  // Errores de Stripe
  if (err && err.type && err.type.startsWith("Stripe")) {
    return res.status(402).json({
      error: "Error de procesamiento de pago",
      code: "PAYMENT_ERROR",
      detail: isDev ? err.message : undefined,
    });
  }

  // Status code personalizado
  const statusCode = err.statusCode || err.status || 500;
  const code = err.code || "INTERNAL_ERROR";

  res.status(statusCode).json({
    error: isDev ? err.message : "Error interno del servidor",
    code,
    ...(isDev && { detail: err.stack || undefined }),
  });
}

// ─── 404 Handler ─────────────────────────────────────────────
function notFound(req, res) {
  res.status(404).json({
    error: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
    code: "NOT_FOUND",
  });
}

// ─── Middleware de Autenticación JWT ────────────────────────
const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      error: "Autenticación requerida",
      code: "NO_TOKEN",
    });
  }

  const config = require("../config");

  try {
    const payload = jwt.verify(token, config.jwtSecret || "fallback-secret");
    req.user = payload; // { id, email, name, role, iat, exp }
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Token expirado",
        code: "TOKEN_EXPIRED",
        retryAfter: Math.max(0, Math.floor((err.expiredAt - Date.now()) / 1000)),
      });
    }
    return res.status(401).json({
      error: "Token inválido",
      code: "INVALID_TOKEN",
    });
  }
}

// ─── Middleware de Autenticación OPCIONAL ───────────────────
// Para carrito de invitado (guest checkout): si hay token válido lo usa,
// si no, deja pasar y las rutas trabajan con sessionId.
function optionalAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) { req.user = null; return next(); }
  try {
    const config = require("../config");
    req.user = jwt.verify(token, config.jwtSecret || "fallback-secret");
  } catch (_) {
    req.user = null;
  }
  next();
}

// ─── Middleware de Autorización por Rol ──────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Autenticación requerida", code: "NO_AUTH" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "No tienes permisos para esta acción",
        code: "FORBIDDEN",
        requiredRoles: roles,
        yourRole: req.user.role,
      });
    }
    next();
  };
}

// ─── Middleware de Validación ────────────────────────────────
const { body, param, query, validationResult } = require("express-validator");

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Error de validación",
      code: "VALIDATION_ERROR",
      details: errors.array().map(e => ({
        field: e.path,
        message: e.msg,
        value: e.value,
      })),
    });
  }
  next();
}

// ─── Middleware de Limpieza de Inputs ────────────────────────
function sanitize(req, res, next) {
  // Sanitizar inputs básicos en query params y body
  if (req.body) {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === "string") {
        req.body[key] = req.body[key].trim().replace(/<[^>]*>/g, ""); // eliminar HTML tags
      }
    }
  }
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      if (typeof req.query[key] === "string") {
        req.query[key] = req.query[key].trim().replace(/<[^>]*>/g, "");
      }
    }
  }
  next();
}

// ─── Middleware de Logging de Auditoría ──────────────────────
const db = require("../config/database");
const auditLog = (action, entityType = null, entityId = null) => {
  return (req, res, next) => {
    // Ejecutar al finalizar la respuesta
    res.on("finish", () => {
      try {
        const detail = {
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          userAgent: req.get("user-agent") || null,
          ip: req.ip || req.connection?.remoteAddress || null,
          duration: null, // se puede medir si se hookea
        };

        db.prepare(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          req.user?.id || null,
          action,
          entityType,
          entityId,
          JSON.stringify(detail),
          detail.ip,
          detail.userAgent
        );
      } catch (_) {
        // No fallar la request por un log
      }
    });
    next();
  };
};

module.exports = {
  errorHandler,
  notFound,
  authenticateToken,
  optionalAuth,
  requireRole,
  validate,
  sanitize,
  auditLog,
  validationResult, // export directo para uso en rutas
};
