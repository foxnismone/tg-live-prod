#!/usr/bin/env node
/**
 * ============================================================
 * LIMPIEZA DE DATOS DE PRUEBA
 * ============================================================
 * Elimina el residuo que dejan las suites de pruebas (productos,
 * pedidos, usuarios y sesiones de chat creados por api-tests.js y
 * e2e-tests.js) para poder trabajar sobre datos reales.
 *
 * Sólo toca registros claramente identificados como de prueba:
 *   · Productos con SKU/nombre que contienen "E2E" o "TEST"
 *   · Pedidos cuyo email contiene "example.com" o "e2e"
 *   · Usuarios con email "cliente.e2e." o dominio example.com
 *   · Sesiones de chat cuyo session_id empieza por "e2e-", "diag-" o "test-"
 *
 * Uso:
 *   node tools/clean-test-data.js           → informe (no borra nada)
 *   node tools/clean-test-data.js --apply   → elimina el residuo
 * ============================================================
 */
"use strict";

const path = require("path");
const Database = require("../backend/config/sqlite-compat");

const DB_PATH = path.resolve(__dirname, "..", "data", "ecommerce.db");
const APPLY = process.argv.includes("--apply");

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

/* ─── Detección ────────────────────────────────────────── */
const targets = {
  products: db.prepare(
    `SELECT id, sku, name, is_active FROM products
     WHERE name LIKE '%E2E%' OR name LIKE '%TEST%'
        OR sku LIKE 'E2E-%' OR sku LIKE 'TEST-%'`
  ).all(),

  orders: db.prepare(
    `SELECT id, order_number, customer_email, total FROM orders
     WHERE customer_email LIKE '%example.com' OR customer_email LIKE '%e2e%'
        OR customer_email LIKE '%test%'`
  ).all(),

  users: db.prepare(
    `SELECT id, email, name FROM users
     WHERE email LIKE 'cliente.e2e.%' OR email LIKE '%e2e%@%'
        OR email LIKE '%@example.com' OR email LIKE '%test%@%'`
  ).all(),

  chatSessions: db.prepare(
    `SELECT id, session_id FROM chat_sessions
     WHERE session_id LIKE 'e2e-%' OR session_id LIKE 'diag-%'
        OR session_id LIKE 'test-%' OR session_id LIKE 'session-%'`
  ).all(),

  carts: db.prepare(
    `SELECT id, session_id FROM carts
     WHERE session_id LIKE 'e2e-%' OR session_id LIKE 'diag-%'
        OR session_id LIKE 'test-%' OR session_id LIKE 'session-%'`
  ).all(),
};

const counts = Object.fromEntries(
  Object.entries(targets).map(([k, v]) => [k, v.length])
);

/* ─── Informe ──────────────────────────────────────────── */
console.log(`\n🧹  Residuo de pruebas en ${path.basename(DB_PATH)}\n${"─".repeat(58)}`);

for (const [kind, rows] of Object.entries(targets)) {
  if (!rows.length) {
    console.log(`  ${kind.padEnd(14)} — sin residuo`);
    continue;
  }
  console.log(`  ${kind.padEnd(14)} ${rows.length}`);
  rows.slice(0, 5).forEach((r) => {
    const label = r.name || r.email || r.order_number || r.session_id;
    console.log(`      · ${label}`);
  });
  if (rows.length > 5) console.log(`      … y ${rows.length - 5} más`);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (!APPLY) {
  console.log(`${"─".repeat(58)}`);
  console.log(`\n  Total: ${total} registros de prueba.`);
  if (total) console.log(`  Para eliminarlos:  node tools/clean-test-data.js --apply\n`);
  else console.log("  Nada que limpiar. ✅\n");
  db.close();
  process.exit(0);
}

/* ─── Eliminación ──────────────────────────────────────── */
if (!total) {
  console.log(`\n  Nada que limpiar. ✅\n`);
  db.close();
  process.exit(0);
}

console.log(`${"─".repeat(58)}\n\n  Eliminando…`);

const deleted = {};
db.transaction(() => {
  // El orden importa: primero lo que depende de otras tablas.
  const stmts = {
    chatSessions: "DELETE FROM chat_messages WHERE session_id = ?",
    carts: "DELETE FROM carts WHERE id = ?",
    products: "DELETE FROM products WHERE id = ?",
    orders: "DELETE FROM payments WHERE order_id = ?",
    users: "DELETE FROM users WHERE id = ?",
  };

  // Mensajes de chat antes que las sesiones
  for (const s of targets.chatSessions) {
    db.prepare(stmts.chatSessions).run(s.session_id);
  }
  deleted.chatSessions = db.prepare(
    `DELETE FROM chat_sessions
     WHERE session_id LIKE 'e2e-%' OR session_id LIKE 'diag-%'
        OR session_id LIKE 'test-%' OR session_id LIKE 'session-%'`
  ).run().changes;

  deleted.carts = db.prepare(
    `DELETE FROM carts
     WHERE session_id LIKE 'e2e-%' OR session_id LIKE 'diag-%'
        OR session_id LIKE 'test-%' OR session_id LIKE 'session-%'`
  ).run().changes;

  // Imágenes y variantes de productos de prueba
  for (const p of targets.products) {
    db.prepare("DELETE FROM product_images WHERE product_id = ?").run(p.id);
    db.prepare("DELETE FROM product_variants WHERE product_id = ?").run(p.id);
    db.prepare("DELETE FROM inventory_logs WHERE product_id = ?").run(p.id);
  }
  deleted.products = db.prepare(
    `DELETE FROM products
     WHERE name LIKE '%E2E%' OR name LIKE '%TEST%'
        OR sku LIKE 'E2E-%' OR sku LIKE 'TEST-%'`
  ).run().changes;

  // Pagos antes que pedidos
  for (const o of targets.orders) {
    db.prepare("DELETE FROM payments WHERE order_id = ?").run(o.id);
  }
  deleted.orders = db.prepare(
    `DELETE FROM orders
     WHERE customer_email LIKE '%example.com' OR customer_email LIKE '%e2e%'
        OR customer_email LIKE '%test%'`
  ).run().changes;

  deleted.users = db.prepare(
    `DELETE FROM users
     WHERE email LIKE 'cliente.e2e.%' OR email LIKE '%e2e%@%'
        OR email LIKE '%@example.com' OR email LIKE '%test%@%'`
  ).run().changes;
})();

console.log("");
for (const [k, v] of Object.entries(deleted)) {
  console.log(`  ${k.padEnd(14)} eliminados: ${v}`);
}

/* ─── Estado final ─────────────────────────────────────── */
const final = {
  productosActivos: db.prepare("SELECT COUNT(*) c FROM products WHERE is_active = 1").get().c,
  productosTotal: db.prepare("SELECT COUNT(*) c FROM products").get().c,
  pedidos: db.prepare("SELECT COUNT(*) c FROM orders").get().c,
  usuarios: db.prepare("SELECT COUNT(*) c FROM users").get().c,
  integridad: db.prepare("PRAGMA integrity_check").all()[0].integrity_check,
};

console.log(`\n${"─".repeat(58)}`);
console.log("  Estado final de la base de datos:");
console.log(`    Productos activos: ${final.productosActivos}`);
console.log(`    Productos totales: ${final.productosTotal}`);
console.log(`    Pedidos:           ${final.pedidos}`);
console.log(`    Usuarios:          ${final.usuarios}`);
console.log(`    Integridad:        ${final.integridad}`);
console.log("");

db.close();
