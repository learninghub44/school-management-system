/**
 * sweepExpiredSubscriptions — daily cron job
 * Marks subscriptions past_due after the 3-day grace period.
 * Runs automatically on server start and every 24 hours.
 */
"use strict";
const db = require("../config/db");
const { subCacheBust } = require("../middleware/subscriptionMiddleware");

const GRACE_DAYS = 7;

async function sweep() {
  try {
    const { rows } = await db.query(
      `UPDATE school_subscriptions
       SET status = 'past_due', updated_at = NOW()
       WHERE status IN ('active', 'trialing')
         AND current_period_end < NOW() - ($1 || ' days')::INTERVAL
       RETURNING school_id, current_period_end`,
      [GRACE_DAYS]
    );
    if (rows.length > 0) {
      rows.forEach(r => subCacheBust(r.school_id));
      console.log(`[sweep] Marked ${rows.length} subscription(s) as past_due`);
    }
  } catch (err) {
    console.error("[sweep] Failed to sweep expired subscriptions:", err.message);
  }
}

function startSweepJob() {
  // Run immediately on boot
  sweep();
  // Then every 24 hours
  setInterval(sweep, 24 * 60 * 60 * 1000);
  console.log("[sweep] Subscription expiry sweep job started (runs every 24h)");
}

module.exports = { startSweepJob, sweep };
