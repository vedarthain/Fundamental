-- 0045 — enrich app.user_watchlist with a cost-basis snapshot + a free-text note.
--
-- The watchlist page grew from "a saved list of symbols" into a lightweight
-- review journal: for each name the user wants to see what the stock closed at
-- the day they added it (a personal reference point, NOT a traded cost basis),
-- alongside a private comment for why they're watching it.
--
--   close_on_add       — the latest available daily close at the moment the row
--                        was inserted. Captured server-side on POST from golden
--                        (split-adjusted close, same basis as the rest of the
--                        app). Null for rows added before this migration —
--                        the UI renders those as "—" rather than backfilling a
--                        guessed price.
--   close_on_add_date  — the trading date that close belongs to (usually the
--                        prior session), so the UI can show "as of <date>".
--   note               — user's free-text comment. Editable from the watchlist
--                        page via PATCH /api/watchlist.
--
-- All three are per (user_id, symbol) — they live on the watchlist row itself.
-- Signed-out (localStorage) users don't get these fields; the list is a bare
-- symbol array on their device with nowhere to hang per-symbol metadata.

ALTER TABLE app.user_watchlist
  ADD COLUMN IF NOT EXISTS close_on_add      numeric(14,4),
  ADD COLUMN IF NOT EXISTS close_on_add_date date,
  ADD COLUMN IF NOT EXISTS note              text;

COMMENT ON COLUMN app.user_watchlist.close_on_add IS
  'Split-adjusted daily close captured when the row was added (personal reference point, not a traded cost basis). Null for pre-0045 rows.';
COMMENT ON COLUMN app.user_watchlist.note IS
  'User free-text comment for this watched name. Editable via PATCH /api/watchlist.';

-- The app role could already INSERT/DELETE watchlist rows; editing a note and
-- writing close_on_add on insert both need UPDATE (the latter via INSERT is
-- covered, but a future backfill and the note editor need UPDATE explicitly).
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.user_watchlist TO fundamental_app;
    END IF;
END $$;
