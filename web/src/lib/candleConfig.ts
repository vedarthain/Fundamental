/**
 * candleConfig.ts — pure, dependency-free candle constants shared by the
 * server-side loader (candles.ts) and client components (GraphClient). Kept
 * separate from candles.ts so importing this value into a "use client" module
 * doesn't drag the server-only `postgres` driver (via db.ts) into the browser
 * bundle.
 */

// Beyond ~2 years, daily candles crush into an unreadable block in a small
// cell (10Y ≈ 2,470 bars). Past this lookback we roll days up into WEEKLY
// candles — far fewer bars, smaller payload, same shape at that zoom.
export const WEEKLY_THRESHOLD_DAYS = 730;
