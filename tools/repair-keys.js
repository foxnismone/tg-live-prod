#!/usr/bin/env node
/**
 * ============================================================
 * HERRAMIENTA — Gestión de claves de API del taller
 * ============================================================
 * Permite crear, listar y revocar claves para que el software de
 * taller externo suba estados al sitio.
 *
 * Uso:
 *   node tools/repair-keys.js create "Nombre del software"
 *   node tools/repair-keys.js list
 *   node tools/repair-keys.js revoke <id>
 *
 * El secreto solo se muestra UNA vez, al crearlo.
 * ============================================================
 */
"use strict";

const path = require("path");
const crypto = require("crypto");
const Database = require(path.join(__dirname, "..", "backend", "config", "sqlite-compat"));

const DB_PATH = path.join(__dirname, "..", "data", "ecommerce.db");
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const hashKey = (key) => crypto.createHash("sha256").update(key).digest("hex");

function generateKey() {
  const prefix = crypto.randomBytes(4).toString("hex");
  const secret = crypto.randomBytes(24).toString("hex");
  return { key: `tgrep_${prefix}_${secret}`, prefix };
}

const cmd = process.argv[2];

if (cmd === "create") {
  const name = process.argv[3] || "Software de taller";
  const scopes = process.argv[4] || "repairs:read,repairs:write";

  const { key, prefix } = generateKey();
  db.prepare(
    `INSERT INTO repair_api_keys (name, key_hash, key_prefix, scopes)
     VALUES (?, ?, ?, ?)`
  ).run(name, hashKey(key), prefix, scopes);

  console.log(`\n🔑  Clave creada para: ${name}\n`);
  console.log(`   ${key}\n`);
  console.log("   ⚠️  GUARDA ESTA CLAVE AHORA. No se puede recuperar después.");
  console.log("       El servidor solo guarda su hash.\n");
  console.log("   Úsala en la cabecera:  X-API-Key: " + key + "\n");

} else if (cmd === "list") {
  const rows = db.prepare(
    `SELECT id, name, key_prefix, scopes, is_active, last_used_at, created_at
     FROM repair_api_keys ORDER BY id`
  ).all();

  if (!rows.length) {
    console.log("\n  No hay claves registradas.\n");
  } else {
    console.log(`\n🔑  Claves de API (${rows.length})\n`);
    for (const r of rows) {
      console.log(`   [${r.id}] ${r.name}`);
      console.log(`       prefijo: ${r.key_prefix}…  |  scopes: ${r.scopes}`);
      console.log(`       estado: ${r.is_active ? "activa" : "REVOCADA"}  |  último uso: ${r.last_used_at || "nunca"}`);
      console.log(`       creada: ${r.created_at}\n`);
    }
  }

} else if (cmd === "revoke") {
  const id = Number(process.argv[3]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error("Uso: node tools/repair-keys.js revoke <id>");
    process.exit(1);
  }
  const r = db.prepare("UPDATE repair_api_keys SET is_active = 0 WHERE id = ?").run(id);
  console.log(r.changes ? `\n✅ Clave ${id} revocada.\n` : `\n⚠️  No existe la clave ${id}.\n`);

} else {
  console.log(`
🔧  Gestión de claves de API del taller

  node tools/repair-keys.js create "Nombre del software" [scopes]
  node tools/repair-keys.js list
  node tools/repair-keys.js revoke <id>

  Scopes disponibles: repairs:read, repairs:write
`);
}

db.close();
