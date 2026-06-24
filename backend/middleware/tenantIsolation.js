/**
 * Tenant Isolation Middleware — ZETU Kadem & Zetu School Management System
 * Enforces strict school_id isolation on every route.
 * school_id is ALWAYS from JWT — never from request body/query.
 */
const UUID_TENANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tenantIsolation = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Not authenticated." });

  const { role, school_id } = req.user;

  if (role === "SUPER_ADMIN") {
    const requested = req.query.school_id || req.body?.school_id || null;
    // Validate format if provided — prevents injection via school_id param
    if (requested && !UUID_TENANT.test(requested))
      return res.status(400).json({ success: false, message: "Invalid school_id format." });
    req.tenantId = requested;
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
