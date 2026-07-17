-- 0041 — app.portfolio_holding / app.portfolio_snapshot: per-user portfolio tracker.
--
-- Holdings-only (no transaction history): each broker CSV is a CURRENT snapshot,
-- so re-importing a broker REPLACES that broker's rows for the user. Current
-- value, day change and Q/V/M/rank overlays are all DERIVED at read time —
-- mapped equities are re-priced live from golden + app.scores; instruments
-- outside our scoring universe (ETFs, gold/silver funds) are carried at the
-- broker's own price/value captured at import time (broker_* columns), so
-- nothing in the portfolio is dropped.
--
-- Performance is FORWARD-ONLY: portfolio_snapshot accrues one row per user per
-- day (Vercel cron) starting the day of import — a holdings export has no
-- back-history, so the equity curve grows from onboarding onward.

CREATE TABLE IF NOT EXISTS app.portfolio_holding (
  id               bigserial     PRIMARY KEY,
  user_id          bigint        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  broker           text          NOT NULL CHECK (broker IN ('upstox','zerodha','fyers','fivepaisa','groww')),
  raw_symbol       text          NOT NULL,      -- broker's original identifier (audit + fallback key)
  isin             text,                        -- present for fyers/groww exports; NULL otherwise
  symbol           text,                        -- resolved app.universe.symbol; NULL if outside coverage
  is_mapped        boolean       NOT NULL DEFAULT false,  -- resolved to the scoring universe
  quantity         numeric(18,4) NOT NULL CHECK (quantity >= 0),
  avg_cost         numeric(14,4),               -- per-share buy price (from broker)
  broker_ltp       numeric(14,4),               -- broker's last price at import (fallback pricing)
  broker_cur_value numeric(18,2),               -- broker's current value at import (fallback)
  broker_day_pct   numeric(9,4),                -- broker's day-change % at import (fallback)
  source_batch     uuid          NOT NULL,      -- ties all rows from one CSV upload
  imported_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (user_id, broker, raw_symbol)          -- idempotent re-import within a broker
);

CREATE INDEX IF NOT EXISTS idx_portfolio_holding_user
  ON app.portfolio_holding (user_id, broker);
CREATE INDEX IF NOT EXISTS idx_portfolio_holding_symbol
  ON app.portfolio_holding (symbol) WHERE symbol IS NOT NULL;

COMMENT ON TABLE app.portfolio_holding IS
  'Per-user current holdings imported from broker CSVs. No transaction history; re-import replaces a broker''s rows. Values/scores derived on read; unmapped instruments carried at broker value.';

CREATE TABLE IF NOT EXISTS app.portfolio_snapshot (
  id                bigserial     PRIMARY KEY,
  user_id           bigint        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  snap_date         date          NOT NULL,
  total_value       numeric(18,2),
  total_cost        numeric(18,2),
  day_change_value  numeric(18,2),
  holdings          jsonb,                       -- per-symbol breakdown for the curve / attribution
  created_at        timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (user_id, snap_date)                    -- one row per user per day
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshot_user
  ON app.portfolio_snapshot (user_id, snap_date DESC);

COMMENT ON TABLE app.portfolio_snapshot IS
  'Forward-only daily portfolio valuation per user (Vercel cron). Enables the equity curve + NIFTY500 comparison that accrues from onboarding.';
