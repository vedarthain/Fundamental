-- 0047 — per-user Scanner "Favourites" (the stars on the Scanner's Graph tab).
--
-- Until now a starred stock was a purely-local ordering hint: the Scanner's
-- Graph tab floats starred names to the top of their industry, persisted only
-- in localStorage (`equityroots:starred:v1`). That meant stars were tied to
-- one browser — sign in on another device and the list was gone.
--
-- This promotes Favourites to an auth-backed per-user store, mirroring
-- app.user_watchlist exactly: a bare (user_id, symbol) set. Signed-out
-- visitors keep using localStorage; on first sign-in the client merges any
-- local stars into this table (one-time, then clears the local key).
--
-- Deliberately SEPARATE from user_watchlist: a star is a scanner-ordering
-- preference, not a tracked position. Keeping them apart means neither
-- surface's semantics leak into the other (the watchlist carries cost-basis +
-- notes; a favourite carries nothing but membership).

CREATE TABLE IF NOT EXISTS app.user_scanner_favourite (
    user_id    bigint       NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    symbol     text         NOT NULL,
    created_at timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, symbol)
);

COMMENT ON TABLE app.user_scanner_favourite IS
  'Per-user Scanner Favourites (starred stocks floated to the top of their industry on the Graph tab). Membership-only, mirrors user_watchlist shape.';

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, DELETE ON app.user_scanner_favourite TO fundamental_app;
    END IF;
END $$;
