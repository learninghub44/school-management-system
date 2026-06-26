/**
 * subscriptionMiddleware — enforces active subscription on all protected routes.
 *
 * Rules:
 * - SUPER_ADMIN: always passes (manages the platform)
 * - School staff: must have an active subscription with current_period_end in the future
 * - Grace period: 3 days after expiry before locking out (avoids midnight surprise)
 * - Cache: 60s per school to avoid hammering DB on every request
 */
"use strict";
const db = require("../config/db");

const CACHE_TTL  = 60 * 1000;   // 60 seconds
const GRACE_DAYS = 3;            // days after expiry before lockout
const subCache   = new Map();    // schoolId → { status, expires_at, exp }

function cacheGet(schoolId) {
  const entry = subCache.get(schoolId);
  if (!entry) return null;
  if (Date.now() > entry.exp) { subCache.delete(schoolId); return null; }
  return entry;
}

function cacheSet(schoolId, data) {
  if (subCache.size >= 5000) subCache.delete(subCache.keys().next().value);
  subCache.set(schoolId, { ...data, exp: Date.now() + CACHE_TTL });
}

function subCacheBust(schoolId) {
  if (schoolId) subCache.delete(schoolId);
  else subCache.clear();
}

async function requireSubscription(req, res, next) {
  try {
    // SUPER_ADMIN is exempt
    if (req.user?.role === "SUPER_ADMIN") return next();

    const schoolId = req.user?.school_id;
    if (!schoolId)
      return res.status(403).json({ success: false, code: "NO_SCHOOL", message: "No school associated with this account." });

    // Check cache first
    let sub = cacheGet(schoolId);

    if (!sub) {
      const { rows } = await db.query(
        `SELECT status, current_period_end
         FROM school_subscriptions
         WHERE school_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [schoolId]
      );
      sub = rows[0] || { status: "inactive", current_period_end: null };
      cacheSet(schoolId, sub);
    }

    // Allow active and trialing statuses
    if (sub.status === "active" || sub.status === "trialing") {
      // Check expiry with grace period
      if (sub.current_period_end) {
        const graceEnd = new Date(sub.current_period_end);
        graceEnd.setDate(graceEnd.getDate() + GRACE_DAYS);
        if (new Date() > graceEnd) {
          // Mark past_due in DB (async, don't block request — will reflect next cache miss)
          db.query(
            "UPDATE school_subscriptions SET status='past_due', updated_at=NOW() WHERE school_id=$1 AND status IN ('active','trialing')",
            [schoolId]
          ).catch(e => console.error("[sub] past_due update failed:", e.message));
          subCacheBust(schoolId);
          return res.status(402).json({
            success: false,
            code: "SUBSCRIPTION_EXPIRED",
            message: "Your subscription has expired. Please renew to continue.",
          });
        }
      }
      return next();
    }

    // past_due: show expiry info
    if (sub.status === "past_due") {
      return res.status(402).json({
        success: false,
        code: "SUBSCRIPTION_PAST_DUE",
        message: "Your subscription has expired. Please renew your plan to restore access.",
        expired_at: sub.current_period_end,
      });
    }

    // cancelled / inactive / anything else
    return res.status(402).json({
      success: false,
      code: "SUBSCRIPTION_REQUIRED",
      message: "An active subscription is required to access this feature. Please subscribe to a plan.",
    });

  } catch (err) {
    console.error("[subscriptionMiddleware]", err.message);
    return res.status(500).json({ success: false, message: "Subscription check failed." });
  }
}

module.exports = requireSubscription;
module.exports.subCacheBust = subCacheBust;
