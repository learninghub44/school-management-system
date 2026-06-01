/**
 * /api/students
 * Access rules:
 *   SUPER_ADMIN  — all schools
 *   SCHOOL_ADMIN — own school only
 *   TEACHER      — own school only (read-only list)
 *   FINANCE      — own school only (read-only list for fee lookup)
 *   STUDENT      — own record only
 *   PARENT       — only children linked in parent_students
 */
const express = require("express");
const { body, validationResult } = require("express-validator");
const bcrypt  = require("bcryptjs");
const db      = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const { audit } = require("../middleware/auditLog");
const roleMiddleware = require("../middleware/roleMiddleware");

const router = express.Router();

// ─── GET /api/students ────────────────────────────────────────────────────────
router.get("/", authMiddleware, async (req, res) => {
    try {
        const { role, school_id, id: userId } = req.user;

        // STUDENT sees only their own record
        if (role === "STUDENT") {
            const { rows } = await db.query(
                `SELECT s.*, g.grade_level, g.stage FROM students s
                 LEFT JOIN grades g ON g.id=s.grade_id
                 WHERE s.user_id=$1`, [userId]
            );
            return res.json({ success: true, data: rows });
        }

        // PARENT sees only their linked children
        if (role === "PARENT") {
            const { rows } = await db.query(
                `SELECT s.*, g.grade_level, g.stage FROM students s
                 LEFT JOIN grades g ON g.id=s.grade_id
                 INNER JOIN parent_students ps ON ps.student_id=s.id
                 WHERE ps.parent_id=$1 AND s.is_active=TRUE`, [userId]
            );
            return res.json({ success: true, data: rows });
        }

        // TEACHER, FINANCE, SCHOOL_ADMIN, SUPER_ADMIN
        if (!["SUPER_ADMIN","SCHOOL_ADMIN","TEACHER","FINANCE"].includes(role))
            return res.status(403).json({ success: false, message: "Access denied." });

        const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id||null) : school_id;
        if (!schoolId && role !== "SUPER_ADMIN") return res.status(403).json({ success: false, message: "Isolation error." });
        let q = `SELECT s.*, g.grade_level, g.stage FROM students s LEFT JOIN grades g ON g.id=s.grade_id`;
        const params = [], where = [];
        if (schoolId) { params.push(schoolId); where.push(`s.school_id=$${params.length}`); }
        if (req.query.grade_id) { params.push(req.query.grade_id); where.push(`s.grade_id=$${params.length}`); }
        if (req.query.is_active !== undefined) { params.push(req.query.is_active === "true"); where.push(`s.is_active=$${params.length}`); }
        if (where.length) q += " WHERE " + where.join(" AND ");
        q += " ORDER BY s.full_name";
        const { rows } = await db.query(q, params);
        return res.json({ success: true, data: rows, count: rows.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/students/:id ────────────────────────────────────────────────────
router.get("/:id", authMiddleware, async (req, res) => {
    try {
        const { role, school_id, id: userId } = req.user;
        const { rows } = await db.query(
            `SELECT s.*, g.grade_level, g.stage, sc.name AS school_name, sc.school_code
             FROM students s LEFT JOIN grades g ON g.id=s.grade_id
             LEFT JOIN schools sc ON sc.id=s.school_id WHERE s.id=$1`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: "Student not found." });
        const student = rows[0];

        if (role === "STUDENT" && student.user_id !== userId)
            return res.status(403).json({ success: false, message: "Access denied." });
        if (role === "PARENT") {
            const link = await db.query(
                "SELECT id FROM parent_students WHERE parent_id=$1 AND student_id=$2", [userId, student.id]
            );
            if (!link.rows.length) return res.status(403).json({ success: false, message: "Not your child." });
        }
        if (["TEACHER","FINANCE","SCHOOL_ADMIN"].includes(role) && student.school_id !== school_id)
            return res.status(403).json({ success: false, message: "Access denied." });
        // V-03: Double-check school isolation regardless of role
        if (role !== "SUPER_ADMIN" && role !== "STUDENT" && role !== "PARENT" && student.school_id !== school_id)
            return res.status(403).json({ success: false, message: "Access denied." });

        return res.json({ success: true, data: student });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── POST /api/students ───────────────────────────────────────────────────────
// Creates student record. If create_account=true, also creates a user account.
router.post("/", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]),
    [
        body("full_name").trim().notEmpty().withMessage("Full name required"),
        body("admission_no").trim().notEmpty().withMessage("Admission number required"),
        body("grade_id").isInt().withMessage("Grade required"),
        body("gender").optional().isIn(["male","female","other"]),
        // Optional login account
        body("email").optional().isEmail(),
        body("password").optional().isLength({ min: 6 }),
    ],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const schoolId = req.user.role === "SUPER_ADMIN" ? (req.body.school_id||req.user.school_id) : req.user.school_id;
            const { full_name, admission_no, grade_id, date_of_birth, gender,
                    parent_name, parent_phone, parent_email, address,
                    email, password, create_account } = req.body;

            let userId = null;

            // Optionally create a login account for this student
            if (create_account && email && password) {
                const dup = await db.query("SELECT id FROM users WHERE email=$1", [email.toLowerCase()]);
                if (dup.rows.length) return res.status(409).json({ success: false, message: "Email already registered." });
                const hash = await bcrypt.hash(password, 12);
                const u = await db.query(
                    `INSERT INTO users (email, password_hash, name, role, school_id)
                     VALUES ($1,$2,$3,'STUDENT',$4) RETURNING id`,
                    [email.toLowerCase(), hash, full_name, schoolId]
                );
                userId = u.rows[0].id;
            }

            const { rows } = await db.query(
                `INSERT INTO students
                  (school_id, user_id, full_name, admission_no, grade_id,
                   date_of_birth, gender, parent_name, parent_phone, parent_email, address)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
                [schoolId, userId, full_name, admission_no, grade_id,
                 date_of_birth||null, gender||null, parent_name||null,
                 parent_phone||null, parent_email||null, address||null]
            );

            // Update user name links
            if (userId) await db.query("UPDATE students SET user_id=$1 WHERE id=$2", [userId, rows[0].id]);

            const full = await db.query(
                "SELECT s.*, g.grade_level, g.stage FROM students s LEFT JOIN grades g ON g.id=s.grade_id WHERE s.id=$1",
                [rows[0].id]
            );
            await audit(req, "CREATE", "students", full.rows[0].id, null, { full_name, admission_no, grade_id, school_id: schoolId });
            return res.status(201).json({ success: true, message: "Student created.", data: full.rows[0] });
        } catch (err) {
            if (err.code === "23505") return res.status(409).json({ success: false, message: "Admission number already exists." });
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

// ─── PUT /api/students/:id ────────────────────────────────────────────────────
router.put("/:id", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const existing = await db.query("SELECT school_id FROM students WHERE id=$1", [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ success: false, message: "Student not found." });
        if (req.user.role !== "SUPER_ADMIN" && existing.rows[0].school_id !== req.user.school_id)
            return res.status(403).json({ success: false, message: "Access denied." });
        const { full_name, grade_id, stream_id, current_class_id, date_of_birth, gender, parent_name, parent_phone, parent_email, address, is_active } = req.body;
        const { rows } = await db.query(
            `UPDATE students SET
               full_name=COALESCE($1,full_name), grade_id=COALESCE($2,grade_id),
               stream_id=COALESCE($3,stream_id), current_class_id=COALESCE($4,current_class_id),
               date_of_birth=COALESCE($5,date_of_birth), gender=COALESCE($6,gender),
               parent_name=COALESCE($7,parent_name), parent_phone=COALESCE($8,parent_phone),
               parent_email=COALESCE($9,parent_email), address=COALESCE($10,address),
               is_active=COALESCE($11,is_active) WHERE id=$12 RETURNING *`,
            [full_name||null, grade_id||null, stream_id||null, current_class_id||null,
             date_of_birth||null, gender||null, parent_name||null, parent_phone||null,
             parent_email||null, address||null, is_active??null, req.params.id]
        );
        return res.json({ success: true, message: "Student updated.", data: rows[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── DELETE /api/students/:id ─────────────────────────────────────────────────
router.delete("/:id", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const existing = await db.query("SELECT school_id FROM students WHERE id=$1", [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ success: false, message: "Student not found." });
        if (req.user.role !== "SUPER_ADMIN" && existing.rows[0].school_id !== req.user.school_id)
            return res.status(403).json({ success: false, message: "Access denied." });
        await db.query("UPDATE students SET is_active=FALSE WHERE id=$1", [req.params.id]);
        await audit(req, "DEACTIVATE", "students", req.params.id);
        return res.json({ success: true, message: "Student deactivated." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── POST /api/students/:id/link-parent ──────────────────────────────────────
router.post("/:id/link-parent", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]),
    [body("parent_id").notEmpty().withMessage("parent_id required")],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const student = await db.query("SELECT * FROM students WHERE id=$1", [req.params.id]);
            if (!student.rows.length) return res.status(404).json({ success: false, message: "Student not found." });
            if (req.user.role !== "SUPER_ADMIN" && student.rows[0].school_id !== req.user.school_id)
                return res.status(403).json({ success: false, message: "Access denied." });

            const parent = await db.query("SELECT id, role, school_id FROM users WHERE id=$1", [req.body.parent_id]);
            if (!parent.rows.length) return res.status(404).json({ success: false, message: "Parent not found." });
            if (parent.rows[0].role !== "PARENT") return res.status(400).json({ success: false, message: "User is not a parent." });
            // Verify parent belongs to same school
            if (req.user.role !== "SUPER_ADMIN" && parent.rows[0].school_id !== student.rows[0].school_id)
                return res.status(403).json({ success: false, message: "Parent not in same school." });

            await db.query(
                `INSERT INTO parent_students (parent_id, student_id, school_id)
                 VALUES ($1,$2,$3) ON CONFLICT (parent_id, student_id) DO NOTHING`,
                [req.body.parent_id, req.params.id, student.rows[0].school_id]
            );
            return res.json({ success: true, message: "Parent linked to student." });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

module.exports = router;
