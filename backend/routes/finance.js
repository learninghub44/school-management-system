/**
 * /api/finance
 * SUPER_ADMIN  — all schools
 * SCHOOL_ADMIN — own school
 * FINANCE      — own school (record + view payments, fee structures)
 * TEACHER      — NO ACCESS
 * STUDENT      — own fee balance + own payment history only
 * PARENT       — children's fee balance + payment history only
 */
const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const { audit } = require("../middleware/auditLog");
const roleMiddleware = require("../middleware/roleMiddleware");

const router = express.Router();

// ─── GET /api/finance/payments ────────────────────────────────────────────────
router.get("/payments", authMiddleware, async (req, res) => {
    try {
        const { role, school_id, id: userId } = req.user;

        if (role === "TEACHER")
            return res.status(403).json({ success: false, message: "Access denied." });

        let q = `SELECT p.*, s.full_name AS student_name, s.admission_no
                 FROM payments p LEFT JOIN students s ON s.id=p.student_id`;
        const params = [], where = [];

        if (role === "STUDENT") {
            const me = await db.query("SELECT id FROM students WHERE user_id=$1", [userId]);
            if (!me.rows.length) return res.json({ success: true, data: [] });
            params.push(me.rows[0].id); where.push(`p.student_id=$${params.length}`);
        } else if (role === "PARENT") {
            const kids = await db.query("SELECT student_id FROM parent_students WHERE parent_id=$1", [userId]);
            if (!kids.rows.length) return res.json({ success: true, data: [] });
            params.push(kids.rows.map(r => r.student_id));
            where.push(`p.student_id = ANY($${params.length})`);
        } else {
            const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id||null) : school_id;
            if (schoolId) { params.push(schoolId); where.push(`p.school_id=$${params.length}`); }
            else if (role !== "SUPER_ADMIN") { return res.status(403).json({ success: false, message: "School isolation error." }); }
            if (req.query.student_id) { params.push(req.query.student_id); where.push(`p.student_id=$${params.length}`); }
            if (req.query.term) { params.push(req.query.term); where.push(`p.term=$${params.length}`); }
            if (req.query.year) { params.push(req.query.year); where.push(`p.year=$${params.length}`); }
        }

        if (where.length) q += " WHERE " + where.join(" AND ");
        q += " ORDER BY p.created_at DESC";
        const { rows } = await db.query(q, params);
        return res.json({ success: true, data: rows, count: rows.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── POST /api/finance/payments ───────────────────────────────────────────────
router.post("/payments", authMiddleware,
    roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN","FINANCE"]),
    [
        body("student_id").notEmpty(),
        body("amount").isFloat({ min: 0.01 }),
        body("method").trim().notEmpty(),
        body("term").isInt({ min:1, max:3 }),
        body("year").isInt({ min:2000 }),
    ],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const schoolId = req.user.role === "SUPER_ADMIN" ? (req.body.school_id||req.user.school_id) : req.user.school_id;
            const { student_id, amount, method, reference, term, year, notes } = req.body;

            const st = await db.query("SELECT id, school_id FROM students WHERE id=$1", [student_id]);
            if (!st.rows.length) return res.status(404).json({ success: false, message: "Student not found." });
            if (req.user.role !== "SUPER_ADMIN" && st.rows[0].school_id !== schoolId)
                return res.status(403).json({ success: false, message: "Student not in your school." });

            const { rows } = await db.query(
                `INSERT INTO payments (school_id, student_id, amount, method, reference, term, year, notes, recorded_by, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'COMPLETED') RETURNING *`,
                [schoolId, student_id, amount, method, reference||null, term, year, notes||null, req.user.id]
            );
            const full = await db.query(
                `SELECT p.*, s.full_name AS student_name, s.admission_no
                 FROM payments p LEFT JOIN students s ON s.id=p.student_id WHERE p.id=$1`,
                [rows[0].id]
            );
            await audit(req, "CREATE", "payments", full.rows[0].id, null,
                { student_id, amount, method, term, year, reference });
            return res.status(201).json({ success: true, message: "Payment recorded.", data: full.rows[0] });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

// ─── GET /api/finance/summary  (ADMIN + FINANCE only — not TEACHER/STUDENT/PARENT) ──
router.get("/summary", authMiddleware,
    roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN","FINANCE"]),
    async (req, res) => {
        try {
            const schoolId = req.user.role === "SUPER_ADMIN" ? (req.query.school_id||null) : req.user.school_id;
            const year = req.query.year || new Date().getFullYear();
            const params = [year];
            let cond = "year=$1 AND status='COMPLETED'";
            if (schoolId) { params.push(schoolId); cond += ` AND school_id=$${params.length}`; }

            const byTerm = await db.query(
                `SELECT term, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
                 FROM payments WHERE ${cond} GROUP BY term ORDER BY term`, params
            );
            const total = await db.query(
                `SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE ${cond}`, params
            );
            const result = [1,2,3].map(t => {
                const f = byTerm.rows.find(r => parseInt(r.term) === t);
                return { term: t, count: parseInt(f?.count||0), total: parseFloat(f?.total||0) };
            });
            return res.json({ success: true, data: {
                total_revenue: parseFloat(total.rows[0].total),
                by_term: result, year
            }});
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

// ─── GET /api/finance/fee-structures ─────────────────────────────────────────
router.get("/fee-structures", authMiddleware, async (req, res) => {
    try {
        const { role, school_id } = req.user;
        if (role === "TEACHER")
            return res.status(403).json({ success: false, message: "Access denied." });

        const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id||null) : school_id;
        let q = `SELECT f.*, g.grade_level FROM fee_structures f LEFT JOIN grades g ON g.id=f.grade_id`;
        const params = [];
        if (schoolId) { q += " WHERE f.school_id=$1"; params.push(schoolId); }
        else if (role !== "SUPER_ADMIN") { return res.status(403).json({ success: false, message: "School isolation error." }); }
        q += " ORDER BY f.year DESC, f.term";
        const { rows } = await db.query(q, params);
        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── POST /api/finance/fee-structures ────────────────────────────────────────
router.post("/fee-structures", authMiddleware,
    roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]),
    [
        body("grade_id").isInt(),
        body("term").isInt({ min:1, max:3 }),
        body("year").isInt({ min:2000 }),
        body("amount").isFloat({ min:0 }),
    ],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const schoolId = req.user.role === "SUPER_ADMIN" ? (req.body.school_id||req.user.school_id) : req.user.school_id;
            const { grade_id, term, year, amount, description } = req.body;
            const { rows } = await db.query(
                `INSERT INTO fee_structures (school_id, grade_id, term, year, amount, description)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
                [schoolId, grade_id, term, year, amount, description||null]
            );
            return res.status(201).json({ success: true, message: "Fee structure created.", data: rows[0] });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

// ─── GET /api/finance/balance/:student_id  (student + parent can call this) ──
router.get("/balance/:student_id", authMiddleware, async (req, res) => {
    try {
        const { role, school_id, id: userId } = req.user;
        const sid = req.params.student_id;

        if (role === "TEACHER")
            return res.status(403).json({ success: false, message: "Access denied." });
        if (role === "STUDENT") {
            const me = await db.query("SELECT id FROM students WHERE user_id=$1", [userId]);
            if (!me.rows.length || me.rows[0].id !== sid)
                return res.status(403).json({ success: false, message: "Access denied." });
        }
        if (role === "PARENT") {
            const link = await db.query("SELECT id FROM parent_students WHERE parent_id=$1 AND student_id=$2", [userId, sid]);
            if (!link.rows.length) return res.status(403).json({ success: false, message: "Not your child." });
        }

        const student = await db.query(
            "SELECT s.*, g.grade_level FROM students s LEFT JOIN grades g ON g.id=s.grade_id WHERE s.id=$1", [sid]
        );
        if (!student.rows.length) return res.status(404).json({ success: false, message: "Student not found." });

        const year = req.query.year || new Date().getFullYear();
        const payments = await db.query(
            "SELECT term, SUM(amount) AS paid FROM payments WHERE student_id=$1 AND year=$2 AND status='COMPLETED' GROUP BY term",
            [sid, year]
        );
        const fees = await db.query(
            "SELECT term, amount AS expected FROM fee_structures WHERE school_id=$1 AND grade_id=$2 AND year=$3",
            [student.rows[0].school_id, student.rows[0].grade_id, year]
        );

        const balance = [1,2,3].map(t => {
            const p = payments.rows.find(r => parseInt(r.term) === t);
            const f = fees.rows.find(r => parseInt(r.term) === t);
            const paid = parseFloat(p?.paid||0);
            const expected = parseFloat(f?.expected||0);
            return { term: t, expected, paid, balance: expected - paid };
        });

        return res.json({ success: true, data: { student: student.rows[0], year, balance } });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
