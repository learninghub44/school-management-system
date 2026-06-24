"use strict";
const db = require("../config/db");

const openStatuses = ["active", "trialing"];

module.exports = async function requireSubscription(req, res, next) {
  if (!req.user || req.user.role === "SUPER_ADMIN") return next();
  if (!req.user.school_id) {
    return res.status(402).json({
      success: false,
      code: "SUBSCRIPTION_REQUIRED",
      message: "A school subscription is required.",
    });
  }

  try {
    const { rows } = await db.query(
      `SELECT ss.status, ss.current_period_end, pp.ai_enabled, pp.ai_daily_limit
       FROM school_subscriptions ss
       JOIN payment_plans pp ON pp.id = ss.plan_id
       WHERE ss.school_id = $1
       ORDER BY ss.created_at DESC
       LIMIT 1`,
      [req.user.school_id]
    );
    const sub = rows[0];
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
};
