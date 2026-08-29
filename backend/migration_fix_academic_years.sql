-- ============================================================
-- Migration: Fix academic_years schema + ensure exams table
-- Run this against your Postgres database (any provider's SQL console or psql)
-- ============================================================

-- ── 1. ACADEMIC_YEARS ────────────────────────────────────────────
-- The old schema used column `name`; routes expect `year_label`.
-- Safely add all missing columns without dropping existing data.

-- Add year_label if missing (copy from `name` if it exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'academic_years' AND column_name = 'year_label'
  ) THEN
    ALTER TABLE academic_years ADD COLUMN year_label VARCHAR(9);

    -- If old `name` column exists, copy data across
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'academic_years' AND column_name = 'name'
    ) THEN
      UPDATE academic_years SET year_label = name;
    END IF;

    -- Add unique constraint on (school_id, year_label)
    ALTER TABLE academic_years ADD CONSTRAINT uq_academic_years_school_label
      UNIQUE (school_id, year_label);
  END IF;
END $$;

-- Add term date columns if missing
DO $$
DECLARE
  cols TEXT[] := ARRAY[
    'term1_start', 'term1_end',
    'term2_start', 'term2_end',
    'term3_start', 'term3_end'
  ];
  col TEXT;
BEGIN
  FOREACH col IN ARRAY cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'academic_years' AND column_name = col
    ) THEN
      EXECUTE format('ALTER TABLE academic_years ADD COLUMN %I DATE', col);
    END IF;
  END LOOP;
END $$;

-- Add notes column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'academic_years' AND column_name = 'notes'
  ) THEN
    ALTER TABLE academic_years ADD COLUMN notes TEXT;
  END IF;
END $$;

-- Make start_date and end_date nullable (old schema had NOT NULL)
ALTER TABLE academic_years ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE academic_years ALTER COLUMN end_date   DROP NOT NULL;

-- ── 2. EXAMS TABLE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exams (
  id               SERIAL PRIMARY KEY,
  school_id        UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title            VARCHAR(200) NOT NULL,
  exam_date        DATE         NOT NULL,
  start_time       TIME         NOT NULL,
  end_time         TIME         NOT NULL,
  term             SMALLINT     NOT NULL CHECK (term BETWEEN 1 AND 3),
  academic_year    CHAR(4)      NOT NULL,
  class_id         INTEGER      REFERENCES classes(id) ON DELETE SET NULL,
  learning_area_id INTEGER      REFERENCES learning_areas(id) ON DELETE SET NULL,
  invigilator_id   UUID         REFERENCES teachers(id) ON DELETE SET NULL,
  venue            VARCHAR(150),
  notes            TEXT,
  created_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exams_school ON exams(school_id);
CREATE INDEX IF NOT EXISTS idx_exams_date   ON exams(exam_date);

-- ── 3. ASSESSMENT_MODERATION TABLE ──────────────────────────────
-- Required by moderation routes
CREATE TABLE IF NOT EXISTS assessment_moderation (
  id             BIGSERIAL PRIMARY KEY,
  school_id      UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id       INTEGER     NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  term           SMALLINT    NOT NULL CHECK (term BETWEEN 1 AND 3),
  academic_year  VARCHAR(9)  NOT NULL,
  is_locked      BOOLEAN     NOT NULL DEFAULT FALSE,
  locked_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  locked_at      TIMESTAMPTZ,
  moderated_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  moderated_at   TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, class_id, term, academic_year)
);
