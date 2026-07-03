/** Helpers for displaying score values consistently. */

export type ScoreBand = "excellent" | "good" | "neutral" | "weak" | "poor";

/** Map a 0-100 percentile to one of the five score bands. */
export function band(pct: number | null | undefined): ScoreBand | null {
  if (pct == null || Number.isNaN(pct)) return null;
  if (pct >= 80) return "excellent";
  if (pct >= 60) return "good";
  if (pct >= 40) return "neutral";
  if (pct >= 20) return "weak";
  return "poor";
}

export function bandColor(b: ScoreBand | null): string {
  switch (b) {
    case "excellent": return "var(--color-score-excellent)";
    case "good":      return "var(--color-score-good)";
    case "neutral":   return "var(--color-score-neutral)";
    case "weak":      return "var(--color-score-weak)";
    case "poor":      return "var(--color-score-poor)";
    default:          return "var(--color-border-default)";
  }
}

export function tierLabel(t: string | null | undefined): string {
  switch (t) {
    case "veteran": return "Long-term Compounder";
    case "mature":  return "Established";
    case "mid":     return "Emerging";
    case "new":     return "New Listing";
    default:        return "—";
  }
}

/** Plural tier label for "N <tier>" / tab contexts. Naively appending "s" to
 *  tierLabel() produced "Establisheds"/"Emergings" — those are adjectives, so
 *  they stay as-is; only the count-noun labels pluralise. */
export function tierLabelPlural(t: string | null | undefined): string {
  switch (t) {
    case "veteran": return "Long-term Compounders";
    case "mature":  return "Established";
    case "mid":     return "Emerging";
    case "new":     return "New Listings";
    default:        return "—";
  }
}

/** Clean a company name for display. Some app.universe.company_name rows are
 *  polluted with the ".NS" Yahoo suffix (e.g. "RELIANCE.NS"); strip it. Falls
 *  back to the symbol when the name is empty/just the suffix. */
export function displayCompanyName(
  name: string | null | undefined,
  symbol?: string | null,
): string {
  const cleaned = (name ?? "").replace(/\.NS$/i, "").trim();
  return cleaned || (symbol ?? "").trim();
}

/** True if the stock listed within the last ~2 years (a recent IPO). The
 *  maturity tier is computed from years of *financial* history, not listing
 *  age — so a long-operating business that just IPO'd reads as "Established".
 *  This flags that case so the recent listing isn't hidden. */
export function isRecentListing(listingDate: string | null | undefined): boolean {
  if (!listingDate) return false;
  const d = new Date(listingDate);
  if (Number.isNaN(d.getTime())) return false;
  return (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000) <= 2;
}

/** Months of trading history since listing, or null if the date is unknown. */
export function monthsSinceListing(listingDate: string | null | undefined): number | null {
  if (!listingDate) return null;
  const d = new Date(listingDate);
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / ((365.25 / 12) * 24 * 3600 * 1000);
}

/** Minimum trading history (months) before a percentile score is shown. */
export const MIN_TRADING_MONTHS = 12;
/** A genuine fresh IPO has only a few years of financials; a long-operating
 *  business hits the ~10yr scrape cap. Used to tell a real recent listing from
 *  a veteran whose listing_date is polluted (see below). */
export const MIN_YEARS_FOR_SCORE = 6;

/** Whether to DISPLAY a stock's percentile score (the score math is untouched).
 *
 *  The bug this guards against: a 3-month-old IPO (INNOVISION, listed Mar 2026)
 *  scored 85–100 and ranked #2 in its industry on ~3 months of price history —
 *  the momentum leg and market-relative valuation are statistical noise on that
 *  little data, which destroys score credibility.
 *
 *  Why two signals, not one:
 *   - `listing_date` alone is unreliable. A batch of ~105 veteran companies
 *     (HAWKINCOOK, TIMEX, GOODYEAR…) were added to the price DB on 2026-04-20
 *     and inherited that as their listing_date — identical signature to a real
 *     IPO (same date, ~50 price bars). Gating on listing_date alone would hide
 *     these established names.
 *   - `years_of_data` alone is too blunt — it would hide legitimate younger
 *     mid-caps that have traded for years.
 *
 *  So: suppress only when the stock looks recently listed (<1yr trading) AND has
 *  a short fundamental record (below the scrape cap). The mis-dated veterans
 *  survive because they carry years_of_data≈10; genuine IPOs (INNOVISION=4,
 *  SURYALA=3) are caught. Unknown listing date → treated as scoreable (legacy
 *  names often have a null date; don't suppress the board). */
export function hasScoreableHistory(
  listingDate: string | null | undefined,
  yearsOfData: number | null | undefined,
): boolean {
  const m = monthsSinceListing(listingDate);
  if (m == null) return true;               // unknown listing date → scoreable
  if (m >= MIN_TRADING_MONTHS) return true; // ≥1yr of trading → scoreable
  // Listed <1yr per our data. Only a short fundamental record confirms a true
  // fresh listing; a full record means the date is a mis-dated veteran.
  if (yearsOfData != null && yearsOfData >= MIN_YEARS_FOR_SCORE) return true;
  return false;
}

/** Listing year, e.g. 2024 — for the "Recent IPO · 2024" badge. */
export function listingYear(listingDate: string | null | undefined): number | null {
  if (!listingDate) return null;
  const y = new Date(listingDate).getFullYear();
  return Number.isNaN(y) ? null : y;
}

/** Clusters at/below this size are too small for a percentile to carry real
 *  precision — in a 13-name group each rank is ~8 points, so "92nd percentile"
 *  implies a resolution the data doesn't have. Below this we lead with the raw
 *  rank and flag the percentile as approximate. */
export const SMALL_CLUSTER_MAX = 20;

/** Ordinal string: 1 → "1st", 2 → "2nd", 3 → "3rd", 13 → "13th". */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function fmtPct(p: number | null | undefined, suffix = "%"): string {
  if (p == null) return "—";
  return Math.round(p) + suffix;
}

export function fmtRupeesCr(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(2)}L Cr`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K Cr`;
  return `₹${Math.round(n)} Cr`;
}
