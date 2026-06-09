-- Corporate announcements (exchange filings) per stock — the "Announcements"
-- feed you see on StockEdge: SEBI disclosures, newspaper publications, investor
-- presentations, board outcomes, general updates, etc.
--
-- Source: BSE's public announcements API (api.bseindia.com AnnSubCategoryGetData)
-- — FREE, reachable from CI (NSE's API 403s behind anti-bot), and the same data
-- third-party aggregators scrape. Companies file with the exchange; BSE is the
-- official, free origin. Mapped from our NSE symbol → BSE scrip code via ISIN,
-- written by scripts/fetch-announcements.py on a daily cron.
--
-- Distinct from app.corporate_action (dividends/splits/bonus/board meetings) —
-- announcements are free-text disclosures, change daily, and carry a PDF link.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.announcement (
    id           text PRIMARY KEY,        -- BSE NEWSID (stable dedup key)
    symbol       text NOT NULL,           -- bare NSE symbol (app.universe.symbol)
    title        text NOT NULL,           -- NEWSSUB (subject line)
    category     text,                    -- CATEGORYNAME (e.g. "Company Update")
    headline     text,                    -- HEADLINE (short extra, often "Enclosed")
    published_at timestamptz,             -- NEWS_DT
    pdf_url      text,                    -- BSE attachment, when present
    bse_code     text,
    source       text NOT NULL DEFAULT 'bse',
    fetched_at   timestamptz NOT NULL DEFAULT now()
);

-- "latest announcements for stock X" → composite index.
CREATE INDEX IF NOT EXISTS announcement_symbol_dt_idx
    ON app.announcement (symbol, published_at DESC);

COMMENT ON TABLE app.announcement IS
'Per-stock corporate announcements (exchange filings) from BSE. Written by
scripts/fetch-announcements.py; pruned to a rolling window.';

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.announcement TO fundamental_app;
    END IF;
END $$;
