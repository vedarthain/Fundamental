"use client";

/**
 * RotationClient — the top-down "where's the rotation" table, used for both the
 * Sectors and Peer groups scanner tabs (same shape, different grouping).
 *
 * Design intent mirrors the price scanners: this is a MAP of strength, not a
 * buy list. Median 1-week return ranks the groups; breadth (% advancers) tells
 * you whether the move is broad or a couple of names dragging the median; the
 * momentum + composite percentiles say whether price strength is backed by
 * fundamentals. A hot sector on thin breadth is the thing to distrust.
 */

import type { RotationRow } from "@/lib/rotation";
import { Pager, usePager } from "./Pager";

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";

function pctColor(p: number | null): string {
  if (p == null) return "var(--color-muted)";
  return p >= 0 ? GREEN : RED;
}
function scoreColor(p: number | null): string {
  if (p == null) return "var(--color-muted)";
  if (p >= 66) return GREEN;
  if (p >= 40) return "var(--color-score-weak, #b7791f)";
  return RED;
}
function signedPct(p: number | null): string {
  if (p == null) return "—";
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

type IconProps = { size?: number };
function svg(size: number | undefined, children: React.ReactNode) {
  return (
    <svg
      width={size ?? 16} height={size ?? 16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      {children}
    </svg>
  );
}
const IconGrid = ({ size }: IconProps) =>
  svg(size, <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>);

export default function RotationClient({
  snapDate,
  rows,
  title,
  eyebrow,
  intro,
  groupLabel,
  noun,
  datePicker,
}: {
  snapDate: string | null;
  rows: RotationRow[];
  title: string;
  eyebrow: string;
  intro: React.ReactNode;
  /** Column header for the group name (e.g. "Sector" / "Peer group"). */
  groupLabel: string;
  /** Pager noun (e.g. "sectors" / "peer groups"). */
  noun: string;
  datePicker?: React.ReactNode;
}) {
  const dateLabel = snapDate
    ? new Date(snapDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" })
    : null;

  const pager = usePager(rows);

  return (
    <>
      <header className="max-w-[720px]">
        <div className="eyebrow mb-3 flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0"
            style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}
          >
            <IconGrid size={14} />
          </span>
          {eyebrow}
        </div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight">{title}</h1>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {dateLabel && (
            <p className="text-[12.5px] muted-text">
              <span className="ink-text font-medium">{dateLabel}</span> · {rows.length} {noun}
            </p>
          )}
          {datePicker}
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="mt-8 card p-8 text-center">
          <div className="text-[15px] font-medium">No groups to rank.</div>
          <p className="muted-text mt-2 text-[13.5px]">
            The scoring panel hasn&apos;t populated for this universe yet. It rebuilds after each
            market close.
          </p>
        </div>
      ) : (
        <div className="mt-7 card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b hairline text-[11px] uppercase tracking-wide muted-text">
                  <th className="text-left  px-3 py-2.5">{groupLabel}</th>
                  <th className="text-right px-2 py-2.5" title="Scored names in this group">Names</th>
                  <th className="text-right px-2 py-2.5" title="% of names positive over the last week">Breadth</th>
                  <th className="text-right px-2 py-2.5" title="Median 1-week return of the group">1W med</th>
                  <th className="text-right px-2 py-2.5" title="Median 1-month return of the group">1M med</th>
                  <th className="text-right px-2 py-2.5" title="Median momentum percentile">Mom</th>
                  <th className="text-right px-2 py-2.5" title="Median composite (fundamental) percentile">Score</th>
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map((r) => (
                  <tr key={r.name} className="border-b hairline align-top hover:bg-[var(--color-paper)] transition-colors">
                    <td className="px-3 py-2.5 font-semibold">{r.name}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums muted-text">{r.n}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: r.breadthPct == null ? "var(--color-muted)" : r.breadthPct >= 50 ? GREEN : RED }}>
                      {r.breadthPct == null ? "—" : `${r.breadthPct}%`}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums font-semibold" style={{ color: pctColor(r.medRet1w) }}>
                      {signedPct(r.medRet1w)}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: pctColor(r.medRet1m) }}>
                      {signedPct(r.medRet1m)}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums font-medium" style={{ color: scoreColor(r.medMomPct) }}>
                      {r.medMomPct == null ? "—" : Math.round(r.medMomPct)}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums font-medium" style={{ color: scoreColor(r.medCompPct) }}>
                      {r.medCompPct == null ? "—" : Math.round(r.medCompPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 pb-3">
            <Pager {...pager} noun={noun} />
          </div>
        </div>
      )}

      <section className="mt-8 card p-5 max-w-[820px]">
        <div className="text-[11px] uppercase tracking-wide muted-text mb-2">About this scanner</div>
        <p className="text-[13.5px] leading-[1.55]">{intro}</p>
        <div className="text-[11px] uppercase tracking-wide muted-text mt-4 mb-2">How to read this</div>
        <ul className="space-y-1.5 text-[13.5px] leading-[1.55]">
          <li><span className="ink-text font-medium">1W med / 1M med</span> — the median return across the group&apos;s names. The ranking metric; median (not mean) so one runaway name can&apos;t carry the group.</li>
          <li><span className="ink-text font-medium">Breadth</span> — share of names positive on the week. <span style={{ color: GREEN }}>High breadth</span> means the move is broad; <span style={{ color: RED }}>low breadth on a green median</span> means a couple of names are doing the lifting — distrust it.</li>
          <li><span className="ink-text font-medium">Mom / Score</span> — median momentum and composite (fundamental) percentiles. Price strength backed by a high score is a quality rotation; strength with a weak score is price-only.</li>
        </ul>
      </section>
    </>
  );
}
