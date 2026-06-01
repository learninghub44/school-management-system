/**
 * Audit logging utility — V-16
 * Call: await audit(req, action, resourceType, resourceId, oldValue, newValue)
 */
const db = require("../config/db");

async function audit(req, action, resourceType, resourceId = null, oldValue = null, newValue = null, status = "SUCCESS", detail = null) {
    try {
        const user    = req.user;
        const ip      = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null;
        const ua      = req.headers["user-agent"]?.substring(0, 250) || null;

        await db.query(
            `INSERT INTO audit_logs
               (school_id, user_id, user_role, action, resource_type, resource_id,
                old_value, new_value, ip_address, user_agent, status, detail)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
                user?.school_id || null,
                user?.id        || null,
                user?.role      || null,
                action,
                resourceType,
                resourceId ? String(resourceId) : null,
                oldValue  ? JSON.stringify(oldValue)  : null,
                newValue  ? JSON.stringify(newValue)  : null,
                ip,
                ua,
                status,
                detail,
            ]
        );
    } catch (err) {
        // Audit log failure must never break the main request
        console.error("Audit log error:", err.message);
    }
}

module.exports = { audit };
