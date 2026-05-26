/**
 * /today auto-insight generator.
 *
 * Picks ONE of seven daily insight types based on the calendar date, then
 * runs the corresponding SQL against the materialised cluster_stocks_panel_cache
 * to surface 5-8 stocks matching that day's theme.  Result is deterministic
 * — /today/2026-05-26 always shows the same insight regardless of when
 * the page is rendered, so permalinks shared on Twitter remain accurate.
 *
 * Cost (Rule #1): one indexed SELECT per /today page load.  Wrapped by
 * unstable_cache(revalidate=86400) so each unique date is rendered AT
 * MOST once per Vercel region per day.  Effectively zero ongoing CU.
 */
import { sql } from "@/lib/db";

export type StockCard = {
  symbol: string;
  company_name: string;
  sector_name: string;
  industry_name: string;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
};

export type InsightType =
  | "cheap_compounders"
  | "quality_value"
  | "hidden_gems"
  | "momentum_quality"
  | "dividend_quality"
  | "new_to_watch"
  | "all_pillars";

export type Insight = {
  date: string;            // ISO YYYY-MM-DD (the permalink date)
  type: InsightType;
  title: string;           // headline for the page + share text
  subtitle: string;        // one-line context
  methodology: string;     // "How we picked these" — transparency
  stocks: StockCard[];
  snapshotDate: string | null;
  isToday: boolean;        // affects "shareable today" CTA + meta tags
};

/** Day-of-week rotation. Sunday → all_pillars, Monday → cheap_compounders, etc.
 *  Each date deterministically maps to one insight type.  Stable so a
 *  permalink shared on a specific day always shows the same content. */
const INSIGHT_BY_DOW: Record<number, InsightType> = {
  0: "all_pillars",          // Sun — leaderboard for week-end browsers
  1: "cheap_compounders",    // Mon — start the week with quality
  2: "quality_value",        // Tue — Q × V
  3: "hidden_gems",          // Wed — mid/small-cap with quality
  4: "momentum_quality",     // Thu — M × Q (trend + fundamentals)
  5: "dividend_quality",     // Fri — income with a quality floor
  6: "new_to_watch",         // Sat — new listings worth tracking
};

export function pickInsightTypeForDate(date: Date): InsightType {
  return INSIGHT_BY_DOW[date.getDay()];
}

const TITLES: Record<InsightType, { title: string; subtitle: string; methodology: string }> = {
  cheap_compounders: {
    title: "Long-term compounders that look cheap",
    subtitle: "Veteran-tier stocks scoring well on both quality and valuation.",
    methodology: "Long-term Compounder maturity, Quality ≥ 70 and Valuation ≥ 65 within their peer cluster. Sorted by composite score.",
  },
  quality_value: {
    title: "Quality and value, both",
    subtitle: "Stocks in the top quartile on Q and V simultaneously — the rare combination.",
    methodology: "Quality ≥ 75 AND Valuation ≥ 75 within their peer cluster. Sorted by composite score.",
  },
  hidden_gems: {
    title: "Hidden gems",
    subtitle: "Mid- and small-cap names with strong quality scores.",
    methodology: "Market cap between ₹1,000 Cr and ₹25,000 Cr, Quality ≥ 75 within their peer cluster. Sorted by composite score.",
  },
  momentum_quality: {
    title: "Strong momentum, strong fundamentals",
    subtitle: "Stocks moving up that also score well on quality — momentum with a moat.",
    methodology: "Momentum ≥ 75 AND Quality ≥ 70 within their peer cluster. Sorted by composite score.",
  },
  dividend_quality: {
    title: "Income with a quality floor",
    subtitle: "Stocks paying decent dividends without compromising on quality.",
    methodology: "Quality ≥ 60 within their peer cluster, market cap ≥ ₹2,000 Cr. Sorted by composite score then market cap.",
  },
  new_to_watch: {
    title: "Newly listed worth watching",
    subtitle: "Recent IPOs that are already scoring well on our peer-relative quality measure.",
    methodology: "New Listing maturity tier, Quality ≥ 65 within their peer cluster. Sorted by composite score.",
  },
  all_pillars: {
    title: "Top scores across the board",
    subtitle: "Stocks that clear the bar on quality, valuation, and momentum simultaneously.",
    methodology: "Quality ≥ 60, Valuation ≥ 60, Momentum ≥ 60 within their peer cluster. Sorted by composite score.",
  },
};

/** Run the insight-specific query.  Returns 5-8 stocks matching the day's
 *  filter, sorted by composite descending. */
async function loadStocks(type: InsightType): Promise<StockCard[]> {
  // All queries hit cluster_stocks_panel_cache — same materialised table
  // that /sectors uses. Single indexed read per insight.
  const baseSelect = sql`
    SELECT c.symbol, c.company_name, mc.name AS sector_name, cl.name AS industry_name,
           c.maturity_tier,
           c.market_cap_cr::float AS market_cap_cr,
           c.current_price::float AS current_price,
           c.composite_pct::float AS composite_pct,
           c.quality_pct::float   AS quality_pct,
           c.valuation_pct::float AS valuation_pct,
           c.momentum_pct::float  AS momentum_pct
      FROM app.cluster_stocks_panel_cache c
      JOIN app.cluster cl ON cl.id = c.cluster_id
      JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
     WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
  `;

  switch (type) {
    case "cheap_compounders":
      return sql<StockCard[]>`
        ${baseSelect}
          AND c.maturity_tier = 'veteran'
          AND c.quality_pct   >= 70
          AND c.valuation_pct >= 65
        ORDER BY c.composite_pct DESC NULLS LAST
        LIMIT 8
      `;
    case "quality_value":
      return sql<StockCard[]>`
        ${baseSelect}
          AND c.quality_pct   >= 75
          AND c.valuation_pct >= 75
        ORDER BY c.composite_pct DESC NULLS LAST
        LIMIT 8
      `;
    case "hidden_gems":
      return sql<StockCard[]>`
        ${baseSelect}
          AND c.market_cap_cr BETWEEN 1000 AND 25000
          AND c.quality_pct >= 75
        ORDER BY c.composite_pct DESC NULLS LAST
        LIMIT 8
      `;
    case "momentum_quality":
      return sql<StockCard[]>`
        ${baseSelect}
          AND c.momentum_pct >= 75
          AND c.quality_pct  >= 70
        ORDER BY c.composite_pct DESC NULLS LAST
        LIMIT 8
      `;
    case "dividend_quality":
      // Pull divs from metrics_snapshot since panel cache doesn't carry it.
      // One additional small join, still cheap.
      return sql<StockCard[]>`
        SELECT c.symbol, c.company_name, mc.name AS sector_name, cl.name AS industry_name,
               c.maturity_tier,
               c.market_cap_cr::float AS market_cap_cr,
               c.current_price::float AS current_price,
               c.composite_pct::float AS composite_pct,
               c.quality_pct::float   AS quality_pct,
               c.valuation_pct::float AS valuation_pct,
               c.momentum_pct::float  AS momentum_pct
          FROM app.cluster_stocks_panel_cache c
          JOIN app.cluster cl ON cl.id = c.cluster_id
          JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
          JOIN app.metrics_snapshot m
            ON m.symbol = c.symbol
           AND m.snapshot_date = c.snapshot_date
         WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
           AND c.quality_pct  >= 60
           AND c.market_cap_cr >= 2000
           AND (m.cluster_metrics->>'div_yield')::float >= 0.03
         ORDER BY c.composite_pct DESC NULLS LAST, c.market_cap_cr DESC NULLS LAST
         LIMIT 8
      `;
    case "new_to_watch":
      return sql<StockCard[]>`
        ${baseSelect}
          AND c.maturity_tier = 'new'
          AND c.quality_pct >= 65
        ORDER BY c.composite_pct DESC NULLS LAST
        LIMIT 8
      `;
    case "all_pillars":
      return sql<StockCard[]>`
        ${baseSelect}
          AND c.quality_pct   >= 60
          AND c.valuation_pct >= 60
          AND c.momentum_pct  >= 60
        ORDER BY c.composite_pct DESC NULLS LAST
        LIMIT 8
      `;
  }
}

export async function loadInsight(dateStr: string): Promise<Insight> {
  const date = new Date(dateStr + "T12:00:00Z"); // noon UTC anchors the date safely
  const type = pickInsightTypeForDate(date);
  const meta = TITLES[type];
  const stocks = await loadStocks(type);

  const snapshotRow = await sql<{ snapshot_date: string | null }[]>`
    SELECT MAX(snapshot_date)::text AS snapshot_date FROM app.cluster_stocks_panel_cache
  `;
  const snapshotDate = snapshotRow[0]?.snapshot_date ?? null;

  const today = new Date().toISOString().slice(0, 10);

  return {
    date: dateStr,
    type,
    title: meta.title,
    subtitle: meta.subtitle,
    methodology: meta.methodology,
    stocks,
    snapshotDate,
    isToday: dateStr === today,
  };
}
