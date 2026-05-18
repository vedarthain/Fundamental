-- Split bfsi_capmarkets into 4 peer-distinct clusters.
--
-- Background: bfsi_capmarkets lumped ~49 stocks together — pure AMCs (HDFCAMC,
-- ICICIAMC), exchanges (BSE, MCX), depositories (CDSL), rating agencies (ICRA,
-- CARERATING), RTAs (CAMS, KFINTECH), and ~30 brokers. Their unit economics are
-- fundamentally different: AMCs are AUM-fee compounders with very high margins;
-- exchanges are regulated near-monopolies; brokers are cyclical and rate-sensitive.
-- Comparing a small broker like KHANDSE against HDFCAMC produces meaningless
-- peer percentiles, so we split the cluster here.
--
-- This migration only adds the new clusters and retires the old one as a label.
-- Stock-to-cluster assignment is rule-driven in clusters/rules.py, and scorecards
-- live in scoring/scorecards.py — both are updated alongside this migration.
-- After deploying, run:
--   etl/.venv/bin/python -m fundamental_etl assign-clusters
--   etl/.venv/bin/python -m fundamental_etl.scoring.seed_scorecards --force
--   etl/.venv/bin/python -m fundamental_etl score

SET search_path = app, public;

INSERT INTO app.cluster (id, name, meta_cluster_id, description) VALUES
  ('bfsi_amc_wealth', 'AMCs & Wealth Managers', 'financials',
   'Asset managers and wealth/advisory firms — recurring AUM-fee economics'),
  ('bfsi_exchange',   'Exchanges & Depositories', 'financials',
   'Stock/commodity exchanges and depositories — regulated near-monopolies'),
  ('bfsi_rta_rating', 'RTAs & Rating Agencies', 'financials',
   'Registrar/transfer agents and credit rating agencies — service-fee oligopolies'),
  ('bfsi_broker',     'Brokers',               'financials',
   'Stock-broking firms — cyclical, transaction-driven revenue')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      meta_cluster_id = EXCLUDED.meta_cluster_id,
      description = EXCLUDED.description;

-- Rename the legacy cluster so it stays visible in any historical scores that
-- may still reference it, but is clearly marked deprecated. (We don't delete
-- it because app.scores has FK rows pointing to it from older snapshots.)
UPDATE app.cluster
   SET name = 'Capital Markets (deprecated)',
       description = 'Retired — split into bfsi_amc_wealth / bfsi_exchange / bfsi_rta_rating / bfsi_broker'
 WHERE id = 'bfsi_capmarkets';
