/**
 * /api/cbc
 * Advanced CBC structure: Academic Years, Streams, Classes, Assessment Categories
 */
const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const router = express.Router();

// ─── STREAMS ──────────────────────────────────────────────────────────────────
router.get("/streams", authMiddleware, async (req, res) => {
    try {
        const schoolId = req.user.role === "SUPER_ADMIN" ? (req.query.school_id || null) : req.user.school_id;
        if (!schoolId && req.user.role !== "SUPER_ADMIN") return res.status(403).json({ success: false, message: "Isolation error." });
        const { rows } = await db.query("SELECT * FROM streams WHERE school_id=$1 ORDER BY name", [schoolId]);
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post("/streams", authMiddleware, roleMiddleware(["SUPER_ADMIN", "SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const { name } = req.body;
        const schoolId = req.user.role === "SUPER_ADMIN" ? (req.body.school_id || req.user.school_id) : req.user.school_id;
        if (!schoolId) return res.status(400).json({ success: false, message: "school_id required." });
        const { rows } = await db.query(
            "INSERT INTO streams (school_id, name) VALUES ($1, $2) RETURNING *",
            [schoolId, name]
        );
        res.status(201).json({ success: true, data: rows[0] });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── ACADEMIC YEARS ───────────────────────────────────────────────────────────
router.get("/academic-years", authMiddleware, async (req, res) => {
    try {
        const schoolId = req.user.role === "SUPER_ADMIN" ? (req.query.school_id || null) : req.user.school_id;
        if (!schoolId && req.user.role !== "SUPER_ADMIN") return res.status(403).json({ success: false, message: "Isolation error." });
        const { rows } = await db.query("SELECT * FROM academic_years WHERE school_id=$1 ORDER BY name DESC", [schoolId]);
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post("/academic-years", authMiddleware, roleMiddleware(["SUPER_ADMIN", "SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const { name, start_date, end_date, is_current } = req.body;
        const schoolId = req.user.role === "SUPER_ADMIN" ? (req.body.school_id || req.user.school_id) : req.user.school_id;
        if (!schoolId) return res.status(400).json({ success: false, message: "school_id required." });
        if (is_current) await db.query("UPDATE academic_years SET is_current=FALSE WHERE school_id=$1", [schoolId]);
        const { rows } = await db.query(
            "INSERT INTO academic_years (school_id, name, start_date, end_date, is_current) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [schoolId, name, start_date, end_date, is_current || false]
        );
        res.status(201).json({ success: true, data: rows[0] });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── CLASSES ──────────────────────────────────────────────────────────────────
router.get("/classes", authMiddleware, async (req, res) => {
    try {
        const schoolId = req.user.role === "SUPER_ADMIN" ? (req.query.school_id || null) : req.user.school_id;
        if (!schoolId && req.user.role !== "SUPER_ADMIN") return res.status(403).json({ success: false, message: "Isolation error." });
        const { rows } = await db.query(
            `SELECT c.*, g.grade_level, s.name as stream_name, ay.name as academic_year_name, u.name as teacher_name
             FROM classes c
             JOIN grades g ON g.id = c.grade_id
             JOIN streams s ON s.id = c.stream_id
             JOIN academic_years ay ON ay.id = c.academic_year_id
             LEFT JOIN users u ON u.id = c.teacher_id
             WHERE c.school_id=$1`, [schoolId]
        );
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post("/classes", authMiddleware, roleMiddleware(["SUPER_ADMIN", "SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const { grade_id, stream_id, academic_year_id, teacher_id } = req.body;
        const schoolId = req.user.role === "SUPER_ADMIN" ? (req.body.school_id || req.user.school_id) : req.user.school_id;
        if (!schoolId) return res.status(400).json({ success: false, message: "school_id required." });

        // Verify stream ownership
        const str = await db.query("SELECT school_id FROM streams WHERE id=$1", [stream_id]);
        if (!str.rows.length || str.rows[0].school_id !== schoolId)
            return res.status(403).json({ success: false, message: "Stream isolation error." });

        // Verify academic year belongs to same school
        const ay = await db.query("SELECT school_id FROM academic_years WHERE id=$1", [academic_year_id]);
        if (!ay.rows.length || ay.rows[0].school_id !== schoolId)
            return res.status(403).json({ success: false, message: "Academic year isolation error." });

        // Verify teacher belongs to same school (if provided)
        if (teacher_id) {
            const tch = await db.query("SELECT school_id FROM teachers WHERE id=$1", [teacher_id]);
            if (!tch.rows.length || tch.rows[0].school_id !== schoolId)
                return res.status(403).json({ success: false, message: "Teacher isolation error." });
        }

        const { rows } = await db.query(
            "INSERT INTO classes (school_id, grade_id, stream_id, academic_year_id, teacher_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [schoolId, grade_id, stream_id, academic_year_id, teacher_id || null]
        );
        res.status(201).json({ success: true, data: rows[0] });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── ASSESSMENT CATEGORIES ────────────────────────────────────────────────────
router.get("/categories", authMiddleware, async (req, res) => {
    try {
        const schoolId = req.user.role === "SUPER_ADMIN" ? (req.query.school_id || null) : req.user.school_id;
        if (!schoolId && req.user.role !== "SUPER_ADMIN") return res.status(403).json({ success: false, message: "Isolation error." });
        const { rows } = await db.query("SELECT * FROM assessment_categories WHERE school_id=$1 ORDER BY name", [schoolId]);
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post("/categories", authMiddleware, roleMiddleware(["SUPER_ADMIN", "SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const { name, weight } = req.body;
        const schoolId = req.user.role === "SUPER_ADMIN" ? (req.body.school_id || req.user.school_id) : req.user.school_id;
        if (!schoolId) return res.status(400).json({ success: false, message: "school_id required." });
        const { rows } = await db.query(
            "INSERT INTO assessment_categories (school_id, name, weight) VALUES ($1, $2, $3) RETURNING *",
            [schoolId, name, weight || 100]
        );
        res.status(201).json({ success: true, data: rows[0] });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/cbc/grades — public reference table (auth required, all roles)
router.get("/grades", authMiddleware, async (req, res) => {
    try {
        const { rows } = await db.query(
            "SELECT id, grade_level, stage, sort_order FROM grades ORDER BY sort_order, grade_level"
        );
        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/cbc/streams — streams for a given school
router.get("/school-streams", authMiddleware, async (req, res) => {
    try {
        const schoolId = req.user.role === "SUPER_ADMIN"
            ? (req.query.school_id || null)
            : req.user.school_id;
        if (!schoolId) return res.json({ success: true, data: [] });
        const { rows } = await db.query(
            "SELECT * FROM streams WHERE school_id=$1 ORDER BY name",
            [schoolId]
        );
        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
