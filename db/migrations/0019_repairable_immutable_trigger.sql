-- TARGET DATABASE: golden_db (NOT the app DB tracked by migrate.py).
-- Apply manually until migrate.py grows multi-DB support:
--   psql golden_db -f db/migrations/0019_repairable_immutable_trigger.sql
--   psql "$NEON_GOLDEN_URL" -f db/migrations/0019_repairable_immutable_trigger.sql
--
-- Allow legitimate data-quality repair on golden tables while keeping the
-- append-only guarantee for everything else.
--
-- Background: golden.price_history_* and delivery_data have a trigger that
-- raises an exception on any UPDATE or DELETE, blocking accidental data
-- corruption.  Good rule — historical price data should never change in
-- the normal course of operations.
--
-- But yfinance occasionally writes broken rows: non-NULL volume + NULL
-- OHLC.  We discovered 1,887 such rows on 2026-05-15 — yfinance returned
-- partial data that day for many stocks.  The chart filters NULL closes
-- out, leaving visible gaps for users.  Repairing those rows from NSE
-- bhavcopy (the authoritative source) is a legitimate, one-way improvement.
--
-- This migration changes the trigger function to honour a session-local
-- opt-in setting: `golden.allow_repair = 'on'`.  When set in the SAME
-- transaction as the UPDATE/DELETE, the trigger allows the operation.
-- Setting it requires an explicit SET LOCAL — neither sync-neon.sh nor
-- the ETL pipeline does this, so accidental corruption remains impossible.
--
-- Usage (in repair scripts):
--   BEGIN;
--   SET LOCAL golden.allow_repair = 'on';
--   UPDATE golden.price_history SET close = ... WHERE close IS NULL ...;
--   COMMIT;

CREATE OR REPLACE FUNCTION golden.raise_immutable_error() RETURNS trigger AS $$
BEGIN
    -- Session opt-in. current_setting(..., true) returns NULL on unset
    -- (instead of erroring); we only allow when explicitly = 'on'.
    -- SET LOCAL ensures the flag dies at COMMIT/ROLLBACK, so it can't
    -- leak across transactions or get stuck on for the whole session.
    IF current_setting('golden.allow_repair', true) = 'on' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    RAISE EXCEPTION
        'golden DB is append-only: % is not permitted on table "%". '
        'For legitimate repair: SET LOCAL golden.allow_repair = ''on''; '
        'in the same transaction.',
        TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION golden.raise_immutable_error() IS
'Append-only enforcement for golden.price_history_* and delivery_data. Honours
session-local golden.allow_repair=on flag to permit legitimate repair operations.';
