"use client";

/**
 * TrendLeadersClient — renders the "fresh trend initiation" scanner.
 *
 * Design intent (mirrors MomentumClient's watch-not-buy framing): the price
 * columns say "a durable uptrend just began here"; the SCORE column says "and
 * here's whether the business underneath is worth it". A fresh golden cross on
 * a low-quality name is the thing to be sceptical of — surfaced, not filtered.
 */

import Link from "next/link";
import type { TrendLeaderSignal } from "@/lib/trendLeaders";
import { Pager, usePager } from "./Pager";

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
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
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
const IconTrend = ({ size }: IconProps) =>
  svg(size, <><path d="M3 17 9 11l4 4 8-8" /><path d="M17 7h4v4" /></>);

export default function TrendLeadersClient({
  snapDate,
  signals,
}: {
  snapDate: string | null;
  signals: TrendLeaderSignal[];
}) {
  const dateLabel = snapDate
    ? new Date(snapDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" })
    : null;

  const pager = usePager(signals);

  return (
    <>
      <header className="max-w-[720px]">
        <div className="eyebrow mb-3 flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0"
            style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}
          >
            <IconTrend size={14} />
          </span>
          Daily scanner
        </div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight">Trend Leaders</h1>
        {dateLabel && (
          <p className="mt-2 text-[12.5px] muted-text">
            Latest scan · <span className="ink-text font-medium">{dateLabel}</span> · {signals.length} fresh crosses
          </p>
        )}
      </header>

      {signals.length === 0 ? (
        <div className="mt-8 card p-8 text-center">
          <div className="text-[15px] font-medium">No fresh crosses in the latest scan.</div>
          <p className="muted-text mt-2 text-[13.5px]">
            No stock cleared a fresh golden cross near its high this window. Trend
            initiations are rare — only a handful cross in a given month. The scanner
            reruns after each market close.
          </p>
        </div>
      ) : (
        <div className="mt-7 card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b hairline text-[11px] uppercase tracking-wide muted-text">
                  <th className="text-left  px-3 py-2.5">Stock</th>
                  <th className="text-right px-2 py-2.5" title="When the 50-day SMA crossed above the 200-day SMA">Cross</th>
                  <th className="text-right px-2 py-2.5" title="% move since the cross day">Since</th>
                  <th className="text-right px-2 py-2.5">Price</th>
                  <th className="text-right px-2 py-2.5" title="Distance below the 52-week high">vs High</th>
                  <th className="text-right px-2 py-2.5" title="Industry Score percentile (fundamental)">Score</th>
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map((s) => {
                  const d = daysSince(s.crossDate);
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
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {ago(s.crossDate)}
                        {d != null && <div className="text-[10px] muted-text">{d}d ago</div>}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-semibold" style={{ color: (s.pctSinceCross ?? 0) >= 0 ? GREEN : RED }}>
                        {s.pctSinceCross == null ? "—" : `${s.pctSinceCross >= 0 ? "+" : ""}${s.pctSinceCross.toFixed(1)}%`}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{inr(s.close)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums muted-text">
                        {s.pctBelowHigh == null ? "—" : `-${s.pctBelowHigh.toFixed(1)}%`}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-medium" style={{ color: scoreColor(s.compositePct) }}>
                        {s.compositePct == null ? "—" : Math.round(s.compositePct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3 pb-3">
            <Pager {...pager} noun="crosses" />
          </div>
        </div>
      )}

      <section className="mt-8 card p-5 max-w-[820px]">
        <div className="text-[11px] uppercase tracking-wide muted-text mb-2">About this scanner</div>
        <p className="text-[13.5px] leading-[1.55]">
          Durable uptrends caught <strong>at the start</strong>: a stock whose{" "}
          <strong>50-day average just crossed above a rising 200-day average</strong>{" "}
          (a fresh golden cross) within the last ~30 sessions, trading near its 52-week
          high. This is the FEDERALBNK-at-₹65 signal — the <em>initiation</em>, not the
          crowded &ldquo;already trending&rdquo; stack. The fundamental score sits alongside so a
          fresh cross on a weak business stands out.
        </p>
        <div className="text-[11px] uppercase tracking-wide muted-text mt-4 mb-2">How to read this</div>
        <ul className="space-y-1.5 text-[13.5px] leading-[1.55]">
          <li><span className="ink-text font-medium">Cross</span> — the day the 50-day average crossed above the 200-day (a golden cross). Fresher is earlier in the trend; the whole list is within ~30 sessions.</li>
          <li><span className="ink-text font-medium">Since</span> — how far price has already run since the cross. A small number means you&apos;re early; a large one means the easy part may be gone.</li>
          <li><span className="ink-text font-medium">vs High</span> — distance below the 52-week high. Near-zero confirms the trend is intact, not fading.</li>
          <li><span className="ink-text font-medium">Score</span> — fundamental Industry Score percentile. A fresh cross on a <span style={{ color: GREEN }}>high score</span> is a quality trend starting; on a <span style={{ color: RED }}>low score</span> it&apos;s price-only — verify before acting.</li>
        </ul>
      </section>
    </>
  );
}
