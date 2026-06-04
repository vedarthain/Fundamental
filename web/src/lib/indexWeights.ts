/**
 * Curated index constituent weights — the REAL NSE index weights, pasted by
 * hand from NSE's monthly index factsheets ("Top constituents by weightage"
 * on niftyindices.com / the index Fact Sheet PDF).
 *
 * WHY static/manual (not ingested like membership):
 *   - NSE and niftyindices block server-side fetches (every programmatic
 *     request 403s or times out), so weights can't be scraped reliably.
 *   - The factsheets only publish the TOP ~10 constituents by weight, as a
 *     monthly PDF — never the full list. So even with access there's no full
 *     weight feed.
 *   Hence: paste the top-N from each factsheet here and refresh at NSE's
 *   semi-annual rebalances (cut-off Jan 31 / Jul 31; 4 weeks' notice). Names
 *   not listed render "—" in the UI — correct, since NSE doesn't publish a
 *   weight for the long tail.
 *
 * Keyed by our bare NSE symbol (matches app.index_constituent.symbol). These
 * are FREE-FLOAT index weights — the actual Nifty methodology — not the
 * full-market-cap proxy we previously approximated.
 */
export type IndexWeight = { symbol: string; weight: number };

/** Factsheet date per index, so the UI/maintainer can see staleness. */
export const INDEX_WEIGHTS_AS_OF: Record<string, string> = {
  NIFTYAUTO: "2026-05-29",
};

export const INDEX_WEIGHTS: Record<string, IndexWeight[]> = {
  // Nifty Auto — Fact Sheet 2026-05-29 (top 10 of 15 by weightage).
  NIFTYAUTO: [
    { symbol: "M&M",        weight: 23.16 },
    { symbol: "MARUTI",     weight: 14.66 },
    { symbol: "BAJAJ-AUTO", weight: 9.86 },
    { symbol: "EICHERMOT",  weight: 8.40 },
    { symbol: "TMPV",       weight: 7.02 },
    { symbol: "TVSMOTOR",   weight: 6.71 },
    { symbol: "MOTHERSON",  weight: 5.49 },
    { symbol: "HEROMOTOCO", weight: 5.42 },
    { symbol: "BHARATFORG", weight: 4.44 },
    { symbol: "ASHOKLEY",   weight: 3.78 },
  ],
};

/** symbol → weight for an index (empty map when none curated yet). */
export function weightsForIndex(code: string): Map<string, number> {
  return new Map((INDEX_WEIGHTS[code] ?? []).map((w) => [w.symbol, w.weight]));
}
