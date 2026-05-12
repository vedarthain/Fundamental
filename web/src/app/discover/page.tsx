import Link from "next/link";
import { sql } from "@/lib/db";
import { band, bandColor, fmtPct, fmtRupeesCr, tierLabel } from "@/lib/score";
import { Controls } from "./Controls";
import { MetaChips, type MetaOption } from "./MetaChips";
import { SubClusterChips, type ClusterRow } from "./SubClusterChips";
import { AboutCard } from "./AboutCard";
import {
  PAGE_SIZE, parseParams, paramsToQuery, type ScreenerParams,
} from "./types";

export const revalidate = 600;
export const dynamic = "force-dynamic"; // search-param driven

type Row = {
  symbol: string;
  company_name: string;
  cluster_id: string;
  cluster_name: string;
  meta_cluster_name: string;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  price_fetched_at: string | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  composite_pct: number | null;
  blend: number | null;
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
    SELECT c.id, c.name, c.meta_cluster_id
    FROM app.cluster c
    WHERE c.id <> 'unclassified'
    ORDER BY c.name
  `;
}

async function loadRows(p: ScreenerParams): Promise<{ rows: Row[]; total: number }> {
  const { weights: w, clusters, metas, tiers, caps, minQ, minV, minM, minC, page } = p;
  const offset = (page - 1) * PAGE_SIZE;

  const clusterFilter = clusters.length
    ? sql`AND s.cluster_id = ANY(${clusters})`
    : sql``;
  const metaFilter = metas.length
    ? sql`AND c.meta_cluster_id = ANY(${metas})`
    : sql``;
  const tierFilter = tiers.length
    ? sql`AND s.maturity_tier = ANY(${tiers})`
    : sql``;
  const capFilter = caps.length
    ? sql`AND u.market_cap_category = ANY(${caps})`
    : sql``;

  const totalRows = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM app.scores s
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = s.cluster_id
    WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
      ${clusterFilter} ${metaFilter} ${tierFilter} ${capFilter}
      AND COALESCE(s.quality_pct, 0)   >= ${minQ}
      AND COALESCE(s.valuation_pct, 0) >= ${minV}
      AND COALESCE(s.momentum_pct, 0)  >= ${minM}
      AND COALESCE(s.composite_pct, 0) >= ${minC}
  `;
  const total = totalRows[0]?.n ?? 0;

  const rows = await sql<Row[]>`
    SELECT s.symbol,
           u.company_name,
           s.cluster_id,
           c.name AS cluster_name,
           mc.name AS meta_cluster_name,
           s.maturity_tier,
           sm.market_cap_cr,
           sm.current_price::float AS current_price,
           sm.last_scraped_at::text AS price_fetched_at,
           s.quality_pct,
           s.valuation_pct,
           s.momentum_pct,
           s.composite_pct,
           ROUND(
             (COALESCE(s.quality_pct, 0)   * ${w.q} +
              COALESCE(s.valuation_pct, 0) * ${w.v} +
              COALESCE(s.momentum_pct, 0)  * ${w.m}) / 100.0
           )::int AS blend
    FROM app.scores s
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = s.cluster_id
    JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    LEFT JOIN app.screener_meta sm USING (symbol)
    WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
      ${clusterFilter} ${metaFilter} ${tierFilter} ${capFilter}
      AND COALESCE(s.quality_pct, 0)   >= ${minQ}
      AND COALESCE(s.valuation_pct, 0) >= ${minV}
      AND COALESCE(s.momentum_pct, 0)  >= ${minM}
      AND COALESCE(s.composite_pct, 0) >= ${minC}
    ORDER BY blend DESC NULLS LAST, s.composite_pct DESC NULLS LAST
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
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
            Find stocks by <em className="accent">your priorities</em>
          </h1>
          <p className="mt-3 text-[15px] muted-text">
            Pick a preset or set your own Quality / Valuation / Momentum weights — every stock
            is re-ranked by your blend within its peer cluster. Filter by sector, industry,
            maturity, or market cap to narrow further.
          </p>
          <div className="mt-3 text-[12px] muted-text">
            Active blend:{" "}
            <span className="tabular-nums">
              {params.weights.q} / {params.weights.v} / {params.weights.m}
            </span>{" "}
            ({params.preset === "custom" ? "Custom" : params.preset[0].toUpperCase() + params.preset.slice(1)}){" "}
            · {total.toLocaleString("en-IN")} matches
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

        <Link
          href="/compare"
          className="inline-flex items-center gap-2.5 card px-4 py-3 hover:border-[var(--color-accent-400)] transition-colors group shrink-0"
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

      <div className="mt-6 max-w-[820px]">
        <AboutCard />
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
        {/* Sticky sidebar: pinned to top-20 on desktop, with its own internal
            scroll so tall filter panels don't get clipped below the viewport.
            max-h subtracts the 5rem top offset + a small gutter. */}
        <aside
          className="card p-5 self-start lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
        >
          <Controls />
        </aside>

        <main>
          <div className="mb-4 space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide muted-text mb-2">Sector</div>
              <MetaChips metas={metas} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide muted-text mb-2">Industry</div>
              <SubClusterChips clusters={clusters} />
            </div>
          </div>
          <ResultsTable rows={rows} weights={params.weights} />
          <Pagination params={params} totalPages={totalPages} />
          <MethodologyFooter weights={params.weights} />
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

function ResultsTable({ rows, weights }: { rows: Row[]; weights: { q: number; v: number; m: number } }) {
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

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-[14px]">
        <thead className="bg-[var(--color-paper)]">
          <tr className="text-left muted-text text-[11px] uppercase tracking-wide">
            <th className="px-4 py-3 w-[34px]">#</th>
            <th className="px-4 py-3">Stock</th>
            <th className="px-4 py-3">Sector · Cluster · Tier</th>
            <th className="px-4 py-3 text-right">
              Mkt cap
              <div className="text-[9px] muted-text font-normal normal-case mt-0.5">(₹ Cr)</div>
            </th>
            <th className="px-3 py-3 text-right" title="Last traded price (from latest Screener fetch)">
              LTP
              <div className="text-[9px] muted-text font-normal normal-case mt-0.5">(₹)</div>
            </th>
            <th className="px-3 py-3 text-right" title={`Quality (weight ${weights.q}%)`}>
              Q <span className="text-[9px] muted-text">{weights.q}%</span>
            </th>
            <th className="px-3 py-3 text-right" title={`Valuation (weight ${weights.v}%)`}>
              V <span className="text-[9px] muted-text">{weights.v}%</span>
            </th>
            <th className="px-3 py-3 text-right" title={`Momentum (weight ${weights.m}%)`}>
              M <span className="text-[9px] muted-text">{weights.m}%</span>
            </th>
            <th className="px-4 py-3 text-right" title="Platform-default cluster-tuned blend">
              Composite
              <div className="text-[9px] muted-text font-normal normal-case mt-0.5">
                cluster default
              </div>
            </th>
            <th className="px-4 py-3 text-right">
              Custom Score
              <div className="text-[9px] muted-text font-normal normal-case mt-0.5 tabular-nums">
                Q {weights.q} · V {weights.v} · M {weights.m}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.symbol} className="border-t hairline hover:bg-[var(--color-paper)]/50">
              <td className="px-4 py-3 muted-text tabular-nums text-[12px]">{i + 1}</td>
              <td className="px-4 py-3">
                <Link href={`/stock/${r.symbol}`} className="font-medium hover:text-[var(--color-accent-600)]">
                  {r.symbol}
                </Link>
                <div className="text-[12px] muted-text truncate max-w-[260px]">
                  {r.company_name}
                </div>
              </td>
              <td className="px-4 py-3 text-[12px]">
                <div className="text-[10px] uppercase tracking-wide muted-text mb-0.5">
                  {r.meta_cluster_name}
                </div>
                <Link href={`/cluster/${r.cluster_id}`} className="hover:text-[var(--color-accent-600)]">
                  {r.cluster_name}
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
              <PillarCell value={r.quality_pct} />
              <PillarCell value={r.valuation_pct} />
              <PillarCell value={r.momentum_pct} />
              <CompositeCell value={r.composite_pct} />
              <BlendCell value={r.blend} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PillarCell({ value }: { value: number | null }) {
  const b = band(value);
  return (
    <td className="px-3 py-3 text-right tabular-nums">
      <span style={{ color: bandColor(b) }} className="font-medium">
        {fmtPct(value, "")}
      </span>
    </td>
  );
}

function CompositeCell({ value }: { value: number | null }) {
  const b = band(value);
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
    </td>
  );
}

function BlendCell({ value }: { value: number | null }) {
  const b = band(value);
  return (
    <td className="px-4 py-3 text-right">
      <span
        className="inline-block min-w-[44px] text-center px-2.5 py-0.5 rounded-md tabular-nums font-medium text-[13px]"
        style={{
          backgroundColor: bandColor(b),
          color: b === "neutral" ? "var(--color-ink)" : "white",
        }}
      >
        {value == null ? "—" : Math.round(value)}
      </span>
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

function MethodologyFooter({ weights }: { weights: { q: number; v: number; m: number } }) {
  return (
    <footer className="mt-12 pt-8 border-t hairline text-[13px] leading-relaxed muted-text max-w-[900px]">
      <h2 className="font-display text-[20px] tracking-tight mb-4 ink-text">
        About the scores
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
        <Section title="Composite — the platform default">
          <p>
            The platform&apos;s default ranking, computed once per snapshot. For each
            <em> (cluster, tier)</em> peer group we percentile every stock against its
            peers on three pillars — <strong className="ink-text">Quality</strong>,
            {" "}<strong className="ink-text">Valuation</strong>,
            {" "}<strong className="ink-text">Momentum</strong> — then blend the three
            using <em>sector-tuned weights</em> and re-percentile the result.
          </p>
          <p className="mt-2">
            Composite = 100 means &quot;best in this peer group on the platform&apos;s
            standard scorecard&quot;.
          </p>
        </Section>

        <Section title="Custom Score — your weighted blend">
          <p>
            The same Quality / Valuation / Momentum percentiles, but blended using
            <strong className="ink-text"> your</strong> slider weights — currently{" "}
            <span className="tabular-nums ink-text">
              {weights.q} / {weights.v} / {weights.m}
            </span>. Lets you stress-test how rankings shift under a value-tilt,
            growth-tilt, momentum-tilt, or any custom mix.
          </p>
          <p className="mt-2">
            A stock can score low on Composite (under-rated by the platform default)
            but high on Custom Score if your weights favour what it&apos;s good at — and
            vice versa.
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
