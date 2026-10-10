/* ============================================================
   API — Cliente HTTP del storefront
   ============================================================
   - Maneja token JWT (localStorage + header Authorization)
   - Session ID para carrito de invitado
   - Reintentos y errores normalizados
   - NUNCA guarda datos de tarjeta (el pago va a la pasarela)
   ============================================================ */
"use strict";

const API = (() => {
  const BASE = "/api/v1";
  const SESSION_KEY = "tg_session";
  const TOKEN_KEY = "tg_token";

  /* ─── Sesión de invitado ─────────────────────────────── */
  function sessionId() {
    let sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = "session-" + Date.now() + "-" + Math.random().toString(36).slice(2, 11);
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  /* ─── Token ──────────────────────────────────────────── */
  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const setToken = (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
  const isLoggedIn = () => !!getToken();

  /* ─── Petición base ──────────────────────────────────── */
  async function request(path, { method = "GET", body, headers = {}, timeout = 15000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);

    const opts = {
      method,
      headers: { Accept: "application/json", ...headers },
      signal: ctrl.signal,
    };

    const token = getToken();
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }

    try {
      const res = await fetch(BASE + path, opts);
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }

      if (!res.ok) {
        const err = new Error(data?.error || `Error ${res.status}`);
        err.status = res.status;
        err.code = data?.code;
        err.details = data?.details;
        // Token inválido/expirado → limpiar sesión
        if (res.status === 401 && /TOKEN|AUTH/i.test(err.code || "")) setToken(null);
        throw err;
      }
      return data;
    } catch (e) {
      if (e.name === "AbortError") {
        const err = new Error("La conexión tardó demasiado. Revisa tu internet.");
        err.code = "TIMEOUT";
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ─── Endpoints ──────────────────────────────────────── */
  return {
    request,           // exponer el cliente base para rutas ad-hoc
    sessionId,
    getToken, setToken, isLoggedIn,

    // Configuración pública (módulos, tiendas, moneda)
    config: () => request("/config"),

    // Catálogo
    products: (params = {}) => {
      const q = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") q.set(k, v);
      });
      const qs = q.toString();
      return request("/products" + (qs ? `?${qs}` : ""));
    },
    product: (id) => request(`/products/${encodeURIComponent(id)}`),
    productBySlug: (slug) => request(`/products/slug/${encodeURIComponent(slug)}`),
    featured: (limit = 8) => request(`/products/featured?limit=${limit}`),
    newArrivals: (limit = 8) => request(`/products/new?limit=${limit}`),
    categories: () => request("/categories"),

    // Carrito
    getCart: () => request(`/cart?sessionId=${encodeURIComponent(sessionId())}`),
    addToCart: (productId, quantity = 1) =>
      request("/cart/items", { method: "POST", body: { productId, quantity, sessionId: sessionId() } }),
    updateCartItem: (index, quantity) =>
      request(`/cart/items/${index}`, { method: "PUT", body: { quantity, sessionId: sessionId() } }),
    removeCartItem: (index) =>
      request(`/cart/items/${index}`, { method: "DELETE", body: { sessionId: sessionId() } }),
    clearCart: () => request("/cart", { method: "DELETE", body: { sessionId: sessionId() } }),
    cartSummary: () => request(`/cart/summary?sessionId=${encodeURIComponent(sessionId())}`),

    // Auth
    login: (email, password) =>
      request("/auth/login", { method: "POST", body: { email, password } }),
    register: (payload) => request("/auth/register", { method: "POST", body: payload }),
    me: () => request("/auth/me"),
    logout: () => { setToken(null); },

    // Pedidos
    createOrder: (payload) => request("/orders", { method: "POST", body: payload }),
    myOrders: () => request("/orders"),

    // Checkout
    createPaymentSession: (payload) =>
      request("/checkout/create-session", { method: "POST", body: payload }),

    // Chat
    chatConfig: () => request("/chat/config"),
    // El backend usa sesiones de chat: se crea/usa una y se envían mensajes a ella
    chatSession: (sessionKey) =>
      request("/chat/sessions", { method: "POST", body: { sessionId: sessionKey || sessionId() } }),
    sendChat: (sessionId_, message) =>
      request(`/chat/sessions/${encodeURIComponent(sessionId_)}`, {
        method: "POST", body: { message, senderType: "customer" },
      }),
    chatHistory: (sessionId_) => request(`/chat/sessions/${encodeURIComponent(sessionId_)}`),

    // Sistema
    systemInfo: () => request("/system/info"),
  };
})();
