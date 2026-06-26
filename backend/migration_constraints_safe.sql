-- migration_constraints_safe.sql
-- Run this on your existing Supabase DB.
-- Every statement is wrapped in DO blocks so it skips if already exists.
-- Safe to run multiple times.

-- ── 1. school_subscriptions FK on last_payment_id ─────────────────
DO $$ BEGIN
  ALTER TABLE school_subscriptions
    ADD CONSTRAINT school_subscriptions_last_payment_fk
    FOREIGN KEY (last_payment_id) REFERENCES subscription_payments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. classes: pathway check constraint ──────────────────────────
ALTER TABLE classes DROP CONSTRAINT IF EXISTS chk_classes_pathway;
ALTER TABLE classes ADD CONSTRAINT chk_classes_pathway
  CHECK (pathway IS NULL OR pathway IN ('STEM', 'Social Sciences', 'Arts & Sports'));

-- ── 3. classes: unique constraint with pathway ────────────────────
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_school_id_grade_stream_academic_year_key;

DO $$ BEGIN
  ALTER TABLE classes ADD CONSTRAINT classes_school_grade_stream_year_pathway_key
    UNIQUE (school_id, grade, stream, academic_year, pathway);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 4. learning_areas: pathway check constraint ───────────────────
ALTER TABLE learning_areas DROP CONSTRAINT IF EXISTS chk_learning_areas_pathway;
ALTER TABLE learning_areas ADD CONSTRAINT chk_learning_areas_pathway
  CHECK (pathway IS NULL OR pathway IN ('STEM', 'Social Sciences', 'Arts & Sports'));

-- ── 5. Merchant reference index (Paystack webhook lookup) ─────────
CREATE INDEX IF NOT EXISTS idx_sub_payments_merchant_ref
  ON subscription_payments (merchant_reference);
