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
