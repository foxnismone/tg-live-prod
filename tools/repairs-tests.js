#!/usr/bin/env node
/**
 * ============================================================
 * PRUEBAS — Módulo de taller / seguimiento de reparaciones
 * ============================================================
 * Cubre el flujo completo del cliente y del taller, más la seguridad
 * de los tres factores de autenticación.
 *
 * Uso:  node tools/repairs-tests.js [baseUrl]
 * ============================================================
 */
"use strict";

const BASE = process.argv[2] || "http://localhost:3000";
const H = { "Content-Type": "application/json", "X-Load-Test": "1" };

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✅  ${name}`); }
  else { fail++; failures.push({ name, detail }); console.log(`  ❌  ${name}${detail ? "  →  " + String(detail).slice(0, 160) : ""}`); }
  return !!cond;
}

async function req(method, p, { body, headers = {}, token, apiKey } = {}) {
  const opts = { method, headers: { ...H, ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (apiKey) opts.headers["X-API-Key"] = apiKey;
  if (body !== undefined) opts.body = JSON.stringify(body);
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

/* ─── RUT de prueba con dígito verificador válido ─────────── */
function makeRut(body) {
  let sum = 0, mult = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const rem = 11 - (sum % 11);
  const dv = rem === 11 ? "0" : rem === 10 ? "K" : String(rem);
  return body + dv;
}

(async () => {
  console.log(`\n🛠️   PRUEBAS DEL MÓDULO DE TALLER  →  ${BASE}\n${"═".repeat(70)}`);

  /* ══ 1. INFO PÚBLICA ══════════════════════════════════════ */
  console.log("\n[1] INFORMACIÓN PÚBLICA DEL TALLER");
  let r = await req("GET", "/api/v1/repairs/info");
  check("GET /repairs/info → 200", r.status === 200, `status=${r.status}`);
  check("Devuelve nombre del taller", !!r.json?.name, r.json?.name);
  check("Devuelve los 9 estados", (r.json?.statuses || []).length === 9, `${(r.json?.statuses || []).length} estados`);
  check("No expone datos sensibles", !r.text.includes("key_hash") && !r.text.includes("api"), "sin filtraciones");

  /* ══ 2. LOGIN Y CLAVE DE API ══════════════════════════════ */
  console.log("\n[2] AUTENTICACIÓN");
  r = await req("POST", "/api/v1/auth/login", { body: { email: "admin@tecnogamer.local", password: "Admin123!" } });
  const token = r.json?.accessToken || r.json?.token;
  check("Login de admin", !!token, token ? "token obtenido" : "sin token");

  r = await req("POST", "/api/v1/admin/repair-keys", { token, body: { name: "Suite de pruebas" } });
  check("Crear clave de API", r.status === 201 && !!r.json?.key, `status=${r.status}`);
  const apiKey = r.json?.key;
  const keyId = r.json?.keyPrefix;

  check("La clave tiene el formato esperado", /^tgrep_[a-f0-9]{8}_[a-f0-9]{48}$/.test(apiKey || ""), apiKey?.slice(0, 20));

  /* ══ 3. SEGURIDAD DE LA API ═══════════════════════════════ */
  console.log("\n[3] SEGURIDAD DE LA API");
  r = await req("GET", "/api/v1/repairs-api/orders");
  check("Sin X-API-Key → 401", r.status === 401, `status=${r.status}`);

  r = await req("GET", "/api/v1/repairs-api/orders", { apiKey: "tgrep_falso_falso" });
  check("Clave falsa → 401", r.status === 401, `status=${r.status}`);

  r = await req("GET", "/api/v1/repairs-api/orders", { apiKey: apiKey.slice(0, -1) });
  check("Clave truncada → 401", r.status === 401, `status=${r.status}`);

  r = await req("GET", "/api/v1/admin/repairs");
  check("Admin sin token → 401", r.status === 401, `status=${r.status}`);

  r = await req("GET", "/api/v1/admin/repairs-alerts");
  check("Alertas sin token → 401", r.status === 401, `status=${r.status}`);

  /* ══ 4. CREAR ORDEN VÍA API ═══════════════════════════════ */
  console.log("\n[4] CREAR ORDEN DESDE EL SOFTWARE DE TALLER");
  const rut1 = makeRut("13579246");
  const serial1 = "SN-TEST-" + Date.now();
  const extRef = "EXT-" + Date.now();

  r = await req("POST", "/api/v1/repairs-api/orders", {
    apiKey,
    body: {
      externalRef: extRef, rut: rut1, serialNumber: serial1,
      customerName: "Cliente de Prueba Taller",
      customerEmail: "taller@example.com", customerPhone: "+56 9 1111 2222",
      deviceType: "Notebook", deviceBrand: "TestBrand", deviceModel: "ModeloX",
      reportedIssue: "No enciende", status: "received", priority: "normal",
      technician: "Técnico Test", estimatedCost: 25000,
      note: "Equipo recibido en mostrador.",
    },
  });
  check("Crear orden → 201", r.status === 201, `status=${r.status} ${r.json?.error || ""}`);
  const ot = r.json?.order?.workOrder;
  check("Devuelve número de orden", /^OT-\d{4}-\d{6}$/.test(ot || ""), ot);
  check("Estado inicial correcto", r.json?.order?.status === "received", r.json?.order?.status);

  r = await req("POST", "/api/v1/repairs-api/orders", {
    apiKey,
    body: { externalRef: extRef, rut: rut1, serialNumber: serial1, customerName: "Cliente de Prueba Taller", status: "diagnosing", note: "Iniciando diagnóstico." },
  });
  check("Upsert por externalRef no duplica", r.status === 200 && r.json?.created === false, `status=${r.status}, created=${r.json?.created}`);
  check("Mismo número de orden", r.json?.order?.workOrder === ot, r.json?.order?.workOrder);

  /* ══ 5. VALIDACIONES DE LA API ════════════════════════════ */
  console.log("\n[5] VALIDACIONES DE LA API");
  r = await req("POST", "/api/v1/repairs-api/orders", { apiKey, body: { rut: "1", serialNumber: "X", customerName: "Y" } });
  check("RUT inválido rechazado", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/v1/repairs-api/orders", { apiKey, body: { rut: makeRut("11111111"), customerName: "X" } });
  check("Serie faltante rechazada", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/v1/repairs-api/orders", { apiKey, body: { rut: makeRut("11111111"), serialNumber: "S1" } });
  check("Nombre faltante rechazado", r.status === 400, `status=${r.status}`);

  r = await req("POST", `/api/v1/repairs-api/orders/${ot}/events`, { apiKey, body: { status: "estado_inventado" } });
  check("Estado inválido rechazado", r.status === 400, `status=${r.status}`);

  /* ══ 6. CONSULTA DEL CLIENTE ══════════════════════════════ */
  console.log("\n[6] CONSULTA DEL CLIENTE (3 FACTORES)");

  // 6a. Los 3 datos exactos
  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: ot, rut: rut1, serialNumber: serial1 },
  });
  check("3 datos correctos → 200", r.status === 200, `status=${r.status} ${r.json?.error || ""}`);
  check("Devuelve la orden correcta", r.json?.repair?.workOrder === ot, r.json?.repair?.workOrder);
  check("Incluye progreso", typeof r.json?.repair?.progress?.percent === "number", r.json?.repair?.progress?.percent);
  check("Incluye historial", Array.isArray(r.json?.repair?.timeline) && r.json.repair.timeline.length > 0, `${r.json?.repair?.timeline?.length} eventos`);

  // 6b. Formatos alternativos de los mismos datos
  r = await req("POST", "/api/v1/repairs/track", {
    body: {
      workOrder: ot.toLowerCase(),
      rut: rut1.slice(0, -1) + "-" + rut1.slice(-1),
      serialNumber: serial1.toLowerCase().replace(/-/g, " "),
    },
  });
  check("Acepta formatos alternativos", r.status === 200, `status=${r.status}`);

  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: "ot " + ot.replace("OT-", ""), rut: rut1.replace(/(\d)(?=(\d{3})+$)/g, "$1."), serialNumber: serial1 },
  });
  check("Acepta orden con espacios y RUT con puntos", r.status === 200, `status=${r.status}`);

  // 6c. RUT inválido (formato)
  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: ot, rut: "12345678-0", serialNumber: serial1 },
  });
  check("RUT con DV incorrecto → 400", r.status === 400 && r.json?.code === "INVALID_RUT", `status=${r.status}`);

  // 6d. Datos que no coinciden
  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: ot, rut: makeRut("22222222"), serialNumber: serial1 },
  });
  check("RUT de otra persona → 404", r.status === 404, `status=${r.status}`);

  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: ot, rut: rut1, serialNumber: "SERIE-EQUIVOCADA" },
  });
  check("Serie equivocada → 404", r.status === 404, `status=${r.status}`);

  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: "OT-2099-999999", rut: rut1, serialNumber: serial1 },
  });
  check("Orden inexistente → 404", r.status === 404, `status=${r.status}`);

  // 6e. El mensaje de error no revela CUÁL dato falló
  const errMsg = r.json?.error || "";
  check("El error no revela qué dato falló",
    !/rut/i.test(errMsg.replace(/RUT y el número de serie/i, "")) || errMsg.includes("Verifica"),
    errMsg.slice(0, 80));

  // 6f. Campos faltantes
  r = await req("POST", "/api/v1/repairs/track", { body: { workOrder: ot } });
  check("Campos faltantes → 400 con detalle", r.status === 400 && Array.isArray(r.json?.missing), `status=${r.status}`);

  // 6g. Cuarto factor: nombre
  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: ot, rut: rut1, serialNumber: serial1, customerName: "Cliente de Prueba Taller" },
  });
  check("Nombre correcto aceptado", r.status === 200, `status=${r.status}`);

  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: ot, rut: rut1, serialNumber: serial1, customerName: "Otra Persona Distinta" },
  });
  check("Nombre incorrecto → 404", r.status === 404, `status=${r.status}`);

  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: ot, rut: rut1, serialNumber: serial1, customerName: "taller prueba de cliente" },
  });
  check("Nombre tolerante a orden de palabras", r.status === 200, `status=${r.status}`);

  /* ══ 7. ENMASCARADO DE DATOS ══════════════════════════════ */
  console.log("\n[7] PROTECCIÓN DE DATOS EN LA RESPUESTA");
  r = await req("POST", "/api/v1/repairs/track", { body: { workOrder: ot, rut: rut1, serialNumber: serial1 } });
  const repairResp = r.json?.repair;
  check("RUT viene enmascarado", repairResp?.rutMasked?.includes("•"), repairResp?.rutMasked);
  check("Serie viene enmascarada", repairResp?.device?.serialNumber?.includes("•"), repairResp?.device?.serialNumber);
  check("No expone notas internas", !r.text.includes("internalNote") && !r.text.includes("internal_note"), "sin notas internas");
  check("No expone el RUT completo", !r.text.includes(rut1), "RUT no expuesto en claro");

  /* ══ 8. GESTIÓN DESDE EL PANEL ADMIN ══════════════════════ */
  console.log("\n[8] GESTIÓN DEL OPERADOR");
  r = await req("GET", "/api/v1/admin/repairs", { token });
  check("Listar órdenes → 200", r.status === 200, `status=${r.status}`);
  check("La orden creada aparece", (r.json?.repairs || []).some(x => x.workOrder === ot), `${r.json?.pagination?.total} órdenes`);

  r = await req("GET", "/api/v1/admin/repairs/stats", { token });
  check("Estadísticas → 200", r.status === 200, `status=${r.status}`);
  check("Stats incluye totales", typeof r.json?.stats?.total === "number", `total=${r.json?.stats?.total}`);
  check("Stats incluye consultas", typeof r.json?.stats?.lookupsToday === "number", `consultas=${r.json?.stats?.lookupsToday}`);

  const detail = await req("GET", "/api/v1/admin/repairs", { token });
  const created = (detail.json?.repairs || []).find(x => x.workOrder === ot);
  check("Encontrada para detalle", !!created, created?.id);

  if (created) {
    r = await req("GET", `/api/v1/admin/repairs/${created.id}`, { token });
    check("Detalle → 200", r.status === 200, `status=${r.status}`);
    check("Detalle incluye eventos", Array.isArray(r.json?.events), `${r.json?.events?.length} eventos`);
    check("Detalle incluye auditoría de consultas", Array.isArray(r.json?.lookups), `${r.json?.lookups?.length} consultas`);
    check("El operador SÍ ve el RUT completo", /\d/.test(r.json?.repair?.rut || ""), r.json?.repair?.rut);

    r = await req("POST", `/api/v1/admin/repairs/${created.id}/events`, {
      token, body: { status: "in_repair", note: "Trabajando en el equipo.", technician: "Técnico Test" },
    });
    check("Añadir evento → 200", r.status === 200, `status=${r.status}`);

    // El cliente debe ver el nuevo estado
    const after = await req("POST", "/api/v1/repairs/track", { body: { workOrder: ot, rut: rut1, serialNumber: serial1 } });
    check("El cliente ve el estado actualizado", after.json?.repair?.status === "in_repair", after.json?.repair?.status);
    check("El historial creció", (after.json?.repair?.timeline || []).length >= 2, `${after.json?.repair?.timeline?.length} eventos`);

    r = await req("PUT", `/api/v1/admin/repairs/${created.id}`, { token, body: { priority: "urgent", estimatedCost: 55000 } });
    check("Actualizar orden → 200", r.status === 200, `status=${r.status}`);
    check("Prioridad actualizada", r.json?.repair?.priority === "urgent", r.json?.repair?.priority);
    check("Costo actualizado", r.json?.repair?.estimatedCost === 55000, r.json?.repair?.estimatedCost);

    r = await req("PUT", `/api/v1/admin/repairs/${created.id}`, { token, body: { priority: "inventado" } });
    check("Prioridad inválida rechazada", r.status === 400, `status=${r.status}`);

    /* ══ 9. ALERTAS ═════════════════════════════════════════ */
    console.log("\n[9] ALERTAS AL EQUIPO (frecuencia de consulta)");

    // Generar consultas suficientes para disparar la alerta
    for (let i = 0; i < 5; i++) {
      await req("POST", "/api/v1/repairs/track", { body: { workOrder: ot, rut: rut1, serialNumber: serial1 } });
    }

    r = await req("GET", "/api/v1/admin/repairs-alerts", { token });
    check("Listar alertas → 200", r.status === 200, `status=${r.status}`);
    const freqAlerts = (r.json?.alerts || []).filter(a => a.type === "frequent_lookup" && a.workOrder === ot);
    check("Se generó alerta de consultas frecuentes", freqAlerts.length >= 1, `${freqAlerts.length} alertas`);
    check("La alerta incluye el conteo", /consultó \d+ veces/.test(freqAlerts[0]?.message || ""), freqAlerts[0]?.message?.slice(0, 70));

    // Verificar que NO se duplican (el bug corregido)
    const firstCount = freqAlerts.length;
    for (let i = 0; i < 3; i++) {
      await req("POST", "/api/v1/repairs/track", { body: { workOrder: ot, rut: rut1, serialNumber: serial1 } });
    }
    const r2 = await req("GET", "/api/v1/admin/repairs-alerts", { token });
    const freqAfter = (r2.json?.alerts || []).filter(a => a.type === "frequent_lookup" && a.workOrder === ot);
    check("Las alertas NO se duplican", freqAfter.length === firstCount, `antes=${firstCount}, después=${freqAfter.length}`);

    if (freqAlerts[0]) {
      r = await req("POST", `/api/v1/admin/repairs-alerts/${freqAlerts[0].id}/read`, { token });
      check("Marcar alerta como leída", r.status === 200, `status=${r.status}`);
    }

    /* ══ 10. FEEDBACK DEL CLIENTE ═══════════════════════════ */
    console.log("\n[10] SOLICITUD DE CONTACTO DEL CLIENTE");
    r = await req("POST", "/api/v1/repairs/feedback", {
      body: { workOrder: ot, rut: rut1, serialNumber: serial1, message: "¿Cuánto costará al final?", contactPreference: "phone" },
    });
    check("Feedback → 200", r.status === 200, `status=${r.status}`);
    check("Confirma recepción", r.json?.code === "FEEDBACK_RECEIVED", r.json?.code);

    r = await req("POST", "/api/v1/repairs/feedback", {
      body: { workOrder: ot, rut: makeRut("22222222"), serialNumber: serial1, message: "Intento ajeno" },
    });
    check("Feedback con datos ajenos → 404", r.status === 404, `status=${r.status}`);

    /* ══ 11. ESTADOS FINALES ════════════════════════════════ */
    console.log("\n[11] FLUJO DE ESTADOS");
    const states = ["diagnosing", "waiting_parts", "in_repair", "testing", "ready"];
    let allOk = true;
    for (const s of states) {
      const ev = await req("POST", `/api/v1/admin/repairs/${created.id}/events`, { token, body: { status: s, note: `Estado: ${s}` } });
      if (ev.status !== 200) { allOk = false; break; }
    }
    check("Recorrer todos los estados", allOk, allOk ? "5 estados" : "falló");

    const final = await req("POST", "/api/v1/repairs/track", { body: { workOrder: ot, rut: rut1, serialNumber: serial1 } });
    check("Estado final = ready", final.json?.repair?.status === "ready", final.json?.repair?.status);
    check("Progreso al 86%", final.json?.repair?.progress?.percent === 86, `${final.json?.repair?.progress?.percent}%`);

    const delivered = await req("POST", `/api/v1/admin/repairs/${created.id}/events`, { token, body: { status: "delivered", finalCost: 48000 } });
    check("Marcar como entregado", delivered.status === 200, `status=${delivered.status}`);
    check("Registra fecha de entrega", !!delivered.json?.repair?.deliveredAt, delivered.json?.repair?.deliveredAt);

    /* ══ 12. LIMPIEZA ═══════════════════════════════════════ */
    console.log("\n[12] LIMPIEZA");
    r = await req("DELETE", `/api/v1/admin/repairs/${created.id}`, { token });
    check("Desactivar orden → 200", r.status === 200, `status=${r.status}`);

    const gone = await req("POST", "/api/v1/repairs/track", { body: { workOrder: ot, rut: rut1, serialNumber: serial1 } });
    check("Orden desactivada no es consultable", gone.status === 404, `status=${gone.status}`);
  }

  /* ══ 13. CLAVES DE API: GESTIÓN ═══════════════════════════ */
  console.log("\n[13] GESTIÓN DE CLAVES DE API");
  r = await req("GET", "/api/v1/admin/repair-keys", { token });
  check("Listar claves → 200", r.status === 200, `status=${r.status}`);
  check("No expone el hash de la clave", !r.text.includes("key_hash") && !r.text.includes("keyHash"), "sin hashes");

  const keyRow = (r.json?.keys || []).find(k => k.keyPrefix === keyId);
  check("La clave creada aparece en la lista", !!keyRow, keyRow?.name);

  if (keyRow) {
    r = await req("DELETE", `/api/v1/admin/repair-keys/${keyRow.id}`, { token });
    check("Revocar clave → 200", r.status === 200, `status=${r.status}`);

    r = await req("GET", "/api/v1/repairs-api/orders", { apiKey });
    check("Clave revocada ya no funciona", r.status === 401, `status=${r.status}`);
  }

  /* ══ 14. MÓDULO DESCONECTABLE ═════════════════════════════ */
  console.log("\n[14] MÓDULO CONFIGURABLE Y DESCONECTABLE");
  r = await req("GET", "/api/v1/config");
  check("Config expone el estado del módulo", typeof r.json?.modules?.repairs?.enabled === "boolean", r.json?.modules?.repairs?.enabled);

  await req("PUT", "/api/v1/admin/settings", { token, body: { settings: { repair_enabled: "0" } } });
  r = await req("GET", "/api/v1/repairs/info");
  check("Módulo desactivado → 404 en info", r.status === 404, `status=${r.status}`);

  r = await req("POST", "/api/v1/repairs/track", { body: { workOrder: "OT-2026-000001", rut: makeRut("11111111"), serialNumber: "X" } });
  check("Módulo desactivado → 404 en track", r.status === 404, `status=${r.status}`);

  await req("PUT", "/api/v1/admin/settings", { token, body: { settings: { repair_enabled: "1" } } });
  r = await req("GET", "/api/v1/repairs/info");
  check("Módulo reactivado → 200", r.status === 200, `status=${r.status}`);

  /* ══ 15. INYECCIÓN Y ENTRADAS MALICIOSAS ══════════════════ */
  console.log("\n[15] ENTRADAS MALICIOSAS");
  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: "'; DROP TABLE repair_orders;--", rut: rut1, serialNumber: serial1 },
  });
  check("SQLi en número de orden → 404", r.status === 404, `status=${r.status}`);

  r = await req("GET", "/api/v1/repairs/info");
  check("La tabla sigue intacta tras SQLi", r.status === 200, `status=${r.status}`);

  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: "<script>alert(1)</script>", rut: rut1, serialNumber: serial1 },
  });
  check("XSS en número de orden → 404", r.status === 404, `status=${r.status}`);

  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: { $ne: null }, rut: rut1, serialNumber: serial1 },
  });
  check("Objeto en lugar de string → 400/404", [400, 404].includes(r.status), `status=${r.status}`);

  r = await req("POST", "/api/v1/repairs/track", {
    body: { workOrder: "A".repeat(10000), rut: rut1, serialNumber: serial1 },
  });
  check("Payload gigante no derriba el servidor", r.status !== 0 && r.status !== 500, `status=${r.status}`);

  /* ─── Resumen ──────────────────────────────────────────── */
  console.log(`\n${"═".repeat(70)}`);
  console.log(`📊  TALLER:  ${pass} OK  /  ${fail} FALLOS  /  ${pass + fail} total`);
  console.log(`${"═".repeat(70)}`);

  if (failures.length) {
    console.log("\n🔴 FALLOS:");
    for (const f of failures) console.log(`  • ${f.name}${f.detail ? "  →  " + f.detail : ""}`);
  }
  console.log();

  require("fs").writeFileSync(
    require("path").join(__dirname, "repairs-report.json"),
    JSON.stringify({ base: BASE, date: new Date().toISOString(), pass, fail, failures }, null, 2)
  );

  process.exit(fail > 0 ? 1 : 0);
})();
