#!/usr/bin/env node
/**
 * ============================================================
 * DB ANALYZER — Análisis de rendimiento de SQLite
 * ============================================================
 * Ejecuta EXPLAIN QUERY PLAN en las consultas críticas para
 * detectar SCAN TABLE (falta de índice) y sugiere índices.
 *
 * Uso:  node tools/db-analyzer.js
 * ============================================================
 */
"use strict";

const path = require("path");
const Database = require(path.join(__dirname, "..", "backend", "config", "sqlite-compat"));

const dbPath = path.join(__dirname, "..", "data", "ecommerce.db");
const db = new Database(dbPath, { readonly: true });

console.log(`\n🔍  DB ANALYZER  →  ${dbPath}\n${"═".repeat(70)}`);

/* ─── PRAGMAs actuales ───────────────────────────────────── */
console.log("\n[1] CONFIGURACIÓN ACTUAL");
const pragmas = ["journal_mode", "synchronous", "cache_size", "mmap_size", "temp_store", "busy_timeout", "page_count", "page_size", "freelist_count"];
for (const p of pragmas) {
  try {
    const r = db.prepare(`PRAGMA ${p}`).get();
    const val = r ? Object.values(r)[0] : "?";
    console.log(`  ${p.padEnd(18)} = ${val}`);
  } catch (e) {
    console.log(`  ${p.padEnd(18)} = (error: ${e.message})`);
  }
}

/* ─── Tamaño de tablas ───────────────────────────────────── */
console.log("\n[2] TAMAÑO DE TABLAS");
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all();

const tableStats = [];
for (const t of tables) {
  try {
    const c = db.prepare(`SELECT COUNT(*) as n FROM "${t.name}"`).get();
    tableStats.push({ table: t.name, rows: c.n });
  } catch (_) {
    tableStats.push({ table: t.name, rows: "?" });
  }
}
tableStats.sort((a, b) => (b.rows || 0) - (a.rows || 0));
for (const s of tableStats) {
  console.log(`  ${String(s.table).padEnd(24)} ${String(s.rows).padStart(8)} filas`);
}

/* ─── Consultas críticas ─────────────────────────────────── */
console.log("\n[3] PLANES DE EJECUCIÓN (consultas críticas)");

const queries = [
  ["Listado de productos activos", "SELECT p.*, c.name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.is_active=1 ORDER BY p.created_at DESC LIMIT 12"],
  ["Búsqueda por nombre", "SELECT * FROM products WHERE is_active=1 AND name LIKE '%gamer%' LIMIT 10"],
  ["Producto por SKU", "SELECT * FROM products WHERE sku = 'TEST'"],
  ["Producto por slug", "SELECT * FROM products WHERE slug = 'test'"],
  ["Categorías activas", "SELECT * FROM categories WHERE is_active=1"],
  ["Imágenes de producto", "SELECT * FROM product_images WHERE product_id = 1 ORDER BY sort_order"],
  ["Carrito por sesión", "SELECT * FROM carts WHERE session_id = 'x'"],
  ["Items de carrito (JSON en carts)", "SELECT id, items FROM carts WHERE session_id = 'x'"],
  ["Pedidos por usuario", "SELECT * FROM orders WHERE user_id = 1 ORDER BY created_at DESC"],
  ["Pedido por número", "SELECT * FROM orders WHERE order_number = 'ORDEN-2026-000001'"],
  ["Pagos por pedido", "SELECT * FROM payments WHERE order_id = 1"],
  ["Usuario por email", "SELECT * FROM users WHERE email = 'a@b.com'"],
  ["Token por valor", "SELECT * FROM auth_tokens WHERE token = 'x'"],
  ["Reviews de producto", "SELECT * FROM reviews WHERE product_id = 1 AND status='approved'"],
  ["Mensajes de chat", "SELECT * FROM chat_messages WHERE session_id = 'x' ORDER BY created_at"],
  ["Audit por entidad", "SELECT * FROM audit_logs WHERE entity_type='product' AND entity_id=1"],
];

let scans = 0, usesIndex = 0;
for (const [name, sql] of queries) {
  try {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
    const detail = plan.map(r => r.detail).join(" | ");
    const isScan = /SCAN/.test(detail) && !/USING (COVERING )?INDEX/.test(detail);
    if (isScan) scans++; else usesIndex++;
    const icon = isScan ? "🟡" : "✅";
    console.log(`  ${icon}  ${name}`);
    console.log(`       ${detail.slice(0, 150)}`);
  } catch (e) {
    console.log(`  ⚠️   ${name}  →  ${e.message}`);
  }
}

/* ─── Índices existentes ─────────────────────────────────── */
console.log("\n[4] ÍNDICES");
const indexes = db.prepare(
  "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name"
).all();
const byTable = {};
for (const i of indexes) {
  (byTable[i.tbl_name] = byTable[i.tbl_name] || []).push(i.name);
}
for (const [tbl, idx] of Object.entries(byTable)) {
  console.log(`  ${tbl.padEnd(20)} ${idx.length} índices`);
}

/* ─── Índices no usados (aproximación) ───────────────────── */
console.log("\n[5] INTEGRIDAD");
try {
  const integrity = db.prepare("PRAGMA integrity_check").get();
  console.log(`  integrity_check: ${Object.values(integrity)[0]}`);
  const fk = db.prepare("PRAGMA foreign_key_check").all();
  console.log(`  foreign_key_check: ${fk.length === 0 ? "OK (sin violaciones)" : fk.length + " violaciones"}`);
} catch (e) {
  console.log(`  error: ${e.message}`);
}

/* ─── Resumen ────────────────────────────────────────────── */
console.log(`\n${"═".repeat(70)}`);
console.log(`📊  Consultas con índice: ${usesIndex}  |  Consultas con SCAN: ${scans}`);
if (scans > 0) {
  console.log(`⚠️   ${scans} consulta(s) hacen SCAN TABLE — revisar si necesitan índice.`);
}
console.log(`${"═".repeat(70)}\n`);

db.close();
