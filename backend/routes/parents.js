/**
 * /api/parents
 * Parents are users with role='PARENT', linked to students via parent_students.
 * SCHOOL_ADMIN — full CRUD for own school
 * SUPER_ADMIN  — all schools
 * TEACHER      — read-only for own school
 * PARENT       — own record only
 * Isolation: school_id ALWAYS from JWT, never body, for non-SUPER_ADMIN
 */
const express = require("express");
const { body, validationResult } = require("express-validator");
const bcrypt   = require("bcryptjs");
const db       = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");

const router = express.Router();

// ─── GET /api/parents ────────────────────────────────────────────
router.get("/", authMiddleware, async (req, res) => {
    try {
        const { role, school_id, id: userId } = req.user;

        if (!["SUPER_ADMIN","SCHOOL_ADMIN","TEACHER","PARENT"].includes(role))
            return res.status(403).json({ success: false, message: "Access denied." });

        // PARENT sees only own record
        if (role === "PARENT") {
            const { rows } = await db.query(
                `SELECT u.id, u.email, u.name, u.phone, u.is_active, u.school_id,
                        array_agg(json_build_object('id', s.id, 'name', s.full_name, 'admission_no', s.admission_no)) AS children
                 FROM users u
                 LEFT JOIN parent_students ps ON ps.parent_id = u.id
                 LEFT JOIN students s ON s.id = ps.student_id
                 WHERE u.id = $1
                 GROUP BY u.id`, [userId]
            );
            return res.json({ success: true, data: rows });
        }

        // Staff: enforce school isolation
        const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id || null) : school_id;
        if (!schoolId && role !== "SUPER_ADMIN")
            return res.status(403).json({ success: false, message: "School isolation error." });

        let q = `SELECT u.id, u.email, u.name, u.phone, u.is_active, u.school_id, u.created_at,
                        s.name AS school_name,
                        COALESCE(
                            json_agg(json_build_object('id', st.id, 'name', st.full_name, 'admission_no', st.admission_no))
                            FILTER (WHERE st.id IS NOT NULL), '[]'
                        ) AS children
                 FROM users u
                 LEFT JOIN schools s ON s.id = u.school_id
                 LEFT JOIN parent_students ps ON ps.parent_id = u.id
                 LEFT JOIN students st ON st.id = ps.student_id
                 WHERE u.role = 'PARENT'`;
        const params = [];
        if (schoolId) { params.push(schoolId); q += ` AND u.school_id=$${params.length}`; }
        if (req.query.is_active !== undefined) {
            params.push(req.query.is_active === "true");
            q += ` AND u.is_active=$${params.length}`;
        }
        q += " GROUP BY u.id, s.name ORDER BY u.name";

        const { rows } = await db.query(q, params);
        return res.json({ success: true, data: rows, count: rows.length });
    } catch (err) {
        console.error("GET /api/parents:", err.message);
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

// ─── GET /api/parents/:id ────────────────────────────────────────
router.get("/:id", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN","TEACHER","PARENT"]), async (req, res) => {
    try {
        const { role, school_id, id: userId } = req.user;
        const targetId = req.params.id;

        // PARENT can only view own record
        if (role === "PARENT" && targetId !== userId)
            return res.status(403).json({ success: false, message: "Access denied." });

        const { rows } = await db.query(
            `SELECT u.id, u.email, u.name, u.phone, u.is_active, u.school_id, u.created_at,
                    COALESCE(
                        json_agg(json_build_object('id', s.id, 'name', s.full_name, 'admission_no', s.admission_no))
                        FILTER (WHERE s.id IS NOT NULL), '[]'
                    ) AS children
             FROM users u
             LEFT JOIN parent_students ps ON ps.parent_id = u.id
             LEFT JOIN students s ON s.id = ps.student_id
             WHERE u.id = $1 AND u.role = 'PARENT'
             GROUP BY u.id`, [targetId]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: "Parent not found." });

        // Staff: enforce school isolation
        if (role !== "SUPER_ADMIN" && rows[0].school_id !== school_id)
            return res.status(403).json({ success: false, message: "Access denied." });

        return res.json({ success: true, data: rows[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

// ─── POST /api/parents — SCHOOL_ADMIN creates a parent user ─────
router.post("/", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]),
    [
        body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
        body("name").trim().notEmpty().withMessage("Name required").isLength({ max: 150 }),
        body("password").isLength({ min: 8 }).withMessage("Password min 8 chars"),
        body("phone").optional().matches(/^\+?[\d\s\-]{7,20}$/).withMessage("Invalid phone"),
    ],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const { email, name, password, phone } = req.body;
            // school_id always from JWT for SCHOOL_ADMIN
            const schoolId = req.user.role === "SUPER_ADMIN"
                ? (req.body.school_id || req.user.school_id)
                : req.user.school_id;

            if (!schoolId) return res.status(400).json({ success: false, message: "school_id required." });

            const dup = await db.query("SELECT id FROM users WHERE email=$1", [email]);
            if (dup.rows.length) return res.status(409).json({ success: false, message: "Email already registered." });

            const hash = await bcrypt.hash(password, 12);
            const { rows } = await db.query(
                `INSERT INTO users (email, password_hash, name, phone, role, school_id, must_change_password)
                 VALUES ($1,$2,$3,$4,'PARENT',$5,TRUE)
                 RETURNING id, email, name, phone, role, school_id, is_active, created_at`,
                [email, hash, name, phone || null, schoolId]
            );
            await audit(req, "CREATE", "users", rows[0].id, null, { email, role: "PARENT", school_id: schoolId });
            return res.status(201).json({ success: true, message: "Parent account created.", data: rows[0] });
        } catch (err) {
            return res.status(500).json({ success: false, message: "Server error." });
        }
    }
);

// ─── PUT /api/parents/:id ────────────────────────────────────────
router.put("/:id", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const existing = await db.query("SELECT * FROM users WHERE id=$1 AND role='PARENT'", [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ success: false, message: "Parent not found." });

        // School isolation
        if (req.user.role !== "SUPER_ADMIN" && existing.rows[0].school_id !== req.user.school_id)
            return res.status(403).json({ success: false, message: "Access denied." });

        const { name, phone, is_active } = req.body;
        const { rows } = await db.query(
            `UPDATE users SET name=COALESCE($1,name), phone=COALESCE($2,phone),
             is_active=COALESCE($3,is_active), updated_at=NOW()
             WHERE id=$4 RETURNING id, email, name, phone, role, school_id, is_active`,
            [name || null, phone || null, is_active ?? null, req.params.id]
        );
        await audit(req, "UPDATE", "users", req.params.id, existing.rows[0], rows[0]);
        return res.json({ success: true, message: "Parent updated.", data: rows[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

// ─── DELETE /api/parents/:id (deactivate) ───────────────────────
router.delete("/:id", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const existing = await db.query("SELECT * FROM users WHERE id=$1 AND role='PARENT'", [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ success: false, message: "Parent not found." });

        if (req.user.role !== "SUPER_ADMIN" && existing.rows[0].school_id !== req.user.school_id)
            return res.status(403).json({ success: false, message: "Access denied." });

        await db.query("UPDATE users SET is_active=FALSE WHERE id=$1", [req.params.id]);
        await audit(req, "DEACTIVATE", "users", req.params.id, { is_active: true }, { is_active: false });
        return res.json({ success: true, message: "Parent deactivated." });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

// ─── POST /api/parents/:id/link-student ─────────────────────────
router.post("/:id/link-student", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]),
    [body("student_id").notEmpty().withMessage("student_id required")],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const parent = await db.query("SELECT * FROM users WHERE id=$1 AND role='PARENT'", [req.params.id]);
            if (!parent.rows.length) return res.status(404).json({ success: false, message: "Parent not found." });

            const student = await db.query("SELECT * FROM students WHERE id=$1", [req.body.student_id]);
            if (!student.rows.length) return res.status(404).json({ success: false, message: "Student not found." });

            // Both must belong to same school for non-SUPER_ADMIN
            if (req.user.role !== "SUPER_ADMIN") {
                if (parent.rows[0].school_id !== req.user.school_id || student.rows[0].school_id !== req.user.school_id)
                    return res.status(403).json({ success: false, message: "Cross-school link denied." });
            }

            await db.query(
                `INSERT INTO parent_students (parent_id, student_id) VALUES ($1,$2)
                 ON CONFLICT (parent_id, student_id) DO NOTHING`,
                [req.params.id, req.body.student_id]
            );
            await audit(req, "LINK_PARENT_STUDENT", "parent_students", null, null, { parent_id: req.params.id, student_id: req.body.student_id });
            return res.json({ success: true, message: "Student linked to parent." });
        } catch (err) {
            return res.status(500).json({ success: false, message: "Server error." });
        }
    }
);

module.exports = router;
