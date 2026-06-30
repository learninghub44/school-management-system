-- ================================================================
-- POST-SCHEMA MIGRATION — run AFTER cbc_schema.sql on a fresh DB
-- ================================================================
-- cbc_schema.sql already contains the consolidated, up-to-date
-- table definitions for academic_years, streams, classes, exams,
-- assessment_categories/moderation, payment_plans/subscriptions,
-- ai_usage_log, token_blocklist, audit_log, and the pathway
-- columns/constraints on classes & learning_areas.
--
-- The ONLY thing genuinely missing from cbc_schema.sql is the
-- school branding columns used live by routes/schools.js,
-- routes/reports.js, and frontend/school-admin.html. Everything
-- else below is optional but recommended (perf indexes).
--
-- Every statement here is idempotent — safe to run multiple times,
-- and safe to run even if some of it already exists.
-- ================================================================

-- ── School branding (REQUIRED — code references these columns) ──
ALTER TABLE schools ADD COLUMN IF NOT EXISTS motto                     VARCHAR(255);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS theme_color                VARCHAR(7);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS report_card_footer         TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS principal_signature_name   VARCHAR(150);

-- ── Performance indexes (recommended, not required for correctness) ──
CREATE INDEX IF NOT EXISTS idx_assessments_school_student   ON assessments(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_assessments_school_class     ON assessments(school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_school_year_term ON assessments(school_id, academic_year, term);
CREATE INDEX IF NOT EXISTS idx_assessments_student_year     ON assessments(student_id, academic_year, term);

CREATE INDEX IF NOT EXISTS idx_attendance_school_date       ON attendance(school_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_school_class_date ON attendance(school_id, class_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date      ON attendance(student_id, date);

CREATE INDEX IF NOT EXISTS idx_students_school_active       ON students(school_id, is_active);
CREATE INDEX IF NOT EXISTS idx_students_school_class        ON students(school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_students_name                ON students(school_id, last_name, first_name);

CREATE INDEX IF NOT EXISTS idx_users_username               ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email                  ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_school                 ON users(school_id, is_active);

CREATE INDEX IF NOT EXISTS idx_token_blocklist_jti          ON token_blocklist(jti);
CREATE INDEX IF NOT EXISTS idx_token_blocklist_expires      ON token_blocklist(expires_at);

CREATE INDEX IF NOT EXISTS idx_students_fullname
  ON students (school_id, LOWER(first_name || ' ' || last_name));
CREATE INDEX IF NOT EXISTS idx_students_firstname_lower
  ON students (school_id, LOWER(first_name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_students_lastname_lower
  ON students (school_id, LOWER(last_name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_students_admission_lower
  ON students (school_id, LOWER(admission_number) text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_teachers_firstname_lower
  ON teachers (school_id, LOWER(first_name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_teachers_lastname_lower
  ON teachers (school_id, LOWER(last_name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_teachers_tsc_lower
  ON teachers (school_id, LOWER(tsc_number) text_pattern_ops);

-- ── Sanity check: confirm nothing is missing ─────────────────────
-- Run this after the migration to confirm all expected tables exist:
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' ORDER BY table_name;
