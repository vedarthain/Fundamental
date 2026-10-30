/**
 * Admin-only: the latest annual-fundamentals row and the latest shareholding
 * row for one symbol — the two props VerdictPanel's "All Parameters Used in
 * Analysis" section (sections 1 and 3) needs but doesn't fetch itself.
 *
 * VerdictPanel already renders that whole section from three optional props
 * (latestAnnual, stock, shareholding). The stock page passes all three
 * (loadStock() in src/app/stock/[symbol]/page.tsx); the admin verdict Detail
 * page only ever passed `data`, so sections 1 (Audited Statements) and 3
 * (Shareholding & Governance) were silently empty — section 2 (Financial
 * Ratios) still rendered because it reads verdict.evidence, which travels
 * with VerdictData already.
 *
 * Deliberately just the ONE latest row of each, not loadStock()'s full
 * 10-year annual + 40-quarter shareholding history — this page shows one
 * snapshot, not the trend charts the stock page's FundamentalsTables build
 * from the fuller range.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  net_block: number | null;
  receivables: number | null;
};

type ShareholdingRow = {
  period_end: string;
  promoter_pct: number | null;
  fii_pct: number | null;
  dii_pct: number | null;
  pledge_pct: number | null;
};

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }

  const symbol = req.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  let latestAnnual: AnnualRow | null = null;
  try {
    const rows = await sql<AnnualRow[]>`
      SELECT period_end::text,
             sales::float, operating_profit::float, net_profit::float, cash_from_operating::float,
             total_assets::float, borrowings::float,
             equity_share_capital::float, reserves::float,
             depreciation::float, net_block::float, receivables::float
        FROM app.fundamentals_annual
       WHERE symbol = ${symbol}
       ORDER BY period_end DESC
       LIMIT 1
    `;
    latestAnnual = rows[0] ?? null;
  } catch {
    latestAnnual = null;
  }

  let shareholding: ShareholdingRow | null = null;
  try {
    const rows = await sql<ShareholdingRow[]>`
      SELECT period_end::text,
             promoter_pct::float AS promoter_pct,
             fii_pct::float AS fii_pct,
             dii_pct::float AS dii_pct,
             pledge_pct::float AS pledge_pct
        FROM app.shareholding_pattern
       WHERE symbol = ${symbol}
       ORDER BY period_end DESC
       LIMIT 1
    `;
    shareholding = rows[0] ?? null;
  } catch {
    shareholding = null;
  }

  return NextResponse.json({ latestAnnual, shareholding }, { headers: { "Cache-Control": "no-store" } });
}
