/**
 * /api/schools
 * SUPER_ADMIN: full CRUD + activate/deactivate + create school admins
 * SCHOOL_ADMIN: read own school only
 */
const express = require("express");
const { body, validationResult } = require("express-validator");
const bcrypt  = require("bcryptjs");
const db      = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const { audit } = require("../middleware/auditLog");
const roleMiddleware = require("../middleware/roleMiddleware");
require("dotenv").config();

const router = express.Router();

// GET /api/schools
router.get("/", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]), async (req, res) => {
    try {
        let q, params = [];
        if (req.user.role === "SUPER_ADMIN") {
            q = `SELECT s.*,
                   (SELECT COUNT(*) FROM users u WHERE u.school_id=s.id AND u.is_active=TRUE) AS staff_count,
                   (SELECT COUNT(*) FROM students st WHERE st.school_id=s.id AND st.is_active=TRUE) AS student_count
                 FROM schools s ORDER BY s.created_at DESC`;
        } else {
            q = "SELECT * FROM schools WHERE id=$1";
            params = [req.user.school_id];
        }
        const { rows } = await db.query(q, params);
        return res.json({ success: true, data: rows, count: rows.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/schools/:id
router.get("/:id", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const id = req.params.id;
        if (req.user.role === "SCHOOL_ADMIN" && req.user.school_id !== id)
            return res.status(403).json({ success: false, message: "Access denied." });
        const { rows } = await db.query("SELECT * FROM schools WHERE id=$1", [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "School not found." });
        return res.json({ success: true, data: rows[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/schools  — SUPER_ADMIN only
router.post("/", authMiddleware, roleMiddleware(["SUPER_ADMIN"]),
    [
        body("name").trim().notEmpty().withMessage("School name required"),
        body("school_code").trim().notEmpty().withMessage("School code required")
            .matches(/^[A-Z0-9\-]+$/i).withMessage("Code: letters, numbers, hyphens only"),
        body("email").optional().isEmail(),
        body("level").optional().isIn(["ECDE","Primary","Junior Secondary","Senior Secondary"]),
    ],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const { name, school_code, county, sub_county, level, email, phone, address } = req.body;
            const code = school_code.toUpperCase().trim();
            const dup = await db.query("SELECT id FROM schools WHERE school_code=$1", [code]);
            if (dup.rows.length) return res.status(409).json({ success: false, message: `Code "${code}" already exists.` });
            const { rows } = await db.query(
                `INSERT INTO schools (name, school_code, county, sub_county, level, email, phone, address)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
                [name, code, county||null, sub_county||null, level||"Primary", email||null, phone||null, address||null]
            );
            await audit(req, "CREATE", "schools", rows[0].id, null, { name, school_code: code, level });
            await audit(req, "CREATE_SCHOOL_ADMIN", "users", rows[0].id, null, { email, school_id: schoolId });
            return res.status(201).json({ success: true, message: "School created.", data: rows[0] });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

// PUT /api/schools/:id  — SUPER_ADMIN only
router.put("/:id", authMiddleware, roleMiddleware(["SUPER_ADMIN"]),
    async (req, res) => {
        try {
            const { name, county, sub_county, level, email, phone, address } = req.body;
            const { rows } = await db.query(
                `UPDATE schools SET name=COALESCE($1,name), county=COALESCE($2,county),
                 sub_county=COALESCE($3,sub_county), level=COALESCE($4,level),
                 email=COALESCE($5,email), phone=COALESCE($6,phone),
                 address=COALESCE($7,address), updated_at=NOW()
                 WHERE id=$8 RETURNING *`,
                [name||null, county||null, sub_county||null, level||null, email||null, phone||null, address||null, req.params.id]
            );
            if (!rows.length) return res.status(404).json({ success: false, message: "School not found." });
            return res.json({ success: true, message: "School updated.", data: rows[0] });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

// PATCH /api/schools/:id/status  — SUPER_ADMIN activate/deactivate
router.patch("/:id/status", authMiddleware, roleMiddleware(["SUPER_ADMIN"]),
    [body("is_active").isBoolean().withMessage("is_active must be true or false")],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const { is_active } = req.body;
            const { rows } = await db.query(
                "UPDATE schools SET is_active=$1, updated_at=NOW() WHERE id=$2 RETURNING id, name, school_code, is_active",
                [is_active, req.params.id]
            );
            if (!rows.length) return res.status(404).json({ success: false, message: "School not found." });
            const action = is_active ? "activated" : "deactivated";
            await audit(req, is_active ? "ACTIVATE_SCHOOL" : "DEACTIVATE_SCHOOL", "schools", req.params.id,
                { is_active: !is_active }, { is_active });
            return res.json({ success: true, message: `School "${rows[0].name}" ${action}.`, data: rows[0] });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

// POST /api/schools/:id/admin  — SUPER_ADMIN creates school admin
router.post("/:id/admin", authMiddleware, roleMiddleware(["SUPER_ADMIN"]),
    [
        body("email").isEmail().withMessage("Valid email required"),
        body("name").trim().notEmpty().withMessage("Name required"),
        body("password").isLength({ min: 8 }).withMessage("Min 8 chars"),
    ],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const { email, name, password, phone } = req.body;
            const schoolId = req.params.id;
            const school = await db.query("SELECT id, name, is_active FROM schools WHERE id=$1", [schoolId]);
            if (!school.rows.length) return res.status(404).json({ success: false, message: "School not found." });
            if (!school.rows[0].is_active) return res.status(400).json({ success: false, message: "School is deactivated." });
            const dup = await db.query("SELECT id FROM users WHERE email=$1", [email.toLowerCase()]);
            if (dup.rows.length) return res.status(409).json({ success: false, message: "Email already registered." });
            const hash = await bcrypt.hash(password, 12);
            const { rows } = await db.query(
                `INSERT INTO users (email, password_hash, name, phone, role, school_id)
                 VALUES ($1,$2,$3,$4,'SCHOOL_ADMIN',$5) RETURNING id, email, name, role, phone, school_id`,
                [email.toLowerCase(), hash, name, phone||null, schoolId]
            );
            return res.status(201).json({
                success: true,
                message: `Admin created for ${school.rows[0].name}.`,
                data: { ...rows[0], school_name: school.rows[0].name }
            });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

// GET /api/schools/:id/stats
router.get("/:id/stats", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const id = req.params.id;
        if (req.user.role === "SCHOOL_ADMIN" && req.user.school_id !== id)
            return res.status(403).json({ success: false, message: "Access denied." });
        const [st, tc, st2, rev] = await Promise.all([
            db.query("SELECT COUNT(*) FROM students WHERE school_id=$1 AND is_active=TRUE", [id]),
            db.query("SELECT COUNT(*) FROM teachers WHERE school_id=$1 AND is_active=TRUE", [id]),
            db.query("SELECT COUNT(*) FROM users WHERE school_id=$1 AND is_active=TRUE", [id]),
            db.query("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE school_id=$1 AND status='COMPLETED'", [id]),
        ]);
        return res.json({ success: true, data: {
            students:      parseInt(st.rows[0].count),
            teachers:      parseInt(tc.rows[0].count),
            staff:         parseInt(st2.rows[0].count),
            total_revenue: parseFloat(rev.rows[0].total),
        }});
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
