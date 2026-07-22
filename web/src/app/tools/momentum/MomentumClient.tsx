"use client";

/**
 * MomentumClient — renders the daily volume-ignition scanner.
 *
 * Design intent: this is a WATCH surface, not a buy list. The volume/return
 * numbers say "something happened here today"; the CATALYST and SCORE columns
 * say "and here's whether it's real". A row with a fat move, no catalyst, and a
 * weak fundamental score is the pump-shaped thing to be suspicious of — we
 * surface it, we don't hide it.
 */

import Link from "next/link";
import type { MomentumSignal } from "@/lib/momentum";

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
/** Compact market-cap label (₹Cr → L/K where helpful). */
function capLabel(cr: number | null): string {
  if (cr == null) return "—";
  if (cr >= 100000) return `₹${(cr / 100000).toFixed(1)}L Cr`;
  if (cr >= 1000) return `₹${Math.round(cr).toLocaleString("en-IN")} Cr`;
  return `₹${Math.round(cr)} Cr`;
}
function ago(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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
const IconBolt = ({ size }: IconProps) => svg(size, <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />);
const IconNews = ({ size }: IconProps) =>
  svg(size, <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></>);
const IconAlert = ({ size }: IconProps) =>
  svg(size, <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>);

export default function MomentumClient({
  snapDate,
  signals,
}: {
  snapDate: string | null;
  signals: MomentumSignal[];
}) {
  const dateLabel = snapDate
    ? new Date(snapDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="theme-indigo mx-auto max-w-[1100px] px-6 py-10">
      <header className="max-w-[720px]">
        <div className="eyebrow mb-3 flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0"
            style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}
          >
            <IconBolt size={14} />
          </span>
          Daily scanner
        </div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight">Momentum Radar</h1>
        <p className="muted-text mt-3 text-[15px] leading-[1.55]">
          Stocks igniting today — a <strong>≥6% up-day on ≥3× normal volume</strong> that broke a{" "}
          <strong>fresh 60-day high</strong>. Each is cross-checked against its news catalyst and
          fundamental score. A big move with <em>no catalyst and a weak score</em> is the
          pump-shaped thing to be wary of — it&apos;s shown, not hidden.
        </p>
        {dateLabel && (
          <p className="mt-2 text-[12.5px] muted-text">
            Latest scan · <span className="ink-text font-medium">{dateLabel}</span> · {signals.length} ignitions
          </p>
        )}
      </header>

      {signals.length === 0 ? (
        <div className="mt-8 card p-8 text-center">
          <div className="text-[15px] font-medium">No ignitions in the latest scan.</div>
          <p className="muted-text mt-2 text-[13.5px]">
            Quiet tape — nothing cleared the volume-breakout trigger. The scanner reruns after
            each market close.
          </p>
        </div>
      ) : (
        <div className="mt-7 card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b hairline text-[11px] uppercase tracking-wide muted-text">
                  <th className="text-left  px-3 py-2.5">Stock</th>
                  <th className="text-right px-2 py-2.5">Day</th>
                  <th className="text-right px-2 py-2.5" title="Volume ÷ 50-day average volume">Vol ×</th>
                  <th className="text-right px-2 py-2.5">Price</th>
                  <th className="text-right px-2 py-2.5" title="Delivery % — context only, not a filter">Dlv</th>
                  <th className="text-right px-2 py-2.5" title="Industry Score percentile (fundamental)">Score</th>
                  <th className="text-left  px-3 py-2.5">Catalyst</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => {
                  const suspicious = !s.catalystTitle && (s.compositePct == null || s.compositePct < 40);
                  return (
                    <tr key={s.symbol} className="border-b hairline align-top hover:bg-[var(--color-paper)] transition-colors">
                      <td className="px-3 py-2.5">
                        <Link href={`/stock/${s.symbol}`} className="font-semibold hover:underline">
                          {s.symbol}
                        </Link>
                        <div className="text-[10.5px] muted-text">
                          {s.isScored ? capLabel(s.marketCapCr) : "unscored"}
                          {s.newHigh && (
                            <span className="ml-1.5" style={{ color: GREEN }}>· new high</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-semibold" style={{ color: s.retPct >= 0 ? GREEN : RED }}>
                        {s.retPct >= 0 ? "+" : ""}{s.retPct.toFixed(1)}%
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-semibold">{s.volX.toFixed(1)}×</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{inr(s.close)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums muted-text">
                        {s.deliveryPct == null ? "—" : `${Math.round(s.deliveryPct)}%`}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-medium" style={{ color: scoreColor(s.compositePct) }}>
                        {s.compositePct == null ? "—" : Math.round(s.compositePct)}
                      </td>
                      <td className="px-3 py-2.5 max-w-[340px]">
                        {s.catalystTitle ? (
                          <a
                            href={s.catalystUrl ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group inline-flex items-start gap-1.5 hover:underline"
                            title={s.catalystTitle}
                          >
                            <span className="mt-0.5 shrink-0" style={{ color: "var(--color-accent-700)" }}>
                              <IconNews size={13} />
                            </span>
                            <span className="line-clamp-2 text-[12.5px] leading-[1.4]">
                              {s.catalystTitle}
                              <span className="muted-text"> · {s.catalystSource}{s.catalystAt ? `, ${ago(s.catalystAt)}` : ""}</span>
                            </span>
                          </a>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-1.5 py-0.5 rounded"
                            style={{
                              color: suspicious ? RED : "var(--color-muted)",
                              background: suspicious ? "color-mix(in srgb, var(--color-delta-down, #b00) 10%, transparent)" : "transparent",
                            }}
                            title={suspicious
                              ? "Big move, no news catalyst, weak fundamentals — treat with suspicion"
                              : "No news catalyst found yet — headlines can lag; check the scorecard"}
                          >
                            <IconAlert size={13} />
                            {suspicious ? "No catalyst — verify" : "No catalyst yet"}
                          </span>
                        )}
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
          <li><span className="ink-text font-medium">Vol ×</span> — how many times the day&apos;s volume beat the stock&apos;s own 50-day average. The engine of the signal.</li>
          <li><span className="ink-text font-medium">Score</span> — the platform&apos;s fundamental Industry Score percentile. High move + high score = quality breakout; high move + low score = momentum only.</li>
          <li><span className="ink-text font-medium">Catalyst</span> — the news/result that likely drove the move. <span style={{ color: RED }}>No catalyst + weak score</span> is the pump-shaped case to verify before acting.</li>
          <li><span className="ink-text font-medium">Delivery</span> is context, not a filter — it routinely collapses on genuine catalyst days as intraday traders pile in.</li>
        </ul>
      </section>
    </div>
  );
}
