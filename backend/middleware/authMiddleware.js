/**
 * authMiddleware — verifies JWT + blocklist + live DB checks
 * Fetches fresh role/school_id from DB on every request so that
 * deactivations and role changes take effect immediately without
 * waiting for token expiry.
 */
const jwt = require("jsonwebtoken");
const db  = require("../config/db");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
      return res.status(401).json({ success: false, message: "No token provided." });

    const token = header.split(" ")[1];
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, message: "Invalid or expired token." });
    }

    // ── Blocklist check ───────────────────────────────────────────
    if (payload.jti) {
      const { rows: bl } = await db.query(
        "SELECT id FROM token_blocklist WHERE jti=$1", [payload.jti]
      );
      if (bl.length)
        return res.status(401).json({ success: false, message: "Token has been revoked." });
    }

    // ── Live DB check: role, school_active, is_active ─────────────
    // Always query DB so revocations/role changes are instant
    const { rows } = await db.query(
      `SELECT u.id, u.role, u.school_id, u.is_active,
              u.must_change_password,
              s.is_active AS school_active
       FROM users u
       LEFT JOIN schools s ON s.id = u.school_id
       WHERE u.id = $1`,
      [payload.id]
    );

    if (!rows.length || !rows[0].is_active)
      return res.status(401).json({ success: false, message: "Account is inactive." });

    if (rows[0].school_active === false)
      return res.status(403).json({ success: false, message: "School account is deactivated." });

    // Merge JWT payload with fresh DB values (DB wins for security-sensitive fields)
    req.user = {
      ...payload,
      role:      rows[0].role,       // Always use DB role — not JWT's stale value
      school_id: rows[0].school_id,  // Always use DB school_id
      must_change_password: rows[0].must_change_password,
    };

    next();
  } catch (err) {
    console.error("authMiddleware:", err.message);
    return res.status(500).json({ success: false, message: "Authentication error." });
  }
};
