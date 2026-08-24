"use client";

/**
 * IndexCandleChart — daily OHLC candlestick chart for one NSE index.
 *
 * Fetches the full daily-OHLC series once per index from /api/indices/ohlc,
 * then slices it in-memory per range button (1W…ALL) so range switching is
 * instant with no refetch. Rendered with lightweight-charts (canvas), which is
 * purpose-built for candles and handles thousands of bars smoothly — Recharts
 * has no native candlestick.
 *
 * EOD-only: there is no 1D/intraday range. Index intraday needs a live
 * authenticated feed (Upstox) we deliberately don't depend on here; the daily
 * NSE driver keeps the last bar current to EOD.
 *
 * Canvas can't read CSS var() strings, so we resolve the theme colours off
 * <html> at mount and re-resolve when the theme attribute flips.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { IndexCandle } from "@/app/api/indices/ohlc/route";

type Range = "1W" | "1M" | "6M" | "1Y" | "3Y" | "5Y" | "10Y" | "ALL";
const RANGES: Range[] = ["1W", "1M", "6M", "1Y", "3Y", "5Y", "10Y", "ALL"];
const RANGE_DAYS: Record<Exclude<Range, "ALL">, number> = {
  "1W": 7, "1M": 30, "6M": 182, "1Y": 365, "3Y": 1095, "5Y": 1825, "10Y": 3650,
};
const RANGE_LABEL: Record<Range, string> = {
  "1W": "1 week", "1M": "1 month", "6M": "6 months", "1Y": "1 year",
  "3Y": "3 years", "5Y": "5 years", "10Y": "10 years", "ALL": "all time",
};

/** Resolve a CSS custom property off <html>, with a hard fallback (canvas can't
 *  use var() strings). */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function themeColors() {
  return {
    up: cssVar("--color-delta-up", "#15803D"),
    down: cssVar("--color-delta-down", "#DC2626"),
    text: cssVar("--color-ink", cssVar("--color-fg", "#1f2937")),
    muted: cssVar("--color-muted", "#6b7280"),
    bg: cssVar("--color-card", "#ffffff"),
    border: cssVar("--color-border-default", "#e5e7eb"),
  };
}

function fmtNum(v: number, dp = 1): string {
  return v.toLocaleString("en-IN", { maximumFractionDigits: dp });
}

export function IndexCandleChart({ code, name }: { code: string; name: string }) {
  const [candles, setCandles] = useState<IndexCandle[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [range, setRange] = useState<Range>("1Y");
  const [themeTick, setThemeTick] = useState(0);

  const holderRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // Fetch full OHLC once per index.
  useEffect(() => {
    let alive = true;
    setState("loading");
    (async () => {
      try {
        const res = await fetch(`/api/indices/ohlc?code=${encodeURIComponent(code)}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { candles: IndexCandle[] };
        if (!alive) return;
        setCandles(json.candles ?? []);
        setState((json.candles?.length ?? 0) >= 2 ? "ok" : "error");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [code]);

  // Re-theme the canvas when the app's theme attribute flips (class or
  // data-theme on <html>). Cheap: just bumps a signal the chart effect reads.
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick((t) => t + 1));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => obs.disconnect();
  }, []);

  // The candles visible for the selected range (anchored on the LAST bar, not
  // "now", so a day-or-two-stale tail still fills the window correctly).
  const visible = useMemo(() => {
    if (candles.length === 0) return [];
    if (range === "ALL") return candles;
    const last = candles[candles.length - 1].time;
    const cutoff = new Date(last);
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
    const cut = cutoff.toISOString().slice(0, 10);
    const sliced = candles.filter((c) => c.time >= cut);
    return sliced.length >= 2 ? sliced : candles.slice(-2);
  }, [candles, range]);

  // Create the chart once the holder is mounted; recreate on theme change.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const c = themeColors();
    const chart = createChart(holder, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: c.bg },
        textColor: c.muted,
        fontFamily: "inherit",
      },
      grid: {
        vertLines: { color: c.border, style: 1 },
        horzLines: { color: c.border, style: 1 },
      },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border, timeVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      handleScale: { axisPressedMouseMove: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: c.up,
      downColor: c.down,
      borderUpColor: c.up,
      borderDownColor: c.down,
      wickUpColor: c.up,
      wickDownColor: c.down,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [themeTick]);

  // Push the visible candles into the series and fit the viewport.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    series.setData(
      visible.map((k) => ({
        time: k.time as unknown as UTCTimestamp, // "YYYY-MM-DD" business day
        open: k.open, high: k.high, low: k.low, close: k.close,
      })),
    );
    chart.timeScale().fitContent();
  }, [visible, themeTick, state]);

  // Headline: latest close + period change over the visible window.
  const last = visible[visible.length - 1];
  const first = visible[0];
  const changePct =
    last && first && first.close > 0 ? (last.close / first.close - 1) * 100 : null;
  const spanYears =
    last && first
      ? (new Date(last.time).getTime() - new Date(first.time).getTime()) /
        (365.25 * 24 * 3600 * 1000)
      : 0;
  const cagr =
    changePct != null && spanYears > 1 && first && first.close > 0
      ? (Math.pow(last!.close / first.close, 1 / spanYears) - 1) * 100
      : null;
  const up = changePct != null && changePct >= 0;

  return (
    <div className="w-full">
      {/* Headline + range tabs */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide muted-text">{name} · OHLC</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="font-display text-[22px] tabular-nums leading-none">
              {last ? fmtNum(last.close) : "—"}
            </span>
            {changePct != null && (
              <span
                className="text-[13px] font-medium tabular-nums"
                style={{ color: up ? "var(--color-delta-up)" : "var(--color-delta-down)" }}
              >
                {up ? "+" : ""}{changePct.toFixed(2)}%
                <span className="muted-text font-normal ml-1">
                  {cagr != null ? `· ${cagr.toFixed(1)}% CAGR` : `· ${RANGE_LABEL[range]}`}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {RANGES.map((r) => {
            const active = r === range;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className="px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors"
                style={
                  active
                    ? {
                        background: "var(--color-accent-50)",
                        color: "var(--color-accent-700)",
                        border: "1px solid var(--color-accent-300)",
                      }
                    : {
                        background: "transparent",
                        color: "var(--color-muted)",
                        border: "1px solid var(--color-border-default)",
                      }
                }
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart / states. The holder always renders so the chart ref can attach;
          overlays cover it while loading/empty. */}
      <div className="relative">
        <div ref={holderRef} className="w-full h-[340px]" />
        {state === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center muted-text text-[13px]">
            Loading candles…
          </div>
        )}
        {state === "error" && (
          <div className="absolute inset-0 flex items-center justify-center muted-text text-[13px]">
            No price history for this index.
          </div>
        )}
      </div>
    </div>
  );
}
