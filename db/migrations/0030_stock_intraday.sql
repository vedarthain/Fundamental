-- Intraday tick store for individual equities.
--
-- Powers the per-stock 1D price chart on /stock/[symbol]. Without this the
-- 1D chart only had two points — yesterday's EOD close and the single live
-- current_price — so it drew a straight line. screener_meta.current_price is
-- OVERWRITTEN on every pinger fire, so no intraday shape survives there.
-- This table APPENDS one row per symbol per fire, building the day's curve.
--
-- Written every ~10 min by the external pinger hitting POST
-- /api/cron/intraday-equity, in the same bulk pass that updates
-- screener_meta.current_price (the LTPs are already in hand, so this is one
-- extra unnest INSERT — no additional Upstox calls).
--
-- Why a SEPARATE table from golden.price_history:
--   golden.price_history is the authoritative DAILY OHLC source (read-only,
--   keyed (symbol, date, interval)). Intraday ticks are fast-rolling, keyed
--   by TIMESTAMP, and live in the app DB (golden is read-only to us). Keeping
--   them apart means the daily series stays clean and this table can be
--   truncated freely — we only ever read the current IST-day slice.
--
-- Symbol convention: bare NSE symbol WITHOUT the ".NS" suffix (e.g.
-- "RELIANCE"), matching app.screener_meta.symbol / app.universe.symbol. The
-- golden daily series uses "<symbol>.NS"; the /stock page strips/adds the
-- suffix at the boundary.
--
-- Volume: ~2,150 active symbols x ~38 fires/day ~= 82k rows/day. With 24h
-- retention the table holds ~one trading day (~4 MB). Negligible for Neon;
-- no partitioning needed at this scale.
--
-- Retention: capped at ~26h. Each write DELETEs ticks older than 26 hours
-- (a touch over one IST day so the current-day read is never truncated at
-- the boundary). We only ever read the IST-day-bounded slice anyway.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.stock_intraday (
    symbol text          NOT NULL,
    -- Bare NSE symbol (no ".NS"), matches app.screener_meta.symbol.

    ts     timestamptz   NOT NULL DEFAULT now(),
    -- Wall-clock instant the tick was captured (server time). The /stock
    -- page bounds reads to the current IST calendar day for the 1D chart.

    ltp    numeric(14,4) NOT NULL,
    -- Last traded price from Upstox /v2/market-quote/ltp (same value written
    -- to screener_meta.current_price in the same pass).

    PRIMARY KEY (symbol, ts)
);

-- Primary read pattern: "today's ticks for ONE symbol, oldest-first" →
-- (symbol, ts) covers it as a range scan. The PK already provides this
-- ordering, so no extra composite index is needed.

-- The retention prune is a range delete on ts across all symbols; a
-- dedicated ts index keeps it a cheap index scan rather than a seq scan.
CREATE INDEX IF NOT EXISTS stock_intraday_ts_idx
    ON app.stock_intraday (ts);

COMMENT ON TABLE app.stock_intraday IS
'Fast-rolling intraday LTP ticks per equity. Appended ~10-min by the external
pinger via /api/cron/intraday-equity (same pass as screener_meta.current_price).
Read only as the current IST-day slice for the /stock 1D chart; older rows
pruned at write time. Daily OHLC lives in golden.price_history.';

-- Permissions
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, DELETE ON app.stock_intraday TO fundamental_app;
    END IF;
END $$;
