/**
 * ============================================================
 * UTILIDADES — RUT chileno y normalización de datos del taller
 * ============================================================
 * El RUT se usa como factor de autenticación para consultar el
 * estado de una reparación. Debe normalizarse SIEMPRE igual,
 * porque "12.345.678-9", "12345678-9" y "123456789" son el mismo
 * RUT y el cliente escribirá cualquiera de las tres formas.
 * ============================================================
 */

"use strict";

const crypto = require("crypto");

/**
 * Limpia un RUT: quita puntos, guiones y espacios. Deja solo
 * dígitos y la letra K final en mayúscula.
 *   "12.345.678-9" → "123456789"
 *   "12.345.678-k" → "12345678K"
 */
function normalizeRut(input) {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/[.\-\s]/g, "")
    .toUpperCase()
    .trim();
}

/**
 * Valida un RUT chileno con el algoritmo módulo 11.
 * Acepta el RUT ya normalizado o con formato.
 */
function isValidRut(input) {
  const rut = normalizeRut(input);
  if (rut.length < 8 || rut.length > 9) return false;

  const body = rut.slice(0, -1);
  const dv = rut.slice(-1);

  if (!/^\d+$/.test(body)) return false;

  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  let expected;
  if (remainder === 11) expected = "0";
  else if (remainder === 10) expected = "K";
  else expected = String(remainder);

  return dv === expected;
}

/**
 * Formatea un RUT para mostrarlo: 123456789 → "12.345.678-9"
 */
function formatRut(input) {
  const rut = normalizeRut(input);
  if (rut.length < 2) return rut;
  const body = rut.slice(0, -1);
  const dv = rut.slice(-1);
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${withDots}-${dv}`;
}

/**
 * Normaliza un número de serie: sin espacios, sin guiones, mayúsculas.
 * Los números de serie se dictan por teléfono y el cliente los escribe
 * con espacios o en minúsculas.
 */
function normalizeSerial(input) {
  if (input === null || input === undefined) return "";
  return String(input).replace(/[\s\-_]/g, "").toUpperCase().trim();
}

/**
 * Normaliza un número de orden de trabajo.
 * Acepta las formas en que un cliente realmente lo escribe:
 *   "OT-2026-000123" → "OT-2026-000123"
 *   "ot 2026 000123" → "OT-2026-000123"
 *   "OT2026000123"   → "OT-2026-000123"
 *   "2026-000123"    → "OT-2026-000123"  (sin el prefijo)
 * El separador interno siempre es guion, porque así se almacena.
 */
function normalizeWorkOrder(input) {
  if (input === null || input === undefined) return "";
  let v = String(input).replace(/\s/g, "").toUpperCase().trim();
  if (!v) return "";

  // Quitar todos los separadores para analizar la forma
  const compact = v.replace(/[^A-Z0-9]/g, "");

  // "OT2026000123" → "OT-2026-000123"
  let m = compact.match(/^OT(\d{4})(\d{1,6})$/);
  if (m) return `OT-${m[1]}-${m[2].padStart(6, "0")}`;

  // "2026000123" → "OT-2026-000123" (sin prefijo OT)
  m = compact.match(/^(\d{4})(\d{1,6})$/);
  if (m) return `OT-${m[1]}-${m[2].padStart(6, "0")}`;

  // Ya viene con guiones (u otra forma): normalizar separadores a guion
  return v.replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Normaliza un nombre completo para comparación laxa:
 * minúsculas, sin acentos, sin espacios dobles, ordenado por palabras.
 * Se usa como factor adicional (no como secreto): permite tolerar
 * "Pérez, Juan" vs "juan perez".
 */
function normalizeName(input) {
  if (input === null || input === undefined) return "";
  return String(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // quitar acentos
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/**
 * Hash del RUT para auditoría. NUNCA se guarda el RUT en claro en la
 * tabla de consultas: solo su hash, para poder contar consultas por
 * persona sin almacenar datos personales.
 */
function hashRut(rut, salt) {
  return crypto
    .createHash("sha256")
    .update(normalizeRut(rut) + (salt || ""))
    .digest("hex");
}

/**
 * Comparación en tiempo constante para evitar ataques de temporización
 * al validar claves de API.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  normalizeRut,
  isValidRut,
  formatRut,
  normalizeSerial,
  normalizeWorkOrder,
  normalizeName,
  hashRut,
  safeEqual,
};
