-- /feedback submissions store.
--
-- Captures what real users tell us they want or what's broken.  Optional
-- name + email, required body.  Page context (where they were when they
-- submitted) helps interpret the feedback later.
--
-- ip_hash is a SHA-256 of the source IP (the raw IP is never stored) — used
-- for soft dedup / rate-limit only, not identification. Same person hitting
-- submit 50 times in a minute will produce 50 rows with the same hash so we
-- can spot abuse without retaining a privacy-sensitive field.
--
-- handled + notes fields let me triage submissions later: mark as read,
-- jot what we did about it.  Not exposed via the public API.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.user_ideas (
    id           bigserial    PRIMARY KEY,
    submitted_at timestamptz  NOT NULL DEFAULT now(),
    name         text,                                -- optional
    email        text,                                -- optional
    body         text         NOT NULL,
    page_url     text,                                -- referer at submit time
    user_agent   text,                                -- browser context
    ip_hash      text,                                -- SHA-256 of IP, not the IP itself
    handled      boolean      NOT NULL DEFAULT false, -- admin triage flag
    notes        text                                 -- internal notes for me
);

-- Common queries: latest unhandled first.
CREATE INDEX IF NOT EXISTS user_ideas_submitted_idx
    ON app.user_ideas (submitted_at DESC);
CREATE INDEX IF NOT EXISTS user_ideas_unhandled_idx
    ON app.user_ideas (handled, submitted_at DESC) WHERE handled = false;

-- ETL role needs INSERT (write submissions) + SELECT/UPDATE (admin reads
-- and triage).  Read user can SELECT too (for the admin page).
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE ON app.user_ideas TO fundamental_app;
        GRANT USAGE, SELECT ON SEQUENCE app.user_ideas_id_seq TO fundamental_app;
    END IF;
END $$;

COMMENT ON TABLE app.user_ideas IS
'/feedback submissions. body is the user-supplied text; name/email optional.
page_url is the referer header at submit time. ip_hash is SHA-256(ip) for
soft dedup only — raw IP is never stored. handled + notes are internal.';
