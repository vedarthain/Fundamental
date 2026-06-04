/**
 * Curated index constituent weights — REAL NSE free-float index weights,
 * extracted from the index Fact Sheet PDFs in factsheet/ by
 * scripts/build-index-weights.py. GENERATED FILE — do not edit by hand;
 * refresh the factsheets and re-run the script after NSE rebalances.
 *
 * Factsheets publish only the TOP ~10 by weight, so the long tail of each
 * index carries no weight here (the UI shows "—"). Keyed by bare NSE
 * symbol (matches app.index_constituent.symbol).
 */
export type IndexWeight = { symbol: string; weight: number };

export const INDEX_WEIGHTS_AS_OF: Record<string, string> = {
  NIFTYBANK: "2026-05-29",
  NIFTYIT: "2026-05-29",
  NIFTYAUTO: "2026-05-29",
  NIFTYFMCG: "2026-05-29",
  NIFTYPHARMA: "2026-05-29",
  NIFTYMETAL: "2026-05-29",
  NIFTYREALTY: "2026-05-29",
};

export const INDEX_WEIGHTS: Record<string, IndexWeight[]> = {
  NIFTYBANK: [
    { symbol: "HDFCBANK", weight: 17.93 },
    { symbol: "ICICIBANK", weight: 13.63 },
    { symbol: "AXISBANK", weight: 10.28 },
    { symbol: "KOTAKBANK", weight: 9.81 },
    { symbol: "SBIN", weight: 9.07 },
    { symbol: "FEDERALBNK", weight: 6.38 },
    { symbol: "INDUSINDBK", weight: 5.4 },
    { symbol: "AUBANK", weight: 4.87 },
    { symbol: "BANKBARODA", weight: 4.47 },
    { symbol: "IDFCFIRSTB", weight: 4.27 },
  ],
  NIFTYIT: [
    { symbol: "INFY", weight: 27.08 },
    { symbol: "TCS", weight: 19.71 },
    { symbol: "TECHM", weight: 11.45 },
    { symbol: "HCLTECH", weight: 10.68 },
    { symbol: "WIPRO", weight: 7.09 },
    { symbol: "PERSISTENT", weight: 6.87 },
    { symbol: "COFORGE", weight: 6.01 },
    { symbol: "LTM", weight: 4.58 },
    { symbol: "MPHASIS", weight: 3.65 },
    { symbol: "OFSS", weight: 2.88 },
  ],
  NIFTYAUTO: [
    { symbol: "M&M", weight: 23.16 },
    { symbol: "MARUTI", weight: 14.66 },
    { symbol: "BAJAJ-AUTO", weight: 9.86 },
    { symbol: "EICHERMOT", weight: 8.4 },
    { symbol: "TMPV", weight: 7.02 },
    { symbol: "TVSMOTOR", weight: 6.71 },
    { symbol: "MOTHERSON", weight: 5.49 },
    { symbol: "HEROMOTOCO", weight: 5.42 },
    { symbol: "BHARATFORG", weight: 4.44 },
    { symbol: "ASHOKLEY", weight: 3.78 },
  ],
  NIFTYFMCG: [
    { symbol: "ITC", weight: 27.21 },
    { symbol: "HINDUNILVR", weight: 18.8 },
    { symbol: "NESTLEIND", weight: 10.03 },
    { symbol: "TATACONSUM", weight: 7.55 },
    { symbol: "VBL", weight: 7.11 },
    { symbol: "BRITANNIA", weight: 6.03 },
    { symbol: "MARICO", weight: 4.28 },
    { symbol: "GODREJCP", weight: 4.07 },
    { symbol: "UNITDSPR", weight: 3.69 },
    { symbol: "RADICO", weight: 2.71 },
  ],
  NIFTYPHARMA: [
    { symbol: "SUNPHARMA", weight: 21.43 },
    { symbol: "DIVISLAB", weight: 9.53 },
    { symbol: "DRREDDY", weight: 8.94 },
    { symbol: "CIPLA", weight: 8.87 },
    { symbol: "LUPIN", weight: 6.19 },
    { symbol: "LAURUSLABS", weight: 5.96 },
    { symbol: "TORNTPHARM", weight: 5.19 },
    { symbol: "AUROPHARMA", weight: 4.49 },
    { symbol: "GLENMARK", weight: 3.85 },
    { symbol: "ALKEM", weight: 3.62 },
  ],
  NIFTYMETAL: [
    { symbol: "TATASTEEL", weight: 17.82 },
    { symbol: "HINDALCO", weight: 16.9 },
    { symbol: "JSWSTEEL", weight: 12.42 },
    { symbol: "ADANIENT", weight: 8.72 },
    { symbol: "VEDL", weight: 6.21 },
    { symbol: "JINDALSTEL", weight: 4.63 },
    { symbol: "NATIONALUM", weight: 3.94 },
    { symbol: "APLAPOLLO", weight: 3.45 },
    { symbol: "NMDC", weight: 3.15 },
    { symbol: "SAIL", weight: 3.06 },
  ],
  NIFTYREALTY: [
    { symbol: "DLF", weight: 19.28 },
    { symbol: "PHOENIXLTD", weight: 16.82 },
    { symbol: "LODHA", weight: 13.44 },
    { symbol: "GODREJPROP", weight: 13.35 },
    { symbol: "PRESTIGE", weight: 11.75 },
    { symbol: "OBEROIRLTY", weight: 10.23 },
    { symbol: "BRIGADE", weight: 4.61 },
    { symbol: "ANANTRAJ", weight: 3.99 },
    { symbol: "ABREL", weight: 3.31 },
    { symbol: "SOBHA", weight: 3.21 },
  ],
};

/** symbol → weight for an index (empty map when none curated yet). */
export function weightsForIndex(code: string): Map<string, number> {
  return new Map((INDEX_WEIGHTS[code] ?? []).map((w) => [w.symbol, w.weight]));
}
