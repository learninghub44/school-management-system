-- migration_production_indexes.sql
-- Run this on your existing Supabase/PostgreSQL DB before go-live.
-- All statements are safe to run multiple times (IF NOT EXISTS).

-- Paystack webhook/verify: merchant_reference is looked up on every callback
-- Without this, each webhook does a sequential scan of subscription_payments
CREATE INDEX IF NOT EXISTS idx_sub_payments_merchant_ref
  ON subscription_payments (merchant_reference);
