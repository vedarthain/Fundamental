-- Corporate actions (dividends, splits, bonus, rights, buybacks) per symbol.
--
-- Powers a /corporate-actions calendar + a per-stock CA tab. Sourced from BSE
-- (api.bseindia.com) by scripts/fetch-corporate-actions.py: BSE responds
-- reliably to us where NSE's dynamic API 403s. Symbols are mapped to BSE
-- scrip codes via ISIN (BSE scrip master ⋈ app.universe.isin).
--
-- One flexible row per action; action_type is normalised (dividend/split/
-- bonus/rights/buyback/other) and the raw BSE fields are kept in `details`
-- jsonb so we don't lose anything across action types.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.corporate_action (
    symbol       text NOT NULL,
    -- Bare NSE symbol (matches app.universe.symbol / screener_meta.symbol).

    action_type  text NOT NULL,
    -- Normalised: 'dividend' | 'split' | 'bonus' | 'rights' | 'buyback' | 'other'.

    ex_date      date,
    -- Ex / book-closure-from date (BSE BCRD_from). The date the action takes
    -- effect; null only if BSE omits it.

    purpose      text,
    -- Raw BSE purpose string, e.g. "Final Dividend", "Stock Split From Rs.10
    -- to Rs.2". Kept verbatim for display + audit.

    amount       numeric,
    -- Dividend per share (₹) when applicable; null for non-cash actions.

    details      jsonb,
    -- Full raw BSE row — future-proofs against new fields / action types.

    bse_code     text,
    source       text NOT NULL DEFAULT 'bse',
    fetched_at   timestamptz NOT NULL DEFAULT now(),

    -- A given symbol can't have two distinct actions with the same ex_date +
    -- purpose; upsert on that key so re-runs refresh rather than duplicate.
    PRIMARY KEY (symbol, ex_date, purpose)
);

CREATE INDEX IF NOT EXISTS corporate_action_symbol_idx
    ON app.corporate_action (symbol, ex_date DESC);
-- Calendar view: "what's going ex soon across the market".
CREATE INDEX IF NOT EXISTS corporate_action_exdate_idx
    ON app.corporate_action (ex_date DESC);

COMMENT ON TABLE app.corporate_action IS
'Corporate actions (dividend/split/bonus/rights/buyback) per symbol, sourced
from BSE by scripts/fetch-corporate-actions.py (mapped via ISIN). Refreshed on
a slow cron — actions change infrequently.';

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.corporate_action TO fundamental_app;
    END IF;
END $$;
