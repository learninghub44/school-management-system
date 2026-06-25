-- ============================================================
-- PRODUCTION READINESS MIGRATION
-- Run once on production DB before go-live
-- Safe to re-run (all statements are idempotent)
-- ============================================================

-- 1. Activate all schools (fixes 403 "School account is deactivated")
UPDATE schools
SET is_active = TRUE, updated_at = NOW()
WHERE is_active = FALSE;

-- 2. Activate all users (fixes 401 "Account is inactive")
UPDATE users
SET is_active = TRUE, updated_at = NOW()
WHERE is_active = FALSE
  AND role != 'SUPER_ADMIN'; -- leave SUPER_ADMIN untouched

-- 3. Clear must_change_password for all existing users
--    so staff aren't blocked on first login.
--    New users created via admin panel will still get must_change_password=TRUE
--    and be prompted to set their own password on first login — that's correct.
--    Only clear for users who already exist at go-live.
UPDATE users
SET must_change_password = FALSE, updated_at = NOW()
WHERE must_change_password = TRUE;

-- 4. Ensure payment_plans has at least one active plan
--    (some routes check is_active = TRUE on plans)
UPDATE payment_plans
SET is_active = TRUE
WHERE is_active = FALSE;

-- 5. Summary report — verify counts
SELECT
  (SELECT COUNT(*) FROM schools WHERE is_active = TRUE)  AS active_schools,
  (SELECT COUNT(*) FROM schools WHERE is_active = FALSE) AS inactive_schools,
  (SELECT COUNT(*) FROM users   WHERE is_active = TRUE)  AS active_users,
  (SELECT COUNT(*) FROM users   WHERE is_active = FALSE) AS inactive_users,
  (SELECT COUNT(*) FROM users   WHERE must_change_password = TRUE) AS pending_password_change;
