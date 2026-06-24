"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const db   = require("../config/db");
const auth = require("../middleware/authMiddleware");
const roleM = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");

const router = express.Router();

const READ_ROLES  = ["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD","TEACHER"];
const WRITE_ROLES = ["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD","TEACHER"];
const ADMIN_ROLES = ["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD"];

function schoolId(req) {
  return req.user.role === "SUPER_ADMIN" ? (req.query.school_id || req.body.school_id || null) : req.user.school_id;
}

// GET /api/interventions?student_id=&status=&risk_level=&term=&academic_year=
router.get("/", auth, roleM(READ_ROLES), async (req, res) => {
  try {
    const sid = schoolId(req);
    const p = [], where = [];
    if (sid)                    { p.push(sid);                    where.push(`i.school_id=$${p.length}`); }
    if (req.query.student_id)   { p.push(req.query.student_id);   where.push(`i.student_id=$${p.length}`); }
    if (req.query.status)       { p.push(req.query.status);       where.push(`i.status=$${p.length}`); }
    if (req.query.risk_level)   { p.push(req.query.risk_level);   where.push(`i.risk_level=$${p.length}`); }
    if (req.query.term)         { p.push(req.query.term);          where.push(`i.term=$${p.length}`); }
    if (req.query.academic_year){ p.push(req.query.academic_year); where.push(`i.academic_year=$${p.length}`); }

    const wc = where.length ? "WHERE " + where.join(" AND ") : "";
    const { rows } = await db.query(
      `SELECT i.*,
              s.first_name||' '||s.last_name AS student_name,
              s.admission_number,
              u.name AS flagged_by_name
       FROM interventions i
       JOIN students s ON s.id = i.student_id
       LEFT JOIN users u ON u.id = i.flagged_by
       ${wc}
       ORDER BY
         CASE i.risk_level WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
         i.created_at DESC`, p
    );

    // Attach updates for each intervention
    const ids = rows.map(r => r.id);
    let updates = [];
    if (ids.length) {
      const { rows: u } = await db.query(
        `SELECT iu.*, us.name AS updated_by_name
         FROM intervention_updates iu
         LEFT JOIN users us ON us.id = iu.updated_by
         WHERE iu.intervention_id = ANY($1::bigint[])
         ORDER BY iu.created_at ASC`, [ids]
      );
      updates = u;
    }

    const updatesMap = {};
    updates.forEach(u => {
      if (!updatesMap[u.intervention_id]) updatesMap[u.intervention_id] = [];
      updatesMap[u.intervention_id].push(u);
    });
    rows.forEach(r => { r.updates = updatesMap[r.id] || []; });

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("interventions GET:", err.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST /api/interventions — flag a learner
router.post("/", auth, roleM(WRITE_ROLES),
  [
    body("student_id").notEmpty().isUUID(),
    body("reason").trim().notEmpty().isLength({ max: 2000 }),
    body("intervention_plan").optional().trim().isLength({ max: 3000 }),
    body("risk_level").optional().isIn(["Low","Medium","High","Critical"]),
    body("term").optional().isInt({ min: 1, max: 3 }),
    body("academic_year").optional().matches(/^\d{4}$/),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const sid = req.user.role === "SUPER_ADMIN" ? req.body.school_id : req.user.school_id;
      if (!sid) return res.status(400).json({ success: false, message: "school_id required." });

      const { student_id, reason, intervention_plan, risk_level, term, academic_year } = req.body;
      const { rows } = await db.query(
        `INSERT INTO interventions
           (school_id, student_id, flagged_by, reason, intervention_plan,
            risk_level, term, academic_year)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [sid, student_id, req.user.id, reason, intervention_plan || null,
         risk_level || "Medium", term || null, academic_year || null]
      );
      await audit(req, "FLAG_INTERVENTION", "interventions", rows[0].id, null, { student_id, risk_level });
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      console.error("interventions POST:", err.message);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// PATCH /api/interventions/:id — update status
router.patch("/:id", auth, roleM(ADMIN_ROLES),
  [
    body("status").optional().isIn(["Active","In Progress","Resolved","Closed"]),
    body("intervention_plan").optional().trim().isLength({ max: 3000 }),
    body("risk_level").optional().isIn(["Low","Medium","High","Critical"]),
    body("ai_recommendations").optional().trim().isLength({ max: 3000 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const { rows: ex } = await db.query("SELECT * FROM interventions WHERE id=$1", [req.params.id]);
      if (!ex.length) return res.status(404).json({ success: false, message: "Not found." });
      if (req.user.role !== "SUPER_ADMIN" && ex[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });

      const { status, intervention_plan, risk_level, ai_recommendations } = req.body;
      const resolvedAt = status === "Resolved" || status === "Closed" ? "NOW()" : "NULL";

      await db.query(
        `UPDATE interventions SET
           status=$1, intervention_plan=COALESCE($2,intervention_plan),
           risk_level=COALESCE($3,risk_level),
           ai_recommendations=COALESCE($4,ai_recommendations),
           resolved_at=${resolvedAt}, updated_at=NOW()
         WHERE id=$5`,
        [status || ex[0].status, intervention_plan, risk_level, ai_recommendations, req.params.id]
      );
      await audit(req, "UPDATE_INTERVENTION", "interventions", req.params.id, null, { status });
      return res.json({ success: true, message: "Updated." });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// POST /api/interventions/:id/updates — add a progress note
router.post("/:id/updates", auth, roleM(WRITE_ROLES),
  [body("note").trim().notEmpty().isLength({ max: 2000 })],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const { rows: ex } = await db.query("SELECT school_id FROM interventions WHERE id=$1", [req.params.id]);
      if (!ex.length) return res.status(404).json({ success: false, message: "Not found." });
      if (req.user.role !== "SUPER_ADMIN" && ex[0].school_id !== req.user.school_id)
        return res.status(403).json({ success: false, message: "Access denied." });

      const { rows } = await db.query(
        `INSERT INTO intervention_updates (intervention_id, updated_by, note) VALUES ($1,$2,$3) RETURNING *`,
        [req.params.id, req.user.id, req.body.note]
      );
      // Also bump status to In Progress if still Active
      await db.query(
        "UPDATE interventions SET status='In Progress', updated_at=NOW() WHERE id=$1 AND status='Active'",
        [req.params.id]
      );
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// DELETE /api/interventions/:id — admin only
router.delete("/:id", auth, roleM(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL"]), async (req, res) => {
  try {
    const { rows } = await db.query("SELECT school_id FROM interventions WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found." });
    if (req.user.role !== "SUPER_ADMIN" && rows[0].school_id !== req.user.school_id)
      return res.status(403).json({ success: false, message: "Access denied." });
    await db.query("DELETE FROM interventions WHERE id=$1", [req.params.id]);
    await audit(req, "DELETE_INTERVENTION", "interventions", req.params.id);
    return res.json({ success: true, message: "Deleted." });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
