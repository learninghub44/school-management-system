/**
 * /api/users — V-04 mass assignment fix + V-16 audit logging
 * All fields whitelisted explicitly. school_id ALWAYS from JWT, never body.
 */
const express = require("express");
const { body, validationResult } = require("express-validator");
const bcrypt  = require("bcryptjs");
const db      = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");

const router = express.Router();

// Whitelist — only these fields accepted on create/update
const ALLOWED_ROLES = ["SCHOOL_ADMIN","TEACHER","FINANCE","STUDENT","PARENT"];

router.get("/", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]), async (req, res) => {
    try {
        // V-03: school_id always from JWT for non-SUPER_ADMIN
        const schoolId = req.user.role === "SUPER_ADMIN" ? (req.query.school_id||null) : req.user.school_id;
        let q = `SELECT u.id, u.email, u.name, u.phone, u.role, u.school_id, u.is_active,
                        u.last_login, u.created_at, s.name AS school_name, s.school_code
                 FROM users u LEFT JOIN schools s ON s.id=u.school_id`;
        const params = [];
        const where = [];
        if (schoolId) { params.push(schoolId); where.push(`u.school_id=$${params.length}`); }
        if (req.query.role) { params.push(req.query.role); where.push(`u.role=$${params.length}`); }
        if (where.length) q += " WHERE " + where.join(" AND ");
        q += " ORDER BY u.role, u.name";
        const { rows } = await db.query(q, params);
        return res.json({ success: true, data: rows, count: rows.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

router.post("/", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]),
    [
        body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
        body("name").trim().notEmpty().withMessage("Name required").isLength({ max: 150 }),
        body("password").isLength({ min: 6 }).withMessage("Password min 6 chars"),
        // V-04: role whitelisted against allowed list
        body("role").isIn(ALLOWED_ROLES).withMessage(`Role must be one of: ${ALLOWED_ROLES.join(", ")}`),
        body("phone").optional().matches(/^\+?[\d\s\-]{7,20}$/).withMessage("Invalid phone"),
    ],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            // V-04: Whitelist only allowed fields — never spread req.body
            const { email, name, password, role, phone } = req.body;

            // V-03: school_id comes from JWT, NEVER from body
            const schoolId = req.user.role === "SUPER_ADMIN"
                ? (req.body.school_id || null)   // SA can specify target school
                : req.user.school_id;             // all others: own school only

            if (!schoolId) return res.status(400).json({ success: false, message: "school_id required." });

            // V-04: SCHOOL_ADMIN cannot create SUPER_ADMIN
            if (req.user.role !== "SUPER_ADMIN" && role === "SUPER_ADMIN")
                return res.status(403).json({ success: false, message: "Insufficient permissions." });

            // V-04: SCHOOL_ADMIN cannot create accounts in other schools
            if (req.user.role === "SCHOOL_ADMIN" && schoolId !== req.user.school_id)
                return res.status(403).json({ success: false, message: "Cannot create users for other schools." });

            const dup = await db.query("SELECT id FROM users WHERE email=$1", [email]);
            if (dup.rows.length) return res.status(409).json({ success: false, message: "Email already registered." });

            const hash = await bcrypt.hash(password, 12);
            const { rows } = await db.query(
                `WITH new_user AS (
                    INSERT INTO users (email, password_hash, name, phone, role, school_id, must_change_password)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)
                    RETURNING id, email, name, role, phone, school_id, is_active, created_at
                )
                SELECT nu.*, s.name AS school_name, s.school_code
                FROM new_user nu
                LEFT JOIN schools s ON s.id = nu.school_id`,
                [email, hash, name, phone||null, role, schoolId, true] // V-19: force password change
            );

            await audit(req, "CREATE", "users", rows[0].id, null, { email, role, school_id: schoolId });
            return res.status(201).json({ success: true, message: "User created.", data: rows[0] });
        } catch (err) {
            return res.status(500).json({ success: false, message: "Server error." });
        }
    }
);

router.put("/:id", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]), async (req, res) => {
    try {
        const existing = await db.query("SELECT * FROM users WHERE id=$1", [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ success: false, message: "User not found." });
        if (req.user.role === "SCHOOL_ADMIN" && existing.rows[0].school_id !== req.user.school_id)
            return res.status(403).json({ success: false, message: "Access denied." });

        // V-04: Only these fields allowed on update — nothing else from body
        const { name, phone, is_active } = req.body;
        // Role changes only by SUPER_ADMIN
        const role = req.user.role === "SUPER_ADMIN" && req.body.role ? req.body.role : undefined;

        const { rows } = await db.query(
            `UPDATE users SET
               name=COALESCE($1,name),
               phone=COALESCE($2,phone),
               is_active=COALESCE($3,is_active)
               ${role ? ", role=$5" : ""}
             WHERE id=$4
             RETURNING id, email, name, role, phone, school_id, is_active`,
            role
                ? [name||null, phone||null, is_active??null, req.params.id, role]
                : [name||null, phone||null, is_active??null, req.params.id]
        );

        await audit(req, "UPDATE", "users", req.params.id, existing.rows[0], rows[0]);
        return res.json({ success: true, message: "User updated.", data: rows[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

router.delete("/:id", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]), async (req, res) => {
    try {
        if (req.params.id === req.user.id)
            return res.status(400).json({ success: false, message: "Cannot deactivate your own account." });
        const existing = await db.query("SELECT * FROM users WHERE id=$1", [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ success: false, message: "User not found." });
        if (req.user.role === "SCHOOL_ADMIN" && existing.rows[0].school_id !== req.user.school_id)
            return res.status(403).json({ success: false, message: "Access denied." });
        await db.query("UPDATE users SET is_active=FALSE WHERE id=$1", [req.params.id]);
        await audit(req, "DEACTIVATE", "users", req.params.id, { is_active: true }, { is_active: false });
        return res.json({ success: true, message: "User deactivated." });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

router.post("/:id/reset-password", authMiddleware, roleMiddleware(["SUPER_ADMIN","SCHOOL_ADMIN"]),
    [body("new_password").isLength({ min: 6 }).withMessage("Min 6 chars")],
    async (req, res) => {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });
        try {
            const existing = await db.query("SELECT * FROM users WHERE id=$1", [req.params.id]);
            if (!existing.rows.length) return res.status(404).json({ success: false, message: "Not found." });
            if (req.user.role === "SCHOOL_ADMIN" && existing.rows[0].school_id !== req.user.school_id)
                return res.status(403).json({ success: false, message: "Access denied." });
            const hash = await bcrypt.hash(req.body.new_password, 12);
            await db.query(
                "UPDATE users SET password_hash=$1, must_change_password=TRUE, password_changed_at=NOW() WHERE id=$2",
                [hash, req.params.id]
            );
            await audit(req, "RESET_PASSWORD", "users", req.params.id);
            return res.json({ success: true, message: "Password reset. User must change on next login." });
        } catch (err) {
            return res.status(500).json({ success: false, message: "Server error." });
        }
    }
);

module.exports = router;
