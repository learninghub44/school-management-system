/**
 * parentScope — restricts a PARENT user to only the students they're
 * linked to via the `guardians` table. Read-only by design: parent
 * routes never accept writes to student/academic data.
 *
 * Attaches req.guardianStudentIds = [uuid, ...] for handlers to filter on.
 * If a :student_id / :id param is present, also verifies it's in scope
 * and 403s early so individual route handlers don't have to repeat the check.
 */
"use strict";
const db = require("../config/db");

async function parentScope(req, res, next) {
  if (req.user.role !== "PARENT")
    return res.status(403).json({ success: false, message: "Parent access only." });

  try {
    const { rows } = await db.query(
      `SELECT student_id FROM guardians WHERE user_id = $1 AND school_id = $2`,
      [req.user.id, req.user.school_id]
    );
    req.guardianStudentIds = rows.map(r => r.student_id);

    if (!req.guardianStudentIds.length)
      return res.status(403).json({ success: false, message: "No students linked to this account. Contact the school office." });

    const paramId = req.params.student_id || req.params.id;
    if (paramId && !req.guardianStudentIds.includes(paramId))
      return res.status(403).json({ success: false, message: "Access denied. Not your child's record." });

    next();
  } catch (err) {
    console.error("parentScope:", err.message);
    return res.status(500).json({ success: false, message: "Could not verify guardian access." });
  }
}

module.exports = parentScope;
