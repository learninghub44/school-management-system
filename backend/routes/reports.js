/**
 * /api/reports — Report cards, dashboard, timetable
 * Fixes: timetable school isolation, report card write permission scoping
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
  if (req.user.role === "SUPER_ADMIN") return req.query.school_id || null;
  return req.user.school_id;
}

// ── GET /api/reports/dashboard ────────────────────────────────────
router.get("/dashboard",
  auth,
  roleM(["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL", "HOD", "BURSAR"]),
  async (req, res) => {
    try {
      const schoolId = getSchoolId(req);
      if (!schoolId)
        return res.status(400).json({ success: false, message: "school_id required." });
      const year = req.query.academic_year || new Date().getFullYear().toString();

      const [s, t, c, a, as_, f] = await Promise.all([
        db.query("SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE gender='Male') AS male, COUNT(*) FILTER(WHERE gender='Female') AS female FROM students WHERE school_id=$1 AND is_active=TRUE", [schoolId]),
        db.query("SELECT COUNT(*) AS total FROM teachers WHERE school_id=$1 AND is_active=TRUE", [schoolId]),
        db.query("SELECT COUNT(*) AS total FROM classes WHERE school_id=$1 AND academic_year=$2", [schoolId, year]),
        db.query("SELECT COUNT(*) FILTER(WHERE status='Present') AS present, COUNT(*) FILTER(WHERE status='Absent') AS absent, COUNT(*) AS total FROM attendance WHERE school_id=$1 AND date >= CURRENT_DATE - 7", [schoolId]),
        db.query("SELECT achievement_level, COUNT(*) AS count FROM assessments WHERE school_id=$1 AND academic_year=$2 GROUP BY achievement_level", [schoolId, year]),
        db.query("SELECT COALESCE(SUM(amount_paid),0) AS collected, COALESCE(SUM(balance),0) AS balance FROM payments WHERE school_id=$1 AND academic_year=$2", [schoolId, year]),
      ]);
      return res.json({
        success: true,
        data: {
          students:             s.rows[0],
          teachers:             t.rows[0],
          classes:              c.rows[0],
          attendance_week:      a.rows[0],
          assessments_by_level: as_.rows,
          finance:              f.rows[0],
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── GET /api/reports/cards ────────────────────────────────────────
router.get("/cards",
  auth,
  roleM(["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL", "HOD", "TEACHER"]),
  async (req, res) => {
    try {
      const schoolId = getSchoolId(req);
      if (!schoolId && req.user.role !== "SUPER_ADMIN")
        return res.status(403).json({ success: false, message: "School isolation error." });

      const p = [], where = [];
      if (schoolId)             { p.push(schoolId);              where.push(`rc.school_id=$${p.length}`); }
      if (req.query.student_id) { p.push(req.query.student_id);  where.push(`rc.student_id=$${p.length}`); }
      if (req.query.term)       { p.push(req.query.term);         where.push(`rc.term=$${p.length}`); }
      if (req.query.academic_year) { p.push(req.query.academic_year); where.push(`rc.academic_year=$${p.length}`); }
      if (req.query.class_id)   { p.push(req.query.class_id);    where.push(`rc.class_id=$${p.length}`); }

      const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
      const { rows } = await db.query(
        `SELECT rc.*,
                CONCAT(s.first_name,' ',s.last_name) AS student_name,
                s.admission_number, s.gender,
                CONCAT(c.grade, COALESCE(' '||c.stream,'')) AS class_label,
                u.name AS generated_by_name
         FROM report_cards rc
         JOIN students s ON s.id = rc.student_id
         JOIN classes c ON c.id = rc.class_id
         LEFT JOIN users u ON u.id = rc.generated_by
         ${whereClause}
         ORDER BY rc.academic_year DESC, rc.term DESC`, p
      );
      return res.json({ success: true, data: rows });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── POST /api/reports/cards — generate/upsert ─────────────────────
// Restricted to PRINCIPAL/DEPUTY_PRINCIPAL (not TEACHER/HOD — they read only)
router.post("/cards",
  auth,
  roleM(["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL"]),
  [
    body("student_id").notEmpty().isUUID(),
    body("class_id").notEmpty().isInt({ min: 1 }),
    body("term").isInt({ min: 1, max: 3 }),
    body("academic_year").matches(/^\d{4}$/),
    body("class_teacher_remark").optional().trim().isLength({ max: 1000 }),
    body("principal_remark").optional().trim().isLength({ max: 1000 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });

    try {
      const schoolId = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!schoolId)
        return res.status(400).json({ success: false, message: "school_id required." });

      // Verify student belongs to school
      const { rows: st } = await db.query(
        "SELECT school_id FROM students WHERE id=$1", [req.body.student_id]
      );
      if (!st.length)
        return res.status(404).json({ success: false, message: "Student not found." });
      if (req.user.role !== "SUPER_ADMIN" && st[0].school_id !== schoolId)
        return res.status(403).json({ success: false, message: "Student not in your school." });

      // Verify class belongs to school
      const { rows: cls } = await db.query(
        "SELECT school_id FROM classes WHERE id=$1", [req.body.class_id]
      );
      if (!cls.length || (req.user.role !== "SUPER_ADMIN" && cls[0].school_id !== schoolId))
        return res.status(400).json({ success: false, message: "Invalid class." });

      const { student_id, class_id, term, academic_year, class_teacher_remark, principal_remark } = req.body;
      const { rows } = await db.query(
        `INSERT INTO report_cards
         (school_id, student_id, class_id, term, academic_year, class_teacher_remark, principal_remark, generated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (school_id, student_id, term, academic_year)
         DO UPDATE SET
           class_teacher_remark = EXCLUDED.class_teacher_remark,
           principal_remark     = EXCLUDED.principal_remark,
           generated_by         = EXCLUDED.generated_by,
           generated_date       = NOW()
         RETURNING *`,
        [schoolId, student_id, class_id, term, academic_year,
         class_teacher_remark || null, principal_remark || null, req.user.id]
      );
      await audit(req, "GENERATE_REPORT_CARD", "report_cards", rows[0].id, null,
        { student_id, term, academic_year });
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── POST /api/reports/cards/:id/publish ──────────────────────────
router.post("/cards/:id/publish",
  auth,
  roleM(["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL"]),
  async (req, res) => {
    try {
      const { rows: ex } = await db.query(
        "SELECT * FROM report_cards WHERE id=$1", [req.params.id]
      );
      if (!ex.length)
        return res.status(404).json({ success: false, message: "Report card not found." });
      if (req.user.role !== "SUPER_ADMIN" && ex[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });

      await db.query("UPDATE report_cards SET is_published=TRUE WHERE id=$1", [req.params.id]);
      await audit(req, "PUBLISH_REPORT_CARD", "report_cards", req.params.id);
      return res.json({ success: true, message: "Report card published." });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── GET /api/reports/timetable ─────────────────────────────────────
// FIX: was completely missing school isolation guard for non-SUPER_ADMIN
router.get("/timetable", auth, async (req, res) => {
  try {
    const schoolId = getSchoolId(req);
    // Hard guard: non-SUPER_ADMIN must always be scoped
    if (!schoolId && req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({ success: false, message: "School isolation error." });

    const p = [], where = [];
    if (schoolId)               { p.push(schoolId);            where.push(`tt.school_id=$${p.length}`); }
    if (req.query.class_id)     { p.push(req.query.class_id);  where.push(`tt.class_id=$${p.length}`); }
    if (req.query.teacher_id)   { p.push(req.query.teacher_id);where.push(`tt.teacher_id=$${p.length}`); }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    const { rows } = await db.query(
      `SELECT tt.*, la.name AS subject_name,
              CONCAT(t.first_name,' ',t.last_name) AS teacher_name,
              CONCAT(c.grade, COALESCE(' '||c.stream,'')) AS class_label
       FROM timetable tt
       JOIN learning_areas la ON la.id = tt.learning_area_id
       LEFT JOIN teachers t ON t.id = tt.teacher_id
       JOIN classes c ON c.id = tt.class_id
       ${whereClause}
       ORDER BY
         CASE tt.day WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3
           WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 END,
         tt.start_time`, p
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── POST /api/reports/timetable ───────────────────────────────────
router.post("/timetable",
  auth,
  roleM(["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL"]),
  [
    body("class_id").notEmpty().isInt({ min: 1 }),
    body("learning_area_id").notEmpty().isInt({ min: 1 }),
    body("day").isIn(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]),
    body("start_time").matches(/^\d{2}:\d{2}$/).withMessage("Format HH:MM"),
    body("end_time").matches(/^\d{2}:\d{2}$/).withMessage("Format HH:MM"),
    body("academic_year").matches(/^\d{4}$/),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });

    try {
      const schoolId = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!schoolId)
        return res.status(400).json({ success: false, message: "school_id required." });

      // Verify class belongs to school
      const { rows: cls } = await db.query(
        "SELECT school_id FROM classes WHERE id=$1", [req.body.class_id]
      );
      if (!cls.length || (req.user.role !== "SUPER_ADMIN" && cls[0].school_id !== schoolId))
        return res.status(400).json({ success: false, message: "Invalid class." });

      const { class_id, learning_area_id, teacher_id, day, start_time, end_time, academic_year } = req.body;
      const { rows } = await db.query(
        `INSERT INTO timetable
         (school_id, class_id, learning_area_id, teacher_id, day, start_time, end_time, academic_year)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [schoolId, class_id, learning_area_id, teacher_id || null, day, start_time, end_time, academic_year]
      );
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      if (err.code === "23505")
        return res.status(409).json({ success: false, message: "Timetable slot already exists." });
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── DELETE /api/reports/timetable/:id ────────────────────────────
router.delete("/timetable/:id",
  auth,
  roleM(["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL"]),
  async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT school_id FROM timetable WHERE id=$1", [req.params.id]
      );
      if (!rows.length)
        return res.status(404).json({ success: false, message: "Not found." });
      if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });
      await db.query("DELETE FROM timetable WHERE id=$1", [req.params.id]);
      return res.json({ success: true, message: "Slot deleted." });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

module.exports = router;
