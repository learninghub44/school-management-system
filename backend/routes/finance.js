/**
 * /api/finance — Fee structures & payments
 * Hard school isolation on all routes.
 * BURSAR + SUPER_ADMIN: write access
 * PRINCIPAL + DEPUTY: read-only
 */
"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const db        = require("../config/db");
const auth      = require("../middleware/authMiddleware");
const roleM     = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");

const router = express.Router();
const ALL          = ["SUPER_ADMIN", "PRINCIPAL", "DEPUTY_PRINCIPAL", "BURSAR"];
const BURSAR_ONLY  = ["SUPER_ADMIN", "BURSAR"];

function getSchoolId(req) {
  if (req.user.role === "SUPER_ADMIN") return req.query.school_id || null;
  return req.user.school_id;
}

function requireSchool(req, res) {
  const sid = getSchoolId(req);
  if (!sid && req.user.role !== "SUPER_ADMIN") {
    res.status(403).json({ success: false, message: "School isolation error." });
    return null;
  }
  return sid;
}

// ── GET /api/finance/fee-structures ──────────────────────────────
router.get("/fee-structures", auth, roleM(ALL), async (req, res) => {
  try {
    const sid = requireSchool(req, res);
    if (sid === null && req.user.role !== "SUPER_ADMIN") return;

    const p = []; let w = "WHERE 1=1";
    if (sid) { p.push(sid); w += ` AND fs.school_id=$${p.length}`; }
    if (req.query.class_id)     { p.push(req.query.class_id);     w += ` AND fs.class_id=$${p.length}`; }
    if (req.query.term)         { p.push(req.query.term);         w += ` AND fs.term=$${p.length}`; }
    if (req.query.academic_year){ p.push(req.query.academic_year); w += ` AND fs.academic_year=$${p.length}`; }

    const { rows } = await db.query(
      `SELECT fs.*, CONCAT(c.grade, COALESCE(' '||c.stream,'')) AS class_label
       FROM fee_structures fs
       LEFT JOIN classes c ON c.id = fs.class_id
       ${w} ORDER BY fs.academic_year DESC, fs.term, fs.fee_name`, p
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── POST /api/finance/fee-structures ─────────────────────────────
router.post("/fee-structures", auth, roleM(BURSAR_ONLY),
  [
    body("fee_name").trim().notEmpty().isLength({ max: 100 }),
    body("amount").isFloat({ min: 1 }),
    body("term").isInt({ min: 1, max: 3 }),
    body("academic_year").matches(/^\d{4}$/),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

      // If class_id provided, verify it belongs to school
      if (req.body.class_id) {
        const { rows: cls } = await db.query(
          "SELECT school_id FROM classes WHERE id=$1", [req.body.class_id]
        );
        if (!cls.length || (req.user.role !== "SUPER_ADMIN" && cls[0].school_id !== sid))
          return res.status(400).json({ success: false, message: "Invalid class." });
      }

      const { fee_name, amount, term, academic_year, class_id } = req.body;
      const { rows } = await db.query(
        "INSERT INTO fee_structures(school_id, class_id, fee_name, amount, term, academic_year) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [sid, class_id || null, fee_name, amount, term, academic_year]
      );
      await audit(req, "CREATE_FEE", "fee_structures", rows[0].id, null, rows[0]);
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      if (err.code === "23505")
        return res.status(409).json({ success: false, message: "Fee structure already exists." });
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── DELETE /api/finance/fee-structures/:id ────────────────────────
router.delete("/fee-structures/:id", auth, roleM(BURSAR_ONLY), async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT school_id FROM fee_structures WHERE id=$1", [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found." });
    if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    await db.query("DELETE FROM fee_structures WHERE id=$1", [req.params.id]);
    await audit(req, "DELETE_FEE", "fee_structures", req.params.id);
    return res.json({ success: true, message: "Fee structure deleted." });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/finance/payments ─────────────────────────────────────
router.get("/payments", auth, roleM(ALL), async (req, res) => {
  try {
    const sid = requireSchool(req, res);
    if (sid === null && req.user.role !== "SUPER_ADMIN") return;

    const p = []; let w = "WHERE 1=1";
    if (sid)                    { p.push(sid);                     w += ` AND py.school_id=$${p.length}`; }
    if (req.query.student_id)   { p.push(req.query.student_id);    w += ` AND py.student_id=$${p.length}`; }
    if (req.query.term)         { p.push(req.query.term);          w += ` AND py.term=$${p.length}`; }
    if (req.query.academic_year){ p.push(req.query.academic_year); w += ` AND py.academic_year=$${p.length}`; }
    if (req.query.date_from)    { p.push(req.query.date_from);     w += ` AND py.payment_date>=$${p.length}`; }
    if (req.query.date_to)      { p.push(req.query.date_to);       w += ` AND py.payment_date<=$${p.length}`; }

    const { rows } = await db.query(
      `SELECT py.*,
              CONCAT(s.first_name,' ',s.last_name) AS student_name,
              s.admission_number,
              CONCAT(c.grade, COALESCE(' '||c.stream,'')) AS class_label,
              fs.fee_name, u.name AS recorded_by_name
       FROM payments py
       JOIN students s ON s.id = py.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN fee_structures fs ON fs.id = py.fee_structure_id
       LEFT JOIN users u ON u.id = py.recorded_by
       ${w} ORDER BY py.payment_date DESC LIMIT 500`, p
    );
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/finance/summary ──────────────────────────────────────
router.get("/summary", auth, roleM(ALL), async (req, res) => {
  try {
    const sid = getSchoolId(req);
    if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

    const year = req.query.academic_year || new Date().getFullYear().toString();
    const p = [sid, year]; let tw = "";
    if (req.query.term) { p.push(req.query.term); tw = ` AND term=$${p.length}`; }

    const [r1, r2] = await Promise.all([
      db.query(`SELECT COALESCE(SUM(amount_paid),0) AS total_collected, COALESCE(SUM(balance),0) AS total_balance, COUNT(*) AS payment_count, COUNT(DISTINCT student_id) AS students_paid FROM payments WHERE school_id=$1 AND academic_year=$2${tw}`, p),
      db.query(`SELECT COALESCE(SUM(amount),0) AS total_expected FROM fee_structures WHERE school_id=$1 AND academic_year=$2${tw}`, p),
    ]);
    return res.json({
      success: true,
      data: {
        ...r1.rows[0],
        total_expected:    r2.rows[0].total_expected,
        total_outstanding: parseFloat(r2.rows[0].total_expected) - parseFloat(r1.rows[0].total_collected),
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── POST /api/finance/payments ────────────────────────────────────
router.post("/payments", auth, roleM(BURSAR_ONLY),
  [
    body("student_id").notEmpty().isUUID(),
    body("amount_paid").isFloat({ min: 1 }),
    body("payment_method").isIn(["Cash", "M-Pesa", "Bank Transfer", "Card", "Cheque"]),
    body("term").isInt({ min: 1, max: 3 }),
    body("academic_year").matches(/^\d{4}$/),
    body("receipt_number").trim().notEmpty().isLength({ max: 50 }),
    body("balance").optional().isFloat({ min: 0 }),
    body("reference").optional().trim().isLength({ max: 100 }),
    body("notes").optional().trim().isLength({ max: 500 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

      // Verify student belongs to school — use DB value
      const { rows: st } = await db.query(
        "SELECT school_id FROM students WHERE id=$1", [req.body.student_id]
      );
      if (!st.length)
        return res.status(404).json({ success: false, message: "Student not found." });
      if (req.user.role !== "SUPER_ADMIN" && st[0].school_id !== sid)
        return res.status(403).json({ success: false, message: "Student not in your school." });

      // Verify fee_structure belongs to school if provided
      if (req.body.fee_structure_id) {
        const { rows: fs } = await db.query(
          "SELECT school_id FROM fee_structures WHERE id=$1", [req.body.fee_structure_id]
        );
        if (!fs.length || (req.user.role !== "SUPER_ADMIN" && fs[0].school_id !== sid))
          return res.status(400).json({ success: false, message: "Invalid fee structure." });
      }

      const {
        student_id, receipt_number, amount_paid, payment_date, payment_method,
        reference, term, academic_year, fee_structure_id, balance, notes
      } = req.body;

      const { rows } = await db.query(
        `INSERT INTO payments
         (school_id, student_id, receipt_number, amount_paid, payment_date,
          payment_method, reference, term, academic_year, fee_structure_id,
          balance, recorded_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          st[0].school_id, student_id, receipt_number, amount_paid,
          payment_date || new Date().toISOString().split("T")[0],
          payment_method, reference || null, term, academic_year,
          fee_structure_id || null, balance || 0, req.user.id, notes || null
        ]
      );
      await audit(req, "RECORD_PAYMENT", "payments", rows[0].id, null,
        { receipt_number, amount_paid, student_id });
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      if (err.code === "23505")
        return res.status(409).json({ success: false, message: "Receipt number already exists." });
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── GET /api/finance/student-balance/:id ─────────────────────────
router.get("/student-balance/:id", auth, roleM(ALL), async (req, res) => {
  try {
    const sid = getSchoolId(req);
    const { rows: st } = await db.query(
      "SELECT * FROM students WHERE id=$1", [req.params.id]
    );
    if (!st.length)
      return res.status(404).json({ success: false, message: "Student not found." });
    if (req.user.role !== "SUPER_ADMIN" && st[0].school_id !== sid)
      return res.status(403).json({ success: false, message: "Access denied." });

    const year = req.query.academic_year || new Date().getFullYear().toString();
    const { rows } = await db.query(
      `SELECT
         COALESCE(SUM(py.amount_paid),0) AS total_paid,
         COALESCE(SUM(py.balance),0)     AS total_balance,
         COALESCE(SUM(fs.amount),0)      AS total_billed,
         COUNT(py.id)                    AS payment_count
       FROM fee_structures fs
       LEFT JOIN payments py
         ON py.fee_structure_id = fs.id AND py.student_id = $1
       WHERE fs.school_id = $2 AND fs.academic_year = $3
         AND (fs.class_id IS NULL OR fs.class_id = $4)`,
      [req.params.id, st[0].school_id, year, st[0].class_id]
    );
    return res.json({ success: true, data: { student: st[0], ...rows[0] } });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
