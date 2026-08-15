/**
 * /api/scanner/returns — precomputed 1D + 1W returns for a set of symbols.
 *
 * The Graph tab needs a stable "1D / 1W" figure that does NOT depend on the
 * chart's zoom level. Deriving it from the on-screen candle series was wrong:
 * beyond ~2Y the series is weekly-rolled, so a true 1-day move can't be read
 * off it (it rendered blank). Instead we reuse the SAME sources the rest of
 * the app already trusts:
 *
 *   • 1W ← app.cluster_stocks_panel_cache.ret_1w  (weekly-refreshed snapshot)
 *   • 1D ← golden.price_history latest close vs the previous trading day
 *
 * Both are returned as fractions (0.012 = +1.2%); the client multiplies by 100.
 * Public + unauthenticated, mirroring /api/scanner/ohlc — this is market data,
 * not user data.
 */
import { NextResponse } from "next/server";
import { sql, golden } from "@/lib/db";

export const dynamic = "force-dynamic";

type ReturnsRow = { ret_1d: number | null; ret_1w: number | null };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("syms") || "").trim();
  if (!raw) return NextResponse.json({ data: {} });

  // Bare NSE symbols (no .NS); cap to keep the query bounded.
  const symbols = Array.from(
    new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ).slice(0, 60);
  if (symbols.length === 0) return NextResponse.json({ data: {} });

  // Independent lookups: a failure in one plane (e.g. golden unreachable in a
  // local dev DB) must not blank out the other. Each defaults to an empty map.
  const ret1wBySym = new Map<string, number | null>();
  try {
    const weekly = await sql<{ symbol: string; ret_1w: number | null }[]>`
      SELECT c.symbol, c.ret_1w::float AS ret_1w
        FROM app.cluster_stocks_panel_cache c
       WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
         AND c.symbol = ANY(${symbols})
    `;
    for (const r of weekly) ret1wBySym.set(r.symbol, r.ret_1w);
  } catch {
    /* leave 1W empty */
  }

  const ret1dBySym = new Map<string, number>();
  try {
    // 1D from golden: latest daily close vs the previous trading day's close.
    // Symbols are stored with a .NS suffix there; strip it for the join/output.
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
    for (const m of moves1D) ret1dBySym.set(m.symbol, m.pct);
  } catch {
    /* leave 1D empty */
  }

  const data: Record<string, ReturnsRow> = {};
  for (const sym of symbols) {
    data[sym] = {
      ret_1d: ret1dBySym.get(sym) ?? null,
      ret_1w: ret1wBySym.get(sym) ?? null,
    };
  }
  return NextResponse.json({ data });
}
