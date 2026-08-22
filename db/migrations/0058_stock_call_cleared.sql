-- 0058 — "clear to history" for stock calls. Clearing a call no longer deletes
-- the row: instead we stamp cleared_at + snapshot cleared_price, so the call
-- drops out of the active Buy/Sell lists but survives as a closed record ("I
-- acted on this call"). The realized raw move is anchor_price → cleared_price.
--
-- Both columns are NULL for an active (un-cleared) call. Re-tagging a cleared
-- symbol (POST) reactivates it: the upsert resets cleared_at/cleared_price back
-- to NULL and re-anchors. A true DELETE still purges a row entirely (used to
-- cancel a mis-tag, and to remove a row from history).

ALTER TABLE app.stock_call
    ADD COLUMN IF NOT EXISTS cleared_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cleared_price NUMERIC(18, 4);

COMMENT ON COLUMN app.stock_call.cleared_at IS
'When the user cleared (closed) this call. NULL = still active. Cleared calls
leave the Buy/Sell lists but stay as history.';
COMMENT ON COLUMN app.stock_call.cleared_price IS
'Price snapshot at the moment of clearing — the realized raw move is computed
anchor_price -> cleared_price. NULL when no quote was available at clear time.';

-- Existing SELECT/INSERT/UPDATE/DELETE grants on app.stock_call already cover
-- the new columns; no additional GRANT needed.
