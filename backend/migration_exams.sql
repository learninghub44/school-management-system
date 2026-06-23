-- Migration: Exam Scheduling
CREATE TABLE IF NOT EXISTS exams (
  id               SERIAL PRIMARY KEY,
  school_id        UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title            VARCHAR(200) NOT NULL,
  exam_date        DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  term             SMALLINT NOT NULL CHECK (term BETWEEN 1 AND 3),
  academic_year    CHAR(4) NOT NULL,
  class_id         INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  learning_area_id INTEGER REFERENCES learning_areas(id) ON DELETE SET NULL,
  invigilator_id   INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  venue            VARCHAR(150),
  notes            TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exams_school ON exams(school_id);
CREATE INDEX IF NOT EXISTS idx_exams_date   ON exams(exam_date);
