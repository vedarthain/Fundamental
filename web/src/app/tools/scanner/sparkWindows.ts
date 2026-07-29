/**
 * sparkWindows.ts — per-tab time-range options for the row sparklines.
 *
 * Plain module (no "use client") so the server page can fetch the DEFAULT range
 * for first paint and the client toggle can offer the full set — both import the
 * same source of truth, so they can't drift.
 *
 * Windows are a per-tab SUBSET, not a uniform 1M→ALL everywhere, because each
 * scanner's thesis lives on its own clock: a 5Y view of a one-day ignition is a
 * flat squiggle with the signal invisible, so Igniting tops out at 1Y; At
 * Support wants the long multi-year context so it goes to ALL. `days` is a
 * calendar-day lookback; ALL uses a large sentinel that predates NSE history.
 */
export type WindowOpt = { label: string; days: number };

export const IGNITING_WINDOWS: WindowOpt[] = [
  { label: "1M", days: 30 },
  { label: "3M", days: 95 },
  { label: "6M", days: 190 },
  { label: "1Y", days: 365 },
];

export const TREND_WINDOWS: WindowOpt[] = [
  { label: "3M", days: 95 },
  { label: "6M", days: 190 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1100 },
];

export const FLOOR_WINDOWS: WindowOpt[] = [
  { label: "6M", days: 190 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1100 },
  { label: "5Y", days: 1830 },
  { label: "ALL", days: 20000 },
];

// All stocks is a browse table over the full universe, so it offers the wide
// momentum→multi-year spread (no 1M — that tab is for standing, not day-trades).
export const ALLSTOCKS_WINDOWS: WindowOpt[] = [
  { label: "3M", days: 95 },
  { label: "6M", days: 190 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1100 },
  { label: "5Y", days: 1830 },
];

// First-paint window per tab (must be one of the tab's option `days`).
export const IGNITING_DEFAULT_DAYS = 95; // 3M
export const TREND_DEFAULT_DAYS = 365; //  1Y
export const FLOOR_DEFAULT_DAYS = 365; //  1Y
export const ALLSTOCKS_DEFAULT_DAYS = 365; // 1Y
