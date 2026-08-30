-- 0064 — retain-and-flag manual trades matched by an import.
--
-- Previously import-trades DELETED any manual (source_file='manual-entry')
-- entry that matched an incoming CSV trade on (symbol, broker, date, qty), so
-- the hand entry vanished silently. We now KEEP the manual row and stamp it
-- matched_at instead, so the Trade Log can show it greyed-out and tagged
-- "Matched" rather than making it disappear.
--
-- Valuation must not double-count: every walk that sums transactions
-- (computeRealized, recomputeDerivedHolding) excludes manual rows where
-- matched_at IS NOT NULL — the imported copy is authoritative for P&L.
--
-- Guarded on the table's existence (app.portfolio_transaction is pre-existing
-- schema drift, not created by a tracked migration) so a from-scratch rebuild
-- is a harmless no-op here.

DO $$
BEGIN
  IF to_regclass('app.portfolio_transaction') IS NULL THEN
    RAISE NOTICE 'app.portfolio_transaction absent — skipping 0064';
    RETURN;
  END IF;

  ALTER TABLE app.portfolio_transaction
    ADD COLUMN IF NOT EXISTS matched_at timestamptz;
END $$;
