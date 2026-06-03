/**
 * /api/auth
 * Login, logout, verify, change password, audit log
 * Roles: SUPER_ADMIN, PRINCIPAL, DEPUTY_PRINCIPAL, HOD, TEACHER, BURSAR
 */
const express   = require("express");
const bcrypt    = require("bcryptjs");
const jwt       = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const db        = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const { audit } = require("../middleware/auditLog");

const router = express.Router();
const JWT_SECRET  = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "10h";

// ── POST /api/auth/login ──────────────────────────────────────────
router.post("/login",
  [
    body("username").trim().notEmpty(),
    body("password").notEmpty(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, message: "Username and password required." });

    const { username, password, school_code } = req.body;
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress;

    try {
      // Find user — SUPER_ADMIN has no school_code
      let userQuery, userParams;
      if (school_code) {
        userQuery = `SELECT u.*, s.name AS school_name, s.school_code, s.academic_year,
                            s.current_term, s.logo_url, s.is_active AS school_active
                     FROM users u
                     JOIN schools s ON s.id = u.school_id
                     WHERE (u.username = $1 OR u.email = $1) AND s.school_code = $2`;
        userParams = [username, school_code.toUpperCase()];
      } else {
        userQuery = `SELECT u.*, NULL AS school_name, NULL AS school_code,
                            NULL AS academic_year, NULL AS current_term,
                            NULL AS logo_url, TRUE AS school_active
                     FROM users u
                     WHERE (u.username = $1 OR u.email = $1) AND u.role = 'SUPER_ADMIN'`;
        userParams = [username];
      }

      const { rows } = await db.query(userQuery, userParams);
      const user = rows[0];

      // Generic error — don't reveal whether user exists
      if (!user) {
        await audit({ user: null, headers: req.headers, socket: req.socket }, "LOGIN_FAIL", "users", null, null, { username }, "FAIL", "User not found");
        return res.status(401).json({ success: false, message: "Invalid credentials." });
      }

      // School active check
      if (!user.school_active) return res.status(403).json({ success: false, message: "School account is deactivated." });

      // Account locked?
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
        return res.status(423).json({ success: false, message: `Account locked. Try again in ${mins} minute(s).` });
      }

      // Account inactive?
      if (!user.is_active) return res.status(403).json({ success: false, message: "Account is deactivated." });

      // Password check
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        const attempts = (user.failed_login_attempts || 0) + 1;
        const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
        await db.query(
          "UPDATE users SET failed_login_attempts=$1, locked_until=$2 WHERE id=$3",
          [attempts, lockUntil, user.id]
        );
        await audit({ user: null, headers: req.headers, socket: req.socket }, "LOGIN_FAIL", "users", user.id, null, { attempts }, "FAIL", "Bad password");
        return res.status(401).json({ success: false, message: "Invalid credentials." });
      }

      // Reset failed attempts + update last_login
      await db.query(
        "UPDATE users SET failed_login_attempts=0, locked_until=NULL, last_login=NOW() WHERE id=$1",
        [user.id]
      );

      // Issue JWT with jti for blocklist support
      const jti = require("crypto").randomBytes(16).toString("hex");
      const payload = {
        jti,
        id:            user.id,
        school_id:     user.school_id,
        school_name:   user.school_name,
        school_code:   user.school_code,
        academic_year: user.academic_year,
        current_term:  user.current_term,
        logo_url:      user.logo_url,
        name:          user.name,
        email:         user.email,
        username:      user.username,
        role:          user.role,
        must_change_password: user.must_change_password,
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

      await audit({ user: payload, headers: req.headers, socket: req.socket }, "LOGIN", "users", user.id, null, { role: user.role }, "SUCCESS");

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
router.post("/logout", authMiddleware, async (req, res) => {
  try {
    // Add jti to blocklist
    if (req.user?.jti) {
      const exp = new Date(req.user.exp * 1000);
      await db.query(
        "INSERT INTO token_blocklist (jti, user_id, expires_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [req.user.jti, req.user.id, exp]
      );
    }
    await audit(req, "LOGOUT", "users", req.user.id);
    return res.json({ success: true, message: "Logged out." });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/auth/verify ──────────────────────────────────────────
router.get("/verify", authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, u.username, u.role, u.is_active,
              u.must_change_password, u.school_id,
              s.name AS school_name, s.school_code, s.academic_year,
              s.current_term, s.logo_url, s.is_active AS school_active
       FROM users u
       LEFT JOIN schools s ON s.id = u.school_id
       WHERE u.id = $1`, [req.user.id]
    );
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ success: false, message: "Session invalid." });
    if (user.school_id && !user.school_active) return res.status(403).json({ success: false, message: "School deactivated." });
    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── POST /api/auth/change-password ───────────────────────────────
router.post("/change-password", authMiddleware,
  [
    body("current_password").notEmpty(),
    body("new_password").isLength({ min: 8 }).withMessage("Min 8 characters")
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage("Must contain uppercase, lowercase, and number"),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const { rows } = await db.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
      const valid = await bcrypt.compare(req.body.current_password, rows[0].password_hash);
      if (!valid) return res.status(400).json({ success: false, message: "Current password is incorrect." });

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
router.get("/audit-log", authMiddleware, async (req, res) => {
  try {
    const { role, school_id } = req.user;
    const allowed = ["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL"];
    if (!allowed.includes(role)) return res.status(403).json({ success: false, message: "Access denied." });

    const schoolFilter = role === "SUPER_ADMIN" ? "" : "WHERE al.school_id = $1";
    const params = role === "SUPER_ADMIN" ? [] : [school_id];
    const { rows } = await db.query(
      `SELECT al.*, u.name AS user_name FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${schoolFilter} ORDER BY al.created_at DESC LIMIT 100`,
      params
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
