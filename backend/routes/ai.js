"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const requireSubscription = require("../middleware/subscriptionMiddleware");
const auth = require("../middleware/authMiddleware");
const db = require("../config/db");
const { audit } = require("../middleware/auditLog");

const router = express.Router();

async function createGroqResponse(input) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured.");
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
  });
  const response = await client.responses.create({
    model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    input,
  });
  return response.output_text;
}

router.post("/assist", auth, requireSubscription,
  [
    body("prompt").trim().notEmpty().isLength({ max: 4000 }),
    body("context").optional().trim().isLength({ max: 2000 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      if (req.user.role !== "SUPER_ADMIN") {
        const { rows } = await db.query(
          `SELECT pp.ai_enabled
           FROM school_subscriptions ss
           JOIN payment_plans pp ON pp.id = ss.plan_id
           WHERE ss.school_id=$1 AND ss.status IN ('active','trialing')
           ORDER BY ss.created_at DESC LIMIT 1`,
          [req.user.school_id]
        );
        if (!rows[0]?.ai_enabled) {
          return res.status(403).json({ success: false, message: "AI is not enabled on this school's plan." });
        }
      }

      const input = [
        "You are an assistant for a Kenyan CBC school management system.",
        "Help staff with concise, practical school administration guidance.",
        req.body.context ? `Context:\n${req.body.context}` : "",
        `Request:\n${req.body.prompt}`,
      ].filter(Boolean).join("\n\n");
      const output = await createGroqResponse(input);
      await audit(req, "AI_ASSIST", "ai", null, null, { prompt_chars: req.body.prompt.length });
      return res.json({ success: true, output });
    } catch (err) {
      console.error("AI assist:", err.message);
      return res.status(500).json({ success: false, message: err.message || "AI request failed." });
    }
  }
);

module.exports = router;
