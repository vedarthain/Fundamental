-- 0043 — app.trend_leader_signal: daily "fresh trend initiation" scanner cache.
--
-- The slow-burn sibling of app.momentum_signal (0042). Where Momentum Radar
-- catches a one-day volume explosion, this catches the START of a durable
-- uptrend: a stock whose 50-day SMA has JUST crossed above a RISING 200-day
-- SMA (golden cross) within the last ~30 sessions, trading near its 52-week
-- high. This is the signal that flagged FEDERALBNK at Rs65 in Dec-2020 (Rs354
-- today, 5.4x) — the "initiation" variant, deliberately NOT the "continuation"
-- stack, because ~180 names are in-trend at any time (too broad to act on)
-- whereas only a handful cross fresh in a given month.
--
-- A daily post-close Vercel cron (/api/cron/trend-leaders) recomputes the whole
-- universe and REPLACES that day's rows (idempotent). Fundamental columns are
-- enrichment from the panel cache — the platform's edge is filtering the fresh
-- crosses by Industry Score, not the price rule alone.

CREATE TABLE IF NOT EXISTS app.trend_leader_signal (
  snap_date        date          NOT NULL,      -- latest golden bar date
  symbol           text          NOT NULL,      -- bare NSE symbol
  close            numeric(14,4)  NOT NULL,      -- latest close
  cross_date       date          NOT NULL,      -- when 50-SMA crossed above 200-SMA
  cross_close      numeric(14,4),               -- close on the cross day (entry reference)
  pct_since_cross  numeric(9,2),                -- % move since the cross
  sma50            numeric(14,4),
  sma200           numeric(14,4),
  pct_below_high   numeric(9,2),                -- distance below 52-week high, %
  market_cap_cr    numeric(18,2),
  composite_pct    numeric(6,2),                -- fundamental Industry Score percentile
  quality_pct      numeric(6,2),
  momentum_pct     numeric(6,2),
  is_scored        boolean        NOT NULL DEFAULT false,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (snap_date, symbol)
);

CREATE INDEX IF NOT EXISTS idx_trend_leader_date
  ON app.trend_leader_signal (snap_date DESC, cross_date DESC);

COMMENT ON TABLE app.trend_leader_signal IS
  'Daily fresh-golden-cross trend-initiation scanner (cron-refreshed). Ruleset: 50-SMA crossed above rising 200-SMA within ~30 sessions, price > 50 > 200, within 20% of 52w high, >=Rs30, liquidity floor. Fundamental columns shown, not filtered on.';
