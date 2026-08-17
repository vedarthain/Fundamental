"use client";

/**
 * CandleChart — candlestick + volume panel WITH axes for the Graph tab.
 *
 * Measures its container (ResizeObserver) and renders the SVG at true pixel
 * coordinates, so axis text stays crisp. (The old fixed 1000×1000 viewBox with
 * preserveAspectRatio="none" stretched the space non-uniformly and would have
 * squished any label.) Layout: a left gutter for price (Y) ticks, a bottom
 * gutter for date (X) ticks, price panel on top (~70%) and a short volume panel
 * beneath sharing the same x-grid. Prices are the split-safe adjusted OHLC.
 */
import { useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/candles";

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";
const AXIS = "var(--color-muted, #7a8894)";
const GRID = "var(--color-border-default, #e5e5e5)";
const CARD = "var(--color-card, #fff)";
const ACCENT = "var(--color-accent-600, #2563eb)";
const ALERT_ARMED = "var(--color-delta-up, #0a0)"; // green — waiting to cross
const ALERT_TRIGGERED = "#e8830c"; // orange — crossed
const EMPTY_DRAWINGS: Drawing[] = [];
const EMPTY_ALERTS: AlertLine[] = [];

// Shared plot margins — used both by renderChart and the hover hit-test so a
// mouse-x maps to the same slot the candles were drawn in.
const mL = 46; // y-axis price gutter
const mR = 8;
const mT = 8;
const mB = 20; // x-axis date gutter

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Nice" round tick values across [min, max] for the price axis.
function niceTicks(min: number, max: number, n: number): number[] {
  const span = max - min || 1;
  const raw = span / Math.max(1, n);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) out.push(v);
  return out;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return Math.round(v).toLocaleString("en-IN");
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function fmtVol(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

function fmtDate(iso: string, longSpan: boolean): string {
  const [y, m, d] = iso.split("-");
  const mon = MONTHS[(+m || 1) - 1];
  return longSpan ? `${mon} '${y.slice(2)}` : `${+d} ${mon}`;
}

// A two-point selection in pixel coords (relative to the chart container).
// Powers the TradingView-style measure tool: click a start point, click an end
// point — the price move, %, bar/day count and summed volume are read out.
type Measure = { x0: number; y0: number; x1: number; y1: number };

// Persistable drawings. Anchored to PRICE / DATE (never pixels) so a line drawn
// on one timeframe re-projects correctly on any other timeframe or chart size.
//  - hline: a single price level (rendered on every chart, incl. the small grid)
//  - trend: two (date, price) anchors → a sloped segment (expanded chart only)
export type Drawing =
  | { kind: "hline"; price: number }
  | { kind: "trend"; d0: string; p0: number; d1: string; p1: number };

// Which drawing/measure tool is armed on an interactive chart. "alert" is the
// crosshair for placing a price alert — same follow-the-cursor feel as "hline",
// but the click creates a server-backed alert instead of a local drawing.
export type ChartTool = "none" | "measure" | "hline" | "trend" | "erase" | "alert";

// A real executed trade to pin on the chart (expanded view only). Anchored to a
// DATE (not a pixel/price) and drawn against the bar's own high/low, so it stays
// correctly placed regardless of split-adjustment or timeframe. Side "B"=buy is
// pinned just below the bar's low; "S"=sell just above the bar's high.
export type TradeMark = { d: string; side: "B" | "S"; price: number; qty: number; derived?: boolean };

// A user price alert to draw as a horizontal line. armed = green (waiting),
// triggered = orange (crossed). Rendered on every chart, like an hline, but
// owned by the server (not the localStorage drawing layer).
export type AlertLine = { price: number; status: "armed" | "triggered" };
const EMPTY_TRADES: TradeMark[] = [];
const BUY_COL = "#16a34a";
const SELL_COL = "#dc2626";

// Shared price/x geometry — the single source of truth used by both renderChart
// (to draw) and the click handler (to invert a pixel back to a price/date).
function computeGeom(data: Candle[], W: number, H: number, hideVolume = false) {
  const plotL = mL;
  const plotR = W - mR;
  const plotW = plotR - plotL;
  const priceTop = mT;
  const priceBot = hideVolume ? H - mB : mT + (H - mT - mB) * 0.7;
  const volTop = priceBot + 12;
  const volBot = H - mB;
  const n = data.length;
  let pMin = Math.min(...data.map((c) => c.l));
  let pMax = Math.max(...data.map((c) => c.h));
  if (pMin === pMax) {
    pMin -= 1;
    pMax += 1;
  }
  const pad = (pMax - pMin) * 0.04;
  const lo = pMin - pad;
  const hi = pMax + pad;
  const vMax = Math.max(1, ...data.map((c) => c.v || 0));
  const slot = plotW / n;
  const bodyW = Math.max(1, slot * 0.62);
  const cx = (i: number) => plotL + slot * (i + 0.5);
  const yP = (v: number) => priceTop + (1 - (v - lo) / (hi - lo)) * (priceBot - priceTop);
  const yV = (v: number) => volBot - (v / vMax) * (volBot - volTop);
  const priceAt = (y: number) => lo + (1 - (y - priceTop) / (priceBot - priceTop)) * (hi - lo);
  const idxAt = (x: number) => Math.max(0, Math.min(n - 1, Math.floor((x - plotL) / slot)));
  return { plotL, plotR, plotW, priceTop, priceBot, volTop, volBot, n, pMin, pMax, lo, hi, vMax, slot, bodyW, cx, yP, yV, priceAt, idxAt };
}

// Map a stored anchor date back to a bar index in the current window. Exact match
// preferred; otherwise the nearest bar by calendar date (so a trend line drawn on
// a 3Y window still lands sensibly if the window changes).
function idxForDate(data: Candle[], d: string): number {
  let exact = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i].d === d) {
      exact = i;
      break;
    }
  }
  if (exact >= 0) return exact;
  const t = new Date(d).getTime();
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < data.length; i++) {
    const diff = Math.abs(new Date(data[i].d).getTime() - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

// Perpendicular distance (px) from point (px,py) to the segment (ax,ay)-(bx,by).
// Used by the eraser to find the drawing nearest a click.
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Live preview of the tool being drawn (pixel coords). sx/sy set = trend in
// progress (first point placed); null = hline follows cursor Y.
type Draft = { tool: ChartTool; x: number; y: number; sx: number | null; sy: number | null };

export function CandleChart({
  candles,
  interactive = false,
  weekly = false,
  tool = "none",
  drawings = EMPTY_DRAWINGS,
  onAddDrawing,
  onDeleteDrawing,
  monoColor,
  hideVolume = false,
  trades = EMPTY_TRADES,
  alerts = EMPTY_ALERTS,
  onPlaceAlert,
}: {
  candles?: Candle[];
  interactive?: boolean;
  weekly?: boolean;
  /** Armed drawing/measure tool (interactive charts only). */
  tool?: ChartTool;
  /** Persisted drawings for this symbol (price/date anchored). */
  drawings?: Drawing[];
  /** Real executed trades to pin as B/S markers. Rendered on both the expanded
   *  chart (with always-on labels) and the small grid charts (compact dots,
   *  hover-only tooltip). */
  trades?: TradeMark[];
  /** Commit a newly placed drawing up to the parent (which persists it). */
  onAddDrawing?: (d: Drawing) => void;
  /** Delete the drawing at this index (eraser tool). */
  onDeleteDrawing?: (index: number) => void;
  /** Paint every candle a single colour (up/down ignored) — used for the
   *  purple index tile on the Themes grid. */
  monoColor?: string;
  /** Drop the volume panel entirely (indices carry no volume). */
  hideVolume?: boolean;
  /** User price alerts to draw as green (armed) / orange (triggered) lines. */
  alerts?: AlertLine[];
  /** Click-to-place handler for the "alert" tool: the price at the cursor Y. */
  onPlaceAlert?: (price: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);
  // Live draft while drawing an hline/trend (pixel coords).
  const [draft, setDraft] = useState<Draft | null>(null);
  // Two-click placement (not drag): "placing" = first point set, second click
  // pending; "done" = both points fixed; next click starts fresh.
  const phaseRef = useRef<"idle" | "placing" | "done">("idle");

  const measureMode = tool === "measure";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measureFn = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measureFn();
    const ro = new ResizeObserver(measureFn);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Switching tool (or disarming) clears the transient measure + draft state.
  useEffect(() => {
    setMeasure(null);
    setDraft(null);
    phaseRef.current = "idle";
  }, [tool]);

  const data = (candles ?? []).filter(
    (c) => c.o != null && c.h != null && c.l != null && c.c != null,
  );

  function localPos(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  const drawMode = tool === "hline" || tool === "trend" || tool === "alert";
  const armed = interactive || tool !== "none";

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || data.length < 2) return;
    // Ruler in "placing" mode: the second point tracks the cursor live until the
    // next click fixes it. No mouse button needs to be held.
    if (measureMode && phaseRef.current === "placing") {
      const p = localPos(e);
      setMeasure((m) => (m ? { ...m, x1: p.x, y1: p.y } : null));
      return;
    }
    // hline / trend draft: preview follows the cursor.
    if (drawMode) {
      const p = localPos(e);
      setDraft((d) => ({ tool, x: p.x, y: p.y, sx: d?.sx ?? null, sy: d?.sy ?? null }));
      return;
    }
    if (!interactive) return;
    // Plain hover crosshair (interactive, no tool armed).
    const rect = el.getBoundingClientRect();
    const plotW = size.w - mR - mL;
    if (plotW <= 0) return;
    const slot = plotW / data.length;
    const idx = Math.floor((e.clientX - rect.left - mL) / slot);
    setHover(Math.max(0, Math.min(data.length - 1, idx)));
  }

  // Click to drop a point. Behaviour depends on the armed tool.
  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (data.length < 2 || size.w <= 20 || size.h <= 20) return;
    const p = localPos(e);
    const geom = computeGeom(data, size.w, size.h, hideVolume);

    if (tool === "measure") {
      if (phaseRef.current === "placing") {
        setMeasure((m) => (m ? { ...m, x1: p.x, y1: p.y } : null));
        phaseRef.current = "done";
      } else {
        setHover(null);
        setMeasure({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        phaseRef.current = "placing";
      }
      return;
    }

    if (tool === "hline") {
      onAddDrawing?.({ kind: "hline", price: geom.priceAt(p.y) });
      return;
    }

    if (tool === "alert") {
      onPlaceAlert?.(geom.priceAt(p.y));
      return;
    }

    if (tool === "trend") {
      if (draft?.sx == null) {
        // First point: remember it; the segment previews to the cursor.
        setDraft({ tool, x: p.x, y: p.y, sx: p.x, sy: p.y });
      } else {
        const i0 = geom.idxAt(draft.sx);
        const i1 = geom.idxAt(p.x);
        onAddDrawing?.({
          kind: "trend",
          d0: data[i0].d,
          p0: geom.priceAt(draft.sy!),
          d1: data[i1].d,
          p1: geom.priceAt(p.y),
        });
        setDraft(null);
      }
      return;
    }

    if (tool === "erase") {
      // Delete the nearest drawing within a small pixel threshold of the click.
      const THRESH = 8;
      let bestIdx = -1;
      let bestDist = THRESH;
      drawings.forEach((d, i) => {
        let dist = Infinity;
        if (d.kind === "hline") {
          dist = Math.abs(p.y - geom.yP(d.price));
        } else if (d.kind === "trend") {
          const x0 = geom.cx(idxForDate(data, d.d0));
          const y0 = geom.yP(d.p0);
          const x1 = geom.cx(idxForDate(data, d.d1));
          const y1 = geom.yP(d.p1);
          dist = distToSegment(p.x, p.y, x0, y0, x1, y1);
        }
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0) onDeleteDrawing?.(bestIdx);
      return;
    }
  }

  return (
    <div
      ref={ref}
      className={`h-full w-full ${armed ? "select-none" : ""}`}
      style={armed ? { cursor: "crosshair" } : undefined}
      onMouseMove={armed ? onMove : undefined}
      onClick={interactive && tool !== "none" ? onClick : undefined}
      onMouseLeave={
        interactive ? () => { setHover(null); setDraft(null); } : undefined
      }
    >
      {data.length < 2 ? (
        <div className="flex h-full w-full items-center justify-center muted-text text-[11px] italic">
          no price history
        </div>
      ) : size.w > 20 && size.h > 20 ? (
        renderChart(
          data,
          size.w,
          size.h,
          interactive && tool === "none" ? hover : null,
          weekly,
          measure,
          drawings,
          interactive,
          drawMode ? draft : null,
          monoColor,
          hideVolume,
          trades,
          alerts,
        )
      ) : null}
    </div>
  );
}

function renderChart(
  data: Candle[],
  W: number,
  H: number,
  hoverIdx: number | null,
  weekly: boolean,
  measure?: Measure | null,
  drawings: Drawing[] = EMPTY_DRAWINGS,
  showTrend = false,
  draft: Draft | null = null,
  monoColor?: string,
  hideVolume = false,
  trades: TradeMark[] = EMPTY_TRADES,
  alerts: AlertLine[] = EMPTY_ALERTS,
) {
  const plotL = mL;
  const plotR = W - mR;
  const plotW = plotR - plotL;
  const priceTop = mT;
  const priceBot = hideVolume ? H - mB : mT + (H - mT - mB) * 0.7;
  const volTop = priceBot + 12;
  const volBot = H - mB;

  const n = data.length;
  let pMin = Math.min(...data.map((c) => c.l));
  let pMax = Math.max(...data.map((c) => c.h));
  if (pMin === pMax) {
    pMin -= 1;
    pMax += 1;
  }
  const pad = (pMax - pMin) * 0.04;
  const lo = pMin - pad;
  const hi = pMax + pad;
  const vMax = Math.max(1, ...data.map((c) => c.v || 0));

  const slot = plotW / n;
  const bodyW = Math.max(1, slot * 0.62);
  const cx = (i: number) => plotL + slot * (i + 0.5);
  const yP = (v: number) => priceTop + (1 - (v - lo) / (hi - lo)) * (priceBot - priceTop);
  const yV = (v: number) => volBot - (v / vMax) * (volBot - volTop);
  // Inverse of yP: the price at a pixel Y — labels the alert draft line.
  const priceAtY = (y: number) => lo + (1 - (y - priceTop) / (priceBot - priceTop)) * (hi - lo);

  const last = data[n - 1];
  const hiY = yP(pMax);
  const loY = yP(pMin);

  const priceTicks = niceTicks(lo, hi, Math.max(3, Math.min(6, Math.floor((priceBot - priceTop) / 42))));

  const spanDays = (new Date(last.d).getTime() - new Date(data[0].d).getTime()) / 86_400_000;
  const longSpan = spanDays > 200;
  const nx = Math.max(2, Math.min(6, Math.floor(plotW / 92)));
  const xIdx: number[] = [];
  for (let k = 0; k < nx; k++) xIdx.push(Math.round((k / (nx - 1)) * (n - 1)));

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
      {/* price (Y) gridlines + labels */}
      {priceTicks.map((t) => {
        const y = yP(t);
        if (y < priceTop - 1 || y > priceBot + 1) return null;
        return (
          <g key={`py-${t}`}>
            <line x1={plotL} y1={y} x2={plotR} y2={y} stroke={GRID} strokeWidth={1} opacity={0.5} />
            <text x={plotL - 5} y={y + 3} textAnchor="end" fontSize={9.5} fill={AXIS}>
              {fmtPrice(t)}
            </text>
          </g>
        );
      })}

      {/* period high (green) / low (red) rules */}
      <line x1={plotL} y1={hiY} x2={plotR} y2={hiY} stroke={GREEN} strokeDasharray="3 3" strokeWidth={1} opacity={0.6} />
      <line x1={plotL} y1={loY} x2={plotR} y2={loY} stroke={RED} strokeDasharray="3 3" strokeWidth={1} opacity={0.6} />

      {/* period high / low VALUE labels, pinned at the left edge on their rules.
          High sits just below its line (near the top), low just above its line
          (near the bottom), so neither clips off-chart. A paper pill keeps them
          legible over gridlines/candles. */}
      {(() => {
        const hiTag = fmtPrice(pMax);
        const loTag = fmtPrice(pMin);
        const hiTw = 6.6 * hiTag.length + 8;
        const loTw = 6.6 * loTag.length + 8;
        const hiTy = hiY + 11;
        const loTy = loY - 4;
        return (
          <g pointerEvents="none">
            <rect x={plotL} y={hiTy - 9} width={hiTw} height={12} rx={2} fill="var(--color-paper, #fbfbfd)" opacity={0.82} />
            <text x={plotL + 3} y={hiTy} textAnchor="start" fontSize={9.5} fontWeight={700} fill={GREEN}>{hiTag}</text>
            <rect x={plotL} y={loTy - 9} width={loTw} height={12} rx={2} fill="var(--color-paper, #fbfbfd)" opacity={0.82} />
            <text x={plotL + 3} y={loTy} textAnchor="start" fontSize={9.5} fontWeight={700} fill={RED}>{loTag}</text>
          </g>
        );
      })()}

      {/* candles + volume, one x-slot per session */}
      {data.map((c, i) => {
        const up = c.c >= c.o;
        const color = monoColor ?? (up ? GREEN : RED);
        const x = cx(i);
        const top = Math.min(yP(c.o), yP(c.c));
        const bh = Math.max(1, Math.abs(yP(c.c) - yP(c.o)));
        const vt = yV(c.v || 0);
        return (
          <g key={c.d}>
            <line x1={x} y1={yP(c.h)} x2={x} y2={yP(c.l)} stroke={color} strokeWidth={1} />
            <rect x={x - bodyW / 2} y={top} width={bodyW} height={bh} fill={color} opacity={up ? 0.85 : 0.9} />
            {!hideVolume && (
              <rect x={x - bodyW / 2} y={vt} width={bodyW} height={Math.max(0, volBot - vt)} fill={color} opacity={0.62} />
            )}
          </g>
        );
      })}

      {/* volume panel: top separator, baseline, and gutter labels */}
      {!hideVolume && (
        <>
          <line x1={plotL} y1={volTop} x2={plotR} y2={volTop} stroke={GRID} strokeWidth={1} opacity={0.5} />
          <line x1={plotL} y1={volBot} x2={plotR} y2={volBot} stroke={GRID} strokeWidth={1} opacity={0.7} />
          <text x={plotL - 5} y={volTop + 8} textAnchor="end" fontSize={8.5} fill={AXIS}>
            {fmtVol(vMax)}
          </text>
          <text x={plotL - 5} y={volBot - 1} textAnchor="end" fontSize={8.5} fill={AXIS} fontWeight={600}>
            {weekly ? "Vol/wk" : "Vol"}
          </text>
        </>
      )}

      {/* date (X) labels */}
      {xIdx.map((i, k) => {
        const anchor = k === 0 ? "start" : k === xIdx.length - 1 ? "end" : "middle";
        const tx = k === 0 ? plotL : k === xIdx.length - 1 ? plotR : cx(i);
        return (
          <text key={`xd-${i}-${k}`} x={tx} y={H - 6} textAnchor={anchor} fontSize={9.5} fill={AXIS}>
            {fmtDate(data[i].d, longSpan)}
          </text>
        );
      })}

      {/* saved drawings: hlines everywhere, trend lines on the expanded chart */}
      {drawings.map((d, i) => {
        if (d.kind === "hline") {
          const y = yP(d.price);
          if (y < priceTop - 1 || y > priceBot + 1) return null; // off current price window
          const tag = fmtPrice(d.price);
          // Label sits just ABOVE the line at the LEFT edge — the right side is
          // where the latest price action lives, so a right-aligned tag sat on
          // top of the candles and was hard to read. A small paper-coloured pill
          // behind it keeps it legible over gridlines/bars. Nudge below the line
          // if the level is near the very top so the text never clips off-chart.
          const ty = y - priceTop < 12 ? y + 12 : y - 5;
          const tw = 6.6 * tag.length + 8;
          return (
            <g key={`dl-${i}`} pointerEvents="none">
              <line x1={plotL} y1={y} x2={plotR} y2={y} stroke={ACCENT} strokeWidth={1.2} strokeDasharray="5 3" opacity={0.85} />
              <rect x={plotL} y={ty - 9} width={tw} height={12} rx={2} fill="var(--color-paper, #fbfbfd)" opacity={0.82} />
              <text x={plotL + 3} y={ty} textAnchor="start" fontSize={9.5} fontWeight={700} fill={ACCENT}>{tag}</text>
            </g>
          );
        }
        if (d.kind === "trend" && showTrend) {
          const x0 = cx(idxForDate(data, d.d0));
          const x1 = cx(idxForDate(data, d.d1));
          return (
            <line key={`dl-${i}`} pointerEvents="none" x1={x0} y1={yP(d.p0)} x2={x1} y2={yP(d.p1)} stroke={ACCENT} strokeWidth={1.6} opacity={0.9} />
          );
        }
        return null;
      })}

      {/* price alerts: green (armed) / orange (triggered) horizontal lines, each
          with an "A" pill on the RIGHT edge so they don't collide with the
          left-anchored hline tags. Solid (not dashed) to read as a live target. */}
      {alerts.map((a, i) => {
        const y = yP(a.price);
        if (y < priceTop - 1 || y > priceBot + 1) return null;
        const color = a.status === "triggered" ? ALERT_TRIGGERED : ALERT_ARMED;
        const tag = fmtPrice(a.price);
        const tw = 6.6 * tag.length + 20;
        if (!showTrend) {
          // Small grid card: pin the "A + price" pill to the LEFT edge, sitting
          // ABOVE the line (flips just below when the line hugs the top so it
          // never clips off-canvas).
          const above = y - priceTop >= 16;
          const ry = above ? y - 15 : y + 3;
          const ty = ry + 10;
          return (
            <g key={`al-${i}`} pointerEvents="none">
              <line x1={plotL} y1={y} x2={plotR} y2={y} stroke={color} strokeWidth={1.3} opacity={0.9} />
              <rect x={plotL} y={ry} width={tw} height={12} rx={2} fill={color} opacity={0.92} />
              <text x={plotL + 3} y={ty} textAnchor="start" fontSize={9.5} fontWeight={800} fill="#fff">A</text>
              <text x={plotL + tw - 3} y={ty} textAnchor="end" fontSize={9.5} fontWeight={700} fill="#fff">{tag}</text>
            </g>
          );
        }
        // Big chart: "A + price" pill on the RIGHT edge (clear of left hline tags).
        const ty = y - priceTop < 12 ? y + 12 : y - 5;
        return (
          <g key={`al-${i}`} pointerEvents="none">
            <line x1={plotL} y1={y} x2={plotR} y2={y} stroke={color} strokeWidth={1.3} opacity={0.9} />
            <rect x={plotR - tw} y={ty - 9} width={tw} height={12} rx={2} fill={color} opacity={0.92} />
            <text x={plotR - tw + 3} y={ty} textAnchor="start" fontSize={9.5} fontWeight={800} fill="#fff">A</text>
            <text x={plotR - 3} y={ty} textAnchor="end" fontSize={9.5} fontWeight={700} fill="#fff">{tag}</text>
          </g>
        );
      })}

      {/* real executed trades: B pinned below the bar's low, S above its high.
          Anchored by date (bar high/low), so split-adjustment can't misplace.
          Each marker is hit-testable so its <title> hover tooltip fires; when
          few enough are in view we also stamp an always-on "B qty @ price" label
          (skipped on dense windows to avoid a wall of overlapping text). */}
      {(() => {
        // Small grid charts render compact markers (smaller dot, no always-on
        // label) — hover still shows the full "Buy qty @ price" tooltip.
        const compact = !showTrend;
        const off = compact ? 9 : 13;
        const r = compact ? 5 : 7;
        const firstD = data[0]?.d;
        const lastD = data[data.length - 1]?.d;
        const drawn = trades
          .map((t) => {
            // A synthetic (snapshot-inferred) buy is date-approximate; if it falls
            // outside the loaded window, idxForDate would clamp it to an edge bar —
            // a lie. Suppress it instead; it reappears when the window is widened.
            if (t.derived && firstD && lastD && (t.d < firstD || t.d > lastD)) return null;
            const idx = idxForDate(data, t.d);
            const c = data[idx];
            if (!c) return null;
            const buy = t.side === "B";
            const barY = buy ? yP(c.l) : yP(c.h);
            const cy = buy
              ? Math.min(barY + off, priceBot - 8)
              : Math.max(barY - off, priceTop + 8);
            return { t, x: cx(idx), barY, cy, buy, col: buy ? BUY_COL : SELL_COL };
          })
          .filter((m): m is NonNullable<typeof m> => m !== null);
        // Always-on labels only on the expanded chart, and only when uncluttered;
        // small charts rely on hover to avoid a wall of overlapping text.
        const showLabels = !compact && drawn.length <= 10;
        return drawn.map((m, i) => {
          const { t, x, barY, cy, buy, col } = m;
          const derived = t.derived === true;
          // Synthetic (snapshot-inferred) buys read differently: "≈" + a note the
          // date is a guess, and they're drawn faded/hollow so a real trade stands out.
          const tip = derived
            ? `≈ Buy ${t.qty} @ ${fmtPrice(t.price)} · ${t.d} (inferred from holding — date approx.)`
            : `${buy ? "Buy" : "Sell"} ${t.qty} @ ${fmtPrice(t.price)} · ${t.d}`;
          const label = `${derived ? "≈ " : ""}${t.side} ${t.qty} @ ${fmtPrice(t.price)}`;
          const ly = buy ? cy + 15 : cy - 15;
          return (
            <g key={`tx-${i}-${t.d}-${t.side}`} opacity={derived ? 0.75 : 1}>
              <line
                pointerEvents="none"
                x1={x} y1={barY} x2={x} y2={cy}
                stroke={col} strokeWidth={1} opacity={0.55}
                strokeDasharray={derived ? "2 2" : undefined}
              />
              {/* interactive dot (pointer-events on) → native title tooltip on hover.
                  Derived markers are hollow (fill washed out, dashed ring) to signal a guess. */}
              <circle
                cx={x} cy={cy} r={r}
                fill={col}
                fillOpacity={derived ? 0.28 : 1}
                stroke={derived ? col : CARD}
                strokeWidth={derived ? 1.4 : 1.2}
                strokeDasharray={derived ? "2.4 2" : undefined}
              >
                <title>{tip}</title>
              </circle>
              <text pointerEvents="none" x={x} y={cy + (compact ? 2.6 : 3.3)} textAnchor="middle" fontSize={compact ? 7.5 : 9.5} fontWeight={800} fill={derived ? col : "#fff"}>
                {t.side}
              </text>
              {showLabels && (
                <text
                  pointerEvents="none"
                  x={x}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline={buy ? "hanging" : "auto"}
                  fontSize={9}
                  fontWeight={700}
                  fill={col}
                  stroke={CARD}
                  strokeWidth={2.6}
                  paintOrder="stroke"
                  style={{ strokeLinejoin: "round" }}
                >
                  {label}
                </text>
              )}
            </g>
          );
        });
      })()}

      {/* live draft preview while placing an hline / trend / alert */}
      {draft && (draft.tool === "hline" ? (
        <line pointerEvents="none" x1={plotL} y1={draft.y} x2={plotR} y2={draft.y} stroke={ACCENT} strokeWidth={1.2} strokeDasharray="5 3" opacity={0.6} />
      ) : draft.tool === "trend" && draft.sx != null ? (
        <line pointerEvents="none" x1={draft.sx} y1={draft.sy!} x2={draft.x} y2={draft.y} stroke={ACCENT} strokeWidth={1.4} strokeDasharray="4 3" opacity={0.7} />
      ) : draft.tool === "alert" ? (() => {
        // Green follow line + a price pill on the right so you can read the
        // exact level before clicking to place the alert.
        const y = Math.max(priceTop, Math.min(priceBot, draft.y));
        const tag = fmtPrice(priceAtY(y));
        const tw = 6.6 * tag.length + 20;
        return (
          <g pointerEvents="none">
            <line x1={plotL} y1={y} x2={plotR} y2={y} stroke={ALERT_ARMED} strokeWidth={1.3} strokeDasharray="5 3" opacity={0.9} />
            <rect x={plotR - tw} y={y - 9} width={tw} height={13} rx={2} fill={ALERT_ARMED} opacity={0.95} />
            <text x={plotR - tw + 3} y={y + 1} textAnchor="start" fontSize={9.5} fontWeight={800} fill="#fff">A</text>
            <text x={plotR - 3} y={y + 1} textAnchor="end" fontSize={9.5} fontWeight={700} fill="#fff">{tag}</text>
          </g>
        );
      })() : null)}

      {/* hover crosshair + per-bar OHLCV tooltip (interactive mode only) */}
      {hoverIdx != null && data[hoverIdx] && (() => {
        const c = data[hoverIdx];
        const hx = cx(hoverIdx);
        const up = c.c >= c.o;
        const [yy, mm, dd] = c.d.split("-");
        const dateLbl = `${+dd} ${MONTHS[(+mm || 1) - 1]} '${yy.slice(2)}`;
        const boxW = 108;
        const boxH = 86;
        // Put the readout on the side opposite the cursor so it never hides bars.
        const bx = hx > (plotL + plotR) / 2 ? plotL + 6 : plotR - boxW - 6;
        const by = priceTop + 4;
        const lines: [string, string, string][] = [
          ["O", fmtPrice(c.o), AXIS],
          ["H", fmtPrice(c.h), GREEN],
          ["L", fmtPrice(c.l), RED],
          ["C", fmtPrice(c.c), up ? GREEN : RED],
          [weekly ? "Vol/wk" : "Vol", fmtVol(c.v || 0), AXIS],
        ];
        const hy = yP(c.c);
        const priceTag = fmtPrice(c.c);
        const tagW = 6.6 * priceTag.length + 12;
        const dateTagW = 6 * dateLbl.length + 12;
        return (
          <g pointerEvents="none">
            {/* vertical + horizontal crosshair through the hovered bar's close */}
            <line x1={hx} y1={priceTop} x2={hx} y2={volBot} stroke={AXIS} strokeWidth={1} strokeDasharray="2 3" opacity={0.55} />
            <line x1={plotL} y1={hy} x2={plotR} y2={hy} stroke={AXIS} strokeWidth={1} strokeDasharray="2 3" opacity={0.55} />
            <circle cx={hx} cy={hy} r={2.6} fill={up ? GREEN : RED} />
            {/* right-edge price tag at the close */}
            <g>
              <rect x={plotR - tagW} y={hy - 8} width={tagW} height={16} rx={3} fill={up ? GREEN : RED} opacity={0.95} />
              <text x={plotR - tagW / 2} y={hy + 3.5} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#fff">{priceTag}</text>
            </g>
            {/* bottom-edge date tag */}
            <g>
              <rect x={Math.max(plotL, Math.min(plotR - dateTagW, hx - dateTagW / 2))} y={volBot + 2} width={dateTagW} height={15} rx={3} fill={AXIS} opacity={0.9} />
              <text x={Math.max(plotL + dateTagW / 2, Math.min(plotR - dateTagW / 2, hx))} y={volBot + 12.5} textAnchor="middle" fontSize={9} fontWeight={600} fill="#fff">{dateLbl}</text>
            </g>
            <rect x={bx} y={by} width={boxW} height={boxH} rx={5} fill={CARD} stroke={GRID} strokeWidth={1} opacity={0.97} />
            <text x={bx + 8} y={by + 15} fontSize={10} fontWeight={600} fill="var(--color-ink, #111)">
              {dateLbl}
            </text>
            {lines.map(([k, v, color], j) => (
              <g key={k}>
                <text x={bx + 8} y={by + 30 + j * 12} fontSize={9.5} fill={AXIS}>{k}</text>
                <text x={bx + boxW - 8} y={by + 30 + j * 12} textAnchor="end" fontSize={9.5} fontWeight={600} fill={color}>{v}</text>
              </g>
            ))}
          </g>
        );
      })()}

      {/* measure tool: drag-selected range → price move, %, bars/days, volume */}
      {measure && (() => {
        const { x0, y0, x1, y1 } = measure;
        // Invert yP to read the price under the cursor at each end.
        const priceAt = (y: number) => lo + (1 - (y - priceTop) / (priceBot - priceTop)) * (hi - lo);
        const p0 = priceAt(y0);
        const p1 = priceAt(y1);
        const chg = p1 - p0;
        const pct = p0 !== 0 ? (chg / p0) * 100 : 0;
        const up = chg >= 0;
        const clampIdx = (x: number) => Math.max(0, Math.min(n - 1, Math.floor((x - plotL) / slot)));
        const iA = Math.min(clampIdx(x0), clampIdx(x1));
        const iB = Math.max(clampIdx(x0), clampIdx(x1));
        const bars = iB - iA + 1;
        const days = Math.round(
          Math.abs(new Date(data[iB].d).getTime() - new Date(data[iA].d).getTime()) / 86_400_000,
        );
        let vol = 0;
        for (let i = iA; i <= iB; i++) vol += data[i].v || 0;
        const fmtD = (s: string) => {
          const [yy, mm, dd] = s.split("-");
          return `${+dd} ${MONTHS[(+mm || 1) - 1]} '${yy.slice(2)}`;
        };
        const dateRange = `${fmtD(data[iA].d)} → ${fmtD(data[iB].d)}`;

        const rx = Math.min(x0, x1);
        const ry = Math.min(y0, y1);
        const rw = Math.abs(x1 - x0);
        const rh = Math.abs(y1 - y0);
        const col = up ? GREEN : RED;
        const cxm = rx + rw / 2;

        const boxW = 172;
        const boxH = 64;
        let bx = cxm - boxW / 2;
        bx = Math.max(plotL + 2, Math.min(plotR - boxW - 2, bx));
        let by = ry - boxH - 6;
        if (by < priceTop + 2) by = Math.min(y0, y1) + rh + 6; // flip below if no room above
        const sign = up ? "+" : "";
        const l1 = `${sign}${chg.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
        const l2 = `${bars} bars, ${days} calendar days`;
        const l3 = `Vol ${fmtVol(vol)}`;

        return (
          <g pointerEvents="none">
            <rect x={rx} y={ry} width={rw} height={rh} fill={col} fillOpacity={0.12} stroke={col} strokeOpacity={0.5} strokeWidth={1} />
            {/* directional guides: vertical = price move, horizontal = time */}
            <line x1={cxm} y1={y0} x2={cxm} y2={y1} stroke={col} strokeWidth={1.2} opacity={0.8} />
            <line x1={x0} y1={ry + rh / 2} x2={x1} y2={ry + rh / 2} stroke={col} strokeWidth={1} opacity={0.6} strokeDasharray="3 3" />
            <rect x={bx} y={by} width={boxW} height={boxH} rx={5} fill={col} opacity={0.95} />
            <text x={bx + boxW / 2} y={by + 15} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{l1}</text>
            <text x={bx + boxW / 2} y={by + 29} textAnchor="middle" fontSize={9.5} fill="#fff" opacity={0.92}>{dateRange}</text>
            <text x={bx + boxW / 2} y={by + 42} textAnchor="middle" fontSize={9.5} fill="#fff" opacity={0.92}>{l2}</text>
            <text x={bx + boxW / 2} y={by + 55} textAnchor="middle" fontSize={9.5} fill="#fff" opacity={0.92}>{l3}</text>
          </g>
        );
      })()}

      <title>{`${data[0].d} → ${last.d} · ${n} sessions`}</title>
    </svg>
  );
}
