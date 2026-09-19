/**
 * trailingReturns — 1D / 1W / 1M / 1Y price returns computed off golden's LATEST
 * close, for any set of symbols.
 *
 * NOTE ON 1D: this is a close-to-close move between the two newest daily bars.
 * It is NOT the live intraday figure — surfaces with an intraday pinger (the
 * watchlist, the portfolio tables, /api/scanner/returns) overlay `eff_ret_1d`
 * on top and should keep doing so. Pages rendered from a server cache have no
 * intraday tick to overlay, and for those this is the correct 1D.
 *
 * WHY THIS EXISTS
 *
 * Five surfaces used to read `ret_1w / ret_1m / ret_1y` straight out of
 * `app.cluster_stocks_panel_cache`. Those columns are correct — but they are
 * anchored to the panel's own snapshot_date, and the panel is rebuilt WEEKLY
 * (snapshots land on Saturdays). Every one of those surfaces renders them next
 * to a live price from golden, so the page silently mixes two as-of dates: the
 * price is today, the return is up to 7 days old.
 *
 * Measured on 2026-09-17 (panel 2026-09-12, 1,909 symbols in common):
 *
 *     window   sign flips        mean |error|   >5pp wrong
 *     1W       706  (37.0%)      4.67 pp        31.6%
 *     1M       339  (17.8%)      5.00 pp        32.8%
 *     1Y        82  ( 4.3%)      5.06 pp        34.1%
 *
 * Note the mean error does NOT shrink with window length. The error is simply
 * "the last N days of price movement the panel hasn't seen yet", which is the
 * same quantity whether you are measuring a week or a year. Only the odds of it
 * being big enough to flip the sign fall away. So a 1Y number off the panel is
 * just as wrong in percentage points as a 1W one — it merely looks plausible.
 *
 * The concrete case that surfaced this: SREEL on 17 Sep showed a chart falling
 * 370 → 294 with a "1W +25.5%" badge beneath it. Both numbers were real; the
 * badge was the true 1W as of 12 Sep (333.27 / 265.52), computed before the
 * stock gave the whole spike back.
 *
 * WHAT THIS DOES NOT REPLACE
 *
 * Only the return columns. Scores, market cap and maturity tier genuinely ARE
 * weekly quantities and still come from the panel. This module is deliberately
 * narrow: it answers "what did the price do over the last N days, as of the
 * newest bar we have", and nothing else.
 *
 * METHOD — identical to lib/watchlistQuote and the price chart's rangePct, so
 * the scanner, the watchlist and the stock page cannot disagree:
 *   anchor = nearest adjusted close ON OR BEFORE (symbol's latest bar − N days)
 *   return = latest adjusted close / anchor − 1
 * Adjusted close (not raw) so a split inside the window isn't read as a move,
 * and every window passes through returnGuards so one broken vendor split basis
 * renders "—" rather than +3358%.
 *
 * UNITS: FRACTIONS (0.0255 = +2.55%), matching the panel columns this replaces,
 * so existing call sites keep their own ×100 scaling untouched.
 */
import { unstable_cache } from "next/cache";
import { golden } from "@/lib/db";
import { guardedPctChange } from "@/lib/returnGuards";

export type TrailingReturns = {
  /** Latest close vs the PREVIOUS TRADING BAR — not "latest − 1 calendar day".
   *  Over a weekend or a market holiday the calendar anchor would land on a
   *  non-trading date and the on-or-before seek would return the same bar as
   *  `latest`, printing a flat 0.0% for every name on a Monday. The other three
   *  windows are long enough that a day of slack is immaterial; 1D is not. */
  ret_1d: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
};

/** golden carries a ".NS" suffix; every app-side table is bare. */
function bare(sym: string): string {
  return (sym || "").trim().toUpperCase().replace(/\.NS$/, "");
}

/** IST calendar date — cache-key component so returns roll over at the trading
 *  day boundary rather than at UTC midnight. */
function istDateKey(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Cheap stable digest of the symbol set. The whole-universe callers pass 2,000+
 *  symbols; joining those into the cache key produces a ~25 KB string, which
 *  Next hashes on every lookup. FNV-1a over the sorted join is enough to
 *  separate one caller's symbol set from another's. */
function digest(parts: string[]): string {
  let h = 0x811c9dc5;
  for (const s of parts) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2c; // separator, so ["AB","C"] ≠ ["A","BC"]
    h = Math.imul(h, 0x01000193);
  }
  return `${parts.length}-${(h >>> 0).toString(36)}`;
}

/**
 * Trailing returns keyed by BARE symbol. Symbols with no usable history are
 * simply absent from the map — callers should render "—", not 0.
 *
 * Cached per (symbol-set, IST trading day) for 15 minutes and tagged
 * "panel-cache" so the existing admin purge and the EOD price refresh both
 * drop it the moment a new close lands.
 */
export async function loadTrailingReturns(
  symbols: string[],
): Promise<Map<string, TrailingReturns>> {
  const bareSyms = Array.from(new Set(symbols.map(bare))).filter(Boolean).sort();
  if (bareSyms.length === 0) return new Map();
  const cached = unstable_cache(
    () => fetchTrailingReturns(bareSyms),
    ["trailing-returns", istDateKey(), digest(bareSyms)],
    { revalidate: 900, tags: ["trailing-returns", "panel-cache"] },
  );
  return new Map(Object.entries(await cached()));
}

/** The uncached golden read. Returns a plain Record (unstable_cache serialises
 *  to JSON — a Map round-trips to {}). Never throws: a golden hiccup yields an
 *  empty map and the caller falls back to whatever it had. */
async function fetchTrailingReturns(
  bareSymsSorted: string[],
): Promise<Record<string, TrailingReturns>> {
  // Query both spellings so golden's (symbol, interval, date) index is usable
  // regardless of which suffix convention the caller's table uses.
  const cands = [...bareSymsSorted, ...bareSymsSorted.map((s) => `${s}.NS`)];
  const out: Record<string, TrailingReturns> = {};

  try {
    // One backward index seek per symbol per window. MAX(date)/DISTINCT ON both
    // force a full scan of every daily bar (no btree skip-scan exists); driving
    // the laterals off the symbol list keeps this at ~4 seeks per symbol. Same
    // shape, and the same measured reason, as lib/watchlistQuote's anchor query.
    const rows = await golden<{
      symbol: string;
      last_c: string | null;
      c_1d: string | null;
      c_1w: string | null;
      c_1m: string | null;
      c_1y: string | null;
    }[]>`
      WITH cand AS (
        SELECT DISTINCT unnest(${cands}::text[]) AS symbol
      ),
      latest AS (
        SELECT c.symbol, l.ld, l.c
        FROM cand c
        CROSS JOIN LATERAL (
          SELECT ph.date AS ld, COALESCE(ph.adj_close, ph.close) AS c
          FROM golden.price_history ph
          WHERE ph.symbol = c.symbol AND ph.interval = '1d'
            AND COALESCE(ph.adj_close, ph.close) IS NOT NULL
          ORDER BY ph.date DESC LIMIT 1
        ) l
      )
      SELECT l.symbol,
             l.c::text    AS last_c,
             a1d.c::text  AS c_1d,
             a1w.c::text  AS c_1w,
             a1m.c::text  AS c_1m,
             a1y.c::text  AS c_1y
      FROM latest l
      LEFT JOIN LATERAL (SELECT COALESCE(adj_close, close) AS c FROM golden.price_history ph
        WHERE ph.symbol = l.symbol AND ph.interval = '1d' AND COALESCE(ph.adj_close, ph.close) IS NOT NULL
          AND ph.date <  l.ld       ORDER BY ph.date DESC LIMIT 1) a1d ON true
      LEFT JOIN LATERAL (SELECT COALESCE(adj_close, close) AS c FROM golden.price_history ph
        WHERE ph.symbol = l.symbol AND ph.interval = '1d' AND COALESCE(ph.adj_close, ph.close) IS NOT NULL
          AND ph.date <= l.ld - 7   ORDER BY ph.date DESC LIMIT 1) a1w ON true
      LEFT JOIN LATERAL (SELECT COALESCE(adj_close, close) AS c FROM golden.price_history ph
        WHERE ph.symbol = l.symbol AND ph.interval = '1d' AND COALESCE(ph.adj_close, ph.close) IS NOT NULL
          AND ph.date <= l.ld - 30  ORDER BY ph.date DESC LIMIT 1) a1m ON true
      LEFT JOIN LATERAL (SELECT COALESCE(adj_close, close) AS c FROM golden.price_history ph
        WHERE ph.symbol = l.symbol AND ph.interval = '1d' AND COALESCE(ph.adj_close, ph.close) IS NOT NULL
          AND ph.date <= l.ld - 365 ORDER BY ph.date DESC LIMIT 1) a1y ON true
    `;

    const num = (x: string | null) => (x == null ? null : Number(x));
    // guardedPctChange returns PERCENT; the panel columns this replaces are
    // fractions, so divide once here rather than at five call sites.
    const frac = (p: number | null) => (p == null ? null : p / 100);

    for (const r of rows) {
      const last = num(r.last_c);
      if (last == null) continue;
      const k = bare(r.symbol);
      const v: TrailingReturns = {
        ret_1d: frac(guardedPctChange(last, num(r.c_1d), "1d")),
        ret_1w: frac(guardedPctChange(last, num(r.c_1w), "1w")),
        ret_1m: frac(guardedPctChange(last, num(r.c_1m), "1m")),
        ret_1y: frac(guardedPctChange(last, num(r.c_1y), "1y")),
      };
      // Both spellings map to the same bare key; keep whichever row actually
      // carried history rather than letting a barren duplicate blank it.
      const prev = out[k];
      if (prev == null || (prev.ret_1y == null && v.ret_1y != null)) out[k] = v;
    }
  } catch {
    /* golden unreachable — caller renders "—" or keeps its existing value */
  }
  return out;
}

/**
 * Market-cap-weighted mean of a window across members, mirroring how the ETL
 * aggregates cluster returns (cli.py, "Aggregate per cluster"):
 *   Σ(mcap × ret) / Σ(mcap), over members where both are present.
 * Returns null when no member qualifies — "we don't know" beats a fabricated 0.
 */
export function capWeightedReturn(
  members: { mcap: number | null; ret: number | null }[],
): number | null {
  let sw = 0;
  let sm = 0;
  for (const m of members) {
    if (m.ret == null || m.mcap == null || !(m.mcap > 0)) continue;
    sw += m.mcap * m.ret;
    sm += m.mcap;
  }
  return sm > 0 ? sw / sm : null;
}
