"use strict";
const express = require("express");
const crypto  = require("crypto");
const { body, validationResult } = require("express-validator");
const db      = require("../config/db");
const auth    = require("../middleware/authMiddleware");
const roleM   = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");
const { subCacheBust } = require("../middleware/subscriptionMiddleware");

const router = express.Router();
const PLAN_ROLES     = ["SUPER_ADMIN"];
const CHECKOUT_ROLES = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL"];

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

/**
 * Kenya CBC billing periods:
 *  month → exactly 1 calendar month (e.g. Jan 15 → Feb 15)
 *  term  → exactly 3 calendar months (Kenya has 3 terms per year, ~3 months each)
 *  year  → exactly 12 calendar months (1 full academic year)
 */
function subscriptionEndDate(interval) {
  const end = new Date();
  if (interval === "month")     end.setMonth(end.getMonth() + 1);
  else if (interval === "term") end.setMonth(end.getMonth() + 3);
  else                          end.setFullYear(end.getFullYear() + 1);
  return end;
}

async function paystackFetch(path, options = {}) {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  const url = `https://api.paystack.co${path}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...(options.headers || {}),
      },
    });
  } catch (networkErr) {
    throw new Error(`Paystack network error: ${networkErr.message}`);
  }
  const raw = await res.text().catch(() => "");
  let data = {};
  try { data = JSON.parse(raw); } catch { data = {}; }
  console.log(`[Paystack] ${path} → HTTP ${res.status}`, raw.slice(0, 400));
  if (!res.ok || data.status === false) {
    throw new Error(data.message || `Paystack HTTP ${res.status}`);
  }
  return data;
}

/**
 * Activate subscription after confirmed payment.
 * Busts subscription cache so middleware reflects new status immediately.
 */
async function activateSubscription(paymentId) {
  const { rows: payments } = await db.query(
    `SELECT sp.*, pp.billing_interval
     FROM subscription_payments sp
     JOIN payment_plans pp ON pp.id = sp.plan_id
     WHERE sp.id = $1`,
    [paymentId]
  );
  if (!payments.length) return null;
  const payment = payments[0];
  const end = subscriptionEndDate(payment.billing_interval);

  const { rows } = await db.query(
    `INSERT INTO school_subscriptions
       (school_id, plan_id, status, current_period_start, current_period_end, last_payment_id)
     VALUES ($1, $2, 'active', NOW(), $3, $4)
     ON CONFLICT (school_id) DO UPDATE SET
       plan_id              = EXCLUDED.plan_id,
       status               = 'active',
       current_period_start = NOW(),
       current_period_end   = EXCLUDED.current_period_end,
       last_payment_id      = EXCLUDED.last_payment_id,
       updated_at           = NOW()
     RETURNING *`,
    [payment.school_id, payment.plan_id, end, payment.id]
  );

  // Bust cache so next request reflects new subscription immediately
  subCacheBust(payment.school_id);
  return rows[0];
}

// ════════════════════════════════════════════════════════════════
// PLAN MANAGEMENT (SUPER_ADMIN only)
// ════════════════════════════════════════════════════════════════

router.get("/plans", auth, async (req, res) => {
  try {
    const where = req.user.role === "SUPER_ADMIN" ? "" : "WHERE is_active = TRUE";
    const { rows } = await db.query(`SELECT * FROM payment_plans ${where} ORDER BY billing_interval, amount`);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[plans GET]", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/plans", auth, roleM(PLAN_ROLES),
  [
    body("name").trim().notEmpty().isLength({ max: 100 }),
    body("amount").isFloat({ min: 1 }),
    body("currency").optional().isLength({ min: 3, max: 3 }),
    body("billing_interval").isIn(["month", "term", "year"])
      .withMessage("billing_interval must be month, term, or year"),
    body("student_limit").optional({ nullable: true }).isInt({ min: 1 }),
    body("ai_enabled").optional().isBoolean(),
    body("is_active").optional().isBoolean(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const { name, amount, currency, billing_interval, student_limit, ai_enabled, is_active } = req.body;
      const { rows } = await db.query(
        `INSERT INTO payment_plans
           (name, amount, currency, billing_interval, student_limit, ai_enabled, is_active)
         VALUES ($1, $2, UPPER($3), $4, $5, $6, $7)
         RETURNING *`,
        [name, amount, currency || "KES", billing_interval, student_limit || null, ai_enabled !== false, is_active !== false]
      );
      await audit(req, "CREATE_PAYMENT_PLAN", "payment_plans", rows[0].id, null, rows[0]);
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ success: false, message: "A plan with that name already exists." });
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

router.put("/plans/:id", auth, roleM(PLAN_ROLES),
  [
    body("billing_interval").optional().isIn(["month", "term", "year"])
      .withMessage("billing_interval must be month, term, or year"),
    body("amount").optional().isFloat({ min: 1 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const { rows } = await db.query(
        `UPDATE payment_plans SET
           name             = COALESCE($1, name),
           amount           = COALESCE($2, amount),
           currency         = COALESCE(UPPER($3), currency),
           billing_interval = COALESCE($4, billing_interval),
           student_limit    = COALESCE($5, student_limit),
           ai_enabled       = COALESCE($6, ai_enabled),
           is_active        = COALESCE($7, is_active),
           updated_at       = NOW()
         WHERE id = $8
         RETURNING *`,
        [
          req.body.name || null,
          req.body.amount ?? null,
          req.body.currency || null,
          req.body.billing_interval || null,
          req.body.student_limit ?? null,
          req.body.ai_enabled ?? null,
          req.body.is_active ?? null,
          req.params.id,
        ]
      );
      if (!rows.length) return res.status(404).json({ success: false, message: "Plan not found." });
      await audit(req, "UPDATE_PAYMENT_PLAN", "payment_plans", rows[0].id, null, rows[0]);
      return res.json({ success: true, data: rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// SUBSCRIPTION STATUS
// ════════════════════════════════════════════════════════════════

router.get("/me", auth, async (req, res) => {
  try {
    const schoolId = req.user.role === "SUPER_ADMIN"
      ? (req.query.school_id || req.user.school_id)
      : req.user.school_id;

    if (!schoolId) return res.json({ success: true, data: null });

    const { rows } = await db.query(
      `SELECT ss.*, pp.name AS plan_name, pp.amount, pp.currency,
              pp.billing_interval, pp.ai_enabled, pp.student_limit,
              -- real-time expiry flag
              (ss.current_period_end IS NOT NULL AND ss.current_period_end < NOW()) AS is_expired
       FROM school_subscriptions ss
       JOIN payment_plans pp ON pp.id = ss.plan_id
       WHERE ss.school_id = $1
       ORDER BY ss.created_at DESC
       LIMIT 1`,
      [schoolId]
    );
    return res.json({ success: true, data: rows[0] || null });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ════════════════════════════════════════════════════════════════
// PAYMENT HISTORY — school staff track their own billing/payments
// ════════════════════════════════════════════════════════════════

router.get("/payments", auth, async (req, res) => {
  try {
    const schoolId = req.user.role === "SUPER_ADMIN"
      ? (req.query.school_id || req.user.school_id)
      : req.user.school_id;

    if (!schoolId) return res.json({ success: true, data: [] });

    const { rows } = await db.query(
      `SELECT sp.id, sp.merchant_reference, sp.amount, sp.currency, sp.status,
              sp.created_at, sp.updated_at,
              pp.name AS plan_name, pp.billing_interval
       FROM subscription_payments sp
       JOIN payment_plans pp ON pp.id = sp.plan_id
       WHERE sp.school_id = $1
       ORDER BY sp.created_at DESC
       LIMIT 50`,
      [schoolId]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[payments GET]", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ════════════════════════════════════════════════════════════════
// MANUAL ACTIVATE (SUPER_ADMIN — for offline payments / adjustments)
// ════════════════════════════════════════════════════════════════

router.post("/payments/:id/activate", auth, roleM(PLAN_ROLES), async (req, res) => {
  try {
    const { rows: payments } = await db.query(
      "SELECT * FROM subscription_payments WHERE id = $1", [req.params.id]
    );
    if (!payments.length) return res.status(404).json({ success: false, message: "Payment not found." });
    if (payments[0].status === "completed")
      return res.status(409).json({ success: false, message: "Payment already activated." });

    await db.query(
      "UPDATE subscription_payments SET status='completed', updated_at=NOW() WHERE id=$1",
      [payments[0].id]
    );
    const subscription = await activateSubscription(payments[0].id);
    await audit(req, "ACTIVATE_SUBSCRIPTION", "school_subscriptions", subscription.id, null, subscription);
    return res.json({ success: true, data: subscription });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ════════════════════════════════════════════════════════════════
// PAYSTACK CHECKOUT
// ════════════════════════════════════════════════════════════════

router.post("/paystack/checkout", auth, roleM(CHECKOUT_ROLES),
  [
    body("plan_id").isInt({ min: 1 }),
    body("school_id").optional().isUUID(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });

    try {
      // Non-SUPER_ADMIN can only pay for their own school
      const schoolId = req.user.role === "SUPER_ADMIN"
        ? req.body.school_id
        : req.user.school_id;
      if (!schoolId) return res.status(400).json({ success: false, message: "school_id required." });

      // Allow up to 3 checkout attempts in a 15-minute window before
      // blocking — only then enforce the 15-minute cooldown.
      const { rows: pending } = await db.query(
        `SELECT id FROM subscription_payments
         WHERE school_id = $1 AND status = 'pending'
           AND created_at > NOW() - INTERVAL '15 minutes'
         ORDER BY created_at ASC`,
        [schoolId]
      );
      if (pending.length >= 3) {
        return res.status(429).json({
          success: false,
          message: "Too many checkout attempts. Please wait 15 minutes before trying again.",
        });
      }

      const [{ rows: schools }, { rows: plans }] = await Promise.all([
        db.query("SELECT * FROM schools WHERE id = $1", [schoolId]),
        db.query("SELECT * FROM payment_plans WHERE id = $1 AND is_active = TRUE", [req.body.plan_id]),
      ]);
      if (!schools.length) return res.status(404).json({ success: false, message: "School not found." });
      if (!plans.length)   return res.status(404).json({ success: false, message: "Plan not found or no longer available." });

      const school = schools[0];
      const plan   = plans[0];

      const reference  = `PS-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const callbackUrl = (process.env.PAYSTACK_CALLBACK_URL || `${req.protocol}://${req.get("host")}/subscription.html`)
        .replace(/^https?:\/\/https?:\/\//, "https://")
        .replace(/([^:])\/\/+/g, "$1/")
        .replace(/\/$/, "");

      // Paystack expects amount in the smallest currency unit (kobo for NGN, but KES is whole units on Paystack)
      // Paystack Kenya accepts KES in whole units (not kobo) — amount * 100 still required per Paystack docs
      const amountKobo = Math.round(Number(plan.amount) * 100);
      const email      = school.email || req.user.email || "school@cbcerp.co.ke";

      const data = await paystackFetch("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email,
          amount: amountKobo,
          currency: plan.currency || "KES",
          reference,
          callback_url: callbackUrl,
          metadata: {
            school_id:   schoolId,
            plan_id:     plan.id,
            school_name: school.name,
            plan_name:   plan.name,
            interval:    plan.billing_interval,
            created_by:  req.user.id,
          },
        }),
      });

      const redirectUrl = data.data?.authorization_url;
      const accessCode  = data.data?.access_code;

      const { rows } = await db.query(
        `INSERT INTO subscription_payments
           (school_id, plan_id, merchant_reference, order_tracking_id, amount, currency, status, checkout_url, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
         RETURNING *`,
        [schoolId, plan.id, reference, accessCode || null, plan.amount, plan.currency, redirectUrl, req.user.id]
      );
      await audit(req, "CREATE_PAYSTACK_CHECKOUT", "subscription_payments", rows[0].id, null, rows[0]);
      return res.status(201).json({ success: true, data: rows[0], redirect_url: redirectUrl });

    } catch (err) {
      console.error("[Paystack] Checkout error:", err.message, err.stack);
      return res.status(500).json({ success: false, message: err.message || "Unable to start checkout." });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// PAYSTACK VERIFY (frontend callback handler)
// ════════════════════════════════════════════════════════════════

router.get("/paystack/verify/:reference", auth, async (req, res) => {
  try {
    const { reference } = req.params;
    if (!reference || !/^[A-Z0-9\-]{10,80}$/i.test(reference))
      return res.status(400).json({ success: false, message: "Invalid reference format." });

    const { rows: existing } = await db.query(
      "SELECT id, school_id, status FROM subscription_payments WHERE merchant_reference = $1",
      [reference]
    );
    if (!existing.length)
      return res.status(404).json({ success: false, message: "Payment record not found." });

    // Prevent cross-school activation
    if (req.user.role !== "SUPER_ADMIN" && existing[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });

    // If already completed, don't re-verify — just return success
    if (existing[0].status === "completed") {
      return res.json({ success: true, paid: true, status: "success", already_activated: true, reference });
    }

    const data = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`);
    const txn  = data.data;
    const paid = txn?.status === "success";

    const { rows } = await db.query(
      `UPDATE subscription_payments SET
         status          = $1,
         provider_payload = $2,
         updated_at      = NOW()
       WHERE merchant_reference = $3
       RETURNING id`,
      [paid ? "completed" : (txn?.status || "failed"), JSON.stringify(txn), reference]
    );

    if (paid && rows[0]?.id) await activateSubscription(rows[0].id);

    return res.json({
      success: true,
      paid,
      status:    txn?.status,
      amount:    txn?.amount ? txn.amount / 100 : null,
      currency:  txn?.currency,
      reference,
    });
  } catch (err) {
    console.error("[Paystack] Verify error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// PAYSTACK WEBHOOK (server-to-server — Paystack calls this directly)
// ════════════════════════════════════════════════════════════════

router.post("/paystack/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(500).end();

    // Always verify signature — reject anything that doesn't match
    const hash = crypto.createHmac("sha512", secret).update(req.body).digest("hex");
    if (hash !== req.headers["x-paystack-signature"]) {
      console.warn("[Paystack] Webhook signature mismatch — rejected");
      return res.status(400).end();
    }

    const event = JSON.parse(req.body.toString());
    console.log("[Paystack] Webhook event:", event.event, "ref:", event.data?.reference);

    if (event.event === "charge.success") {
      const reference = event.data?.reference;
      if (!reference) return res.status(200).end();

      const { rows } = await db.query(
        `UPDATE subscription_payments SET
           status           = 'completed',
           provider_payload = $1,
           updated_at       = NOW()
         WHERE merchant_reference = $2 AND status = 'pending'
         RETURNING id`,
        [JSON.stringify(event.data), reference]
      );
      if (rows[0]?.id) await activateSubscription(rows[0].id);
    }

    return res.status(200).end();
  } catch (err) {
    console.error("[Paystack] Webhook error:", err.message);
    return res.status(500).end();
  }
});

// ════════════════════════════════════════════════════════════════
// EXPIRED SUBSCRIPTION SWEEP (SUPER_ADMIN only)
// Marks all overdue subscriptions as past_due in one query.
// Call this from a cron or manually from the admin panel.
// ════════════════════════════════════════════════════════════════

router.post("/sweep-expired", auth, roleM(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const GRACE_DAYS = 7;
    const { rows } = await db.query(
      `UPDATE school_subscriptions
       SET status = 'past_due', updated_at = NOW()
       WHERE status IN ('active', 'trialing')
         AND current_period_end < NOW() - ($1 || ' days')::INTERVAL
       RETURNING school_id, current_period_end`,
      [GRACE_DAYS]
    );
    // Bust cache for all affected schools
    rows.forEach(r => subCacheBust(r.school_id));
    await audit(req, "SWEEP_EXPIRED_SUBSCRIPTIONS", "school_subscriptions", null, null, { expired_count: rows.length });
    return res.json({ success: true, expired_count: rows.length, schools: rows });
  } catch (err) {
    console.error("[sweep-expired]", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ════════════════════════════════════════════════════════════════
// DEBUG (SUPER_ADMIN only, disabled in production)
// ════════════════════════════════════════════════════════════════

router.get("/debug-paystack", auth, roleM(["SUPER_ADMIN"]), async (req, res) => {
  if (process.env.NODE_ENV === "production")
    return res.status(403).json({ success: false, message: "Debug endpoints disabled in production." });
  const key  = process.env.PAYSTACK_SECRET_KEY || "";
  const mode = !key ? "missing" : key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : "unknown";
  const info = {
    PAYSTACK_SECRET_KEY:  key ? key.slice(0, 12) + "..." : "(NOT SET)",
    key_mode:             mode,
    PAYSTACK_CALLBACK_URL: process.env.PAYSTACK_CALLBACK_URL || "(not set)",
    NODE_ENV:             process.env.NODE_ENV,
    billing_periods:      { month: "+1 month", term: "+3 months", year: "+12 months" },
    grace_period_days:    7,
  };
  if (!key) return res.status(500).json({ success: false, config: info, error: "PAYSTACK_SECRET_KEY not set" });
  try {
    const data = await paystackFetch("/bank?country=kenya&perPage=1");
    return res.json({ success: true, config: info, connectivity: "OK", sample: data?.data?.[0] || null });
  } catch (err) {
    return res.status(500).json({ success: false, config: info, connectivity: "FAILED", error: err.message });
  }
});

module.exports = router;
