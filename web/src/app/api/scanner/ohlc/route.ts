/**
 * GET /api/scanner/ohlc — split-safe daily candles for the Graph tab.
 *
 * The Graph tab paints 4 candlestick+volume charts per page and lazily fetches
 * only the visible page's symbols (never the whole ~2,100-name universe). This
 * route reuses the batched loader — one golden query per call.
 *
 * Query params:
 *   syms — comma-separated BARE symbols (no ".NS"); capped for sanity.
 *   days — calendar-day lookback; clamped to [30, 1825] (≈1 month … 5 years).
 *   raw  — "1" to skip the server-side weekly rollup and return true daily
 *          bars for the whole lookback.
 *
 * WHY `raw` EXISTS. Without it a caller asking for a long lookback cannot get
 * daily bars at all: loadCandles collapses anything past ~2 years to weekly
 * before it returns. For the Graph tab that is the right trade — eight symbols
 * per call painting small cells. For PriceChart it was silent data loss: that
 * component fetches days=11000 ONCE and slices per range in the browser, so
 * its 1W / 1M / 3M / 1Y views were every one of them drawn from weekly bars,
 * and the watchlist chart had never rendered a daily candle at any zoom.
 * `raw=1` is how a client-slicing caller says "return what I asked for; I will
 * decide the bar size".
 *
 * Default stays rolled-up. Flipping the default would silently multiply the
 * Graph tab's payload by ~5 for eight symbols at once, which is a regression
 * nobody asked for in a fix for a different chart.
 */
import { NextResponse } from "next/server";
import { loadCandles } from "@/lib/candles";

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 8;
const MIN_DAYS = 5; // 1W window
// 10Y is the labelled max preset; the "ALL" toggle sends a larger value that we
// clamp here to ~30Y so full listed history comes back (weekly-rolled past ~2Y).
const MAX_DAYS = 11000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawSyms = (url.searchParams.get("syms") ?? "").trim();
  const rawDays = Number(url.searchParams.get("days"));

  const syms = rawSyms
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  if (syms.length === 0) return NextResponse.json({ data: {} });

  const days = Number.isFinite(rawDays)
    ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(rawDays)))
    : 180;

  const raw = url.searchParams.get("raw") === "1";

  const data = await loadCandles(syms, days, { rollup: !raw });
  return NextResponse.json({ data });
}
