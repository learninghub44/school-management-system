/**
 * /api/reports
 * Comprehensive reporting and analytics endpoints
 * All data is school-isolated and role-based
 */
const express = require("express");
const db = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const router = express.Router();

// ─── GET /api/reports/dashboard ─────────────────────────────────────────
router.get("/dashboard", authMiddleware, async (req, res) => {
    try {
        const { role, school_id, id: userId } = req.user;
        if (!["SCHOOL_ADMIN", "FINANCE", "SUPER_ADMIN"].includes(role))
            return res.status(403).json({ success: false, message: "Access denied." });

        const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id || school_id) : school_id;
        if (!schoolId && role !== "SUPER_ADMIN")
            return res.status(403).json({ success: false, message: "School isolation error." });

        // Get dashboard metrics
        const [studRes, teachRes, parRes, payRes, attRes] = await Promise.all([
            db.query("SELECT COUNT(*) as count FROM students WHERE school_id=$1 AND is_active=TRUE", [schoolId]),
            db.query("SELECT COUNT(*) as count FROM teachers WHERE school_id=$1 AND status='Active'", [schoolId]),
            db.query("SELECT COUNT(*) as count FROM users WHERE school_id=$1 AND role='PARENT'", [schoolId]),
            db.query("SELECT COALESCE(SUM(amount_paid), 0) as total_paid, COALESCE(SUM(amount_due - amount_paid), 0) as outstanding FROM payments_v2 WHERE school_id=$1", [schoolId]),
            db.query("SELECT status, COUNT(*) as count FROM attendance WHERE school_id=$1 AND date >= NOW() - INTERVAL '30 days' GROUP BY status", [schoolId])
        ]);

        const dashboard = {
            students: parseInt(studRes.rows[0]?.count || 0),
            teachers: parseInt(teachRes.rows[0]?.count || 0),
            parents: parseInt(parRes.rows[0]?.count || 0),
            finance: {
                total_paid: parseFloat(payRes.rows[0]?.total_paid || 0),
                outstanding: parseFloat(payRes.rows[0]?.outstanding || 0),
            },
            attendance: {}
        };

        attRes.rows.forEach(r => {
            dashboard.attendance[r.status] = parseInt(r.count);
        });

        return res.json({ success: true, data: dashboard });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/reports/fee-collection ────────────────────────────────────
router.get("/fee-collection", authMiddleware, async (req, res) => {
    try {
        const { role, school_id } = req.user;
        if (!["SCHOOL_ADMIN", "FINANCE", "SUPER_ADMIN"].includes(role))
            return res.status(403).json({ success: false, message: "Access denied." });

        const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id || school_id) : school_id;
        if (!schoolId && role !== "SUPER_ADMIN")
            return res.status(403).json({ success: false, message: "School isolation error." });

        const { rows } = await db.query(`
            SELECT 
                pc.name as category,
                COUNT(p.id) as payment_count,
                COALESCE(SUM(p.amount_paid), 0) as total_collected,
                COALESCE(SUM(p.amount_due - p.amount_paid), 0) as outstanding,
                ROUND(100.0 * SUM(p.amount_paid) / NULLIF(SUM(p.amount_due), 0), 2) as collection_rate
            FROM payments_v2 p
            LEFT JOIN payment_categories pc ON pc.id = p.payment_category_id
            WHERE p.school_id = $1
            GROUP BY pc.id, pc.name
            ORDER BY total_collected DESC
        `, [schoolId]);

        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/reports/daily-collection ──────────────────────────────────
router.get("/daily-collection", authMiddleware, async (req, res) => {
    try {
        const { role, school_id } = req.user;
        if (!["SCHOOL_ADMIN", "FINANCE", "SUPER_ADMIN"].includes(role))
            return res.status(403).json({ success: false, message: "Access denied." });

        const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id || school_id) : school_id;
        const days = parseInt(req.query.days || "30");

        if (!schoolId && role !== "SUPER_ADMIN")
            return res.status(403).json({ success: false, message: "School isolation error." });

        const { rows } = await db.query(`
            SELECT 
                DATE(payment_date) as date,
                COUNT(*) as transaction_count,
                COALESCE(SUM(amount_paid), 0) as daily_total,
                payment_method,
                COUNT(DISTINCT student_id) as unique_students
            FROM payments_v2
            WHERE school_id = $1 AND payment_date >= NOW() - INTERVAL '${days} days'
            GROUP BY DATE(payment_date), payment_method
            ORDER BY date DESC
        `, [schoolId]);

        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/reports/outstanding-balances ──────────────────────────────
router.get("/outstanding-balances", authMiddleware, async (req, res) => {
    try {
        const { role, school_id } = req.user;
        if (!["SCHOOL_ADMIN", "FINANCE", "SUPER_ADMIN"].includes(role))
            return res.status(403).json({ success: false, message: "Access denied." });

        const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id || school_id) : school_id;
        if (!schoolId && role !== "SUPER_ADMIN")
            return res.status(403).json({ success: false, message: "School isolation error." });

        const { rows } = await db.query(`
            SELECT 
                s.id,
                s.full_name as student_name,
                s.admission_no,
                g.grade_level,
                COALESCE(SUM(p.amount_due - p.amount_paid), 0) as balance,
                COUNT(DISTINCT p.id) as payment_records
            FROM students s
            LEFT JOIN grades g ON g.id = s.grade_id
            LEFT JOIN payments_v2 p ON p.student_id = s.id AND p.school_id = $1
            WHERE s.school_id = $1 AND s.is_active = TRUE
            GROUP BY s.id, s.full_name, s.admission_no, g.grade_level
            HAVING COALESCE(SUM(p.amount_due - p.amount_paid), 0) > 0
            ORDER BY balance DESC
        `, [schoolId]);

        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/reports/attendance-summary ────────────────────────────────
router.get("/attendance-summary", authMiddleware, async (req, res) => {
    try {
        const { role, school_id } = req.user;
        if (!["SCHOOL_ADMIN", "TEACHER", "SUPER_ADMIN"].includes(role))
            return res.status(403).json({ success: false, message: "Access denied." });

        const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id || school_id) : school_id;
        const days = parseInt(req.query.days || "30");

        if (!schoolId && role !== "SUPER_ADMIN")
            return res.status(403).json({ success: false, message: "School isolation error." });

        const { rows } = await db.query(`
            SELECT 
                s.id,
                s.full_name,
                s.admission_no,
                g.grade_level,
                COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present,
                COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent,
                COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late,
                COUNT(CASE WHEN a.status = 'excused' THEN 1 END) as excused,
                ROUND(100.0 * COUNT(CASE WHEN a.status = 'present' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as attendance_rate
            FROM students s
            LEFT JOIN grades g ON g.id = s.grade_id
            LEFT JOIN attendance a ON a.student_id = s.id AND a.date >= NOW() - INTERVAL '${days} days'
            WHERE s.school_id = $1 AND s.is_active = TRUE
            GROUP BY s.id, s.full_name, s.admission_no, g.grade_level
            ORDER BY attendance_rate ASC
        `, [schoolId]);

        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/reports/cbc-performance ────────────────────────────────────
router.get("/cbc-performance", authMiddleware, async (req, res) => {
    try {
        const { role, school_id } = req.user;
        if (!["SCHOOL_ADMIN", "TEACHER", "SUPER_ADMIN"].includes(role))
            return res.status(403).json({ success: false, message: "Access denied." });

        const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id || school_id) : school_id;
        if (!schoolId && role !== "SUPER_ADMIN")
            return res.status(403).json({ success: false, message: "School isolation error." });

        const { rows } = await db.query(`
            SELECT 
                la.name as learning_area,
                ROUND(AVG(a.score), 2) as avg_score,
                MAX(a.score) as max_score,
                MIN(a.score) as min_score,
                COUNT(DISTINCT a.student_id) as students_assessed,
                COUNT(a.id) as total_assessments,
                ROUND(100.0 * COUNT(CASE WHEN a.score >= 70 THEN 1 END) / NULLIF(COUNT(*), 0), 2) as pass_rate
            FROM assessments a
            LEFT JOIN learning_areas la ON la.id = a.learning_area_id
            WHERE a.school_id = $1
            GROUP BY la.id, la.name
            ORDER BY avg_score DESC
        `, [schoolId]);

        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/reports/student-statement/:student_id ──────────────────────
router.get("/student-statement/:student_id", authMiddleware, async (req, res) => {
    try {
        const { role, school_id, id: userId } = req.user;
        const studentId = req.params.student_id;

        // Verify access
        if (role === "STUDENT") {
            const me = await db.query("SELECT id FROM students WHERE user_id=$1", [userId]);
            if (!me.rows.length || me.rows[0].id !== parseInt(studentId))
                return res.status(403).json({ success: false, message: "Access denied." });
        } else if (role === "PARENT") {
            const link = await db.query("SELECT id FROM parent_students WHERE parent_id=$1 AND student_id=$2", [userId, studentId]);
            if (!link.rows.length) return res.status(403).json({ success: false, message: "Not your child." });
        } else if (!["SCHOOL_ADMIN", "FINANCE", "SUPER_ADMIN"].includes(role)) {
            return res.status(403).json({ success: false, message: "Access denied." });
        }

        const { rows: studentData } = await db.query(`
            SELECT s.*, g.grade_level, st.name as stream_name, sc.name as school_name
            FROM students s
            LEFT JOIN grades g ON g.id = s.grade_id
            LEFT JOIN streams st ON st.id = s.stream_id
            LEFT JOIN schools sc ON sc.id = s.school_id
            WHERE s.id = $1
        `, [studentId]);

        if (!studentData.length)
            return res.status(404).json({ success: false, message: "Student not found." });

        const { rows: payments } = await db.query(`
            SELECT p.*, pc.name as category_name
            FROM payments_v2 p
            LEFT JOIN payment_categories pc ON pc.id = p.payment_category_id
            WHERE p.student_id = $1
            ORDER BY p.payment_date DESC
        `, [studentId]);

        return res.json({
            success: true,
            data: {
                student: studentData[0],
                payments: payments,
                summary: {
                    total_paid: payments.reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0),
                    total_due: payments.reduce((sum, p) => sum + parseFloat(p.amount_due || 0), 0),
                    balance: payments.reduce((sum, p) => sum + (parseFloat(p.amount_due || 0) - parseFloat(p.amount_paid || 0)), 0),
                }
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/reports/export/:report_type ───────────────────────────────
router.get("/export/:report_type", authMiddleware, async (req, res) => {
    try {
        const { role, school_id } = req.user;
        if (!["SCHOOL_ADMIN", "FINANCE", "SUPER_ADMIN"].includes(role))
            return res.status(403).json({ success: false, message: "Access denied." });

        const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id || school_id) : school_id;
        const reportType = req.params.report_type;

        if (!schoolId && role !== "SUPER_ADMIN")
            return res.status(403).json({ success: false, message: "School isolation error." });

        // Prepare CSV data based on report type
        let csvData = "";
        let filename = "";

        if (reportType === "fee-collection") {
            const { rows } = await db.query(`
                SELECT 
                    pc.name, COUNT(*), COALESCE(SUM(amount_paid), 0), 
                    COALESCE(SUM(amount_due - amount_paid), 0)
                FROM payments_v2 p
                LEFT JOIN payment_categories pc ON pc.id = p.payment_category_id
                WHERE p.school_id = $1
                GROUP BY pc.id, pc.name
            `, [schoolId]);

            csvData = "Category,Payments,Collected,Outstanding\n";
            rows.forEach(r => {
                csvData += `"${r.name}",${r.count},${r.coalesce},${r.coalesce_1}\n`;
            });
            filename = "fee-collection-report.csv";
        } else if (reportType === "outstanding-balances") {
            const { rows } = await db.query(`
                SELECT s.full_name, s.admission_no, g.grade_level,
                    COALESCE(SUM(p.amount_due - p.amount_paid), 0) as balance
                FROM students s
                LEFT JOIN grades g ON g.id = s.grade_id
                LEFT JOIN payments_v2 p ON p.student_id = s.id
                WHERE s.school_id = $1 AND s.is_active = TRUE
                GROUP BY s.id, s.full_name, s.admission_no, g.grade_level
                HAVING COALESCE(SUM(p.amount_due - p.amount_paid), 0) > 0
                ORDER BY balance DESC
            `, [schoolId]);

            csvData = "Student Name,Admission No,Grade,Outstanding Balance\n";
            rows.forEach(r => {
                csvData += `"${r.full_name}","${r.admission_no}","${r.grade_level}",${r.balance}\n`;
            });
            filename = "outstanding-balances-report.csv";
        }

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(csvData);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
