/**
 * GET /api/stock/profile?symbol=SYM — the "what does this company actually do"
 * card behind the ⓘ button in the watchlist detail panel.
 *
 * Fetched ONLY on click, never with the list and never with /watchlist/extras.
 * business_summary averages ~1.5KB of prose; on a 234-name list that is 350KB
 * nobody asked for, and most rows are never opened at all. One symbol, one
 * indexed primary-key read, on demand.
 *
 * Cost (Rule #1): single row from app.universe by PK. No joins.
 *
 * Freshness caveat, stated because the UI has to say it: every
 * business_info_fetched_at in the table is 2026-05-04 — one backfill, nothing
 * maintains it. 2,142 of 2,593 active symbols have a summary; anything
 * onboarded after that date has none. The route returns `fetchedAt` so the
 * client can date the card rather than implying it is live.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

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
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error("stock profile failed:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
