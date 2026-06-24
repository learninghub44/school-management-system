"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const requireSubscription = require("../middleware/subscriptionMiddleware");
const auth = require("../middleware/authMiddleware");
const db = require("../config/db");
const { audit } = require("../middleware/auditLog");
const { aiBurstLimit, aiDailyQuota, logAiUsage } = require("../middleware/aiRateLimit");

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

// requireSubscription already attaches req.subscription with ai_enabled —
// this just adds the explicit plan check on top of "subscription is active".
function requireAiEnabled(req, res, next) {
  if (req.user.role === "SUPER_ADMIN") return next();
  if (!req.subscription?.ai_enabled) {
    return res.status(403).json({ success: false, code: "AI_NOT_ON_PLAN", message: "AI features are not enabled on this school's plan." });
  }
  next();
}

// ── POST /ai/assist — general-purpose assistant ─────────────────────
router.post("/assist", auth, requireSubscription, requireAiEnabled, aiBurstLimit, aiDailyQuota,
  [
    body("prompt").trim().notEmpty().isLength({ max: 4000 }),
    body("context").optional().trim().isLength({ max: 2000 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const input = [
        "You are an assistant for a Kenyan CBC school management system.",
        "Help staff with concise, practical school administration guidance.",
        req.body.context ? `Context:\n${req.body.context}` : "",
        `Request:\n${req.body.prompt}`,
      ].filter(Boolean).join("\n\n");
      const output = await createGroqResponse(input);
      await logAiUsage(req, "assist", req.body.prompt.length);
      await audit(req, "AI_ASSIST", "ai", null, null, { prompt_chars: req.body.prompt.length });
      return res.json({ success: true, output, quota: req.aiQuota || null });
    } catch (err) {
      console.error("AI assist:", err.message);
      return res.status(500).json({ success: false, message: "AI request failed." });
    }
  }
);

// ── POST /ai/report-comment — CBC report card comment generator ────
// Takes a student's assessment context (achievement levels per subject,
// attendance, any existing teacher notes) and drafts a professional,
// constructive comment a teacher or principal can edit before publishing.
router.post("/report-comment", auth, requireSubscription, requireAiEnabled, aiBurstLimit, aiDailyQuota,
  [
    body("student_name").trim().notEmpty().isLength({ max: 150 }),
    body("role").isIn(["class_teacher", "principal"]),
    body("achievements").optional().isArray({ max: 30 }),
    body("attendance_summary").optional().trim().isLength({ max: 300 }),
    body("notes").optional().trim().isLength({ max: 1000 }),
    body("tone").optional().isIn(["encouraging", "neutral", "formal"]),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const { student_name, role, achievements, attendance_summary, notes, tone } = req.body;
      const achievementLines = (achievements || [])
        .filter(a => a && a.subject && a.level)
        .map(a => `- ${a.subject}: ${a.level}`)
        .join("\n");

      const roleLabel = role === "principal" ? "school principal" : "class teacher";
      const toneLabel = tone || "encouraging";

      const input = [
        `You are helping a ${roleLabel} at a Kenyan CBC school write a report card comment.`,
        `Write ONE short paragraph (2-4 sentences) in a ${toneLabel}, professional tone.`,
        "Do not invent facts not given below. If achievement data is sparse, keep the comment general but genuine.",
        "Do not include a greeting, sign-off, or the student's name repeated more than once.",
        `Student: ${student_name}`,
        achievementLines ? `Subject achievement levels (EE=Exceeding, ME=Meeting, AE=Approaching, BE=Below):\n${achievementLines}` : "",
        attendance_summary ? `Attendance: ${attendance_summary}` : "",
        notes ? `Teacher's own notes to incorporate:\n${notes}` : "",
      ].filter(Boolean).join("\n\n");

      const output = await createGroqResponse(input);
      await logAiUsage(req, "report_comment", input.length);
      await audit(req, "AI_REPORT_COMMENT", "ai", null, null, { student_name, role });
      return res.json({ success: true, output, quota: req.aiQuota || null });
    } catch (err) {
      console.error("AI report-comment:", err.message);
      return res.status(500).json({ success: false, message: "AI request failed." });
    }
  }
);

module.exports = router;
