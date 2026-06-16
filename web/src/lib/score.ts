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

/** Listing year, e.g. 2024 — for the "Recent IPO · 2024" badge. */
export function listingYear(listingDate: string | null | undefined): number | null {
  if (!listingDate) return null;
  const y = new Date(listingDate).getFullYear();
  return Number.isNaN(y) ? null : y;
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
