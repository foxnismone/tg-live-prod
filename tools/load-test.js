#!/usr/bin/env node
/**
 * ============================================================
 * LOAD TEST — Pruebas de carga y estrés
 * ============================================================
 * Simula usuarios concurrentes y mide:
 *   - Throughput (req/s)
 *   - Latencia (p50, p95, p99)
 *   - Tasa de error
 *   - Punto de degradación
 *
 * Uso:  node tools/load-test.js [baseUrl] [usuarios] [duracionSeg]
 * ============================================================
 */
"use strict";

const BASE = process.argv[2] || "http://localhost:3000";
const VUS = parseInt(process.argv[3] || "50", 10);
const DURATION = parseInt(process.argv[4] || "15", 10);

const ENDPOINTS = [
  { weight: 40, method: "GET", path: "/api/v1/products?limit=12", name: "Listado productos" },
  { weight: 20, method: "GET", path: "/api/v1/categories", name: "Categorías" },
  { weight: 15, method: "GET", path: "/api/v1/products/1", name: "Detalle producto" },
  { weight: 10, method: "GET", path: "/health", name: "Health check" },
  { weight: 10, method: "GET", path: "/api/v1/products?search=gamer&limit=6", name: "Búsqueda" },
  { weight: 5,  method: "GET", path: "/api/v1/products?category=1&limit=6", name: "Filtro categoría" },
];

const totalWeight = ENDPOINTS.reduce((a, e) => a + e.weight, 0);

function pickEndpoint() {
  let r = Math.random() * totalWeight;
  for (const e of ENDPOINTS) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return ENDPOINTS[0];
}

const stats = {};
for (const e of ENDPOINTS) stats[e.name] = { count: 0, errors: 0, times: [] };

let running = true;
let totalRequests = 0;
let totalErrors = 0;

async function vu(id) {
  while (running) {
    const ep = pickEndpoint();
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(BASE + ep.path, {
        method: ep.method,
        headers: { "X-Load-Test": "1" },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      await res.text();
      const dt = Date.now() - t0;
      const s = stats[ep.name];
      s.count++;
      s.times.push(dt);
      totalRequests++;
      if (res.status >= 400) { s.errors++; totalErrors++; }
    } catch (e) {
      const dt = Date.now() - t0;
      const s = stats[ep.name];
      s.count++;
      s.errors++;
      s.times.push(dt);
      totalRequests++;
      totalErrors++;
    }
  }
}

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

(async () => {
  console.log(`\n🚀  LOAD TEST  →  ${BASE}`);
  console.log(`   Usuarios virtuales: ${VUS}  |  Duración: ${DURATION}s`);
  console.log(`${"═".repeat(70)}\n`);

  const start = Date.now();
  const vus = Array.from({ length: VUS }, (_, i) => vu(i));

  // Reporte progresivo cada 5s
  const reporter = setInterval(() => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    const rps = (totalRequests / (elapsed || 1)).toFixed(0);
    process.stdout.write(`\r   ⏱  ${elapsed}s  |  ${totalRequests} req  |  ${rps} req/s  |  ${totalErrors} errores   `);
  }, 1000);

  await new Promise(r => setTimeout(r, DURATION * 1000));
  running = false;
  clearInterval(reporter);
  await Promise.all(vus);

  const elapsed = (Date.now() - start) / 1000;
  console.log("\n");

  /* ─── Resultados por endpoint ─────────────────────────── */
  console.log("[RESULTADOS POR ENDPOINT]");
  console.log(`  ${"Endpoint".padEnd(22)} ${"Reqs".padStart(6)} ${"Err".padStart(5)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"p99".padStart(7)}`);
  console.log(`  ${"─".repeat(60)}`);

  const allTimes = [];
  for (const [name, s] of Object.entries(stats)) {
    if (s.count === 0) continue;
    allTimes.push(...s.times);
    console.log(
      `  ${name.padEnd(22)} ${String(s.count).padStart(6)} ${String(s.errors).padStart(5)} ` +
      `${(pct(s.times, 50) + "ms").padStart(7)} ${(pct(s.times, 95) + "ms").padStart(7)} ${(pct(s.times, 99) + "ms").padStart(7)}`
    );
  }

  /* ─── Resumen global ──────────────────────────────────── */
  const rps = (totalRequests / elapsed).toFixed(1);
  const errRate = totalRequests > 0 ? ((totalErrors / totalRequests) * 100).toFixed(2) : "0.00";

  console.log(`\n[RESUMEN GLOBAL]`);
  console.log(`  Duración            ${elapsed.toFixed(1)}s`);
  console.log(`  Total requests      ${totalRequests}`);
  console.log(`  Throughput          ${rps} req/s`);
  console.log(`  Errores             ${totalErrors} (${errRate}%)`);
  console.log(`  Latencia p50        ${pct(allTimes, 50)}ms`);
  console.log(`  Latencia p95        ${pct(allTimes, 95)}ms`);
  console.log(`  Latencia p99        ${pct(allTimes, 99)}ms`);
  console.log(`  Latencia máx        ${Math.max(...allTimes)}ms`);

  /* ─── Veredicto ───────────────────────────────────────── */
  console.log(`\n[VEREDICTO]`);
  const p95 = pct(allTimes, 95);
  const checks = [
    ["Throughput > 100 req/s", parseFloat(rps) > 100],
    ["Tasa de error < 1%", parseFloat(errRate) < 1],
    ["p95 < 500ms", p95 < 500],
    ["p99 < 1000ms", pct(allTimes, 99) < 1000],
  ];
  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "✅" : "❌"}  ${name}`);
    if (!ok) allOk = false;
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(allOk ? "✅  PASA — el sistema soporta la carga" : "⚠️   REVISAR — algunos umbrales no se cumplen");
  console.log(`${"═".repeat(70)}\n`);

  require("fs").writeFileSync(
    require("path").join(__dirname, "load-test-report.json"),
    JSON.stringify({
      base: BASE, vus: VUS, duration: elapsed, totalRequests, totalErrors,
      rps: parseFloat(rps), errorRate: parseFloat(errRate),
      p50: pct(allTimes, 50), p95: pct(allTimes, 95), p99: pct(allTimes, 99),
      max: Math.max(...allTimes), passed: allOk, date: new Date().toISOString(),
    }, null, 2)
  );

  process.exit(allOk ? 0 : 1);
})();
