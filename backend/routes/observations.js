"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const db   = require("../config/db");
const auth = require("../middleware/authMiddleware");
const roleM = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");

const router = express.Router();
const validateUUID = require("../middleware/validateUUID");

const OBS_TYPES = ["Behaviour","Skill Development","Participation","Social Interaction","Leadership","General"];
const READ_ROLES  = ["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD","TEACHER"];
const WRITE_ROLES = ["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD","TEACHER"];

function schoolId(req) {
  return req.user.role === "SUPER_ADMIN" ? (req.query.school_id || req.body.school_id || null) : req.user.school_id;
}

// GET /api/observations?student_id=&class_id=&term=&academic_year=&type=
router.get("/", auth, roleM(READ_ROLES), async (req, res) => {
  try {
    const sid = schoolId(req);
    const p = [], where = [];
    if (sid)                    { p.push(sid);                    where.push(`o.school_id=$${p.length}`); }
    if (req.query.student_id)   { p.push(req.query.student_id);   where.push(`o.student_id=$${p.length}`); }
    if (req.query.class_id)     { p.push(req.query.class_id);     where.push(`o.class_id=$${p.length}`); }
    if (req.query.term)         { p.push(req.query.term);          where.push(`o.term=$${p.length}`); }
    if (req.query.academic_year){ p.push(req.query.academic_year); where.push(`o.academic_year=$${p.length}`); }
    if (req.query.observation_type){ p.push(req.query.observation_type); where.push(`o.observation_type=$${p.length}`); }

    const wc = where.length ? "WHERE " + where.join(" AND ") : "";
    const { rows } = await db.query(
      `SELECT o.*,
              s.first_name||' '||s.last_name AS student_name,
              s.admission_number,
              t.first_name||' '||t.last_name AS teacher_name,
              c.grade||COALESCE(' '||c.stream,'') AS class_label
       FROM teacher_observations o
       JOIN students s ON s.id = o.student_id
       JOIN teachers t ON t.id = o.teacher_id
       LEFT JOIN classes c ON c.id = o.class_id
       ${wc}
       ORDER BY o.observation_date DESC, o.created_at DESC`, p
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("observations GET:", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST /api/observations
router.post("/", auth, roleM(WRITE_ROLES),
  [
    body("student_id").notEmpty().isUUID(),
    body("observation_type").isIn(OBS_TYPES),
    body("notes").trim().notEmpty().isLength({ max: 3000 }),
    body("observation_date").optional().isDate(),
    body("class_id").optional().isInt({ min: 1 }),
    body("term").optional().isInt({ min: 1, max: 3 }),
    body("academic_year").optional().matches(/^\d{4}$/),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

      // Resolve teacher_id from logged-in user
      let teacher_id = req.body.teacher_id || null;
      if (!teacher_id) {
        const { rows: tr } = await db.query("SELECT id FROM teachers WHERE user_id=$1", [req.user.id]);
        if (tr.length) teacher_id = tr[0].id;
      }
      if (!teacher_id) return res.status(400).json({ success: false, message: "Teacher record not found for this user." });

      const { student_id, observation_type, notes, observation_date, class_id, term, academic_year } = req.body;
      const { rows } = await db.query(
        `INSERT INTO teacher_observations
           (school_id, student_id, teacher_id, class_id, observation_date,
            observation_type, notes, term, academic_year)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [sid, student_id, teacher_id, class_id || null,
         observation_date || new Date().toISOString().slice(0,10),
         observation_type, notes, term || null, academic_year || null]
      );
      await audit(req, "CREATE_OBSERVATION", "teacher_observations", rows[0].id, null, { student_id, observation_type });
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      console.error("observations POST:", err.message);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// DELETE /api/observations/:id
router.delete("/:id", validateUUID("id"), auth, roleM(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD","TEACHER"]),
  async (req, res) => {
    try {
      const { rows } = await db.query("SELECT school_id FROM teacher_observations WHERE id=$1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, message: "Not found." });
      if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });
      await db.query("DELETE FROM teacher_observations WHERE id=$1", [req.params.id]);
      await audit(req, "DELETE_OBSERVATION", "teacher_observations", req.params.id);
      return res.json({ success: true, message: "Deleted." });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

module.exports = router;
