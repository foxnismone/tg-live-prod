#!/usr/bin/env node
"use strict";
// Diagnóstico: captura el error real del login interceptando console.error
const orig = console.error;
console.error = (...a) => orig("[CAPTURED]", ...a.map(x => (x && x.stack) || x));
require("../backend/server.js");
setTimeout(async () => {
  const r = await fetch("http://localhost:3000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Load-Test": "1" },
    body: JSON.stringify({ email: "admin@tecnogamer.local", password: "Admin123!" }),
  });
  console.log("STATUS:", r.status);
  console.log("BODY:", (await r.text()).slice(0, 500));
  process.exit(0);
}, 3500);
