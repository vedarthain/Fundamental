/**
 * GET /api/portfolio/deferred — tab payloads that must not block first paint.
 *
 * /portfolio's Holdings tab only needs loadPortfolio. Realized P&L, the trade
 * log, the import ledger, and (owner-only) performance used to ride on the
 * same Promise.all, so opening the page paid 1,810 trade rows before the
 * holdings table could render. This route is fetched after paint, and again
 * whenever the RSC tree refreshes (import / manual trade).
 *
 * Auth-gated. Non-owners still get booked + transactions; performance fields
 * stay null — same split as the page.
 */
import { NextResponse } from "next/server";
import { getSession, isAdminRequest } from "@/lib/auth";
import {
  loadRealizedPnl,
  loadTradeLog,
  loadImportLog,
  loadPerformanceStats,
  loadRealizedTimeline,
} from "@/lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  const owner = await isAdminRequest();
  const [realized, tradeLog, importLog, perf, timeline] = await Promise.all([
    loadRealizedPnl(session.userId),
    loadTradeLog(session.userId),
    loadImportLog(session.userId),
    owner ? loadPerformanceStats(session.userId) : Promise.resolve(null),
    owner ? loadRealizedTimeline(session.userId) : Promise.resolve(null),
  ]);

  return NextResponse.json({ realized, tradeLog, importLog, owner, perf, timeline });
}
