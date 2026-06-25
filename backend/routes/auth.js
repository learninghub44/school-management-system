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

    const { username, password } = req.body;
    const raw_school_code = req.body.school_code?.trim().toUpperCase() || null;
    const school_code = raw_school_code === "ADMIN100" ? null : raw_school_code;
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress;

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

module.exports = router;
