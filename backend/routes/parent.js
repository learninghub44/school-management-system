/**
 * /api/parent — read-only portal for guardians.
 * Every route runs through parentScope, which restricts results to only
 * the student_id(s) linked to the logged-in PARENT user via `guardians`.
 * No write endpoints here on purpose — fee payment initiation, if added
 * later, should go through the existing Paystack/Pesapal flow, not a
 * raw write to academic/financial tables.
 */
"use strict";
const express = require("express");
const db = require("../config/db");
const auth = require("../middleware/authMiddleware");
const parentScope = require("../middleware/parentScope");
const validateUUID = require("../middleware/validateUUID");

const router = express.Router();

// ── GET /api/parent/children — list linked students ────────────────
router.get("/children", auth, parentScope, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.admission_number, s.first_name, s.middle_name, s.last_name,
              s.gender, s.photo_url, g.relationship, g.is_primary,
              CONCAT(c.grade, COALESCE(' '||c.stream,'')) AS class_label,
              c.pathway
       FROM guardians g
       JOIN students s ON s.id = g.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE g.user_id = $1 AND g.school_id = $2
       ORDER BY s.first_name`,
      [req.user.id, req.user.school_id]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[parent/children]", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/parent/children/:id/report-cards ───────────────────────
router.get("/children/:id/report-cards", auth, parentScope, validateUUID("id"), async (req, res) => {
  try {
    const p = [req.params.id], where = ["rc.student_id=$1"];
    if (req.query.term)          { p.push(req.query.term);          where.push(`rc.term=$${p.length}`); }
    if (req.query.academic_year) { p.push(req.query.academic_year); where.push(`rc.academic_year=$${p.length}`); }

    const { rows } = await db.query(
      `SELECT rc.*, CONCAT(c.grade, COALESCE(' '||c.stream,'')) AS class_label,
              sc.name AS school_name, sc.logo_url AS school_logo_url,
              sc.motto AS school_motto, sc.theme_color AS school_theme_color
       FROM report_cards rc
       JOIN classes c  ON c.id = rc.class_id
       LEFT JOIN schools sc ON sc.id = rc.school_id
       WHERE ${where.join(" AND ")} AND rc.is_published = TRUE
       ORDER BY rc.academic_year DESC, rc.term DESC`, p
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[parent/report-cards]", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/parent/children/:id/attendance ─────────────────────────
router.get("/children/:id/attendance", auth, parentScope, validateUUID("id"), async (req, res) => {
  try {
    const p = [req.params.id], where = ["a.student_id=$1"];
    if (req.query.date_from) { p.push(req.query.date_from); where.push(`a.date>=$${p.length}`); }
    if (req.query.date_to)   { p.push(req.query.date_to);   where.push(`a.date<=$${p.length}`); }

    const { rows } = await db.query(
      `SELECT a.date, a.status, a.remarks
       FROM attendance a
       WHERE ${where.join(" AND ")}
       ORDER BY a.date DESC LIMIT 60`, p
    );
    const { rows: summary } = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status='Present') AS present,
         COUNT(*) FILTER (WHERE status='Absent')  AS absent,
         COUNT(*) FILTER (WHERE status='Late')    AS late,
         COUNT(*) AS total,
         ROUND(COUNT(*) FILTER (WHERE status='Present')::numeric / NULLIF(COUNT(*),0) * 100, 1) AS attendance_rate
       FROM attendance WHERE student_id=$1`,
      [req.params.id]
    );
    return res.json({ success: true, data: { records: rows, summary: summary[0] } });
  } catch (err) {
    console.error("[parent/attendance]", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/parent/children/:id/fees ────────────────────────────────
router.get("/children/:id/fees", auth, parentScope, validateUUID("id"), async (req, res) => {
  try {
    const { rows: st } = await db.query("SELECT school_id, class_id FROM students WHERE id=$1", [req.params.id]);
    if (!st.length) return res.status(404).json({ success: false, message: "Student not found." });

    const year = req.query.academic_year || new Date().getFullYear().toString();
    const { rows: balance } = await db.query(
      `SELECT
         COALESCE(SUM(fs.amount),0)      AS total_billed,
         COALESCE(SUM(py.amount_paid),0) AS total_paid
       FROM fee_structures fs
       LEFT JOIN payments py ON py.fee_structure_id = fs.id AND py.student_id = $1
       WHERE fs.school_id = $2 AND fs.academic_year = $3
         AND (fs.class_id IS NULL OR fs.class_id = $4)`,
      [req.params.id, st[0].school_id, year, st[0].class_id]
    );
    const { rows: payments } = await db.query(
      `SELECT receipt_number, amount_paid, payment_date, payment_method, term, academic_year
       FROM payments WHERE student_id=$1 ORDER BY payment_date DESC LIMIT 20`,
      [req.params.id]
    );
    return res.json({ success: true, data: { ...balance[0], recent_payments: payments } });
  } catch (err) {
    console.error("[parent/fees]", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
