/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Rutas de Autenticación
 * ============================================================
 * Endpoints:
 *   POST   /api/v1/auth/register        → Crear cuenta usuario
 *   POST   /api/v1/auth/login          → Login → access + refresh token
 *   POST   /api/v1/auth/refresh        → Renovar access token
 *   POST   /api/v1/auth/logout         → Invalidar refresh token
 *   GET    /api/v1/auth/me             → Perfil del usuario autenticado
 *   PUT    /api/v1/auth/profile        → Actualizar perfil
 *   PUT    /api/v1/auth/password       → Cambiar contraseña
 *   POST   /api/v1/auth/forgot-password → Request de reset
 *   POST   /api/v1/auth/reset-password  → Reset con token
 *   POST   /api/v1/auth/verify-email   → Verificar email
 * ============================================================
 */

"use strict";

const express       = require("express");
const bcrypt        = require("bcryptjs");
const jwt           = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const db            = require("../config/database");
const { authenticateToken, validate, sanitize } = require("../middleware/errorHandler");
const { auditLog } = require("../middleware/errorHandler");

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────
const jwtSecret = process.env.JWT_SECRET;
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "7d";
const jwtRefreshExp = process.env.JWT_REFRESH_EXPIRES_IN || "30d";

const crypto = require("crypto");

function generateTokens(userId, email, name, role) {
  // `jti` (JWT ID) único por token. Sin él, dos inicios de sesión dentro del
  // mismo segundo producen exactamente el mismo JWT (mismos claims + mismo
  // `iat`), lo que viola la restricción UNIQUE de auth_tokens.token y hace
  // fallar el login con un 500 intermitente.
  const jti = () => crypto.randomBytes(16).toString("hex");

  const accessToken = jwt.sign(
    { userId, email, name, role, type: "access", jti: jti() },
    jwtSecret,
    { expiresIn: jwtExpiresIn }
  );

  const refreshToken = jwt.sign(
    { userId, email, type: "refresh", jti: jti() },
    jwtSecret,
    { expiresIn: jwtRefreshExp }
  );

  return { accessToken, refreshToken };
}

function storeRefreshToken(userId, refreshToken, ip, userAgent) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 días

  // Invalidar tokens anteriores del usuario
  db.prepare("UPDATE auth_tokens SET used = 1 WHERE user_id = ? AND type = 'refresh' AND used = 0")
    .run(userId);

  db.prepare(
    `INSERT INTO auth_tokens (user_id, token, type, expires_at, ip_address, user_agent)
     VALUES (?, ?, 'refresh', ?, ?, ?)`
  ).run(userId, refreshToken, expiresAt.toISOString(), ip, userAgent);
}

function sendJsonResponse(res, statusCode, data) {
  res.status(statusCode).json(data);
}

// ─── POST /api/v1/auth/register — Crear cuenta ─────────────
router.post("/register", sanitize, [
  body("email").isEmail().normalizeEmail().withMessage("Email inválido"),
  body("password")
    .isLength({ min: 8 })
    .withMessage("La contraseña debe tener al menos 8 caracteres")
    .matches(/[A-Z]/)
    .withMessage("Debe contener al menos una mayúscula")
    .matches(/[a-z]/)
    .withMessage("Debe contener al menos una minúscula")
    .matches(/[0-9]/)
    .withMessage("Debe contener al menos un número"),
  body("name").trim().isLength({ min: 2, max: 100 }).withMessage("Nombre inválido (2-100 caracteres)"),
  validate,
], async (req, res) => {
  try {
    const { email, password, name, phone } = req.body;

    // Verificar si email ya existe
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return sendJsonResponse(res, 409, {
        error: "Este email ya está registrado",
        code: "EMAIL_EXISTS",
      });
    }

    // Hash de contraseña
    const passwordHash = await bcrypt.hash(password, 12);

    // Crear usuario
    const result = db.prepare(
      `INSERT INTO users (email, password_hash, name, phone, status, role)
       VALUES (?, ?, ?, ?, 'active', 'customer')`
    ).run(email, passwordHash, name, phone || null);

    // Crear carrito vacío para el usuario
    db.prepare(
      `INSERT INTO carts (user_id, session_id, items, subtotal)
       VALUES (?, ?, '[]', 0)`
    ).run(result.lastInsertRowid, `cart-${result.lastInsertRowid}`);

    // Generar tokens
    const tokens = generateTokens(result.lastInsertRowid, email, name, "customer");
    storeRefreshToken(result.lastInsertRowid, tokens.refreshToken, req.ip, req.get("user-agent"));

    // Log de auditoría
    try {
      db.prepare(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
         VALUES (?, 'register', 'user', ?, ?)`
      ).run(result.lastInsertRowid, result.lastInsertRowid, JSON.stringify({ email }));
    } catch (_) {}

    sendJsonResponse(res, 201, {
      message: "Cuenta creada exitosamente",
      user: {
        id: result.lastInsertRowid,
        email,
        name,
        role: "customer",
        createdAt: new Date().toISOString(),
      },
      ...tokens,
    });
  } catch (err) {
    console.error("Error en register:", err);
    sendJsonResponse(res, 500, { error: "Error al crear la cuenta", code: "REGISTRATION_ERROR" });
  }
});

// ─── POST /api/v1/auth/login — Login ─────────────────────────
router.post("/login", sanitize, [
  body("email").isEmail().normalizeEmail().withMessage("Email inválido"),
  body("password").notEmpty().withMessage("Contraseña requerida"),
  body("rememberMe").optional().isBoolean(),
  validate,
], async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    const user = db.prepare(
      `SELECT id, email, password_hash, name, role, status, avatar_url, phone
       FROM users WHERE email = ? AND status = 'active'`
    ).get(email);

    if (!user) {
      // Intentar con email case-insensitive
      const userCI = db.prepare(
        `SELECT id, email, password_hash, name, role, status, avatar_url, phone
         FROM users WHERE LOWER(email) = LOWER(?) AND status = 'active'`
      ).get(email);

      if (!userCI) {
        return sendJsonResponse(res, 401, {
          error: "Email o contraseña incorrectos",
          code: "INVALID_CREDENTIALS",
        });
      }
      // Usar userCI
      if (await bcrypt.compare(password, userCI.password_hash)) {
        const tokens = generateTokens(userCI.id, userCI.email, userCI.name, userCI.role);
        storeRefreshToken(userCI.id, tokens.refreshToken, req.ip, req.get("user-agent"));

        // Actualizar last_login
        db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(userCI.id);

        sendJsonResponse(res, 200, {
          message: "Login exitoso",
          user: {
            id: userCI.id,
            email: userCI.email,
            name: userCI.name,
            role: userCI.role,
            avatarUrl: userCI.avatar_url,
            phone: userCI.phone,
          },
          ...tokens,
        });
        return;
      }
      return sendJsonResponse(res, 401, {
        error: "Email o contraseña incorrectos",
        code: "INVALID_CREDENTIALS",
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return sendJsonResponse(res, 401, {
        error: "Email o contraseña incorrectos",
        code: "INVALID_CREDENTIALS",
      });
    }

    const tokens = generateTokens(user.id, user.email, user.name, user.role);
    storeRefreshToken(user.id, tokens.refreshToken, req.ip, req.get("user-agent"));

    // Actualizar last_login
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    sendJsonResponse(res, 200, {
      message: "Login exitoso",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatarUrl: user.avatar_url,
        phone: user.phone,
      },
      ...tokens,
    });
  } catch (err) {
    console.error("Error en login:", err);
    sendJsonResponse(res, 500, { error: "Error en el login", code: "LOGIN_ERROR" });
  }
});

// ─── POST /api/v1/auth/refresh — Renovar token access ───────
router.post("/refresh", sanitize, [
  body("refreshToken").notEmpty().withMessage("Refresh token requerido"),
  validate,
], (req, res) => {
  try {
    const { refreshToken } = req.body;

    const payload = jwt.verify(refreshToken, jwtSecret);
    if (payload.type !== "refresh") {
      return sendJsonResponse(res, 401, { error: "Token inválido", code: "INVALID_TOKEN" });
    }

    const user = db.prepare(
      `SELECT id, email, name, role FROM users WHERE id = ? AND status = 'active'`
    ).get(payload.userId);

    if (!user) {
      return sendJsonResponse(res, 401, { error: "Usuario no encontrado o inactivo", code: "USER_NOT_FOUND" });
    }

    // Verificar que el token existe y no ha sido usado
    const tokenRecord = db.prepare(
      `SELECT id FROM auth_tokens WHERE token = ? AND type = 'refresh' AND used = 0 AND expires_at > datetime('now')`
    ).get(refreshToken);

    if (!tokenRecord) {
      return sendJsonResponse(res, 401, { error: "Refresh token inválido o expirado", code: "INVALID_TOKEN" });
    }

    // Generar nuevos tokens
    const tokens = generateTokens(user.id, user.email, user.name, user.role);
    storeRefreshToken(user.id, tokens.refreshToken, req.ip, req.get("user-agent"));

    sendJsonResponse(res, 200, {
      message: "Token renovado",
      ...tokens,
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return sendJsonResponse(res, 401, { error: "Refresh token expirado. Haz login de nuevo.", code: "TOKEN_EXPIRED" });
    }
    console.error("Error en refresh:", err);
    sendJsonResponse(res, 401, { error: "Error al renovar token", code: "REFRESH_ERROR" });
  }
});

// ─── POST /api/v1/auth/logout — Logout ──────────────────────
router.post("/logout", authenticateToken, sanitize, async (req, res) => {
  try {
    const { refreshToken } = req.body;

    // Invalidar token si se proporciona
    if (refreshToken) {
      db.prepare("UPDATE auth_tokens SET used = 1 WHERE token = ?").run(refreshToken);
    }

    // Invalidar todos los refresh tokens del usuario (logout en todos los dispositivos)
    if (!refreshToken) {
      db.prepare("UPDATE auth_tokens SET used = 1 WHERE user_id = ? AND type = 'refresh'").run(req.user.userId);
    }

    sendJsonResponse(res, 200, { message: "Logout exitoso" });
  } catch (err) {
    console.error("Error en logout:", err);
    sendJsonResponse(res, 500, { error: "Error en el logout", code: "LOGOUT_ERROR" });
  }
});

// ─── GET /api/v1/auth/me — Perfil actual ────────────────────
router.get("/me", authenticateToken, (req, res) => {
  try {
    const user = db.prepare(
      `SELECT id, email, name, role, phone, avatar_url, status, last_login, created_at
       FROM users WHERE id = ?`
    ).get(req.user.userId);

    if (!user) {
      return sendJsonResponse(res, 404, { error: "Usuario no encontrado", code: "NOT_FOUND" });
    }

    // Obtener carrito del usuario
    const cart = db.prepare(
      `SELECT id, session_id, items, subtotal, updated_at
       FROM carts WHERE user_id = ?`
    ).get(req.user.userId);

    sendJsonResponse(res, 200, { user, cart });
  } catch (err) {
    console.error("Error en /me:", err);
    sendJsonResponse(res, 500, { error: "Error al obtener perfil", code: "PROFILE_ERROR" });
  }
});

// ─── PUT /api/v1/auth/profile — Actualizar perfil ───────────
router.put("/profile", authenticateToken, sanitize, [
  body("name").optional().trim().isLength({ min: 2, max: 100 }).withMessage("Nombre inválido"),
  body("phone").optional().trim().isLength({ max: 20 }).withMessage("Teléfono inválido"),
  body("avatarUrl").optional().isURL().withMessage("URL de avatar inválida"),
  validate,
], (req, res) => {
  try {
    const { name, phone, avatarUrl } = req.body;
    const userId = req.user.userId;

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push("name = ?");
      values.push(name);
    }
    if (phone !== undefined) {
      updates.push("phone = ?");
      values.push(phone);
    }
    if (avatarUrl !== undefined) {
      updates.push("avatar_url = ?");
      values.push(avatarUrl);
    }
    updates.push("updated_at = datetime('now')");
    values.push(userId);

    db.prepare(
      `UPDATE users SET ${updates.join(", ")} WHERE id = ?`
    ).run(...values);

    const updatedUser = db.prepare(
      `SELECT id, email, name, role, phone, avatar_url, status, created_at
       FROM users WHERE id = ?`
    ).get(userId);

    sendJsonResponse(res, 200, {
      message: "Perfil actualizado",
      user: updatedUser,
    });
  } catch (err) {
    console.error("Error al actualizar perfil:", err);
    sendJsonResponse(res, 500, { error: "Error al actualizar perfil", code: "UPDATE_ERROR" });
  }
});

// ─── PUT /api/v1/auth/password — Cambiar contraseña ─────────
router.put("/password", authenticateToken, sanitize, [
  body("currentPassword").notEmpty().withMessage("Contraseña actual requerida"),
  body("newPassword")
    .isLength({ min: 8 })
    .withMessage("La nueva contraseña debe tener al menos 8 caracteres")
    .matches(/[A-Z]/)
    .withMessage("Debe contener al menos una mayúscula")
    .matches(/[a-z]/)
    .withMessage("Debe contener al menos una minúscula")
    .matches(/[0-9]/)
    .withMessage("Debe contener al menos un número"),
  validate,
], async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId);
    if (!user) {
      return sendJsonResponse(res, 404, { error: "Usuario no encontrado", code: "NOT_FOUND" });
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return sendJsonResponse(res, 400, { error: "Contraseña actual incorrecta", code: "INVALID_CURRENT_PASSWORD" });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(newHash, userId);

    // Invalidar todos los refresh tokens (obligar a login en otros dispositivos)
    db.prepare("UPDATE auth_tokens SET used = 1 WHERE user_id = ? AND type = 'refresh'").run(userId);

    sendJsonResponse(res, 200, { message: "Contraseña cambiada exitosamente" });
  } catch (err) {
    console.error("Error al cambiar contraseña:", err);
    sendJsonResponse(res, 500, { error: "Error al cambiar contraseña", code: "PASSWORD_ERROR" });
  }
});

// ─── POST /api/v1/auth/forgot-password — Request reset ──────
router.post("/forgot-password", sanitize, [
  body("email").isEmail().normalizeEmail().withMessage("Email inválido"),
  validate,
], async (req, res) => {
  // Nota: En producción, enviar email real aquí.
  // Por ahora, generar token y devolver (simulado)
  try {
    const { email } = req.body;
    const user = db.prepare("SELECT id, email, name FROM users WHERE email = ? AND status = 'active'").get(email);

    if (!user) {
      // No revelar si el email existe o no (security best practice)
      return sendJsonResponse(res, 200, {
        message: "Si el email existe, se enviará un enlace de recuperación",
      });
    }

    // Generar token de reset
    const crypto = require("crypto");
    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // 1 hora

    db.prepare(
      `INSERT INTO auth_tokens (user_id, token, type, expires_at)
       VALUES (?, ?, 'reset', ?)`
    ).run(user.id, resetToken, expiresAt.toISOString());

    // Log
    console.log(`🔑  Token de reset generado para: ${email} (usuario ID: ${user.id})`);
    console.log(`   Token: ${resetToken}`);
    console.log(`   Expires: ${expiresAt.toISOString()}`);
    console.log(`   🔗  En producción, enviar email a ${email} con enlace:`);
    console.log(`   🔗  ${process.env.SITE_URL || "https://tudominio.com"}/reset-password?token=${resetToken}`);

    sendJsonResponse(res, 200, {
      message: "Si el email existe, se enviará un enlace de recuperación",
    });
  } catch (err) {
    console.error("Error en forgot-password:", err);
    sendJsonResponse(res, 500, { error: "Error al procesar la solicitud", code: "FORGOT_ERROR" });
  }
});

// ─── POST /api/v1/auth/reset-password — Reset con token ─────
router.post("/reset-password", sanitize, [
  body("token").notEmpty().withMessage("Token requerido"),
  body("newPassword")
    .isLength({ min: 8 })
    .withMessage("La nueva contraseña debe tener al menos 8 caracteres")
    .matches(/[A-Z]/)
    .withMessage("Debe contener al menos una mayúscula")
    .matches(/[a-z]/)
    .withMessage("Debe contener al menos una minúscula")
    .matches(/[0-9]/)
    .withMessage("Debe contener al menos un número"),
  validate,
], async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const tokenRecord = db.prepare(
      `SELECT a.*, u.email, u.name FROM auth_tokens a
       JOIN users u ON a.user_id = u.id
       WHERE a.token = ? AND a.type = 'reset' AND a.used = 0 AND a.expires_at > datetime('now')`
    ).get(token);

    if (!tokenRecord) {
      return sendJsonResponse(res, 400, { error: "Token inválido, expirado o ya usado", code: "INVALID_RESET_TOKEN" });
    }

    // Hash nueva contraseña
    const newHash = await bcrypt.hash(newPassword, 12);

    // Actualizar contraseña
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
      newHash, tokenRecord.user_id
    );

    // Marcar token como usado
    db.prepare("UPDATE auth_tokens SET used = 1 WHERE id = ?").run(tokenRecord.id);

    // Invalidar todos los refresh tokens del usuario
    db.prepare("UPDATE auth_tokens SET used = 1 WHERE user_id = ? AND type = 'refresh'").run(tokenRecord.user_id);

    sendJsonResponse(res, 200, {
      message: "Contraseña restablecida exitosamente. Ahora puedes hacer login con tu nueva contraseña.",
    });
  } catch (err) {
    console.error("Error en reset-password:", err);
    sendJsonResponse(res, 500, { error: "Error al restablecer contraseña", code: "RESET_ERROR" });
  }
});

// ─── POST /api/v1/auth/verify-email — Verificar email (opcional) ──
router.post("/verify-email", sanitize, [
  body("token").notEmpty().withMessage("Token de verificación requerido"),
  validate,
], (req, res) => {
  // Implementar si se necesita verificación de email
  // Por ahora, placeholder
  sendJsonResponse(res, 501, { error: "No implementado aún", code: "NOT_IMPLEMENTED" });
});

// ─── GET /api/v1/auth/session-info — Info de sesión actual ──
router.get("/session-info", authenticateToken, (req, res) => {
  res.json({
    userId: req.user.userId,
    email: req.user.email,
    name: req.user.name,
    role: req.user.role,
    tokenType: req.user.type,
  });
});

module.exports = router;
