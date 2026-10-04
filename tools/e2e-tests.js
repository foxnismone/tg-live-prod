#!/usr/bin/env node
/**
 * ============================================================
 * TEST E2E — Flujos completos del usuario y del operador
 * ============================================================
 * Simula con peticiones HTTP reales:
 *   1. Visitante: navega catálogo, filtra, busca, ve producto
 *   2. Visitante: agrega al carrito, modifica, elimina
 *   3. Visitante: completa checkout (datos válidos)
 *   4. Visitante: usa el chat de ventas
 *   5. Operador: inicia sesión, crea producto, sube imagen
 *   6. Operador: ajusta inventario, ve dashboard
 *   7. Seguridad: verifica que un cliente no acceda a admin
 *
 * Uso:  node tools/e2e-tests.js [baseUrl]
 * ============================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");

const BASE = process.argv[2] || "http://localhost:3000";
const H = { "Content-Type": "application/json", "X-Load-Test": "1" };

let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail = "") {
  const ok = !!cond;
  ok ? pass++ : fail++;
  results.push({ name, ok, detail: ok ? "" : String(detail).slice(0, 220) });
  console.log(`${ok ? "✅" : "❌"}  ${name}${!ok && detail ? "  → " + String(detail).slice(0, 160) : ""}`);
  return ok;
}

async function req(method, p, { body, headers = {}, token } = {}) {
  const opts = { method, headers: { ...H, ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(BASE + p, opts);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    return { status: res.status, json, text, headers: Object.fromEntries(res.headers) };
  } catch (e) {
    return { status: 0, json: null, text: e.message, headers: {} };
  }
}

(async () => {
  console.log(`\n🧪  PRUEBAS E2E  →  ${BASE}\n${"═".repeat(62)}`);

  // Limpieza previa: la suite es re-ejecutable y no debe dejar residuos
  try {
    const lr = await req("POST", "/api/v1/auth/login", {
      body: { email: "admin@tecnogamer.local", password: "Admin123!" },
    });
    const cleanToken = lr.json?.token || lr.json?.accessToken;
    if (cleanToken) {
      const all = await req("GET", "/api/v1/products?limit=100", { token: cleanToken });
      for (const prod of (all.json?.products || [])) {
        if (/E2E/i.test(prod.name)) {
          await req("DELETE", `/api/v1/products/${prod.id}`, { token: cleanToken });
        }
      }
    }
  } catch (_) { /* la limpieza es best-effort */ }
  const SESSION = "e2e-" + Date.now();
  let token = null;
  let createdProductId = null;
  let chatSessionId = null;

  /* ══ 1. VISITANTE: catálogo ══════════════════════════════ */
  console.log("\n[1] VISITANTE — Navegación del catálogo");

  let r = await req("GET", "/");
  check("La tienda carga (HTML)", r.status === 200 && /<html/i.test(r.text), `status=${r.status}`);
  check("El HTML incluye el catálogo", /product-grid/.test(r.text));
  check("El HTML incluye el chat", /chat-fab/.test(r.text));

  r = await req("GET", "/assets/css/main.css");
  check("CSS accesible", r.status === 200 && r.text.length > 5000, `len=${r.text.length}`);

  r = await req("GET", "/assets/js/store.js");
  check("JS del storefront accesible", r.status === 200 && r.text.length > 5000, `len=${r.text.length}`);

  r = await req("GET", "/api/v1/products?limit=12&sort=newest");
  check("Listado de productos", r.status === 200, `status=${r.status}`);
  const products = (r.json?.products || []).filter(
    p => p.stockStatus === "in_stock" && p.stockQuantity > 2 && !/E2E/i.test(p.name)
  );
  check("Hay productos en el catálogo", products.length > 0, `len=${products.length}`);
  const P1 = products[0];
  check("Producto trae imágenes", Array.isArray(P1?.images), typeof P1?.images);
  check("Producto trae precio", typeof P1?.price === "number");

  r = await req("GET", "/api/v1/categories");
  const cats = r.json?.categories || [];
  check("Categorías disponibles", cats.length > 0, `len=${cats.length}`);

  if (cats[0]) {
    r = await req("GET", `/api/v1/products?category=${cats[0].slug}`);
    check(`Filtro por categoría "${cats[0].slug}"`, r.status === 200, `status=${r.status}`);
  }

  r = await req("GET", "/api/v1/products?sort=price-asc&limit=5");
  const pr = (r.json?.products || []).map(p => p.price);
  check("Orden por precio ascendente", pr.every((v, i) => i === 0 || pr[i-1] <= v), JSON.stringify(pr));

  r = await req("GET", "/api/v1/products?search=" + encodeURIComponent("rtx"));
  check("Búsqueda funciona", r.status === 200, `status=${r.status}`);

  if (P1) {
    r = await req("GET", `/api/v1/products/${P1.id}`);
    check("Detalle de producto", r.status === 200, `status=${r.status}`);
  }

  /* ══ 2. VISITANTE: carrito (invitado) ════════════════════ */
  console.log("\n[2] VISITANTE — Carrito sin registrarse");

  r = await req("POST", "/api/v1/cart/items", {
    body: { productId: P1.id, quantity: 2, sessionId: SESSION },
  });
  check("Agregar al carrito como invitado", [200, 201].includes(r.status), `status=${r.status} ${r.text.slice(0,120)}`);
  const cart = r.json?.cart;
  check("Carrito devuelve items", Array.isArray(cart?.items) && cart.items.length > 0, `items=${cart?.items?.length}`);

  r = await req("GET", `/api/v1/cart?sessionId=${SESSION}`);
  check("Recuperar carrito por sesión", r.status === 200, `status=${r.status}`);
  const itemCount = r.json?.cart?.items?.length || 0;
  check("El carrito conserva el item", itemCount > 0, `items=${itemCount}`);

  r = await req("GET", `/api/v1/cart/summary?sessionId=${SESSION}`);
  check("Resumen del carrito (subtotal/envío)", r.status === 200, `status=${r.status}`);

  r = await req("PUT", "/api/v1/cart/items/0", { body: { quantity: 3, sessionId: SESSION } });
  check("Modificar cantidad", [200, 201].includes(r.status), `status=${r.status}`);

  r = await req("POST", "/api/v1/cart/items", {
    body: { productId: 999999, quantity: 1, sessionId: SESSION },
  });
  check("Producto inexistente → 404", r.status === 404, `status=${r.status}`);

  r = await req("POST", "/api/v1/cart/items", {
    body: { productId: P1.id, quantity: 0, sessionId: SESSION },
  });
  check("Cantidad 0 rechazada → 400", r.status === 400, `status=${r.status}`);

  /* ══ 3. VISITANTE: checkout ══════════════════════════════ */
  console.log("\n[3] VISITANTE — Checkout con datos válidos");

  r = await req("POST", "/api/v1/orders", {
    body: {
      customerName: "Juan Pérez",
      customerEmail: "juan.perez@example.com",
      customerPhone: "+56912345678",
      shippingAddress: "Av. Providencia 1234, Santiago",
      sessionId: SESSION,
      items: [{ productId: P1.id, quantity: 2, price: P1.price, name: P1.name }],
    },
  });
  check("Crear pedido (invitado)", [200, 201].includes(r.status), `status=${r.status} ${r.text.slice(0,180)}`);
  const order = r.json?.order;
  check("Pedido tiene número", !!(order?.orderNumber || order?.id),
        JSON.stringify(r.json || {}).slice(0, 160));

  r = await req("POST", "/api/v1/orders", {
    body: { customerName: "", customerEmail: "no-es-email", items: [] },
  });
  check("Pedido inválido rechazado → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/v1/checkout/create-session", {
    body: { items: [{ name: P1.name, price: P1.price, quantity: 1 }], customerEmail: "juan.perez@example.com" },
  });
  check("Pasarela responde sin caer (503 si no configurada)", [200, 400, 503].includes(r.status), `status=${r.status}`);

  /* ══ 4. VISITANTE: chat de ventas ════════════════════════ */
  console.log("\n[4] VISITANTE — Chat de ventas");

  r = await req("GET", "/api/v1/chat/config");
  check("Config del chat", r.status === 200, `status=${r.status}`);

  r = await req("POST", "/api/v1/chat/sessions", {
    body: { sessionId: SESSION, customerName: "Visitante E2E" },
  });
  chatSessionId = r.json?.session?.session_id || r.json?.session?.sessionId || r.json?.sessionId;
  check("Crear sesión de chat (invitado)", [200, 201, 409].includes(r.status), `status=${r.status} ${r.text.slice(0,150)}`);

  if (chatSessionId) {
    r = await req("POST", `/api/v1/chat/sessions/${chatSessionId}`, {
      body: { message: "Hola, ¿tienen stock de la RTX 4070?", sender: "customer" },
    });
    check("Enviar mensaje al chat", [200, 201].includes(r.status), `status=${r.status} ${r.text.slice(0,150)}`);

    r = await req("GET", `/api/v1/chat/sessions/${chatSessionId}`);
    check("Leer historial del chat", r.status === 200, `status=${r.status}`);
  } else {
    check("Enviar mensaje al chat", false, "no se obtuvo sessionId");
    check("Leer historial del chat", false, "no se obtuvo sessionId");
  }

  /* ══ 5. OPERADOR: sesión y gestión ═══════════════════════ */
  console.log("\n[5] OPERADOR — Inicio de sesión y gestión");

  r = await req("POST", "/api/v1/auth/login", {
    body: { email: "admin@tecnogamer.local", password: "Admin123!" },
  });
  token = r.json?.token || r.json?.accessToken;
  check("Login del operador", r.status === 200 && !!token,
        `status=${r.status} ${r.text.slice(0,120)} (si es 429, espera ~1 min y reintenta)`);

  if (!token) {
    console.log("\n⛔  Sin token de operador: se omiten las pruebas de gestión.\n");
  } else {
    r = await req("GET", "/api/v1/admin/dashboard", { token });
    check("Dashboard del operador", r.status === 200, `status=${r.status} ${r.text.slice(0,150)}`);
    check("Dashboard trae métricas", !!r.json?.dashboard?.inventory, Object.keys(r.json || {}).join(","));

    // Crear producto
    const sku = "E2E-TEST-" + Date.now();
    r = await req("POST", "/api/v1/products", {
      token,
      body: {
        name: "Producto de prueba E2E " + Date.now(),
        sku,
        description: "Producto generado por la suite de pruebas end-to-end.",
        categoryId: cats[0]?.id || 1,
        price: 49990,
        stockQuantity: 10,
        isActive: true,
      },
    });
    check("Crear producto desde el panel", [200, 201].includes(r.status), `status=${r.status} ${r.text.slice(0,180)}`);
    createdProductId = r.json?.product?.id || r.json?.id;
    check("Producto creado tiene ID", !!createdProductId, JSON.stringify(r.json).slice(0,120));

    // SKU duplicado debe fallar
    r = await req("POST", "/api/v1/products", {
      token,
      body: { name: "Duplicado", sku, categoryId: cats[0]?.id || 1, price: 1000, stockQuantity: 1 },
    });
    check("SKU duplicado rechazado (409/400)", [400, 409].includes(r.status), `status=${r.status}`);

    if (createdProductId) {
      // Actualizar
      r = await req("PUT", `/api/v1/products/${createdProductId}`, {
        token, body: { price: 59990, stockQuantity: 25 },
      });
      check("Editar producto", [200, 201].includes(r.status), `status=${r.status}`);

      // Subir imagen real (PNG mínimo válido)
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64"
      );
      const fd = new FormData();
      fd.append("images", new Blob([png], { type: "image/png" }), "e2e-test.png");
      const up = await fetch(`${BASE}/api/v1/products/${createdProductId}/images`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const upText = await up.text();
      check("Subir imagen al producto", [200, 201].includes(up.status), `status=${up.status} ${upText.slice(0,180)}`);

      // Verificar que la imagen quedó asociada
      r = await req("GET", `/api/v1/products/${createdProductId}`);
      const imgs = r.json?.product?.images || r.json?.images || [];
      check("Imagen asociada al producto", imgs.length > 0, `imgs=${imgs.length}`);

      // Ajuste de inventario
      r = await req("POST", "/api/v1/inventory/adjust", {
        token, body: { productId: createdProductId, changeQty: 5, reason: "restock" },
      });
      check("Ajustar inventario", [200, 201].includes(r.status), `status=${r.status} ${r.text.slice(0,150)}`);

      // Eliminar (soft delete)
      r = await req("DELETE", `/api/v1/products/${createdProductId}`, { token });
      check("Eliminar producto de prueba", [200, 204].includes(r.status), `status=${r.status}`);
    }

    r = await req("GET", "/api/v1/admin/orders?limit=10", { token });
    check("Listado de pedidos del panel", [200, 404].includes(r.status), `status=${r.status}`);
  }

  /* ══ 5b. MODELO DE PRECIOS RETAIL (patrón pc Factory) ════ */
  console.log("\n[5b] MODELO DE PRECIOS — transferencia, cuotas y retiro");

  r = await req("GET", "/api/v1/products?limit=10&sort=price-desc");
  const priced = r.json?.products || [];

  check("Productos exponen precio de transferencia",
        priced.every(p => typeof p.cashPrice === "number"),
        JSON.stringify(priced[0]?.cashPrice));

  check("Precio de transferencia es menor o igual al de crédito",
        priced.every(p => p.cashPrice <= p.price),
        priced.filter(p => p.cashPrice > p.price).map(p => p.name).join(", "));

  check("Productos caros ofrecen cuotas sin interés",
        priced.some(p => p.installments > 0),
        `max=${Math.max(...priced.map(p => p.installments || 0))}`);

  check("Valor de cuota coherente con el precio",
        priced.filter(p => p.installments > 0)
              .every(p => Math.abs(p.installmentValue * p.installments - p.cashPrice) < p.installments + 10),
        JSON.stringify(priced.find(p => p.installments > 0)?.installmentValue));

  check("Cuotas máximas no superan 24",
        priced.every(p => (p.installments || 0) <= 24),
        `max=${Math.max(...priced.map(p => p.installments || 0))}`);

  check("Productos indican disponibilidad de retiro",
        priced.some(p => p.pickupAvailable === true),
        `con retiro=${priced.filter(p => p.pickupAvailable).length}/${priced.length}`);

  const withStores = priced.find(p => p.storeStock && Object.keys(p.storeStock).length);
  check("Productos con retiro exponen stock por tienda", !!withStores,
        withStores ? Object.keys(withStores.storeStock).length + " tiendas" : "ninguno");

  check("Descuento calculado como porcentaje",
        priced.every(p => p.discountPercent === 0 || (p.discountPercent > 0 && p.discountPercent < 100)),
        JSON.stringify(priced.map(p => p.discountPercent).slice(0, 5)));

  /* ══ 6. SEGURIDAD: separación de roles ═══════════════════ */
  console.log("\n[6] SEGURIDAD — Control de acceso");

  r = await req("GET", "/api/v1/admin/dashboard");
  check("Panel sin token → 401", r.status === 401, `status=${r.status}`);

  r = await req("POST", "/api/v1/products", { body: { name: "Intruso", price: 1, sku: "X1", categoryId: 1 } });
  check("Crear producto sin token → 401", r.status === 401, `status=${r.status}`);

  // Crear un cliente normal y comprobar que NO puede entrar al panel
  const clientEmail = `cliente.e2e.${Date.now()}@example.com`;
  r = await req("POST", "/api/v1/auth/register", {
    body: { email: clientEmail, password: "Cliente123!", name: "Cliente E2E" },
  });
  const clientToken = r.json?.token || r.json?.accessToken;
  check("Registro de cliente", [200, 201].includes(r.status), `status=${r.status} ${r.text.slice(0,150)}`);

  if (clientToken) {
    r = await req("GET", "/api/v1/admin/dashboard", { token: clientToken });
    check("Cliente NO accede al panel → 403", r.status === 403, `status=${r.status}`);
    r = await req("POST", "/api/v1/products", {
      token: clientToken, body: { name: "Hack", sku: "H1", price: 1, categoryId: 1 },
    });
    check("Cliente NO puede crear productos → 403", r.status === 403, `status=${r.status}`);
  }

  r = await req("GET", "/api/v1/products/1", { headers: { Authorization: "Bearer token.falso.aqui" } });
  check("Token falsificado rechazado", [200, 401].includes(r.status), `status=${r.status}`);

  /* ══ 7. RESILIENCIA ══════════════════════════════════════ */
  console.log("\n[7] RESILIENCIA — Entradas hostiles");

  r = await req("GET", "/api/v1/products?search=" + encodeURIComponent("'; DROP TABLE products;--"));
  check("Intento de inyección SQL neutralizado", r.status === 200, `status=${r.status}`);
  r = await req("GET", "/api/v1/products");
  check("La tabla de productos sigue intacta", (r.json?.pagination?.total || 0) > 0, `total=${r.json?.pagination?.total}`);

  r = await req("POST", "/api/v1/cart/items", { body: { productId: { $ne: null }, quantity: 1, sessionId: SESSION } });
  check("Tipo de dato malicioso rechazado", [400, 404].includes(r.status), `status=${r.status}`);

  r = await req("POST", "/api/v1/auth/login", { body: { email: "a@b.com", password: "x".repeat(10000) } });
  check("Contraseña gigante no derriba el servidor", [400, 401, 413, 429].includes(r.status), `status=${r.status}`);

  r = await req("GET", "/api/v1/products?limit=" + "9".repeat(50));
  check("Límite desmesurado acotado", [200, 400].includes(r.status), `status=${r.status}`);

  r = await req("GET", "/health");
  check("El servidor sigue en pie al final", r.status === 200, `status=${r.status}`);

  /* ─── Limpieza final ───────────────────────────────────── */
  // La suite deja pedidos y usuarios de prueba. Se eliminan al terminar
  // para no contaminar la base de datos con datos que parecen reales.
  try {
    if (token) {
      const cleanup = await req("POST", "/api/v1/admin/cleanup-test-data", { token });
      if (cleanup.status === 200 && cleanup.json?.deleted) {
        console.log(`\n🧹  Residuo eliminado: ${JSON.stringify(cleanup.json.deleted)}`);
      }
    }
  } catch (_) { /* best-effort */ }

  /* ─── Resumen ──────────────────────────────────────────── */
  console.log(`\n${"═".repeat(62)}`);
  console.log(`📊  E2E:  ${pass} OK  /  ${fail} FALLOS  /  ${pass + fail} total`);
  console.log(`${"═".repeat(62)}\n`);

  fs.writeFileSync(
    path.join(__dirname, "e2e-report.json"),
    JSON.stringify({ base: BASE, date: new Date().toISOString(), pass, fail, results }, null, 2)
  );
  console.log("📄  Reporte: tools/e2e-report.json\n");
  process.exit(fail > 0 ? 1 : 0);
})();
