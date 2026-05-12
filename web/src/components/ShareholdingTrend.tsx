// ShareholdingTrend
//
// Quarterly stacked-bar chart of ownership composition (Promoter / FII / DII /
// Government / Public) over the last N quarters. Complements `CardShareholder`
// inside BusinessVisual which shows only the *current* snapshot.
//
// Why we built our own and didn't reuse a chart lib:
//   - Only one chart shape needed; pulling in a charting dep would balloon the
//     bundle for a single use.
//   - SVG renders fine on the server; no client hydration cost.
//   - Inline accessibility (title attribute on each segment) is easier than
//     wiring up a library's tooltip system.
//
// Empty / sparse handling:
//   - If we have <2 quarters of data we return null (caller already shows the
//     latest-quarter card via BusinessVisual; a 1-bar "trend" is not a trend).

import type { ShareholdingRow } from "@/components/BusinessVisual";

const CATEGORIES = [
  { key: "promoter_pct",   label: "Promoter",   color: "var(--color-accent-400)" },
  { key: "fii_pct",        label: "FII",        color: "var(--color-score-good)" },
  { key: "dii_pct",        label: "DII",        color: "var(--color-accent-500)" },
  { key: "government_pct", label: "Government", color: "var(--color-score-neutral)" },
  { key: "public_pct",     label: "Public",     color: "var(--color-muted)" },
] as const;

type CatKey = (typeof CATEGORIES)[number]["key"];

function fmtPeriod(iso: string): string {
  // Render "Mar '26" — compact enough for x-axis under 5 bars.
  const d = new Date(iso);
  const m = d.toLocaleDateString("en-IN", { month: "short" });
  const y = String(d.getFullYear()).slice(-2);
  return `${m} '${y}`;
}

export function ShareholdingTrend({
  shareholding,
}: {
  shareholding: ShareholdingRow[];
}) {
  if (!shareholding || shareholding.length < 2) return null;

  // Caller orders DESC by period_end (most recent first). Flip to chronological
  // so the chart reads left→right as time advances.
  const ordered = [...shareholding].reverse();

  // SVG geometry — sized to feel like a "callout" not a "section".
  // Aspect ratio ~3.5:1 so the chart reads as a slim horizontal strip rather
  // than dominating the viewport. Bars stay narrow which keeps tiny segments
  // (FII at 0.3% etc.) visible as thin slivers instead of one giant block.
  const W = 480;
  const H = 130;
  const PAD_L = 28;
  const PAD_R = 12;
  const PAD_T = 8;
  const PAD_B = 22;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const gap = 10;
  const barW = (innerW - gap * (ordered.length - 1)) / ordered.length;

  // Latest values for the legend's "current %" + delta vs previous quarter.
  const latest = ordered[ordered.length - 1];
  const prev = ordered[ordered.length - 2];

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="font-display text-[15px]">Shareholding</h2>
        <div className="muted-text text-[10.5px]">
          {ordered.length} quarter{ordered.length === 1 ? "" : "s"} · latest {fmtPeriod(latest.period_end)}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" preserveAspectRatio="xMidYMid meet">
        {/* y-axis gridlines at 50/100 only — fewer numbers, less noise */}
        {[0, 50, 100].map((p) => {
          const y = PAD_T + innerH * (1 - p / 100);
          return (
            <g key={p}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y}
                y2={y}
                stroke="var(--color-border-default)"
                strokeOpacity={p === 0 || p === 100 ? 0.4 : 0.2}
                strokeDasharray={p === 0 || p === 100 ? "" : "2 3"}
              />
              <text
                x={PAD_L - 4}
                y={y + 3}
                textAnchor="end"
                fontSize={8}
                fill="var(--color-muted)"
                fontFamily="Inter"
              >
                {p}
              </text>
            </g>
          );
        })}

        {/* stacked bars */}
        {ordered.map((row, i) => {
          const x = PAD_L + i * (barW + gap);
          let cursor = 0; // cumulative % from the bottom of the bar
          return (
            <g key={row.period_end}>
              {CATEGORIES.map((c) => {
                const v = (row[c.key as CatKey] as number | null) ?? 0;
                if (v <= 0) return null;
                const yTop = PAD_T + innerH * (1 - (cursor + v) / 100);
                const h = innerH * (v / 100);
                const segment = (
                  <rect
                    key={c.key}
                    x={x}
                    y={yTop}
                    width={barW}
                    height={h}
                    fill={c.color}
                    rx={1}
                  >
                    <title>
                      {c.label} {v.toFixed(1)}% · {fmtPeriod(row.period_end)}
                    </title>
                  </rect>
                );
                cursor += v;
                return segment;
              })}
              <text
                x={x + barW / 2}
                y={H - PAD_B + 13}
                textAnchor="middle"
                fontSize={9.5}
                fill="var(--color-muted)"
                fontFamily="Inter"
              >
                {fmtPeriod(row.period_end)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Inline legend — single row, label · pct · delta. Drops categories
          that are zero in both current and previous quarters (e.g. Government
          for most private companies). */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {CATEGORIES.map((c) => {
          const curr = (latest[c.key as CatKey] as number | null) ?? 0;
          const past = prev ? ((prev[c.key as CatKey] as number | null) ?? 0) : null;
          if (curr <= 0.01 && (past ?? 0) <= 0.01) return null;
          const delta = past == null ? null : curr - past;
          const showDelta = delta != null && Math.abs(delta) >= 0.1;
          const deltaColor =
            (delta ?? 0) >= 0
              ? "var(--color-score-good)"
              : "var(--color-score-poor)";
          return (
            <span key={c.key} className="inline-flex items-baseline gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-sm shrink-0 translate-y-[1px]"
                style={{ background: c.color }}
              />
              <span className="muted-text">{c.label}</span>
              <span className="tabular-nums ink-text font-medium">{curr.toFixed(1)}%</span>
              {showDelta && (
                <span
                  className="tabular-nums"
                  style={{ color: deltaColor, fontSize: 10 }}
                  title={`Δ vs ${fmtPeriod(prev!.period_end)}`}
                >
                  {delta! >= 0 ? "+" : ""}{delta!.toFixed(1)}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </section>
  );
}
