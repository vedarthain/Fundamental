/**
 * graphUniverse.ts — the sector → industry → stock tree for the Graph tab's
 * left nav. Built ONCE server-side from the latest scoring panel snapshot; it's
 * only symbols + names + composite (a few thousand small rows), so it ships with
 * the page. The heavy per-chart OHLCV is fetched lazily, 4 symbols at a time.
 *
 *   sector   = meta_cluster.name  (9 broad groupings)
 *   industry = cluster.name       (~49 scoring peer clusters)
 *
 * Stocks are ordered composite-desc within each industry so the strongest names
 * surface on the first page of charts (browsing 4 at a time).
 */
import { sql } from "@/lib/db";

export type GraphStock = {
  symbol: string;
  name: string | null;
  composite_pct: number | null;
};
export type GraphIndustry = {
  id: string;
  name: string;
  stocks: GraphStock[];
};
export type GraphSector = {
  name: string;
  count: number; // total stocks in the sector
  industries: GraphIndustry[];
};
export type GraphUniverse = {
  snapDate: string | null;
  sectors: GraphSector[];
};

type Row = {
  sector: string | null;
  industry_id: string;
  industry: string | null;
  symbol: string;
  name: string | null;
  composite_pct: number | null;
};

export async function loadGraphUniverse(): Promise<GraphUniverse> {
  const empty: GraphUniverse = { snapDate: null, sectors: [] };

  let snapDate: string | null;
  try {
    const d = await sql<{ d: string | null }[]>`
      SELECT max(snapshot_date)::text AS d FROM app.cluster_stocks_panel_cache
    `;
    snapDate = d[0]?.d ?? null;
  } catch {
    return empty;
  }
  if (!snapDate) return empty;

  let rows: Row[];
  try {
    rows = await sql<Row[]>`
      SELECT mc.name AS sector,
             c.id::text AS industry_id,
             c.name  AS industry,
             p.symbol,
             u.company_name AS name,
             p.composite_pct::float8 AS composite_pct
        FROM app.cluster_stocks_panel_cache p
        JOIN app.cluster c        ON c.id = p.cluster_id
        JOIN app.meta_cluster mc  ON mc.id = c.meta_cluster_id
        LEFT JOIN app.universe u  ON u.symbol = p.symbol
       WHERE p.snapshot_date = ${snapDate}::date
       ORDER BY mc.name ASC,
                c.name ASC,
                p.composite_pct DESC NULLS LAST,
                p.symbol ASC
    `;
  } catch {
    return empty;
  }

  // Nest rows → sectors[industries[stocks]]. Input is already ordered, so we
  // just group in a single pass keeping that order.
  const sectorMap = new Map<string, GraphSector>();
  const industryMap = new Map<string, GraphIndustry>(); // key: industry_id

  for (const r of rows) {
    const sName = (r.sector || "—").trim() || "—";
    let sector = sectorMap.get(sName);
    if (!sector) {
      sector = { name: sName, count: 0, industries: [] };
      sectorMap.set(sName, sector);
    }
    let industry = industryMap.get(r.industry_id);
    if (!industry) {
      industry = { id: r.industry_id, name: (r.industry || "—").trim() || "—", stocks: [] };
      industryMap.set(r.industry_id, industry);
      sector.industries.push(industry);
    }
    industry.stocks.push({ symbol: r.symbol, name: r.name, composite_pct: r.composite_pct });
    sector.count += 1;
  }

  // Sort sectors by stock count desc (biggest sectors first), a sensible
  // browsing order; industries keep their alphabetical order from SQL.
  const sectors = Array.from(sectorMap.values()).sort((a, b) => b.count - a.count);
  return { snapDate, sectors };
}
