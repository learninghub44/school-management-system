/**
 * Audit log middleware — writes to audit_logs table
 * Never throws — audit failures must not break request flow
 */
"use strict";
const db = require("../config/db");

async function audit(req, action, resource, resourceId, oldVal, newVal, outcome = "SUCCESS", detail = null) {
  try {
    const user  = req?.user;
    const ip    = req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
                || req?.socket?.remoteAddress
                || null;
    const ua    = req?.headers?.["user-agent"]?.substring(0, 255) || null;

    await db.query(
      `INSERT INTO audit_logs
         (school_id, user_id, user_role, action, resource_type, resource_id,
          old_value, new_value, ip_address, user_agent, outcome, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        user?.school_id  || null,
        user?.id         || null,
        user?.role       || null,
        action,
        resource         || null,
        resourceId?.toString() || null,
        oldVal ? JSON.stringify(oldVal) : null,
        newVal ? JSON.stringify(newVal) : null,
        ip,
        ua,
        outcome,
        detail || null,
      ]
    );
  } catch (e) {
    // Audit errors are logged but never propagated
    console.error("Audit log error:", e.message);
  }
}

module.exports = { audit };
