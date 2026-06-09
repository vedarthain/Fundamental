-- Per-symbol fetch bookkeeping for the indianapi corporate-actions sweep.
--
-- Why a separate table: a stock with NO corporate actions ends the per-symbol
-- atomic replace with zero rows in app.corporate_action — so row presence
-- can't tell "never fetched" from "fetched, has nothing". This marker table
-- records that we *attempted* a symbol and when, independent of whether any
-- action rows resulted.
--
-- It makes the sweep RESUMABLE + fair: order the universe by this timestamp
-- ASC NULLS FIRST and each run picks up the never-fetched / stalest symbols
-- first. A run that times out (or a re-run) makes forward progress instead of
-- restarting at "A" every time, and the monthly cron naturally rotates the
-- oldest symbols.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.corporate_action_fetch (
    symbol     text PRIMARY KEY,
    fetched_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.corporate_action_fetch IS
'Last successful indianapi corporate-actions fetch per symbol — drives the
resumable, least-recently-fetched-first sweep order. Written by
scripts/fetch-corporate-actions-iapi.py.';

-- Backfill from symbols already pulled (those with action rows) so the first
-- resumable run doesn't re-spend quota re-fetching them. Symbols fetched but
-- empty (no action rows) aren't covered here and will be re-checked once — a
-- small, acceptable one-time cost.
INSERT INTO app.corporate_action_fetch (symbol, fetched_at)
SELECT symbol, MAX(fetched_at)
  FROM app.corporate_action
 WHERE source = 'indianapi'
 GROUP BY symbol
ON CONFLICT (symbol) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.corporate_action_fetch TO fundamental_app;
    END IF;
END $$;
