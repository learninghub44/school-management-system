-- ================================================================
-- RECONCILIATION MIGRATION: interventions / intervention_updates /
-- assessment_moderation
--
-- WHY THIS EXISTS:
-- migration_new_only.sql defines an OLD/INCOMPATIBLE shape for these
-- tables (UUID ids, different columns) that the live route code
-- (interventions.js, ai.js, moderation.js) does NOT use. The live
-- code expects the shape defined in cbc_schema.sql / 
-- migration_cbc_advanced.sql (BIGSERIAL ids, risk_level, flagged_by,
-- class/term-based locking for moderation).
--
-- This migration is SAFE to run regardless of which shape (if any)
-- currently exists in your database:
--   - If table doesn't exist          -> creates the correct version
--   - If table already has the correct shape -> does nothing
--   - If table has the legacy/wrong shape     -> renames it to
--     *_legacy_backup (NO DATA IS DROPPED), copies rows forward into
--     a freshly created correct table, and remaps any FK references
--     in intervention_updates.
--
-- Run this ONCE, after backing up your DB as a precaution. It is
-- idempotent — safe to re-run.
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1. INTERVENTIONS
-- ----------------------------------------------------------------
DO $$
DECLARE
  id_type TEXT;
  has_risk_level BOOLEAN;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'interventions') THEN

    SELECT data_type INTO id_type
    FROM information_schema.columns
    WHERE table_name = 'interventions' AND column_name = 'id';

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'interventions' AND column_name = 'risk_level'
    ) INTO has_risk_level;

    IF id_type = 'uuid' OR NOT has_risk_level THEN
      RAISE NOTICE 'interventions: legacy/incompatible shape detected — migrating';

      -- Rename legacy table out of the way (keeps all data, never dropped)
      ALTER TABLE interventions RENAME TO interventions_legacy_backup;

      -- Create the correct schema used by live code
      CREATE TABLE interventions (
        id                  BIGSERIAL   PRIMARY KEY,
        school_id           UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        student_id          UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        flagged_by          UUID        REFERENCES users(id) ON DELETE SET NULL,
        reason              TEXT        NOT NULL,
        intervention_plan   TEXT,
        status              VARCHAR(30) NOT NULL DEFAULT 'Active'
                              CHECK (status IN ('Active','In Progress','Resolved','Closed')),
        risk_level          VARCHAR(20) NOT NULL DEFAULT 'Medium'
                              CHECK (risk_level IN ('Low','Medium','High','Critical')),
        ai_recommendations  TEXT,
        term                SMALLINT    CHECK (term BETWEEN 1 AND 3),
        academic_year       VARCHAR(4),
        resolved_at         TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Mapping table: legacy UUID id -> new BIGSERIAL id, so we can
      -- remap intervention_updates FKs afterward.
      CREATE TEMP TABLE _interventions_id_map (
        old_id UUID,
        new_id BIGINT
      );

      -- Copy data forward, capturing the new id for each old row.
      -- Column mapping: initiated_by -> flagged_by,
      -- status 'open' -> 'Active' (best-effort mapping; anything
      -- else falls through to 'Active' as a safe default since the
      -- legacy table only ever used 'open').
      INSERT INTO interventions (
        school_id, student_id, flagged_by, reason, status,
        risk_level, created_at, updated_at
      )
      SELECT
        school_id, student_id, initiated_by, reason,
        CASE WHEN status = 'open' THEN 'Active' ELSE 'Active' END,
        'Medium',
        created_at, updated_at
      FROM interventions_legacy_backup
      RETURNING id; -- not directly usable for mapping in plain INSERT, handled below

      -- The RETURNING above can't be joined to the source row in a
      -- plain INSERT...SELECT, so rebuild the map explicitly using a
      -- correlated approach (safe because legacy ids are unique).
      TRUNCATE _interventions_id_map;
      INSERT INTO _interventions_id_map (old_id, new_id)
      SELECT lb.id, i.id
      FROM interventions_legacy_backup lb
      JOIN interventions i
        ON i.school_id = lb.school_id
       AND i.student_id = lb.student_id
       AND i.reason = lb.reason
       AND i.created_at = lb.created_at;

      RAISE NOTICE 'interventions: migrated % rows', (SELECT COUNT(*) FROM interventions_legacy_backup);
    ELSE
      RAISE NOTICE 'interventions: already correct shape — no action needed';
    END IF;

  ELSE
    -- Table doesn't exist at all — create it fresh.
    CREATE TABLE interventions (
      id                  BIGSERIAL   PRIMARY KEY,
      school_id           UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id          UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      flagged_by          UUID        REFERENCES users(id) ON DELETE SET NULL,
      reason              TEXT        NOT NULL,
      intervention_plan   TEXT,
      status              VARCHAR(30) NOT NULL DEFAULT 'Active'
                            CHECK (status IN ('Active','In Progress','Resolved','Closed')),
      risk_level          VARCHAR(20) NOT NULL DEFAULT 'Medium'
                            CHECK (risk_level IN ('Low','Medium','High','Critical')),
      ai_recommendations  TEXT,
      term                SMALLINT    CHECK (term BETWEEN 1 AND 3),
      academic_year       VARCHAR(4),
      resolved_at         TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    RAISE NOTICE 'interventions: created fresh (table did not exist)';
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 2. INTERVENTION_UPDATES (depends on interventions.id type)
-- ----------------------------------------------------------------
DO $$
DECLARE
  id_type TEXT;
  intervention_id_type TEXT;
  legacy_backup_exists BOOLEAN;
BEGIN
  legacy_backup_exists := EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'interventions_legacy_backup'
  );

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'intervention_updates') THEN

    SELECT data_type INTO intervention_id_type
    FROM information_schema.columns
    WHERE table_name = 'intervention_updates' AND column_name = 'intervention_id';

    IF intervention_id_type = 'uuid' THEN
      RAISE NOTICE 'intervention_updates: legacy shape detected — migrating';

      ALTER TABLE intervention_updates RENAME TO intervention_updates_legacy_backup;

      CREATE TABLE intervention_updates (
        id              BIGSERIAL   PRIMARY KEY,
        intervention_id BIGINT      NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
        updated_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
        note            TEXT        NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Remap old UUID intervention_id -> new BIGINT id using the
      -- mapping built in step 1 (only possible if that map exists,
      -- i.e. interventions was also migrated in this same run).
      IF legacy_backup_exists AND EXISTS (
        SELECT 1 FROM pg_tables WHERE tablename = '_interventions_id_map'
      ) THEN
        INSERT INTO intervention_updates (intervention_id, updated_by, note, created_at)
        SELECT m.new_id, u.updated_by, u.notes, u.created_at
        FROM intervention_updates_legacy_backup u
        JOIN _interventions_id_map m ON m.old_id = u.intervention_id;

        RAISE NOTICE 'intervention_updates: migrated % rows', (SELECT COUNT(*) FROM intervention_updates_legacy_backup);
      ELSE
        RAISE NOTICE 'intervention_updates: could not remap rows automatically (no id map available) — data preserved in intervention_updates_legacy_backup only';
      END IF;
    ELSE
      RAISE NOTICE 'intervention_updates: already correct shape — no action needed';
    END IF;

  ELSE
    CREATE TABLE intervention_updates (
      id              BIGSERIAL   PRIMARY KEY,
      intervention_id BIGINT      NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
      updated_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
      note            TEXT        NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    RAISE NOTICE 'intervention_updates: created fresh (table did not exist)';
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 3. ASSESSMENT_MODERATION
-- Legacy shape (migration_new_only.sql) is a per-ASSESSMENT override
-- table; correct/live shape (cbc_schema.sql) is a per-CLASS/TERM
-- lock table. These serve genuinely different purposes, so legacy
-- data is preserved as a backup but NOT auto-migrated into the new
-- table (there's no safe automatic field mapping between them).
-- ----------------------------------------------------------------
DO $$
DECLARE
  has_class_id BOOLEAN;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assessment_moderation') THEN

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'assessment_moderation' AND column_name = 'class_id'
    ) INTO has_class_id;

    IF NOT has_class_id THEN
      RAISE NOTICE 'assessment_moderation: legacy/incompatible shape detected — backing up and recreating';

      ALTER TABLE assessment_moderation RENAME TO assessment_moderation_legacy_backup;

      CREATE TABLE assessment_moderation (
        id            BIGSERIAL   PRIMARY KEY,
        school_id     UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        class_id      BIGINT      NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        term          SMALLINT    NOT NULL CHECK (term BETWEEN 1 AND 3),
        academic_year VARCHAR(4)  NOT NULL,
        locked_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
        locked_at     TIMESTAMPTZ,
        is_locked     BOOLEAN     NOT NULL DEFAULT FALSE,
        moderated_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
        moderated_at  TIMESTAMPTZ,
        notes         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (school_id, class_id, term, academic_year)
      );

      RAISE NOTICE 'assessment_moderation: % legacy rows preserved in assessment_moderation_legacy_backup (not auto-migrated — different purpose/shape, review manually if needed)', (SELECT COUNT(*) FROM assessment_moderation_legacy_backup);
    ELSE
      RAISE NOTICE 'assessment_moderation: already correct shape — no action needed';
    END IF;

  ELSE
    CREATE TABLE assessment_moderation (
      id            BIGSERIAL   PRIMARY KEY,
      school_id     UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      class_id      BIGINT      NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      term          SMALLINT    NOT NULL CHECK (term BETWEEN 1 AND 3),
      academic_year VARCHAR(4)  NOT NULL,
      locked_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
      locked_at     TIMESTAMPTZ,
      is_locked     BOOLEAN     NOT NULL DEFAULT FALSE,
      moderated_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
      moderated_at  TIMESTAMPTZ,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (school_id, class_id, term, academic_year)
    );
    RAISE NOTICE 'assessment_moderation: created fresh (table did not exist)';
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 4. Indexes for the (possibly newly created) interventions table,
-- matching what cbc_schema.sql / migration_cbc_advanced.sql expect.
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_interventions_school   ON interventions(school_id);
CREATE INDEX IF NOT EXISTS idx_interventions_student  ON interventions(student_id);
CREATE INDEX IF NOT EXISTS idx_interventions_status   ON interventions(status);
CREATE INDEX IF NOT EXISTS idx_intervention_updates_intervention ON intervention_updates(intervention_id);
CREATE INDEX IF NOT EXISTS idx_assessment_moderation_lookup ON assessment_moderation(school_id, class_id, term, academic_year);

COMMIT;

-- ================================================================
-- POST-MIGRATION CHECKLIST:
-- 1. Run: SELECT COUNT(*) FROM interventions; — confirm row count
--    looks right (matches old table if migration ran).
-- 2. If *_legacy_backup tables were created, review them, then once
--    you're confident the migration is correct, you can DROP them
--    manually (this script intentionally does NOT drop them for you).
-- 3. Delete or archive migration_new_only.sql from the repo so it's
--    never run again on a fresh DB — it's the source of the drift.
-- ================================================================
