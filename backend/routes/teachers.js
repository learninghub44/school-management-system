"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const db           = require("../config/db");
const auth         = require("../middleware/authMiddleware");
const roleM        = require("../middleware/roleMiddleware");
const { audit }    = require("../middleware/auditLog");
const validateUUID = require("../middleware/validateUUID");

const router = express.Router();
const MANAGE = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL"];
const READ   = [...MANAGE, "HOD", "TEACHER", "BURSAR"];

function getSchoolId(req) {
  if (req.user.role === "SUPER_ADMIN") return req.query.school_id || null;
  return req.user.school_id;
}

router.get("/", auth, roleM(READ), async (req, res) => {
  try {
    const sid = getSchoolId(req);
    if (!sid && req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({ success: false, message: "School isolation error." });
    let q = `SELECT t.*, d.name AS department_name, u.username, u.last_login
             FROM teachers t
             LEFT JOIN departments d ON d.id = t.department_id
             LEFT JOIN users u ON u.id = t.user_id
             WHERE 1=1`;
    const p = [];
    if (sid) { p.push(sid); q += ` AND t.school_id=$${p.length}`; }
    if (req.query.is_active !== undefined) { p.push(req.query.is_active === "true"); q += ` AND t.is_active=$${p.length}`; }
    if (req.query.department_id) { p.push(req.query.department_id); q += ` AND t.department_id=$${p.length}`; }
    if (req.query.user_id) { p.push(req.query.user_id); q += ` AND t.user_id=$${p.length}`; }
    if (req.query.search) {
      const search = req.query.search.replace(/[%_\\]/g, "\\$&").substring(0, 100);
      p.push(`%${search}%`);
      q += ` AND (t.first_name ILIKE $${p.length} OR t.last_name ILIKE $${p.length} OR t.tsc_number ILIKE $${p.length} OR t.email ILIKE $${p.length})`;
    }
    q += " ORDER BY t.last_name, t.first_name LIMIT 100";
    const { rows } = await db.query(q, p);
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (err) { return res.status(500).json({ success: false, message: "Server error." }); }
});

router.get("/:id", auth, roleM(READ), validateUUID("id"), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT t.*, d.name AS department_name, u.username, u.last_login
       FROM teachers t
       LEFT JOIN departments d ON d.id=t.department_id
       LEFT JOIN users u ON u.id=t.user_id
       WHERE t.id=$1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found." });
    if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    return res.json({ success: true, data: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, message: "Server error." }); }
});

router.post("/", auth, roleM(MANAGE),
  [
    body("first_name").trim().notEmpty().isLength({ max: 80 }),
    body("last_name").trim().notEmpty().isLength({ max: 80 }),
    body("phone").optional().matches(/^\+?[\d\s\-]{7,20}$/),
    body("email").optional().isEmail().normalizeEmail(),
    body("tsc_number").optional().trim().isLength({ max: 30 }),
    body("designation").optional().trim().isLength({ max: 100 }),
    body("user_id").optional().isUUID(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

      // If linking a user_id, verify user belongs to same school
      if (req.body.user_id) {
        const { rows: u } = await db.query("SELECT school_id FROM users WHERE id=$1", [req.body.user_id]);
        if (!u.length || (req.user.role !== "SUPER_ADMIN" && u[0].school_id !== sid))
          return res.status(400).json({ success: false, message: "Invalid user_id." });
      }

      const { first_name, last_name, phone, email, tsc_number, department_id, designation, user_id } = req.body;
      const { rows } = await db.query(
        `INSERT INTO teachers (school_id, first_name, last_name, phone, email, tsc_number, department_id, designation, user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [sid, first_name, last_name, phone||null, email||null, tsc_number||null, department_id||null, designation||null, user_id||null]
      );
      await audit(req, "CREATE_TEACHER", "teachers", rows[0].id, null, { first_name, last_name });
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ success: false, message: "TSC number already registered." });
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

router.put("/:id", auth, roleM(MANAGE), validateUUID("id"), async (req, res) => {
  try {
    const { rows: ex } = await db.query("SELECT * FROM teachers WHERE id=$1", [req.params.id]);
    if (!ex.length) return res.status(404).json({ success: false, message: "Not found." });
    if (req.user.role !== "SUPER_ADMIN" && ex[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    const { first_name, last_name, phone, email, tsc_number, department_id, designation, is_active, user_id } = req.body;
    const { rows } = await db.query(
      `UPDATE teachers SET
         first_name  = COALESCE($1, first_name),
         last_name   = COALESCE($2, last_name),
         phone       = COALESCE($3, phone),
         email       = COALESCE($4, email),
         tsc_number  = COALESCE($5, tsc_number),
         department_id = COALESCE($6, department_id),
         designation = COALESCE($7, designation),
         is_active   = COALESCE($8, is_active),
         user_id     = COALESCE($9, user_id),
         updated_at  = NOW()
       WHERE id=$10 RETURNING *`,
      [first_name||null, last_name||null, phone||null, email||null, tsc_number||null,
       department_id||null, designation||null, is_active??null, user_id||null, req.params.id]
    );
    await audit(req, "UPDATE_TEACHER", "teachers", req.params.id, ex[0], rows[0]);
    return res.json({ success: true, data: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, message: "Server error." }); }
});

router.delete("/:id", auth, roleM(MANAGE), validateUUID("id"), async (req, res) => {
  try {
    const { rows } = await db.query("SELECT school_id FROM teachers WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found." });
    if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    await db.query("UPDATE teachers SET is_active=FALSE, updated_at=NOW() WHERE id=$1", [req.params.id]);
    await audit(req, "DEACTIVATE_TEACHER", "teachers", req.params.id);
    return res.json({ success: true, message: "Teacher deactivated." });
  } catch (err) { return res.status(500).json({ success: false, message: "Server error." }); }
});

router.get("/:id/assignments", auth, roleM(READ), validateUUID("id"), async (req, res) => {
  try {
    const { rows: t } = await db.query("SELECT school_id FROM teachers WHERE id=$1", [req.params.id]);
    if (!t.length) return res.status(404).json({ success: false, message: "Not found." });
    if (req.user.role !== "SUPER_ADMIN" && t[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    const { rows } = await db.query(
      `SELECT ta.*, c.grade, c.stream, la.name AS subject_name, la.code AS subject_code
       FROM teacher_assignments ta
       JOIN classes c ON c.id=ta.class_id
       JOIN learning_areas la ON la.id=ta.learning_area_id
       WHERE ta.teacher_id=$1 AND ta.school_id=$2`,
      [req.params.id, t[0].school_id]
    );
    return res.json({ success: true, data: rows });
  } catch (err) { return res.status(500).json({ success: false, message: "Server error." }); }
});

module.exports = router;
