/**
 * authMiddleware — V-01, V-06
 * - Verifies JWT signature (requires strong JWT_SECRET ≥64 chars)
 * - Checks token blocklist (revoked tokens)
 * - Attaches req.user
 */
const jwt = require("jsonwebtoken");
const db  = require("../config/db");
require("dotenv").config();

const authMiddleware = async (req, res, next) => {
    try {
        // Support both httpOnly cookie (preferred) and Bearer header (API clients)
        let token = req.cookies?.token;
        if (!token) {
            const auth = req.headers.authorization;
            if (auth?.startsWith("Bearer ")) token = auth.split(" ")[1];
        }
        if (!token) {
            return res.status(401).json({ success: false, message: "Authentication required." });
        }

        // Verify signature
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            const msg = err.name === "TokenExpiredError" ? "Session expired. Please log in again." : "Invalid token.";
            return res.status(401).json({ success: false, message: msg });
        }

        // V-06: Check token blocklist (logout/revocation)
        if (decoded.jti) {
            const blocked = await db.query(
                "SELECT id FROM token_blocklist WHERE jti = $1 AND expires_at > NOW()",
                [decoded.jti]
            );
            if (blocked.rows.length) {
                return res.status(401).json({ success: false, message: "Session has been revoked. Please log in again." });
            }
        }

        // Verify user still active in DB (catches deactivated accounts mid-session)
        const { rows } = await db.query(
            `SELECT u.id, u.email, u.name, u.role, u.school_id, u.is_active,
                    u.must_change_password, s.is_active AS school_active
             FROM users u
             LEFT JOIN schools s ON s.id = u.school_id
             WHERE u.id = $1`,
            [decoded.id]
        );

        if (!rows.length || !rows[0].is_active) {
            return res.status(401).json({ success: false, message: "Account not found or deactivated." });
        }

        // Block access if school deactivated (except SUPER_ADMIN)
        if (rows[0].role !== "SUPER_ADMIN" && rows[0].school_active === false) {
            return res.status(403).json({ success: false, message: "School account deactivated." });
        }

        req.user  = rows[0];
        req.token = decoded;
        next();
    } catch (err) {
        console.error("authMiddleware error:", err.message);
        return res.status(500).json({ success: false, message: "Authentication error." });
    }
};

module.exports = authMiddleware;
