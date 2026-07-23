"use client";

/**
 * SupportFloorClient — renders the "at a multi-year tested floor" scanner.
 *
 * Design intent (deliberately more sceptical than its momentum siblings): the
 * columns say "price is sitting on a floor it has bounced off before"; the copy
 * hammers that this is LOCATION, not a buy signal. A stock at a tested floor may
 * bounce or slice through it. The SCORE column is the real filter — a quality
 * name at a floor is interesting; a broken business at a floor is a trap. More
 * touches is flagged as a WARNING, not a virtue.
 */

import Link from "next/link";
import type { SupportFloorSignal } from "@/lib/supportFloor";

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";

function inr(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
function scoreColor(p: number | null): string {
  if (p == null) return "var(--color-muted)";
  if (p >= 66) return GREEN;
  if (p >= 40) return "var(--color-score-weak, #b7791f)";
  return RED;
}
function capLabel(cr: number | null): string {
  if (cr == null) return "—";
  if (cr >= 100000) return `₹${(cr / 100000).toFixed(1)}L Cr`;
  if (cr >= 1000) return `₹${Math.round(cr).toLocaleString("en-IN")} Cr`;
  return `₹${Math.round(cr)} Cr`;
}
function ago(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
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
const IconFloor = ({ size }: IconProps) =>
  svg(size, <><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /><path d="M21 20H3" /></>);

export default function SupportFloorClient({
  snapDate,
  signals,
}: {
  snapDate: string | null;
  signals: SupportFloorSignal[];
}) {
  const dateLabel = snapDate
    ? new Date(snapDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <>
      <header className="max-w-[720px]">
        <div className="eyebrow mb-3 flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0"
            style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}
          >
            <IconFloor size={14} />
          </span>
          Daily scanner
        </div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight">At Support</h1>
        <p className="muted-text mt-3 text-[15px] leading-[1.55]">
          Stocks sitting on a <strong>multi-year floor they&apos;ve bounced off before</strong>: a
          price band tested <strong>≥3 times over 13+ months</strong>, with price now within{" "}
          <strong>~12% above it</strong>. This is the opposite of a breakout — these names are near
          their <em>lows</em>. It finds <strong>location, not direction</strong>: a tested floor can
          bounce or break. The fundamental score is the real filter — a quality name at a floor is
          interesting; a weak one is a falling knife.
        </p>
        {dateLabel && (
          <p className="mt-2 text-[12.5px] muted-text">
            Latest scan · <span className="ink-text font-medium">{dateLabel}</span> · {signals.length} at support
          </p>
        )}
      </header>

      {signals.length === 0 ? (
        <div className="mt-8 card p-8 text-center">
          <div className="text-[15px] font-medium">Nothing sitting at a tested floor.</div>
          <p className="muted-text mt-2 text-[13.5px]">
            No liquid name is currently within range of a multi-year support band it has tested
            ≥3 times. The scanner reruns after each market close.
          </p>
        </div>
      ) : (
        <div className="mt-7 card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b hairline text-[11px] uppercase tracking-wide muted-text">
                  <th className="text-left  px-3 py-2.5">Stock</th>
                  <th className="text-right px-2 py-2.5">Price</th>
                  <th className="text-right px-2 py-2.5" title="The tested support level">Floor</th>
                  <th className="text-right px-2 py-2.5" title="How far price sits above the floor">Above</th>
                  <th className="text-right px-2 py-2.5" title="Times the floor was tested — MORE IS A WARNING, a heavily-tested floor is closer to breaking">Tests</th>
                  <th className="text-right px-2 py-2.5" title="Most recent test of the floor">Last test</th>
                  <th className="text-right px-2 py-2.5" title="Industry Score percentile (fundamental)">Score</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => {
                  const heavilyTested = s.nTouch >= 6;
                  return (
                    <tr key={s.symbol} className="border-b hairline align-top hover:bg-[var(--color-paper)] transition-colors">
                      <td className="px-3 py-2.5">
                        <Link href={`/stock/${s.symbol}`} className="font-semibold hover:underline">
                          {s.symbol}
                        </Link>
                        <div className="text-[10.5px] muted-text">
                          {s.isScored ? capLabel(s.marketCapCr) : "unscored"}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{inr(s.close)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums muted-text">{inr(s.floorPx)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-semibold">
                        {s.pctAbove == null ? "—" : `+${s.pctAbove.toFixed(1)}%`}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: heavilyTested ? RED : "inherit" }}>
                        {s.nTouch}
                        {heavilyTested && <span className="ml-1 text-[10px]" title="Heavily-tested floor — more likely to break">⚠</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums muted-text">{ago(s.lastTouch)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-medium" style={{ color: scoreColor(s.compositePct) }}>
                        {s.compositePct == null ? "—" : Math.round(s.compositePct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <section className="mt-8 card p-5 max-w-[820px]">
        <div className="text-[11px] uppercase tracking-wide muted-text mb-2">How to read this</div>
        <ul className="space-y-1.5 text-[13.5px] leading-[1.55]">
          <li><span className="ink-text font-medium">Floor</span> — a price the stock has fallen to and bounced from repeatedly. &ldquo;Above&rdquo; is how close today&apos;s price sits to it; near-zero means it&apos;s right on the floor now.</li>
          <li><span className="ink-text font-medium">Tests</span> — how many times the floor held. <span style={{ color: RED }}>More is a warning, not a virtue</span> — every retest spends buyers, so a floor tested many times is closer to breaking.</li>
          <li><span className="ink-text font-medium">Score</span> — the fundamental filter that matters most here. A <span style={{ color: GREEN }}>high score</span> at a floor is a quality name that sold off; a <span style={{ color: RED }}>low score</span> is a falling knife — the floor is likely to give way.</li>
          <li><span className="ink-text font-medium">This is not a buy list.</span> It finds where price <em>is</em> (on a floor), never whether it will bounce. Confirm a turn before acting.</li>
        </ul>
      </section>
    </>
  );
}
