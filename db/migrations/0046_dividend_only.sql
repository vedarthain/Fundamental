-- 0046 — app.dividend_only: a small, hand-curated register of InvIT / REIT
-- names that we cover for DIVIDENDS ONLY, deliberately OUTSIDE the scored
-- equity universe.
--
-- WHY A SEPARATE TABLE. The scoring/clustering pipeline selects
--   FROM app.universe WHERE is_active
-- so anything in app.universe enters the Q/V/M engine. InvITs/REITs are trusts,
-- not companies — units not shares, distributions (a blend of interest,
-- dividend and capital return) not equity dividends — and they must NOT be
-- scored against equity peers. Keeping them in their own table makes it
-- structurally impossible for them to leak into clustering or scoring.
--
-- WHAT LIVES WHERE. app.fundamentals_annual has a FOREIGN KEY to app.universe,
-- so we cannot write InvIT dividend rows there without adding them to the
-- scored universe — the very thing we're avoiding. Instead the dividend HISTORY
-- gets its own FK-free table, app.dividend_only_annual (below). app.dividend_only
-- holds display metadata plus a current-price snapshot, because
-- golden.price_history_1d is read-only and does not carry these symbols — so
-- their LTP comes from the Screener export, captured at scrape time.
--
-- Populated by the ETL command `fetch-dividend-only`, which scrapes the same
-- Screener export the equity path uses. The Dividend Scanner (web) UNIONs these
-- rows into its tree under a synthetic "InvITs & REITs" sector with a null
-- composite (they are not scored — the composite column shows "—").

CREATE TABLE IF NOT EXISTS app.dividend_only (
  symbol          text        PRIMARY KEY,   -- bare NSE symbol, e.g. PGINVIT
  company_name    text,                       -- display name
  sector          text        NOT NULL,       -- coarse grouping for the tree, e.g. 'InvITs & REITs'
  industry        text        NOT NULL,       -- finer grouping, e.g. 'Power InvIT'
  current_price   numeric(14,4),              -- LTP snapshot from the Screener export (golden lacks these)
  price_fetched_at timestamptz,               -- when current_price was captured
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.dividend_only IS
  'Hand-curated InvIT/REIT register covered for dividends only, kept OUTSIDE the scored equity universe (app.universe). Dividend history lives in app.dividend_only_annual; this table holds display metadata + a current-price snapshot (golden.price_history_1d does not carry these symbols). Populated by ETL fetch-dividend-only; surfaced by the web Dividend Scanner with a null composite.';

-- Per-fiscal-year dividend history for the register above. Mirrors the three
-- app.fundamentals_annual columns the Dividend Scanner actually needs — total
-- distribution, unit count, and that year's close — but WITHOUT the FK to
-- app.universe, so trusts can be stored without entering the equity tables.
-- no_of_equity_shares carries units (backfilled from market_cap / current_price
-- when Screener omits the shares row); annual_close_price drives the per-year
-- yield exactly as it does for equities.
CREATE TABLE IF NOT EXISTS app.dividend_only_annual (
  symbol              text          NOT NULL REFERENCES app.dividend_only(symbol) ON DELETE CASCADE,
  period_end          date          NOT NULL,        -- fiscal-year end (~31 Mar)
  dividend_amount     numeric,                        -- total distribution, ₹ crore
  no_of_equity_shares numeric,                        -- units (see note above)
  annual_close_price  numeric,                        -- that FY's close, ₹
  source_fetched_at   timestamptz,
  PRIMARY KEY (symbol, period_end)
);

COMMENT ON TABLE app.dividend_only_annual IS
  'Per-FY dividend history for app.dividend_only (InvITs/REITs). FK-free of app.universe by design. DPU = dividend_amount x 1e7 / no_of_equity_shares; per-year yield = DPU / annual_close_price.';
