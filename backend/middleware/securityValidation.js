/**
 * Security Validation Middleware
 * Comprehensive input validation and sanitization
 */

const { body, param, query, validationResult } = require("express-validator");

/**
 * Validate and sanitize common fields
 */
const validators = {
  // Email validation
  email: () => body("email")
    .isEmail().withMessage("Invalid email format")
    .normalizeEmail()
    .trim(),

  // Password validation (strong)
  password: () => body("password")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
    .matches(/[A-Z]/).withMessage("Password must contain uppercase letter")
    .matches(/[a-z]/).withMessage("Password must contain lowercase letter")
    .matches(/[0-9]/).withMessage("Password must contain number")
    .matches(/[!@#$%^&*]/).withMessage("Password must contain special character"),

  // Name validation
  name: (field = "name") => body(field)
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage(`${field} must be 2-100 characters`)
    .matches(/^[a-zA-Z\s'-]+$/).withMessage(`${field} contains invalid characters`),

  // Phone validation (E.164 format)
  phone: () => body("phone")
    .matches(/^\+?[1-9]\d{1,14}$/).withMessage("Invalid phone number format"),

  // ID number validation (Kenya)
  nationalId: () => body("national_id")
    .matches(/^\d{1,8}$/).withMessage("Invalid national ID format"),

  // Admission number
  admissionNo: () => body("admission_no")
    .trim()
    .isLength({ min: 3, max: 20 }).withMessage("Invalid admission number")
    .matches(/^[A-Z0-9\-\/]+$/).withMessage("Admission number contains invalid characters"),

  // Amount validation
  amount: (field = "amount") => body(field)
    .isFloat({ min: 0.01, max: 999999999 }).withMessage("Invalid amount"),

  // Date validation
  date: (field = "date") => body(field)
    .isISO8601().withMessage(`${field} must be valid ISO date`),

  // ID parameter validation
  idParam: () => param("id")
    .isInt({ min: 1 }).withMessage("Invalid ID"),

  // School ID validation
  schoolId: () => query("school_id")
    .optional()
    .isInt({ min: 1 }).withMessage("Invalid school ID"),

  // Pagination
  pagination: () => [
    query("page").optional().isInt({ min: 1 }).withMessage("Invalid page"),
    query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Invalid limit")
  ],
};

/**
 * Middleware to handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      errors: errors.array().map(e => ({ field: e.param, message: e.msg }))
    });
  }
  next();
};

/**
 * Sanitize user input to prevent XSS
 */
const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj !== "object" || obj === null) return obj;
    
    for (let key in obj) {
      if (typeof obj[key] === "string") {
        // Remove potentially dangerous characters
        obj[key] = obj[key]
          .replace(/[<>\"']/g, "")
          .trim();
      } else if (typeof obj[key] === "object") {
        sanitize(obj[key]);
      }
    }
  };

  sanitize(req.body);
  sanitize(req.query);
  next();
};

/**
 * Validate school isolation
 */
const validateSchoolIsolation = (req, res, next) => {
  const { role, school_id } = req.user;
  
  // SUPER_ADMIN can specify any school
  if (role === "SUPER_ADMIN") {
    const requestedSchool = req.body?.school_id || req.query?.school_id;
    if (requestedSchool && !Number.isInteger(parseInt(requestedSchool))) {
      return res.status(400).json({ success: false, message: "Invalid school ID" });
    }
    return next();
  }

  // Other roles must use their own school
  if (req.body?.school_id && req.body.school_id !== school_id) {
    return res.status(403).json({ success: false, message: "Cannot modify other schools" });
  }

  // Ensure school_id is set in body for non-SUPER_ADMIN
  if (!req.body?.school_id) {
    req.body.school_id = school_id;
  }

  next();
};

/**
 * Validate role-based access
 */
const validateRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Insufficient permissions" });
    }
    next();
  };
};

/**
 * Rate limiting per user (in-memory — use Redis in high-scale production)
 * Uses a Map with periodic cleanup to prevent unbounded memory growth.
 */
const userRateLimit = (maxRequests = 100, windowMs = 60000) => {
  const userRequests = new Map();

  // Periodically purge expired entries to prevent memory leak
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, data] of userRequests.entries()) {
      if (now > data.resetTime) userRequests.delete(key);
    }
  }, windowMs * 2);
  // Don't hold process open for this interval
  if (cleanup.unref) cleanup.unref();

  return (req, res, next) => {
    const userId = req.user?.id;
    if (!userId) return next();

    const now = Date.now();
    let userData = userRequests.get(userId);

    if (!userData || now > userData.resetTime) {
      userData = { count: 0, resetTime: now + windowMs };
      userRequests.set(userId, userData);
    }

    userData.count++;

    if (userData.count > maxRequests) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later."
      });
    }

    next();
  };
};

/**
 * Validate data ownership before modification
 */
const validateOwnership = async (Model, idParam, ownerField, db) => {
  return async (req, res, next) => {
    const id = req.params[idParam];
    const { school_id, role, id: userId } = req.user;

    const { rows } = await db.query(
      `SELECT ${ownerField} FROM ${Model} WHERE id=$1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Resource not found" });
    }

    const ownerId = rows[0][ownerField];

    // Check ownership
    if (role !== "SUPER_ADMIN" && ownerId !== userId && ownerId !== school_id) {
      return res.status(403).json({ success: false, message: "Cannot modify this resource" });
    }

    next();
  };
};

module.exports = {
  validators,
  handleValidationErrors,
  sanitizeInput,
  validateSchoolIsolation,
  validateRole,
  userRateLimit,
  validateOwnership,
};
