"use client";

/**
 * StrengthsPanel — "graphs-first" layout for the stock page's Strengths & gaps
 * tab. Replaces the old tabbed PillarTabs (which hid each pillar's charts
 * behind a tab click) with:
 *
 *   1. A dense grid of ALL underlying metric trend charts across every pillar,
 *      visible at once up top (grouped + colour-tagged by pillar).
 *   2. The peer-percentile StrengthBars.
 *   3. The per-pillar narration (why this score) as compact prose underneath.
 */

import { band, bandColor } from "@/lib/score";
import { MetricTrendCard } from "@/components/Sparkline";
import { StrengthBars, type StrengthRow } from "@/components/StrengthBars";
import type { PillarTabContent, PillarKey } from "@/components/PillarTabs";

const PILLAR_COLORS: Record<PillarKey, string> = {
  Quality:   "var(--color-accent-600)",
  Valuation: "var(--color-accent-400)",
  Momentum:  "var(--color-accent-300)",
};

export function StrengthsPanel({
  tabs,
  strengthRows,
}: {
  tabs: PillarTabContent[];
  strengthRows: StrengthRow[];
}) {
  const withTrends = tabs.filter((t) => t.trends.length > 0);

  return (
    <div className="space-y-8">
      {/* 1 — all trend charts, grouped by pillar, visible at once */}
      {withTrends.length > 0 && (
        <div className="space-y-5">
          {withTrends.map((t) => (
            <div key={t.pillar}>
              <div className="flex items-baseline gap-2 mb-2.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PILLAR_COLORS[t.pillar] }} />
                <span className="text-[12px] uppercase tracking-wide font-semibold">{t.pillar}</span>
                <span
                  className="font-display text-[17px] tabular-nums leading-none"
                  style={{ color: bandColor(band(t.pct)) }}
                >
                  {t.pct == null ? "—" : Math.round(t.pct)}
                </span>
                <span className="text-[11.5px] muted-text truncate">{t.oneLineSummary}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 auto-rows-fr">
                {t.trends.map((tr) => (
                  <MetricTrendCard
                    key={tr.name}
                    name={tr.name}
                    format={tr.format}
                    data={tr.data}
                    inverse={tr.inverse}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 2 — peer-percentile bars */}
      <div className="border-t hairline pt-6">
        <div className="text-[11px] uppercase tracking-wide muted-text mb-3">
          Percentile vs peers
        </div>
        <StrengthBars rows={strengthRows} />
      </div>

      {/* 3 — why this score (narration), no longer hidden behind tabs */}
      <div className="border-t hairline pt-6 space-y-5">
        <div className="text-[11px] uppercase tracking-wide muted-text">Why this score</div>
        {tabs.map((t) => (
          <div key={t.pillar}>
            <div className="flex items-baseline gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PILLAR_COLORS[t.pillar] }} />
              <span className="text-[12.5px] uppercase tracking-wide font-semibold" style={{ color: PILLAR_COLORS[t.pillar] }}>
                {t.pillar}
              </span>
            </div>
            <p className="mt-1 text-[14px] leading-[1.65]">{t.companyNarration}</p>
            {(t.strength || t.gap) && (
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
                {t.strength && (
                  <span className="flex items-center gap-1.5">
                    <span style={{ color: "var(--color-score-good)" }} className="font-medium">↑</span>
                    {t.strength.label}
                    <span className="muted-text tabular-nums">{Math.round(t.strength.subPct)} pct</span>
                  </span>
                )}
                {t.gap && (
                  <span className="flex items-center gap-1.5">
                    <span style={{ color: "var(--color-score-poor)" }} className="font-medium">↓</span>
                    {t.gap.label}
                    <span className="muted-text tabular-nums">{Math.round(t.gap.subPct)} pct</span>
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
