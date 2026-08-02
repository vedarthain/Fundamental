/**
 * CandleChart — pure-SVG candlestick + volume panel for the Graph tab.
 *
 * Fills its container (width/height 100%) via a fixed coordinate space and
 * preserveAspectRatio="none", so a 2×2 grid of these uses the whole viewport.
 * Strokes are non-scaling (wicks/borders stay 1px crisp regardless of the
 * cell's aspect ratio). Prices are the split-safe (adjusted) OHLC from
 * lib/candles; volume sits in a short panel underneath sharing the x-grid.
 *
 * No client hooks — it's a dumb renderer; the parent owns data + interaction.
 */
import type { Candle } from "@/lib/candles";

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";

// Coordinate space (stretched to the cell). Price occupies the top ~70%,
// volume the bottom ~22%, with a gap between.
const W = 1000;
const H = 1000;
const PAD_X = 6;
const PRICE_TOP = 6;
const PRICE_BOT = 706;
const VOL_TOP = 762;
const VOL_BOT = 992;

export function CandleChart({ candles }: { candles?: Candle[] }) {
  const data = (candles ?? []).filter(
    (c) => c.o != null && c.h != null && c.l != null && c.c != null,
  );
  if (data.length < 2) {
    return (
      <div className="flex h-full w-full items-center justify-center muted-text text-[11px] italic">
        no price history
      </div>
    );
  }

  const n = data.length;
  let pMin = Math.min(...data.map((c) => c.l));
  let pMax = Math.max(...data.map((c) => c.h));
  if (pMin === pMax) {
    pMin -= 1;
    pMax += 1;
  }
  const pRange = pMax - pMin;
  const pPad = pRange * 0.04;
  const lo = pMin - pPad;
  const hi = pMax + pPad;
  const vMax = Math.max(1, ...data.map((c) => c.v || 0));

  const slot = (W - 2 * PAD_X) / n;
  const bodyW = Math.max(1.2, slot * 0.62);
  const cx = (i: number) => PAD_X + slot * (i + 0.5);
  const yP = (v: number) => PRICE_TOP + (1 - (v - lo) / (hi - lo)) * (PRICE_BOT - PRICE_TOP);
  const yV = (v: number) => VOL_BOT - (v / vMax) * (VOL_BOT - VOL_TOP);

  const last = data[data.length - 1];
  const lastY = yP(last.c);
  // Period high / low guide rules (the true extremes, before the 4% padding).
  const hiY = yP(pMax);
  const loY = yP(pMin);

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block"
    >
      {/* faint last-close guide across the price panel */}
      <line
        x1={PAD_X}
        y1={lastY}
        x2={W - PAD_X}
        y2={lastY}
        stroke="var(--color-border-default)"
        strokeDasharray="2 4"
        strokeWidth={1}
        opacity={0.5}
        vectorEffect="non-scaling-stroke"
      />
      {/* period high (green) and low (red) rules */}
      <line
        x1={PAD_X}
        y1={hiY}
        x2={W - PAD_X}
        y2={hiY}
        stroke={GREEN}
        strokeDasharray="3 3"
        strokeWidth={1}
        opacity={0.55}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={PAD_X}
        y1={loY}
        x2={W - PAD_X}
        y2={loY}
        stroke={RED}
        strokeDasharray="3 3"
        strokeWidth={1}
        opacity={0.55}
        vectorEffect="non-scaling-stroke"
      />
      {data.map((c, i) => {
        const up = c.c >= c.o;
        const color = up ? GREEN : RED;
        const x = cx(i);
        const yHigh = yP(c.h);
        const yLow = yP(c.l);
        const yOpen = yP(c.o);
        const yClose = yP(c.c);
        const top = Math.min(yOpen, yClose);
        const h = Math.max(1, Math.abs(yClose - yOpen));
        const vTop = yV(c.v || 0);
        return (
          <g key={c.d}>
            {/* wick */}
            <line
              x1={x}
              y1={yHigh}
              x2={x}
              y2={yLow}
              stroke={color}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {/* body */}
            <rect
              x={x - bodyW / 2}
              y={top}
              width={bodyW}
              height={h}
              fill={color}
              opacity={up ? 0.85 : 0.9}
            />
            {/* volume */}
            <rect
              x={x - bodyW / 2}
              y={vTop}
              width={bodyW}
              height={Math.max(0, VOL_BOT - vTop)}
              fill={color}
              opacity={0.4}
            />
          </g>
        );
      })}
      {/* volume baseline */}
      <line
        x1={PAD_X}
        y1={VOL_BOT}
        x2={W - PAD_X}
        y2={VOL_BOT}
        stroke="var(--color-border-default)"
        strokeWidth={1}
        opacity={0.6}
        vectorEffect="non-scaling-stroke"
      />
      <title>{`${data[0].d} → ${last.d} · ${n} sessions`}</title>
    </svg>
  );
}
