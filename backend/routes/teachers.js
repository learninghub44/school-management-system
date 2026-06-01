const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const router = express.Router();

router.get("/", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN","TEACHER"]), async (req, res) => {
    try {
        const schoolId = req.user.role === "SUPER_ADMIN" ? (req.query.school_id||null) : req.user.school_id;
        let q = "SELECT * FROM teachers";
        const params = [];
        if (schoolId) { q += " WHERE school_id=$1"; params.push(schoolId); }
        q += " ORDER BY full_name";
        const { rows } = await db.query(q, params);
        return res.json({ success: true, data: rows, count: rows.length });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get("/:id", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN","TEACHER"]), async (req, res) => {
    try {
        const { rows } = await db.query("SELECT * FROM teachers WHERE id=$1", [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Teacher not found." });
        if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
            return res.status(403).json({ success: false, message: "Access denied." });
        return res.json({ success: true, data: rows[0] });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.post("/", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]),
    [body("full_name").trim().notEmpty().withMessage("Full name required")],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const schoolId = req.user.role === "SUPER_ADMIN" ? (req.body.school_id||req.user.school_id) : req.user.school_id;
            const { full_name, email, phone, tsc_no, department, subjects, user_id } = req.body;
            const { rows } = await db.query(
                `INSERT INTO teachers (school_id, user_id, full_name, email, phone, tsc_no, department, subjects)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
                [schoolId, user_id||null, full_name, email||null, phone||null, tsc_no||null, department||null, subjects||[]]
            );
            return res.status(201).json({ success: true, message: "Teacher created.", data: rows[0] });
        } catch (err) {
            if (err.code === "23505") return res.status(409).json({ success: false, message: "TSC number already exists." });
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

router.put("/:id", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const existing = await db.query("SELECT school_id FROM teachers WHERE id=$1", [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ success: false, message: "Teacher not found." });
        if (req.user.role !== "SUPER_ADMIN" && existing.rows[0].school_id !== req.user.school_id)
            return res.status(403).json({ success: false, message: "Access denied." });
        const { full_name, email, phone, tsc_no, department, subjects, is_active } = req.body;
        const { rows } = await db.query(
            `UPDATE teachers SET full_name=COALESCE($1,full_name), email=COALESCE($2,email),
             phone=COALESCE($3,phone), tsc_no=COALESCE($4,tsc_no), department=COALESCE($5,department),
             subjects=COALESCE($6,subjects), is_active=COALESCE($7,is_active) WHERE id=$8 RETURNING *`,
            [full_name||null, email||null, phone||null, tsc_no||null, department||null, subjects||null, is_active??null, req.params.id]
        );
        return res.json({ success: true, message: "Teacher updated.", data: rows[0] });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.delete("/:id", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const existing = await db.query("SELECT school_id FROM teachers WHERE id=$1", [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ success: false, message: "Teacher not found." });
        if (req.user.role !== "SUPER_ADMIN" && existing.rows[0].school_id !== req.user.school_id)
            return res.status(403).json({ success: false, message: "Access denied." });
        await db.query("UPDATE teachers SET is_active=FALSE WHERE id=$1", [req.params.id]);
        return res.json({ success: true, message: "Teacher deactivated." });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
