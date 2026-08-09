/**
 * indexCandles.ts — OHLC candles for an NSE thematic index (Themes tab).
 *
 * The Graph tab's stock candles come from golden.price_history_1d. A traded
 * index (Nifty Auto, Bank, …) is NOT a golden stock — its OHLC lives in
 * app.market_index_history (backfilled ~21y via Upstox + kept current daily by
 * fetch-indices.py). This loader returns the same Candle[] shape so the Themes
 * grid can reuse CandleChart unchanged.
 *
 * Index bars carry no volume (v = 0) — the Themes grid hides the volume panel
 * for the index tile. Long lookbacks are rolled up to weekly, matching candles.ts.
 */
import { sql } from "@/lib/db";
import type { Candle } from "@/lib/candles";
import { WEEKLY_THRESHOLD_DAYS } from "@/lib/candleConfig";

/** Monday-anchored ISO week bucket key for a "YYYY-MM-DD" date. */
function weekKey(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  const dow = (dt.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

/** Roll an ascending daily series up to weekly OHLC (volume stays 0 for indices). */
function toWeekly(daily: Candle[]): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curKey = "";
  for (const c of daily) {
    const key = weekKey(c.d);
    if (key !== curKey) {
      cur = { d: c.d, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
      out.push(cur);
      curKey = key;
    } else if (cur) {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.d = c.d;
      cur.v += c.v;
    }
  }
  return out;
}

/**
 * Fetch daily OHLC candles for one index_code over the last `days` calendar
 * days. Returns [] on any failure (the tile renders "no price history").
 */
export async function loadIndexCandles(code: string, days: number): Promise<Candle[]> {
  if (!code) return [];
  let rows: { d: string; o: number | null; h: number | null; l: number | null; c: number | null }[];
  try {
    rows = await sql<
      { d: string; o: number | null; h: number | null; l: number | null; c: number | null }[]
    >`
      SELECT date::text AS d,
             open::float8  AS o,
             high::float8  AS h,
             low::float8   AS l,
             close::float8 AS c
      FROM app.market_index_history
      WHERE index_code = ${code}
        AND close IS NOT NULL
        AND date >= CURRENT_DATE - ${days}::int
      ORDER BY date ASC
    `;
  } catch {
    return [];
  }

  const daily: Candle[] = [];
  for (const r of rows) {
    if (r.c == null) continue;
    // Pre-2016 sectorals occasionally lack intraday O/H/L in the CSV source;
    // fall back to close so the bar still draws (a doji) instead of vanishing.
    const c = r.c;
    daily.push({
      d: r.d,
      o: r.o ?? c,
      h: r.h ?? c,
      l: r.l ?? c,
      c,
      v: 0,
    });
  }

  return days > WEEKLY_THRESHOLD_DAYS ? toWeekly(daily) : daily;
}
