-- 0061 — server-side, per-user storage for scanner Graph/Themes bookmarks.
--
-- Scanner bookmarks (src/lib/scannerBookmarks.ts) were localStorage-only, so a
-- saved spot lived on exactly one browser and vanished on every other device
-- for the SAME signed-in user. This table makes them user-scoped and
-- cross-device, mirroring app.user_watchlist.
--
-- One row = one surface's whole bookmark list stored as an opaque JSON blob,
-- keyed by the same string the client hook already uses
-- (er:graphBookmarks:v1 / er:themeBookmarks:v1). The client caps the list to a
-- single spot per surface today; storing the list (not a single row) keeps the
-- table generic if that cap ever changes. Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS app.user_scanner_bookmark (
  user_id      bigint      NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  bookmark_key text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bookmark_key)
);
