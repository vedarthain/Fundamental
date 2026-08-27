-- Retire the intraday index tick store.
--
-- app.market_index_intraday (added in 0028) held fast-rolling LTP ticks for
-- the headline indices, written ~15-min by an external cron-job.org pinger
-- hitting /api/cron/intraday-index. That route has been removed and the
-- live intraday index readout de-scoped — the last code reference
-- (fetchIndexQuotes / INDEX_INSTRUMENT_KEYS in web/src/lib/upstox.ts) is
-- gone, so nothing reads or writes this table anymore.
--
-- DAILY index OHLC is unaffected: it lives in app.market_index_history,
-- fed by scripts/fetch-indices.py (NSE close CSV) and backfilled from
-- Upstox candles via scripts/fetch-index-history-upstox.py. That table and
-- its pipeline stay.
--
-- The ticks here are disposable by design (retention capped at 24h, only
-- the latest tick per index was ever read), so dropping loses nothing of
-- value.
--
-- Operational follow-up (manual, outside this migration): delete the
-- cron-job.org job that pings /api/cron/intraday-index — it now 404s.

SET search_path = app, public;

DROP TABLE IF EXISTS app.market_index_intraday;
