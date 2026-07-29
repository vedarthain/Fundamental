/**
 * sparklines.ts — batched per-symbol price series for the scanner row mini-charts.
 *
 * ONE golden query per window pulls split-safe adj_close for a whole set of
 * displayed symbols, groups + downsamples in JS, and returns a plain
 * Record<symbol, SparkPoint[]> (RSC-serializable, keyed by the BARE symbol the
 * scanners use). Never call this per-row — that would be N round-trips; the
 * scanner page calls it once per tab with that tab's symbol list.
 *
 * Window differs by tab on purpose (the scanners run on different clocks):
 *   Igniting → ~3M (base → the breakout day), Trend → 1Y (the whole uptrend),
 *   At Support → ~7M (approach to the tested floor). See scanner/page.tsx.
 *
 * Uses adj_close (COALESCE with close) so the mini-chart agrees with the stock
 * page price chart and the All-stocks returns — a raw close would show a split
 * as a phantom cliff.
 */
import { golden } from "@/lib/db";
import type { SparkPoint } from "@/components/Sparkline";

/** Strip the NSE ".NS" suffix golden uses so keys match the bare scanner symbol. */
function bare(sym: string): string {
  return sym.endsWith(".NS") ? sym.slice(0, -3) : sym;
}

/** Downsample an ascending series to ~points evenly-spaced samples (keeps the last). */
function downsample(rows: { d: string; v: number }[], points: number): SparkPoint[] {
  const n = rows.length;
  if (n <= points) return rows.map((r) => ({ label: r.d, value: r.v }));
  const out: SparkPoint[] = [];
  const step = (n - 1) / (points - 1);
  for (let i = 0; i < points; i++) {
    const r = rows[Math.min(Math.round(i * step), n - 1)];
    out.push({ label: r.d, value: r.v });
  }
  return out;
}

/**
 * Fetch a downsampled adj_close series for each symbol over the last `days`
 * calendar days. Returns {} on any failure (mini-charts render "—", the table
 * still works). Keyed by bare symbol.
 */
export async function loadSparklines(
  symbols: string[],
  days: number,
  points = 48,
): Promise<Record<string, SparkPoint[]>> {
  const out: Record<string, SparkPoint[]> = {};
  const uniq = Array.from(new Set(symbols));
  if (uniq.length === 0) return out;
  const ns = uniq.map((s) => `${s}.NS`);

  let rows: { symbol: string; d: string; c: number }[];
  try {
    rows = await golden<{ symbol: string; d: string; c: number }[]>`
      SELECT symbol, date::text AS d, COALESCE(adj_close, close)::float8 AS c
      FROM golden.price_history_1d
      WHERE interval = '1d'
        AND COALESCE(adj_close, close) IS NOT NULL
        AND symbol = ANY(${ns})
        AND date >= CURRENT_DATE - (${days})::int
      ORDER BY symbol, date ASC
    `;
  } catch {
    return out;
  }

  const bySym = new Map<string, { d: string; v: number }[]>();
  for (const r of rows) {
    const k = bare(r.symbol);
    let arr = bySym.get(k);
    if (!arr) bySym.set(k, (arr = []));
    arr.push({ d: r.d, v: r.c });
  }
  for (const [k, series] of bySym) out[k] = downsample(series, points);
  return out;
}
