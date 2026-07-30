/**
 * returnGuards — shared plausibility caps for price returns.
 *
 * golden.price_history is an upstream, yfinance-sourced series this repo does
 * not populate. A handful of names carry an internally-inconsistent split basis:
 * the N-ago adj_close sits on a different scale than today's, implying physically
 * impossible moves (TVSMOTOR read +3358% for 1Y, CUPID +3525%). The ETL refuses
 * to publish those (_RET_CAP in cli.py); every WEB surface that computes a return
 * off golden must mirror the same guard so one bad vendor bar never renders as a
 * headline number.
 *
 * Caps sit well above any real move over the window (India's daily circuit is
 * ±20%), so a genuine multi-bagger still shows; only data errors collapse to
 * "—". 3Y is far looser: a real multi-year multibagger (5–15×) is legitimate, so
 * only an outright broken split basis (100×+) gets nulled.
 *
 * Keep this the single source of truth — the scanner (allStocks) and the price
 * chart both import it, which is also what keeps the two surfaces consistent.
 */

export type RetWindow = "1d" | "1w" | "1m" | "1y" | "3y";

export const PCT_CAP: Record<RetWindow, number> = {
  "1d": 60,
  "1w": 200,
  "1m": 300,
  "1y": 500,
  "3y": 2000,
};

/**
 * Percent change from `base` → `last`, or null when the inputs are unusable
 * (missing / non-positive base) or the move exceeds the window's plausibility
 * cap (an upstream adjustment defect, not a real move).
 */
export function guardedPctChange(
  last: number | null | undefined,
  base: number | null | undefined,
  window: RetWindow,
): number | null {
  if (last == null || base == null || base === 0) return null;
  const pct = Math.round((last / base - 1) * 1000) / 10;
  if (Math.abs(pct) > PCT_CAP[window]) return null;
  return pct;
}
