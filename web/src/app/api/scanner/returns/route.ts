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
    // 1D from golden: each symbol's latest daily close vs its previous trading
    // day's close. Get the last 2 rows PER SYMBOL straight off the primary key
    // (symbol, interval, date) with a short date-window guard — a per-symbol
    // index scan (~50ms).
    //
    // The prior shape computed a GLOBAL latest/previous trading date via
    // `MAX(date)`/`ORDER BY date DESC` over the whole 1d partition. With no
    // standalone index on `date`, that full-scanned ~3.3M rows (~30s) — the real
    // cause of the slow 1D/1W populate. Per-symbol windowing sidesteps it and is
    // also more correct when some symbols' data lags others'. Strip ".NS" in output.
    const symbolsNS = symbols.map((s) => `${s}.NS`);
    const moves1D = await golden<{ symbol: string; pct: number }[]>`
      WITH recent AS (
        SELECT REPLACE(symbol, '.NS', '') AS symbol,
               close,
               row_number() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
          FROM golden.price_history
         WHERE interval = '1d' AND symbol = ANY(${symbolsNS})
           AND date >= CURRENT_DATE - 16
      )
      SELECT c.symbol, ((c.close - p.close) / NULLIF(p.close, 0))::float AS pct
        FROM recent c
        JOIN recent p ON p.symbol = c.symbol AND p.rn = 2
       WHERE c.rn = 1 AND p.close > 0
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
