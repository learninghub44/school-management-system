/**
 * /api/finance — Enhanced Payment Recording System
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

// ─── GET /api/finance/payment-categories ────────────────────────────────────
router.get("/payment-categories", authMiddleware, async (req, res) => {
    try {
        const { role, school_id } = req.user;
        if (role === "TEACHER")
            return res.status(403).json({ success: false, message: "Access denied." });

        const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id || null) : school_id;
        let q = "SELECT * FROM payment_categories WHERE is_active=true";
        const params = [];
        if (schoolId) { q += " AND school_id=$1"; params.push(schoolId); }
        else if (role !== "SUPER_ADMIN") { return res.status(403).json({ success: false, message: "School isolation error." }); }
        q += " ORDER BY name";
        const { rows } = await db.query(q, params);
        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── POST /api/finance/payment-categories ───────────────────────────────────
router.post("/payment-categories", authMiddleware,
    roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]),
    [
        body("name").trim().notEmpty(),
        body("code").trim().notEmpty(),
    ],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const schoolId = req.user.role === "SUPER_ADMIN" ? (req.body.school_id || req.user.school_id) : req.user.school_id;
            const { name, code, description } = req.body;
            const { rows } = await db.query(
                `INSERT INTO payment_categories (school_id, name, code, description)
                 VALUES ($1,$2,$3,$4) RETURNING *`,
                [schoolId, name, code, description || null]
            );
            await audit(req, "CREATE", "payment_categories", rows[0].id, null, { name, code });
            return res.status(201).json({ success: true, message: "Payment category created.", data: rows[0] });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

// ─── GET /api/finance/payments ────────────────────────────────────────────────
router.get("/payments", authMiddleware, async (req, res) => {
    try {
        const { role, school_id, id: userId } = req.user;

        if (role === "TEACHER")
            return res.status(403).json({ success: false, message: "Access denied." });

        let q = `SELECT p.*, s.full_name AS student_name, s.admission_no, pc.name AS category_name,
                        u.name AS recorded_by_name, ay.name AS academic_year
                 FROM payments_v2 p 
                 LEFT JOIN students s ON s.id=p.student_id
                 LEFT JOIN payment_categories pc ON pc.id=p.payment_category_id
                 LEFT JOIN users u ON u.id=p.recorded_by
                 LEFT JOIN academic_years ay ON ay.id=p.academic_year_id`;
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
            const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id || null) : school_id;
            if (schoolId) { params.push(schoolId); where.push(`p.school_id=$${params.length}`); }
            else if (role !== "SUPER_ADMIN") { return res.status(403).json({ success: false, message: "School isolation error." }); }
            if (req.query.student_id) { params.push(req.query.student_id); where.push(`p.student_id=$${params.length}`); }
            if (req.query.payment_status) { params.push(req.query.payment_status); where.push(`p.payment_status=$${params.length}`); }
            if (req.query.term) { params.push(req.query.term); where.push(`p.term=$${params.length}`); }
            if (req.query.year) { params.push(req.query.year); where.push(`p.academic_year_id=$${params.length}`); }
        }

        if (where.length) q += " WHERE " + where.join(" AND ");
        q += " ORDER BY p.created_at DESC LIMIT 100";
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
        body("payment_category_id").isInt(),
        body("amount_due").isFloat({ min: 0.01 }),
        body("amount_paid").isFloat({ min: 0.01 }),
        body("payment_method").trim().notEmpty(),
    ],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const schoolId = req.user.role === "SUPER_ADMIN" ? (req.body.school_id || req.user.school_id) : req.user.school_id;
            const { student_id, payment_category_id, amount_due, amount_paid, payment_method, 
                    transaction_reference, mpesa_code, mpesa_sender_name, mpesa_sender_phone, 
                    academic_year_id, term, remarks, parent_id } = req.body;

            // Verify student exists and belongs to school
            const st = await db.query("SELECT id, school_id FROM students WHERE id=$1", [student_id]);
            if (!st.rows.length) return res.status(404).json({ success: false, message: "Student not found." });
            if (req.user.role !== "SUPER_ADMIN" && st.rows[0].school_id !== schoolId)
                return res.status(403).json({ success: false, message: "Student not in your school." });

            // Verify payment category exists
            const pc = await db.query("SELECT id FROM payment_categories WHERE id=$1 AND school_id=$2", 
                [payment_category_id, schoolId]);
            if (!pc.rows.length) return res.status(404).json({ success: false, message: "Payment category not found." });

            // Generate receipt number
            const receiptNum = `RCP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

            // Determine payment status
            const paymentStatus = amount_paid >= amount_due ? 'completed' : (amount_paid > 0 ? 'partial' : 'pending');

            const { rows } = await db.query(
                `INSERT INTO payments_v2 (school_id, student_id, parent_id, payment_category_id, 
                    receipt_number, amount_due, amount_paid, payment_method, transaction_reference,
                    mpesa_code, mpesa_sender_name, mpesa_sender_phone, academic_year_id, term,
                    payment_status, remarks, recorded_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
                [schoolId, student_id, parent_id || null, payment_category_id, receiptNum, 
                 amount_due, amount_paid, payment_method, transaction_reference || null,
                 mpesa_code || null, mpesa_sender_name || null, mpesa_sender_phone || null,
                 academic_year_id || null, term || null, paymentStatus, remarks || null, req.user.id]
            );

            // Create receipt
            await db.query(
                `INSERT INTO receipts (school_id, payment_id, receipt_number, issued_by)
                 VALUES ($1,$2,$3,$4)`,
                [schoolId, rows[0].id, receiptNum, req.user.id]
            );

            const full = await db.query(
                `SELECT p.*, s.full_name AS student_name, s.admission_no, pc.name AS category_name
                 FROM payments_v2 p 
                 LEFT JOIN students s ON s.id=p.student_id
                 LEFT JOIN payment_categories pc ON pc.id=p.payment_category_id
                 WHERE p.id=$1`,
                [rows[0].id]
            );

            await audit(req, "CREATE", "payments_v2", full.rows[0].id, null,
                { student_id, payment_category_id, amount_paid, payment_method, receipt_number: receiptNum });

            return res.status(201).json({ success: true, message: "Payment recorded.", data: full.rows[0] });
        } catch (err) {
            console.error("Payment creation error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

// ─── PUT /api/finance/payments/:id (Update payment approval status) ──────────
router.put("/payments/:id", authMiddleware,
    roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { approval_status, remarks } = req.body;

            const payment = await db.query("SELECT * FROM payments_v2 WHERE id=$1", [id]);
            if (!payment.rows.length) return res.status(404).json({ success: false, message: "Payment not found." });

            if (req.user.role !== "SUPER_ADMIN" && payment.rows[0].school_id !== req.user.school_id)
                return res.status(403).json({ success: false, message: "Access denied." });

            const { rows } = await db.query(
                `UPDATE payments_v2 SET approval_status=$1, approved_by=$2, remarks=$3, updated_at=NOW()
                 WHERE id=$4 RETURNING *`,
                [approval_status || payment.rows[0].approval_status, req.user.id, remarks || null, id]
            );

            await audit(req, "UPDATE", "payments_v2", id, payment.rows[0], { approval_status, remarks });

            return res.json({ success: true, message: "Payment updated.", data: rows[0] });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }
);

// ─── GET /api/finance/receipts/:payment_id ──────────────────────────────────
router.get("/receipts/:payment_id", authMiddleware, async (req, res) => {
    try {
        const { payment_id } = req.params;
        const { role, school_id, id: userId } = req.user;

        if (role === "TEACHER")
            return res.status(403).json({ success: false, message: "Access denied." });

        const { rows } = await db.query(
            `SELECT r.*, p.receipt_number, s.full_name AS student_name, pc.name AS category_name, p.school_id, p.student_id
             FROM receipts r
             LEFT JOIN payments_v2 p ON p.id=r.payment_id
             LEFT JOIN students s ON s.id=p.student_id
             LEFT JOIN payment_categories pc ON pc.id=p.payment_category_id
             WHERE r.payment_id=$1`,
            [payment_id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: "Receipt not found." });

        const receipt = rows[0];
        if (role === "STUDENT") {
            const me = await db.query("SELECT id FROM students WHERE user_id=$1 AND id=$2", [userId, receipt.student_id]);
            if (!me.rows.length) return res.status(403).json({ success: false, message: "Access denied." });
        } else if (role === "PARENT") {
            const link = await db.query("SELECT id FROM parent_students WHERE parent_id=$1 AND student_id=$2", [userId, receipt.student_id]);
            if (!link.rows.length) return res.status(403).json({ success: false, message: "Access denied." });
        } else {
            if (role !== "SUPER_ADMIN" && receipt.school_id !== school_id)
                return res.status(403).json({ success: false, message: "Access denied." });
        }

        return res.json({ success: true, data: receipt });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/finance/summary  (ADMIN + FINANCE only) ──
router.get("/summary", authMiddleware,
    roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN","FINANCE"]),
    async (req, res) => {
        try {
            const schoolId = req.user.role === "SUPER_ADMIN" ? (req.query.school_id || null) : req.user.school_id;
            const year = req.query.year || new Date().getFullYear();
            const params = [year, 'completed'];
            let cond = "p.academic_year_id=$1 AND p.payment_status=$2";
            if (schoolId) { params.push(schoolId); cond += ` AND p.school_id=$${params.length}`; }

            const byCategory = await db.query(
                `SELECT pc.name, COUNT(*) AS count, COALESCE(SUM(p.amount_paid),0) AS total
                 FROM payments_v2 p
                 LEFT JOIN payment_categories pc ON pc.id=p.payment_category_id
                 WHERE ${cond} GROUP BY pc.name ORDER BY total DESC`, params
            );
            const total = await db.query(
                `SELECT COALESCE(SUM(p.amount_paid),0) AS total FROM payments_v2 p WHERE ${cond}`, params
            );
            const pending = await db.query(
                `SELECT COALESCE(SUM(p.balance),0) AS total FROM payments_v2 p WHERE p.school_id=$1 AND p.payment_status IN ('pending','partial')`,
                [schoolId]
            );

            return res.json({ success: true, data: {
                total_revenue: parseFloat(total.rows[0].total),
                total_pending: parseFloat(pending.rows[0].total),
                by_category: byCategory.rows,
                year
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

        const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id || null) : school_id;
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
            const schoolId = req.user.role === "SUPER_ADMIN" ? (req.body.school_id || req.user.school_id) : req.user.school_id;
            const { grade_id, term, year, amount, description } = req.body;
            const { rows } = await db.query(
                `INSERT INTO fee_structures (school_id, grade_id, term, year, amount, description)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
                [schoolId, grade_id, term, year, amount, description || null]
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
            "SELECT term, SUM(amount_paid) AS paid FROM payments_v2 WHERE student_id=$1 AND academic_year_id=$2 AND payment_status='completed' GROUP BY term",
            [sid, year]
        );
        const fees = await db.query(
            "SELECT term, amount AS expected FROM fee_structures WHERE school_id=$1 AND grade_id=$2 AND year=$3",
            [student.rows[0].school_id, student.rows[0].grade_id, year]
        );

        const balance = [1,2,3].map(t => {
            const p = payments.rows.find(r => parseInt(r.term) === t);
            const f = fees.rows.find(r => parseInt(r.term) === t);
            const paid = parseFloat(p?.paid || 0);
            const expected = parseFloat(f?.expected || 0);
            return { term: t, expected, paid, balance: expected - paid };
        });

        return res.json({ success: true, data: { student: student.rows[0], year, balance } });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
