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
import { NextRequest, NextResponse } from "next/server";
import { getSession, isAdminRequest } from "@/lib/auth";
import {
  loadPortfolio,
  loadRealizedPnl,
  loadTradeLog,
  loadImportLog,
  loadPerformanceStats,
  loadRealizedTimeline,
} from "@/lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  const owner = await isAdminRequest();
  const liveOnly = req.nextUrl.searchParams.get("liveOnly") === "1";

  if (liveOnly) {
    const portfolio = await loadPortfolio(session.userId);
    const perf = owner ? await loadPerformanceStats(session.userId, portfolio) : null;
    return NextResponse.json(
      { portfolio, perf },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [portfolio, realized, tradeLog, importLog, timeline] = await Promise.all([
    loadPortfolio(session.userId),
    loadRealizedPnl(session.userId),
    loadTradeLog(session.userId),
    loadImportLog(session.userId),
    owner ? loadRealizedTimeline(session.userId) : Promise.resolve(null),
  ]);
  const perf = owner ? await loadPerformanceStats(session.userId, portfolio) : null;

  return NextResponse.json(
    { portfolio, realized, tradeLog, importLog, owner, perf, timeline },
    { headers: { "Cache-Control": "no-store" } },
  );
}
