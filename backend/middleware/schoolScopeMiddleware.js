/**
 * Attaches req.schoolId based on the authenticated user's school.
 * SUPER_ADMIN may pass ?school_id= or body.school_id to operate on a specific school.
 */
const schoolScopeMiddleware = (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authenticated." });

    if (req.user.role === "SUPER_ADMIN") {
        req.schoolId = req.query.school_id || req.body?.school_id || null;
    } else {
        if (!req.user.school_id)
            return res.status(403).json({ success: false, message: "No school assigned to account." });
        req.schoolId = req.user.school_id;
    }
    next();
};

module.exports = schoolScopeMiddleware;
