/**
 * The admin-only Verdict tab.
 *
 * Renders a hand-written verdict (app.stock_verdict, migration 0086) with the
 * figures it was written against placed next to today's values, so a verdict
 * that has gone out of date says so through the numbers that moved rather than
 * through its age. See lib/verdict.ts for why drift is the primary signal and
 * the date is secondary.
 *
 * Rendered in two places from this one file: the stock page's 7th tab (as a
 * server component) and the watchlist's verdict sheet (inside a client
 * modal). It therefore imports only from lib/verdictTypes, which has no
 * database — see that file's header. Two copies of this panel would be the
 * CLAUDE.md §4 drift failure with a stale opinion attached.
 *
 * Gating stays server-side in BOTH paths and is not a property of this file:
 * the stock page omits the prop entirely for a non-admin request, and the
 * sheet's data comes from an admin-gated route that 403s. Hiding it with CSS
 * would ship the text to everyone.
 *
 * `points` carry light inline HTML (<b>, <i>, entities) written by hand in a
 * Claude Code session and inserted via dangerouslySetInnerHTML. That is
 * acceptable here and nowhere else on the site: the only writer is the operator
 * running scripts/verdict-load.py against their own database, the content is
 * never user-submitted, and the panel is only ever rendered to an admin. If
 * this table ever acquires a second writer, this is the line that has to change
 * first.
 */

import type { VerdictData, VerdictRow, DriftRow, EvidenceValue } from "@/lib/verdictTypes";
import { BUCKET_COLOR, STALE_DAYS, verdictBucket } from "@/lib/verdictTypes";

/** Keys whose stored value is a 0..1 rate and reads better as a percentage. */
const RATE_KEYS = new Set([
  "pct_above_200ema_252d", "fcf_yield", "div_yield", "roce_3y", "roce_5y",
  "roe_3y", "roe_5y", "op_margin_3y", "op_margin_latest",
  "ret_3m_rel", "ret_6m_rel", "ret_12m_rel",
]);

function fmt(key: string, v: EvidenceValue): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v;
  if (RATE_KEYS.has(key)) return `${(v * 100).toFixed(1)}%`;
  return Math.abs(v) >= 1000 ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 })
                             : v.toFixed(2);
}

function label(key: string): string {
  return key.replace(/_/g, " ");
}

function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/* ------------------------------------------------------------------ empty */

/**
 * No verdict written yet. This renders rather than returning null on purpose:
 * a tab that shows nothing is indistinguishable from a tab that failed, and
 * "nobody has written one" is a different fact from "the query broke".
 */
export function VerdictEmpty({ symbol }: { symbol: string }) {
  return (
    <div className="max-w-[760px] rounded-lg border p-5"
         style={{ borderColor: "var(--color-border-default)", background: "var(--color-paper)" }}>
      <div className="text-[13px] font-semibold ink-text">No verdict written for {symbol}</div>
      <p className="mt-2 text-[13px] muted-text leading-relaxed">
        Verdicts are written by hand, a batch of symbols at a time, from the evidence pack
        built by <code>scripts/verdict-evidence.py</code>. Nothing generates them on a
        schedule, so an absent verdict means exactly that — not a failure, and not a
        neutral opinion.
      </p>
      <p className="mt-2 text-[13px] muted-text leading-relaxed">
        <a href="/admin/verdicts" className="underline">/admin/verdicts</a> lists which
        tracked symbols are still missing one.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------- drift */

function DriftTable({ drift }: { drift: DriftRow[] }) {
  if (drift.length === 0) {
    return (
      <p className="text-[12.5px] muted-text">
        This verdict stored no evidence figures, so nothing can be checked against today&apos;s
        values. Treat it as unverifiable rather than current.
      </p>
    );
  }
  const comparable = drift.filter((d) => d.comparable && !d.liveMissing);
  // Present in the live metric set but carrying no value this snapshot. Kept
  // apart from both of the other groups: scoring these as "moved" flagged
  // every verdict in the first batch on day one, and scoring them as
  // unchanged would have been a lie in the other direction.
  const unverifiable = drift.filter((d) => d.comparable && d.liveMissing);
  const derived = drift.filter((d) => !d.comparable);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px] min-w-[460px]">
        <thead>
          <tr className="muted-text">
            <th className="text-left py-1.5 pr-3 font-medium">Figure</th>
            <th className="text-right py-1.5 px-3 font-medium">Written against</th>
            <th className="text-right py-1.5 px-3 font-medium">Now</th>
            <th className="text-right py-1.5 pl-3 font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {comparable.map((d) => (
            <tr key={d.key} style={{ borderTop: "1px solid var(--color-border-default)" }}>
              <td className="py-1.5 pr-3">{label(d.key)}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{fmt(d.key, d.stored)}</td>
              <td className="py-1.5 px-3 text-right tabular-nums font-medium"
                  style={d.moved ? { color: "var(--color-delta-down)" } : undefined}>
                {fmt(d.key, d.live)}
              </td>
              <td className="py-1.5 pl-3 text-right tabular-nums"
                  style={{ color: d.moved ? "var(--color-delta-down)" : "var(--color-muted)" }}>
                {d.relPct === null
                  ? (d.moved ? "changed" : "—")
                  : `${d.relPct >= 0 ? "+" : ""}${(d.relPct * 100).toFixed(1)}%`}
              </td>
            </tr>
          ))}
          {unverifiable.map((d) => (
            <tr key={d.key} style={{ borderTop: "1px solid var(--color-border-default)" }}>
              <td className="py-1.5 pr-3">{label(d.key)}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{fmt(d.key, d.stored)}</td>
              <td className="py-1.5 px-3 text-right" colSpan={2}
                  style={{ color: "var(--color-score-mid, #d4951a)" }}>
                not computed in the current snapshot — unverified, not unchanged
              </td>
            </tr>
          ))}
          {derived.map((d) => (
            <tr key={d.key} style={{ borderTop: "1px solid var(--color-border-default)" }}>
              <td className="py-1.5 pr-3">{label(d.key)}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{fmt(d.key, d.stored)}</td>
              <td className="py-1.5 px-3 text-right muted-text" colSpan={2}>
                no live counterpart — cannot be rechecked
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------- panel */

export function VerdictPanel({ symbol, data }: { symbol: string; data: VerdictData }) {
  const { current, history, drift, ageDays, dormant } = data;
  const bucket = verdictBucket(current.verdict);
  const color = BUCKET_COLOR[bucket];
  const movedCount = drift.filter((d) => d.moved).length;
  const checkedCount = drift.filter((d) => d.comparable && !d.liveMissing).length;
  const unverifiedCount = drift.filter((d) => d.comparable && d.liveMissing).length;
  const stale = ageDays > STALE_DAYS;

  return (
    <div className="space-y-5 max-w-[860px]">
      {/* Why this tab exists and who can see it — stated, because an opinion
          rendered in the same frame as computed scores will otherwise be read
          as one of them. */}
      <div className="rounded-lg border px-4 py-3 text-[12.5px] leading-relaxed"
           style={{ borderColor: "var(--color-border-default)", background: "var(--color-paper)" }}>
        <span className="font-semibold ink-text">Private.</span>{" "}
        <span className="muted-text">
          Visible only to an admin session and never rendered for a signed-out visitor.
          This is a hand-written opinion, not a computed score — the percentile pillars
          elsewhere on this page are produced by the scoring engine, this is an argument
          made by a person on a date.
        </span>
      </div>

      {(movedCount > 0 || stale || dormant || unverifiedCount > 0) && (
        <div className="rounded-lg border-l-4 px-4 py-3 text-[13px] leading-relaxed"
             style={{
               borderLeftColor: movedCount > 0 ? "var(--color-delta-down)" : "var(--color-score-mid, #d4951a)",
               background: "var(--color-surface-raised, var(--color-paper))",
             }}>
          {movedCount > 0 && (
            <div>
              <span className="font-semibold ink-text">
                {movedCount} of the {checkedCount} figures this verdict was written
                against has{movedCount === 1 ? "" : "ve"} moved materially.
              </span>{" "}
              <span className="muted-text">
                The argument below quotes the old numbers. Read the comparison table before
                acting on it.
              </span>
            </div>
          )}
          {stale && (
            <div className={movedCount > 0 ? "mt-1.5" : ""}>
              <span className="muted-text">
                Written {ageDays} days ago, past the {STALE_DAYS}-day review mark.
                {movedCount === 0 && " None of its stored figures have moved, which is the better signal of the two."}
              </span>
            </div>
          )}
          {unverifiedCount > 0 && (
            <div className={movedCount > 0 || stale ? "mt-1.5" : ""}>
              <span className="muted-text">
                {unverifiedCount} of its stored figures cannot be checked right now — the metric
                exists but carries no value in the current snapshot. Those are reported below as
                unverified rather than counted either way.
              </span>
            </div>
          )}
          {dormant && (
            <div className={movedCount > 0 || stale ? "mt-1.5" : ""}>
              <span className="muted-text">
                You no longer track {symbol} — it is neither on the watchlist nor in the
                portfolio. This verdict is kept as history and is not being maintained.
              </span>
            </div>
          )}
        </div>
      )}

      {/* The verdict itself */}
      <div className="rounded-lg border p-5"
           style={{ borderColor: "var(--color-border-default)", borderTop: `3px solid ${color}`,
                    background: "var(--color-paper)" }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[18px] font-semibold" style={{ color }}>{current.verdict}</div>
            <div className="text-[12px] muted-text mt-0.5">
              confidence: {current.confidence} · capped by data coverage, not conviction
            </div>
          </div>
          <div className="text-[11.5px] muted-text text-right">
            <div>written {dateOnly(current.generated_at)} ({ageDays}d ago)</div>
            {current.snapshot_date && <div>metrics snapshot {current.snapshot_date}</div>}
            {current.price_asof && <div>prices to {current.price_asof}</div>}
            {current.model && <div>{current.model}</div>}
            {current.source_report && <div>from {current.source_report}</div>}
          </div>
        </div>

        <ol className="mt-4 space-y-2.5 text-[13.5px] leading-relaxed list-decimal pl-5">
          {current.points.map((p, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: p }} />
          ))}
        </ol>

        {current.trigger_text && (
          <div className="mt-4 rounded border-l-[3px] px-3.5 py-2.5 text-[13px] leading-relaxed"
               style={{ borderLeftColor: "var(--color-score-mid, #d4951a)",
                        background: "var(--color-surface-raised, transparent)" }}>
            <span className="font-semibold ink-text">What would change this verdict:</span>{" "}
            <span dangerouslySetInnerHTML={{ __html: current.trigger_text }} />
          </div>
        )}
      </div>

      {/* Stored vs live */}
      <div className="rounded-lg border p-5"
           style={{ borderColor: "var(--color-border-default)", background: "var(--color-paper)" }}>
        <div className="text-[13px] font-semibold ink-text">
          What it was written against, and what those figures are now
        </div>
        <p className="mt-1 mb-3 text-[12px] muted-text leading-relaxed">
          Frozen at the time of writing and re-read live on every page load. This is how the
          verdict reports its own staleness — through the numbers that moved, not through a
          date.
        </p>
        <DriftTable drift={drift} />
      </div>

      {/* History */}
      {history.length > 0 && (
        <details className="rounded-lg border p-5"
                 style={{ borderColor: "var(--color-border-default)", background: "var(--color-paper)" }}>
          <summary className="text-[13px] font-semibold ink-text cursor-pointer">
            {history.length} earlier verdict{history.length === 1 ? "" : "s"} for {symbol}
          </summary>
          <p className="mt-2 text-[12px] muted-text leading-relaxed">
            Nothing is overwritten. Each entry shows what was believed, when, and which of its
            figures had already changed by the time the next one was written — so the reason a
            verdict moved is computed rather than remembered.
          </p>
          <div className="mt-4 space-y-4">
            {history.map((h, i) => (
              <PriorVerdict key={h.generated_at} prior={h}
                            succeededBy={i === 0 ? current : history[i - 1]} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * One superseded verdict, with the diff against whichever verdict replaced it.
 *
 * The most useful part of the Consumer Durables v3 report was its table of what
 * changed from v2 and why. That table can be derived from two consecutive rows,
 * so it is derived — relying on a hand-written "downgraded because…" note means
 * the note goes missing in the month it matters.
 */
function PriorVerdict({ prior, succeededBy }: { prior: VerdictRow; succeededBy: VerdictRow }) {
  const changedKeys = Object.keys(prior.evidence).filter((k) => {
    const a = prior.evidence[k];
    const b = succeededBy.evidence[k];
    if (b === undefined) return false;
    if (typeof a === "number" && typeof b === "number") {
      return a !== 0 ? Math.abs(b / a - 1) >= 0.1 : b !== 0;
    }
    return a !== b;
  });
  const verdictChanged = prior.verdict !== succeededBy.verdict;

  return (
    <div className="border-l-2 pl-3.5" style={{ borderLeftColor: "var(--color-border-default)" }}>
      <div className="text-[12px] muted-text">{dateOnly(prior.generated_at)}</div>
      <div className="text-[13.5px] font-medium ink-text mt-0.5">
        {prior.verdict}{" "}
        <span className="muted-text font-normal">(confidence: {prior.confidence})</span>
      </div>
      {verdictChanged && (
        <div className="text-[12.5px] mt-1" style={{ color: "var(--color-accent-600)" }}>
          → became &ldquo;{succeededBy.verdict}&rdquo; on {dateOnly(succeededBy.generated_at)}
        </div>
      )}
      <div className="text-[12px] muted-text mt-1">
        {changedKeys.length > 0
          ? `Figures that had moved by then: ${changedKeys.map(label).join(", ")}.`
          : verdictChanged
            ? "No stored figure had moved materially — the change was a correction of reasoning, not new data."
            : "Restated with no material change in its figures."}
      </div>
      <ol className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed list-decimal pl-5 muted-text">
        {prior.points.map((p, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: p }} />
        ))}
      </ol>
    </div>
  );
}
