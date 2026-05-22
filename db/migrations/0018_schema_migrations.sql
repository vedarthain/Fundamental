-- Migration tracking table.  Records which migrations have been applied
-- to this database, so scripts/migrate.py can detect pending vs. applied.
--
-- Before this migration:
--   - Migrations were applied by hand (`psql -f db/migrations/0017.sql`).
--   - Neon got the same DDL via shell heredocs duplicated in sync-neon.sh.
--   - No record of "what's on which DB" → silent schema drift was possible.
--
-- After: scripts/migrate.py reads this table and applies only what's missing.
-- Idempotent — re-running migrate.py is a no-op.  Bootstrap an existing DB
-- once with `scripts/migrate.py --baseline` to record 0001..0017 as
-- already-applied without re-running them.
--
-- The migrate.py runner also CREATEs this table IF NOT EXISTS as part of
-- its initialization (chicken-and-egg: the tracker has to exist before it
-- can track itself).  This file is the formal definition for new DBs
-- created from scratch via the migration pipeline.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.schema_migrations (
    version    text        NOT NULL PRIMARY KEY,
    name       text        NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.schema_migrations IS
'Tracks applied DB migrations. Managed by scripts/migrate.py — do not write
to this table by hand. version = leading NNNN from db/migrations/NNNN_*.sql.';

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT ON app.schema_migrations TO fundamental_app;
    END IF;
END $$;
