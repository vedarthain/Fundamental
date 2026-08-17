-- 0054 — collapse Scanner "Favourites" into the Watchlist ("Watch").
--
-- We're retiring the favourite/watchlist split. There is now ONE user concept
-- called "Watch": star a stock to track it, unstar to drop it. The physical
-- survivor is app.user_watchlist — it already carries the metadata a star never
-- had (close_on_add snapshot + note), and the /watchlist page already reads it.
-- app.user_scanner_favourite becomes dead weight once the app stops writing it.
--
-- This migration is ADDITIVE and idempotent: it folds every existing favourite
-- row into the watchlist so no user loses a starred name in the switchover.
-- Merged rows carry close_on_add = NULL (we never captured a close when the
-- star was set); the UI already renders those as "—". added_at is backfilled
-- from the favourite's created_at so the "watching since" date is preserved.
--
-- app.user_scanner_favourite is intentionally LEFT IN PLACE (not dropped) so
-- this is reversible — a follow-up migration can drop it once the new code has
-- baked in production.

INSERT INTO app.user_watchlist (user_id, symbol, added_at)
SELECT f.user_id, f.symbol, f.created_at
FROM app.user_scanner_favourite f
ON CONFLICT (user_id, symbol) DO NOTHING;
