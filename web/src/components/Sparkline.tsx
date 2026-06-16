/** Pure-SVG sparkline (no client JS). Server-renderable. */

export type SparkPoint = { label: string; value: number | null };

export function Sparkline({
  data,
  width = 180,
  height = 56,
  stroke = "var(--color-accent-500)",
  fill = false,
}: {
  data: SparkPoint[];
  width?: number;
  height?: number;
  stroke?: string;
  /** Stretch to the container's width (svg width=100%) instead of a fixed px
   *  width. `width` still defines the coordinate space. */
  fill?: boolean;
}) {
  const points = data.filter((d) => d.value != null) as { label: string; value: number }[];
  if (points.length < 2) {
    return (
      <div className="muted-text text-[10px] italic flex items-center" style={fill ? { width: "100%", height } : { width, height }}>
        not enough data
      </div>
    );
  }
  const vals = points.map((p) => p.value);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = 4;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (points.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (height - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.value)}`).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  const positive = last.value >= first.value;
  return (
    <svg
      width={fill ? "100%" : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fill ? "none" : "xMidYMid meet"}
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={2.5} fill={stroke} />
      <line
        x1={pad}
        y1={y((min + max) / 2)}
        x2={width - pad}
        y2={y((min + max) / 2)}
        stroke="var(--color-border-default)"
        strokeDasharray="2 3"
        strokeWidth={1}
        opacity={0.6}
      />
      {/* axis labels */}
      <title>{`${first.label} → ${last.label}, ${positive ? "improving" : "declining"}`}</title>
    </svg>
  );
}

export type FormatId = "pct" | "ratio" | "cr";

const FMT: Record<FormatId, (v: number | null) => string> = {
  pct:   (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`),
  ratio: (v) => (v == null ? "—" : v.toFixed(2)),
  cr:    (v) => (v == null ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`),
};

export function MetricTrendCard({
  name,
  format,
  data,
  inverse,
}: {
  name: string;
  format: FormatId;
  data: SparkPoint[];
  inverse?: boolean; // true when LOWER is better (debt/equity etc.)
}) {
  const fmt = FMT[format];
  const valid = data.filter((d) => d.value != null) as { label: string; value: number }[];
  const last = valid[valid.length - 1];
  const first = valid[0];
  const delta = last && first ? last.value - first.value : null;
  // Decide color of trend arrow: improving = good, regardless of inverse
  let trendColor = "var(--color-muted)";
  if (delta != null && Math.abs(delta) > 0.0001) {
    const improved = inverse ? delta < 0 : delta > 0;
    trendColor = improved ? "var(--color-score-good)" : "var(--color-score-poor)";
  }
  return (
    <div className="card p-3 h-full flex flex-col">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <div className="text-[11px] muted-text uppercase tracking-wide truncate">{name}</div>
        <div className="text-[14px] tabular-nums font-medium whitespace-nowrap shrink-0" style={{ color: trendColor }}>
          {fmt(last?.value ?? null)}
        </div>
      </div>
      <div className="mt-auto">
        <Sparkline data={data} width={200} height={44} stroke={trendColor} fill />
        <div className="flex justify-between text-[9px] muted-text mt-1">
          <span>{first?.label ?? ""}</span>
          <span>{last?.label ?? ""}</span>
        </div>
      </div>
    </div>
  );
}
