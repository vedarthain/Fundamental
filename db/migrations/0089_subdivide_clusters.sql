-- Subdivide oversized clusters into institutional peer clusters.
--
-- Background:
--   cap_goods_industrial (411 stocks), consumer_durables (193 stocks),
--   textiles (178 stocks), and services_commercial (129 stocks) lumped wildly
--   different unit economics together (e.g. Jewellery vs ACs; Cables vs Heavy Machinery;
--   Commodity Yarn vs Branded Apparel; IT BPO vs Security Guards).
--
-- This migration adds the specialized clusters and retires legacy catch-alls.
-- Stock-to-cluster assignment is rule-driven in clusters/rules.py, and scorecards
-- live in scoring/scorecards.py — both are updated alongside this migration.
--
-- After deploying, run:
--   etl/.venv/bin/python -m fundamental_etl.scoring.seed_scorecards --force
--   etl/.venv/bin/python -m fundamental_etl.cli assign-clusters
--   etl/.venv/bin/python -m fundamental_etl.cli score

SET search_path = app, public;

INSERT INTO app.cluster (id, name, meta_cluster_id, description) VALUES
  -- Industrials subdivisions
  ('cap_goods_machinery_equipment', 'Machinery & Heavy Equipment',       'industrials',
   'Heavy industrial machinery, engines, turbines, compressors, pumps & machine tools'),
  ('cap_goods_pipes_building',      'Pipes & Structural Tubes',          'industrials',
   'Pipes, fittings, ductile iron & structural steel/plastic tubes'),
  ('cap_goods_precision_eng',       'Precision Bearings & Castings',     'industrials',
   'High-precision bearings, abrasives, grinding media & engineered castings/forgings'),
  ('cap_goods_ems',                 'EMS & Advanced Electronics',        'industrials',
   'Turnkey electronics manufacturing services, contract manufacturing & advanced electronic assemblies'),
  ('packaging_containers',          'Packaging & Containers',            'industrials',
   'Industrial drums, pails, bottles, flexible packaging, cartons & specialty films'),
  ('services_staffing_facilities',  'Staffing, Security & Facilities',   'industrials',
   'Workforce staffing, security services, cash management & integrated facility management'),

  -- Consumer subdivisions
  ('consumer_appliances',           'Consumer Appliances & Electronics', 'consumer',
   'Consumer electronics, HVAC, air conditioning, refrigeration & home appliances'),
  ('consumer_jewellery',            'Jewellery & Gems',                  'consumer',
   'Gold, diamond, precious jewelry & gem retailing'),
  ('consumer_footwear',             'Footwear & Athleisure',             'consumer',
   'Footwear, athleisure & fashion footwear retailing'),
  ('consumer_building_home',        'Home Improvement, Paints & Tiles',  'consumer',
   'Paints, coatings, ceramics, tiles, sanitaryware & interior wood panels/laminates'),

  -- Materials subdivisions
  ('textiles_apparel_retail',       'Apparel & Garment Exports',         'materials',
   'Branded retail apparel, innerwear, fashion garments & readymade garment exports'),
  ('textiles_spinning_yarn',        'Spinning Mills & Commodity Textiles', 'materials',
   'Cotton spinning, yarn mills, synthetic filaments & commodity home textiles')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      meta_cluster_id = EXCLUDED.meta_cluster_id,
      description = EXCLUDED.description;

-- Deprecate legacy lumped clusters so historical scores snapshots remain FK-valid
UPDATE app.cluster
   SET name = 'Industrial Products & Manufacturing (deprecated)',
       description = 'Retired — split into cap_goods_machinery_equipment / cap_goods_pipes_building / cap_goods_precision_eng / cap_goods_ems / packaging_containers'
 WHERE id = 'cap_goods_industrial';

UPDATE app.cluster
   SET name = 'Consumer Durables (deprecated)',
       description = 'Retired — split into consumer_appliances / consumer_jewellery / consumer_footwear / consumer_building_home'
 WHERE id = 'consumer_durables';

UPDATE app.cluster
   SET name = 'Textiles (deprecated)',
       description = 'Retired — split into textiles_apparel_retail / textiles_spinning_yarn'
 WHERE id = 'textiles';

UPDATE app.cluster
   SET name = 'Commercial Services (deprecated)',
       description = 'Retired — split into services_staffing_facilities / it_services_midsmall / realty'
 WHERE id = 'services_commercial';
