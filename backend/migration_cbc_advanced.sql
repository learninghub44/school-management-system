-- ============================================================
-- CBC Advanced Features Migration
-- Covers: core competencies on report cards, learner portfolio,
-- teacher observations, intervention management, assessment
-- moderation, academic year management, bulk ops audit
-- ============================================================

-- ── 1. Extend report_cards with competencies, values, extra remarks ──
ALTER TABLE report_cards
  ADD COLUMN IF NOT EXISTS teacher_remark          TEXT,
  ADD COLUMN IF NOT EXISTS headteacher_remark      TEXT,
  ADD COLUMN IF NOT EXISTS ai_remark               TEXT,
  -- Core Competencies (1=Not Observed, 2=Developing, 3=Competent, 4=Exceptional)
  ADD COLUMN IF NOT EXISTS cc_communication        SMALLINT CHECK (cc_communication BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS cc_critical_thinking    SMALLINT CHECK (cc_critical_thinking BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS cc_creativity           SMALLINT CHECK (cc_creativity BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS cc_citizenship          SMALLINT CHECK (cc_citizenship BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS cc_digital_literacy     SMALLINT CHECK (cc_digital_literacy BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS cc_learning_to_learn    SMALLINT CHECK (cc_learning_to_learn BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS cc_self_efficacy        SMALLINT CHECK (cc_self_efficacy BETWEEN 1 AND 4),
  -- Values (1=Needs Improvement, 2=Satisfactory, 3=Good, 4=Excellent)
  ADD COLUMN IF NOT EXISTS val_respect             SMALLINT CHECK (val_respect BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS val_responsibility      SMALLINT CHECK (val_responsibility BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS val_integrity           SMALLINT CHECK (val_integrity BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS val_unity               SMALLINT CHECK (val_unity BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS val_peace               SMALLINT CHECK (val_peace BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS val_patriotism          SMALLINT CHECK (val_patriotism BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS val_social_justice      SMALLINT CHECK (val_social_justice BETWEEN 1 AND 4);

-- ── 2. Learner Portfolio ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio_items (
  id              BIGSERIAL PRIMARY KEY,
  school_id       UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id      UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id      UUID        REFERENCES teachers(id) ON DELETE SET NULL,
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  item_type       VARCHAR(50) NOT NULL CHECK (item_type IN (
                    'Project','Assignment','Practical','Artwork','Video','Image','Observation','Other')),
  learning_area_id BIGINT     REFERENCES learning_areas(id) ON DELETE SET NULL,
  term            SMALLINT    CHECK (term BETWEEN 1 AND 3),
  academic_year   VARCHAR(4),
  file_url        TEXT,
  thumbnail_url   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portfolio_student ON portfolio_items(student_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_school  ON portfolio_items(school_id);

-- ── 3. Teacher Observation Records ──────────────────────────────
CREATE TABLE IF NOT EXISTS teacher_observations (
  id                BIGSERIAL PRIMARY KEY,
  school_id         UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id        UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id        UUID        NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id          BIGINT      REFERENCES classes(id) ON DELETE SET NULL,
  observation_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  observation_type  VARCHAR(50) NOT NULL CHECK (observation_type IN (
                      'Behaviour','Skill Development','Participation','Social Interaction','Leadership','General')),
  notes             TEXT        NOT NULL,
  term              SMALLINT    CHECK (term BETWEEN 1 AND 3),
  academic_year     VARCHAR(4),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_obs_student ON teacher_observations(student_id);
CREATE INDEX IF NOT EXISTS idx_obs_school  ON teacher_observations(school_id, academic_year);

-- ── 4. Intervention Management ───────────────────────────────────
CREATE TABLE IF NOT EXISTS interventions (
  id              BIGSERIAL PRIMARY KEY,
  school_id       UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id      UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  flagged_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT        NOT NULL,
  intervention_plan TEXT,
  status          VARCHAR(30) NOT NULL DEFAULT 'Active'
                    CHECK (status IN ('Active','In Progress','Resolved','Closed')),
  risk_level      VARCHAR(20) NOT NULL DEFAULT 'Medium'
                    CHECK (risk_level IN ('Low','Medium','High','Critical')),
  ai_recommendations TEXT,
  term            SMALLINT    CHECK (term BETWEEN 1 AND 3),
  academic_year   VARCHAR(4),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_intervention_student ON interventions(student_id);
CREATE INDEX IF NOT EXISTS idx_intervention_school  ON interventions(school_id, status);

CREATE TABLE IF NOT EXISTS intervention_updates (
  id              BIGSERIAL PRIMARY KEY,
  intervention_id BIGINT      NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
  updated_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  note            TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. Assessment Moderation ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS assessment_moderation (
  id              BIGSERIAL PRIMARY KEY,
  school_id       UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id        BIGINT      NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  term            SMALLINT    NOT NULL CHECK (term BETWEEN 1 AND 3),
  academic_year   VARCHAR(4)  NOT NULL,
  locked_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  locked_at       TIMESTAMPTZ,
  is_locked       BOOLEAN     NOT NULL DEFAULT FALSE,
  moderated_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  moderated_at    TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, class_id, term, academic_year)
);

-- ── 6. Academic Year Management ──────────────────────────────────
CREATE TABLE IF NOT EXISTS academic_years (
  id              BIGSERIAL PRIMARY KEY,
  school_id       UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  year_label      VARCHAR(9)  NOT NULL,          -- e.g. "2026" or "2025/2026"
  start_date      DATE,
  end_date        DATE,
  is_current      BOOLEAN     NOT NULL DEFAULT FALSE,
  term1_start     DATE,
  term1_end       DATE,
  term2_start     DATE,
  term2_end       DATE,
  term3_start     DATE,
  term3_end       DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, year_label)
);

-- ── 7. Competency Progress View (for analytics) ──────────────────
-- A view that summarises per-student competency scores across terms
CREATE OR REPLACE VIEW student_competency_summary AS
SELECT
  rc.school_id,
  rc.student_id,
  rc.academic_year,
  rc.term,
  s.first_name || ' ' || s.last_name AS student_name,
  s.admission_number,
  c.grade,
  c.stream,
  -- Competency averages (NULL if never filled)
  ROUND(AVG(NULLIF(rc.cc_communication,    0))::NUMERIC, 2) AS avg_communication,
  ROUND(AVG(NULLIF(rc.cc_critical_thinking,0))::NUMERIC, 2) AS avg_critical_thinking,
  ROUND(AVG(NULLIF(rc.cc_creativity,       0))::NUMERIC, 2) AS avg_creativity,
  ROUND(AVG(NULLIF(rc.cc_citizenship,      0))::NUMERIC, 2) AS avg_citizenship,
  ROUND(AVG(NULLIF(rc.cc_digital_literacy, 0))::NUMERIC, 2) AS avg_digital_literacy,
  ROUND(AVG(NULLIF(rc.cc_learning_to_learn,0))::NUMERIC, 2) AS avg_learning_to_learn,
  ROUND(AVG(NULLIF(rc.cc_self_efficacy,    0))::NUMERIC, 2) AS avg_self_efficacy
FROM report_cards rc
JOIN students s ON s.id = rc.student_id
JOIN classes  c ON c.id = rc.class_id
GROUP BY rc.school_id, rc.student_id, rc.academic_year, rc.term,
         student_name, s.admission_number, c.grade, c.stream;

-- ── Indexes for performance ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_report_cards_school_year ON report_cards(school_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_assessments_school_year  ON assessments(school_id, academic_year, term);
