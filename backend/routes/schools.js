/**
 * /api/schools
 * SUPER_ADMIN: full CRUD + toggle
 * School staff (PRINCIPAL etc): read own school only, update own school
 * logo_url: validated to https:// only to prevent SSRF
 */
"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");
const db        = require("../config/db");
const auth      = require("../middleware/authMiddleware");
const roleM     = require("../middleware/roleMiddleware");
const { audit } = require("../middleware/auditLog");

const router = express.Router();

// ── GET /api/schools — SUPER_ADMIN only ──────────────────────────
router.get("/", auth, roleM(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.*,
              COUNT(DISTINCT u.id)::int  AS staff_count,
              COUNT(DISTINCT st.id)::int AS student_count
       FROM schools s
       LEFT JOIN users u   ON u.school_id  = s.id AND u.is_active  = TRUE
       LEFT JOIN students st ON st.school_id = s.id AND st.is_active = TRUE
       GROUP BY s.id
       ORDER BY s.name`
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/schools/me — own school info ────────────────────────
router.get("/me", auth, async (req, res) => {
  try {
    if (!req.user.school_id)
      return res.status(404).json({ success: false, message: "No school associated." });
    const { rows } = await db.query(
      "SELECT * FROM schools WHERE id=$1", [req.user.school_id]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: "School not found." });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── GET /api/schools/learning-areas — public reference ───────────
router.get("/learning-areas", auth, async (req, res) => {
  try {
    const p = []; let w = "WHERE 1=1";
    if (req.query.stage) { p.push(req.query.stage); w += ` AND stage=$${p.length}`; }
    const { rows } = await db.query(
      `SELECT * FROM learning_areas ${w} ORDER BY sort_order, name`, p
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── POST /api/schools — SUPER_ADMIN only ─────────────────────────
router.post("/", auth, roleM(["SUPER_ADMIN"]),
  [
    body("name").trim().notEmpty().isLength({ max: 255 }),
    body("school_code").trim().notEmpty().matches(/^[A-Z0-9]{2,20}$/i)
      .withMessage("Code must be 2–20 alphanumeric characters"),
    body("email").optional().isEmail().normalizeEmail(),
    body("phone").optional().matches(/^\+?[\d\s\-]{7,20}$/),
    body("current_term").optional().isInt({ min: 1, max: 3 }),
    body("academic_year").optional().matches(/^\d{4}$/),
    body("level").optional().isIn(["ECDE", "Primary", "Junior Secondary", "Senior Secondary", "Mixed"]),
    body("county").optional().trim().isLength({ max: 100 }),
    body("sub_county").optional().trim().isLength({ max: 100 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });
    try {
      const {
        name, school_code, address, phone, email,
        county, sub_county, level, academic_year, current_term
      } = req.body;
      const { rows } = await db.query(
        `INSERT INTO schools
         (name, school_code, address, phone, email, county, sub_county,
          level, academic_year, current_term)
         VALUES ($1, UPPER($2), $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          name, school_code, address || null, phone || null, email || null,
          county || null, sub_county || null,
          level || "Primary",
          academic_year || new Date().getFullYear().toString(),
          current_term || 1
        ]
      );
      await audit(req, "CREATE_SCHOOL", "schools", rows[0].id, null, { name, school_code });
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      if (err.code === "23505")
        return res.status(409).json({ success: false, message: "School code already exists." });
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── PUT /api/schools/:id — SUPER_ADMIN or own school ─────────────
router.put("/:id", auth,
  [
    body("name").optional().trim().isLength({ max: 255 }),
    body("email").optional().isEmail().normalizeEmail(),
    body("phone").optional().matches(/^\+?[\d\s\-]{7,20}$/),
    body("current_term").optional().isInt({ min: 1, max: 3 }),
    body("academic_year").optional().matches(/^\d{4}$/),
    body("level").optional().isIn(["ECDE", "Primary", "Junior Secondary", "Senior Secondary", "Mixed"]),
    // FIX: logo_url must be a safe HTTPS URL — prevents SSRF / open redirect
    body("logo_url").optional().custom(val => {
      if (!val) return true;
      try {
        const u = new URL(val);
        if (u.protocol !== "https:")
          throw new Error("logo_url must use https://");
        return true;
      } catch {
        throw new Error("logo_url must be a valid https:// URL");
      }
    }),
    body("county").optional().trim().isLength({ max: 100 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ success: false, errors: errs.array() });

    // Access check: SUPER_ADMIN can update any, others can only update own
    if (req.user.role !== "SUPER_ADMIN" && req.user.school_id !== req.params.id)
      return res.status(403).json({ success: false, message: "Access denied." });

    try {
      const { rows: ex } = await db.query(
        "SELECT * FROM schools WHERE id=$1", [req.params.id]
      );
      if (!ex.length)
        return res.status(404).json({ success: false, message: "School not found." });

      const {
        name, address, phone, email, logo_url,
        county, academic_year, current_term, level
      } = req.body;

      const { rows } = await db.query(
        `UPDATE schools SET
           name          = COALESCE($1,  name),
           address       = COALESCE($2,  address),
           phone         = COALESCE($3,  phone),
           email         = COALESCE($4,  email),
           logo_url      = COALESCE($5,  logo_url),
           county        = COALESCE($6,  county),
           academic_year = COALESCE($7,  academic_year),
           current_term  = COALESCE($8,  current_term),
           level         = COALESCE($9,  level),
           updated_at    = NOW()
         WHERE id = $10
         RETURNING *`,
        [
          name || null, address || null, phone || null, email || null,
          logo_url || null, county || null, academic_year || null,
          current_term ?? null, level || null, req.params.id
        ]
      );
      await audit(req, "UPDATE_SCHOOL", "schools", req.params.id, ex[0], rows[0]);
      return res.json({ success: true, data: rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ── PATCH /api/schools/:id/toggle — SUPER_ADMIN only ────────────
router.patch("/:id/toggle", auth, roleM(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const { rows } = await db.query(
      "UPDATE schools SET is_active = NOT is_active, updated_at = NOW() WHERE id=$1 RETURNING id, name, is_active",
      [req.params.id]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: "School not found." });
    await audit(req, "TOGGLE_SCHOOL", "schools", req.params.id, null, { is_active: rows[0].is_active });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
