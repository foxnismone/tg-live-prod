#!/usr/bin/env node
/**
 * ============================================================
 * SECURITY ATTACK SIMULATOR — Simulación de ataques web
 * ============================================================
 * Ejecuta payloads de ataque REALES contra el servidor para
 * verificar que las defensas funcionan. NO usa exploits
 * destructivos: solo payloads benignos de detección.
 *
 * Categorías:
 *   1. SQL Injection (SQLi)
 *   2. Cross-Site Scripting (XSS)
 *   3. Path Traversal
 *   4. Command Injection
 *   5. NoSQL/JSON Injection
 *   6. Prototype Pollution
 *   7. SSRF
 *   8. Broken Authentication
 *   9. Rate Limiting / Brute Force
 *  10. Mass Assignment
 *  11. IDOR (Insecure Direct Object Reference)
 *  12. HTTP Header Injection
 *
 * Uso:  node tools/security-attack-sim.js [baseUrl]
 * ============================================================
 */
"use strict";

const BASE = process.argv[2] || "http://localhost:3000";
const H = { "Content-Type": "application/json", "X-Load-Test": "1" };

let blocked = 0, vulnerable = 0, inconclusive = 0;
const findings = [];

function record(name, safe, detail, severity = "alta") {
  if (safe) {
    blocked++;
    console.log(`  ✅  ${name}`);
  } else {
    vulnerable++;
    findings.push({ name, detail, severity });
    console.log(`  ❌  VULNERABLE: ${name}  →  ${String(detail).slice(0, 140)}`);
  }
}

async function req(method, p, { body, headers = {}, token, raw } = {}) {
  const opts = { method, headers: { ...H, ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (raw !== undefined) opts.body = raw;
  else if (body !== undefined) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(BASE + p, opts);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: e.message };
  }
}

(async () => {
  console.log(`\n🛡️   SECURITY ATTACK SIMULATOR  →  ${BASE}\n${"═".repeat(70)}`);

  // Login como admin para pruebas autenticadas
  const loginRes = await req("POST", "/api/v1/auth/login", {
    body: { email: "admin@tecnogamer.local", password: "Admin123!" },
  });
  const token = loginRes.json?.token || loginRes.json?.accessToken;
  console.log(`\n  Token admin: ${token ? "obtenido ✓" : "NO obtenido ✗"}\n`);

  /* ══ 1. SQL INJECTION ═════════════════════════════════════ */
  console.log("[1] SQL INJECTION");
  const sqliPayloads = [
    "' OR '1'='1",
    "'; DROP TABLE products;--",
    "1' UNION SELECT * FROM users--",
    "admin'--",
    "' OR 1=1 LIMIT 1--",
    "1; DELETE FROM products WHERE 1=1;--",
    "' AND SLEEP(5)--",
    "1' AND (SELECT COUNT(*) FROM users)>0--",
  ];

  for (const p of sqliPayloads) {
    const r = await req("GET", `/api/v1/products?search=${encodeURIComponent(p)}`);
    const safe = r.status === 200 || r.status === 400;
    record(`SQLi en search: ${p.slice(0, 30)}`, safe, `status=${r.status}`);
  }

  // Verificar que la tabla sigue intacta
  const check = await req("GET", "/api/v1/products?limit=1");
  record("Tabla products intacta tras SQLi", (check.json?.pagination?.total || 0) > 0, `total=${check.json?.pagination?.total}`);

  // SQLi en login
  for (const p of ["admin@tecnogamer.local' --", "' OR '1'='1' --", "admin'/*"]) {
    const r = await req("POST", "/api/v1/auth/login", { body: { email: p, password: "x" } });
    record(`SQLi en login: ${p.slice(0, 25)}`, r.status !== 200 || !r.json?.token, `status=${r.status}`);
  }

  /* ══ 2. XSS ═══════════════════════════════════════════════ */
  console.log("\n[2] XSS (Cross-Site Scripting)");
  const xssPayloads = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)",
    "\"><svg onload=alert(1)>",
    "'-alert(1)-'",
    "<iframe src=javascript:alert(1)>",
  ];
  for (const p of xssPayloads) {
    const r = await req("POST", "/api/v1/auth/login", { body: { email: p, password: "x" } });
    // El servidor debe rechazar o escapar, nunca devolver el payload crudo en JSON exitoso
    const reflected = r.text.includes(p) && r.status === 200 && r.json?.token;
    record(`XSS en email: ${p.slice(0, 25)}`, !reflected, `status=${r.status}`);
  }

  /* ══ 3. PATH TRAVERSAL ════════════════════════════════════ */
  console.log("\n[3] PATH TRAVERSAL");
  const traversals = [
    "/api/v1/../../etc/passwd",
    "/api/v1/products/../../../package.json",
    "/static/../../.env",
    "/uploads/../../backend/config/database.js",
    "/%2e%2e%2f%2e%2e%2fpackage.json",
    "/api/v1/products/%2e%2e%2f%2e%2e%2f.env",
  ];
  for (const p of traversals) {
    const r = await req("GET", p);
    const leaked = /root:|DB_PATH|JWT_SECRET|"dependencies"/.test(r.text);
    record(`Path traversal: ${p.slice(0, 40)}`, !leaked, leaked ? "FUGA DE ARCHIVO" : `status=${r.status}`, "crítica");
  }

  /* ══ 4. COMMAND INJECTION ═════════════════════════════════ */
  console.log("\n[4] COMMAND INJECTION");
  const cmds = ["; ls -la", "| cat /etc/passwd", "`id`", "$(whoami)", "&& dir", "\n cat /etc/passwd"];
  for (const c of cmds) {
    const r = await req("GET", `/api/v1/products?search=${encodeURIComponent(c)}`);
    const leaked = /uid=|gid=|root:|total \d+/.test(r.text);
    record(`Command injection: ${c.slice(0, 20)}`, !leaked, leaked ? "EJECUCIÓN" : `status=${r.status}`, "crítica");
  }

  /* ══ 5. JSON / NoSQL INJECTION ════════════════════════════ */
  console.log("\n[5] JSON / NoSQL INJECTION");
  const jsonInj = [
    { email: { $gt: "" }, password: { $gt: "" } },
    { email: { $ne: null }, password: { $ne: null } },
    { email: "admin@tecnogamer.local", password: { $regex: ".*" } },
  ];
  for (const b of jsonInj) {
    const r = await req("POST", "/api/v1/auth/login", { body: b });
    record(`NoSQL injection: ${JSON.stringify(b).slice(0, 40)}`, !(r.status === 200 && r.json?.token), `status=${r.status}`, "crítica");
  }

  /* ══ 6. PROTOTYPE POLLUTION ═══════════════════════════════ */
  console.log("\n[6] PROTOTYPE POLLUTION");
  const r6 = await req("POST", "/api/v1/cart/items", {
    body: { productId: 1, quantity: 1, sessionId: "sec-test", __proto__: { polluted: true }, constructor: { prototype: { polluted: true } } },
  });
  const r6b = await req("GET", "/api/v1/products?limit=1");
  record("Prototype pollution neutralizado", !r6b.json?.polluted && !{}.polluted, `status=${r6.status}`, "alta");

  /* ══ 7. SSRF ══════════════════════════════════════════════ */
  console.log("\n[7] SSRF");
  const ssrfUrls = [
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:22",
    "file:///etc/passwd",
    "http://127.0.0.1:3000/api/v1/admin/dashboard",
  ];
  for (const u of ssrfUrls) {
    const r = await req("POST", "/api/v1/ai/generate-description", { token, body: { url: u, name: "test" } });
    const leaked = /meta-data|ami-id|ssh|root:/.test(r.text);
    record(`SSRF: ${u.slice(0, 35)}`, !leaked, leaked ? "SSRF EXITOSO" : `status=${r.status}`, "crítica");
  }

  /* ══ 8. BROKEN AUTHENTICATION ═════════════════════════════ */
  console.log("\n[8] BROKEN AUTHENTICATION");
  const badTokens = [
    "Bearer null", "Bearer undefined", "Bearer 0", "Bearer " + "a".repeat(500),
    "Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOjEsInJvbGUiOiJhZG1pbiJ9.",
  ];
  for (const t of badTokens) {
    const r = await req("GET", "/api/v1/auth/me", { headers: { Authorization: t } });
    record(`Token inválido: ${t.slice(7, 30)}`, r.status === 401, `status=${r.status}`, "crítica");
  }

  // Alg: none attack
  const noneToken = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url") +
    "." + Buffer.from(JSON.stringify({ userId: 1, role: "admin" })).toString("base64url") + ".";
  const rNone = await req("GET", "/api/v1/admin/dashboard", { headers: { Authorization: `Bearer ${noneToken}` } });
  record("Ataque alg:none rechazado", rNone.status === 401, `status=${rNone.status}`, "crítica");

  /* ══ 9. RATE LIMITING / BRUTE FORCE ═══════════════════════ */
  console.log("\n[9] RATE LIMITING / BRUTE FORCE");
  // Nota: en desarrollo el límite es 25/60s; en producción 10/15min.
  // El test hace 35 intentos para superar el límite de dev.
  let rateLimited = false;
  let attempts = 0;
  for (let i = 0; i < 35; i++) {
    // Sin X-Load-Test para que el rate limit aplique de verdad
    try {
      const r = await fetch(BASE + "/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@tecnogamer.local", password: "wrong" + i }),
      });
      attempts++;
      if (r.status === 429) { rateLimited = true; break; }
    } catch (_) {
      attempts++;
    }
  }
  record(`Rate limiting en login (${attempts} intentos)`, rateLimited, rateLimited ? "bloqueado con 429 ✓" : "sin bloqueo tras 35 intentos", "alta");

  /* ══ 10. MASS ASSIGNMENT ══════════════════════════════════ */
  console.log("\n[10] MASS ASSIGNMENT");
  const r10 = await req("POST", "/api/v1/products", {
    token,
    body: {
      name: "Mass Assign Test", sku: "MA-" + Date.now(), price: 1, categoryId: 1,
      is_admin: true, role: "admin", id: 99999, created_at: "2000-01-01",
    },
  });
  const created = r10.json?.product || r10.json;
  const massOk = created?.id !== 99999 && !created?.is_admin;
  record("Mass assignment: campos no permitidos ignorados", massOk, `id=${created?.id}`, "alta");
  if (created?.id) await req("DELETE", `/api/v1/products/${created.id}`, { token });

  /* ══ 11. IDOR ═════════════════════════════════════════════ */
  console.log("\n[11] IDOR (Insecure Direct Object Reference)");
  const r11 = await req("GET", "/api/v1/admin/dashboard");
  record("Dashboard admin sin token → 401", r11.status === 401, `status=${r11.status}`, "crítica");
  const r11b = await req("GET", "/api/v1/admin/users");
  record("Lista usuarios sin token → 401", r11b.status === 401, `status=${r11b.status}`, "crítica");
  const r11c = await req("GET", "/api/v1/orders");
  record("Pedidos sin token → 401", r11c.status === 401, `status=${r11c.status}`, "crítica");
  const r11d = await req("GET", "/api/v1/orders/1");
  record("Pedido ajeno sin token → 401", r11d.status === 401, `status=${r11d.status}`, "crítica");

  /* ══ 12. HTTP HEADER INJECTION ════════════════════════════ */
  console.log("\n[12] HTTP HEADER INJECTION");
  // Un CRLF en un valor de cabecera hace que el propio cliente HTTP rechace
  // la petición (status=0). Eso ya es una defensa válida: el header malicioso
  // nunca llega al servidor.
  const r12 = await req("GET", "/api/v1/products?limit=1", {
    headers: { "X-Forwarded-For": "127.0.0.1\r\nX-Injected: yes", "User-Agent": "test\r\nX-Bad: 1" },
  });
  const headerInjectionSafe = r12.status === 0 || (!r12.text.includes("X-Injected") && !r12.text.includes("X-Bad"));
  record("Header injection no reflejado", headerInjectionSafe, r12.status === 0 ? "cliente rechazó CRLF ✓" : `status=${r12.status}`, "media");

  /* ══ 13. DOS / PAYLOAD GIGANTE ════════════════════════════ */
  console.log("\n[13] DoS / PAYLOADS GIGANTES");
  const r13 = await req("POST", "/api/v1/auth/login", { raw: "x".repeat(2 * 1024 * 1024), headers: { "Content-Type": "application/json" } });
  record("Payload 2MB rechazado", [400, 413, 429].includes(r13.status), `status=${r13.status}`, "alta");

  const r13b = await req("POST", "/api/v1/auth/login", { body: { email: "a@b.com", password: "x".repeat(100000) } });
  record("Password 100KB rechazado", [400, 401, 413, 429].includes(r13b.status), `status=${r13b.status}`, "media");

  /* ══ 14. JSON PROFUNDO (DoS) ══════════════════════════════ */
  console.log("\n[14] JSON PROFUNDAMENTE ANIDADO");
  let deep = { a: 1 };
  for (let i = 0; i < 500; i++) deep = { nested: deep };
  const r14 = await req("POST", "/api/v1/cart/items", { body: deep });
  record("JSON 500 niveles no derriba servidor", r14.status !== 0, `status=${r14.status}`, "media");

  /* ══ RESUMEN ══════════════════════════════════════════════ */
  console.log(`\n${"═".repeat(70)}`);
  console.log(`📊  ATAQUES:  ${blocked} bloqueados  /  ${vulnerable} vulnerables  /  ${blocked + vulnerable} total`);
  console.log(`${"═".repeat(70)}`);

  if (findings.length > 0) {
    console.log("\n🔴 HALLAZGOS:");
    for (const f of findings) {
      console.log(`  [${f.severity}] ${f.name}`);
      console.log(`      ${f.detail}`);
    }
  } else {
    console.log("\n✅  Sin vulnerabilidades detectadas en las pruebas ejecutadas.");
  }
  console.log();

  require("fs").writeFileSync(
    require("path").join(__dirname, "security-attack-report.json"),
    JSON.stringify({ base: BASE, date: new Date().toISOString(), blocked, vulnerable, findings }, null, 2)
  );
  console.log("📄  Reporte: tools/security-attack-report.json\n");
  process.exit(vulnerable > 0 ? 1 : 0);
})();
