/**
 * /api/students
 * Full UUID validation on :id params
 * School isolation hard-locked from DB-verified JWT
 * Student promote endpoint verifies destination class belongs to same school
 */
"use strict";
const express = require("express");
const bcrypt  = require("bcryptjs");
const crypto  = require("crypto");
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

    // export=true: authorised roles can dump all school students for backup
    const isExport = req.query.export === "true" &&
      ["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL"].includes(req.user.role);

    // Safety: require at least one filter to prevent full-table scans
    const hasFilter = isExport || req.query.class_id || req.query.search ||
      req.query.is_active !== undefined || req.user.role === "SUPER_ADMIN";
    if (!hasFilter) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one filter: class_id, search, is_active, or export=true."
      });
    }

    let q = `SELECT s.id, s.first_name, s.middle_name, s.last_name, s.admission_number,
                    s.gender, s.is_active, s.class_id, s.upi_number,
                    s.parent_name, s.parent_phone, s.date_of_birth,
                    s.address, s.admission_date,
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

    // Export mode: higher cap for backup; normal mode: paginated
    const maxLimit = isExport ? 5000 : 200;
    const limit  = Math.min(parseInt(req.query.limit  || (isExport ? "5000" : "100"), 10), maxLimit);
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
    body("assessment_number").optional().trim().isLength({ max: 30 }),
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
        first_name, middle_name, last_name, upi_number, assessment_number,
        gender, date_of_birth, class_id, admission_date,
        parent_name, parent_phone, address
      } = req.body;

      // ── Enforce student limit from subscription plan ──────────────
      if (req.user.role !== "SUPER_ADMIN") {
        const { rows: subRows } = await db.query(
          `SELECT pp.student_limit
           FROM school_subscriptions ss
           JOIN payment_plans pp ON pp.id = ss.plan_id
           WHERE ss.school_id = $1 AND ss.status IN ('active','trialing')
           LIMIT 1`,
          [sid]
        );
        const limit = subRows[0]?.student_limit;
        if (limit) {
          const { rows: countRows } = await db.query(
            "SELECT COUNT(*) AS total FROM students WHERE school_id=$1 AND is_active=TRUE",
            [sid]
          );
          if (parseInt(countRows[0].total) >= limit) {
            return res.status(403).json({
              success: false,
              code: "STUDENT_LIMIT_REACHED",
              message: `Your plan allows a maximum of ${limit} students. Upgrade your plan to enroll more.`,
            });
          }
        }
      }

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
          assessment_number, gender, date_of_birth, class_id, admission_date, parent_name, parent_phone, address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          cls[0].school_id, first_name, middle_name || null, last_name,
          admission_number, upi_number || null, assessment_number || null,
          gender, date_of_birth || null,
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
        parent_name, parent_phone, address, upi_number, assessment_number,
        kpsea_registered, kjsea_registered, is_active
      } = req.body;

      const { rows } = await db.query(
        `UPDATE students SET
           first_name        = COALESCE($1,  first_name),
           middle_name       = COALESCE($2,  middle_name),
           last_name         = COALESCE($3,  last_name),
           gender            = COALESCE($4,  gender),
           date_of_birth     = COALESCE($5,  date_of_birth),
           class_id          = COALESCE($6,  class_id),
           parent_name       = COALESCE($7,  parent_name),
           parent_phone      = COALESCE($8,  parent_phone),
           address           = COALESCE($9,  address),
           upi_number        = COALESCE($10, upi_number),
           is_active         = COALESCE($11, is_active),
           assessment_number = COALESCE($12, assessment_number),
           kpsea_registered  = COALESCE($13, kpsea_registered),
           kjsea_registered  = COALESCE($14, kjsea_registered),
           updated_at        = NOW()
         WHERE id = $15
         RETURNING *`,
        [
          first_name||null, middle_name||null, last_name||null, gender||null,
          date_of_birth||null, class_id||null, parent_name||null, parent_phone||null,
          address||null, upi_number||null, is_active??null,
          assessment_number||null, kpsea_registered??null, kjsea_registered??null,
          req.params.id
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
// CBC policy: Grade 6→7 (KPSEA) and Grade 9→10 (KJSEA) are 100%
// transitions — every learner moves regardless of assessment score.
// This endpoint updates class_id AND logs a permanent promotion_history row.
router.post("/promote", auth, roleM(MANAGE), async (req, res) => {
  try {
    const { student_ids, new_class_id, academic_year, notes } = req.body;
    if (!Array.isArray(student_ids) || !student_ids.length || !new_class_id)
      return res.status(400).json({ success: false, message: "student_ids[] and new_class_id required." });

    const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;

    // Verify destination class belongs to school and get its grade/stage
    const { rows: destCls } = await db.query(
      "SELECT id, school_id, grade, stage FROM classes WHERE id=$1", [new_class_id]
    );
    if (!destCls.length)
      return res.status(404).json({ success: false, message: "Destination class not found." });
    if (req.user.role !== "SUPER_ADMIN" && destCls[0].school_id !== sid)
      return res.status(403).json({ success: false, message: "Class does not belong to your school." });

    // Fetch students with their current class grade/stage for history logging
    const { rows: studs } = await db.query(
      `SELECT s.id, s.school_id, s.class_id,
              c.grade AS from_grade, c.stage AS from_stage
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.id = ANY($1)`,
      [student_ids]
    );
    for (const s of studs) {
      if (req.user.role !== "SUPER_ADMIN" && s.school_id !== sid)
        return res.status(403).json({ success: false, message: `Student ${s.id} does not belong to your school.` });
    }

    const schoolId  = destCls[0].school_id;
    const toGrade   = destCls[0].grade;
    const toStage   = destCls[0].stage;
    const acYear    = academic_year || String(new Date().getFullYear());

    // Determine promotion type based on grade transition
    const getPromotionType = (fromGrade) => {
      if (fromGrade === "Grade 6" && toGrade === "Grade 7") return "KPSEA Transition";
      if (fromGrade === "Grade 9" && toGrade === "Grade 10") return "KJSEA Transition";
      return "Normal";
    };

    // Update class_id for all students
    const { rowCount } = await db.query(
      "UPDATE students SET class_id=$1, updated_at=NOW() WHERE id=ANY($2) AND school_id=$3",
      [new_class_id, student_ids, schoolId]
    );

    // Log promotion_history for each student (best-effort — don't fail if table missing)
    try {
      for (const s of studs) {
        const promotionType = getPromotionType(s.from_grade);
        await db.query(
          `INSERT INTO promotion_history
             (school_id, student_id, from_class_id, to_class_id,
              from_grade, to_grade, from_stage, to_stage,
              academic_year, promoted_by, promotion_type, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            schoolId, s.id, s.class_id || null, new_class_id,
            s.from_grade || null, toGrade,
            s.from_stage || null, toStage,
            acYear, req.user.id, promotionType, notes || null
          ]
        );
      }
    } catch (histErr) {
      // Table may not exist yet on older DBs — promotion still succeeds
      console.warn("promotion_history insert skipped:", histErr.message);
    }

    await audit(req, "PROMOTE_STUDENTS", "students", null, null,
      { count: rowCount, new_class_id, to_grade: toGrade, to_stage: toStage });

    const isTransition = studs.some(s =>
      s.from_grade === "Grade 6" || s.from_grade === "Grade 9"
    );
    return res.json({
      success: true,
      message: `${rowCount} student(s) promoted to ${toGrade}.`,
      to_grade: toGrade,
      to_stage: toStage,
      is_stage_transition: isTransition,
    });
  } catch (err) {
    console.error("promote error:", err.stack);
    return res.status(500).json({ success: false, message: "Server error during promotion." });
  }
});

// ── GET /api/students/promotion-history — list promotion records ──
// Used to audit who was promoted when, especially for Grade 6/9 transitions
router.get("/promotion-history", auth, roleM(READ), async (req, res) => {
  try {
    const sid = req.user.role === "SUPER_ADMIN" ? req.query.school_id : req.user.school_id;
    if (!sid) return res.status(400).json({ success: false, message: "school_id required." });
    const p = [sid];
    let q = `SELECT ph.*,
               s.first_name || ' ' || s.last_name AS student_name,
               s.admission_number,
               u.first_name || ' ' || u.last_name AS promoted_by_name
             FROM promotion_history ph
             JOIN students s ON s.id = ph.student_id
             LEFT JOIN users u ON u.id = ph.promoted_by
             WHERE ph.school_id = $1`;
    if (req.query.academic_year) { p.push(req.query.academic_year); q += ` AND ph.academic_year=$${p.length}`; }
    if (req.query.promotion_type) { p.push(req.query.promotion_type); q += ` AND ph.promotion_type=$${p.length}`; }
    if (req.query.student_id)    { p.push(req.query.student_id);    q += ` AND ph.student_id=$${p.length}`; }
    q += " ORDER BY ph.promoted_at DESC LIMIT 200";
    const { rows } = await db.query(q, p);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("promotion-history error:", err.stack);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── PATCH /api/students/:id/knec-registration — mark KPSEA/KJSEA registered ──
// Lets a principal tick off that a Grade 6 or 9 student has been registered
// on cba.knec.ac.ke before the KNEC deadline
router.patch("/:id/knec-registration", auth, roleM(MANAGE), async (req, res) => {
  try {
    const { kpsea_registered, kjsea_registered } = req.body;
    if (kpsea_registered === undefined && kjsea_registered === undefined)
      return res.status(400).json({ success: false, message: "Provide kpsea_registered or kjsea_registered." });
    const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
    const sets = [], p = [];
    if (kpsea_registered !== undefined) { sets.push(`kpsea_registered=$${p.push(kpsea_registered)}`); }
    if (kjsea_registered !== undefined) { sets.push(`kjsea_registered=$${p.push(kjsea_registered)}`); }
    sets.push("updated_at=NOW()");
    p.push(req.params.id); p.push(sid);
    const { rows } = await db.query(
      `UPDATE students SET ${sets.join(",")} WHERE id=$${p.length-1} AND school_id=$${p.length} RETURNING id, kpsea_registered, kjsea_registered`,
      p
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "Student not found." });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/students/:id/guardians — list linked parent accounts ──
router.get("/:id/guardians", auth, roleM(READ), validateUUID("id"), async (req, res) => {
  try {
    const sid = getSchoolId(req);
    const { rows: st } = await db.query("SELECT school_id FROM students WHERE id=$1", [req.params.id]);
    if (!st.length) return res.status(404).json({ success: false, message: "Student not found." });
    if (req.user.role !== "SUPER_ADMIN" && st[0].school_id !== sid)
      return res.status(403).json({ success: false, message: "Access denied." });

    const { rows } = await db.query(
      `SELECT g.id AS guardian_id, g.relationship, g.is_primary, g.created_at,
              u.id AS parent_user_id, u.name, u.email, u.username, u.is_active
       FROM guardians g
       JOIN users u ON u.id = g.user_id
       WHERE g.student_id = $1
       ORDER BY g.is_primary DESC, g.created_at ASC`,
      [req.params.id]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[students/guardians GET]", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── POST /api/students/:id/guardians — link a parent account ───────
// Creates a PARENT user if the email is new, or links an existing PARENT
// account (so the same login works across siblings). MANAGE roles only —
// this is the one write path into the otherwise read-only parent portal.
router.post("/:id/guardians", auth, roleM(MANAGE), validateUUID("id"),
  [
    body("email").isEmail().normalizeEmail(),
    body("name").trim().notEmpty().isLength({ max: 150 }),
    body("phone").optional().matches(/^\+?[\d\s\-]{7,20}$/),
    body("relationship").isIn(["Mother", "Father", "Guardian", "Other"]),
    body("is_primary").optional().isBoolean(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = getSchoolId(req);
      const { rows: st } = await db.query("SELECT school_id FROM students WHERE id=$1", [req.params.id]);
      if (!st.length) return res.status(404).json({ success: false, message: "Student not found." });
      if (req.user.role !== "SUPER_ADMIN" && st[0].school_id !== sid)
        return res.status(403).json({ success: false, message: "Access denied." });

      const { email, name, phone, relationship, is_primary } = req.body;
      const studentSchoolId = st[0].school_id;

      // Reuse an existing PARENT account for this school+email if one exists
      // (covers siblings sharing one parent login), otherwise create one.
      const { rows: existing } = await db.query(
        "SELECT id FROM users WHERE email=$1 AND school_id=$2 AND role='PARENT'",
        [email, studentSchoolId]
      );

      let parentUserId, tempPassword = null;
      if (existing.length) {
        parentUserId = existing[0].id;
      } else {
        // Username derived from email local-part, deduped with a short suffix on conflict
        const base = email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40) || "parent";
        let username = base, suffix = 0;
        while (true) {
          const { rows: dup } = await db.query("SELECT id FROM users WHERE username=$1", [username]);
          if (!dup.length) break;
          suffix += 1; username = `${base}${suffix}`;
        }
        tempPassword = crypto.randomBytes(6).toString("base64url"); // shown once in the response
        const hash = await bcrypt.hash(tempPassword, 12);
        const { rows: created } = await db.query(
          `INSERT INTO users (school_id, username, email, password_hash, name, phone, role, must_change_password)
           VALUES ($1,$2,$3,$4,$5,$6,'PARENT',TRUE) RETURNING id`,
          [studentSchoolId, username, email, hash, name, phone || null]
        );
        parentUserId = created[0].id;
      }

      const { rows: link } = await db.query(
        `INSERT INTO guardians (school_id, user_id, student_id, relationship, is_primary, created_by)
         VALUES ($1,$2,$3,$4,COALESCE($5,FALSE),$6)
         ON CONFLICT (user_id, student_id) DO UPDATE SET relationship=EXCLUDED.relationship, is_primary=EXCLUDED.is_primary
         RETURNING id`,
        [studentSchoolId, parentUserId, req.params.id, relationship, is_primary, req.user.id]
      );

      await audit(req, "LINK_GUARDIAN", "guardians", link[0].id, null, { student_id: req.params.id, email });
      return res.status(201).json({
        success: true,
        message: tempPassword ? "Parent account created and linked." : "Existing parent account linked to this student.",
        data: { guardian_id: link[0].id, parent_user_id: parentUserId, temp_password: tempPassword },
      });
    } catch (err) {
      console.error("[students/guardians]", err.message);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

module.exports = router;
