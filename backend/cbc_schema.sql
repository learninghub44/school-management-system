-- ================================================================
-- Kadem & Zetu School Management System — Production Schema v4.0
-- Kenya KICD Competency Based Curriculum
-- Multi-tenant · Roles: SUPER_ADMIN, PRINCIPAL, DEPUTY_PRINCIPAL,
--   HOD, TEACHER, BURSAR
-- ================================================================

-- Drop in dependency order
-- DROP TABLE IF EXISTS audit_logs          CASCADE;
-- DROP TABLE IF EXISTS token_blocklist     CASCADE;
-- DROP TABLE IF EXISTS subscription_payments CASCADE;
-- DROP TABLE IF EXISTS school_subscriptions CASCADE;
-- DROP TABLE IF EXISTS payment_plans       CASCADE;
-- DROP TABLE IF EXISTS timetable           CASCADE;
-- DROP TABLE IF EXISTS report_cards        CASCADE;
-- DROP TABLE IF EXISTS assessments         CASCADE;
-- DROP TABLE IF EXISTS attendance          CASCADE;
-- DROP TABLE IF EXISTS payments            CASCADE;
-- DROP TABLE IF EXISTS fee_structures      CASCADE;
-- DROP TABLE IF EXISTS teacher_assignments CASCADE;
-- DROP TABLE IF EXISTS students            CASCADE;
-- DROP TABLE IF EXISTS classes             CASCADE;
-- DROP TABLE IF EXISTS learning_areas      CASCADE;
-- DROP TABLE IF EXISTS departments         CASCADE;
-- DROP TABLE IF EXISTS teachers            CASCADE;
-- DROP TABLE IF EXISTS users               CASCADE;
-- DROP TABLE IF EXISTS schools             CASCADE;

-- ================================================================
-- SCHOOLS  (each row = one tenant)
-- ================================================================
CREATE TABLE IF NOT EXISTS schools (
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
CREATE TABLE IF NOT EXISTS users (
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
CREATE TABLE IF NOT EXISTS departments (
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
CREATE TABLE IF NOT EXISTS teachers (
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
CREATE TABLE IF NOT EXISTS classes (
  id               SERIAL       PRIMARY KEY,
  school_id        UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grade            VARCHAR(20)  NOT NULL,   -- PP1, PP2, Grade 1 … Grade 12
  stream           VARCHAR(20),             -- East, West, North, South, A, B …
  pathway          VARCHAR(30),             -- STEM / Social Sciences / Arts & Sports (Grade 10-12 only)
  stage            VARCHAR(30)  NOT NULL,   -- ECDE / Lower Primary / Upper Primary / JSS / Senior Secondary
  class_teacher_id UUID         REFERENCES teachers(id) ON DELETE SET NULL,
  academic_year    VARCHAR(10)  NOT NULL DEFAULT TO_CHAR(CURRENT_DATE,'YYYY'),
  capacity         SMALLINT     DEFAULT 40,
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  CHECK (pathway IS NULL OR pathway IN ('STEM', 'Social Sciences', 'Arts & Sports')),
  UNIQUE(school_id, grade, stream, academic_year, pathway)
);

-- ================================================================
-- LEARNING AREAS  (KICD CBC — global reference, no school_id)
-- ================================================================
CREATE TABLE IF NOT EXISTS learning_areas (
  id           SERIAL       PRIMARY KEY,
  code         VARCHAR(20)  UNIQUE NOT NULL,
  name         VARCHAR(120) NOT NULL,
  stage        VARCHAR(30)  NOT NULL,
  department   VARCHAR(60),                -- logical dept for grouping
  is_core      BOOLEAN      DEFAULT TRUE,
  sort_order   SMALLINT     DEFAULT 0,
  kicd_ref     VARCHAR(50),
  pathway      VARCHAR(30),                -- NULL = core/all pathways; set = Senior Secondary elective (STEM / Social Sciences / Arts & Sports)
  CHECK (pathway IS NULL OR pathway IN ('STEM', 'Social Sciences', 'Arts & Sports'))
);

-- ================================================================
-- STUDENTS
-- ================================================================
CREATE TABLE IF NOT EXISTS students (
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
CREATE TABLE IF NOT EXISTS teacher_assignments (
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
CREATE TABLE IF NOT EXISTS attendance (
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
CREATE TABLE IF NOT EXISTS fee_structures (
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
CREATE TABLE IF NOT EXISTS payments (
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
-- SUBSCRIPTION PLANS AND PESAPAL PAYMENTS
-- ================================================================
CREATE TABLE IF NOT EXISTS payment_plans (
  id               SERIAL        PRIMARY KEY,
  name             VARCHAR(100)  UNIQUE NOT NULL,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency         CHAR(3)       NOT NULL DEFAULT 'KES',
  billing_interval VARCHAR(10)   NOT NULL CHECK (billing_interval IN ('month','term','year')),
  student_limit    INTEGER,
  ai_enabled       BOOLEAN       DEFAULT TRUE,
  ai_daily_limit   INTEGER       DEFAULT 50,   -- max AI requests/day per school; NULL = unlimited
  is_active        BOOLEAN       DEFAULT TRUE,
  created_at       TIMESTAMPTZ   DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   DEFAULT NOW()
);

-- AI usage log — backs the daily per-school request quota
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id           BIGSERIAL    PRIMARY KEY,
  school_id    UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature      VARCHAR(40)  NOT NULL DEFAULT 'assist',
  prompt_chars INTEGER,
  created_at   TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_school_day ON ai_usage_log(school_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_day   ON ai_usage_log(user_id, created_at);

CREATE TABLE IF NOT EXISTS school_subscriptions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            UUID        UNIQUE NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  plan_id              INTEGER     NOT NULL REFERENCES payment_plans(id),
  status               VARCHAR(20) NOT NULL DEFAULT 'inactive'
                         CHECK (status IN ('inactive','trialing','active','past_due','cancelled')),
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  last_payment_id      UUID,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          UUID          NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  plan_id            INTEGER       NOT NULL REFERENCES payment_plans(id),
  merchant_reference VARCHAR(80)   UNIQUE NOT NULL,
  order_tracking_id  VARCHAR(120)  UNIQUE,
  amount             NUMERIC(12,2) NOT NULL,
  currency           CHAR(3)       NOT NULL DEFAULT 'KES',
  status             VARCHAR(20)   NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','completed','failed','cancelled','invalid')),
  checkout_url       TEXT,
  provider_payload   JSONB,
  created_by         UUID          REFERENCES users(id),
  created_at         TIMESTAMPTZ   DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   DEFAULT NOW()
);

ALTER TABLE school_subscriptions
  ADD CONSTRAINT school_subscriptions_last_payment_fk
  FOREIGN KEY (last_payment_id) REFERENCES subscription_payments(id) ON DELETE SET NULL;

-- ================================================================
-- CBC ASSESSMENTS
-- ================================================================
CREATE TABLE IF NOT EXISTS assessments (
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
CREATE TABLE IF NOT EXISTS report_cards (
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
CREATE TABLE IF NOT EXISTS timetable (
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
CREATE TABLE IF NOT EXISTS token_blocklist (
  id         SERIAL      PRIMARY KEY,
  jti        VARCHAR(64) UNIQUE NOT NULL,
  user_id    UUID        REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- AUDIT LOGS
-- ================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
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
CREATE INDEX IF NOT EXISTS idx_users_school          ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_users_email           ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role            ON users(role);
CREATE INDEX IF NOT EXISTS idx_teachers_school       ON teachers(school_id);
CREATE INDEX IF NOT EXISTS idx_teachers_user         ON teachers(user_id);
CREATE INDEX IF NOT EXISTS idx_teachers_dept         ON teachers(department_id);
CREATE INDEX IF NOT EXISTS idx_classes_school        ON classes(school_id);
CREATE INDEX IF NOT EXISTS idx_classes_year          ON classes(academic_year);
CREATE INDEX IF NOT EXISTS idx_students_school       ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_class        ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_adm          ON students(school_id, admission_number);
CREATE INDEX IF NOT EXISTS idx_attendance_school     ON attendance(school_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date       ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_student    ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_class      ON attendance(class_id);
CREATE INDEX IF NOT EXISTS idx_payments_school       ON payments(school_id);
CREATE INDEX IF NOT EXISTS idx_payments_student      ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_date         ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payment_plans_active  ON payment_plans(is_active);
CREATE INDEX IF NOT EXISTS idx_school_subs_school    ON school_subscriptions(school_id);
CREATE INDEX IF NOT EXISTS idx_school_subs_status    ON school_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_sub_payments_school   ON subscription_payments(school_id);
CREATE INDEX IF NOT EXISTS idx_sub_payments_tracking ON subscription_payments(order_tracking_id);
CREATE INDEX IF NOT EXISTS idx_assessments_school    ON assessments(school_id);
CREATE INDEX IF NOT EXISTS idx_assessments_student   ON assessments(student_id);
CREATE INDEX IF NOT EXISTS idx_assessments_term      ON assessments(term, academic_year);
CREATE INDEX IF NOT EXISTS idx_report_cards_student  ON report_cards(student_id);
CREATE INDEX IF NOT EXISTS idx_timetable_class       ON timetable(class_id);
CREATE INDEX IF NOT EXISTS idx_token_blocklist_jti   ON token_blocklist(jti);
CREATE INDEX IF NOT EXISTS idx_audit_logs_school     ON audit_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created    ON audit_logs(created_at DESC);

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

-- Senior Secondary (Grade 10-12) — core subjects (all pathways) + pathway electives
INSERT INTO learning_areas (code, name, stage, department, is_core, sort_order, kicd_ref, pathway) VALUES
  -- Core subjects, common to all three pathways
  ('SS-EN',       'English',                         'Senior Secondary', 'Languages',      TRUE,  35, 'KICD/CBC/SS/001',      NULL),
  ('SS-KIS',      'Kiswahili',                       'Senior Secondary', 'Languages',      TRUE,  36, 'KICD/CBC/SS/002',      NULL),
  ('SS-CSL',      'Community Service Learning',      'Senior Secondary', 'Social Studies', TRUE,  37, 'KICD/CBC/SS/003',      NULL),
  ('SS-PHE',      'Physical Education',              'Senior Secondary', 'Physical Ed',    TRUE,  38, 'KICD/CBC/SS/004',      NULL),
  -- STEM pathway electives
  ('SS-STEM-MA',  'Advanced Mathematics',            'Senior Secondary', 'Mathematics',    TRUE,  39, 'KICD/CBC/SS/STEM/001', 'STEM'),
  ('SS-STEM-PHY', 'Physics',                         'Senior Secondary', 'Science',        TRUE,  40, 'KICD/CBC/SS/STEM/002', 'STEM'),
  ('SS-STEM-CHE', 'Chemistry',                       'Senior Secondary', 'Science',        TRUE,  41, 'KICD/CBC/SS/STEM/003', 'STEM'),
  ('SS-STEM-BIO', 'Biology',                         'Senior Secondary', 'Science',        TRUE,  42, 'KICD/CBC/SS/STEM/004', 'STEM'),
  ('SS-STEM-ICT', 'Computer Science',                'Senior Secondary', 'Technical',      TRUE,  43, 'KICD/CBC/SS/STEM/005', 'STEM'),
  ('SS-STEM-AG',  'Agriculture',                     'Senior Secondary', 'Science',        FALSE, 44, 'KICD/CBC/SS/STEM/006', 'STEM'),
  -- Social Sciences pathway electives
  ('SS-SOC-HIS',  'History & Citizenship',           'Senior Secondary', 'Social Studies', TRUE,  45, 'KICD/CBC/SS/SOC/001',  'Social Sciences'),
  ('SS-SOC-GEO',  'Geography',                       'Senior Secondary', 'Social Studies', TRUE,  46, 'KICD/CBC/SS/SOC/002',  'Social Sciences'),
  ('SS-SOC-CRE',  'Christian Religious Education',   'Senior Secondary', 'Social Studies', FALSE, 47, 'KICD/CBC/SS/SOC/003',  'Social Sciences'),
  ('SS-SOC-BUS',  'Business Studies',                'Senior Secondary', 'Social Studies', TRUE,  48, 'KICD/CBC/SS/SOC/004',  'Social Sciences'),
  ('SS-SOC-ECO',  'Economics',                       'Senior Secondary', 'Social Studies', TRUE,  49, 'KICD/CBC/SS/SOC/005',  'Social Sciences'),
  ('SS-SOC-LIT',  'Literature',                      'Senior Secondary', 'Languages',      TRUE,  50, 'KICD/CBC/SS/SOC/006',  'Social Sciences'),
  -- Arts & Sports pathway electives
  ('SS-ART-MUS',  'Music & Dance',                   'Senior Secondary', 'Arts',           TRUE,  51, 'KICD/CBC/SS/ART/001',  'Arts & Sports'),
  ('SS-ART-VIS',  'Visual & Applied Arts',           'Senior Secondary', 'Arts',           TRUE,  52, 'KICD/CBC/SS/ART/002',  'Arts & Sports'),
  ('SS-ART-PER',  'Performing Arts',                 'Senior Secondary', 'Arts',           TRUE,  53, 'KICD/CBC/SS/ART/003',  'Arts & Sports'),
  ('SS-ART-SCI',  'Sports Science',                  'Senior Secondary', 'Physical Ed',    TRUE,  54, 'KICD/CBC/SS/ART/004',  'Arts & Sports'),
  ('SS-ART-FAS',  'Fashion & Design',                'Senior Secondary', 'Arts',           FALSE, 55, 'KICD/CBC/SS/ART/005',  'Arts & Sports'),
  ('SS-ART-FIL',  'Film & Theatre',                  'Senior Secondary', 'Arts',           FALSE, 56, 'KICD/CBC/SS/ART/006',  'Arts & Sports');



-- ── Migrations (safe to re-run — all use IF NOT EXISTS) ───────────

-- === migration_cbc_upgrade.sql ===
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

-- === migration_subscriptions_pesapal_ai.sql ===
-- Subscription, Pesapal, and AI feature upgrade.

CREATE TABLE IF NOT EXISTS payment_plans (
  id               SERIAL        PRIMARY KEY,
  name             VARCHAR(100)  UNIQUE NOT NULL,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency         CHAR(3)       NOT NULL DEFAULT 'KES',
  billing_interval VARCHAR(10)   NOT NULL CHECK (billing_interval IN ('month','term','year')),
  student_limit    INTEGER,
  ai_enabled       BOOLEAN       DEFAULT TRUE,
  is_active        BOOLEAN       DEFAULT TRUE,
  created_at       TIMESTAMPTZ   DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_subscriptions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            UUID        UNIQUE NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  plan_id              INTEGER     NOT NULL REFERENCES payment_plans(id),
  status               VARCHAR(20) NOT NULL DEFAULT 'inactive'
                         CHECK (status IN ('inactive','trialing','active','past_due','cancelled')),
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  last_payment_id      UUID,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          UUID          NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  plan_id            INTEGER       NOT NULL REFERENCES payment_plans(id),
  merchant_reference VARCHAR(80)   UNIQUE NOT NULL,
  order_tracking_id  VARCHAR(120)  UNIQUE,
  amount             NUMERIC(12,2) NOT NULL,
  currency           CHAR(3)       NOT NULL DEFAULT 'KES',
  status             VARCHAR(20)   NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','completed','failed','cancelled','invalid')),
  checkout_url       TEXT,
  provider_payload   JSONB,
  created_by         UUID          REFERENCES users(id),
  created_at         TIMESTAMPTZ   DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_subscriptions_last_payment_fk'
  ) THEN
    ALTER TABLE school_subscriptions
      ADD CONSTRAINT school_subscriptions_last_payment_fk
      FOREIGN KEY (last_payment_id) REFERENCES subscription_payments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_plans_active  ON payment_plans(is_active);
CREATE INDEX IF NOT EXISTS idx_school_subs_school    ON school_subscriptions(school_id);
CREATE INDEX IF NOT EXISTS idx_school_subs_status    ON school_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_sub_payments_school   ON subscription_payments(school_id);
CREATE INDEX IF NOT EXISTS idx_sub_payments_tracking ON subscription_payments(order_tracking_id);

-- === migration_ai_rate_limiting.sql ===
-- ================================================================
-- AI ASSISTANT RATE LIMITING
-- Adds a per-plan daily AI request quota and a usage log to
-- enforce it. Burst (per-minute) limiting is handled in-memory by
-- the API layer; this table backs the daily, persistent cap.
-- ================================================================

-- 1. Daily AI request quota per plan. NULL = unlimited (e.g. for a
--    future "Enterprise" tier). Existing plans default to a sane cap.
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS ai_daily_limit INTEGER DEFAULT 50;

-- 2. Usage log — one row per AI request that passed all checks.
--    Used to compute "requests so far today" per school.
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id          BIGSERIAL    PRIMARY KEY,
  school_id   UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature     VARCHAR(40)  NOT NULL DEFAULT 'assist', -- 'assist', 'report_comment', 'report_summary', etc.
  prompt_chars INTEGER,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_school_day ON ai_usage_log(school_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_day   ON ai_usage_log(user_id, created_at);

-- === migration_exams.sql ===
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
  invigilator_id   UUID REFERENCES teachers(id) ON DELETE SET NULL,
  venue            VARCHAR(150),
  notes            TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exams_school ON exams(school_id);
CREATE INDEX IF NOT EXISTS idx_exams_date   ON exams(exam_date);

-- === migration_cbc_advanced.sql ===
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

-- === migration_senior_school_pathways.sql ===
-- ================================================================
-- SENIOR SCHOOL PATHWAYS MIGRATION
-- Adds pathway support for Grade 10-12 (STEM / Social Sciences / Arts & Sports)
-- ================================================================

-- 1. Add pathway column to classes (NULL for PP1-Grade 9, required for Grade 10-12)
ALTER TABLE classes ADD COLUMN IF NOT EXISTS pathway VARCHAR(30);

-- 2. Constrain pathway to known values when set
ALTER TABLE classes DROP CONSTRAINT IF EXISTS chk_classes_pathway;
ALTER TABLE classes ADD CONSTRAINT chk_classes_pathway
  CHECK (pathway IS NULL OR pathway IN ('STEM', 'Social Sciences', 'Arts & Sports'));

-- 3. Update uniqueness so two pathways of the same grade/stream/year can coexist
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_school_id_grade_stream_academic_year_key;
ALTER TABLE classes ADD CONSTRAINT classes_school_grade_stream_year_pathway_key
  UNIQUE (school_id, grade, stream, academic_year, pathway);

-- 4. Helpful index for filtering Senior School classes by pathway
CREATE INDEX IF NOT EXISTS idx_classes_pathway ON classes(pathway) WHERE pathway IS NOT NULL;

-- ================================================================
-- LEARNING AREAS: pathway support + Senior Secondary seed data
-- ================================================================

-- 5. Add pathway column to learning_areas.
--    NULL = core subject, applies to all Senior School pathways (and all other stages).
--    Set  = pathway-specific elective, only relevant for Senior Secondary.
ALTER TABLE learning_areas ADD COLUMN IF NOT EXISTS pathway VARCHAR(30);

ALTER TABLE learning_areas DROP CONSTRAINT IF EXISTS chk_learning_areas_pathway;
ALTER TABLE learning_areas ADD CONSTRAINT chk_learning_areas_pathway
  CHECK (pathway IS NULL OR pathway IN ('STEM', 'Social Sciences', 'Arts & Sports'));

-- 6. Seed Senior Secondary learning areas (Grade 10-12), only if not already present.
INSERT INTO learning_areas (code, name, stage, department, is_core, sort_order, kicd_ref, pathway)
SELECT * FROM (VALUES
  -- Core subjects — common to all three pathways
  ('SS-EN',        'English',                          'Senior Secondary', 'Languages',      TRUE,  35, 'KICD/CBC/SS/001', NULL::VARCHAR),
  ('SS-KIS',       'Kiswahili',                         'Senior Secondary', 'Languages',      TRUE,  36, 'KICD/CBC/SS/002', NULL),
  ('SS-CSL',       'Community Service Learning',        'Senior Secondary', 'Social Studies', TRUE,  37, 'KICD/CBC/SS/003', NULL),
  ('SS-PHE',       'Physical Education',               'Senior Secondary', 'Physical Ed',    TRUE,  38, 'KICD/CBC/SS/004', NULL),
  -- STEM pathway electives
  ('SS-STEM-MA',   'Advanced Mathematics',              'Senior Secondary', 'Mathematics',    TRUE,  39, 'KICD/CBC/SS/STEM/001', 'STEM'),
  ('SS-STEM-PHY',  'Physics',                           'Senior Secondary', 'Science',        TRUE,  40, 'KICD/CBC/SS/STEM/002', 'STEM'),
  ('SS-STEM-CHE',  'Chemistry',                         'Senior Secondary', 'Science',        TRUE,  41, 'KICD/CBC/SS/STEM/003', 'STEM'),
  ('SS-STEM-BIO',  'Biology',                           'Senior Secondary', 'Science',        TRUE,  42, 'KICD/CBC/SS/STEM/004', 'STEM'),
  ('SS-STEM-ICT',  'Computer Science',                  'Senior Secondary', 'Technical',      TRUE,  43, 'KICD/CBC/SS/STEM/005', 'STEM'),
  ('SS-STEM-AG',   'Agriculture',                       'Senior Secondary', 'Science',        FALSE, 44, 'KICD/CBC/SS/STEM/006', 'STEM'),
  -- Social Sciences pathway electives
  ('SS-SOC-HIS',   'History & Citizenship',            'Senior Secondary', 'Social Studies', TRUE,  45, 'KICD/CBC/SS/SOC/001',  'Social Sciences'),
  ('SS-SOC-GEO',   'Geography',                         'Senior Secondary', 'Social Studies', TRUE,  46, 'KICD/CBC/SS/SOC/002',  'Social Sciences'),
  ('SS-SOC-CRE',   'Christian Religious Education',     'Senior Secondary', 'Social Studies', FALSE, 47, 'KICD/CBC/SS/SOC/003',  'Social Sciences'),
  ('SS-SOC-BUS',   'Business Studies',                  'Senior Secondary', 'Social Studies', TRUE,  48, 'KICD/CBC/SS/SOC/004',  'Social Sciences'),
  ('SS-SOC-ECO',   'Economics',                         'Senior Secondary', 'Social Studies', TRUE,  49, 'KICD/CBC/SS/SOC/005',  'Social Sciences'),
  ('SS-SOC-LIT',   'Literature',                        'Senior Secondary', 'Languages',      TRUE,  50, 'KICD/CBC/SS/SOC/006',  'Social Sciences'),
  -- Arts & Sports pathway electives
  ('SS-ART-MUS',   'Music & Dance',                     'Senior Secondary', 'Arts',           TRUE,  51, 'KICD/CBC/SS/ART/001',  'Arts & Sports'),
  ('SS-ART-VIS',   'Visual & Applied Arts',             'Senior Secondary', 'Arts',           TRUE,  52, 'KICD/CBC/SS/ART/002',  'Arts & Sports'),
  ('SS-ART-PER',   'Performing Arts',                   'Senior Secondary', 'Arts',           TRUE,  53, 'KICD/CBC/SS/ART/003',  'Arts & Sports'),
  ('SS-ART-SCI',   'Sports Science',                    'Senior Secondary', 'Physical Ed',    TRUE,  54, 'KICD/CBC/SS/ART/004',  'Arts & Sports'),
  ('SS-ART-FAS',   'Fashion & Design',                  'Senior Secondary', 'Arts',           FALSE, 55, 'KICD/CBC/SS/ART/005',  'Arts & Sports'),
  ('SS-ART-FIL',   'Film & Theatre',                    'Senior Secondary', 'Arts',           FALSE, 56, 'KICD/CBC/SS/ART/006',  'Arts & Sports')
) AS v(code, name, stage, department, is_core, sort_order, kicd_ref, pathway)
WHERE NOT EXISTS (SELECT 1 FROM learning_areas la WHERE la.code = v.code);

-- === migration_scalability.sql ===
-- ================================================================
-- Migration: Scalability & Performance Indexes
-- Kadem & Zetu School Management System
-- Run once against production DB
-- ================================================================

-- Full-text search indexes for student name/admission search (ILIKE queries)
CREATE INDEX IF NOT EXISTS idx_students_fullname
  ON students (school_id, LOWER(first_name || ' ' || last_name));

CREATE INDEX IF NOT EXISTS idx_students_firstname_lower
  ON students (school_id, LOWER(first_name) text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_students_lastname_lower
  ON students (school_id, LOWER(last_name) text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_students_admission_lower
  ON students (school_id, LOWER(admission_number) text_pattern_ops);

-- Teacher search indexes
CREATE INDEX IF NOT EXISTS idx_teachers_firstname_lower
  ON teachers (school_id, LOWER(first_name) text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_teachers_lastname_lower
  ON teachers (school_id, LOWER(last_name) text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_teachers_tsc_lower
  ON teachers (school_id, LOWER(tsc_number) text_pattern_ops);

-- Auth middleware: blocklist lookup (already has unique, but explicit index for speed)
CREATE INDEX IF NOT EXISTS idx_token_blocklist_exp
  ON token_blocklist (expires_at);

-- Subscription middleware: fast lookup
CREATE INDEX IF NOT EXISTS idx_school_subs_school_created
  ON school_subscriptions (school_id, created_at DESC);

-- Attendance: date range queries are common
CREATE INDEX IF NOT EXISTS idx_attendance_school_date
  ON attendance (school_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_class_date
  ON attendance (class_id, date DESC);

-- Assessments: per-student per-term queries
CREATE INDEX IF NOT EXISTS idx_assessments_student_term
  ON assessments (school_id, student_id, term, academic_year);

-- Payments: per-student queries
CREATE INDEX IF NOT EXISTS idx_payments_student_term
  ON payments (school_id, student_id, term, academic_year);

-- Audit logs: school + time queries (for audit reports)
CREATE INDEX IF NOT EXISTS idx_audit_logs_school_time
  ON audit_logs (school_id, created_at DESC);

-- Report cards
CREATE INDEX IF NOT EXISTS idx_report_cards_school_term
  ON report_cards (school_id, term, academic_year);


-- Paystack webhook/verify: merchant_reference looked up on every callback
CREATE INDEX IF NOT EXISTS idx_sub_payments_merchant_ref
  ON subscription_payments (merchant_reference);
