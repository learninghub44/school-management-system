/**
 * /api/users — Staff account management
 * Isolation: school_id always from DB-verified JWT, never from request body/query
 * SUPER_ADMIN: cross-school access
 * PRINCIPAL/DEPUTY: own school only
 */
"use strict";
const express = require("express");
const bcrypt  = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const db        = require("../config/db");
const auth      = require("../middleware/authMiddleware");
const roleM     = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");
const validateUUID = require("../middleware/validateUUID");

const router = express.Router();
const MANAGE = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL"];

function getSchoolId(req) {
  if (req.user.role === "SUPER_ADMIN") return req.query.school_id || null;
  return req.user.school_id;
}

// ── GET /api/users ────────────────────────────────────────────────
router.get("/", auth, roleM([...MANAGE, "HOD"]), async (req, res) => {
  try {
    const sid = getSchoolId(req);
    if (!sid && req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({ success: false, message: "School isolation error." });

    let q = `SELECT u.id, u.username, u.email, u.name, u.phone, u.role,
                    u.is_active, u.must_change_password, u.last_login, u.created_at,
                    s.name AS school_name
             FROM users u
             LEFT JOIN schools s ON s.id = u.school_id
             WHERE u.role != 'SUPER_ADMIN'`;
    const p = [];
    if (sid)            { p.push(sid);          q += ` AND u.school_id=$${p.length}`; }
    if (req.query.role) { p.push(req.query.role); q += ` AND u.role=$${p.length}`; }
    q += " ORDER BY u.name";

    const { rows } = await db.query(q, p);
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/users/:id ────────────────────────────────────────────
router.get("/:id", auth, roleM([...MANAGE, "HOD"]), validateUUID("id"), async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, username, email, name, phone, role, is_active, last_login, created_at, school_id FROM users WHERE id=$1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "User not found." });
    // School isolation
    if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── POST /api/users — create staff account ───────────────────────
router.post("/", auth, roleM(MANAGE),
  [
    body("username").trim().notEmpty()
      .matches(/^[a-zA-Z0-9._-]{3,50}$/)
      .withMessage("Username: 3–50 chars, letters/numbers/._- only"),
    body("email").isEmail().normalizeEmail(),
    body("name").trim().notEmpty().isLength({ max: 150 }),
    body("password")
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage("Min 8 chars, must include uppercase, lowercase, and number"),
    body("role").isIn(["PRINCIPAL", "DEPUTY_PRINCIPAL", "HOD", "TEACHER", "BURSAR"])
      .withMessage("Invalid role"),
    body("phone").optional().matches(/^\+?[\d\s\-]{7,20}$/),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });
    try {
      // school_id: SUPER_ADMIN may pass body.school_id; everyone else locked to JWT
      const sid = req.user.role === "SUPER_ADMIN"
        ? req.body.school_id
        : req.user.school_id;
      if (!sid)
        return res.status(400).json({ success: false, message: "school_id required." });

      // PRINCIPAL cannot create another PRINCIPAL (avoid privilege escalation)
      if (req.user.role === "PRINCIPAL" && req.body.role === "PRINCIPAL")
        return res.status(403).json({ success: false, message: "PRINCIPAL cannot create another PRINCIPAL." });

      const { username, email, name, password, role, phone } = req.body;

      const dup = await db.query(
        "SELECT id FROM users WHERE username=$1 OR email=$2", [username, email]
      );
      if (dup.rows.length)
        return res.status(409).json({ success: false, message: "Username or email already taken." });

      const hash = await bcrypt.hash(password, 12);
      const { rows } = await db.query(
        `INSERT INTO users (school_id, username, email, password_hash, name, phone, role)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, username, email, name, phone, role, is_active, created_at`,
        [sid, username, email, hash, name, phone || null, role]
      );
      await audit(req, "CREATE_USER", "users", rows[0].id, null, { username, email, role });
      return res.status(201).json({ success: true, message: "Staff account created.", data: rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── PUT /api/users/:id ────────────────────────────────────────────
router.put("/:id", auth, roleM(MANAGE), validateUUID("id"),
  [
    body("name").optional().trim().isLength({ max: 150 }),
    body("phone").optional().matches(/^\+?[\d\s\-]{7,20}$/),
    body("role").optional().isIn(["PRINCIPAL", "DEPUTY_PRINCIPAL", "HOD", "TEACHER", "BURSAR"]),
    body("is_active").optional().isBoolean(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const { rows: ex } = await db.query(
        "SELECT * FROM users WHERE id=$1", [req.params.id]
      );
      if (!ex.length) return res.status(404).json({ success: false, message: "User not found." });
      if (req.user.role !== "SUPER_ADMIN" && ex[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });

      // Cannot demote/modify SUPER_ADMIN
      if (ex[0].role === "SUPER_ADMIN")
        return res.status(403).json({ success: false, message: "Cannot modify SUPER_ADMIN." });

      const { name, phone, role, is_active } = req.body;
      const { rows } = await db.query(
        `UPDATE users SET
           name      = COALESCE($1, name),
           phone     = COALESCE($2, phone),
           role      = COALESCE($3, role),
           is_active = COALESCE($4, is_active),
           updated_at = NOW()
         WHERE id = $5
         RETURNING id, username, email, name, phone, role, is_active`,
        [name || null, phone || null, role || null, is_active ?? null, req.params.id]
      );
      await audit(req, "UPDATE_USER", "users", req.params.id, ex[0], rows[0]);
      return res.json({ success: true, data: rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── POST /api/users/:id/reset-password ───────────────────────────
router.post("/:id/reset-password", auth, roleM(MANAGE), validateUUID("id"),
  [
    body("new_password")
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage("Min 8 chars, must include uppercase, lowercase, and number"),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const { rows } = await db.query(
        "SELECT school_id, role FROM users WHERE id=$1", [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ success: false, message: "User not found." });
      if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });
      if (rows[0].role === "SUPER_ADMIN")
        return res.status(403).json({ success: false, message: "Cannot reset SUPER_ADMIN password this way." });

      const hash = await bcrypt.hash(req.body.new_password, 12);
      await db.query(
        "UPDATE users SET password_hash=$1, must_change_password=TRUE, failed_login_attempts=0, locked_until=NULL WHERE id=$2",
        [hash, req.params.id]
      );
      await audit(req, "RESET_PASSWORD", "users", req.params.id);
      return res.json({ success: true, message: "Password reset. User must change on next login." });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── DELETE /api/users/:id — deactivate ───────────────────────────
router.delete("/:id", auth, roleM(MANAGE), validateUUID("id"), async (req, res) => {
  try {
    if (req.params.id === req.user.id)
      return res.status(400).json({ success: false, message: "Cannot deactivate your own account." });
    const { rows } = await db.query(
      "SELECT school_id, role FROM users WHERE id=$1", [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "User not found." });
    if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    if (rows[0].role === "SUPER_ADMIN")
      return res.status(403).json({ success: false, message: "Cannot deactivate SUPER_ADMIN." });

    await db.query(
      "UPDATE users SET is_active=FALSE, updated_at=NOW() WHERE id=$1", [req.params.id]
    );
    await audit(req, "DEACTIVATE_USER", "users", req.params.id);
    return res.json({ success: true, message: "User deactivated." });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
