-- ================================================================
-- CBC School ERP — Full Multi-Tenant Schema
-- Kenya KICD Competency Based Curriculum
-- Pure PostgreSQL — bcrypt passwords, no Supabase Auth
-- ================================================================

DROP TABLE IF EXISTS attendance        CASCADE;
DROP TABLE IF EXISTS results           CASCADE;
DROP TABLE IF EXISTS assessments       CASCADE;
DROP TABLE IF EXISTS payments          CASCADE;
DROP TABLE IF EXISTS fee_structures    CASCADE;
DROP TABLE IF EXISTS parent_students   CASCADE;
DROP TABLE IF EXISTS teachers          CASCADE;
DROP TABLE IF EXISTS students          CASCADE;
DROP TABLE IF EXISTS subjects          CASCADE;
DROP TABLE IF EXISTS learning_areas    CASCADE;
DROP TABLE IF EXISTS strands           CASCADE;
DROP TABLE IF EXISTS grades            CASCADE;
DROP TABLE IF EXISTS users             CASCADE;
DROP TABLE IF EXISTS schools           CASCADE;

-- ================================================================
-- SCHOOLS
-- ================================================================
CREATE TABLE schools (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  school_code   VARCHAR(20)  UNIQUE NOT NULL,
  county        VARCHAR(100),
  sub_county    VARCHAR(100),
  level         VARCHAR(20)  CHECK (level IN ('ECDE','Primary','Junior Secondary','Senior Secondary')) DEFAULT 'Primary',
  email         VARCHAR(255),
  phone         VARCHAR(20),
  address       TEXT,
  is_active     BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ================================================================
-- USERS  (all roles — bcrypt passwords)
-- ================================================================
CREATE TABLE users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID         REFERENCES schools(id) ON DELETE CASCADE,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  phone         VARCHAR(20),
  role          VARCHAR(20)  NOT NULL DEFAULT 'TEACHER'
                  CHECK (role IN ('SUPER_ADMIN','SCHOOL_ADMIN','TEACHER','FINANCE','STUDENT','PARENT')),
  is_active     BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT super_admin_no_school CHECK (
    (role = 'SUPER_ADMIN' AND school_id IS NULL) OR
    (role != 'SUPER_ADMIN' AND school_id IS NOT NULL)
  )
);

-- ================================================================
-- GRADES  (KICD CBC structure)
-- ================================================================
CREATE TABLE grades (
  id          SERIAL       PRIMARY KEY,
  grade_level VARCHAR(20)  UNIQUE NOT NULL,
  stage       VARCHAR(30)  NOT NULL,  -- ECDE / Lower Primary / Upper Primary / JSS / SSS
  sort_order  INTEGER      NOT NULL
);

-- ================================================================
-- LEARNING AREAS  (KICD CBC — replaces "subjects")
-- ================================================================
CREATE TABLE learning_areas (
  id           SERIAL       PRIMARY KEY,
  code         VARCHAR(20)  UNIQUE NOT NULL,
  name         VARCHAR(100) NOT NULL,
  stage        VARCHAR(30),           -- which stage it applies to
  is_core      BOOLEAN      DEFAULT TRUE,
  kicd_ref     VARCHAR(50)            -- e.g. "KICD/CBC/LA/001"
);

-- ================================================================
-- STRANDS  (under each learning area — KICD)
-- ================================================================
CREATE TABLE strands (
  id               SERIAL       PRIMARY KEY,
  learning_area_id INTEGER      REFERENCES learning_areas(id) ON DELETE CASCADE,
  name             VARCHAR(150) NOT NULL,
  sub_strand       VARCHAR(150),
  kicd_ref         VARCHAR(50)
);

-- ================================================================
-- SUBJECTS  (legacy reference kept for backward compat)
-- ================================================================
CREATE TABLE subjects (
  id           SERIAL       PRIMARY KEY,
  subject_name VARCHAR(100) NOT NULL,
  grade_id     INTEGER      REFERENCES grades(id),
  category     VARCHAR(20)  CHECK (category IN ('core','optional','pathway')),
  strand_id    INTEGER      REFERENCES strands(id),
  assessment_types TEXT[]
);

-- ================================================================
-- STUDENTS  (tenant-scoped, linked to user account)
-- ================================================================
CREATE TABLE students (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id       UUID         REFERENCES users(id) ON DELETE SET NULL,
  admission_no  VARCHAR(30)  NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  grade_id      INTEGER      REFERENCES grades(id),
  date_of_birth DATE,
  gender        VARCHAR(10)  CHECK (gender IN ('male','female','other')),
  parent_name   VARCHAR(150),
  parent_phone  VARCHAR(20),
  parent_email  VARCHAR(255),
  address       TEXT,
  is_active     BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, admission_no)
);

-- ================================================================
-- PARENT → STUDENT  (many-to-many link)
-- ================================================================
CREATE TABLE parent_students (
  id         SERIAL PRIMARY KEY,
  parent_id  UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id UUID   NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_id  UUID   NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  UNIQUE(parent_id, student_id)
);

-- ================================================================
-- TEACHERS  (profile record, separate from user account)
-- ================================================================
CREATE TABLE teachers (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id     UUID         REFERENCES users(id) ON DELETE SET NULL,
  tsc_no      VARCHAR(30),
  full_name   VARCHAR(150) NOT NULL,
  email       VARCHAR(255),
  phone       VARCHAR(20),
  department  VARCHAR(100),
  subjects    TEXT[],
  is_active   BOOLEAN      DEFAULT TRUE,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, tsc_no)
);

-- ================================================================
-- FEE STRUCTURES  (tenant-scoped)
-- ================================================================
CREATE TABLE fee_structures (
  id          SERIAL         PRIMARY KEY,
  school_id   UUID           NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grade_id    INTEGER        REFERENCES grades(id),
  term        INTEGER        CHECK (term BETWEEN 1 AND 3),
  year        INTEGER        NOT NULL,
  amount      NUMERIC(10,2)  NOT NULL,
  description TEXT,
  created_at  TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
);

-- ================================================================
-- PAYMENTS  (tenant-scoped)
-- ================================================================
CREATE TABLE payments (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    UUID           NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id   UUID           NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount       NUMERIC(10,2)  NOT NULL,
  term         INTEGER        CHECK (term BETWEEN 1 AND 3),
  year         INTEGER        NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  method       VARCHAR(50),
  reference    VARCHAR(100),
  status       VARCHAR(20)    DEFAULT 'COMPLETED' CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  notes        TEXT,
  recorded_by  UUID           REFERENCES users(id),
  created_at   TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
);

-- ================================================================
-- ASSESSMENTS  (CBC — tenant-scoped)
-- ================================================================
CREATE TABLE assessments (
  id               SERIAL        PRIMARY KEY,
  school_id        UUID          NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  learning_area_id INTEGER       REFERENCES learning_areas(id),
  strand_id        INTEGER       REFERENCES strands(id),
  student_id       UUID          REFERENCES students(id) ON DELETE CASCADE,
  teacher_id       UUID          REFERENCES teachers(id) ON DELETE SET NULL,
  term             INTEGER       CHECK (term BETWEEN 1 AND 3),
  year             INTEGER       NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  assessment_type  VARCHAR(30)   CHECK (assessment_type IN ('formative','summative','project-based')),
  score            NUMERIC(5,2),
  grade            VARCHAR(2)    CHECK (grade IN ('EE','ME','AE','BE')),
  competency_area  VARCHAR(150),
  assessment_date  DATE          DEFAULT CURRENT_DATE,
  remarks          TEXT
);

-- ================================================================
-- RESULTS  (end-of-term, tenant-scoped)
-- ================================================================
CREATE TABLE results (
  id           SERIAL        PRIMARY KEY,
  school_id    UUID          NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id   UUID          REFERENCES students(id) ON DELETE CASCADE,
  learning_area_id INTEGER   REFERENCES learning_areas(id),
  term         INTEGER       CHECK (term BETWEEN 1 AND 3),
  year         INTEGER       NOT NULL,
  ca_grade     VARCHAR(2)    CHECK (ca_grade IN ('EE','ME','AE','BE')),
  exam_grade   VARCHAR(2)    CHECK (exam_grade IN ('EE','ME','AE','BE')),
  final_grade  VARCHAR(2)    CHECK (final_grade IN ('EE','ME','AE','BE')),
  remarks      TEXT
);

-- ================================================================
-- ATTENDANCE  (tenant-scoped)
-- ================================================================
CREATE TABLE attendance (
  id          SERIAL        PRIMARY KEY,
  school_id   UUID          NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  UUID          NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id  UUID          REFERENCES teachers(id) ON DELETE SET NULL,
  date        DATE          NOT NULL,
  status      VARCHAR(20)   CHECK (status IN ('present','absent','late','excused')),
  remarks     TEXT,
  UNIQUE(school_id, student_id, date)
);

-- ================================================================
-- INDEXES
-- ================================================================
CREATE INDEX idx_users_school        ON users(school_id);
CREATE INDEX idx_users_email         ON users(email);
CREATE INDEX idx_users_role          ON users(role);
CREATE INDEX idx_students_school     ON students(school_id);
CREATE INDEX idx_students_user       ON students(user_id);
CREATE INDEX idx_teachers_school     ON teachers(school_id);
CREATE INDEX idx_teachers_user       ON teachers(user_id);
CREATE INDEX idx_payments_school     ON payments(school_id);
CREATE INDEX idx_payments_student    ON payments(student_id);
CREATE INDEX idx_attendance_school   ON attendance(school_id);
CREATE INDEX idx_attendance_date     ON attendance(date);
CREATE INDEX idx_attendance_student  ON attendance(student_id);
CREATE INDEX idx_assessments_school  ON assessments(school_id);
CREATE INDEX idx_assessments_student ON assessments(student_id);
CREATE INDEX idx_parent_students_p   ON parent_students(parent_id);
CREATE INDEX idx_parent_students_s   ON parent_students(student_id);

-- ================================================================
-- SEED: KICD CBC GRADES
-- ================================================================
INSERT INTO grades (grade_level, stage, sort_order) VALUES
  ('PP1',      'ECDE',             1),
  ('PP2',      'ECDE',             2),
  ('Grade 1',  'Lower Primary',    3),
  ('Grade 2',  'Lower Primary',    4),
  ('Grade 3',  'Lower Primary',    5),
  ('Grade 4',  'Upper Primary',    6),
  ('Grade 5',  'Upper Primary',    7),
  ('Grade 6',  'Upper Primary',    8),
  ('Grade 7',  'Junior Secondary', 9),
  ('Grade 8',  'Junior Secondary', 10),
  ('Grade 9',  'Junior Secondary', 11),
  ('Grade 10', 'Senior Secondary', 12),
  ('Grade 11', 'Senior Secondary', 13),
  ('Grade 12', 'Senior Secondary', 14);

-- ================================================================
-- SEED: KICD CBC LEARNING AREAS
-- ================================================================
INSERT INTO learning_areas (code, name, stage, is_core, kicd_ref) VALUES
  -- ECDE
  ('ECDE-LA', 'Language Activities',           'ECDE',             TRUE,  'KICD/CBC/ECDE/001'),
  ('ECDE-MA', 'Mathematical Activities',        'ECDE',             TRUE,  'KICD/CBC/ECDE/002'),
  ('ECDE-EA', 'Environmental Activities',       'ECDE',             TRUE,  'KICD/CBC/ECDE/003'),
  ('ECDE-PA', 'Psychomotor & Creative Arts',    'ECDE',             TRUE,  'KICD/CBC/ECDE/004'),
  ('ECDE-RL', 'Religious Activities',           'ECDE',             FALSE, 'KICD/CBC/ECDE/005'),
  -- Lower Primary (Grade 1-3)
  ('LP-LS',   'Literacy Activities (Swahili)',  'Lower Primary',    TRUE,  'KICD/CBC/LP/001'),
  ('LP-LE',   'Literacy Activities (English)',  'Lower Primary',    TRUE,  'KICD/CBC/LP/002'),
  ('LP-MA',   'Mathematical Activities',        'Lower Primary',    TRUE,  'KICD/CBC/LP/003'),
  ('LP-EN',   'Environmental Activities',       'Lower Primary',    TRUE,  'KICD/CBC/LP/004'),
  ('LP-CA',   'Creative Arts',                  'Lower Primary',    TRUE,  'KICD/CBC/LP/005'),
  ('LP-PE',   'Physical & Health Education',    'Lower Primary',    TRUE,  'KICD/CBC/LP/006'),
  ('LP-RL',   'Religious Education',            'Lower Primary',    FALSE, 'KICD/CBC/LP/007'),
  -- Upper Primary (Grade 4-6)
  ('UP-EN',   'English',                        'Upper Primary',    TRUE,  'KICD/CBC/UP/001'),
  ('UP-KIS',  'Kiswahili',                      'Upper Primary',    TRUE,  'KICD/CBC/UP/002'),
  ('UP-MA',   'Mathematics',                    'Upper Primary',    TRUE,  'KICD/CBC/UP/003'),
  ('UP-SC',   'Science & Technology',           'Upper Primary',    TRUE,  'KICD/CBC/UP/004'),
  ('UP-SS',   'Social Studies',                 'Upper Primary',    TRUE,  'KICD/CBC/UP/005'),
  ('UP-RE',   'Religious Education',            'Upper Primary',    FALSE, 'KICD/CBC/UP/006'),
  ('UP-CA',   'Creative Arts & Sports',         'Upper Primary',    TRUE,  'KICD/CBC/UP/007'),
  ('UP-AG',   'Agriculture',                    'Upper Primary',    FALSE, 'KICD/CBC/UP/008'),
  ('UP-HE',   'Home Science',                   'Upper Primary',    FALSE, 'KICD/CBC/UP/009'),
  ('UP-BS',   'Business Studies',               'Upper Primary',    FALSE, 'KICD/CBC/UP/010'),
  ('UP-LS',   'Life Skills',                    'Upper Primary',    TRUE,  'KICD/CBC/UP/011'),
  -- Junior Secondary (Grade 7-9)
  ('JS-EN',   'English',                        'Junior Secondary', TRUE,  'KICD/CBC/JS/001'),
  ('JS-KIS',  'Kiswahili & Kenya Sign Language','Junior Secondary', TRUE,  'KICD/CBC/JS/002'),
  ('JS-MA',   'Mathematics',                    'Junior Secondary', TRUE,  'KICD/CBC/JS/003'),
  ('JS-INT',  'Integrated Science',             'Junior Secondary', TRUE,  'KICD/CBC/JS/004'),
  ('JS-HC',   'Health Education',               'Junior Secondary', TRUE,  'KICD/CBC/JS/005'),
  ('JS-PRE',  'Pre-Technical & Pre-Vocational', 'Junior Secondary', TRUE,  'KICD/CBC/JS/006'),
  ('JS-SS',   'Social Studies',                 'Junior Secondary', TRUE,  'KICD/CBC/JS/007'),
  ('JS-RE',   'Religious Education',            'Junior Secondary', FALSE, 'KICD/CBC/JS/008'),
  ('JS-BS',   'Business Studies',               'Junior Secondary', FALSE, 'KICD/CBC/JS/009'),
  ('JS-AG',   'Agriculture',                    'Junior Secondary', FALSE, 'KICD/CBC/JS/010'),
  ('JS-CA',   'Creative Arts',                  'Junior Secondary', FALSE, 'KICD/CBC/JS/011'),
  ('JS-PE',   'Physical & Health Education',    'Junior Secondary', TRUE,  'KICD/CBC/JS/012'),
  ('JS-ICT',  'Computer Science',               'Junior Secondary', TRUE,  'KICD/CBC/JS/013');

-- ================================================================
-- SEED: KEY STRANDS (sample — Upper Primary Math)
-- ================================================================
INSERT INTO strands (learning_area_id, name, sub_strand, kicd_ref) VALUES
  (15, 'Numbers',        'Whole Numbers & Place Value',  'KICD/CBC/UP/MA/S01'),
  (15, 'Numbers',        'Fractions',                    'KICD/CBC/UP/MA/S02'),
  (15, 'Numbers',        'Decimals',                     'KICD/CBC/UP/MA/S03'),
  (15, 'Measurement',    'Length',                       'KICD/CBC/UP/MA/S04'),
  (15, 'Measurement',    'Mass',                         'KICD/CBC/UP/MA/S05'),
  (15, 'Measurement',    'Time',                         'KICD/CBC/UP/MA/S06'),
  (15, 'Geometry',       'Shapes & Space',               'KICD/CBC/UP/MA/S07'),
  (15, 'Data Handling',  'Statistics',                   'KICD/CBC/UP/MA/S08'),
  (13, 'Reading',        'Fluency & Comprehension',      'KICD/CBC/UP/EN/S01'),
  (13, 'Writing',        'Composition & Grammar',        'KICD/CBC/UP/EN/S02'),
  (13, 'Oral Skills',    'Listening & Speaking',         'KICD/CBC/UP/EN/S03'),
  (16, 'Scientific Investigation', 'Experiments',        'KICD/CBC/UP/SC/S01'),
  (16, 'Living Things',  'Plants & Animals',             'KICD/CBC/UP/SC/S02');
