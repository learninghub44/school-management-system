/**
 * /api/auth — Login, logout, verify, change-password, audit-log
 * Security: bcrypt, JWT + jti blocklist, account lockout (5 attempts → 15min)
 * Constant-time path to prevent user enumeration on login failure
 */
"use strict";
const express = require("express");
const bcrypt  = require("bcryptjs");
const crypto  = require("crypto");
const jwt     = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const db   = require("../config/db");
const auth = require("../middleware/authMiddleware");
const { audit } = require("../middleware/auditLog");

const router = express.Router();
const JWT_SECRET  = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "10h";

// ── Cloudflare Turnstile CAPTCHA verification ─────────────────────
async function verifyTurnstile(token, ip) {
  if (!token) return false;
  const secret = (globalThis.WORKER_ENV?.TURNSTILE_SECRET_KEY) || process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Dev mode: skip CAPTCHA if secret not configured
    console.warn("[turnstile] TURNSTILE_SECRET_KEY not set — skipping verification");
    return true;
  }
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    });
    const data = await r.json();
    return data.success === true;
  } catch (e) {
    console.error("[turnstile] Verification error:", e.message);
    return false;
  }
}

// Dummy hash for constant-time comparison when user not found (prevents timing attacks)
const DUMMY_HASH = "$2b$12$hWsOkHoESichkRBu8Yynqei4G/cjWZmAYNITOYnjNGDi2vTdv5YLy";

// ── POST /api/auth/login ──────────────────────────────────────────
router.post("/login",
  [
    body("username").trim().notEmpty().isLength({ max: 255 }),
    body("password").notEmpty().isLength({ max: 200 }),
    body("school_code").optional().trim().isLength({ max: 20 })
      .matches(/^[A-Z0-9]*$/i).withMessage("Invalid school code format"),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, message: "Invalid request." });

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress;

    // CAPTCHA verification — TEMPORARILY DISABLED, see git history / verifyTurnstile() above to re-enable
    // const captchaOk = await verifyTurnstile(req.body.cf_turnstile_response, ip);
    // if (!captchaOk)
    //   return res.status(400).json({ success: false, message: "CAPTCHA verification failed. Please try again." });

    const { username, password } = req.body;
    const raw_school_code = req.body.school_code?.trim().toUpperCase() || null;
    const school_code = raw_school_code === "ADMIN100" ? null : raw_school_code;

    try {
      let user = null;

      if (school_code) {
        // Staff login with school code
        const { rows } = await db.query(
          `SELECT u.*, s.name AS school_name, s.school_code, s.academic_year,
                  s.current_term, s.logo_url, s.is_active AS school_active,
                  ss.status AS subscription_status,
                  ss.current_period_end AS subscription_expires_at,
                  pp.name AS subscription_plan,
                  pp.ai_enabled
           FROM users u
           JOIN schools s ON s.id = u.school_id
           LEFT JOIN school_subscriptions ss ON ss.school_id = s.id
           LEFT JOIN payment_plans pp ON pp.id = ss.plan_id
           WHERE (u.username = $1 OR u.email = $1)
             AND s.school_code = $2
             AND u.role != 'SUPER_ADMIN'`,
          [username, school_code]
        );
        user = rows[0] || null;
      } else {
        // SUPER_ADMIN login (no school code)
        const { rows } = await db.query(
          `SELECT u.*, NULL AS school_name, NULL AS school_code,
                  NULL AS academic_year, NULL AS current_term,
                  NULL AS logo_url, TRUE AS school_active
           FROM users u
           WHERE (u.username = $1 OR u.email = $1)
             AND UPPER(u.role) = 'SUPER_ADMIN'`,
          [username]
        );
        user = rows[0] || null;
      }

      // ALWAYS do bcrypt compare — prevents timing-based user enumeration
      const hashToCheck = user ? user.password_hash : DUMMY_HASH;
      const validPassword = await bcrypt.compare(password, hashToCheck);

      if (!user || !validPassword) {
        // If user exists but wrong password, increment failed attempts
        if (user) {
          const attempts = (user.failed_login_attempts || 0) + 1;
          const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
          await db.query(
            "UPDATE users SET failed_login_attempts=$1, locked_until=$2 WHERE id=$3",
            [attempts, lockUntil, user.id]
          );
        }
        await audit(
          { user: null, headers: req.headers, socket: req.socket },
          "LOGIN_FAIL", "users", user?.id || null, null,
          { username, school_code }, "FAIL", "Bad credentials"
        );
        return res.status(401).json({ success: false, message: "Invalid credentials." });
      }

      // Check account locked first (before revealing school/account state)
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const mins = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
        return res.status(423).json({
          success: false,
          message: `Account locked. Try again in ${mins} minute(s).`
        });
      }

      // Check account active
      if (!user.is_active)
        return res.status(403).json({ success: false, message: "Account is deactivated." });

      // Check school active
      if (!user.school_active)
        return res.status(403).json({ success: false, message: "School account is deactivated." });

      // Reset failed attempts + record login
      await db.query(
        "UPDATE users SET failed_login_attempts=0, locked_until=NULL, last_login=NOW() WHERE id=$1",
        [user.id]
      );

      // Issue JWT with jti for blocklist support
      const jti = crypto.randomBytes(16).toString("hex");
      const payload = {
        jti,
        id:            user.id,
        school_id:     user.school_id,
        school_name:   user.school_name,
        school_code:   user.school_code,
        academic_year: user.academic_year,
        current_term:  user.current_term,
        logo_url:      user.logo_url,
        subscription_status: "active", // manual activation — payment bypassed
        subscription_expires_at: null,
        subscription_plan: user.subscription_plan || null,
        ai_enabled: true,
        name:          user.name,
        email:         user.email,
        username:      user.username,
        role:          user.role,
        must_change_password: user.must_change_password,
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

      await audit(
        { user: payload, headers: req.headers, socket: req.socket },
        "LOGIN", "users", user.id, null, { role: user.role }
      );

      return res.json({
        success: true,
        token,
        user: payload,
        must_change_password: user.must_change_password,
      });
    } catch (err) {
      console.error("Login error:", err.message);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── POST /api/auth/logout ─────────────────────────────────────────
router.post("/logout", auth, async (req, res) => {
  try {
    if (req.user?.jti) {
      const exp = new Date(req.user.exp * 1000);
      await db.query(
        "INSERT INTO token_blocklist (jti, user_id, expires_at) VALUES ($1,$2,$3) ON CONFLICT (jti) DO NOTHING",
        [req.user.jti, req.user.id, exp]
      );
    }
    // Bust the auth cache so revocation is immediate
    auth.cacheBust?.(req.user?.id);
    await audit(req, "LOGOUT", "users", req.user.id);
    return res.json({ success: true, message: "Logged out." });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/auth/verify ──────────────────────────────────────────
router.get("/verify", auth, async (req, res) => {
  try {
    // req.user is already DB-verified by authMiddleware — just return fresh data
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, u.username, u.role, u.is_active,
              u.must_change_password, u.school_id,
              s.name AS school_name, s.school_code, s.academic_year,
              s.current_term, s.logo_url, s.is_active AS school_active,
              ss.status AS subscription_status,
              ss.current_period_end AS subscription_expires_at,
              pp.name AS subscription_plan,
              pp.ai_enabled
       FROM users u
       LEFT JOIN schools s ON s.id = u.school_id
       LEFT JOIN school_subscriptions ss ON ss.school_id = s.id
       LEFT JOIN payment_plans pp ON pp.id = ss.plan_id
       WHERE u.id = $1`, [req.user.id]
    );
    const user = rows[0];
    if (!user || !user.is_active)
      return res.status(401).json({ success: false, message: "Session invalid." });
    if (user.school_id && user.school_active === false)
      return res.status(403).json({ success: false, message: "School deactivated." });
    return res.json({ success: true, user: { ...user, subscription_status: "active", subscription_expires_at: null, ai_enabled: true } });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── POST /api/auth/change-password ───────────────────────────────
router.post("/change-password", auth,
  [
    body("current_password").notEmpty(),
    body("new_password")
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage("Min 8 chars, must include uppercase, lowercase, and number"),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const { rows } = await db.query(
        "SELECT password_hash FROM users WHERE id=$1", [req.user.id]
      );
      const valid = await bcrypt.compare(req.body.current_password, rows[0].password_hash);
      if (!valid)
        return res.status(400).json({ success: false, message: "Current password is incorrect." });

      // Disallow reusing current password
      const same = await bcrypt.compare(req.body.new_password, rows[0].password_hash);
      if (same)
        return res.status(400).json({ success: false, message: "New password must differ from current password." });

      const hash = await bcrypt.hash(req.body.new_password, 12);
      await db.query(
        "UPDATE users SET password_hash=$1, must_change_password=FALSE, password_changed_at=NOW() WHERE id=$2",
        [hash, req.user.id]
      );
      await audit(req, "CHANGE_PASSWORD", "users", req.user.id);
      return res.json({ success: true, message: "Password changed successfully." });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── GET /api/auth/audit-log ───────────────────────────────────────
router.get("/audit-log", auth, async (req, res) => {
  try {
    const { role, school_id } = req.user;
    const allowed = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL"];
    if (!allowed.includes(role))
      return res.status(403).json({ success: false, message: "Access denied." });

    const p = [], where = [];
    if (role !== "SUPER_ADMIN") { p.push(school_id); where.push(`al.school_id=$${p.length}`); }

    // Validate and sanitize filters
    if (req.query.action) {
      if (!/^[A-Z_]{2,50}$/.test(req.query.action))
        return res.status(400).json({ success: false, message: "Invalid action filter." });
      p.push(req.query.action); where.push(`al.action=$${p.length}`);
    }
    if (req.query.user_id) {
      if (!/^[0-9a-f-]{36}$/i.test(req.query.user_id))
        return res.status(400).json({ success: false, message: "Invalid user_id filter." });
      p.push(req.query.user_id); where.push(`al.user_id=$${p.length}`);
    }

    // Pagination — max 200 per page
    const limit  = Math.min(parseInt(req.query.limit)  || 100, 200);
    const offset = Math.max(parseInt(req.query.offset) || 0,   0);
    p.push(limit); const limitParam = p.length;
    p.push(offset); const offsetParam = p.length;

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    const { rows } = await db.query(
      `SELECT al.*, u.name AS user_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`, p
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── POST /api/auth/register — Public self-registration ───────────────────────
// Creates school + PRINCIPAL user + pending subscription in one transaction.
// Returns school_code, temp credentials, and a Paystack checkout URL.
router.post("/register",
  [
    // School fields
    body("school_name").trim().notEmpty().isLength({ max: 255 }).withMessage("School name required"),
    body("school_code").trim().notEmpty().matches(/^[A-Z0-9]{2,20}$/i).withMessage("Code must be 2–20 alphanumeric chars"),
    body("county").optional().trim().isLength({ max: 100 }),
    body("sub_county").optional().trim().isLength({ max: 100 }),
    body("level").optional().isIn(["ECDE","Primary","Junior Secondary","Senior Secondary","Mixed"]),
    body("phone").optional().matches(/^\+?[\d\s\-]{7,20}$/),
    // Admin user fields
    body("admin_name").trim().notEmpty().isLength({ max: 255 }).withMessage("Admin name required"),
    body("admin_email").isEmail().normalizeEmail().withMessage("Valid email required"),
    body("admin_password").isLength({ min: 8, max: 72 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage("Password min 8 chars with uppercase, lowercase and number"),
    // Subscription
    body("plan_id").isInt({ min: 1 }).withMessage("Plan required"),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });

    // CAPTCHA verification — TEMPORARILY DISABLED, see git history / verifyTurnstile() above to re-enable
    const regIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress;
    // const captchaOk = await verifyTurnstile(req.body.cf_turnstile_response, regIp);
    // if (!captchaOk)
    //   return res.status(400).json({ success: false, message: "CAPTCHA verification failed. Please try again." });

    const {
      school_name, school_code, county, sub_county, level, phone,
      admin_name, admin_email, admin_password, plan_id,
    } = req.body;

    const upperCode = school_code.trim().toUpperCase();

    try {
      // 1. Check plan exists
      const { rows: plans } = await db.query(
        "SELECT * FROM payment_plans WHERE id=$1 AND is_active=TRUE", [plan_id]
      );
      if (!plans.length)
        return res.status(404).json({ success: false, message: "Plan not found or unavailable." });
      const plan = plans[0];

      // 2. Check uniqueness — allow resume if school exists with no active subscription
      const { rows: existing } = await db.query(
        `SELECT s.id, s.name,
                ss.status AS sub_status,
                u.id AS principal_id,
                u.username AS principal_username,
                u.email AS principal_email,
                u.last_login AS principal_last_login,
                u2.id AS email_user_id,
                u2.school_id AS email_user_school_id
         FROM schools s
         LEFT JOIN school_subscriptions ss ON ss.school_id = s.id
         LEFT JOIN users u ON u.school_id = s.id AND u.role = 'PRINCIPAL'
         LEFT JOIN users u2 ON u2.email = $2
         WHERE s.school_code = $1`, [upperCode, admin_email]
      );

      if (existing.length) {
        const ex = existing[0];
        const hasActiveSub = ex.sub_status === "active";

        if (hasActiveSub)
          return res.status(409).json({ success: false, message: "School code already taken by an active school." });

        const principalExists = !!ex.principal_id;
        const emailMismatch = principalExists && ex.principal_email !== admin_email;
        const principalNeverLoggedIn = !ex.principal_last_login;

        // The email submitted now belongs to a DIFFERENT school's account — always block, regardless of login state.
        if (ex.email_user_id && ex.email_user_school_id && ex.email_user_school_id !== ex.id)
          return res.status(409).json({ success: false, message: "Email already registered to another school." });

        let adminId = ex.principal_id;
        let adminUsername = ex.principal_username;
        const password_hash = await bcrypt.hash(admin_password, 12);

        if (emailMismatch) {
          if (!principalNeverLoggedIn) {
            // This account has actually been used before — don't silently overwrite it.
            return res.status(409).json({ success: false, message: "School exists but email doesn\'t match. Contact support." });
          }
          // Abandoned/never-used registration (payment never completed, never logged in) — safe to
          // restart it with the newly submitted email/name/password rather than blocking the user.
          const generatedUsername = `${upperCode.toLowerCase()}_admin`;
          const { rows: updated } = await db.query(
            `UPDATE users
               SET email = $1, name = $2, username = $3, password_hash = $4, must_change_password = TRUE
             WHERE id = $5
             RETURNING id, username`,
            [admin_email, admin_name, generatedUsername, password_hash, ex.principal_id]
          );
          adminId = updated[0].id;
          adminUsername = updated[0].username;
        }

        // If no user was ever created (e.g. previous transaction rolled back), create one now
        if (!adminId) {
          const generatedUsername = `${upperCode.toLowerCase()}_admin`;
          const { rows: newUser } = await db.query(
            `INSERT INTO users (school_id, username, email, name, password_hash, role, is_active, must_change_password)
             VALUES ($1, $2, $3, $4, $5, 'PRINCIPAL', TRUE, TRUE)
             ON CONFLICT (email) DO UPDATE SET school_id=$1, username=$2, name=$4, password_hash=$5, role='PRINCIPAL'
             RETURNING id, username`,
            [ex.id, generatedUsername, admin_email, admin_name, password_hash]
          );
          adminId = newUser[0].id;
          adminUsername = newUser[0].username;
        }

        const reference = `REG-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        const paystackKey = (globalThis.WORKER_ENV?.PAYSTACK_SECRET_KEY) || process.env.PAYSTACK_SECRET_KEY;
        const callbackUrl = (globalThis.WORKER_ENV?.PAYSTACK_CALLBACK_URL) || process.env.PAYSTACK_CALLBACK_URL || `${req.protocol}://${req.get("host")}/subscription.html`;

        let checkoutUrl = null;
        try {
          const psRes = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${paystackKey}` },
            body: JSON.stringify({
              email: admin_email,
              amount: Math.round(Number(plan.amount) * 100),
              currency: plan.currency || "KES",
              reference,
              callback_url: callbackUrl,
              metadata: { school_id: ex.id, plan_id: plan.id, school_name: ex.name, plan_name: plan.name,
                          interval: plan.billing_interval, created_by: adminId, self_registered: true },
            }),
          });
          const psData = await psRes.json();
          if (psData.status) {
            checkoutUrl = psData.data?.authorization_url;
            await db.query(
              `INSERT INTO subscription_payments
                 (school_id, plan_id, merchant_reference, order_tracking_id, amount, currency, status, checkout_url, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8)`,
              [ex.id, plan.id, reference, psData.data?.access_code || null, plan.amount, plan.currency, checkoutUrl, adminId]
            );
          }
        } catch (psErr) {
          console.error("[register-resume] Paystack error:", psErr.message);
        }

        return res.status(200).json({
          success: true,
          message: "Registration found but payment incomplete. Complete payment to activate.",
          data: { school_code: upperCode, school_name: ex.name, username: adminUsername,
                  plan: plan.name, checkout_url: checkoutUrl, resumed: true },
        });
      }

      const { rows: existingEmail } = await db.query(
        "SELECT id FROM users WHERE email=$1", [admin_email]
      );
      if (existingEmail.length)
        return res.status(409).json({ success: false, message: "Email already registered to another school." });

      // 3. Hash password
      const password_hash = await bcrypt.hash(admin_password, 12);

      // 4. Transaction: insert school → insert user → insert pending subscription
      await db.query("BEGIN");
      let school, adminUser;
      try {
        const { rows: s } = await db.query(
          `INSERT INTO schools (name, school_code, phone, county, sub_county, level, academic_year, current_term, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, TRUE)
           RETURNING *`,
          [
            school_name, upperCode,
            phone || null, county || null, sub_county || null,
            level || "Primary",
            new Date().getFullYear().toString(),
          ]
        );
        school = s[0];

        const username = `${upperCode.toLowerCase()}_admin`;
        const { rows: u } = await db.query(
          `INSERT INTO users (school_id, username, email, name, password_hash, role, is_active, must_change_password)
           VALUES ($1, $2, $3, $4, $5, 'PRINCIPAL', TRUE, TRUE)
           RETURNING *`,
          [school.id, username, admin_email, admin_name, password_hash]
        );
        adminUser = u[0];

        await db.query("COMMIT");
      } catch (txErr) {
        await db.query("ROLLBACK");
        throw txErr;
      }

      // 5. Initiate Paystack checkout
      const reference = `REG-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const paystackKey = (globalThis.WORKER_ENV?.PAYSTACK_SECRET_KEY) || process.env.PAYSTACK_SECRET_KEY;
      const callbackUrl = (globalThis.WORKER_ENV?.PAYSTACK_CALLBACK_URL) || process.env.PAYSTACK_CALLBACK_URL || `${req.protocol}://${req.get("host")}/subscription.html`;

      let checkoutUrl = null;
      try {
        const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${paystackKey}`,
          },
          body: JSON.stringify({
            email: admin_email,
            amount: Math.round(Number(plan.amount) * 100),
            currency: plan.currency || "KES",
            reference,
            callback_url: callbackUrl,
            metadata: {
              school_id:   school.id,
              plan_id:     plan.id,
              school_name: school.name,
              plan_name:   plan.name,
              interval:    plan.billing_interval,
              created_by:  adminUser.id,
              self_registered: true,
            },
          }),
        });
        const psData = await paystackRes.json();
        if (psData.status) {
          checkoutUrl = psData.data?.authorization_url;
          // Save pending payment
          await db.query(
            `INSERT INTO subscription_payments
               (school_id, plan_id, merchant_reference, order_tracking_id, amount, currency, status, checkout_url, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8)`,
            [school.id, plan.id, reference, psData.data?.access_code || null,
             plan.amount, plan.currency, checkoutUrl, adminUser.id]
          );
        }
      } catch (psErr) {
        // Non-fatal — school/user created, payment can be retried from login
        console.error("[register] Paystack init failed:", psErr.message);
      }

      return res.status(201).json({
        success: true,
        message: "School registered. Complete payment to activate your account.",
        data: {
          school_code:  upperCode,
          school_name:  school.name,
          username:     adminUser.username,
          plan:         plan.name,
          checkout_url: checkoutUrl,
        },
      });

    } catch (err) {
      if (err.code === "23505")
        return res.status(409).json({ success: false, message: "School code or email already exists." });
      console.error("[register]", err.message);
      return res.status(500).json({ success: false, message: "Registration failed. Please try again." });
    }
  }
);

// ── GET /api/auth/register/plans — Public: list active plans for registration page
router.get("/register/plans", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, amount, currency, billing_interval, student_limit, ai_enabled, ai_daily_limit
       FROM payment_plans WHERE is_active=TRUE ORDER BY amount ASC`
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
