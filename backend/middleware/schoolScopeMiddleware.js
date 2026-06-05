/**
 * schoolScopeMiddleware
 * Sets req.schoolId from the authenticated user's DB-verified school_id.
 * SUPER_ADMIN may optionally scope to a specific school via ?school_id= or body.school_id.
 * All non-SUPER_ADMIN roles are HARD-LOCKED to their own school_id — no overrides.
 */
const schoolScopeMiddleware = (req, res, next) => {
  if (!req.user)
    return res.status(401).json({ success: false, message: "Not authenticated." });

  if (req.user.role === "SUPER_ADMIN") {
    // SUPER_ADMIN can optionally filter by school
    const requested = req.query.school_id || req.body?.school_id || null;
    req.schoolId = requested || null; // null = all schools
  } else {
    // Everyone else is hard-locked — client-supplied school_id is completely ignored
    if (!req.user.school_id)
      return res.status(403).json({ success: false, message: "No school assigned to account." });
    req.schoolId = req.user.school_id;
  }
  next();
};

module.exports = schoolScopeMiddleware;
