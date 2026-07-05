"use client";

/**
 * TrendSection — composite-percentile trajectory for one stock vs the
 * average of its peer cluster, over the last 4 weekly snapshots.
 *
 * Design priorities (per recent feedback):
 *   - NUMBERS over prose.  Each row of the explainer card has a
 *     concrete number, not a sentence.
 *   - COMPARISON CHART so the reader sees the stock line and the peer
 *     average on the same axes.  The visual gap between the two lines
 *     is the signal worth surfacing — the peer line is the "control
 *     group" for cluster-wide moves.
 *   - One headline number: the change in stock-vs-peer gap over the
 *     window (positive = stock pulled ahead of peers).
 *
 * Empty state: explicit "need 2+ snapshots".  We never render a line
 * built from a single point.
 */

import { useEffect, useRef, useState } from "react";
import {
  Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Legend,
} from "recharts";
import type { PersistenceSummary } from "@/lib/persistence";

const STOCK_LINE  = "var(--color-accent-600)";
const PEER_LINE   = "var(--color-muted)";

export function TrendSection({ persistence }: { persistence: PersistenceSummary }) {
  const { series } = persistence;

  // Defensive: render an explicit empty state when the panel cache
  // doesn't yet have enough snapshots OR the row data is missing
  // composites.  This avoids the chart trying to plot null points.
  const validSeries = series.filter((p) => p.composite_pct !== null);
  if (validSeries.length < 2) {
    return (
      <section className="card p-5 mt-2 max-w-[520px]">
        <div className="font-display text-[16px] leading-tight">Recent trend</div>
        <div className="muted-text text-[12.5px] mt-1.5 leading-snug">
          Need 2+ weekly snapshots with a composite score to compute a trend.
          The next scoring run will start populating this surface.
        </div>
      </section>
    );
  }

  // Endpoints + deltas — the headline numbers.
  const oldest = validSeries[0];
  const newest = validSeries[validSeries.length - 1];
  const stockOld = oldest.composite_pct ?? 0;
  const stockNew = newest.composite_pct ?? 0;
  const stockDelta = stockNew - stockOld;

  const peerOld = oldest.cluster_composite_avg;
  const peerNew = newest.cluster_composite_avg;
  const peerDelta = (peerOld !== null && peerNew !== null) ? peerNew - peerOld : null;

  // Gap = stock − peer at any given snapshot.  Trajectory of this gap is
  // the cleanest "are you pulling ahead or falling behind?" signal.
  const gapOld = (peerOld !== null) ? stockOld - peerOld : null;
  const gapNew = (peerNew !== null) ? stockNew - peerNew : null;
  const gapChange = (gapOld !== null && gapNew !== null) ? gapNew - gapOld : null;

  // Auto-scale Y so tight ranges read meaningfully.
  const allValues: number[] = [];
  for (const p of validSeries) {
    if (p.composite_pct !== null)         allValues.push(p.composite_pct);
    if (p.cluster_composite_avg !== null) allValues.push(p.cluster_composite_avg);
  }
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const MIN_SPAN = 10;
  const span = Math.max(maxV - minV, MIN_SPAN);
  const mid  = (minV + maxV) / 2;
  const domainMin = Math.max(0,   Math.floor(mid - span / 2 - 1));
  const domainMax = Math.min(100, Math.ceil (mid + span / 2 + 1));

  // Shape rows for the chart: every snapshot gets stock + peer values
  // (peer may be null and the line will skip that point).
  const chartData = validSeries.map((p) => ({
    date:  p.snapshot_date.slice(5),       // "MM-DD" for compactness
    stock: p.composite_pct,
    peers: p.cluster_composite_avg,
  }));

  const peerCount = newest.cluster_peer_count || oldest.cluster_peer_count || 0;

  // Pattern label — 1-2 words describing the gap behaviour over the
  // window. Picks the LEVEL story when the change is near zero (gap
  // holds steady), the CHANGE story when it isn't.
  const patternLabel = describeGapPattern(gapOld, gapNew, gapChange);

  return (
    <section className="card overflow-hidden w-full h-full flex flex-col">
      {/* Header — tighter padding than before. */}
      <div className="px-3.5 pt-3 pb-1.5 flex items-baseline justify-between gap-2">
        <div>
          <div className="font-display text-[15px] leading-tight">Recent trend</div>
          <div className="muted-text text-[10.5px] mt-0.5">
            Composite percentile · stock vs cluster avg · {validSeries.length} snapshots
          </div>
        </div>
        {patternLabel && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold tracking-wide whitespace-nowrap"
            style={patternLabel.style}
          >
            {patternLabel.text}
          </span>
        )}
      </div>

      {/* Comparison chart — taller now (220px) so it shares visual
          weight with the narrative card sitting beside it.  The table
          docks beneath via `mt-auto` to keep both cards visually
          balanced regardless of available vertical space. */}
      <div className="px-1 pb-1 flex-1 flex flex-col">
        <MountedChart className="h-[220px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 12, right: 14, left: 0, bottom: 0 }}>
              <ReferenceLine y={50} stroke={PEER_LINE} strokeDasharray="2 3" strokeWidth={0.6} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: PEER_LINE }}
                axisLine={false}
                tickLine={false}
                minTickGap={20}
              />
              <YAxis
                domain={[domainMin, domainMax]}
                tick={{ fontSize: 10, fill: PEER_LINE }}
                axisLine={false}
                tickLine={false}
                width={28}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: unknown, name: unknown) => [
                  v === null || v === undefined ? "—" : Number(v).toFixed(1),
                  String(name),
                ]}
              />
              <Legend
                verticalAlign="top"
                align="left"
                iconType="line"
                iconSize={10}
                wrapperStyle={{ fontSize: 10.5, paddingBottom: 4 }}
              />
              <Line
                type="monotone"
                dataKey="stock"
                name="This stock"
                stroke={STOCK_LINE}
                strokeWidth={2}
                dot={{ r: 3, fill: STOCK_LINE }}
                isAnimationActive={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="peers"
                name={peerCount > 0 ? `Cluster avg (${peerCount} peers)` : "Cluster avg"}
                stroke={PEER_LINE}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={{ r: 2.5, fill: PEER_LINE }}
                isAnimationActive={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </MountedChart>
      </div>

      {/* Number grid — tighter rows, smaller type.  Two data rows plus
          a gap row that emphasises today's gap as the primary number
          (font-semibold + larger) since it's the headline. */}
      <div className="px-3.5 py-2.5 border-t hairline mt-auto">
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr className="muted-text text-[10px] uppercase tracking-wide">
              <th className="text-left  font-medium pb-1"></th>
              <th className="text-right font-medium pb-1">{shortDate(oldest.snapshot_date)}</th>
              <th className="text-right font-medium pb-1">{shortDate(newest.snapshot_date)}</th>
              <th className="text-right font-medium pb-1">Δ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-0.5 text-left">
                <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: STOCK_LINE }} />
                <span className="font-medium">Stock</span>
              </td>
              <td className="text-right">{stockOld.toFixed(1)}</td>
              <td className="text-right font-semibold">{stockNew.toFixed(1)}</td>
              <td className="text-right font-medium" style={{ color: deltaColor(stockDelta) }}>{fmtDelta(stockDelta)}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-left">
                <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: PEER_LINE }} />
                <span className="font-medium">Peers</span>
              </td>
              <td className="text-right">{peerOld === null ? "—" : peerOld.toFixed(1)}</td>
              <td className="text-right">{peerNew === null ? "—" : peerNew.toFixed(1)}</td>
              <td className="text-right" style={{ color: deltaColor(peerDelta) }}>{peerDelta === null ? "—" : fmtDelta(peerDelta)}</td>
            </tr>
            <tr className="border-t hairline">
              <td className="pt-1.5 text-left">
                <span className="text-[10.5px] uppercase tracking-wide muted-text">Gap</span>
              </td>
              <td className="text-right pt-1.5" style={{ color: deltaColor(gapOld) }}>
                {gapOld === null ? "—" : fmtDelta(gapOld)}
              </td>
              <td className="text-right pt-1.5 text-[14.5px] font-bold"
                  style={{ color: deltaColor(gapNew) }}>
                {gapNew === null ? "—" : fmtDelta(gapNew)}
              </td>
              <td className="text-right pt-1.5 font-medium" style={{ color: deltaColor(gapChange) }}>
                {gapChange === null ? "—" : fmtDelta(gapChange)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * One- or two-word interpretation of the gap pattern over the window.
 * Uses two ranges: LEVEL_THRESHOLD says "is the gap non-trivial?",
 * CHANGE_THRESHOLD says "did the gap move?".
 *
 * Returns null when both the level and the change are noise — keeps the
 * pill out of the way when there's nothing to call out.
 */
function describeGapPattern(
  gapOld: number | null, gapNew: number | null, gapChange: number | null,
): { text: string; style: React.CSSProperties } | null {
  if (gapOld === null || gapNew === null || gapChange === null) return null;
  const LEVEL  = 1.5;   // gap must be at least this big in absolute terms to count
  const CHANGE = 1.5;   // change must be at least this big to count as "moving"

  // Crossing zero is a story regardless of magnitude — the stock went
  // from below average to above (or vice versa) within the window.
  if (gapOld < -0.5 && gapNew > 0.5) return styledPill("Passed peers", "up");
  if (gapOld > 0.5 && gapNew < -0.5) return styledPill("Slipped below peers", "down");

  // Big change → describe the movement.
  if (gapChange >= CHANGE)  return styledPill("Pulling ahead", "up");
  if (gapChange <= -CHANGE) return styledPill("Falling behind", "down");

  // Change small → describe the LEVEL (constant gap story).
  if (gapNew >= LEVEL)      return styledPill("Steady lead", "up");
  if (gapNew <= -LEVEL)     return styledPill("Steady lag", "down");
  return styledPill("In line with peers", "neutral");
}

// ──────────────────────────────────────────────────────────────────────────
// TrendCommentary — observational narrative paired with the chart card.
// Lives in the same file because the two are always rendered together
// in the stock page's Trend tab and share the persistence shape.
// ──────────────────────────────────────────────────────────────────────────

export function TrendCommentary({
  persistence,
  companyName,
  industryName,
  maturityTier,
}: {
  persistence: PersistenceSummary;
  companyName: string;
  industryName: string | null;
  maturityTier: string | null;
}) {
  const validSeries = persistence.series.filter((p) => p.composite_pct !== null);

  if (validSeries.length < 2) {
    return (
      <section className="card p-4 w-full h-full flex flex-col justify-center text-center">
        <div className="font-display text-[16px] leading-tight">Trend story</div>
        <div className="muted-text text-[12.5px] mt-3 leading-snug max-w-[300px] mx-auto">
          Not enough history yet to write a meaningful story. Check back
          after the next Friday scoring run.
        </div>
      </section>
    );
  }

  const oldest = validSeries[0];
  const newest = validSeries[validSeries.length - 1];
  const stockOld = oldest.composite_pct ?? 0;
  const stockNew = newest.composite_pct ?? 0;
  const peerOld  = oldest.cluster_composite_avg;
  const peerNew  = newest.cluster_composite_avg;
  const gapOld   = peerOld !== null ? stockOld - peerOld : null;
  const gapNew   = peerNew !== null ? stockNew - peerNew : null;
  const peerCount = newest.cluster_peer_count || oldest.cluster_peer_count || 0;
  const subject  = shortName(companyName);
  const cluster  = industryName ?? "its peer cluster";

  const lines = buildNarrative({
    subject, cluster, peerCount, maturityTier,
    stockOld, stockNew, peerOld, peerNew, gapOld, gapNew,
    snapshotCount: validSeries.length,
  });

  return (
    <section className="card w-full h-full flex flex-col overflow-hidden">
      {/* Header mirrors TrendSection's header style so the two cards
          read as a matching pair when placed side by side. */}
      <div className="px-3.5 pt-3 pb-1.5">
        <div className="font-display text-[15px] leading-tight">Trend story</div>
        <div className="muted-text text-[10.5px] mt-0.5">
          {peerCount > 0 ? `Over ${validSeries.length} snapshots · ${peerCount} peers in cluster` : `Over ${validSeries.length} snapshots`}
        </div>
      </div>
      {/* Narrative — centered vertically in the remaining space so when
          this card is forced to a taller row height (because TrendSection
          dictates it), the prose doesn't all clump to the top with a
          big empty area below. */}
      <div className="flex-1 flex flex-col justify-center px-4 py-3 space-y-3 text-[13px] leading-snug">
        {lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </section>
  );
}

/** Build 2-3 observational sentences from the persistence data. No
 *  buy/sell language. Picks among ~6 narrative shapes based on the
 *  level of the gap and whether it moved over the window. */
function buildNarrative({
  subject, cluster, peerCount, maturityTier,
  stockOld, stockNew, peerOld, peerNew, gapOld, gapNew, snapshotCount,
}: {
  subject: string;
  cluster: string;
  peerCount: number;
  maturityTier: string | null;
  stockOld: number;
  stockNew: number;
  peerOld: number | null;
  peerNew: number | null;
  gapOld: number | null;
  gapNew: number | null;
  snapshotCount: number;
}): string[] {
  const lvl = bandLabel(stockNew);
  const lines: string[] = [];

  // Opening line — anchor in level + cluster.
  lines.push(
    `${subject} closed the latest snapshot at ${stockNew.toFixed(0)} on the composite percentile inside ${cluster}` +
    `${maturityTier ? ` · ${tierLabelShort(maturityTier)}` : ""}. ` +
    `That's ${lvl.toLowerCase()} of the cluster.`,
  );

  // Middle line — peer comparison numbers.
  if (gapNew !== null && peerNew !== null) {
    const peerCountFrag = peerCount > 0 ? ` across ${peerCount} peers` : "";
    if (Math.abs(gapNew) < 1) {
      lines.push(
        `Cluster average came in at ${peerNew.toFixed(0)}${peerCountFrag} — essentially the same level as the stock today.`,
      );
    } else if (gapNew > 0) {
      lines.push(
        `Cluster average came in at ${peerNew.toFixed(0)}${peerCountFrag}, ${gapNew.toFixed(0)} percentile points below where the stock landed.`,
      );
    } else {
      lines.push(
        `Cluster average came in at ${peerNew.toFixed(0)}${peerCountFrag}, ${Math.abs(gapNew).toFixed(0)} points above where the stock landed.`,
      );
    }
  }

  // Closing line — what the trajectory of the gap says (movement narrative).
  if (gapOld !== null && gapNew !== null) {
    const change = gapNew - gapOld;
    if (Math.abs(change) < 1.5) {
      if (Math.abs(gapNew) < 1.5) {
        lines.push(`Stock and cluster have moved roughly in lockstep over the ${snapshotCount}-snapshot window.`);
      } else if (gapNew > 0) {
        lines.push(`The gap has held steady at roughly +${Math.round(gapNew)} points across all ${snapshotCount} snapshots — a consistent edge over the cluster.`);
      } else {
        lines.push(`The gap has held steady at roughly ${Math.round(gapNew)} points across all ${snapshotCount} snapshots — a consistent lag behind the cluster.`);
      }
    } else if (change > 0) {
      lines.push(`Over the ${snapshotCount}-snapshot window the gap widened from ${fmtSigned(gapOld)} to ${fmtSigned(gapNew)} — the stock pulled away from the cluster average.`);
    } else {
      lines.push(`Over the ${snapshotCount}-snapshot window the gap moved from ${fmtSigned(gapOld)} to ${fmtSigned(gapNew)} — the cluster narrowed the gap on the stock.`);
    }
  } else {
    // Cluster peer count was zero or missing — describe stock movement only.
    const stockChange = stockNew - stockOld;
    if (Math.abs(stockChange) < 1) {
      lines.push(`Composite has held steady at ${stockNew.toFixed(0)} across ${snapshotCount} snapshots.`);
    } else if (stockChange > 0) {
      lines.push(`Composite climbed from ${stockOld.toFixed(0)} to ${stockNew.toFixed(0)} across ${snapshotCount} snapshots.`);
    } else {
      lines.push(`Composite slipped from ${stockOld.toFixed(0)} to ${stockNew.toFixed(0)} across ${snapshotCount} snapshots.`);
    }
  }

  return lines;
}

function bandLabel(pct: number): string {
  if (pct >= 80) return "Top quartile";
  if (pct >= 60) return "Above median";
  if (pct >= 40) return "Mid-pack";
  if (pct >= 20) return "Below median";
  return "Bottom quartile";
}

function tierLabelShort(t: string): string {
  switch (t) {
    case "veteran": return "Long-established";
    case "mature":  return "Established";
    case "mid":     return "Emerging";
    case "new":     return "New Listing";
    default:        return t;
  }
}

function shortName(name: string): string {
  // Drop common suffixes so opening sentences read smoothly.
  return name
    .replace(/\s+(Limited|Ltd\.?|Industries|Inc\.?|Corporation|Corp\.?|Company|Co\.?)\.?$/i, "")
    .trim();
}

function fmtSigned(v: number): string {
  if (Math.abs(v) < 0.05) return "0";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

function styledPill(text: string, tone: "up" | "down" | "neutral") {
  const style: React.CSSProperties =
    tone === "up"   ? { backgroundColor: "color-mix(in srgb, var(--color-delta-up)   18%, var(--color-paper))", color: "var(--color-delta-up)" } :
    tone === "down" ? { backgroundColor: "color-mix(in srgb, var(--color-delta-down) 18%, var(--color-paper))", color: "var(--color-delta-down)" } :
                      { backgroundColor: "var(--color-paper)", color: "var(--color-muted)" };
  return { text, style };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** YYYY-MM-DD → "MM-DD" for compact column headers. */
function shortDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(5) : iso;
}

function fmtDelta(v: number): string {
  if (Math.abs(v) < 0.05) return "0.0";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

function deltaColor(v: number | null): string {
  if (v === null) return "var(--color-muted)";
  if (v >  0.5) return "var(--color-delta-up)";
  if (v < -0.5) return "var(--color-delta-down)";
  return "var(--color-muted)";
}

const tooltipStyle: React.CSSProperties = {
  backgroundColor: "var(--color-card)",
  border: "1px solid var(--color-border-default)",
  borderRadius: 6,
  fontSize: 10.5,
  padding: "5px 7px",
};

/** ResizeObserver-gated chart wrapper — keeps recharts quiet during
 *  hydration. */
function MountedChart({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    const check = (): boolean => {
      const el = ref.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    if (check()) { setReady(true); return; }
    const obs = new ResizeObserver(() => { if (!cancelled && check()) { setReady(true); obs.disconnect(); } });
    obs.observe(ref.current);
    return () => { cancelled = true; obs.disconnect(); };
  }, []);
  return <div ref={ref} className={className}>{ready ? children : null}</div>;
}

