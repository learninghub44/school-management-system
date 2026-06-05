/**
 * Tenant Isolation Middleware — ZETU CBC School ERP
 * Enforces strict school_id isolation on every route.
 * school_id is ALWAYS from JWT — never from request body/query.
 */
const tenantIsolation = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Not authenticated." });

  const { role, school_id } = req.user;

  if (role === "SUPER_ADMIN") {
    req.tenantId = req.query.school_id || req.body?.school_id || null;
  } else {
    if (!school_id)
      return res.status(403).json({ success: false, message: "No school assigned. Contact support." });

    // Block body school_id that doesn't match JWT
    const bodySchoolId = req.body?.school_id;
    if (bodySchoolId && bodySchoolId !== school_id)
      return res.status(403).json({ success: false, message: "Tenant boundary violation." });

    req.tenantId = school_id;
  }
  next();
};

const assertOwnership = (res, recordSchoolId, tenantId) => {
  if (!tenantId) return true; // SUPER_ADMIN global view
  if (recordSchoolId !== tenantId) {
    res.status(403).json({ success: false, message: "Access denied. Record belongs to another school." });
    return false;
  }
  return true;
};

module.exports = { tenantIsolation, assertOwnership };
