/**
 * The half of the verdict module that carries no database.
 *
 * WHY THIS FILE IS SEPARATE FROM lib/verdict.ts
 *
 * `VerdictPanel` is rendered in two places: as the 7th tab on the stock page
 * (a server component) and inside the watchlist's verdict sheet (a client
 * component reached from a row chip). A module imported by a client component
 * is pulled into the client bundle along with everything it imports — and
 * `lib/verdict.ts` imports `sql` from `@/lib/db`. Importing the panel from the
 * sheet would therefore have tried to bundle the Postgres client for the
 * browser.
 *
 * The alternative was a second copy of the panel for the modal. That is the
 * failure CLAUDE.md §4 names by example: the watchlist buy marker drifted from
 * the portfolio's because the rule lived in two places. A verdict rendered two
 * ways that disagree about what counts as drift is the same bug with higher
 * stakes, so there is exactly one panel and this file is what makes that
 * possible.
 *
 * Nothing here may import from `@/lib/db`.
 */

/** Evidence values are whatever the verdict leaned on — ratios, percentages,
 *  booleans (ema_stack_bull), occasionally a label. */
export type EvidenceValue = number | boolean | string | null;

export type VerdictRow = {
  generated_at: string;
  verdict: string;
  confidence: "high" | "medium" | "low";
  points: string[];
  trigger_text: string | null;
  evidence: Record<string, EvidenceValue>;
  snapshot_date: string | null;
  price_asof: string | null;
  model: string | null;
  source_report: string | null;
};

export type DriftRow = {
  key: string;
  stored: EvidenceValue;
  live: EvidenceValue;
  /** false when the key has no counterpart in cluster_metrics at all. */
  comparable: boolean;
  /**
   * The key exists live but carries no value this snapshot, so the figure can
   * neither be confirmed nor contradicted.
   *
   * This is a THIRD state and it has to be, because the first version did not
   * have it and would have flagged every verdict in the first batch as
   * drifted on the day it shipped. pct_above_200ema_252d and ema_stack_bull
   * were written into the evidence on 7 Oct from a live computation, while the
   * newest metrics snapshot was 4 Oct and still carried nulls for both — so
   * "stored 0.996, live null" was being scored as a material move when the
   * truth was that nothing had been measured yet.
   *
   * A verdict panel that shouts on all 23 rows the day it launches teaches the
   * reader to ignore it, which is the one failure mode this whole feature
   * exists to avoid. Missing is reported as missing.
   */
  liveMissing: boolean;
  /** true when the live value has moved past the threshold for its shape. */
  moved: boolean;
  /** Relative change, where both sides are usable numbers. */
  relPct: number | null;
};

export type VerdictData = {
  current: VerdictRow;
  /** Older verdicts, newest first, excluding `current`. */
  history: VerdictRow[];
  drift: DriftRow[];
  ageDays: number;
  /** Set when the symbol is no longer on the watchlist or in the portfolio. */
  dormant: boolean;
};

/**
 * The row-level summary the watchlist chip renders.
 *
 * Deliberately NOT the full VerdictData. The watchlist asks about 251 symbols
 * at once and the chip shows four facts; shipping every point, every evidence
 * object and every superseded verdict to draw them would be a payload the user
 * pays for and never reads. The sheet fetches the full record for the one
 * symbol that was actually clicked.
 */
export type VerdictChip = {
  symbol: string;
  verdict: string;
  bucket: VerdictBucket;
  confidence: "high" | "medium" | "low";
  generated_at: string;
  ageDays: number;
  /** How many comparable evidence figures have moved past threshold. */
  movedCount: number;
  comparableCount: number;
  /** Figures whose live counterpart is not currently computed. Reported apart
   *  from `movedCount` so an uncomputed metric never reads as a changed one. */
  unverifiableCount: number;
  stale: boolean;
};

/** A symbol that is tracked but carries no verdict, or whose verdict needs
 *  revisiting. The watchlist Verdict tab is a work queue before it is a
 *  report, and a queue that cannot say "nothing is pending" is decoration. */
export type QueueBucket = "missing" | "due" | "dormant" | "current";

export type VerdictBucket = "buy" | "hold" | "watch" | "sell";

/** Past this, the panel says so even if nothing has drifted. Secondary to
 *  drift: a 60-day-old verdict whose every figure is unchanged is mostly fine,
 *  and a 10-day-old one whose PE moved 20% is not. */
export const STALE_DAYS = 45;

/** A numeric figure counts as moved past 10% relative change. Chosen because
 *  it is roughly the point at which a sentence of prose quoting the old number
 *  starts to read as wrong rather than as rounded. */
export const REL_THRESHOLD = 0.1;

/** For figures already expressed as a rate in 0..1 (pct_above_200ema_252d,
 *  margins stored as fractions) a relative test is too twitchy near zero:
 *  0.008 -> 0.02 is +150% relative and immaterial. Use absolute points there. */
export const ABS_THRESHOLD_FOR_RATES = 0.05;

/**
 * Keys the evidence script derives itself — no live counterpart exists, so
 * they must never render as "unchanged".
 *
 * This set is duplicated in scripts/verdict-load.py and the two MUST agree.
 * A key the loader treats as derived but this file does not will render as a
 * live comparison against an absent value forever; a key this file treats as
 * derived but the loader does not will make the loader shout "possible typo"
 * on every single load until the warning is ignored wholesale. Both failures
 * are quiet. Change them together.
 */
export const DERIVED_KEYS = new Set([
  "pe_band_lo", "pe_band_hi", "pe_band_avg", "pe_vs_own_history",
  "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "opm_now", "opm_prev",
  "delivery_pct", "promoter_pct", "fii_pct", "dii_pct", "pledge_pct",
  "shareholders",
]);

export function asNumber(v: EvidenceValue): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function hasMoved(
  stored: EvidenceValue,
  live: EvidenceValue,
): { moved: boolean; relPct: number | null; liveMissing: boolean } {
  // No live value at all. Not a move — see DriftRow.liveMissing for the batch
  // this distinction was learned on. The figure is unverifiable this
  // snapshot, and saying so is different from saying it changed.
  if (live === null || live === undefined) {
    return { moved: false, relPct: null, liveMissing: true };
  }
  // A boolean flipping is always material — that is the entire content of
  // ema_stack_bull, and it is the upgrade trigger on two live verdicts.
  if (typeof stored === "boolean" || typeof live === "boolean") {
    return { moved: Boolean(stored) !== Boolean(live), relPct: null, liveMissing: false };
  }
  const a = asNumber(stored);
  const b = asNumber(live);
  // A live value that is present but unparseable is still unverifiable; the
  // verdict having stored nothing for the key is the same.
  if (a === null || b === null) {
    return { moved: false, relPct: null, liveMissing: true };
  }
  if (a === 0) return { moved: b !== 0, relPct: null, liveMissing: false };

  const rel = b / a - 1;
  const isRate = Math.abs(a) <= 1 && Math.abs(b) <= 1;
  const moved = isRate
    ? Math.abs(b - a) >= ABS_THRESHOLD_FOR_RATES
    : Math.abs(rel) >= REL_THRESHOLD;
  return { moved, relPct: rel, liveMissing: false };
}

/**
 * The one colour map for verdict buckets.
 *
 * Lives here rather than in a component because three places now paint a
 * verdict — the watchlist chip, the by-call groups on the Verdict tab, and the
 * panel's header. Two of them agreeing and one drifting is a colour that means
 * "sell" in one view and nothing in another.
 */
export const BUCKET_COLOR: Record<VerdictBucket, string> = {
  buy: "var(--color-delta-up)",
  hold: "var(--color-accent-600)",
  watch: "var(--color-score-mid, #d4951a)",
  sell: "var(--color-delta-down)",
};

/** Colour bucket for a verdict label. Prefix-matched rather than enumerated
 *  because the labels carry their own correction ("HOLD — downgraded from
 *  BUY"), and an enum would flatten that back to "HOLD". */
export function verdictBucket(v: string): VerdictBucket {
  const u = v.toUpperCase();
  if (u.startsWith("BUY") || u.startsWith("ACCUMULATE")) return "buy";
  if (u.startsWith("AVOID") || u.startsWith("REDUCE") || u.startsWith("SELL")) return "sell";
  if (u.startsWith("WATCH") || u.startsWith("SPECULATIVE")) return "watch";
  return "hold";
}
