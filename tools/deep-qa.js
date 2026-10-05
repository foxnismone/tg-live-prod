#!/usr/bin/env node
/**
 * ============================================================
 * DEEP QA — Pruebas de seguridad, rendimiento y carga
 * ============================================================
 * Suite completa de pruebas que cubre:
 *   1. OWASP API Security Top 10
 *   2. Pruebas de rendimiento (tiempo de respuesta, throughput)
 *   3. Pruebas de carga (concurrencia)
 *   4. Pruebas de integración (flujos completos)
 *   5. Pruebas de regresión (que no se rompa nada)
 *
 * Uso:  node tools/deep-qa.js [baseUrl]
 * ============================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");

const BASE = process.argv[2] || "http://localhost:3000";
const H = { "Content-Type": "application/json", "X-Load-Test": "1" };

let pass = 0, fail = 0, warn = 0;
const results = [];

function check(name, cond, detail = "", severity = "error") {
  const ok = !!cond;
  if (ok) pass++;
  else if (severity === "warn") { warn++; results.push({ name, ok, detail, severity }); console.log(`  🟡  ${name}${detail ? "  → " + String(detail).slice(0, 120) : ""}`); return ok; }
  else { fail++; results.push({ name, ok, detail, severity }); console.log(`  ❌  ${name}${detail ? "  → " + String(detail).slice(0, 120) : ""}`); return ok; }
  console.log(`  ✅  ${name}`);
  return ok;
}

async function req(method, p, { body, headers = {}, token, timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const opts = { method, headers: { ...H, ...headers }, signal: ctrl.signal };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(BASE + p, opts);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    return { status: res.status, json, text, headers: Object.fromEntries(res.headers) };
  } catch (e) {
    return { status: 0, json: null, text: e.message, headers: {} };
  } finally { clearTimeout(timer); }
}

(async () => {
  console.log(`\n🔬  DEEP QA  →  ${BASE}\n${"═".repeat(70)}`);

  /* ══ 1. OWASP API SECURITY TOP 10 ══════════════════════════ */
  console.log("\n[1] OWASP API SECURITY TOP 10");

  // A01:2025 - Broken Access Control
  console.log("\n  A01:2025 - Broken Access Control");
  let r = await req("GET", "/api/v1/admin/dashboard");
  check("Admin sin token → 401", r.status === 401, `status=${r.status}`);

  r = await req("POST", "/api/v1/products", { body: { name: "Hack", price: 1, sku: "X1", categoryId: 1 } });
  check("Crear producto sin token → 401", r.status === 401, `status=${r.status}`);

  r = await req("DELETE", "/api/v1/products/1");
  check("Eliminar producto sin token → 401", r.status === 401, `status=${r.status}`);

  // A02:2025 - Security Misconfiguration
  console.log("\n  A02:2025 - Security Misconfiguration");
  r = await req("GET", "/health");
  const h = r.headers;
  check("X-Content-Type-Options: nosniff", h["x-content-type-options"] === "nosniff", h["x-content-type-options"]);
  check("X-Frame-Options presente", !!h["x-frame-options"], h["x-frame-options"]);
  check("Content-Security-Policy presente", !!h["content-security-policy"]);
  check("Strict-Transport-Security presente", !!h["strict-transport-security"], h["strict-transport-security"]);
  check("X-Powered-By oculto", !h["x-powered-by"], h["x-powered-by"]);
  check("Referrer-Policy presente", !!h["referrer-policy"], h["referrer-policy"]);

  // A03:2025 - Software Supply Chain Failures
  console.log("\n  A03:2025 - Software Supply Chain Failures");
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  check("Dependencias definidas", Object.keys(pkg.dependencies || {}).length > 0, `${Object.keys(pkg.dependencies || {}).length} deps`);
  check("Scripts definidos", Object.keys(pkg.scripts || {}).length > 0, `${Object.keys(pkg.scripts || {}).length} scripts`);
  check("Node engine especificado", !!pkg.engines?.node, pkg.engines?.node);

  // A04:2025 - Cryptographic Failures
  console.log("\n  A04:2025 - Cryptographic Failures");
  r = await req("POST", "/api/v1/auth/login", { body: { email: "admin@tecnogamer.local", password: "Admin123!" } });
  const token = r.json?.token || r.json?.accessToken;
  check("Login devuelve token JWT", !!token, token ? "token recibido" : "sin token");
  if (token) {
    const parts = token.split(".");
    check("JWT tiene 3 partes", parts.length === 3, `${parts.length} partes`);
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
      check("JWT tiene exp", !!payload.exp, `exp=${payload.exp}`);
      check("JWT tiene iat", !!payload.iat, `iat=${payload.iat}`);
      check("JWT tiene jti", !!payload.jti, `jti=${payload.jti}`);
    } catch (e) {
      check("JWT es válido", false, e.message);
    }
  }

  // A05:2025 - Injection
  console.log("\n  A05:2025 - Injection");
  r = await req("GET", "/api/v1/products?search=" + encodeURIComponent("'; DROP TABLE products;--"));
  check("SQLi en search neutralizado", r.status === 200, `status=${r.status}`);
  r = await req("GET", "/api/v1/products");
  check("Tabla products intacta tras SQLi", (r.json?.pagination?.total || 0) > 0, `total=${r.json?.pagination?.total}`);

  r = await req("POST", "/api/v1/auth/login", { body: { email: "<script>alert(1)</script>", password: "x" } });
  check("XSS en login saneado", [400, 401].includes(r.status), `status=${r.status}`);

  // A06:2025 - Insecure Design
  console.log("\n  A06:2025 - Insecure Design");
  r = await req("GET", "/api/v1/products?limit=99999999");
  check("Limit desmesurado acotado", [200, 400].includes(r.status), `status=${r.status}`);
  r = await req("GET", "/api/v1/products?page=-1");
  check("Page negativa no da 500", r.status !== 500, `status=${r.status}`);

  // A07:2025 - Authentication Failures
  console.log("\n  A07:2025 - Authentication Failures");
  r = await req("POST", "/api/v1/auth/login", { body: { email: "admin@tecnogamer.local", password: "wrong" } });
  check("Contraseña incorrecta → 401", r.status === 401, `status=${r.status}`);
  r = await req("POST", "/api/v1/auth/login", { body: { email: "noexiste@x.com", password: "x" } });
  check("Usuario inexistente → 401", r.status === 401, `status=${r.status}`);
  r = await req("GET", "/api/v1/auth/me", { headers: { Authorization: "Bearer token.falso" } });
  check("Token falsificado → 401", r.status === 401, `status=${r.status}`);

  // A08:2025 - Software or Data Integrity Failures
  console.log("\n  A08:2025 - Software or Data Integrity Failures");
  r = await req("POST", "/api/v1/cart/items", { body: { productId: "1 OR 1=1", quantity: 1, sessionId: "test" } });
  check("Tipo malicioso en productId → 400", r.status === 400, `status=${r.status}`);

  // A09:2025 - Security Logging and Alerting Failures
  console.log("\n  A09:2025 - Security Logging and Alerting Failures");
  r = await req("GET", "/api/v1/admin/audit-logs");
  check("Audit logs accesible solo para admin", [401, 403].includes(r.status), `status=${r.status}`);

  // A10:2025 - Mishandling of Exceptional Conditions
  console.log("\n  A10:2025 - Mishandling of Exceptional Conditions");
  r = await req("POST", "/api/v1/auth/login", { body: { email: "a@b.com", password: "x".repeat(10000) } });
  check("Payload gigante no derriba el servidor", [400, 401, 413, 429].includes(r.status), `status=${r.status}`);
  r = await req("POST", "/api/v1/cart/items", { body: "no-es-json", headers: { "Content-Type": "application/json" } });
  check("Body no-JSON → 400", r.status === 400, `status=${r.status}`);

  /* ══ 2. RENDIMIENTO ════════════════════════════════════════ */
  console.log("\n[2] RENDIMIENTO");

  const perfTests = [
    ["GET /health", "/health"],
    ["GET /api/v1/products?limit=12", "/api/v1/products?limit=12"],
    ["GET /api/v1/categories", "/api/v1/categories"],
    ["GET /api/v1/products/1", "/api/v1/products/1"],
  ];

  for (const [name, endpoint] of perfTests) {
    const times = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      await req("GET", endpoint);
      times.push(Date.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    check(`${name} < 500ms (promedio)`, avg < 500, `avg=${avg.toFixed(0)}ms, max=${max}ms`, "warn");
  }

  /* ══ 3. CARGA ══════════════════════════════════════════════ */
  console.log("\n[3] CARGA");

  const concurrent = async (n, fn) => {
    const results = await Promise.all(Array.from({ length: n }, () => fn()));
    return results;
  };

  const loadTest = await concurrent(10, () => req("GET", "/api/v1/products?limit=1"));
  const successCount = loadTest.filter(r => r.status === 200).length;
  check("10 requests concurrentes → 200", successCount === 10, `${successCount}/10 exitosas`);

  const loadTest2 = await concurrent(20, () => req("GET", "/api/v1/categories"));
  const successCount2 = loadTest2.filter(r => r.status === 200).length;
  check("20 requests concurrentes → 200", successCount2 === 20, `${successCount2}/20 exitosas`);

  /* ══ 4. INTEGRACIÓN ════════════════════════════════════════ */
  console.log("\n[4] INTEGRACIÓN");

  // Flujo completo: login → ver perfil → crear producto → verlo → actualizarlo → eliminarlo
  const loginRes = await req("POST", "/api/v1/auth/login", { body: { email: "admin@tecnogamer.local", password: "Admin123!" } });
  const adminToken = loginRes.json?.token || loginRes.json?.accessToken;

  if (adminToken) {
    const meRes = await req("GET", "/api/v1/auth/me", { token: adminToken });
    check("Flujo: login → me", meRes.status === 200, `status=${meRes.status}`);

    const createRes = await req("POST", "/api/v1/products", {
      token: adminToken,
      body: { name: "Test Integración", sku: "TEST-INT-" + Date.now(), price: 1000, stockQuantity: 1, categoryId: 1 },
    });
    check("Flujo: crear producto", [200, 201].includes(createRes.status), `status=${createRes.status}`);

    const productId = createRes.json?.product?.id || createRes.json?.id;
    if (productId) {
      const getRes = await req("GET", `/api/v1/products/${productId}`);
      check("Flujo: ver producto", getRes.status === 200, `status=${getRes.status}`);

      const updateRes = await req("PUT", `/api/v1/products/${productId}`, {
        token: adminToken,
        body: { price: 2000 },
      });
      check("Flujo: actualizar producto", [200, 201].includes(updateRes.status), `status=${updateRes.status}`);

      const deleteRes = await req("DELETE", `/api/v1/products/${productId}`, { token: adminToken });
      check("Flujo: eliminar producto", [200, 204].includes(deleteRes.status), `status=${deleteRes.status}`);
    }
  }

  /* ══ 5. REGRESIÓN ══════════════════════════════════════════ */
  console.log("\n[5] REGRESIÓN");

  r = await req("GET", "/api/v1/products?limit=1");
  check("Regresión: productos accesibles", r.status === 200, `status=${r.status}`);

  r = await req("GET", "/api/v1/categories");
  check("Regresión: categorías accesibles", r.status === 200, `status=${r.status}`);

  r = await req("GET", "/health");
  check("Regresión: servidor saludable", r.status === 200, `status=${r.status}`);

  /* ─── Resumen ──────────────────────────────────────────── */
  console.log(`\n${"═".repeat(70)}`);
  console.log(`📊  DEEP QA:  ${pass} OK  /  ${fail} FALLOS  /  ${warn} WARNINGS  /  ${pass + fail + warn} total`);
  console.log(`${"═".repeat(70)}\n`);

  fs.writeFileSync(
    path.join(__dirname, "deep-qa-report.json"),
    JSON.stringify({ base: BASE, date: new Date().toISOString(), pass, fail, warn, results }, null, 2)
  );
  console.log("📄  Reporte: tools/deep-qa-report.json\n");
  process.exit(fail > 0 ? 1 : 0);
})();
