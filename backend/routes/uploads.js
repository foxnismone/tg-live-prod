"use strict";
const express = require("express");
const router = express.Router();

// placeholder — las rutas reales se agregan cuando hay uploads habilitados
router.get("/", (req, res) => res.json({ ok: true, msg: "upload routes placeholder" }));

module.exports = router;
