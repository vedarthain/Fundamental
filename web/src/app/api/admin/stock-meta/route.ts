/**
 * Admin-only per-symbol stock metadata for the verdict detail page's header
 * card: maturity tier ("Long-established" etc.), market-cap tier (Large/Mid/
 * Small), listing date, and live intraday price + 1-day % change.
 *
 * Deliberately NOT a reuse of loadAllStocks() (src/lib/allStocks.ts) — that
 * function computes 1D/1W/1M/1Y/3Y returns for the ENTIRE universe in one
 * call (five golden queries each scanning every symbol), which is the right
 * shape for a scanner table but would be paying for four unused horizons
 * every time this page opens one stock. This route does the same 1D
 * calculation (last close vs the close before it, from golden.price_history,
 * ADJUSTED close to match the price chart) but scoped to one symbol.
 *
 * Same one-route-per-concern reasoning as /api/admin/stock-context: the
 * verdict route already serves three shapes, and this is a different table
 * family (app.universe / app.screener_meta / golden.price_history) read for
 * a different purpose (page chrome, not the verdict itself).
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sql, golden } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VolumeStats = {
  day_volume: number | null;
  day_turnover_cr: number | null;
  week_volume: number | null;
  avg_volume_20d: number | null;
  rel_volume: number | null;
  volume_date: string | null;
  ret_1d?: number | null;
  latest_close?: number | null;
};

type Meta = {
  maturity_tier: string | null;
  market_cap_category: string | null;
  listing_date: string | null;
  current_price: number | null;
  price_fetched_at: string | null;
  ret_1d: number | null;
  scores_snapshot_date: string | null;
  day_volume: number | null;
  day_turnover_cr: number | null;
  week_volume: number | null;
  avg_volume_20d: number | null;
  rel_volume: number | null;
  volume_date: string | null;
};

async function fetchUpstoxVolumes(instrumentKey: string): Promise<VolumeStats | null> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from35 = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
    const fromWeek = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);

    const encKey = encodeURIComponent(instrumentKey);
    const headers = {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    };

    const dayUrl = `https://api.upstox.com/v2/historical-candle/${encKey}/day/${today}/${from35}`;
    const weekUrl = `https://api.upstox.com/v2/historical-candle/${encKey}/week/${today}/${fromWeek}`;

    const [dayRes, weekRes] = await Promise.all([
      fetch(dayUrl, { headers, signal: AbortSignal.timeout(2500) }).catch(() => null),
      fetch(weekUrl, { headers, signal: AbortSignal.timeout(2500) }).catch(() => null),
    ]);

    if (!dayRes || !dayRes.ok) return null;
    const dayJson = (await dayRes.json().catch(() => null)) as {
      data?: { candles?: [string, number, number, number, number, number, number][] };
    } | null;
    const dayCandles = dayJson?.data?.candles ?? [];
    if (dayCandles.length === 0) return null;

    const latestDay = dayCandles[0];
    const dayVol = typeof latestDay[5] === "number" ? latestDay[5] : null;
    const dayClose = typeof latestDay[4] === "number" ? latestDay[4] : 0;
    const dayTurnoverCr = dayVol != null && dayClose > 0 ? (dayVol * dayClose) / 10000000 : null;
    const volDate = latestDay[0]?.slice(0, 10) ?? null;

    let ret1d: number | null = null;
    if (dayCandles.length >= 2 && dayCandles[1][4] > 0) {
      ret1d = ((dayClose - dayCandles[1][4]) / dayCandles[1][4]) * 100;
    }

    const past20 = dayCandles
      .slice(1, 21)
      .map((c) => c[5])
      .filter((v): v is number => typeof v === "number" && v > 0);
    const avg20 = past20.length > 0 ? past20.reduce((a, b) => a + b, 0) / past20.length : null;
    const relVol = dayVol != null && avg20 != null && avg20 > 0 ? dayVol / avg20 : null;

    let weekVol: number | null = null;
    if (weekRes && weekRes.ok) {
      const weekJson = (await weekRes.json().catch(() => null)) as {
        data?: { candles?: [string, number, number, number, number, number, number][] };
      } | null;
      const weekCandles = weekJson?.data?.candles ?? [];
      if (weekCandles.length > 0 && typeof weekCandles[0][5] === "number") {
        weekVol = weekCandles[0][5];
      }
    }

    if (weekVol == null && dayCandles.length > 0) {
      const last5 = dayCandles
        .slice(0, 5)
        .map((c) => c[5])
        .filter((v): v is number => typeof v === "number");
      if (last5.length > 0) weekVol = last5.reduce((a, b) => a + b, 0);
    }

    return {
      day_volume: dayVol,
      day_turnover_cr: dayTurnoverCr != null ? Math.round(dayTurnoverCr * 10) / 10 : null,
      week_volume: weekVol,
      avg_volume_20d: avg20 != null ? Math.round(avg20) : null,
      rel_volume: relVol != null ? Math.round(relVol * 100) / 100 : null,
      volume_date: volDate,
      ret_1d: ret1d,
      latest_close: dayClose > 0 ? dayClose : null,
    };
  } catch {
    return null;
  }
}

async function fetchGoldenVolumes(symbol: string): Promise<VolumeStats | null> {
  try {
    const rows = await golden<{ d: string; c: number; v: number }[]>`
      SELECT date::text AS d,
             close::float8 AS c,
             volume::float8 AS v
        FROM golden.price_history_1d
       WHERE (symbol = ${symbol + ".NS"} OR symbol = ${symbol + ".BO"})
         AND interval = '1d'
         AND volume IS NOT NULL
         AND volume > 0
       ORDER BY date DESC
       LIMIT 35
    `;
    if (!rows || rows.length === 0) return null;
    const latest = rows[0];
    const dayVol = latest.v;
    const dayTurnoverCr = dayVol && latest.c ? (dayVol * latest.c) / 10000000 : null;
    const past20 = rows.slice(1, 21).map((r) => r.v).filter((v) => v > 0);
    const avg20 = past20.length > 0 ? past20.reduce((a, b) => a + b, 0) / past20.length : null;
    const relVol = dayVol != null && avg20 != null && avg20 > 0 ? dayVol / avg20 : null;
    const weekVol = rows.slice(0, 5).reduce((acc, r) => acc + (r.v || 0), 0);

    let ret1d: number | null = null;
    if (rows.length >= 2 && rows[1].c > 0) {
      ret1d = ((latest.c - rows[1].c) / rows[1].c) * 100;
    }

    return {
      day_volume: dayVol,
      day_turnover_cr: dayTurnoverCr != null ? Math.round(dayTurnoverCr * 10) / 10 : null,
      week_volume: weekVol,
      avg_volume_20d: avg20 != null ? Math.round(avg20) : null,
      rel_volume: relVol != null ? Math.round(relVol * 100) / 100 : null,
      volume_date: latest.d,
      ret_1d: ret1d,
      latest_close: latest.c,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }

  const symbol = req.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  let base: {
    maturity_tier: string | null;
    market_cap_category: string | null;
    listing_date: string | null;
    cache_price: number | null;
    intraday_price: number | null;
    price_fetched_at: string | null;
    scores_snapshot_date: string | null;
    instrument_key: string | null;
  } | null = null;

  try {
    const rows = await sql<
      {
        maturity_tier: string | null;
        market_cap_category: string | null;
        listing_date: string | null;
        cache_price: number | null;
        intraday_price: number | null;
        price_fetched_at: string | null;
        scores_snapshot_date: string | null;
        instrument_key: string | null;
      }[]
    >`
      SELECT u.maturity_tier,
             u.market_cap_category,
             u.listing_date::text AS listing_date,
             p.current_price::float8 AS cache_price,
             p.snapshot_date::text AS scores_snapshot_date,
             sm.current_price::float8 AS intraday_price,
             sm.price_fetched_at::text AS price_fetched_at,
             ui.instrument_key
        FROM app.universe u
        LEFT JOIN app.cluster_stocks_panel_cache p
               ON p.symbol = u.symbol
              AND p.snapshot_date = (SELECT max(snapshot_date) FROM app.cluster_stocks_panel_cache)
        LEFT JOIN app.screener_meta sm ON sm.symbol = u.symbol
        LEFT JOIN app.upstox_instrument ui ON ui.symbol = u.symbol
       WHERE u.symbol = ${symbol}
       LIMIT 1
    `;
    base = rows[0] ?? null;
  } catch {
    base = null;
  }

  // Fetch volume metrics: try live Upstox first, then fall back to golden.price_history_1d
  let volStats: VolumeStats | null = null;
  if (base?.instrument_key) {
    volStats = await fetchUpstoxVolumes(base.instrument_key);
  }
  if (!volStats) {
    volStats = await fetchGoldenVolumes(symbol);
  }

  let ret_1d: number | null = volStats?.ret_1d ?? null;
  if (ret_1d == null) {
    try {
      const px = await golden<{ c: string }[]>`
        SELECT COALESCE(adj_close, close)::text AS c
          FROM golden.price_history
         WHERE (symbol = ${symbol + ".NS"} OR symbol = ${symbol + ".BO"})
           AND interval = '1d'
           AND COALESCE(adj_close, close) IS NOT NULL
           AND date >= CURRENT_DATE - 16
         ORDER BY date DESC
         LIMIT 2
      `;
      if (px.length === 2) {
        const last = Number(px[0].c);
        const prev = Number(px[1].c);
        if (prev > 0) ret_1d = ((last - prev) / prev) * 100;
      }
    } catch {
      ret_1d = null;
    }
  }

  const usingIntraday = base?.intraday_price != null;
  const currentPrice =
    base?.intraday_price ??
    base?.cache_price ??
    volStats?.latest_close ??
    null;

  const meta: Meta = {
    maturity_tier: base?.maturity_tier ?? null,
    market_cap_category: base?.market_cap_category ?? null,
    listing_date: base?.listing_date ?? null,
    current_price: currentPrice,
    price_fetched_at: usingIntraday ? (base?.price_fetched_at ?? null) : null,
    ret_1d,
    scores_snapshot_date: base?.scores_snapshot_date ?? null,
    day_volume: volStats?.day_volume ?? null,
    day_turnover_cr: volStats?.day_turnover_cr ?? null,
    week_volume: volStats?.week_volume ?? null,
    avg_volume_20d: volStats?.avg_volume_20d ?? null,
    rel_volume: volStats?.rel_volume ?? null,
    volume_date: volStats?.volume_date ?? null,
  };

  return NextResponse.json(meta, { headers: { "Cache-Control": "no-store" } });
}
