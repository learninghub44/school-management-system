-- ================================================================
-- PARENT PORTAL — adds PARENT role + guardians link table
-- Safe to re-run (idempotent). Run after cbc_schema.sql.
-- ================================================================

-- 1. Allow 'PARENT' as a valid role on users.
--    Postgres can't ALTER a CHECK constraint in place, so drop + recreate.
DO $$ BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('SUPER_ADMIN','PRINCIPAL','DEPUTY_PRINCIPAL','HOD','TEACHER','BURSAR','PARENT'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- PARENT accounts still belong to a single school_id (like staff) — the
-- existing super_admin_no_school constraint already requires this for any
-- non-SUPER_ADMIN role, so no change needed there.

-- ================================================================
-- GUARDIANS — many-to-many link between PARENT users and students.
-- Supports: a parent with multiple children (siblings), and a student
-- with multiple guardians (mother + father + legal guardian, etc).
-- ================================================================
CREATE TABLE IF NOT EXISTS guardians (
  id            BIGSERIAL    PRIMARY KEY,
  school_id     UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id       UUID         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  student_id    UUID         NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship  VARCHAR(30)  CHECK (relationship IN ('Mother','Father','Guardian','Other')),
  is_primary    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_guardians_user    ON guardians(user_id);
CREATE INDEX IF NOT EXISTS idx_guardians_student ON guardians(student_id);
CREATE INDEX IF NOT EXISTS idx_guardians_school  ON guardians(school_id);

-- Verify
SELECT 'migration_parent_portal applied' AS status;
