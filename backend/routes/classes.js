"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const auth = require("../middleware/authMiddleware");
const roleM = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");
const router = express.Router();

const MANAGE = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL"];
const READ   = [...MANAGE, "HOD", "TEACHER", "BURSAR"];
const VALID_GRADES = ["PP1","PP2","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9"];
const STAGE_MAP = { "PP1":"ECDE","PP2":"ECDE","Grade 1":"Lower Primary","Grade 2":"Lower Primary","Grade 3":"Lower Primary","Grade 4":"Upper Primary","Grade 5":"Upper Primary","Grade 6":"Upper Primary","Grade 7":"Junior Secondary","Grade 8":"Junior Secondary","Grade 9":"Junior Secondary" };

function getSchoolId(req) {
  return req.user.role === "SUPER_ADMIN" ? (req.query.school_id || null) : req.user.school_id;
}

router.get("/", auth, roleM(READ), async (req, res) => {
  try {
    const sid = getSchoolId(req);
    if (!sid && req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({ success: false, message: "School isolation error." });
    let q = `SELECT c.*, CONCAT(t.first_name,' ',t.last_name) AS class_teacher_name, COUNT(DISTINCT s.id)::int AS student_count
             FROM classes c LEFT JOIN teachers t ON t.id=c.class_teacher_id LEFT JOIN students s ON s.class_id=c.id AND s.is_active=TRUE WHERE 1=1`;
    const p = [];
    if (sid) { p.push(sid); q += ` AND c.school_id=$${p.length}`; }
    if (req.query.academic_year) { p.push(req.query.academic_year); q += ` AND c.academic_year=$${p.length}`; }
    if (req.query.stage) { p.push(req.query.stage); q += ` AND c.stage=$${p.length}`; }
    q += " GROUP BY c.id, t.first_name, t.last_name ORDER BY c.stage, c.grade, c.stream";
    const { rows } = await db.query(q, p);
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (err) { return res.status(500).json({ success: false, message: "Server error." }); }
});

router.get("/:id/students", auth, roleM(READ), async (req, res) => {
  try {
    const { rows: cls } = await db.query("SELECT school_id FROM classes WHERE id=$1", [req.params.id]);
    if (!cls.length) return res.status(404).json({ success: false, message: "Class not found." });
    if (req.user.role !== "SUPER_ADMIN" && cls[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    const { rows } = await db.query(
      "SELECT * FROM students WHERE class_id=$1 AND is_active=TRUE ORDER BY last_name, first_name",
      [req.params.id]
    );
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (err) { return res.status(500).json({ success: false, message: "Server error." }); }
});

router.post("/", auth, roleM(MANAGE),
  [body("grade").isIn(VALID_GRADES), body("academic_year").matches(/^\d{4}$/)],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });
      const { grade, stream, academic_year, class_teacher_id, capacity } = req.body;
      const stage = STAGE_MAP[grade];
      const { rows } = await db.query(
        "INSERT INTO classes (school_id,grade,stream,stage,academic_year,class_teacher_id,capacity) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [sid, grade, stream||null, stage, academic_year, class_teacher_id||null, capacity||40]
      );
      await audit(req, "CREATE_CLASS", "classes", rows[0].id, null, rows[0]);
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ success: false, message: "Class already exists for this year." });
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

router.put("/:id", auth, roleM(MANAGE), async (req, res) => {
  try {
    const { rows: ex } = await db.query("SELECT * FROM classes WHERE id=$1", [req.params.id]);
    if (!ex.length) return res.status(404).json({ success: false, message: "Not found." });
    if (req.user.role !== "SUPER_ADMIN" && ex[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    const { stream, class_teacher_id, capacity } = req.body;
    const { rows } = await db.query(
      "UPDATE classes SET stream=COALESCE($1,stream), class_teacher_id=COALESCE($2,class_teacher_id), capacity=COALESCE($3,capacity) WHERE id=$4 RETURNING *",
      [stream||null, class_teacher_id||null, capacity||null, req.params.id]
    );
    await audit(req, "UPDATE_CLASS", "classes", req.params.id, ex[0], rows[0]);
    return res.json({ success: true, data: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, message: "Server error." }); }
});

router.delete("/:id", auth, roleM(MANAGE), async (req, res) => {
  try {
    const { rows } = await db.query("SELECT school_id FROM classes WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found." });
    if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    const { rows: studs } = await db.query("SELECT COUNT(*) FROM students WHERE class_id=$1 AND is_active=TRUE", [req.params.id]);
    if (parseInt(studs[0].count) > 0)
      return res.status(409).json({ success: false, message: "Cannot delete class with active students." });
    await db.query("DELETE FROM classes WHERE id=$1", [req.params.id]);
    await audit(req, "DELETE_CLASS", "classes", req.params.id);
    return res.json({ success: true, message: "Class deleted." });
  } catch (err) { return res.status(500).json({ success: false, message: "Server error." }); }
});

module.exports = router;
