-- app.screener_session — the one place the Screener cookie lives.
--
-- WHY THIS EXISTS
--
-- SCREENER_SESSIONID was stored in two places that expired independently:
-- .env.local on one laptop, and this repo's GitHub secrets. On 2026-10-02 the
-- GitHub copy was found 33 days stale, having silently broken four workflows —
-- refresh-company-overview, refresh-company-info, refresh-shareholding and the
-- Screener scrape inside weekly-fetch — with 2,235 symbols due and 2,062
-- holding no overview at all. The local copy was dead too. Rotating by hand
-- means devtools, a file edit, and two `gh secret set` calls; the step people
-- forget is the second place, which is also the one nothing visibly depends on
-- until a scheduled job fails at 23:02 on a Wednesday.
--
-- One row in a table every workflow already connects to collapses those two
-- copies into one. Rotation becomes a single write with no laptop involved.
--
-- WHY NOT A GITHUB PAT AND AN API CALL
--
-- The obvious alternative is an admin button that writes the repo secret via
-- the GitHub API. That needs a PAT with secrets-write on vedarthain/Fundamental
-- — a PUBLIC repo — parked in Vercel's environment, held by a public-facing
-- Next.js app. A non-expiring credential that can inject anything into CI,
-- guarding a cookie that expires on its own. The tradeoff runs the wrong way.
--
-- WHY A SINGLE-ROW TABLE
--
-- Same reasoning as app.upstox_session (0026), which this deliberately mirrors:
-- there is exactly one EquityRoots Screener account and exactly one session in
-- flight. CHECK (id = 1) makes UPDATE the natural write path and makes it
-- impossible to accumulate rival rows that readers would have to choose
-- between.
--
-- WHAT IS NOT STORED HERE
--
-- The Screener email and password. /api/screener/session uses them to log in
-- and discards them; they are never written to this table, to .env.local, or to
-- a log. A stored password would turn a self-expiring cookie into a permanent
-- credential, which is the same mistake as the PAT.
--
-- WHY verified_at IS SEPARATE FROM updated_at
--
-- A row is only written after the cookie has been PROVEN authenticated against
-- the login-gated Key Points fragment (/wiki/company/{id}/commentary/v2/, which
-- 302s to the login page without a valid session). Screener's company pages
-- render for anonymous visitors, so "the page loaded" proves nothing — that
-- mistake is what made an earlier cookie-health check report a dead session as
-- alive. verified_at records when that proof was obtained and verified_symbol
-- records what it was obtained against, so a later reader can tell a verified
-- rotation from a hand-edited row.
--
-- WHAT KEEPS THIS CURRENT (CLAUDE.md §5)
--
-- Nothing automatic, and that is stated rather than hidden: Screener has no
-- refresh token, so a human logs in. What DOES keep it honest is the
-- cookie_health check in scripts/check-freshness.py, which actively probes the
-- gated fragment every morning and fails when the stored cookie is dead. The
-- row is not a seed — if it goes stale, something says so out loud.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.screener_session (
    id              smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    sessionid       text,
    csrftoken       text,
    -- When the cookie was last PROVEN to work, and against what. NULL means
    -- unproven, which readers should treat as suspect rather than absent.
    verified_at     timestamptz,
    verified_symbol text,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    -- Who rotated it: 'admin-page' or 'screener-session.py'. Not an audit log,
    -- just enough to tell a button press from a CLI run when debugging.
    updated_by      text
);

-- Seed the singleton so writers can always UPDATE rather than branch.
INSERT INTO app.screener_session (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE app.screener_session IS
'Single-row store for the current Screener.in session cookie. Written by '
'/api/screener/session (admin page) and scripts/screener-session.py, both of '
'which verify the cookie against the login-gated Key Points fragment before '
'writing. Read DB-first by the Screener scraper, build-company-overview.mjs '
'and check-freshness.py, with SCREENER_SESSIONID kept only as a fallback. '
'Credentials are never stored here — see 0084 for why.';

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, UPDATE ON app.screener_session TO fundamental_app;
    END IF;
END $$;
