#!/usr/bin/env node
/**
 * ============================================================
 * VERIFICAR TEMA — resuelve la cascada CSS y comprueba contraste
 * ============================================================
 * No usa navegador: parsea las hojas en el MISMO orden en que las
 * carga el HTML, resuelve las variables :root y calcula el valor
 * ganador de cada propiedad por especificidad + orden.
 *
 * Detecta el fallo clásico: texto claro sobre fondo claro (o al
 * revés), que es exactamente lo que hace que un tema no se aplique.
 *
 * Uso:  node tools/verify-theme.js
 * ============================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CSS_DIR = path.resolve(__dirname, "..", "frontend", "assets", "css");

/* Orden EXACTO en que index.html carga las hojas */
const SHEETS = ["main.css", "retail.css", "theme-pcf.css"];

/* ─── Parser mínimo de CSS ─────────────────────────────── */
function parseRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (!sel || sel.startsWith("@")) continue;
    const decls = {};
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      const k = d.slice(0, i).trim();
      const v = d.slice(i + 1).trim();
      if (k && v) decls[k] = v;
    }
    if (Object.keys(decls).length) rules.push({ sel, decls });
  }
  return rules;
}

/* ─── Especificidad (a,b,c) ────────────────────────────── */
function specificity(sel) {
  const s = sel.split(",")[0].trim();
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+(\([^)]*\))?/g) || []).length;
  const tags = (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 10000 + classes * 100 + tags;
}

/* ─── Resolver var() ───────────────────────────────────── */
function resolveVars(value, vars, depth = 0) {
  if (depth > 10 || !value) return value;
  return value.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name, fb) => {
    const v = vars[name];
    if (v !== undefined) return resolveVars(v, vars, depth + 1);
    return fb ? resolveVars(fb.trim(), vars, depth + 1) : "";
  });
}

/* ─── Color → RGB ──────────────────────────────────────── */
function toRgb(color) {
  if (!color) return null;
  let c = color.trim().toLowerCase();
  // Tomar el primer color si hay gradiente
  const grad = c.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/g);
  if (grad && c.includes("gradient")) c = grad[grad.length - 1];

  let m = c.match(/^#([0-9a-f]{3})$/);
  if (m) return [0, 1, 2].map(i => parseInt(m[1][i] + m[1][i], 16));
  m = c.match(/^#([0-9a-f]{6})$/);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = c.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  if (c === "white") return [255, 255, 255];
  if (c === "black") return [0, 0, 0];
  if (c === "transparent") return null;
  return null;
}

/* ─── Contraste WCAG ───────────────────────────────────── */
function luminance([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ─── Cargar y resolver ────────────────────────────────── */
const vars = {};
const allRules = [];

for (const file of SHEETS) {
  const p = path.join(CSS_DIR, file);
  if (!fs.existsSync(p)) { console.log(`⚠  Falta ${file}`); continue; }
  const css = fs.readFileSync(p, "utf8");

  // Variables :root (el orden importa: la última gana)
  for (const m of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const d of m[1].split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      const k = d.slice(0, i).trim();
      const v = d.slice(i + 1).trim();
      if (k.startsWith("--") && v) vars[k] = v;
    }
  }
  for (const r of parseRules(css)) {
    allRules.push({ ...r, order: allRules.length, file });
  }
}

// Resolver todas las variables (pueden referenciar otras)
for (let pass = 0; pass < 5; pass++) {
  for (const k of Object.keys(vars)) vars[k] = resolveVars(vars[k], vars);
}

/* ─── Calcular valor ganador para un selector+propiedad ── */
function resolve(selector, prop, pseudoState = "") {
  const target = pseudoState ? `${selector}${pseudoState}` : selector;
  // `background-color` también puede venir de la taquigrafía `background`
  const props = prop === "background-color" ? ["background-color", "background"] : [prop];
  let best = null;

  for (const r of allRules) {
    const sels = r.sel.split(",").map(s => s.trim());
    const matches = sels.some(s =>
      s === target || s === selector ||
      (s.endsWith(target) && !s.includes(" ") && !s.includes(">"))
    );
    if (!matches) continue;

    for (const p of props) {
      if (r.decls[p] === undefined) continue;
      const spec = specificity(r.sel);
      if (!best || spec > best.spec || (spec === best.spec && r.order > best.order)) {
        best = { value: r.decls[p], spec, order: r.order, file: r.file, sel: r.sel, from: p };
      }
    }
  }
  if (!best) return null;
  return { ...best, resolved: resolveVars(best.value, vars) };
}

/* ─── Comprobaciones ───────────────────────────────────── */
const CHECKS = [
  // [descripción, selector, prop, selector-de-fondo, esperado]
  ["Cuerpo de la página",      "body",                    "background-color", "body"],
  ["Cuerpo (texto)",           "body",                    "color",            null],
  ["Barra de anuncios",        ".topbar",                 "background-color", null],
  ["Barra de anuncios (texto)",".topbar",                 "color",            null],
  ["Header",                   ".header",                 "background-color", null],
  ["Navegación (fondo)",       ".navbar",                 "background-color", null],
  ["Navegación (enlace)",      ".navbar__link",           "color",            null],
  ["Navegación (activo)",      ".navbar__link.is-active", "color",            null],
  ["Tarjeta de producto",      ".product-card",           "background-color", null],
  ["Precio transferencia",     ".price-cash__value",      "color",            null],
  ["Etiqueta de precio",       ".price-cash__label",      "color",            null],
  ["Precio normal (tachado)",  ".price-normal",           "color",            null],
  ["Cuotas",                   ".installments",           "color",            null],
  ["Botón primario (fondo)",   ".btn--primary",           "background-color", null],
  ["Botón primario (texto)",   ".btn--primary",           "color",            null],
  ["Botón secundario (fondo)", ".btn--secondary",         "background-color", null],
  ["Botón secundario (texto)", ".btn--secondary",         "color",            null],
  ["Filtros (fondo)",          ".filters",                "background-color", null],
  ["Input (fondo)",            ".input",                  "background-color", null],
  ["Input (texto)",            ".input",                  "color",            null],
  ["Footer (fondo)",           ".footer",                 "background-color", null],
  ["Footer (enlace)",          ".footer__link",           "color",            null],
  ["Carrito lateral",          ".drawer",                 "background-color", null],
  ["Modal",                    ".modal",                  "background-color", null],
  ["Spinner (borde)",          ".spinner",                "border-color",     null],
];

console.log("\n🎨  VERIFICACIÓN DEL TEMA — cascada resuelta\n" + "═".repeat(72));
console.log(`Hojas cargadas en orden: ${SHEETS.join(" → ")}\n`);

let problems = 0;
let lastBg = null;

for (const [label, sel, prop, bgRef] of CHECKS) {
  const r = resolve(sel, prop);
  if (!r) {
    console.log(`  ⚪ ${label.padEnd(26)} (sin valor)`);
    continue;
  }
  const rgb = toRgb(r.resolved);
  const hex = rgb ? "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("") : r.resolved.slice(0, 22);

  // ¿Viene del tema claro o quedó del tema oscuro?
  const fromTheme = r.file === "theme-pcf.css";
  const mark = fromTheme ? "🟢" : (r.file === "retail.css" ? "🟡" : "⚪");

  console.log(`  ${mark} ${label.padEnd(26)} ${hex.padEnd(9)} ← ${r.file}`);
  if (prop === "background-color") lastBg = rgb;
}

/* ─── Contraste texto/fondo de los pares clave ─────────── */
console.log("\n" + "─".repeat(72));
console.log("CONTRASTE (WCAG AA requiere ≥ 4.5 para texto normal)\n");

const PAIRS = [
  ["Cuerpo",            "body",              "background-color", "body",              "color"],
  ["Barra anuncios",    ".topbar",           "background-color", ".topbar",           "color"],
  ["Navegación",        ".navbar",           "background-color", ".navbar__link",     "color"],
  ["Nav activo",        ".navbar",           "background-color", ".navbar__link.is-active", "color"],
  ["Tarjeta producto",  ".product-card",     "background-color", ".price-cash__value","color"],
  ["Botón primario",    ".btn--primary",     "background-color", ".btn--primary",     "color"],
  ["Botón secundario",  ".btn--secondary",   "background-color", ".btn--secondary",   "color"],
  ["Input",             ".input",            "background-color", ".input",            "color"],
  ["Footer",            ".footer",           "background-color", ".footer__link",     "color"],
];

for (const [label, bgSel, bgProp, fgSel, fgProp] of PAIRS) {
  const bgR = resolve(bgSel, bgProp);
  const fgR = resolve(fgSel, fgProp);
  const bg = bgR ? toRgb(bgR.resolved) : null;
  const fg = fgR ? toRgb(fgR.resolved) : null;

  if (!bg || !fg) {
    console.log(`  ⚪ ${label.padEnd(20)} no se pudo calcular`);
    continue;
  }
  const ratio = contrast(bg, fg);
  const ok = ratio >= 4.5;
  const okLarge = ratio >= 3.0;
  const verdict = ok ? "✅ AA" : (okLarge ? "🟡 AA-grande" : "❌ INSUFICIENTE");
  if (!ok) problems++;
  console.log(`  ${verdict.padEnd(16)} ${label.padEnd(20)} ${ratio.toFixed(2)}:1`);
}

/* ─── Resumen ──────────────────────────────────────────── */
const navBg = resolve(".navbar", "background-color");
const bodyBg = resolve("body", "background-color");
const navRgb = navBg ? toRgb(navBg.resolved) : null;
const bodyRgb = bodyBg ? toRgb(bodyBg.resolved) : null;

console.log("\n" + "═".repeat(72));
const isLightBody = bodyRgb && luminance(bodyRgb) > 0.5;
const isDarkNav = navRgb && luminance(navRgb) < 0.3;

console.log(`  Cuerpo claro (estilo retail):     ${isLightBody ? "✅ SÍ" : "❌ NO"}`);
console.log(`  Navegación oscura (contraste):    ${isDarkNav ? "✅ SÍ" : "❌ NO"}`);
console.log(`  Variables resueltas:              ${Object.keys(vars).length}`);
console.log(`  Pares con contraste insuficiente: ${problems}`);

if (isLightBody && isDarkNav && problems === 0) {
  console.log("\n  ✅ El tema se aplica correctamente y es accesible.\n");
  process.exit(0);
} else {
  console.log("\n  ⚠  Revisar los puntos marcados arriba.\n");
  process.exit(1);
}
