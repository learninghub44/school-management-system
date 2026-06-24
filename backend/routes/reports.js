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
    body("teacher_remark").optional().trim().isLength({ max: 1000 }),
    body("principal_remark").optional().trim().isLength({ max: 1000 }),
    body("headteacher_remark").optional().trim().isLength({ max: 1000 }),
    body("ai_remark").optional().trim().isLength({ max: 1000 }),
    // Core Competencies (1=Not Observed, 2=Developing, 3=Competent, 4=Exceptional)
    body("cc_communication").optional().isInt({ min: 1, max: 4 }),
    body("cc_critical_thinking").optional().isInt({ min: 1, max: 4 }),
    body("cc_creativity").optional().isInt({ min: 1, max: 4 }),
    body("cc_citizenship").optional().isInt({ min: 1, max: 4 }),
    body("cc_digital_literacy").optional().isInt({ min: 1, max: 4 }),
    body("cc_learning_to_learn").optional().isInt({ min: 1, max: 4 }),
    body("cc_self_efficacy").optional().isInt({ min: 1, max: 4 }),
    // Values (1=Needs Improvement, 2=Satisfactory, 3=Good, 4=Excellent)
    body("val_respect").optional().isInt({ min: 1, max: 4 }),
    body("val_responsibility").optional().isInt({ min: 1, max: 4 }),
    body("val_integrity").optional().isInt({ min: 1, max: 4 }),
    body("val_unity").optional().isInt({ min: 1, max: 4 }),
    body("val_peace").optional().isInt({ min: 1, max: 4 }),
    body("val_patriotism").optional().isInt({ min: 1, max: 4 }),
    body("val_social_justice").optional().isInt({ min: 1, max: 4 }),
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

      const {
        student_id, class_id, term, academic_year,
        class_teacher_remark, teacher_remark, principal_remark,
        headteacher_remark, ai_remark,
        cc_communication, cc_critical_thinking, cc_creativity,
        cc_citizenship, cc_digital_literacy, cc_learning_to_learn, cc_self_efficacy,
        val_respect, val_responsibility, val_integrity, val_unity,
        val_peace, val_patriotism, val_social_justice,
      } = req.body;

      const { rows } = await db.query(
        `INSERT INTO report_cards
         (school_id, student_id, class_id, term, academic_year,
          class_teacher_remark, teacher_remark, principal_remark,
          headteacher_remark, ai_remark,
          cc_communication, cc_critical_thinking, cc_creativity,
          cc_citizenship, cc_digital_literacy, cc_learning_to_learn, cc_self_efficacy,
          val_respect, val_responsibility, val_integrity, val_unity,
          val_peace, val_patriotism, val_social_justice,
          generated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         ON CONFLICT (school_id, student_id, term, academic_year)
         DO UPDATE SET
           class_teacher_remark = EXCLUDED.class_teacher_remark,
           teacher_remark       = EXCLUDED.teacher_remark,
           principal_remark     = EXCLUDED.principal_remark,
           headteacher_remark   = EXCLUDED.headteacher_remark,
           ai_remark            = EXCLUDED.ai_remark,
           cc_communication     = COALESCE(EXCLUDED.cc_communication,     report_cards.cc_communication),
           cc_critical_thinking = COALESCE(EXCLUDED.cc_critical_thinking, report_cards.cc_critical_thinking),
           cc_creativity        = COALESCE(EXCLUDED.cc_creativity,        report_cards.cc_creativity),
           cc_citizenship       = COALESCE(EXCLUDED.cc_citizenship,       report_cards.cc_citizenship),
           cc_digital_literacy  = COALESCE(EXCLUDED.cc_digital_literacy,  report_cards.cc_digital_literacy),
           cc_learning_to_learn = COALESCE(EXCLUDED.cc_learning_to_learn, report_cards.cc_learning_to_learn),
           cc_self_efficacy     = COALESCE(EXCLUDED.cc_self_efficacy,     report_cards.cc_self_efficacy),
           val_respect          = COALESCE(EXCLUDED.val_respect,          report_cards.val_respect),
           val_responsibility   = COALESCE(EXCLUDED.val_responsibility,   report_cards.val_responsibility),
           val_integrity        = COALESCE(EXCLUDED.val_integrity,        report_cards.val_integrity),
           val_unity            = COALESCE(EXCLUDED.val_unity,            report_cards.val_unity),
           val_peace            = COALESCE(EXCLUDED.val_peace,            report_cards.val_peace),
           val_patriotism       = COALESCE(EXCLUDED.val_patriotism,       report_cards.val_patriotism),
           val_social_justice   = COALESCE(EXCLUDED.val_social_justice,   report_cards.val_social_justice),
           generated_by         = EXCLUDED.generated_by,
           generated_date       = NOW()
         RETURNING *`,
        [schoolId, student_id, class_id, term, academic_year,
         class_teacher_remark || null, teacher_remark || null,
         principal_remark || null, headteacher_remark || null, ai_remark || null,
         cc_communication || null, cc_critical_thinking || null, cc_creativity || null,
         cc_citizenship || null, cc_digital_literacy || null,
         cc_learning_to_learn || null, cc_self_efficacy || null,
         val_respect || null, val_responsibility || null, val_integrity || null,
         val_unity || null, val_peace || null, val_patriotism || null,
         val_social_justice || null, req.user.id]
      );
      await audit(req, "GENERATE_REPORT_CARD", "report_cards", rows[0].id, null,
        { student_id, term, academic_year });
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      console.error("report card POST:", err.message);
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
router.get("/timetable", auth,
  roleM(["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL", "HOD", "TEACHER", "BURSAR"]),
  async (req, res) => {
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
  }
);

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

// ── GET /api/reports/analytics — CBC Analytics Dashboard ─────────
router.get("/analytics",
  auth,
  roleM(["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL", "HOD"]),
  async (req, res) => {
    try {
      const schoolId = getSchoolId(req);
      if (!schoolId)
        return res.status(400).json({ success: false, message: "school_id required." });
      const year = req.query.academic_year || new Date().getFullYear().toString();
      const term = req.query.term || null;

      const termFilter = term ? "AND a.term=$3" : "";
      const params     = term ? [schoolId, year, term] : [schoolId, year];

      const [byGrade, bySubject, competencies, atRisk] = await Promise.all([
        // Achievement by grade
        db.query(
          `SELECT c.grade,
                  COUNT(*) AS total,
                  COUNT(*) FILTER(WHERE a.achievement_level='EE') AS ee,
                  COUNT(*) FILTER(WHERE a.achievement_level='ME') AS me,
                  COUNT(*) FILTER(WHERE a.achievement_level='AE') AS ae,
                  COUNT(*) FILTER(WHERE a.achievement_level='BE') AS be
           FROM assessments a
           JOIN classes c ON c.id = a.class_id
           WHERE a.school_id=$1 AND a.academic_year=$2 ${termFilter}
           GROUP BY c.grade ORDER BY c.grade`, params
        ),
        // Achievement by subject/learning area
        db.query(
          `SELECT la.name AS subject,
                  COUNT(*) AS total,
                  COUNT(*) FILTER(WHERE a.achievement_level='EE') AS ee,
                  COUNT(*) FILTER(WHERE a.achievement_level='ME') AS me,
                  COUNT(*) FILTER(WHERE a.achievement_level='AE') AS ae,
                  COUNT(*) FILTER(WHERE a.achievement_level='BE') AS be,
                  ROUND(AVG(a.score) FILTER (WHERE a.score IS NOT NULL), 1) AS avg_score
           FROM assessments a
           JOIN learning_areas la ON la.id = a.learning_area_id
           WHERE a.school_id=$1 AND a.academic_year=$2 ${termFilter}
           GROUP BY la.name ORDER BY la.name`, params
        ),
        // Core competency averages from report cards
        db.query(
          `SELECT
             ROUND(AVG(NULLIF(cc_communication,    0))::NUMERIC, 2) AS communication,
             ROUND(AVG(NULLIF(cc_critical_thinking,0))::NUMERIC, 2) AS critical_thinking,
             ROUND(AVG(NULLIF(cc_creativity,       0))::NUMERIC, 2) AS creativity,
             ROUND(AVG(NULLIF(cc_citizenship,      0))::NUMERIC, 2) AS citizenship,
             ROUND(AVG(NULLIF(cc_digital_literacy, 0))::NUMERIC, 2) AS digital_literacy,
             ROUND(AVG(NULLIF(cc_learning_to_learn,0))::NUMERIC, 2) AS learning_to_learn,
             ROUND(AVG(NULLIF(cc_self_efficacy,    0))::NUMERIC, 2) AS self_efficacy
           FROM report_cards
           WHERE school_id=$1 AND academic_year=$2`,
          [schoolId, year]
        ),
        // At-risk students (mostly BE this term)
        db.query(
          `SELECT s.id, s.first_name||' '||s.last_name AS student_name,
                  s.admission_number,
                  c.grade||COALESCE(' '||c.stream,'') AS class_label,
                  COUNT(*) FILTER(WHERE a.achievement_level='BE') AS be_count,
                  COUNT(*) AS total_assessments
           FROM assessments a
           JOIN students s ON s.id = a.student_id
           JOIN classes  c ON c.id = a.class_id
           WHERE a.school_id=$1 AND a.academic_year=$2 ${termFilter}
           GROUP BY s.id, student_name, s.admission_number, class_label
           HAVING COUNT(*) FILTER(WHERE a.achievement_level='BE') >= 2
           ORDER BY be_count DESC LIMIT 20`, params
        ),
      ]);

      return res.json({
        success: true,
        data: {
          by_grade:       byGrade.rows,
          by_subject:     bySubject.rows,
          competencies:   competencies.rows[0],
          at_risk:        atRisk.rows,
        }
      });
    } catch (err) {
      console.error("analytics:", err.message);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── GET /api/reports/progress/:student_id — Student progress over time ──
router.get("/progress/:student_id",
  auth,
  roleM(["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL", "HOD", "TEACHER"]),
  async (req, res) => {
    try {
      const schoolId = getSchoolId(req);
      if (!schoolId && req.user.role !== "SUPER_ADMIN")
        return res.status(403).json({ success: false, message: "Access denied." });

      const sid = req.params.student_id;

      const [student, progress, competencies] = await Promise.all([
        db.query(
          `SELECT s.*, c.grade, c.stream FROM students s
           LEFT JOIN classes c ON c.id = s.class_id
           WHERE s.id=$1`, [sid]
        ),
        db.query(
          `SELECT a.academic_year, a.term, la.name AS subject,
                  a.achievement_level, a.score, a.strand
           FROM assessments a
           JOIN learning_areas la ON la.id = a.learning_area_id
           WHERE a.student_id=$1 ${schoolId ? "AND a.school_id=$2" : ""}
           ORDER BY a.academic_year, a.term, la.name`,
          schoolId ? [sid, schoolId] : [sid]
        ),
        db.query(
          `SELECT academic_year, term,
                  cc_communication, cc_critical_thinking, cc_creativity,
                  cc_citizenship, cc_digital_literacy, cc_learning_to_learn,
                  cc_self_efficacy
           FROM report_cards
           WHERE student_id=$1 ${schoolId ? "AND school_id=$2" : ""}
           ORDER BY academic_year, term`,
          schoolId ? [sid, schoolId] : [sid]
        ),
      ]);

      if (!student.rows.length)
        return res.status(404).json({ success: false, message: "Student not found." });

      return res.json({
        success: true,
        data: {
          student:      student.rows[0],
          assessments:  progress.rows,
          competencies: competencies.rows,
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

module.exports = router;
