-- ================================================================
-- PAYMENT RECORDING & STAKEHOLDER ENHANCEMENT MIGRATION
-- Comprehensive payment tracking, CBC integration, and audit logging
-- ================================================================

-- 1. TOKEN BLOCKLIST (for session revocation)
CREATE TABLE IF NOT EXISTS token_blocklist (
  id          SERIAL       PRIMARY KEY,
  jti         VARCHAR(255) UNIQUE NOT NULL,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMP    NOT NULL,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_token_blocklist_jti ON token_blocklist(jti);
CREATE INDEX IF NOT EXISTS idx_token_blocklist_expires ON token_blocklist(expires_at);

-- 2. PAYMENT CATEGORIES (Tuition, Transport, Meals, etc.)
CREATE TABLE IF NOT EXISTS payment_categories (
  id          SERIAL       PRIMARY KEY,
  school_id   UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  code        VARCHAR(20)  NOT NULL,
  description TEXT,
  is_active   BOOLEAN      DEFAULT TRUE,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, code)
);

-- 3. ENHANCED PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS payments_v2 (
  id                    UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID           NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id            UUID           NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_id             UUID           REFERENCES users(id) ON DELETE SET NULL,
  payment_category_id   INTEGER        NOT NULL REFERENCES payment_categories(id),
  
  receipt_number        VARCHAR(50)    UNIQUE,
  amount_due            NUMERIC(12,2)  NOT NULL,
  amount_paid           NUMERIC(12,2)  NOT NULL,
  balance               NUMERIC(12,2)  GENERATED ALWAYS AS (amount_due - amount_paid) STORED,
  
  academic_year_id      INTEGER        REFERENCES academic_years(id),
  term                  INTEGER        CHECK (term BETWEEN 1 AND 3),
  
  payment_method        VARCHAR(50)    CHECK (payment_method IN ('cash','bank_transfer','mpesa','card','cheque','other')),
  transaction_reference VARCHAR(100),
  
  mpesa_code            VARCHAR(20),
  mpesa_sender_name     VARCHAR(150),
  mpesa_sender_phone    VARCHAR(20),
  
  payment_status        VARCHAR(20)    DEFAULT 'PENDING' CHECK (payment_status IN ('pending','partial','completed','failed','cancelled')),
  approval_status       VARCHAR(20)    DEFAULT 'PENDING' CHECK (approval_status IN ('pending','approved','rejected')),
  
  recorded_by           UUID           REFERENCES users(id) ON DELETE SET NULL,
  approved_by           UUID           REFERENCES users(id) ON DELETE SET NULL,
  remarks               TEXT,
  
  created_at            TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  deleted_at            TIMESTAMP,
  
  UNIQUE(school_id, receipt_number)
);

-- 4. RECEIPTS TABLE
CREATE TABLE IF NOT EXISTS receipts (
  id                 SERIAL         PRIMARY KEY,
  school_id          UUID           NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  payment_id         UUID           NOT NULL REFERENCES payments_v2(id) ON DELETE CASCADE,
  receipt_number     VARCHAR(50)    UNIQUE NOT NULL,
  receipt_date       DATE           DEFAULT CURRENT_DATE,
  issued_by          UUID           REFERENCES users(id) ON DELETE SET NULL,
  printed_count      INTEGER        DEFAULT 0,
  last_printed_at    TIMESTAMP,
  created_at         TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, receipt_number)
);

-- 5. ENHANCED USERS TABLE
ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS occupation VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(150);
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

-- 6. ENHANCED STUDENTS TABLE
ALTER TABLE students ADD COLUMN IF NOT EXISTS middle_name VARCHAR(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS national_id VARCHAR(30);
ALTER TABLE students ADD COLUMN IF NOT EXISTS enrollment_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','graduated','transferred','withdrawn'));
ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url VARCHAR(255);
ALTER TABLE students ADD COLUMN IF NOT EXISTS special_needs TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS cbc_level VARCHAR(50);

-- 7. ENHANCED TEACHERS TABLE
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS national_id VARCHAR(30);
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS tsc_number VARCHAR(30);
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS employment_date DATE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','on_leave','retired'));

-- 8. AUDIT LOG TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
  id              SERIAL       PRIMARY KEY,
  school_id       UUID         REFERENCES schools(id) ON DELETE CASCADE,
  user_id         UUID         REFERENCES users(id) ON DELETE SET NULL,
  action          VARCHAR(50)  NOT NULL,
  resource_type   VARCHAR(50)  NOT NULL,
  resource_id     VARCHAR(100),
  old_values      JSONB,
  new_values      JSONB,
  ip_address      VARCHAR(45),
  user_agent      TEXT,
  status          VARCHAR(20)  CHECK (status IN ('success','failure')),
  error_message   TEXT,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_school ON audit_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- 9. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_payments_v2_school ON payments_v2(school_id);
CREATE INDEX IF NOT EXISTS idx_payments_v2_student ON payments_v2(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_v2_parent ON payments_v2(parent_id);
CREATE INDEX IF NOT EXISTS idx_payments_v2_status ON payments_v2(payment_status);
CREATE INDEX IF NOT EXISTS idx_payments_v2_created ON payments_v2(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_categories_school ON payment_categories(school_id);
CREATE INDEX IF NOT EXISTS idx_receipts_school ON receipts(school_id);
CREATE INDEX IF NOT EXISTS idx_receipts_payment ON receipts(payment_id);
