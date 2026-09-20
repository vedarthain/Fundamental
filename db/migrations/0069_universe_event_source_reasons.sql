-- Widen app.universe_event.source so a retirement can say WHY it happened.
--
-- 0055 defined source as ('sync', 'backfill') — provenance of the log row, not
-- reason for the change. sync-universe has since grown two deliberate,
-- evidence-specific cleanups that are NOT the ordinary gone-dark path:
--
--   'fund'       --retire-funds       ISIN prefix is INF (mutual-fund/ETF unit)
--   'non_equity' --retire-non-equity  absent from NSE's EQUITY_L.csv master AND
--                                     zero rows in app.fundamentals_annual
--
-- Collapsing these into 'sync' would make the log unable to answer "why did 40
-- symbols leave on the same day" — the exact question the log exists for.
--
-- NOTE: the 'fund' write has been in cli.py since --retire-funds shipped and
-- would have thrown CheckViolation on first use. It has never been run against
-- a database with this constraint, which is why nobody saw it. This migration
-- fixes that path as well as enabling the new one.
ALTER TABLE app.universe_event
    DROP CONSTRAINT universe_event_source_check;

ALTER TABLE app.universe_event
    ADD CONSTRAINT universe_event_source_check
    CHECK (source IN ('sync', 'backfill', 'fund', 'non_equity'));

COMMENT ON COLUMN app.universe_event.source IS
'How this event came to be logged:
  sync       — recorded live by sync-universe at the moment of the change
  backfill   — reconstructed from universe.synced_at when the log was created
  fund       — retired by --retire-funds (INF ISIN = mutual-fund/ETF unit)
  non_equity — retired by --retire-non-equity (absent from NSE EQUITY_L.csv AND
               zero annual fundamentals; ETFs and rights entitlements that carry
               no ISIN at all, so the INF filter cannot see them)';
