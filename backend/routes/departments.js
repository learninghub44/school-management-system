"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const auth = require("../middleware/authMiddleware");
const roleM = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");
const router = express.Router();
const MANAGE = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL"];

function validateIntId(req, res, next) {
  if (!/^\d+$/.test(req.params.id))
    return res.status(400).json({ success: false, message: "Invalid ID." });
  next();
}

function getSchoolId(req) {
  return req.user.role === "SUPER_ADMIN" ? (req.query.school_id || null) : req.user.school_id;
}

const READ = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL", "HOD", "TEACHER", "BURSAR"];
router.get("/", auth, roleM(READ), async (req, res) => {
  try {
    const sid = getSchoolId(req);
    if (!sid && req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({ success: false, message: "School isolation error." });
    let q = `SELECT d.*, u.name AS hod_name FROM departments d LEFT JOIN users u ON u.id=d.hod_id WHERE 1=1`;
    const p = [];
    if (sid) { p.push(sid); q += ` AND d.school_id=$${p.length}`; }
    q += " ORDER BY d.name";
    const { rows } = await db.query(q, p);
    return res.json({ success: true, data: rows });
  } catch (err) { return res.status(500).json({ success: false, message: "Server error." }); }
});

router.post("/", auth, roleM(MANAGE),
  [body("name").trim().notEmpty().isLength({ max: 100 })],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });
      const { rows } = await db.query(
        "INSERT INTO departments (school_id, name, hod_id, description) VALUES ($1,$2,$3,$4) RETURNING *",
        [sid, req.body.name, req.body.hod_id || null, req.body.description || null]
      );
      await audit(req, "CREATE_DEPT", "departments", rows[0].id, null, rows[0]);
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ success: false, message: "Department already exists." });
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

router.put("/:id", auth, roleM(MANAGE), validateIntId, async (req, res) => {
  try {
    const { rows: ex } = await db.query("SELECT * FROM departments WHERE id=$1", [req.params.id]);
    if (!ex.length) return res.status(404).json({ success: false, message: "Not found." });
    if (req.user.role !== "SUPER_ADMIN" && ex[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    const { rows } = await db.query(
      "UPDATE departments SET name=COALESCE($1,name), hod_id=COALESCE($2,hod_id), description=COALESCE($3,description) WHERE id=$4 RETURNING *",
      [req.body.name||null, req.body.hod_id||null, req.body.description||null, req.params.id]
    );
    await audit(req, "UPDATE_DEPT", "departments", req.params.id, ex[0], rows[0]);
    return res.json({ success: true, data: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, message: "Server error." }); }
});

router.delete("/:id", auth, roleM(MANAGE), validateIntId, async (req, res) => {
  try {
    const { rows } = await db.query("SELECT school_id FROM departments WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found." });
    if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    await db.query("DELETE FROM departments WHERE id=$1", [req.params.id]);
    await audit(req, "DELETE_DEPT", "departments", req.params.id);
    return res.json({ success: true, message: "Department deleted." });
  } catch (err) { return res.status(500).json({ success: false, message: "Server error." }); }
});

module.exports = router;
