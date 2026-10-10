/* ============================================================
   STORE — Lógica del storefront TecnoGamer
   ============================================================
   Catálogo, filtros, carrito, checkout, chat de ventas.
   Vanilla JS, sin dependencias. Accesible por teclado.
   ============================================================ */
"use strict";

(() => {
  /* ─── Utilidades ─────────────────────────────────────── */
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const money = (n) =>
    new Intl.NumberFormat("es-CL", {
      style: "currency", currency: "CLP",
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(Number(n) || 0);

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const stars = (avg = 0) => {
    const n = Math.round(Number(avg) || 0);
    return "★".repeat(Math.max(0, Math.min(5, n))) + "☆".repeat(Math.max(0, 5 - n));
  };

  const debounce = (fn, ms = 350) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  /**
   * Cuotas sin interés según el monto (misma lógica que el backend).
   * Se usa para mostrar el "hasta N cuotas" en carrito y detalle.
   */
  const installmentsFor = (amount) => {
    if (amount >= 1000000) return 24;
    if (amount >= 500000)  return 18;
    if (amount >= 200000)  return 12;
    if (amount >= 100000)  return 6;
    if (amount >= 50000)   return 3;
    return 0;
  };

  /* ─── Estado ─────────────────────────────────────────── */
  const state = {
    page: 1,
    limit: 12,
    totalPages: 1,
    category: "",
    search: "",
    sort: "newest",
    minPrice: "",
    maxPrice: "",
    inStock: "",
    products: [],
    cart: { items: [], subtotal: 0 },
    // Configuración pública del sitio (módulos, envío, moneda).
    // Se carga una vez al inicio desde GET /api/v1/config.
    config: null,
  };

  /* ─── Configuración del sitio ────────────────────────── */
  // Valores por defecto mientras llega la config del backend.
  const COMMERCE = {
    shippingFlatRate: 5990,
    freeShippingThreshold: 75000,
    currency: "CLP",
  };

  async function loadSiteConfig() {
    try {
      const cfg = await API.config();
      state.config = cfg;

      // Aplicar valores de comercio reales
      if (cfg?.commerce) {
        COMMERCE.shippingFlatRate = Number(cfg.commerce.shippingFlatRate) || 0;
        COMMERCE.freeShippingThreshold = Number(cfg.commerce.freeShippingThreshold) || 0;
        COMMERCE.currency = cfg.site?.currency || "CLP";
      }

      // Nombre y datos del sitio
      if (cfg?.site?.name) {
        document.title = `${cfg.site.name} — Tecnología y Gaming`;
        $$("[data-site-name]").forEach(el => { el.textContent = cfg.site.name; });
      }

      return cfg;
    } catch (_) {
      // Si falla, la tienda sigue funcionando con los valores por defecto
      return null;
    }
  }

  /** Costo de envío según el subtotal y la config del backend. */
  const shippingFor = (subtotal) =>
    subtotal >= COMMERCE.freeShippingThreshold ? 0 : COMMERCE.shippingFlatRate;

  /* ─── Notificaciones ─────────────────────────────────── */
  const toasts = $("#toasts");
  function toast(message, type = "info", ms = 3800) {
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.textContent = message;
    toasts.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(20px)";
      setTimeout(() => el.remove(), 220);
    }, ms);
  }

  /* ─── Estado de carga / error en el grid ─────────────── */
  function gridLoading() {
    const g = $("#product-grid");
    g.setAttribute("aria-busy", "true");
    g.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join("");
  }

  function gridMessage(icon, title, text) {
    const g = $("#product-grid");
    g.setAttribute("aria-busy", "false");
    g.innerHTML = `
      <div class="state">
        <div class="state__icon" aria-hidden="true">${icon}</div>
        <p class="state__title">${esc(title)}</p>
        <p>${esc(text)}</p>
      </div>`;
  }

  /* ─── Render de producto ─────────────────────────────── */
  function productCard(p) {
    const img = p.images?.find(i => i.isPrimary)?.url || p.images?.[0]?.url || p.imageUrl;
    const hasDiscount = p.compareAtPrice && p.compareAtPrice > p.price;
    const discount = p.discountPercent || (hasDiscount
      ? Math.round((1 - p.price / p.compareAtPrice) * 100)
      : 0);

    // Modelo de precios retail: precio de transferencia como gancho principal
    const cashPrice = p.cashPrice != null ? p.cashPrice : p.price;
    const hasCashAdvantage = cashPrice < p.price;
    const installments = p.installments || 0;
    const installmentValue = p.installmentValue ||
      (installments > 0 ? Math.round(cashPrice / installments) : null);

    const flags = [];
    if (p.isNew) flags.push('<span class="flag flag--new">Nuevo</span>');
    if (discount > 0) flags.push(`<span class="flag flag--discount">-${discount}%</span>`);
    if (p.stockStatus === "out_of_stock") flags.push('<span class="flag flag--out">Sin stock</span>');
    else if (p.stockStatus === "low_stock") flags.push('<span class="flag flag--low">Últimas unidades</span>');

    const soldOut = p.stockStatus === "out_of_stock";

    // Marca: primera palabra del nombre (los catálogos tech la usan como filtro)
    const brand = (p.name || "").split(" ")[0];

    return `
      <article class="product-card" data-id="${p.id}">
        <div class="product-card__media">
          <div class="product-card__flags">${flags.join("")}</div>
          ${img
            ? `<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
            : `<span class="product-card__placeholder" aria-hidden="true">📦</span>`}
        </div>
        <div class="product-card__body">
          <span class="product-card__brand">${esc(brand)}</span>
          <h3 class="product-card__name">${esc(p.name)}</h3>
          <div class="product-card__rating">
            <span class="stars" aria-hidden="true">${stars(p.ratingAvg)}</span>
            <span>${Number(p.ratingAvg || 0).toFixed(1)} (${p.ratingCount || 0})</span>
          </div>

          <div class="price-block">
            <div class="price-cash">
              <span class="price-cash__label">Transferencia</span>
            </div>
            <div class="price-cash">
              <span class="price-cash__value">${money(cashPrice)}</span>
            </div>
            ${hasCashAdvantage
              ? `<div class="price-normal">Normal <span class="price-normal__value">${money(p.price)}</span></div>`
              : (hasDiscount ? `<div class="price-normal">Antes <span class="price-normal__value">${money(p.compareAtPrice)}</span></div>` : "")}
            ${installments > 0
              ? `<div class="installments">o hasta <strong>${installments} cuotas</strong> de ${money(installmentValue)}</div>`
              : ""}
            ${p.pickupAvailable
              ? `<div class="pickup-badge">Retiro en tienda</div>`
              : ""}
          </div>

          <div class="product-card__foot">
            <button class="btn btn--secondary btn--sm" data-action="detail" data-id="${p.id}">
              Ver detalle
            </button>
            <button class="btn btn--primary btn--sm" data-action="add" data-id="${p.id}"
              ${soldOut ? "disabled" : ""} aria-label="Agregar ${esc(p.name)} al carrito">
              ${soldOut ? "Agotado" : "Agregar"}
            </button>
          </div>
        </div>
      </article>`;
  }

  function renderProducts(list, append = false) {
    const g = $("#product-grid");
    g.setAttribute("aria-busy", "false");
    if (!list.length) {
      if (!append) gridMessage("🔍", "Sin resultados", "Prueba con otros filtros o términos de búsqueda.");
      return;
    }
    const html = list.map(productCard).join("");
    if (append) g.insertAdjacentHTML("beforeend", html);
    else g.innerHTML = html;
  }

  /* ─── Catálogo ───────────────────────────────────────── */
  async function loadProducts({ append = false } = {}) {
    if (!append) { state.page = 1; gridLoading(); }

    try {
      const res = await API.products({
        page: state.page,
        limit: state.limit,
        category: state.category,
        search: state.search,
        sort: state.sort,
        minPrice: state.minPrice,
        maxPrice: state.maxPrice,
        inStock: state.inStock,
      });

      const list = res.products || [];
      state.products = append ? [...state.products, ...list] : list;
      state.totalPages = res.pagination?.totalPages || 1;

      renderProducts(list, append);

      const total = res.pagination?.total ?? list.length;
      $("#catalog-count").textContent =
        total === 1 ? "1 producto encontrado" : `${total} productos encontrados`;

      $("#btn-load-more").hidden = state.page >= state.totalPages;
    } catch (err) {
      console.error("Error cargando catálogo:", err);
      gridMessage("⚠️", "No se pudo cargar el catálogo",
        err.code === "TIMEOUT" ? "La conexión tardó demasiado." : "Revisa tu conexión e inténtalo de nuevo.");
      toast(err.message || "Error al cargar productos", "error");
    }
  }

  /* ─── Categorías ─────────────────────────────────────── */
  async function loadCategories() {
    try {
      const res = await API.categories();
      const cats = res.categories || [];
      const nav = $("#nav-categories");
      nav.innerHTML =
        `<li><a class="navbar__link is-active" href="#" data-cat="">Todos</a></li>` +
        cats.map(c =>
          `<li><a class="navbar__link" href="#" data-cat="${esc(c.slug)}">${esc(c.name)}${
            c.product_count ? ` <span style="opacity:.6">(${c.product_count})</span>` : ""
          }</a></li>`
        ).join("");

      $("#stat-categories").textContent = cats.length;
    } catch (err) {
      console.error("Error cargando categorías:", err);
      $("#stat-categories").textContent = "—";
    }
  }

  /* ─── Estadísticas del hero ──────────────────────────── */
  async function loadStats() {
    try {
      const res = await API.products({ limit: 1 });
      $("#stat-products").textContent = res.pagination?.total ?? "—";
    } catch (_) {
      $("#stat-products").textContent = "—";
    }
  }

  /* ─── Grilla de categorías (patrón retail) ───────────── */
  const CAT_ICONS = {
    "componentes-pc": "🧩", "consolas": "🎮", "videojuegos": "🕹️",
    "perifericos": "⌨️", "notebooks": "💻", "monitores": "🖥️",
    "almacenamiento": "💾", "audio": "🎧", "electronica": "🔌",
  };

  async function loadCategoryGrid() {
    const grid = $("#cat-grid");
    try {
      const res = await API.categories();
      const cats = (res.categories || []).filter(c => c.product_count > 0);

      if (!cats.length) {
        grid.innerHTML = `<div class="state" style="grid-column:1/-1">
          <p>No hay categorías disponibles.</p></div>`;
        return;
      }

      grid.innerHTML = cats.map(c => `
        <a class="cat-card" href="#catalogo" data-cat="${esc(c.slug)}">
          <span class="cat-card__icon" aria-hidden="true">${CAT_ICONS[c.slug] || "📦"}</span>
          <span class="cat-card__name">${esc(c.name)}</span>
          <span class="cat-card__count">${c.product_count} producto${c.product_count === 1 ? "" : "s"}</span>
        </a>`).join("");

      // Al pulsar una categoría se filtra el catálogo
      grid.addEventListener("click", (e) => {
        const card = e.target.closest("[data-cat]");
        if (!card) return;
        state.category = card.dataset.cat;
        $$(".navbar__link").forEach(a =>
          a.classList.toggle("is-active", a.dataset.cat === state.category));
        loadProducts();
      });
    } catch (err) {
      console.error("Error cargando categorías:", err);
      grid.innerHTML = "";
    }
  }

  /* ─── Ofertas destacadas ─────────────────────────────── */
  async function loadFeatured() {
    const grid = $("#featured-grid");
    try {
      const res = await API.featured(8);
      const list = (res.products || []).slice(0, 8);
      if (!list.length) {
        grid.innerHTML = `<div class="state" style="grid-column:1/-1">
          <p>No hay ofertas activas en este momento.</p></div>`;
        return;
      }
      grid.innerHTML = list.map(productCard).join("");
    } catch (err) {
      console.error("Error cargando ofertas:", err);
      grid.innerHTML = "";
    }
  }

  /* ─── Gamer Zone ─────────────────────────────────────── */
  // Categorías que componen la zona gamer (mismo criterio que el retail tech)
  const GAMER_SLUGS = ["componentes-pc", "consolas", "perifericos", "monitores"];

  async function loadGamerZone() {
    const grid = $("#gamer-grid");
    try {
      const results = await Promise.all(
        GAMER_SLUGS.map(slug =>
          API.products({ category: slug, limit: 4, sort: "sales-desc" })
            .then(r => r.products || [])
            .catch(() => [])
        )
      );

      // Intercalar para que se vean productos de varias categorías
      const merged = [];
      const maxLen = Math.max(...results.map(r => r.length), 0);
      for (let i = 0; i < maxLen && merged.length < 8; i++) {
        for (const arr of results) {
          if (arr[i] && merged.length < 8) merged.push(arr[i]);
        }
      }

      if (!merged.length) {
        grid.innerHTML = `<div class="state" style="grid-column:1/-1">
          <p>La zona gamer estará disponible pronto.</p></div>`;
        return;
      }
      grid.innerHTML = merged.map(productCard).join("");
    } catch (err) {
      console.error("Error cargando Gamer Zone:", err);
      grid.innerHTML = "";
    }
  }

  /* ─── Tiendas (módulo configurable y desconectable) ──── */
  // Las tiendas vienen del backend (GET /api/v1/config/stores).
  // Si el módulo está desconectado, la sección completa se oculta.
  let STORES = [];

  async function loadStores() {
    const section = $("#tiendas");
    const grid = $("#stores-grid");
    if (!grid) return;

    try {
      const res = await API.request("/config/stores");

      // Módulo desconectado → ocultar toda la sección
      if (!res.moduleEnabled || !res.stores?.length) {
        if (section) section.hidden = true;
        return;
      }

      STORES = res.stores;
      if (section) section.hidden = false;

      grid.innerHTML = STORES.map(s => `
        <div class="store-card">
          <span class="store-card__icon" aria-hidden="true">🏬</span>
          <div>
            <div class="store-card__name">${esc(s.name)}</div>
            ${s.address ? `<div class="store-card__meta">${esc(s.address)}${s.city ? `, ${esc(s.city)}` : ""}</div>` : ""}
            ${s.hours ? `<div class="store-card__meta">🕐 ${esc(s.hours)}</div>` : ""}
            ${s.phone ? `<div class="store-card__meta">📞 ${esc(s.phone)}</div>` : ""}
            ${s.isPickup ? `<div class="store-card__meta"><span class="badge badge--ok">Retiro disponible</span></div>` : ""}
          </div>
        </div>`).join("");

      // Actualizar la nota de retiro con los minutos configurados
      const note = $(".stores__note");
      if (note && res.pickupEnabled) {
        const mins = state.config?.modules?.store?.pickupReadyMinutes || 90;
        note.textContent = `ℹ️ El stock por tienda se actualiza cada 10 minutos. El retiro está disponible desde ${mins} minutos después de confirmado el pedido, presentando el documento de compra y cédula de identidad.`;
      }
    } catch (_) {
      if (section) section.hidden = true;
    }
  }

  /* ─── Barra de anuncios rotativa ─────────────────────── */
  function startTopbarRotation() {
    const msgs = $$(".topbar__msg");
    if (msgs.length < 2) return;
    let i = 0;
    setInterval(() => {
      msgs[i].classList.remove("is-active");
      i = (i + 1) % msgs.length;
      msgs[i].classList.add("is-active");
    }, 4500);
  }

  /* ─── Menú móvil de categorías ───────────────────────── */
  async function loadMobileMenu() {
    try {
      const res = await API.categories();
      const cats = (res.categories || []).filter(c => c.product_count > 0);
      $("#menu-body").innerHTML =
        `<button class="menu-cat" data-cat="">
           <span>Todos los productos</span>
           <span class="menu-cat__count">${$("#stat-products").textContent}</span>
         </button>` +
        cats.map(c => `
          <button class="menu-cat" data-cat="${esc(c.slug)}">
            <span>${CAT_ICONS[c.slug] || "📦"} ${esc(c.name)}</span>
            <span class="menu-cat__count">${c.product_count}</span>
          </button>`).join("");
    } catch (_) {
      $("#menu-body").innerHTML = `<p class="form-hint">No se pudieron cargar las categorías.</p>`;
    }
  }

  /* ─── Carrito ────────────────────────────────────────── */
  function renderCart() {
    const body = $("#cart-body");
    const foot = $("#cart-foot");
    const items = state.cart.items || [];

    $("#cart-count").textContent = items.reduce((s, i) => s + i.quantity, 0);
    $("#cart-count").hidden = items.length === 0;

    if (!items.length) {
      body.innerHTML = `
        <div class="state">
          <div class="state__icon" aria-hidden="true">🛒</div>
          <p class="state__title">Tu carrito está vacío</p>
          <p>Agrega productos para comenzar tu compra.</p>
        </div>`;
      foot.hidden = true;
      return;
    }

    body.innerHTML = items.map((item, idx) => {
      const img = item.image || item.images?.find(i => i.isPrimary)?.url || item.images?.[0]?.url;
      return `
        <div class="cart-item">
          <div class="cart-item__media">
            ${img ? `<img src="${esc(img)}" alt="${esc(item.name)}" loading="lazy">`
                  : `<span aria-hidden="true">📦</span>`}
          </div>
          <div>
            <div class="cart-item__name">${esc(item.name)}</div>
            <div class="cart-item__price">${money(item.price)}</div>
            <div class="qty" style="margin-top:var(--sp-2)">
              <button class="qty__btn" data-qty="-1" data-idx="${idx}"
                aria-label="Quitar una unidad de ${esc(item.name)}">−</button>
              <span class="qty__val">${item.quantity}</span>
              <button class="qty__btn" data-qty="1" data-idx="${idx}"
                aria-label="Agregar una unidad de ${esc(item.name)}">+</button>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:700;font-size:.9rem">${money(item.price * item.quantity)}</div>
            <button class="btn btn--ghost btn--sm" data-remove="${idx}"
              aria-label="Eliminar ${esc(item.name)} del carrito" style="margin-top:var(--sp-2)">🗑️</button>
          </div>
        </div>`;
    }).join("");

    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const shipping = shippingFor(subtotal);
    const total = subtotal + shipping;
    const unitCount = items.reduce((s, i) => s + i.quantity, 0);

    $("#cart-subtotal").textContent = money(subtotal);
    $("#cart-shipping").textContent = shipping === 0 ? "Gratis 🎉" : money(shipping);
    $("#cart-total").textContent = money(total);

    // Cuotas sin interés sobre el total (patrón retail)
    const instEl = $("#cart-installment");
    if (instEl) {
      const n = installmentsFor(total);
      instEl.innerHTML = n > 0
        ? `o hasta <strong>${n} cuotas sin interés</strong> de ${money(Math.round(total / n))}`
        : "";
      instEl.hidden = n === 0;
    }

    /* ─── Claridad de compra: contador, barra de envío y modo ─── */
    const infoEl = $("#cart-info");
    if (infoEl) {
      const freeThreshold = Number(state.config?.commerce?.freeShippingThreshold || 0);
      const missing = freeThreshold - subtotal;
      const gateway = !!state.config?.modules?.payment?.gatewayEnabled;

      let shippingBar = "";
      if (freeThreshold > 0 && missing > 0) {
        const pct = Math.min(100, Math.round((subtotal / freeThreshold) * 100));
        shippingBar = `
          <div class="ship-bar">
            <p class="ship-bar__msg">Te faltan <strong>${money(missing)}</strong> para el <strong>envío gratis</strong></p>
            <div class="ship-bar__track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
              <div class="ship-bar__fill" style="width:${pct}%"></div>
            </div>
          </div>`;
      } else if (freeThreshold > 0) {
        shippingBar = `<div class="ship-bar ship-bar--done"><p class="ship-bar__msg">🎉 ¡Tienes <strong>envío gratis</strong>!</p></div>`;
      }

      infoEl.innerHTML = `
        <p class="cart-info__count">${unitCount} ${unitCount === 1 ? "producto" : "productos"} en tu carrito</p>
        ${shippingBar}
        <p class="cart-info__mode ${gateway ? "is-pay" : "is-order"}">
          ${gateway
            ? "💳 <strong>Carro de compra:</strong> pagas en línea al finalizar."
            : "📋 <strong>Orden de compra:</strong> envías tu pedido y te contactamos para coordinar el pago. No se hace ningún cargo automático."}
        </p>`;
    }

    foot.hidden = false;
  }

  async function refreshCart() {
    try {
      const res = await API.getCart();
      state.cart = res.cart || { items: [], subtotal: 0 };
      renderCart();
    } catch (err) {
      console.error("Error cargando carrito:", err);
    }
  }

  async function addToCart(productId, quantity = 1) {
    try {
      const res = await API.addToCart(productId, quantity);
      if (res?.cart) { state.cart = res.cart; renderCart(); }
      else await refreshCart();
      toast("Producto agregado al carrito ✓", "success");
      openCart();
    } catch (err) {
      if (err.code === "OUT_OF_STOCK") toast("Ese producto está agotado", "warning");
      else if (err.code === "PRODUCT_NOT_FOUND") toast("El producto ya no está disponible", "warning");
      else toast(err.message || "No se pudo agregar el producto", "error");
    }
  }

  async function changeQty(idx, delta) {
    const item = state.cart.items[idx];
    if (!item) return;
    const qty = item.quantity + delta;
    try {
      if (qty <= 0) {
        const res = await API.removeCartItem(idx);
        if (res?.cart) state.cart = res.cart;
      } else {
        const res = await API.updateCartItem(idx, qty);
        if (res?.cart) state.cart = res.cart;
      }
      renderCart();
    } catch (err) {
      toast(err.message || "No se pudo actualizar el carrito", "error");
      await refreshCart();
    }
  }

  async function removeItem(idx) {
    try {
      const res = await API.removeCartItem(idx);
      if (res?.cart) state.cart = res.cart;
      renderCart();
      toast("Producto eliminado", "info");
    } catch (err) {
      toast(err.message || "No se pudo eliminar", "error");
    }
  }

  /* ─── Drawer del carrito ─────────────────────────────── */
  const drawer = $("#cart-drawer");
  const backdrop = $("#cart-backdrop");

  function openCart() {
    drawer.classList.add("is-open");
    backdrop.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    $("#cart-close").focus();
  }
  function closeCart() {
    drawer.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  /* ─── Modal ──────────────────────────────────────────── */
  const modalBackdrop = $("#modal-backdrop");
  let lastFocused = null;

  function openModal(title, bodyHTML, footHTML = "") {
    lastFocused = document.activeElement;
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = bodyHTML;
    $("#modal-foot").innerHTML = footHTML;
    modalBackdrop.classList.add("is-open");
    document.body.style.overflow = "hidden";
    $("#modal-close").focus();
  }
  function closeModal() {
    modalBackdrop.classList.remove("is-open");
    document.body.style.overflow = "";
    if (lastFocused) lastFocused.focus();
  }

  /* ─── Detalle de producto ────────────────────────────── */
  async function showProduct(id) {
    openModal("Cargando…", `<div class="state"><div class="spinner" style="margin:0 auto"></div></div>`);
    try {
      const res = await API.product(id);
      const p = res.product || res;
      const img = p.images?.find(i => i.isPrimary)?.url || p.images?.[0]?.url;
      const soldOut = p.stockStatus === "out_of_stock";

      // Modelo de precios retail
      const cashPrice = p.cashPrice != null ? p.cashPrice : p.price;
      const hasCashAdvantage = cashPrice < p.price;
      const installments = p.installments || installmentsFor(cashPrice);
      const installmentValue = installments > 0 ? Math.round(cashPrice / installments) : 0;

      const rows = [
        ["SKU", p.sku],
        ["Categoría", p.category?.name],
        ["Disponibilidad", soldOut ? "Agotado"
          : p.stockStatus === "low_stock" ? `Últimas ${p.stockQuantity} unidades`
          : `${p.stockQuantity} en stock`],
        ["Garantía", "12 meses oficial"],
        ["Despacho", p.requiresShipping ? "A todo el país" : "Producto digital"],
      ].filter(([, v]) => v);

      // Stock por tienda (retiro inmediato)
      let storesHtml = "";
      if (p.storeStock && Object.keys(p.storeStock).length && state.config?.modules?.store?.enabled !== false) {
        const entries = Object.entries(p.storeStock);
        storesHtml = `
          <div class="pd__stores">
            <div class="pd__price-key" style="font-weight:700;color:var(--text-primary)">
              🏬 Disponible para retiro inmediato
            </div>
            <div class="pd__store-list">
              ${entries.map(([sid, qty]) => {
                // El id de tienda en storeStock coincide con stores.code
                const store = STORES.find(s => s.code === sid)
                  || { name: sid.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) };
                return `<div class="pd__store">
                  <span>${esc(store.name)}</span>
                  <span class="pd__store-qty ${qty <= 2 ? "pd__store-qty--low" : ""}">${qty} un.</span>
                </div>`;
              }).join("")}
            </div>
          </div>`;
      }

      openModal(
        p.name,
        `<div class="pd">
          <div class="pd__media">
            ${img ? `<img src="${esc(img)}" alt="${esc(p.name)}">` : `<span aria-hidden="true">📦</span>`}
          </div>
          <div>
            ${p.category ? `<span class="product-card__cat">${esc(p.category.name)}</span>` : ""}
            <h3 style="font-size:1.3rem;font-weight:700;line-height:1.25;margin-top:var(--sp-2)">${esc(p.name)}</h3>
            <div class="product-card__rating" style="margin-top:var(--sp-2)">
              <span class="stars">${stars(p.ratingAvg)}</span>
              <span>${Number(p.ratingAvg || 0).toFixed(1)} · ${p.ratingCount || 0} valoraciones</span>
            </div>

            <div class="pd__prices">
              <div class="pd__price-row">
                <span class="pd__price-key">💵 Transferencia o débito</span>
                <span class="pd__price-val pd__price-val--cash">${money(cashPrice)}</span>
              </div>
              ${hasCashAdvantage ? `
              <div class="pd__price-row">
                <span class="pd__price-key">💳 Tarjeta de crédito</span>
                <span class="pd__price-val pd__price-val--credit">${money(p.price)}</span>
              </div>` : ""}
              ${p.compareAtPrice > p.price ? `
              <div class="pd__price-row">
                <span class="pd__price-key">Precio normal</span>
                <span class="price--was">${money(p.compareAtPrice)}</span>
              </div>` : ""}
              ${installments > 0 ? `
              <div class="pd__installments">
                o hasta <strong>${installments} cuotas sin interés</strong> de ${money(installmentValue)}
              </div>` : ""}
            </div>

            <p class="pd__desc">${esc(p.description || "Sin descripción disponible.")}</p>

            ${storesHtml}

            <div class="pd__meta" style="margin-top:var(--sp-4)">
              ${rows.map(([k, v]) =>
                `<div class="pd__meta-row"><span class="pd__meta-key">${esc(k)}</span><span>${esc(v)}</span></div>`
              ).join("")}
            </div>
          </div>
        </div>`,
        `<button class="btn btn--secondary" data-close-modal>Volver</button>
         <button class="btn btn--primary" data-add-detail="${p.id}" ${soldOut ? "disabled" : ""}>
           ${soldOut ? "Sin stock" : "🛒 Agregar al carrito"}
         </button>`
      );
    } catch (err) {
      openModal("Error", `<div class="state"><p class="state__title">No se pudo cargar el producto</p><p>${esc(err.message)}</p></div>`,
        `<button class="btn btn--secondary" data-close-modal>Cerrar</button>`);
    }
  }

  /* ─── Checkout (adaptativo: orden de compra o carro con pago) ─── */
  /**
   * Modo del carrito:
   *   'purchase_order' → no hay pasarela integrada. El cliente envía su
   *                      pedido y el operador lo confirma y cobra aparte.
   *   'cart'           → hay pasarela activa. El cliente paga online.
   * El modo lo decide el backend (modules.payment.cartMode).
   */
  const isGatewayEnabled = () => !!state.config?.modules?.payment?.gatewayEnabled;

  function showCheckout() {
    const items = state.cart.items || [];
    if (!items.length) { toast("Tu carrito está vacío", "warning"); return; }

    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const shipping = shippingFor(subtotal);
    const total = subtotal + shipping;

    const gateway = isGatewayEnabled();
    const pickupEnabled = !!state.config?.modules?.store?.pickupEnabled;
    const storeName = state.config?.modules?.store?.name || "la tienda";

    // Modo entrega: despacho a domicilio o retiro en tienda
    const deliveryBlock = pickupEnabled ? `
      <fieldset class="form-fieldset">
        <legend class="form-legend">¿Cómo quieres recibir tu pedido?</legend>
        <div class="radio-group">
          <label class="radio-card">
            <input type="radio" name="delivery" value="shipping" checked>
            <span class="radio-card__body">
              <span class="radio-card__title">🚚 Despacho a domicilio</span>
              <span class="radio-card__desc">${shipping === 0 ? "Envío gratis" : money(shipping) + " · 2 a 5 días hábiles"}</span>
            </span>
          </label>
          <label class="radio-card">
            <input type="radio" name="delivery" value="pickup">
            <span class="radio-card__body">
              <span class="radio-card__title">🏬 Retiro en tienda</span>
              <span class="radio-card__desc">Sin costo · ${esc(storeName)}</span>
            </span>
          </label>
        </div>
      </fieldset>` : "";

    // Aviso honesto según el modo de compra
    const modeNotice = gateway
      ? `<p class="notice notice--info">
           <span aria-hidden="true">🔒</span>
           <span>Serás redirigido a la <strong>pasarela de pago segura</strong> para completar la compra.
           Tus datos de tarjeta <strong>nunca</strong> pasan por nuestros servidores.</span>
         </p>`
      : `<p class="notice notice--warn">
           <span aria-hidden="true">📋</span>
           <span>Esto es una <strong>orden de compra</strong>: registramos tu pedido y un ejecutivo
           te contactará al email y teléfono que indiques para coordinar el pago y la entrega.
           <strong>No se realizará ningún cargo automático.</strong></span>
         </p>`;

    openModal(
      "Finalizar compra",
      `<div class="steps">
        <span class="step is-active"><span class="step__num">1</span> Tus datos</span>
        <span class="step__sep">›</span>
        <span class="step"><span class="step__num">2</span> Entrega</span>
        <span class="step__sep">›</span>
        <span class="step"><span class="step__num">3</span> ${gateway ? "Pago" : "Confirmación"}</span>
      </div>

      <form class="form" id="checkout-form" novalidate>
        <div class="form-row">
          <div class="form-field">
            <label class="form-label" for="co-name">Nombre completo <span class="req" aria-hidden="true">*</span></label>
            <input class="input" id="co-name" name="name" required autocomplete="name"
                   aria-describedby="err-co-name">
            <span class="form-error" id="err-co-name" data-error-for="co-name" role="alert"></span>
          </div>
          <div class="form-field">
            <label class="form-label" for="co-email">Email <span class="req" aria-hidden="true">*</span></label>
            <input class="input" id="co-email" name="email" type="email" required autocomplete="email"
                   inputmode="email" aria-describedby="err-co-email">
            <span class="form-error" id="err-co-email" data-error-for="co-email" role="alert"></span>
            <span class="form-hint">Aquí te enviaremos la confirmación del pedido.</span>
          </div>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label class="form-label" for="co-phone">Teléfono <span class="req" aria-hidden="true">*</span></label>
            <input class="input" id="co-phone" name="phone" required autocomplete="tel"
                   inputmode="tel" placeholder="+56 9 1234 5678" aria-describedby="err-co-phone">
            <span class="form-error" id="err-co-phone" data-error-for="co-phone" role="alert"></span>
          </div>
          <div class="form-field">
            <label class="form-label" for="co-rut">RUT <span class="opt">(opcional)</span></label>
            <input class="input" id="co-rut" name="rut" autocomplete="off"
                   placeholder="12.345.678-9" aria-describedby="err-co-rut">
            <span class="form-error" id="err-co-rut" data-error-for="co-rut" role="alert"></span>
            <span class="form-hint">Para la boleta electrónica.</span>
          </div>
        </div>

        ${deliveryBlock}

        <div class="form-field" id="address-field">
          <label class="form-label" for="co-address">Dirección de envío <span class="req" aria-hidden="true">*</span></label>
          <input class="input" id="co-address" name="address" required autocomplete="street-address"
                 placeholder="Calle, número, depto." aria-describedby="err-co-address">
          <span class="form-error" id="err-co-address" data-error-for="co-address" role="alert"></span>
        </div>

        <div class="form-field">
          <label class="form-label" for="co-notes">Comentarios <span class="opt">(opcional)</span></label>
          <textarea class="input" id="co-notes" name="notes" rows="2"
                    placeholder="Referencias de entrega, horario preferido, etc."></textarea>
        </div>

        <div class="summary">
          <div class="cart-line"><span>Subtotal (${items.reduce((s,i)=>s+i.quantity,0)} productos)</span><span>${money(subtotal)}</span></div>
          <div class="cart-line"><span>Envío</span><span id="co-shipping">${shipping === 0 ? "Gratis 🎉" : money(shipping)}</span></div>
          <div class="cart-line cart-line--total"><span>Total a pagar</span><span id="co-total">${money(total)}</span></div>
          <p class="summary__note">IVA incluido. Precio válido para transferencia o débito.</p>
        </div>

        ${modeNotice}
      </form>`,
      `<button class="btn btn--secondary" data-close-modal>Volver al carrito</button>
       <button class="btn btn--primary btn--lg" id="btn-pay" type="submit" form="checkout-form">
         ${gateway ? `🔒 Pagar ${money(total)}` : `📋 Enviar orden de compra`}
       </button>`
    );

    // Mostrar/ocultar dirección según el modo de entrega elegido
    const addrField = $("#address-field");
    const syncDelivery = () => {
      const mode = form_value("delivery") || "shipping";
      const isPickup = mode === "pickup";
      if (addrField) addrField.hidden = isPickup;
      const addrInput = $("#co-address");
      if (addrInput) {
        addrInput.required = !isPickup;
        if (isPickup) {
          addrInput.removeAttribute("aria-invalid");
          addrInput.closest(".form-field")?.classList.remove("is-invalid");
        }
      }
      const shipEl = $("#co-shipping");
      const totEl = $("#co-total");
      const ship = isPickup ? 0 : shippingFor(subtotal);
      if (shipEl) shipEl.textContent = isPickup ? "Retiro en tienda (sin costo)" : (ship === 0 ? "Gratis 🎉" : money(ship));
      if (totEl) totEl.textContent = money(subtotal + ship);
      const payBtn = $("#btn-pay");
      if (payBtn) {
        const t = subtotal + ship;
        payBtn.textContent = gateway ? `🔒 Pagar ${money(t)}` : `📋 Enviar orden de compra`;
      }
    };
    $$('input[name="delivery"]').forEach(r => r.addEventListener("change", syncDelivery));
    syncDelivery();
  }

  // Helper: lee el valor de un campo del formulario de checkout por nombre
  function form_value(name) {
    const el = document.querySelector(`#checkout-form [name="${name}"]:checked`)
            || document.querySelector(`#checkout-form [name="${name}"]`);
    return el ? el.value : null;
  }

  async function submitCheckout(e) {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form));

    const mode = data.delivery || "shipping";
    const isPickup = mode === "pickup";

    // Validación en cliente con mensajes accesibles
    let valid = true;
    const rules = {
      name: v => v.trim().length >= 3 || "Ingresa tu nombre completo",
      email: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || "Ingresa un email válido",
      phone: v => v.replace(/\D/g, "").length >= 8 || "Ingresa un teléfono válido (mínimo 8 dígitos)",
    };
    if (!isPickup) {
      rules.address = v => v.trim().length >= 6 || "Ingresa una dirección válida";
    }

    $$(".form-field", form).forEach(f => f.classList.remove("is-invalid"));
    for (const [field, rule] of Object.entries(rules)) {
      const input = form.elements[field];
      if (!input) continue;
      const result = rule(input.value || "");
      const errEl = $(`[data-error-for="${input.id}"]`);
      if (result !== true) {
        valid = false;
        input.closest(".form-field").classList.add("is-invalid");
        if (errEl) errEl.textContent = result;
        input.setAttribute("aria-invalid", "true");
      } else {
        input.removeAttribute("aria-invalid");
        if (errEl) errEl.textContent = "";
      }
    }
    if (!valid) {
      $(".form-field.is-invalid .input", form)?.focus();
      toast("Revisa los campos marcados en rojo", "warning");
      return;
    }

    const btn = $("#btn-pay");
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Procesando…';

    const gateway = isGatewayEnabled();
    const storeName = state.config?.modules?.store?.name || "la tienda";

    try {
      const order = await API.createOrder({
        customerName: data.name,
        customerEmail: data.email,
        customerPhone: data.phone,
        customerRut: data.rut || null,
        shippingAddress: isPickup ? null : data.address,
        deliveryMethod: mode,
        pickupStore: isPickup ? storeName : null,
        notes: data.notes || null,
        items: state.cart.items.map(i => ({
          productId: i.productId, quantity: i.quantity, price: i.price, name: i.name,
        })),
        sessionId: API.sessionId(),
      });

      const orderNumber = order?.order?.orderNumber || order?.order?.id || "—";

      // ─── Con pasarela: redirigir al pago ───
      if (gateway) {
        try {
          const pay = await API.createPaymentSession({
            items: state.cart.items.map(i => ({
              name: i.name, price: i.price, quantity: i.quantity,
            })),
            customerEmail: data.email,
            metadata: { orderId: String(order?.order?.id || "") },
          });
          if (pay?.url) { window.location.href = pay.url; return; }
        } catch (payErr) {
          console.warn("Pasarela no disponible:", payErr.message);
          toast("La pasarela no respondió. Tu orden quedó registrada igualmente.", "warning", 7000);
        }
      }

      // ─── Sin pasarela: orden de compra confirmada ───
      closeModal();
      await API.clearCart();
      await refreshCart();

      if (gateway) {
        toast("¡Pedido registrado! Te contactaremos para coordinar el pago.", "success", 7000);
      } else {
        toast("¡Orden de compra enviada! Te contactaremos a la brevedad.", "success", 7000);
      }

      openModal(
        gateway ? "Pedido confirmado" : "Orden de compra enviada",
        `<div class="state">
          <div class="state__icon" aria-hidden="true">✅</div>
          <p class="state__title">${gateway ? "¡Gracias por tu compra!" : "¡Recibimos tu pedido!"}</p>
          <p>Número de orden: <strong>#${esc(orderNumber)}</strong></p>

          <div class="receipt">
            <div class="receipt__row"><span>Productos</span><span>${state.cart.items?.length || 0}</span></div>
            <div class="receipt__row"><span>Entrega</span><span>${isPickup ? `Retiro en ${esc(storeName)}` : "Despacho a domicilio"}</span></div>
            <div class="receipt__row"><span>Contacto</span><span>${esc(data.email)}</span></div>
          </div>

          <p class="notice notice--info" style="text-align:left;margin-top:var(--sp-4)">
            <span aria-hidden="true">${gateway ? "🔒" : "📞"}</span>
            <span>${gateway
              ? "Recibirás un email con la confirmación del pago y el seguimiento del envío."
              : `Un ejecutivo te contactará a <strong>${esc(data.email)}</strong> o al <strong>${esc(data.phone)}</strong> para coordinar el pago y la entrega. No se realizó ningún cargo.`}</span>
          </p>
        </div>`,
        `<button class="btn btn--primary" data-close-modal>Entendido</button>`
      );
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = originalLabel;
      toast(err.message || "No se pudo procesar el pedido", "error");
    }
  }

  /* ─── Chat de ventas ─────────────────────────────────── */
  const chatPanel = $("#chat-panel");
  const chatBody = $("#chat-body");
  let chatOpen = false;

  function addChatMsg(text, who = "bot") {
    const el = document.createElement("div");
    el.className = `chat-msg chat-msg--${who}`;
    el.textContent = text;
    chatBody.appendChild(el);
    chatBody.scrollTop = chatBody.scrollHeight;
    return el;
  }

  async function openChat() {
    chatPanel.classList.add("is-open");
    chatPanel.setAttribute("aria-hidden", "false");
    chatOpen = true;

    if (!chatBody.children.length) {
      addChatMsg("¡Hola! 👋 Soy tu asesor de TecnoGamer. ¿En qué puedo ayudarte hoy?", "bot");
      addChatMsg("Puedo ayudarte con: precios, stock, envíos, comparar productos o recomendarte un setup según tu presupuesto.", "bot");
      try {
        const cfg = await API.chatConfig();
        if (cfg?.greetMessage && !chatBody.children.length) {
          chatBody.innerHTML = "";
          addChatMsg(cfg.greetMessage, "bot");
        }
      } catch (_) { /* el saludo local basta */ }
    }
    $("#chat-input").focus();
  }

  function closeChat() {
    chatPanel.classList.remove("is-open");
    chatPanel.setAttribute("aria-hidden", "true");
    chatOpen = false;
  }

  let chatSessionId = null;

  async function ensureChatSession() {
    if (chatSessionId) return chatSessionId;
    try {
      const res = await API.chatSession();
      chatSessionId = res?.session?.id || res?.session?.sessionId || res?.id || res?.sessionId;
    } catch (_) { /* se maneja al enviar */ }
    return chatSessionId;
  }

  async function sendChat(e) {
    e.preventDefault();
    const input = $("#chat-input");
    const text = input.value.trim();
    if (!text) return;

    addChatMsg(text, "me");
    input.value = "";
    const typing = addChatMsg("Escribiendo…", "bot");
    typing.style.opacity = ".6";

    try {
      const sid = await ensureChatSession();
      if (!sid) throw new Error("Sin sesión de chat");
      const res = await API.sendChat(sid, text);
      typing.remove();
      const reply = res?.reply || res?.message?.content || res?.message || res?.response;
      if (reply && typeof reply === "string") addChatMsg(reply, "bot");
      else addChatMsg("Gracias por tu mensaje. Un asesor te responderá en breve por aquí.", "bot");
    } catch (err) {
      typing.remove();
      addChatMsg(
        "No pude enviar tu mensaje en este momento. Escríbenos a ventas@tecnogamer.local y te respondemos enseguida.",
        "bot"
      );
    }
  }

  /* ─── Eventos ────────────────────────────────────────── */
  function bindEvents() {
    // Grid: delegación
    $("#product-grid").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.action === "add") addToCart(Number(id), 1);
      if (btn.dataset.action === "detail") showProduct(id);
    });

    // Carrito
    $("#btn-cart").addEventListener("click", openCart);
    $("#cart-close").addEventListener("click", closeCart);
    backdrop.addEventListener("click", closeCart);

    $("#cart-body").addEventListener("click", (e) => {
      const qtyBtn = e.target.closest("[data-qty]");
      if (qtyBtn) return changeQty(Number(qtyBtn.dataset.idx), Number(qtyBtn.dataset.qty));
      const rmBtn = e.target.closest("[data-remove]");
      if (rmBtn) return removeItem(Number(rmBtn.dataset.remove));
    });

    $("#btn-checkout").addEventListener("click", () => { closeCart(); showCheckout(); });

    // Modal
    $("#modal-close").addEventListener("click", closeModal);
    modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });

    $("#modal-body").addEventListener("click", (e) => {
      const add = e.target.closest("[data-add-detail]");
      if (add) { closeModal(); addToCart(Number(add.dataset.addDetail), 1); }
    });
    $("#modal-foot").addEventListener("click", (e) => {
      if (e.target.closest("[data-close-modal]")) closeModal();
    });

    // Formulario de checkout
    document.addEventListener("submit", (e) => {
      if (e.target.id === "checkout-form") submitCheckout(e);
    });

    // Escape cierra todo
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (modalBackdrop.classList.contains("is-open")) closeModal();
      else if (drawer.classList.contains("is-open")) closeCart();
      else if (chatOpen) closeChat();
    });

    // Filtros
    $("#filter-sort").addEventListener("change", (e) => { state.sort = e.target.value; loadProducts(); });
    $("#filter-stock").addEventListener("change", (e) => { state.inStock = e.target.value; loadProducts(); });
    $("#filter-min").addEventListener("change", (e) => { state.minPrice = e.target.value; loadProducts(); });
    $("#filter-max").addEventListener("change", (e) => { state.maxPrice = e.target.value; loadProducts(); });

    $("#btn-clear-filters").addEventListener("click", () => {
      state.sort = "newest"; state.minPrice = ""; state.maxPrice = ""; state.inStock = "";
      $("#filter-sort").value = "newest"; $("#filter-min").value = "";
      $("#filter-max").value = ""; $("#filter-stock").value = "";
      loadProducts();
      toast("Filtros restablecidos", "info");
    });

    $("#btn-load-more").addEventListener("click", () => {
      state.page += 1;
      loadProducts({ append: true });
    });

    // Búsqueda con debounce
    $("#search-input").addEventListener("input", debounce((e) => {
      state.search = e.target.value.trim();
      loadProducts();
    }, 400));

    // Categorías
    $("#nav-categories").addEventListener("click", (e) => {
      const link = e.target.closest("a[data-cat]");
      if (!link) return;
      e.preventDefault();
      $$(".navbar__link").forEach(a => a.classList.remove("is-active"));
      link.classList.add("is-active");
      state.category = link.dataset.cat;
      loadProducts();
      document.getElementById("catalogo").scrollIntoView({ behavior: "smooth" });
    });

    // Chat
    $("#chat-fab").addEventListener("click", () => chatOpen ? closeChat() : openChat());
    $("#chat-close").addEventListener("click", closeChat);
    $("#chat-form").addEventListener("submit", sendChat);
    $("#btn-chat-hero")?.addEventListener("click", openChat);
    $("#link-chat")?.addEventListener("click", (e) => { e.preventDefault(); openChat(); });

    // Cuenta
    $("#btn-account").addEventListener("click", showAccount);

    // Barra de navegación: se oscurece al hacer scroll (patrón del sitio real)
    const navbar = $(".navbar");
    if (navbar) {
      const onScroll = () => {
        navbar.classList.toggle("is-scrolled", window.scrollY > 40);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    // Menú móvil de categorías
    const menuDrawer = $("#menu-drawer");
    const menuBackdrop = $("#menu-backdrop");
    const openMenu = () => {
      loadMobileMenu().then(() => {
        menuDrawer.classList.add("is-open");
        menuBackdrop.classList.add("is-open");
        menuDrawer.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
      });
    };
    const closeMenu = () => {
      menuDrawer.classList.remove("is-open");
      menuBackdrop.classList.remove("is-open");
      menuDrawer.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    };
    $("#btn-burger")?.addEventListener("click", openMenu);
    $("#menu-close")?.addEventListener("click", closeMenu);
    menuBackdrop?.addEventListener("click", closeMenu);

    $("#menu-body")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (!btn) return;
      state.category = btn.dataset.cat;
      $$(".navbar__link").forEach(a =>
        a.classList.toggle("is-active", a.dataset.cat === state.category));
      closeMenu();
      loadProducts();
      document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth" });
    });
  }

  /* ─── Cuenta ─────────────────────────────────────────── */
  function showAccount() {
    if (API.isLoggedIn()) {
      openModal("Mi cuenta",
        `<div class="state"><div class="state__icon">👤</div><p class="state__title">Sesión activa</p>
         <p>Gestiona tus pedidos y datos desde aquí.</p></div>`,
        `<button class="btn btn--secondary" data-close-modal>Cerrar</button>
         <button class="btn btn--danger" id="btn-logout">Cerrar sesión</button>`);
      setTimeout(() => {
        $("#btn-logout")?.addEventListener("click", () => {
          API.logout(); closeModal(); toast("Sesión cerrada", "info");
        });
      }, 0);
      return;
    }

    openModal("Iniciar sesión",
      `<form class="form" id="login-form" novalidate>
        <div class="form-field">
          <label class="form-label" for="lg-email">Email</label>
          <input class="input" id="lg-email" type="email" required autocomplete="email">
        </div>
        <div class="form-field">
          <label class="form-label" for="lg-pass">Contraseña</label>
          <input class="input" id="lg-pass" type="password" required autocomplete="current-password">
        </div>
        <p class="form-hint">Demo: admin@tecnogamer.local / Admin123!</p>
      </form>`,
      `<button class="btn btn--secondary" data-close-modal>Cancelar</button>
       <button class="btn btn--primary" id="btn-login">Entrar</button>`);

    setTimeout(() => {
      $("#btn-login")?.addEventListener("click", async () => {
        const email = $("#lg-email").value.trim();
        const password = $("#lg-pass").value;
        if (!email || !password) { toast("Completa email y contraseña", "warning"); return; }
        const btn = $("#btn-login");
        btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
        try {
          const res = await API.login(email, password);
          API.setToken(res.token || res.accessToken);
          closeModal();
          toast(`Bienvenido, ${res.user?.name || "usuario"}`, "success");
        } catch (err) {
          btn.disabled = false; btn.textContent = "Entrar";
          toast(err.message || "Credenciales incorrectas", "error");
        }
      });
    }, 0);
  }

  /* ─── Inicio ─────────────────────────────────────────── */
  async function init() {
    $("#year").textContent = new Date().getFullYear();
    bindEvents();
    startTopbarRotation();

    // La configuración del sitio se carga PRIMERO: define si el módulo de
    // tienda está activo, el modo del carrito y los costos de envío reales.
    await loadSiteConfig();

    loadStores();

    // Todas las secciones se cargan en paralelo: si una falla, el resto sigue
    await Promise.allSettled([
      loadCategories(),
      loadCategoryGrid(),
      loadFeatured(),
      loadGamerZone(),
      loadStats(),
      loadProducts(),
    ]);

    await refreshCart();

    // Re-verificar stock periódicamente (inventario en tiempo real)
    setInterval(refreshCart, 120000);

    console.log("%c🎮 TecnoGamer", "color:#10b981;font-weight:bold;font-size:14px",
      "— storefront listo",
      state.config ? `(modo carrito: ${state.config.modules?.payment?.cartMode || "?"})` : "");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
