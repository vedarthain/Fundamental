-- Per-symbol fetch bookkeeping for the BSE announcements sweep — same pattern
-- as app.corporate_action_fetch (migration 0034).
--
-- Why: the daily announcements sweep is ~2,055 BSE calls and slow BSE responses
-- (15s timeouts) can push a run past the job timeout, getting it cancelled. The
-- fetcher was not resumable (ORDER BY symbol every run), so a cancelled run
-- restarted at "A" and late-alphabet symbols could go stale. This marker table
-- records the last *attempt* per symbol so the sweep runs least-recently-fetched
-- first and any run/re-run makes forward progress.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.announcement_fetch (
    symbol     text PRIMARY KEY,
    fetched_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.announcement_fetch IS
'Last BSE announcements fetch attempt per symbol — drives the resumable,
least-recently-fetched-first sweep order. Written by scripts/fetch-announcements.py.';

-- Backfill from symbols already pulled so the first resumable run doesn''t
-- needlessly re-fetch them before reaching never-fetched symbols.
INSERT INTO app.announcement_fetch (symbol, fetched_at)
SELECT symbol, MAX(fetched_at)
  FROM app.announcement
 GROUP BY symbol
ON CONFLICT (symbol) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.announcement_fetch TO fundamental_app;
    END IF;
END $$;
