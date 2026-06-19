/** Pure-SVG sparkline (no client JS). Server-renderable. */

export type SparkPoint = { label: string; value: number | null };

export function Sparkline({
  data,
  width = 180,
  height = 56,
  stroke = "var(--color-accent-500)",
  fill = false,
  overlay,
  overlayStroke = "var(--color-muted)",
}: {
  data: SparkPoint[];
  width?: number;
  height?: number;
  stroke?: string;
  /** Stretch to the container's width (svg width=100%) instead of a fixed px
   *  width. `width` still defines the coordinate space. */
  fill?: boolean;
  /** Optional second series drawn on the SAME y-scale as `data`, as a dashed
   *  muted line with no end dot. Used to overlay a peer/cluster baseline so the
   *  reader sees the stock's path RELATIVE to its peers, not just in absolute
   *  terms. Aligned to `data` by index (pass the same-length, same-order series).
   *  When provided it replaces the static mid-line. */
  overlay?: SparkPoint[];
  overlayStroke?: string;
}) {
  const points = data.filter((d) => d.value != null) as { label: string; value: number }[];
  if (points.length < 2) {
    return (
      <div className="muted-text text-[10px] italic flex items-center" style={fill ? { width: "100%", height } : { width, height }}>
        not enough data
      </div>
    );
  }
  // Overlay aligned to the FULL data array by index, then filtered to the same
  // positions that survived data's null-filter would over-complicate alignment;
  // instead we just take overlay's own non-null points for scale, and map it on
  // its own index grid (same length as data when caller passes a parallel array).
  const overlayPts = (overlay ?? []).filter((d) => d.value != null) as { label: string; value: number }[];
  const scaleVals = [...points.map((p) => p.value), ...overlayPts.map((p) => p.value)];
  let min = Math.min(...scaleVals);
  let max = Math.max(...scaleVals);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = 4;
  const xN = (i: number, n: number) => pad + (i * (width - 2 * pad)) / (n - 1);
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (height - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xN(i, points.length)} ${y(p.value)}`).join(" ");
  const overlayPath = overlayPts.length >= 2
    ? overlayPts.map((p, i) => `${i === 0 ? "M" : "L"} ${xN(i, overlayPts.length)} ${y(p.value)}`).join(" ")
    : null;
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
      {overlayPath ? (
        <path d={overlayPath} fill="none" stroke={overlayStroke} strokeWidth={1} strokeDasharray="2.5 2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.7} />
      ) : (
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
      )}
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={xN(points.length - 1, points.length)} cy={y(last.value)} r={2.5} fill={stroke} />
      {/* axis labels */}
      <title>{`${first.label} → ${last.label}, ${positive ? "improving" : "declining"}${overlayPath ? " (dashed = peer cluster avg)" : ""}`}</title>
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
