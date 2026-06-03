const jwt = require("jsonwebtoken");
const db  = require("../config/db");

module.exports = async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "No token provided." });
    const token = header.split(" ")[1];
    let payload;
    try { payload = jwt.verify(token, process.env.JWT_SECRET); }
    catch (e) { return res.status(401).json({ success: false, message: "Invalid or expired token." }); }

    // Check token is not in blocklist
    if (payload.jti) {
      const { rows } = await db.query("SELECT id FROM token_blocklist WHERE jti=$1",[payload.jti]);
      if (rows.length) return res.status(401).json({ success: false, message: "Token has been revoked." });
    }

    // Verify user still active + school still active
    const { rows } = await db.query(
      `SELECT u.is_active, u.role, s.is_active AS school_active
       FROM users u LEFT JOIN schools s ON s.id=u.school_id WHERE u.id=$1`, [payload.id]
    );
    if (!rows.length || !rows[0].is_active) return res.status(401).json({ success: false, message: "Account is inactive." });
    if (rows[0].school_active === false) return res.status(403).json({ success: false, message: "School account deactivated." });

    req.user = payload;
    next();
  } catch (err) {
    console.error("authMiddleware:", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
