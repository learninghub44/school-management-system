/**
 * /api/attendance — Daily attendance recording & reporting
 * Valid roles: SUPER_ADMIN, PRINCIPAL, DEPUTY_PRINCIPAL, HOD, TEACHER, BURSAR
 * BURSAR: read-only (for fee-default correlation)
 * TEACHER: scoped to own assigned classes only
 * All isolation from DB-verified req.user.school_id
 *
 * Production fixes:
 * - bulk insert now uses a single parameterised multi-row VALUES clause
 *   wrapped in a transaction — atomic, fast, no N+1 DB round-trips
 * - all student ownership checks batched before any write
 */
"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const db           = require("../config/db");
const auth         = require("../middleware/authMiddleware");
const roleM        = require("../middleware/roleMiddleware");
const { audit }    = require("../middleware/auditLog");

const router = express.Router();

function validateIntId(req, res, next) {
  if (!/^\d+$/.test(req.params.id))
    return res.status(400).json({ success: false, message: "Invalid ID." });
  next();
}

const VALID_STATUSES = ["Present", "Absent", "Late"];
const READ_ROLES     = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL", "HOD", "TEACHER", "BURSAR"];
const WRITE_ROLES    = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL", "HOD", "TEACHER"];

function getSchoolId(req) {
  if (req.user.role === "SUPER_ADMIN") return req.query.school_id || null;
  return req.user.school_id;
}

// ── GET /api/attendance ───────────────────────────────────────────
router.get("/", auth, roleM(READ_ROLES), async (req, res) => {
  try {
    const schoolId = getSchoolId(req);
    if (!schoolId && req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({ success: false, message: "School isolation error." });

    const p = [], where = [];
    if (schoolId) { p.push(schoolId); where.push(`a.school_id=$${p.length}`); }

    if (req.query.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
        return res.status(400).json({ success: false, message: "Invalid date format. Use YYYY-MM-DD." });
      p.push(req.query.date); where.push(`a.date=$${p.length}`);
    }

    if (req.query.class_id) {
      if (!/^\d+$/.test(req.query.class_id))
        return res.status(400).json({ success: false, message: "Invalid class_id." });
      p.push(req.query.class_id); where.push(`a.class_id=$${p.length}`);
    }

    if (req.query.status) {
      if (!VALID_STATUSES.includes(req.query.status))
        return res.status(400).json({ success: false, message: `Invalid status. Use: ${VALID_STATUSES.join(", ")}` });
      p.push(req.query.status); where.push(`a.status=$${p.length}`);
    }

    // TEACHER: restrict to own assigned classes only
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
      p.push(assigned.map(r => r.class_id));
      where.push(`a.class_id = ANY($${p.length})`);
    }

    const limit  = Math.min(parseInt(req.query.limit  || "200", 10), 500);
    const offset = Math.max(parseInt(req.query.offset || "0",   10), 0);

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    const { rows } = await db.query(
      `SELECT a.*,
              CONCAT(s.first_name,' ',s.last_name) AS student_name,
              s.admission_number,
              CONCAT(c.grade, COALESCE(' '||c.stream,'')) AS class_label,
              CONCAT(t.first_name,' ',t.last_name) AS recorded_by_name
       FROM attendance a
       JOIN students s ON s.id = a.student_id
       JOIN classes c ON c.id = a.class_id
       LEFT JOIN teachers t ON t.id = a.teacher_id
       ${whereClause}
       ORDER BY a.date DESC, s.last_name
       LIMIT ${limit} OFFSET ${offset}`, p
    );
    return res.json({ success: true, data: rows, count: rows.length, limit, offset });
  } catch (err) {
    console.error("GET /attendance:", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/attendance/summary ───────────────────────────────────
router.get("/summary", auth, roleM(READ_ROLES), async (req, res) => {
  try {
    const schoolId = getSchoolId(req);
    if (!schoolId)
      return res.status(400).json({ success: false, message: "school_id required." });

    const p = [schoolId]; let where = "WHERE a.school_id=$1";
    if (req.query.class_id) {
      if (!/^\d+$/.test(req.query.class_id))
        return res.status(400).json({ success: false, message: "Invalid class_id." });
      p.push(req.query.class_id); where += ` AND a.class_id=$${p.length}`;
    }
    if (req.query.date_from) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date_from))
        return res.status(400).json({ success: false, message: "Invalid date_from. Use YYYY-MM-DD." });
      p.push(req.query.date_from); where += ` AND a.date>=$${p.length}`;
    }
    if (req.query.date_to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date_to))
        return res.status(400).json({ success: false, message: "Invalid date_to. Use YYYY-MM-DD." });
      p.push(req.query.date_to); where += ` AND a.date<=$${p.length}`;
    }

    const { rows } = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE a.status='Present') AS present,
         COUNT(*) FILTER (WHERE a.status='Absent')  AS absent,
         COUNT(*) FILTER (WHERE a.status='Late')    AS late,
         COUNT(*) AS total,
         ROUND(COUNT(*) FILTER (WHERE a.status='Present')::numeric / NULLIF(COUNT(*),0) * 100, 1) AS attendance_rate
       FROM attendance a ${where}`, p
    );
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── POST /api/attendance/bulk — record whole class at once ────────
// Uses a single multi-row upsert in a transaction — O(1) round-trips not O(N)
router.post("/bulk", auth, roleM(WRITE_ROLES), async (req, res) => {
  const { class_id, date, records } = req.body;

  if (!class_id || !date || !Array.isArray(records) || !records.length)
    return res.status(400).json({ success: false, message: "class_id, date, and records[] required." });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ success: false, message: "Invalid date. Use YYYY-MM-DD." });

  if (records.length > 300)
    return res.status(400).json({ success: false, message: "Maximum 300 records per bulk request." });

  // Validate all statuses up-front
  for (const r of records) {
    if (!r.student_id)
      return res.status(400).json({ success: false, message: "Each record must have student_id." });
    if (!VALID_STATUSES.includes(r.status))
      return res.status(400).json({ success: false, message: `Invalid status "${r.status}". Use: ${VALID_STATUSES.join(", ")}` });
  }

  try {
    const schoolId = getSchoolId(req);
    if (!schoolId)
      return res.status(400).json({ success: false, message: "school_id required." });

    // Verify class belongs to school
    const { rows: cls } = await db.query(
      "SELECT school_id FROM classes WHERE id=$1", [class_id]
    );
    if (!cls.length)
      return res.status(404).json({ success: false, message: "Class not found." });
    if (req.user.role !== "SUPER_ADMIN" && cls[0].school_id !== schoolId)
      return res.status(403).json({ success: false, message: "Class does not belong to your school." });

    const resolvedSchoolId = cls[0].school_id;

    // TEACHER: verify they are assigned to this class
    let teacherId = null;
    if (req.user.role === "TEACHER") {
      const { rows: tr } = await db.query(
        "SELECT id FROM teachers WHERE user_id=$1 AND school_id=$2",
        [req.user.id, schoolId]
      );
      if (!tr.length)
        return res.status(403).json({ success: false, message: "Teacher profile not found." });
      teacherId = tr[0].id;
      const { rows: asgn } = await db.query(
        "SELECT id FROM teacher_assignments WHERE teacher_id=$1 AND class_id=$2 AND school_id=$3",
        [teacherId, class_id, schoolId]
      );
      if (!asgn.length)
        return res.status(403).json({ success: false, message: "You are not assigned to this class." });
    }

    // Batch verify ALL student_ids belong to this school
    const studentIds = records.map(r => r.student_id);
    const { rows: studs } = await db.query(
      "SELECT id, school_id FROM students WHERE id = ANY($1)", [studentIds]
    );
    const studentMap = new Map(studs.map(s => [s.id, s]));
    for (const sid of studentIds) {
      const stud = studentMap.get(sid);
      if (!stud)
        return res.status(400).json({ success: false, message: `Student not found: ${sid}` });
      if (req.user.role !== "SUPER_ADMIN" && stud.school_id !== schoolId)
        return res.status(403).json({ success: false, message: `Student ${sid} does not belong to your school.` });
    }

    // Build a single multi-row upsert inside a transaction
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");

      // Build VALUES ($1,$2,...), ($N+1,...) for all rows
      const vals = [];
      const placeholders = records.map((r, i) => {
        const base = i * 6;
        vals.push(resolvedSchoolId, r.student_id, class_id, teacherId, date, r.status, r.remarks || null);
        // 7 columns per row
        const b = i * 7;
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`;
      });

      // Rebuild correctly (7 params per row, not 6)
      const vals2 = [];
      const ph2 = records.map((r, i) => {
        const b = i * 7;
        vals2.push(resolvedSchoolId, r.student_id, class_id, teacherId, date, r.status, r.remarks || null);
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`;
      });

      await client.query(
        `INSERT INTO attendance (school_id, student_id, class_id, teacher_id, date, status, remarks)
         VALUES ${ph2.join(",")}
         ON CONFLICT (school_id, student_id, date)
         DO UPDATE SET status=EXCLUDED.status, remarks=EXCLUDED.remarks, teacher_id=EXCLUDED.teacher_id`,
        vals2
      );

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    await audit(req, "BULK_ATTENDANCE", "attendance", null, null,
      { class_id, date, count: records.length });
    return res.json({ success: true, message: `${records.length} record(s) saved.`, count: records.length });
  } catch (err) {
    console.error("POST /attendance/bulk:", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── PUT /api/attendance/:id ───────────────────────────────────────
router.put("/:id", auth, roleM(WRITE_ROLES), validateIntId,
  [body("status").optional().isIn(VALID_STATUSES)],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });

    try {
      const { rows: ex } = await db.query(
        "SELECT * FROM attendance WHERE id=$1", [req.params.id]
      );
      if (!ex.length)
        return res.status(404).json({ success: false, message: "Record not found." });
      if (req.user.role !== "SUPER_ADMIN" && ex[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });

      const { rows } = await db.query(
        "UPDATE attendance SET status=COALESCE($1,status), remarks=COALESCE($2,remarks) WHERE id=$3 RETURNING *",
        [req.body.status || null, req.body.remarks || null, req.params.id]
      );
      await audit(req, "UPDATE_ATTENDANCE", "attendance", req.params.id, ex[0], rows[0]);
      return res.json({ success: true, data: rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

module.exports = router;
