"use client";

/**
 * ScoreHistoryChart — full multi-pillar score trajectory over all available
 * weekly snapshots for a single stock.
 *
 * Shows four series (Composite / Quality / Valuation / Momentum) plus the
 * peer-cluster composite average as a dashed baseline.  The composite line
 * is deliberately heavier so it reads as the "headline" signal.
 *
 * Time-range toggle: 3M (~13 weeks) / 6M (~26 weeks) / All
 * Each series is click-toggleable via the custom legend.
 *
 * Design notes:
 *   - No Recharts <Legend> — custom clickable legend with line-segment icons
 *     so the touch targets are bigger and the styling is consistent.
 *   - Auto-scaled Y domain with a 15-point minimum span so narrow ranges
 *     don't produce a misleadingly steep-looking chart.
 *   - MountedChart wrapper defers rendering until the container has a non-zero
 *     bounding rect, preventing the Recharts ResizeObserver console warnings
 *     that fire when the chart mounts in a hidden tab.
 */

import { useState, useEffect, useRef } from "react";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ScoreHistoryPoint = {
  snapshot_date: string;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  cluster_avg: number | null;
};

type Range = "3M" | "6M" | "All";
type SeriesKey = "composite" | "quality" | "valuation" | "momentum" | "peers";

const RANGES: Range[] = ["3M", "6M", "All"];
const RANGE_WEEKS: Record<Range, number> = { "3M": 13, "6M": 26, "All": Infinity };

interface SeriesDef {
  key: SeriesKey;
  /** Display label in legend and tooltip */
  label: string;
  color: string;
  /** SVG stroke-width */
  width: number;
  /** SVG stroke-dasharray (undefined = solid) */
  dash?: string;
}

const SERIES: SeriesDef[] = [
  { key: "composite", label: "Composite", color: "var(--color-accent-600)", width: 2.5 },
  { key: "quality",   label: "Quality",   color: "#16a34a",                 width: 1.5 },
  { key: "valuation", label: "Valuation", color: "#d97706",                 width: 1.5 },
  { key: "momentum",  label: "Momentum",  color: "#7c3aed",                 width: 1.5 },
  { key: "peers",     label: "Peers avg", color: "var(--color-muted)",      width: 1.5, dash: "5 5" },
];

export function ScoreHistoryChart({ data }: { data: ScoreHistoryPoint[] }) {
  const [range, setRange] = useState<Range>("All");
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());

  if (data.length === 0) {
    return (
      <div className="card p-5">
        <div className="font-display text-[15px] mb-1">Score history</div>
        <div className="muted-text text-[12.5px]">
          No score history available yet. Check back after the next scoring run.
        </div>
      </div>
    );
  }

  const weeks = RANGE_WEEKS[range];
  const visible = weeks === Infinity ? data : data.slice(-weeks);

  // X-axis label: compact "MM-DD" for 3M, "YYYY-MM" for longer windows
  const labelFor = (iso: string) => (range === "3M" ? iso.slice(5) : iso.slice(0, 7));

  const chartData = visible.map((p) => ({
    date:      labelFor(p.snapshot_date),
    composite: p.composite_pct,
    quality:   p.quality_pct,
    valuation: p.valuation_pct,
    momentum:  p.momentum_pct,
    peers:     p.cluster_avg,
  }));

  // Auto-scale Y to the range of visible, non-hidden values
  const vals: number[] = [];
  for (const p of visible) {
    const pairs: [SeriesKey, number | null][] = [
      ["composite", p.composite_pct],
      ["quality",   p.quality_pct],
      ["valuation", p.valuation_pct],
      ["momentum",  p.momentum_pct],
      ["peers",     p.cluster_avg],
    ];
    for (const [k, v] of pairs) {
      if (!hidden.has(k) && v != null) vals.push(v);
    }
  }
  const minV   = vals.length ? Math.min(...vals) : 0;
  const maxV   = vals.length ? Math.max(...vals) : 100;
  const span   = Math.max(maxV - minV, 15);   // minimum 15-point Y span
  const mid    = (minV + maxV) / 2;
  const domainMin = Math.max(0,   Math.floor(mid - span / 2 - 2));
  const domainMax = Math.min(100, Math.ceil (mid + span / 2 + 2));

  const toggle = (key: SeriesKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="card overflow-hidden">
      {/* Header row: title + range buttons */}
      <div className="px-4 pt-3.5 pb-2 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-display text-[15px] leading-tight">Score history</div>
          <div className="muted-text text-[10.5px] mt-0.5">
            {data.length} weekly snapshot{data.length !== 1 ? "s" : ""} · percentile within peer cluster · click a series to toggle
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors"
              style={
                range === r
                  ? { background: "var(--color-accent-600)", color: "white" }
                  : { background: "var(--color-paper)", color: "var(--color-muted)" }
              }
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Clickable series legend */}
      <div className="px-4 pb-2.5 flex gap-4 flex-wrap">
        {SERIES.map(({ key, label, color, dash }) => (
          <button
            key={key}
            onClick={() => toggle(key)}
            className="flex items-center gap-1.5 text-[11.5px] transition-opacity"
            style={{ opacity: hidden.has(key) ? 0.28 : 1, color: "var(--color-muted)" }}
            aria-pressed={!hidden.has(key)}
          >
            {/* Line-segment icon matching chart style */}
            <svg width="18" height="10" viewBox="0 0 18 10" fill="none" aria-hidden>
              {dash ? (
                <line
                  x1="0" y1="5" x2="18" y2="5"
                  stroke={color} strokeWidth="2" strokeDasharray={dash}
                />
              ) : (
                <line
                  x1="0" y1="5" x2="18" y2="5"
                  stroke={color} strokeWidth={key === "composite" ? 2.5 : 1.5}
                />
              )}
            </svg>
            {label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <MountedChart className="h-[260px] w-full px-1 pb-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            {/* Midpoint reference */}
            <ReferenceLine
              y={50}
              stroke="var(--color-muted)"
              strokeDasharray="2 3"
              strokeWidth={0.5}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "var(--color-muted)" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[domainMin, domainMax]}
              tick={{ fontSize: 10, fill: "var(--color-muted)" }}
              axisLine={false}
              tickLine={false}
              width={28}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => [
                v == null ? "—" : `${Number(v).toFixed(1)}`,
                String(name),
              ]}
              labelStyle={{ color: "var(--color-muted)", fontSize: 10 }}
            />
            {SERIES.map(({ key, label, color, width, dash }) =>
              hidden.has(key) ? null : (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={label}
                  stroke={color}
                  strokeWidth={width}
                  strokeDasharray={dash}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                  connectNulls
                />
              )
            )}
          </LineChart>
        </ResponsiveContainer>
      </MountedChart>
    </div>
  );
}

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "var(--color-card)",
  border: "1px solid var(--color-border-default)",
  borderRadius: 6,
  fontSize: 10.5,
  padding: "5px 8px",
};

/**
 * ResizeObserver-gated chart wrapper.
 * Recharts fires a spurious "width/height is 0" warning when it mounts in a
 * hidden tab (display:none).  Deferring render until the container has a
 * non-zero bounding rect keeps the console clean.
 */
function MountedChart({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    const check = () => {
      const el = ref.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    if (check()) { setReady(true); return; }
    const obs = new ResizeObserver(() => {
      if (!cancelled && check()) { setReady(true); obs.disconnect(); }
    });
    obs.observe(ref.current);
    return () => { cancelled = true; obs.disconnect(); };
  }, []);
  return (
    <div ref={ref} className={className}>
      {ready ? children : null}
    </div>
  );
}
