import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import {
  SectorsClient,
  type IndustryTile,
  type StockRow,
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
    return { tiles: [], stocksByIndustry: {}, snapshotDate: null };
  }

  // Cluster tiles + cluster-level returns from the materialised cache.
  const tiles = await sql<IndustryTile[]>`
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
      cc.momentum_aggr_pct::float  AS avg_momentum,
      cc.ret_1w::float   AS ret_1w,
      cc.ret_1m::float   AS ret_1m,
      cc.ret_1y::float   AS ret_1y
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
    (StockRow & { cluster_id: string })[]
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
      maturity_tier,
      ret_1w::float           AS ret_1w,
      ret_1m::float           AS ret_1m,
      ret_1y::float           AS ret_1y
    FROM app.cluster_stocks_panel_cache
    WHERE snapshot_date = ${snapshotDate}
    ORDER BY cluster_id, composite_pct DESC NULLS LAST
  `;

  // Bucket by cluster_id for direct lookup in the client component. Drop
  // cluster_id from each row since it's now implicit in the bucket key.
  const stocksByIndustry: Record<string, StockRow[]> = {};
  for (const r of panelRows) {
    const bucket =
      stocksByIndustry[r.cluster_id] ??
      (stocksByIndustry[r.cluster_id] = []);
    const { cluster_id: _drop, ...stock } = r;
    void _drop;
    bucket.push(stock);
  }

  return { tiles, stocksByIndustry, snapshotDate };
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
const getCachedAll = unstable_cache(() => loadAll(), ["sectors-all"], {
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
