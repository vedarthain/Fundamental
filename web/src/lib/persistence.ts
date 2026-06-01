/**
 * Persistence — multi-snapshot trend helpers shared by /watchlist,
 * /stock/[symbol], and any future surface that needs "is this stock
 * gaining or losing ground in its peer cluster over time?".
 *
 * Single source of truth so the watchlist column and the stock-page
 * trend chart can't drift apart on window size or filter rules.
 *
 * Methodology (intentionally simple — see /feed premortem):
 *   - Window: last 4 snapshots in app.cluster_stocks_panel_cache.
 *   - raw_delta        = composite_pct(latest) − composite_pct(4-back)
 *   - cluster_avg_delta = AVG raw_delta across the same cluster_id
 *   - cluster_adjusted = raw_delta − cluster_avg_delta
 *     (positive = beating peers; this is the signal worth surfacing)
 *
 * If a symbol has fewer than 4 snapshots of history we return null for
 * all deltas — UI shows "—" rather than misleading partial numbers.
 */
import "server-only";
import { sql } from "@/lib/db";

const WINDOW_SNAPSHOTS = 4;

export type PersistencePoint = {
  snapshot_date: string;
  composite_pct: number | null;
  quality_pct:   number | null;
  valuation_pct: number | null;
  momentum_pct:  number | null;
  /** Cluster's AVG composite_pct at this snapshot.  Lets the UI plot
   *  a "peers" line alongside the stock's own line. Null if the cluster
   *  is empty at that snapshot (extremely rare). */
  cluster_composite_avg: number | null;
  /** Number of peers contributing to the cluster average — useful for
   *  showing "vs 11 peers" context, and for the UI to drop the
   *  comparison line when the peer base is tiny. */
  cluster_peer_count: number;
};

export type PersistenceSummary = {
  symbol: string;
  /** Last N snapshots, oldest → newest. May be shorter than WINDOW_SNAPSHOTS
   *  if the stock doesn't have enough history (recent IPO, etc.). */
  series: PersistencePoint[];
  /** Net change in composite_pct over the window. Null if <2 snapshots. */
  raw_delta: number | null;
  /** Cluster-mate average net change over the same window. */
  cluster_avg_delta: number | null;
  /** raw_delta − cluster_avg_delta. Positive = outpacing peers. */
  cluster_adjusted: number | null;
  /** Count of snapshot-to-snapshot transitions where composite_pct
   *  increased. Range 0..(series.length-1). */
  snaps_improving: number;
};

/**
 * Compute persistence summary for ONE symbol.  Used by /stock/[symbol].
 *
 * Two queries:
 *   1. Pull last 4 snapshots for the symbol → series.
 *   2. Pull cluster-average raw_delta for the same cluster_id and window.
 *
 * Total cost: ~2 cheap indexed reads, < 50 ms cold.
 */
export async function loadPersistenceForSymbol(symbol: string): Promise<PersistenceSummary> {
  // Single query — pulls the stock's 4 snapshots AND the cluster's
  // average composite_pct at each of those snapshots, in one go.
  // The LATERAL subquery computes the cluster mean per snapshot_date.
  const series = await sql<PersistencePoint[]>`
    WITH sym_snaps AS (
      SELECT snapshot_date, cluster_id,
             composite_pct, quality_pct, valuation_pct, momentum_pct
        FROM app.cluster_stocks_panel_cache
       WHERE symbol = ${symbol}
       ORDER BY snapshot_date DESC
       LIMIT ${WINDOW_SNAPSHOTS}
    )
    SELECT s.snapshot_date::text,
           s.composite_pct::float AS composite_pct,
           s.quality_pct::float   AS quality_pct,
           s.valuation_pct::float AS valuation_pct,
           s.momentum_pct::float  AS momentum_pct,
           ca.cluster_composite_avg::float AS cluster_composite_avg,
           COALESCE(ca.cluster_peer_count, 0)::int AS cluster_peer_count
      FROM sym_snaps s
      LEFT JOIN LATERAL (
        SELECT AVG(c.composite_pct) AS cluster_composite_avg,
               COUNT(*) AS cluster_peer_count
          FROM app.cluster_stocks_panel_cache c
         WHERE c.cluster_id = s.cluster_id
           AND c.snapshot_date = s.snapshot_date
           AND c.composite_pct IS NOT NULL
      ) ca ON TRUE
     ORDER BY s.snapshot_date
  `;

  const empty: PersistenceSummary = {
    symbol,
    series,
    raw_delta: null,
    cluster_avg_delta: null,
    cluster_adjusted: null,
    snaps_improving: 0,
  };
  if (series.length < 2) return empty;

  const newest = series[series.length - 1];
  const oldest = series[0];
  if (newest.composite_pct == null || oldest.composite_pct == null) return empty;

  const raw_delta = newest.composite_pct - oldest.composite_pct;

  // Cluster average: pull cluster_id, then average delta over peers.
  const clusterRow = await sql<{ cluster_avg_delta: number | null }[]>`
    WITH snaps AS (
      SELECT DISTINCT snapshot_date,
             ROW_NUMBER() OVER (ORDER BY snapshot_date DESC) AS rn
        FROM app.cluster_stocks_panel_cache
    ),
    latest_d AS (SELECT snapshot_date FROM snaps WHERE rn = 1),
    old_d    AS (SELECT snapshot_date FROM snaps WHERE rn = ${WINDOW_SNAPSHOTS}),
    sym_cluster AS (
      SELECT cluster_id FROM app.cluster_stocks_panel_cache
       WHERE symbol = ${symbol} AND snapshot_date = (SELECT snapshot_date FROM latest_d)
       LIMIT 1
    ),
    latest AS (
      SELECT symbol, cluster_id, composite_pct FROM app.cluster_stocks_panel_cache
       WHERE snapshot_date = (SELECT snapshot_date FROM latest_d)
         AND cluster_id = (SELECT cluster_id FROM sym_cluster)
    ),
    old AS (
      SELECT symbol, composite_pct AS old_composite FROM app.cluster_stocks_panel_cache
       WHERE snapshot_date = (SELECT snapshot_date FROM old_d)
         AND cluster_id = (SELECT cluster_id FROM sym_cluster)
    )
    SELECT AVG(l.composite_pct - o.old_composite)::float AS cluster_avg_delta
      FROM latest l
      JOIN old    o ON o.symbol = l.symbol
     WHERE l.composite_pct IS NOT NULL AND o.old_composite IS NOT NULL
  `;
  const cluster_avg_delta = clusterRow[0]?.cluster_avg_delta ?? null;
  const cluster_adjusted = cluster_avg_delta == null ? null : raw_delta - cluster_avg_delta;

  // Snaps improving — count strict increases in composite_pct between
  // consecutive snapshots.
  let snaps_improving = 0;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1].composite_pct;
    const b = series[i].composite_pct;
    if (a != null && b != null && b > a) snaps_improving++;
  }

  return { symbol, series, raw_delta, cluster_avg_delta, cluster_adjusted, snaps_improving };
}

/**
 * Compute persistence summaries for MANY symbols at once.  Used by
 * /watchlist where the user has up to 100 saved symbols.
 *
 * Two queries total regardless of how many symbols:
 *   1. Pull last 4 snapshots for ALL requested symbols + their cluster_ids
 *   2. Pull cluster-average delta per cluster_id (across the full universe)
 *
 * Merge in Node.  Cheaper than running loadPersistenceForSymbol N times.
 *
 * Returns a Map keyed by symbol.  Symbols not found in panel cache are
 * NOT added to the map — caller checks .get(symbol) defensively.
 */
export async function loadPersistenceForSymbols(
  symbols: string[],
): Promise<Map<string, PersistenceSummary>> {
  const out = new Map<string, PersistenceSummary>();
  if (symbols.length === 0) return out;

  // 1. Series for each requested symbol — pull the last 4 snapshots PER
  //    symbol using a row-number window.  Cluster averages are joined
  //    in via a LATERAL subquery so we get the peer comparison data in
  //    the same trip.
  const seriesRows = await sql<
    (PersistencePoint & { symbol: string; cluster_id: string; rn: number })[]
  >`
    WITH ranked AS (
      SELECT symbol, cluster_id, snapshot_date,
             composite_pct, quality_pct, valuation_pct, momentum_pct,
             ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY snapshot_date DESC) AS rn
        FROM app.cluster_stocks_panel_cache
       WHERE symbol = ANY(${symbols})
    ),
    windowed AS (
      SELECT * FROM ranked WHERE rn <= ${WINDOW_SNAPSHOTS}
    )
    SELECT w.symbol,
           w.cluster_id,
           w.snapshot_date::text,
           w.composite_pct::float AS composite_pct,
           w.quality_pct::float   AS quality_pct,
           w.valuation_pct::float AS valuation_pct,
           w.momentum_pct::float  AS momentum_pct,
           ca.cluster_composite_avg::float                  AS cluster_composite_avg,
           COALESCE(ca.cluster_peer_count, 0)::int          AS cluster_peer_count,
           w.rn
      FROM windowed w
      LEFT JOIN LATERAL (
        SELECT AVG(c.composite_pct) AS cluster_composite_avg,
               COUNT(*)             AS cluster_peer_count
          FROM app.cluster_stocks_panel_cache c
         WHERE c.cluster_id = w.cluster_id
           AND c.snapshot_date = w.snapshot_date
           AND c.composite_pct IS NOT NULL
      ) ca ON TRUE
     ORDER BY w.symbol, w.snapshot_date
  `;

  // Group by symbol; capture cluster_id for the cluster-average step.
  const seriesBySym = new Map<string, PersistencePoint[]>();
  const clusterBySym = new Map<string, string>();
  for (const r of seriesRows) {
    if (!seriesBySym.has(r.symbol)) seriesBySym.set(r.symbol, []);
    seriesBySym.get(r.symbol)!.push({
      snapshot_date:        r.snapshot_date,
      composite_pct:        r.composite_pct,
      quality_pct:          r.quality_pct,
      valuation_pct:        r.valuation_pct,
      momentum_pct:         r.momentum_pct,
      cluster_composite_avg: r.cluster_composite_avg,
      cluster_peer_count:    r.cluster_peer_count,
    });
    if (!clusterBySym.has(r.symbol)) clusterBySym.set(r.symbol, r.cluster_id);
  }

  if (seriesBySym.size === 0) return out;

  // 2. Cluster-average delta over the same window.  Compute once for
  //    every cluster mentioned in the watchlist; reuse for all members.
  const clusterIds = Array.from(new Set(clusterBySym.values()));
  const clusterAvgRows = await sql<{ cluster_id: string; cluster_avg_delta: number | null }[]>`
    WITH snaps AS (
      SELECT DISTINCT snapshot_date,
             ROW_NUMBER() OVER (ORDER BY snapshot_date DESC) AS rn
        FROM app.cluster_stocks_panel_cache
    ),
    latest_d AS (SELECT snapshot_date FROM snaps WHERE rn = 1),
    old_d    AS (SELECT snapshot_date FROM snaps WHERE rn = ${WINDOW_SNAPSHOTS}),
    latest AS (
      SELECT symbol, cluster_id, composite_pct FROM app.cluster_stocks_panel_cache
       WHERE snapshot_date = (SELECT snapshot_date FROM latest_d)
         AND cluster_id = ANY(${clusterIds})
    ),
    old AS (
      SELECT symbol, cluster_id, composite_pct AS old_composite FROM app.cluster_stocks_panel_cache
       WHERE snapshot_date = (SELECT snapshot_date FROM old_d)
         AND cluster_id = ANY(${clusterIds})
    )
    SELECT l.cluster_id,
           AVG(l.composite_pct - o.old_composite)::float AS cluster_avg_delta
      FROM latest l
      JOIN old    o ON o.symbol = l.symbol
     WHERE l.composite_pct IS NOT NULL AND o.old_composite IS NOT NULL
     GROUP BY l.cluster_id
  `;
  const clusterAvgById = new Map(clusterAvgRows.map((r) => [r.cluster_id, r.cluster_avg_delta]));

  // 3. Compose summaries per symbol.
  for (const sym of symbols) {
    const series = seriesBySym.get(sym) ?? [];
    const clusterId = clusterBySym.get(sym);
    const cluster_avg_delta = clusterId ? clusterAvgById.get(clusterId) ?? null : null;

    let raw_delta: number | null = null;
    let cluster_adjusted: number | null = null;
    let snaps_improving = 0;
    if (series.length >= 2) {
      const newest = series[series.length - 1].composite_pct;
      const oldest = series[0].composite_pct;
      if (newest != null && oldest != null) {
        raw_delta = newest - oldest;
        if (cluster_avg_delta != null) cluster_adjusted = raw_delta - cluster_avg_delta;
      }
      for (let i = 1; i < series.length; i++) {
        const a = series[i - 1].composite_pct;
        const b = series[i].composite_pct;
        if (a != null && b != null && b > a) snaps_improving++;
      }
    }

    out.set(sym, {
      symbol: sym,
      series,
      raw_delta,
      cluster_avg_delta,
      cluster_adjusted,
      snaps_improving,
    });
  }
  return out;
}
