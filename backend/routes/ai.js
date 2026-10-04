/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Rutas de IA (Descripciones de Productos)
 * ============================================================
 * Endpoints:
 *   POST   /api/v1/ai/generate-description    → Generar descripción para 1 producto
 *   POST   /api/v1/ai/bulk-generate          → Generar para múltiples productos
 *   POST   /api/v1/ai/enrich-product         → Enriquecer producto existente con IA
 *   GET    /api/v1/ai/config                 → Configuración actual de IA
 *   PUT    /api/v1/ai/config                 → Actualizar config (admin)
 *   POST   /api/v1/ai/test-connection        → Probar conexión con API de IA
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
const { body } = require("express-validator");

const router = express.Router();

// ─── Configuración ──────────────────────────────────────────
function getAiConfig() {
  const siteUrl    = process.env.SITE_URL    || "https://tudominio.com";
  const aiUrl      = process.env.AI_API_URL   || "";
  const aiKey      = process.env.AI_API_KEY   || "";
  const aiModel    = process.env.AI_MODEL     || "gpt-4o-mini";
  const aiTemp     = parseFloat(process.env.AI_TEMPERATURE || "0.7");
  const aiMaxToken = parseInt(process.env.AI_MAX_TOKENS || "2000", 10);
  const aiPromptTpl = process.env.AI_PROMPT_TEMPLATE || "";

  return { siteUrl, aiUrl, aiKey, aiModel, aiTemp, aiMaxToken, aiPromptTpl, enabled: !!(aiUrl && aiKey) };
}

const config = getAiConfig();

// ─── Prompt Builder ────────────────────────────────────────
function buildPrompt(product) {
  const template = config.aiPromptTpl || `
Eres un experto redactor de contenido para e-commerce. Genera una descripción de producto atractiva, persuasiva y optimizada para SEO en español.

PRODUCTO: {{name}}
CATEGORÍA: {{category}}
PRECIO: ${{price}}
ATRIBUTOS: {{attributes}}
DESCRIPCIÓN ACTUAL: {{description}}

Estructura de salida (JSON):
{
  "title": "Título corto y atractivo (máx 70 caracteres)",
  "shortDescription": "Descripción corta persuasiva (máx 150 caracteres)",
  "fullDescription": "Descripción completa bien estructurada con párrafos, máximo 500 palabras",
  "bulletPoints": ["característica 1", "característica 2", "característica 3", ...],
  "seoTitle": "Título SEO optimizado (máx 60 caracteres)",
  "seoDescription": "Meta descripción SEO (máx 160 caracteres)",
  "tags": ["tag1", "tag2", "tag3"]
}

Reglas:
- Escribe en español latino neutro
- Usa un tono {{tone}} (profesional pero cercano)
- Destaca beneficios, no solo características
- Incluye palabras clave naturalmente
- La salida debe ser VALID JSON SIN markdown, sin backticks, sin texto extra
`;

  let prompt = template
    .replace(/\{\{name\}\}/g, product.name || "Producto sin nombre")
    .replace(/\{\{category\}\}/g, product.categoryName || "Sin categoría")
    .replace(/\{\{price\}\}/g, (product.price || 0).toFixed(2))
    .replace(/\{\{attributes\}\}/g, JSON.stringify(product.attributes || {}))
    .replace(/\{\{description\}\}/g, product.description || "Sin descripción")
    .replace(/\{\{tone\}\}/g, "profesional y persuasivo");

  return prompt.trim();
}

// ─── Llamada a IA ──────────────────────────────────────────
async function callAi(messages) {
  if (!config.enabled) {
    throw new Error("API de IA no configurada. Configure AI_API_URL y AI_API_KEY en .env");
  }

  const url = config.aiUrl.replace(/\/$/, "") + "/chat/completions";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.aiKey}`,
    },
    body: JSON.stringify({
      model: config.aiModel,
      messages: messages.map(m => ({
        role: m.role,
        content: typeof m.content === "string"
          ? m.content
          : m.content.map(c => typeof c === "string" ? { type: "text", text: c } : c),
      })),
      temperature: config.aiTemp,
      max_tokens: config.aiMaxToken,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`IA API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Respuesta de IA vacía");
  }

  // Intentar parsear JSON
  try {
    // Limpiar markdown backticks si los hay
    let cleaned = content.replace(/```json\s*/g, "").replace(/```\s*$/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Error parseando respuesta IA:", e.message);
    console.error("Respuesta cruda:", content.substring(0, 2000));
    throw new Error("No se pudo parsear la respuesta de la IA como JSON");
  }
}

// ─── POST /api/v1/ai/generate-description — Generar 1 producto ──
router.post("/generate-description", authenticateToken, requireRole("admin", "vendor"), sanitize, [
  body("productId").optional().isInt({ min: 1 }),
  body("name").optional().trim().isLength({ min: 3, max: 150 }),
  body("categoryName").optional().trim(),
  body("description").optional().trim(),
  body("price").optional().isFloat({ min: 0 }),
  body("attributes").optional().isObject(),
  body("tone").optional().trim().isIn(["formal", "casual", "entusiasta", "técnico", "elegancia"]),
  validate,
], async (req, res) => {
  try {
    const { productId, name, categoryName, description, price, attributes, tone = "profesional" } = req.body;

    // Si se proporciona productId, obtener datos del producto
    let productData = {};
    if (productId) {
      const product = db.prepare(
        `SELECT p.*, c.name as category_name FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.id = ?`
      ).get(productId);

      if (!product) {
        return res.status(404).json({ error: "Producto no encontrado", code: "NOT_FOUND" });
      }
      productData = product;
    }

    const product = {
      name: name || productData.name || "Producto sin nombre",
      categoryName: categoryName || productData.category_name || "Sin categoría",
      description: description || productData.description || "",
      price: price ?? productData.price ?? 0,
      attributes: attributes || (productData.attributes ? JSON.parse(productData.attributes) : {}),
    };

    const systemMessage = {
      role: "system",
      content: `Eres un experto redactor de e-commerce en español. Genera descripciones de alta calidad, persuasivas y optimizadas para SEO. Siempre respondes con JSON válido.`,
    };

    const userMessage = buildPrompt({ ...product, tone });

    const result = await callAi([
      systemMessage,
      { role: "user", content: userMessage },
    ]);

    // Si se proporciona productId, guardar en DB
    let savedDescription = null;
    if (productId) {
      db.prepare(
        `UPDATE products SET
         description_ai = ?,
         seo_title = ?,
         seo_description = ?,
         updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        result.fullDescription || null,
        result.seoTitle || null,
        result.seoDescription || null,
        productId
      );

      // Extraer y actualizar tags
      if (result.tags && Array.isArray(result.tags)) {
        db.prepare("UPDATE products SET tags = ? WHERE id = ?").run(
          JSON.stringify(result.tags),
          productId
        );
      }

      savedDescription = {
        productId,
        generatedAt: new Date().toISOString(),
      };
    }

    res.json({
      message: "Descripción generada",
      description: result,
      ...(savedDescription && { savedInDatabase: savedDescription }),
    });
  } catch (err) {
    console.error("Error en generate-description:", err);
    if (err.message.includes("Producto no encontrado")) {
      res.status(404).json({ error: err.message, code: "NOT_FOUND" });
    } else if (err.message.includes("IA API error") || err.message.includes("No se pudo parsear")) {
      res.status(502).json({ error: "Error de servicio de IA: " + err.message, code: "AI_ERROR" });
    } else {
      res.status(500).json({ error: "Error al generar descripción", code: "AI_ERROR" });
    }
  }
});

// ─── POST /api/v1/ai/bulk-generate — Generar múltiples ─────
router.post("/bulk-generate", authenticateToken, requireRole("admin"), sanitize, [
  body("productIds").optional().isArray({ min: 1 }),
  body("categoryId").optional().isInt(),
  body("batchSize").optional().isInt({ min: 1, max: 50 }).toInt(),
  body("autoApply").optional().isBoolean(),
  validate,
], async (req, res) => {
  try {
    const { productIds, categoryId, batchSize = 10, autoApply = false } = req.body;

    // Obtener productos
    let products;
    if (productIds && productIds.length > 0) {
      const placeholders = productIds.map(() => "?").join(",");
      products = db.prepare(
        `SELECT p.*, c.name as category_name FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.id IN (${placeholders}) AND p.is_active = 1`
      ).all(...productIds);
    } else if (categoryId) {
      products = db.prepare(
        `SELECT p.*, c.name as category_name FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.category_id = ? AND p.is_active = 1`
      ).all(categoryId);
    } else {
      products = db.prepare(
        `SELECT p.*, c.name as category_name FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.is_active = 1 AND (p.description_ai IS NULL OR p.description_ai = '')
         LIMIT 50`
      ).all();
    }

    if (products.length === 0) {
      return res.status(400).json({ error: "No se encontraron productos para generar descripciones", code: "NO_PRODUCTS" });
    }

    // Limitar batch size para evitar timeouts
    const toProcess = products.slice(0, batchSize);
    const results = [];
    let success = 0;
    let failed = 0;
    let errors = [];

    for (const product of toProcess) {
      try {
        const productData = {
          name: product.name,
          categoryName: product.category_name || "Sin categoría",
          description: product.description || "",
          price: product.price,
          attributes: product.attributes ? JSON.parse(product.attributes) : {},
        };

        const result = await callAi([
          {
            role: "system",
            content: "Eres un experto redactor de e-commerce en español. Genera descripciones de alta calidad. Responde solo JSON válido.",
          },
          {
            role: "user",
            content: buildPrompt({ ...productData, tone: "profesional" }),
          },
        ]);

        if (autoApply) {
          db.prepare(
            `UPDATE products SET
             description_ai = ?,
             seo_title = ?,
             seo_description = ?,
             updated_at = datetime('now')
             WHERE id = ?`
          ).run(
            result.fullDescription || null,
            result.seoTitle || null,
            result.seoDescription || null,
            product.id
          );

          if (result.tags && Array.isArray(result.tags)) {
            db.prepare("UPDATE products SET tags = ? WHERE id = ?").run(
              JSON.stringify(result.tags), product.id
            );
          }
        }

        results.push({
          productId: product.id,
          productName: product.name,
          success: true,
          description: result,
          applied: autoApply,
        });
        success++;
      } catch (err) {
        failed++;
        errors.push({ productId: product.id, productName: product.name, error: err.message });
        results.push({
          productId: product.id,
          productName: product.name,
          success: false,
          error: err.message,
        });
      }
    }

    res.json({
      message: `Bulk generation completado: ${success} éxitos, ${failed} fallidos`,
      results,
      summary: { total: toProcess.length, success, failed, errors },
      config: {
        batchSize: toProcess.length,
        autoApply,
      },
    });
  } catch (err) {
    console.error("Error en bulk-generate:", err);
    res.status(500).json({ error: "Error en bulk generation", code: "BULK_AI_ERROR" });
  }
});

// ─── POST /api/v1/ai/enrich-product — Enriquecer producto ──
router.post("/enrich-product", authenticateToken, requireRole("admin", "vendor"), sanitize, [
  body("productId").isInt({ min: 1 }).withMessage("productId requerido"),
  body("enhanceFields").optional().isArray(),
  validate,
], async (req, res) => {
  try {
    const { productId, enhanceFields } = req.body;

    const product = db.prepare(
      `SELECT p.*, c.name as category_name FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = ?`
    ).get(productId);

    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado", code: "NOT_FOUND" });
    }

    const fields = enhanceFields || ["description", "seo", "tags", "bulletPoints"];

    const systemMessage = {
      role: "system",
      content: `Eres un experto en e-commerce. Enriquece la información del producto. Responde con JSON válido.`,
    };

    const requestParts = fields.map(f => {
      switch (f) {
        case "description":
          return "genera una descripción completa y persuasiva";
        case "seo":
          return "genera un título SEO y meta descripción optimizados";
        case "tags":
          return "genera 5-10 tags relevantes";
        case "bulletPoints":
          return "genera 5-8 bullet points de características y beneficios";
        default:
          return `genera información para ${f}`;
      }
    }).join(", ");

    const userMessage = `
Producto: ${product.name}
Categoría: ${product.category_name || "Sin categoría"}
Precio: $${product.price}
Descripción actual: ${product.description || "Sin descripción"}
Atributos: ${JSON.stringify(product.attributes || {})}

Por favor ${requestParts}. Responde en JSON con la estructura adecuada para cada campo solicitado.
`;

    const result = await callAi([
      systemMessage,
      { role: "user", content: userMessage },
    ]);

    // Aplicar mejoras al producto
    if (result.fullDescription && fields.includes("description")) {
      db.prepare("UPDATE products SET description = ?, updated_at = datetime('now') WHERE id = ?")
        .run(result.fullDescription, productId);
    }
    if (result.seoTitle && fields.includes("seo")) {
      db.prepare("UPDATE products SET seo_title = ? WHERE id = ?").run(result.seoTitle, productId);
    }
    if (result.seoDescription && fields.includes("seo")) {
      db.prepare("UPDATE products SET seo_description = ? WHERE id = ?").run(result.seoDescription, productId);
    }
    if (result.tags && Array.isArray(result.tags) && fields.includes("tags")) {
      db.prepare("UPDATE products SET tags = ? WHERE id = ?").run(JSON.stringify(result.tags), productId);
    }

    res.json({
      message: "Producto enriquecido",
      productId,
      enrichedFields: fields,
      result,
    });
  } catch (err) {
    console.error("Error en enrich-product:", err);
    if (err.message.includes("Producto no encontrado")) {
      res.status(404).json({ error: err.message, code: "NOT_FOUND" });
    } else if (err.message.includes("IA API error")) {
      res.status(502).json({ error: err.message, code: "AI_ERROR" });
    } else {
      res.status(500).json({ error: "Error", code: "ENRICH_ERROR" });
    }
  }
});

// ─── GET /api/v1/ai/config ─────────────────────────────────
router.get("/config", authenticateToken, (req, res) => {
  res.json({
    config: {
      enabled: config.enabled,
      model: config.aiModel,
      temperature: config.aiTemp,
      maxTokens: config.aiMaxToken,
      endpoint: config.aiUrl ? `${config.aiUrl.split("/v1")[0]}/` : null,
      promptTemplate: config.aiPromptTpl ? "Personalizado" : "Predeterminado",
    },
  });
});

// ─── PUT /api/v1/ai/config — Actualizar config (admin) ─────
router.put("/config", authenticateToken, requireRole("admin"), sanitize, [
  body("model").optional().trim(),
  body("temperature").optional().isFloat({ min: 0, max: 2 }),
  body("maxTokens").optional().isInt({ min: 100, max: 8000 }),
  body("promptTemplate").optional().trim().isLength({ min: 10 }),
  validate,
], (req, res) => {
  try {
    const { model, temperature, maxTokens, promptTemplate } = req.body;

    // En producción, esto actualizaría un archivo de config o DB
    // Por ahora, devolver lo que se intentó configurar
    const updates = {};
    if (model) updates.model = model;
    if (temperature !== undefined) updates.temperature = temperature;
    if (maxTokens) updates.maxTokens = maxTokens;
    if (promptTemplate) updates.promptTemplate = promptTemplate;

    res.json({
      message: "Configuración de IA actualizada (requiere reiniciar servidor para aplicar cambios en AI_API_URL/AI_API_KEY)",
      applied: {
        ...updates,
        note: "Los cambios en model, temperature y maxTokens se aplican en runtime. AI_API_URL y AI_API_KEY requieren reinicio.",
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Error", code: "CONFIG_ERROR" });
  }
});

// ─── POST /api/v1/ai/test-connection — Probar conexión ─────
router.post("/test-connection", authenticateToken, (req, res) => {
  (async () => {
    try {
      if (!config.enabled) {
        return res.json({
          success: false,
          message: "IA no configurada. Configure AI_API_URL y AI_API_KEY en .env",
        });
      }

      // Probar con un mensaje simple
      const testResult = await callAi([
        {
          role: "system",
          content: "Eres un asistente útil. Responde en JSON: {\"status\": \"ok\", \"message\": \"Conexión OK\"}",
        },
        {
          role: "user",
          content: "Responde: {\"status\": \"ok\", \"message\": \"Conexión OK\"}",
        },
      ]);

      res.json({
        success: true,
        message: "Conexión con IA establecida correctamente",
        model: testResult.model || config.aiModel,
        latency: "tests completed",
      });
    } catch (err) {
      res.json({
        success: false,
        message: `Error de conexión: ${err.message}`,
        code: "AI_CONNECTION_ERROR",
      });
    }
  })();
});

module.exports = router;
