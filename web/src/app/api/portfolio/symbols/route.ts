/**
 * GET /api/portfolio/symbols — the mapped universe symbols the signed-in user
 * currently holds. Cheap membership list (no valuation), used by the Portfolio
 * tab on /watchlist to feed the same card renderer as the watchlist itself.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadPortfolioSymbols } from "@/lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ signedIn: false, symbols: [] }, { status: 200 });
  }
  const symbols = await loadPortfolioSymbols(session.userId);
  return NextResponse.json({ signedIn: true, symbols });
}
