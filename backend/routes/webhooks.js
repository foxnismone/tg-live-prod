"use strict";
const express = require("express");
const router = express.Router();

// webhook placeholders
router.post("/stripe", (req, res) => res.json({ received: true }));
router.post("/whatsapp", (req, res) => res.json({ received: true }));

module.exports = router;
