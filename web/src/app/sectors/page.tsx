import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { loadTrailingReturns, capWeightedReturn } from "@/lib/trailingReturns";
import {
  SectorsClient,
  type IndustryTile,
  type StockRow,
  type ClusterHistoryRow,
  type SectorsData,
} from "./SectorsClient";

// Single-page-app architecture: the server component does ONE data fetch
// for the entire page (all 46 cluster tiles + every stock row across all
// clusters, ~2,150 rows), wraps it in unstable_cache so it runs at most
// once per 24h, and hands everything to the client component.  All
// interactions (industry switch, tier filter, sector tab) become pure
// React state changes with zero server round-trips.
//
// revalidate alone is insufficient because Next.js 15's `await searchParams`
// marks the page as dynamic and bypasses ISR; unstable_cache pins the data
// layer regardless.

export const revalidate = 86400;

// ── Data fetch ───────────────────────────────────────────────────────────

async function loadAll(): Promise<SectorsData> {
  // Find the latest snapshot once — both queries below filter by it.
  const latest = await sql<{ snapshot_date: string }[]>`
    SELECT MAX(snapshot_date)::text AS snapshot_date FROM app.scores
  `;
  const snapshotDate = latest[0]?.snapshot_date ?? null;
  if (!snapshotDate) {
    return { tiles: [], stocksByIndustry: {}, clusterHistory: [], snapshotDate: null };
  }

  // Cluster tiles + cluster-level returns from the materialised cache.
  const tiles = await sql<Omit<IndustryTile, "ret_1w" | "ret_1m" | "ret_1y">[]>`
    SELECT
      cc.cluster_id      AS industry_id,
      cc.industry_name,
      cc.meta_cluster_id AS sector_id,
      cc.sector_name,
      mc.display_order   AS meta_display_order,
      cc.n_stocks        AS stock_count,
      cc.composite_aggr_pct::float AS avg_composite,
      cc.quality_aggr_pct::float   AS avg_quality,
      cc.valuation_aggr_pct::float AS avg_valuation,
      cc.momentum_aggr_pct::float  AS avg_momentum
    FROM app.cluster_composite_cache cc
    JOIN app.meta_cluster mc ON mc.id = cc.meta_cluster_id
    WHERE cc.snapshot_date = ${snapshotDate}
    ORDER BY mc.display_order, cc.industry_name
  `;

  // ALL stocks across ALL clusters, pre-joined with prices + returns.
  // Single 2,150-row query from one table — no golden_db hit, no per-cluster
  // join.  Volume on the wire after gzip ≈ 50-80 KB; well within payload
  // budget for a one-time SPA hydration.
  const panelRows = await sql<
    (Omit<StockRow, "ret_1w" | "ret_1m" | "ret_1y"> & { cluster_id: string })[]
  >`
    SELECT
      cluster_id,
      symbol, company_name,
      market_cap_cr::float    AS market_cap_cr,
      current_price::float    AS current_price,
      composite_pct::float    AS composite_pct,
      quality_pct::float      AS quality_pct,
      valuation_pct::float    AS valuation_pct,
      momentum_pct::float     AS momentum_pct,
      maturity_tier
    FROM app.cluster_stocks_panel_cache
    WHERE snapshot_date = ${snapshotDate}
    ORDER BY cluster_id, composite_pct DESC NULLS LAST
  `;

  // Returns are NOT read from the two caches above. Both are rebuilt weekly, so
  // their ret_* columns are anchored up to 7 days behind `current_price`, which
  // the EOD job refreshes in place daily — the row shows today's price beside
  // last Saturday's return. Measured 2026-09-17 across 1,909 names: 37% of 1W
  // values had the WRONG SIGN, and 1M/1Y were off by the same ~5pp in absolute
  // terms (the error is "days the panel hasn't seen", which doesn't shrink as
  // the window lengthens). lib/trailingReturns recomputes them off golden's
  // latest close using the watchlist's anchor, in fractions.
  const trailing = await loadTrailingReturns(panelRows.map((r) => r.symbol));

  // Bucket by cluster_id for direct lookup in the client component. Drop
  // cluster_id from each row since it's now implicit in the bucket key.
  const stocksByIndustry: Record<string, StockRow[]> = {};
  for (const r of panelRows) {
    const bucket =
      stocksByIndustry[r.cluster_id] ??
      (stocksByIndustry[r.cluster_id] = []);
    const { cluster_id: _drop, ...stock } = r;
    void _drop;
    const t = trailing.get(r.symbol);
    bucket.push({
      ...stock,
      ret_1w: t?.ret_1w ?? null,
      ret_1m: t?.ret_1m ?? null,
      ret_1y: t?.ret_1y ?? null,
    });
  }

  // Cluster-level returns, re-aggregated from the fresh per-stock numbers with
  // the SAME market-cap weighting the ETL uses (cli.py, "Aggregate per
  // cluster"). Recomputing here rather than reading cc.ret_* keeps a tile and
  // the rows inside it from telling two different stories.
  const tilesWithReturns: IndustryTile[] = tiles.map((t) => {
    const rows = stocksByIndustry[t.industry_id] ?? [];
    return {
      ...t,
      ret_1w: capWeightedReturn(rows.map((s) => ({ mcap: s.market_cap_cr, ret: s.ret_1w }))),
      ret_1m: capWeightedReturn(rows.map((s) => ({ mcap: s.market_cap_cr, ret: s.ret_1m }))),
      ret_1y: capWeightedReturn(rows.map((s) => ({ mcap: s.market_cap_cr, ret: s.ret_1y }))),
    };
  });

  // Sector heatmap: weekly average scores per cluster over the last ~90 days.
  // Aggregated from app.scores (not the materialized cache — cache only stores
  // the latest snapshot). We skip partial snapshots (< 40 clusters) to avoid
  // noise from early partial runs.
  const clusterHistory = await sql<ClusterHistoryRow[]>`
    WITH full_snaps AS (
      SELECT snapshot_date
      FROM app.scores
      WHERE composite_pct IS NOT NULL
        AND snapshot_date >= CURRENT_DATE - INTERVAL '120 days'
      GROUP BY snapshot_date
      HAVING COUNT(DISTINCT cluster_id) >= 40
    )
    SELECT
      s.cluster_id,
      s.snapshot_date::text,
      ROUND(AVG(s.composite_pct))::int  AS avg_composite,
      ROUND(AVG(s.quality_pct))::int    AS avg_quality,
      ROUND(AVG(s.valuation_pct))::int  AS avg_valuation,
      ROUND(AVG(s.momentum_pct))::int   AS avg_momentum
    FROM app.scores s
    WHERE s.snapshot_date IN (SELECT snapshot_date FROM full_snaps)
      AND s.composite_pct IS NOT NULL
    GROUP BY s.cluster_id, s.snapshot_date
    ORDER BY s.cluster_id, s.snapshot_date ASC
  `;

  return { tiles: tilesWithReturns, stocksByIndustry, clusterHistory, snapshotDate };
}

// Cache the entire data layer for 24h regardless of searchParams. Without
// this, awaiting searchParams in the page component (needed to read the
// initial sector/industry from the URL on first paint) marks the page as
// dynamic and bypasses ISR.
// Tag the cache entry so /api/revalidate can purge it on demand after the
// daily refresh-ltp script lands fresh data in Neon. Without the tag, only
// `revalidate: 86400` controls when this data becomes stale — meaning
// /sectors can serve up to a full day of yesterday's prices even though
// the DB already has today's. With the tag, the GH Action posts to
// /api/revalidate after the upsert and the next page render rebuilds.
const getCachedAll = unstable_cache(() => loadAll(), ["sectors-all", "v2-live-returns"], {
  revalidate: 86400,
  tags: ["sectors", "panel-cache"],
});

// ── Page component ──────────────────────────────────────────────────────

export const metadata = {
  title: "Sectors — NSE peer groups by quality, value & momentum · EquityRoots",
  description:
    "Browse NSE peer groups ranked on Quality, Valuation and Momentum. See cluster leaders and laggards, scored weekly within their true peers — not broad sectors.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [sp, data] = await Promise.all([searchParams, getCachedAll()]);

  // Initial state is read from the URL on first paint so bookmarks /
  // share-links land on the right industry. Subsequent navigation is
  // purely client-side via history.replaceState.
  const initialSectorId = sp.sector ?? null;
  const initialIndustryId = sp.industry ?? null;

  return (
    <div className="theme-teal mx-auto max-w-[1200px] px-4 md:px-6 py-6 md:py-8">
      <SectorsClient
        data={data}
        initialSectorId={initialSectorId}
        initialIndustryId={initialIndustryId}
      />
    </div>
  );
}
