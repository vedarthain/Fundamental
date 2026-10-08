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
 * WHY "BY CALL" CARRIES THE DRIFT MARKER TOO
 *
 * A list grouped under a BUY heading is the single easiest place in this whole
 * feature to misread a stale call as a current one — the heading asserts a
 * position and the row says nothing about whether the argument behind it still
 * holds. That is precisely the failure the drift machinery exists to catch, so
 * the by-call view is the same rows with the same "what moved" column, and
 * drifted rows sort to the top of their own group rather than sitting in
 * symbol order among the ones that still stand. Without that it would be a
 * view that quietly argues with the rest of the tab.
 */

import { useEffect, useMemo, useState } from "react";
import { VerdictSheet } from "@/components/VerdictSheet";
import { BUCKET_COLOR, verdictBucket, type QueueBucket } from "@/lib/verdictTypes";
import type { QueueEntry, TimelineWeek, VerdictQueue } from "@/lib/verdict";

const BUCKET_META: Record<QueueBucket, { label: string; color: string; blurb: string }> = {
  due: {
    label: "Needs revisiting",
    color: "var(--color-delta-down)",
    blurb:
      "The figures these were written against have moved, or they are past the 45-day review mark. Drift is the stronger signal of the two.",
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

const ORDER: QueueBucket[] = ["due", "missing", "current", "dormant"];

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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
 */
function callOf(verdict: string): string {
  return verdict.split(/[\s—–-]+/)[0].toUpperCase().slice(0, 12);
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
  const d = (e: QueueEntry) => (e.movedCount > 0 ? 0 : (e.ageDays ?? 0) > 45 ? 1 : 2);
  return d(a) - d(b) || (b.ageDays ?? 0) - (a.ageDays ?? 0) || a.symbol.localeCompare(b.symbol);
}

export function VerdictQueueClient() {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ok"; q: VerdictQueue } | { kind: "error"; msg: string }
  >({ kind: "loading" });
  const [open, setOpen] = useState<string | null>(null);
  const [show, setShow] = useState<QueueBucket>("due");
  const [axis, setAxis] = useState<"status" | "call">("status");

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
   * under Dormant on the status axis.
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
  const rows = grouped.get(show) ?? [];

  return (
    <div className="space-y-5">
      <div
        className="rounded-lg border px-4 py-3 text-[12.5px] leading-relaxed max-w-[860px]"
        style={{ borderColor: "var(--color-border-default)", background: "var(--color-paper)" }}
      >
        <span className="font-semibold ink-text">Private.</span>{" "}
        <span className="muted-text">
          {trackedCount} symbols tracked across the watchlist and portfolio. Verdicts are
          hand-written, nothing generates them on a schedule, and this tab exists to say what is
          owed rather than to celebrate what was written.
        </span>
      </div>

      {/* Axis toggle. Two ways of cutting the same rows: what is owed, and
          what has been called. The queue stays the default — this tab is a
          work list before it is a report, and opening on "By call" would put
          the celebratory view first, which is how §5's monument gets built. */}
      <div className="flex gap-1.5 text-[12px]">
        {(["status", "call"] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAxis(a)}
            aria-pressed={axis === a}
            className="px-2.5 py-1 rounded-md font-medium border transition-colors"
            style={{
              borderColor: axis === a ? "var(--color-accent-600)" : "var(--color-border-default)",
              color: axis === a ? "var(--color-accent-600)" : "var(--color-muted)",
              background:
                axis === a
                  ? "color-mix(in srgb, var(--color-accent-600) 10%, transparent)"
                  : "transparent",
            }}
          >
            {a === "status" ? "By status" : "By call"}
          </button>
        ))}
      </div>

      {axis === "call" ? (
        <ByCall groups={byCall} onOpen={setOpen} />
      ) : (
      <>
      {/* Bucket switcher. Counts live on the control so the shape of the
          backlog is visible without selecting each one in turn. */}
      <div className="flex flex-wrap gap-1.5">
        {ORDER.map((b) => {
          const meta = BUCKET_META[b];
          const active = show === b;
          return (
            <button
              key={b}
              type="button"
              onClick={() => setShow(b)}
              aria-pressed={active}
              className="px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors"
              style={{
                borderColor: active ? meta.color : "var(--color-border-default)",
                color: active ? "#fff" : "var(--color-muted)",
                background: active ? meta.color : "transparent",
              }}
            >
              {meta.label}
              <span className="ml-1.5 tabular-nums opacity-80">{counts[b]}</span>
            </button>
          );
        })}
      </div>

      <p className="text-[12px] muted-text max-w-[760px] leading-relaxed -mt-2">
        {BUCKET_META[show].blurb}
      </p>

      {rows.length === 0 ? (
        /* An explicit empty state per bucket. "Nothing is due" is a real and
           useful answer; a blank area is indistinguishable from a failure. */
        <div
          className="rounded-lg border px-4 py-6 text-center text-[13px] muted-text"
          style={{ borderColor: "var(--color-border-default)" }}
        >
          Nothing in {BUCKET_META[show].label.toLowerCase()}.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[680px]">
            <thead>
              <tr className="muted-text">
                <th className="text-left py-1.5 pr-3 font-medium">Symbol</th>
                <th className="text-left py-1.5 px-3 font-medium">Verdict</th>
                <th className="text-right py-1.5 px-3 font-medium">Written</th>
                <th className="text-right py-1.5 px-3 font-medium">Age</th>
                <th className="text-left py-1.5 pl-3 font-medium">
                  {show === "missing" ? "Tracked since" : "What moved"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <EntryRow
                  key={e.symbol}
                  e={e}
                  lastCol={show === "missing" ? "added" : "moved"}
                  onOpen={setOpen}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>
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
          e.ageDays != null && e.ageDays > 45
            ? { color: "var(--color-score-mid, #d4951a)" }
            : { color: "var(--color-muted)" }
        }
      >
        {e.ageDays != null ? `${e.ageDays}d` : "—"}
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

/* ------------------------------------------------------------- by call */

function ByCall({
  groups,
  onOpen,
}: {
  groups: { call: string; rows: QueueEntry[] }[];
  onOpen: (s: string) => void;
}) {
  // The selected call, as a NAME rather than an index. Indices break the
  // moment a group empties out — write one more AVOID and index 2 silently
  // becomes a different call under a tab the reader already had open. The
  // fallback below re-resolves against the live group list every render, so a
  // call that disappears lands on the strongest remaining one instead of a
  // blank panel.
  //
  // Declared ABOVE the empty-state return, not next to the code that uses it:
  // the queue arrives asynchronously, so `groups` really does go 0 -> n on a
  // normal load. A hook after that early return would be skipped on the first
  // render and present on the second, which is the "rendered more hooks than
  // during the previous render" crash, not a style nit.
  const [sel, setSel] = useState<string | null>(null);

  if (groups.length === 0) {
    return (
      <div
        className="rounded-lg border px-4 py-6 text-center text-[13px] muted-text"
        style={{ borderColor: "var(--color-border-default)" }}
      >
        No verdicts have been written yet, so there are no calls to group.
      </div>
    );
  }

  const drifted = groups.reduce(
    (n, g) => n + g.rows.filter((r) => r.movedCount > 0 || (r.ageDays ?? 0) > 45).length,
    0,
  );

  const active = groups.find((g) => g.call === sel) ?? groups[0];

  return (
    <div className="space-y-4">
      <p className="text-[12px] muted-text max-w-[760px] leading-relaxed -mt-2">
        Every live verdict, one call at a time.{" "}
        {drifted > 0 ? (
          <>
            <b style={{ color: "var(--color-delta-down)" }}>{drifted}</b> of them were written
            against figures that have since moved or are past the review mark; those sit at the top
            of their tab. A heading is not evidence — read the last column before acting on one.
          </>
        ) : (
          <>
            Nothing here has drifted or aged past the review mark, so every call still rests on the
            figures it was written against.
          </>
        )}{" "}
        Dormant verdicts — symbols no longer tracked — are left out; they are under By status.
      </p>

      {/* One tab per call, strongest conviction leftmost (CALL_ORDER). The
          count stays ON the tab: separating the calls hides the shape of the
          book, and a BUY tab of 1 next to a HOLD tab of 18 is the single most
          useful thing this view says. Each tab is tinted with its own bucket
          colour so the direction of a call is readable before it is selected —
          an unselected grey "AVOID" next to a grey "BUY" is a strip of words. */}
      <div className="flex flex-wrap gap-1.5">
        {groups.map((g) => {
          const color = BUCKET_COLOR[verdictBucket(g.call)];
          const on = g.call === active.call;
          return (
            <button
              key={g.call}
              type="button"
              onClick={() => setSel(g.call)}
              aria-pressed={on}
              className="px-2.5 py-1 rounded-md text-[11.5px] font-semibold tracking-wide border transition-colors"
              style={{
                color,
                borderColor: on
                  ? color
                  : `color-mix(in srgb, ${color} 30%, transparent)`,
                background: on
                  ? `color-mix(in srgb, ${color} 16%, transparent)`
                  : "transparent",
                opacity: on ? 1 : 0.72,
              }}
            >
              {g.call}
              <span className="ml-1.5 tabular-nums font-medium opacity-80">{g.rows.length}</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[680px]">
          <thead>
            <tr className="muted-text">
              <th className="text-left py-1.5 pr-3 font-medium">Symbol</th>
              <th className="text-left py-1.5 px-3 font-medium">Verdict</th>
              <th className="text-right py-1.5 px-3 font-medium">Written</th>
              <th className="text-right py-1.5 px-3 font-medium">Age</th>
              <th className="text-left py-1.5 pl-3 font-medium">What moved</th>
            </tr>
          </thead>
          <tbody>
            {active.rows.map((e) => (
              <EntryRow key={e.symbol} e={e} lastCol="moved" onOpen={onOpen} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
