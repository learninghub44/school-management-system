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
