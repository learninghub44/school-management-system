"use strict";
/**
 * AI rate limiting — two layers:
 *
 * 1. Burst limit: a tight per-user, per-minute cap via express-rate-limit
 *    (in-memory). Stops accidental spam-clicking / runaway loops. Resets
 *    automatically; no DB cost.
 *
 * 2. Daily quota: a per-school cap read from payment_plans.ai_daily_limit,
 *    enforced against ai_usage_log. This is the real cost control — Groq
 *    usage is billed per request, and one runaway script or shared login
 *    shouldn't be able to blow through a school's plan in an afternoon.
 *
 * Usage: router.post("/assist", auth, requireSubscription, aiBurstLimit, aiDailyQuota, handler)
 * aiDailyQuota also calls next() and stashes req.aiQuota for the handler to
 * log usage with `await logAiUsage(req, "assist")` after a successful call.
 */
const rateLimit = require("express-rate-limit");
const db = require("../config/db");

// ── Layer 1: burst limit ────────────────────────────────────────────
// 8 requests per minute per user. Generous enough for normal back-and-forth,
// tight enough to stop a stuck retry loop or accidental multi-click.
const aiBurstLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      code: "AI_RATE_LIMITED",
      message: "You're sending requests too quickly. Please wait a moment and try again.",
    });
  },
});

// ── Layer 2: daily per-school quota ─────────────────────────────────
async function aiDailyQuota(req, res, next) {
  try {
    // SUPER_ADMIN has no school_id and isn't subject to a school's plan quota.
    if (req.user.role === "SUPER_ADMIN") return next();

    const limit = req.subscription?.ai_daily_limit;
    // NULL/undefined limit means unlimited for this plan.
    if (limit === null || limit === undefined) return next();

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM ai_usage_log
       WHERE school_id = $1 AND created_at >= CURRENT_DATE`,
      [req.user.school_id]
    );
    const usedToday = rows[0]?.count || 0;
    if (usedToday >= limit) {
      return res.status(429).json({
        success: false,
        code: "AI_DAILY_LIMIT_REACHED",
        message: `Your school has reached its daily AI request limit (${limit}). This resets at midnight.`,
        used: usedToday,
        limit,
      });
    }
    req.aiQuota = { used: usedToday, limit, remaining: limit - usedToday - 1 };
    next();
  } catch (err) {
    console.error("aiDailyQuota:", err.message);
    // Fail open on a transient DB error rather than blocking AI entirely —
    // the burst limiter above still bounds worst-case abuse.
    next();
  }
}

// ── Helper: log a successful AI request ─────────────────────────────
async function logAiUsage(req, feature, promptChars) {
  try {
    await db.query(
      `INSERT INTO ai_usage_log (school_id, user_id, feature, prompt_chars) VALUES ($1,$2,$3,$4)`,
      [req.user.school_id || null, req.user.id, feature, promptChars || null]
    );
  } catch (err) {
    console.error("logAiUsage:", err.message);
    // Non-fatal — never fail the user's request just because logging failed.
  }
}

module.exports = { aiBurstLimit, aiDailyQuota, logAiUsage };
