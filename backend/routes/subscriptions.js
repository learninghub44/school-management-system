"use strict";
const express = require("express");
const crypto = require("crypto");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const auth = require("../middleware/authMiddleware");
const roleM = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");

const router = express.Router();
const PLAN_ROLES = ["SUPER_ADMIN"];
const CHECKOUT_ROLES = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL"];

const pesapalBase = () =>
  (process.env.PESAPAL_BASE_URL || "https://cybqa.pesapal.com/pesapalv3/api").replace(/\/$/, "");

async function pesapalFetch(path, options = {}) {
  const url = `${pesapalBase()}${path}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
  } catch (networkErr) {
    console.error(`[Pesapal] Network error calling ${path}:`, networkErr.message);
    throw new Error(`Pesapal network error: ${networkErr.message}`);
  }

  const raw = await res.text().catch(() => "");
  let data = {};
  try { data = JSON.parse(raw); } catch { data = {}; }

  console.log(`[Pesapal] ${path} → HTTP ${res.status}`, raw.slice(0, 500));

  if (!res.ok) {
    const msg =
      data.error?.message ||
      data.message ||
      data.error ||
      data.error_description ||
      (typeof data === "string" ? data : null) ||
      `Pesapal HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function getPesapalToken() {
  if (!process.env.PESAPAL_CONSUMER_KEY || !process.env.PESAPAL_CONSUMER_SECRET) {
    throw new Error("Pesapal credentials are not configured (missing PESAPAL_CONSUMER_KEY or PESAPAL_CONSUMER_SECRET).");
  }
  console.log("[Pesapal] Requesting token with key:", process.env.PESAPAL_CONSUMER_KEY?.slice(0, 8) + "...");
  console.log("[Pesapal] Base URL:", pesapalBase());
  const data = await pesapalFetch("/Auth/RequestToken", {
    method: "POST",
    body: JSON.stringify({
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET,
    }),
  });
  if (!data.token) {
    console.error("[Pesapal] Token response had no token field:", JSON.stringify(data));
    throw new Error(`Pesapal did not return a token. Response: ${JSON.stringify(data)}`);
  }
  console.log("[Pesapal] Token obtained successfully");
  return data.token;
}

async function getNotificationId(token) {
  if (process.env.PESAPAL_IPN_ID) return process.env.PESAPAL_IPN_ID;
  if (!process.env.PESAPAL_IPN_URL) throw new Error("PESAPAL_IPN_URL or PESAPAL_IPN_ID is required.");
  const data = await pesapalFetch("/URLSetup/RegisterIPN", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      url: process.env.PESAPAL_IPN_URL,
      ipn_notification_type: "GET",
    }),
  });
  return data.ipn_id;
}

function subscriptionEndDate(interval) {
  const end = new Date();
  if (interval === "month") end.setMonth(end.getMonth() + 1);
  else if (interval === "term") end.setMonth(end.getMonth() + 4);
  else end.setFullYear(end.getFullYear() + 1);
  return end;
}

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: "School", middle_name: "", last_name: "Account" };
  if (parts.length === 1) return { first_name: parts[0], middle_name: "", last_name: "School" };
  return {
    first_name: parts[0],
    middle_name: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
    last_name: parts[parts.length - 1],
  };
}

function buildPesapalRecurringOrder({ reference, plan, school, user, callbackUrl, notificationId }) {
  const contactName = splitName(user?.name || school.name);
  return {
    id: reference,
    currency: plan.currency,
    amount: Number(plan.amount),
    description: `${plan.name} subscription for ${school.name}`,
    callback_url: callbackUrl,
    notification_id: notificationId,
    billing_address: {
      email_address: school.email || user.email || "",
      phone_number: school.phone || user.phone || "",
      country_code: "KE",
      first_name: contactName.first_name,
      middle_name: contactName.middle_name,
      last_name: contactName.last_name,
      line_1: school.address || school.name || "",
      line_2: "",
      city: school.sub_county || "",
      state: school.county || "",
      postal_code: "",
      zip_code: "",
    },
    account_number: school.school_code || String(school.id),
  };
}

async function activateSubscription(paymentId) {
  const { rows: payments } = await db.query(
    `SELECT sp.*, pp.billing_interval
     FROM subscription_payments sp
     JOIN payment_plans pp ON pp.id = sp.plan_id
     WHERE sp.id=$1`,
    [paymentId]
  );
  if (!payments.length) return null;
  const payment = payments[0];
  const end = subscriptionEndDate(payment.billing_interval);
  const { rows } = await db.query(
    `INSERT INTO school_subscriptions
     (school_id, plan_id, status, current_period_start, current_period_end, last_payment_id)
     VALUES ($1,$2,'active',NOW(),$3,$4)
     ON CONFLICT (school_id) DO UPDATE SET
       plan_id=EXCLUDED.plan_id,
       status='active',
       current_period_start=NOW(),
       current_period_end=EXCLUDED.current_period_end,
       last_payment_id=EXCLUDED.last_payment_id,
       updated_at=NOW()
     RETURNING *`,
    [payment.school_id, payment.plan_id, end, payment.id]
  );
  return rows[0];
}

// ── TEMP DEBUG: remove after fixing payment ───────────────────────
router.get("/debug-pesapal", async (req, res) => {
  const info = {
    PESAPAL_BASE_URL: process.env.PESAPAL_BASE_URL || "(not set, using sandbox default)",
    PESAPAL_CONSUMER_KEY: process.env.PESAPAL_CONSUMER_KEY
      ? process.env.PESAPAL_CONSUMER_KEY.slice(0, 8) + "..."
      : "(NOT SET)",
    PESAPAL_CONSUMER_SECRET: process.env.PESAPAL_CONSUMER_SECRET
      ? process.env.PESAPAL_CONSUMER_SECRET.slice(0, 4) + "..."
      : "(NOT SET)",
    PESAPAL_IPN_ID: process.env.PESAPAL_IPN_ID || "(not set)",
    PESAPAL_IPN_URL: process.env.PESAPAL_IPN_URL || "(not set)",
    PESAPAL_CALLBACK_URL: process.env.PESAPAL_CALLBACK_URL || "(not set)",
    NODE_ENV: process.env.NODE_ENV,
  };
  try {
    const token = await getPesapalToken();
    return res.json({ success: true, config: info, token_preview: token.slice(0, 20) + "..." });
  } catch (err) {
    return res.status(500).json({ success: false, config: info, error: err.message });
  }
});
// ── END DEBUG ─────────────────────────────────────────────────────

router.get("/plans", auth, async (req, res) => {
  try {
    const where = req.user.role === "SUPER_ADMIN" ? "" : "WHERE is_active = TRUE";
    const { rows } = await db.query(
      `SELECT * FROM payment_plans ${where} ORDER BY amount, name`
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/plans", auth, roleM(PLAN_ROLES),
  [
    body("name").trim().notEmpty().isLength({ max: 100 }),
    body("amount").isFloat({ min: 1 }),
    body("currency").optional().isLength({ min: 3, max: 3 }),
    body("billing_interval").isIn(["month", "term", "year"]),
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
         VALUES ($1,$2,UPPER($3),$4,$5,$6,$7)
         RETURNING *`,
        [name, amount, currency || "KES", billing_interval, student_limit || null, ai_enabled !== false, is_active !== false]
      );
      await audit(req, "CREATE_PAYMENT_PLAN", "payment_plans", rows[0].id, null, rows[0]);
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ success: false, message: "Plan already exists." });
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

router.put("/plans/:id", auth, roleM(PLAN_ROLES), async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE payment_plans SET
         name = COALESCE($1, name),
         amount = COALESCE($2, amount),
         currency = COALESCE(UPPER($3), currency),
         billing_interval = COALESCE($4, billing_interval),
         student_limit = COALESCE($5, student_limit),
         ai_enabled = COALESCE($6, ai_enabled),
         is_active = COALESCE($7, is_active),
         updated_at = NOW()
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
});

router.get("/me", auth, async (req, res) => {
  try {
    if (!req.user.school_id) return res.json({ success: true, data: null });
    const { rows } = await db.query(
      `SELECT ss.*, pp.name AS plan_name, pp.amount, pp.currency, pp.billing_interval, pp.ai_enabled
       FROM school_subscriptions ss
       JOIN payment_plans pp ON pp.id = ss.plan_id
       WHERE ss.school_id = $1
       ORDER BY ss.created_at DESC
       LIMIT 1`,
      [req.user.school_id]
    );
    return res.json({ success: true, data: rows[0] || null });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/checkout", auth, roleM(CHECKOUT_ROLES),
  [body("plan_id").isInt({ min: 1 }), body("school_id").optional().isUUID()],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const schoolId = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!schoolId) return res.status(400).json({ success: false, message: "school_id required." });

      const [{ rows: schools }, { rows: plans }] = await Promise.all([
        db.query("SELECT * FROM schools WHERE id=$1", [schoolId]),
        db.query("SELECT * FROM payment_plans WHERE id=$1 AND is_active=TRUE", [req.body.plan_id]),
      ]);
      if (!schools.length) return res.status(404).json({ success: false, message: "School not found." });
      if (!plans.length) return res.status(404).json({ success: false, message: "Plan not found." });

      const school = schools[0];
      const plan = plans[0];
      const reference = `SUB-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const callbackUrl = process.env.PESAPAL_CALLBACK_URL || `${req.protocol}://${req.get("host")}/subscription.html`;
      const token = await getPesapalToken();
      const notificationId = await getNotificationId(token);
      const pesapalOrder = buildPesapalRecurringOrder({
        reference,
        plan,
        school,
        user: req.user,
        callbackUrl,
        notificationId,
      });
      const order = await pesapalFetch("/Transactions/SubmitOrderRequest", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(pesapalOrder),
      });

      const redirectUrl = order.redirect_url || order.redirectUrl;
      const trackingId = order.order_tracking_id || order.orderTrackingId || null;
      const { rows } = await db.query(
        `INSERT INTO subscription_payments
         (school_id, plan_id, merchant_reference, order_tracking_id, amount, currency, status, checkout_url, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8)
         RETURNING *`,
        [schoolId, plan.id, reference, trackingId, plan.amount, plan.currency, redirectUrl, req.user.id]
      );
      await audit(req, "CREATE_SUBSCRIPTION_CHECKOUT", "subscription_payments", rows[0].id, null, rows[0]);
      return res.status(201).json({ success: true, data: rows[0], redirect_url: redirectUrl });
    } catch (err) {
      console.error("[Pesapal] Checkout error:", err.message);
      // Return actual Pesapal error to client so it's actionable
      return res.status(500).json({ success: false, message: err.message || "Unable to start Pesapal checkout." });
    }
  }
);

router.post("/payments/:id/activate", auth, roleM(PLAN_ROLES), async (req, res) => {
  try {
    const { rows: payments } = await db.query("SELECT * FROM subscription_payments WHERE id=$1", [req.params.id]);
    if (!payments.length) return res.status(404).json({ success: false, message: "Payment not found." });
    await db.query("UPDATE subscription_payments SET status='completed', updated_at=NOW() WHERE id=$1", [payments[0].id]);
    const subscription = await activateSubscription(payments[0].id);
    await audit(req, "ACTIVATE_SUBSCRIPTION", "school_subscriptions", subscription.id, null, subscription);
    return res.json({ success: true, data: subscription });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.get("/ipn", async (req, res) => {
  try {
    const trackingId = req.query.OrderTrackingId || req.query.orderTrackingId;
    const merchantReference = req.query.OrderMerchantReference || req.query.orderMerchantReference;
    if (!trackingId && !merchantReference) return res.status(400).json({ success: false });

    const token = await getPesapalToken();
    const statusPath = trackingId
      ? `/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(trackingId)}`
      : `/Transactions/GetTransactionStatus?orderMerchantReference=${encodeURIComponent(merchantReference)}`;
    const status = await pesapalFetch(statusPath, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const normalized = String(status.payment_status_description || status.status || "").toLowerCase();
    const paid = normalized.includes("completed") || normalized.includes("paid");
    const { rows } = await db.query(
      `UPDATE subscription_payments SET
         status=$1, provider_payload=$2, updated_at=NOW()
       WHERE order_tracking_id=$3 OR merchant_reference=$4
       RETURNING id`,
      [paid ? "completed" : normalized || "pending", JSON.stringify(status), trackingId || null, merchantReference || null]
    );
    if (paid && rows[0]?.id) await activateSubscription(rows[0].id);
    return res.json({ success: true });
  } catch (err) {
    console.error("Pesapal IPN:", err.message);
    return res.status(500).json({ success: false });
  }
});

module.exports = router;
