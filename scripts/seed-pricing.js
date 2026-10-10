#!/usr/bin/env node
/**
 * ============================================================
 * SEED — Modelo de precios y disponibilidad estilo retail chileno
 * ============================================================
 * Adopta el patrón de pc Factory:
 *   · Precio transferencia/débito (más bajo) como gancho principal
 *   · Precio con tarjeta de crédito (referencia alta)
 *   · Cuotas sin interés (hasta 24 según tramo de precio)
 *   · Stock por tienda + retiro inmediato
 *
 * Idempotente: solo actualiza, no duplica.
 * Uso:  node scripts/seed-pricing.js
 * ============================================================
 */
"use strict";

const path = require("path");
const Database = require("../backend/config/sqlite-compat");

const DB_PATH = path.resolve(__dirname, "..", "data", "ecommerce.db");

/* ─── Tienda (módulo configurable) ─────────────────────── */
// TecnoGamer tiene UNA sola tienda física.
const STORES = [
  { id: "san-diego", name: "TecnoGamer San Diego", region: "RM" },
];

/**
 * Cuotas sin interés según tramo de precio (patrón retail chileno).
 * A mayor precio, más cuotas disponibles.
 */
function installmentsFor(price) {
  if (price >= 1000000) return 24;
  if (price >= 500000)  return 18;
  if (price >= 200000)  return 12;
  if (price >= 100000)  return 6;
  if (price >= 50000)   return 3;
  return 0;
}

/**
 * Precio de transferencia: descuento típico del retail chileno
 * cuando se paga con transferencia o tarjeta de débito.
 */
function cashPriceFor(price, sku) {
  // Descuento determinista por producto (8%–13%) para que sea estable
  const seed = sku.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const pct = 0.08 + (seed % 6) / 100;      // 8% .. 13%
  return Math.round((price * (1 - pct)) / 10) * 10;
}

/**
 * Stock de la tienda única. Determinista para que no cambie entre ejecuciones.
 * Con una sola tienda, todo el stock disponible está en ella.
 */
function storeStockFor(product) {
  const total = product.stock_quantity;
  if (total <= 0) return null;
  return { [STORES[0].id]: total };
}

/* ─── Ejecución ────────────────────────────────────────── */
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const products = db.prepare("SELECT id, sku, name, price, stock_quantity FROM products WHERE is_active = 1").all();

const update = db.prepare(
  `UPDATE products
   SET cash_price = ?, installments = ?, pickup_available = ?, store_stock = ?
   WHERE id = ?`
);

let updated = 0;
let withInstallments = 0;
let withPickup = 0;

db.transaction(() => {
  for (const p of products) {
    const cash = cashPriceFor(p.price, p.sku);
    const inst = installmentsFor(p.price);
    const storeStock = storeStockFor(p);
    const pickup = storeStock && Object.keys(storeStock).length > 0 ? 1 : 0;

    update.run(cash, inst, pickup, storeStock ? JSON.stringify(storeStock) : null, p.id);

    updated++;
    if (inst > 0) withInstallments++;
    if (pickup) withPickup++;
  }
})();

/* ─── Informe ──────────────────────────────────────────── */
const sample = db.prepare(
  `SELECT name, price, cash_price, installments, stock_quantity, store_stock
   FROM products WHERE is_active = 1 AND installments > 0
   ORDER BY price DESC LIMIT 5`
).all();

console.log(`\n✅  Modelo de precios aplicado a ${updated} productos`);
console.log(`   Con cuotas sin interés: ${withInstallments}`);
console.log(`   Con retiro en tienda:   ${withPickup}`);
console.log(`   Tiendas configuradas:   ${STORES.length}`);

console.log(`\n📋  Ejemplos (los 5 más caros):`);
for (const s of sample) {
  const cash = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(s.cash_price);
  const credit = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(s.price);
  const cuota = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.round(s.cash_price / s.installments));
  const stores = s.store_stock ? Object.keys(JSON.parse(s.store_stock)).length : 0;
  console.log(`\n   ${s.name.slice(0, 46)}`);
  console.log(`     Transferencia: ${cash}`);
  console.log(`     Crédito:       ${credit}`);
  console.log(`     ${s.installments} cuotas de ${cuota}`);
  console.log(`     Retiro en ${stores} tienda(s) · ${s.stock_quantity} unidades`);
}

console.log("");
db.close();
