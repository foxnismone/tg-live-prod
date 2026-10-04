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
  };

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

  /* ─── Tiendas (retiro en tienda) ─────────────────────── */
  // Direcciones reales de pc Factory (referencia del retail chileno)
  const STORES = [
    { name: "Santiago Centro",  addr: "Av. Libertador B. O'Higgins 1234, Santiago", hours: "Lun–Sáb 10:00–20:00", phone: "+56 2 2560 0040" },
    { name: "Providencia",      addr: "Av. Providencia 2124, Providencia",         hours: "Lun–Sáb 10:00–20:30", phone: "+56 2 2560 0040" },
    { name: "Maipú",            addr: "Av. Pajaritos 3050, Maipú",               hours: "Lun–Dom 10:00–21:00", phone: "+56 2 2560 0040" },
    { name: "Valparaíso",       addr: "Calle Prat 850, Valparaíso",               hours: "Lun–Sáb 10:00–19:30", phone: "+56 2 2560 0040" },
    { name: "Concepción",       addr: "Av. O'Higgins 456, Concepción",            hours: "Lun–Sáb 10:00–20:00", phone: "+56 2 2560 0040" },
    { name: "Temuco",           addr: "Av. Alemania 0875, Temuco",                hours: "Lun–Sáb 10:00–19:30", phone: "+56 2 2560 0040" },
    { name: "Antofagasta",      addr: "Av. Balmaceda 2355, Antofagasta",          hours: "Lun–Sáb 10:00–20:00", phone: "+56 2 2560 0040" },
    { name: "La Serena",        addr: "Av. Francisco de Aguirre 220, La Serena",  hours: "Lun–Sáb 10:00–19:30", phone: "+56 2 2560 0040" },
  ];

  function loadStores() {
    const grid = $("#stores-grid");
    if (!grid) return;
    grid.innerHTML = STORES.map(s => `
      <div class="store-card">
        <span class="store-card__icon" aria-hidden="true">🏬</span>
        <div>
          <div class="store-card__name">${esc(s.name)}</div>
          <div class="store-card__meta">${esc(s.addr)}</div>
          <div class="store-card__meta">${esc(s.hours)}</div>
          <div class="store-card__meta">📞 ${esc(s.phone)}</div>
        </div>
      </div>`).join("");
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
    const shipping = subtotal >= 75000 ? 0 : 5990;
    const total = subtotal + shipping;

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
      if (p.storeStock && Object.keys(p.storeStock).length) {
        const entries = Object.entries(p.storeStock);
        storesHtml = `
          <div class="pd__stores">
            <div class="pd__price-key" style="font-weight:700;color:var(--text-primary)">
              🏬 Disponible para retiro inmediato
            </div>
            <div class="pd__store-list">
              ${entries.map(([sid, qty]) => {
                const store = STORES.find(s => s.name.toLowerCase().replace(/\s+/g, "-").includes(sid.split("-")[0]))
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

  /* ─── Checkout ───────────────────────────────────────── */
  function showCheckout() {
    const items = state.cart.items || [];
    if (!items.length) { toast("Tu carrito está vacío", "warning"); return; }

    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const shipping = subtotal >= 75000 ? 0 : 5990;
    const total = subtotal + shipping;

    openModal(
      "Finalizar compra",
      `<div class="steps">
        <span class="step is-active"><span class="step__num">1</span> Datos</span>
        <span class="step__sep">›</span>
        <span class="step"><span class="step__num">2</span> Envío</span>
        <span class="step__sep">›</span>
        <span class="step"><span class="step__num">3</span> Pago</span>
      </div>

      <form class="form" id="checkout-form" novalidate>
        <div class="form-row">
          <div class="form-field">
            <label class="form-label" for="co-name">Nombre completo <span class="req">*</span></label>
            <input class="input" id="co-name" name="name" required autocomplete="name">
            <span class="form-error" data-error-for="co-name"></span>
          </div>
          <div class="form-field">
            <label class="form-label" for="co-email">Email <span class="req">*</span></label>
            <input class="input" id="co-email" name="email" type="email" required autocomplete="email">
            <span class="form-error" data-error-for="co-email"></span>
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label class="form-label" for="co-phone">Teléfono <span class="req">*</span></label>
            <input class="input" id="co-phone" name="phone" required autocomplete="tel" inputmode="tel">
            <span class="form-error" data-error-for="co-phone"></span>
          </div>
          <div class="form-field">
            <label class="form-label" for="co-address">Dirección de envío <span class="req">*</span></label>
            <input class="input" id="co-address" name="address" required autocomplete="street-address">
            <span class="form-error" data-error-for="co-address"></span>
          </div>
        </div>

        <div style="background:var(--bg-elevated);border-radius:var(--r-md);padding:var(--sp-4);margin-top:var(--sp-2)">
          <div class="cart-line"><span>Subtotal</span><span>${money(subtotal)}</span></div>
          <div class="cart-line"><span>Envío</span><span>${shipping === 0 ? "Gratis 🎉" : money(shipping)}</span></div>
          <div class="cart-line cart-line--total"><span>Total</span><span>${money(total)}</span></div>
        </div>

        <p style="font-size:.78rem;color:var(--text-muted);display:flex;gap:var(--sp-2);align-items:flex-start">
          <span aria-hidden="true">🔒</span>
          <span>Serás redirigido a la pasarela de pago segura. Tus datos de tarjeta nunca pasan por nuestros servidores.</span>
        </p>
      </form>`,
      `<button class="btn btn--secondary" data-close-modal>Cancelar</button>
       <button class="btn btn--primary btn--lg" id="btn-pay" type="submit" form="checkout-form">
         🔒 Ir a pagar ${money(total)}
       </button>`
    );
  }

  async function submitCheckout(e) {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form));

    // Validación en cliente con mensajes accesibles
    let valid = true;
    const rules = {
      name: v => v.trim().length >= 3 || "Ingresa tu nombre completo",
      email: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || "Email inválido",
      phone: v => v.replace(/\D/g, "").length >= 8 || "Teléfono inválido",
      address: v => v.trim().length >= 6 || "Ingresa una dirección válida",
    };
    $$(".form-field", form).forEach(f => f.classList.remove("is-invalid"));
    for (const [field, rule] of Object.entries(rules)) {
      const input = form.elements[field];
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
      toast("Revisa los campos marcados", "warning");
      return;
    }

    const btn = $("#btn-pay");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Procesando…';

    try {
      const order = await API.createOrder({
        customerName: data.name,
        customerEmail: data.email,
        customerPhone: data.phone,
        shippingAddress: data.address,
        items: state.cart.items.map(i => ({
          productId: i.productId, quantity: i.quantity, price: i.price, name: i.name,
        })),
        sessionId: API.sessionId(),
      });

      // Intentar sesión de pago real (si la pasarela está configurada)
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
      }

      closeModal();
      await API.clearCart();
      await refreshCart();
      toast("¡Pedido registrado! Te contactaremos para coordinar el pago.", "success", 7000);
      openModal(
        "Pedido confirmado",
        `<div class="state">
          <div class="state__icon" aria-hidden="true">✅</div>
          <p class="state__title">¡Gracias por tu compra!</p>
          <p>Pedido <strong>#${esc(order?.order?.orderNumber || order?.order?.id || "—")}</strong></p>
          <p style="margin-top:var(--sp-3)">Recibirás un email con los detalles y el seguimiento del envío.</p>
        </div>`,
        `<button class="btn btn--primary" data-close-modal>Entendido</button>`
      );
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = "🔒 Reintentar pago";
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
      "— storefront listo");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
