/**
 * Recommendation desk — PRIVATE paper-trading ledger for the score's picks.
 *
 * Two halves:
 *   1. generateCohorts()  — WRITE. For each weekly score snapshot, take the top
 *      TOP_N stocks by composite_pct, stamp each with an entry price (first
 *      golden close on/after the snapshot), a fixed stop/target, and a horizon.
 *      Idempotent (ON CONFLICT DO NOTHING on cohort_date+symbol), so it can be
 *      re-run weekly or back-filled over history safely.
 *   2. getRecommendationReport() — READ. Load the immutable picks, pull golden
 *      OHLC, and SETTLE each one at read time: walk the price path from entry to
 *      horizon and decide TARGET / STOPPED / EXPIRED / OPEN. Nothing about the
 *      outcome is stored, so the ledger can never drift and needs no cron.
 *
 * HONESTY: the underlying score is NOT yet validated (see lib/validation.ts —
 * composite IC ≈ noise over a short single-regime archive). This desk is a
 * paper track record to find out whether the picks work, not a claim that they
 * do. No orders are ever placed.
 *
 * Cross-DB: scores + ledger live in the app DB (`sql`); prices in golden
 * (`golden`). Joined in JS — there is no cross-database SQL.
 */
import { sql, golden } from "@/lib/db";
import { unstable_cache } from "next/cache";

// ── Strategy knobs (locked cohorts). Change here, regenerate to apply. ──
export const TOP_N = 10;          // picks per weekly cohort
export const STOP_PCT = 0.08;     // stop-loss: -8% from entry
export const TARGET_PCT = 0.15;   // target:   +15% from entry
export const HORIZON_TD = 21;     // holding period in trading days (~1 month)

export type RecoStatus = "OPEN" | "TARGET" | "STOPPED" | "EXPIRED" | "NO_DATA";

export type SettledPick = {
  id: number;
  cohortDate: string;
  symbol: string;
  rank: number;
  compositePct: number | null;
  qualityPct: number | null;
  valuationPct: number | null;
  momentumPct: number | null;
  entryDate: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  horizonTd: number;
  // Settlement (computed at read time):
  status: RecoStatus;
  markPrice: number | null;   // latest close (open) or exit price (closed)
  exitDate: string | null;    // null while OPEN
  retPct: number | null;      // realised (closed) or unrealised (open) return
  daysHeldTd: number | null;  // trading days elapsed since entry
};

export type CohortSummary = {
  cohortDate: string;
  entryDate: string | null;
  nPicks: number;
  nClosed: number;
  nOpen: number;
  nTarget: number;
  nStopped: number;
  nExpired: number;
  winRate: number | null;     // over CLOSED picks: share with retPct > 0
  avgRetClosed: number | null;
  avgRetOpenUnreal: number | null;
  picks: SettledPick[];
};

export type RecoReport = {
  generatedAt: string;
  totalPicks: number;
  nClosed: number;
  nOpen: number;
  // Aggregate over all CLOSED picks:
  winRate: number | null;
  avgRetClosed: number | null;
  bestClosed: number | null;
  worstClosed: number | null;
  // Aggregate over all OPEN picks:
  avgRetOpenUnreal: number | null;
  cohorts: CohortSummary[];   // newest first
  knobs: { topN: number; stopPct: number; targetPct: number; horizonTd: number };
};

type ScoreRow = {
  symbol: string;
  snapshot_date: string;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
};

type Bar = { date: string; high: number; low: number; close: number };

/** ascending price series per bare symbol */
async function loadSeries(symbols: string[], fromDate: string): Promise<Map<string, Bar[]>> {
  const series = new Map<string, Bar[]>();
  if (symbols.length === 0) return series;
  const gsyms = symbols.map((s) => `${s}.NS`);
  const rows = await golden<{ symbol: string; date: string; high: string; low: string; close: string }[]>`
    SELECT symbol, date::text AS date, high::text AS high, low::text AS low, close::text AS close
    FROM golden.price_history_1d
    WHERE symbol = ANY(${gsyms})
      AND date >= ${fromDate}
      AND close IS NOT NULL
    ORDER BY symbol, date
  `.catch(() => [] as { symbol: string; date: string; high: string; low: string; close: string }[]);
  for (const r of rows) {
    const bare = r.symbol.endsWith(".NS") ? r.symbol.slice(0, -3) : r.symbol;
    let arr = series.get(bare);
    if (!arr) { arr = []; series.set(bare, arr); }
    arr.push({ date: r.date, high: Number(r.high), low: Number(r.low), close: Number(r.close) });
  }
  return series;
}

/** index of first bar with date >= target (−1 if none) */
function firstIdxOnOrAfter(bars: Bar[], date: string): number {
  for (let i = 0; i < bars.length; i++) if (bars[i].date >= date) return i;
  return -1;
}

/**
 * WRITE: generate locked cohorts. If `onlyLatest` is true only the most-recent
 * snapshot is materialised (weekly use); otherwise every snapshot in the
 * archive is back-filled. Returns how many picks were newly inserted.
 */
export async function generateCohorts(opts: { onlyLatest?: boolean } = {}): Promise<{
  inserted: number; cohorts: string[]; skipped: number;
}> {
  const scores = await sql<ScoreRow[]>`
    SELECT symbol, snapshot_date::text AS snapshot_date,
           composite_pct, quality_pct, valuation_pct, momentum_pct
    FROM app.scores
    WHERE composite_pct IS NOT NULL
  `.catch(() => [] as ScoreRow[]);

  if (scores.length === 0) return { inserted: 0, cohorts: [], skipped: 0 };

  const snapshots = [...new Set(scores.map((s) => s.snapshot_date))].sort();
  const targetSnaps = opts.onlyLatest ? snapshots.slice(-1) : snapshots;

  // Prices for every scored symbol from the earliest target snapshot.
  const allSymbols = [...new Set(scores.map((s) => s.symbol))];
  const series = await loadSeries(allSymbols, targetSnaps[0]);

  const bySnap = new Map<string, ScoreRow[]>();
  for (const r of scores) {
    let arr = bySnap.get(r.snapshot_date);
    if (!arr) { arr = []; bySnap.set(r.snapshot_date, arr); }
    arr.push(r);
  }

  let inserted = 0, skipped = 0;
  const cohorts: string[] = [];

  for (const snap of targetSnaps) {
    const recs = (bySnap.get(snap) ?? [])
      .filter((r) => r.composite_pct != null)
      .sort((a, b) => (b.composite_pct! - a.composite_pct!));
    const top = recs.slice(0, TOP_N);

    let cohortHadPick = false;
    for (let rank = 0; rank < top.length; rank++) {
      const r = top[rank];
      const bars = series.get(r.symbol);
      if (!bars) { skipped++; continue; }
      const i0 = firstIdxOnOrAfter(bars, snap);
      if (i0 < 0) { skipped++; continue; }        // no price on/after snapshot yet
      const entry = bars[i0];
      if (!(entry.close > 0)) { skipped++; continue; }
      const entryPrice = entry.close;
      const stop = entryPrice * (1 - STOP_PCT);
      const target = entryPrice * (1 + TARGET_PCT);

      const res = await sql`
        INSERT INTO app.recommendations
          (cohort_date, symbol, rank, composite_pct, quality_pct, valuation_pct,
           momentum_pct, entry_date, entry_price, stop_price, target_price, horizon_td)
        VALUES
          (${snap}, ${r.symbol}, ${rank + 1}, ${r.composite_pct}, ${r.quality_pct},
           ${r.valuation_pct}, ${r.momentum_pct}, ${entry.date}, ${entryPrice},
           ${stop}, ${target}, ${HORIZON_TD})
        ON CONFLICT (cohort_date, symbol) DO NOTHING
      `.catch(() => null);
      // postgres.js returns rows affected via .count on the result; guard for null.
      const affected = res && typeof (res as { count?: number }).count === "number"
        ? (res as { count: number }).count : 0;
      if (affected > 0) { inserted++; cohortHadPick = true; }
    }
    if (cohortHadPick) cohorts.push(snap);
  }

  // Note: the read cache (getRecommendationReport) is invalidated by the caller
  // (the generate route) via revalidatePath, so a fresh backfill shows at once.
  return { inserted, cohorts, skipped };
}

type RecoRow = {
  id: number;
  cohort_date: string;
  symbol: string;
  rank: number;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  entry_date: string;
  entry_price: string;
  stop_price: string;
  target_price: string;
  horizon_td: number;
};

/**
 * Settle one pick against its price path.
 *
 * Walk trading days from the bar AFTER entry through entry+horizon:
 *   - if the day's LOW ≤ stop → STOPPED (assume filled at stop_price)
 *   - else if the day's HIGH ≥ target → TARGET (assume filled at target_price)
 * If both trip on the same day we assume the STOP filled first (conservative —
 * we never flatter the strategy). If the horizon bar exists with no hit →
 * EXPIRED at that close. If we haven't reached the horizon yet → OPEN, marked
 * to the latest close.
 */
function settle(row: RecoRow, bars: Bar[] | undefined): SettledPick {
  const entryPrice = Number(row.entry_price);
  const stopPrice = Number(row.stop_price);
  const targetPrice = Number(row.target_price);
  const base: Omit<SettledPick, "status" | "markPrice" | "exitDate" | "retPct" | "daysHeldTd"> = {
    id: row.id,
    cohortDate: row.cohort_date,
    symbol: row.symbol,
    rank: row.rank,
    compositePct: row.composite_pct,
    qualityPct: row.quality_pct,
    valuationPct: row.valuation_pct,
    momentumPct: row.momentum_pct,
    entryDate: row.entry_date,
    entryPrice,
    stopPrice,
    targetPrice,
    horizonTd: row.horizon_td,
  };

  if (!bars) {
    return { ...base, status: "NO_DATA", markPrice: null, exitDate: null, retPct: null, daysHeldTd: null };
  }
  const i0 = firstIdxOnOrAfter(bars, row.entry_date);
  if (i0 < 0) {
    return { ...base, status: "NO_DATA", markPrice: null, exitDate: null, retPct: null, daysHeldTd: null };
  }

  const lastIdx = Math.min(i0 + row.horizon_td, bars.length - 1);
  for (let j = i0 + 1; j <= i0 + row.horizon_td && j < bars.length; j++) {
    const b = bars[j];
    if (b.low <= stopPrice) {
      return { ...base, status: "STOPPED", markPrice: stopPrice, exitDate: b.date,
        retPct: stopPrice / entryPrice - 1, daysHeldTd: j - i0 };
    }
    if (b.high >= targetPrice) {
      return { ...base, status: "TARGET", markPrice: targetPrice, exitDate: b.date,
        retPct: targetPrice / entryPrice - 1, daysHeldTd: j - i0 };
    }
  }

  // No stop/target hit. Did we reach the full horizon?
  if (i0 + row.horizon_td < bars.length) {
    const exit = bars[i0 + row.horizon_td];
    return { ...base, status: "EXPIRED", markPrice: exit.close, exitDate: exit.date,
      retPct: exit.close / entryPrice - 1, daysHeldTd: row.horizon_td };
  }

  // Still within horizon — OPEN, mark to latest available close.
  const mark = bars[lastIdx];
  return { ...base, status: "OPEN", markPrice: mark.close, exitDate: null,
    retPct: mark.close / entryPrice - 1, daysHeldTd: lastIdx - i0 };
}

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

async function compute(): Promise<RecoReport> {
  const rows = await sql<RecoRow[]>`
    SELECT id, cohort_date::text AS cohort_date, symbol, rank,
           composite_pct, quality_pct, valuation_pct, momentum_pct,
           entry_date::text AS entry_date, entry_price::text AS entry_price,
           stop_price::text AS stop_price, target_price::text AS target_price, horizon_td
    FROM app.recommendations
    ORDER BY cohort_date DESC, rank ASC
  `.catch(() => [] as RecoRow[]);

  if (rows.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      totalPicks: 0, nClosed: 0, nOpen: 0,
      winRate: null, avgRetClosed: null, bestClosed: null, worstClosed: null,
      avgRetOpenUnreal: null, cohorts: [],
      knobs: { topN: TOP_N, stopPct: STOP_PCT, targetPct: TARGET_PCT, horizonTd: HORIZON_TD },
    };
  }

  const symbols = [...new Set(rows.map((r) => r.symbol))];
  const minEntry = rows.reduce((m, r) => (r.entry_date < m ? r.entry_date : m), rows[0].entry_date);
  const series = await loadSeries(symbols, minEntry);

  const settled = rows.map((r) => settle(r, series.get(r.symbol)));

  // Group into cohorts (newest first — rows already sorted).
  const byCohort = new Map<string, SettledPick[]>();
  for (const p of settled) {
    let arr = byCohort.get(p.cohortDate);
    if (!arr) { arr = []; byCohort.set(p.cohortDate, arr); }
    arr.push(p);
  }

  const cohorts: CohortSummary[] = [...byCohort.entries()].map(([cohortDate, picks]) => {
    const closed = picks.filter((p) => p.status === "TARGET" || p.status === "STOPPED" || p.status === "EXPIRED");
    const open = picks.filter((p) => p.status === "OPEN");
    const closedRets = closed.map((p) => p.retPct!).filter((x) => Number.isFinite(x));
    return {
      cohortDate,
      entryDate: picks.find((p) => p.entryDate)?.entryDate ?? null,
      nPicks: picks.length,
      nClosed: closed.length,
      nOpen: open.length,
      nTarget: picks.filter((p) => p.status === "TARGET").length,
      nStopped: picks.filter((p) => p.status === "STOPPED").length,
      nExpired: picks.filter((p) => p.status === "EXPIRED").length,
      winRate: closedRets.length ? closedRets.filter((x) => x > 0).length / closedRets.length : null,
      avgRetClosed: mean(closedRets),
      avgRetOpenUnreal: mean(open.map((p) => p.retPct!).filter((x) => Number.isFinite(x))),
      picks,
    };
  });

  const allClosed = settled.filter((p) => p.status === "TARGET" || p.status === "STOPPED" || p.status === "EXPIRED");
  const allClosedRets = allClosed.map((p) => p.retPct!).filter((x) => Number.isFinite(x));
  const allOpen = settled.filter((p) => p.status === "OPEN");

  return {
    generatedAt: new Date().toISOString(),
    totalPicks: settled.length,
    nClosed: allClosed.length,
    nOpen: allOpen.length,
    winRate: allClosedRets.length ? allClosedRets.filter((x) => x > 0).length / allClosedRets.length : null,
    avgRetClosed: mean(allClosedRets),
    bestClosed: allClosedRets.length ? Math.max(...allClosedRets) : null,
    worstClosed: allClosedRets.length ? Math.min(...allClosedRets) : null,
    avgRetOpenUnreal: mean(allOpen.map((p) => p.retPct!).filter((x) => Number.isFinite(x))),
    cohorts,
    knobs: { topN: TOP_N, stopPct: STOP_PCT, targetPct: TARGET_PCT, horizonTd: HORIZON_TD },
  };
}

// Outcomes move daily (prices change); cache 1h. Regeneration busts the tag.
export const getRecommendationReport = unstable_cache(compute, ["reco-report-v1"], {
  revalidate: 3600,
  tags: ["recommendations"],
});
