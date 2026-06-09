-- Market news, aggregated from broadcaster RSS feeds + heuristic per-stock
-- tagging.
--
-- Source: free RSS from major Indian financial outlets (Economic Times,
-- LiveMint, Hindu BusinessLine, …) — no API key, no quota, fetched by
-- scripts/fetch-news.py on a short cron. We store headline + summary + source
-- link only (never full article text — copyright + it drives traffic back to
-- the source).
--
-- Tagging is best-effort: match a stock's company name / symbol in the
-- headline. It's heuristic (never 100%), so news_stock is a separate table —
-- a headline can map to 0..N stocks, and a re-tag never touches app.news.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.news (
    id           text PRIMARY KEY,
    -- sha256(canonical url) — stable dedup key across feeds + re-runs.

    source       text NOT NULL,        -- "Economic Times" | "LiveMint" | …
    title        text NOT NULL,
    summary      text,                 -- RSS <description>, plain-text, trimmed
    url          text NOT NULL,        -- link back to the source article
    published_at timestamptz,          -- RSS <pubDate>
    fetched_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS news_published_idx ON app.news (published_at DESC);

CREATE TABLE IF NOT EXISTS app.news_stock (
    news_id text NOT NULL REFERENCES app.news(id) ON DELETE CASCADE,
    symbol  text NOT NULL,             -- bare NSE symbol (app.universe.symbol)
    PRIMARY KEY (news_id, symbol)
);

-- "latest news for stock X" → index on symbol.
CREATE INDEX IF NOT EXISTS news_stock_symbol_idx ON app.news_stock (symbol);

COMMENT ON TABLE app.news IS
'Aggregated market headlines from broadcaster RSS (headline+summary+link only).
Written by scripts/fetch-news.py; pruned to a rolling window.';

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.news        TO fundamental_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.news_stock  TO fundamental_app;
    END IF;
END $$;
