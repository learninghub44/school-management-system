-- ================================================================
-- CBC School ERP — Production Schema v4.0
-- Kenya KICD Competency Based Curriculum
-- Multi-tenant · Roles: SUPER_ADMIN, PRINCIPAL, DEPUTY_PRINCIPAL,
--   HOD, TEACHER, BURSAR
-- ================================================================

-- Drop in dependency order
DROP TABLE IF EXISTS audit_logs          CASCADE;
DROP TABLE IF EXISTS token_blocklist     CASCADE;
DROP TABLE IF EXISTS timetable           CASCADE;
DROP TABLE IF EXISTS report_cards        CASCADE;
DROP TABLE IF EXISTS assessments         CASCADE;
DROP TABLE IF EXISTS attendance          CASCADE;
DROP TABLE IF EXISTS payments            CASCADE;
DROP TABLE IF EXISTS fee_structures      CASCADE;
DROP TABLE IF EXISTS teacher_assignments CASCADE;
DROP TABLE IF EXISTS students            CASCADE;
DROP TABLE IF EXISTS classes             CASCADE;
DROP TABLE IF EXISTS learning_areas      CASCADE;
DROP TABLE IF EXISTS departments         CASCADE;
DROP TABLE IF EXISTS teachers            CASCADE;
DROP TABLE IF EXISTS users               CASCADE;
DROP TABLE IF EXISTS schools             CASCADE;

-- ================================================================
-- SCHOOLS  (each row = one tenant)
-- ================================================================
CREATE TABLE schools (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(255) NOT NULL,
  school_code    VARCHAR(20)  UNIQUE NOT NULL,   -- login identifier
  address        TEXT,
  phone          VARCHAR(20),
  email          VARCHAR(255),
  logo_url       TEXT,
  county         VARCHAR(100),
  sub_county     VARCHAR(100),
  level          VARCHAR(30)  CHECK (level IN ('ECDE','Primary','Junior Secondary','Senior Secondary','Mixed')) DEFAULT 'Primary',
  academic_year  VARCHAR(10)  DEFAULT TO_CHAR(CURRENT_DATE,'YYYY'),
  current_term   SMALLINT     DEFAULT 1 CHECK (current_term BETWEEN 1 AND 3),
  is_active      BOOLEAN      DEFAULT TRUE,
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  DEFAULT NOW()
);

-- ================================================================
-- USERS  (staff only — no student/parent logins per spec)
-- ================================================================
CREATE TABLE users (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID         REFERENCES schools(id) ON DELETE CASCADE,
  username              VARCHAR(100) UNIQUE NOT NULL,
  email                 VARCHAR(255) UNIQUE NOT NULL,
  password_hash         VARCHAR(255) NOT NULL,
  name                  VARCHAR(150) NOT NULL,
  phone                 VARCHAR(20),
  role                  VARCHAR(25)  NOT NULL
                          CHECK (role IN ('SUPER_ADMIN','PRINCIPAL','DEPUTY_PRINCIPAL','HOD','TEACHER','BURSAR')),
  is_active             BOOLEAN      DEFAULT TRUE,
  must_change_password  BOOLEAN      DEFAULT TRUE,
  failed_login_attempts SMALLINT     DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login            TIMESTAMPTZ,
  password_changed_at   TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT super_admin_no_school CHECK (
    (role = 'SUPER_ADMIN' AND school_id IS NULL) OR
    (role != 'SUPER_ADMIN' AND school_id IS NOT NULL)
  )
);

-- ================================================================
-- DEPARTMENTS
-- ================================================================
CREATE TABLE departments (
  id              SERIAL       PRIMARY KEY,
  school_id       UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  hod_id          UUID         REFERENCES users(id) ON DELETE SET NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(school_id, name)
);

-- ================================================================
-- TEACHERS  (profile record, linked to user account)
-- ================================================================
CREATE TABLE teachers (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id       UUID         UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  tsc_number    VARCHAR(30),
  first_name    VARCHAR(80)  NOT NULL,
  last_name     VARCHAR(80)  NOT NULL,
  phone         VARCHAR(20),
  email         VARCHAR(255),
  department_id INTEGER      REFERENCES departments(id) ON DELETE SET NULL,
  designation   VARCHAR(100),       -- e.g. "Senior Teacher", "Head Teacher"
  photo_url     TEXT,
  is_active     BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(school_id, tsc_number)
);

-- ================================================================
-- CLASSES  (PP1..Grade 12, per school per year)
-- ================================================================
CREATE TABLE classes (
  id               SERIAL       PRIMARY KEY,
  school_id        UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grade            VARCHAR(20)  NOT NULL,   -- PP1, PP2, Grade 1 … Grade 9
  stream           VARCHAR(20),             -- East, West, North, South, A, B …
  stage            VARCHAR(30)  NOT NULL,   -- ECDE / Lower Primary / Upper Primary / JSS
  class_teacher_id UUID         REFERENCES teachers(id) ON DELETE SET NULL,
  academic_year    VARCHAR(10)  NOT NULL DEFAULT TO_CHAR(CURRENT_DATE,'YYYY'),
  capacity         SMALLINT     DEFAULT 40,
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(school_id, grade, stream, academic_year)
);

-- ================================================================
-- LEARNING AREAS  (KICD CBC — global reference, no school_id)
-- ================================================================
CREATE TABLE learning_areas (
  id           SERIAL       PRIMARY KEY,
  code         VARCHAR(20)  UNIQUE NOT NULL,
  name         VARCHAR(120) NOT NULL,
  stage        VARCHAR(30)  NOT NULL,
  department   VARCHAR(60),                -- logical dept for grouping
  is_core      BOOLEAN      DEFAULT TRUE,
  sort_order   SMALLINT     DEFAULT 0,
  kicd_ref     VARCHAR(50)
);

-- ================================================================
-- STUDENTS
-- ================================================================
CREATE TABLE students (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id        INTEGER      REFERENCES classes(id) ON DELETE SET NULL,
  admission_number VARCHAR(30) NOT NULL,
  upi_number      VARCHAR(30),             -- Kenya NEMIS UPI
  first_name      VARCHAR(80)  NOT NULL,
  middle_name     VARCHAR(80),
  last_name       VARCHAR(80)  NOT NULL,
  gender          VARCHAR(10)  CHECK (gender IN ('Male','Female')),
  date_of_birth   DATE,
  admission_date  DATE         DEFAULT CURRENT_DATE,
  parent_name     VARCHAR(150),
  parent_phone    VARCHAR(20),
  address         TEXT,
  photo_url       TEXT,
  is_active       BOOLEAN      DEFAULT TRUE,
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(school_id, admission_number)
);

-- ================================================================
-- TEACHER ASSIGNMENTS  (which teacher teaches which subject in which class)
-- ================================================================
CREATE TABLE teacher_assignments (
  id                SERIAL      PRIMARY KEY,
  school_id         UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id        UUID        NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id          INTEGER     NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  learning_area_id  INTEGER     NOT NULL REFERENCES learning_areas(id) ON DELETE CASCADE,
  role              VARCHAR(20) NOT NULL CHECK (role IN ('Class Teacher','Subject Teacher','HOD')),
  academic_year     VARCHAR(10) NOT NULL DEFAULT TO_CHAR(CURRENT_DATE,'YYYY'),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, teacher_id, class_id, learning_area_id, academic_year)
);

-- ================================================================
-- ATTENDANCE
-- ================================================================
CREATE TABLE attendance (
  id          SERIAL       PRIMARY KEY,
  school_id   UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  UUID         NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id    INTEGER      NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id  UUID         REFERENCES teachers(id) ON DELETE SET NULL,
  date        DATE         NOT NULL,
  status      VARCHAR(10)  NOT NULL CHECK (status IN ('Present','Absent','Late')),
  remarks     TEXT,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(school_id, student_id, date)
);

-- ================================================================
-- FEE STRUCTURES  (per class per term)
-- ================================================================
CREATE TABLE fee_structures (
  id          SERIAL         PRIMARY KEY,
  school_id   UUID           NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id    INTEGER        REFERENCES classes(id) ON DELETE SET NULL,
  fee_name    VARCHAR(100)   NOT NULL,   -- "Tuition", "Activity Fee", "Lunch"
  amount      NUMERIC(12,2)  NOT NULL,
  term        SMALLINT       CHECK (term BETWEEN 1 AND 3),
  academic_year VARCHAR(10)  NOT NULL DEFAULT TO_CHAR(CURRENT_DATE,'YYYY'),
  created_at  TIMESTAMPTZ    DEFAULT NOW(),
  UNIQUE(school_id, class_id, fee_name, term, academic_year)
);

-- ================================================================
-- PAYMENTS
-- ================================================================
CREATE TABLE payments (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID           NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id      UUID           NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  receipt_number  VARCHAR(50)    UNIQUE NOT NULL,
  amount_paid     NUMERIC(12,2)  NOT NULL CHECK (amount_paid > 0),
  payment_date    DATE           NOT NULL DEFAULT CURRENT_DATE,
  payment_method  VARCHAR(30)    DEFAULT 'Cash' CHECK (payment_method IN ('Cash','M-Pesa','Bank Transfer','Card','Cheque')),
  reference       VARCHAR(100),
  term            SMALLINT       CHECK (term BETWEEN 1 AND 3),
  academic_year   VARCHAR(10)    NOT NULL DEFAULT TO_CHAR(CURRENT_DATE,'YYYY'),
  fee_structure_id INTEGER       REFERENCES fee_structures(id) ON DELETE SET NULL,
  balance         NUMERIC(12,2)  DEFAULT 0,
  recorded_by     UUID           REFERENCES users(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ    DEFAULT NOW()
);

-- ================================================================
-- CBC ASSESSMENTS
-- ================================================================
CREATE TABLE assessments (
  id                SERIAL       PRIMARY KEY,
  school_id         UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id        UUID         NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id          INTEGER      NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  learning_area_id  INTEGER      NOT NULL REFERENCES learning_areas(id),
  teacher_id        UUID         REFERENCES teachers(id) ON DELETE SET NULL,
  strand            VARCHAR(150),
  sub_strand        VARCHAR(150),
  score             NUMERIC(5,2) CHECK (score BETWEEN 0 AND 100),
  achievement_level VARCHAR(2)   NOT NULL CHECK (achievement_level IN ('EE','ME','AE','BE')),
  teacher_comment   TEXT,
  assessment_type   VARCHAR(30)  DEFAULT 'Formative' CHECK (assessment_type IN ('Formative','Summative','Project','Observation')),
  assessment_date   DATE         DEFAULT CURRENT_DATE,
  term              SMALLINT     NOT NULL CHECK (term BETWEEN 1 AND 3),
  academic_year     VARCHAR(10)  NOT NULL DEFAULT TO_CHAR(CURRENT_DATE,'YYYY'),
  created_at        TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(school_id, student_id, learning_area_id, assessment_type, term, academic_year)
);

-- ================================================================
-- REPORT CARDS
-- ================================================================
CREATE TABLE report_cards (
  id                    SERIAL      PRIMARY KEY,
  school_id             UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id            UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id              INTEGER     NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  term                  SMALLINT    NOT NULL CHECK (term BETWEEN 1 AND 3),
  academic_year         VARCHAR(10) NOT NULL,
  class_teacher_remark  TEXT,
  principal_remark      TEXT,
  generated_by          UUID        REFERENCES users(id),
  generated_date        TIMESTAMPTZ DEFAULT NOW(),
  is_published          BOOLEAN     DEFAULT FALSE,
  UNIQUE(school_id, student_id, term, academic_year)
);

-- ================================================================
-- TIMETABLE
-- ================================================================
CREATE TABLE timetable (
  id               SERIAL      PRIMARY KEY,
  school_id        UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id         INTEGER     NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  learning_area_id INTEGER     NOT NULL REFERENCES learning_areas(id),
  teacher_id       UUID        REFERENCES teachers(id) ON DELETE SET NULL,
  day              VARCHAR(10) NOT NULL CHECK (day IN ('Monday','Tuesday','Wednesday','Thursday','Friday')),
  start_time       TIME        NOT NULL,
  end_time         TIME        NOT NULL,
  academic_year    VARCHAR(10) NOT NULL DEFAULT TO_CHAR(CURRENT_DATE,'YYYY'),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, class_id, day, start_time, academic_year)
);

-- ================================================================
-- TOKEN BLOCKLIST  (revoked JWTs)
-- ================================================================
CREATE TABLE token_blocklist (
  id         SERIAL      PRIMARY KEY,
  jti        VARCHAR(64) UNIQUE NOT NULL,
  user_id    UUID        REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- AUDIT LOGS
-- ================================================================
CREATE TABLE audit_logs (
  id            SERIAL       PRIMARY KEY,
  school_id     UUID         REFERENCES schools(id) ON DELETE SET NULL,
  user_id       UUID         REFERENCES users(id) ON DELETE SET NULL,
  user_role     VARCHAR(25),
  action        VARCHAR(80)  NOT NULL,
  resource_type VARCHAR(60),
  resource_id   VARCHAR(100),
  old_value     JSONB,
  new_value     JSONB,
  ip_address    VARCHAR(45),
  user_agent    VARCHAR(255),
  outcome       VARCHAR(10)  DEFAULT 'SUCCESS',
  detail        TEXT,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ================================================================
-- INDEXES
-- ================================================================
CREATE INDEX idx_users_school          ON users(school_id);
CREATE INDEX idx_users_email           ON users(email);
CREATE INDEX idx_users_role            ON users(role);
CREATE INDEX idx_teachers_school       ON teachers(school_id);
CREATE INDEX idx_teachers_user         ON teachers(user_id);
CREATE INDEX idx_teachers_dept         ON teachers(department_id);
CREATE INDEX idx_classes_school        ON classes(school_id);
CREATE INDEX idx_classes_year          ON classes(academic_year);
CREATE INDEX idx_students_school       ON students(school_id);
CREATE INDEX idx_students_class        ON students(class_id);
CREATE INDEX idx_students_adm          ON students(school_id, admission_number);
CREATE INDEX idx_attendance_school     ON attendance(school_id);
CREATE INDEX idx_attendance_date       ON attendance(date);
CREATE INDEX idx_attendance_student    ON attendance(student_id);
CREATE INDEX idx_attendance_class      ON attendance(class_id);
CREATE INDEX idx_payments_school       ON payments(school_id);
CREATE INDEX idx_payments_student      ON payments(student_id);
CREATE INDEX idx_payments_date         ON payments(payment_date);
CREATE INDEX idx_assessments_school    ON assessments(school_id);
CREATE INDEX idx_assessments_student   ON assessments(student_id);
CREATE INDEX idx_assessments_term      ON assessments(term, academic_year);
CREATE INDEX idx_report_cards_student  ON report_cards(student_id);
CREATE INDEX idx_timetable_class       ON timetable(class_id);
CREATE INDEX idx_token_blocklist_jti   ON token_blocklist(jti);
CREATE INDEX idx_audit_logs_school     ON audit_logs(school_id);
CREATE INDEX idx_audit_logs_created    ON audit_logs(created_at DESC);

-- ================================================================
-- SEED: KICD CBC LEARNING AREAS
-- ================================================================
INSERT INTO learning_areas (code, name, stage, department, is_core, sort_order, kicd_ref) VALUES
  -- ECDE
  ('ECDE-LA',  'Language Activities',                  'ECDE',             'Languages',     TRUE,  1,  'KICD/CBC/ECDE/001'),
  ('ECDE-MA',  'Mathematical Activities',              'ECDE',             'Mathematics',   TRUE,  2,  'KICD/CBC/ECDE/002'),
  ('ECDE-ENV', 'Environmental Activities',             'ECDE',             'Science',       TRUE,  3,  'KICD/CBC/ECDE/003'),
  ('ECDE-PSY', 'Psychomotor & Creative Arts',          'ECDE',             'Arts',          TRUE,  4,  'KICD/CBC/ECDE/004'),
  ('ECDE-RE',  'Religious Education',                  'ECDE',             'Social Studies',FALSE, 5,  'KICD/CBC/ECDE/005'),
  -- Lower Primary (Grade 1–3)
  ('LP-LE',    'Literacy (English)',                   'Lower Primary',    'Languages',     TRUE,  6,  'KICD/CBC/LP/001'),
  ('LP-LS',    'Literacy (Kiswahili)',                 'Lower Primary',    'Languages',     TRUE,  7,  'KICD/CBC/LP/002'),
  ('LP-MA',    'Mathematical Activities',              'Lower Primary',    'Mathematics',   TRUE,  8,  'KICD/CBC/LP/003'),
  ('LP-ENV',   'Environmental Activities',             'Lower Primary',    'Science',       TRUE,  9,  'KICD/CBC/LP/004'),
  ('LP-CA',    'Creative Arts',                        'Lower Primary',    'Arts',          TRUE,  10, 'KICD/CBC/LP/005'),
  ('LP-PHE',   'Physical & Health Education',          'Lower Primary',    'Physical Ed',   TRUE,  11, 'KICD/CBC/LP/006'),
  ('LP-RE',    'Religious Education',                  'Lower Primary',    'Social Studies',FALSE, 12, 'KICD/CBC/LP/007'),
  -- Upper Primary (Grade 4–6)
  ('UP-EN',    'English',                              'Upper Primary',    'Languages',     TRUE,  13, 'KICD/CBC/UP/001'),
  ('UP-KIS',   'Kiswahili',                            'Upper Primary',    'Languages',     TRUE,  14, 'KICD/CBC/UP/002'),
  ('UP-MA',    'Mathematics',                          'Upper Primary',    'Mathematics',   TRUE,  15, 'KICD/CBC/UP/003'),
  ('UP-SCI',   'Science & Technology',                 'Upper Primary',    'Science',       TRUE,  16, 'KICD/CBC/UP/004'),
  ('UP-SS',    'Social Studies',                       'Upper Primary',    'Social Studies',TRUE,  17, 'KICD/CBC/UP/005'),
  ('UP-RE',    'Religious Education',                  'Upper Primary',    'Social Studies',FALSE, 18, 'KICD/CBC/UP/006'),
  ('UP-CAS',   'Creative Arts & Sports',               'Upper Primary',    'Arts',          TRUE,  19, 'KICD/CBC/UP/007'),
  ('UP-LS',    'Life Skills',                          'Upper Primary',    'Social Studies',TRUE,  20, 'KICD/CBC/UP/008'),
  ('UP-AG',    'Agriculture',                          'Upper Primary',    'Science',       FALSE, 21, 'KICD/CBC/UP/009'),
  -- Junior Secondary (Grade 7–9)
  ('JS-EN',    'English',                              'Junior Secondary', 'Languages',     TRUE,  22, 'KICD/CBC/JS/001'),
  ('JS-KIS',   'Kiswahili & Kenya Sign Language',      'Junior Secondary', 'Languages',     TRUE,  23, 'KICD/CBC/JS/002'),
  ('JS-MA',    'Mathematics',                          'Junior Secondary', 'Mathematics',   TRUE,  24, 'KICD/CBC/JS/003'),
  ('JS-INT',   'Integrated Science',                   'Junior Secondary', 'Science',       TRUE,  25, 'KICD/CBC/JS/004'),
  ('JS-HC',    'Health Education',                     'Junior Secondary', 'Science',       TRUE,  26, 'KICD/CBC/JS/005'),
  ('JS-PRE',   'Pre-Technical Studies',                'Junior Secondary', 'Technical',     TRUE,  27, 'KICD/CBC/JS/006'),
  ('JS-SS',    'Social Studies',                       'Junior Secondary', 'Social Studies',TRUE,  28, 'KICD/CBC/JS/007'),
  ('JS-RE',    'Religious Education',                  'Junior Secondary', 'Social Studies',FALSE, 29, 'KICD/CBC/JS/008'),
  ('JS-BS',    'Business Studies',                     'Junior Secondary', 'Social Studies',FALSE, 30, 'KICD/CBC/JS/009'),
  ('JS-AG',    'Agriculture',                          'Junior Secondary', 'Science',       FALSE, 31, 'KICD/CBC/JS/010'),
  ('JS-CA',    'Creative Arts',                        'Junior Secondary', 'Arts',          FALSE, 32, 'KICD/CBC/JS/011'),
  ('JS-PHE',   'Physical & Health Education',          'Junior Secondary', 'Physical Ed',   TRUE,  33, 'KICD/CBC/JS/012'),
  ('JS-ICT',   'Computer Science',                     'Junior Secondary', 'Technical',     TRUE,  34, 'KICD/CBC/JS/013');

