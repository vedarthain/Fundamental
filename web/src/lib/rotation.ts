/**
 * rotation.ts — sector & peer-group "rotation" aggregates for the Scanner page.
 *
 * The three price scanners (momentum / trend / floor) are bottom-up: they
 * surface individual stocks. This is the top-down complement — it answers
 * "which SECTORS and PEER GROUPS are moving?" by rolling the per-stock scoring
 * panel up to the group level.
 *
 * Source: app.cluster_stocks_panel_cache (the same materialised panel the
 * /sectors page reads) joined to cluster → meta_cluster for names, and to
 * index_constituent for NIFTY 500 membership. One app-DB query, no golden
 * roundtrip. Everything below is a pure JS rollup so we can produce both the
 * full-universe and NIFTY-500-only cuts from a single fetch.
 *
 *   sector    = meta_cluster.name  (broad grouping, ~12)
 *   peerGroup = cluster.name       (the scoring peer cluster, ~46)
 *
 * Ranking metric is median 1-week return (a "today-ish" rotation read that
 * doesn't need an intraday golden query); breadth (% advancers) and median
 * momentum percentile ride alongside so a thin, lopsided group is visible.
 */

import { sql } from "@/lib/db";

export type RotationRow = {
  name: string;
  /** Number of scored names in the group. */
  n: number;
  /** % of names with a positive 1-week return (advancers). */
  breadthPct: number | null;
  medRet1w: number | null;
  medRet1m: number | null;
  /** Median cross-sectional momentum percentile of the group. */
  medMomPct: number | null;
  /** Median composite (fundamental) percentile of the group. */
  medCompPct: number | null;
};

export type RotationData = {
  snapDate: string | null;
  sectorsAll: RotationRow[];
  sectorsN500: RotationRow[];
  peersAll: RotationRow[];
  peersN500: RotationRow[];
};

type PanelRow = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  ret_1w: number | null;
  ret_1m: number | null;
  mom: number | null;
  comp: number | null;
  is_n500: boolean;
};

// Groups with fewer than this many scored names are dropped — a 1- or 2-stock
// "sector" median is noise, not a rotation signal.
const MIN_GROUP = 3;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(x: number | null): number | null {
  return x == null ? null : Math.round(x * 10) / 10;
}

/** Roll a set of panel rows up to group level, keyed by `pick(row)`. */
function rollup(rows: PanelRow[], pick: (r: PanelRow) => string | null): RotationRow[] {
  const groups = new Map<string, PanelRow[]>();
  for (const r of rows) {
    const key = pick(r) || "(unclassified)";
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  const out: RotationRow[] = [];
  for (const [name, g] of groups) {
    if (g.length < MIN_GROUP) continue;
    const ret1w = g.map((r) => r.ret_1w).filter((v): v is number => v != null);
    const ret1m = g.map((r) => r.ret_1m).filter((v): v is number => v != null);
    const mom = g.map((r) => r.mom).filter((v): v is number => v != null);
    const comp = g.map((r) => r.comp).filter((v): v is number => v != null);
    const advancers = ret1w.filter((v) => v > 0).length;
    out.push({
      name,
      n: g.length,
      breadthPct: ret1w.length ? Math.round((advancers / ret1w.length) * 100) : null,
      medRet1w: round1(median(ret1w)),
      medRet1m: round1(median(ret1m)),
      medMomPct: round1(median(mom)),
      medCompPct: round1(median(comp)),
    });
  }
  // Strongest 1-week median first; nulls sink to the bottom.
  out.sort((a, b) => (b.medRet1w ?? -1e9) - (a.medRet1w ?? -1e9));
  return out;
}

export async function loadRotation(): Promise<RotationData> {
  let rows: PanelRow[];
  try {
    rows = await sql<PanelRow[]>`
      SELECT p.symbol,
             mc.name AS sector,
             c.name  AS industry,
             -- ret_1w / ret_1m are stored as FRACTIONS (0.09 = +9%); scale to
             -- percent here so the whole pipeline downstream is in %.
             (p.ret_1w::float8 * 100) AS ret_1w,
             (p.ret_1m::float8 * 100) AS ret_1m,
             p.momentum_pct::float8 AS mom,
             p.composite_pct::float8 AS comp,
             (ic.symbol IS NOT NULL) AS is_n500
        FROM app.cluster_stocks_panel_cache p
        LEFT JOIN app.cluster c       ON c.id = p.cluster_id
        LEFT JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
        LEFT JOIN app.index_constituent ic
               ON ic.symbol = p.symbol AND ic.index_code = 'NIFTY500'
       WHERE p.snapshot_date = (SELECT max(snapshot_date) FROM app.cluster_stocks_panel_cache)
    `;
  } catch {
    return { snapDate: null, sectorsAll: [], sectorsN500: [], peersAll: [], peersN500: [] };
  }

  const snap = await sql<{ d: string | null }[]>`
    SELECT max(snapshot_date)::text AS d FROM app.cluster_stocks_panel_cache
  `;

  const n500 = rows.filter((r) => r.is_n500);
  return {
    snapDate: snap[0]?.d ?? null,
    sectorsAll: rollup(rows, (r) => r.sector),
    sectorsN500: rollup(n500, (r) => r.sector),
    peersAll: rollup(rows, (r) => r.industry),
    peersN500: rollup(n500, (r) => r.industry),
  };
}
