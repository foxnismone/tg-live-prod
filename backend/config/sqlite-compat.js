/**
 * ============================================================
 * SQLITE COMPAT — Adaptador better-sqlite3 → node:sqlite
 * ============================================================
 * better-sqlite3 requiere compilación nativa (node-gyp + MSBuild).
 * En entornos sin toolchain de C++ eso falla. Node >=22 trae SQLite
 * embebido (node:sqlite), así que exponemos la MISMA API que usa el
 * resto del backend para no tocar ni una línea de las rutas.
 *
 * API soportada:
 *   new Database(path, opts)
 *   db.pragma(str)            → ejecuta PRAGMA (lectura devuelve filas)
 *   db.exec(sql)              → múltiples sentencias
 *   db.prepare(sql)           → { get, all, run, iterate }
 *   db.transaction(fn)        → función envuelta en BEGIN/COMMIT
 *   db.close()
 *
 * Diferencias resueltas aquí:
 *   - node:sqlite no acepta `undefined` como parámetro → se normaliza a null.
 *   - node:sqlite no acepta booleanos → se convierten a 0/1.
 *   - better-sqlite3 devuelve { changes, lastInsertRowid } → igual.
 *   - Nombres con @param / $param / :param funcionan en ambos.
 * ============================================================
 */

"use strict";

const { DatabaseSync } = require("node:sqlite");

/** Normaliza parámetros al subconjunto que node:sqlite acepta. */
function normalizeParam(v) {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  return v;
}

function normalizeArgs(args) {
  return args.map(normalizeParam);
}

class Statement {
  constructor(stmt) {
    this._stmt = stmt;
  }

  get(...params) {
    const row = this._stmt.get(...normalizeArgs(params));
    return row === undefined ? undefined : row;
  }

  all(...params) {
    return this._stmt.all(...normalizeArgs(params));
  }

  run(...params) {
    const res = this._stmt.run(...normalizeArgs(params));
    return {
      changes: Number(res.changes ?? 0),
      lastInsertRowid: Number(res.lastInsertRowid ?? 0),
    };
  }

  *iterate(...params) {
    const rows = this._stmt.all(...normalizeArgs(params));
    for (const r of rows) yield r;
  }

  // better-sqlite3 expone estas propiedades; se dejan por compatibilidad.
  get source() { return this._stmt.source ?? ""; }
}

class Database {
  constructor(filePath, options = {}) {
    this._db = new DatabaseSync(filePath, {
      // node:sqlite: open por defecto es read-write-create
      readOnly: options.readonly === true,
    });
    this._inTransaction = false;
  }

  pragma(statement) {
    // better-sqlite3: db.pragma('journal_mode = WAL')
    // node:sqlite: no tiene pragma(), se usa exec/prepare
    const sql = `PRAGMA ${statement}`;
    const trimmed = statement.trim().toLowerCase();
    // Los PRAGMA de asignación (con '=') no devuelven filas útiles.
    if (trimmed.includes("=")) {
      this._db.exec(sql);
      return undefined;
    }
    try {
      return this._db.prepare(sql).all();
    } catch (_) {
      this._db.exec(sql);
      return undefined;
    }
  }

  exec(sql) {
    this._db.exec(sql);
    return this;
  }

  prepare(sql) {
    return new Statement(this._db.prepare(sql));
  }

  transaction(fn) {
    // better-sqlite3 devuelve una función que envuelve en transacción.
    const db = this;
    const wrapped = function (...args) {
      db._db.exec("BEGIN");
      try {
        const result = fn.apply(this, args);
        db._db.exec("COMMIT");
        return result;
      } catch (err) {
        try { db._db.exec("ROLLBACK"); } catch (_) { /* noop */ }
        throw err;
      }
    };
    // better-sqlite3 permite transaction(fn).deferred / .immediate / .exclusive
    wrapped.deferred = wrapped;
    wrapped.immediate = wrapped;
    wrapped.exclusive = wrapped;
    return wrapped;
  }

  close() {
    try { this._db.close(); } catch (_) { /* ya cerrada */ }
  }

  // better-sqlite3: db.backup(dest) → Promise
  async backup(destPath) {
    const fs = require("fs");
    const src = this._db.location?.() ?? null;
    if (src && fs.existsSync(src)) {
      fs.copyFileSync(src, destPath);
      return { totalPages: 1, remainingPages: 0 };
    }
    throw new Error("No se pudo determinar la ruta de la base de datos para backup");
  }

  // Utilidades extra que algunos módulos podrían usar
  get open() { return true; }
  get name() { return this._db.location?.() ?? ""; }
}

module.exports = Database;
module.exports.Database = Database;
module.exports.default = Database;
