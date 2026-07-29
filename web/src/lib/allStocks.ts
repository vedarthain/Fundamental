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
  composite_rank: number | null; // 1 = best composite in the scored universe
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
// names whose split adjustment is internally inconsistent — the N-ago adj_close
// sits on a different scale than today's, implying impossible moves (TVSMOTOR
// read +3358% for 1Y). That's an upstream golden defect the ETL guard (_RET_CAP
// in cli.py) also filters; mirror it here so the live All-stocks table never
// renders one bad vendor bar as a headline return. Caps sit well above any real
// move over the window (India's daily circuit is ±20%), so a genuine multi-
// bagger still shows; only data errors collapse to "—".
const PCT_CAP: Record<"1d" | "1w" | "1m" | "1y", number> = {
  "1d": 60,
  "1w": 200,
  "1m": 300,
  "1y": 500,
};

function pctChange(
  last: number | undefined,
  base: number | undefined,
  window: "1d" | "1w" | "1m" | "1y",
): number | null {
  if (last == null || base == null || base === 0) return null;
  const pct = Math.round((last / base - 1) * 1000) / 10;
  if (Math.abs(pct) > PCT_CAP[window]) return null;
  return pct;
}

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

  try {
    const [last2, w, m, y] = await Promise.all([
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
    ]);
    for (const r of last2) {
      const k = bare(r.symbol);
      if (Number(r.rn) === 1) last.set(k, Number(r.c));
      else prev.set(k, Number(r.c));
    }
    for (const r of w) wAgo.set(bare(r.symbol), Number(r.c));
    for (const r of m) mAgo.set(bare(r.symbol), Number(r.c));
    for (const r of y) yAgo.set(bare(r.symbol), Number(r.c));
  } catch {
    // Non-fatal: returns render as "—", table still lists the universe.
  }

  // Absolute composite rank across the whole scored universe (1 = best), so a
  // stock's "#" is a fixed market standing that doesn't shift with the table's
  // sort/filter or the NIFTY-500 toggle. Unscored names get no rank. Ties break
  // by symbol so the ordinal is deterministic snapshot to snapshot.
  const rankOf = new Map<string, number>();
  panel
    .filter((p) => p.composite_pct != null)
    .sort((a, b) => (b.composite_pct as number) - (a.composite_pct as number) || a.symbol.localeCompare(b.symbol))
    .forEach((p, i) => rankOf.set(p.symbol, i + 1));

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
      composite_pct: p.composite_pct == null ? null : Math.round(p.composite_pct),
      composite_rank: rankOf.get(p.symbol) ?? null,
      is_n500: p.is_n500,
    };
  });

  return { snapDate, rows };
}
