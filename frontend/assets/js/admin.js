/* ============================================================
   ADMIN — Panel de operador TecnoGamer
   ============================================================
   Resumen, productos, alta con imágenes (arrastrar/soltar),
   inventario, pedidos, chat y configuración.
   ============================================================ */
"use strict";

(() => {
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  const money = (n) => new Intl.NumberFormat("es-CL", {
    style: "currency", currency: "CLP",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Number(n) || 0);

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const fmtDate = (d) => {
    if (!d) return "—";
    const dt = new Date(d.includes("T") ? d : d.replace(" ", "T") + "Z");
    return isNaN(dt) ? d : dt.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
  };

  /* ─── API admin ──────────────────────────────────────── */
  const BASE = "/api/v1";
  const TOKEN_KEY = "tg_admin_token";
  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const setToken = (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

  async function api(path, { method = "GET", body, raw = false, timeout = 20000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const headers = { Accept: "application/json" };
    const tk = getToken();
    if (tk) headers.Authorization = `Bearer ${tk}`;

    const opts = { method, headers, signal: ctrl.signal };
    if (body !== undefined && !raw) {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    } else if (raw) {
      opts.body = body;
    }

    try {
      const res = await fetch(BASE + path, opts);
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
      if (!res.ok) {
        const e = new Error(data?.error || `Error ${res.status}`);
        e.status = res.status; e.code = data?.code; e.details = data?.details;
        if (res.status === 401) setToken(null);
        throw e;
      }
      return data;
    } catch (e) {
      if (e.name === "AbortError") { const err = new Error("Tiempo de espera agotado"); err.code = "TIMEOUT"; throw err; }
      throw e;
    } finally { clearTimeout(timer); }
  }

  /* ─── Toasts ─────────────────────────────────────────── */
  function toast(msg, type = "info", ms = 4000) {
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 200); }, ms);
  }

  /* ─── Modal ──────────────────────────────────────────── */
  function openModal(title, body, foot = "") {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = body;
    $("#modal-foot").innerHTML = foot;
    $("#modal-backdrop").classList.add("is-open");
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    $("#modal-backdrop").classList.remove("is-open");
    document.body.style.overflow = "";
  }

  function confirmDialog(title, message, confirmLabel = "Confirmar", danger = false) {
    return new Promise((resolve) => {
      openModal(title, `<p style="color:var(--text-secondary)">${esc(message)}</p>`,
        `<button class="btn btn--secondary" data-confirm="0">Cancelar</button>
         <button class="btn ${danger ? "btn--danger" : "btn--primary"}" data-confirm="1">${esc(confirmLabel)}</button>`);
      $("#modal-foot").addEventListener("click", (e) => {
        const b = e.target.closest("[data-confirm]");
        if (!b) return;
        closeModal();
        resolve(b.dataset.confirm === "1");
      }, { once: true });
    });
  }

  /* ─── Estado ─────────────────────────────────────────── */
  const state = { view: "dashboard", products: [], page: 1, totalPages: 1, search: "", categories: [] };

  /* ─── Login ──────────────────────────────────────────── */
  function showLogin() {
    $("#login-screen").hidden = false;
    $("#admin-app").hidden = true;
    $("#password").value = "";
  }
  function showApp() {
    $("#login-screen").hidden = true;
    $("#admin-app").hidden = false;
    const u = localStorage.getItem("tg_admin_user");
    $("#sidebar-user").textContent = u || "Operador";
  }

  async function doLogin(e) {
    e.preventDefault();
    const email = $("#email").value.trim();
    const password = $("#password").value;
    const errBox = $("#login-error");
    const btn = $("#btn-login");
    errBox.hidden = true;

    if (!email || !password) {
      errBox.textContent = "Completa email y contraseña.";
      errBox.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Verificando…';

    try {
      const res = await api("/auth/login", { method: "POST", body: { email, password } });
      const token = res.token || res.accessToken;
      if (!token) throw new Error("Respuesta sin token");
      setToken(token);
      localStorage.setItem("tg_admin_user", `${res.user?.name || "Admin"} (${res.user?.role || "admin"})`);
      showApp();
      toast(`Bienvenido, ${res.user?.name || "operador"}`, "success");
      navigate("dashboard");
    } catch (err) {
      errBox.textContent = err.status === 401
        ? "Email o contraseña incorrectos."
        : err.status === 429
          ? "Demasiados intentos. Espera unos minutos."
          : (err.message || "No se pudo iniciar sesión.");
      errBox.hidden = false;
      btn.disabled = false;
      btn.textContent = "Iniciar sesión";
    }
  }

  /* ─── Navegación ─────────────────────────────────────── */
  const TITLES = {
    dashboard: "Resumen", products: "Productos", "new-product": "Nuevo producto",
    inventory: "Inventario", orders: "Pedidos", chat: "Chat de ventas",
    repairs: "Taller — Órdenes de reparación", settings: "Configuración",
  };

  async function navigate(view) {
    state.view = view;
    $$(".nav-item").forEach(b => b.classList.toggle("is-active", b.dataset.view === view));
    $("#view-title").textContent = TITLES[view] || view;
    $("#sidebar").classList.remove("is-open");

    const c = $("#admin-content");
    c.innerHTML = '<div class="state"><div class="spinner" style="margin:0 auto"></div></div>';

    try {
      if (view === "dashboard")  await renderDashboard();
      if (view === "products")   await renderProducts();
      if (view === "new-product") await renderProductForm();
      if (view === "inventory")  await renderInventory();
      if (view === "orders")     await renderOrders();
      if (view === "chat")       await renderChat();
      if (view === "repairs")    await renderRepairs();
      if (view === "settings")   await renderSettings();
    } catch (err) {
      c.innerHTML = `<div class="state">
        <div class="state__icon">⚠️</div>
        <p class="state__title">No se pudo cargar la sección</p>
        <p>${esc(err.message)}</p>
        <button class="btn btn--secondary" style="margin-top:var(--sp-4)" onclick="location.reload()">Reintentar</button>
      </div>`;
      toast(err.message, "error");
    }
  }

  /* ─── Dashboard ──────────────────────────────────────── */
  async function renderDashboard() {
    const res = await api("/admin/dashboard");
    const d = res.dashboard || {};

    const period = d.period || {};
    const inv = d.inventory || {};
    const top = d.topProducts || [];

    $("#admin-content").innerHTML = `
      <div class="metrics">
        <div class="metric">
          <div class="metric__label">Ventas hoy</div>
          <div class="metric__value metric__value--brand">${money(period.today?.revenue)}</div>
          <div class="metric__sub">${period.today?.orders || 0} pedidos</div>
        </div>
        <div class="metric">
          <div class="metric__label">Ventas del mes</div>
          <div class="metric__value">${money(period.month?.revenue)}</div>
          <div class="metric__sub">${period.month?.orders || 0} pedidos</div>
        </div>
        <div class="metric">
          <div class="metric__label">Productos activos</div>
          <div class="metric__value">${inv.totalProducts || 0}</div>
          <div class="metric__sub">${inv.totalUnits || 0} unidades en stock</div>
        </div>
        <div class="metric">
          <div class="metric__label">Valor de inventario</div>
          <div class="metric__value">${money(inv.totalValue)}</div>
          <div class="metric__sub">${inv.lowStock || 0} con stock bajo</div>
        </div>
      </div>

      ${(inv.lowStock || inv.outOfStock) ? `
      <div class="panel" style="border-color:rgba(245,158,11,.35)">
        <div class="panel__head">
          <span class="panel__title">⚠️ Requiere tu atención</span>
          <button class="btn btn--secondary btn--sm" data-go="inventory">Ver inventario</button>
        </div>
        <div class="panel__body">
          ${inv.outOfStock ? `<p style="color:#fca5a5">• <strong>${inv.outOfStock}</strong> producto(s) sin stock — no se pueden vender.</p>` : ""}
          ${inv.lowStock ? `<p style="color:var(--warning);margin-top:var(--sp-2)">• <strong>${inv.lowStock}</strong> producto(s) con stock bajo — considera reponer.</p>` : ""}
        </div>
      </div>` : ""}

      <div class="panel">
        <div class="panel__head">
          <span class="panel__title">Más vendidos</span>
        </div>
        <div class="panel__body panel__body--flush">
          ${top.length ? `
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Producto</th><th>SKU</th><th>Vendidos</th><th>Ingresos</th></tr></thead>
              <tbody>
                ${top.map(p => `
                  <tr>
                    <td class="cell-name">${esc(p.name)}</td>
                    <td><span class="cell-sub">${esc(p.sku)}</span></td>
                    <td><span class="tag tag--ok">${p.quantitySold}</span></td>
                    <td>${money(p.revenue)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>` : `<div class="state"><div class="state__icon">📊</div><p class="state__title">Aún no hay ventas registradas</p><p>Cuando se concreten pedidos verás aquí tus productos más vendidos.</p></div>`}
        </div>
      </div>

      <div class="panel">
        <div class="panel__head">
          <span class="panel__title">Últimos productos agregados</span>
          <button class="btn btn--secondary btn--sm" data-go="products">Ver todos</button>
        </div>
        <div class="panel__body panel__body--flush">
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th></th><th>Producto</th><th>Precio</th><th>Stock</th><th>Agregado</th></tr></thead>
              <tbody>
                ${(d.newProducts || []).map(p => `
                  <tr>
                    <td><div class="thumb">📦</div></td>
                    <td>
                      <div class="cell-name">${esc(p.name)}</div>
                      <div class="cell-sub">${esc(p.sku)}</div>
                    </td>
                    <td>${money(p.price)}</td>
                    <td>${p.stock}</td>
                    <td class="cell-sub">${fmtDate(p.createdAt)}</td>
                  </tr>`).join("") || `<tr><td colspan="5" class="cell-sub" style="text-align:center;padding:var(--sp-5)">Sin productos</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  /* ─── Productos ──────────────────────────────────────── */
  async function loadCategories() {
    if (state.categories.length) return state.categories;
    const res = await api("/categories");
    state.categories = res.categories || [];
    return state.categories;
  }

  async function renderProducts(page = 1) {
    const q = new URLSearchParams({ page: String(page), limit: "20", sort: "newest" });
    if (state.search) q.set("search", state.search);
    const res = await api(`/products?${q}`);
    state.products = res.products || [];
    state.page = res.pagination?.page || 1;
    state.totalPages = res.pagination?.totalPages || 1;

    const stockTag = (p) => {
      if (p.stockStatus === "out_of_stock") return '<span class="tag tag--bad">Agotado</span>';
      if (p.stockStatus === "low_stock")   return `<span class="tag tag--warn">Stock bajo (${p.stockQuantity})</span>`;
      return `<span class="tag tag--ok">${p.stockQuantity} en stock</span>`;
    };

    $("#admin-content").innerHTML = `
      <div class="panel">
        <div class="panel__head">
          <span class="panel__title">Catálogo (${res.pagination?.total || 0} productos)</span>
          <div style="display:flex;gap:var(--sp-2)">
            <input class="input" id="prod-search" placeholder="Buscar…" value="${esc(state.search)}" style="min-width:180px">
            <button class="btn btn--primary btn--sm" data-go="new-product">➕ Nuevo</button>
          </div>
        </div>
        <div class="panel__body panel__body--flush">
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr><th></th><th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                ${state.products.map(p => {
                  const img = p.images?.find(i => i.isPrimary)?.url || p.images?.[0]?.url;
                  return `
                  <tr>
                    <td>${img ? `<img class="thumb" src="${esc(img)}" alt="">` : '<div class="thumb">📦</div>'}</td>
                    <td>
                      <div class="cell-name">${esc(p.name)}</div>
                      <div class="cell-sub">${esc(p.sku)}</div>
                    </td>
                    <td><span class="tag">${esc(p.category?.name || "—")}</span></td>
                    <td>${money(p.price)}${p.compareAtPrice ? `<div class="cell-sub" style="text-decoration:line-through">${money(p.compareAtPrice)}</div>` : ""}</td>
                    <td>${stockTag(p)}</td>
                    <td>${p.isActive ? '<span class="tag tag--ok">Activo</span>' : '<span class="tag">Inactivo</span>'}
                        ${p.isFeatured ? '<span class="tag tag--warn">Destacado</span>' : ""}</td>
                    <td>
                      <div class="row-actions">
                        <button class="btn btn--secondary btn--sm" data-edit="${p.id}" title="Editar">✏️</button>
                        <button class="btn btn--secondary btn--sm" data-images="${p.id}" title="Imágenes">🖼️</button>
                        <button class="btn btn--danger btn--sm" data-del="${p.id}" title="Eliminar">🗑️</button>
                      </div>
                    </td>
                  </tr>`;
                }).join("") || `<tr><td colspan="7" style="text-align:center;padding:var(--sp-6)" class="cell-sub">Sin productos. Crea el primero con “Nuevo”.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
        ${state.totalPages > 1 ? `
        <div class="panel__head" style="border-top:1px solid var(--border);border-bottom:none;justify-content:center;gap:var(--sp-3)">
          <button class="btn btn--secondary btn--sm" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>‹ Anterior</button>
          <span class="cell-sub">Página ${state.page} de ${state.totalPages}</span>
          <button class="btn btn--secondary btn--sm" data-page="${state.page + 1}" ${state.page >= state.totalPages ? "disabled" : ""}>Siguiente ›</button>
        </div>` : ""}
      </div>
    `;

    // Búsqueda con debounce
    let t;
    $("#prod-search")?.addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => { state.search = e.target.value.trim(); renderProducts(1); }, 400);
    });

    // Acciones
    $("#admin-content").addEventListener("click", async (e) => {
      const edit = e.target.closest("[data-edit]");
      const imgs = e.target.closest("[data-images]");
      const del  = e.target.closest("[data-del]");
      const pg   = e.target.closest("[data-page]");

      if (pg) return renderProducts(Number(pg.dataset.page));
      if (edit) return renderProductForm(Number(edit.dataset.edit));
      if (imgs) return manageImages(Number(imgs.dataset.images));
      if (del) {
        const ok = await confirmDialog("Eliminar producto",
          "El producto se desactivará y dejará de mostrarse en la tienda. Esta acción se puede revertir.", "Eliminar", true);
        if (!ok) return;
        try {
          await api(`/products/${del.dataset.del}`, { method: "DELETE" });
          toast("Producto eliminado", "success");
          renderProducts(state.page);
        } catch (err) { toast(err.message, "error"); }
      }
    }, { once: true });
  }

  /* ─── Alta / edición de producto ─────────────────────── */
  async function renderProductForm(id = null) {
    const cats = await loadCategories();
    let p = { name: "", sku: "", description: "", price: "", compareAtPrice: "",
              stockQuantity: "", categoryId: "", isFeatured: false, isNew: true, isActive: true, tags: [] };

    if (id) {
      const res = await api(`/products/${id}`);
      p = res.product || res;
      p.tags = p.tags || [];
      p.categoryId = p.categoryId || p.category?.id || "";
    }

    const isEdit = !!id;

    $("#admin-content").innerHTML = `
      <form id="product-form" class="form" novalidate>
        <div class="form-grid">
          <div style="display:grid;gap:var(--sp-5)">

            <div class="panel">
              <div class="panel__head"><span class="panel__title">Información básica</span></div>
              <div class="panel__body">
                <div class="form-field">
                  <label class="form-label" for="p-name">Nombre del producto <span class="req">*</span></label>
                  <input class="input" id="p-name" name="name" required value="${esc(p.name)}"
                         placeholder="Ej: NVIDIA GeForce RTX 4070 Super">
                  <span class="form-error" data-err="p-name"></span>
                </div>

                <div class="form-row" style="margin-top:var(--sp-4)">
                  <div class="form-field">
                    <label class="form-label" for="p-sku">SKU <span class="req">*</span></label>
                    <input class="input" id="p-sku" name="sku" required value="${esc(p.sku)}"
                           placeholder="GPU-RTX4070S-12G">
                    <span class="form-hint">Código único interno del producto.</span>
                    <span class="form-error" data-err="p-sku"></span>
                  </div>
                  <div class="form-field">
                    <label class="form-label" for="p-cat">Categoría <span class="req">*</span></label>
                    <select class="select" id="p-cat" name="categoryId" required>
                      <option value="">Selecciona…</option>
                      ${cats.map(c => `<option value="${c.id}" ${String(p.categoryId) === String(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
                    </select>
                    <span class="form-error" data-err="p-cat"></span>
                  </div>
                </div>

                <div class="form-field" style="margin-top:var(--sp-4)">
                  <label class="form-label" for="p-desc">Descripción</label>
                  <textarea class="input" id="p-desc" name="description" rows="5"
                    placeholder="Describe el producto: características, beneficios, especificaciones…">${esc(p.description || "")}</textarea>
                  <span class="form-hint"><span id="desc-count">${(p.description || "").length}</span> caracteres</span>
                </div>
              </div>
            </div>

            <div class="panel">
              <div class="panel__head"><span class="panel__title">Precio e inventario</span></div>
              <div class="panel__body">
                <div class="form-row">
                  <div class="form-field">
                    <label class="form-label" for="p-price">Precio de venta <span class="req">*</span></label>
                    <input class="input" id="p-price" name="price" type="number" min="0" step="1" required
                           value="${p.price ?? ""}" placeholder="429990" inputmode="numeric">
                    <span class="form-error" data-err="p-price"></span>
                  </div>
                  <div class="form-field">
                    <label class="form-label" for="p-was">Precio anterior (tachado)</label>
                    <input class="input" id="p-was" name="compareAtPrice" type="number" min="0" step="1"
                           value="${p.compareAtPrice ?? ""}" placeholder="499990" inputmode="numeric">
                    <span class="form-hint">Déjalo vacío si no está en oferta.</span>
                  </div>
                </div>
                <div class="form-row" style="margin-top:var(--sp-4)">
                  <div class="form-field">
                    <label class="form-label" for="p-stock">Unidades en stock <span class="req">*</span></label>
                    <input class="input" id="p-stock" name="stockQuantity" type="number" min="0" step="1" required
                           value="${p.stockQuantity ?? ""}" placeholder="24" inputmode="numeric">
                    <span class="form-error" data-err="p-stock"></span>
                  </div>
                  <div class="form-field">
                    <label class="form-label" for="p-tags">Etiquetas</label>
                    <input class="input" id="p-tags" name="tags"
                           value="${esc((p.tags || []).join(", "))}" placeholder="gaming, rtx, 1440p">
                    <span class="form-hint">Separadas por comas.</span>
                  </div>
                </div>

                <div class="form-row" style="margin-top:var(--sp-4)">
                  <div class="form-field">
                    <label class="form-label" for="p-cash">Precio transferencia / débito</label>
                    <input class="input" id="p-cash" name="cashPrice" type="number" min="0" step="10"
                           value="${p.cashPrice ?? ""}" placeholder="Dejar vacío = igual al de crédito" inputmode="numeric">
                    <span class="form-hint">Es el precio que se muestra como principal en la tienda.</span>
                  </div>
                  <div class="form-field">
                    <label class="form-label" for="p-inst">Cuotas sin interés</label>
                    <input class="input" id="p-inst" name="installments" type="number" min="0" max="24" step="1"
                           value="${p.installments ?? 0}" placeholder="0" inputmode="numeric">
                    <span class="form-hint">0 = no ofrecer cuotas. Máximo 24.</span>
                  </div>
                </div>

                <div style="display:flex;gap:var(--sp-5);margin-top:var(--sp-4);flex-wrap:wrap">
                  <label style="display:flex;gap:var(--sp-2);align-items:center;cursor:pointer">
                    <input type="checkbox" id="p-active" ${p.isActive !== false ? "checked" : ""}>
                    <span class="form-label" style="margin:0">Visible en la tienda</span>
                  </label>
                  <label style="display:flex;gap:var(--sp-2);align-items:center;cursor:pointer">
                    <input type="checkbox" id="p-featured" ${p.isFeatured ? "checked" : ""}>
                    <span class="form-label" style="margin:0">Destacado</span>
                  </label>
                  <label style="display:flex;gap:var(--sp-2);align-items:center;cursor:pointer">
                    <input type="checkbox" id="p-new" ${p.isNew ? "checked" : ""}>
                    <span class="form-label" style="margin:0">Marcar como nuevo</span>
                  </label>
                </div>
              </div>
            </div>

            <div style="display:flex;gap:var(--sp-3)">
              <button class="btn btn--primary btn--lg" type="submit" id="btn-save">
                ${isEdit ? "💾 Guardar cambios" : "✅ Crear producto"}
              </button>
              <button class="btn btn--secondary btn--lg" type="button" data-go="products">Cancelar</button>
            </div>
          </div>

          <div style="display:grid;gap:var(--sp-4)">
            <div class="panel">
              <div class="panel__head"><span class="panel__title">Imágenes</span></div>
              <div class="panel__body">
                ${isEdit ? `
                  <div class="dropzone" id="dropzone" tabindex="0" role="button"
                       aria-label="Subir imágenes del producto">
                    <div class="dropzone__icon" aria-hidden="true">🖼️</div>
                    <div class="dropzone__title">Arrastra tus imágenes aquí</div>
                    <div class="dropzone__hint">o haz clic para seleccionarlas · JPG, PNG, WEBP, AVIF · máx 10 MB</div>
                    <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" multiple>
                  </div>
                  <div class="thumbs" id="thumbs"></div>
                  <p class="form-hint" style="margin-top:var(--sp-3)">
                    💡 Usa imágenes cuadradas de al menos 800×800 px y fondo neutro para mejor resultado.
                  </p>
                ` : `
                  <div class="dropzone" style="opacity:.6;cursor:not-allowed">
                    <div class="dropzone__icon" aria-hidden="true">🔒</div>
                    <div class="dropzone__title">Primero crea el producto</div>
                    <div class="dropzone__hint">Al guardarlo podrás subir sus imágenes.</div>
                  </div>
                `}
              </div>
            </div>

            <div class="ai-box">
              <div class="ai-box__head">
                <span aria-hidden="true">✨</span>
                <span class="ai-box__title">Descripción con IA</span>
              </div>
              <p class="form-hint" style="margin-bottom:var(--sp-3)">
                Genera una descripción de venta a partir del nombre y la categoría.
              </p>
              <button class="btn btn--secondary btn--block" type="button" id="btn-ai">
                ✨ Generar descripción
              </button>
            </div>
          </div>
        </div>
      </form>
    `;

    // Contador de caracteres
    $("#p-desc")?.addEventListener("input", (e) => {
      $("#desc-count").textContent = e.target.value.length;
    });

    // Generador IA
    $("#btn-ai")?.addEventListener("click", async () => {
      const name = $("#p-name").value.trim();
      const catId = $("#p-cat").value;
      const catName = cats.find(c => String(c.id) === String(catId))?.name || "";
      if (!name) { toast("Escribe primero el nombre del producto", "warning"); return; }

      const btn = $("#btn-ai");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generando…';
      try {
        const res = await api("/ai/generate-description", {
          method: "POST",
          body: {
            name,
            categoryName: catName,
            description: $("#p-desc").value.trim() || undefined,
            price: Number($("#p-price").value) || undefined,
            tone: "entusiasta",
          },
        });
        const text = res.description || res.text || res.content;
        if (text) {
          $("#p-desc").value = text;
          $("#desc-count").textContent = text.length;
          toast("Descripción generada ✓", "success");
        } else {
          toast("La IA no devolvió texto", "warning");
        }
      } catch (err) {
        toast(err.status === 503
          ? "El generador IA no está configurado. Añade AI_API_URL y AI_API_KEY en .env"
          : `No se pudo generar: ${err.message}`, "warning", 6000);
      } finally {
        btn.disabled = false;
        btn.textContent = "✨ Generar descripción";
      }
    });

    // Guardar
    $("#product-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = {
        name: $("#p-name").value.trim(),
        sku: $("#p-sku").value.trim(),
        description: $("#p-desc").value.trim(),
        categoryId: Number($("#p-cat").value),
        price: Number($("#p-price").value),
        compareAtPrice: $("#p-was").value ? Number($("#p-was").value) : null,
        cashPrice: $("#p-cash").value ? Number($("#p-cash").value) : null,
        installments: Number($("#p-inst").value) || 0,
        stockQuantity: Number($("#p-stock").value),
        isActive: $("#p-active").checked,
        isFeatured: $("#p-featured").checked,
        isNew: $("#p-new").checked,
        tags: $("#p-tags").value.split(",").map(s => s.trim()).filter(Boolean),
      };

      // Validación accesible
      const rules = {
        "p-name": () => f.name.length >= 3 || "Mínimo 3 caracteres",
        "p-sku":  () => /^[A-Za-z0-9._-]{3,}$/.test(f.sku) || "Solo letras, números, guiones",
        "p-cat":  () => !!f.categoryId || "Selecciona una categoría",
        "p-price":() => f.price > 0 || "Debe ser mayor que 0",
        "p-stock":() => Number.isFinite(f.stockQuantity) && f.stockQuantity >= 0 || "No puede ser negativo",
      };
      let ok = true;
      $$(".form-field").forEach(el => el.classList.remove("is-invalid"));
      for (const [fid, rule] of Object.entries(rules)) {
        const el = document.getElementById(fid);
        const r = rule();
        const errEl = $(`[data-err="${fid}"]`);
        if (r !== true) {
          ok = false;
          el.closest(".form-field").classList.add("is-invalid");
          el.setAttribute("aria-invalid", "true");
          if (errEl) errEl.textContent = r;
        } else {
          el.removeAttribute("aria-invalid");
          if (errEl) errEl.textContent = "";
        }
      }

      // Reglas del modelo de precios retail
      if (f.cashPrice != null && f.cashPrice > f.price) {
        ok = false;
        const el = $("#p-cash");
        el.closest(".form-field").classList.add("is-invalid");
        el.setAttribute("aria-invalid", "true");
        toast("El precio de transferencia no puede superar al de crédito", "warning");
      }
      if (f.installments < 0 || f.installments > 24) {
        ok = false;
        const el = $("#p-inst");
        el.closest(".form-field").classList.add("is-invalid");
        el.setAttribute("aria-invalid", "true");
        toast("Las cuotas deben estar entre 0 y 24", "warning");
      }

      if (!ok) { $(".form-field.is-invalid .input, .form-field.is-invalid .select")?.focus(); toast("Revisa los campos marcados", "warning"); return; }

      const btn = $("#btn-save");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Guardando…';

      try {
        if (isEdit) {
          await api(`/products/${id}`, { method: "PUT", body: f });
          toast("Producto actualizado ✓", "success");
          navigate("products");
        } else {
          const res = await api("/products", { method: "POST", body: f });
          const newId = res.product?.id || res.id;
          toast("Producto creado ✓ Ahora sube sus imágenes", "success", 5000);
          if (newId) renderProductForm(newId);
          else navigate("products");
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = isEdit ? "💾 Guardar cambios" : "✅ Crear producto";
        if (err.code === "DUPLICATE_SKU" || /sku/i.test(err.message)) {
          $("#p-sku").closest(".form-field").classList.add("is-invalid");
          $('[data-err="p-sku"]').textContent = "Ese SKU ya existe";
          $("#p-sku").focus();
        }
        toast(err.message || "No se pudo guardar", "error");
      }
    });

    if (isEdit) initImageUploader(id);
  }

  /* ─── Subida de imágenes (arrastrar y soltar) ────────── */
  async function initImageUploader(productId) {
    const dz = $("#dropzone");
    const input = $("#file-input");
    if (!dz || !input) return;

    await refreshThumbs(productId);

    dz.addEventListener("click", () => input.click());
    dz.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });

    ["dragenter", "dragover"].forEach(ev =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("is-dragover"); }));
    ["dragleave", "drop"].forEach(ev =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("is-dragover"); }));

    dz.addEventListener("drop", (e) => {
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) uploadFiles(productId, files);
    });

    input.addEventListener("change", () => {
      const files = [...input.files];
      if (files.length) uploadFiles(productId, files);
      input.value = "";
    });
  }

  async function refreshThumbs(productId) {
    const cont = $("#thumbs");
    if (!cont) return;
    try {
      const res = await api(`/products/${productId}`);
      const p = res.product || res;
      const imgs = p.images || [];
      cont.innerHTML = imgs.map(im => `
        <div class="thumb-item">
          <img src="${esc(im.url)}" alt="${esc(im.altText || p.name)}">
          ${im.isPrimary ? '<span class="thumb-item__badge">Principal</span>' : ""}
          <button class="thumb-item__del" data-del-img="${im.id}" title="Eliminar imagen" aria-label="Eliminar imagen">✕</button>
        </div>`).join("");

      cont.querySelectorAll("[data-del-img]").forEach(b => {
        b.addEventListener("click", async () => {
          const ok = await confirmDialog("Eliminar imagen", "¿Seguro que quieres eliminar esta imagen?", "Eliminar", true);
          if (!ok) return;
          try {
            await api(`/products/${productId}/images/${b.dataset.delImg}`, { method: "DELETE" });
            toast("Imagen eliminada", "info");
            refreshThumbs(productId);
          } catch (err) { toast(err.message, "error"); }
        });
      });
    } catch (_) { /* sin imágenes */ }
  }

  async function uploadFiles(productId, files) {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
    const maxBytes = 10 * 1024 * 1024;

    const valid = [];
    for (const f of files) {
      if (!allowed.includes(f.type)) { toast(`${f.name}: formato no permitido`, "warning"); continue; }
      if (f.size > maxBytes) { toast(`${f.name}: supera 10 MB`, "warning"); continue; }
      valid.push(f);
    }
    if (!valid.length) return;

    const cont = $("#thumbs");
    const placeholders = valid.map((f, i) => {
      const url = URL.createObjectURL(f);
      cont.insertAdjacentHTML("beforeend", `
        <div class="thumb-item" id="up-${i}">
          <img src="${url}" alt="Subiendo ${esc(f.name)}">
          <div class="thumb-item__bar"><i style="width:10%"></i></div>
        </div>`);
      return `#up-${i}`;
    });

    const fd = new FormData();
    valid.forEach(f => fd.append("images", f));

    try {
      // Progreso simulado hasta que el navegador reporte (fetch no expone upload progress)
      let prog = 10;
      const iv = setInterval(() => {
        prog = Math.min(90, prog + 12);
        placeholders.forEach(sel => { const b = $(`${sel} .thumb-item__bar i`); if (b) b.style.width = prog + "%"; });
      }, 180);

      const res = await fetch(`${BASE}/products/${productId}/images`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      clearInterval(iv);

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);

      placeholders.forEach(sel => { const b = $(`${sel} .thumb-item__bar i`); if (b) b.style.width = "100%"; });
      toast(`${valid.length} imagen(es) subida(s) ✓`, "success");
      setTimeout(() => refreshThumbs(productId), 350);
    } catch (err) {
      placeholders.forEach(sel => $(sel)?.remove());
      toast(err.message || "No se pudieron subir las imágenes", "error");
    }
  }

  async function manageImages(productId) {
    openModal("Gestionar imágenes",
      `<div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Subir imágenes">
         <div class="dropzone__icon" aria-hidden="true">🖼️</div>
         <div class="dropzone__title">Arrastra imágenes o haz clic</div>
         <div class="dropzone__hint">JPG, PNG, WEBP, AVIF · máx 10 MB cada una</div>
         <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" multiple>
       </div>
       <div class="thumbs" id="thumbs"></div>`,
      `<button class="btn btn--secondary" data-close-modal>Cerrar</button>`);
    initImageUploader(productId);
  }

  /* ─── Inventario ─────────────────────────────────────── */
  async function renderInventory() {
    const res = await api("/products?limit=100&sort=name-asc");
    const list = res.products || [];
    const low = list.filter(p => p.stockStatus === "low_stock");
    const out = list.filter(p => p.stockStatus === "out_of_stock");
    const totalUnits = list.reduce((s, p) => s + (p.stockQuantity || 0), 0);
    const totalValue = list.reduce((s, p) => s + (p.stockQuantity || 0) * (p.price || 0), 0);

    $("#admin-content").innerHTML = `
      <div class="metrics">
        <div class="metric"><div class="metric__label">Productos</div><div class="metric__value">${list.length}</div></div>
        <div class="metric"><div class="metric__label">Unidades totales</div><div class="metric__value">${totalUnits}</div></div>
        <div class="metric"><div class="metric__label">Stock bajo</div><div class="metric__value" style="color:var(--warning)">${low.length}</div></div>
        <div class="metric"><div class="metric__label">Sin stock</div><div class="metric__value" style="color:var(--danger)">${out.length}</div></div>
        <div class="metric"><div class="metric__label">Valor total</div><div class="metric__value metric__value--brand">${money(totalValue)}</div></div>
      </div>

      <div class="panel">
        <div class="panel__head">
          <span class="panel__title">Ajuste rápido de stock</span>
          <span class="cell-sub">Los cambios se guardan al instante</span>
        </div>
        <div class="panel__body panel__body--flush">
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Producto</th><th>SKU</th><th>Actual</th><th>Ajustar</th><th>Estado</th></tr></thead>
              <tbody>
                ${list.map(p => `
                  <tr>
                    <td class="cell-name">${esc(p.name)}</td>
                    <td class="cell-sub">${esc(p.sku)}</td>
                    <td><strong>${p.stockQuantity}</strong></td>
                    <td>
                      <div style="display:flex;gap:var(--sp-2);align-items:center">
                        <input class="input" type="number" min="0" value="${p.stockQuantity}"
                               data-stock="${p.id}" data-current="${p.stockQuantity}"
                               style="width:88px;height:34px" inputmode="numeric">
                        <button class="btn btn--primary btn--sm" data-save-stock="${p.id}">Guardar</button>
                      </div>
                    </td>
                    <td>${p.stockStatus === "out_of_stock"
                          ? '<span class="tag tag--bad">Agotado</span>'
                          : p.stockStatus === "low_stock"
                            ? '<span class="tag tag--warn">Bajo</span>'
                            : '<span class="tag tag--ok">OK</span>'}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    $("#admin-content").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-save-stock]");
      if (!b) return;
      const id = b.dataset.saveStock;
      const input = $(`[data-stock="${id}"]`);
      const qty = Number(input.value);
      if (!Number.isFinite(qty) || qty < 0) { toast("Cantidad inválida", "warning"); return; }
      b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
      try {
        const current = Number($(`[data-stock="${id}"]`).dataset.current ?? 0);
        const delta = qty - current;
        await api("/inventory/adjust", {
          method: "POST",
          body: { productId: Number(id), changeQty: delta, reason: "adjustment" },
        });
        toast("Stock actualizado ✓", "success");
        renderInventory();
      } catch (err) {
        // Fallback: actualizar vía producto
        try {
          await api(`/products/${id}`, { method: "PUT", body: { stockQuantity: qty } });
          toast("Stock actualizado ✓", "success");
          renderInventory();
        } catch (e2) {
          b.disabled = false; b.textContent = "Guardar";
          toast(e2.message || err.message, "error");
        }
      }
    }, { once: true });
  }

  /* ─── Pedidos ────────────────────────────────────────── */
  async function renderOrders() {
    let orders = [];
    try {
      const res = await api("/admin/orders?limit=50");
      orders = res.orders || res.data || [];
    } catch (err) {
      if (err.status !== 404) throw err;
    }

    const statusTag = (s) => {
      const m = { pending: ["Pendiente","tag--warn"], confirmed: ["Confirmado","tag"],
                  shipped: ["Enviado","tag--ok"], delivered: ["Entregado","tag--ok"],
                  cancelled: ["Cancelado","tag--bad"] };
      const [label, cls] = m[s] || [s, "tag"];
      return `<span class="tag ${cls}">${esc(label)}</span>`;
    };

    $("#admin-content").innerHTML = `
      <div class="panel">
        <div class="panel__head"><span class="panel__title">Pedidos (${orders.length})</span></div>
        <div class="panel__body panel__body--flush">
          ${orders.length ? `
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>N°</th><th>Cliente</th><th>Total</th><th>Estado</th><th>Pago</th><th>Fecha</th></tr></thead>
              <tbody>
                ${orders.map(o => `
                  <tr>
                    <td><strong>#${esc(o.orderNumber || o.id)}</strong></td>
                    <td>
                      <div class="cell-name">${esc(o.customerName || "—")}</div>
                      <div class="cell-sub">${esc(o.customerEmail || "")}</div>
                    </td>
                    <td>${money(o.total)}</td>
                    <td>${statusTag(o.status)}</td>
                    <td><span class="tag">${esc(o.paymentStatus || "—")}</span></td>
                    <td class="cell-sub">${fmtDate(o.createdAt)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>` : `<div class="state"><div class="state__icon">🧾</div><p class="state__title">Todavía no hay pedidos</p><p>Los pedidos que entren desde la tienda aparecerán aquí.</p></div>`}
        </div>
      </div>
    `;
  }

  /* ─── Taller / Reparaciones ──────────────────────────── */
  const REPAIR_STATUSES = [
    { key: "", label: "Todos" },
    { key: "received", label: "📥 Recibido" },
    { key: "diagnosing", label: "🔍 En diagnóstico" },
    { key: "waiting_parts", label: "📦 Esperando repuestos" },
    { key: "in_repair", label: "🔧 En reparación" },
    { key: "testing", label: "🧪 En pruebas" },
    { key: "ready", label: "✅ Listo para retiro" },
    { key: "delivered", label: "🎉 Entregado" },
    { key: "unrepairable", label: "⚠️ No reparable" },
    { key: "cancelled", label: "🚫 Cancelado" },
  ];

  async function renderRepairs() {
    let data = { repairs: [], pagination: { total: 0 } };
    let stats = {};
    let alerts = { alerts: [], unreadCount: 0 };

    try {
      const [r, s, a] = await Promise.all([
        api("/admin/repairs?limit=100"),
        api("/admin/repairs/stats"),
        api("/admin/repairs-alerts"),
      ]);
      data = r; stats = s.stats || {}; alerts = a;
    } catch (err) {
      toast(err.message || "No se pudo cargar el taller", "error");
    }

    const repairs = data.repairs || [];

    const sevIcon = { critical: "🔴", warning: "🟠", info: "🔵" };

    $("#admin-content").innerHTML = `
      <div class="stats-grid" style="margin-bottom:var(--sp-4)">
        ${[
          ["Órdenes activas", stats.active || 0, "🔧"],
          ["Listas para retiro", stats.ready || 0, "✅"],
          ["Urgentes", stats.urgent || 0, "⚡"],
          ["Entregadas este mes", stats.deliveredThisMonth || 0, "🎉"],
          ["Consultas hoy", stats.lookupsToday || 0, "👁️"],
          ["Alertas sin leer", stats.unreadAlerts || 0, "🔔"],
        ].map(([label, val, icon]) => `
          <div class="stat-card">
            <div class="stat-card__icon" aria-hidden="true">${icon}</div>
            <div class="stat-card__val">${val}</div>
            <div class="stat-card__label">${label}</div>
          </div>`).join("")}
      </div>

      ${(alerts.alerts || []).length ? `
        <div class="panel" style="border-left:4px solid var(--warning,#f59e0b)">
          <div class="panel__head">
            <span class="panel__title">🔔 Alertas del taller (${alerts.unreadCount})</span>
            <button class="btn btn--ghost btn--sm" id="btn-read-all-alerts">Marcar todas leídas</button>
          </div>
          <div class="panel__body">
            <div style="display:grid;gap:var(--sp-2)">
              ${alerts.alerts.slice(0, 10).map(a => `
                <div class="alert-row" data-alert="${a.id}">
                  <span aria-hidden="true">${sevIcon[a.severity] || "🔵"}</span>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:.86rem">${esc(a.message)}</div>
                    <div class="cell-sub" style="font-size:.76rem">
                      ${a.workOrder ? "Orden " + esc(a.workOrder) + " · " : ""}
                      ${a.customerName ? esc(a.customerName) + " · " : ""}
                      ${a.customerPhone ? esc(a.customerPhone) + " · " : ""}
                      ${fmtDate(a.createdAt)}
                    </div>
                  </div>
                  <button class="btn btn--ghost btn--sm" data-read-alert="${a.id}">Leída</button>
                </div>`).join("")}
            </div>
          </div>
        </div>` : ""}

      <div class="panel">
        <div class="panel__head">
          <span class="panel__title">Órdenes de reparación (${data.pagination?.total || 0})</span>
          <button class="btn btn--primary btn--sm" id="btn-new-repair">+ Nueva orden</button>
        </div>
        <div class="panel__body">
          <div class="filters" style="margin-bottom:var(--sp-3)">
            <input class="input" id="rep-search" placeholder="Buscar por orden, RUT, serie, nombre o modelo…"
                   style="flex:1;min-width:220px" autocomplete="off">
            <select class="input" id="rep-status" style="width:auto">
              ${REPAIR_STATUSES.map(s => `<option value="${s.key}">${s.label}</option>`).join("")}
            </select>
          </div>

          <div id="rep-list">
            ${repairs.length ? repairs.map(r => `
              <div class="repair-row" data-id="${r.id}" tabindex="0" role="button">
                <div class="repair-row__main">
                  <div class="repair-row__wo">${esc(r.workOrder)}</div>
                  <div class="repair-row__customer">${esc(r.customerName)}</div>
                  <div class="repair-row__device">
                    ${esc([r.deviceBrand, r.deviceModel].filter(Boolean).join(" ") || r.deviceType || "—")}
                    · serie ${esc(r.serialNumber)}
                  </div>
                </div>
                <div class="repair-row__meta">
                  <span class="pill ${r.priority === "urgent" ? "pill--bad" : r.priority === "high" ? "pill--warn" : ""}">
                    ${r.priority === "urgent" ? "⚡ Urgente" : r.priority === "high" ? "Alta" : r.priority === "low" ? "Baja" : "Normal"}
                  </span>
                  <span class="pill">${esc(r.statusIcon)} ${esc(r.statusLabel)}</span>
                  ${r.estimatedCost ? `<span class="cell-sub">$${Number(r.estimatedCost).toLocaleString("es-CL")}</span>` : ""}
                  <span class="cell-sub" style="font-size:.76rem">${fmtDate(r.updatedAt)}</span>
                </div>
              </div>`).join("")
              : `<div class="state">
                   <div class="state__icon" aria-hidden="true">🛠️</div>
                   <p class="state__title">Sin órdenes de reparación</p>
                   <p>Crea la primera orden o espera a que el software de taller las envíe por la API.</p>
                 </div>`}
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head">
          <span class="panel__title">🔑 Claves de API del taller</span>
          <button class="btn btn--secondary btn--sm" id="btn-new-key">+ Nueva clave</button>
        </div>
        <div class="panel__body">
          <p class="cell-sub" style="margin-bottom:var(--sp-3);font-size:.84rem">
            Entrega estas claves a tu software de gestión de taller para que suba los estados
            automáticamente. El secreto se muestra <strong>una sola vez</strong>.
          </p>
          <div id="keys-list">Cargando…</div>
        </div>
      </div>
    `;

    /* ─── Filtros ─── */
    const applyFilters = async () => {
      const search = $("#rep-search")?.value.trim() || "";
      const status = $("#rep-status")?.value || "";
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (status) qs.set("status", status);
      qs.set("limit", "100");

      try {
        const res = await api(`/admin/repairs?${qs}`);
        const list = res.repairs || [];
        $("#rep-list").innerHTML = list.length ? list.map(r => `
          <div class="repair-row" data-id="${r.id}" tabindex="0" role="button">
            <div class="repair-row__main">
              <div class="repair-row__wo">${esc(r.workOrder)}</div>
              <div class="repair-row__customer">${esc(r.customerName)}</div>
              <div class="repair-row__device">
                ${esc([r.deviceBrand, r.deviceModel].filter(Boolean).join(" ") || r.deviceType || "—")}
                · serie ${esc(r.serialNumber)}
              </div>
            </div>
            <div class="repair-row__meta">
              <span class="pill ${r.priority === "urgent" ? "pill--bad" : r.priority === "high" ? "pill--warn" : ""}">
                ${r.priority === "urgent" ? "⚡ Urgente" : r.priority === "high" ? "Alta" : r.priority === "low" ? "Baja" : "Normal"}
              </span>
              <span class="pill">${esc(r.statusIcon)} ${esc(r.statusLabel)}</span>
              <span class="cell-sub" style="font-size:.76rem">${fmtDate(r.updatedAt)}</span>
            </div>
          </div>`).join("")
          : `<div class="state"><p>Sin resultados para ese filtro.</p></div>`;
        bindRows();
      } catch (err) { toast(err.message, "error"); }
    };

    let searchTimer;
    $("#rep-search")?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 350);
    });
    $("#rep-status")?.addEventListener("change", applyFilters);

    /* ─── Abrir detalle ─── */
    function bindRows() {
      $$(".repair-row").forEach(row => {
        const open = () => openRepairDetail(Number(row.dataset.id));
        row.addEventListener("click", open);
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
        });
      });
    }
    bindRows();

    /* ─── Alertas ─── */
    $("#btn-read-all-alerts")?.addEventListener("click", async () => {
      try {
        await api("/admin/repairs-alerts/read-all", { method: "POST" });
        toast("Alertas marcadas como leídas ✓", "success");
        await renderRepairs();
      } catch (err) { toast(err.message, "error"); }
    });

    $$("[data-read-alert]").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await api(`/admin/repairs-alerts/${btn.dataset.readAlert}/read`, { method: "POST" });
          btn.closest(".alert-row")?.remove();
          toast("Alerta marcada como leída ✓", "success");
        } catch (err) { toast(err.message, "error"); }
      });
    });

    /* ─── Nueva orden ─── */
    $("#btn-new-repair")?.addEventListener("click", () => openRepairForm());

    /* ─── Claves ─── */
    loadKeys();

    async function loadKeys() {
      try {
        const res = await api("/admin/repair-keys");
        const keys = res.keys || [];
        $("#keys-list").innerHTML = keys.length ? `
          <div style="display:grid;gap:var(--sp-2)">
            ${keys.map(k => `
              <div style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-2) var(--sp-3);
                          background:var(--bg-elevated,var(--bg-surface));border-radius:var(--r-md);
                          border:1px solid var(--border-light)">
                <div style="flex:1;min-width:0">
                  <div style="font-weight:600;font-size:.88rem">${esc(k.name)}</div>
                  <div class="cell-sub" style="font-size:.76rem">
                    <code>${esc(k.keyPrefix)}…</code> · ${esc(k.scopes)}
                    · ${k.lastUsedAt ? "último uso " + fmtDate(k.lastUsedAt) : "nunca usada"}
                  </div>
                </div>
                <span class="pill ${k.isActive ? "pill--ok" : "pill--bad"}">${k.isActive ? "Activa" : "Revocada"}</span>
                ${k.isActive ? `<button class="btn btn--ghost btn--sm" data-revoke="${k.id}">Revocar</button>` : ""}
              </div>`).join("")}
          </div>` : `<p class="cell-sub">No hay claves. Crea una para conectar tu software de taller.</p>`;

        $$("[data-revoke]").forEach(btn => {
          btn.addEventListener("click", async () => {
            const ok = await confirmDialog("Revocar clave",
              "El software que use esta clave dejará de poder subir estados. ¿Continuar?", "Revocar", true);
            if (!ok) return;
            try {
              await api(`/admin/repair-keys/${btn.dataset.revoke}`, { method: "DELETE" });
              toast("Clave revocada ✓", "success");
              loadKeys();
            } catch (err) { toast(err.message, "error"); }
          });
        });
      } catch (err) {
        $("#keys-list").innerHTML = `<p class="cell-sub">No se pudieron cargar las claves.</p>`;
      }
    }

    $("#btn-new-key")?.addEventListener("click", () => {
      openModal("Nueva clave de API",
        `<div class="form">
          <div class="form-field">
            <label class="form-label" for="key-name">Nombre del software</label>
            <input class="input" id="key-name" placeholder="Sistema de taller / POS / Script de importación">
            <span class="form-hint">Sirve para identificar qué sistema usa esta clave.</span>
          </div>
          <div class="form-field">
            <label class="form-label">Permisos</label>
            <label style="display:flex;gap:8px;align-items:center;font-size:.88rem;margin-bottom:6px">
              <input type="checkbox" id="key-read" checked> Leer órdenes y alertas
            </label>
            <label style="display:flex;gap:8px;align-items:center;font-size:.88rem">
              <input type="checkbox" id="key-write" checked> Crear órdenes y subir estados
            </label>
          </div>
        </div>`,
        `<button class="btn btn--secondary" data-close-modal>Cancelar</button>
         <button class="btn btn--primary" id="btn-create-key">Crear clave</button>`
      );

      $("#btn-create-key")?.addEventListener("click", async () => {
        const name = $("#key-name")?.value.trim();
        if (!name) { toast("Escribe un nombre", "warning"); return; }

        const scopes = [];
        if ($("#key-read")?.checked) scopes.push("repairs:read");
        if ($("#key-write")?.checked) scopes.push("repairs:write");
        if (!scopes.length) { toast("Selecciona al menos un permiso", "warning"); return; }

        try {
          const res = await api("/admin/repair-keys", { method: "POST", body: { name, scopes } });

          // Mostrar la clave UNA vez, con botón de copiar
          openModal("✅ Clave creada",
            `<div class="notice notice--warn" style="margin-bottom:var(--sp-3)">
              <span aria-hidden="true">⚠️</span>
              <span>Guarda esta clave <strong>ahora</strong>. No se puede recuperar después:
              el servidor solo almacena su hash.</span>
            </div>
            <div class="form-field">
              <label class="form-label">Clave de API</label>
              <div style="display:flex;gap:8px">
                <input class="input" id="new-key-value" value="${esc(res.key)}" readonly
                       style="font-family:monospace;font-size:.82rem">
                <button class="btn btn--secondary" id="btn-copy-key">Copiar</button>
              </div>
              <span class="form-hint">Úsala en la cabecera <code>X-API-Key</code> de tus peticiones.</span>
            </div>
            <div class="form-field">
              <label class="form-label">Ejemplo de uso</label>
              <pre style="background:var(--bg-base);padding:var(--sp-3);border-radius:var(--r-md);
                          font-size:.75rem;overflow-x:auto;margin:0">curl -X POST ${location.origin}/api/v1/repairs-api/orders \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${esc(res.key)}" \\
  -d '{"rut":"12.345.678-5","serialNumber":"SN-123",
       "customerName":"Juan Pérez","status":"received"}'</pre>
            </div>`,
            `<button class="btn btn--primary" data-close-modal>Entendido</button>`
          );

          $("#btn-copy-key")?.addEventListener("click", () => {
            const input = $("#new-key-value");
            input.select();
            navigator.clipboard?.writeText(input.value).then(
              () => toast("Clave copiada ✓", "success"),
              () => toast("Copia manualmente con Ctrl+C", "info")
            );
          });

          loadKeys();
        } catch (err) { toast(err.message, "error"); }
      });
    });
  }

  /* ─── Detalle de una orden de reparación ─────────────── */
  async function openRepairDetail(id) {
    try {
      const res = await api(`/admin/repairs/${id}`);
      const r = res.repair;
      const events = res.events || [];
      const lookups = res.lookups || [];

      const lookupSummary = lookups.length
        ? `${lookups.length} consultas del cliente (${lookups.filter(l => !l.success).length} fallidas)`
        : "El cliente aún no ha consultado esta orden";

      openModal(`Orden ${r.workOrder}`,
        `<div style="display:grid;gap:var(--sp-4)">
          <div style="display:flex;gap:var(--sp-2);flex-wrap:wrap">
            <span class="pill">${esc(r.statusIcon)} ${esc(r.statusLabel)}</span>
            <span class="pill ${r.priority === "urgent" ? "pill--bad" : r.priority === "high" ? "pill--warn" : ""}">
              ${r.priority === "urgent" ? "⚡ Urgente" : r.priority === "high" ? "Alta" : r.priority === "low" ? "Baja" : "Normal"}
            </span>
            <span class="pill">${r.source === "api" ? "🤖 Vía API" : "✍️ Manual"}</span>
          </div>

          <div class="detail-grid">
            <div><span class="cell-sub">Cliente</span><strong>${esc(r.customerName)}</strong></div>
            <div><span class="cell-sub">RUT</span><strong>${esc(r.rut)}</strong></div>
            <div><span class="cell-sub">Email</span><strong>${esc(r.customerEmail || "—")}</strong></div>
            <div><span class="cell-sub">Teléfono</span><strong>${esc(r.customerPhone || "—")}</strong></div>
            <div><span class="cell-sub">Equipo</span><strong>${esc([r.deviceBrand, r.deviceModel].filter(Boolean).join(" ") || "—")}</strong></div>
            <div><span class="cell-sub">N° de serie</span><strong>${esc(r.serialNumber)}</strong></div>
            <div><span class="cell-sub">Técnico</span><strong>${esc(r.technician || "sin asignar")}</strong></div>
            <div><span class="cell-sub">Recibido</span><strong>${fmtDate(r.receivedAt)}</strong></div>
            ${r.promisedAt ? `<div><span class="cell-sub">Entrega prometida</span><strong>${fmtDate(r.promisedAt)}</strong></div>` : ""}
            ${r.deliveredAt ? `<div><span class="cell-sub">Entregado</span><strong>${fmtDate(r.deliveredAt)}</strong></div>` : ""}
            <div><span class="cell-sub">Costo estimado</span><strong>$${Number(r.estimatedCost || 0).toLocaleString("es-CL")}</strong></div>
            <div><span class="cell-sub">Costo final</span><strong>$${Number(r.finalCost || 0).toLocaleString("es-CL")}</strong></div>
          </div>

          ${r.reportedIssue ? `<div><span class="cell-sub">Falla reportada</span><p style="margin:4px 0 0;font-size:.86rem">${esc(r.reportedIssue)}</p></div>` : ""}
          ${r.diagnosis ? `<div><span class="cell-sub">Diagnóstico</span><p style="margin:4px 0 0;font-size:.86rem">${esc(r.diagnosis)}</p></div>` : ""}

          <div>
            <span class="cell-sub">Actividad del cliente</span>
            <p style="margin:4px 0 0;font-size:.85rem">${lookupSummary}</p>
          </div>

          <div>
            <span class="cell-sub">Historial de estados (${events.length})</span>
            <div style="margin-top:8px;display:grid;gap:8px;max-height:240px;overflow-y:auto">
              ${events.map(e => `
                <div style="padding:8px 10px;background:var(--bg-elevated,var(--bg-surface));
                            border-radius:var(--r-sm,6px);border-left:3px solid var(--brand)">
                  <div style="font-size:.85rem;font-weight:600">${esc(e.statusLabel)}</div>
                  ${e.note ? `<div style="font-size:.82rem;color:var(--text-secondary)">${esc(e.note)}</div>` : ""}
                  ${e.internalNote ? `<div style="font-size:.78rem;color:var(--text-muted);font-style:italic">Interno: ${esc(e.internalNote)}</div>` : ""}
                  <div class="cell-sub" style="font-size:.74rem">
                    ${fmtDate(e.date)} · ${esc(e.createdBy)}${e.technician ? " · " + esc(e.technician) : ""}
                  </div>
                </div>`).join("")}
            </div>
          </div>
        </div>`,
        `<button class="btn btn--secondary" data-close-modal>Cerrar</button>
         <button class="btn btn--primary" id="btn-add-event">Añadir estado</button>`
      );

      $("#btn-add-event")?.addEventListener("click", () => openEventForm(r));

    } catch (err) {
      toast(err.message || "No se pudo abrir la orden", "error");
    }
  }

  /* ─── Formulario de nuevo estado ─────────────────────── */
  function openEventForm(repair) {
    openModal(`Nuevo estado — ${repair.workOrder}`,
      `<div class="form">
        <div class="form-field">
          <label class="form-label" for="ev-status">Estado</label>
          <select class="input" id="ev-status">
            ${REPAIR_STATUSES.filter(s => s.key).map(s =>
              `<option value="${s.key}" ${s.key === repair.status ? "selected" : ""}>${s.label}</option>`).join("")}
          </select>
        </div>
        <div class="form-field">
          <label class="form-label" for="ev-note">Comentario para el cliente</label>
          <textarea class="input" id="ev-note" rows="2"
                    placeholder="Lo que verá el cliente en el seguimiento."></textarea>
        </div>
        <div class="form-field">
          <label class="form-label" for="ev-internal">Nota interna <span class="opt">(no la ve el cliente)</span></label>
          <textarea class="input" id="ev-internal" rows="2"
                    placeholder="Detalle solo para el taller."></textarea>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label class="form-label" for="ev-tech">Técnico</label>
            <input class="input" id="ev-tech" value="${esc(repair.technician || "")}">
          </div>
          <div class="form-field">
            <label class="form-label" for="ev-cost">Costo final</label>
            <input class="input" id="ev-cost" type="number" min="0" value="${Number(repair.finalCost || 0)}">
          </div>
        </div>
      </div>`,
      `<button class="btn btn--secondary" data-close-modal>Cancelar</button>
       <button class="btn btn--primary" id="btn-save-event">Guardar estado</button>`
    );

    $("#btn-save-event")?.addEventListener("click", async () => {
      const body = {
        status: $("#ev-status")?.value,
        note: $("#ev-note")?.value.trim() || undefined,
        internalNote: $("#ev-internal")?.value.trim() || undefined,
        technician: $("#ev-tech")?.value.trim() || undefined,
        finalCost: Number($("#ev-cost")?.value) || 0,
      };

      try {
        await api(`/admin/repairs/${repair.id}/events`, { method: "POST", body });
        toast("Estado registrado ✓", "success");
        closeModal();
        await renderRepairs();
      } catch (err) { toast(err.message, "error"); }
    });
  }

  /* ─── Formulario de nueva orden ──────────────────────── */
  function openRepairForm() {
    openModal("Nueva orden de reparación",
      `<div class="form">
        <div class="form-row">
          <div class="form-field">
            <label class="form-label" for="nr-name">Nombre del cliente <span class="req">*</span></label>
            <input class="input" id="nr-name" required>
          </div>
          <div class="form-field">
            <label class="form-label" for="nr-rut">RUT <span class="req">*</span></label>
            <input class="input" id="nr-rut" placeholder="12.345.678-9">
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label class="form-label" for="nr-email">Email</label>
            <input class="input" id="nr-email" type="email">
          </div>
          <div class="form-field">
            <label class="form-label" for="nr-phone">Teléfono</label>
            <input class="input" id="nr-phone" placeholder="+56 9 1234 5678">
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label class="form-label" for="nr-type">Tipo de equipo</label>
            <input class="input" id="nr-type" placeholder="Notebook, PC, consola…">
          </div>
          <div class="form-field">
            <label class="form-label" for="nr-serial">N° de serie <span class="req">*</span></label>
            <input class="input" id="nr-serial" placeholder="SN-ABC123">
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label class="form-label" for="nr-brand">Marca</label>
            <input class="input" id="nr-brand">
          </div>
          <div class="form-field">
            <label class="form-label" for="nr-model">Modelo</label>
            <input class="input" id="nr-model">
          </div>
        </div>
        <div class="form-field">
          <label class="form-label" for="nr-issue">Falla reportada</label>
          <textarea class="input" id="nr-issue" rows="2" placeholder="Lo que describe el cliente."></textarea>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label class="form-label" for="nr-priority">Prioridad</label>
            <select class="input" id="nr-priority">
              <option value="normal">Normal</option>
              <option value="low">Baja</option>
              <option value="high">Alta</option>
              <option value="urgent">⚡ Urgente</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label" for="nr-tech">Técnico</label>
            <input class="input" id="nr-tech">
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label class="form-label" for="nr-est">Costo estimado</label>
            <input class="input" id="nr-est" type="number" min="0" value="0">
          </div>
          <div class="form-field">
            <label class="form-label" for="nr-warranty">Garantía (días)</label>
            <input class="input" id="nr-warranty" type="number" min="0" value="90">
          </div>
        </div>
      </div>`,
      `<button class="btn btn--secondary" data-close-modal>Cancelar</button>
       <button class="btn btn--primary" id="btn-save-repair">Crear orden</button>`
    );

    $("#btn-save-repair")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const body = {
        customerName: $("#nr-name")?.value.trim(),
        rut: $("#nr-rut")?.value.trim(),
        serialNumber: $("#nr-serial")?.value.trim(),
        customerEmail: $("#nr-email")?.value.trim() || undefined,
        customerPhone: $("#nr-phone")?.value.trim() || undefined,
        deviceType: $("#nr-type")?.value.trim() || undefined,
        deviceBrand: $("#nr-brand")?.value.trim() || undefined,
        deviceModel: $("#nr-model")?.value.trim() || undefined,
        reportedIssue: $("#nr-issue")?.value.trim() || undefined,
        priority: $("#nr-priority")?.value,
        technician: $("#nr-tech")?.value.trim() || undefined,
        estimatedCost: Number($("#nr-est")?.value) || 0,
        warrantyDays: Number($("#nr-warranty")?.value) || 90,
      };

      if (!body.customerName || !body.rut || !body.serialNumber) {
        toast("Nombre, RUT y número de serie son obligatorios", "warning");
        return;
      }

      btn.disabled = true;
      try {
        const res = await api("/admin/repairs", { method: "POST", body });
        toast(`Orden ${res.repair.workOrder} creada ✓`, "success");
        closeModal();
        await renderRepairs();
      } catch (err) {
        toast(err.details ? err.details.join(" · ") : (err.message || "No se pudo crear la orden"), "error");
      } finally { btn.disabled = false; }
    });
  }

  /* ─── Utilidad de fecha ──────────────────────────────── */
  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(String(iso).replace(" ", "T") + (String(iso).includes("Z") ? "" : "Z"));
      return d.toLocaleString("es-CL", {
        day: "2-digit", month: "2-digit", year: "2-digit",
        hour: "2-digit", minute: "2-digit",
      });
    } catch (_) { return iso; }
  }

  /* ─── Chat ───────────────────────────────────────────── */
  async function renderChat() {
    let sessions = [];
    try {
      const res = await api("/chat/sessions");
      sessions = res.sessions || res.data || [];
    } catch (_) { /* endpoint opcional */ }

    $("#admin-content").innerHTML = `
      <div class="panel">
        <div class="panel__head"><span class="panel__title">Conversaciones (${sessions.length})</span></div>
        <div class="panel__body panel__body--flush">
          ${sessions.length ? `
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Visitante</th><th>Último mensaje</th><th>Mensajes</th><th>Fecha</th></tr></thead>
              <tbody>
                ${sessions.map(s => `
                  <tr>
                    <td class="cell-sub">${esc(s.sessionId || s.id)}</td>
                    <td>${esc((s.lastMessage || "").slice(0, 80))}</td>
                    <td>${s.messageCount || 0}</td>
                    <td class="cell-sub">${fmtDate(s.updatedAt)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>` : `<div class="state"><div class="state__icon">💬</div><p class="state__title">Sin conversaciones todavía</p><p>Cuando un visitante use el chat de la tienda, verás aquí sus consultas.</p></div>`}
        </div>
      </div>
    `;
  }

  /* ─── Configuración ──────────────────────────────────── */
  async function renderSettings() {
    let info = {};
    try { info = await api("/system/info"); } catch (_) {}
    let settings = {};
    try {
      const r = await api("/admin/settings");
      settings = r.settings || {};
    } catch (_) {}

    const f = info.features || {};
    const flag = (ok, label) => `<span class="tag ${ok ? "tag--ok" : "tag--bad"}">${ok ? "✓" : "✕"} ${esc(label)}</span>`;

    // Valor booleano de un ajuste ('1'/'true' = activo)
    const on = (key, def = false) => {
      const v = settings[key];
      if (v === undefined || v === "") return def;
      return v === "1" || v === "true";
    };

    // Interruptor de módulo: guarda al cambiar
    const toggle = (key, label, desc, checked) => `
      <label class="module-toggle">
        <input type="checkbox" class="module-switch" data-setting="${key}"
               ${checked ? "checked" : ""} role="switch">
        <span class="module-toggle__body">
          <span class="module-toggle__title">${esc(label)}</span>
          <span class="module-toggle__desc">${esc(desc)}</span>
        </span>
        <span class="module-toggle__state" aria-hidden="true">${checked ? "Activo" : "Inactivo"}</span>
      </label>`;

    const storeEnabled = on("store_enabled", false);
    const pickupEnabled = on("store_pickup_enabled", false);
    const gatewayEnabled = on("payment_gateway_enabled", false);

    $("#admin-content").innerHTML = `
      <div class="panel">
        <div class="panel__head">
          <span class="panel__title">Módulos del sitio</span>
          <span class="cell-sub">Activa o desactiva funciones en vivo</span>
        </div>
        <div class="panel__body">
          <div class="modules-list">
            ${toggle("store_enabled", "🏬 Tienda física",
              "Muestra la dirección, horarios y el retiro en tienda. Al desactivarlo, esas secciones desaparecen del sitio.",
              storeEnabled)}
            ${toggle("store_pickup_enabled", "🏬 Retiro en tienda",
              "Permite elegir «retiro en tienda» en el checkout. Requiere que la tienda física esté activa.",
              pickupEnabled)}
            ${toggle("payment_gateway_enabled", "💳 Pasarela de pago",
              "Desactivada: el carrito funciona como ORDEN DE COMPRA (el cliente envía el pedido y un ejecutivo coordina el pago). Activada: el carrito funciona como CARRO DE COMPRA con pago en línea.",
              gatewayEnabled)}
          </div>

          <div class="mode-banner mode-banner--${gatewayEnabled ? "pay" : "order"}">
            <span class="mode-banner__icon" aria-hidden="true">${gatewayEnabled ? "💳" : "📋"}</span>
            <div>
              <strong>Modo actual del carrito: ${gatewayEnabled ? "Carro de compra (pago en línea)" : "Orden de compra"}</strong>
              <p>${gatewayEnabled
                ? "Los clientes pagan en línea mediante la pasarela. El pedido queda confirmado automáticamente al aprobarse el pago."
                : "Los clientes envían su pedido sin pagar. Tú lo recibes en Pedidos, lo contactas y coordinas el pago y la entrega."}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head"><span class="panel__title">Datos de la tienda física</span></div>
        <div class="panel__body">
          <div class="form-row">
            <div class="form-field">
              <label class="form-label" for="set-store-name">Nombre</label>
              <input class="input" id="set-store-name" data-setting="store_name"
                     value="${esc(settings.store_name || "")}" placeholder="TecnoGamer San Diego">
            </div>
            <div class="form-field">
              <label class="form-label" for="set-store-phone">Teléfono</label>
              <input class="input" id="set-store-phone" data-setting="store_phone"
                     value="${esc(settings.store_phone || "")}" placeholder="+56 2 2560 0040">
            </div>
          </div>
          <div class="form-field">
            <label class="form-label" for="set-store-address">Dirección</label>
            <input class="input" id="set-store-address" data-setting="store_address"
                   value="${esc(settings.store_address || "")}" placeholder="Santiago 965, Local 14, San Diego">
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="form-label" for="set-store-hours">Horario</label>
              <input class="input" id="set-store-hours" data-setting="store_hours"
                     value="${esc(settings.store_hours || "")}" placeholder="Lun–Sáb 10:30–19:30">
            </div>
            <div class="form-field">
              <label class="form-label" for="set-pickup-min">Minutos para alistar el retiro</label>
              <input class="input" id="set-pickup-min" data-setting="store_pickup_ready_minutes"
                     type="number" min="0" value="${esc(settings.store_pickup_ready_minutes || "90")}">
              <span class="form-hint">Tiempo que tardas en preparar un pedido para retiro.</span>
            </div>
          </div>
          <button class="btn btn--primary" id="btn-save-store">Guardar datos de la tienda</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head"><span class="panel__title">Estado del sistema</span></div>
        <div class="panel__body">
          <div style="display:grid;gap:var(--sp-3)">
            <div style="display:flex;justify-content:space-between;padding:var(--sp-2) 0;border-bottom:1px solid var(--border)">
              <span class="cell-sub">Tienda</span><strong>${esc(info.name || "TecnoGamer")}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:var(--sp-2) 0;border-bottom:1px solid var(--border)">
              <span class="cell-sub">Versión</span><strong>${esc(info.version || "1.0.0")}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:var(--sp-2) 0;align-items:center">
              <span class="cell-sub">Entorno</span>
              <span class="pill ${info.environment === "production" ? "pill--ok" : "pill--warn"}">
                ${info.environment === "production" ? "PRODUCCIÓN" : "DESARROLLO"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head"><span class="panel__title">Módulos</span></div>
        <div class="panel__body">
          <div style="display:flex;gap:var(--sp-2);flex-wrap:wrap">
            ${flag(f.stripe, "Pasarela de pago")}
            ${flag(f.aiDescriptions, "Descripciones con IA")}
            ${flag(f.webChat, "Chat web")}
            ${flag(f.whatsappChat, "WhatsApp")}
            ${flag(f.inventory, "Inventario")}
            ${flag(f.backups, "Copias de seguridad")}
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head"><span class="panel__title">Seguridad activa</span></div>
        <div class="panel__body">
          <div style="display:grid;gap:var(--sp-2);font-size:.88rem">
            <div>✓ Contraseñas con hash bcrypt (coste 12)</div>
            <div>✓ Sesiones con JWT y rotación de refresh token</div>
            <div>✓ Límite de intentos de acceso (anti fuerza bruta)</div>
            <div>✓ Cabeceras de seguridad (CSP, HSTS, X-Frame-Options)</div>
            <div>✓ Consultas parametrizadas (sin inyección SQL)</div>
            <div>✓ Validación y saneado de todas las entradas</div>
            <div>✓ Datos de tarjeta nunca tocan nuestros servidores</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head"><span class="panel__title">Tareas del operador</span></div>
        <div class="panel__body">
          <div style="display:flex;gap:var(--sp-3);flex-wrap:wrap">
            <button class="btn btn--secondary" id="btn-export">⬇️ Exportar catálogo (CSV)</button>
            <button class="btn btn--secondary" id="btn-backup">💾 Crear copia de seguridad</button>
          </div>
        </div>
      </div>
    `;

    /* ─── Guardado de módulos y datos de tienda ─── */
    const saveSettings = async (payload, okMsg) => {
      try {
        await api("/admin/settings", { method: "PUT", body: { settings: payload } });
        toast(okMsg, "success");
        return true;
      } catch (err) {
        toast(err.message || "No se pudo guardar", "error");
        return false;
      }
    };

    // Interruptores: guardan al cambiar y recargan para reflejar dependencias
    document.querySelectorAll(".module-switch").forEach(sw => {
      sw.addEventListener("change", async () => {
        const key = sw.dataset.setting;
        const val = sw.checked ? "1" : "0";
        const payload = { [key]: val };

        // Desactivar la tienda física desactiva también el retiro
        if (key === "store_enabled" && val === "0") payload.store_pickup_enabled = "0";

        sw.disabled = true;
        const ok = await saveSettings(payload, sw.checked ? "Módulo activado ✓" : "Módulo desactivado ✓");
        sw.disabled = false;
        if (ok) await renderSettings();
        else sw.checked = !sw.checked;
      });
    });

    // Guardar datos de la tienda física
    $("#btn-save-store")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const keys = ["store_name", "store_phone", "store_address", "store_hours", "store_pickup_ready_minutes"];
      const payload = {};
      for (const k of keys) {
        const el = document.querySelector(`[data-setting="${k}"]`);
        if (el) payload[k] = el.value.trim();
      }
      btn.disabled = true;
      const ok = await saveSettings(payload, "Datos de la tienda guardados ✓");
      btn.disabled = false;
      if (ok) await renderSettings();
    });

    $("#btn-export")?.addEventListener("click", exportCsv);
    $("#btn-backup")?.addEventListener("click", async () => {
      try {
        await api("/admin/backup", { method: "POST" });
        toast("Copia de seguridad creada ✓", "success");
      } catch (err) { toast(err.message || "No se pudo crear la copia", "error"); }
    });
  }

  async function exportCsv() {
    try {
      const res = await api("/products?limit=100");
      const list = res.products || [];
      const head = ["SKU","Nombre","Categoría","Precio","Stock","Estado"];
      const rows = list.map(p => [
        p.sku, p.name, p.category?.name || "", p.price, p.stockQuantity, p.stockStatus,
      ]);
      const csv = [head, ...rows]
        .map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `catalogo-tecnogamer-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Catálogo exportado ✓", "success");
    } catch (err) { toast(err.message, "error"); }
  }

  /* ─── Eventos globales ───────────────────────────────── */
  function bind() {
    $("#login-form").addEventListener("submit", doLogin);
    $("#btn-logout").addEventListener("click", () => {
      setToken(null);
      localStorage.removeItem("tg_admin_user");
      showLogin();
      toast("Sesión cerrada", "info");
    });

    $$(".nav-item").forEach(b => b.addEventListener("click", () => navigate(b.dataset.view)));

    $("#modal-close").addEventListener("click", closeModal);
    $("#modal-backdrop").addEventListener("click", (e) => { if (e.target.id === "modal-backdrop") closeModal(); });
    $("#modal-foot").addEventListener("click", (e) => { if (e.target.closest("[data-close-modal]")) closeModal(); });

    $("#btn-menu").addEventListener("click", () => $("#sidebar").classList.toggle("is-open"));

    // Delegación para botones "ir a"
    document.addEventListener("click", (e) => {
      const go = e.target.closest("[data-go]");
      if (go) navigate(go.dataset.go);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  /* ─── Inicio ─────────────────────────────────────────── */
  async function init() {
    bind();
    const tk = getToken();
    if (!tk) { showLogin(); return; }

    try {
      await api("/auth/me");
      showApp();
      navigate("dashboard");
    } catch (_) {
      setToken(null);
      showLogin();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
