-- Subdivide the remaining 11 large clusters (>100 stocks) into institutional peer cohorts.
--
-- Clusters subdivided:
--   1. bfsi_nbfc (173 stocks) -> bfsi_housing_finance, bfsi_gold_microfinance, bfsi_nbfc
--   2. pharma (152 stocks) -> pharma_cdmo_apis, pharma
--   3. it_services_midsmall (165 stocks) -> it_erd_engineering, it_software_products_saas, it_services_midsmall
--   4. fmcg_food_agri (164 stocks) -> agri_sugar_biofuels, fmcg_packaged_foods, fmcg_food_agri
--   5. cap_goods_electrical (141 stocks) -> electrical_wires_cables, electrical_transformers_grid, cap_goods_electrical
--   6. leisure_hospitality (106 stocks) -> hospitality_hotels, education_training_services, leisure_hospitality
--   7. auto_components (130 stocks) -> auto_tyres_rubber, auto_components
--   8. construction (126 stocks) -> construction_railways_infra, construction
--   9. realty (109 stocks) -> realty_commercial_coworking, realty
--  10. chemicals_specialty (166 stocks) -> chemicals_dyes_pigments, chemicals_specialty
--  11. services_staffing_facilities (104 stocks) -> services_hr_staffing, services_staffing_facilities

SET search_path = app, public;

INSERT INTO app.cluster (id, name, meta_cluster_id, description) VALUES
  -- Financials subdivisions
  ('bfsi_housing_finance',          'Housing Finance',                   'financials',
   'Housing finance companies (HFCs), retail mortgage originators & affordable home lending'),
  ('bfsi_gold_microfinance',        'Gold Loan & Microfinance',          'financials',
   'Gold loan financiers, microfinance institutions (MFIs) & high-yield rural lenders'),

  -- Healthcare subdivisions
  ('pharma_cdmo_apis',              'Pharma CDMO, CRAMS & APIs',         'healthcare',
   'Contract development & manufacturing (CDMO), custom research synthesis & bulk active pharmaceutical ingredients'),

  -- Tech subdivisions
  ('it_erd_engineering',            'Engineering R&D & Embedded Systems','tech',
   'Automotive/aerospace ER&D, digital product engineering, IoT & embedded software systems'),
  ('it_software_products_saas',     'Software Products & SaaS Platforms','tech',
   'Enterprise cloud software products, vertical SaaS platforms, fintech solutions & digital platforms'),

  -- Consumer / Food & Agri subdivisions
  ('agri_sugar_biofuels',           'Sugar & Biofuels',                  'consumer',
   'Integrated sugarcane milling, ethanol blending, distilleries & co-generation power'),
  ('fmcg_packaged_foods',           'Packaged Foods & Dairy',            'consumer',
   'Branded packaged foods, snacks, biscuits, confectionery, dairy & value-added foods'),

  -- Industrials subdivisions
  ('electrical_wires_cables',       'Wires & Cables',                    'industrials',
   'Building wires, power distribution cables, optical fiber cables & metal conductors'),
  ('electrical_transformers_grid',  'Transformers & Power Grid',         'industrials',
   'Power & distribution transformers, high-voltage switchyards, substations & grid equipment'),
  ('auto_tyres_rubber',             'Tyres & Rubber Products',           'industrials',
   'Automotive tyres, tubes, conveyor belts, treads & engineered rubber products'),
  ('services_hr_staffing',          'Staffing, Security & Cash Logistics','industrials',
   'Workforce staffing, HR solutions, manned guarding, facility security & cash transit logistics'),

  -- Leisure / Consumer services subdivisions
  ('hospitality_hotels',            'Hotels & Resorts',                  'consumer',
   'Hotels, luxury resorts, boutique palaces, leisure lodging & serviced apartments'),
  ('education_training_services',   'Education & EdTech',                'consumer',
   'K-12 schools, higher education institutions, test prep, skill training & EdTech platforms'),

  -- Real Estate & Infra subdivisions
  ('construction_railways_infra',   'Railways & Transport Infra EPC',    'real_estate_infra',
   'Railway civil works, track laying, electrification, metro rail systems & rolling stock infrastructure EPC'),
  ('realty_commercial_coworking',   'Commercial Real Estate & Coworking','real_estate_infra',
   'Managed flexible workspaces, coworking spaces, commercial IT parks & retail mall REITs'),

  -- Materials subdivisions
  ('chemicals_dyes_pigments',       'Dyes, Pigments & Colorants',        'materials',
   'Reactive dyes, organic pigments, food colors, masterbatches & synthetic dye intermediates')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      meta_cluster_id = EXCLUDED.meta_cluster_id,
      description = EXCLUDED.description;

-- Refine display names and descriptions of partitioned clusters for crystal clarity
UPDATE app.cluster
   SET name = 'NBFCs — Diversified & Retail',
       description = 'Diversified retail NBFCs, vehicle financiers, MSME lenders & consumer credit'
 WHERE id = 'bfsi_nbfc';

UPDATE app.cluster
   SET name = 'Pharma — Formulations & Generics',
       description = 'Domestic branded formulations, acute/chronic therapies & international generic pharmaceuticals'
 WHERE id = 'pharma';

UPDATE app.cluster
   SET name = 'IT Services & Consulting',
       description = 'IT services, cloud migration, enterprise consulting, system integration & digital transformation'
 WHERE id = 'it_services_midsmall';

UPDATE app.cluster
   SET name = 'Agri Commodities & Edible Oils',
       description = 'Agricultural commodity trading, edible oil crushing & refining, animal feeds & grains'
 WHERE id = 'fmcg_food_agri';

UPDATE app.cluster
   SET name = 'Electrical Equipment & Switchgear',
       description = 'Industrial motors, switchgear, control panels, power automation & lighting equipment'
 WHERE id = 'cap_goods_electrical';

UPDATE app.cluster
   SET name = 'Dining, QSR & Entertainment',
       description = 'Quick service restaurants, casual dining, theme parks, ticketing & travel platforms'
 WHERE id = 'leisure_hospitality';

UPDATE app.cluster
   SET name = 'Auto Components (Powertrain & Body)',
       description = 'Engine components, transmission, chassis, suspension, lighting, braking & precision automotive forgings/castings'
 WHERE id = 'auto_components';

UPDATE app.cluster
   SET name = 'Civil Infrastructure & Construction EPC',
       description = 'Roads, highways, bridges, urban civil works, irrigation & industrial EPC'
 WHERE id = 'construction';

UPDATE app.cluster
   SET name = 'Residential Real Estate Developers',
       description = 'Residential real estate developers, integrated townships & plotted housing developments'
 WHERE id = 'realty';

UPDATE app.cluster
   SET name = 'Specialty & Performance Chemicals',
       description = 'Fluorochemicals, advanced specialty intermediates, polymer additives & performance chemicals'
 WHERE id = 'chemicals_specialty';

UPDATE app.cluster
   SET name = 'Commercial B2B Services & Supplies',
       description = 'Commercial trading, industrial distribution, office supplies, testing/inspection & technical services'
 WHERE id = 'services_staffing_facilities';
