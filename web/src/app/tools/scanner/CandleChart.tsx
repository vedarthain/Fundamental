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

// A drag-selection in pixel coords (relative to the chart container). Powers the
// TradingView-style measure tool: press → drag → release marks a rectangle; the
// price move, %, bar/day count and summed volume across it are read out.
type Measure = { x0: number; y0: number; x1: number; y1: number };

export function CandleChart({
  candles,
  interactive = false,
  weekly = false,
}: {
  candles?: Candle[];
  interactive?: boolean;
  weekly?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measureFn = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measureFn();
    const ro = new ResizeObserver(measureFn);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = (candles ?? []).filter(
    (c) => c.o != null && c.h != null && c.l != null && c.c != null,
  );

  function localPos(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // Map cursor-x → nearest candle slot using the same geometry renderChart uses.
  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || data.length < 2) return;
    if (draggingRef.current) {
      const p = localPos(e);
      setMeasure((m) => (m ? { ...m, x1: p.x, y1: p.y } : null));
      return;
    }
    const rect = el.getBoundingClientRect();
    const plotW = size.w - mR - mL;
    if (plotW <= 0) return;
    const slot = plotW / data.length;
    const idx = Math.floor((e.clientX - rect.left - mL) / slot);
    setHover(Math.max(0, Math.min(data.length - 1, idx)));
  }

  function onDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!interactive || data.length < 2) return;
    e.preventDefault();
    const p = localPos(e);
    draggingRef.current = true;
    setHover(null);
    setMeasure({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  function onUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    // A click (no real drag) clears any existing measurement.
    setMeasure((m) =>
      m && Math.abs(m.x1 - m.x0) < 4 && Math.abs(m.y1 - m.y0) < 4 ? null : m,
    );
  }

  return (
    <div
      ref={ref}
      className={`h-full w-full ${interactive ? "select-none" : ""}`}
      style={interactive ? { cursor: "crosshair" } : undefined}
      onMouseMove={interactive ? onMove : undefined}
      onMouseDown={interactive ? onDown : undefined}
      onMouseUp={interactive ? onUp : undefined}
      onMouseLeave={interactive ? () => { setHover(null); onUp(); } : undefined}
    >
      {data.length < 2 ? (
        <div className="flex h-full w-full items-center justify-center muted-text text-[11px] italic">
          no price history
        </div>
      ) : size.w > 20 && size.h > 20 ? (
        renderChart(data, size.w, size.h, interactive && !measure ? hover : null, weekly, measure)
      ) : null}
    </div>
  );
}

function renderChart(data: Candle[], W: number, H: number, hoverIdx: number | null, weekly: boolean, measure?: Measure | null) {
  const plotL = mL;
  const plotR = W - mR;
  const plotW = plotR - plotL;
  const priceTop = mT;
  const priceBot = mT + (H - mT - mB) * 0.7;
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

      {/* candles + volume, one x-slot per session */}
      {data.map((c, i) => {
        const up = c.c >= c.o;
        const color = up ? GREEN : RED;
        const x = cx(i);
        const top = Math.min(yP(c.o), yP(c.c));
        const bh = Math.max(1, Math.abs(yP(c.c) - yP(c.o)));
        const vt = yV(c.v || 0);
        return (
          <g key={c.d}>
            <line x1={x} y1={yP(c.h)} x2={x} y2={yP(c.l)} stroke={color} strokeWidth={1} />
            <rect x={x - bodyW / 2} y={top} width={bodyW} height={bh} fill={color} opacity={up ? 0.85 : 0.9} />
            <rect x={x - bodyW / 2} y={vt} width={bodyW} height={Math.max(0, volBot - vt)} fill={color} opacity={0.62} />
          </g>
        );
      })}

      {/* volume panel: top separator, baseline, and gutter labels */}
      <line x1={plotL} y1={volTop} x2={plotR} y2={volTop} stroke={GRID} strokeWidth={1} opacity={0.5} />
      <line x1={plotL} y1={volBot} x2={plotR} y2={volBot} stroke={GRID} strokeWidth={1} opacity={0.7} />
      <text x={plotL - 5} y={volTop + 8} textAnchor="end" fontSize={8.5} fill={AXIS}>
        {fmtVol(vMax)}
      </text>
      <text x={plotL - 5} y={volBot - 1} textAnchor="end" fontSize={8.5} fill={AXIS} fontWeight={600}>
        {weekly ? "Vol/wk" : "Vol"}
      </text>

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
        return (
          <g pointerEvents="none">
            <line x1={hx} y1={priceTop} x2={hx} y2={volBot} stroke={AXIS} strokeWidth={1} strokeDasharray="2 3" opacity={0.55} />
            <circle cx={hx} cy={yP(c.c)} r={2.6} fill={up ? GREEN : RED} />
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

        const rx = Math.min(x0, x1);
        const ry = Math.min(y0, y1);
        const rw = Math.abs(x1 - x0);
        const rh = Math.abs(y1 - y0);
        const col = up ? GREEN : RED;
        const cxm = rx + rw / 2;

        const boxW = 150;
        const boxH = 50;
        let bx = cxm - boxW / 2;
        bx = Math.max(plotL + 2, Math.min(plotR - boxW - 2, bx));
        let by = ry - boxH - 6;
        if (by < priceTop + 2) by = Math.min(y0, y1) + rh + 6; // flip below if no room above
        const sign = up ? "+" : "";
        const l1 = `${sign}${chg.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
        const l2 = `${bars} bars, ${days}d`;
        const l3 = `Vol ${fmtVol(vol)}`;

        return (
          <g pointerEvents="none">
            <rect x={rx} y={ry} width={rw} height={rh} fill={col} fillOpacity={0.12} stroke={col} strokeOpacity={0.5} strokeWidth={1} />
            {/* directional guides: vertical = price move, horizontal = time */}
            <line x1={cxm} y1={y0} x2={cxm} y2={y1} stroke={col} strokeWidth={1.2} opacity={0.8} />
            <line x1={x0} y1={ry + rh / 2} x2={x1} y2={ry + rh / 2} stroke={col} strokeWidth={1} opacity={0.6} strokeDasharray="3 3" />
            <rect x={bx} y={by} width={boxW} height={boxH} rx={5} fill={col} opacity={0.95} />
            <text x={bx + boxW / 2} y={by + 16} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{l1}</text>
            <text x={bx + boxW / 2} y={by + 30} textAnchor="middle" fontSize={9.5} fill="#fff" opacity={0.92}>{l2}</text>
            <text x={bx + boxW / 2} y={by + 43} textAnchor="middle" fontSize={9.5} fill="#fff" opacity={0.92}>{l3}</text>
          </g>
        );
      })()}

      <title>{`${data[0].d} → ${last.d} · ${n} sessions`}</title>
    </svg>
  );
}
