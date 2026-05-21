import Link from "next/link";
import { sql } from "@/lib/db";
import { band, bandColor, fmtPct, tierLabel } from "@/lib/score";
import { Controls } from "./Controls";
import { MetaChips, type MetaOption } from "./MetaChips";
import { SubClusterChips, type ClusterRow } from "./SubClusterChips";
import { IndexChips } from "./IndexChips";
import { INDEX_COLUMNS } from "./types";
import { AboutCard } from "./AboutCard";
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

async function loadRows(p: ScreenerParams): Promise<{ rows: Row[]; total: number }> {
  const { clusters, metas, tiers, caps, index, minQ, minV, minM, minC, page } = p;
  const offset = (page - 1) * PAGE_SIZE;

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
  const tailOrder = isIndustryView
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

  const totalRows = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM app.scores s
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = s.cluster_id
    WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
      ${clusterFilter} ${metaFilter} ${tierFilter} ${capFilter} ${indexFilter}
      AND COALESCE(s.quality_pct, 0)   >= ${minQ}
      AND COALESCE(s.valuation_pct, 0) >= ${minV}
      AND COALESCE(s.momentum_pct, 0)  >= ${minM}
      AND COALESCE(s.composite_pct, 0) >= ${minC}
  `;
  const total = totalRows[0]?.n ?? 0;

  // Always paginate now — the results table is a flat ranked list across all
  // matching stocks. No per-industry top-N cap and no industry-block grouping.
  void isIndustryView;
  const limitClause = sql`LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
  const perIndustryClause = sql``;

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
             )::int AS display_rank
      FROM ranked r
      JOIN app.universe u USING (symbol)
      JOIN app.cluster c ON c.id = r.cluster_id
      JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
      LEFT JOIN app.screener_meta sm USING (symbol)
      WHERE u.is_active
        ${clusterFilterR} ${metaFilter} ${tierFilterR} ${capFilter} ${indexFilter}
        AND COALESCE(r.quality_pct, 0)   >= ${minQ}
        AND COALESCE(r.valuation_pct, 0) >= ${minV}
        AND COALESCE(r.momentum_pct, 0)  >= ${minM}
        AND COALESCE(r.composite_pct, 0) >= ${minC}
    )
    SELECT symbol, company_name, industry_id, industry_name, sector_name,
           maturity_tier, market_cap_cr, current_price, price_fetched_at,
           quality_pct, valuation_pct, momentum_pct, composite_pct,
           peer_rank, peer_count, leading_pillar, score_status
    FROM joined
    ${perIndustryClause}
    ORDER BY
      (score_status = 'full') DESC,
      (quality_pct IS NOT NULL
       AND valuation_pct IS NOT NULL
       AND momentum_pct IS NOT NULL) DESC,
      ${tailOrder}
    ${limitClause}
  `;
  return { rows, total };
}

export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const params = parseParams(sp);
  const [metas, clusters, { rows, total }, coverage] = await Promise.all([
    loadMetas(),
    loadClusters(),
    loadRows(params),
    loadCoverage(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
            <span>Discover</span>
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

        <div className="flex flex-col gap-3 shrink-0">
          <Link
            href="/screen"
            className="inline-flex items-center gap-2.5 card px-4 py-3 hover:border-[var(--color-accent-400)] transition-colors group"
            style={{ borderTop: "3px solid var(--color-accent-500)" }}
          >
            <span className="text-[11px] uppercase tracking-wide muted-text">Tool</span>
            <span className="border-l hairline pl-3">
              <div className="text-[13.5px] font-medium" style={{ color: "var(--color-ink)" }}>
                Investing Trials →
              </div>
              <div className="text-[11px] muted-text mt-0.5 max-w-[180px] leading-snug">
                Re-rank stocks with your own Q / V / M weights.
              </div>
            </span>
          </Link>
          <Link
            href="/compare"
            className="inline-flex items-center gap-2.5 card px-4 py-3 hover:border-[var(--color-accent-400)] transition-colors group"
            style={{ borderTop: "3px solid var(--color-accent-500)" }}
          >
            <span className="text-[11px] uppercase tracking-wide muted-text">Tool</span>
            <span className="border-l hairline pl-3">
              <div className="text-[13.5px] font-medium" style={{ color: "var(--color-ink)" }}>
                Peer comparison →
              </div>
              <div className="text-[11px] muted-text mt-0.5 max-w-[180px] leading-snug">
                Stack 2–5 stocks side by side on the same scorecard.
              </div>
            </span>
          </Link>
        </div>
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
          className="card p-5 self-start lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
        >
          <div className="space-y-5">
            <div>
              <div className="text-[11px] uppercase tracking-wide muted-text mb-2">Sector</div>
              <MetaChips metas={metas} clusters={clusters} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide muted-text mb-2">Industry</div>
              <SubClusterChips clusters={clusters} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide muted-text mb-2">Index membership</div>
              <IndexChips />
            </div>
          </div>
          <div className="mt-6 pt-5 border-t hairline">
            <Controls />
          </div>
        </aside>

        <main>
          <ResultsTable rows={rows} groupByIndustry={false} />
          <Pagination params={params} totalPages={totalPages} />
          <MethodologyFooter />
        </main>
      </div>
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

function ResultsTable({ rows, groupByIndustry }: { rows: Row[]; groupByIndustry: boolean }) {
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

  if (!groupByIndustry) {
    return <IndustryBlock rows={rows} showHeader={false} />;
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
  rows, showHeader, sectorName, industryId, industryName,
}: {
  rows: Row[];
  showHeader: boolean;
  sectorName?: string;
  industryId?: string;
  industryName?: string;
}) {
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
        <table className="w-full text-[14px]">
          <thead className="bg-[var(--color-paper)]">
            <tr className="text-left muted-text text-[11px] uppercase tracking-wide">
              <th className="px-4 py-3 w-[34px]">#</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Sector · Industry · Tier</th>
              <th className="px-4 py-3 text-right">
                Mkt cap
                <div className="text-[9px] muted-text font-normal normal-case mt-0.5">(₹ Cr)</div>
              </th>
              <th className="px-3 py-3 text-right" title="Last traded price">
                LTP
                <div className="text-[9px] muted-text font-normal normal-case mt-0.5">(₹)</div>
              </th>
              <th className="px-3 py-3 text-right" title="Quality percentile within peer cluster">
                Q
                <div className="text-[9px] muted-text font-normal normal-case mt-0.5">quality</div>
              </th>
              <th className="px-3 py-3 text-right" title="Valuation percentile within peer cluster">
                V
                <div className="text-[9px] muted-text font-normal normal-case mt-0.5">valuation</div>
              </th>
              <th className="px-3 py-3 text-right" title="Momentum percentile within peer cluster">
                M
                <div className="text-[9px] muted-text font-normal normal-case mt-0.5">momentum</div>
              </th>
              <th className="px-4 py-3 text-right" title="Peer-relative composite score using sector-tuned weights. 96 = top 4% of its cluster.">
                Industry Score
                <div className="text-[9px] muted-text font-normal normal-case mt-0.5">within cluster</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.symbol} className="border-t hairline hover:bg-[var(--color-paper)]/50">
                <td className="px-4 py-3 muted-text tabular-nums text-[12px]">{i + 1}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Link href={`/stock/${r.symbol}`} className="font-medium hover:text-[var(--color-accent-600)]">
                      {r.symbol}
                    </Link>
                    {r.score_status && r.score_status !== "full" && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded border"
                        style={{
                          color: "var(--color-score-weak)",
                          borderColor: "var(--color-score-weak)",
                          opacity: 0.8,
                        }}
                        title={
                          r.score_status === "partial-cluster-mixed-tiers"
                            ? "Thin peer group — maturity tiers were merged to reach 10+ peers. Score is less precise."
                            : "Very thin peer group — fell back to broader sector comparison. Score is least precise."
                        }
                      >
                        thin bucket
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] muted-text truncate max-w-[260px]">
                    {r.company_name}
                  </div>
                </td>
                <td className="px-4 py-3 text-[12px]">
                  <div className="text-[10px] uppercase tracking-wide muted-text mb-0.5">
                    {r.sector_name}
                  </div>
                  <Link href={`/industry/${r.industry_id}`} className="hover:text-[var(--color-accent-600)]">
                    {r.industry_name}
                  </Link>
                  <div className="muted-text">{tierLabel(r.maturity_tier)}</div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[12px] muted-text">
                  {fmtMktCapBare(r.market_cap_cr)}
                </td>
                <td
                  className="px-3 py-3 text-right tabular-nums text-[12.5px]"
                  title={
                    r.price_fetched_at
                      ? `Fetched ${new Date(r.price_fetched_at).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })}`
                      : "No price data"
                  }
                >
                  {r.current_price != null
                    ? r.current_price.toLocaleString("en-IN", { maximumFractionDigits: 2 })
                    : <span className="muted-text">—</span>}
                </td>
                <PillarCell value={r.quality_pct} highlight={r.leading_pillar === "Q"} />
                <PillarCell value={r.valuation_pct} highlight={r.leading_pillar === "V"} />
                <PillarCell value={r.momentum_pct} highlight={r.leading_pillar === "M"} />
                <CompositeCell
                  value={r.composite_pct}
                  peerRank={r.peer_rank}
                  peerCount={r.peer_count}
                  leadingPillar={r.leading_pillar}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PillarCell({ value, highlight }: { value: number | null; highlight?: boolean }) {
  const b = band(value);
  const isNull = value == null;
  const showHighlight = highlight && !isNull;
  return (
    <td className={`px-3 py-3 text-right tabular-nums${showHighlight ? " bg-[var(--color-paper)]" : ""}`}>
      <span
        style={{ color: isNull ? "var(--color-muted)" : bandColor(b) }}
        className={`${showHighlight ? "font-bold" : "font-medium"}${isNull ? " opacity-40" : ""}`}
        title={isNull ? "No data — excluded from Industry Score" : undefined}
      >
        {fmtPct(value, "")}
      </span>
      {showHighlight && (
        <div className="text-[9px] muted-text mt-0.5">leading</div>
      )}
      {isNull && (
        <div className="text-[9px] mt-0.5" style={{ color: "var(--color-muted)" }}>no data</div>
      )}
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
  value, peerRank, peerCount, leadingPillar,
}: {
  value: number | null;
  peerRank: number | null;
  peerCount: number | null;
  leadingPillar: string | null;
}) {
  const b = band(value);
  const rankLabel = peerRank != null && peerCount != null
    ? `${ordinal(peerRank)} of ${peerCount}`
    : null;
  const pillarLabel = leadingPillar ? PILLAR_LABEL[leadingPillar] : null;

  return (
    <td className="px-4 py-3 text-right">
      <span
        className="inline-block min-w-[36px] text-center px-2 py-0.5 rounded-md tabular-nums text-[12px]"
        style={{
          backgroundColor: bandColor(b),
          color: b === "neutral" ? "var(--color-ink)" : "white",
        }}
      >
        {value == null ? "—" : Math.round(value)}
      </span>
      {rankLabel && <div className="mt-1 text-[10px] muted-text tabular-nums leading-tight">{rankLabel}</div>}
      {pillarLabel && <div className="text-[10px] muted-text leading-tight">{pillarLabel}</div>}
    </td>
  );
}

function Pagination({
  params, totalPages,
}: { params: ScreenerParams; totalPages: number }) {
  if (totalPages <= 1) return null;
  const page = params.page;
  const buildHref = (p: number) =>
    "/discover" + paramsToQuery({ ...params, page: p });

  const pages: number[] = [];
  const window = 2;
  const start = Math.max(1, page - window);
  const end = Math.min(totalPages, page + window);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <nav className="mt-5 flex items-center justify-center gap-1.5 text-[13px]">
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
            <Link href="/screen" className="underline hover:no-underline ink-text">
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
