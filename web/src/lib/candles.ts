/**
 * candles.ts — batched, split-safe OHLCV candles for the Graph tab's charts.
 *
 * golden.price_history_1d stores RAW open/high/low/close plus adj_close (the
 * split/bonus-adjusted close). A candlestick drawn from raw OHLC would show a
 * split as a phantom cliff, disagreeing with every other price surface on the
 * site (all adj_close-based). So we adjust each bar by that day's own factor
 * `adj_close / close` — applied uniformly to o/h/l — which preserves the candle
 * shape (body/wick proportions) while placing it on the split-safe scale.
 *
 * ONE query per page of charts (≤4 symbols), never per-chart. Keyed by the BARE
 * symbol the scanners use (no ".NS").
 */
import { golden } from "@/lib/db";

export type Candle = {
  d: string; // ISO date
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

/** Strip the NSE ".NS" suffix golden uses so keys match the bare scanner symbol. */
function bare(sym: string): string {
  return sym.endsWith(".NS") ? sym.slice(0, -3) : sym;
}

/**
 * Fetch split-safe daily candles for each symbol over the last `days` calendar
 * days. Returns {} on any failure (charts render an empty state, the tab still
 * works). Keyed by bare symbol, each series ascending by date.
 */
export async function loadCandles(
  symbols: string[],
  days: number,
): Promise<Record<string, Candle[]>> {
  const out: Record<string, Candle[]> = {};
  const uniq = Array.from(new Set(symbols)).filter(Boolean);
  if (uniq.length === 0) return out;
  const ns = uniq.map((s) => `${s.toUpperCase()}.NS`);

  let rows: {
    symbol: string;
    d: string;
    o: number;
    h: number;
    l: number;
    c: number;
    ac: number | null;
    v: number | null;
  }[];
  try {
    rows = await golden<
      {
        symbol: string;
        d: string;
        o: number;
        h: number;
        l: number;
        c: number;
        ac: number | null;
        v: number | null;
      }[]
    >`
      SELECT symbol,
             date::text AS d,
             open::float8  AS o,
             high::float8  AS h,
             low::float8   AS l,
             close::float8 AS c,
             adj_close::float8 AS ac,
             volume::float8    AS v
      FROM golden.price_history_1d
      WHERE interval = '1d'
        AND symbol = ANY(${ns})
        AND close IS NOT NULL AND open IS NOT NULL
        AND high IS NOT NULL AND low IS NOT NULL
        AND date >= CURRENT_DATE - ${days}::int
      ORDER BY symbol, date ASC
    `;
  } catch {
    return out;
  }

  for (const r of rows) {
    // Split-safe factor: scale the raw bar so its close lands on adj_close.
    const factor = r.ac != null && r.c > 0 ? r.ac / r.c : 1;
    const k = bare(r.symbol);
    (out[k] ??= []).push({
      d: r.d,
      o: r.o * factor,
      h: r.h * factor,
      l: r.l * factor,
      c: r.c * factor,
      v: r.v ?? 0,
    });
  }
  return out;
}
