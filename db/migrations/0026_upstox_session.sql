-- Upstox OAuth session store.
--
-- WHY THIS EXISTS:
--   Upstox Developer API gives free real-time LTP for up to 500 instruments
--   per call.  We use it for intraday price refresh during market hours.
--   Their access tokens expire daily at ~03:30 UTC (08:30 IST), so we need
--   a persistent place to stash the current token between runs of the
--   intraday refresh script.
--
-- WHY A SINGLE-ROW TABLE:
--   This is a SERVER-LEVEL credential, not a per-user one.  There's exactly
--   one EquityRoots app on Upstox, exactly one access token in flight at
--   any time.  Enforcing `CHECK (id = 1)` makes UPDATEs the natural write
--   path (no risk of accidentally accumulating duplicate rows).
--
-- TOKEN ROTATION:
--   /api/upstox/callback writes a fresh row after each daily login.  The
--   intraday refresh script reads it before each run; if expired/missing,
--   the script logs a clear "needs reauth" message and exits.  Auto-TOTP
--   login can come later — for now an admin clicks "Reauth" once a day.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.upstox_session (
    id            smallint     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    access_token  text,
    upstox_user_id text,
    upstox_user_name text,
    -- Upstox doesn't return an exp claim; spec says tokens die at ~08:30 IST
    -- the next morning. We store our best estimate so callers can check
    -- without hitting Upstox.
    expires_at    timestamptz,
    refreshed_at  timestamptz  NOT NULL DEFAULT now()
);

-- Seed the singleton row so UPDATEs always have a target.
INSERT INTO app.upstox_session (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE app.upstox_session IS
'Single-row store for the current Upstox access token. Refreshed by
/api/upstox/callback after each daily admin login. Read by
scripts/intraday-refresh-ltp.py before each price fetch.';

-- Permissions
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, UPDATE ON app.upstox_session TO fundamental_app;
    END IF;
END $$;
