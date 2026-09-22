/**
 * GET /api/stock/profile?symbol=SYM — the "what does this company actually do"
 * card behind the ⓘ button in the watchlist detail panel.
 *
 * Fetched ONLY on click, never with the list and never with /watchlist/extras.
 * business_summary averages ~1.5KB of prose; on a 234-name list that is 350KB
 * nobody asked for, and most rows are never opened at all. One symbol, one
 * indexed primary-key read, on demand.
 *
 * Also returns `health` — the derived pros/cons bullets. Three reads, not one,
 * but still three INDEX reads for one symbol on click: the universe row, 11
 * annual statements, 8 shareholding quarters. Folded into THIS route rather
 * than a second endpoint because they are triggered by the same click and
 * consumed by the same card; two routes would mean two loading states and two
 * failure modes for one panel.
 *
 * Why derived rather than scraped: screener.in's own Pros/Cons are HTML-only,
 * and what this repo stores (app.screener_export_raw) is the XLSX export. See
 * lib/businessHealth.ts for the rules the derivation holds itself to.
 *
 * Cost (Rule #1): PK read from app.universe, plus two index-prefix scans on
 * (symbol, period_end DESC) with LIMITs. No joins.
 *
 * Freshness caveat, stated because the UI has to say it: every
 * business_info_fetched_at in the table is 2026-05-04 — one backfill, nothing
 * maintains it. 2,142 of 2,593 active symbols have a summary; anything
 * onboarded after that date has none. The route returns `fetchedAt` so the
 * client can date the card rather than implying it is live.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { assessBusiness, type AnnualRow, type ShareRow } from "@/lib/businessHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Z0-9&-]+$/;

type ProfileRow = {
  symbol: string;
  company_name: string;
  sector: string | null;
  industry: string | null;
  market_cap_category: string | null;
  listing_date: string | null;
  business_summary: string | null;
  website: string | null;
  employees: number | null;
  ceo_name: string | null;
  ceo_title: string | null;
  fetched_at: string | null;
};

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!raw || !SYMBOL_RE.test(raw) || raw.length > 30) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }

  try {
    const rows = await sql<ProfileRow[]>`
      SELECT symbol,
             company_name,
             sector,
             industry,
             market_cap_category,
             listing_date::text            AS listing_date,
             business_summary,
             website,
             employees,
             ceo_name,
             ceo_title,
             business_info_fetched_at::text AS fetched_at
        FROM app.universe
       WHERE symbol = ${raw}
       LIMIT 1
    `;
    if (!rows.length) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // 11 rows so a 10-year span has both ends; the assessor uses 5 and falls
    // back to 3. 8 quarters of ownership is two years — long enough that a
    // promoter stake change is a decision rather than a rounding artefact.
    const [annual, shares] = await Promise.all([
      sql<AnnualRow[]>`
        SELECT period_end::text AS period_end, sales, operating_profit, other_income, interest,
               profit_before_tax, net_profit, dividend_amount, equity_share_capital,
               reserves, borrowings, no_of_equity_shares, cash_from_operating
          FROM app.fundamentals_annual
         WHERE symbol = ${raw}
         ORDER BY period_end DESC
         LIMIT 11
      `,
      sql<ShareRow[]>`
        SELECT period_end::text AS period_end, promoter_pct, pledge_pct
          FROM app.shareholding_pattern
         WHERE symbol = ${raw}
         ORDER BY period_end DESC
         LIMIT 8
      `,
    ]);

    return NextResponse.json({
      ...rows[0],
      health: assessBusiness(annual, shares, rows[0].sector),
    });
  } catch (err) {
    console.error("stock profile failed:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
