"use strict";
const express = require("express");
const router = express.Router();

// chat web placeholder
router.get("/", (req, res) => res.json({ ok: true, msg: "chat-web placeholder" }));

module.exports = router;
