/**
 * /api/attendance
 * TEACHER/SCHOOL_ADMIN — mark + view
 * STUDENT  — own records only
 * PARENT   — children's records only
 * FINANCE  — NO ACCESS
 */
const express = require("express");
const db = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", authMiddleware, async (req, res) => {
    try {
        const { role, school_id, id: userId } = req.user;
        if (role === "FINANCE")
            return res.status(403).json({ success: false, message: "Access denied." });

        let q = `SELECT a.*, s.full_name, s.admission_no
                 FROM attendance a LEFT JOIN students s ON s.id=a.student_id`;
        const params = [], where = [];

        if (role === "STUDENT") {
            const me = await db.query("SELECT id FROM students WHERE user_id=$1", [userId]);
            if (!me.rows.length) return res.json({ success: true, data: [] });
            params.push(me.rows[0].id); where.push(`a.student_id=$${params.length}`);
        } else if (role === "PARENT") {
            const kids = await db.query("SELECT student_id FROM parent_students WHERE parent_id=$1", [userId]);
            if (!kids.rows.length) return res.json({ success: true, data: [] });
            params.push(kids.rows.map(r => r.student_id));
            where.push(`a.student_id = ANY($${params.length})`);
        } else {
            const schoolId = role === "SUPER_ADMIN" ? (req.query.school_id||null) : school_id;
            if (schoolId) { params.push(schoolId); where.push(`a.school_id=$${params.length}`); }
            if (req.query.date) { params.push(req.query.date); where.push(`a.date=$${params.length}`); }
            if (req.query.student_id) { params.push(req.query.student_id); where.push(`a.student_id=$${params.length}`); }
        }

        if (where.length) q += " WHERE " + where.join(" AND ");
        q += " ORDER BY a.date DESC, s.full_name";
        const { rows } = await db.query(q, params);
        return res.json({ success: true, data: rows, count: rows.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// POST — single or bulk
router.post("/", authMiddleware, async (req, res) => {
    try {
        const { role, school_id } = req.user;
        if (!["SUPER_ADMIN","SCHOOL_ADMIN","TEACHER"].includes(role))
            return res.status(403).json({ success: false, message: "Access denied." });

        const records = Array.isArray(req.body) ? req.body : [req.body];
        const schoolId = req.user.school_id;
        const inserted = [];

        for (const r of records) {
            if (!r.student_id || !r.date || !r.status)
                return res.status(400).json({ success: false, message: "student_id, date, status required." });
            if (!["present","absent","late","excused"].includes(r.status))
                return res.status(400).json({ success: false, message: `Invalid status: ${r.status}` });

            // Verify student ownership
            const st = await db.query("SELECT school_id FROM students WHERE id=$1", [r.student_id]);
            if (!st.rows.length || (req.user.role !== "SUPER_ADMIN" && st.rows[0].school_id !== schoolId)) {
                continue; // Skip cross-tenant or missing student
            }

            const { rows } = await db.query(
                `INSERT INTO attendance (school_id, student_id, teacher_id, date, status, remarks)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (school_id, student_id, date)
                 DO UPDATE SET status=EXCLUDED.status, remarks=EXCLUDED.remarks
                 RETURNING *`,
                [st.rows[0].school_id, r.student_id, req.user.id, r.date, r.status, r.remarks||null]
            );
            inserted.push(rows[0]);
        }
        return res.status(201).json({ success: true, message: `${inserted.length} record(s) saved.`, data: inserted });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/attendance/report/:student_id
router.get("/report/:student_id", authMiddleware, async (req, res) => {
    try {
        const { role, id: userId } = req.user;
        if (role === "FINANCE")
            return res.status(403).json({ success: false, message: "Access denied." });
        if (role === "STUDENT") {
            const me = await db.query("SELECT id FROM students WHERE user_id=$1", [userId]);
            if (!me.rows.length || me.rows[0].id !== req.params.student_id)
                return res.status(403).json({ success: false, message: "Access denied." });
        }
        if (role === "PARENT") {
            const link = await db.query(
                "SELECT id FROM parent_students WHERE parent_id=$1 AND student_id=$2",
                [userId, req.params.student_id]
            );
            if (!link.rows.length) return res.status(403).json({ success: false, message: "Not your child." });
        }

        // Verify student ownership for staff
        if (["TEACHER", "SCHOOL_ADMIN"].includes(role)) {
            const st = await db.query("SELECT school_id FROM students WHERE id=$1", [req.params.student_id]);
            if (!st.rows.length || st.rows[0].school_id !== req.user.school_id)
                return res.status(403).json({ success: false, message: "Access denied." });
        }

        const { rows } = await db.query(
            "SELECT * FROM attendance WHERE student_id=$1 ORDER BY date DESC",
            [req.params.student_id]
        );
        const s = { total: rows.length, present:0, absent:0, late:0, excused:0 };
        rows.forEach(r => { if (s[r.status]!==undefined) s[r.status]++; });
        s.percentage = s.total > 0 ? ((s.present/s.total)*100).toFixed(1)+"%" : "0%";
        return res.json({ success: true, data: { records: rows, summary: s } });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
