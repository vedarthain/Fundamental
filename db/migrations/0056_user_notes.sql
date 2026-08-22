-- 0056 — per-user scribble pad. A free-text notebook hung off the user menu:
-- jot anything, each save becomes a dated entry. This is NOT tied to a symbol
-- or a portfolio row (that's app.user_watchlist.note) — it's a standalone
-- personal log, so it gets its own table rather than another nullable column.
--
-- Append-style: every save is a new row (never an in-place edit), so created_at
-- is the entry's date and the newest-first list reads as a journal. Deletes are
-- per-row. ON DELETE CASCADE drops a user's notes when their account is removed.

CREATE TABLE IF NOT EXISTS app.user_note (
    id         BIGSERIAL   PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    body       TEXT        NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The dominant read is "this user's notes, newest first". Composite index
-- covers it without touching the table.
CREATE INDEX IF NOT EXISTS user_note_user_created_idx
    ON app.user_note (user_id, created_at DESC);

COMMENT ON TABLE app.user_note IS
'Per-user free-text scribble pad. Append-only journal — one row per save,
created_at is the entry date. Standalone (no symbol FK).';

-- Permissions for the app role.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, DELETE ON app.user_note TO fundamental_app;
        GRANT USAGE, SELECT ON SEQUENCE app.user_note_id_seq TO fundamental_app;
    END IF;
END $$;
