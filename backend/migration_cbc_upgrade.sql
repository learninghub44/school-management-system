-- ================================================================
-- CBC UPGRADE MIGRATION
-- Adding Classes, Streams, and Assessment Categories
-- ================================================================

-- 1. ACADEMIC YEARS
CREATE TABLE IF NOT EXISTS academic_years (
  id          SERIAL       PRIMARY KEY,
  school_id   UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        VARCHAR(20)  NOT NULL, -- e.g. "2024"
  start_date  DATE         NOT NULL,
  end_date    DATE         NOT NULL,
  is_current  BOOLEAN      DEFAULT FALSE,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, name)
);

-- 2. STREAMS
CREATE TABLE IF NOT EXISTS streams (
  id          SERIAL       PRIMARY KEY,
  school_id   UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        VARCHAR(50)  NOT NULL, -- e.g. "East", "West", "North"
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, name)
);

-- 3. CLASSES (Linking Grade + Stream + Academic Year)
CREATE TABLE IF NOT EXISTS classes (
  id               SERIAL       PRIMARY KEY,
  school_id        UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grade_id         INTEGER      NOT NULL REFERENCES grades(id),
  stream_id        INTEGER      NOT NULL REFERENCES streams(id),
  academic_year_id INTEGER      NOT NULL REFERENCES academic_years(id),
  teacher_id       UUID         REFERENCES users(id) ON DELETE SET NULL, -- Class Teacher
  created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, grade_id, stream_id, academic_year_id)
);

-- 4. ASSESSMENT CATEGORIES
CREATE TABLE IF NOT EXISTS assessment_categories (
  id          SERIAL       PRIMARY KEY,
  school_id   UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL, -- e.g. "CAT 1", "End Term", "Project"
  weight      INTEGER      DEFAULT 100, -- percentage weight
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, name)
);

-- 5. UPDATE STUDENTS WITH CLASS INFO
ALTER TABLE students ADD COLUMN IF NOT EXISTS stream_id INTEGER REFERENCES streams(id);
ALTER TABLE students ADD COLUMN IF NOT EXISTS current_class_id INTEGER REFERENCES classes(id);

-- 6. UPDATE ASSESSMENTS TO LINK TO CATEGORY
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES assessment_categories(id);

-- 7. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_classes_school ON classes(school_id);
CREATE INDEX IF NOT EXISTS idx_streams_school ON streams(school_id);
CREATE INDEX IF NOT EXISTS idx_assessment_cats_school ON assessment_categories(school_id);
