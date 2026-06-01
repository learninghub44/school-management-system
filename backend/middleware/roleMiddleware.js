/**
 * Role guard - call after authMiddleware
 * Usage: roleMiddleware(["SUPER_ADMIN", "SCHOOL_ADMIN"])
 *
 * This is the FIRST layer of access control (application layer).
 * RLS policies in Postgres are the SECOND layer (database layer).
 * Both must pass for a request to succeed.
 */
const roleMiddleware = (allowedRoles = []) => (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Not authenticated." });
    }
    if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: `Access denied. Requires: ${allowedRoles.join(", ")}`,
        });
    }
    next();
};

module.exports = roleMiddleware;
