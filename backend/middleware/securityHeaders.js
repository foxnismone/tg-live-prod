/**
 * ============================================================
 * E-COMMERCE FULLSTACK — Seguridad Headers Middleware
 * ============================================================
 */

"use strict";

/**
 * Configura headers de seguridad adicionales que Helmet no cubre completamente
 * para nuestro caso de uso específico de e-commerce.
 */
function securityHeaders(req, res, next) {
  // Anti-clickjacking
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  // Prevenir sniffing de MIME type
  res.setHeader("X-Content-Type-Options", "nosniff");

  // XSS Protection (legacy pero útil para IE)
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Referrer Policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions Policy (formerly Feature Policy)
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );

  // Cross-Origin policies
  // COEP se omite: rompe la carga de fuentes externas (Google Fonts) y
  // recursos de terceros legítimos. COOP + CORP son suficientes y más seguros
  // que un COEP mal configurado.
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");

  // Expect-CT (Certificate Transparency)
  // res.setHeader("Expect-CT", "max-age=86400, enforce, report-uri=\"https://...\"");

  // NEL (Network Error Logging)
  // res.setHeader("NEL", JSON.stringify({ report_to: "default", max_age: 3600 }));

  // Clear-Site-Data (opcional para logout: borrar cookies + storage del cliente)
  // res.setHeader("Clear-Site-Data", '"cache", "cookies", "storage"');

  next();
}

/**
 * Genera una política CSP personalizada basada en lo que la página necesita.
 * Útil para entregar HTML con CSP inline.
 */
function generateCSP(opts = {}) {
  const {
    withStripe = false,
    withWhatsApp = false,
    withOpenAI = false,
    withGoogleFonts = false,
    withAnalytics = false,
  } = opts;

  const directives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    frameSrc: ["'self'"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    formAction: ["'self'"],
    baseUri: ["'self'"],
    frameAncestors: ["'self'"],
    upgradeInsecureRequests: [],
  };

  if (withStripe) {
    directives.scriptSrc.push("https://js.stripe.com");
    directives.connectSrc.push("https://api.stripe.com");
    directives.frameSrc.push("https://js.stripe.com");
  }

  if (withWhatsApp) {
    directives.scriptSrc.push("https://*.whatsapp.com", "https://connect.facebook.net");
    directives.connectSrc.push("https://graph.facebook.com", "https://whatsapp.com");
  }

  if (withOpenAI) {
    directives.connectSrc.push("https://api.openai.com");
  }

  if (withGoogleFonts) {
    directives.fontSrc.push("https://fonts.gstatic.com");
    directives.styleSrc.push("https://fonts.googleapis.com");
  }

  if (withAnalytics) {
    directives.scriptSrc.push("https://www.google-analytics.com", "https://ssl.google-analytics.com");
    directives.connectSrc.push("https://www.google-analytics.com");
  }

  return directives;
}

/**
 * Convierte las directivas CSP a string para header
 */
function cspDirectivesToString(directives) {
  return Object.entries(directives)
    .map(([key, values]) => {
      const directiveName = key.replace(/([A-Z])/g, "-$1").toLowerCase();
      if (values.length === 0) return directiveName;
      return `${directiveName} ${values.join(" ")}`;
    })
    .join("; ");
}

module.exports = {
  securityHeaders,
  generateCSP,
  cspDirectivesToString,
};
