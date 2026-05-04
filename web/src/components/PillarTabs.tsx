"use client";

import { useState } from "react";
import { band, bandColor } from "@/lib/score";
import { MetricTrendCard, type SparkPoint, type FormatId } from "@/components/Sparkline";

export type PillarKey = "Quality" | "Valuation" | "Momentum";

export type PillarTabContent = {
  pillar: PillarKey;
  pct: number | null;
  oneLineSummary: string;       // existing one-line e.g. "Strong — clearly above cluster median."
  companyNarration: string;     // NEW: 2-3 sentence stock-specific paragraph
  strength: { label: string; subPct: number } | null;
  gap: { label: string; subPct: number } | null;
  trends: {
    name: string;
    format: FormatId;
    data: SparkPoint[];
    inverse?: boolean;
  }[];
};

const PILLAR_COLORS: Record<PillarKey, string> = {
  Quality:   "var(--color-accent-600)",
  Valuation: "var(--color-accent-400)",
  Momentum:  "var(--color-accent-300)",
};

export function PillarTabs({ tabs }: { tabs: PillarTabContent[] }) {
  const [active, setActive] = useState<PillarKey>(tabs[0]?.pillar ?? "Quality");
  const current = tabs.find((t) => t.pillar === active) ?? tabs[0];
  if (!current) return null;
  const c = PILLAR_COLORS[current.pillar];
  const bnd = band(current.pct);

  return (
    <div className="card overflow-hidden">
      {/* Tab header */}
      <div role="tablist" className="grid grid-cols-3 border-b hairline">
        {tabs.map((t) => {
          const tabColor = PILLAR_COLORS[t.pillar];
          const isActive = t.pillar === active;
          const tBand = band(t.pct);
          return (
            <button
              key={t.pillar}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.pillar)}
              className={`px-5 py-4 text-left transition-colors ${
                isActive
                  ? "bg-[var(--color-card)]"
                  : "bg-[var(--color-paper)]/60 hover:bg-[var(--color-paper)]"
              }`}
              style={{
                borderTop: isActive ? `3px solid ${tabColor}` : "3px solid transparent",
              }}
            >
              <div className="text-[11px] uppercase tracking-wide muted-text">
                {t.pillar}
              </div>
              <div className="flex items-baseline justify-between gap-2 mt-1">
                <span
                  className="font-display text-[24px] tabular-nums leading-none"
                  style={{ color: bandColor(tBand) }}
                >
                  {t.pct == null ? "—" : Math.round(t.pct)}
                </span>
                {isActive && (
                  <span className="text-[10px] muted-text">selected</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div className="p-6">
        <div className="font-display text-[22px] leading-tight tracking-tight" style={{ color: c }}>
          {current.oneLineSummary}
        </div>

        {/* Company-specific narration */}
        <p className="mt-4 text-[14.5px] leading-[1.7]">
          {current.companyNarration}
        </p>

        {/* Strength + gap drivers */}
        {(current.strength || current.gap) && (
          <div className="mt-5 border-y hairline py-3 space-y-2 text-[13px]">
            {current.strength && (
              <div className="flex items-start gap-2">
                <span style={{ color: "var(--color-score-good)" }} className="font-medium">↑</span>
                <span className="flex-1">{current.strength.label}</span>
                <span className="text-[11px] muted-text tabular-nums">{Math.round(current.strength.subPct)} pct</span>
              </div>
            )}
            {current.gap && (
              <div className="flex items-start gap-2">
                <span style={{ color: "var(--color-score-poor)" }} className="font-medium">↓</span>
                <span className="flex-1">{current.gap.label}</span>
                <span className="text-[11px] muted-text tabular-nums">{Math.round(current.gap.subPct)} pct</span>
              </div>
            )}
          </div>
        )}

        {/* Metric trend grid */}
        {current.trends.length > 0 && (
          <div className="mt-6">
            <div className="text-[11px] uppercase tracking-wide muted-text mb-3">
              Underlying trends
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              {current.trends.map((t) => (
                <MetricTrendCard
                  key={t.name}
                  name={t.name}
                  format={t.format}
                  data={t.data}
                  inverse={t.inverse}
                />
              ))}
            </div>
          </div>
        )}

        {/* Coverage warning when sparse */}
        {current.trends.length > 0 && (
          <CoverageWarning trends={current.trends} pillar={current.pillar} />
        )}
      </div>
    </div>
  );
}

function CoverageWarning({
  trends, pillar,
}: { trends: PillarTabContent["trends"]; pillar: PillarKey }) {
  // Count rows with null values across all trends — high null share = sparse source data
  const totalCells = trends.reduce((s, t) => s + t.data.length, 0);
  const nullCells = trends.reduce((s, t) => s + t.data.filter((d) => d.value == null).length, 0);
  if (totalCells === 0) return null;
  const nullShare = nullCells / totalCells;
  if (nullShare < 0.3) return null;

  return (
    <div
      className="mt-5 px-3 py-2 rounded-md text-[12px]"
      style={{
        backgroundColor: "var(--color-paper)",
        color: "var(--color-muted)",
      }}
    >
      <strong className="ink-text">Limited data</strong>
      {" "}— this company has reporting gaps in the {pillar.toLowerCase()} metrics.
      {" "}Charts above show only the years/periods the source has on file.
    </div>
  );
}
