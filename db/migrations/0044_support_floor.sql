-- 0044 — app.support_floor_signal: daily "at a multi-year tested floor" scanner cache.
--
-- The mean-reversion sibling of the two momentum scanners (0042/0043). Where
-- those catch a move already underway (a volume explosion or a fresh trend),
-- this catches stocks sitting ON a price floor they've bounced off repeatedly:
-- a horizontal support band tested >=3 times over >13 months, with price now
-- within ~12% above it. It is deliberately the OPPOSITE of a breakout — it
-- surfaces names near their lows, not their highs.
--
-- HONEST FRAMING (baked into the UI copy too): this finds LOCATION, not
-- DIRECTION. A stock at a tested floor may bounce (the pattern we like) or slice
-- through (a value trap / falling knife). No standalone edge is proven; the
-- fundamental score is the filter that separates "quality name at a floor" from
-- "broken business grinding down". More touches is NOT more bullish — a floor
-- tested 10x is closer to breaking than one tested 3x.
--
-- A daily post-close cron (/api/cron/support-floor) recomputes the whole
-- universe over a ~5-year window and REPLACES that day's rows (idempotent).

CREATE TABLE IF NOT EXISTS app.support_floor_signal (
  snap_date      date          NOT NULL,      -- latest golden bar date
  symbol         text          NOT NULL,      -- bare NSE symbol
  close          numeric(14,4)  NOT NULL,      -- latest close
  floor_px       numeric(14,4)  NOT NULL,      -- the tested support level
  pct_above      numeric(9,2),                -- how far close sits above the floor, %
  n_touch        integer        NOT NULL,      -- number of confirmed swing-low tests of the band
  span_days      integer        NOT NULL,      -- calendar days between first and last test
  first_touch    date          NOT NULL,      -- earliest test of the floor
  last_touch     date          NOT NULL,      -- most recent test of the floor
  turnover_cr    numeric(14,2),               -- avg daily turnover, Rs cr (liquidity)
  market_cap_cr  numeric(18,2),
  composite_pct  numeric(6,2),                -- fundamental Industry Score percentile
  quality_pct    numeric(6,2),
  momentum_pct   numeric(6,2),
  is_scored      boolean        NOT NULL DEFAULT false,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (snap_date, symbol)
);

CREATE INDEX IF NOT EXISTS idx_support_floor_date
  ON app.support_floor_signal (snap_date DESC, pct_above ASC);

COMMENT ON TABLE app.support_floor_signal IS
  'Daily "at a multi-year tested floor" mean-reversion scanner (cron-refreshed). Ruleset: >=3 confirmed swing-low tests of a support band (within 8% of the floor) spread over >400 days, price now within 12% above the floor and not below it, >=Rs30, >=Rs1cr turnover. Finds location not direction; fundamental columns shown, not filtered on.';
