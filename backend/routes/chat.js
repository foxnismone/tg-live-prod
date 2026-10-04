/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Rutas de Chat / Ventas
 * ============================================================
 * Endpoints:
 *   GET    /api/v1/chat/sessions              → Sesiones activas
 *   POST   /api/v1/chat/sessions              → Crear nueva sesión
 *   GET    /api/v1/chat/sessions/:sessionId   → Mensajes de sesión
 *   POST   /api/v1/chat/sessions/:sessionId   → Enviar mensaje
 *   POST   /api/v1/chat/sessions/:sessionId/close → Cerrar sesión
 *   POST   /api/v1/chat/webhook/whatsapp     → Webhook WhatsApp (incoming)
 *   GET    /api/v1/chat/webhook/whatsapp     → Verify WhatsApp webhook
 *   POST   /api/v1/chat/send-message          → Enviar mensaje externo (admin)
 *   GET    /api/v1/chat/config                → Configuración de chat
 * ============================================================
 * 
 * Chat de ventas integrado:
 *   - Chat web en frontend (WebSocket emulado via polling)
 *   - WhatsApp Business API (Meta)
 *   - Bot de respuesta automática con catálogo en línea
 *   - Asignación a administradores
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
} = require("../middleware/errorHandler");
const { body, query } = require("express-validator");

const router = express.Router();

// ─── Verificar si chat está habilitado ──────────────────────
function isChatEnabled() {
  return process.env.CHAT_WEB_ENABLED !== "false";
}

function isWhatsappEnabled() {
  return process.env.WHATSAPP_ENABLED === "true";
}

// ─── GET /api/v1/chat/sessions — Sesiones activas ──────────
router.get("/sessions", authenticateToken, sanitize, (req, res) => {
  try {
    const userId = req.user.userId;
    const role = req.user.role;
    const status = req.query.status || "active";

    let sessions;
    if (role === "admin") {
      // Admin ve todas
      sessions = db.prepare(
        `SELECT cs.*, u.email as user_email, u.name as user_name,
                (SELECT COUNT(*) FROM chat_messages cm WHERE cm.session_id = cs.session_id AND cm.is_read = 0 AND cm.sender = 'customer') as unread_count,
                (SELECT message FROM chat_messages WHERE session_id = cs.session_id ORDER BY created_at DESC LIMIT 1) as last_message,
                carts.items as cart_snapshot
         FROM chat_sessions cs
         LEFT JOIN users u ON cs.user_id = u.id
         LEFT JOIN carts ON cs.cart_id = carts.id
         WHERE cs.status = ?
         ORDER BY cs.last_message_at DESC
         LIMIT 100`
      ).all(status);
    } else {
      // Usuario solo ve sus sesiones
      sessions = db.prepare(
        `SELECT cs.*, u.email as user_email, u.name as user_name,
                (SELECT COUNT(*) FROM chat_messages cm WHERE cm.session_id = cs.session_id AND cm.is_read = 0 AND cm.sender = 'customer') as unread_count,
                (SELECT message FROM chat_messages WHERE session_id = cs.session_id ORDER BY created_at DESC LIMIT 1) as last_message
         FROM chat_sessions cs
         LEFT JOIN users u ON cs.user_id = u.id
         WHERE cs.user_id = ? AND cs.status = ?
         ORDER BY cs.last_message_at DESC`
      ).all(userId, status);
    }

    res.json({
      sessions: sessions.map(s => ({
        id: s.id,
        sessionId: s.session_id,
        userId: s.user_id,
        userEmail: s.user_email,
        userName: s.user_name,
        phone: s.phone,
        cartId: s.cart_id,
        status: s.status,
        lastMessageAt: s.last_message_at,
        lastMessage: s.last_message,
        unreadCount: s.unread_count || 0,
        cartSnapshot: s.cart_snapshot ? JSON.parse(s.cart_snapshot) : null,
        createdAt: s.created_at,
      })),
    });
  } catch (err) {
    console.error("Error en GET /chat/sessions:", err);
    res.status(500).json({ error: "Error", code: "CHAT_ERROR" });
  }
});

// ─── POST /api/v1/chat/sessions — Crear sesión ─────────────
router.post("/sessions", optionalAuth, sanitize, [
  body("sessionId").optional().trim().isLength({ min: 4, max: 64 }),
  body("customerEmail").optional().isEmail().normalizeEmail(),
  body("customerName").optional().trim().isLength({ min: 1, max: 100 }),
  body("phone").optional().trim().isLength({ max: 20 }),
  validate,
], (req, res) => {
  try {
    const { sessionId: customSessionId, customerEmail, customerName, phone } = req.body;
    const userId = req.user ? req.user.userId : null;

    // Generar session_id único si no se proporciona
    const finalSessionId = customSessionId || `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Verificar que no exista
    const existing = db.prepare("SELECT id FROM chat_sessions WHERE session_id = ?").get(finalSessionId);
    if (existing) {
      return res.status(409).json({ error: "Session ID ya existe", code: "SESSION_EXISTS" });
    }

    // Obtener carrito del usuario si existe
    let cartId = null;
    if (customerEmail) {
      const user = db.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'").get(customerEmail);
      if (user) {
        const cart = db.prepare("SELECT id FROM carts WHERE user_id = ?").get(user.id);
        if (cart) cartId = cart.id;
      }
    }

    const result = db.prepare(
      `INSERT INTO chat_sessions (session_id, user_id, customer_email, customer_name, phone, cart_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`
    ).run(
      finalSessionId,
      userId || null,
      customerEmail || null,
      customerName || null,
      phone || null,
      cartId,
    );

    // Mensaje de bienvenida automática
    const welcomeMsg = process.env.CHAT_WEB_GREET_MESSAGE ||
      "¡Hola! 👋 Soy el asistente de ventas. ¿En qué puedo ayudarte hoy?";

    db.prepare(
      `INSERT INTO chat_messages (session_id, sender, message, is_read)
       VALUES (?, 'bot', ?, 1)`
    ).run(finalSessionId, welcomeMsg);

    // Actualizar last_message_at
    db.prepare("UPDATE chat_sessions SET last_message_at = datetime('now') WHERE id = ?").run(result.lastInsertRowid);

    res.status(201).json({
      message: "Sesión de chat creada",
      session: {
        id: result.lastInsertRowid,
        sessionId: finalSessionId,
        customerEmail,
        customerName,
        phone,
        cartId,
        status: "active",
      },
    });
  } catch (err) {
    console.error("Error en POST /chat/sessions:", err);
    res.status(500).json({ error: "Error al crear sesión", code: "SESSION_ERROR" });
  }
});

// ─── GET /api/v1/chat/sessions/:sessionId — Mensajes ───────
router.get("/sessions/:sessionId", optionalAuth, sanitize, (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user ? req.user.userId : null;
    const role = req.user ? req.user.role : "guest";

    const session = db.prepare("SELECT * FROM chat_sessions WHERE session_id = ?").get(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sesión no encontrada", code: "NOT_FOUND" });
    }

    // Control de acceso:
    //  - admin: acceso a cualquier sesión
    //  - cliente autenticado: solo sus propias sesiones
    //  - invitado (sin token): puede leer su propia sesión de invitado,
    //    que se identifica porque no está asociada a ningún usuario.
    const isOwner = userId != null && session.user_id === userId;
    const isGuestOwn = userId == null && session.user_id == null;
    if (role !== "admin" && !isOwner && !isGuestOwn) {
      return res.status(403).json({ error: "No tienes acceso a esta sesión", code: "FORBIDDEN" });
    }

    // Marcar mensajes del customer como leídos (solo admin puede marcar como leído)
    if (role === "admin") {
      db.prepare(
        "UPDATE chat_messages SET is_read = 1 WHERE session_id = ? AND sender = 'customer' AND is_read = 0"
      ).run(sessionId);
    }

    const messages = db.prepare(
      `SELECT cm.*, u.name as sender_name, u.avatar_url as sender_avatar
       FROM chat_messages cm
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE cm.session_id = ?
       ORDER BY cm.created_at ASC`
    ).all(sessionId);

    res.json({
      session: {
        id: session.id,
        sessionId: session.session_id,
        customerEmail: session.customer_email,
        customerName: session.customer_name,
        phone: session.phone,
        status: session.status,
        createdAt: session.created_at,
      },
      messages: messages.map(m => ({
        id: m.id,
        sender: m.sender,
        message: m.message,
        attachments: m.attachments ? JSON.parse(m.attachments) : [],
        isRead: m.is_read === 1,
        senderName: m.sender_name,
        senderAvatar: m.sender_avatar,
        createdAt: m.created_at,
      })),
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Error", code: "CHAT_ERROR" });
  }
});

// ─── POST /api/v1/chat/sessions/:sessionId — Enviar mensaje ─
router.post("/sessions/:sessionId", optionalAuth, sanitize, [
  body("message").trim().isLength({ min: 1, max: 5000 }).withMessage("message requerido (1-5000 caracteres)"),
  body("attachments").optional().isArray(),
  body("sender").optional().isIn(["customer", "admin", "bot"]),
  validate,
], (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message, attachments = [], sender = "customer" } = req.body;
    const userId = req.user ? req.user.userId : null;
    const userRole = req.user ? req.user.role : "guest";

    const session = db.prepare("SELECT * FROM chat_sessions WHERE session_id = ?").get(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sesión no encontrada", code: "NOT_FOUND" });
    }

    // Determinar sender basado en rol
    const finalSender = userRole === "admin" ? "admin" : sender;

    // Insertar mensaje
    const result = db.prepare(
      `INSERT INTO chat_messages (session_id, user_id, sender, message, attachments, is_read)
       VALUES (?, ?, ?, ?, ?, 0)`
    ).run(
      sessionId,
      userId,
      finalSender,
      message,
      JSON.stringify(attachments),
    );

    // Actualizar last_message_at de la sesión
    db.prepare("UPDATE chat_sessions SET last_message_at = datetime('now') WHERE id = ?").run(session.id);
    if (finalSender === "customer") {
      db.prepare("UPDATE chat_sessions SET status = 'active' WHERE id = ?").run(session.id);
    }

    // Respuesta automática del bot (si está habilitado)
    let botReply = null;
    if (isChatEnabled() && finalSender === "customer") {
      botReply = generateBotReply(message, session, req);
      if (botReply) {
        setTimeout(() => {
          db.prepare(
            `INSERT INTO chat_messages (session_id, sender, message, is_read)
             VALUES (?, 'bot', ?, 1)`
          ).run(sessionId, botReply);
          db.prepare("UPDATE chat_sessions SET last_message_at = datetime('now') WHERE id = ?").run(session.id);
        }, 500 + Math.random() * 1500); // Simular "escribiendo..."
      }
    }

    res.status(201).json({
      message: "Mensaje enviado",
      messageData: {
        id: result.lastInsertRowid,
        sender: finalSender,
        message,
        attachments,
        createdAt: new Date().toISOString(),
      },
      botReply,
    });
  } catch (err) {
    console.error("Error al enviar mensaje:", err);
    res.status(500).json({ error: "Error", code: "SEND_MESSAGE_ERROR" });
  }
});

// ─── POST /api/v1/chat/sessions/:sessionId/close — Cerrar ──
router.post("/sessions/:sessionId/close", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = db.prepare("SELECT * FROM chat_sessions WHERE session_id = ?").get(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sesión no encontrada", code: "NOT_FOUND" });
    }

    db.prepare("UPDATE chat_sessions SET status = 'closed', updated_at = datetime('now') WHERE id = ?")
      .run(session.id);

    // Mensaje de cierre
    db.prepare(
      `INSERT INTO chat_messages (session_id, sender, message, is_read)
       VALUES (?, 'bot', ?, 1)`
    ).run(sessionId, "Gracias por contactarnos. Tu sesión ha sido cerrada. Si necesitas algo más, no dudes en abrir una nueva conversación. 😊");

    res.json({ message: "Sesión cerrada", sessionId });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Error", code: "CLOSE_ERROR" });
  }
});

// ─── POST /api/v1/chat/send-message (enviar como admin) ────
router.post("/send-message", authenticateToken, requireRole("admin"), sanitize, [
  body("sessionId").trim().isLength({ min: 4 }),
  body("message").trim().isLength({ min: 1, max: 5000 }),
  body("attachments").optional().isArray(),
  validate,
], (req, res) => {
  try {
    const { sessionId, message, attachments = [] } = req.body;

    const session = db.prepare("SELECT * FROM chat_sessions WHERE session_id = ?").get(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sesión no encontrada", code: "NOT_FOUND" });
    }

    db.prepare(
      `INSERT INTO chat_messages (session_id, user_id, sender, message, attachments, is_read)
       VALUES (?, ?, 'admin', ?, ?, ?)`
    ).run(sessionId, session.user_id, message, JSON.stringify(attachments), 0);

    db.prepare("UPDATE chat_sessions SET last_message_at = datetime('now') WHERE id = ?").run(session.id);

    res.status(201).json({ message: "Mensaje enviado como administrador" });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Error", code: "SEND_ERROR" });
  }
});

// ─── GET /api/v1/chat/config — Configuración ────────────────
router.get("/config", (req, res) => {
  res.json({
    chat: {
      webEnabled: isChatEnabled(),
      whatsappEnabled: isWhatsappEnabled(),
      greetMessage: process.env.CHAT_WEB_GREET_MESSAGE || "¡Hola! 👋 ¿En qué puedo ayudarte?",
      supportUrl: process.env.CHAT_WEB_SUPPORT_URL || null,
      whatsappPhone: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    },
  });
});

// ─── GET /api/v1/chat/webhook/whatsapp — Verify webhook ───
router.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("✅ WhatsApp webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── POST /api/v1/chat/webhook/whatsapp — Recibir mensaje ──
router.post("/webhook/whatsapp", (req, res) => {
  try {
    if (!isWhatsappEnabled()) {
      console.log("⚠ WhatsApp webhook recibido pero deshabilitado");
      return res.sendStatus(200);
    }

    const body = req.body;
    console.log("📱 WhatsApp webhook received:", JSON.stringify(body).substring(0, 200));

    // Verificar que sea un evento de mensaje
    if (body.object !== "whatsapp_business_account") {
      return res.sendStatus(200);
    }

    // Procesar cada entry
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value.messages) continue;

        for (const message of value.messages) {
          const from = message.from; // número de WhatsApp del cliente
          const msgType = message.type;
          let msgText = null;

          if (msgType === "text" && message.text) {
            msgText = message.text.body;
          } else if (msgType === "image" && message.image) {
            msgText = `[Imagen recibida: ${message.image.caption || "sin descripción"}]`;
          } else if (msgType === "interactive") {
            msgText = message.interactive?.button_reply?.text || "Interacción";
          }

          if (msgText) {
            // Buscar o crear sesión de chat basada en número de teléfono
            const session = db.prepare(
              `SELECT id FROM chat_sessions WHERE phone = ? AND status != 'closed'`
            ).get(from);

            let sessionId;
            if (session) {
              sessionId = session.session_id;
            } else {
              // Crear nueva sesión
              const newSession = db.prepare(
                `INSERT INTO chat_sessions (session_id, customer_email, customer_name, phone, status)
                 VALUES (?, null, null, ?, 'active')`
              ).run(`whatsapp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, from);
              sessionId = newSession.lastInsertRowid;
            }

            // Guardar mensaje del cliente
            db.prepare(
              `INSERT INTO chat_messages (session_id, sender, message, is_read)
               VALUES (?, 'customer', ?, 0)`
            ).run(sessionId, msgText);

            db.prepare("UPDATE chat_sessions SET last_message_at = datetime('now') WHERE id = ?")
              .run(sessionId);

            // Respuesta automática del bot
            const botReply = generateBotReply(msgText, { session_id: sessionId, phone: from }, { from });

            if (botReply) {
              // Enviar respuesta por WhatsApp (en producción, usarWhatsApp API)
              // Por ahora solo guardar como mensaje del bot
              db.prepare(
                `INSERT INTO chat_messages (session_id, sender, message, is_read)
                 VALUES (?, 'bot', ?, 1)`
              ).run(sessionId, botReply);

              console.log(`🤖 WhatsApp Bot reply to ${from}: ${botReply}`);
            }
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error en WhatsApp webhook:", err);
    res.sendStatus(200); // Siempre responder 200 para no reintentar
  }
});

// ─── Helper: Generar respuesta automática del bot ────────────
function generateBotReply(message, session, ctx) {
  const lowerMsg = message.toLowerCase().trim();

  // Saludos
  if (/hola|buenas|hey|hi|hello|buenos días|buenas tardes|buenas noches/g.test(lowerMsg)) {
    const greetings = [
      "¡Hola! 👋 Bienvenido a nuestra tienda. ¿En qué puedo ayudarte hoy?",
      "¡Hola! 🎉 Gracias por contactarnos. Estoy aquí para ayudarte con tus compras.",
      "¡Hola! 😊 Soy el asistente virtual. Pregúntame sobre productos, precios o disponibilidad.",
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  // Saludo de despedida
  if (/chao|adios|bye|until|nos vemos|hasta luego/g.test(lowerMsg)) {
    const farewells = [
      "¡Chau! 👋 Que tengas un excelente día. Vuelve cuando quieras!",
      "¡Hasta luego! 😊 Gracias por escribirnos. ¡Visita nuestra tienda en línea!",
    ];
    return farewells[Math.floor(Math.random() * farewells.length)];
  }

  // Consulta de productos
  if (/producto|buscar|quieres|tienes|tengo|mostrarme|ver productos|qué productos|catalog/g.test(lowerMsg)) {
    // Listar algunos productos destacados
    const products = db.prepare(
      "SELECT id, name, price, stock_quantity, stock_status, is_featured FROM products WHERE is_active = 1 ORDER BY is_featured DESC, total_sales DESC LIMIT 5"
    ).all();

    if (products.length === 0) {
      return "Aún no tenemos productos en la tienda. Vuelve más tarde, por favor. 🙏";
    }

    let reply = "📦 Estos son algunos de nuestros productos destacados:\n\n";
    products.slice(0, 3).forEach((p, i) => {
      const stockLabel = p.stock_status === "out_of_stock" ? "❌ Agotado" : p.stock_quantity < 10 ? `⚠️ Solo ${p.stock_quantity} unidades` : `✅ ${p.stock_quantity} en stock`;
      reply += `${i + 1}. **${p.name}** — $${p.price.toFixed(2)}\n   ${stockLabel}\n\n`;
    });

    reply += "Escribe el número del producto para más detalles, o dime qué categoría te interesa. 😊";
    return reply;
  }

  // Consulta de stock
  if (/stock|disponible|hay|cuántas|cuantas|unidades|cantidad|agotado|out of stock/g.test(lowerMsg)) {
    // Intentar extraer nombre o número
    const productNumMatch = lowerMsg.match(/(\d+)/);
    if (productNumMatch) {
      const num = parseInt(productNumMatch[1]);
      const products = db.prepare(
        "SELECT id, name, price, stock_quantity, stock_status FROM products WHERE is_active = 1 ORDER BY is_featured DESC LIMIT 20"
      ).all();
      const product = products[num - 1];
      if (product) {
        const status = product.stock_status === "out_of_stock" ? "❌ Agotado" :
          product.stock_quantity < 10 ? `⚠️ Stock bajo: ${product.stock_quantity} uds` :
          `✅ En stock: ${product.stock_quantity} uds`;
        return `📦 **${product.name}** — $${product.price.toFixed(2)}\n${status}`;
      }
    }

    return "Para consultar stock de un producto específico, dime el nombre o número del producto. 😊";
  }

  // Precios
  if (/precio|costo|cuánto|cuanto|cuanto cuesta|precio|gasto|gasto|valor|valor|dolar|pesos|euros/g.test(lowerMsg)) {
    const productNumMatch = lowerMsg.match(/(\d+)/);
    if (productNumMatch) {
      const num = parseInt(productNumMatch[1]);
      const products = db.prepare(
        "SELECT id, name, price, stock_quantity FROM products WHERE is_active = 1 ORDER BY is_featured DESC LIMIT 20"
      ).all();
      const product = products[num - 1];
      if (product) {
        return `💰 **${product.name}** — Precio: $${product.price.toFixed(2)} FA\nStock: ${product.stock_quantity} unidades disponibles`;
      }
    }

    // Mostrar productos con precios
    const products = db.prepare(
      "SELECT id, name, price, stock_quantity, stock_status FROM products WHERE is_active = 1 AND price > 0 ORDER BY price ASC LIMIT 10"
    ).all();

    if (products.length === 0) return "No tenemos productos con precio actualmente.";

    let reply = "💰 Nuestros productos y precios:\n\n";
    products.slice(0, 5).forEach((p, i) => {
      reply += `${i + 1}. ${p.name} — **$${p.price.toFixed(2)}**\n`;
    });
    reply += "\nEscribe el número para más detalles o para comprar. 🛒";
    return reply;
  }

  // Ayuda
  if (/ayuda|como|how|que puedes|que puedes hacer|que haces|q|q\?|help|ayudame|ayúdame/g.test(lowerMsg)) {
    return `🆘 **Cómo puedo ayudarte:**

1. **Ver productos** — Escribe "productos" o "catálogo"
2. **Consultar stock** — Escribe "stock" o dime el producto
3. **Ver precios** — Escribe "precios" o el número del producto
4. **Hacer un pedido** — Agrega productos al carrito
5. **Consultar ordenes** — Si ya hiciste una compra

¿Qué te gustaría hacer hoy? 😊`;
  }

  // Pedido / comprar
  if (/comprar|pedido|orden|order|carrito|cart|agregar|add|quiero comprar|make order|give me|giveme/g.test(lowerMsg)) {
    return "🛒 Para hacer un pedido, primero agrega los productos a tu carrito en nuestra web. Luego puedes completar el pago de forma segura. ¿Necesitas ayuda con algún producto en particular? 😊";
  }

  // Si no se reconoce, ofrecer ayuda
  return "🤔 No estoy seguro de haber entendido. Puedo ayudarte con:\n\n" +
    "• **Productos** — Consulta nuestro catálogo\n" +
    "• **Precios y stock** — Verifica disponibilidad\n" +
    "• **Pedidos** — Ayuda con tu compra\n" +
    "• **Ayuda general** — Cualquier duda\n\n" +
    "¿En qué puedo ayudarte? 😊";
}

module.exports = router;
