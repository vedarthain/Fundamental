"use client";

/** Five horizontal axis bars showing percentile within (cluster, tier) peers.
 * Cluster median sits at 50 (faint vertical reference line).
 * Sorted descending so strengths rise to the top.
 */

import { band, bandColor } from "@/lib/score";
import type { SpiderAxis } from "@/lib/spider";

export type StrengthRow = { axis: SpiderAxis; value: number | null };

const AXIS_BLURBS: Record<SpiderAxis, string> = {
  Profitability: "Returns on capital — RoE/RoCE/RoA",
  Growth: "Top-line and bottom-line CAGR",
  "Cash & BS": "Cash conversion and leverage",
  Valuation: "Price vs fundamentals (cluster-weighted)",
  Momentum: "Price action + earnings momentum",
};

export function StrengthBars({ rows }: { rows: StrengthRow[] }) {
  const sorted = [...rows].sort(
    (a, b) => (b.value ?? -1) - (a.value ?? -1)
  );

  return (
    <div className="space-y-4">
      {sorted.map((r) => {
        const v = r.value;
        const bnd = band(v);
        const fillPct = v == null ? 0 : Math.max(2, Math.min(100, v));
        const delta = v == null ? null : Math.round(v - 50);
        return (
          <div key={r.axis} className="grid grid-cols-[140px_1fr_72px] items-center gap-4">
            <div>
              <div className="font-medium text-[14px]">{r.axis}</div>
              <div className="text-[11px] muted-text leading-tight">
                {AXIS_BLURBS[r.axis]}
              </div>
            </div>

            <div className="relative h-7">
              {/* Track */}
              <div className="absolute inset-y-2 left-0 right-0 rounded-full bg-[var(--color-paper)] border hairline" />
              {/* Median tick at 50 */}
              <div
                className="absolute top-0 bottom-0 w-px bg-[var(--color-muted)]/50"
                style={{ left: "50%" }}
              />
              {/* Fill */}
              {v != null && (
                <div
                  className="absolute inset-y-2 left-0 rounded-full transition-all"
                  style={{
                    width: `${fillPct}%`,
                    backgroundColor: bandColor(bnd),
                    opacity: 0.9,
                  }}
                />
              )}
              {/* Median label below the line */}
              <div
                className="absolute -bottom-3.5 text-[9px] muted-text -translate-x-1/2"
                style={{ left: "50%" }}
              >
                cluster median
              </div>
            </div>

            <div className="text-right">
              <div
                className="text-[18px] tabular-nums font-medium leading-none"
                style={{ color: bandColor(bnd) }}
              >
                {v == null ? "—" : Math.round(v)}
              </div>
              {delta != null && (
                <div
                  className="text-[10px] tabular-nums mt-0.5"
                  style={{ color: delta >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)" }}
                >
                  {delta >= 0 ? "+" : ""}
                  {delta} vs median
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
