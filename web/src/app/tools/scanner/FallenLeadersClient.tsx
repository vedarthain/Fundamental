"use client";

/**
 * FallenLeadersClient — the "beaten-down quality" scanner (formerly the
 * standalone Correction Opportunities tool), brought under the Scanner roof.
 *
 * The mirror image of Trend Leaders: instead of durable uptrends starting, it
 * surfaces fundamentally strong businesses (Quality ≥ 55, Valuation ≥ 50) whose
 * price has been sold off (Momentum ≤ 50). Recovery signals + latest filing sit
 * alongside so a base that's turning stands apart from a knife still falling.
 *
 * Data is live from /api/opportunities (computed, not a daily snapshot), so this
 * scanner has no history date-picker — it always reflects the current panel.
 * The scanner's All-NSE / NIFTY-500 toggle drives the universe here too.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { tierLabel, displayCompanyName } from "@/lib/score";
import { WatchlistButton } from "@/components/WatchlistButton";
import { Pager, usePager } from "./Pager";
import { orderBySector, useSectorCounts, SectorHeaderRow, GroupBySectorToggle } from "./sectorGroup";

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";

type Opportunity = {
  symbol: string;
  company_name: string;
  industry_id: string;
  industry_name: string;
  sector_name: string;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  composite_pct: number | null;
  peer_rank: number | null;
  peer_count: number | null;
  is_nifty500: boolean;
  ret_1m_rel: number | null;
  ema_stack_bull: boolean | null;
  price_1m_ago: number | null;
  price_3m_ago: number | null;
  price_6m_ago: number | null;
  price_1y_ago: number | null;
  above_200sma: boolean | null;
  off_52w_low_pct: number | null;
  accum_ratio_20d: number | null;
  np_yoy_q: number | null;
  filing_title: string | null;
  filing_category: string | null;
  filing_date: string | null;
  filing_url: string | null;
};

function priceReturn(current: number | null, anchor: number | null): number | null {
  return current != null && anchor != null && anchor > 0 ? (current - anchor) / anchor : null;
}

function recoverySignals(r: Opportunity) {
  return [
    { key: "sma", label: "Above 200-day SMA", active: r.above_200sma === true },
    { key: "vol", label: "Volume accumulation (20d)", active: (r.accum_ratio_20d ?? 0) > 1.2 },
    { key: "ema", label: "Short-term EMA stack bullish", active: r.ema_stack_bull === true },
    { key: "low", label: "Off 52W low > 5%", active: (r.off_52w_low_pct ?? 0) > 0.05 },
    { key: "rel1m", label: "Outperforming index (1M)", active: (r.ret_1m_rel ?? -1) > 0 },
  ];
}
function recoveryScore(r: Opportunity): number {
  return recoverySignals(r).filter((s) => s.active).length;
}
function earningsGrowing(r: Opportunity): boolean {
  return (r.np_yoy_q ?? -Infinity) > 0;
}

function fmtCr(n: number | null): string {
  if (n == null) return "—";
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L Cr`;
  if (n >= 1_000) return `₹${Math.round(n).toLocaleString("en-IN")} Cr`;
  return `₹${Math.round(n)} Cr`;
}

function retStyle(val: number | null): { text: string; color: string } {
  if (val == null) return { text: "—", color: "var(--color-muted)" };
  const pct = val * 100;
  const text = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  if (pct <= -20) return { text, color: "#991b1b" };
  if (pct <= -10) return { text, color: "#b45309" };
  if (pct <= -3) return { text, color: "#92400e" };
  if (pct >= 10) return { text, color: GREEN };
  return { text, color: "var(--color-muted)" };
}
function scoreColor(p: number | null): string {
  if (p == null) return "var(--color-muted)";
  if (p >= 66) return GREEN;
  if (p >= 40) return "var(--color-score-weak, #b7791f)";
  return RED;
}

const SIGNAL_LABELS: Record<string, string> = { sma: "SMA", vol: "VOL", ema: "EMA", low: "52W", rel1m: "1M↑" };

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
const IconFalling = ({ size }: IconProps) =>
  svg(size, <><path d="M3 7l6 6 4-4 8 8" /><path d="M17 17h4v-4" /></>);

export default function FallenLeadersClient({ n500Only }: { n500Only: boolean }) {
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recoveryWatch, setRecoveryWatch] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/opportunities")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: { rows: Opportunity[] }) => {
        if (!live) return;
        setRows(data.rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  // Core screen: strong business, sold off (Q ≥ 55, V ≥ 50, M ≤ 50).
  const base = useMemo(
    () =>
      rows.filter(
        (r) =>
          (r.quality_pct ?? 0) >= 55 &&
          (r.valuation_pct ?? 0) >= 50 &&
          (r.momentum_pct ?? 100) <= 50,
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    let out = base;
    if (n500Only) out = out.filter((r) => r.is_nifty500);
    if (recoveryWatch) out = out.filter((r) => recoveryScore(r) >= 2);
    return out;
  }, [base, n500Only, recoveryWatch]);

  // Most-corrected first: worst 6-month return at the top.
  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const av = priceReturn(a.current_price, a.price_6m_ago);
        const bv = priceReturn(b.current_price, b.price_6m_ago);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av - bv;
      }),
    [filtered],
  );

  const recoveryCount = useMemo(() => base.filter((r) => recoveryScore(r) >= 2).length, [base]);

  const [groupSector, setGroupSector] = useState(false);
  const sectorOf = (r: Opportunity) => r.sector_name;
  const ordered = useMemo(
    () => (groupSector ? orderBySector(sorted, sectorOf) : sorted),
    [groupSector, sorted],
  );
  const sectorCounts = useSectorCounts(sorted, sectorOf);
  const pager = usePager(ordered);

  return (
    <>
      <header className="max-w-[720px]">
        <div className="eyebrow mb-3 flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0"
            style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}
          >
            <IconFalling size={14} />
          </span>
          Quality screen
        </div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight">Fallen Leaders</h1>
        <p className="mt-2 text-[12.5px] muted-text">
          Strong businesses, temporarily beaten down · {sorted.length} names
        </p>
      </header>

      {/* Recovery Watch toggle */}
      {!loading && !error && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => setRecoveryWatch((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12.5px] font-medium transition-colors"
            style={
              recoveryWatch
                ? { borderColor: GREEN, background: "color-mix(in srgb, var(--color-delta-up, #0a0) 10%, transparent)", color: GREEN }
                : { borderColor: "var(--color-border)", color: "var(--color-muted)" }
            }
            aria-pressed={recoveryWatch}
          >
            <span
              className={`w-2 h-2 rounded-full ${recoveryWatch ? "animate-livepulse" : ""}`}
              style={{ background: recoveryWatch ? GREEN : "var(--color-border)" }}
            />
            Recovery Watch
            <span className="tabular-nums">({recoveryCount})</span>
          </button>
          <span className="text-[11.5px] muted-text">
            {recoveryWatch ? "≥ 2 of 5 recovery signals firing" : "Show only names where the sell-off is easing"}
          </span>
          <GroupBySectorToggle on={groupSector} onToggle={() => setGroupSector((v) => !v)} />
        </div>
      )}

      {loading ? (
        <div className="mt-7 card p-16 text-center muted-text">Loading…</div>
      ) : error ? (
        <div className="mt-7 card p-12 text-center" style={{ color: RED }}>{error}</div>
      ) : sorted.length === 0 ? (
        <div className="mt-7 card p-8 text-center">
          <div className="text-[15px] font-medium">No names match right now.</div>
          <p className="muted-text mt-2 text-[13.5px]">
            No strong business is trading at a deep enough discount in this universe. Widen to All NSE
            or turn off Recovery Watch.
          </p>
        </div>
      ) : (
        <div className="mt-5 card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b hairline text-[11px] uppercase tracking-wide muted-text">
                  <th className="text-left  px-3 py-2.5">Stock</th>
                  <th className="text-right px-2 py-2.5">Mcap</th>
                  <th className="text-right px-2 py-2.5" title="1-month price return">1M</th>
                  <th className="text-right px-2 py-2.5" title="3-month price return">3M</th>
                  <th className="text-right px-2 py-2.5" title="6-month price return">6M</th>
                  <th className="text-right px-2 py-2.5" title="12-month price return">12M</th>
                  <th className="text-right px-2 py-2.5" title="Industry Score percentile (fundamental)">Score</th>
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map((r, i) => {
                  const score = recoveryScore(r);
                  const active = recoverySignals(r).filter((s) => s.active);
                  const prev = i > 0 ? pager.pageItems[i - 1] : undefined;
                  const showHeader =
                    groupSector && (i === 0 || sectorOf(prev!) !== sectorOf(r));
                  const secKey = (sectorOf(r) || "").trim() || "—";
                  return (
                    <Fragment key={r.symbol}>
                    {showHeader && (
                      <SectorHeaderRow label={secKey} count={sectorCounts.get(secKey) ?? 0} colSpan={7} />
                    )}
                    <tr className="border-b hairline align-top hover:bg-[var(--color-paper)] transition-colors">
                      <td className="px-3 py-2.5">
                        <div className="flex items-start gap-1.5">
                          <WatchlistButton symbol={r.symbol} variant="icon" className="-ml-1 shrink-0" />
                          <div className="min-w-0">
                        <Link href={`/stock/${r.symbol}`} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">
                          {r.symbol}
                        </Link>
                        <div className="text-[10.5px] muted-text truncate max-w-[200px]">
                          {displayCompanyName(r.company_name, r.symbol)}
                        </div>
                        <div className="text-[10.5px] muted-text mt-0.5">
                          {[r.sector_name, r.industry_name].filter(Boolean).join(" · ")}
                          <span className="mx-1">·</span>
                          {tierLabel(r.maturity_tier)}
                        </div>
                        {(active.length > 0 || earningsGrowing(r)) && (
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {active.map((s) => (
                              <span
                                key={s.key}
                                title={s.label}
                                className="inline-block text-[9px] font-bold px-1.5 py-[2px] rounded tracking-wide select-none"
                                style={{ background: "#475569", color: "#fff" }}
                              >
                                {SIGNAL_LABELS[s.key] ?? s.key.toUpperCase()}
                              </span>
                            ))}
                            {score > 0 && (
                              <span
                                className="text-[9px] font-semibold tabular-nums"
                                style={{ color: score >= 4 ? "#15803d" : score >= 2 ? "#b45309" : "#6b7280" }}
                              >
                                {score}/5
                              </span>
                            )}
                            {earningsGrowing(r) && (
                              <span
                                title="Latest quarter net profit grew YoY — fundamentals backing the recovery"
                                className="inline-block text-[9px] font-bold px-1.5 py-[2px] rounded tracking-wide select-none"
                                style={{ background: "#4f46e5", color: "#fff" }}
                              >
                                Q↑
                              </span>
                            )}
                          </div>
                        )}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums muted-text">{fmtCr(r.market_cap_cr)}</td>
                      {[r.price_1m_ago, r.price_3m_ago, r.price_6m_ago, r.price_1y_ago].map((anchor, i) => {
                        const s = retStyle(priceReturn(r.current_price, anchor));
                        return (
                          <td key={i} className="px-2 py-2.5 text-right tabular-nums font-medium" style={{ color: s.color }}>
                            {s.text}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2.5 text-right tabular-nums font-semibold" style={{ color: scoreColor(r.composite_pct) }}>
                        {r.composite_pct == null ? "—" : Math.round(r.composite_pct)}
                        {r.peer_rank != null && r.peer_count != null && (
                          <div className="text-[9.5px] muted-text font-normal">
                            {r.peer_rank}/{r.peer_count}
                          </div>
                        )}
                      </td>
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3 pb-3">
            <Pager {...pager} noun="names" />
          </div>
        </div>
      )}

      <section className="mt-8 card p-5 max-w-[820px]">
        <div className="text-[11px] uppercase tracking-wide muted-text mb-2">About this scanner</div>
        <p className="text-[13.5px] leading-[1.55]">
          The mirror of Trend Leaders: fundamentally strong businesses
          (<strong>Quality ≥ 55, Valuation ≥ 50</strong>) whose price has been sold off
          (<strong>Momentum ≤ 50</strong>). Ranked <strong>most-corrected first</strong> by 6-month
          return. This finds <em>candidates</em>, not calls — a cheap quality name can keep falling.
          The recovery signals are what separate a base that&apos;s turning from a knife still dropping.
        </p>
        <div className="text-[11px] uppercase tracking-wide muted-text mt-4 mb-2">How to read this</div>
        <ul className="space-y-1.5 text-[13.5px] leading-[1.55]">
          <li><span className="ink-text font-medium">1M / 3M / 6M / 12M</span> — absolute price return over each window. Deep negatives are the correction you&apos;re fishing in.</li>
          <li><span className="ink-text font-medium">Recovery chips</span> — <span className="font-mono">SMA</span> (above 200-day), <span className="font-mono">VOL</span> (buying &gt; selling), <span className="font-mono">EMA</span> (short EMAs re-stacking), <span className="font-mono">52W</span> (&gt;5% off the low), <span className="font-mono">1M↑</span> (beating the index). The <span className="font-mono">N/5</span> score is the count firing; <span className="font-mono">Q↑</span> means latest-quarter profit grew.</li>
          <li><span className="ink-text font-medium">Score</span> — fundamental Industry Score percentile with peer rank. A deep correction on a <span style={{ color: GREEN }}>high score</span> is the setup; on a <span style={{ color: RED }}>low score</span> it may just be a broken business.</li>
        </ul>
      </section>
    </>
  );
}
