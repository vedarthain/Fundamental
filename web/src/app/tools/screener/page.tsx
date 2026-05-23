import Link from "next/link";
import { sql } from "@/lib/db";
import { band, bandColor, fmtPct, tierLabel } from "@/lib/score";
import { Controls } from "./Controls";
import { MetaChips, type MetaOption } from "./MetaChips";
import { SubClusterChips, type ClusterRow } from "./SubClusterChips";
import { IndexChips } from "./IndexChips";
import {
  INDEX_COLUMNS, INDEX_LABELS, TIER_LABELS, MKT_CAP_LABELS,
  type SortParam,
} from "./types";
import { AboutCard } from "./AboutCard";
import { RangeFilters } from "./RangeFilters";
import { PresetBar } from "./PresetBar";
import {
  PAGE_SIZE, parseParams, paramsToQuery, type ScreenerParams,
} from "./types";

export const revalidate = 600;
export const dynamic = "force-dynamic"; // search-param driven

type Row = {
  symbol: string;
  company_name: string;
  industry_id: string;
  industry_name: string;
  sector_name: string;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  price_fetched_at: string | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  composite_pct: number | null;
  peer_rank: number | null;
  peer_count: number | null;
  leading_pillar: string | null;
  score_status: string | null;
  // Raw fundamentals — extracted from metrics_snapshot.cluster_metrics JSONB.
  // Powers the spreadsheet-style columns (P/E, P/B, ROE, etc.) on the
  // screener table. Each is nullable because metric availability varies by
  // cluster's scorecard (e.g., loss-makers have null pe_ttm).
  pe_ttm: number | null;
  pb: number | null;
  roe_3y: number | null;        // stored as decimal (0.18 = 18%)
  ret_12m_rel: number | null;   // 12-month return vs market (decimal)
  div_yield: number | null;     // dividend yield (decimal)
  op_margin_3y: number | null;  // operating margin (decimal)
};

/** Column-name → SQL expression (against the outer `joined` CTE). Used by
 * the ORDER BY builder. Keeps the user-supplied sort key safely confined to
 * this whitelist — a malformed URL param can never reach the raw SQL. The
 * SortParam type lives in ./types so other components (SortHeader) can use it. */
const SORT_SQL: Record<SortParam, string> = {
  score:  "composite_pct",
  symbol: "symbol",
  mcap:   "market_cap_cr",
  ltp:    "current_price",
  pe:     "pe_ttm",
  pb:     "pb",
  roe:    "roe_3y",
  ret12m: "ret_12m_rel",
  divyld: "div_yield",
  opm:    "op_margin_3y",
  q:      "quality_pct",
  v:      "valuation_pct",
  m:      "momentum_pct",
};

async function loadCoverage(): Promise<{ stocks: number }> {
  // Count of stocks visible to the screener — i.e. anything actively tracked
  // in app.universe. This is what users want to see surfaced as the scope of
  // coverage ("we track N stocks") rather than the filtered match count.
  const rows = await sql<{ stocks: number }[]>`
    SELECT COUNT(*)::int AS stocks FROM app.universe WHERE is_active
  `;
  return rows[0] ?? { stocks: 0 };
}

async function loadMetas(): Promise<MetaOption[]> {
  return sql<MetaOption[]>`
    SELECT mc.id, mc.name, COUNT(c.id)::int AS cluster_count
    FROM app.meta_cluster mc
    LEFT JOIN app.cluster c ON c.meta_cluster_id = mc.id AND c.id <> 'unclassified'
    GROUP BY mc.id, mc.name, mc.display_order
    ORDER BY mc.display_order
  `;
}

async function loadClusters(): Promise<ClusterRow[]> {
  return sql<ClusterRow[]>`
    SELECT c.id, c.name, c.meta_cluster_id AS sector_id
    FROM app.cluster c
    WHERE c.id <> 'unclassified'
    ORDER BY c.name
  `;
}

// In multi-industry view (sector / all sectors) we surface the top N stocks
// per industry instead of paginating one flat list of 50 rows. This guarantees
// every industry that matches the user's filters appears on the page — the
// alternative (PAGE_SIZE=50 globally) silently dropped industries past the
// first two or three. Single-industry drill-in keeps the regular pagination.
const PER_INDUSTRY_LIMIT = 8;

export async function loadRowsForExport(
  p: ScreenerParams,
  opts?: { exportAll?: boolean },
): Promise<{ rows: Row[]; total: number }> {
  const r = await loadRows(p, opts);
  return { rows: r.rows, total: r.total };
}

async function loadRows(
  p: ScreenerParams,
  opts?: { exportAll?: boolean },
): Promise<{
  rows: Row[];
  total: number;
  maxSectorDepth: number;
  isSectorView: boolean;
  /** Per-tier totals — populated in sector view only. Powers the "Show all
   *  N Long-term Compounders →" link below each tier section. */
  tierCounts: Record<string, number>;
}> {
  const { clusters, metas, tiers, caps, index, minQ, minV, minM, minC, page, perSector } = p;
  // Pagination mode logic (in order of specificity):
  //   1. Drill-down (single cluster selected) → flat LIMIT/OFFSET.
  //   2. Sector-view (exactly one meta, no cluster, no tier filter) →
  //      partition by maturity_tier, top N per tier within the sector.
  //   3. Multi-sector / default → partition by meta_cluster_id, top N per sector.
  const isFlatPagination = clusters.length === 1;
  const isSectorView = !isFlatPagination
    && metas.length === 1
    && clusters.length === 0
    && tiers.length === 0;
  const offset = (page - 1) * perSector;
  // Within-group rank window for the current page (used by both sector- and
  // multi-sector views; the partition expression in the CTE differs but the
  // [low, high] range is the same).
  const sectorRankLow  = (page - 1) * perSector + 1;
  const sectorRankHigh = page * perSector;

  // ── Range filters on raw fundamental metrics ──────────────────────────
  // These reference columns inside the `joined` CTE (m.cluster_metrics->>...
  // already cast to float). We build SQL fragments that are no-ops when
  // their bound is null and active WHERE clauses when it's set.
  // Percentages are divided by 100 here because the JSONB stores decimals
  // (e.g. 0.18 = 18%) and the user inputs percent (e.g. 18).
  const peMaxClause     = p.peMax != null
    ? sql`AND (m.cluster_metrics->>'pe_ttm')::float <= ${p.peMax}`
    : sql``;
  const pbMaxClause     = p.pbMax != null
    ? sql`AND (m.cluster_metrics->>'pb')::float <= ${p.pbMax}`
    : sql``;
  // ROE filter matches WHICHEVER return-on-capital metric the stock's cluster
  // scorecard computes. BFSI clusters store roe_3y; most other clusters store
  // roce_3y. Without the COALESCE the filter would silently exclude ~85% of
  // the universe whenever it's active.
  const roeMinClause    = p.roeMin != null
    ? sql`AND COALESCE(
              (m.cluster_metrics->>'roe_3y')::float,
              (m.cluster_metrics->>'roce_3y')::float
            ) >= ${p.roeMin / 100}`
    : sql``;
  const divYldMinClause = p.divYldMin != null
    ? sql`AND (m.cluster_metrics->>'div_yield')::float >= ${p.divYldMin / 100}`
    : sql``;
  const opmMinClause    = p.opmMin != null
    ? sql`AND (m.cluster_metrics->>'op_margin_3y')::float >= ${p.opmMin / 100}`
    : sql``;
  const ret12mMinClause = p.ret12mMin != null
    ? sql`AND (m.cluster_metrics->>'ret_12m_rel')::float >= ${p.ret12mMin / 100}`
    : sql``;
  const mcapMinClause   = p.mcapMin != null
    ? sql`AND sm.market_cap_cr >= ${p.mcapMin}`
    : sql``;
  const mcapMaxClause   = p.mcapMax != null
    ? sql`AND sm.market_cap_cr <= ${p.mcapMax}`
    : sql``;
  // Combined fragment we'll apply in both the count query (with m + sm
  // already joined there too — see below) and the rows query.
  const rangeFilters = sql`
    ${peMaxClause} ${pbMaxClause} ${roeMinClause} ${divYldMinClause}
    ${opmMinClause} ${ret12mMinClause} ${mcapMinClause} ${mcapMaxClause}
  `;
  // True when any range filter is active — used to decide whether the count
  // query needs to join metrics_snapshot (skip the join cost when not needed).
  const hasRangeFilters =
    p.peMax != null || p.pbMax != null || p.roeMin != null ||
    p.divYldMin != null || p.opmMin != null || p.ret12mMin != null ||
    p.mcapMin != null || p.mcapMax != null;

  // Count query: FROM app.scores s → use s.* for score-derived columns.
  const clusterFilter = clusters.length
    ? sql`AND s.cluster_id = ANY(${clusters})`
    : sql``;
  const tierFilter = tiers.length
    ? sql`AND s.maturity_tier = ANY(${tiers})`
    : sql``;
  // Rows query: outer FROM is ranked r — use r.* for score-derived columns.
  const clusterFilterR = clusters.length
    ? sql`AND r.cluster_id = ANY(${clusters})`
    : sql``;
  const tierFilterR = tiers.length
    ? sql`AND r.maturity_tier = ANY(${tiers})`
    : sql``;
  // c.* / u.* aliases exist in both queries, so meta + cap + index filters are shared.
  const metaFilter = metas.length
    ? sql`AND c.meta_cluster_id = ANY(${metas})`
    : sql``;
  const capFilter = caps.length
    ? sql`AND u.market_cap_category = ANY(${caps})`
    : sql``;
  // Index filter uses the boolean columns on app.universe (is_nifty50 etc.).
  // We only render a fixed set of values, so injecting the column name as
  // a sql.unsafe identifier is safe — but we route through INDEX_COLUMNS
  // (whitelist map) so a malformed URL param can't reach the raw query.
  const indexFilter = index && INDEX_COLUMNS[index]
    ? sql`AND u.${sql(INDEX_COLUMNS[index])} = TRUE`
    : sql``;

  // Sort mode: at the all-sectors / sector level, surface by maturity tier
  // (VETERAN → MATURE → MID → NEW), then by composite within tier. When the
  // user drills into a single industry, sort by peer rank — that's the only
  // sort that's meaningful within one cluster.
  const isIndustryView = clusters.length === 1;
  // Industry view → flat peer-rank ordering. Multi-industry views (all sectors
  // or a sector) group rows by industry first so the rank column ("2nd of 23")
  // doesn't have to be reconciled across different peer pools. Within each
  // industry block we order by maturity tier (V→M→Mid→New) then peer rank so
  // rank 1 of each tier surfaces before rank 2 of the same tier.
  const tailOrderDefault = isIndustryView
    ? sql`peer_rank ASC NULLS LAST, composite_pct DESC NULLS LAST`
    : sql`sector_name ASC,
           industry_name ASC,
           CASE maturity_tier
             WHEN 'veteran' THEN 1
             WHEN 'mature'  THEN 2
             WHEN 'mid'     THEN 3
             WHEN 'new'     THEN 4
             ELSE 5
           END ASC,
           peer_rank ASC NULLS LAST,
           composite_pct DESC NULLS LAST`;
  // When the user explicitly clicks a sort column, drop the bucket/pillar
  // penalty preamble — they asked for this ordering, surface it directly with
  // composite_pct as a stable tiebreak. SORT_SQL maps the URL param to a
  // SQL column name (whitelisted in the type, never user input).
  const userSorting = p.sort !== "score" || p.dir !== "desc";
  const sortDir = p.dir === "asc" ? sql`ASC NULLS LAST` : sql`DESC NULLS LAST`;
  const sortCol = SORT_SQL[p.sort];
  const orderBy = userSorting
    ? sql`${sql(sortCol)} ${sortDir}, composite_pct DESC NULLS LAST`
    : sql`(score_status = 'full') DESC,
           (quality_pct IS NOT NULL
            AND valuation_pct IS NOT NULL
            AND momentum_pct IS NOT NULL) DESC,
           ${tailOrderDefault}`;

  // Count query joins metrics_snapshot + screener_meta only when needed
  // (range filters active). Saves the join cost on the common no-range path.
  // Explicit ON instead of USING — `app.universe u USING (symbol)` already
  // appears in the outer query, so a second USING(symbol) would trigger
  // "common column name appears more than once in left table".
  const rangeJoinForCount = hasRangeFilters
    ? sql`LEFT JOIN app.metrics_snapshot m
            ON m.symbol = s.symbol
           AND m.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
          LEFT JOIN app.screener_meta sm ON sm.symbol = s.symbol`
    : sql``;
  const totalRows = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM app.scores s
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = s.cluster_id
    ${rangeJoinForCount}
    WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
      ${clusterFilter} ${metaFilter} ${tierFilter} ${capFilter} ${indexFilter}
      AND COALESCE(s.quality_pct, 0)   >= ${minQ}
      AND COALESCE(s.valuation_pct, 0) >= ${minV}
      AND COALESCE(s.momentum_pct, 0)  >= ${minM}
      AND COALESCE(s.composite_pct, 0) >= ${minC}
      ${rangeFilters}
  `;
  const total = totalRows[0]?.n ?? 0;

  void isIndustryView;
  // Pagination strategy:
  //   - Export       → no LIMIT, no rank filter (capped at 5,000 in outer SELECT)
  //   - Industry view → flat LIMIT/OFFSET pagination through the cluster
  //   - Multi-sector → rank-tier pagination via sector_rank WHERE clause
  //                    (LIMIT is then a safety cap only)
  const limitClause = opts?.exportAll
    ? sql`LIMIT 5000`
    : isFlatPagination
      ? sql`LIMIT ${perSector} OFFSET ${offset}`
      : sql``;  // sector_rank filter does the slicing instead
  // Rank-tier filter. Picks the right partition column for the active view:
  //   - sector view  → tier_rank (top N per maturity tier within the sector)
  //   - multi-sector → sector_rank (top N per sector across the universe)
  //   - flat/export  → no rank filter
  const sectorRankFilter = (opts?.exportAll || isFlatPagination)
    ? sql``
    : isSectorView
      ? sql`WHERE tier_rank BETWEEN ${sectorRankLow} AND ${sectorRankHigh}`
      : sql`WHERE sector_rank BETWEEN ${sectorRankLow} AND ${sectorRankHigh}`;

  const rows = await sql<Row[]>`
    WITH ranked AS (
      SELECT s.symbol,
             s.cluster_id,
             s.maturity_tier,
             s.quality_pct,
             s.valuation_pct,
             s.momentum_pct,
             s.composite_pct,
             s.score_status,
             RANK() OVER (
               PARTITION BY s.cluster_id, s.maturity_tier
               ORDER BY s.composite_pct DESC NULLS LAST
             )::int AS peer_rank,
             COUNT(*) OVER (
               PARTITION BY s.cluster_id, s.maturity_tier
             )::int AS peer_count,
             CASE
               WHEN COALESCE(s.quality_pct, 0) >= COALESCE(s.valuation_pct, 0)
                AND COALESCE(s.quality_pct, 0) >= COALESCE(s.momentum_pct, 0)
               THEN 'Q'
               WHEN COALESCE(s.valuation_pct, 0) >= COALESCE(s.momentum_pct, 0)
               THEN 'V'
               ELSE 'M'
             END AS leading_pillar
      FROM app.scores s
      WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
    ),
    joined AS (
      SELECT r.symbol,
             u.company_name,
             r.cluster_id AS industry_id,
             c.name AS industry_name,
             mc.name AS sector_name,
             r.maturity_tier,
             sm.market_cap_cr,
             sm.current_price::float AS current_price,
             sm.last_scraped_at::text AS price_fetched_at,
             r.quality_pct,
             r.valuation_pct,
             r.momentum_pct,
             r.composite_pct,
             r.peer_rank,
             r.peer_count,
             r.leading_pillar,
             r.score_status,
             -- Raw fundamentals extracted from metrics_snapshot.cluster_metrics JSONB.
             -- These are the absolute (non-percentile) values used for the
             -- spreadsheet-style columns and for sorting by P/E, ROE etc.
             (m.cluster_metrics->>'pe_ttm')::float       AS pe_ttm,
             (m.cluster_metrics->>'pb')::float           AS pb,
             -- ROE for BFSI; ROCE for everyone else.  The screener column
             -- "ROE / ROCE 3Y" surfaces whichever the cluster scorecard
             -- computed.  Both are "return on capital" measures in
             -- comparable ranges; collapsing them keeps the column populated
             -- for the full universe.
             COALESCE(
                 (m.cluster_metrics->>'roe_3y')::float,
                 (m.cluster_metrics->>'roce_3y')::float
             ) AS roe_3y,
             (m.cluster_metrics->>'ret_12m_rel')::float  AS ret_12m_rel,
             (m.cluster_metrics->>'div_yield')::float    AS div_yield,
             (m.cluster_metrics->>'op_margin_3y')::float AS op_margin_3y,
             ROW_NUMBER() OVER (
               PARTITION BY r.cluster_id
               ORDER BY
                 (r.score_status = 'full') DESC,
                 (r.quality_pct IS NOT NULL
                  AND r.valuation_pct IS NOT NULL
                  AND r.momentum_pct IS NOT NULL) DESC,
                 CASE r.maturity_tier
                   WHEN 'veteran' THEN 1
                   WHEN 'mature'  THEN 2
                   WHEN 'mid'     THEN 3
                   WHEN 'new'     THEN 4
                   ELSE 5
                 END ASC,
                 r.peer_rank ASC NULLS LAST,
                 r.composite_pct DESC NULLS LAST
             )::int AS display_rank,
             -- sector_rank = within-sector ordinal, used for "top N per
             -- sector" pagination.  Same tier-then-composite ordering as
             -- display_rank so the per-sector tour matches the cluster-
             -- level ordering users expect.
             ROW_NUMBER() OVER (
               PARTITION BY mc.id
               ORDER BY
                 (r.score_status = 'full') DESC,
                 (r.quality_pct IS NOT NULL
                  AND r.valuation_pct IS NOT NULL
                  AND r.momentum_pct IS NOT NULL) DESC,
                 r.composite_pct DESC NULLS LAST,
                 r.peer_rank ASC NULLS LAST
             )::int AS sector_rank,
             -- tier_rank = within-tier ordinal.  In sector view (single meta
             -- filter) this gives "top N Long-term Compounders / Established
             -- / Emerging / New Listings" within the selected sector. Across
             -- the whole universe in other views; only consulted in sector view.
             ROW_NUMBER() OVER (
               PARTITION BY r.maturity_tier
               ORDER BY
                 (r.score_status = 'full') DESC,
                 (r.quality_pct IS NOT NULL
                  AND r.valuation_pct IS NOT NULL
                  AND r.momentum_pct IS NOT NULL) DESC,
                 r.composite_pct DESC NULLS LAST,
                 r.peer_rank ASC NULLS LAST
             )::int AS tier_rank
      FROM ranked r
      JOIN app.universe u USING (symbol)
      JOIN app.cluster c ON c.id = r.cluster_id
      JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
      LEFT JOIN app.screener_meta sm USING (symbol)
      -- Latest snapshot's raw metrics — same date as the scores so the row's
      -- score and raw values come from the same compute pass.
      LEFT JOIN app.metrics_snapshot m
        ON m.symbol = r.symbol
       AND m.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
      WHERE u.is_active
        ${clusterFilterR} ${metaFilter} ${tierFilterR} ${capFilter} ${indexFilter}
        AND COALESCE(r.quality_pct, 0)   >= ${minQ}
        AND COALESCE(r.valuation_pct, 0) >= ${minV}
        AND COALESCE(r.momentum_pct, 0)  >= ${minM}
        AND COALESCE(r.composite_pct, 0) >= ${minC}
        ${rangeFilters}
    )
    SELECT symbol, company_name, industry_id, industry_name, sector_name,
           maturity_tier, market_cap_cr, current_price, price_fetched_at,
           quality_pct, valuation_pct, momentum_pct, composite_pct,
           peer_rank, peer_count, leading_pillar, score_status,
           pe_ttm, pb, roe_3y, ret_12m_rel, div_yield, op_margin_3y
    FROM joined
    ${sectorRankFilter}
    ORDER BY ${orderBy}
    ${limitClause}
  `;

  // Compute max-depth of the active partition so we can derive total page
  // count: ceil(maxPartitionDepth / perSector).
  //   - flat/export → just use total
  //   - sector view → MAX(count per maturity_tier within the sector)
  //   - multi-sector → MAX(count per meta_cluster_id)
  let maxSectorDepth = total;
  if (!isFlatPagination && !opts?.exportAll) {
    const groupExpr = isSectorView ? sql`s.maturity_tier` : sql`mc.id`;
    const depthQ = await sql<{ d: number }[]>`
      SELECT COALESCE(MAX(n), 0)::int AS d
      FROM (
        SELECT COUNT(*)::int AS n
        FROM app.scores s
        JOIN app.universe u USING (symbol)
        JOIN app.cluster c ON c.id = s.cluster_id
        JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
        ${rangeJoinForCount}
        WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
          ${clusterFilter} ${metaFilter} ${tierFilter} ${capFilter} ${indexFilter}
          AND COALESCE(s.quality_pct, 0)   >= ${minQ}
          AND COALESCE(s.valuation_pct, 0) >= ${minV}
          AND COALESCE(s.momentum_pct, 0)  >= ${minM}
          AND COALESCE(s.composite_pct, 0) >= ${minC}
          ${rangeFilters}
        GROUP BY ${groupExpr}
      ) sub
    `;
    maxSectorDepth = depthQ[0]?.d ?? 0;
  }

  // Per-tier totals (sector view only) — used by ResultsTable to render
  // the "Show all N →" link below each tier section.
  let tierCounts: Record<string, number> = {};
  if (isSectorView && !opts?.exportAll) {
    const tcRows = await sql<{ t: string; n: number }[]>`
      SELECT s.maturity_tier AS t, COUNT(*)::int AS n
      FROM app.scores s
      JOIN app.universe u USING (symbol)
      JOIN app.cluster c ON c.id = s.cluster_id
      JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
      ${rangeJoinForCount}
      WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
        ${clusterFilter} ${metaFilter} ${tierFilter} ${capFilter} ${indexFilter}
        AND COALESCE(s.quality_pct, 0)   >= ${minQ}
        AND COALESCE(s.valuation_pct, 0) >= ${minV}
        AND COALESCE(s.momentum_pct, 0)  >= ${minM}
        AND COALESCE(s.composite_pct, 0) >= ${minC}
        ${rangeFilters}
      GROUP BY s.maturity_tier
    `;
    tierCounts = Object.fromEntries(tcRows.map((r) => [r.t, r.n]));
  }

  return { rows, total, maxSectorDepth, isSectorView, tierCounts };
}

export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const params = parseParams(sp);
  const [metas, clusters, { rows, total, maxSectorDepth, isSectorView, tierCounts }, coverage] = await Promise.all([
    loadMetas(),
    loadClusters(),
    loadRows(params),
    loadCoverage(),
  ]);

  // Page count depends on view:
  //   - Industry view (single cluster): flat pagination → total / perSector
  //   - Sector view (single meta): tier-rank pagination → ceil(deepest tier / perSector)
  //   - Multi-sector view: sector-rank pagination → ceil(deepest sector / perSector)
  const isIndustryView = params.clusters.length === 1;
  const totalPages = Math.max(
    1,
    Math.ceil((isIndustryView ? total : maxSectorDepth) / params.perSector),
  );

  // Newest + oldest price-fetch timestamps across the rows on this page.
  // We surface this so the user knows whether the LTPs they're seeing are
  // hours old or weeks old. Some stocks get re-fetched more often than others.
  let latestPrice: Date | null = null;
  let oldestPrice: Date | null = null;
  for (const r of rows) {
    if (!r.price_fetched_at) continue;
    const d = new Date(r.price_fetched_at);
    if (!latestPrice || d > latestPrice) latestPrice = d;
    if (!oldestPrice || d < oldestPrice) oldestPrice = d;
  }
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });

  return (
    <div className="theme-indigo mx-auto max-w-[1300px] px-6 py-10">
      {/* Header row — title block on the left, secondary "tool" CTAs on
          the right (Peer comparison). The Peer Comparison entry point used
          to live in the top nav; it lives here now because the natural flow
          is browse → narrow → compare 2-5 finalists. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <header className="max-w-[760px]">
          <div className="text-[12px] uppercase tracking-wide muted-text flex items-center gap-2 flex-wrap">
            <Link href="/tools" className="hover:underline">Tools</Link>
            <span aria-hidden style={{ color: "var(--color-border-default)" }}>›</span>
            <span>Stock Screener</span>
            <span aria-hidden style={{ color: "var(--color-border-default)" }}>·</span>
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border hairline normal-case tracking-normal"
              style={{ backgroundColor: "var(--color-card)" }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-livepulse"
                style={{ backgroundColor: "var(--color-score-excellent)" }}
              />
              <span className="tabular-nums font-medium" style={{ color: "var(--color-ink)" }}>
                {coverage.stocks.toLocaleString("en-IN")}
              </span>
              <span>stocks tracked</span>
            </span>
          </div>
          <h1 className="font-display text-[36px] tracking-tight leading-tight mt-1">
            Stocks ranked by <em className="accent">Industry Score</em>
          </h1>
          <p className="mt-3 text-[15px] muted-text">
            Every stock ranked within its peer cluster using sector-tuned Quality, Valuation,
            and Momentum weights. Filter by sector, industry, maturity, or market cap.
          </p>
          <div className="mt-3 text-[12px] muted-text">
            {total.toLocaleString("en-IN")} matches
            {latestPrice && (
              <>
                {" "}·{" "}
                <span
                  title={
                    oldestPrice && oldestPrice.getTime() !== latestPrice.getTime()
                      ? `Prices on this page were fetched between ${fmtDate(oldestPrice)} and ${fmtDate(latestPrice)}.`
                      : `Prices fetched ${fmtDate(latestPrice)}.`
                  }
                >
                  LTP as of <span className="ink-text tabular-nums">{fmtDate(latestPrice)}</span>
                  {oldestPrice && oldestPrice.getTime() !== latestPrice.getTime() && (
                    <span className="muted-text"> · oldest {fmtDate(oldestPrice)}</span>
                  )}
                </span>
              </>
            )}
          </div>
        </header>

        {/* CTA cards for the sibling tools (Investing Trials, Peer Comparison)
            used to sit here, but they visually nested those tools under
            Screener instead of treating them as siblings. The /tools landing
            page + Tools dropdown in the top nav cover discovery; the contextual
            link further down the page ("Want your own Q/V/M weights? → Try
            Investing Trials") covers the educational cross-reference. */}
      </div>

      <div className="mt-6 max-w-[820px]">
        <AboutCard />
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
        {/* Sticky sidebar: every filter lives here — sector + industry +
            index membership at the top (the "what universe to look at"
            filters), then min pillar scores + maturity + market cap below
            ("what to require of each stock"). Previously the chip rows sat
            above the results table, which made /discover feel like a
            navigation surface; now the results are the headline and filters
            are the lever — true screener-altitude. */}
        <aside
          className="card p-4 self-start lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
        >
          {/* Reset-all link — always visible at the top of the sidebar so the
              user has a single obvious "wipe everything" button regardless of
              which sections are expanded. Preserves sort/dir/density. */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] uppercase tracking-wide muted-text font-semibold">
              Filters
            </div>
            <Link
              href={"/tools/screener" + paramsToQuery({
                sort: params.sort, dir: params.dir, density: params.density,
              })}
              scroll={false}
              className="text-[11px] underline hover:no-underline text-[var(--color-accent-600)]"
            >
              Reset all
            </Link>
          </div>

          {/* Each section is wrapped in <details> so users can collapse the
              ones they don't currently care about. Default-open state is
              chosen per-section: universe filters (sector/industry/index)
              open by default; per-stock criteria open by default too.
              Switching to <details> instead of React state means zero JS
              for the collapsing UX and per-section state survives navigation. */}
          <div className="space-y-3">
            {/* Universe filters — blue family. "What part of the market am I
                looking at?" Picks which peer pools we draw stocks from. */}
            <FilterSection label="Sector" hint="Which industry-group to look at" color="blue">
              <MetaChips metas={metas} clusters={clusters} />
            </FilterSection>

            <FilterSection label="Industry" hint="Narrow to a specific peer cluster" color="blue">
              <SubClusterChips clusters={clusters} />
            </FilterSection>

            <FilterSection label="Index membership" hint="Limit to Nifty 50 / 200 / 500" color="blue">
              <IndexChips />
            </FilterSection>

            {/* Stock-shape filters — green family. "What shape of stock?"
                Filters by listing tenure and market-cap category. */}
            <FilterSection label="Maturity" hint="Filter by years of listed history" color="green">
              <Controls only="maturity" />
            </FilterSection>

            <FilterSection label="Market cap" hint="Stock size category" color="green">
              <Controls only="cap" />
            </FilterSection>

            {/* Score filters — purple family. "What threshold must each stock
                clear?" Applies peer-percentile floors. */}
            <FilterSection label="Minimum scores" hint="Pillar percentile floors (within peer cluster)" color="purple">
              <Controls only="minScores" />
            </FilterSection>

            {/* Metric ranges — purple family. Filter by raw fundamental
                values (P/E, ROE, Div Yield, Op Margin, Market Cap, 12M
                Return). Complements the percentile floors above; range
                filters work on the absolute number, scores work on the
                within-cluster peer rank. */}
            <FilterSection label="Metric ranges" hint="Filter by raw P/E, ROE, dividend yield, etc." color="purple">
              <RangeFilters />
            </FilterSection>
          </div>
        </aside>

        <main>
          {/* Quick presets + CSV export — sits above the results toolbar so
              users can one-click between "Compounders" / "Value" / "Growth"
              filter combos and download the active result set as CSV. */}
          <PresetBar />
          <ResultsToolbar
            params={params}
            total={total}
            metas={metas}
            clusters={clusters}
          />
          <ResultsTable
            rows={rows}
            groupByIndustry={false}
            groupByTier={isSectorView}
            tierCounts={tierCounts}
            params={params}
          />
          <Pagination params={params} totalPages={totalPages} />
          <MethodologyFooter />
        </main>
      </div>
    </div>
  );
}

/** Section family colors — three accent colors group the filter sections by
 * what they're filtering. Each family uses a stripe on the left edge + a
 * dot in the section label so the three groups are visually distinguishable
 * without being a clown show. Picking a stripe instead of full-section
 * backgrounds keeps the sidebar readable.
 *
 *   blue   — Universe filters  (Sector / Industry / Index — "what to look at")
 *   green  — Stock-shape filters (Maturity / Market Cap — "what shape of stock")
 *   purple — Score filters      (Min Q/V/M/Composite — "what threshold to clear")
 */
type FamilyColor = "blue" | "green" | "purple";

const FAMILY_COLORS: Record<FamilyColor, { stripe: string; dot: string; label: string }> = {
  blue:   { stripe: "#7d95b3", dot: "#3d5778", label: "#2c4361" },
  green:  { stripe: "#6abf5d", dot: "#2e9a47", label: "#206b32" },
  purple: { stripe: "#a78bfa", dot: "#7c3aed", label: "#5b21b6" },
};

/** Collapsible filter section. Uses <details> so the collapse state lives
 *  in the DOM, no React state needed — each section remembers its own
 *  state across navigation. The hint line under the label explains what the
 *  filter does. A 2px colored stripe on the left + a small colored dot
 *  signals the section's family (universe / shape / scores). */
function FilterSection({
  label, hint, defaultOpen = false, color, children, group = "screener-filters",
}: {
  label: string;
  hint?: string;
  defaultOpen?: boolean;
  color: FamilyColor;
  children: React.ReactNode;
  /** Native HTML accordion grouping: <details> elements sharing the same
   *  `name` attribute auto-close each other when one opens. Removes the
   *  need for any client-side state to drive single-section-open UX.
   *  Supported in all modern browsers (Chrome 120+, Firefox 130+, Safari
   *  17.5+); older browsers degrade gracefully to allowing multiple open
   *  at once. */
  group?: string;
}) {
  const c = FAMILY_COLORS[color];
  return (
    <details
      className="group rounded-md"
      open={defaultOpen}
      name={group}
      style={{ borderLeft: `2px solid ${c.stripe}`, paddingLeft: "8px" }}
    >
      <summary className="cursor-pointer flex items-baseline justify-between gap-2 py-1 list-none">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: c.dot }}
            />
            <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: c.label }}>
              {label}
            </span>
          </div>
          {hint && (
            <div className="text-[10.5px] muted-text mt-0.5 ml-3 leading-snug">
              {hint}
            </div>
          )}
        </div>
        <span aria-hidden className="text-[10px] muted-text opacity-70 group-open:rotate-180 transition-transform">
          ▾
        </span>
      </summary>
      <div className="mt-2 ml-3">{children}</div>
    </details>
  );
}

/** Maturity-tier section divider for tier-grouped results.  Tinted strip
 *  with the same colour family /sectors uses so the visual language is
 *  consistent across both surfaces (compounders = green, established =
 *  teal, emerging = amber, new = slate). */
function TierSectionHeader({ tier, shown, total }: { tier: string; shown: number; total: number }) {
  const colors: Record<string, { stripe: string; bg: string; label: string }> = {
    veteran: { stripe: "#2e9a47", bg: "rgba(46,154,71,0.10)",  label: "#206b32" },
    mature:  { stripe: "#3a9290", bg: "rgba(58,146,144,0.10)", label: "#236663" },
    mid:     { stripe: "#c08e2c", bg: "rgba(192,142,44,0.12)", label: "#8a6116" },
    new:     { stripe: "#7882b8", bg: "rgba(120,130,184,0.12)", label: "#3f4978" },
  };
  const c = colors[tier] ?? { stripe: "var(--color-muted)", bg: "var(--color-paper)", label: "var(--color-muted)" };
  return (
    <div
      className="px-4 md:px-5 py-2.5 flex items-center gap-2.5 rounded-md mb-2"
      style={{ backgroundColor: c.bg }}
    >
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: c.stripe }} />
      <span className="text-[12px] uppercase tracking-wide font-semibold" style={{ color: c.label }}>
        {tierLabel(tier)}s
      </span>
      <span className="tabular-nums text-[11.5px] muted-text">
        · showing {shown} of {total}
      </span>
    </div>
  );
}

/** Compact crore-units formatter, no ₹ / Cr suffix (the column header carries
 *  the unit). 150,000 Cr → "1.50L"; 3,900 Cr → "3.9K"; 850 Cr → "850". */
function fmtMktCapBare(n: number | null): string {
  if (n == null) return "—";
  if (n >= 100_000) return `${(n / 100_000).toFixed(2)}L`;
  if (n >= 1_000)   return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-IN");
}

/**
 * Toolbar above the results table:
 *  - Match count ("Showing 234 of 2,150 stocks")
 *  - Active-filter chips with × buttons (one per applied filter)
 *  - Density toggle (Compact / Comfortable)
 * Renders nothing if there are no active filters AND no count to show, but
 * in practice always renders since we always have a count.
 */
function ResultsToolbar({
  params, total, metas, clusters,
}: {
  params: ScreenerParams;
  total: number;
  metas: MetaOption[];
  clusters: ClusterRow[];
}) {
  const chips: { label: string; clearTo: Partial<ScreenerParams> }[] = [];

  // Sector chips — one per selected meta. Removing one shrinks the set
  // (we also prune industries that lose their parent sector to stay
  // consistent with MetaChips's onApply pruning).
  for (const metaId of params.metas) {
    const meta = metas.find((m) => m.id === metaId);
    if (meta) {
      const remainingMetas = params.metas.filter((id) => id !== metaId);
      const allowedIndustryIds = remainingMetas.length === 0
        ? new Set<string>()
        : new Set(clusters.filter((c) => remainingMetas.includes(c.sector_id)).map((c) => c.id));
      const remainingClusters = params.clusters.filter((id) => allowedIndustryIds.has(id));
      chips.push({
        label: `Sector: ${meta.name}`,
        clearTo: { metas: remainingMetas, clusters: remainingClusters },
      });
    }
  }
  // Industry chips — one per selected cluster.
  for (const clusterId of params.clusters) {
    const cluster = clusters.find((c) => c.id === clusterId);
    if (cluster) chips.push({
      label: `Industry: ${cluster.name}`,
      clearTo: { clusters: params.clusters.filter((id) => id !== clusterId) },
    });
  }
  // Index chip.
  if (params.index) {
    const lbl = INDEX_LABELS[params.index];
    if (lbl) chips.push({ label: `Index: ${lbl}`, clearTo: { index: "" } });
  }
  // Maturity chips.
  for (const t of params.tiers) {
    chips.push({
      label: `Maturity: ${TIER_LABELS[t] || t}`,
      clearTo: { tiers: params.tiers.filter((x) => x !== t) },
    });
  }
  // Market-cap chips.
  for (const c of params.caps) {
    chips.push({
      label: `Cap: ${MKT_CAP_LABELS[c] || c}`,
      clearTo: { caps: params.caps.filter((x) => x !== c) },
    });
  }
  // Min-score chips.
  if (params.minQ > 0) chips.push({ label: `Min Q ≥ ${params.minQ}`, clearTo: { minQ: 0 } });
  if (params.minV > 0) chips.push({ label: `Min V ≥ ${params.minV}`, clearTo: { minV: 0 } });
  if (params.minM > 0) chips.push({ label: `Min M ≥ ${params.minM}`, clearTo: { minM: 0 } });
  if (params.minC > 0) chips.push({ label: `Min Score ≥ ${params.minC}`, clearTo: { minC: 0 } });

  const clearAllHref = "/tools/screener" + paramsToQuery({
    sort: params.sort, dir: params.dir, density: params.density,
  });

  const compactHref     = "/tools/screener" + paramsToQuery({ ...params, density: "compact", page: 1 });
  const comfortableHref = "/tools/screener" + paramsToQuery({ ...params, density: "comfortable", page: 1 });

  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <div className="text-[13px] muted-text">
          Showing <span className="ink-text tabular-nums font-medium">{total.toLocaleString("en-IN")}</span> stock{total === 1 ? "" : "s"}
          {chips.length > 0 && " matching the active filters"}
        </div>
        <div className="inline-flex items-center gap-1 text-[11px]">
          <span className="muted-text mr-1">Density:</span>
          <Link
            href={comfortableHref}
            scroll={false}
            className={`px-2 py-0.5 rounded border ${
              params.density === "comfortable"
                ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
                : "hairline hover:bg-[var(--color-paper)]"
            }`}
          >
            Comfortable
          </Link>
          <Link
            href={compactHref}
            scroll={false}
            className={`px-2 py-0.5 rounded border ${
              params.density === "compact"
                ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
                : "hairline hover:bg-[var(--color-paper)]"
            }`}
          >
            Compact
          </Link>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5">
          {chips.map((c, i) => {
            const href = "/tools/screener" + paramsToQuery({ ...params, ...c.clearTo, page: 1 });
            return (
              <Link
                key={i}
                href={href}
                scroll={false}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border hairline text-[11px] hover:bg-[var(--color-paper)] transition-colors"
              >
                <span>{c.label}</span>
                <span aria-hidden className="muted-text">×</span>
              </Link>
            );
          })}
          <Link
            href={clearAllHref}
            scroll={false}
            className="text-[11px] muted-text underline hover:no-underline ml-1"
          >
            Clear all
          </Link>
        </div>
      )}
    </div>
  );
}

function ResultsTable({
  rows, groupByIndustry, groupByTier = false, tierCounts = {}, params,
}: {
  rows: Row[];
  groupByIndustry: boolean;
  /** When true, bin rows by maturity_tier with section headers.  Used in
   *  sector view (single meta selected) to surface the four maturity
   *  buckets (Long-term Compounder / Established / Emerging / New Listing)
   *  separately, each with a "Show all N →" link. */
  groupByTier?: boolean;
  /** Map of tier code → total count of stocks in that tier within the
   *  current filter scope. Used to render the "Show all N →" links. */
  tierCounts?: Record<string, number>;
  params: ScreenerParams;
}) {
  if (rows.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="font-display text-[20px] mb-2">No matches</div>
        <div className="muted-text text-[14px]">
          Try loosening your minimum scores or expanding the cluster/tier filters.
        </div>
      </div>
    );
  }

  // Tier-grouped layout — runs when sector view is active.  Reads the rows
  // (already top-N per tier from the SQL) and splits into 4 buckets.  Tier
  // order is the curated VETERAN → MATURE → MID → NEW progression so the
  // page reads from "buy-and-hold compounders" at the top to "newly
  // listed" at the bottom.
  if (groupByTier) {
    const TIER_ORDER = ["veteran", "mature", "mid", "new"] as const;
    const byTier = new Map<string, Row[]>();
    for (const r of rows) {
      const t = r.maturity_tier || "—";
      if (!byTier.has(t)) byTier.set(t, []);
      byTier.get(t)!.push(r);
    }
    const orderedTiers = [
      ...TIER_ORDER.filter((t) => byTier.has(t)),
      ...Array.from(byTier.keys()).filter((t) => !(TIER_ORDER as readonly string[]).includes(t)),
    ];
    return (
      <div className="space-y-6">
        {orderedTiers.map((tier) => {
          const bucket = byTier.get(tier)!;
          const total = tierCounts[tier] ?? bucket.length;
          const hasMore = total > bucket.length;
          // "Show all N →" — same screener URL plus `tiers=<tier>` so the
          // user can drill into just that maturity bucket in the active
          // sector. Flat pagination kicks in automatically since
          // `tiers=[one]` exits sector-view mode.
          const showAllHref = "/tools/screener" + paramsToQuery({
            ...params,
            tiers: [tier],
            page: 1,
          });
          return (
            <section key={tier}>
              <TierSectionHeader tier={tier} shown={bucket.length} total={total} />
              <IndustryBlock rows={bucket} showHeader={false} params={params} />
              {hasMore && (
                <div className="mt-2 text-right">
                  <Link
                    href={showAllHref}
                    className="text-[12px] muted-text hover:text-[var(--color-accent-700)] transition-colors"
                  >
                    Show all {total} {tierLabel(tier)}s →
                  </Link>
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  if (!groupByIndustry) {
    return <IndustryBlock rows={rows} showHeader={false} params={params} />;
  }

  // Group rows hierarchically: sector → industries → stocks. The SQL already
  // orders by (sector_name, industry_name, …) so adjacent rows stay grouped.
  type IndustryGroup = { industryId: string; industryName: string; rows: Row[] };
  type SectorGroup = { sectorName: string; industries: IndustryGroup[] };
  const sectors: SectorGroup[] = [];
  for (const r of rows) {
    let sec = sectors[sectors.length - 1];
    if (!sec || sec.sectorName !== r.sector_name) {
      sec = { sectorName: r.sector_name, industries: [] };
      sectors.push(sec);
    }
    let ind = sec.industries[sec.industries.length - 1];
    if (!ind || ind.industryId !== r.industry_id) {
      ind = { industryId: r.industry_id, industryName: r.industry_name, rows: [] };
      sec.industries.push(ind);
    }
    ind.rows.push(r);
  }

  return (
    <div className="space-y-10">
      {sectors.map((sec) => {
        const stockCount = sec.industries.reduce((n, ig) => n + ig.rows.length, 0);
        return (
          <section key={sec.sectorName}>
            <div className="flex items-baseline justify-between mb-4 pb-2 border-b hairline">
              <h2 className="font-display text-[22px] tracking-tight">{sec.sectorName}</h2>
              <div className="text-[11px] uppercase tracking-wide muted-text tabular-nums">
                {sec.industries.length} {sec.industries.length === 1 ? "industry" : "industries"} · {stockCount} {stockCount === 1 ? "stock" : "stocks"}
              </div>
            </div>
            <div className="space-y-6">
              {sec.industries.map((ig) => (
                <IndustryBlock
                  key={ig.industryId}
                  rows={ig.rows}
                  showHeader
                  sectorName={sec.sectorName}
                  industryId={ig.industryId}
                  industryName={ig.industryName}
                  params={params}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function IndustryBlock({
  rows, showHeader, sectorName, industryId, industryName, params,
}: {
  rows: Row[];
  showHeader: boolean;
  sectorName?: string;
  industryId?: string;
  industryName?: string;
  params: ScreenerParams;
}) {
  // Density toggle — compact mode tightens row padding so ~2× more rows fit
  // on a screen without scrolling. Driven by the URL `density` param so the
  // server renders the right class on first paint.
  const compact = params.density === "compact";
  const rowPad = compact ? "px-2 py-1" : "px-3 py-2.5";
  const headerPad = compact ? "px-2 py-2" : "px-3 py-2.5";
  return (
    <div>
      {showHeader && industryId && (
        <div className="flex items-baseline gap-2 mb-2 px-1">
          <span className="text-[10px] uppercase tracking-wide muted-text">{sectorName}</span>
          <span style={{ color: "var(--color-border-default)" }}>·</span>
          <Link href={`/industry/${industryId}`} className="text-[14px] font-medium hover:text-[var(--color-accent-600)]">
            {industryName}
          </Link>
          <span className="text-[11px] muted-text">({rows.length})</span>
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-[var(--color-paper)]">
              <tr className="text-left muted-text text-[10.5px] uppercase tracking-wide">
                <th className={`${headerPad} w-[34px]`}>#</th>
                <SortHeader sortKey="symbol" label="Stock" params={params} align="left" className={headerPad} />
                <th className={`${headerPad} hidden lg:table-cell`}>Industry · Tier</th>
                <SortHeader sortKey="mcap"   label="Mcap" sub="₹ Cr" params={params} align="right" className={headerPad} />
                <SortHeader sortKey="ltp"    label="LTP"  sub="₹"    params={params} align="right" className={headerPad} />
                <SortHeader sortKey="pe"     label="P/E"  sub="TTM"  params={params} align="right" className={headerPad} />
                <SortHeader sortKey="pb"     label="P/B"             params={params} align="right" className={headerPad} />
                <SortHeader
                  sortKey="roe"
                  label={
                    <>
                      ROE / ROCE
                      {/* Visible info icon — invites the hover/tap so users
                          discover the tooltip explaining when ROE vs ROCE is
                          surfaced. Muted color so it doesn't overpower the
                          column label. */}
                      <span
                        aria-hidden="true"
                        className="ml-1 opacity-50 text-[10px] align-text-top"
                      >
                        ⓘ
                      </span>
                    </>
                  }
                  sub="3y"
                  params={params}
                  align="right"
                  className={headerPad}
                  title={"Return on capital, averaged over 3 years.\n\n"
                    + "BFSI / financial stocks use ROE (Return on Equity = Net Profit ÷ Shareholder Equity).\n"
                    + "Other industries use ROCE (Return on Capital Employed = EBIT ÷ (Equity + Debt)).\n\n"
                    + "Higher is better. 15%+ is good, 25%+ is exceptional.\n\n"
                    + "The cluster scorecard picks whichever metric best suits the industry — ROE for "
                    + "banks (equity-driven), ROCE for manufacturing / capital-heavy industries (equity + debt).\n\n"
                    + "See /glossary for full details and examples."}
                />
                <SortHeader sortKey="ret12m" label="1Y Δ" sub="vs market" params={params} align="right" className={headerPad} />
                <SortHeader sortKey="divyld" label="Div"  sub="yield" params={params} align="right" className={headerPad} />
                <SortHeader sortKey="opm"    label="Op M" sub="3y"    params={params} align="right" className={headerPad} />
                <SortHeader sortKey="q"      label="Q"    params={params} align="right" className={headerPad} title="Quality percentile within peer cluster" />
                <SortHeader sortKey="v"      label="V"    params={params} align="right" className={headerPad} title="Valuation percentile within peer cluster" />
                <SortHeader sortKey="m"      label="M"    params={params} align="right" className={headerPad} title="Momentum percentile within peer cluster" />
                <SortHeader sortKey="score"  label="Score" sub="within cluster" params={params} align="right" className={headerPad} title="Peer-relative composite score" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.symbol} className="border-t hairline hover:bg-[var(--color-paper)]/50">
                  <td className={`${rowPad} muted-text tabular-nums text-[11px]`}>{i + 1}</td>
                  <td className={rowPad}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Link href={`/stock/${r.symbol}`} className="font-medium hover:text-[var(--color-accent-600)]">
                        {r.symbol}
                      </Link>
                      {r.score_status && r.score_status !== "full" && (
                        <span
                          className="text-[9.5px] px-1 py-px rounded border"
                          style={{
                            color: "var(--color-score-weak)",
                            borderColor: "var(--color-score-weak)",
                            opacity: 0.8,
                          }}
                          title={
                            r.score_status === "partial-cluster-mixed-tiers"
                              ? "Thin peer group — maturity tiers were merged to reach 10+ peers."
                              : "Very thin peer group — fell back to broader sector comparison."
                          }
                        >
                          thin
                        </span>
                      )}
                    </div>
                    {!compact && (
                      <div className="text-[10.5px] muted-text truncate max-w-[180px]">
                        {r.company_name}
                      </div>
                    )}
                  </td>
                  <td className={`${rowPad} text-[11px] hidden lg:table-cell`}>
                    <Link href={`/industry/${r.industry_id}`} className="hover:text-[var(--color-accent-600)]">
                      {r.industry_name}
                    </Link>
                    {!compact && (
                      <div className="muted-text text-[10px]">{tierLabel(r.maturity_tier)}</div>
                    )}
                  </td>
                  <td className={`${rowPad} text-right tabular-nums text-[11.5px] muted-text`}>
                    {fmtMktCapBare(r.market_cap_cr)}
                  </td>
                  <td className={`${rowPad} text-right tabular-nums text-[11.5px]`}>
                    {fmtNum(r.current_price, 2)}
                  </td>
                  <td className={`${rowPad} text-right tabular-nums text-[11.5px]`}>
                    {fmtNum(r.pe_ttm, 1)}
                  </td>
                  <td className={`${rowPad} text-right tabular-nums text-[11.5px]`}>
                    {fmtNum(r.pb, 2)}
                  </td>
                  <td className={`${rowPad} text-right tabular-nums text-[11.5px]`}>
                    {fmtPctVal(r.roe_3y)}
                  </td>
                  <td className={`${rowPad} text-right tabular-nums text-[11.5px]`}>
                    {fmtPctVal(r.ret_12m_rel, true)}
                  </td>
                  <td className={`${rowPad} text-right tabular-nums text-[11.5px]`}>
                    {fmtPctVal(r.div_yield)}
                  </td>
                  <td className={`${rowPad} text-right tabular-nums text-[11.5px]`}>
                    {fmtPctVal(r.op_margin_3y)}
                  </td>
                  <PillarCell value={r.quality_pct}   highlight={r.leading_pillar === "Q"} className={rowPad} />
                  <PillarCell value={r.valuation_pct} highlight={r.leading_pillar === "V"} className={rowPad} />
                  <PillarCell value={r.momentum_pct}  highlight={r.leading_pillar === "M"} className={rowPad} />
                  <CompositeCell
                    value={r.composite_pct}
                    peerRank={r.peer_rank}
                    peerCount={r.peer_count}
                    leadingPillar={r.leading_pillar}
                    className={rowPad}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Sortable column header. Clicking toggles direction; clicking a different
 * column resets to descending for numeric (typical screener behavior). The
 * link goes back to /tools/screener with the new sort/dir URL params, and
 * the server re-renders.
 */
function SortHeader({
  sortKey, label, sub, params, align, className = "", title,
}: {
  sortKey: SortParam;
  /** label is ReactNode so callers can embed inline icons (e.g. an info
   *  glyph next to the column name). Plain strings still work. */
  label: React.ReactNode;
  sub?: string;
  params: ScreenerParams;
  align: "left" | "right";
  className?: string;
  title?: string;
}) {
  const isActive = params.sort === sortKey;
  // Toggle direction if clicking the active column; otherwise default to desc
  // (descending — the typical "top of the list" expectation for percentile
  // columns and most fundamentals). Exception: symbol defaults to ascending.
  const nextDir: "asc" | "desc" = isActive
    ? (params.dir === "asc" ? "desc" : "asc")
    : (sortKey === "symbol" ? "asc" : "desc");
  const href = "/tools/screener" + paramsToQuery({ ...params, sort: sortKey, dir: nextDir, page: 1 });
  const arrow = isActive ? (params.dir === "asc" ? "▲" : "▼") : "";
  return (
    <th className={`${className} ${align === "right" ? "text-right" : "text-left"}`} title={title}>
      <Link
        href={href}
        scroll={false}
        className={`inline-flex items-${align === "right" ? "end" : "start"} flex-col gap-0 hover:text-[var(--color-ink)] transition-colors ${
          isActive ? "ink-text" : ""
        }`}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {arrow && <span className="text-[9px]">{arrow}</span>}
        </span>
        {sub && <span className="text-[9px] muted-text font-normal normal-case">{sub}</span>}
      </Link>
    </th>
  );
}

/** Format a number with given decimals, "—" for null. */
function fmtNum(n: number | null, decimals = 2): React.ReactNode {
  if (n == null) return <span className="muted-text">—</span>;
  return n.toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

/** Format a decimal as a percent (0.18 → "18.0%"). When `signed`, prefix +/-
 * and color positive green / negative red — used for return columns where
 * sign carries meaning. */
function fmtPctVal(n: number | null, signed = false): React.ReactNode {
  if (n == null) return <span className="muted-text">—</span>;
  const pct = n * 100;
  const formatted = pct.toLocaleString("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  if (!signed) return `${formatted}%`;
  const color = pct >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)";
  const sign = pct >= 0 ? "+" : "";
  return <span style={{ color }}>{sign}{formatted}%</span>;
}

function PillarCell({
  value, highlight, className = "px-3 py-3",
}: { value: number | null; highlight?: boolean; className?: string }) {
  const b = band(value);
  const isNull = value == null;
  const showHighlight = highlight && !isNull;
  return (
    <td className={`${className} text-right tabular-nums${showHighlight ? " bg-[var(--color-paper)]" : ""}`}>
      <span
        style={{ color: isNull ? "var(--color-muted)" : bandColor(b) }}
        className={`${showHighlight ? "font-bold" : "font-medium"}${isNull ? " opacity-40" : ""}`}
        title={isNull ? "No data — excluded from Industry Score" : undefined}
      >
        {fmtPct(value, "")}
      </span>
    </td>
  );
}

const PILLAR_LABEL: Record<string, string> = { Q: "Quality", V: "Valuation", M: "Momentum" };

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function CompositeCell({
  value, peerRank, peerCount, leadingPillar, className = "px-4 py-3",
}: {
  value: number | null;
  peerRank: number | null;
  peerCount: number | null;
  leadingPillar: string | null;
  className?: string;
}) {
  const b = band(value);
  const rankLabel = peerRank != null && peerCount != null
    ? `${ordinal(peerRank)} of ${peerCount}`
    : null;
  void leadingPillar; // pillar label hidden in spreadsheet view (column shows it)

  return (
    <td className={`${className} text-right`}>
      <span
        className="inline-block min-w-[36px] text-center px-2 py-0.5 rounded-md tabular-nums text-[11.5px]"
        style={{
          backgroundColor: bandColor(b),
          color: b === "neutral" ? "var(--color-ink)" : "white",
        }}
      >
        {value == null ? "—" : Math.round(value)}
      </span>
      {rankLabel && <div className="mt-0.5 text-[9.5px] muted-text tabular-nums leading-tight">{rankLabel}</div>}
    </td>
  );
}

function Pagination({
  params, totalPages,
}: { params: ScreenerParams; totalPages: number }) {
  const page = params.page;
  const buildHref = (p: number) =>
    "/tools/screener" + paramsToQuery({ ...params, page: p });
  const isIndustryView = params.clusters.length === 1;

  const pages: number[] = [];
  const window = 2;
  const start = Math.max(1, page - window);
  const end = Math.min(totalPages, page + window);
  for (let i = start; i <= end; i++) pages.push(i);

  // Per-sector / page-size picker — sits to the right of the page buttons so
  // users can switch "10 per sector" ↔ "20" ↔ "50" without leaving the
  // results. Resets to page 1 on change to keep the user from landing past
  // the new last page.
  const sizeOptions = [10, 20, 50] as const;
  const sizeLabel = isIndustryView ? "per page" : "per sector";

  return (
    <nav className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[13px]">
      {totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <PageBtn href={buildHref(Math.max(1, page - 1))} disabled={page === 1}>← Prev</PageBtn>
          {start > 1 && (
            <>
              <PageBtn href={buildHref(1)}>1</PageBtn>
              {start > 2 && <span className="muted-text">…</span>}
            </>
          )}
          {pages.map((p) => (
            <PageBtn key={p} href={buildHref(p)} active={p === page}>
              {p}
            </PageBtn>
          ))}
          {end < totalPages && (
            <>
              {end < totalPages - 1 && <span className="muted-text">…</span>}
              <PageBtn href={buildHref(totalPages)}>{totalPages}</PageBtn>
            </>
          )}
          <PageBtn href={buildHref(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
            Next →
          </PageBtn>
        </div>
      )}
      <div className="flex items-center gap-1.5 ml-auto sm:ml-2">
        <span className="muted-text text-[11.5px]">Show</span>
        {sizeOptions.map((n) => {
          const href = "/tools/screener" + paramsToQuery({
            ...params,
            perSector: n,
            page: 1,
          });
          const active = params.perSector === n;
          return (
            <PageBtn key={n} href={href} active={active}>
              {n}
            </PageBtn>
          );
        })}
        <span className="muted-text text-[11.5px]">{sizeLabel}</span>
      </div>
    </nav>
  );
}

function PageBtn({
  href, children, active, disabled,
}: { href: string; children: React.ReactNode; active?: boolean; disabled?: boolean }) {
  const cls = `inline-flex items-center px-2.5 py-1 rounded-md tabular-nums border ${
    active
      ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
      : "hairline text-[var(--color-ink)] hover:bg-[var(--color-paper)]"
  } ${disabled ? "opacity-40 pointer-events-none" : ""}`;
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

function MethodologyFooter() {
  return (
    <footer className="mt-12 pt-8 border-t hairline text-[13px] leading-relaxed muted-text max-w-[900px]">
      <h2 className="font-display text-[20px] tracking-tight mb-4 ink-text">
        About Industry Score
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
        <Section title="How it is computed">
          <p>
            For each <em>(cluster, tier)</em> peer group, every formula is ranked as a
            percentile against peers. Those percentiles are weighted within each pillar —
            <strong className="ink-text"> Quality</strong>,{" "}
            <strong className="ink-text">Valuation</strong>,{" "}
            <strong className="ink-text">Momentum</strong> — using sector-tuned weights,
            then blended and re-percentiled once more within the peer group.
          </p>
          <p className="mt-2">
            Industry Score = 96 means the stock is in the top 4% of its peer cluster —
            not the whole market.
          </p>
        </Section>

        <Section title="What Q · V · M show">
          <p>
            The three pillar columns show the score <em>before</em> the final
            re-ranking — they reveal the shape of the quality. A stock can reach 90 on
            Industry Score driven entirely by momentum (M=95, Q=40, V=35) or by being
            well-rounded across all three. Q · V · M let you see which.
          </p>
          <p className="mt-2">
            Want to apply your own Q / V / M weights?{" "}
            <Link href="/tools/investing-trials" className="underline hover:no-underline ink-text">
              Try Investing Trials →
            </Link>
          </p>
        </Section>
      </div>

      <h3 className="font-display text-[16px] mt-8 mb-3 ink-text">
        How the pillar scores are derived
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-4">
        <PillarBlock
          name="Quality"
          color="var(--color-accent-600)"
          desc="Long-term operational durability — returns on capital, growth, growth consistency, cash conversion, balance-sheet discipline, and margin trends. The specific inputs vary by sector."
        />
        <PillarBlock
          name="Valuation"
          color="var(--color-accent-400)"
          desc="Price vs fundamentals relative to peers — earnings, book value, EBITDA, free cash flow, dividend yield. The relative weight of each input varies by sector; loss-makers fall back to revenue-based or book-based metrics."
        />
        <PillarBlock
          name="Momentum"
          color="var(--color-accent-300)"
          desc="Both price action (multi-horizon returns vs the broader market, trend strength) and earnings momentum (latest-quarter year-over-year growth)."
        />
      </div>

      <div className="mt-8 p-4 rounded-md" style={{ backgroundColor: "var(--color-paper)" }}>
        <div className="font-medium text-[13px] ink-text mb-1">Why peer-relative?</div>
        <p>
          Comparing a small-cap bank to HDFC Bank on absolute RoE is meaningless.
          Comparing it to other small-cap banks on the same scorecard is. Every score on
          this page is a percentile within the stock&apos;s <em>(cluster, maturity-tier)</em>
          peer group, so a 75 always means &quot;top 25% within its bucket&quot; — apples
          to apples.
        </p>
      </div>

      <p className="mt-6 text-[12px]">
        <Link href="/about" className="underline hover:no-underline">
          Read the full methodology →
        </Link>
      </p>
    </footer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-medium text-[14px] ink-text mb-2">{title}</div>
      {children}
    </div>
  );
}

function PillarBlock({ name, color, desc }: { name: string; color: string; desc: string }) {
  return (
    <div className="border-l-2 pl-3" style={{ borderColor: color }}>
      <div className="font-medium ink-text" style={{ color }}>{name}</div>
      <p className="mt-1 text-[12.5px]">{desc}</p>
    </div>
  );
}
