"use client";

// PromoterTrendChart — the multi-year promoter-holding graph on the stock page.
//
// Renders promoter % as a line across every stored quarter (app.shareholding_
// pattern accumulates history permanently, so this graph lengthens over the
// years), with the headline "movement" the user actually cares about: where
// promoter holding STARTED in our record vs where it is NOW (e.g. 80% → 90%),
// plus QoQ and YoY deltas.
//
// Deltas are in percentage POINTS (pp), never percent: promoter 80% → 90% is
// +10.0pp. A ±0.1pp noise floor keeps rounding / ESOP drift from being coloured
// as a real accumulation or exit.

export type PromoterPoint = { period_end: string; promoter_pct: number | null };

// Quarter label from an ISO period-end date, matching the stock page's qLabel
// (Indian FY: Apr–Mar, so Mar quarter = Q4 of that FY).
function qLabel(iso: string): string {
  const d = new Date(iso);
  const m = d.getMonth() + 1;
  const q = m <= 3 ? "Q4" : m <= 6 ? "Q1" : m <= 9 ? "Q2" : "Q3";
  const fy = m <= 3 ? d.getFullYear() : d.getFullYear() + 1;
  return `${q} FY${String(fy).slice(-2)}`;
}

const NOISE = 0.1; // pp — below this a move reads as "flat", not a signal.

function DeltaChip({ label, d }: { label: string; d: number | null }) {
  let text: string;
  let color: string;
  if (d == null) {
    text = "—";
    color = "var(--color-muted)";
  } else if (Math.abs(d) < NOISE) {
    text = "≈0";
    color = "var(--color-muted)";
  } else {
    text = `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}pp`;
    color = d > 0 ? "var(--color-delta-up)" : "var(--color-delta-down)";
  }
  return (
    <span
      className="inline-flex items-baseline gap-1 rounded px-1.5 py-[1px] text-[11px] font-semibold tabular-nums"
      style={{ background: "color-mix(in srgb, var(--color-ink) 5%, transparent)" }}
      title={`Change in promoter holding ${label} (percentage points)`}
    >
      <span className="muted-text font-medium">{label}</span>
      <span style={{ color }}>{text}</span>
    </span>
  );
}

export default function PromoterTrendChart({ points }: { points: PromoterPoint[] }) {
  // Chronological, non-null only, for the line. Keep index alignment loose —
  // gaps (a quarter Screener never filed) simply collapse to the next point.
  const pts = points
    .filter((p): p is { period_end: string; promoter_pct: number } => p.promoter_pct != null)
    .sort((a, b) => a.period_end.localeCompare(b.period_end));

  if (pts.length < 2) {
    // Not enough history to draw a trend — show just the latest level, honestly.
    const only = pts[0];
    return (
      <div className="text-[12px] muted-text px-1 py-2">
        {only
          ? `Promoters hold ${only.promoter_pct.toFixed(1)}% (${qLabel(only.period_end)}). Trend appears once we have at least two quarters on record.`
          : "No promoter-holding history on record yet."}
      </div>
    );
  }

  const first = pts[0];
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  // YoY base = the point ~4 quarters before the latest, if we have it.
  const yoyBase = pts.length >= 5 ? pts[pts.length - 5] : null;

  const qoq = last.promoter_pct - prev.promoter_pct;
  const yoy = yoyBase ? last.promoter_pct - yoyBase.promoter_pct : null;
  const sinceStart = last.promoter_pct - first.promoter_pct;

  // Y-scale: fit the data, but never let a tiny band look like a cliff. Enforce
  // a minimum visible span of 4pp centred on the data's midpoint.
  const vals = pts.map((p) => p.promoter_pct);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const span = hi - lo;
  if (span < 4) {
    const mid = (hi + lo) / 2;
    lo = mid - 2;
    hi = mid + 2;
  } else {
    lo -= span * 0.1;
    hi += span * 0.1;
  }
  const range = hi - lo || 1;

  const W = 100;
  const H = 34;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - 2 - ((v - lo) / range) * (H - 4);

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.promoter_pct).toFixed(2)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  const rising = sinceStart >= 0;
  const stroke = "var(--color-accent-600)";

  return (
    <div className="px-1 pb-1">
      {/* Movement headline: from → now, plus the deltas. */}
      <div className="flex items-end justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-semibold tabular-nums leading-none">
            {last.promoter_pct.toFixed(1)}%
          </span>
          <span className="text-[11px] muted-text">
            from {first.promoter_pct.toFixed(1)}%{" "}
            <span className="opacity-70">({qLabel(first.period_end)})</span>
            {" · "}
            <span
              className="font-semibold tabular-nums"
              style={{ color: Math.abs(sinceStart) < NOISE ? "var(--color-muted)" : rising ? "var(--color-delta-up)" : "var(--color-delta-down)" }}
            >
              {Math.abs(sinceStart) < NOISE ? "flat" : `${sinceStart > 0 ? "+" : "−"}${Math.abs(sinceStart).toFixed(1)}pp`}
            </span>{" "}
            over {pts.length} quarters
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <DeltaChip label="QoQ" d={qoq} />
          <DeltaChip label="YoY" d={yoy} />
        </div>
      </div>

      {/* The line itself — stretches to width; y auto-scaled with a floor. */}
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[64px] block">
          <defs>
            <linearGradient id="promFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#promFill)" />
          <path
            d={line}
            fill="none"
            stroke={stroke}
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={x(pts.length - 1)} cy={y(last.promoter_pct)} r="1.6" fill={stroke} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>

      {/* Sparse x labels: first · midpoint · last quarter. */}
      <div className="flex justify-between text-[9.5px] muted-text mt-0.5 tabular-nums">
        <span>{qLabel(first.period_end)}</span>
        {pts.length >= 3 && <span>{qLabel(pts[Math.floor((pts.length - 1) / 2)].period_end)}</span>}
        <span>{qLabel(last.period_end)}</span>
      </div>
    </div>
  );
}
