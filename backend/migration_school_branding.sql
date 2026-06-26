-- ================================================================
-- School branding / customization settings
-- Cosmetic, per-school fields only — nothing here affects core
-- system behaviour (auth, billing, grading logic, etc).
-- Safe to run multiple times.
-- ================================================================

ALTER TABLE schools ADD COLUMN IF NOT EXISTS motto                     VARCHAR(255);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS theme_color                VARCHAR(7);   -- hex, e.g. #4f46e5
ALTER TABLE schools ADD COLUMN IF NOT EXISTS report_card_footer         TEXT;         -- custom note printed at the bottom of report cards
ALTER TABLE schools ADD COLUMN IF NOT EXISTS principal_signature_name   VARCHAR(150); -- name printed under the principal's signature line
