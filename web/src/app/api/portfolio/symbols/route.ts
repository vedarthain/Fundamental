/**
 * GET /api/portfolio/symbols — the mapped universe symbols the signed-in user
 * currently holds. Cheap membership list (no valuation), used by the Portfolio
 * tab on /watchlist to feed the same card renderer as the watchlist itself.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadPortfolioSymbols, loadPortfolioReturns } from "@/lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ signedIn: false, symbols: [], returns: null }, { status: 200 });
  }
  // Trailing returns ride along on the membership call the Scorecard tab
  // already makes, so the performance strip costs no extra client round trip.
  const [symbols, returns] = await Promise.all([
    loadPortfolioSymbols(session.userId),
    loadPortfolioReturns(session.userId).catch(() => null),
  ]);
  return NextResponse.json({ signedIn: true, symbols, returns });
}
