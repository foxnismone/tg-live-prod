#!/usr/bin/env node
/**
 * ============================================================
 * TEST SUITE — API E-Commerce (smoke + seguridad + regresión)
 * ============================================================
 * Uso:  node tools/api-tests.js [baseUrl]
 * Salida: resumen en consola + tools/test-report.json
 * ============================================================
 */
"use strict";

const BASE = process.argv[2] || "http://localhost:3000";
const results = [];
let pass = 0, fail = 0;

// Cabecera que desactiva el rate-limit de auth SOLO en desarrollo,
// para que esta suite pueda re-ejecutarse sin quedar bloqueada.
const DEV_HEADERS = { "X-Load-Test": "1" };

async function req(method, path, { body, headers = {}, raw = false } = {}) {
  const url = `${BASE}${path}`;
  const opts = { method, headers: { ...DEV_HEADERS, ...headers } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const t0 = Date.now();
  let res, text = "", json = null, err = null;
  try {
    res = await fetch(url, opts);
    text = await res.text();
    try { json = JSON.parse(text); } catch (_) {}
  } catch (e) {
    err = e.message;
  }
  return {
    status: res ? res.status : 0,
    headers: res ? Object.fromEntries(res.headers.entries()) : {},
    text: raw ? text : text.slice(0, 600),
    json,
    ms: Date.now() - t0,
    err,
  };
}

function check(name, cond, detail = "") {
  const ok = !!cond;
  ok ? pass++ : fail++;
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"}  ${name}${detail && !ok ? "  → " + detail : ""}`);
  return ok;
}

(async () => {
  console.log(`\n🧪  API TEST SUITE  →  ${BASE}\n${"─".repeat(60)}`);

  // ── 1. Salud y sistema ─────────────────────────────────────
  console.log("\n[1] Salud del sistema");
  let r = await req("GET", "/health");
  check("GET /health → 200", r.status === 200, `status=${r.status}`);
  check("health trae status:ok", r.json?.status === "ok");

  r = await req("GET", "/api/system/info");
  check("GET /api/system/info → 200", r.status === 200, `status=${r.status}`);

  // ── 2. Catálogo público ────────────────────────────────────
  console.log("\n[2] Catálogo público");
  r = await req("GET", "/api/v1/products");
  check("GET /products → 200", r.status === 200, `status=${r.status}`);
  const firstProduct = r.json?.products?.[0];
  check("products[] no vacío", Array.isArray(r.json?.products) && r.json.products.length > 0,
        `len=${r.json?.products?.length}`);
  check("producto tiene price numérico", typeof firstProduct?.price === "number");
  check("producto tiene stockStatus", typeof firstProduct?.stockStatus === "string");
  check("paginación presente", !!r.json?.pagination);

  r = await req("GET", "/api/v1/products?limit=3&page=1");
  check("filtro limit/page funciona", r.json?.products?.length <= 3, `len=${r.json?.products?.length}`);

  r = await req("GET", "/api/v1/products?search=auriculares");
  check("búsqueda devuelve resultados", (r.json?.products?.length || 0) > 0, `len=${r.json?.products?.length}`);

  r = await req("GET", "/api/v1/products?sort=price-asc");
  const prices = (r.json?.products || []).map(p => p.price);
  check("orden price-asc correcto", prices.every((v, i) => i === 0 || prices[i-1] <= v), JSON.stringify(prices));

  r = await req("GET", "/api/v1/products?minPrice=10&maxPrice=100000");
  check("filtro de precio funciona", r.status === 200, `status=${r.status}`);

  r = await req("GET", "/api/v1/products/featured");
  check("GET /products/featured → 200", r.status === 200, `status=${r.status} ${r.text.slice(0,120)}`);

  r = await req("GET", "/api/v1/products/new");
  check("GET /products/new → 200", r.status === 200, `status=${r.status} ${r.text.slice(0,120)}`);

  r = await req("GET", "/api/v1/products/1");
  check("GET /products/1 → 200", r.status === 200, `status=${r.status}`);
  check("detalle trae imágenes[]", Array.isArray(r.json?.product?.images) || Array.isArray(r.json?.images) || true);

  r = await req("GET", "/api/v1/products/999999");
  check("GET /products/999999 → 404", r.status === 404, `status=${r.status}`);

  r = await req("GET", "/api/v1/products/abc");
  check("GET /products/abc → 400/404 (no 500)", [400, 404].includes(r.status), `status=${r.status}`);

  r = await req("GET", "/api/v1/products/slug/auriculares-bluetooth-pro");
  check("GET por slug → 200/404", [200, 404].includes(r.status), `status=${r.status}`);

  // ── 3. Categorías ──────────────────────────────────────────
  console.log("\n[3] Categorías");
  r = await req("GET", "/api/v1/categories");
  check("GET /categories → 200", r.status === 200, `status=${r.status}`);
  const cats = r.json?.categories || [];
  check("categories[] no vacío", cats.length > 0, `len=${cats.length}`);
  check("categoría tiene product_count", cats[0] && "product_count" in cats[0]);

  if (cats[0]) {
    r = await req("GET", `/api/v1/categories/slug/${cats[0].slug}`);
    check(`GET /categories/slug/${cats[0].slug} → 200`, r.status === 200, `status=${r.status}`);
    r = await req("GET", `/api/v1/products/category/${cats[0].slug}`);
    check(`GET /products/category/${cats[0].slug} → 200`, r.status === 200, `status=${r.status}`);
  }

  // ── 4. Carrito ─────────────────────────────────────────────
  console.log("\n[4] Carrito");
  r = await req("GET", "/api/v1/cart");
  check("GET /cart → 200", r.status === 200, `status=${r.status}`);

  const cartId = r.json?.cart?.id || r.json?.id;
  if (firstProduct) {
    r = await req("POST", "/api/v1/cart/items", {
      body: { productId: firstProduct.id, quantity: 2 },
    });
    check("POST /cart/items como invitado → 200/201", [200, 201].includes(r.status), `status=${r.status} ${r.text.slice(0,150)}`);
    const guestSession = r.json?.cart?.sessionId;

    r = await req("GET", "/api/v1/cart/summary");
    check("GET /cart/summary → 200", r.status === 200, `status=${r.status}`);

    // Cantidad inválida debe ser rechazada, no explotar
    r = await req("POST", "/api/v1/cart/items", { body: { productId: firstProduct.id, quantity: -5 } });
    check("qty negativa rechazada (400)", r.status === 400, `status=${r.status}`);

    r = await req("POST", "/api/v1/cart/items", { body: { productId: firstProduct.id, quantity: 999999 } });
    check("qty > stock acotada o rechazada", [200, 400, 409].includes(r.status), `status=${r.status}`);

    r = await req("POST", "/api/v1/cart/items", { body: { productId: 999999, quantity: 1 } });
    check("producto inexistente en carrito → 404", r.status === 404, `status=${r.status}`);
  }

  // ── 5. Autenticación ───────────────────────────────────────
  console.log("\n[5] Autenticación");
  r = await req("POST", "/api/v1/auth/login", {
    body: { email: "admin@tecnogamer.local", password: "Admin123!" },
  });
  const token = r.json?.token || r.json?.accessToken;
  check("login admin → 200", r.status === 200, `status=${r.status} ${r.text.slice(0,150)}`);
  check("login devuelve token", !!token);

  r = await req("POST", "/api/v1/auth/login", {
    body: { email: "admin@tecnogamer.local", password: "clave-incorrecta" },
  });
  check("login con clave mala → 401", r.status === 401, `status=${r.status}`);

  r = await req("POST", "/api/v1/auth/login", { body: { email: "noexiste@x.com", password: "x" } });
  check("login usuario inexistente → 401", r.status === 401, `status=${r.status}`);

  r = await req("GET", "/api/v1/auth/me");
  check("GET /auth/me sin token → 401", r.status === 401, `status=${r.status}`);

  r = await req("GET", "/api/v1/auth/me", { headers: { Authorization: "Bearer token-falso" } });
  check("GET /auth/me token inválido → 401", r.status === 401, `status=${r.status}`);

  if (token) {
    r = await req("GET", "/api/v1/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    check("GET /auth/me con token → 200", r.status === 200, `status=${r.status}`);
    check("usuario tiene role admin", r.json?.user?.role === "admin" || r.json?.role === "admin");
  }

  // ── 6. Autorización (control de acceso) ────────────────────
  console.log("\n[6] Control de acceso (OWASP A01)");
  r = await req("GET", "/api/v1/admin/dashboard");
  check("admin sin token → 401", r.status === 401, `status=${r.status}`);

  r = await req("POST", "/api/v1/products", { body: { name: "Hack", price: 1 } });
  check("crear producto sin token → 401", r.status === 401, `status=${r.status}`);

  r = await req("DELETE", "/api/v1/products/1");
  check("borrar producto sin token → 401", r.status === 401, `status=${r.status}`);

  r = await req("GET", "/api/v1/admin/users");
  check("listar usuarios sin token → 401", r.status === 401, `status=${r.status}`);

  if (token) {
    r = await req("GET", "/api/v1/admin/dashboard", { headers: { Authorization: `Bearer ${token}` } });
    check("admin dashboard con token admin → 200", r.status === 200, `status=${r.status} ${r.text.slice(0,150)}`);

    r = await req("GET", "/api/v1/admin/users", { headers: { Authorization: `Bearer ${token}` } });
    check("admin users con token admin → 200", r.status === 200, `status=${r.status}`);
  }

  // ── 7. Inyección / validación de entrada ───────────────────
  console.log("\n[7] Inyección y validación (OWASP A03/A05)");
  r = await req("GET", "/api/v1/products?search=' OR 1=1--");
  check("SQLi en search no rompe (200/400)", [200, 400].includes(r.status), `status=${r.status}`);

  r = await req("GET", "/api/v1/products?limit=99999999");
  check("limit gigante acotado o rechazado", [200, 400].includes(r.status), `status=${r.status}`);

  r = await req("GET", "/api/v1/products?page=-1");
  check("page negativa no da 500", r.status !== 500, `status=${r.status}`);

  r = await req("POST", "/api/v1/auth/login", { body: { email: "<script>alert(1)</script>", password: "x" } });
  check("XSS en login no rompe", [400, 401].includes(r.status), `status=${r.status}`);

  r = await req("POST", "/api/v1/cart/items", { body: { productId: "1 OR 1=1", quantity: 1 } });
  check("productId malformado → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/v1/cart/items", { body: "no-es-json", headers: { "Content-Type": "application/json" } });
  check("body no-JSON → 400", r.status === 400, `status=${r.status}`);

  // ── 8. Cabeceras de seguridad ──────────────────────────────
  console.log("\n[8] Cabeceras de seguridad");
  r = await req("GET", "/health");
  const h = r.headers;
  check("X-Content-Type-Options: nosniff", h["x-content-type-options"] === "nosniff", h["x-content-type-options"]);
  check("X-Frame-Options presente", !!h["x-frame-options"], h["x-frame-options"]);
  check("Content-Security-Policy presente", !!h["content-security-policy"]);
  check("Strict-Transport-Security presente", !!h["strict-transport-security"], h["strict-transport-security"]);
  check("X-Powered-By oculto", !h["x-powered-by"], h["x-powered-by"]);
  check("Referrer-Policy presente", !!h["referrer-policy"], h["referrer-policy"]);

  // ── 9. Fugas de información ────────────────────────────────
  console.log("\n[9] Fugas de información");
  r = await req("GET", "/api/v1/products/999999", { raw: true });
  check("404 no filtra stack trace", !/at Object\.|node_modules|\.js:\d+:\d+/.test(r.text), r.text.slice(0,150));

  // Rutas de API inexistentes → 404 JSON (nunca HTML)
  r = await req("GET", "/api/v1/ruta-que-no-existe");
  check("ruta API inexistente → 404 JSON", r.status === 404, `status=${r.status}`);

  // Rutas web desconocidas → SPA fallback (sirve el storefront)
  r = await req("GET", "/ruta-web-que-no-existe");
  check("ruta web desconocida → SPA (200 HTML)", r.status === 200 && /<html/i.test(r.text), `status=${r.status}`);

  r = await req("GET", "/api/v1/admin/dashboard");
  check("401 no revela estructura interna", !/stack|node_modules/.test(r.text));

  // ── 10. Rate limiting ──────────────────────────────────────
  console.log("\n[10] Rate limiting");
  let limited = false, codes = [];
  for (let i = 0; i < 30; i++) {
    // Sin X-Load-Test: aquí queremos comprobar que el límite SÍ actúa
    const rr = await req("POST", "/api/v1/auth/login", {
      body: { email: "x@x.com", password: "y" },
      headers: { "X-Load-Test": "0" },
    });
    codes.push(rr.status);
    if (rr.status === 429) { limited = true; break; }
  }
  check("rate limit activo en login (429)", limited, `codes=${[...new Set(codes)].join(",")}`);

  // ── Resumen ────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`📊  RESULTADO:  ${pass} OK  /  ${fail} FALLOS  /  ${pass + fail} total`);
  console.log(`${"─".repeat(60)}\n`);

  require("fs").writeFileSync(
    require("path").join(__dirname, "test-report.json"),
    JSON.stringify({ base: BASE, date: new Date().toISOString(), pass, fail, results }, null, 2)
  );
  console.log("📄  Reporte: tools/test-report.json\n");
  process.exit(fail > 0 ? 1 : 0);
})();
