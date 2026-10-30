/**
 * Admin-only portfolio holdings (qty + blended avg cost per symbol), for the
 * verdict detail page's header — "how much do I actually own" next to the
 * verdict, not just a yes/no "is this in the portfolio" flag.
 *
 * Reuses loadHeldPositions() from src/lib/portfolio.ts verbatim — the same
 * function the watchlist route already uses for its position badges — rather
 * than re-deriving qty/avg-cost from app.portfolio_holding here. One holdings
 * calc, read by both.
 *
 * Session-scoped, not query-param-scoped: "my portfolio" means the signed-in
 * admin's own holdings (session.userId), same as every other portfolio read
 * in this app. isAdminRequest() still gates it because this route lives under
 * /api/admin and is only ever called from the admin verdict page.
 */
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { getSession } from "@/lib/auth";
import { loadHeldPositions } from "@/lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ positions: {} }, { headers: { "Cache-Control": "no-store" } });
  }

  let positions: Record<string, { qty: number; avgCost: number | null }> = {};
  try {
    positions = await loadHeldPositions(session.userId);
  } catch {
    positions = {};
  }

  return NextResponse.json({ positions }, { headers: { "Cache-Control": "no-store" } });
}
