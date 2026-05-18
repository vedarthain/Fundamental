-- Split bfsi_pvt_banks into 3 peer-distinct clusters.
--
-- The legacy bfsi_pvt_banks lumped 29 stocks together across a 1,190x range
-- of market cap (HDFCBANK ₹11.8L Cr down to FINOPB ₹992 Cr) and three
-- fundamentally different business models:
--   - Top private banks (universal franchise, premium ROE on large bases)
--   - Mid/small private banks (regional, cheaper multiples justified by risk)
--   - Small Finance Banks (microfinance-heavy book, recovering from cycle lows)
--
-- Comparing HDFC Bank against an SFB on the same scorecard produced peer
-- percentiles that flattered SFBs (recent inflection metrics) and penalized
-- HDFC (compressed by HDFC Ltd merger digestion). Splitting into three
-- clusters puts each business model in its own peer pool.
--
-- After deploying, run:
--   etl/.venv/bin/python -m fundamental_etl assign-clusters
--   etl/.venv/bin/python -m fundamental_etl.scoring.seed_scorecards --force
--   etl/.venv/bin/python -m fundamental_etl compute-metrics --snapshot YYYY-MM-DD
--   etl/.venv/bin/python -m fundamental_etl score --snapshot YYYY-MM-DD

SET search_path = app, public;

INSERT INTO app.cluster (id, name, meta_cluster_id, description) VALUES
  ('bfsi_pvt_banks_large',     'Private Banks — Large Cap', 'financials',
   'Top private banks (HDFC, ICICI, Axis, Kotak class) — universal franchise, large-cap'),
  ('bfsi_pvt_banks_mid_small', 'Private Banks — Mid/Small', 'financials',
   'Mid and small private banks — regional or niche franchises'),
  ('bfsi_sfb',                 'Small Finance Banks',       'financials',
   'Small Finance Banks and Payments Banks — microfinance-heavy, recovering economics')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      meta_cluster_id = EXCLUDED.meta_cluster_id,
      description = EXCLUDED.description;

-- Mark the legacy cluster deprecated. We don't delete (FK references in
-- historical app.scores rows) — but it stays visibly retired.
UPDATE app.cluster
   SET name = 'Private Banks (deprecated)',
       description = 'Retired — split into bfsi_pvt_banks_large / bfsi_pvt_banks_mid_small / bfsi_sfb'
 WHERE id = 'bfsi_pvt_banks';
