-- Extend user_ideas with status + publish + admin response columns.
--
-- New columns:
--   status      — lifecycle label: open | planned | building | shipped | wont_do
--   is_public   — true when the admin (me) approves this for the public
--                 board on /feedback. Default false, opt-in publication.
--   response    — public-facing admin reply shown next to the body when
--                 is_public = true. Plain text, 2000 char cap (enforced
--                 in the API).
--
-- Privacy: even when is_public = true, the /feedback public board NEVER
-- surfaces name/email/page_url/user_agent/ip_hash.  The public-board
-- query selects only id, submitted_at, body, status, response.

SET search_path = app, public;

ALTER TABLE app.user_ideas
  ADD COLUMN IF NOT EXISTS status    text    NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS response  text;

-- Constrain status to a known set so a typo never gets persisted.
-- DO block + EXCEPTION because ADD CONSTRAINT IF NOT EXISTS isn't supported.
DO $$
BEGIN
  ALTER TABLE app.user_ideas
    ADD CONSTRAINT user_ideas_status_chk
    CHECK (status IN ('open', 'planned', 'building', 'shipped', 'wont_do'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Partial index for the public board query (WHERE is_public = true ...).
-- Tiny index because only a fraction of rows will ever be public.
CREATE INDEX IF NOT EXISTS user_ideas_public_idx
  ON app.user_ideas (status, submitted_at DESC)
  WHERE is_public = true;

COMMENT ON COLUMN app.user_ideas.status     IS 'open | planned | building | shipped | wont_do';
COMMENT ON COLUMN app.user_ideas.is_public  IS 'When true, this row appears on the public /feedback board (anonymised — never shows name/email).';
COMMENT ON COLUMN app.user_ideas.response   IS 'Public admin reply, shown on the public board next to the body.';
