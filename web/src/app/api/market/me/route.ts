/**
 * GET /api/market/me — per-user signed-in extras for the /market page.
 *
 * Returns:
 *   - watchlistMovers: every symbol in the signed-in user's watchlist,
 *     with 1D and 1W returns + cluster + quality context.  Sorted by
 *     absolute 1D move so the user sees what's actually moving today
 *     within their tracked names.
 *   - fiiTrend:        60-day FII/DII series for a richer trend chart
 *     (the public card shows only 5 days; signed-in gets the full month).
 *
 * Unauthenticated calls get a clean 401 — the /market page only fires
 * this endpoint when a session is present.
 *
 * Cost (Rule #1): two cheap reads.  Watchlist movers does the same
 * cross-DB pattern as the public 1D movers (universe symbol list →
 * golden price moves → panel context), scoped to ≤100 symbols.
 */
import { NextResponse } from "next/server";
import { sql, golden } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type WatchlistMover = {
  symbol: string;
  company_name: string | null;
  sector_name: string | null;
  industry_name: string | null;
  current_price: number | null;
  ret_1d: number | null;
  ret_1w: number | null;
  composite_pct: number | null;
  quality_pct: number | null;
  maturity_tier: string | null;
};

export type FiiTrendPoint = {
  date: string;
  fii_net: number | null;
  dii_net: number | null;
};

export type MarketMeResponse = {
  watchlistMovers: WatchlistMover[];
  fiiTrend: FiiTrendPoint[];
};

async function loadWatchlistMovers(userId: number): Promise<WatchlistMover[]> {
  // 1. User's saved symbols.
  const watch = await sql<{ symbol: string }[]>`
    SELECT symbol FROM app.user_watchlist
     WHERE user_id = ${userId}
     ORDER BY added_at DESC
     LIMIT 100
  `;
  if (watch.length === 0) return [];
  const symbols = watch.map((w) => w.symbol);

  // 2. Panel cache context (1W return + cluster + quality) — single
  //    indexed read in the app pool.
  const context = await sql<{
    symbol: string;
    company_name: string | null;
    sector_name: string | null;
    industry_name: string | null;
    current_price: number | null;
    ret_1w: number | null;
    composite_pct: number | null;
    quality_pct: number | null;
    maturity_tier: string | null;
  }[]>`
    SELECT
      c.symbol,
      c.company_name,
      mc.name AS sector_name,
      cl.name AS industry_name,
      c.current_price::float AS current_price,
      c.ret_1w::float        AS ret_1w,
      c.composite_pct::float AS composite_pct,
      c.quality_pct::float   AS quality_pct,
      c.maturity_tier
    FROM app.cluster_stocks_panel_cache c
    JOIN app.cluster cl       ON cl.id = c.cluster_id
    JOIN app.meta_cluster mc  ON mc.id = cl.meta_cluster_id
    WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
      AND c.symbol = ANY(${symbols})
  `;
  const ctxBySym = new Map(context.map((c) => [c.symbol, c]));

  // 3. 1D moves from golden for the same symbols.
  const moves1D = await golden<{ symbol: string; pct: number }[]>`
    WITH bounds AS (
      SELECT date AS latest FROM golden.price_history WHERE interval='1d'
       ORDER BY date DESC LIMIT 1
    ),
    prev AS (
      SELECT MAX(date) AS d FROM golden.price_history
       WHERE interval='1d' AND date < (SELECT latest FROM bounds)
    ),
    today_close AS (
      SELECT REPLACE(symbol, '.NS', '') AS symbol, close
        FROM golden.price_history, bounds
       WHERE interval='1d' AND date = bounds.latest
         AND REPLACE(symbol, '.NS', '') = ANY(${symbols})
    ),
    prev_close AS (
      SELECT REPLACE(symbol, '.NS', '') AS symbol, close
        FROM golden.price_history, prev
       WHERE interval='1d' AND date = prev.d
         AND REPLACE(symbol, '.NS', '') = ANY(${symbols})
    )
    SELECT t.symbol, ((t.close - p.close) / NULLIF(p.close, 0))::float AS pct
      FROM today_close t
      JOIN prev_close  p ON p.symbol = t.symbol
     WHERE p.close > 0
  `;
  const pctBySym = new Map(moves1D.map((m) => [m.symbol, m.pct]));

  // 4. Merge — preserve watchlist's display order (newest-added first),
  //    but bring missing-context symbols through with NULLs so the user
  //    still sees them flagged in the UI rather than silently dropped.
  const rows: WatchlistMover[] = [];
  for (const sym of symbols) {
    const c = ctxBySym.get(sym);
    rows.push({
      symbol:        sym,
      company_name:  c?.company_name ?? null,
      sector_name:   c?.sector_name  ?? null,
      industry_name: c?.industry_name ?? null,
      current_price: c?.current_price ?? null,
      ret_1d:        pctBySym.get(sym) ?? null,
      ret_1w:        c?.ret_1w        ?? null,
      composite_pct: c?.composite_pct ?? null,
      quality_pct:   c?.quality_pct   ?? null,
      maturity_tier: c?.maturity_tier ?? null,
    });
  }
  // Sort by |1D| descending so the biggest movers float to the top.
  // Stocks without 1D data sink to the bottom but aren't dropped.
  rows.sort((a, b) => {
    const av = a.ret_1d == null ? -1 : Math.abs(a.ret_1d);
    const bv = b.ret_1d == null ? -1 : Math.abs(b.ret_1d);
    return bv - av;
  });
  return rows;
}

async function loadFiiTrend(): Promise<FiiTrendPoint[]> {
  // 60 trading sessions; reversed so left-to-right is chronological.
  const series = await sql<FiiTrendPoint[]>`
    SELECT date::text, fii_net::float, dii_net::float
      FROM app.fii_dii_flow
     ORDER BY date DESC
     LIMIT 60
  `;
  series.reverse();
  return series;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const [watchlistMovers, fiiTrend] = await Promise.all([
    loadWatchlistMovers(session.userId),
    loadFiiTrend(),
  ]);
  return NextResponse.json({ watchlistMovers, fiiTrend });
}
