/**
 * /api/assessments
 * CBC KICD-aligned — uses learning_areas + strands
 * TEACHER      — read/write own school
 * STUDENT      — read own records only
 * PARENT       — read children's records only
 * SCHOOL_ADMIN — read/write own school
 * SUPER_ADMIN  — all schools
 * FINANCE      — NO ACCESS (revenue data only)
 */
const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const { audit } = require("../middleware/auditLog");
const roleMiddleware = require("../middleware/roleMiddleware");

const router = express.Router();

// GET /api/assessments
router.get("/", authMiddleware, async (req, res) => {
    try {
        const { role, school_id, id: userId } = req.user;

        // FINANCE: no access to assessments
        if (role === "FINANCE")
            return res.status(403).json({ success: false, message: "Access denied." });

        let q = `SELECT a.*, la.name AS learning_area_name, la.code AS learning_area_code,
                        st.name AS strand_name, st.sub_strand,
                        s.full_name AS student_name, s.admission_no,
                        g.grade_level
                 FROM assessments a
                 LEFT JOIN learning_areas la ON la.id=a.learning_area_id
                 LEFT JOIN strands st ON st.id=a.strand_id
                 LEFT JOIN students s ON s.id=a.student_id
                 LEFT JOIN grades g ON g.id=s.grade_id`;
        const params = [], where = [];

        if (role === "STUDENT") {
            // Only own assessments via student record
            const me = await db.query("SELECT id FROM students WHERE user_id=$1", [userId]);
            if (!me.rows.length) return res.json({ success: true, data: [] });
            params.push(me.rows[0].id); where.push(`a.student_id=$${params.length}`);
        } else if (role === "PARENT") {
            // Only children's assessments
            const kids = await db.query(
                "SELECT student_id FROM parent_students WHERE parent_id=$1", [userId]
            );
            if (!kids.rows.length) return res.json({ success: true, data: [] });
            const ids = kids.rows.map(r => r.student_id);
            params.push(ids); where.push(`a.student_id = ANY($${params.length})`);
        } else {
            const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id||null) : school_id;
            if (schoolId) { params.push(schoolId); where.push(`a.school_id=$${params.length}`); }
            if (req.query.student_id) { params.push(req.query.student_id); where.push(`a.student_id=$${params.length}`); }
            if (req.query.term) { params.push(req.query.term); where.push(`a.term=$${params.length}`); }
            if (req.query.year) { params.push(req.query.year); where.push(`a.year=$${params.length}`); }
        }

        if (where.length) q += " WHERE " + where.join(" AND ");
        q += " ORDER BY a.assessment_date DESC";
        const { rows } = await db.query(q, params);
        return res.json({ success: true, data: rows, count: rows.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/assessments
router.post("/", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN","TEACHER"]),
    [
        body("student_id").notEmpty(),
        body("term").isInt({ min:1, max:3 }),
        body("year").isInt({ min:2020 }),
        body("grade").isIn(["EE","ME","AE","BE"]).withMessage("Grade must be EE/ME/AE/BE"),
        body("assessment_type").isIn(["formative","summative","project-based"]),
        body("learning_area_id").isInt().withMessage("Learning area required"),
    ],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const schoolId = req.user.role === "SUPER_ADMIN" ? (req.body.school_id||req.user.school_id) : req.user.school_id;
            const { student_id, learning_area_id, strand_id, teacher_id, term, year,
                    assessment_type, score, grade, competency_area, assessment_date, remarks } = req.body;

        // Verify student belongs to school
        const st = await db.query("SELECT school_id FROM students WHERE id=$1", [student_id]);
        if (!st.rows.length) return res.status(404).json({ success: false, message: "Student not found." });
        if (req.user.role !== "SUPER_ADMIN" && st.rows[0].school_id !== schoolId)
            return res.status(403).json({ success: false, message: "Student not in your school." });

        const { rows } = await db.query(
            `INSERT INTO assessments
              (school_id, student_id, learning_area_id, strand_id, teacher_id,
               term, year, assessment_type, score, grade, competency_area, assessment_date, remarks)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [st.rows[0].school_id, student_id, learning_area_id, strand_id||null, req.user.id,
             term, year, assessment_type, score||null, grade,
             competency_area||null, assessment_date||new Date().toISOString().split("T")[0], remarks||null]
        );
            await audit(req, "CREATE", "assessments", rows[0].id, null, { student_id, learning_area_id, grade, term, year });
            return res.status(201).json({ success: true, message: "Assessment recorded.", data: rows[0] });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

// GET /api/assessments/student/:id/report
router.get("/student/:id/report", authMiddleware, async (req, res) => {
    try {
        const { role, school_id, id: userId } = req.user;
        // Check access
        if (role === "STUDENT") {
            const me = await db.query("SELECT id FROM students WHERE user_id=$1", [userId]);
            if (!me.rows.length || me.rows[0].id !== req.params.id)
                return res.status(403).json({ success: false, message: "Access denied." });
        }
        if (role === "PARENT") {
            const link = await db.query("SELECT id FROM parent_students WHERE parent_id=$1 AND student_id=$2", [userId, req.params.id]);
            if (!link.rows.length) return res.status(403).json({ success: false, message: "Not your child." });
        }
        if (role === "FINANCE") return res.status(403).json({ success: false, message: "Access denied." });

        // Verify student ownership for staff
        if (["TEACHER", "SCHOOL_ADMIN"].includes(role)) {
            const st = await db.query("SELECT school_id FROM students WHERE id=$1", [req.params.id]);
            if (!st.rows.length || st.rows[0].school_id !== req.user.school_id)
                return res.status(403).json({ success: false, message: "Access denied." });
        }

        let q = `SELECT a.*, la.name AS learning_area_name, st.name AS strand_name, st.sub_strand
                 FROM assessments a
                 LEFT JOIN learning_areas la ON la.id=a.learning_area_id
                 LEFT JOIN strands st ON st.id=a.strand_id
                 WHERE a.student_id=$1`;
        const params = [req.params.id];
        if (req.query.term) { params.push(req.query.term); q += ` AND a.term=$${params.length}`; }
        if (req.query.year) { params.push(req.query.year); q += ` AND a.year=$${params.length}`; }
        q += " ORDER BY a.assessment_date DESC";
        const { rows } = await db.query(q, params);
        const grades = { EE:0, ME:0, AE:0, BE:0 };
        rows.forEach(r => { if (r.grade) grades[r.grade]++; });
        return res.json({ success: true, data: { assessments: rows, grade_summary: grades } });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/assessments/learning-areas  — reference data
router.get("/learning-areas", authMiddleware, async (req, res) => {
    try {
        const { rows } = await db.query(
            "SELECT * FROM learning_areas ORDER BY stage, name"
        );
        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/assessments/strands/:learning_area_id
router.get("/strands/:learning_area_id", authMiddleware, async (req, res) => {
    try {
        const { rows } = await db.query(
            "SELECT * FROM strands WHERE learning_area_id=$1 ORDER BY name",
            [req.params.learning_area_id]
        );
        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/assessments/student/:id/marks (Student Portal)
router.get("/student/:id/marks", authMiddleware, async (req, res) => {
    try {
        const { role, id: userId } = req.user;
        const studentId = req.params.id;

        // Verify access
        if (role === "STUDENT") {
            const me = await db.query("SELECT id FROM students WHERE user_id=$1", [userId]);
            if (!me.rows.length || me.rows[0].id !== parseInt(studentId))
                return res.status(403).json({ success: false, message: "Access denied." });
        } else if (role === "PARENT") {
            const link = await db.query("SELECT id FROM parent_students WHERE parent_id=$1 AND student_id=$2", [userId, studentId]);
            if (!link.rows.length) return res.status(403).json({ success: false, message: "Not your child." });
        } else if (role !== "SUPER_ADMIN") {
            return res.status(403).json({ success: false, message: "Access denied." });
        }

        const { rows } = await db.query(
            `SELECT a.*, la.name AS learning_area, ac.name AS category_name
             FROM assessments a
             LEFT JOIN learning_areas la ON la.id=a.learning_area_id
             LEFT JOIN assessment_categories ac ON ac.id=a.assessment_type
             WHERE a.student_id=$1
             ORDER BY a.assessment_date DESC`,
            [studentId]
        );
        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
