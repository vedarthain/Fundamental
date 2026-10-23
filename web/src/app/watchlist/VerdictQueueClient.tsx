"use client";

/**
 * The watchlist's Verdict tab: a work queue first, a weekly timeline second.
 *
 * WHY A QUEUE RATHER THAN A LIST OF VERDICTS
 *
 * Migration 0086 says it outright — nothing refreshes app.stock_verdict on a
 * schedule. A tab that simply lists the verdicts that exist is therefore a
 * monument to the ones that were written and silent about the ones that are
 * owed, which is CLAUDE.md §5's recurring failure dressed as a feature. So the
 * first thing on the page is what is OUTSTANDING: tracked symbols with no
 * verdict, and verdicts whose evidence has moved or which have aged past the
 * review mark. "Nothing pending" is a state this tab can reach and say, which
 * is the only reason the other states mean anything.
 *
 * WHY THE WEEKLY VIEW TRACKS DRIFT, NOT WRITING
 *
 * Verdicts are hand-written in monthly batches, so a chart of writing activity
 * is three empty weeks out of four — a panel blank by design and read as
 * broken. app.metrics_snapshot, by contrast, is written weekly, so each week's
 * metrics can be compared against the frozen evidence to find the week a
 * verdict's argument first stopped matching the data. That column moves every
 * week and is worth reading. The writing batches sit on the same line so a
 * quiet stretch is visibly a quiet stretch rather than missing data.
 *
 * WHY ONE ROW OF CHIPS AND NOT TWO AXES
 *
 * This tab used to open on a "By status" / "By call" toggle. It was two
 * controls over one set of rows, and it did not survive being explained: the
 * call groups and the status buckets are the SAME 146 live verdicts cut two
 * ways, plus two populations only the status cut could show (160 tracked
 * symbols never written about, 133 dormant verdicts). The two totals therefore
 * disagreed by design — 439 against 146 — and the reader had to choose an axis
 * before seeing any count at all.
 *
 * So the toggle is gone and the chips are concatenated: the calls, a thin
 * rule, then "Needs revisiting", "Never written" and "Dormant". Nothing was
 * dropped. What this deliberately refuses is the obvious simplification —
 * keeping ONLY the calls. A list of what was written, with no row for the 160
 * never written, is CLAUDE.md §5 as a feature: a monument to the work that
 * happened, silent about the work that is owed. The owed buckets stay on the
 * row precisely because they are the ones that generate an action.
 *
 * WHY EVERY GROUP CARRIES THE DRIFT MARKER
 *
 * A list grouped under a BUY heading is the single easiest place in this whole
 * feature to misread a stale call as a current one — the heading asserts a
 * position and the row says nothing about whether the argument behind it still
 * holds. That is precisely the failure the drift machinery exists to catch, so
 * a call group is the same rows and the same "what moved" column as a status
 * bucket, and drifted rows sort to the top of their own group rather than
 * sitting in symbol order among the ones that still stand. One EntryRow serves
 * both, so neither can drift from the other.
 */

import { useEffect, useMemo, useState } from "react";
import { VerdictSheet } from "@/components/VerdictSheet";
import { BUCKET_COLOR, STALE_DAYS, verdictBucket, type QueueBucket } from "@/lib/verdictTypes";
import type { QueueEntry, TimelineWeek, VerdictQueue } from "@/lib/verdict";

const BUCKET_META: Record<QueueBucket, { label: string; color: string; blurb: string }> = {
  due: {
    label: "Needs revisiting",
    color: "var(--color-delta-down)",
    blurb:
      "The figures these were written against have moved, or they are past the review mark. Drift is the stronger signal of the two.",
  },
  missing: {
    label: "No verdict yet",
    color: "var(--color-score-mid, #d4951a)",
    blurb:
      "Tracked on the watchlist or held in the portfolio, and never written about. Build the evidence pack with scripts/verdict-evidence.py.",
  },
  current: {
    label: "Still standing",
    color: "var(--color-delta-up)",
    blurb:
      "Written recently enough and no stored figure has moved materially. Nothing to do.",
  },
  dormant: {
    label: "Dormant",
    color: "var(--color-muted)",
    blurb:
      "A verdict exists but the symbol is no longer tracked. The row is kept as history and dropped from the queue — this is the eviction the old coverage ledger never had.",
  },
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Rupees, two decimals, grouped Indian-style. No ₹ symbol in the cell — the
 *  column header carries the unit once and three prices per row with a glyph
 *  each is noise. Two decimals rather than zero because several names in this
 *  book trade under ₹20, where rounding to the rupee makes a real move look
 *  like none. */
function inr(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------- by call */

/**
 * The call itself, which is the first word of the label.
 *
 * Deliberately NOT `verdictBucket()`. That collapses ACCUMULATE into "buy" and
 * REDUCE/AVOID into "sell" because it exists to pick a colour, and four colours
 * is the right number for a chip. But "accumulate" and "buy" are different
 * instructions to a person holding cash, and flattening them here would answer
 * the question this view was added to answer with a coarser one. The bucket is
 * still used — for the colour, which is all it was ever for.
 *
 * MATCH LETTERS, DO NOT SPLIT ON SEPARATORS. The first version split on
 * whitespace and dashes, which quietly left trailing punctuation attached: of
 * the 146 live verdicts in prod on 2026-10-21, five are headed "HOLD, do not
 * add" or "HOLD, on watch" and two "ACCUMULATE, small", so the view rendered
 * `HOLD,` and `ACCUMULATE,` as two extra headings — HOLD read 64 instead of
 * 69 and ACCUMULATE 20 instead of 22, across 9 groups instead of 7. Nothing
 * errored; the book simply looked different from what had been written. Taking
 * the leading run of letters cannot reintroduce it, because every call in
 * CALL_ORDER is one word and anything after that word is commentary.
 */
function callOf(verdict: string): string {
  return (verdict.trim().match(/^[A-Za-z]+/)?.[0] ?? "").toUpperCase().slice(0, 12);
}

/** Strongest conviction first, in both directions from HOLD. Anything the
 *  report invents that is not on this list sorts after it, alphabetically,
 *  rather than being dropped — an unrecognised call is still a call. */
const CALL_ORDER = [
  "BUY", "ACCUMULATE", "HOLD", "WATCH", "SPECULATIVE", "REDUCE", "SELL", "AVOID",
];

/** Drifted first, then stale, then oldest. A BUY whose evidence has moved is
 *  the row in this view most likely to be acted on wrongly, so it goes on top
 *  of its own group rather than wherever the alphabet puts it. */
function byUrgency(a: QueueEntry, b: QueueEntry): number {
  const d = (e: QueueEntry) => (e.movedCount > 0 ? 0 : (e.ageDays ?? 0) > STALE_DAYS ? 1 : 2);
  return d(a) - d(b) || (b.ageDays ?? 0) - (a.ageDays ?? 0) || a.symbol.localeCompare(b.symbol);
}

/* ------------------------------------------------------------- sorting */

type SortKey = "urgency" | "pctMove" | "ltp";

/**
 * Sorting the visible rows by price — with urgency as the default and as a
 * state the reader can always get back to.
 *
 * WHY URGENCY REMAINS THE DEFAULT. The file header's premise is that a call
 * group is "the same rows and the same what-moved column as a status bucket,
 * and drifted rows sort to the top of their own group". A price sort breaks
 * precisely that: the largest move and the broken argument are different
 * facts, and a BUY whose evidence has moved can land anywhere in a price
 * ranking, including off the bottom of a long group. So the price sorts are
 * opt-in, the active one is named in the header, and a third click on the
 * same column returns to urgency rather than cycling between two price orders
 * forever. The order that reflects the work is never more than one click away.
 *
 * NULLS SINK IN BOTH DIRECTIONS. A missing LTP is golden having no bar; a
 * missing pctMove is a verdict with no anchor (migration 0087 — "render it as
 * absent, never as zero"). Coercing either to 0 would file a stock we cannot
 * price among the flat ones, which is the one place a reader would not think
 * to look for it. They go last ascending and last descending alike.
 */
function bySort(key: Exclude<SortKey, "urgency">, dir: 1 | -1) {
  return (a: QueueEntry, b: QueueEntry): number => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return a.symbol.localeCompare(b.symbol);
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir * (av - bv) || a.symbol.localeCompare(b.symbol);
  };
}

export function VerdictQueueClient() {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ok"; q: VerdictQueue } | { kind: "error"; msg: string }
  >({ kind: "loading" });
  const [open, setOpen] = useState<string | null>(null);
  // ONE selection, not an axis plus a bucket. The tab used to have a "By
  // status" / "By call" toggle, which was two controls over one set of rows:
  // the call groups and the status buckets are the same 146 live verdicts cut
  // two ways, plus two populations (never-written, dormant) that only one cut
  // could show. A reader had to pick an axis before they could see a count,
  // and the two totals disagreed by design — 439 against 146 — with nothing on
  // screen explaining why. Collapsing to a single row of chips removes the
  // choice without removing a row: the calls are chips, and "Needs revisiting",
  // "Never written" and "Dormant" are three more chips beside them.
  //
  // `sel` is a call name (from CALL_ORDER or anything a report invents) OR a
  // QueueBucket. They cannot collide: buckets are lowercase, calls are
  // upper-cased by callOf().
  const [sel, setSel] = useState<string>("due");
  // Default descending because the question a price sort is opened to answer
  // is "what has run the hardest since I wrote this", not "what has fallen".
  // One click on the other column, or a third on this one, gets the rest.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "urgency", dir: -1 });

  useEffect(() => {
    let live = true;
    fetch("/api/admin/verdict?queue=1", { cache: "no-store" })
      .then(async (r) => {
        if (!live) return;
        if (r.status === 401) {
          setState({
            kind: "error",
            msg: "Verdicts are admin-only and this session is not an admin session.",
          });
          return;
        }
        if (!r.ok) {
          setState({ kind: "error", msg: `The queue request failed (${r.status}).` });
          return;
        }
        setState({ kind: "ok", q: (await r.json()) as VerdictQueue });
      })
      .catch(() => {
        if (live) setState({ kind: "error", msg: "The queue request did not complete." });
      });
    return () => {
      live = false;
    };
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<QueueBucket, QueueEntry[]>();
    if (state.kind !== "ok") return m;
    for (const e of state.q.entries) {
      const a = m.get(e.bucket) ?? [];
      a.push(e);
      m.set(e.bucket, a);
    }
    return m;
  }, [state]);

  /**
   * Every live verdict, grouped by the call it makes.
   *
   * Dormant verdicts are excluded. A symbol that is no longer on the watchlist
   * or in the portfolio still has a row in app.stock_verdict as history, and
   * listing it under "BUY" would be this tab asserting a position on something
   * that is not being tracked — the same stale-row-presented-as-current
   * failure the dormant bucket was added to prevent. They remain reachable
   * under the Dormant chip, which is beside the calls rather than behind a
   * toggle, so nothing here is unreachable.
   */
  const byCall = useMemo(() => {
    const m = new Map<string, QueueEntry[]>();
    if (state.kind !== "ok") return [] as { call: string; rows: QueueEntry[] }[];
    for (const e of state.q.entries) {
      if (!e.verdict || e.bucket === "dormant") continue;
      const c = callOf(e.verdict);
      const a = m.get(c) ?? [];
      a.push(e);
      m.set(c, a);
    }
    return [...m.entries()]
      .map(([call, rows]) => ({ call, rows: rows.slice().sort(byUrgency) }))
      .sort((a, b) => {
        const ia = CALL_ORDER.indexOf(a.call);
        const ib = CALL_ORDER.indexOf(b.call);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        return a.call.localeCompare(b.call);
      });
  }, [state]);

  if (state.kind === "loading") {
    return <div className="py-10 text-center text-[13px] muted-text">Reading the queue…</div>;
  }
  if (state.kind === "error") {
    return (
      <div
        className="rounded-lg border-l-4 px-4 py-3 text-[13px] max-w-[640px]"
        style={{ borderLeftColor: "var(--color-delta-down)" }}
      >
        <span className="font-semibold ink-text">Could not load the queue.</span>{" "}
        <span className="muted-text">{state.msg}</span>
      </div>
    );
  }

  const { counts, trackedCount, timeline } = state.q;

  // THE ACTION CHIPS, in one row and one order: what you have said, then what
  // you owe. Calls first because they are the reason to open the tab; the two
  // work buckets last because they are where the tab sends you next. Dormant
  // sits at the end, muted — it is history, not work, and dropping it would
  // make 133 verdicts unreachable from this page.
  const callChips = byCall.map((g) => ({
    key: g.call,
    label: g.call,
    count: g.rows.length,
    color: BUCKET_COLOR[verdictBucket(g.call)],
    rows: g.rows,
  }));
  const workChips = (["due", "missing", "dormant"] as QueueBucket[]).map((b) => ({
    key: b,
    label: BUCKET_META[b].label,
    count: counts[b],
    color: BUCKET_META[b].color,
    rows: (grouped.get(b) ?? []).slice().sort(byUrgency),
  }));
  const chips = [...callChips, ...workChips];

  // Re-resolve the selection against the live chip list every render. A call
  // group empties out the moment the last verdict under it is rewritten, and a
  // stale `sel` would leave a blank panel with a chip still highlighted.
  const active = chips.find((c) => c.key === sel) ?? chips[0];
  // `active.rows` is already urgency-sorted; a price sort replaces that order
  // rather than layering on it, and copies first so the chip's own array is
  // not mutated under React.
  const rows =
    sort.key === "urgency"
      ? (active?.rows ?? [])
      : (active?.rows ?? []).slice().sort(bySort(sort.key, sort.dir));
  /** Click: new column → descending. Same column → flip, then back to urgency. */
  const onSort = (key: Exclude<SortKey, "urgency">) =>
    setSort((s) =>
      s.key !== key
        ? { key, dir: -1 }
        : s.dir === -1
          ? { key, dir: 1 }
          : { key: "urgency", dir: -1 },
    );
  const sortArrow = (key: SortKey) =>
    sort.key !== key ? "" : sort.dir === -1 ? " ↓" : " ↑";
  const isMissing = active?.key === "missing";
  // The whole book, counted once: every live verdict plus everything owed.
  const liveVerdicts = counts.due + counts.current;

  // THIS MONTH'S PROGRESS, against the tracked universe and nothing else.
  //
  // Counted from the entries on screen rather than with a COUNT(*) over
  // app.stock_verdict, because the obvious query overstates the work in two
  // ways at once and both are invisible in the total: on 2026-10-22 the table
  // held 283 rows written this month, but 4 of those were rewrites of a symbol
  // already covered and 133 were about symbols no longer tracked. "283 done"
  // would have been a number that only ever goes up — the celebratory count
  // this tab exists not to produce. 146 of 306 is the one that decides whether
  // the month is finished.
  //
  // Only tracked buckets are summed; `dormant` is deliberately absent.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const writtenThisMonth = state.q.entries.filter(
    (e) =>
      e.bucket !== "dormant" &&
      e.generated_at != null &&
      new Date(e.generated_at) >= monthStart,
  ).length;
  const monthLabel = monthStart.toLocaleDateString("en-IN", { month: "long" });
  // What is owed: tracked symbols with no verdict, plus verdicts that have
  // drifted or aged out. Deliberately excludes `dormant` — those are verdicts
  // about symbols no longer tracked, so no work is owed on them.
  const pending = counts.missing + counts.due;

  return (
    <div className="space-y-5">
      <div
        className="rounded-lg border px-4 py-3 text-[12.5px] leading-relaxed max-w-[860px]"
        style={{ borderColor: "var(--color-border-default)", background: "var(--color-paper)" }}
      >
        {/* PENDING, FIRST AND IN COLOUR. The tab's whole premise (see the file
            header) is that it reports what is owed, but the outstanding figure
            was only ever legible by adding two chips together. Pending is
            missing + due — the one number that decides whether this month's
            batch is finished — so it is stated here, above the chips, where it
            is true regardless of which chip is selected. */}
        <span className="font-semibold ink-text">Private.</span>{" "}
        <span className="muted-text">
          {trackedCount} symbols tracked across the watchlist and portfolio.{" "}
          <b className="ink-text tabular-nums">
            {writtenThisMonth} of {trackedCount}
          </b>{" "}
          written this {monthLabel}.{" "}
        </span>
        {pending > 0 ? (
          <span className="font-semibold" style={{ color: "var(--color-delta-down)" }}>
            {pending} pending a verdict
          </span>
        ) : (
          <span className="font-semibold" style={{ color: "var(--color-delta-up)" }}>
            Nothing pending
          </span>
        )}
        <span className="muted-text">
          {pending > 0 ? (
            <>
              {" "}
              — {counts.missing} never written, {counts.due} to revisit (drifted, or older than the{" "}
              {STALE_DAYS}-day review mark).{" "}
            </>
          ) : (
            <> — every tracked symbol has a verdict inside the review window. </>
          )}
          Verdicts are hand-written, nothing generates them on a schedule, and this tab exists to
          say what is owed rather than to celebrate what was written.
        </span>
      </div>

      {/* One row of chips. Calls, then work. See `sel` above for why there is
          no longer an axis toggle in front of this. */}
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c, i) => {
          const on = active?.key === c.key;
          const muted = c.key === "dormant";
          return (
            <span key={c.key} className="contents">
              {/* A thin rule where the calls end and the work begins, so the
                  row reads as two things rather than eleven equal buttons. */}
              {i === callChips.length && (
                <span
                  aria-hidden
                  className="self-stretch w-px mx-1"
                  style={{ background: "var(--color-border-default)" }}
                />
              )}
              <button
                type="button"
                onClick={() => setSel(c.key)}
                aria-pressed={on}
                className="px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors"
                style={{
                  borderColor: on ? c.color : "var(--color-border-default)",
                  color: on ? "#fff" : "var(--color-muted)",
                  background: on ? c.color : "transparent",
                  opacity: muted && !on ? 0.65 : 1,
                }}
              >
                {c.label}
                <span className="ml-1.5 tabular-nums opacity-80">{c.count}</span>
              </button>
            </span>
          );
        })}
      </div>

      {/* What the row adds up to, and what the selected chip means. Both
          sentences exist because a chip count on its own is ambiguous: 69 HOLD
          is a share of something, and the reader cannot see of what. */}
      <p className="text-[12px] muted-text max-w-[800px] leading-relaxed -mt-2">
        <b className="ink-text tabular-nums">{liveVerdicts} live verdicts</b> across{" "}
        {callChips.length} calls, and <b className="ink-text tabular-nums">{counts.missing}</b>{" "}
        tracked symbols never written about. The {counts.dormant} dormant rows are verdicts on
        symbols you no longer track — kept as history, not counted as work.
        <br />
        {BUCKET_META[active?.key as QueueBucket]?.blurb ??
          "Every verdict making this call. Drifted and stale rows sort to the top — a heading is not evidence, so read the Move and What-moved columns before acting on one."}
        {/* Said out loud, because a price sort silently suspends the one
            ordering this tab's premise rests on: drifted rows no longer sit at
            the top, and nothing else on screen would tell you that. */}
        {sort.key !== "urgency" && (
          <>
            {" "}
            <span style={{ color: "var(--color-score-mid, #d4951a)" }}>
              Sorted by {sort.key === "ltp" ? "LTP" : "move"},{" "}
              {sort.dir === -1 ? "high to low" : "low to high"} — drifted rows are no longer on
              top.
            </span>{" "}
            <button
              type="button"
              onClick={() => setSort({ key: "urgency", dir: -1 })}
              className="underline underline-offset-2"
            >
              Back to urgency
            </button>
          </>
        )}
      </p>

      {rows.length === 0 ? (
        /* An explicit empty state per bucket. "Nothing is due" is a real and
           useful answer; a blank area is indistinguishable from a failure. */
        <div
          className="rounded-lg border px-4 py-6 text-center text-[13px] muted-text"
          style={{ borderColor: "var(--color-border-default)" }}
        >
          Nothing in {(active?.label ?? "this group").toLowerCase()}.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[880px]">
            <thead>
              <tr className="muted-text">
                <th className="text-left py-1.5 pr-3 font-medium">Symbol</th>
                <th className="text-left py-1.5 px-3 font-medium">Verdict</th>
                <th className="text-right py-1.5 px-3 font-medium">Written</th>
                <th className="text-right py-1.5 px-3 font-medium">Age</th>
                <th className="text-right py-1.5 px-3 font-medium" title="Close on the verdict's price_asof date, frozen at load time">
                  At verdict
                </th>
                <th className="text-right py-1.5 px-3 font-medium">
                  <button
                    type="button"
                    onClick={() => onSort("ltp")}
                    className="hover:underline underline-offset-2"
                    style={sort.key === "ltp" ? { color: "var(--color-ink)" } : undefined}
                    title="Sort by last traded price. Click again to reverse, a third time to return to urgency order."
                  >
                    LTP{sortArrow("ltp")}
                  </button>
                </th>
                <th className="text-right py-1.5 px-3 font-medium">
                  <button
                    type="button"
                    onClick={() => onSort("pctMove")}
                    className="hover:underline underline-offset-2"
                    style={sort.key === "pctMove" ? { color: "var(--color-ink)" } : undefined}
                    title="Sort by move since the verdict's anchor price. Click again to reverse, a third time to return to urgency order."
                  >
                    Move{sortArrow("pctMove")}
                  </button>
                </th>
                <th className="text-left py-1.5 pl-3 font-medium">
                  {isMissing ? "Tracked since" : "What moved"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <EntryRow
                  key={e.symbol}
                  e={e}
                  lastCol={isMissing ? "added" : "moved"}
                  onOpen={setOpen}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Timeline weeks={timeline} onOpen={setOpen} />

      {open && <VerdictSheet symbol={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------- one row */

/**
 * One queue row, used by both axes.
 *
 * Shared rather than copied because the last column encodes the whole point of
 * the feature — what moved, what could not be checked, what is merely
 * unchanged — and a second copy of that rule under the "By call" heading would
 * be free to drift from this one. CLAUDE.md §4, the watchlist buy marker.
 */
function EntryRow({
  e,
  lastCol,
  onOpen,
}: {
  e: QueueEntry;
  lastCol: "added" | "moved";
  onOpen: (s: string) => void;
}) {
  return (
    <tr
      style={{ borderTop: "1px solid var(--color-border-default)" }}
      className="hover:bg-[var(--color-paper)]"
    >
      <td className="py-1.5 pr-3">
        <button
          type="button"
          onClick={() => onOpen(e.symbol)}
          className="font-semibold underline-offset-2 hover:underline"
        >
          {e.symbol}
        </button>
        {e.company_name && (
          <div className="text-[11px] muted-text truncate max-w-[220px]">{e.company_name}</div>
        )}
      </td>
      <td className="py-1.5 px-3">
        {e.verdict ?? <span className="muted-text">—</span>}
        {e.confidence && <span className="muted-text"> · {e.confidence}</span>}
      </td>
      <td className="py-1.5 px-3 text-right tabular-nums muted-text">
        {e.generated_at ? shortDate(e.generated_at) : "—"}
      </td>
      <td
        className="py-1.5 px-3 text-right tabular-nums"
        style={
          e.ageDays != null && e.ageDays > STALE_DAYS
            ? { color: "var(--color-score-mid, #d4951a)" }
            : { color: "var(--color-muted)" }
        }
      >
        {e.ageDays != null ? `${e.ageDays}d` : "—"}
      </td>
      {/* PRICE SINCE THE VERDICT. Three cells, not one: the anchor, today, and
          the move. The move alone would be the only number a reader needs and
          the only one they could not check — "+18%" with nothing to divide
          tells you whether to feel good, not whether it is true. The anchor
          carries its own date for the same reason the evidence column names
          the keys that moved.
          The anchor is NOT recomputed client-side from a price series: it is
          app.stock_verdict.anchor_price, frozen when the verdict loaded,
          because golden.price_history is split-back-adjusted and a derived
          anchor would quietly restate this move after a bonus issue. See
          db/migrations/0087. */}
      <td className="py-1.5 px-3 text-right tabular-nums muted-text whitespace-nowrap">
        {e.anchorPrice != null ? (
          <>
            {inr(e.anchorPrice)}
            {e.priceAsof && (
              <div className="text-[10.5px] opacity-70">{shortDate(e.priceAsof)}</div>
            )}
          </>
        ) : (
          <span title="No close in golden on or before the verdict's price_asof date">—</span>
        )}
      </td>
      <td className="py-1.5 px-3 text-right tabular-nums muted-text">
        {e.ltp != null ? inr(e.ltp) : "—"}
      </td>
      <td
        className="py-1.5 px-3 text-right tabular-nums font-medium"
        style={{
          color:
            e.pctMove == null
              ? "var(--color-muted)"
              : e.pctMove >= 0
                ? "var(--color-delta-up)"
                : "var(--color-delta-down)",
        }}
      >
        {e.pctMove != null ? `${e.pctMove >= 0 ? "+" : ""}${e.pctMove.toFixed(1)}%` : "—"}
      </td>
      <td className="py-1.5 pl-3">
        {lastCol === "added" ? (
          <span className="muted-text">{e.addedAt ? shortDate(e.addedAt) : "—"}</span>
        ) : e.movedKeys.length > 0 ? (
          <span style={{ color: "var(--color-delta-down)" }}>
            {e.movedKeys.slice(0, 4).map((k) => k.replace(/_/g, " ")).join(", ")}
            {e.movedKeys.length > 4 && ` +${e.movedKeys.length - 4}`}
          </span>
        ) : e.comparableCount === 0 ? (
          <span
            style={
              e.unverifiableCount > 0 ? { color: "var(--color-score-mid, #d4951a)" } : undefined
            }
            className={e.unverifiableCount > 0 ? "" : "muted-text"}
          >
            {e.unverifiableCount > 0
              ? `${e.unverifiableCount} not computed this snapshot`
              : "nothing recheckable"}
          </span>
        ) : (
          <span className="muted-text">
            {e.comparableCount} unchanged
            {e.unverifiableCount > 0 && `, ${e.unverifiableCount} unverified`}
          </span>
        )}
      </td>
    </tr>
  );
}

/* ---------------------------------------------------------------- weekly */

function Timeline({
  weeks,
  onOpen,
}: {
  weeks: TimelineWeek[];
  onOpen: (s: string) => void;
}) {
  const anything = weeks.some(
    (w) => w.written.length || w.broke.length || w.wentStale.length || w.added.length,
  );

  return (
    <div
      className="rounded-lg border p-4 max-w-[900px]"
      style={{ borderColor: "var(--color-border-default)", background: "var(--color-paper)" }}
    >
      <div className="text-[13px] font-semibold ink-text">Week by week</div>
      <p className="mt-1 mb-3 text-[12px] muted-text leading-relaxed">
        The metrics snapshot is written weekly, so each week&apos;s values can be compared against
        the evidence a verdict froze. <b>Broke</b> is the week a verdict&apos;s argument first
        stopped matching the data — reported once, not every week after. Writing batches are
        marked for context; they are monthly by nature, so most weeks are legitimately empty.
      </p>

      {!anything ? (
        <div className="text-[12.5px] muted-text py-3">
          Nothing happened in this window — no verdicts written, none drifted, none aged past the
          mark, no symbols added. That is a quiet stretch, not missing data.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[560px]">
            <thead>
              <tr className="muted-text">
                <th className="text-left py-1.5 pr-3 font-medium">Week of</th>
                <th className="text-left py-1.5 px-3 font-medium">Written</th>
                <th className="text-left py-1.5 px-3 font-medium">Broke</th>
                <th className="text-left py-1.5 px-3 font-medium">Went stale</th>
                <th className="text-left py-1.5 pl-3 font-medium">Added to watchlist</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => {
                const quiet =
                  !w.written.length && !w.broke.length && !w.wentStale.length && !w.added.length;
                return (
                  <tr
                    key={w.weekStart}
                    style={{ borderTop: "1px solid var(--color-border-default)" }}
                  >
                    <td className="py-1.5 pr-3 tabular-nums muted-text whitespace-nowrap">
                      {shortDate(w.weekStart)}
                    </td>
                    {quiet ? (
                      <td className="py-1.5 px-3 muted-text" colSpan={4}>
                        —
                      </td>
                    ) : (
                      <>
                        <Cell syms={w.written} onOpen={onOpen} />
                        <Cell syms={w.broke} onOpen={onOpen} color="var(--color-delta-down)" />
                        <Cell
                          syms={w.wentStale}
                          onOpen={onOpen}
                          color="var(--color-score-mid, #d4951a)"
                        />
                        <Cell syms={w.added} onOpen={onOpen} />
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Cell({
  syms,
  onOpen,
  color,
}: {
  syms: string[];
  onOpen: (s: string) => void;
  color?: string;
}) {
  if (syms.length === 0) return <td className="py-1.5 px-3 muted-text">—</td>;
  const shown = syms.slice(0, 5);
  return (
    <td className="py-1.5 px-3" style={color ? { color } : undefined}>
      <span className="tabular-nums font-medium">{syms.length}</span>{" "}
      <span className="muted-text">
        {shown.map((s, i) => (
          <span key={s}>
            {i > 0 && ", "}
            <button
              type="button"
              onClick={() => onOpen(s)}
              className="underline-offset-2 hover:underline"
            >
              {s}
            </button>
          </span>
        ))}
        {syms.length > shown.length && ` +${syms.length - shown.length}`}
      </span>
    </td>
  );
}
