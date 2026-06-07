import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, golden } from "@/lib/db";
import { band, bandColor, fmtPct, fmtRupeesCr, tierLabel } from "@/lib/score";
import { StrengthBars } from "@/components/StrengthBars";
import { WatchlistButton } from "@/components/WatchlistButton";
import { PriceChart, type PricePoint } from "@/components/PriceChart";
import type { SparkPoint } from "@/components/Sparkline";
import { PillarTabs, type PillarTabContent } from "@/components/PillarTabs";
import { buildSpider } from "@/lib/spider";
import { buildPillarStory } from "@/lib/explainer";
import {
  qualityNarration, valuationNarration, momentumNarration,
} from "@/lib/companyNarration";
import { BusinessVisual } from "@/components/BusinessVisual";
import { StockPageTabs } from "@/components/StockPageTabs";
import { TrendSection, TrendCommentary } from "@/components/TrendSection";
import { loadPersistenceForSymbol } from "@/lib/persistence";

// Stock fundamentals + scores change weekly at most. 6h cache cuts Neon wakes
// significantly — with 2,000+ stock pages each revalidating at 30min, the
// previous setting caused up to 4,000 DB wakes/day from ISR alone.
export const revalidate = 21600;

type ShareholdingRow = {
  period_end: string;
  promoter_pct: number | null;
  fii_pct: number | null;
  dii_pct: number | null;
  government_pct: number | null;
  public_pct: number | null;
  shareholders: number | null;
};

type Stock = {
  symbol: string;
  company_name: string;
  sector: string | null;
  industry: string | null;
  listing_date: string | null;
  years_of_data: number | null;
  business_summary: string | null;
  website: string | null;
  employees: number | null;
  ceo_name: string | null;
  ceo_title: string | null;
  industry_id: string;
  industry_name: string;
  sector_id: string;
  sector_name: string;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  price_fetched_at: string | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  quality_components: Record<string, number>;
  valuation_components: Record<string, number>;
  momentum_components: Record<string, number>;
  score_status: string | null;
};

type AnnualRow = {
  period_end: string;
  sales: number | null;
  operating_profit: number | null;
  net_profit: number | null;
  cash_from_operating: number | null;
  total_assets: number | null;
  borrowings: number | null;
  equity_share_capital: number | null;
  reserves: number | null;
  depreciation: number | null;
  interest: number | null;
  profit_before_tax: number | null;
};

type QuarterlyRow = {
  period_end: string;
  sales: number | null;
  operating_profit: number | null;
  net_profit: number | null;
};

type Scorecard = {
  pillar_weights: Record<string, number>;
  quality: Record<string, number>;
  valuation: Record<string, number>;
  momentum: Record<string, number>;
};

async function loadStock(symbol: string) {
  const upper = symbol.toUpperCase();
  const rows = await sql<Stock[]>`
    SELECT
      s.symbol, u.company_name, u.sector, u.industry, u.listing_date::text, u.years_of_data,
      u.business_summary, u.website, u.employees,
      u.ceo_name, u.ceo_title,
      s.cluster_id AS industry_id, c.name AS industry_name, mc.id AS sector_id, mc.name AS sector_name,
      s.maturity_tier, sm.market_cap_cr, sm.current_price,
      sm.price_fetched_at::text,
      s.composite_pct, s.quality_pct, s.valuation_pct, s.momentum_pct,
      s.quality_components, s.valuation_components, s.momentum_components,
      s.score_status
    FROM app.scores s
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = s.cluster_id
    JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    LEFT JOIN app.screener_meta sm USING (symbol)
    WHERE s.symbol = ${upper}
    ORDER BY s.snapshot_date DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const stock = rows[0];

  // Last 10 fiscal years of annual fundamentals (extended cols for trend graphs).
  // Using a date filter (not LIMIT 10) so stocks with reporting gaps don't
  // pull in orphan blocks of older data e.g. SOTL whose source has a 12-year
  // gap from FY10–FY20. CAST numeric → float so JS treats them as numbers.
  const annual = await sql<AnnualRow[]>`
    SELECT period_end::text,
           sales::float, operating_profit::float, net_profit::float, cash_from_operating::float,
           total_assets::float, borrowings::float,
           equity_share_capital::float, reserves::float,
           depreciation::float, interest::float, profit_before_tax::float
    FROM app.fundamentals_annual
    WHERE symbol = ${upper}
      AND period_end >= (CURRENT_DATE - INTERVAL '10 years')
    ORDER BY period_end DESC
    LIMIT 10
  `;
  // Latest 6 quarters
  const quarterly = await sql<QuarterlyRow[]>`
    SELECT period_end::text,
           sales::float, operating_profit::float, net_profit::float
    FROM app.fundamentals_quarterly
    WHERE symbol = ${upper}
    ORDER BY period_end DESC
    LIMIT 6
  `;
  // Daily price history — full available range. golden_db keeps daily back to
  // ~1996 for most NSE stocks. ~7K rows × 30 bytes ≈ 50KB gzipped, fine to
  // ship to the client so the chart can support 1D/1W/1M zoom client-side.
  const priceHistory = await golden<PricePoint[]>`
    SELECT date::text, close::float
    FROM golden.price_history
    WHERE symbol = ${upper + ".NS"} AND interval = '1d'
    ORDER BY date ASC
  `;
  // Intraday ticks (appended every ~10 min by the equity pinger) for the 1D
  // chart's real session curve. Use the MOST RECENT tick-day, not strictly
  // "today" — otherwise the chart is a straight line all weekend / before the
  // first tick lands (today has no ticks, so it fell back to a 2-point line).
  // The latest tick-day is today during market hours, Friday on a weekend.
  // At most ~38 rows. Empty only if the symbol has never been pinged.
  const intradayTicks = await sql<{ ts: string; ltp: number }[]>`
    WITH latest AS (
      SELECT MAX((ts AT TIME ZONE 'Asia/Kolkata')::date) AS d
        FROM app.stock_intraday WHERE symbol = ${upper}
    )
    SELECT ts::text, ltp::float
      FROM app.stock_intraday, latest
     WHERE symbol = ${upper}
       AND (ts AT TIME ZONE 'Asia/Kolkata')::date = latest.d
     ORDER BY ts ASC
  `;

  // Peer-cluster stats for the header — cluster median (radar baseline) AND
  // this stock's rank within its (cluster, tier) peer group at the latest
  // snapshot. Rank is computed as
  //     1 + (peers strictly above on composite_pct)
  // so ties share the higher rank, and NULL composites sink to the bottom.
  // Returns a single row.
  const peerStats = await sql<{ median: number; rank: number; peer_count: number }[]>`
    WITH peers AS (
      SELECT symbol, composite_pct
      FROM app.scores
      WHERE cluster_id = ${stock.industry_id} AND maturity_tier = ${stock.maturity_tier}
        AND snapshot_date = (
          SELECT MAX(snapshot_date) FROM app.scores
          WHERE cluster_id = ${stock.industry_id} AND maturity_tier = ${stock.maturity_tier}
        )
    )
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY composite_pct)::float AS median,
      ((SELECT COUNT(*) FROM peers
        WHERE COALESCE(composite_pct, -1) >
              COALESCE((SELECT composite_pct FROM peers WHERE symbol = ${upper}), -1)
       ) + 1)::int AS rank,
      (SELECT COUNT(*) FROM peers)::int AS peer_count
    FROM peers
  `;

  // Scorecard for this (cluster, tier) — needed to build the SHAP waterfall weights
  const scRow = await sql<Scorecard[]>`
    SELECT pillar_weights, quality, valuation, momentum
    FROM app.cluster_scorecard_active
    WHERE cluster_id = ${stock.industry_id}
  `;
  const scorecard = scRow[0] ?? null;

  // Latest 4 quarters of shareholding pattern. Latest one drives the chart;
  // the previous one provides delta arrows so the user sees movement, not just
  // a static breakdown.
  const shareholding = await sql<ShareholdingRow[]>`
    SELECT period_end::text,
           promoter_pct::float    AS promoter_pct,
           fii_pct::float         AS fii_pct,
           dii_pct::float         AS dii_pct,
           government_pct::float  AS government_pct,
           public_pct::float      AS public_pct,
           shareholders::bigint   AS shareholders
    FROM app.shareholding_pattern
    WHERE symbol = ${upper}
    ORDER BY period_end DESC
    LIMIT 4
  `;

  return {
    stock, scorecard, annual, quarterly, priceHistory, intradayTicks, shareholding,
    peerMedianComposite: peerStats[0]?.median ?? 50,
    rankInIndustry: peerStats[0]?.rank ?? null,
    industryPeerCount: peerStats[0]?.peer_count ?? null,
  };
}

export default async function StockPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const [data, persistence] = await Promise.all([
    loadStock(symbol),
    loadPersistenceForSymbol(symbol),
  ]);
  if (!data) return notFound();
  const { stock, scorecard, annual, quarterly, priceHistory, intradayTicks, shareholding, rankInIndustry, industryPeerCount } = data;

  // Build the 5-axis strength bars from per-component sub-percentiles
  const strengthRows = buildSpider(
    stock.quality_components || {},
    stock.valuation_components || {},
    stock.momentum_components || {}
  ).map((s) => ({ axis: s.axis, value: s.value }));

  // Build three pillar stories
  const pillarStories = [
    buildPillarStory("Quality",   stock.quality_pct,   stock.quality_components || {}),
    buildPillarStory("Valuation", stock.valuation_pct, stock.valuation_components || {}),
    buildPillarStory("Momentum",  stock.momentum_pct,  stock.momentum_components || {}),
  ];

  const stockMeta = {
    company_name: stock.company_name,
    symbol: stock.symbol,
    market_cap_cr: stock.market_cap_cr,
    current_price: stock.current_price,
    industry_name: stock.industry_name,
    composite_pct: stock.composite_pct,
  };

  const compositeBand = band(stock.composite_pct);
  const compositeBg = bandColor(compositeBand);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-10">
      {/* Back link: returns to the sector page with the right sector +
          industry pre-selected, so the user lands on the same list of stocks
          they were just browsing. Falls back to /sectors root if either
          identifier is missing. */}
      <Link
        href={`/sectors?sector=${encodeURIComponent(stock.sector_id)}&industry=${encodeURIComponent(stock.industry_id)}`}
        className="text-[12px] muted-text hover:text-[var(--color-accent-600)]"
      >
        ← {stock.sector_name} · {stock.industry_name}
      </Link>

      {/* Header — name + percentile badge.
          On mobile, stack vertically so the badge sits BELOW the name
          instead of crammed into a tall narrow column on the right.
          Desktop keeps the side-by-side layout. */}
      <header className="mt-3 flex flex-col md:flex-row items-start md:justify-between gap-4 md:gap-8">
        <div>
          <div className="text-[12px] muted-text uppercase tracking-wide">
            {stock.sector_name} · {stock.industry_name} · {tierLabel(stock.maturity_tier)}
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <h1 className="font-display text-[36px] tracking-tight leading-tight">
              {stock.company_name || stock.symbol}
            </h1>
            {quarterly[0] && <ResultFlashChip latest={quarterly[0]} />}
            <WatchlistButton symbol={stock.symbol} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[14px] muted-text">
            <span className="font-medium ink-text tabular-nums">{stock.symbol}</span>
            {stock.current_price != null && (
              <>
                <span>·</span>
                <span className="tabular-nums">₹{stock.current_price.toLocaleString("en-IN")}</span>
                {stock.price_fetched_at && (
                  <span
                    className="inline-flex items-center rounded px-1.5 py-[1px] text-[10px] font-medium tabular-nums"
                    style={{ background: "color-mix(in srgb, var(--color-muted) 10%, transparent)", color: "var(--color-muted)" }}
                    title="Last time the intraday price pinger updated this stock"
                  >
                    {new Intl.DateTimeFormat("en-IN", {
                      timeZone: "Asia/Kolkata",
                      hour: "2-digit", minute: "2-digit", hour12: false,
                    }).format(new Date(stock.price_fetched_at))} IST
                  </span>
                )}
              </>
            )}
            {stock.market_cap_cr != null && (
              <>
                <span>·</span>
                <span>{fmtRupeesCr(stock.market_cap_cr)}</span>
              </>
            )}
            {stock.listing_date && (
              <>
                <span>·</span>
                <span>
                  Listed {new Date(stock.listing_date).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })}
                </span>
              </>
            )}
          </div>
          {stock.maturity_tier === "new" && stock.listing_date && (
            <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--color-accent-50)] border border-[var(--color-accent-200)]">
              <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-accent-700)" }}>
                Recent IPO
              </span>
              <span className="text-[12px] muted-text">
                Listed {(((Date.now() - new Date(stock.listing_date).getTime()) / (365.25 * 24 * 3600 * 1000))).toFixed(1)} years ago
              </span>
            </div>
          )}
        </div>

        {/* Percentile badge — right-aligned on desktop, left-aligned on mobile
            (so it follows the stacked name block flush-left). */}
        <div className="text-left md:text-right shrink-0">
          <div
            className="inline-block px-4 py-2 rounded-md"
            style={{ backgroundColor: compositeBg, color: compositeBand === "neutral" ? "var(--color-ink)" : "white" }}
          >
            <div className="text-[11px] uppercase tracking-wide opacity-80">
              Industry Score
            </div>
            <div className="text-[28px] font-medium tabular-nums leading-none mt-1">
              {stock.composite_pct == null ? "—" : Math.round(stock.composite_pct)}
            </div>
          </div>
          {/* The wordy "Above median in … not a buy/sell" description used
              to live here.  Moved down to a single asterisked footnote
              under the score badge column so the header sits tighter and
              the tab bar reaches the eye sooner. */}
          {/* Rank-in-cluster pill — explicit position within the peer group,
              complementing the abstract percentile. "Rank 3 of 12" reads
              more concretely than "Top 18%". */}
          {rankInIndustry != null && industryPeerCount != null && industryPeerCount > 1 && (
            <div
              className="inline-flex items-center gap-1.5 mt-2 px-2 py-0.5 rounded-full border hairline text-[11px] tabular-nums"
              style={{ backgroundColor: "var(--color-card)" }}
              title={`Position within ${stock.industry_name} · ${tierLabel(stock.maturity_tier)} at this snapshot`}
            >
              <span className="muted-text">Rank</span>
              <span className="font-medium ink-text">{rankInIndustry}</span>
              <span className="muted-text">of {industryPeerCount}</span>
            </div>
          )}
        </div>
      </header>

      {/* Single asterisked footnote replaces the three-line description that
          used to sit under the Industry Score badge.  Compact, one line
          where possible, italic so it reads as an annotation. */}
      {stock.composite_pct != null && (
        <p className="text-[11px] muted-text italic mt-2 leading-snug">
          * {percentileLabel(stock.composite_pct)} in {stock.industry_name} ·{" "}
          {tierLabel(stock.maturity_tier)} — where this stock ranks within its
          industry, not the whole market. Not a buy/sell recommendation.
        </p>
      )}

      <StockPageTabs
        results={
          <LatestResultCard
            quarterly={quarterly}
            annual={annual}
            marketCapCr={stock.market_cap_cr}
            currentPrice={stock.current_price}
          />
        }
        about={
          <>
            {stock.business_summary && (
              <BusinessVisual
                companyName={stock.company_name}
                symbol={stock.symbol}
                sector={stock.sector}
                industry={stock.industry}
                summary={stock.business_summary}
                website={stock.website}
                employees={stock.employees}
                ceoName={stock.ceo_name}
                ceoTitle={stock.ceo_title}
                shareholding={shareholding}
              />
            )}
            <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6">
              <AboutCard stock={stock} priceHistoryStart={priceHistory[0]?.date ?? null} />
              <PriceChartCard symbol={stock.symbol} history={priceHistory} intraday={intradayTicks} currentPrice={stock.current_price} priceFetchedAt={stock.price_fetched_at} />
            </div>
          </>
        }
        strengths={
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8">
            <div className="space-y-8">
              <section className="card p-6">
                <h2 className="font-display text-[20px] mb-2">Strengths and gaps</h2>
                <p className="text-[13px] muted-text mb-6">
                  Each bar is this stock&apos;s percentile within {stock.industry_name} ·{" "}
                  {tierLabel(stock.maturity_tier)} peers. The thin line in the middle is
                  the cluster median — anything to the right of it beats half the cluster.
                </p>
                <StrengthBars rows={strengthRows} />
              </section>

              <section>
                <h2 className="font-display text-[20px] mb-2">Why this score</h2>
                <p className="text-[13px] muted-text mb-4">
                  Three pillars. Switch between them to see how this stock specifically
                  scored, with the underlying metric trends.
                </p>
                <PillarTabs
                  tabs={[
                    {
                      pillar: "Quality",
                      pct: stock.quality_pct,
                      oneLineSummary: pillarStories[0].summary,
                      companyNarration: qualityNarration(
                        stockMeta, annual, stock.quality_components || {}, stock.quality_pct
                      ),
                      strength: pillarStories[0].strength,
                      gap: pillarStories[0].gap,
                      trends: computePillarTrends("Quality", annual),
                    },
                    {
                      pillar: "Valuation",
                      pct: stock.valuation_pct,
                      oneLineSummary: pillarStories[1].summary,
                      companyNarration: valuationNarration(
                        stockMeta, stock.valuation_components || {}, stock.valuation_pct
                      ),
                      strength: pillarStories[1].strength,
                      gap: pillarStories[1].gap,
                      trends: computePillarTrends("Valuation", annual),
                    },
                    {
                      pillar: "Momentum",
                      pct: stock.momentum_pct,
                      oneLineSummary: pillarStories[2].summary,
                      companyNarration: momentumNarration(
                        stockMeta, stock.momentum_components || {}, quarterly, stock.momentum_pct
                      ),
                      strength: pillarStories[2].strength,
                      gap: pillarStories[2].gap,
                      trends: computePillarTrends("Momentum", annual),
                    },
                  ] satisfies PillarTabContent[]}
                />
              </section>
            </div>

            <aside className="space-y-6">
              <PillarBreakdown
                quality={stock.quality_pct}
                valuation={stock.valuation_pct}
                momentum={stock.momentum_pct}
              />
              <StatusCard status={stock.score_status} />
              <CompositeExplainer
                composite={stock.composite_pct}
                cluster={stock.industry_name}
                tier={stock.maturity_tier}
              />
            </aside>
          </div>
        }
        trend={
          // Two strictly equal-width, equal-height cards.  Grid uses
          // auto-rows-fr to force the row to the tallest item's height
          // (default behaviour) AND each card has its own min-h floor
          // so when content is short the cards don't collapse.
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch auto-rows-fr max-w-[960px]">
            <div className="min-h-[420px]">
              <TrendSection persistence={persistence} />
            </div>
            <div className="min-h-[420px]">
              <TrendCommentary
                persistence={persistence}
                companyName={stock.company_name}
                industryName={stock.industry_name}
                maturityTier={stock.maturity_tier}
              />
            </div>
          </div>
        }
        numbers={<FundamentalsTables annual={annual} quarterly={quarterly} />}
      />
    </div>
  );
}

function PillarBreakdown(props: {
  quality: number | null;
  valuation: number | null;
  momentum: number | null;
}) {
  const rows = [
    { label: "Quality", value: props.quality },
    { label: "Valuation", value: props.valuation },
    { label: "Momentum", value: props.momentum },
  ];
  return (
    <div className="card p-5">
      <div className="text-[12px] uppercase tracking-wide muted-text">Pillars</div>
      <div className="mt-3 space-y-3">
        {rows.map((r) => {
          const b = band(r.value);
          return (
            <div key={r.label}>
              <div className="font-medium text-[14px]">{r.label}</div>
              <div className="flex items-center gap-3 mt-1">
                <div className="flex-1 h-1.5 bg-[var(--color-paper)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${r.value ?? 0}%`,
                      backgroundColor: bandColor(b),
                    }}
                  />
                </div>
                <span className="text-[14px] tabular-nums w-8 text-right" style={{ color: bandColor(b) }}>
                  {fmtPct(r.value, "")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Phrase a percentile as a peer-relative rank label.
 * pct=95 → "Top 5%"; pct=50 → "Median"; pct=5 → "Bottom 5%".
 * Uses round-number bands at the extremes so badges read cleanly.
 */
function percentileLabel(pct: number): string {
  const p = Math.round(pct);
  if (p >= 90) return `Top ${Math.max(1, 100 - p)}%`;
  if (p >= 75) return `Top quartile`;
  if (p >= 60) return `Above median`;
  if (p >= 40) return `Mid-pack`;
  if (p >= 25) return `Below median`;
  if (p >= 10) return `Bottom quartile`;
  return `Bottom ${Math.max(1, p)}%`;
}

/* ----------------------------- Business description ---------------- */

function BusinessDescription({
  summary, website,
}: { summary: string; website: string | null }) {
  return (
    <section className="mt-8 card p-6 max-w-[920px]">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <div className="text-[11px] uppercase tracking-wide muted-text">
          About the company
        </div>
        <div className="flex items-center gap-3 text-[12px] muted-text">
          {website && (
            <a
              href={website.startsWith("http") ? website : `https://${website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:no-underline"
              style={{ color: "var(--color-accent-600)" }}
            >
              {website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
            </a>
          )}
        </div>
      </div>
      <p className="text-[14.5px] leading-[1.7] text-[var(--color-ink)]">
        {summary}
      </p>
      <div className="mt-3 text-[10.5px] muted-text italic">
        Sourced from public company disclosures.
      </div>
    </section>
  );
}

/* ----------------------------- About card -------------------------- */

function AboutCard({
  stock, priceHistoryStart,
}: { stock: Stock; priceHistoryStart: string | null }) {
  const facts: { label: string; value: string }[] = [];
  if (stock.industry) facts.push({ label: "Industry", value: stock.industry });
  if (stock.sector) facts.push({ label: "Sector", value: stock.sector });
  facts.push({
    label: "Cluster",
    value: `${stock.industry_name} · ${tierLabel(stock.maturity_tier)}`,
  });
  if (stock.market_cap_cr != null) {
    facts.push({ label: "Market cap", value: fmtRupeesCr(stock.market_cap_cr) });
  }
  if (stock.listing_date) {
    facts.push({
      label: "Listed",
      value: new Date(stock.listing_date).toLocaleDateString("en-IN", {
        year: "numeric", month: "short", day: "numeric",
      }),
    });
  }
  if (priceHistoryStart) {
    const totalMs = Date.now() - new Date(priceHistoryStart).getTime();
    const yrs = Math.floor(totalMs / (365.25 * 24 * 3600 * 1000));
    const mos = Math.floor(totalMs / (30.44 * 24 * 3600 * 1000));
    const phLabel =
      yrs >= 1
        ? `${yrs} year${yrs !== 1 ? "s" : ""} available`
        : mos >= 1
        ? `${mos} month${mos !== 1 ? "s" : ""} available`
        : "< 1 month available";
    facts.push({ label: "Price history", value: phLabel });
  }
  if (stock.years_of_data) {
    facts.push({ label: "Fundamentals", value: `${stock.years_of_data} years available` });
  }

  return (
    <section className="card p-5">
      <div className="text-[11px] uppercase tracking-wide muted-text mb-3">About</div>
      <div className="font-display text-[18px] leading-tight tracking-tight mb-4">
        {stock.company_name || stock.symbol}
      </div>
      <div className="space-y-2.5">
        {facts.map((f) => (
          <div key={f.label} className="grid grid-cols-[110px_1fr] gap-3 text-[13px]">
            <span className="muted-text">{f.label}</span>
            <span>{f.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- Price chart card -------------------- */

function PriceChartCard({
  symbol, history, intraday, currentPrice, priceFetchedAt,
}: { symbol: string; history: PricePoint[]; intraday?: { ts: string; ltp: number }[]; currentPrice?: number | null; priceFetchedAt?: string | null }) {
  const first = history[0];
  const last = history[history.length - 1];
  const totalReturn = first && last && first.close > 0
    ? (last.close / first.close - 1) * 100
    : null;
  const years = first
    ? (Date.now() - new Date(first.date).getTime()) / (365.25 * 24 * 3600 * 1000)
    : 0;
  const cagr = totalReturn != null && years > 1
    ? (Math.pow(last.close / first.close, 1 / years) - 1) * 100
    : null;

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide muted-text">Price history</div>
          <div className="font-display text-[18px] mt-0.5">
            {symbol} ·{" "}
            <span className="muted-text">
              monthly close,{" "}
              {history.length > 0
                ? first?.date.slice(0, 4) === last?.date.slice(0, 4)
                  ? first?.date.slice(0, 4)                              // single year: "2026"
                  : `${first?.date.slice(0, 4)}–${last?.date.slice(0, 4)}`  // range: "2019–2026"
                : "—"}
            </span>
          </div>
        </div>
        {totalReturn != null && (
          <div className="text-right">
            <div
              className="font-display text-[20px] tabular-nums leading-none"
              style={{
                color: totalReturn >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)",
              }}
            >
              {totalReturn >= 0 ? "+" : ""}
              {totalReturn.toFixed(0)}%
            </div>
            <div className="text-[10px] muted-text mt-1">
              {cagr != null ? `${cagr.toFixed(1)}% CAGR · ${years.toFixed(0)}y` : "Total return"}
            </div>
          </div>
        )}
      </div>
      <PriceChart data={history} intraday={intraday} currentPrice={currentPrice ?? undefined} priceFetchedAt={priceFetchedAt ?? undefined} />
    </section>
  );
}

/* -- Pillar trend computation ---------------------------------- */

type TrendDef = {
  name: string;
  data: SparkPoint[];
  format: import("@/components/Sparkline").FormatId;
  inverse?: boolean;
};

function fyLabelFromIso(iso: string): string {
  return `FY${String(new Date(iso).getFullYear()).slice(-2)}`;
}

function computePillarTrends(
  pillar: "Quality" | "Valuation" | "Momentum",
  annual: AnnualRow[],
): TrendDef[] {
  const rowsAsc = [...annual].reverse();

  if (pillar === "Quality") {
    return [
      {
        name: "Return on equity",
        format: "pct",
        data: rowsAsc.map((r) => {
          const eq = (r.equity_share_capital ?? 0) + (r.reserves ?? 0);
          const v = eq > 0 && r.net_profit != null ? r.net_profit / eq : null;
          return { label: fyLabelFromIso(r.period_end), value: v };
        }),
      },
      {
        name: "Return on capital employed",
        format: "pct",
        data: rowsAsc.map((r) => {
          const cap = (r.equity_share_capital ?? 0) + (r.reserves ?? 0) + (r.borrowings ?? 0);
          const ebit = (r.profit_before_tax ?? 0) + (r.interest ?? 0);
          const v = cap > 0 && r.profit_before_tax != null ? ebit / cap : null;
          return { label: fyLabelFromIso(r.period_end), value: v };
        }),
      },
      {
        name: "Operating margin",
        format: "pct",
        data: rowsAsc.map((r) => {
          const v = r.sales && r.sales > 0 && r.operating_profit != null ? r.operating_profit / r.sales : null;
          return { label: fyLabelFromIso(r.period_end), value: v };
        }),
      },
      {
        name: "Net profit margin",
        format: "pct",
        data: rowsAsc.map((r) => {
          const v = r.sales && r.sales > 0 && r.net_profit != null ? r.net_profit / r.sales : null;
          return { label: fyLabelFromIso(r.period_end), value: v };
        }),
      },
      {
        name: "Debt / Equity",
        format: "ratio",
        inverse: true,
        data: rowsAsc.map((r) => {
          const eq = (r.equity_share_capital ?? 0) + (r.reserves ?? 0);
          const v = eq > 0 && r.borrowings != null ? r.borrowings / eq : null;
          return { label: fyLabelFromIso(r.period_end), value: v };
        }),
      },
      {
        name: "CFO ÷ Net profit",
        format: "ratio",
        data: rowsAsc.map((r) => {
          const v = r.cash_from_operating != null && r.net_profit != null && r.net_profit > 0
            ? r.cash_from_operating / r.net_profit : null;
          return { label: fyLabelFromIso(r.period_end), value: v };
        }),
      },
    ];
  }

  if (pillar === "Valuation") {
    // Valuation is harder to chart historically — P/E needs annual mc which we don't store.
    // For now, show two trends derivable from raw fundamentals: book value and earnings yield trend.
    return [
      {
        name: "Book value (₹ Cr)",
        format: "cr",
        data: rowsAsc.map((r) => ({
          label: fyLabelFromIso(r.period_end),
          value: (r.equity_share_capital ?? 0) + (r.reserves ?? 0) || null,
        })),
      },
      {
        name: "Net profit (₹ Cr)",
        format: "cr",
        data: rowsAsc.map((r) => ({
          label: fyLabelFromIso(r.period_end),
          value: r.net_profit,
        })),
      },
      {
        name: "Sales (₹ Cr)",
        format: "cr",
        data: rowsAsc.map((r) => ({
          label: fyLabelFromIso(r.period_end),
          value: r.sales,
        })),
      },
    ];
  }

  // Momentum — show YoY growth rates derived from annuals
  return [
    {
      name: "Sales YoY growth",
      format: "pct",
      data: rowsAsc.map((r, i) => {
        if (i === 0) return { label: fyLabelFromIso(r.period_end), value: null };
        const prev = rowsAsc[i - 1].sales;
        const v = prev && prev > 0 && r.sales != null ? (r.sales - prev) / prev : null;
        return { label: fyLabelFromIso(r.period_end), value: v };
      }),
    },
    {
      name: "Net profit YoY growth",
      format: "pct",
      data: rowsAsc.map((r, i) => {
        if (i === 0) return { label: fyLabelFromIso(r.period_end), value: null };
        const prev = rowsAsc[i - 1].net_profit;
        const v = prev && prev !== 0 && r.net_profit != null ? (r.net_profit - prev) / Math.abs(prev) : null;
        return { label: fyLabelFromIso(r.period_end), value: v };
      }),
    },
    {
      name: "Operating profit YoY growth",
      format: "pct",
      data: rowsAsc.map((r, i) => {
        if (i === 0) return { label: fyLabelFromIso(r.period_end), value: null };
        const prev = rowsAsc[i - 1].operating_profit;
        const v = prev && prev !== 0 && r.operating_profit != null
          ? (r.operating_profit - prev) / Math.abs(prev)
          : null;
        return { label: fyLabelFromIso(r.period_end), value: v };
      }),
    },
  ];
}

function CompositeExplainer(props: {
  composite: number | null;
  cluster: string;
  tier: string;
}) {
  return (
    <footer className="mt-12 pt-6 border-t hairline">
      <div className="text-[11px] uppercase tracking-wide muted-text mb-2">
        Note · How the score works
      </div>
      <p className="text-[12.5px] leading-relaxed muted-text max-w-[820px]">
        The <strong className="ink-text">Industry Score</strong> is this stock&apos;s overall
        percentile (0&ndash;100) within its peer group: <em>{props.cluster}</em>,{" "}
        {tierLabel(props.tier)}. It is a weighted blend of three pillars — Quality,
        Valuation, Momentum — using sector-tuned weights, then re-ranked against the
        same peers so the final number is itself a percentile. Higher = better.{" "}
        <Link href="/about" className="underline hover:no-underline">
          Read the methodology
        </Link>.
      </p>
    </footer>
  );
}

type AnnualLite = {
  period_end: string;
  sales: number | null;
  operating_profit: number | null;
  net_profit: number | null;
  cash_from_operating: number | null;
  total_assets: number | null;
  borrowings: number | null;
  equity_share_capital: number | null;
  reserves: number | null;
};

type QuarterlyLite = {
  period_end: string;
  sales: number | null;
  operating_profit: number | null;
  net_profit: number | null;
};

// One cell in a fundamentals row — keeps the formatted display string and
// the raw numeric value so the table can color period-over-period direction.
type NumCell = { text: string; value: number | null };

// Per-row polarity: most P&L lines (sales, profit, margins) want UP = green.
// Balance-sheet liability rows (borrowings, debt/equity) flip: UP = red.
type Polarity = "up-good" | "up-bad";

type NumRow = { label: string; cells: NumCell[]; polarity?: Polarity };

// Helper: build a NumCell from a raw number + a formatter.
function cell(n: number | null, fmt: (x: number | null) => string): NumCell {
  return { text: fmt(n), value: n };
}

function FundamentalsTables({
  annual, quarterly,
}: { annual: AnnualLite[]; quarterly: QuarterlyLite[] }) {
  const annualOldFirst = [...annual].reverse();
  const qOldFirst = [...quarterly].reverse();

  // Derived ratios per year
  const derived = annualOldFirst.map((r) => {
    const equity = (r.equity_share_capital ?? 0) + (r.reserves ?? 0);
    const op_margin = r.sales && r.sales > 0 && r.operating_profit != null
      ? (r.operating_profit / r.sales) : null;
    const np_margin = r.sales && r.sales > 0 && r.net_profit != null
      ? (r.net_profit / r.sales) : null;
    const roe = equity > 0 && r.net_profit != null ? r.net_profit / equity : null;
    const debt_equity = equity > 0 && r.borrowings != null ? r.borrowings / equity : null;
    return { period_end: r.period_end, op_margin, np_margin, roe, debt_equity };
  });

  return (
    <section className="card p-6">
      <h2 className="font-display text-[20px] mb-1">The numbers</h2>
      <p className="text-[13px] muted-text mb-5">
        Source data behind the score. All ₹ figures in crores; ratios as percentages.
        Cells color green when the metric moved in a favourable direction vs the
        prior period, red when it moved unfavourably.
      </p>

      <div className="space-y-8">
        <FundamentalsBlock
          title="Annual P&amp;L (last 10 fiscal years)"
          rows={[
            { label: "Sales",                cells: annualOldFirst.map((r) => cell(r.sales,               fmtCr)) },
            { label: "Operating profit",     cells: annualOldFirst.map((r) => cell(r.operating_profit,    fmtCr)) },
            { label: "Net profit",           cells: annualOldFirst.map((r) => cell(r.net_profit,          fmtCr)) },
            { label: "Cash from operations", cells: annualOldFirst.map((r) => cell(r.cash_from_operating, fmtCr)) },
            { label: "Total assets",         cells: annualOldFirst.map((r) => cell(r.total_assets,        fmtCr)) },
            // Borrowings up = bad — flip the polarity so rising debt reads red.
            { label: "Borrowings",           cells: annualOldFirst.map((r) => cell(r.borrowings,          fmtCr)), polarity: "up-bad" },
          ]}
          headers={annualOldFirst.map((r) => fyLabel(r.period_end))}
        />

        <FundamentalsBlock
          title="Derived ratios"
          rows={[
            { label: "Operating margin",  cells: derived.map((r) => cell(r.op_margin,    fmtPctRatio)) },
            { label: "Net profit margin", cells: derived.map((r) => cell(r.np_margin,    fmtPctRatio)) },
            { label: "Return on equity",  cells: derived.map((r) => cell(r.roe,          fmtPctRatio)) },
            // Higher debt/equity is unfavourable.
            { label: "Debt / Equity",     cells: derived.map((r) => cell(r.debt_equity,  fmtRatio)), polarity: "up-bad" },
          ]}
          headers={derived.map((r) => fyLabel(r.period_end))}
        />

        <FundamentalsBlock
          title={`Quarterly results (latest ${qOldFirst.length} quarters)`}
          rows={[
            { label: "Sales",            cells: qOldFirst.map((r) => cell(r.sales,            fmtCr)) },
            { label: "Operating profit", cells: qOldFirst.map((r) => cell(r.operating_profit, fmtCr)) },
            { label: "Net profit",       cells: qOldFirst.map((r) => cell(r.net_profit,       fmtCr)) },
          ]}
          headers={qOldFirst.map((r) => qLabel(r.period_end))}
        />
      </div>
    </section>
  );
}

function FundamentalsBlock(props: {
  title: string;
  rows: NumRow[];
  headers: string[];
}) {
  // Drop rows where every cell is "—" (blank). Keeps tables tight for stocks
  // where the source feed doesn't report some line items (e.g. brokerages have no
  // separate Operating Profit row in their P&L).
  const rows = props.rows.filter((r) => r.cells.some((c) => c.text !== "—"));
  if (rows.length === 0) {
    return null;
  }
  return (
    <div>
      <div className="text-[12px] uppercase tracking-wide muted-text mb-2">{props.title}</div>
      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-[13px] min-w-[480px]">
          <thead>
            <tr className="border-b hairline">
              <th className="text-left font-normal muted-text py-2 px-2 text-[11px] uppercase">Item</th>
              {props.headers.map((h) => (
                <th key={h} className="text-right font-normal muted-text py-2 px-2 text-[11px] uppercase">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const polarity = r.polarity ?? "up-good";
              return (
                <tr key={r.label} className="border-b hairline last:border-b-0">
                  <td className="py-2 px-2 text-[13px]">{r.label}</td>
                  {r.cells.map((c, i) => {
                    // Find the most recent prior cell with a numeric value —
                    // skipping nulls lets us color FY24 against FY22 if FY23
                    // is missing, instead of going neutral.
                    let prev: number | null = null;
                    for (let j = i - 1; j >= 0; j--) {
                      if (r.cells[j].value != null) {
                        prev = r.cells[j].value;
                        break;
                      }
                    }
                    let cls = "";
                    if (c.text === "—") {
                      cls = "muted-text";
                    } else if (c.value != null && prev != null && c.value !== prev) {
                      const up = c.value > prev;
                      const favourable = polarity === "up-good" ? up : !up;
                      cls = favourable ? "delta-up" : "delta-down";
                    }
                    return (
                      <td
                        key={i}
                        className={`py-2 px-2 text-right tabular-nums font-medium ${cls}`}
                      >
                        {c.text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtCr(n: number | null): string {
  if (n == null) return "—";
  // Always suffix the unit so the value is unambiguous outside a labeled
  // table. Big numbers compact to "L Cr" (lakh crore) to stay readable.
  //   < 100,000 cr  → "₹X,XXX Cr"   (Indian comma grouping)
  //   ≥ 100,000 cr  → "₹X.XL Cr"   (e.g. ₹2.5L Cr = 2.5 lakh crore)
  if (Math.abs(n) >= 100_000) {
    return `₹${(n / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}L Cr`;
  }
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}

function fmtPctRatio(r: number | null): string {
  if (r == null) return "—";
  return `${(r * 100).toFixed(1)}%`;
}

function fmtRatio(r: number | null): string {
  if (r == null) return "—";
  return r.toFixed(2);
}

function fyLabel(iso: string): string {
  const d = new Date(iso);
  return `FY${String(d.getFullYear()).slice(-2)}`;
}

function qLabel(iso: string): string {
  const d = new Date(iso);
  const m = d.getMonth() + 1;
  const q = m <= 3 ? "Q4" : m <= 6 ? "Q1" : m <= 9 ? "Q2" : "Q3";
  const fy = m <= 3 ? d.getFullYear() : d.getFullYear() + 1;
  return `${q} FY${String(fy).slice(-2)}`;
}

// ---------------------------------------------------------------------------
// Latest result card
// ---------------------------------------------------------------------------
//
// A compact "result flash" panel that sits above the StockPageTabs. Surfaces
// the headline P&L lines (Revenue / OP / NP / Op margin) for the most recent
// quarter alongside YoY and QoQ deltas. Reuses the quarterly data already
// loaded on the stock page — no extra DB roundtrip.
//
// Why no estimate-vs-actual block (which the reference infographic showed):
// we don't have analyst consensus estimates in golden_db or app, and adding
// a paid feed for that one box isn't on-brand for the platform.
//
// Why no Buy/Hold/Sell verdict box: the site explicitly disclaims advisory.

type QuarterLite = {
  period_end: string;
  sales: number | null;
  operating_profit: number | null;
  net_profit: number | null;
};

type AnnualLiteForRatios = {
  period_end: string;
  total_assets: number | null;
  borrowings: number | null;
  equity_share_capital: number | null;
  reserves: number | null;
};

// Small "result flash" pill that sits beside the company name in the page
// header. Shows just the period and end date — no editorial wording. The
// freshness signal is carried by color + pulse instead:
//
//   ≤ 45 days old  → green pill with pulsing dot
//   ≤ 120 days old → muted accent pill, no pulse
//   older          → don't render at all
//
// We don't have actual filing dates, so we use period_end as a proxy
// (results typically file within ~60 days of period end).
function ResultFlashChip({ latest }: { latest: QuarterLite }) {
  const periodEnd = new Date(latest.period_end);
  const daysSince = Math.floor(
    (Date.now() - periodEnd.getTime()) / (24 * 3600 * 1000),
  );
  if (daysSince > 120) return null;

  const fresh = daysSince <= 45;
  const styles = fresh
    ? {
        backgroundColor: "var(--color-delta-up)",
        color: "#fff",
        borderColor: "var(--color-delta-up)",
      }
    : {
        backgroundColor: "var(--color-accent-50)",
        color: "var(--color-accent-700)",
        borderColor: "var(--color-accent-200)",
      };

  return (
    <a
      href="#latest-result"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold tracking-wide whitespace-nowrap shrink-0 transition-transform hover:scale-105"
      style={styles}
      title="Click to scroll to the result panel"
    >
      {fresh && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-livepulse shrink-0"
          aria-hidden
        />
      )}
      <span>{qLabel(latest.period_end)}</span>
      <span style={{ opacity: 0.85 }}>
        ·{" "}
        {periodEnd.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </span>
    </a>
  );
}

function LatestResultCard({
  quarterly, annual, marketCapCr, currentPrice,
}: {
  quarterly: QuarterLite[];
  annual: AnnualLiteForRatios[];
  marketCapCr: number | null;
  currentPrice: number | null;
}) {
  if (!quarterly || quarterly.length === 0) return null;

  // Quarterly rows arrive newest-first; index 1 is the previous quarter (QoQ)
  // and index 4 is the same quarter a year ago (YoY). Either may be missing
  // when there's less than 5 quarters of history.
  const cur = quarterly[0];
  const qoq = quarterly[1] ?? null;
  const yoy = quarterly[4] ?? null;

  const revYoY = pctChange(cur.sales, yoy?.sales);
  const revQoQ = pctChange(cur.sales, qoq?.sales);
  const opYoY = pctChange(cur.operating_profit, yoy?.operating_profit);
  const opQoQ = pctChange(cur.operating_profit, qoq?.operating_profit);
  const npYoY = pctChange(cur.net_profit, yoy?.net_profit);
  const npQoQ = pctChange(cur.net_profit, qoq?.net_profit);

  // Operating margin in pct points; delta vs YoY-ago quarter in basis points.
  const opmCur =
    cur.sales && cur.sales > 0 && cur.operating_profit != null
      ? (cur.operating_profit / cur.sales) * 100
      : null;
  const opmYoy =
    yoy && yoy.sales && yoy.sales > 0 && yoy.operating_profit != null
      ? (yoy.operating_profit / yoy.sales) * 100
      : null;
  const opmDeltaBps =
    opmCur != null && opmYoy != null ? Math.round((opmCur - opmYoy) * 100) : null;

  // ---- Trailing-12-month ratios -------------------------------------------
  // TTM = sum of the four most-recent quarters. Need at least 4 to be honest;
  // otherwise we skip the ratio rather than display a partial-TTM number.
  const hasTTM = quarterly.length >= 4;
  const ttmNetProfit = hasTTM ? sumQ(quarterly, 0, 4, "net_profit") : null;
  const ttmOpProfit = hasTTM ? sumQ(quarterly, 0, 4, "operating_profit") : null;

  // Equity + Debt from the latest annual balance sheet. Most platforms call
  // this "Capital Employed" (a simpler definition than Total Assets minus
  // Current Liabilities, which we don't store). Standard practical form used
  // by Screener and most Indian retail tools.
  const latestAnnual = annual && annual.length > 0 ? annual[0] : null;
  const equityCr =
    latestAnnual && (latestAnnual.equity_share_capital != null || latestAnnual.reserves != null)
      ? (latestAnnual.equity_share_capital ?? 0) + (latestAnnual.reserves ?? 0)
      : null;
  const borrowingsCr = latestAnnual?.borrowings ?? null;
  const capitalEmployedCr =
    equityCr != null ? equityCr + (borrowingsCr ?? 0) : null;

  // EPS in ₹/share. Derive shares from market_cap and current_price (both
  // INR, units cancel) → shares = market_cap_cr / current_price. Then
  // EPS = TTM_NP_cr × current_price / market_cap_cr.
  const epsTTM =
    ttmNetProfit != null && currentPrice != null && marketCapCr != null && marketCapCr > 0
      ? (ttmNetProfit * currentPrice) / marketCapCr
      : null;

  // P/E (TTM) — algebraically just market_cap_cr / TTM_net_profit_cr.
  const peTTM =
    ttmNetProfit != null && ttmNetProfit > 0 && marketCapCr != null && marketCapCr > 0
      ? marketCapCr / ttmNetProfit
      : null;

  // RoE (TTM) — TTM net profit on latest annual equity.
  const roeTTM =
    ttmNetProfit != null && equityCr != null && equityCr > 0
      ? (ttmNetProfit / equityCr) * 100
      : null;

  // RoCE (TTM) — TTM operating profit on capital employed (Equity + Debt).
  const roceTTM =
    ttmOpProfit != null && capitalEmployedCr != null && capitalEmployedCr > 0
      ? (ttmOpProfit / capitalEmployedCr) * 100
      : null;

  const hasAnyRatio = epsTTM != null || peTTM != null || roeTTM != null || roceTTM != null;

  return (
    <section id="latest-result" className="card p-4 scroll-mt-24">
      <div className="flex items-baseline justify-between gap-3 mb-2.5 flex-wrap">
        <div className="flex items-baseline gap-2">
          <h2 className="font-display text-[16px] leading-none">
            Latest result · {qLabel(cur.period_end)}
          </h2>
          <span className="text-[9.5px] uppercase tracking-[0.12em] muted-text font-semibold">
            Quarterly
          </span>
        </div>
        <span className="text-[10.5px] muted-text tabular-nums">
          Period ended {fmtResultDate(cur.period_end)}
        </span>
      </div>

      {/* Single bordered box containing 4 internal cells. The container's
          background is the border colour; gap-px reveals it through the grid,
          producing clean 1px dividers between cells in both axes (works even
          when the grid wraps to 2 columns on mobile). */}
      <div
        className="rounded-md overflow-hidden p-px"
        style={{ backgroundColor: "var(--color-border-default)" }}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px">
          <StatTile label="Revenue"          value={fmtCr(cur.sales)}            yoy={revYoY} qoq={revQoQ} />
          <StatTile label="Operating profit" value={fmtCr(cur.operating_profit)} yoy={opYoY}  qoq={opQoQ} />
          <StatTile label="Net profit"       value={fmtCr(cur.net_profit)}       yoy={npYoY}  qoq={npQoQ} />
          <MarginTile margin={opmCur} deltaBps={opmDeltaBps} />
        </div>
      </div>

      <p className="mt-2.5 text-[12.5px] leading-relaxed muted-text">
        {interpretQuarter({ revYoY, opYoY, npYoY, opmDeltaBps })}
      </p>

      {/* Row 2 — TTM ratios, same single-bordered-box pattern as row 1. */}
      {hasAnyRatio && (
        <div
          className="rounded-md overflow-hidden p-px mt-2"
          style={{ backgroundColor: "var(--color-border-default)" }}
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px">
            <RatioTile
              label="EPS"
              value={epsTTM == null ? "—" : `₹${epsTTM.toFixed(1)}`}
              hint="TTM · per share"
            />
            <RatioTile
              label="P/E"
              value={peTTM == null ? "—" : `${peTTM.toFixed(1)}×`}
              hint="TTM"
            />
            <RatioTile
              label="RoE"
              value={roeTTM == null ? "—" : `${roeTTM.toFixed(1)}%`}
              hint="TTM"
              threshold={{ value: roeTTM, good: 15, excellent: 18 }}
            />
            <RatioTile
              label="RoCE"
              value={roceTTM == null ? "—" : `${roceTTM.toFixed(1)}%`}
              hint="TTM"
              threshold={{ value: roceTTM, good: 15, excellent: 20 }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

// Sum the last `count` quarters' values for a given P&L field. Returns null
// if any required quarter is missing the field — we don't want half-TTM
// numbers leaking out as if they were full TTM.
function sumQ(
  rows: QuarterLite[],
  start: number,
  count: number,
  field: "sales" | "operating_profit" | "net_profit",
): number | null {
  let total = 0;
  for (let i = start; i < start + count; i++) {
    const v = rows[i]?.[field];
    if (v == null) return null;
    total += v;
  }
  return total;
}

function RatioTile({
  label, value, hint, threshold,
}: {
  label: string;
  value: string;
  hint: string;
  // Optional value-band coloring. When provided and value >= excellent, the
  // tile's number turns vivid green; >= good turns leaf green; otherwise
  // stays ink color. Used for RoE / RoCE where there's a universal threshold.
  threshold?: { value: number | null; good: number; excellent: number };
}) {
  let valueColor: string | undefined = undefined;
  if (threshold && threshold.value != null) {
    if (threshold.value >= threshold.excellent) valueColor = "var(--color-score-excellent)";
    else if (threshold.value >= threshold.good) valueColor = "var(--color-score-good)";
  }
  return (
    <div
      className="px-3 py-2.5"
      style={{ backgroundColor: "var(--color-paper)" }}
    >
      <div className="text-[9.5px] uppercase tracking-[0.1em] muted-text font-semibold truncate">
        {label}
      </div>
      <div
        className="num font-semibold leading-none mt-0.5"
        style={{ color: valueColor ?? "var(--color-ink)", fontSize: 15 }}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[9.5px] muted-text uppercase tracking-[0.08em] truncate">
        {hint}
      </div>
    </div>
  );
}

function StatTile({
  label, value, yoy, qoq,
}: {
  label: string;
  value: string;
  yoy: number | null;
  qoq: number | null;
}) {
  return (
    <div
      className="px-3 py-2.5"
      style={{ backgroundColor: "var(--color-paper)" }}
    >
      <div className="text-[9.5px] uppercase tracking-[0.1em] muted-text font-semibold truncate">
        {label}
      </div>
      <div
        className="num font-semibold leading-none mt-0.5"
        style={{ color: "var(--color-ink)", fontSize: 15 }}
      >
        {value}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2 text-[10.5px] tabular-nums">
        <DeltaPair label="YoY" pct={yoy} />
        <DeltaPair label="QoQ" pct={qoq} />
      </div>
    </div>
  );
}

function MarginTile({
  margin, deltaBps,
}: {
  margin: number | null;
  deltaBps: number | null;
}) {
  const display = margin == null ? "—" : `${margin.toFixed(1)}%`;
  return (
    <div
      className="px-3 py-2.5"
      style={{ backgroundColor: "var(--color-paper)" }}
    >
      <div className="text-[9.5px] uppercase tracking-[0.1em] muted-text font-semibold truncate">
        Op margin
      </div>
      <div
        className="num font-semibold leading-none mt-0.5"
        style={{ color: "var(--color-ink)", fontSize: 15 }}
      >
        {display}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2 text-[10.5px] tabular-nums">
        <span>
          <span className="text-[9px] uppercase tracking-[0.08em] muted-text mr-1 font-semibold">
            YoY Δ
          </span>
          {deltaBps == null ? (
            <span className="muted-text">—</span>
          ) : (
            <span
              className={`num font-semibold ${
                deltaBps > 0 ? "delta-up" : deltaBps < 0 ? "delta-down" : "muted-text"
              }`}
            >
              {deltaBps > 0 ? "+" : ""}
              {deltaBps} bps
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function DeltaPair({ label, pct }: { label: string; pct: number | null }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[9px] uppercase tracking-[0.06em] muted-text font-semibold">
        {label}
      </span>
      {pct == null ? (
        <span className="muted-text">—</span>
      ) : (
        <span
          className={`num font-semibold ${
            pct > 0 ? "delta-up" : pct < 0 ? "delta-down" : "muted-text"
          }`}
        >
          {pct > 0 ? "+" : ""}
          {Math.abs(pct) >= 100 ? Math.round(pct) : pct.toFixed(1)}%
        </span>
      )}
    </span>
  );
}

function pctChange(now: number | null, then: number | null | undefined): number | null {
  if (now == null || then == null || then === 0) return null;
  return (now / then - 1) * 100;
}

function fmtResultDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Rule-based one-liner. No LLM — just a decision tree over the four headline
// deltas. We deliberately phrase observations, not recommendations, to stay
// aligned with the "information surface, not advisory" disclaimer.
function interpretQuarter({
  revYoY, opYoY, npYoY, opmDeltaBps,
}: {
  revYoY: number | null;
  opYoY: number | null;
  npYoY: number | null;
  opmDeltaBps: number | null;
}): string {
  // No YoY anchor available — fall back to a coverage note rather than
  // inventing direction.
  if (revYoY == null && opYoY == null && npYoY == null) {
    return "Year-on-year comparison unavailable — this is the first full quarter we have on record.";
  }

  const revUp = (revYoY ?? 0) > 1;
  const revDown = (revYoY ?? 0) < -1;
  const opUp = (opYoY ?? 0) > 1;
  const opDown = (opYoY ?? 0) < -1;
  const npUp = (npYoY ?? 0) > 1;
  const npDown = (npYoY ?? 0) < -1;
  const marginUp = (opmDeltaBps ?? 0) > 25;
  const marginDown = (opmDeltaBps ?? 0) < -25;

  if (revUp && opUp && npUp && !marginDown) {
    return "Broad-based growth — sales, operating profit, and net profit all rose year-on-year, with margins holding or expanding.";
  }
  if (revUp && (opDown || npDown || marginDown)) {
    return "Top-line grew but profitability slipped — operating costs are rising faster than revenue this quarter.";
  }
  if (revDown && opDown) {
    return "Revenue and operating profit both declined year-on-year — this is a weak quarter on the headline numbers.";
  }
  if (revDown && marginUp) {
    return "Revenue fell but margins expanded — cost discipline cushioned the topline weakness this quarter.";
  }
  if (!revUp && !revDown && opUp && marginUp) {
    return "Flat revenue but stronger operating profit — margin gains are doing the heavy lifting this quarter.";
  }
  if (revUp && opUp && marginUp) {
    return "Sales, operating profit, and margins all expanded year-on-year — a quality growth quarter.";
  }
  // Fallback — neutral description.
  return "Mixed quarter — see the deltas above for the precise direction on each line.";
}

function StatusCard({ status }: { status: string | null }) {
  if (!status || status === "full") return null;
  const labels: Record<string, string> = {
    "partial-cluster-mixed-tiers": "Cluster has few same-tier peers — percentile uses adjacent tiers as fallback.",
    "partial-meta-cluster": "Cluster has very few peers — percentile uses meta-cluster as fallback.",
    "partial-data": "Some metrics unavailable for this stock.",
    "partial-balance-sheet": "Balance-sheet figure (book value) is null — valuation pillar partial.",
    "insufficient_data": "Too little history to compute scores.",
  };
  return (
    <div className="card p-4 text-[12px]">
      <div className="font-medium mb-1">Score status</div>
      <div className="muted-text">{labels[status] || status}</div>
    </div>
  );
}
