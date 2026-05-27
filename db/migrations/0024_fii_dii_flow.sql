-- Daily Foreign Institutional Investor (FII) and Domestic Institutional
-- Investor (DII) net cash-market flows. Indian retail markets watch
-- these flows obsessively — sustained FII selling vs. DII buying is one
-- of the most-discussed daily signals in Indian financial media.
--
-- Source: NSE provides a daily JSON/CSV at
--   https://www.nseindia.com/api/fiidiiTradeReact
--   (also archived as CSV per day at /content/equities/Fiidii_DDMMYYYY.csv)
--
-- Numbers are in CRORES (₹ Cr), matching the NSE display. Storing in Cr
-- keeps numbers human-readable in raw SQL ("FII net -2,341 Cr"), which
-- helps debugging more than micro-precision in INR. We use numeric(14,2)
-- so 6-figure crore flows (1L Cr = 1 trillion ₹) still fit comfortably.
--
-- We store buy + sell + net separately because some downstream views
-- want gross activity (buy+sell volume of conviction) and some want
-- net direction. Deriving net = buy - sell is trivial; recovering
-- buy and sell from net alone is impossible.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.fii_dii_flow (
    date       date            PRIMARY KEY,

    fii_buy    numeric(14,2),
    fii_sell   numeric(14,2),
    fii_net    numeric(14,2),

    dii_buy    numeric(14,2),
    dii_sell   numeric(14,2),
    dii_net    numeric(14,2),

    source     text            NOT NULL DEFAULT 'nse_api',
    -- Tag so we know which feed each row came from. "nse_api" for the
    -- live JSON endpoint, "nse_csv" for the per-day archive used by
    -- backfill. Useful when the live API misbehaves and we have to
    -- backfill manually.

    fetched_at timestamptz     NOT NULL DEFAULT now()
);

-- Time series queries scan recent dates first; descending index serves
-- both "latest day" and "last N days for the chart."
CREATE INDEX IF NOT EXISTS fii_dii_flow_date_idx
    ON app.fii_dii_flow (date DESC);

COMMENT ON TABLE app.fii_dii_flow IS
'Daily Foreign / Domestic Institutional Investor cash market net flows
in ₹ crores. Source: NSE. PK on date; idempotent upsert on re-run.';

-- Permissions
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE ON app.fii_dii_flow TO fundamental_app;
    END IF;
END $$;
