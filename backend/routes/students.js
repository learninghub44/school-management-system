/**
 * /api/students
 * Full UUID validation on :id params
 * School isolation hard-locked from DB-verified JWT
 * Student promote endpoint verifies destination class belongs to same school
 */
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

// ── GET /api/students ─────────────────────────────────────────────
router.get("/", auth, roleM(READ), async (req, res) => {
  try {
    const sid = getSchoolId(req);
    if (!sid && req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({ success: false, message: "School isolation error." });

    // Safety: require at least one filter to prevent dumping entire student table
    const hasFilter = req.query.class_id || req.query.search || req.query.is_active !== undefined || req.user.role === "SUPER_ADMIN";
    if (!hasFilter) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one filter: class_id, search, or is_active."
      });
    }

    let q = `SELECT s.id, s.first_name, s.middle_name, s.last_name, s.admission_number,
                    s.gender, s.is_active, s.class_id, s.upi_number,
                    s.parent_name, s.parent_phone,
                    CONCAT(c.grade, COALESCE(' '||c.stream,'')) AS class_label,
                    c.grade, c.stream, c.stage
             FROM students s
             LEFT JOIN classes c ON c.id = s.class_id
             WHERE 1=1`;
    const p = [];
    if (sid) { p.push(sid); q += ` AND s.school_id=$${p.length}`; }
    if (req.query.class_id) {
      if (!/^\d+$/.test(req.query.class_id))
        return res.status(400).json({ success: false, message: "Invalid class_id." });
      p.push(req.query.class_id); q += ` AND s.class_id=$${p.length}`;
    }
    if (req.query.is_active !== undefined) {
      p.push(req.query.is_active === "true"); q += ` AND s.is_active=$${p.length}`;
    }
    if (req.query.gender && ["Male","Female"].includes(req.query.gender)) {
      p.push(req.query.gender); q += ` AND s.gender=$${p.length}`;
    }
    if (req.query.search) {
      const search = req.query.search.replace(/[%_\\]/g, "\\$&").substring(0, 100);
      p.push(`%${search}%`);
      q += ` AND (s.first_name ILIKE $${p.length} OR s.last_name ILIKE $${p.length} OR s.admission_number ILIKE $${p.length})`;
    }

    // Hard cap — prevent memory exhaustion
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 200);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
    p.push(limit);  q += ` ORDER BY s.last_name, s.first_name LIMIT $${p.length}`;
    p.push(offset); q += ` OFFSET $${p.length}`;

    const { rows } = await db.query(q, p);
    return res.json({ success: true, data: rows, count: rows.length, limit, offset });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/students/next-admission ─────────────────────────────
// Returns the next available admission number for the school
// Format: {SCHOOL_CODE}/{YEAR}/{SEQUENCE} e.g. GEN001/2026/0042
router.get("/next-admission", auth, roleM(READ), async (req, res) => {
  try {
    const sid = getSchoolId(req);
    if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

    // Get school code
    const { rows: schoolRows } = await db.query(
      "SELECT school_code FROM schools WHERE id=$1", [sid]
    );
    const schoolCode = schoolRows[0]?.school_code || "SCH";
    const year = new Date().getFullYear();

    // Count existing students for this school this year
    const { rows } = await db.query(
      `SELECT COUNT(*) AS total FROM students
       WHERE school_id=$1 AND EXTRACT(YEAR FROM created_at)=$2`,
      [sid, year]
    );
    const next = parseInt(rows[0].total || 0) + 1;
    const seq  = String(next).padStart(4, "0");
    const admission_no = `${schoolCode}/${year}/${seq}`;

    return res.json({ success: true, admission_no });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/students/:id ─────────────────────────────────────────
router.get("/:id", auth, roleM(READ), validateUUID("id"), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.*, CONCAT(c.grade, COALESCE(' '||c.stream,'')) AS class_label, c.stage
       FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "Student not found." });
    if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── POST /api/students ────────────────────────────────────────────
router.post("/", auth, roleM(MANAGE),
  [
    body("first_name").trim().notEmpty().isLength({ max: 80 }),
    body("last_name").trim().notEmpty().isLength({ max: 80 }),
    body("middle_name").optional().trim().isLength({ max: 80 }),
    body("admission_number").optional().trim().isLength({ max: 30 }),
    body("upi_number").optional().trim().isLength({ max: 30 }),
    body("gender").isIn(["Male", "Female"]),
    body("class_id").notEmpty().isInt({ min: 1 }),
    body("date_of_birth").optional().isDate(),
    body("admission_date").optional().isDate(),
    body("parent_name").optional().trim().isLength({ max: 150 }),
    body("parent_phone").optional().matches(/^\+?[\d\s\-]{7,20}$/),
    body("address").optional().trim().isLength({ max: 500 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

      // Verify class belongs to same school
      const { rows: cls } = await db.query(
        "SELECT school_id FROM classes WHERE id=$1", [req.body.class_id]
      );
      if (!cls.length)
        return res.status(404).json({ success: false, message: "Class not found." });
      if (req.user.role !== "SUPER_ADMIN" && cls[0].school_id !== sid)
        return res.status(403).json({ success: false, message: "Class does not belong to your school." });

      const {
        first_name, middle_name, last_name, upi_number,
        gender, date_of_birth, class_id, admission_date,
        parent_name, parent_phone, address
      } = req.body;

      // Auto-generate admission number if not supplied
      let admission_number = req.body.admission_number?.trim();
      if (!admission_number) {
        const { rows: sc } = await db.query("SELECT school_code FROM schools WHERE id=$1", [cls[0].school_id]);
        const code = sc[0]?.school_code || "SCH";
        const year = new Date().getFullYear();
        const { rows: cnt } = await db.query(
          "SELECT COUNT(*) AS total FROM students WHERE school_id=$1 AND EXTRACT(YEAR FROM created_at)=$2",
          [cls[0].school_id, year]
        );
        const seq = String(parseInt(cnt[0].total || 0) + 1).padStart(4, "0");
        admission_number = `${code}/${year}/${seq}`;
      }

      const { rows } = await db.query(
        `INSERT INTO students
         (school_id, first_name, middle_name, last_name, admission_number, upi_number,
          gender, date_of_birth, class_id, admission_date, parent_name, parent_phone, address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          cls[0].school_id, first_name, middle_name || null, last_name,
          admission_number, upi_number || null, gender, date_of_birth || null,
          class_id, admission_date || null, parent_name || null,
          parent_phone || null, address || null
        ]
      );
      await audit(req, "CREATE_STUDENT", "students", rows[0].id, null,
        { first_name, last_name, admission_number });
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      if (err.code === "23505")
        return res.status(409).json({ success: false, message: "Admission number already exists in this school." });
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── PUT /api/students/:id ─────────────────────────────────────────
router.put("/:id", auth, roleM(MANAGE), validateUUID("id"),
  [
    body("first_name").optional().trim().isLength({ max: 80 }),
    body("last_name").optional().trim().isLength({ max: 80 }),
    body("gender").optional().isIn(["Male", "Female"]),
    body("date_of_birth").optional().isDate(),
    body("parent_phone").optional().matches(/^\+?[\d\s\-]{7,20}$/),
    body("is_active").optional().isBoolean(),
    body("class_id").optional().isInt({ min: 1 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const { rows: ex } = await db.query("SELECT * FROM students WHERE id=$1", [req.params.id]);
      if (!ex.length) return res.status(404).json({ success: false, message: "Student not found." });
      if (req.user.role !== "SUPER_ADMIN" && ex[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });

      // If changing class, verify new class belongs to same school
      if (req.body.class_id) {
        const { rows: cls } = await db.query(
          "SELECT school_id FROM classes WHERE id=$1", [req.body.class_id]
        );
        if (!cls.length || (req.user.role !== "SUPER_ADMIN" && cls[0].school_id !== ex[0].school_id))
          return res.status(400).json({ success: false, message: "Invalid class." });
      }

      const {
        first_name, middle_name, last_name, gender, date_of_birth, class_id,
        parent_name, parent_phone, address, upi_number, is_active
      } = req.body;

      const { rows } = await db.query(
        `UPDATE students SET
           first_name   = COALESCE($1,  first_name),
           middle_name  = COALESCE($2,  middle_name),
           last_name    = COALESCE($3,  last_name),
           gender       = COALESCE($4,  gender),
           date_of_birth= COALESCE($5,  date_of_birth),
           class_id     = COALESCE($6,  class_id),
           parent_name  = COALESCE($7,  parent_name),
           parent_phone = COALESCE($8,  parent_phone),
           address      = COALESCE($9,  address),
           upi_number   = COALESCE($10, upi_number),
           is_active    = COALESCE($11, is_active),
           updated_at   = NOW()
         WHERE id = $12
         RETURNING *`,
        [
          first_name||null, middle_name||null, last_name||null, gender||null,
          date_of_birth||null, class_id||null, parent_name||null, parent_phone||null,
          address||null, upi_number||null, is_active??null, req.params.id
        ]
      );
      await audit(req, "UPDATE_STUDENT", "students", req.params.id, ex[0], rows[0]);
      return res.json({ success: true, data: rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── POST /api/students/promote ────────────────────────────────────
router.post("/promote", auth, roleM(MANAGE), async (req, res) => {
  try {
    const { student_ids, new_class_id } = req.body;
    if (!Array.isArray(student_ids) || !student_ids.length || !new_class_id)
      return res.status(400).json({ success: false, message: "student_ids[] and new_class_id required." });

    const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;

    // Verify destination class belongs to school
    const { rows: cls } = await db.query(
      "SELECT school_id FROM classes WHERE id=$1", [new_class_id]
    );
    if (!cls.length)
      return res.status(404).json({ success: false, message: "Destination class not found." });
    if (req.user.role !== "SUPER_ADMIN" && cls[0].school_id !== sid)
      return res.status(403).json({ success: false, message: "Class does not belong to your school." });

    // Verify all student_ids belong to the same school
    const { rows: studs } = await db.query(
      "SELECT id, school_id FROM students WHERE id = ANY($1)", [student_ids]
    );
    for (const s of studs) {
      if (req.user.role !== "SUPER_ADMIN" && s.school_id !== sid)
        return res.status(403).json({ success: false, message: `Student ${s.id} does not belong to your school.` });
    }

    const { rowCount } = await db.query(
      "UPDATE students SET class_id=$1, updated_at=NOW() WHERE id=ANY($2) AND school_id=$3",
      [new_class_id, student_ids, cls[0].school_id]
    );
    await audit(req, "PROMOTE_STUDENTS", "students", null, null,
      { count: rowCount, new_class_id });
    return res.json({ success: true, message: `${rowCount} student(s) promoted.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
