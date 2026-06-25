/**
 * /api/assessments — CBC KICD assessments
 * Roles: SUPER_ADMIN, PRINCIPAL, DEPUTY_PRINCIPAL, HOD, TEACHER, BURSAR
 * BURSAR: NO ACCESS (finance only)
 * TEACHER: read/write scoped to own school only
 * All school isolation enforced from DB-verified req.user.school_id
 */
"use strict";
const express = require("express");
const { body, param, validationResult } = require("express-validator");
const db           = require("../config/db");
const auth         = require("../middleware/authMiddleware");
const roleM        = require("../middleware/roleMiddleware");
const { audit }    = require("../middleware/auditLog");
const validateUUID = require("../middleware/validateUUID");

const router = express.Router();

const VALID_LEVELS = ["EE", "ME", "AE", "BE"];
const VALID_TYPES  = ["Formative", "Summative", "Project", "Observation"];
const READ_ROLES   = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL", "HOD", "TEACHER"];
const WRITE_ROLES  = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL", "HOD", "TEACHER"];

// Helper: safe school scope for non-SUPER_ADMIN
function getSchoolId(req) {
  if (req.user.role === "SUPER_ADMIN") return req.query.school_id || null;
  return req.user.school_id; // always from DB, never client
}

// Helper: verify student belongs to school (prevents cross-tenant access)
async function assertStudentOwnership(studentId, schoolId, isSuperAdmin) {
  const { rows } = await db.query(
    "SELECT school_id FROM students WHERE id=$1", [studentId]
  );
  if (!rows.length) return { ok: false, code: 404, msg: "Student not found." };
  if (!isSuperAdmin && rows[0].school_id !== schoolId)
    return { ok: false, code: 403, msg: "Student does not belong to your school." };
  return { ok: true, schoolId: rows[0].school_id };
}

// ── GET /api/assessments ──────────────────────────────────────────
router.get("/", auth, roleM(READ_ROLES), async (req, res) => {
  try {
    const schoolId = getSchoolId(req);
    if (!schoolId && req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({ success: false, message: "School isolation error." });

    const p = [], where = [];

    // School scope — always applied for non-SUPER_ADMIN
    if (schoolId) { p.push(schoolId); where.push(`a.school_id=$${p.length}`); }

    // Optional filters (validated)
    if (req.query.student_id) {
      if (!/^[0-9a-f-]{36}$/i.test(req.query.student_id))
        return res.status(400).json({ success: false, message: "Invalid student_id format." });
      p.push(req.query.student_id); where.push(`a.student_id=$${p.length}`);
    }
    if (req.query.class_id) {
      if (!/^\d+$/.test(req.query.class_id))
        return res.status(400).json({ success: false, message: "Invalid class_id." });
      p.push(req.query.class_id); where.push(`a.class_id=$${p.length}`);
    }
    if (req.query.term) {
      const t = parseInt(req.query.term);
      if (![1,2,3].includes(t))
        return res.status(400).json({ success: false, message: "Invalid term." });
      p.push(t); where.push(`a.term=$${p.length}`);
    }
    if (req.query.academic_year) {
      if (!/^\d{4}$/.test(req.query.academic_year))
        return res.status(400).json({ success: false, message: "Invalid academic_year." });
      p.push(req.query.academic_year); where.push(`a.academic_year=$${p.length}`);
    }
    if (req.query.learning_area_id) {
      if (!/^\d+$/.test(req.query.learning_area_id))
        return res.status(400).json({ success: false, message: "Invalid learning_area_id." });
      p.push(req.query.learning_area_id); where.push(`a.learning_area_id=$${p.length}`);
    }

    // TEACHER: further restrict to own assigned classes only
    if (req.user.role === "TEACHER") {
      const { rows: tr } = await db.query(
        "SELECT id FROM teachers WHERE user_id=$1 AND school_id=$2",
        [req.user.id, schoolId]
      );
      if (!tr.length) return res.json({ success: true, data: [], count: 0 });
      const { rows: assigned } = await db.query(
        "SELECT DISTINCT class_id FROM teacher_assignments WHERE teacher_id=$1 AND school_id=$2",
        [tr[0].id, schoolId]
      );
      if (!assigned.length) return res.json({ success: true, data: [], count: 0 });
      const classIds = assigned.map(r => r.class_id);
      p.push(classIds); where.push(`a.class_id = ANY($${p.length})`);
    }

    const limit  = Math.min(parseInt(req.query.limit  || "200", 10), 500);
    const offset = Math.max(parseInt(req.query.offset || "0",   10), 0);
    p.push(limit);  const limitPh  = p.length;
    p.push(offset); const offsetPh = p.length;

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    const { rows } = await db.query(
      `SELECT a.*,
              CONCAT(s.first_name,' ',s.last_name) AS student_name,
              s.admission_number,
              la.name AS subject_name, la.code AS subject_code,
              CONCAT(c.grade, COALESCE(' '||c.stream,'')) AS class_label,
              CONCAT(t.first_name,' ',t.last_name) AS teacher_name
       FROM assessments a
       JOIN students s ON s.id = a.student_id
       JOIN learning_areas la ON la.id = a.learning_area_id
       JOIN classes c ON c.id = a.class_id
       LEFT JOIN teachers t ON t.id = a.teacher_id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${limitPh} OFFSET $${offsetPh}`, p
    );
    return res.json({ success: true, data: rows, count: rows.length, limit, offset });
  } catch (err) {
    console.error("GET /assessments:", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/assessments/report ───────────────────────────────────
router.get("/report", auth, roleM(READ_ROLES), async (req, res) => {
  try {
    const schoolId = getSchoolId(req);
    const { student_id, term, academic_year } = req.query;
    if (!student_id)
      return res.status(400).json({ success: false, message: "student_id required." });

    const own = await assertStudentOwnership(student_id, schoolId, req.user.role === "SUPER_ADMIN");
    if (!own.ok) return res.status(own.code).json({ success: false, message: own.msg });

    const p = [student_id]; let where = "WHERE a.student_id=$1";
    if (term) { p.push(parseInt(term)); where += ` AND a.term=$${p.length}`; }
    if (academic_year) { p.push(academic_year); where += ` AND a.academic_year=$${p.length}`; }

    const { rows } = await db.query(
      `SELECT a.*, la.name AS subject_name, la.code AS subject_code
       FROM assessments a
       JOIN learning_areas la ON la.id = a.learning_area_id
       ${where}
       ORDER BY la.sort_order, a.term`, p
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── POST /api/assessments ─────────────────────────────────────────
router.post("/", auth, roleM(WRITE_ROLES),
  [
    body("student_id").notEmpty().isUUID().withMessage("Valid student UUID required"),
    body("class_id").notEmpty().isInt({ min: 1 }).withMessage("Valid class_id required"),
    body("learning_area_id").notEmpty().isInt({ min: 1 }),
    body("achievement_level").isIn(VALID_LEVELS).withMessage(`Must be one of: ${VALID_LEVELS.join(", ")}`),
    body("term").isInt({ min: 1, max: 3 }),
    body("academic_year").matches(/^\d{4}$/).withMessage("Format: YYYY"),
    body("assessment_type").optional().isIn(VALID_TYPES),
    body("score").optional().isFloat({ min: 0, max: 100 }),
    body("strand").optional().trim().isLength({ max: 150 }),
    body("sub_strand").optional().trim().isLength({ max: 150 }),
    body("teacher_comment").optional().trim().isLength({ max: 600 }),
    body("assessment_date").optional().isDate(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });

    try {
      const schoolId = getSchoolId(req);
      if (!schoolId)
        return res.status(400).json({ success: false, message: "school_id required." });

      // Verify student belongs to school — use DB's school_id, not body
      const own = await assertStudentOwnership(
        req.body.student_id, schoolId, req.user.role === "SUPER_ADMIN"
      );
      if (!own.ok) return res.status(own.code).json({ success: false, message: own.msg });

      // Verify class belongs to school
      const { rows: cls } = await db.query(
        "SELECT school_id FROM classes WHERE id=$1", [req.body.class_id]
      );
      if (!cls.length || (req.user.role !== "SUPER_ADMIN" && cls[0].school_id !== schoolId))
        return res.status(400).json({ success: false, message: "Invalid class." });

      // Check moderation lock — block writes if term is locked
      if (req.body.class_id && req.body.term && req.body.academic_year) {
        const { rows: lockRow } = await db.query(
          "SELECT is_locked FROM assessment_moderation WHERE school_id=$1 AND class_id=$2 AND term=$3 AND academic_year=$4",
          [schoolId, req.body.class_id, req.body.term, req.body.academic_year]
        );
        if (lockRow.length && lockRow[0].is_locked)
          return res.status(403).json({ success: false, message: "Assessments for this class/term are locked for moderation." });
      }

      // Resolve teacher profile from user account (if TEACHER role)
      let teacherId = null;
      if (req.user.role === "TEACHER") {
        const { rows: tr } = await db.query(
          "SELECT id FROM teachers WHERE user_id=$1 AND school_id=$2",
          [req.user.id, own.schoolId]
        );
        if (tr.length) teacherId = tr[0].id;
      }

      const {
        student_id, class_id, learning_area_id, strand, sub_strand,
        score, achievement_level, teacher_comment, assessment_type,
        assessment_date, term, academic_year
      } = req.body;

      const { rows } = await db.query(
        `INSERT INTO assessments
         (school_id, student_id, class_id, learning_area_id, teacher_id,
          strand, sub_strand, score, achievement_level, teacher_comment,
          assessment_type, assessment_date, term, academic_year)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (school_id, student_id, learning_area_id, assessment_type, term, academic_year)
         DO UPDATE SET
           score              = EXCLUDED.score,
           achievement_level  = EXCLUDED.achievement_level,
           teacher_comment    = EXCLUDED.teacher_comment,
           strand             = EXCLUDED.strand,
           sub_strand         = EXCLUDED.sub_strand,
           assessment_date    = EXCLUDED.assessment_date,
           teacher_id         = EXCLUDED.teacher_id
         RETURNING *`,
        [
          own.schoolId, student_id, class_id, learning_area_id, teacherId,
          strand || null, sub_strand || null, score ?? null, achievement_level,
          teacher_comment || null,
          assessment_type || "Formative",
          assessment_date || new Date().toISOString().split("T")[0],
          term, academic_year
        ]
      );

      await audit(req, "UPSERT_ASSESSMENT", "assessments", rows[0].id, null,
        { student_id, achievement_level, term, academic_year });
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      console.error("POST /assessments:", err.message);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── DELETE /api/assessments/:id ───────────────────────────────────
router.delete("/:id",
  auth,
  roleM(["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL"]),
  validateUUID("id"),
  async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT school_id FROM assessments WHERE id=$1", [req.params.id]
      );
      if (!rows.length)
        return res.status(404).json({ success: false, message: "Assessment not found." });
      if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });

      await db.query("DELETE FROM assessments WHERE id=$1", [req.params.id]);
      await audit(req, "DELETE_ASSESSMENT", "assessments", req.params.id);
      return res.json({ success: true, message: "Assessment deleted." });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

module.exports = router;
