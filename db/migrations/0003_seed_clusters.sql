-- Seed the cluster taxonomy from docs/sector-clusters.md.
-- 8 meta-clusters, 41 peer clusters, plus an explicit 'unclassified' fallback.

SET search_path = app, public;

INSERT INTO app.meta_cluster (id, name, display_order) VALUES
  ('financials',          'Financials',          1),
  ('tech',                'Tech & Communication',2),
  ('healthcare',          'Healthcare',          3),
  ('consumer',            'Consumer',            4),
  ('industrials',         'Industrials',         5),
  ('materials',           'Materials',           6),
  ('real_estate_infra',   'Real Estate & Infra', 7),
  ('energy_utilities',    'Energy & Utilities',  8),
  ('diversified_meta',    'Diversified',         9)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, display_order = EXCLUDED.display_order;

INSERT INTO app.cluster (id, name, meta_cluster_id, description) VALUES
  -- Financials
  ('bfsi_psu_banks',             'PSU Banks',                          'financials',        'State-owned commercial banks'),
  ('bfsi_pvt_banks',             'Private Banks',                      'financials',        'Private-sector commercial banks'),
  ('bfsi_nbfc',                  'NBFCs / Lenders',                    'financials',        'Non-banking finance companies'),
  ('bfsi_insurance',             'Insurance',                          'financials',        'Life and general insurance'),
  ('bfsi_capmarkets',            'Capital Markets, Brokers, AMCs',     'financials',        'Asset managers, broking, exchanges'),
  ('bfsi_fintech',               'Fintech',                            'financials',        'Digital-first financial services'),

  -- Tech
  ('it_services_large',          'IT Services — Large Cap',            'tech',              'Top tier IT services exporters'),
  ('it_services_midsmall',       'IT Services — Mid/Small',            'tech',              'Mid and small IT services'),
  ('it_hardware',                'IT Hardware',                        'tech',              'Hardware, peripherals, IT products'),
  ('telecom',                    'Telecom',                            'tech',              'Telecom services and equipment'),

  -- Healthcare
  ('pharma',                     'Pharmaceuticals',                    'healthcare',        'Pharma manufacturers and biotech'),
  ('health_services',            'Hospitals & Diagnostics',            'healthcare',        'Hospital chains and diagnostic labs'),
  ('medtech',                    'MedTech',                            'healthcare',        'Medical equipment & supplies'),

  -- Consumer
  ('fmcg_food_agri',             'Packaged Food & Agri',               'consumer',          'Food, agri, edible oils'),
  ('fmcg_personal',              'Personal Care & Household',          'consumer',          'Soaps, cosmetics, home care'),
  ('fmcg_beverages',             'Beverages',                          'consumer',          'Soft drinks, juices, alcohol'),
  ('fmcg_diversified',           'Diversified FMCG (incl. Tobacco)',   'consumer',          'Multi-segment FMCG conglomerates'),
  ('consumer_durables',          'Consumer Durables',                  'consumer',          'Appliances, electronics, jewellery'),
  ('retail',                     'Retail',                             'consumer',          'Department stores, specialty retail'),
  ('leisure_hospitality',        'Leisure & Hospitality',              'consumer',          'Hotels, restaurants, travel, entertainment'),
  ('media_entertainment',        'Media & Entertainment',              'consumer',          'Broadcasters, content producers, publishers'),

  -- Industrials
  ('cap_goods_industrial',       'Industrial Products & Manufacturing','industrials',       'Bearings, pumps, forgings, general industrials'),
  ('cap_goods_electrical',       'Electrical Equipment',               'industrials',       'Transformers, switchgear, cables'),
  ('defense_aero',               'Defense & Aerospace',                'industrials',       'Defense and aerospace'),
  ('auto_oem',                   'Auto OEMs',                          'industrials',       '2W/PV/CV/tractor manufacturers'),
  ('auto_components',            'Auto Components',                    'industrials',       'Tier-1/2/3 auto parts'),
  ('services_commercial',        'Commercial Services',                'industrials',       'Staffing, facilities, business services'),
  ('transport_logistics',        'Transport & Logistics',              'industrials',       'Logistics, ports, shipping, airlines'),

  -- Materials
  ('chemicals_specialty',        'Specialty Chemicals',                'materials',         'Specialty and petrochemicals'),
  ('chemicals_agro',             'Agrochemicals & Fertilizers',        'materials',         'Crop protection and fertilizers'),
  ('metals_ferrous',             'Ferrous Metals',                     'materials',         'Steel, iron, ferrous alloys'),
  ('metals_nonferrous_mining',   'Non-Ferrous & Mining',               'materials',         'Aluminium, copper, zinc, mining, trading'),
  ('cement',                     'Cement',                             'materials',         'Cement and cement products'),
  ('paper_forest',               'Paper & Forest Products',            'materials',         'Paper, pulp, wood products'),
  ('textiles',                   'Textiles',                           'materials',         'Fabrics, apparel, yarn'),

  -- Real Estate & Infra
  ('realty',                     'Realty Developers',                  'real_estate_infra', 'Residential, commercial property developers'),
  ('construction',               'Construction & EPC',                 'real_estate_infra', 'EPC contractors, infra developers'),

  -- Energy & Utilities
  ('oil_refining',               'Oil & Refining',                     'energy_utilities',  'Refining, exploration, fuels'),
  ('gas_distribution',           'Gas Distribution',                   'energy_utilities',  'CGD, LPG, industrial gas'),
  ('power',                      'Power Generation & Utilities',       'energy_utilities',  'Generators, T&D, other utilities'),

  -- Diversified
  ('diversified',                'Diversified Conglomerates',          'diversified_meta',  'Multi-segment holding companies'),

  -- Fallback
  ('unclassified',               'Unclassified',                       'diversified_meta',  'Stocks awaiting manual cluster assignment')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  meta_cluster_id = EXCLUDED.meta_cluster_id,
  description = EXCLUDED.description;
