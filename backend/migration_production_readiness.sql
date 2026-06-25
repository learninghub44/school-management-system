-- ============================================================
-- PRODUCTION READINESS MIGRATION
-- Run once on production DB before go-live
-- Safe to re-run (all statements are idempotent)
-- ============================================================

-- ── REQUIRED: Activate the school so staff can log in ────────────
-- Replace the UUID below with your actual school ID from the DB.
-- You can find it by running: SELECT id, name, is_active FROM schools;
-- UPDATE schools SET is_active = TRUE, updated_at = NOW() WHERE id = 'YOUR-SCHOOL-UUID-HERE';

-- ── Performance indexes for scalability ──────────────────────────
-- These prevent full-table scans as student/assessment counts grow.

-- Assessments: most common query patterns
CREATE INDEX IF NOT EXISTS idx_assessments_school_student   ON assessments(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_assessments_school_class     ON assessments(school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_school_year_term ON assessments(school_id, academic_year, term);
CREATE INDEX IF NOT EXISTS idx_assessments_student_year     ON assessments(student_id, academic_year, term);

-- Attendance: daily lookups by date + class
CREATE INDEX IF NOT EXISTS idx_attendance_school_date       ON attendance(school_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_school_class_date ON attendance(school_id, class_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date      ON attendance(student_id, date);

-- Students: search and class listing
CREATE INDEX IF NOT EXISTS idx_students_school_active       ON students(school_id, is_active);
CREATE INDEX IF NOT EXISTS idx_students_school_class        ON students(school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_students_name                ON students(school_id, last_name, first_name);

-- Users: login lookups
CREATE INDEX IF NOT EXISTS idx_users_username               ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email                  ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_school                 ON users(school_id, is_active);

-- Token blocklist: jti lookups on every authenticated request
CREATE INDEX IF NOT EXISTS idx_token_blocklist_jti          ON token_blocklist(jti);
CREATE INDEX IF NOT EXISTS idx_token_blocklist_expires      ON token_blocklist(expires_at);

-- Audit logs: filtered reads by school + action
CREATE INDEX IF NOT EXISTS idx_audit_school_created         ON audit_logs(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_created           ON audit_logs(user_id, created_at DESC);

-- Payments: finance reports
CREATE INDEX IF NOT EXISTS idx_payments_school_year         ON payments(school_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_payments_student             ON payments(student_id);

-- Report cards
CREATE INDEX IF NOT EXISTS idx_report_cards_school_year     ON report_cards(school_id, academic_year, term);
CREATE INDEX IF NOT EXISTS idx_report_cards_student         ON report_cards(student_id, academic_year, term);

-- AI usage log: daily quota lookups
CREATE INDEX IF NOT EXISTS idx_ai_usage_school_date         ON ai_usage_log(school_id, created_at);

-- Interventions: active cases
CREATE INDEX IF NOT EXISTS idx_interventions_school_status  ON interventions(school_id, status, risk_level);

-- ── Token blocklist: auto-purge expired tokens ───────────────────
-- Old tokens pile up forever without this. Run as a periodic job or
-- add to your cleanup cron. This just makes the index useful:
-- DELETE FROM token_blocklist WHERE expires_at < NOW();
-- (already handled by jobs/cleanupTokens.js if scheduled)

-- ── Summary ──────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM schools WHERE is_active = TRUE)  AS active_schools,
  (SELECT COUNT(*) FROM schools WHERE is_active = FALSE) AS inactive_schools,
  (SELECT COUNT(*) FROM users   WHERE is_active = TRUE)  AS active_users,
  (SELECT COUNT(*) FROM students WHERE is_active = TRUE) AS active_students;
