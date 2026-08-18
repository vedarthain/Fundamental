-- Immutable history of universe membership changes (add / remove).
--
-- WHY THIS EXISTS:
--   app.universe.synced_at is a SINGLE timestamp per row — it only remembers
--   the *latest* transition. If a symbol is added, then retired months later,
--   the retire UPDATE overwrites synced_at and the add-date is lost forever.
--   That makes a "what changed each week" view impossible to reconstruct.
--
--   This table is the append-only log: sync-universe writes one row every time
--   it INSERTS a new listing ('added') or retires a dark name ('removed'). It
--   outlives the current-state row in app.universe, so any past week can be
--   replayed forever. Data is never lost.
--
-- No FK to app.universe ON PURPOSE: a 'removed' event must survive even if the
-- universe row is later hard-deleted, and an 'added' event for a symbol that
-- churned out must not cascade-vanish. company_name is snapshotted at event
-- time so the log reads correctly even if identity later changes.
CREATE TABLE app.universe_event (
    id            BIGSERIAL PRIMARY KEY,
    symbol        TEXT NOT NULL,                 -- bare NSE symbol (snapshot)
    event         TEXT NOT NULL CHECK (event IN ('added', 'removed')),
    company_name  TEXT,                          -- snapshot at event time
    event_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 'sync'     = recorded live by sync-universe at the moment of the change.
    -- 'backfill' = reconstructed from universe.synced_at when this log was
    --              created (best-available; only the LATEST transition per
    --              symbol survived in synced_at, so older churn is not present).
    source        TEXT NOT NULL DEFAULT 'sync' CHECK (source IN ('sync', 'backfill'))
);

-- Primary read: "changes newest first", and "changes in week of X".
CREATE INDEX idx_universe_event_at ON app.universe_event (event_at DESC);
-- Per-symbol history ("when did TICKER come and go").
CREATE INDEX idx_universe_event_symbol ON app.universe_event (symbol, event_at DESC);

COMMENT ON TABLE app.universe_event IS
'Append-only log of universe add/remove events. Written by the ETL
sync-universe command; never updated or deleted. Source of the weekly
"what was added / removed" GUI. Outlives app.universe rows on purpose.';

-- ── Backfill from current state ──────────────────────────────────────────────
-- Seed one event per existing universe row from its (is_active, synced_at) so
-- the log starts populated with the current known state instead of empty. This
-- is a RECONSTRUCTION: synced_at only holds each symbol's most-recent
-- transition, so a name that was added-then-removed shows only the removal.
-- Marked source='backfill' to keep that fidelity caveat honest and queryable.
INSERT INTO app.universe_event (symbol, event, company_name, event_at, source)
SELECT symbol,
       CASE WHEN is_active THEN 'added' ELSE 'removed' END,
       company_name,
       COALESCE(synced_at, now()),
       'backfill'
  FROM app.universe;

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        -- ETL appends; it never updates or deletes history.
        GRANT SELECT, INSERT ON app.universe_event TO fundamental_app;
        GRANT USAGE, SELECT ON SEQUENCE app.universe_event_id_seq TO fundamental_app;
    END IF;
END $$;
