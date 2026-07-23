import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { sql, golden } from "@/lib/db";
import { band, bandColor, fmtPct, fmtRupeesCr, tierLabel, displayCompanyName, isRecentListing, listingYear, hasScoreableHistory, monthsSinceListing, ordinal } from "@/lib/score";
import { WatchlistButton } from "@/components/WatchlistButton";
import { PriceChart, type PricePoint } from "@/components/PriceChart";
import type { SparkPoint } from "@/components/Sparkline";
import { type PillarTabContent } from "@/components/PillarTabs";
import { StrengthsPanel } from "@/components/StrengthsPanel";
import { buildSpider } from "@/lib/spider";
import { buildPillarStory } from "@/lib/explainer";
import {
  qualityNarration, valuationNarration, momentumNarration,
} from "@/lib/companyNarration";
import { BusinessVisual } from "@/components/BusinessVisual";
import { AboutTabs } from "@/components/AboutTabs";
import { StockPageTabs } from "@/components/StockPageTabs";
import { StockActionsTabs } from "@/components/StockActionsTabs";
import { TrendSection, TrendCommentary } from "@/components/TrendSection";
import { ScoreHistoryChart, type ScoreHistoryPoint } from "@/components/ScoreHistoryChart";
import { loadPersistenceForSymbol } from "@/lib/persistence";
import { getOIAlertForSymbol, type OIAlert } from "@/lib/oi-alerts";
import { AlertTriangle } from "lucide-react";

// Stock fundamentals + scores change weekly at most. 6h cache cuts Neon wakes
// significantly — with 2,000+ stock pages each revalidating at 30min, the
// previous setting caused up to 4,000 DB wakes/day from ISR alone.
export const revalidate = 21600;

// Next.js delivers dynamic route params URL-ENCODED — a symbol like "M&MFIN"
// (Mahindra & Mahindra Financial) arrives as "M%26MFIN". Querying that literal
// against app.universe never matches, so the page 404s. Decode once here so
// '&'-bearing symbols (M&M, M&MFIN, …) resolve. Guarded against malformed
// escapes so a stray '%' can't throw.
function decodeSymbolParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

type ShareholdingRow = {
  period_end: string;
  pledge_pct?: number | null;
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
  other_income: number | null;
  depreciation: number | null;
  interest: number | null;
  profit_before_tax: number | null;
  tax: number | null;
};

type Scorecard = {
  pillar_weights: Record<string, number>;
  quality: Record<string, number>;
  valuation: Record<string, number>;
  momentum: Record<string, number>;
};

/**
 * Per-page SEO metadata (audit #6/#35). Every /stock/* route previously
 * inherited the generic homepage <title>, so all ~2,200 stock pages were
 * indistinguishable to Google. This gives each a unique title + description
 * built from the company, its industry peer-group and (when the stock clears
 * the history gate) its composite band — the same hasScoreableHistory rule the
 * page body uses, so we never advertise a score we then suppress on the page.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ symbol: string }> },
): Promise<Metadata> {
  const { symbol } = await params;
  const upper = decodeSymbolParam(symbol).toUpperCase();
  const rows = await sql<{
    company_name: string; industry_name: string; sector_name: string;
    listing_date: string | null; years_of_data: number | null;
    composite_pct: number | null; quality_pct: number | null;
    valuation_pct: number | null; momentum_pct: number | null;
  }[]>`
    SELECT u.company_name, c.name AS industry_name, mc.name AS sector_name,
           u.listing_date::text AS listing_date, u.years_of_data,
           s.composite_pct, s.quality_pct, s.valuation_pct, s.momentum_pct
    FROM app.universe u
    JOIN app.cluster_assignment ca USING (symbol)
    JOIN app.cluster c ON c.id = ca.cluster_id
    JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    LEFT JOIN app.scores s
      ON s.symbol = u.symbol
     AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
    WHERE u.symbol = ${upper} AND u.is_active
    LIMIT 1
  `.catch(() => []);

  if (rows.length === 0) {
    return { title: `${upper} — stock not found · EquityRoots` };
  }
  const r = rows[0];
  const name = displayCompanyName(r.company_name, upper);
  const scoreable = hasScoreableHistory(r.listing_date, r.years_of_data);

  const title = scoreable && r.composite_pct != null
    ? `${name} (${upper}) — Score ${r.composite_pct}, Quality · Valuation · Momentum · EquityRoots`
    : `${name} (${upper}) — Quality, Valuation & Momentum vs peers · EquityRoots`;

  const scorePhrase = scoreable && r.composite_pct != null
    ? `Composite ${r.composite_pct}/100 (${band(r.composite_pct)}) — Quality ${r.quality_pct ?? "—"}, Valuation ${r.valuation_pct ?? "—"}, Momentum ${r.momentum_pct ?? "—"}.`
    : `Fundamental profile — quality, valuation and momentum.`;
  const description =
    `${name} (${upper}) scored against its real industry peers in ${r.industry_name} (${r.sector_name}). ${scorePhrase} See the full breakdown, peer ranking and 10-year fundamentals on EquityRoots.`;

  return {
    title,
    description,
    alternates: { canonical: `/stock/${upper}` },
    openGraph: { title, description, type: "website", url: `/stock/${upper}` },
    twitter: { card: "summary", title, description },
  };
}

async function loadStock(symbol: string) {
  const upper = symbol.toUpperCase();
  // Base identity (name, cluster/industry/sector, tier) comes from STABLE tables
  // — app.universe + app.cluster_assignment — NOT app.scores. The score is
  // LEFT-JOINed from the CURRENT snapshot only. This means a symbol gated out of
  // the latest scoring run (stale/dormant filings — score_status "stale_data",
  // no scores row) still renders its page (fundamentals, price, news) with the
  // score cleanly withheld, instead of either 404-ing or falling back to a
  // last-scored OLDER snapshot and showing a stale composite as if it were
  // current. Verified scores.cluster_id/maturity_tier == cluster_assignment/
  // universe for every scored symbol, so sourcing them here is equivalent.
  const rows = await sql<Stock[]>`
    SELECT
      u.symbol, u.company_name, u.sector, u.industry, u.listing_date::text, u.years_of_data,
      u.business_summary, u.website, u.employees,
      u.ceo_name, u.ceo_title,
      ca.cluster_id AS industry_id, c.name AS industry_name, mc.id AS sector_id, mc.name AS sector_name,
      u.maturity_tier, sm.market_cap_cr, sm.current_price,
      sm.price_fetched_at::text,
      s.composite_pct, s.quality_pct, s.valuation_pct, s.momentum_pct,
      s.quality_components, s.valuation_components, s.momentum_components,
      s.score_status
    FROM app.universe u
    JOIN app.cluster_assignment ca USING (symbol)
    JOIN app.cluster c ON c.id = ca.cluster_id
    JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    LEFT JOIN app.screener_meta sm USING (symbol)
    LEFT JOIN app.scores s
      ON s.symbol = u.symbol
     AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
    WHERE u.symbol = ${upper} AND u.is_active
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const stock = rows[0];

  // No score for the current snapshot → the symbol was gated (e.g. stale_data)
  // or otherwise not scored this run. Surface the withheld state so the page
  // shows the "scores withheld" notice (StatusCard) rather than a blank void.
  // Percentiles are already null from the LEFT JOIN; the score UI is null-safe.
  if (stock.composite_pct == null && !stock.score_status) {
    stock.score_status = "stale_data";
  }
  stock.quality_components = stock.quality_components || {};
  stock.valuation_components = stock.valuation_components || {};
  stock.momentum_components = stock.momentum_components || {};

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
  `.catch(() => [] as AnnualRow[]);
  // Latest 6 quarters
  const quarterly = await sql<QuarterlyRow[]>`
    SELECT period_end::text,
           sales::float, operating_profit::float, net_profit::float,
           other_income::float, depreciation::float, interest::float,
           profit_before_tax::float, tax::float
    FROM app.fundamentals_quarterly
    WHERE symbol = ${upper}
    ORDER BY period_end DESC
    LIMIT 6
  `.catch(() => [] as QuarterlyRow[]);
  // Daily price history — full available range. golden_db keeps daily back to
  // ~1996 for most NSE stocks. ~7K rows × 30 bytes ≈ 50KB gzipped, fine to
  // ship to the client so the chart can support 1D/1W/1M zoom client-side.
  const priceHistory = await golden<PricePoint[]>`
    SELECT date::text, COALESCE(adj_close, close)::float AS close
    FROM golden.price_history
    WHERE symbol = ${upper + ".NS"} AND interval = '1d'
    ORDER BY date ASC
  `.catch(() => [] as PricePoint[]);
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
  `.catch(() => [] as { ts: string; ltp: number }[]);

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
  `.catch(() => [] as { median: number; rank: number; peer_count: number }[]);

  // Full score history — all weekly snapshots for this symbol from app.scores,
  // oldest to newest.  The LEFT JOIN computes the peer-cluster composite average
  // at each snapshot using the stock's current cluster_id (stable in practice).
  // Used by the Score history chart on the Trend tab.
  const scoreHistory = await sql<ScoreHistoryPoint[]>`
    SELECT
      s.snapshot_date::text,
      s.composite_pct::float AS composite_pct,
      s.quality_pct::float   AS quality_pct,
      s.valuation_pct::float AS valuation_pct,
      s.momentum_pct::float  AS momentum_pct,
      ca.avg_composite       AS cluster_avg
    FROM app.scores s
    LEFT JOIN (
      SELECT snapshot_date, AVG(composite_pct)::float AS avg_composite
        FROM app.scores
       WHERE cluster_id = ${stock.industry_id}
         AND composite_pct IS NOT NULL
       GROUP BY snapshot_date
    ) ca ON ca.snapshot_date = s.snapshot_date
    WHERE s.symbol = ${upper}
    ORDER BY s.snapshot_date ASC
  `.catch(() => [] as ScoreHistoryPoint[]);

  // OI spike check — detects quarters where a large one-time "other income"
  // has inflated net profit and downstream scoring metrics (P/E, CAGR, ROE).
  // Financial-sector stocks are excluded (their investment income is structural).
  const oiAlert = await getOIAlertForSymbol(upper, stock.sector_id).catch(() => null);

  // Scorecard for this (cluster, tier) — needed to build the SHAP waterfall weights
  const scRow = await sql<Scorecard[]>`
    SELECT pillar_weights, quality, valuation, momentum
    FROM app.cluster_scorecard_active
    WHERE cluster_id = ${stock.industry_id}
  `.catch(() => [] as Scorecard[]);
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
           pledge_pct::float      AS pledge_pct,
           shareholders::bigint   AS shareholders
    FROM app.shareholding_pattern
    WHERE symbol = ${upper}
    ORDER BY period_end DESC
    LIMIT 4
  `.catch(() => [] as ShareholdingRow[]);

  // Corporate actions (dividends — BSE serves the actual per-share amounts;
  // ~last 5 actions per stock, which in practice are dividends). Fail-soft: if
  // the table isn't present in this environment yet (migration 0032 not
  // applied), return none rather than 500-ing the whole stock page.
  type CARow = { action_type: string; ex_date: string | null; purpose: string; amount: number | null };
  let corporateActions: CARow[] = [];
  try {
    // Corporate actions come from two sources — indianapi (full history) and
    // BSE (recent dividends, fresher between indianapi runs). Dedup on
    // (action_type, ex_date) preferring indianapi so an action covered by both
    // shows once (the richer indianapi row wins).
    corporateActions = await sql<CARow[]>`
      SELECT action_type, ex_date::text, purpose, amount::float
        FROM (
          SELECT DISTINCT ON (action_type, ex_date)
                 action_type, ex_date, purpose, amount
            FROM app.corporate_action
           WHERE symbol = ${upper}
           ORDER BY action_type, ex_date, (source = 'indianapi') DESC
        ) d
       ORDER BY ex_date DESC NULLS LAST
       LIMIT 12
    `;
  } catch {
    corporateActions = [];
  }

  // Recent news tagged to this stock (best-effort; from broadcaster RSS).
  // Fail-soft if the news tables aren't present in this environment yet.
  type StockNews = { title: string; source: string; url: string; published_at: string | null };
  let stockNews: StockNews[] = [];
  try {
    const rawNews = await sql<StockNews[]>`
      SELECT n.title, n.source, n.url, n.published_at::text
        FROM app.news_stock ns JOIN app.news n ON n.id = ns.news_id
       WHERE ns.symbol = ${upper}
         AND n.published_at > now() - interval '6 months'
       ORDER BY n.published_at DESC NULLS LAST
       LIMIT 80
    `;
    stockNews = cleanStockNews(rawNews);
  } catch {
    stockNews = [];
  }

  // Corporate announcements (exchange filings) for this stock — from BSE.
  // Fail-soft if app.announcement isn't present in this environment yet.
  type Announcement = {
    title: string; category: string | null; headline: string | null;
    published_at: string | null; pdf_url: string | null;
  };
  let announcements: Announcement[] = [];
  try {
    announcements = await sql<Announcement[]>`
      SELECT title, category, headline, published_at::text, pdf_url
        FROM app.announcement
       WHERE symbol = ${upper}
       ORDER BY published_at DESC NULLS LAST
       LIMIT 30
    `;
  } catch {
    announcements = [];
  }

  // Next upcoming corporate event (board meeting, dividend, split, bonus) for
  // the "Next event" chip in the stock page header.
  type NextEvent = { action_type: string; ex_date: string; purpose: string };
  let nextEvent: NextEvent | null = null;
  try {
    const nextRows = await sql<NextEvent[]>`
      SELECT DISTINCT ON (action_type)
        action_type, ex_date::text, purpose
      FROM app.corporate_action
      WHERE symbol = ${upper}
        AND ex_date >= CURRENT_DATE
      ORDER BY action_type, ex_date ASC
    `;
    // Prefer board_meeting > dividend > others as the "most informative" upcoming event
    nextEvent =
      nextRows.find((r) => r.action_type === "board_meeting") ??
      nextRows.find((r) => r.action_type === "dividend") ??
      nextRows[0] ??
      null;
  } catch {
    nextEvent = null;
  }

  return {
    stock, scorecard, annual, quarterly, priceHistory, intradayTicks, shareholding,
    corporateActions, stockNews, announcements, scoreHistory, oiAlert, nextEvent,
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
  const { symbol: rawSymbol } = await params;
  const symbol = decodeSymbolParam(rawSymbol);
  const [data, persistence] = await Promise.all([
    loadStock(symbol),
    loadPersistenceForSymbol(symbol),
  ]);
  if (!data) return notFound();
  const { stock, scorecard, annual, quarterly, priceHistory, intradayTicks, shareholding, corporateActions, stockNews, announcements, scoreHistory, oiAlert, nextEvent, rankInIndustry, industryPeerCount } = data;

  // Some app.universe.company_name rows are polluted with the ".NS" Yahoo
  // suffix (e.g. "INFY.NS"). Strip it once here so every downstream render —
  // header, About card, BusinessVisual, TrendCommentary, page metadata — shows
  // the clean name.
  stock.company_name = displayCompanyName(stock.company_name, stock.symbol);

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
  // Minimum-history gate: a fresh IPO (e.g. INNOVISION, listed Mar 2026) can
  // score in the top decile on ~3 months of price history. Suppress the
  // percentile/rank display when trading history is under a year — the score
  // math is untouched; we just don't present a misleading number.
  const scoreable = hasScoreableHistory(stock.listing_date, stock.years_of_data);
  const listedMonths = monthsSinceListing(stock.listing_date);

  // Pillar data for the Strengths & gaps tab (graphs-first StrengthsPanel).
  const pillarTabs: PillarTabContent[] = [
    {
      pillar: "Quality",
      pct: stock.quality_pct,
      oneLineSummary: pillarStories[0].summary,
      companyNarration: qualityNarration(stockMeta, annual, stock.quality_components || {}, stock.quality_pct),
      strength: pillarStories[0].strength,
      gap: pillarStories[0].gap,
      trends: computePillarTrends("Quality", annual),
    },
    {
      pillar: "Valuation",
      pct: stock.valuation_pct,
      oneLineSummary: pillarStories[1].summary,
      companyNarration: valuationNarration(stockMeta, stock.valuation_components || {}, stock.valuation_pct),
      strength: pillarStories[1].strength,
      gap: pillarStories[1].gap,
      trends: computePillarTrends("Valuation", annual),
    },
    {
      pillar: "Momentum",
      pct: stock.momentum_pct,
      oneLineSummary: pillarStories[2].summary,
      companyNarration: momentumNarration(stockMeta, stock.momentum_components || {}, quarterly, stock.momentum_pct),
      strength: pillarStories[2].strength,
      gap: pillarStories[2].gap,
      trends: computePillarTrends("Momentum", annual),
    },
  ];

  // Result declaration — the BSE result filing for the latest quarter (declared
  // after period_end). From the already-loaded announcements; the EARLIEST match
  // after period_end is the declaration (later ones are presentations etc.).
  // Fail-soft to null if announcements don't cover it.
  const latestQ = quarterly[0];
  const isResultAnn = (a: { title: string; category: string | null }) =>
    /result/i.test(a.category ?? "") ||
    /financial results|board meeting outcome|audited|unaudited|quarterly results/i.test(a.title);
  const resultMatches = latestQ
    ? announcements.filter(
        (a) => a.published_at != null && a.published_at.slice(0, 10) >= latestQ.period_end && isResultAnn(a),
      )
    : [];
  const resultDecl = resultMatches.length ? resultMatches[resultMatches.length - 1] : null;
  const declaration = resultDecl
    ? { date: resultDecl.published_at, pdfUrl: resultDecl.pdf_url }
    : null;

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
          <div className="text-[12px] muted-text uppercase tracking-wide flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{stock.sector_name} · {stock.industry_name} · {tierLabel(stock.maturity_tier)}</span>
            {isRecentListing(stock.listing_date) && stock.maturity_tier !== "new" && (
              <span
                className="inline-flex items-center rounded px-1.5 py-[1px] text-[10px] font-semibold normal-case"
                style={{ background: "color-mix(in srgb, var(--color-accent-600) 14%, transparent)", color: "var(--color-accent-700)" }}
                title={`Recent IPO — listed ${listingYear(stock.listing_date)}. The maturity tier reflects years of financial history, not how long it has been listed.`}
              >
                Recent IPO · {listingYear(stock.listing_date)}
              </span>
            )}
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
            <span
              className="inline-flex items-center rounded px-1.5 py-[1px] text-[10px] font-semibold tracking-wide"
              style={{
                background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)",
                color: "var(--color-accent-700)",
              }}
              title="Listed on the National Stock Exchange of India"
            >
              NSE
            </span>
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
            {nextEvent && (
              <>
                <span>·</span>
                <span
                  className="inline-flex items-center rounded px-1.5 py-[1px] text-[10.5px] font-medium"
                  style={{ background: "color-mix(in srgb, var(--color-accent-600) 10%, transparent)", color: "var(--color-accent-700)" }}
                  title={nextEvent.purpose}
                >
                  {nextEvent.action_type === "board_meeting"
                    ? "Board meeting"
                    : nextEvent.action_type === "dividend"
                    ? "Dividend ex-date"
                    : nextEvent.action_type === "split"
                    ? "Split"
                    : nextEvent.action_type === "bonus"
                    ? "Bonus"
                    : "Event"}{" — "}
                  {new Date(nextEvent.ex_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
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

        {/* Peer-rank badge — right-aligned on desktop, left-aligned on mobile
            (so it follows the stacked name block flush-left).

            Rank is the single hero across every maturity tier and cluster
            size. We deliberately do NOT also show the composite percentile
            or an "Industry Score" number: the score IS a within-bucket
            percentile, so for a peer-relative metric it restates the rank,
            and a percentile ("≈100 pctile", "Top 1%") overstates precision
            in a 15-stock group. One honest unit — "#N of M" — with the peer
            count always visible so the reader can calibrate. */}
        <div className="text-left md:text-right shrink-0">
          {scoreable && rankInIndustry != null && industryPeerCount != null && industryPeerCount > 1 ? (
            <div
              className="inline-block px-4 py-2 rounded-md"
              style={{ backgroundColor: compositeBg, color: compositeBand === "neutral" ? "var(--color-ink)" : "white" }}
            >
              <div className="text-[11px] uppercase tracking-wide opacity-80">
                Industry Rank
              </div>
              <div className="text-[28px] font-medium tabular-nums leading-none mt-1">
                {ordinal(rankInIndustry)}
                <span className="text-[13px] font-normal opacity-80"> of {industryPeerCount}</span>
              </div>
            </div>
          ) : scoreable ? (
            /* Sole name in its peer group (or rank unavailable): no meaningful
               "#1 of 1" to show, so fall back to the composite band number. */
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
          ) : (
            <div
              className="inline-block px-4 py-2 rounded-md border hairline"
              style={{ backgroundColor: "var(--color-card)" }}
            >
              <div className="text-[11px] uppercase tracking-wide muted-text">
                Industry Score
              </div>
              <div className="text-[16px] font-medium leading-none mt-1.5 ink-text">
                Unscored
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Single asterisked footnote replaces the three-line description that
          used to sit under the Industry Score badge.  Compact, one line
          where possible, italic so it reads as an annotation. */}
      {scoreable && stock.composite_pct != null && (
        <p className="text-[11px] muted-text italic mt-2 leading-snug">
          * Ranked within {stock.industry_name} · {tierLabel(stock.maturity_tier)}
          {industryPeerCount != null && industryPeerCount > 1 ? ` (${industryPeerCount}-stock peer group)` : ""} —
          position among peers in the same industry and maturity, not the whole
          market. Not a buy/sell recommendation.
        </p>
      )}
      {!scoreable && (
        <p className="text-[11px] muted-text italic mt-2 leading-snug">
          * Unscored — insufficient trading history
          {listedMonths != null ? ` (listed ~${Math.round(listedMonths)} months ago)` : ""}.
          A percentile needs at least a year of price history to be meaningful; a
          fresh listing can rank near the top on a fluke, so we withhold the number
          until the record is long enough to trust.
        </p>
      )}

      {/* One-time other income alert — shown when the latest quarter contains a
          large non-recurring "other income" that inflates net profit and
          downstream metrics (P/E TTM, CAGR, ROE).  Score may normalize once
          this quarter rolls out of the trailing window. */}
      {/* Promoter pledge warning — shown when the latest quarter has meaningful pledge % */}
      {(() => {
        const latestPledge = shareholding[0]?.pledge_pct;
        if (latestPledge == null || latestPledge < 5) return null;
        const isHigh = latestPledge >= 30;
        return (
          <div
            className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-md mt-3 text-[12.5px] leading-snug"
            style={{
              background: isHigh
                ? "color-mix(in srgb, #dc2626 10%, transparent)"
                : "color-mix(in srgb, #d97706 10%, transparent)",
              color: isHigh ? "#991b1b" : "#92400e",
            }}
          >
            <AlertTriangle size={14} className="shrink-0 mt-[1px]" strokeWidth={2.2} />
            <span>
              <strong>Governance alert — promoter pledge:</strong>{" "}
              {latestPledge.toFixed(1)}% of promoter shares are pledged as of{" "}
              {shareholding[0].period_end.slice(0, 7)}.
              {isHigh
                ? " High pledge levels can force distressed selling if collateral value falls."
                : " Monitor for increases — rising pledge is a governance red flag."}
            </span>
          </div>
        );
      })()}

      {oiAlert && (
        <div
          className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-md mt-3 text-[12.5px] leading-snug"
          style={{ background: "color-mix(in srgb, #b45309 10%, transparent)", color: "#92400e" }}
        >
          <AlertTriangle size={14} className="shrink-0 mt-[1px]" strokeWidth={2.2} />
          <span>
            <strong>Score alert — one-time other income:</strong>{" "}
            The {oiAlert.period_end.slice(0, 7)} quarter reported ₹{Math.round(oiAlert.oi_cr).toLocaleString("en-IN")} Cr
            in other income — {oiAlert.spike_ratio.toFixed(0)}× the 8-quarter average and{" "}
            {Math.round(oiAlert.oi_pct_pbt)}% of pre-tax profit.
            Metrics derived from net profit (P/E, CAGR, ROE) may be temporarily elevated
            until this quarter rolls out of the trailing window.
          </span>
        </div>
      )}

      <StockPageTabs
        results={
          <LatestResultCard
            quarterly={quarterly}
            annual={annual}
            marketCapCr={stock.market_cap_cr}
            currentPrice={stock.current_price}
            declaration={declaration}
          />
        }
        about={
          <>
            {/* About on the left (with an Overview / Further details sub-tab),
                price chart pinned top-right. */}
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 items-start">
              <div className="min-w-0">
                {stock.business_summary ? (
                  <AboutTabs
                    overview={
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
                    }
                    details={<AboutCard stock={stock} priceHistoryStart={priceHistory[0]?.date ?? null} />}
                  />
                ) : (
                  <AboutCard stock={stock} priceHistoryStart={priceHistory[0]?.date ?? null} />
                )}
              </div>
              <PriceChartCard symbol={stock.symbol} history={priceHistory} intraday={intradayTicks} currentPrice={stock.current_price} priceFetchedAt={stock.price_fetched_at} />
            </div>
            {stockNews.length > 0 && (
              <div className="mt-6">
                <StockNewsCard news={stockNews} />
              </div>
            )}
          </>
        }
        actions={
          <StockActionsTabs
            announcements={<AnnouncementsCard announcements={announcements} symbol={stock.symbol} />}
            corporate={
              corporateActions.length > 0 ? (
                <CorporateActionsCard actions={corporateActions} />
              ) : (
                <div className="card p-6 muted-text text-[13px]">
                  No corporate actions on record yet for {stock.symbol}. Dividends,
                  bonus/splits and board meetings will appear here once published.
                </div>
              )
            }
          />
        }
        strengths={
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8">
            <section className="card p-6">
              <h2 className="font-display text-[20px] mb-2">Strengths and gaps</h2>
              <p className="text-[13px] muted-text mb-6">
                The charts are this stock&apos;s underlying metric trends across all three
                pillars; the bars below show where it ranks within {stock.industry_name} ·{" "}
                {tierLabel(stock.maturity_tier)} peers (the middle line is the cluster median).
              </p>
              <StrengthsPanel tabs={pillarTabs} strengthRows={strengthRows} />
            </section>

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
          <div className="space-y-6 max-w-[960px]">
            {/* Full score history — all available weekly snapshots with
                3M / 6M / All toggle.  This is the primary R1 chart. */}
            <ScoreHistoryChart data={scoreHistory} />

            {/* 4-snapshot detail: stock vs cluster, gap table, narrative. */}
            <div>
              <div className="text-[11px] uppercase tracking-wide muted-text mb-3">
                Recent trajectory — last {persistence.series.length} snapshot{persistence.series.length !== 1 ? "s" : ""}
              </div>
              {/* Two strictly equal-width, equal-height cards.  Grid uses
                  auto-rows-fr to force the row to the tallest item's height
                  (default behaviour) AND each card has its own min-h floor
                  so when content is short the cards don't collapse. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch auto-rows-fr">
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
            </div>
          </div>
        }
        numbers={<FundamentalsTables annual={annual} quarterly={quarterly} />}
      />
    </div>
  );
}

/** Human-readable label for each pillar's percentile level. */
function pillarLabel(pillar: string, value: number | null): string | null {
  if (value == null) return null;
  const v = Math.round(value);
  if (pillar === "Valuation") {
    if (v >= 70) return "Undervalued";
    if (v >= 35) return "Fairly Valued";
    return "Overvalued";
  }
  if (pillar === "Quality") {
    if (v >= 70) return "High Quality";
    if (v >= 35) return "Average";
    return "Weak";
  }
  if (pillar === "Momentum") {
    if (v >= 70) return "Rising";
    if (v >= 35) return "Neutral";
    return "Fading";
  }
  return null;
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
          const lbl = pillarLabel(r.label, r.value);
          return (
            <div key={r.label}>
              <div className="flex items-center justify-between">
                <div className="font-medium text-[14px]">{r.label}</div>
                {lbl && (
                  <span
                    className="text-[10.5px] font-medium rounded px-1.5 py-[1px]"
                    style={{
                      color: bandColor(b),
                      background: `color-mix(in srgb, ${bandColor(b)} 12%, transparent)`,
                    }}
                  >
                    {lbl}
                  </span>
                )}
              </div>
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

/* ----------------------- Corporate actions card -------------------- */

const CA_STYLE: Record<string, { label: string; color: string }> = {
  dividend:      { label: "Dividend",      color: "var(--color-score-good)" },
  split:         { label: "Split",         color: "var(--color-accent-600)" },
  bonus:         { label: "Bonus",         color: "var(--color-accent-600)" },
  rights:        { label: "Rights",        color: "var(--color-score-weak)" },
  buyback:       { label: "Buyback",       color: "var(--color-score-good)" },
  board_meeting: { label: "Board meeting", color: "var(--color-muted)" },
  other:         { label: "Action",        color: "var(--color-muted)" },
};

function CorporateActionsCard({
  actions,
}: {
  actions: { action_type: string; ex_date: string | null; purpose: string; amount: number | null }[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide muted-text">Corporate actions</div>
          <div className="font-display text-[18px] mt-0.5">Dividends, bonus &amp; board meetings</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="muted-text text-[10px] uppercase tracking-wide text-left">
              <th className="font-medium py-1 pr-2">Ex-date</th>
              <th className="font-medium py-1 px-2">Type</th>
              <th className="font-medium py-1 px-2">Details</th>
              <th className="font-medium py-1 pl-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a, i) => {
              const st = CA_STYLE[a.action_type] ?? CA_STYLE.other;
              const upcoming = a.ex_date != null && a.ex_date >= today;
              return (
                <tr key={`${a.ex_date}-${a.purpose}-${i}`} className="border-t hairline">
                  <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">
                    {a.ex_date ? fmtResultDate(a.ex_date) : "—"}
                    {upcoming && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wide rounded px-1 py-[1px]"
                        style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}>
                        upcoming
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 px-2">
                    <span className="inline-block rounded px-1.5 py-[1px] text-[10.5px] font-medium"
                      style={{ background: `color-mix(in srgb, ${st.color} 12%, transparent)`, color: st.color }}>
                      {st.label}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 muted-text">{a.purpose}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">
                    {a.amount != null ? `₹${a.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ----------------------- Announcements card ------------------------ */

/** Colour-code the BSE category so filings scan quickly. */
function annCatColor(category: string | null): string {
  const c = (category || "").toLowerCase();
  if (c.includes("result")) return "var(--color-score-good)";
  if (c.includes("board")) return "var(--color-accent-600)";
  if (c.includes("corp action") || c.includes("dividend")) return "var(--color-accent-700)";
  if (c.includes("insider") || c.includes("sast")) return "var(--color-score-weak)";
  return "var(--color-muted)";
}

// Pure-boilerplate headlines that add nothing beyond the (generic) title.
const ANN_GENERIC = new Set([
  "press release", "media release", "enclosed", "as per the enclosed file",
  "as per enclosed", "please find enclosed", "please find attached",
  "please find enclosed herewith", "please find attached herewith",
  "n.a.", "na", "not applicable", "intimation",
]);

/** The BSE HEADLINE shown as a couple of detail lines under the often-generic
 *  title (e.g. many filings share "…Reg 30 (LODR)-Press Release/Media Release"
 *  but the headline says what it actually is). Suppress pure boilerplate and
 *  headlines that just repeat the title. */
function announcementDetail(title: string, headline: string | null): string | null {
  if (!headline) return null;
  const h = headline.trim().replace(/\s+/g, " ");
  if (h.length < 12) return null;
  const hl = h.toLowerCase().replace(/[.\s]+$/, "");
  const tl = title.toLowerCase();
  if (ANN_GENERIC.has(hl)) return null;
  if (tl.includes(hl) || hl.includes(tl)) return null; // duplicate of the title
  return h;
}

function AnnouncementsCard({
  announcements,
  symbol,
}: {
  announcements: { title: string; category: string | null; headline: string | null; published_at: string | null; pdf_url: string | null }[];
  symbol: string;
}) {
  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide muted-text">Announcements</div>
          <div className="font-display text-[18px] mt-0.5">Latest exchange filings</div>
        </div>
      </div>
      {announcements.length === 0 ? (
        <div className="muted-text text-[13px]">
          No recent announcements on record for {symbol}. SEBI disclosures, board
          outcomes and other filings will appear here once published.
        </div>
      ) : (
        <div className="space-y-1.5">
          {announcements.map((a, i) => {
            const color = annCatColor(a.category);
            const date = a.published_at ? fmtResultDate(a.published_at.slice(0, 10)) : "";
            const detail = announcementDetail(a.title, a.headline);
            const Inner = (
              <>
                <div className="flex items-center gap-2 text-[10px] mb-0.5">
                  {a.category && (
                    <span className="inline-block rounded px-1.5 py-[1px] font-medium uppercase tracking-wide"
                      style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
                      {a.category}
                    </span>
                  )}
                  <span className="muted-text tabular-nums">{date}</span>
                </div>
                <div className="text-[13px] leading-snug">{a.title}</div>
                {detail && (
                  <div className="muted-text text-[12px] mt-0.5 leading-snug line-clamp-2">{detail}</div>
                )}
              </>
            );
            return a.pdf_url ? (
              <a
                key={`${a.title}-${i}`}
                href={a.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-md px-2 py-1.5 -mx-2 hover:bg-[var(--color-paper)] transition-colors"
              >
                {Inner}
              </a>
            ) : (
              <div key={`${a.title}-${i}`} className="px-2 py-1.5 -mx-2">{Inner}</div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------ In the news ------------------------ */

// Listicle / recommendation headlines to drop from a stock's news feed — these
// are "stocks to watch/buy today" filler, not news about the company. Mirrors
// DISPLAY_RECO_RE in the /news feed, plus the bare "stocks to watch" form
// (no leading number) so "Stocks to watch today: X, Y, Z" is caught too.
const STOCK_RECO_RE =
  /\b(?:stocks?|shares?)\s+to\s+(?:buy|sell|bet|grab|add|watch)\b|\b\d+\s+(?:stocks?|shares?)\s+to\s+(?:buy|sell|bet|grab|add|watch)\b|\btop\s+(?:stock\s+)?picks?\b|\bstock\s+picks?\b|\bbuy\s+or\s+sell\b|\bshould\s+you\s+(?:buy|sell|invest)\b|\bmulti-?bagger\w*|\bstock\s+tips?\b|\b(?:stock|share)\s+recommendations?\b|\btrade\s+setups?\b|\btrading\s+guide\b|\bintraday\s+(?:pick|tip|trade)\w*|\bbuy\s+this\s+stock\b|\bbest\s+(?:stocks?|shares?)\s+to\b|\bhot\s+stocks?\b|\bstocks?\s+to\s+watch\s+today\b/i;

/** Normalised title key for dedup — case/punctuation/whitespace-insensitive so
 *  the same story syndicated across sources collapses to one row. */
function newsKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Drop recommendation filler, then de-duplicate by normalised title (keeping
 *  the most recent, since the query is already ordered newest-first). */
function cleanStockNews(
  rows: { title: string; source: string; url: string; published_at: string | null }[],
): { title: string; source: string; url: string; published_at: string | null }[] {
  const seen = new Set<string>();
  const out: typeof rows = [];
  for (const n of rows) {
    if (!n.title || STOCK_RECO_RE.test(n.title)) continue;
    const key = newsKey(n.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function StockNewsCard({
  news,
}: {
  news: { title: string; source: string; url: string; published_at: string | null }[];
}) {
  const ago = (iso: string | null) => {
    if (!iso) return "";
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 60) return `${Math.max(1, m)}m ago`;
    if (m < 1440) return `${Math.floor(m / 60)}h ago`;
    const d = Math.floor(m / 1440);
    if (d < 30) return `${d}d ago`;
    return `${Math.floor(d / 30)}mo ago`;
  };
  const shown = news.slice(0, 12);
  return (
    <section className="card p-6">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide muted-text">In the news</div>
          <div className="font-display text-[20px] mt-0.5">Recent headlines</div>
        </div>
        <span className="text-[10.5px] muted-text">
          {news.length} stor{news.length === 1 ? "y" : "ies"} · deduplicated · links open source
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
        {shown.map((n, i) => (
          <a
            key={`${n.url}-${i}`}
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-md px-2.5 py-2 -mx-2 border-b hairline hover:bg-[var(--color-paper)] transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] muted-text mb-0.5">
              <span className="font-medium uppercase tracking-wide" style={{ color: "var(--color-accent-700)" }}>{n.source}</span>
              <span className="tabular-nums">· {ago(n.published_at)}</span>
            </div>
            <div className="text-[13.5px] leading-snug">{n.title}</div>
          </a>
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
      <p className="text-[12px] leading-relaxed muted-text max-w-[820px] mt-3">
        <strong className="ink-text">What this score does not do.</strong> It measures how good
        the <em>reported</em> numbers are versus peers — it assumes those numbers are accurate.
        It is <strong>not a fraud or governance check</strong>: it does not detect misstated
        revenue, circular/related-party transactions, aggressive accounting, auditor
        resignations, or regulatory actions (e.g. a SEBI order). Always read the company&apos;s
        filings, cash flows and any regulatory disclosures yourself. Information only — not
        investment advice.
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
  other_income: number | null;
  depreciation: number | null;
  interest: number | null;
  profit_before_tax: number | null;
  tax: number | null;
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
  quarterly, annual, marketCapCr, currentPrice, declaration,
}: {
  quarterly: QuarterLite[];
  annual: AnnualLiteForRatios[];
  marketCapCr: number | null;
  currentPrice: number | null;
  /** When + the filing link for the latest result's declaration. */
  declaration?: { date: string | null; pdfUrl: string | null } | null;
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
          {qoq && <> · prev {qLabel(qoq.period_end)}</>}
          {declaration?.date && (
            <> · declared {fmtResultDate(declaration.date.slice(0, 10))}
              {declaration.pdfUrl && (
                <>
                  {" · "}
                  <a
                    href={declaration.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: "var(--color-accent-600)" }}
                  >
                    filing ↗
                  </a>
                </>
              )}
            </>
          )}
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
          <StatTile label="Revenue"          value={fmtCr(cur.sales)}            prev={qoq ? fmtCr(qoq.sales) : null}            yoyBase={yoy ? fmtCr(yoy.sales) : null}            yoy={revYoY} qoq={revQoQ} />
          <StatTile label="Operating profit" value={fmtCr(cur.operating_profit)} prev={qoq ? fmtCr(qoq.operating_profit) : null} yoyBase={yoy ? fmtCr(yoy.operating_profit) : null} yoy={opYoY}  qoq={opQoQ} />
          <StatTile label="Net profit"       value={fmtCr(cur.net_profit)}       prev={qoq ? fmtCr(qoq.net_profit) : null}       yoyBase={yoy ? fmtCr(yoy.net_profit) : null}       yoy={npYoY}  qoq={npQoQ}
            note="Profit attributable to shareholders (excludes minority interest). For holding companies (e.g. Vedanta) this is lower than the consolidated 'Net Profit' some sources show — it's the figure EPS is based on." />
          <MarginTile margin={opmCur} deltaBps={opmDeltaBps} />
        </div>
      </div>

      {/* Progress — a short narrative of how the quarter moved, beside the
          tiles. Headline read + phrased revenue / profit / margin lines. */}
      <div className="mt-3 rounded-md p-3" style={{ background: "var(--color-paper)" }}>
        <div className="text-[10px] uppercase tracking-[0.12em] muted-text font-semibold mb-1">
          Progress
        </div>
        <div className="text-[13px] font-medium leading-snug" style={{ color: "var(--color-ink)" }}>
          {interpretQuarter({ revYoY, opYoY, npYoY, opmDeltaBps, opQoQ, npQoQ })}
        </div>
        <ul className="mt-1.5 space-y-0.5 text-[12.5px] muted-text">
          {quarterProgressLines({ revYoY, revQoQ, npYoY, npQoQ, opmCur, opmDeltaBps }).map((l, i) => (
            <li key={i} className="flex gap-1.5">
              <span aria-hidden style={{ opacity: 0.5 }}>·</span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Earnings-quality flags — rule-based heads-up (low-quality beat, tax one-offs). */}
      <ResultQualityFlags cur={cur} />

      {/* Full P&L for the quarter — collapsed by default. */}
      <PnlExpander cur={cur} periodLabel={qLabel(cur.period_end)} />

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
  label, value, prev, yoyBase, yoy, qoq, note,
}: {
  label: string;
  value: string;
  /** Previous quarter's value, shown under the current for direct comparison. */
  prev?: string | null;
  /** Year-ago quarter's value — tooltip base for the YoY delta. */
  yoyBase?: string | null;
  yoy: number | null;
  qoq: number | null;
  /** Optional hover note on the tile (e.g. net-profit definition). */
  note?: string;
}) {
  return (
    <div
      className="px-3 py-2.5"
      style={{ backgroundColor: "var(--color-paper)" }}
      title={note}
    >
      <div className="text-[9.5px] uppercase tracking-[0.1em] muted-text font-semibold truncate flex items-center gap-1">
        {label}
        {note && <span aria-hidden style={{ opacity: 0.6 }}>ⓘ</span>}
      </div>
      <div
        className="num font-semibold leading-none mt-0.5"
        style={{ color: "var(--color-ink)", fontSize: 15 }}
      >
        {value}
      </div>
      {prev && (
        <div className="text-[9.5px] muted-text tabular-nums mt-0.5">
          prev <span className="ink-text">{prev}</span>
        </div>
      )}
      <div className="mt-1.5 flex items-baseline gap-2 text-[10.5px] tabular-nums">
        <DeltaPair label="YoY" pct={yoy} base={yoyBase} />
        <DeltaPair label="QoQ" pct={qoq} base={prev} />
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

function DeltaPair({
  label, pct, base,
}: {
  label: string;
  pct: number | null;
  /** Formatted comparison value (the prior period's figure) for the tooltip. */
  base?: string | null;
}) {
  // A huge % off a tiny base ("+2,208%") is technically right but misleading,
  // so beyond +300% we show the cleaner MULTIPLE (e.g. +23×). The tooltip
  // always carries the exact % and the base value.
  const extreme = pct != null && pct >= 300;
  let text = "—";
  if (pct != null) {
    if (extreme) {
      const mult = 1 + pct / 100; // 2208% → 23.08×
      text = `+${mult >= 10 ? Math.round(mult) : mult.toFixed(1)}×`;
    } else {
      text = `${pct > 0 ? "+" : ""}${Math.abs(pct) >= 100 ? Math.round(pct) : pct.toFixed(1)}%`;
    }
  }
  const pctText = pct == null ? "n/a" : `${pct > 0 ? "+" : ""}${Math.round(pct)}%`;
  const title = base
    ? `${label}: ${pctText} vs ${base}${extreme ? " (low base)" : ""}`
    : undefined;
  return (
    <span className="inline-flex items-baseline gap-1" title={title}>
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
          {text}
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
  revYoY, opYoY, npYoY, opmDeltaBps, opQoQ, npQoQ,
}: {
  revYoY: number | null;
  opYoY: number | null;
  npYoY: number | null;
  opmDeltaBps: number | null;
  opQoQ: number | null;
  npQoQ: number | null;
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

  const base = (() => {
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
  })();

  // Sequential (QoQ) context. A YoY headline can hide a sharp sequential move,
  // which is exactly what a strong-base quarter looks like (audit #3/#20). We
  // surface — but don't editorialise — a material sequential drop: a QoQ swing
  // is often seasonal (e.g. jewellery Q3 festive vs Q4), so we state the number
  // rather than call it deterioration.
  const seqDrop = Math.min(npQoQ ?? 0, opQoQ ?? 0);
  if (seqDrop <= -15) {
    const which = (npQoQ ?? 0) <= (opQoQ ?? 0) ? "Net profit" : "Operating profit";
    return `${base} ${which} fell ${Math.abs(Math.round(seqDrop))}% from the prior quarter, so the year-on-year gain overstates current momentum.`;
  }
  return base;
}

/** A few plain-English lines on how the quarter progressed — phrasing the
 *  revenue / profit / margin moves so the result reads as a story, not just
 *  tiles. */
function quarterProgressLines(p: {
  revYoY: number | null; revQoQ: number | null;
  npYoY: number | null;  npQoQ: number | null;
  opmCur: number | null; opmDeltaBps: number | null;
}): string[] {
  const both = (yo: number | null, qo: number | null): string | null => {
    const parts = [
      yo != null ? `${yo >= 0 ? "+" : ""}${Math.round(yo)}% YoY` : null,
      qo != null ? `${qo >= 0 ? "+" : ""}${Math.round(qo)}% QoQ` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  };
  const lines: string[] = [];

  const rev = both(p.revYoY, p.revQoQ);
  if (rev) {
    const trend = (p.revYoY ?? 0) > 1 ? "growing" : (p.revYoY ?? 0) < -1 ? "declining" : "flat";
    lines.push(`Revenue is ${trend} (${rev}).`);
  }
  const np = both(p.npYoY, p.npQoQ);
  if (np) {
    // When YoY and QoQ point opposite ways (up on a weak year-ago base, down
    // sequentially), don't lead with "higher year-on-year" — that buries the
    // sequential move. State both directions with equal billing (audit #3/#20).
    const diverges =
      p.npYoY != null && p.npQoQ != null &&
      Math.sign(p.npYoY) !== Math.sign(p.npQoQ) &&
      Math.abs(p.npQoQ) >= 10;
    if (diverges) {
      const yoy = p.npYoY as number, qoq = p.npQoQ as number;
      lines.push(
        `Net profit ${yoy >= 0 ? "up" : "down"} ${Math.abs(Math.round(yoy))}% year-on-year but ` +
        `${qoq >= 0 ? "up" : "down"} ${Math.abs(Math.round(qoq))}% versus the prior quarter.`,
      );
    } else {
      const trend = (p.npYoY ?? 0) > 1 ? "higher" : (p.npYoY ?? 0) < -1 ? "lower" : "broadly flat";
      lines.push(`Net profit is ${trend} year-on-year (${np}).`);
    }
  }
  if (p.opmCur != null) {
    let m = `Operating margin at ${p.opmCur.toFixed(1)}%`;
    if (p.opmDeltaBps != null && Math.abs(p.opmDeltaBps) >= 10) {
      m += ` — ${p.opmDeltaBps >= 0 ? "expanded" : "contracted"} ${Math.abs(Math.round(p.opmDeltaBps))} bps vs a year ago`;
    }
    lines.push(m + ".");
  }
  return lines;
}

/* ----------------- Full P&L expander + earnings-quality flags ------- */

function PnlRow({
  label, value, pct = false, bold = false,
}: {
  label: string;
  value: number | null;
  pct?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between px-3 py-1.5">
      <span className={`text-[12px] ${bold ? "ink-text font-semibold" : "muted-text"}`}>{label}</span>
      <span className={`num tabular-nums text-[12.5px] ${bold ? "font-semibold" : ""}`}>
        {value == null ? "—" : pct ? `${value.toFixed(1)}%` : fmtCr(value)}
      </span>
    </div>
  );
}

/** Collapsed full income statement for the latest quarter (the line items
 *  behind Revenue → PBT → Net profit). Hidden if the source lacks the detail. */
function PnlExpander({ cur, periodLabel }: { cur: QuarterLite; periodLabel: string }) {
  const pbt = cur.profit_before_tax, tax = cur.tax, np = cur.net_profit;
  const eff = tax != null && pbt != null && pbt !== 0 ? (tax / pbt) * 100 : null;
  // PAT = PBT − Tax. For holding companies (minority interest) this is HIGHER
  // than the net profit attributable to shareholders (our `net_profit`); the
  // gap is minority interest (+ any associate/exceptional adjustment). Surface
  // it so the waterfall closes instead of looking inconsistent.
  const pat = pbt != null && tax != null ? pbt - tax : null;
  const minorityEtc = pat != null && np != null ? pat - np : null;
  const showMinority = minorityEtc != null && Math.abs(minorityEtc) >= Math.max(1, 0.01 * Math.abs(pat ?? 0));
  if (pbt == null && cur.other_income == null && tax == null) return null;
  return (
    <details className="mt-2.5">
      <summary className="cursor-pointer select-none text-[12px] muted-text hover:text-[var(--color-ink)] transition-colors">
        Full P&amp;L · {periodLabel}
      </summary>
      <div className="mt-2 rounded-md overflow-hidden border hairline divide-y">
        <PnlRow label="Revenue" value={cur.sales} />
        <PnlRow label="Operating profit (EBITDA)" value={cur.operating_profit} />
        <PnlRow label="+ Other income" value={cur.other_income} />
        <PnlRow label="− Depreciation" value={cur.depreciation} />
        <PnlRow label="− Interest" value={cur.interest} />
        <PnlRow label="Profit before tax" value={pbt} bold />
        <PnlRow label="− Tax" value={tax} />
        <PnlRow label="Effective tax rate" value={eff} pct />
        {showMinority ? (
          <>
            <PnlRow label="Profit after tax" value={pat} />
            <PnlRow label="− Minority & other" value={minorityEtc} />
            <PnlRow label="Net profit (attributable)" value={np} bold />
          </>
        ) : (
          <PnlRow label="Net profit" value={np} bold />
        )}
      </div>
    </details>
  );
}

/** Rule-based earnings-quality heads-up: large non-operating income share of
 *  pre-tax profit (low-quality beat) and tax-rate anomalies (one-offs). */
function ResultQualityFlags({ cur }: { cur: QuarterLite }) {
  const flags: string[] = [];
  const oi = cur.other_income, pbt = cur.profit_before_tax, tax = cur.tax;
  if (oi != null && pbt != null && pbt > 0 && oi / pbt >= 0.25) {
    flags.push(`${Math.round((oi / pbt) * 100)}% of pre-tax profit is non-operating (other) income`);
  }
  if (tax != null && pbt != null && pbt > 0) {
    const rate = (tax / pbt) * 100;
    if (rate < 10) flags.push(`Low effective tax rate (${rate.toFixed(0)}%) — may include one-off credits`);
    else if (rate > 40) flags.push(`High effective tax rate (${rate.toFixed(0)}%)`);
  }
  if (flags.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {flags.map((f, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]"
          style={{
            background: "color-mix(in srgb, var(--color-score-weak) 14%, transparent)",
            color: "var(--color-score-weak)",
          }}
        >
          ⚑ {f}
        </span>
      ))}
    </div>
  );
}

function StatusCard({ status }: { status: string | null }) {
  if (!status || status === "full") return null;
  const labels: Record<string, string> = {
    "partial-cluster-mixed-tiers": "Cluster has few same-tier peers — percentile uses adjacent tiers as fallback.",
    "partial-meta-cluster": "Cluster has very few peers — percentile uses meta-cluster as fallback.",
    "partial-data": "Some metrics unavailable for this stock.",
    "partial-balance-sheet": "Balance-sheet figure (book value) is null — valuation pillar partial.",
    "insufficient_data": "Too little history to compute scores.",
    "stale_data": "Latest available filings are over a year old — scores withheld until fresh results arrive.",
  };
  return (
    <div className="card p-4 text-[12px]">
      <div className="font-medium mb-1">Score status</div>
      <div className="muted-text">{labels[status] || status}</div>
    </div>
  );
}
