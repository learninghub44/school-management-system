/**
 * roleMiddleware — checks req.user.role (always DB-fresh from authMiddleware)
 */
"use strict";
module.exports = function roleMiddleware(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ success: false, message: "Not authenticated." });
    if (!allowedRoles.includes(req.user.role))
      return res.status(403).json({
        success: false,
        message: `Access denied. Allowed roles: ${allowedRoles.join(", ")}.`,
      });
    next();
  };
};
