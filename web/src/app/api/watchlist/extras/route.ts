/**
 * GET /api/watchlist/extras?symbol=SYM — corporate actions + quarterly-result
 * snapshot for a single watched stock. Fetched lazily when a row is opened in
 * the watchlist detail panel (never for the whole list at once).
 *
 * Returns:
 *   dividends  — recent cash dividends (ex_date, amount, purpose)
 *   bonuses    — recent bonus / split actions (ex_date, purpose)
 *   quarterly  — last few quarters (period_end, sales, net_profit, opm%, npm%,
 *                PBT, and YoY growth vs the same quarter a year earlier)
 *   news       — recent headlines (title, source, url, published_at)
 *
 * All three come from app tables keyed by the BARE NSE symbol (no ".NS"),
 * matching what the watchlist stores. Missing data → empty arrays, never an
 * error, so the client can always render.
 *
 * Cost (Rule #1): three small indexed reads, each LIMIT-capped.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Z0-9&-]+$/;

type Dividend = { ex_date: string; amount: number | null; purpose: string | null };
type Bonus = { ex_date: string; action_type: string; purpose: string | null };
type QuarterRaw = {
  period_end: string;
  sales: number | null;
  net_profit: number | null;
  operating_profit: number | null;
  profit_before_tax: number | null;
  opm_pct: number | null;
  npm_pct: number | null;
};
type Quarter = QuarterRaw & {
  /** YoY % change vs the same quarter a year earlier (null if unavailable). */
  sales_yoy: number | null;
  np_yoy: number | null;
};
type NewsItem = {
  title: string;
  source: string | null;
  url: string | null;
  published_at: string;
};

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!raw || !SYMBOL_RE.test(raw) || raw.length > 30) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }

  try {
    const [dividends, bonuses, quarterlyRaw, news] = await Promise.all([
      sql<Dividend[]>`
        SELECT ex_date::text AS ex_date, amount::float AS amount, purpose
          FROM app.corporate_action
         WHERE symbol = ${raw} AND action_type = 'dividend'
         ORDER BY ex_date DESC
         LIMIT 6
      `,
      sql<Bonus[]>`
        SELECT ex_date::text AS ex_date, action_type, purpose
          FROM app.corporate_action
         WHERE symbol = ${raw} AND action_type IN ('bonus', 'rights')
         ORDER BY ex_date DESC
         LIMIT 4
      `,
      sql<QuarterRaw[]>`
        SELECT period_end::text AS period_end,
               sales::float             AS sales,
               net_profit::float        AS net_profit,
               operating_profit::float  AS operating_profit,
               profit_before_tax::float AS profit_before_tax,
               CASE WHEN sales IS NOT NULL AND sales <> 0
                    THEN round((operating_profit / sales * 100)::numeric, 1)::float
                    ELSE NULL END        AS opm_pct,
               CASE WHEN sales IS NOT NULL AND sales <> 0
                    THEN round((net_profit / sales * 100)::numeric, 1)::float
                    ELSE NULL END        AS npm_pct
          FROM app.fundamentals_quarterly
         WHERE symbol = ${raw}
         ORDER BY period_end DESC
         LIMIT 9
      `,
      sql<NewsItem[]>`
        SELECT n.title,
               n.source,
               n.url,
               n.published_at::text AS published_at
          FROM app.news_stock ns
          JOIN app.news n ON n.id = ns.news_id
         WHERE ns.symbol = ${raw}
           AND n.title IS NOT NULL
         ORDER BY n.published_at DESC
         LIMIT 8
      `,
    ]);

    // Attach YoY growth (this quarter vs the same quarter a year earlier). Rows
    // come back newest-first; the same period one year prior sits ~4 rows down.
    const quarterly: Quarter[] = quarterlyRaw.map((q, i) => {
      const prior = quarterlyRaw[i + 4];
      const yoy = (now: number | null, then: number | null): number | null => {
        if (now == null || then == null || then === 0) return null;
        // Guard against sign flips making growth meaningless (loss → profit).
        if (then < 0) return null;
        return Math.round((now / then - 1) * 1000) / 10;
      };
      return {
        ...q,
        sales_yoy: prior ? yoy(q.sales, prior.sales) : null,
        np_yoy: prior ? yoy(q.net_profit, prior.net_profit) : null,
      };
    });
    // Only surface the most recent 5 quarters in the UI; the extra 4 were
    // fetched solely so the oldest displayed quarter still has a YoY base.
    const quarterlyOut = quarterly.slice(0, 5);

    return NextResponse.json({
      symbol: raw,
      dividends,
      bonuses,
      quarterly: quarterlyOut,
      news,
    });
  } catch (err) {
    console.error("watchlist extras failed:", err);
    // Degrade gracefully — the detail panel still renders the chart + scores.
    return NextResponse.json({ symbol: raw, dividends: [], bonuses: [], quarterly: [], news: [] });
  }
}
