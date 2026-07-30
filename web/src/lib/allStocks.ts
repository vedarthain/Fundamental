/**
 * allStocks.ts — the full scored universe with multi-window performance, for
 * the Scanner's "All stocks" tab (a sortable, paginated reference table).
 *
 * Identity (sector, peer group, score, NIFTY-500 membership) comes from the
 * latest scoring panel snapshot. The RETURNS, however, are computed from
 * golden's SPLIT/BONUS-ADJUSTED close (`adj_close`), NOT the panel's cached
 * ret_* columns — those store an unadjusted 1y-ago basis for names with a
 * corporate action, which blows the 1Y return up (e.g. ANGELONE showed
 * +1119% off an unadjusted ~₹25 base instead of +20% off the real ~₹256).
 * Using adj_close makes this table agree with the stock-page price chart,
 * which is also adj_close-based.
 *
 *   sector    = meta_cluster.name  (broad grouping)
 *   peerGroup = cluster.name       (the scoring peer cluster)
 */

import { sql, golden } from "@/lib/db";
import { guardedPctChange } from "@/lib/returnGuards";

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
  ret_3y: number | null; // percent
  composite_pct: number | null;
  industry_rank: number | null; // 1 = best composite within the stock's peer group
  industry_count: number | null; // scored peers in that group (the "of N")
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
  cache_price: number | null;
  composite_pct: number | null;
  is_n500: boolean;
};

/** Strip the NSE ".NS" suffix golden uses so keys match the bare panel symbol. */
function bare(sym: string): string {
  return sym.endsWith(".NS") ? sym.slice(0, -3) : sym;
}

// Per-window plausibility caps (in PERCENT). golden's price_history has a few
// Return plausibility caps + the pctChange guard now live in one shared module
// (returnGuards) so the scanner and the stock-page price chart apply the exact
// same rule — which is also what keeps the two surfaces' returns consistent.
const pctChange = guardedPctChange;

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
             p.current_price::float8 AS cache_price,
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

  // ── Returns from golden's ADJUSTED close (matches the price chart) ──
  // last + prev (for 1D) from a small 2-row window; then the nearest close
  // on/before ~1W / ~1M / ~1Y ago via DISTINCT ON over bounded date windows.
  const last = new Map<string, number>();
  const prev = new Map<string, number>();
  const wAgo = new Map<string, number>();
  const mAgo = new Map<string, number>();
  const yAgo = new Map<string, number>();
  const y3Ago = new Map<string, number>();

  try {
    const [last2, w, m, y, y3] = await Promise.all([
      golden<{ symbol: string; c: string; rn: string }[]>`
        SELECT symbol, c, rn FROM (
          SELECT symbol, COALESCE(adj_close, close)::text AS c,
                 row_number() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
          FROM golden.price_history
          WHERE interval = '1d' AND COALESCE(adj_close, close) IS NOT NULL
            AND date >= CURRENT_DATE - 16
        ) t WHERE rn <= 2
      `,
      golden<{ symbol: string; c: string }[]>`
        SELECT DISTINCT ON (symbol) symbol, COALESCE(adj_close, close)::text AS c
        FROM golden.price_history
        WHERE interval = '1d' AND COALESCE(adj_close, close) IS NOT NULL
          AND date <= CURRENT_DATE - 7 AND date >= CURRENT_DATE - 24
        ORDER BY symbol, date DESC
      `,
      golden<{ symbol: string; c: string }[]>`
        SELECT DISTINCT ON (symbol) symbol, COALESCE(adj_close, close)::text AS c
        FROM golden.price_history
        WHERE interval = '1d' AND COALESCE(adj_close, close) IS NOT NULL
          AND date <= CURRENT_DATE - 30 AND date >= CURRENT_DATE - 60
        ORDER BY symbol, date DESC
      `,
      golden<{ symbol: string; c: string }[]>`
        SELECT DISTINCT ON (symbol) symbol, COALESCE(adj_close, close)::text AS c
        FROM golden.price_history
        WHERE interval = '1d' AND COALESCE(adj_close, close) IS NOT NULL
          AND date <= CURRENT_DATE - 365 AND date >= CURRENT_DATE - 400
        ORDER BY symbol, date DESC
      `,
      golden<{ symbol: string; c: string }[]>`
        SELECT DISTINCT ON (symbol) symbol, COALESCE(adj_close, close)::text AS c
        FROM golden.price_history
        WHERE interval = '1d' AND COALESCE(adj_close, close) IS NOT NULL
          AND date <= CURRENT_DATE - 1095 AND date >= CURRENT_DATE - 1200
        ORDER BY symbol, date DESC
      `,
    ]);
    for (const r of last2) {
      const k = bare(r.symbol);
      if (Number(r.rn) === 1) last.set(k, Number(r.c));
      else prev.set(k, Number(r.c));
    }
    for (const r of w) wAgo.set(bare(r.symbol), Number(r.c));
    for (const r of m) mAgo.set(bare(r.symbol), Number(r.c));
    for (const r of y) yAgo.set(bare(r.symbol), Number(r.c));
    for (const r of y3) y3Ago.set(bare(r.symbol), Number(r.c));
  } catch {
    // Non-fatal: returns render as "—", table still lists the universe.
  }

  // Industry rank: a stock's composite standing WITHIN its own peer group
  // (cluster), which is the population the score is actually measured against —
  // "#26 of 44 in Media & Entertainment" is far more meaningful than a #1220
  // absolute-universe ordinal. Group by peer_group, sort by composite desc, ties
  // break by symbol for determinism. Names with no peer group or no score get no
  // rank. `industry_count` is the scored-peer denominator for the "of N".
  const rankOf = new Map<string, number>();
  const countOf = new Map<string, number>();
  const byGroup = new Map<string, PanelRow[]>();
  for (const p of panel) {
    if (p.composite_pct == null || !p.peer_group) continue;
    let g = byGroup.get(p.peer_group);
    if (!g) byGroup.set(p.peer_group, (g = []));
    g.push(p);
  }
  for (const group of byGroup.values()) {
    group.sort((a, b) => (b.composite_pct as number) - (a.composite_pct as number) || a.symbol.localeCompare(b.symbol));
    group.forEach((p, i) => {
      rankOf.set(p.symbol, i + 1);
      countOf.set(p.symbol, group.length);
    });
  }

  const rows: AllStockRow[] = panel.map((p) => {
    const lastPx = last.get(p.symbol);
    const price = lastPx ?? p.cache_price ?? null;
    return {
      symbol: p.symbol,
      company_name: p.company_name,
      sector: p.sector,
      peer_group: p.peer_group,
      current_price: price == null ? null : Math.round(price * 100) / 100,
      ret_1d: pctChange(lastPx, prev.get(p.symbol), "1d"),
      ret_1w: pctChange(lastPx, wAgo.get(p.symbol), "1w"),
      ret_1m: pctChange(lastPx, mAgo.get(p.symbol), "1m"),
      ret_1y: pctChange(lastPx, yAgo.get(p.symbol), "1y"),
      ret_3y: pctChange(lastPx, y3Ago.get(p.symbol), "3y"),
      composite_pct: p.composite_pct == null ? null : Math.round(p.composite_pct),
      industry_rank: rankOf.get(p.symbol) ?? null,
      industry_count: countOf.get(p.symbol) ?? null,
      is_n500: p.is_n500,
    };
  });

  return { snapDate, rows };
}
