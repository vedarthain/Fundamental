/**
 * allStocks.ts — the full scored universe with multi-window performance, for
 * the Scanner's "All stocks" tab (a sortable, paginated reference table).
 *
 * Two round-trips, run in parallel by the caller:
 *   • app.cluster_stocks_panel_cache (latest snapshot) → identity, sector,
 *     peer group, composite score, and the 1W / 1M / 1Y returns (stored as
 *     FRACTIONS in the panel; scaled to percent here).
 *   • golden.price_history_1d (last two closes per symbol) → the 1D return,
 *     which the panel doesn't carry. Restricted to the last ~2 weeks so the
 *     window scan stays cheap.
 *
 *   sector    = meta_cluster.name  (broad grouping)
 *   peerGroup = cluster.name       (the scoring peer cluster)
 */

import { sql, golden } from "@/lib/db";

export type AllStockRow = {
  symbol: string;
  company_name: string | null;
  sector: string | null; // meta_cluster.name
  peer_group: string | null; // cluster.name
  current_price: number | null;
  ret_1d: number | null; // percent
  ret_1w: number | null; // percent
  ret_1m: number | null; // percent
  ret_1y: number | null; // percent
  composite_pct: number | null;
  is_n500: boolean;
};

export type AllStocksData = {
  snapDate: string | null;
  rows: AllStockRow[];
};

type PanelRow = {
  symbol: string;
  company_name: string | null;
  sector: string | null;
  peer_group: string | null;
  current_price: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
  composite_pct: number | null;
  is_n500: boolean;
};

export async function loadAllStocks(): Promise<AllStocksData> {
  const empty: AllStocksData = { snapDate: null, rows: [] };

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

  let panel: PanelRow[];
  try {
    panel = await sql<PanelRow[]>`
      SELECT p.symbol,
             u.company_name,
             mc.name AS sector,
             c.name  AS peer_group,
             p.current_price::float8 AS current_price,
             -- ret_* are stored as FRACTIONS (0.09 = +9%); scale to percent.
             (p.ret_1w::float8 * 100) AS ret_1w,
             (p.ret_1m::float8 * 100) AS ret_1m,
             (p.ret_1y::float8 * 100) AS ret_1y,
             p.composite_pct::float8 AS composite_pct,
             (ic.symbol IS NOT NULL) AS is_n500
        FROM app.cluster_stocks_panel_cache p
        LEFT JOIN app.universe u       ON u.symbol = p.symbol
        LEFT JOIN app.cluster c        ON c.id = p.cluster_id
        LEFT JOIN app.meta_cluster mc  ON mc.id = c.meta_cluster_id
        LEFT JOIN app.index_constituent ic
               ON ic.symbol = p.symbol AND ic.index_code = 'NIFTY500'
       WHERE p.snapshot_date = ${snapDate}::date
    `;
  } catch {
    return empty;
  }

  // 1D return from golden — last two daily closes per symbol. One windowed
  // query over the last ~2 weeks (covers long weekends / holidays).
  const gLast = new Map<string, number>();
  const gPrev = new Map<string, number>();
  try {
    const gp = await golden<{ symbol: string; close: string; rn: string }[]>`
      SELECT symbol, close::text AS close, rn FROM (
        SELECT symbol, close,
               row_number() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
        FROM golden.price_history_1d
        WHERE close IS NOT NULL AND date >= CURRENT_DATE - 16
      ) t WHERE rn <= 2
    `;
    for (const g of gp) {
      const bare = g.symbol.endsWith(".NS") ? g.symbol.slice(0, -3) : g.symbol;
      if (Number(g.rn) === 1) gLast.set(bare, Number(g.close));
      else gPrev.set(bare, Number(g.close));
    }
  } catch {
    // Non-fatal: table renders with 1D as "—".
  }

  const rows: AllStockRow[] = panel.map((p) => {
    const last = gLast.get(p.symbol);
    const prev = gPrev.get(p.symbol);
    const ret1d =
      last != null && prev != null && prev !== 0
        ? Math.round((last / prev - 1) * 1000) / 10
        : null;
    const price = last ?? p.current_price ?? null;
    return {
      symbol: p.symbol,
      company_name: p.company_name,
      sector: p.sector,
      peer_group: p.peer_group,
      current_price: price == null ? null : Math.round(price * 100) / 100,
      ret_1d: ret1d,
      ret_1w: p.ret_1w == null ? null : Math.round(p.ret_1w * 10) / 10,
      ret_1m: p.ret_1m == null ? null : Math.round(p.ret_1m * 10) / 10,
      ret_1y: p.ret_1y == null ? null : Math.round(p.ret_1y * 10) / 10,
      composite_pct: p.composite_pct == null ? null : Math.round(p.composite_pct),
      is_n500: p.is_n500,
    };
  });

  return { snapDate, rows };
}
