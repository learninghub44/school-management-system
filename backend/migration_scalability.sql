-- ================================================================
-- Migration: Scalability & Performance Indexes
-- Kadem & Zetu School Management System
-- Run once against production DB
-- ================================================================

-- Full-text search indexes for student name/admission search (ILIKE queries)
CREATE INDEX IF NOT EXISTS idx_students_fullname
  ON students (school_id, LOWER(first_name || ' ' || last_name));

CREATE INDEX IF NOT EXISTS idx_students_firstname_lower
  ON students (school_id, LOWER(first_name) text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_students_lastname_lower
  ON students (school_id, LOWER(last_name) text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_students_admission_lower
  ON students (school_id, LOWER(admission_number) text_pattern_ops);

-- Teacher search indexes
CREATE INDEX IF NOT EXISTS idx_teachers_firstname_lower
  ON teachers (school_id, LOWER(first_name) text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_teachers_lastname_lower
  ON teachers (school_id, LOWER(last_name) text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_teachers_tsc_lower
  ON teachers (school_id, LOWER(tsc_number) text_pattern_ops);

-- Auth middleware: blocklist lookup (already has unique, but explicit index for speed)
CREATE INDEX IF NOT EXISTS idx_token_blocklist_exp
  ON token_blocklist (expires_at);

-- Subscription middleware: fast lookup
CREATE INDEX IF NOT EXISTS idx_school_subs_school_created
  ON school_subscriptions (school_id, created_at DESC);

-- Attendance: date range queries are common
CREATE INDEX IF NOT EXISTS idx_attendance_school_date
  ON attendance (school_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_class_date
  ON attendance (class_id, date DESC);

-- Assessments: per-student per-term queries
CREATE INDEX IF NOT EXISTS idx_assessments_student_term
  ON assessments (school_id, student_id, term, academic_year);

-- Payments: per-student queries
CREATE INDEX IF NOT EXISTS idx_payments_student_term
  ON payments (school_id, student_id, term, academic_year);

-- Audit logs: school + time queries (for audit reports)
CREATE INDEX IF NOT EXISTS idx_audit_logs_school_time
  ON audit_logs (school_id, created_at DESC);

-- Report cards
CREATE INDEX IF NOT EXISTS idx_report_cards_school_term
  ON report_cards (school_id, term, academic_year);
