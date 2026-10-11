#!/usr/bin/env node
"use strict";
// Diagnóstico: captura el error REAL del endpoint de IA
const orig = console.error;
console.error = (...a) => orig("[CAPTURED]", ...a.map(x => (x && x.stack) || x));
require("../backend/server.js");
setTimeout(async () => {
  const login = await fetch("http://localhost:3000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Load-Test": "1" },
    body: JSON.stringify({ email: "admin@tecnogamer.local", password: "Admin123!" }),
  });
  const { accessToken } = await login.json();

  const r = await fetch("http://localhost:3000/api/v1/ai/generate-description", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ productId: 1 }),
  });
  console.log("STATUS:", r.status);
  console.log("BODY:", (await r.text()).slice(0, 400));
  process.exit(0);
}, 3500);
