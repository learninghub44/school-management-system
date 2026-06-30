-- ============================================================
-- migration_cbc_promotion.sql
-- Adds proper CBC-aligned promotion tracking to the system.
--
-- What this adds:
-- 1. assessment_number on students (the KNEC learner tracking ID,
--    separate from upi_number/NEMIS — used on cba.knec.ac.ke)
-- 2. promotion_history table — audit trail of every class move
-- 3. kpsea_registered / kjsea_registered flags on students —
--    so the system can warn if a Grade 6/9 student hasn't been
--    registered with KNEC before promotion
-- ============================================================

-- 1. assessment_number: the KNEC-issued number that tracks a
--    learner from Grade 3 through Grade 12 on cba.knec.ac.ke.
--    Usually same as NEMIS/UPI but recorded separately per KNEC docs.
ALTER TABLE students ADD COLUMN IF NOT EXISTS assessment_number VARCHAR(30);
ALTER TABLE students ADD COLUMN IF NOT EXISTS kpsea_registered   BOOLEAN DEFAULT FALSE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS kjsea_registered   BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN students.assessment_number IS
  'KNEC-issued learner tracking number used on cba.knec.ac.ke (Grade 3 → Grade 12)';
COMMENT ON COLUMN students.kpsea_registered IS
  'Whether this student has been registered for KPSEA (Grade 6) on the KNEC CBA portal';
COMMENT ON COLUMN students.kjsea_registered IS
  'Whether this student has been registered for KJSEA (Grade 9) on the KNEC CBA portal';

-- 2. promotion_history: permanent audit log of every class move.
--    Per CBC 100% transition policy, Grade 6→7 and Grade 9→10
--    are mandatory regardless of assessment scores — but the record
--    must still be kept so schools can prove who moved when.
CREATE TABLE IF NOT EXISTS promotion_history (
  id             BIGSERIAL    PRIMARY KEY,
  school_id      UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id     UUID         NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_class_id  INTEGER      REFERENCES classes(id) ON DELETE SET NULL,
  to_class_id    INTEGER      REFERENCES classes(id) ON DELETE SET NULL,
  from_grade     VARCHAR(20),   -- denormalised snapshot e.g. "Grade 6"
  to_grade       VARCHAR(20),   -- denormalised snapshot e.g. "Grade 7"
  from_stage     VARCHAR(30),   -- e.g. "Upper Primary"
  to_stage       VARCHAR(30),   -- e.g. "Junior Secondary"
  academic_year  VARCHAR(9)   NOT NULL,  -- year the student came FROM, e.g. "2025"
  promoted_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  promotion_type VARCHAR(30)  NOT NULL DEFAULT 'Normal'
                   CHECK (promotion_type IN (
                     'Normal',          -- within same stage
                     'KPSEA Transition', -- Grade 6 → 7
                     'KJSEA Transition', -- Grade 9 → 10
                     'Manual'           -- admin override
                   )),
  notes          TEXT,
  promoted_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_history_student ON promotion_history(student_id);
CREATE INDEX IF NOT EXISTS idx_promotion_history_school  ON promotion_history(school_id, academic_year);

COMMENT ON TABLE promotion_history IS
  'Permanent audit trail of student class promotions. Grade 6→7 (KPSEA) and Grade 9→10 (KJSEA) are 100% transition per CBC policy.';
