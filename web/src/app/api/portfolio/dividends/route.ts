/**
 * GET /api/portfolio/dividends — Dividend forecast, yield on cost, and cash flow schedule.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadPortfolioDividends } from "@/lib/portfolioDividends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  const report = await loadPortfolioDividends(session.userId);
  return NextResponse.json(report, {
    headers: { "Cache-Control": "private, no-cache" },
  });
}
