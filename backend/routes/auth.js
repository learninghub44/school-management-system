/**
 * /api/auth — Security hardened
 * Fixes: V-01, V-02, V-06, V-07, V-11, V-18, V-19
 */
const express   = require("express");
const { body, validationResult } = require("express-validator");
const bcrypt    = require("bcryptjs");
const jwt       = require("jsonwebtoken");
const crypto    = require("crypto");
const db        = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const { audit } = require("../middleware/auditLog");
require("dotenv").config();

const router = express.Router();

// ── V-01: Token factory with JTI for revocation ───────────────────
function makeToken(user) {
    return jwt.sign(
        {
            jti:       crypto.randomBytes(16).toString("hex"), // V-06: unique token ID
            id:        user.id,
            email:     user.email,
            role:      user.role,
            school_id: user.school_id || null,
            name:      user.name,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE || "8h" } // Shorter window than 7d
    );
}

// ── V-11: Generic error — never reveal whether email exists ───────
const AUTH_FAIL = "Invalid credentials.";

// ─── POST /api/auth/login ─────────────────────────────────────────
// V-02, V-18: rate limiting applied in server.js (express-rate-limit + slow-down)
router.post("/login",
    [
        body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
        body("password").notEmpty().withMessage("Password required"),
    ],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, message: "Invalid input." });

        const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress;

        try {
            const { email, password, school_code } = req.body;

            const { rows } = await db.query(
                `SELECT u.*,
                        s.name        AS school_name,
                        s.school_code AS school_code,
                        s.is_active   AS school_active
                 FROM users u
                 LEFT JOIN schools s ON s.id = u.school_id
                 WHERE u.email = $1`,
                [email.toLowerCase().trim()]
            );

            // V-11: Same response whether user missing or password wrong
            if (!rows.length) {
                await audit({ headers: req.headers, socket: req.socket, user: null }, "FAILED_LOGIN", "auth", null, null, { email, ip }, "FAILURE", "Email not found");
                return res.status(401).json({ success: false, message: AUTH_FAIL });
            }

            const user = rows[0];

            // V-18: Account lockout check
            if (user.locked_until && new Date(user.locked_until) > new Date()) {
                const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
                await audit({ headers: req.headers, socket: req.socket, user }, "FAILED_LOGIN", "auth", user.id, null, { reason: "locked" }, "FAILURE", "Account locked");
                return res.status(429).json({ success: false, message: `Account locked. Try again in ${mins} minute(s).` });
            }

            // School code validation (non-SUPER_ADMIN)
            if (user.role !== "SUPER_ADMIN") {
                if (!school_code || user.school_code?.toUpperCase() !== school_code.toUpperCase().trim()) {
                    await incrementFailedLogins(user.id);
                    await audit({ headers: req.headers, socket: req.socket, user }, "FAILED_LOGIN", "auth", user.id, null, { reason: "bad_school_code" }, "FAILURE");
                    return res.status(401).json({ success: false, message: AUTH_FAIL });
                }
                if (user.school_active === false) {
                    return res.status(403).json({ success: false, message: "School account has been deactivated." });
                }
            }

            if (!user.is_active) {
                return res.status(403).json({ success: false, message: "Account deactivated. Contact admin." });
            }

            const valid = await bcrypt.compare(password, user.password_hash);
            if (!valid) {
                await incrementFailedLogins(user.id);
                await audit({ headers: req.headers, socket: req.socket, user }, "FAILED_LOGIN", "auth", user.id, null, { reason: "bad_password", ip }, "FAILURE");
                return res.status(401).json({ success: false, message: AUTH_FAIL });
            }

            // Successful login — reset lockout counters
            await db.query(
                "UPDATE users SET failed_login_attempts=0, locked_until=NULL, last_login=NOW() WHERE id=$1",
                [user.id]
            );

            const token = makeToken(user);

            // V-05: Set httpOnly, Secure cookie
            // Cross-domain (Cloudflare -> Render) requires SameSite: "None" + Secure: true
            res.cookie("token", token, {
                httpOnly: true,
                secure:   true, 
                sameSite: "None",
                maxAge:   8 * 60 * 60 * 1000, // 8 hours
            });

            await audit({ headers: req.headers, socket: req.socket, user }, "LOGIN", "auth", user.id, null, { role: user.role, school: user.school_name }, "SUCCESS");

            return res.json({
                success: true,
                message: "Login successful",
                // Token is primarily in httpOnly cookie for browser security
                user: {
                    id:                  user.id,
                    email:               user.email,
                    name:                user.name,
                    role:                user.role,
                    phone:               user.phone,
                    school_id:           user.school_id,
                    school_name:         user.school_name,
                    school_code:         user.school_code,
                    must_change_password: user.must_change_password,
                },
            });
        } catch (err) {
            console.error("Login error:", err.message);
            return res.status(500).json({ success: false, message: "Server error." });
        }
    }
);

// ── Account lockout helper (V-18) ─────────────────────────────────
async function incrementFailedLogins(userId) {
    try {
        const MAX_ATTEMPTS    = 5;
        const LOCKOUT_MINUTES = 15;
        const { rows } = await db.query(
            `UPDATE users
             SET failed_login_attempts = failed_login_attempts + 1,
                 locked_until = CASE
                   WHEN failed_login_attempts + 1 >= $1
                   THEN NOW() + ($2 || ' minutes')::INTERVAL
                   ELSE NULL END
             WHERE id = $3
             RETURNING failed_login_attempts`,
            [MAX_ATTEMPTS, LOCKOUT_MINUTES, userId]
        );
        return rows[0]?.failed_login_attempts;
    } catch (_) {}
}

// ─── POST /api/auth/logout — V-06 token revocation ───────────────
router.post("/logout", authMiddleware, async (req, res) => {
    try {
        if (req.token?.jti && req.token?.exp) {
            await db.query(
                "INSERT INTO token_blocklist (jti, user_id, expires_at) VALUES ($1,$2,to_timestamp($3)) ON CONFLICT (jti) DO NOTHING",
                [req.token.jti, req.user.id, req.token.exp]
            );
        }
        res.clearCookie("token", { httpOnly: true, secure: true, sameSite: "None" });
        await audit(req, "LOGOUT", "auth", req.user.id);
        return res.json({ success: true, message: "Logged out." });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Logout error." });
    }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────
router.get("/me", authMiddleware, async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT u.id, u.email, u.name, u.role, u.phone, u.school_id,
                    u.is_active, u.must_change_password, u.last_login,
                    s.name AS school_name, s.school_code, s.level AS school_level
             FROM users u
             LEFT JOIN schools s ON s.id = u.school_id
             WHERE u.id = $1`,
            [req.user.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: "Not found." });
        return res.json({ success: true, data: rows[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

// ─── GET /api/auth/verify ─────────────────────────────────────────
router.get("/verify", authMiddleware, (req, res) =>
    res.json({ success: true, user: req.user })
);

// ─── POST /api/auth/change-password — V-07 old password required ─
router.post("/change-password", authMiddleware,
    [
        body("current_password").notEmpty().withMessage("Current password required"),
        body("new_password")
            .isLength({ min: 8 }).withMessage("Min 8 characters")
            .matches(/[A-Z]/).withMessage("Must include uppercase letter")
            .matches(/[0-9]/).withMessage("Must include number")
            .matches(/[^A-Za-z0-9]/).withMessage("Must include special character"),
    ],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const { current_password, new_password } = req.body;

            // V-07: Verify current password before allowing change
            const { rows } = await db.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
            if (!rows.length) return res.status(404).json({ success: false, message: "User not found." });

            const valid = await bcrypt.compare(current_password, rows[0].password_hash);
            if (!valid) {
                await audit(req, "FAILED_PASSWORD_CHANGE", "auth", req.user.id, null, null, "FAILURE", "Wrong current password");
                return res.status(403).json({ success: false, message: "Current password is incorrect." });
            }

            const hash = await bcrypt.hash(new_password, 12);
            await db.query(
                "UPDATE users SET password_hash=$1, password_changed_at=NOW(), must_change_password=FALSE WHERE id=$2",
                [hash, req.user.id]
            );

            // Revoke current token — force re-login with new password
            if (req.token?.jti) {
                await db.query(
                    "INSERT INTO token_blocklist (jti, user_id, expires_at) VALUES ($1,$2,to_timestamp($3)) ON CONFLICT (jti) DO NOTHING",
                    [req.token.jti, req.user.id, req.token.exp]
                );
            }
            res.clearCookie("token", { httpOnly: true, secure: true, sameSite: "None" });
            await audit(req, "PASSWORD_CHANGED", "auth", req.user.id);
            return res.json({ success: true, message: "Password changed. Please log in again." });
        } catch (err) {
            return res.status(500).json({ success: false, message: "Server error." });
        }
    }
);

// ─── GET /api/auth/audit — admin views own school audit log ──────
router.get("/audit", authMiddleware, async (req, res) => {
    try {
        const { role, school_id } = req.user;
        if (!["SUPER_ADMIN","SCHOOL_ADMIN"].includes(role))
            return res.status(403).json({ success: false, message: "Access denied." });

        let q = `SELECT al.*, u.name AS user_name
                 FROM audit_logs al LEFT JOIN users u ON u.id=al.user_id`;
        const params = [];
        if (role === "SCHOOL_ADMIN") { params.push(school_id); q += " WHERE al.school_id=$1"; }
        q += " ORDER BY al.created_at DESC LIMIT 200";

        const { rows } = await db.query(q, params);
        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

module.exports = router;
