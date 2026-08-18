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
  type UniverseEvent,
} from "@/lib/universeEvents";

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

function EventPill({ e }: { e: UniverseEvent }) {
  const added = e.event === "added";
  return (
    <Link
      href={`/stock/${e.symbol}`}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border hairline text-[13px] hover:opacity-80 transition-opacity"
      style={{ backgroundColor: "var(--color-card)" }}
      title={`${e.companyName ?? e.symbol} · ${new Date(e.eventAt).toLocaleString("en-IN")}${
        e.source === "backfill" ? " · reconstructed from initial state" : ""
      }`}
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
        ever overwritten.
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

        {weeks.map((w) => (
          <section key={w.weekStart}>
            <div className="flex items-baseline gap-3 mb-3">
              <h2 className="font-display text-[18px]" style={{ color: "var(--color-ink)" }}>
                {fmtWeek(w.weekStart)}
              </h2>
              <span className="text-[12px] muted-text tabular-nums">
                +{w.added.length} / −{w.removed.length}
              </span>
            </div>

            {w.added.length > 0 && (
              <div className="mb-3">
                <div className="eyebrow mb-2">Added</div>
                <div className="flex flex-wrap gap-2">
                  {w.added.map((e) => (
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
        ))}
      </div>
    </div>
  );
}
