-- =============================================================
-- migration_new_only.sql
-- Run this on your existing DB for anything not yet applied.
-- Every statement is safe to re-run (IF NOT EXISTS / ON CONFLICT).
-- =============================================================

-- 1. school_subscriptions: FK on last_payment_id
DO $$ BEGIN
  ALTER TABLE school_subscriptions
    ADD CONSTRAINT school_subscriptions_last_payment_fk
    FOREIGN KEY (last_payment_id) REFERENCES subscription_payments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. students: new columns
ALTER TABLE students ADD COLUMN IF NOT EXISTS stream_id        INTEGER REFERENCES streams(id);
ALTER TABLE students ADD COLUMN IF NOT EXISTS current_class_id INTEGER REFERENCES classes(id);

-- 3. assessments: category column
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES assessment_categories(id);

-- 4. payment_plans: AI daily limit column
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS ai_daily_limit INTEGER DEFAULT 50;

-- 5. report_cards: CBC competency + values columns
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS teacher_remark            TEXT;
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS headteacher_remark        TEXT;
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS ai_remark                 TEXT;
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS cc_communication          SMALLINT CHECK (cc_communication          BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS cc_critical_thinking      SMALLINT CHECK (cc_critical_thinking      BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS cc_creativity             SMALLINT CHECK (cc_creativity             BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS cc_citizenship            SMALLINT CHECK (cc_citizenship            BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS cc_digital_literacy       SMALLINT CHECK (cc_digital_literacy       BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS cc_learning_to_learn      SMALLINT CHECK (cc_learning_to_learn      BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS cc_self_efficacy          SMALLINT CHECK (cc_self_efficacy          BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS val_respect               SMALLINT CHECK (val_respect               BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS val_responsibility        SMALLINT CHECK (val_responsibility        BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS val_integrity             SMALLINT CHECK (val_integrity             BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS val_unity                 SMALLINT CHECK (val_unity                 BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS val_peace                 SMALLINT CHECK (val_peace                 BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS val_patriotism            SMALLINT CHECK (val_patriotism            BETWEEN 1 AND 4);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS val_social_justice        SMALLINT CHECK (val_social_justice        BETWEEN 1 AND 4);

-- 6. classes: pathway column + constraints
ALTER TABLE classes ADD COLUMN IF NOT EXISTS pathway VARCHAR(30);
ALTER TABLE classes DROP CONSTRAINT IF EXISTS chk_classes_pathway;
ALTER TABLE classes ADD CONSTRAINT chk_classes_pathway
  CHECK (pathway IS NULL OR pathway IN ('STEM', 'Social Sciences', 'Arts & Sports'));
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_school_id_grade_stream_academic_year_key;
DO $$ BEGIN
  ALTER TABLE classes ADD CONSTRAINT classes_school_grade_stream_year_pathway_key
    UNIQUE (school_id, grade, stream, academic_year, pathway);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7. learning_areas: pathway column + constraint
ALTER TABLE learning_areas ADD COLUMN IF NOT EXISTS pathway VARCHAR(30);
ALTER TABLE learning_areas DROP CONSTRAINT IF EXISTS chk_learning_areas_pathway;
ALTER TABLE learning_areas ADD CONSTRAINT chk_learning_areas_pathway
  CHECK (pathway IS NULL OR pathway IN ('STEM', 'Social Sciences', 'Arts & Sports'));

-- 8. New tables (skipped if already exist)
CREATE TABLE IF NOT EXISTS academic_years (
  id           SERIAL PRIMARY KEY,
  school_id    UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  label        VARCHAR(20) NOT NULL,
  start_date   DATE,
  end_date     DATE,
  is_current   BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, label)
);

CREATE TABLE IF NOT EXISTS streams (
  id        SERIAL PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name      VARCHAR(50) NOT NULL,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS assessment_categories (
  id        SERIAL PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name      VARCHAR(100) NOT NULL,
  weight    NUMERIC(5,2) DEFAULT 100,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS exams (
  id            SERIAL PRIMARY KEY,
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id      INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  title         VARCHAR(200) NOT NULL,
  exam_date     DATE,
  academic_year VARCHAR(9),
  term          SMALLINT CHECK (term BETWEEN 1 AND 3),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id  UUID REFERENCES teachers(id) ON DELETE SET NULL,
  title       VARCHAR(200) NOT NULL,
  type        VARCHAR(50),
  description TEXT,
  file_url    TEXT,
  term        SMALLINT,
  academic_year VARCHAR(9),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_observations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id  UUID REFERENCES teachers(id) ON DELETE SET NULL,
  type        VARCHAR(80),
  notes       TEXT NOT NULL,
  term        SMALLINT,
  academic_year VARCHAR(9),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interventions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  initiated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason       TEXT NOT NULL,
  status       VARCHAR(30) DEFAULT 'open',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intervention_updates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id UUID NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  notes           TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessment_moderation (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  moderated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  original_level VARCHAR(2),
  moderated_level VARCHAR(2),
  reason        TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Indexes
CREATE INDEX IF NOT EXISTS idx_classes_pathway          ON classes(pathway) WHERE pathway IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sub_payments_merchant_ref ON subscription_payments(merchant_reference);
CREATE INDEX IF NOT EXISTS idx_token_blocklist_exp       ON token_blocklist(expires_at);
CREATE INDEX IF NOT EXISTS idx_school_subs_school_created ON school_subscriptions(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_school_date    ON attendance(school_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_class_date     ON attendance(class_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_student_term  ON assessments(school_id, student_id, term, academic_year);
CREATE INDEX IF NOT EXISTS idx_payments_student_term     ON payments(school_id, student_id, term, academic_year);
CREATE INDEX IF NOT EXISTS idx_audit_logs_school_time    ON audit_logs(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_cards_school_term  ON report_cards(school_id, term, academic_year);
