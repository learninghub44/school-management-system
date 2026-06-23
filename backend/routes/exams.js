/**
 * /api/exams — Exam scheduling
 * Roles: SUPER_ADMIN, PRINCIPAL, DEPUTY_PRINCIPAL, HOD, TEACHER (read)
 */
"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const db        = require("../config/db");
const auth      = require("../middleware/authMiddleware");
const roleM     = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");

const router = express.Router();

function getSchoolId(req) {
  if (req.user.role === "SUPER_ADMIN") return req.query.school_id || req.body.school_id || null;
  return req.user.school_id;
}

// ── GET /api/exams ────────────────────────────────────────────────
router.get("/", auth, roleM(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD","TEACHER","BURSAR"]),
  async (req, res) => {
    try {
      const schoolId = getSchoolId(req);
      if (!schoolId) return res.status(400).json({ success: false, message: "school_id required." });

      const p = [schoolId];
      let extra = "";
      if (req.query.term)          { p.push(req.query.term);          extra += ` AND term=$${p.length}`; }
      if (req.query.academic_year) { p.push(req.query.academic_year); extra += ` AND academic_year=$${p.length}`; }
      if (req.query.class_id)      { p.push(req.query.class_id);      extra += ` AND class_id=$${p.length}`; }

      const { rows } = await db.query(
        `SELECT e.*,
                CONCAT(c.grade, COALESCE(' '||c.stream,'')) AS class_label,
                la.name AS subject_name,
                CONCAT(t.first_name,' ',t.last_name) AS invigilator_name
         FROM exams e
         LEFT JOIN classes c ON c.id = e.class_id
         LEFT JOIN learning_areas la ON la.id = e.learning_area_id
         LEFT JOIN teachers t ON t.id = e.invigilator_id
         WHERE e.school_id=$1 ${extra}
         ORDER BY e.exam_date ASC, e.start_time ASC`, p
      );
      return res.json({ success: true, data: rows });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── POST /api/exams ───────────────────────────────────────────────
router.post("/", auth, roleM(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD"]),
  [
    body("title").notEmpty().trim().isLength({ max: 200 }),
    body("exam_date").isDate(),
    body("start_time").matches(/^\d{2}:\d{2}$/),
    body("end_time").matches(/^\d{2}:\d{2}$/),
    body("term").isInt({ min: 1, max: 3 }),
    body("academic_year").matches(/^\d{4}$/),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });

    try {
      const schoolId = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!schoolId) return res.status(400).json({ success: false, message: "school_id required." });

      const { title, exam_date, start_time, end_time, term, academic_year,
              class_id, learning_area_id, invigilator_id, venue, notes } = req.body;

      // Verify class belongs to school if provided
      if (class_id) {
        const { rows: cls } = await db.query(
          "SELECT school_id FROM classes WHERE id=$1", [class_id]
        );
        if (!cls.length || (req.user.role !== "SUPER_ADMIN" && cls[0].school_id !== schoolId))
          return res.status(400).json({ success: false, message: "Invalid class." });
      }

      // Verify invigilator belongs to school if provided
      if (invigilator_id) {
        const { rows: inv } = await db.query(
          "SELECT school_id FROM teachers WHERE id=$1", [invigilator_id]
        );
        if (!inv.length || (req.user.role !== "SUPER_ADMIN" && inv[0].school_id !== schoolId))
          return res.status(400).json({ success: false, message: "Invalid invigilator." });
      }

      const { rows } = await db.query(
        `INSERT INTO exams
         (school_id, title, exam_date, start_time, end_time, term, academic_year,
          class_id, learning_area_id, invigilator_id, venue, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [schoolId, title, exam_date, start_time, end_time, term, academic_year,
         class_id || null, learning_area_id || null, invigilator_id || null,
         venue || null, notes || null, req.user.id]
      );
      await audit(req, "CREATE_EXAM", "exams", rows[0].id, null, { title, exam_date });
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── PUT /api/exams/:id ────────────────────────────────────────────
router.put("/:id", auth, roleM(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD"]),
  [
    body("title").optional().trim().notEmpty().isLength({ max: 200 }),
    body("exam_date").optional().isDate(),
    body("start_time").optional().matches(/^\d{2}:\d{2}$/),
    body("end_time").optional().matches(/^\d{2}:\d{2}$/),
    body("term").optional().isInt({ min: 1, max: 3 }),
    body("academic_year").optional().matches(/^\d{4}$/),
    body("venue").optional().trim().isLength({ max: 200 }),
    body("notes").optional().trim().isLength({ max: 1000 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const { rows: ex } = await db.query("SELECT * FROM exams WHERE id=$1", [req.params.id]);
      if (!ex.length) return res.status(404).json({ success: false, message: "Exam not found." });
      if (req.user.role !== "SUPER_ADMIN" && ex[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });

      const { title, exam_date, start_time, end_time, term, academic_year,
              class_id, learning_area_id, invigilator_id, venue, notes } = req.body;

      // Verify class belongs to school if changing it
      if (class_id) {
        const { rows: cls } = await db.query("SELECT school_id FROM classes WHERE id=$1", [class_id]);
        if (!cls.length || (req.user.role !== "SUPER_ADMIN" && cls[0].school_id !== ex[0].school_id))
          return res.status(400).json({ success: false, message: "Invalid class." });
      }
      // Verify invigilator belongs to school if changing it
      if (invigilator_id) {
        const { rows: inv } = await db.query("SELECT school_id FROM teachers WHERE id=$1", [invigilator_id]);
        if (!inv.length || (req.user.role !== "SUPER_ADMIN" && inv[0].school_id !== ex[0].school_id))
          return res.status(400).json({ success: false, message: "Invalid invigilator." });
      }

      const { rows } = await db.query(
        `UPDATE exams SET
           title            = COALESCE($1,  title),
           exam_date        = COALESCE($2,  exam_date),
           start_time       = COALESCE($3,  start_time),
           end_time         = COALESCE($4,  end_time),
           term             = COALESCE($5,  term),
           academic_year    = COALESCE($6,  academic_year),
           class_id         = COALESCE($7,  class_id),
           learning_area_id = COALESCE($8,  learning_area_id),
           invigilator_id   = COALESCE($9,  invigilator_id),
           venue            = COALESCE($10, venue),
           notes            = COALESCE($11, notes),
           updated_at       = NOW()
         WHERE id=$12 RETURNING *`,
        [title||null, exam_date||null, start_time||null, end_time||null, term??null,
         academic_year||null, class_id||null, learning_area_id||null, invigilator_id||null,
         venue||null, notes||null, req.params.id]
      );
      await audit(req, "UPDATE_EXAM", "exams", req.params.id, ex[0], rows[0]);
      return res.json({ success: true, data: rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── DELETE /api/exams/:id ─────────────────────────────────────────
router.delete("/:id", auth, roleM(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL"]),
  async (req, res) => {
    try {
      const { rows } = await db.query("SELECT school_id FROM exams WHERE id=$1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, message: "Not found." });
      if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });
      await db.query("DELETE FROM exams WHERE id=$1", [req.params.id]);
      await audit(req, "DELETE_EXAM", "exams", req.params.id);
      return res.json({ success: true, message: "Exam deleted." });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

module.exports = router;
