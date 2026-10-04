/* ============================================================
   SERVICE WORKER — TecnoGamer
   ============================================================
   Estrategia:
     · Shell (HTML/CSS/JS/iconos) → cache-first con revalidación
     · API GET                    → network-first con respaldo en caché
     · Imágenes                   → cache-first
     · Peticiones no-GET          → nunca se cachean (carrito, pedidos, pagos)
   ============================================================ */
"use strict";

const VERSION = "tg-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const API_CACHE = `${VERSION}-api`;
const IMG_CACHE = `${VERSION}-img`;

const SHELL = [
  "/",
  "/index.html",
  "/assets/css/main.css",
  "/assets/js/api.js",
  "/assets/js/store.js",
  "/manifest.webmanifest",
  "/assets/icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Solo mismo origen
  if (url.origin !== self.location.origin) return;

  // Nunca cachear mutaciones (carrito, pedidos, pagos, auth)
  if (request.method !== "GET") return;

  // Nunca cachear el panel de operador ni rutas sensibles
  if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/v1/admin")) return;

  // Imágenes y subidas → cache-first
  if (url.pathname.startsWith("/uploads/") || /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(url.pathname)) {
    e.respondWith(
      caches.match(request).then((hit) =>
        hit || fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(IMG_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }).catch(() => hit)
      )
    );
    return;
  }

  // API pública → network-first, respaldo en caché
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(API_CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Shell → cache-first con revalidación en segundo plano
  e.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
