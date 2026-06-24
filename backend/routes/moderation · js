"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const db   = require("../config/db");
const auth = require("../middleware/authMiddleware");
const roleM = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");

const router = express.Router();

const ADMIN_ROLES = ["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL"];

function schoolId(req) {
  return req.user.role === "SUPER_ADMIN" ? (req.query.school_id || req.body.school_id || null) : req.user.school_id;
}

// ── MODERATION ────────────────────────────────────────────────────

// GET /api/moderation?term=&academic_year=
router.get("/", auth, roleM(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD"]), async (req, res) => {
  try {
    const sid = schoolId(req);
    const p = [], where = [];
    if (sid)                    { p.push(sid);                    where.push(`m.school_id=$${p.length}`); }
    if (req.query.term)         { p.push(req.query.term);          where.push(`m.term=$${p.length}`); }
    if (req.query.academic_year){ p.push(req.query.academic_year); where.push(`m.academic_year=$${p.length}`); }

    const wc = where.length ? "WHERE " + where.join(" AND ") : "";
    const { rows } = await db.query(
      `SELECT m.*,
              c.grade||COALESCE(' '||c.stream,'') AS class_label,
              ul.name AS locked_by_name,
              um.name AS moderated_by_name
       FROM assessment_moderation m
       JOIN classes c ON c.id = m.class_id
       LEFT JOIN users ul ON ul.id = m.locked_by
       LEFT JOIN users um ON um.id = m.moderated_by
       ${wc}
       ORDER BY c.grade, c.stream`, p
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST /api/moderation/:class_id/lock — lock or unlock a term's assessments
router.post("/:class_id/lock", auth, roleM(ADMIN_ROLES),
  [
    body("term").isInt({ min: 1, max: 3 }),
    body("academic_year").matches(/^\d{4}$/),
    body("is_locked").isBoolean(),
    body("notes").optional().trim().isLength({ max: 500 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

      const { term, academic_year, is_locked, notes } = req.body;
      const { rows } = await db.query(
        `INSERT INTO assessment_moderation
           (school_id, class_id, term, academic_year, is_locked, locked_by, locked_at, notes)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)
         ON CONFLICT (school_id, class_id, term, academic_year) DO UPDATE SET
           is_locked=$5, locked_by=$6, locked_at=NOW(), notes=COALESCE($7, assessment_moderation.notes)
         RETURNING *`,
        [sid, req.params.class_id, term, academic_year, is_locked, req.user.id, notes || null]
      );
      await audit(req, is_locked ? "LOCK_ASSESSMENTS" : "UNLOCK_ASSESSMENTS",
        "assessment_moderation", rows[0].id, null, { class_id: req.params.class_id, term, academic_year });
      return res.json({ success: true, data: rows[0], message: is_locked ? "Assessments locked." : "Assessments unlocked." });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// POST /api/moderation/:class_id/moderate — mark as moderated/approved
router.post("/:class_id/moderate", auth, roleM(ADMIN_ROLES),
  [
    body("term").isInt({ min: 1, max: 3 }),
    body("academic_year").matches(/^\d{4}$/),
    body("notes").optional().trim().isLength({ max: 500 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

      const { term, academic_year, notes } = req.body;
      const { rows } = await db.query(
        `INSERT INTO assessment_moderation
           (school_id, class_id, term, academic_year, is_locked, moderated_by, moderated_at, notes)
         VALUES ($1,$2,$3,$4,TRUE,$5,NOW(),$6)
         ON CONFLICT (school_id, class_id, term, academic_year) DO UPDATE SET
           moderated_by=$5, moderated_at=NOW(),
           notes=COALESCE($6, assessment_moderation.notes)
         RETURNING *`,
        [sid, req.params.class_id, term, academic_year, req.user.id, notes || null]
      );
      await audit(req, "MODERATE_ASSESSMENTS", "assessment_moderation", rows[0].id, null,
        { class_id: req.params.class_id, term, academic_year });
      return res.json({ success: true, data: rows[0], message: "Term results approved." });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── ACADEMIC YEARS ────────────────────────────────────────────────

// GET /api/moderation/academic-years
router.get("/academic-years", auth, roleM(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD"]), async (req, res) => {
  try {
    const sid = schoolId(req);
    const p = [], where = [];
    if (sid) { p.push(sid); where.push(`school_id=$${p.length}`); }
    const wc = where.length ? "WHERE " + where.join(" AND ") : "";
    const { rows } = await db.query(`SELECT * FROM academic_years ${wc} ORDER BY year_label DESC`, p);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST /api/moderation/academic-years
router.post("/academic-years", auth, roleM(ADMIN_ROLES),
  [
    body("year_label").trim().notEmpty().isLength({ max: 9 }),
    body("start_date").optional().isDate(),
    body("end_date").optional().isDate(),
    body("is_current").optional().isBoolean(),
    body("term1_start").optional().isDate(),
    body("term1_end").optional().isDate(),
    body("term2_start").optional().isDate(),
    body("term2_end").optional().isDate(),
    body("term3_start").optional().isDate(),
    body("term3_end").optional().isDate(),
    body("notes").optional().trim().isLength({ max: 500 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

      const { year_label, start_date, end_date, is_current,
              term1_start, term1_end, term2_start, term2_end,
              term3_start, term3_end, notes } = req.body;

      // If marking as current, clear others first
      if (is_current) {
        await db.query("UPDATE academic_years SET is_current=FALSE WHERE school_id=$1", [sid]);
      }

      const { rows } = await db.query(
        `INSERT INTO academic_years
           (school_id, year_label, start_date, end_date, is_current,
            term1_start, term1_end, term2_start, term2_end,
            term3_start, term3_end, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (school_id, year_label) DO UPDATE SET
           start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date,
           is_current=EXCLUDED.is_current,
           term1_start=EXCLUDED.term1_start, term1_end=EXCLUDED.term1_end,
           term2_start=EXCLUDED.term2_start, term2_end=EXCLUDED.term2_end,
           term3_start=EXCLUDED.term3_start, term3_end=EXCLUDED.term3_end,
           notes=EXCLUDED.notes
         RETURNING *`,
        [sid, year_label, start_date || null, end_date || null, is_current || false,
         term1_start || null, term1_end || null, term2_start || null, term2_end || null,
         term3_start || null, term3_end || null, notes || null]
      );
      await audit(req, "UPSERT_ACADEMIC_YEAR", "academic_years", rows[0].id, null, { year_label });
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      console.error("academic year:", err.message);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── BULK OPERATIONS ────────────────────────────────────────────────

// POST /api/moderation/bulk-assess — bulk assessment entry
router.post("/bulk-assess", auth, roleM(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD","TEACHER"]),
  [
    body("entries").isArray({ min: 1, max: 200 }),
    body("entries.*.student_id").notEmpty().isUUID(),
    body("entries.*.learning_area_id").isInt({ min: 1 }),
    body("entries.*.achievement_level").isIn(["EE","ME","AE","BE"]),
    body("entries.*.term").isInt({ min: 1, max: 3 }),
    body("entries.*.academic_year").matches(/^\d{4}$/),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

      const { entries } = req.body;
      let inserted = 0, errors = [];

      for (const e of entries) {
        try {
          // Check moderation lock
          if (e.class_id) {
            const { rows: lock } = await db.query(
              "SELECT is_locked FROM assessment_moderation WHERE school_id=$1 AND class_id=$2 AND term=$3 AND academic_year=$4",
              [sid, e.class_id, e.term, e.academic_year]
            );
            if (lock.length && lock[0].is_locked) {
              errors.push({ student_id: e.student_id, reason: "Term is locked for moderation." });
              continue;
            }
          }
          await db.query(
            `INSERT INTO assessments
               (school_id, student_id, class_id, learning_area_id, strand, sub_strand,
                score, achievement_level, teacher_comment, assessment_type, term, academic_year)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (school_id, student_id, learning_area_id, assessment_type, term, academic_year)
             DO UPDATE SET
               achievement_level=EXCLUDED.achievement_level,
               score=EXCLUDED.score,
               teacher_comment=EXCLUDED.teacher_comment,
               strand=EXCLUDED.strand,
               sub_strand=EXCLUDED.sub_strand`,
            [sid, e.student_id, e.class_id || null, e.learning_area_id,
             e.strand || null, e.sub_strand || null,
             e.score || null, e.achievement_level,
             e.teacher_comment || null, e.assessment_type || "Formative",
             e.term, e.academic_year]
          );
          inserted++;
        } catch (rowErr) {
          errors.push({ student_id: e.student_id, reason: rowErr.message });
        }
      }
      await audit(req, "BULK_ASSESS", "assessments", null, null, { inserted, errors: errors.length });
      return res.json({ success: true, inserted, errors });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// POST /api/moderation/bulk-promote — bulk learner promotion
router.post("/bulk-promote", auth, roleM(ADMIN_ROLES),
  [
    body("student_ids").isArray({ min: 1, max: 500 }),
    body("student_ids.*").isUUID(),
    body("target_grade").trim().notEmpty(),
    body("academic_year").matches(/^\d{4}$/),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

      // Find or create target class
      const { rows: targetClass } = await db.query(
        "SELECT id FROM classes WHERE school_id=$1 AND grade=$2 AND academic_year=$3 LIMIT 1",
        [sid, req.body.target_grade, req.body.academic_year]
      );
      if (!targetClass.length)
        return res.status(400).json({ success: false, message: `No class found for ${req.body.target_grade} in ${req.body.academic_year}.` });

      const classId = targetClass[0].id;
      let promoted = 0;
      for (const studentId of req.body.student_ids) {
        await db.query(
          "UPDATE students SET class_id=$1 WHERE id=$2 AND school_id=$3",
          [classId, studentId, sid]
        );
        promoted++;
      }
      await audit(req, "BULK_PROMOTE", "students", null, null,
        { promoted, target_grade: req.body.target_grade, academic_year: req.body.academic_year });
      return res.json({ success: true, promoted, message: `${promoted} learner(s) promoted to ${req.body.target_grade}.` });
    } catch (err) {
      console.error("bulk promote:", err.message);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

module.exports = router;
