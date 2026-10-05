/**
 * Signed-in home. `/dashboard` is a redirect, not a page of widgets.
 * Holdings win; otherwise watchlist (saved names or open calls); else
 * empty /portfolio so the import CTA is the first thing a new account sees.
 */
import "server-only";
import { sql } from "@/lib/db";
import { loadPortfolioSymbols } from "@/lib/portfolio";
import { SIGNED_IN_HOME } from "@/lib/homePath";

export { SIGNED_IN_HOME };

export type SignedInHome = "/portfolio" | "/watchlist";

export async function resolveSignedInHome(userId: number): Promise<SignedInHome> {
  const [held, saved, calls] = await Promise.all([
    loadPortfolioSymbols(userId).catch(() => [] as string[]),
    sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM app.user_watchlist WHERE user_id = ${userId}
    `.then((r) => r[0]?.n ?? 0).catch(() => 0),
    sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM app.stock_call
       WHERE user_id = ${userId} AND cleared_at IS NULL
    `.then((r) => r[0]?.n ?? 0).catch(() => 0),
  ]);
  if (held.length > 0) return "/portfolio";
  if (saved > 0 || calls > 0) return "/watchlist";
  return "/portfolio";
}
