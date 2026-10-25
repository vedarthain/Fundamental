/**
 * Hand-written per-symbol verdicts, and the drift check that keeps them honest.
 *
 * `app.stock_verdict` (migration 0086) stores a verdict, the points supporting
 * it, the condition that would reverse it, and — the load-bearing part — the
 * figures it was actually written against, frozen at the time of writing.
 *
 * WHY DRIFT RATHER THAN AGE
 *
 * A date badge does not stop a reader trusting an old opinion. "Written 7 Oct"
 * reads as provenance, not as a warning, and a verdict written against PE 40
 * is not wrong because STALE_DAYS elapsed — it is wrong because the PE is now 47.
 * So this module re-reads the same metric keys live and compares, and the panel
 * reports the comparison in the reader's own terms: "written against PE 40.0 —
 * now 47.2". Age is kept as a secondary signal, not the primary one.
 *
 * Asked CLAUDE.md §5's question — what would make this fail? — a clock cannot.
 * It always renders an age and an age always looks like information. A
 * stored-vs-live comparison fails loudly, on the specific number that moved.
 *
 * WHAT CANNOT BE COMPARED IS SAID, NOT HIDDEN
 *
 * Some evidence keys have no counterpart in `cluster_metrics`: the own-history
 * PE band and the TTM-vs-prior-TTM trend are derived by
 * `scripts/verdict-evidence.py` because the engine stores no such metric. Those
 * rows render as "no live counterpart" rather than as unchanged. Silently
 * treating an uncomparable figure as stable is precisely how a stale verdict
 * would pass itself off as current.
 *
 * The pure half — types, thresholds, `hasMoved`, `verdictBucket` — lives in
 * lib/verdictTypes.ts so the same panel can render inside a client modal. See
 * that file's header for why one panel rather than two.
 */

import { latestCloseBySymbol } from "@/lib/calls";
import { sql } from "@/lib/db";
import {
  DERIVED_KEYS,
  STALE_DAYS,
  hasMoved,
  verdictBucket,
  type DriftRow,
  type EvidenceValue,
  type QueueBucket,
  type VerdictChip,
  type VerdictData,
  type VerdictRow,
} from "@/lib/verdictTypes";

export * from "@/lib/verdictTypes";

type RawVerdict = {
  generated_at: Date;
  verdict: string;
  confidence: "high" | "medium" | "low";
  points: unknown;
  trigger_text: string | null;
  evidence: unknown;
  snapshot_date: Date | null;
  price_asof: Date | null;
  model: string | null;
  source_report: string | null;
};

function normalise(r: RawVerdict): VerdictRow {
  return {
    generated_at: r.generated_at.toISOString(),
    verdict: r.verdict,
    confidence: r.confidence,
    points: Array.isArray(r.points) ? (r.points as string[]) : [],
    trigger_text: r.trigger_text,
    evidence:
      r.evidence && typeof r.evidence === "object"
        ? (r.evidence as Record<string, EvidenceValue>)
        : {},
    snapshot_date: r.snapshot_date ? r.snapshot_date.toISOString().slice(0, 10) : null,
    price_asof: r.price_asof ? r.price_asof.toISOString().slice(0, 10) : null,
    model: r.model,
    source_report: r.source_report,
  };
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * Compare one verdict's frozen evidence against a set of live metric values.
 *
 * Shared by the panel, the watchlist chip and the weekly timeline so that all
 * three agree on what "moved" means. The timeline passes an OLD snapshot's
 * metrics rather than today's, which is the only reason it can say which week
 * a verdict's evidence first broke instead of only that it is broken now.
 */
export function computeDrift(
  evidence: Record<string, EvidenceValue>,
  live: Record<string, EvidenceValue>,
): DriftRow[] {
  return Object.keys(evidence)
    .sort()
    .map((key) => {
      const stored = evidence[key];
      if (DERIVED_KEYS.has(key) || !(key in live)) {
        return {
          key, stored, live: null, comparable: false,
          liveMissing: false, moved: false, relPct: null,
        };
      }
      const liveVal = live[key];
      const { moved, relPct, liveMissing } = hasMoved(stored, liveVal);
      return { key, stored, live: liveVal, comparable: true, liveMissing, moved, relPct };
    });
}

/**
 * Load the newest verdict for a symbol plus its history and drift.
 *
 * Returns null when no verdict has been written. The caller must render an
 * explicit empty state for that case and never a blank panel — a tab that
 * shows nothing is indistinguishable from a tab that failed.
 *
 * Fails soft on a missing table so a fresh clone or an environment where 0086
 * has not been applied renders the empty state rather than a 500.
 */
export async function loadVerdict(symbol: string): Promise<VerdictData | null> {
  const upper = symbol.toUpperCase();

  let rows: RawVerdict[] = [];
  try {
    rows = await sql<RawVerdict[]>`
      SELECT generated_at, verdict, confidence, points, trigger_text, evidence,
             snapshot_date, price_asof, model, source_report
        FROM app.stock_verdict
       WHERE symbol = ${upper}
       ORDER BY generated_at DESC
       LIMIT 12
    `;
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const all = rows.map(normalise);
  const current = all[0];

  // Live values for the same keys, from the metrics store the scorer reads.
  // cluster_metrics rather than the flat columns on metrics_snapshot: the flat
  // set is narrower and is not what the formulas consume, so comparing against
  // it would compare the verdict to something nothing else uses.
  let live: Record<string, EvidenceValue> = {};
  let tracked = true;
  try {
    const m = await sql<{ cluster_metrics: Record<string, EvidenceValue> | null }[]>`
      SELECT cluster_metrics
        FROM app.metrics_snapshot
       WHERE symbol = ${upper}
       ORDER BY snapshot_date DESC
       LIMIT 1
    `;
    live = m[0]?.cluster_metrics ?? {};
  } catch {
    live = {};
  }
  try {
    const t = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM (
        SELECT symbol FROM app.user_watchlist WHERE symbol = ${upper}
        UNION
        SELECT symbol FROM app.portfolio_holding WHERE symbol = ${upper}
      ) x
    `;
    tracked = (t[0]?.n ?? 0) > 0;
  } catch {
    tracked = true;
  }

  return {
    current,
    history: all.slice(1),
    drift: computeDrift(current.evidence, live),
    ageDays: daysSince(current.generated_at),
    dormant: !tracked,
  };
}

/* ------------------------------------------------------------------ chips */

/**
 * The newest verdict for each of many symbols, reduced to what a row chip
 * shows. One query for the verdicts and one for the metrics, regardless of
 * how many symbols are asked for — the watchlist calls this with ~250.
 *
 * DISTINCT ON rather than a correlated subquery because the table is
 * append-only: every symbol has as many rows as it has ever had opinions, and
 * the chip wants only the live one.
 */
export async function loadVerdictChips(symbols: string[]): Promise<Map<string, VerdictChip>> {
  const out = new Map<string, VerdictChip>();
  if (symbols.length === 0) return out;

  let rows: { symbol: string; generated_at: Date; verdict: string;
              confidence: "high" | "medium" | "low"; evidence: unknown }[] = [];
  try {
    rows = await sql`
      SELECT DISTINCT ON (symbol)
             symbol, generated_at, verdict, confidence, evidence
        FROM app.stock_verdict
       WHERE symbol = ANY(${symbols})
       ORDER BY symbol, generated_at DESC
    `;
  } catch {
    // Non-fatal: no chips rather than no watchlist.
    return out;
  }
  if (rows.length === 0) return out;

  const live = await loadLiveMetrics(rows.map((r) => r.symbol));

  for (const r of rows) {
    const evidence = (r.evidence && typeof r.evidence === "object"
      ? r.evidence : {}) as Record<string, EvidenceValue>;
    const drift = computeDrift(evidence, live.get(r.symbol) ?? {});
    const generated_at = r.generated_at.toISOString();
    const ageDays = daysSince(generated_at);
    out.set(r.symbol, {
      symbol: r.symbol,
      verdict: r.verdict,
      bucket: verdictBucket(r.verdict),
      confidence: r.confidence,
      generated_at,
      ageDays,
      movedCount: drift.filter((d) => d.moved).length,
      comparableCount: drift.filter((d) => d.comparable && !d.liveMissing).length,
      unverifiableCount: drift.filter((d) => d.comparable && d.liveMissing).length,
      stale: ageDays > STALE_DAYS,
    });
  }
  return out;
}

/** cluster_metrics at the latest snapshot, for many symbols at once. */
async function loadLiveMetrics(
  symbols: string[],
): Promise<Map<string, Record<string, EvidenceValue>>> {
  const out = new Map<string, Record<string, EvidenceValue>>();
  if (symbols.length === 0) return out;
  try {
    const rows = await sql<
      { symbol: string; cluster_metrics: Record<string, EvidenceValue> | null }[]
    >`
      SELECT symbol, cluster_metrics
        FROM app.metrics_snapshot
       WHERE symbol = ANY(${symbols})
         AND snapshot_date = (SELECT MAX(snapshot_date) FROM app.metrics_snapshot)
    `;
    for (const r of rows) out.set(r.symbol, r.cluster_metrics ?? {});
  } catch {
    // Leave empty — every key then reads as "no live counterpart", which is
    // the honest rendering of "we could not look".
  }
  return out;
}

/* ------------------------------------------------------- queue + timeline */

export type QueueEntry = {
  symbol: string;
  company_name: string | null;
  sector: string | null;
  industry: string | null;
  bucket: QueueBucket;
  verdict: string | null;
  action: string | null;
  thesis: string | null;
  confidence: "high" | "medium" | "low" | null;
  generated_at: string | null;
  ageDays: number | null;
  movedCount: number;
  comparableCount: number;
  /** Figures whose live counterpart is not computed this snapshot. A verdict
   *  is not "due" for these — nothing has contradicted it, the check simply
   *  could not be run. */
  unverifiableCount: number;
  /** Which stored figures have moved — named, because "3 figures moved" does
   *  not tell you whether to bother re-reading it. */
  movedKeys: string[];
  /** When the symbol entered the watchlist, where that is known. */
  addedAt: string | null;
  /** The close on the verdict's own `price_asof`, frozen at load time by
   *  scripts/verdict-load.py. NOT recomputed here: golden.price_history is
   *  split-back-adjusted, so a derived anchor would silently rewrite
   *  `pctMove` months later. See db/migrations/0087. */
  anchorPrice: number | null;
  /** The date `anchorPrice` is the close for — shown, because "₹1,178" with no
   *  date is not a verifiable claim. */
  priceAsof: string | null;
  /** Latest close, from `latestCloseBySymbol()` — the same reader the calls
   *  feature uses, so the two features cannot disagree about what LTP means. */
  ltp: number | null;
  /** Move from anchor to LTP, in percent. null when either end is missing;
   *  never 0, because a zero move is a claim and an absent one is not. */
  pctMove: number | null;
};

export type TimelineWeek = {
  /** Monday of the week, ISO date. */
  weekStart: string;
  /** The metrics snapshot this week's drift was measured against. */
  snapshotDate: string | null;
  written: string[];
  /** Verdicts whose evidence first broke during this week. */
  broke: string[];
  /** Verdicts that crossed the STALE_DAYS mark during this week. */
  wentStale: string[];
  /** Symbols added to the watchlist during this week. */
  added: string[];
};

export type VerdictQueue = {
  entries: QueueEntry[];
  timeline: TimelineWeek[];
  counts: Record<QueueBucket, number>;
  trackedCount: number;
};

function weekStartOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // getUTCDay(): 0 = Sunday. Shift so Monday starts the week.
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

/**
 * The work queue behind the watchlist's Verdict tab, plus a weekly timeline.
 *
 * WHY A QUEUE AND NOT A LIST OF VERDICTS
 *
 * Migration 0086's header says it plainly: nothing refreshes this table on a
 * schedule, so the thing that keeps it honest has to be a view that says what
 * is OUTSTANDING. And it must EVICT, not only upsert — the previous coverage
 * ledger in this codebase could only add, so retired symbols sat in it forever
 * and the number it reported slowly stopped meaning anything. Here the tracked
 * set is recomputed from watchlist UNION portfolio on every read, so a symbol
 * dropped from the watchlist leaves the queue the same day and reappears under
 * `dormant` only if a verdict about it exists.
 *
 * WHY THE TIMELINE IS NOT "VERDICTS WRITTEN PER WEEK"
 *
 * Verdicts are written by hand in monthly batches, so a chart of writing
 * activity is three empty weeks out of four — a panel that is blank by design
 * and reads as broken. What genuinely moves week to week is the evidence:
 * `app.metrics_snapshot` is written weekly, so each week's `cluster_metrics`
 * can be compared against the frozen evidence to find the week a verdict's
 * argument first stopped matching the data. That is the column worth reading,
 * and the writing batches are marked on the same line for context.
 */
export async function loadVerdictQueue(weeks = 12): Promise<VerdictQueue> {
  const empty: VerdictQueue = {
    entries: [], timeline: [],
    counts: { missing: 0, due: 0, dormant: 0, current: 0 },
    trackedCount: 0,
  };

  let tracked: { symbol: string; company_name: string | null; sector: string | null; industry: string | null; added_at: Date | null }[] = [];
  try {
    tracked = await sql`
      SELECT t.symbol,
             s.company_name,
             s.sector,
             s.industry,
             MIN(w.added_at) AS added_at
        FROM (
          SELECT symbol FROM app.user_watchlist WHERE symbol IS NOT NULL
          UNION
          SELECT symbol FROM app.portfolio_holding WHERE symbol IS NOT NULL
        ) t
        LEFT JOIN app.user_watchlist w ON w.symbol = t.symbol
        LEFT JOIN app.universe s ON s.symbol = t.symbol
       GROUP BY t.symbol, s.company_name, s.sector, s.industry
    `;
  } catch {
    return empty;
  }

  let vrows: {
    symbol: string; generated_at: Date; verdict: string;
    confidence: "high" | "medium" | "low"; evidence: unknown;
    price_asof: Date | null; anchor_price: number | null;
  }[] = [];
  try {
    vrows = await sql`
      SELECT symbol, generated_at, verdict, confidence, evidence,
             price_asof, anchor_price::float AS anchor_price
        FROM app.stock_verdict
       ORDER BY generated_at DESC
    `;
  } catch {
    return { ...empty, trackedCount: tracked.length };
  }

  const newest = new Map<string, (typeof vrows)[number]>();
  for (const r of vrows) if (!newest.has(r.symbol)) newest.set(r.symbol, r);

  const trackedSet = new Set(tracked.map((t) => t.symbol));
  const verdictSymbols = [...newest.keys()];
  const allSymbols = [...new Set([...trackedSet, ...verdictSymbols])];

  const universeInfo = new Map<string, { company_name: string | null; sector: string | null; industry: string | null }>();
  if (allSymbols.length > 0) {
    try {
      const urows = await sql<{ symbol: string; company_name: string | null; sector: string | null; industry: string | null }[]>`
        SELECT symbol, company_name, sector, industry
          FROM app.universe
         WHERE symbol = ANY(${allSymbols})
      `;
      for (const u of urows) {
        universeInfo.set(u.symbol, { company_name: u.company_name, sector: u.sector, industry: u.industry });
      }
    } catch {
      // fallback
    }
  }

  // Weekly cluster_metrics for the symbols that have a verdict, so drift can be
  // asked of the past and not only of today. Scoped to those symbols because
  // the whole universe × 12 weeks of JSONB is a payload nothing here reads.
  const since = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString().slice(0, 10);
  let hist: { symbol: string; snapshot_date: Date;
              cluster_metrics: Record<string, EvidenceValue> | null }[] = [];
  if (verdictSymbols.length > 0) {
    try {
      hist = await sql`
        SELECT symbol, snapshot_date, cluster_metrics
          FROM app.metrics_snapshot
         WHERE symbol = ANY(${verdictSymbols})
           AND snapshot_date >= ${since}::date
         ORDER BY snapshot_date
      `;
    } catch {
      hist = [];
    }
  }

  const live = new Map<string, Record<string, EvidenceValue>>();
  for (const h of hist) live.set(h.symbol, h.cluster_metrics ?? {}); // last wins = newest

  // One batched golden read for every symbol on the page — tracked ones and
  // dormant ones alike, since both render a move. `latestCloseBySymbol` already
  // swallows a golden outage and returns an empty map, which degrades to "no
  // LTP" rather than to a failed queue.
  const ltps = await latestCloseBySymbol(allSymbols);
  const priceOf = (
    sym: string,
    anchor: number | null,
  ): { anchorPrice: number | null; ltp: number | null; pctMove: number | null } => {
    const ltp = ltps.get(sym) ?? null;
    return {
      anchorPrice: anchor,
      ltp,
      pctMove:
        anchor != null && anchor > 0 && ltp != null ? ((ltp - anchor) / anchor) * 100 : null,
    };
  };

  const parseActionAndThesis = (verdictText: string | null): { action: string | null; thesis: string | null } => {
    if (!verdictText) return { action: null, thesis: null };
    const clean = verdictText.trim();
    const sepIdx = clean.indexOf("—");
    if (sepIdx !== -1) {
      const rawAction = clean.slice(0, sepIdx).trim().toUpperCase();
      const action = rawAction.split(/[\s,]+/)[0];
      const thesis = clean.slice(sepIdx + 1).trim();
      return { action, thesis };
    }
    const match = clean.match(/^([A-Za-z]+)\b/);
    const action = match ? match[1].toUpperCase() : clean.slice(0, 10);
    const thesis = clean.replace(/^[A-Za-z]+[,\s—–-]+/, "").trim();
    return { action, thesis: thesis || null };
  };

  /* ---- entries -------------------------------------------------------- */

  const entries: QueueEntry[] = [];
  const counts: Record<QueueBucket, number> = { missing: 0, due: 0, dormant: 0, current: 0 };

  for (const t of tracked) {
    const v = newest.get(t.symbol);
    const u = universeInfo.get(t.symbol);
    if (!v) {
      entries.push({
        symbol: t.symbol,
        company_name: u?.company_name ?? t.company_name,
        sector: u?.sector ?? t.sector ?? null,
        industry: u?.industry ?? t.industry ?? null,
        bucket: "missing",
        verdict: null,
        action: null,
        thesis: null,
        confidence: null,
        generated_at: null,
        ageDays: null,
        movedCount: 0,
        comparableCount: 0,
        unverifiableCount: 0,
        movedKeys: [],
        addedAt: t.added_at ? t.added_at.toISOString() : null,
        // No verdict means no anchor to move from. LTP is still carried so the
        // row is not blank, and pctMove stays null rather than 0.
        ...priceOf(t.symbol, null),
        priceAsof: null,
      });
      counts.missing++;
      continue;
    }
    const evidence = (v.evidence && typeof v.evidence === "object"
      ? v.evidence : {}) as Record<string, EvidenceValue>;
    const drift = computeDrift(evidence, live.get(t.symbol) ?? {});
    const movedKeys = drift.filter((d) => d.moved).map((d) => d.key);
    const generated_at = v.generated_at.toISOString();
    const ageDays = daysSince(generated_at);
    const bucket: QueueBucket = movedKeys.length > 0 || ageDays > STALE_DAYS ? "due" : "current";
    const parsed = parseActionAndThesis(v.verdict);

    entries.push({
      symbol: t.symbol,
      company_name: u?.company_name ?? t.company_name,
      sector: u?.sector ?? t.sector ?? null,
      industry: u?.industry ?? t.industry ?? null,
      bucket,
      verdict: v.verdict,
      action: parsed.action,
      thesis: parsed.thesis,
      confidence: v.confidence,
      generated_at,
      ageDays,
      movedCount: movedKeys.length,
      comparableCount: drift.filter((d) => d.comparable && !d.liveMissing).length,
      unverifiableCount: drift.filter((d) => d.comparable && d.liveMissing).length,
      movedKeys,
      addedAt: t.added_at ? t.added_at.toISOString() : null,
      ...priceOf(t.symbol, v.anchor_price),
      priceAsof: v.price_asof ? v.price_asof.toISOString().slice(0, 10) : null,
    });
    counts[bucket]++;
  }

  // Dormant: a verdict exists but the symbol is no longer tracked. Kept as
  // history and dropped from the work queue — the row survives, the obligation
  // does not. This is the eviction half the old coverage ledger never had.
  for (const [symbol, v] of newest) {
    if (trackedSet.has(symbol)) continue;
    const generated_at = v.generated_at.toISOString();
    const u = universeInfo.get(symbol);
    const parsed = parseActionAndThesis(v.verdict);

    entries.push({
      symbol,
      company_name: u?.company_name ?? null,
      sector: u?.sector ?? null,
      industry: u?.industry ?? null,
      bucket: "dormant",
      verdict: v.verdict,
      action: parsed.action,
      thesis: parsed.thesis,
      confidence: v.confidence,
      generated_at,
      ageDays: daysSince(generated_at),
      movedCount: 0,
      comparableCount: 0,
      unverifiableCount: 0,
      movedKeys: [],
      addedAt: null,
      ...priceOf(symbol, v.anchor_price),
      priceAsof: v.price_asof ? v.price_asof.toISOString().slice(0, 10) : null,
    });
    counts.dormant++;
  }

  /* ---- timeline ------------------------------------------------------- */

  const byWeek = new Map<string, TimelineWeek>();
  const week = (d: Date): TimelineWeek => {
    const k = weekStartOf(d);
    let w = byWeek.get(k);
    if (!w) {
      w = { weekStart: k, snapshotDate: null, written: [], broke: [], wentStale: [], added: [] };
      byWeek.set(k, w);
    }
    return w;
  };

  const cutoff = new Date(since).getTime();

  for (const r of vrows) {
    if (r.generated_at.getTime() < cutoff) continue;
    week(r.generated_at).written.push(r.symbol);
  }
  for (const t of tracked) {
    if (!t.added_at || t.added_at.getTime() < cutoff) continue;
    week(t.added_at).added.push(t.symbol);
  }

  // The week a verdict crossed STALE_DAYS, where that happened inside the
  // window. Computed rather than stored: a stored "is_stale" flag would need a
  // writer, and nothing writes to this table on a schedule.
  for (const [symbol, v] of newest) {
    const crossed = v.generated_at.getTime() + STALE_DAYS * 86_400_000;
    if (crossed < cutoff || crossed > Date.now()) continue;
    week(new Date(crossed)).wentStale.push(symbol);
  }

  // The week each verdict's evidence first failed. Walk that symbol's weekly
  // snapshots forward from the week it was written; the first one whose drift
  // is non-zero is the answer, and later weeks are not re-reported — a verdict
  // that broke in week 3 and stayed broken is one event, not nine.
  const histBySymbol = new Map<string, typeof hist>();
  for (const h of hist) {
    const arr = histBySymbol.get(h.symbol) ?? [];
    arr.push(h);
    histBySymbol.set(h.symbol, arr);
  }
  for (const [symbol, v] of newest) {
    const evidence = (v.evidence && typeof v.evidence === "object"
      ? v.evidence : {}) as Record<string, EvidenceValue>;
    for (const h of histBySymbol.get(symbol) ?? []) {
      if (h.snapshot_date.getTime() < v.generated_at.getTime()) continue;
      const d = computeDrift(evidence, h.cluster_metrics ?? {});
      if (d.some((x) => x.moved)) {
        const w = week(h.snapshot_date);
        w.snapshotDate = h.snapshot_date.toISOString().slice(0, 10);
        w.broke.push(symbol);
        break;
      }
    }
  }

  // Every week in the window gets a row, including the empty ones. An absent
  // week would read as "nothing happened" and a missing week as the same
  // thing; showing the gap is what makes a quiet month visible as a quiet
  // month rather than as no data.
  const timeline: TimelineWeek[] = [];
  const cursor = new Date(weekStartOf(new Date()));
  for (let i = 0; i < weeks; i++) {
    const k = cursor.toISOString().slice(0, 10);
    timeline.push(
      byWeek.get(k) ??
        { weekStart: k, snapshotDate: null, written: [], broke: [], wentStale: [], added: [] },
    );
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }

  const order: Record<QueueBucket, number> = { due: 0, missing: 1, current: 2, dormant: 3 };
  entries.sort(
    (a, b) =>
      order[a.bucket] - order[b.bucket] ||
      b.movedCount - a.movedCount ||
      (b.ageDays ?? 0) - (a.ageDays ?? 0) ||
      a.symbol.localeCompare(b.symbol),
  );

  return { entries, timeline, counts, trackedCount: tracked.length };
}
