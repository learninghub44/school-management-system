/**
 * /api/assignments — Teacher-Class-Subject assignments
 */
const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");
const router = express.Router();
const MANAGE = ["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL"];

router.get("/", authMiddleware, async (req, res) => {
  try {
    const schoolId = req.user.role === "SUPER_ADMIN" ? (req.query.school_id||null) : req.user.school_id;
    if (!schoolId && req.user.role !== "SUPER_ADMIN") return res.status(403).json({ success:false, message:"School isolation error." });
    let q = `SELECT ta.*, 
                    CONCAT(t.first_name,' ',t.last_name) AS teacher_name,
                    t.tsc_number,
                    CONCAT(c.grade, COALESCE(' '||c.stream,'')) AS class_label,
                    c.grade, c.stream, c.stage,
                    la.name AS subject_name, la.code AS subject_code
             FROM teacher_assignments ta
             JOIN teachers t ON t.id=ta.teacher_id
             JOIN classes c ON c.id=ta.class_id
             JOIN learning_areas la ON la.id=ta.learning_area_id
             WHERE 1=1`;
    const p = [];
    if (schoolId) { p.push(schoolId); q += ` AND ta.school_id=$${p.length}`; }
    if (req.query.teacher_id) { p.push(req.query.teacher_id); q += ` AND ta.teacher_id=$${p.length}`; }
    if (req.query.class_id) { p.push(req.query.class_id); q += ` AND ta.class_id=$${p.length}`; }
    if (req.query.academic_year) { p.push(req.query.academic_year); q += ` AND ta.academic_year=$${p.length}`; }
    q += " ORDER BY c.grade, c.stream, la.sort_order";
    const { rows } = await db.query(q, p);
    return res.json({ success:true, data:rows, count:rows.length });
  } catch(err) { return res.status(500).json({ success:false, message:"Server error." }); }
});

router.post("/", authMiddleware, roleMiddleware(MANAGE),
  [
    body("teacher_id").notEmpty(),
    body("class_id").notEmpty().isInt(),
    body("learning_area_id").notEmpty().isInt(),
    body("role").isIn(["Class Teacher","Subject Teacher","HOD"]),
    body("academic_year").matches(/^\d{4}$/),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success:false, errors:errs.array() });
    try {
      const schoolId = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      const { teacher_id, class_id, learning_area_id, role, academic_year } = req.body;

      // Verify teacher and class belong to same school
      const [tRes, cRes] = await Promise.all([
        db.query("SELECT school_id FROM teachers WHERE id=$1",[teacher_id]),
        db.query("SELECT school_id FROM classes WHERE id=$1",[class_id]),
      ]);
      if (!tRes.rows.length || !cRes.rows.length) return res.status(404).json({ success:false, message:"Teacher or class not found." });
      if (req.user.role !== "SUPER_ADMIN" && (tRes.rows[0].school_id !== schoolId || cRes.rows[0].school_id !== schoolId))
        return res.status(403).json({ success:false, message:"Cross-school assignment denied." });

      const { rows } = await db.query(
        `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, learning_area_id, role, academic_year)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [schoolId, teacher_id, class_id, learning_area_id, role, academic_year]
      );
      await audit(req,"CREATE_ASSIGNMENT","teacher_assignments",rows[0].id,null,rows[0]);
      return res.status(201).json({ success:true, data:rows[0] });
    } catch(err) {
      if (err.code==="23505") return res.status(409).json({ success:false, message:"Assignment already exists." });
      return res.status(500).json({ success:false, message:"Server error." });
    }
  }
);

router.delete("/:id", authMiddleware, roleMiddleware(MANAGE), async (req, res) => {
  try {
    const { rows } = await db.query("SELECT school_id FROM teacher_assignments WHERE id=$1",[req.params.id]);
    if (!rows.length) return res.status(404).json({ success:false, message:"Not found." });
    if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id) return res.status(403).json({ success:false, message:"Access denied." });
    await db.query("DELETE FROM teacher_assignments WHERE id=$1",[req.params.id]);
    await audit(req,"DELETE_ASSIGNMENT","teacher_assignments",req.params.id);
    return res.json({ success:true, message:"Assignment removed." });
  } catch(err) { return res.status(500).json({ success:false, message:"Server error." }); }
});

module.exports = router;
