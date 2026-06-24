/**
 * Subscription middleware
 * Caches subscription status for 60 seconds per school to avoid a DB
 * query on every single authenticated API call. Cache is busted when
 * a subscription is updated (via the subscriptions route).
 */
"use strict";
const db = require("../config/db");

const openStatuses = ["active", "trialing"];

// ── 60-second subscription cache per school ───────────────────────
const SUB_CACHE_TTL = 60 * 1000;
const SUB_CACHE_MAX = 500;
const subCache = new Map();

function subCacheGet(schoolId) {
  const entry = subCache.get(schoolId);
  if (!entry) return undefined;
  if (Date.now() > entry.exp) { subCache.delete(schoolId); return undefined; }
  return entry.data;
}
function subCacheSet(schoolId, data) {
  if (subCache.size >= SUB_CACHE_MAX) subCache.delete(subCache.keys().next().value);
  subCache.set(schoolId, { data, exp: Date.now() + SUB_CACHE_TTL });
}
function subCacheBust(schoolId) { if (schoolId) subCache.delete(schoolId); }

// ── Middleware ────────────────────────────────────────────────────
async function requireSubscription(req, res, next) {
  if (!req.user || req.user.role === "SUPER_ADMIN") return next();
  if (!req.user.school_id) {
    return res.status(402).json({
      success: false,
      code: "SUBSCRIPTION_REQUIRED",
      message: "A school subscription is required.",
    });
  }

  try {
    let sub = subCacheGet(req.user.school_id);
    if (sub === undefined) {
      const { rows } = await db.query(
        `SELECT ss.status, ss.current_period_end, pp.ai_enabled, pp.ai_daily_limit
         FROM school_subscriptions ss
         JOIN payment_plans pp ON pp.id = ss.plan_id
         WHERE ss.school_id = $1
         ORDER BY ss.created_at DESC
         LIMIT 1`,
        [req.user.school_id]
      );
      sub = rows[0] || null;
      subCacheSet(req.user.school_id, sub);
    }

    const stillOpen = sub?.current_period_end
      ? new Date(sub.current_period_end) >= new Date()
      : true;

    if (!sub || !openStatuses.includes(sub.status) || !stillOpen) {
      return res.status(402).json({
        success: false,
        code: "SUBSCRIPTION_REQUIRED",
        message: "Your school subscription is inactive. Please renew to continue.",
      });
    }

    req.subscription = sub;
    next();
  } catch (err) {
    console.error("subscriptionMiddleware:", err.message);
    return res.status(500).json({ success: false, message: "Subscription check failed." });
  }
}

module.exports = requireSubscription;
module.exports.subCacheBust = subCacheBust;
