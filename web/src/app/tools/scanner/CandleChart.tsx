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

function fmtDate(iso: string, longSpan: boolean): string {
  const [y, m, d] = iso.split("-");
  const mon = MONTHS[(+m || 1) - 1];
  return longSpan ? `${mon} '${y.slice(2)}` : `${+d} ${mon}`;
}

export function CandleChart({ candles }: { candles?: Candle[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = (candles ?? []).filter(
    (c) => c.o != null && c.h != null && c.l != null && c.c != null,
  );

  return (
    <div ref={ref} className="h-full w-full">
      {data.length < 2 ? (
        <div className="flex h-full w-full items-center justify-center muted-text text-[11px] italic">
          no price history
        </div>
      ) : size.w > 20 && size.h > 20 ? (
        renderChart(data, size.w, size.h)
      ) : null}
    </div>
  );
}

function renderChart(data: Candle[], W: number, H: number) {
  const mL = 46; // y-axis price gutter
  const mR = 8;
  const mT = 8;
  const mB = 20; // x-axis date gutter
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
            <rect x={x - bodyW / 2} y={vt} width={bodyW} height={Math.max(0, volBot - vt)} fill={color} opacity={0.38} />
          </g>
        );
      })}

      {/* volume baseline */}
      <line x1={plotL} y1={volBot} x2={plotR} y2={volBot} stroke={GRID} strokeWidth={1} opacity={0.7} />

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

      <title>{`${data[0].d} → ${last.d} · ${n} sessions`}</title>
    </svg>
  );
}
