-- Migration 0091: Add Holding Companies & Core Investment Companies (CICs) and Industrial Pumps & Valves
-- Carves out non-lending holding vehicles from bfsi_nbfc and fluid-handling pump/valve manufacturers from machinery.

SET search_path = app, public;

INSERT INTO app.cluster (id, name, meta_cluster_id, description) VALUES
  ('bfsi_holding_companies', 'Holding Companies & CICs', 'financials',
   'Core investment companies (CICs), promoter holding companies & equity investment vehicles'),
  ('cap_goods_pumps_valves', 'Industrial Pumps, Valves & Compressors', 'industrials',
   'Industrial fluid handling systems, submersible pumps, solar agricultural pumps, valves & air compressors')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      meta_cluster_id = EXCLUDED.meta_cluster_id,
      description = EXCLUDED.description;
