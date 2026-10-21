/**
 * /tools/universe-changes — the weekly membership changelog for the tracked
 * universe. Reads the immutable app.universe_event log (migration 0055): every
 * new NSE listing the ETL onboards shows as 'added', every dark name it retires
 * as 'removed'. Grouped by ISO week so "what changed this week / last week / a
 * month ago" is a scroll, not a query — and because the log is append-only, no
 * week is ever lost to a later transition.
 */
import Link from "next/link";
import {
  loadUniverseChanges,
  loadUniverseChangeTotals,
  type CoverageStatus,
  type UniverseEvent,
} from "@/lib/universeEvents";

/**
 * How the ETL's coverage verdict reads to a human. Phrased as the stock's
 * state, not the pipeline's: "too new to score" is a fact about the company,
 * while 'gated_insufficient_history' is a fact about our SQL.
 *
 * `scored` gets no chip at all — it is the expected case, and labelling it
 * would make the exceptions harder to spot, not easier.
 */
const COVERAGE_LABEL: Record<CoverageStatus, { text: string; hint: string } | null> = {
  scored: null,
  gated_insufficient_history: {
    text: "too new to score",
    hint: "Under a year of reported annual history, so the scorecard is withheld rather than computed on thin data. It fills in as results accrue.",
  },
  gated_stale_financials: {
    text: "financials stale",
    hint: "The most recent annual report is too old to score against — usually a company that has stopped filing on time.",
  },
  no_metrics: {
    text: "not yet computed",
    hint: "Onboarded, but the weekly compute has not produced a scorecard for it yet.",
  },
  never_attempted: {
    text: "not yet fetched",
    hint: "Onboarded, but we have not successfully pulled its financials yet.",
  },
  fetch_failing: {
    text: "fetch failing",
    hint: "Our data pull for this symbol is erroring — we are aware of it.",
  },
  unclassified: {
    text: "unclassified",
    hint: "No sector assigned yet, so it has no peer group to be scored against.",
  },
};

export const dynamic = "force-dynamic";
export const metadata = { title: "Universe changes · EquityRoots" };

function fmtWeek(weekStart: string): string {
  const start = new Date(weekStart + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const sameMonth = start.getMonth() === end.getMonth();
  const startStr = start.toLocaleDateString("en-IN", opts);
  const endStr = end.toLocaleDateString(
    "en-IN",
    sameMonth ? { day: "numeric" } : opts,
  );
  return `${startStr} – ${endStr}, ${end.getFullYear()}`;
}

function fmtDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function EventPill({ e }: { e: UniverseEvent }) {
  const added = e.event === "added";
  const cov = e.coverageStatus ? COVERAGE_LABEL[e.coverageStatus] : null;
  return (
    <Link
      href={`/stock/${e.symbol}`}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border hairline text-[13px] hover:opacity-80 transition-opacity"
      style={{ backgroundColor: "var(--color-card)" }}
      title={[
        e.companyName ?? e.symbol,
        e.listingDate ? `listed ${fmtDate(e.listingDate)}` : null,
        `tracked from ${new Date(e.eventAt).toLocaleDateString("en-IN")}`,
        e.source === "backfill" ? "reconstructed from initial state" : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <span
        aria-hidden
        style={{
          color: added
            ? "var(--color-score-excellent)"
            : "var(--color-score-poor, #b91c1c)",
        }}
      >
        {added ? "+" : "−"}
      </span>
      <span className="font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>
        {e.symbol}
      </span>
      {e.companyName && e.companyName !== e.symbol && (
        <span className="muted-text truncate max-w-[180px]">{e.companyName}</span>
      )}
      {cov && (
        <span
          className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
          style={{
            color: "var(--color-ink-muted, #6b7280)",
            backgroundColor: "var(--color-bg-subtle, rgba(0,0,0,0.04))",
          }}
          title={cov.hint}
        >
          {cov.text}
        </span>
      )}
      {e.source === "backfill" && (
        <span
          className="muted-text text-[10px] uppercase tracking-wide"
          title="Reconstructed from the universe's state when this log was created — not live-recorded."
        >
          seed
        </span>
      )}
    </Link>
  );
}

export default async function UniverseChangesPage() {
  const [weeks, totals] = await Promise.all([
    loadUniverseChanges(16),
    loadUniverseChangeTotals(),
  ]);

  const lastEvent = totals.lastEventAt
    ? new Date(totals.lastEventAt).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

  return (
    <div className="theme-indigo mx-auto max-w-[900px] px-6 py-10">
      <div className="text-[12px] uppercase tracking-wide muted-text flex items-center gap-2 flex-wrap">
        <Link href="/tools" className="hover:underline">Tools</Link>
        <span aria-hidden style={{ color: "var(--color-border-default)" }}>›</span>
        <span>Universe changes</span>
      </div>

      <h1 className="font-display text-[36px] tracking-tight leading-tight mt-1">
        What&apos;s <em className="accent">joined</em> and{" "}
        <em className="accent">left</em> the universe
      </h1>
      <p className="mt-3 text-[15px] muted-text max-w-[640px]">
        Every week the fetch job reconciles our roster against NSE&apos;s live
        listing master — onboarding fresh listings and retiring names that have
        gone dark. This is the append-only record of those changes; no week is
        ever overwritten. Genuinely new listings are kept separate from older
        companies we simply started tracking, and each name carries whether we
        can score it yet.
      </p>

      <div className="mt-4 flex flex-wrap gap-4 text-[13px] muted-text">
        <span>
          <span className="font-medium tabular-nums" style={{ color: "var(--color-score-excellent)" }}>
            {totals.added.toLocaleString("en-IN")}
          </span>{" "}
          added
        </span>
        <span>
          <span className="font-medium tabular-nums" style={{ color: "var(--color-score-poor, #b91c1c)" }}>
            {totals.removed.toLocaleString("en-IN")}
          </span>{" "}
          removed
        </span>
        <span>· since logging began (live events only)</span>
        <span>· last change {lastEvent}</span>
      </div>

      <div className="mt-8 space-y-8">
        {weeks.length === 0 && (
          <p className="muted-text text-[14px]">
            No membership changes recorded yet. The first weekly fetch after this
            log went live will start filling it in.
          </p>
        )}

        {weeks.map((w) => {
          // The split that makes this page honest. Both halves are 'added'
          // events a week apart in our log; only one half is news about the
          // market. See universeEvents.ts — MHHL listed in 2018 and was
          // onboarded in October 2026.
          const fresh = w.added.filter((e) => e.isNewListing);
          const backfilled = w.added.filter((e) => !e.isNewListing);
          return (
          <section key={w.weekStart}>
            <div className="flex items-baseline gap-3 mb-3">
              <h2 className="font-display text-[18px]" style={{ color: "var(--color-ink)" }}>
                {fmtWeek(w.weekStart)}
              </h2>
              <span className="text-[12px] muted-text tabular-nums">
                +{w.added.length} / −{w.removed.length}
              </span>
            </div>

            {fresh.length > 0 && (
              <div className="mb-3">
                <div className="eyebrow mb-2">
                  New listings ({fresh.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {fresh.map((e) => (
                    <EventPill key={e.id} e={e} />
                  ))}
                </div>
              </div>
            )}

            {backfilled.length > 0 && (
              <div className="mb-3">
                <div
                  className="eyebrow mb-2"
                  title="Companies that were already listed — sometimes for years — and that we started tracking this week. The date is ours, not the market's."
                >
                  Newly tracked, already listed ({backfilled.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {backfilled.map((e) => (
                    <EventPill key={e.id} e={e} />
                  ))}
                </div>
              </div>
            )}

            {w.removed.length > 0 && (
              <div>
                <div className="eyebrow mb-2">Removed</div>
                <div className="flex flex-wrap gap-2">
                  {w.removed.map((e) => (
                    <EventPill key={e.id} e={e} />
                  ))}
                </div>
              </div>
            )}
          </section>
          );
        })}
      </div>
    </div>
  );
}
