-- Intraday tick store for headline indices (NIFTY 50, NIFTY BANK).
--
-- Powers the LIVE LTP + change-since-prev-close readout on the /market
-- hero panels during market hours. Written every ~15 min by an external
-- pinger (cron-job.org) hitting POST /api/cron/intraday-index, which pulls
-- the live LTP from Upstox and computes change against the prior trading
-- day's close.
--
-- Why a SEPARATE table from app.market_index_history:
--   market_index_history is the authoritative DAILY OHLC source — keyed
--   (index_code, date), one row per trading day, written by the EOD NSE
--   archive fetcher. Intraday ticks are fast-rolling (dozens per day per
--   index) and keyed by TIMESTAMP, not date. Mixing them would force every
--   existing daily query to filter out intraday noise. Keeping intraday in
--   its own table means the daily table stays clean and this one can be
--   truncated freely (we only ever read the latest tick — history here is
--   disposable).
--
-- Retention: only the latest tick per index is ever read. We DELETE ticks
-- older than 2 days at write time (cheap, keeps the table tiny). No
-- partitioning needed at this volume (~26 ticks/day × 2 indices).

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.market_index_intraday (
    index_code   text          NOT NULL,
    -- Same stable internal code as market_index_history: "NIFTY50",
    -- "NIFTYBANK". Lets the live readout join back to the daily row.

    ts           timestamptz   NOT NULL DEFAULT now(),
    -- Wall-clock instant the tick was captured (server time). The /market
    -- live endpoint uses this to decide whether a tick is fresh enough to
    -- display vs. falling back to the daily close.

    ltp          numeric(14,4) NOT NULL,
    -- Last traded price from Upstox /v2/market-quote/ltp.

    prev_close   numeric(14,4),
    -- Prior trading day's close (from market_index_history at write time).
    -- Stored so the live endpoint renders change without a second join.

    pct_change   numeric(8,4),
    -- (ltp - prev_close) / prev_close * 100, computed at write time.

    PRIMARY KEY (index_code, ts)
);

-- The only query pattern is "latest tick per index_code", so a
-- (index_code, ts DESC) index makes it a single index seek.
CREATE INDEX IF NOT EXISTS market_index_intraday_code_ts_idx
    ON app.market_index_intraday (index_code, ts DESC);

COMMENT ON TABLE app.market_index_intraday IS
'Fast-rolling intraday LTP ticks for headline indices. Written ~15-min by
the external pinger via /api/cron/intraday-index. Only the latest tick per
index is read; older rows pruned at write time. Daily OHLC lives in
market_index_history.';

-- Permissions
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, DELETE ON app.market_index_intraday TO fundamental_app;
    END IF;
END $$;
