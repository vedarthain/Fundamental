/**
 * Recommendation desk — PRIVATE paper-trading ledger for the score's picks.
 *
 * Two halves:
 *   1. generateCohorts()  — WRITE. For each monthly score snapshot, take the top
 *      TOP_N stocks by a 5-leg absolute selection key, stamp each with an entry
 *      price (first golden close on/after the snapshot), a hard stop, and a
 *      horizon. Idempotent (ON CONFLICT DO NOTHING on cohort_date+symbol), so it
 *      can be re-run monthly or back-filled over history safely.
 *   2. getRecommendationReport() — READ. Load the immutable picks, pull golden
 *      OHLC, and SETTLE each one at read time: walk the price path from entry to
 *      horizon and decide TARGET / TRAILED / STOPPED / EXPIRED / OPEN. Nothing
 *      about the outcome is stored, so the ledger can't drift and needs no cron.
 *
 * TWO STRATEGIES COEXIST in one table, distinguished by strategy_version:
 *   v1 (legacy) — top-10 by composite, fixed −8% stop / +15% target, 21td.
 *   v2 ("go big", current) — top-20 by the 5-leg key, −20% hard stop + 25%
 *      trailing stop, 252td (~1yr) horizon, monthly cadence. settle() branches
 *      on the version, so the 16 pre-existing v1 cohorts keep their own rules.
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

// ── Strategy knobs — v2 "go big" (locked cohorts). Change here, regenerate. ──
// The desk hunts for high-conviction names with room to compound over a year,
// not for +15% swing trades. Each monthly cohort locks the top 20 by a 5-leg
// absolute key and rides them with a wide trailing stop so winners run.
//   • TOP_N          20  — a diversified conviction roster, not a 10-name bet.
//   • HORIZON_TD    252  — ~1 trading year; give the thesis time to play out.
//   • HARD_STOP_PCT 0.20 — catastrophic floor: exit if it ever drops 20% off
//                          ENTRY (protects against a name that never works).
//   • TRAIL_PCT     0.25 — trailing stop: exit if it falls 25% off its PEAK
//                          close since entry (locks in a runner's gains while
//                          leaving slack for normal 1-year volatility).
// v2 has NO fixed take-profit — the whole point is to let compounding run.
export const STRATEGY_VERSION = 2;   // stamped on every v2 pick (settle() branches on it)
export const TOP_N = 20;             // picks per monthly cohort
export const HARD_STOP_PCT = 0.20;   // hard stop: −20% from ENTRY
export const TRAIL_PCT = 0.25;       // trailing stop: −25% from PEAK-since-entry
export const HORIZON_TD = 252;       // holding period in trading days (~1 year)
export const BENCH_INDEX = "NIFTY50";       // benchmark code in app.market_index_history
export const BENCH_LABEL = "NIFTY 50";      // human label for the desk

// v1 legacy knobs — retained ONLY so the 16 pre-existing cohorts still settle by
// their original fixed-stop/target rules. Not used for new (v2) generation.
export const V1_STOP_PCT = 0.08;     // legacy stop-loss: −8% from entry
export const V1_TARGET_PCT = 0.15;   // legacy target:   +15% from entry

// Liquidity floor (₹ crore market cap). composite_pct is a WITHIN-BUCKET
// percentile that saturates at 100 for every peer group's leader — ~56 stocks
// tie at 100 on a typical snapshot, and many are untradeable microcaps (down to
// ₹9 Cr). Without a floor, "top 10 by composite" is a microcap lottery. We
// require a minimum market cap so the paper desk only picks realistically
// tradeable names. Tunable — raise for a stricter, more liquid roster.
export const MIN_MARKET_CAP_CR = 1000;

// ── Absolute cross-universe selection key (5-leg "go big") ─────────────────
// composite_pct is a WITHIN-BUCKET percentile: it saturates at 100 for every
// peer group's leader, so "top-N by composite" can't rank leaders against each
// other. The desk needs a genuinely cross-comparable key. We build one WITHOUT
// hand-picked magic thresholds (a "cheap P/E" differs by sector, so fixed cut-
// offs just re-import cross-sector bias). Instead each raw fundamental is scored
// as its percentile across the WHOLE scored universe for the snapshot, then
// blended into FIVE legs. It's a two-stage hybrid:
//
//   Stage 1 — GATE: composite_pct >= COMPOSITE_GATE (strong FOR ITS SECTOR, by
//             construction) AND market_cap floor. The gate does the sector-
//             fairness job.
//   Stage 2 — RANK the survivors head-to-head by the absolute universe-
//             percentile key. Residual sector tilt is damped by five legs.
//
// "Go big" tilt: we want names with the potential to COMPOUND over a year, so
// momentum + growth carry the most weight (55%), quality guards against value
// traps (25%), value keeps us from overpaying (10%), safety is a light
// solvency guardrail (10%). This is a growth-at-a-reasonable-price selector,
// not a deep-value or a pure-momentum one.
//
// The key drives SELECTION + rank only; the pillar percentiles stored on each
// pick are still the original within-bucket score columns (for display).
export const COMPOSITE_GATE = 90;   // Stage-1 peer-strength floor (tunable)

// Leg weights (sum to 1). Momentum + growth lead (compounding tilt); quality
// guards against value traps; value/safety are light guardrails.
export const LEG_WEIGHTS = {
  momentum: 0.30, growth: 0.25, quality: 0.25, value: 0.10, safety: 0.10,
};

// Minimum live metrics a leg needs before its score is trusted. A leg built on
// a single metric is low-confidence and prone to artifacts — e.g. banks/holding
// companies have null EV/EBITDA, EV/sales and FCF-yield, so their VALUE leg
// would rest on P/E alone, and a structurally-low holdco P/E then reads as
// extreme "value" and floats them to the top. Below this threshold we shrink
// the leg to neutral (50) rather than let one metric drive it to an extreme.
export const MIN_LEG_COVERAGE = 2;

// Which raw cluster_metrics fields feed each leg. `roce` is synthetic
// (roce_5y with roce_3y fallback). Fields that are 100%/85% null across the
// universe (tech_net_score_scaled, ema_stack_bull, pct_above_200ema_252d) are
// deliberately excluded — they'd contribute nothing. Safety carries three
// metrics (not just np_consistency + net_debt, which alone leaves most names
// under MIN_LEG_COVERAGE because net_debt_ebitda is ~85% null) so the leg
// actually differentiates.
const LEG_DEF: Record<"momentum" | "growth" | "quality" | "value" | "safety", string[]> = {
  momentum: ["ret_12m_rel", "ret_6m_rel", "ret_3m_rel"],
  growth:   ["np_yoy_q", "sales_yoy_q", "np_growth_above_inflation_5y", "np_growth_above_inflation_7y"],
  quality:  ["roce", "cfo_ebitda_5y", "ebitda_margin_5y", "op_margin_trend_7y", "roe_avg_above_threshold_7y"],
  value:    ["pe_ttm", "ev_ebitda_ttm", "fcf_yield"],
  safety:   ["np_consistency_10y", "roe_avg_above_threshold_10y", "net_debt_ebitda"],
};
// Metrics where a LOWER raw value is better (inverted before ranking).
const LOWER_BETTER = new Set(["pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "net_debt_ebitda"]);
// Multiples where a non-positive value means a loss / no meaningful multiple —
// forced to the worst rank rather than misread as "cheapest".
const REQUIRE_POSITIVE = new Set(["pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm"]);
// Every distinct raw field we must pull from cluster_metrics.
const KEY_METRIC_FIELDS = [
  "pe_ttm", "ev_ebitda_ttm", "fcf_yield",
  "roce_5y", "roce_3y", "cfo_ebitda_5y", "ebitda_margin_5y", "op_margin_trend_7y",
  "roe_avg_above_threshold_7y", "roe_avg_above_threshold_10y", "np_consistency_10y",
  "ret_12m_rel", "ret_6m_rel", "ret_3m_rel",
  "np_yoy_q", "sales_yoy_q", "np_growth_above_inflation_5y", "np_growth_above_inflation_7y",
  "net_debt_ebitda",
] as const;

// A universe row: score columns + market cap + the raw metric fields.
type UniverseRow = ScoreRow & {
  market_cap: number | null;
  metrics: Record<string, number | null>;
};

/** Higher = better "goodness" for a metric, or null. Folds in direction and the
 *  positive-multiple guard so a single percentile pass handles every field. */
function goodness(key: string, v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (REQUIRE_POSITIVE.has(key) && v <= 0) return -1e12;   // loss → worst rank
  return LOWER_BETTER.has(key) ? -v : v;
}

/** Percentile-rank (0–100, higher = better) of each entry against the non-null
 *  population, with tie-averaging. Nulls stay null. */
function percentileRanks(goods: (number | null)[]): (number | null)[] {
  const present = goods
    .map((g, i) => ({ g, i }))
    .filter((x): x is { g: number; i: number } => x.g != null)
    .sort((a, b) => a.g - b.g);
  const out: (number | null)[] = goods.map(() => null);
  const m = present.length;
  if (m === 0) return out;
  if (m === 1) { out[present[0].i] = 100; return out; }
  // average positions across tie groups so equal values get equal percentiles
  let j = 0;
  while (j < m) {
    let k = j;
    while (k + 1 < m && present[k + 1].g === present[j].g) k++;
    const avgPos = (j + k) / 2;                 // 0-based mean position
    const pct = (avgPos / (m - 1)) * 100;
    for (let t = j; t <= k; t++) out[present[t].i] = pct;
    j = k + 1;
  }
  return out;
}

/**
 * Stage-2 absolute selection: given the full scored universe for a snapshot,
 * rank the gated survivors by the universe-percentile key and return the top-N
 * as ScoreRow[] (ranked order preserved for the insert loop).
 */
function selectByAbsoluteKey(universe: UniverseRow[]): ScoreRow[] {
  if (universe.length === 0) return [];
  // roce with 5y→3y fallback, injected as synthetic field "roce".
  for (const r of universe) r.metrics.roce = r.metrics.roce_5y ?? r.metrics.roce_3y;

  // One percentile pass per metric field used by any leg.
  const usedKeys = [...new Set(Object.values(LEG_DEF).flat())];
  const pct: Record<string, (number | null)[]> = {};
  for (const key of usedKeys) {
    pct[key] = percentileRanks(universe.map((r) => goodness(key, r.metrics[key])));
  }
  const legScore = (i: number, leg: keyof typeof LEG_DEF): number | null => {
    const vals = LEG_DEF[leg].map((k) => pct[k][i]).filter((v): v is number => v != null);
    if (vals.length === 0) return null;                       // no data → truly absent
    if (vals.length < MIN_LEG_COVERAGE) return 50;            // low-confidence → neutral
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  type Scored = { row: UniverseRow; key: number };
  const scored: Scored[] = [];
  universe.forEach((row, i) => {
    // Stage-1 gate.
    if ((row.composite_pct ?? -1) < COMPOSITE_GATE) return;
    if ((row.market_cap ?? 0) < MIN_MARKET_CAP_CR) return;
    // Require the two conviction legs: a "go big" name must have real quality
    // AND real growth data — no faking a compounder on a lone momentum print.
    const quality = legScore(i, "quality");
    const growth = legScore(i, "growth");
    if (quality == null || growth == null) return;
    // The remaining legs are near-always present; if a leg is fully null, treat
    // it as neutral (50) rather than renormalising (which rewards missing data).
    const momentum = legScore(i, "momentum") ?? 50;
    const value = legScore(i, "value") ?? 50;
    const safety = legScore(i, "safety") ?? 50;
    const key =
      LEG_WEIGHTS.momentum * momentum +
      LEG_WEIGHTS.growth * growth +
      LEG_WEIGHTS.quality * quality +
      LEG_WEIGHTS.value * value +
      LEG_WEIGHTS.safety * safety;
    scored.push({ row, key });
  });

  scored.sort((a, b) =>
    b.key - a.key ||
    (b.row.market_cap ?? 0) - (a.row.market_cap ?? 0) ||
    (a.row.symbol < b.row.symbol ? -1 : a.row.symbol > b.row.symbol ? 1 : 0),
  );
  return scored.slice(0, TOP_N).map((s) => ({
    symbol: s.row.symbol,
    snapshot_date: s.row.snapshot_date,
    composite_pct: s.row.composite_pct,
    quality_pct: s.row.quality_pct,
    valuation_pct: s.row.valuation_pct,
    momentum_pct: s.row.momentum_pct,
  }));
}

// TARGET/STOPPED are v1 (fixed take-profit / fixed stop); TRAILED is v2 (exit
// off a trailing stop); STOPPED also covers v2's −20% hard stop. EXPIRED = held
// to horizon. OPEN = still live. NO_DATA = no price series.
export type RecoStatus = "OPEN" | "TARGET" | "STOPPED" | "TRAILED" | "EXPIRED" | "NO_DATA";

export type SettledPick = {
  id: number;
  cohortDate: string;
  symbol: string;
  rank: number;
  strategyVersion: number;
  compositePct: number | null;
  qualityPct: number | null;
  valuationPct: number | null;
  momentumPct: number | null;
  entryDate: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number | null;   // null for v2 (no fixed take-profit)
  horizonTd: number;
  // Settlement (computed at read time):
  status: RecoStatus;
  markPrice: number | null;   // latest close (open) or exit price (closed)
  exitDate: string | null;    // null while OPEN
  retPct: number | null;      // realised (closed) or unrealised (open) return
  daysHeldTd: number | null;  // trading days elapsed since entry
  // Benchmark (NIFTY 50 buy-and-hold over the SAME entry→exit window):
  benchRetPct: number | null; // NIFTY 50 return over the pick's holding window
  alphaPct: number | null;    // retPct − benchRetPct (edge vs the index fund)
};

export type CohortSummary = {
  cohortDate: string;
  strategyVersion: number;
  entryDate: string | null;
  nPicks: number;
  nClosed: number;
  nOpen: number;
  nTarget: number;
  nStopped: number;
  nTrailed: number;
  nExpired: number;
  winRate: number | null;     // over CLOSED picks: share with retPct > 0
  avgRetClosed: number | null;
  avgRetOpenUnreal: number | null;
  avgBenchClosed: number | null;   // avg NIFTY 50 return over closed picks' windows
  avgAlphaClosed: number | null;   // avg (pick − NIFTY 50) over closed picks
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
  // Benchmark aggregates over all CLOSED picks (NIFTY 50, same windows):
  avgBenchClosed: number | null;
  avgAlphaClosed: number | null;
  benchCode: string;          // which index the benchmark uses (e.g. "NIFTY 50")
  headlineVersion: number;    // strategy the headline aggregates are computed over
  cohorts: CohortSummary[];   // newest first
  knobs: { topN: number; hardStopPct: number; trailPct: number; horizonTd: number };
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
 * Benchmark helper. Loads the NIFTY 50 daily close series (app DB, same as the
 * ledger — no cross-DB) and returns an as-of return function: the index's
 * buy-and-hold return between two dates, using the last close on/before each.
 * This lets every pick be measured against "what if I'd just held the index
 * over the exact same window?" — the honest alternative to stock-picking.
 */
async function loadBenchmark(fromDate: string): Promise<(from: string, to: string) => number | null> {
  const rows = await sql<{ date: string; close: string }[]>`
    SELECT date::text AS date, close::text AS close
    FROM app.market_index_history
    WHERE index_code = ${BENCH_INDEX} AND date >= ${fromDate} AND close IS NOT NULL
    ORDER BY date
  `.catch(() => [] as { date: string; close: string }[]);
  const series: [string, number][] = rows.map((r) => [r.date, Number(r.close)]);

  /** last close on/before `date` (−1 → none) */
  function closeAsOf(date: string): number | null {
    let ans: number | null = null;
    for (let i = 0; i < series.length; i++) {
      if (series[i][0] <= date) ans = series[i][1];
      else break;
    }
    return ans && ans > 0 ? ans : null;
  }
  return (from: string, to: string): number | null => {
    const a = closeAsOf(from), b = closeAsOf(to);
    if (a == null || b == null) return null;
    return b / a - 1;
  };
}

/**
 * WRITE: generate locked cohorts. If `onlyLatest` is true only the most-recent
 * snapshot is materialised (weekly use); otherwise every snapshot in the
 * archive is back-filled. Returns how many picks were newly inserted.
 */
export async function generateCohorts(opts: { onlyLatest?: boolean } = {}): Promise<{
  inserted: number; cohorts: string[]; skipped: number; snapshotsConsidered: number;
}> {
  // Distinct snapshot dates only — a cheap, indexed query. (The old code pulled
  // every symbol × every snapshot in one unbounded scan, which timed out on
  // Neon and, because the error was swallowed, silently produced zero picks.)
  // NOTE: no .catch here — a real DB error must propagate to the route so it
  // returns a 500 with detail instead of pretending success.
  const snapRows = await sql<{ snapshot_date: string }[]>`
    SELECT DISTINCT snapshot_date::text AS snapshot_date
    FROM app.scores
    WHERE composite_pct IS NOT NULL
    ORDER BY snapshot_date
  `;
  const snapshots = snapRows.map((s) => s.snapshot_date);
  if (snapshots.length === 0) {
    return { inserted: 0, cohorts: [], skipped: 0, snapshotsConsidered: 0 };
  }

  const targetSnaps = opts.onlyLatest ? snapshots.slice(-1) : snapshots;

  // For each target snapshot, pull the FULL scored universe (score columns +
  // market cap + the raw fundamentals the key needs), then select in JS.
  //
  // Selection is a two-stage hybrid (see COMPOSITE_GATE / LEG_DEF above):
  //   Stage 1 — GATE by composite_pct (peer-strength, sector-fair) + market-cap
  //             floor (drops untradeable microcaps).
  //   Stage 2 — RANK survivors by the absolute universe-percentile key so we
  //             compare leaders across buckets head-to-head — the thing
  //             composite_pct can't do because it saturates at 100. A
  //             deterministic market-cap/symbol tie-break keeps runs stable.
  const bySnap = new Map<string, ScoreRow[]>();
  for (const snap of targetSnaps) {
    const rows = await sql<{
      symbol: string; snapshot_date: string;
      composite_pct: number | null; quality_pct: number | null;
      valuation_pct: number | null; momentum_pct: number | null;
      market_cap: number | null; metrics: Record<string, number | null>;
    }[]>`
      SELECT s.symbol, s.snapshot_date::text AS snapshot_date,
             s.composite_pct, s.quality_pct, s.valuation_pct, s.momentum_pct,
             m.market_cap,
             m.cluster_metrics AS metrics
      FROM app.scores s
      JOIN app.metrics_snapshot m
        ON m.symbol = s.symbol AND m.snapshot_date = s.snapshot_date
      WHERE s.snapshot_date = ${snap}
        AND s.composite_pct IS NOT NULL
    `;
    // Coerce only the metric fields the key uses to numbers (cluster_metrics
    // arrives as a jsonb object of strings/numbers/nulls).
    const universe: UniverseRow[] = rows.map((r) => {
      const metrics: Record<string, number | null> = {};
      for (const f of KEY_METRIC_FIELDS) {
        const raw = r.metrics?.[f];
        const n = raw == null ? null : Number(raw);
        metrics[f] = n != null && Number.isFinite(n) ? n : null;
      }
      return {
        symbol: r.symbol, snapshot_date: r.snapshot_date,
        composite_pct: r.composite_pct, quality_pct: r.quality_pct,
        valuation_pct: r.valuation_pct, momentum_pct: r.momentum_pct,
        market_cap: r.market_cap, metrics,
      };
    });
    bySnap.set(snap, selectByAbsoluteKey(universe));
  }

  // Prices for just the picked symbols, from the earliest target snapshot.
  const allSymbols = [...new Set([...bySnap.values()].flat().map((r) => r.symbol))];
  const series = await loadSeries(allSymbols, targetSnaps[0]);

  let inserted = 0, skipped = 0;
  const cohorts: string[] = [];

  for (const snap of targetSnaps) {
    const top = bySnap.get(snap) ?? [];

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
      // v2 "go big": hard stop is −20% from ENTRY; the 25% trailing stop is
      // applied at settle time (needs the price path). target_price is NULL —
      // there is no fixed take-profit, we let winners run.
      const hardStop = entryPrice * (1 - HARD_STOP_PCT);

      // No .catch — surface genuine insert failures. ON CONFLICT DO NOTHING
      // already makes re-runs idempotent, so duplicates aren't errors.
      const res = await sql`
        INSERT INTO app.recommendations
          (cohort_date, symbol, rank, composite_pct, quality_pct, valuation_pct,
           momentum_pct, entry_date, entry_price, stop_price, target_price,
           horizon_td, strategy_version)
        VALUES
          (${snap}, ${r.symbol}, ${rank + 1}, ${r.composite_pct}, ${r.quality_pct},
           ${r.valuation_pct}, ${r.momentum_pct}, ${entry.date}, ${entryPrice},
           ${hardStop}, ${null}, ${HORIZON_TD}, ${STRATEGY_VERSION})
        ON CONFLICT (cohort_date, symbol) DO NOTHING
      `;
      // postgres.js exposes rows affected via .count on the result.
      const affected = typeof (res as { count?: number }).count === "number"
        ? (res as { count: number }).count : 0;
      if (affected > 0) { inserted++; cohortHadPick = true; }
    }
    if (cohortHadPick) cohorts.push(snap);
  }

  // Note: the read cache (getRecommendationReport) is invalidated by the caller
  // (the generate route) via revalidatePath, so a fresh backfill shows at once.
  return { inserted, cohorts, skipped, snapshotsConsidered: targetSnaps.length };
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
  target_price: string | null;   // null for v2 (no fixed take-profit)
  horizon_td: number;
  strategy_version: number;
};

/**
 * Settle one pick against its price path. The exit rules depend on the pick's
 * strategy_version (both versions coexist in the same table):
 *
 *   v1 (legacy fixed stop/target) — walk entry+1 … entry+horizon:
 *       LOW ≤ stop  → STOPPED (filled at stop_price)
 *       HIGH ≥ target → TARGET (filled at target_price)
 *       stop wins a same-day tie (conservative). Else EXPIRED / OPEN.
 *
 *   v2 ("go big" trailing stop) — no fixed take-profit. Track the PEAK close
 *       since entry; the live stop each day is max(hard stop, peak·(1−TRAIL)).
 *       LOW ≤ live stop → exit. If the trailing stop is the binding one it's a
 *       TRAILED exit (gave back gains from a high); if the −20% hard floor
 *       binds it's a STOPPED. Peak is updated with the CLOSE only AFTER the
 *       day's stop check, so a bar can't both lift the trail and be measured
 *       against the lifted trail (no same-bar look-ahead). Else EXPIRED / OPEN.
 */
function settle(
  row: RecoRow,
  bars: Bar[] | undefined,
  benchRet: (from: string, to: string) => number | null,
): SettledPick {
  const entryPrice = Number(row.entry_price);
  const stopPrice = Number(row.stop_price);
  const targetPrice = row.target_price == null ? null : Number(row.target_price);
  const base: Omit<SettledPick,
    "status" | "markPrice" | "exitDate" | "retPct" | "daysHeldTd" | "benchRetPct" | "alphaPct"> = {
    id: row.id,
    cohortDate: row.cohort_date,
    symbol: row.symbol,
    rank: row.rank,
    strategyVersion: row.strategy_version,
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
  const noBench = { benchRetPct: null, alphaPct: null };

  if (!bars) {
    return { ...base, status: "NO_DATA", markPrice: null, exitDate: null, retPct: null, daysHeldTd: null, ...noBench };
  }
  const i0 = firstIdxOnOrAfter(bars, row.entry_date);
  if (i0 < 0) {
    return { ...base, status: "NO_DATA", markPrice: null, exitDate: null, retPct: null, daysHeldTd: null, ...noBench };
  }

  // Determine the outcome (status, mark, exit date, return, days held).
  let status: RecoStatus, markPrice: number, exitDate: string | null, retPct: number, daysHeldTd: number;
  let outDate: string;   // the date the holding window ends (for the benchmark)

  const lastIdx = Math.min(i0 + row.horizon_td, bars.length - 1);
  let resolved = false;
  status = "OPEN"; markPrice = 0; exitDate = null; retPct = 0; daysHeldTd = 0; outDate = bars[i0].date;

  if (row.strategy_version >= 2) {
    // v2: trailing stop off the peak close, with the −20% hard floor.
    let peak = entryPrice;   // peak close since entry (starts at entry)
    for (let j = i0 + 1; j <= i0 + row.horizon_td && j < bars.length; j++) {
      const b = bars[j];
      const trailStop = peak * (1 - TRAIL_PCT);
      const liveStop = Math.max(stopPrice, trailStop);
      if (b.low <= liveStop) {
        // Trailing binds when it sits above the hard floor → gave back gains.
        status = trailStop > stopPrice ? "TRAILED" : "STOPPED";
        markPrice = liveStop; exitDate = b.date;
        retPct = liveStop / entryPrice - 1; daysHeldTd = j - i0; outDate = b.date; resolved = true; break;
      }
      if (b.close > peak) peak = b.close;   // lift AFTER the stop check
    }
  } else {
    // v1: fixed stop / fixed target (target_price is non-null for v1).
    for (let j = i0 + 1; j <= i0 + row.horizon_td && j < bars.length; j++) {
      const b = bars[j];
      if (b.low <= stopPrice) {
        status = "STOPPED"; markPrice = stopPrice; exitDate = b.date;
        retPct = stopPrice / entryPrice - 1; daysHeldTd = j - i0; outDate = b.date; resolved = true; break;
      }
      if (targetPrice != null && b.high >= targetPrice) {
        status = "TARGET"; markPrice = targetPrice; exitDate = b.date;
        retPct = targetPrice / entryPrice - 1; daysHeldTd = j - i0; outDate = b.date; resolved = true; break;
      }
    }
  }

  if (!resolved) {
    if (i0 + row.horizon_td < bars.length) {
      const exit = bars[i0 + row.horizon_td];
      status = "EXPIRED"; markPrice = exit.close; exitDate = exit.date;
      retPct = exit.close / entryPrice - 1; daysHeldTd = row.horizon_td; outDate = exit.date;
    } else {
      const mark = bars[lastIdx];
      status = "OPEN"; markPrice = mark.close; exitDate = null;
      retPct = mark.close / entryPrice - 1; daysHeldTd = lastIdx - i0; outDate = mark.date;
    }
  }

  // Benchmark over the SAME window (entry bar date → outDate). Alpha = pick − index.
  const benchRetPct = benchRet(bars[i0].date, outDate);
  const alphaPct = benchRetPct == null ? null : retPct - benchRetPct;

  return { ...base, status, markPrice, exitDate, retPct, daysHeldTd, benchRetPct, alphaPct };
}

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** A pick is "closed" once it has a realised outcome (any exit rule fired or it
 *  ran to horizon). OPEN / NO_DATA are still live/unknown. */
const isClosed = (p: SettledPick): boolean =>
  p.status === "TARGET" || p.status === "STOPPED" || p.status === "TRAILED" || p.status === "EXPIRED";

async function compute(): Promise<RecoReport> {
  const rows = await sql<RecoRow[]>`
    SELECT id, cohort_date::text AS cohort_date, symbol, rank,
           composite_pct, quality_pct, valuation_pct, momentum_pct,
           entry_date::text AS entry_date, entry_price::text AS entry_price,
           stop_price::text AS stop_price, target_price::text AS target_price,
           horizon_td, strategy_version
    FROM app.recommendations
    ORDER BY cohort_date DESC, rank ASC
  `.catch(() => [] as RecoRow[]);

  if (rows.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      totalPicks: 0, nClosed: 0, nOpen: 0,
      winRate: null, avgRetClosed: null, bestClosed: null, worstClosed: null,
      avgRetOpenUnreal: null, avgBenchClosed: null, avgAlphaClosed: null,
      benchCode: BENCH_LABEL, headlineVersion: STRATEGY_VERSION, cohorts: [],
      knobs: { topN: TOP_N, hardStopPct: HARD_STOP_PCT, trailPct: TRAIL_PCT, horizonTd: HORIZON_TD },
    };
  }

  const symbols = [...new Set(rows.map((r) => r.symbol))];
  const minEntry = rows.reduce((m, r) => (r.entry_date < m ? r.entry_date : m), rows[0].entry_date);
  const [series, benchRet] = await Promise.all([
    loadSeries(symbols, minEntry),
    loadBenchmark(minEntry),
  ]);

  const settled = rows.map((r) => settle(r, series.get(r.symbol), benchRet));

  // Group into cohorts (newest first — rows already sorted).
  const byCohort = new Map<string, SettledPick[]>();
  for (const p of settled) {
    let arr = byCohort.get(p.cohortDate);
    if (!arr) { arr = []; byCohort.set(p.cohortDate, arr); }
    arr.push(p);
  }

  const cohorts: CohortSummary[] = [...byCohort.entries()].map(([cohortDate, picks]) => {
    const closed = picks.filter(isClosed);
    const open = picks.filter((p) => p.status === "OPEN");
    const closedRets = closed.map((p) => p.retPct!).filter((x) => Number.isFinite(x));
    return {
      cohortDate,
      strategyVersion: picks[0]?.strategyVersion ?? 1,
      entryDate: picks.find((p) => p.entryDate)?.entryDate ?? null,
      nPicks: picks.length,
      nClosed: closed.length,
      nOpen: open.length,
      nTarget: picks.filter((p) => p.status === "TARGET").length,
      nStopped: picks.filter((p) => p.status === "STOPPED").length,
      nTrailed: picks.filter((p) => p.status === "TRAILED").length,
      nExpired: picks.filter((p) => p.status === "EXPIRED").length,
      winRate: closedRets.length ? closedRets.filter((x) => x > 0).length / closedRets.length : null,
      avgRetClosed: mean(closedRets),
      avgRetOpenUnreal: mean(open.map((p) => p.retPct!).filter((x) => Number.isFinite(x))),
      avgBenchClosed: mean(closed.map((p) => p.benchRetPct).filter((x): x is number => x != null)),
      avgAlphaClosed: mean(closed.map((p) => p.alphaPct).filter((x): x is number => x != null)),
      picks,
    };
  });

  // Headline aggregates cover ONLY the current strategy (v2). The legacy v1
  // cohorts settle by different rules (fixed +15% target / −8% stop), so
  // blending their win-rate into the go-big scorecard would be dishonest — they
  // still render per-cohort below with their own stats.
  const headline = settled.filter((p) => p.strategyVersion === STRATEGY_VERSION);
  const allClosed = headline.filter(isClosed);
  const allClosedRets = allClosed.map((p) => p.retPct!).filter((x) => Number.isFinite(x));
  const allOpen = headline.filter((p) => p.status === "OPEN");

  return {
    generatedAt: new Date().toISOString(),
    totalPicks: headline.length,
    nClosed: allClosed.length,
    nOpen: allOpen.length,
    winRate: allClosedRets.length ? allClosedRets.filter((x) => x > 0).length / allClosedRets.length : null,
    avgRetClosed: mean(allClosedRets),
    bestClosed: allClosedRets.length ? Math.max(...allClosedRets) : null,
    worstClosed: allClosedRets.length ? Math.min(...allClosedRets) : null,
    avgRetOpenUnreal: mean(allOpen.map((p) => p.retPct!).filter((x) => Number.isFinite(x))),
    avgBenchClosed: mean(allClosed.map((p) => p.benchRetPct).filter((x): x is number => x != null)),
    avgAlphaClosed: mean(allClosed.map((p) => p.alphaPct).filter((x): x is number => x != null)),
    benchCode: BENCH_LABEL,
    headlineVersion: STRATEGY_VERSION,
    cohorts,
    knobs: { topN: TOP_N, hardStopPct: HARD_STOP_PCT, trailPct: TRAIL_PCT, horizonTd: HORIZON_TD },
  };
}

// Outcomes move daily (prices change); cache 1h. Regeneration busts the tag.
export const getRecommendationReport = unstable_cache(compute, ["reco-report-v2"], {
  revalidate: 3600,
  tags: ["recommendations"],
});
