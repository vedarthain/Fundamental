-- Username/password auth — v1.
--
-- Email + bcrypt password hash, signed-cookie sessions (no session table —
-- the cookie itself carries {userId, exp} HMAC-signed with SESSION_SECRET).
-- This keeps Rule #1 happy: zero extra DB reads per authenticated request,
-- only the existing page queries.
--
-- Email is CITEXT so 'Foo@Bar.com' and 'foo@bar.com' collide on the UNIQUE
-- constraint — the standard mistake users make on signup is mixing case,
-- and treating those as separate accounts would be a support nightmare.
--
-- password_hash holds the full bcrypt output (algorithm + cost + salt +
-- digest, ~60 chars). We never store the raw password and never log it.
--
-- last_login_at is updated on each successful login. Useful later for
-- dormant-account cleanup; not exposed in any UI today.
--
-- No email verification in v1 — anyone can sign up instantly. If abuse
-- shows up we'll add a `email_verified_at` column and gate watchlist on it.
-- Schema is forward-compatible.

SET search_path = app, public;

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS app.users (
    id             bigserial    PRIMARY KEY,
    email          citext       NOT NULL UNIQUE,
    password_hash  text         NOT NULL,
    display_name   text,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    last_login_at  timestamptz
);

COMMENT ON TABLE app.users IS
'Username/password auth users. Sessions are stateless (signed cookie).
Email is case-insensitive (CITEXT). password_hash holds bcrypt output.';

-- Server-side watchlist — follows the user across devices.
--
-- Composite PK (user_id, symbol) gives us free dedup + the natural lookup
-- pattern ("does this user watch SYM?"). added_at is informational only;
-- we may surface "added 3 weeks ago" on the watchlist page later.
--
-- ON DELETE CASCADE on user_id so account deletion drops the watchlist
-- automatically — we don't want orphan rows.
--
-- The symbol column intentionally does NOT have a foreign key to a stocks
-- table. The universe shifts (delistings, renames) and we don't want a
-- delisting to silently wipe someone's watchlist row. The watchlist page
-- already handles "symbol no longer in universe" gracefully by flagging
-- missing rows.

CREATE TABLE IF NOT EXISTS app.user_watchlist (
    user_id   bigint       NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    symbol    text         NOT NULL,
    added_at  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, symbol)
);

-- Listing a user's full watchlist in chronological order is the dominant
-- read pattern. Composite index covers it.
CREATE INDEX IF NOT EXISTS user_watchlist_user_added_idx
    ON app.user_watchlist (user_id, added_at DESC);

COMMENT ON TABLE app.user_watchlist IS
'Per-user watchlist. (user_id, symbol) is unique. No FK to a stocks table —
symbols may leave the universe (delisting, rename) without invalidating
the row.';

-- Permissions for the app role.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.users          TO fundamental_app;
        GRANT SELECT, INSERT,         DELETE ON app.user_watchlist TO fundamental_app;
        GRANT USAGE, SELECT ON SEQUENCE app.users_id_seq TO fundamental_app;
    END IF;
END $$;
