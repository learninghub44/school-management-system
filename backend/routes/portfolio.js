"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const db   = require("../config/db");
const auth = require("../middleware/authMiddleware");
const roleM = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");

const router = express.Router();

function schoolId(req) {
  return req.user.role === "SUPER_ADMIN" ? (req.query.school_id || req.body.school_id || null) : req.user.school_id;
}

const READ_ROLES  = ["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD","TEACHER"];
const WRITE_ROLES = ["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD","TEACHER"];

// GET /api/portfolio?student_id=&term=&academic_year=&item_type=
router.get("/", auth, roleM(READ_ROLES), async (req, res) => {
  try {
    const sid = schoolId(req);
    const p = [], where = [];
    if (sid)                   { p.push(sid);                    where.push(`pi.school_id=$${p.length}`); }
    if (req.query.student_id)  { p.push(req.query.student_id);  where.push(`pi.student_id=$${p.length}`); }
    if (req.query.term)        { p.push(req.query.term);         where.push(`pi.term=$${p.length}`); }
    if (req.query.academic_year){ p.push(req.query.academic_year); where.push(`pi.academic_year=$${p.length}`); }
    if (req.query.item_type)   { p.push(req.query.item_type);   where.push(`pi.item_type=$${p.length}`); }

    const wc = where.length ? "WHERE " + where.join(" AND ") : "";
    const { rows } = await db.query(
      `SELECT pi.*,
              s.first_name||' '||s.last_name AS student_name,
              s.admission_number,
              la.name AS learning_area_name,
              t.first_name||' '||t.last_name AS teacher_name
       FROM portfolio_items pi
       JOIN students s ON s.id = pi.student_id
       LEFT JOIN learning_areas la ON la.id = pi.learning_area_id
       LEFT JOIN teachers t ON t.id = pi.teacher_id
       ${wc}
       ORDER BY pi.created_at DESC`, p
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("portfolio GET:", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST /api/portfolio
router.post("/", auth, roleM(WRITE_ROLES),
  [
    body("student_id").notEmpty().isUUID(),
    body("title").trim().notEmpty().isLength({ max: 200 }),
    body("item_type").isIn(["Project","Assignment","Practical","Artwork","Video","Image","Observation","Other"]),
    body("description").optional().trim().isLength({ max: 2000 }),
    body("learning_area_id").optional().isInt({ min: 1 }),
    body("term").optional().isInt({ min: 1, max: 3 }),
    body("academic_year").optional().matches(/^\d{4}$/),
    body("file_url").optional().trim().isURL().isLength({ max: 500 }),
    body("thumbnail_url").optional().trim().isURL().isLength({ max: 500 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

      // Resolve teacher_id from user if teacher
      let teacher_id = req.body.teacher_id || null;
      if (!teacher_id && req.user.role === "TEACHER") {
        const { rows: tr } = await db.query("SELECT id FROM teachers WHERE user_id=$1", [req.user.id]);
        if (tr.length) teacher_id = tr[0].id;
      }

      const { student_id, title, description, item_type, learning_area_id,
              term, academic_year, file_url, thumbnail_url } = req.body;
      const { rows } = await db.query(
        `INSERT INTO portfolio_items
           (school_id, student_id, teacher_id, title, description, item_type,
            learning_area_id, term, academic_year, file_url, thumbnail_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [sid, student_id, teacher_id, title, description || null, item_type,
         learning_area_id || null, term || null, academic_year || null,
         file_url || null, thumbnail_url || null]
      );
      await audit(req, "CREATE_PORTFOLIO_ITEM", "portfolio_items", rows[0].id, null, { student_id, item_type });
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      console.error("portfolio POST:", err.message);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// DELETE /api/portfolio/:id
router.delete("/:id", auth, roleM(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD","TEACHER"]),
  async (req, res) => {
    try {
      const { rows } = await db.query("SELECT school_id FROM portfolio_items WHERE id=$1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, message: "Not found." });
      if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });
      await db.query("DELETE FROM portfolio_items WHERE id=$1", [req.params.id]);
      await audit(req, "DELETE_PORTFOLIO_ITEM", "portfolio_items", req.params.id);
      return res.json({ success: true, message: "Deleted." });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

module.exports = router;
