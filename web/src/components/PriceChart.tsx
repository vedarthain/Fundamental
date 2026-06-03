"use client";
import { useState, useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

export type PricePoint = { date: string; close: number };

type Range = "1D" | "1W" | "1M" | "3M" | "1Y" | "3Y" | "5Y" | "10Y" | "ALL";

/** Lookback in calendar days. 1D is special-cased below to grab the last 2
 *  daily closes so we always have at least a 2-point line. */
const RANGE_DAYS: Record<Exclude<Range, "1D" | "ALL">, number> = {
  "1W":  7,
  "1M":  30,
  "3M":  90,
  "1Y":  365,
  "3Y":  365 * 3,
  "5Y":  365 * 5,
  "10Y": 365 * 10,
};

const RANGES: Range[] = ["1D", "1W", "1M", "3M", "1Y", "3Y", "5Y", "10Y", "ALL"];

export function PriceChart({
  data,
  currentPrice,
  priceFetchedAt,
}: {
  data: PricePoint[];
  currentPrice?: number;
  priceFetchedAt?: string;
}) {
  const [range, setRange] = useState<Range>("1Y");

  // Filter the full daily series down to the selected range.
  const filtered = useMemo(() => {
    if (data.length === 0) return [];
    if (range === "ALL") return data;
    if (range === "1D") {
      // For 1D: show yesterday's EOD close → today's live price (if available).
      // Falls back to last 2 EOD closes when the pinger hasn't run yet today.
      // Use the raw ISO timestamp (priceFetchedAt or todayIso) as the date
      // field so new Date() can parse it; the tickFormatter converts it to
      // a readable time label.
      const base = data.slice(-1);          // yesterday's close
      if (currentPrice != null && base.length > 0) {
        const todayIso = new Date().toISOString().slice(0, 10);
        if (todayIso > base[0].date) {
          const dateField = priceFetchedAt ?? `${todayIso}T15:30:00+05:30`;
          return [...base, { date: dateField, close: currentPrice }];
        }
      }
      return data.slice(-2);               // fallback: last 2 EOD closes
    }
    const days = RANGE_DAYS[range as Exclude<Range, "1D" | "ALL">];
    const cutoff = Date.now() - days * 86_400_000;
    const sliced = data.filter((p) => new Date(p.date).getTime() >= cutoff);
    // If the range is so short there's no data (e.g. 1W on a freshly-listed
    // stock), fall back to the last few points so the chart doesn't go blank.
    return sliced.length >= 2 ? sliced : data.slice(-Math.max(2, Math.ceil(days / 7)));
  }, [data, range, currentPrice, priceFetchedAt]);

  // Direction colour — green if last close ≥ first close in the visible range,
  // red if it dropped. Uses our existing earthy score palette.
  const positive =
    filtered.length >= 2 && filtered[filtered.length - 1].close >= filtered[0].close;
  const stroke = positive ? "var(--color-score-excellent)" : "var(--color-score-poor)";
  const fillStop = positive ? "var(--color-score-good)" : "var(--color-score-weak)";

  // Headline numbers — current price + period change.
  const last = filtered[filtered.length - 1]?.close;
  const first = filtered[0]?.close;
  const changeAbs = last != null && first != null ? last - first : null;
  const changePct = changeAbs != null && first ? (changeAbs / first) * 100 : null;

  if (data.length === 0) {
    return (
      <div className="h-[260px] flex items-center justify-center muted-text text-[13px]">
        No price history available.
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Range tabs + headline stats */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          {last != null && (
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] font-medium tabular-nums">
                ₹{last.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
              {changeAbs != null && changePct != null && (
                <span
                  className="text-[12px] font-medium tabular-nums"
                  style={{ color: stroke }}
                >
                  {changeAbs >= 0 ? "+" : ""}
                  {changeAbs.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  {"  "}
                  ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
                </span>
              )}
              <span className="text-[10.5px] muted-text uppercase tracking-wide">
                {range === "1D" ? "1 day" : range === "ALL" ? "all time" : range}
              </span>
            </div>
          )}
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

      <ResponsiveContainer width="100%" height={260} minWidth={0}>
        <AreaChart data={filtered} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fillStop} stopOpacity={0.32} />
              <stop offset="100%" stopColor={fillStop} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tickFormatter={(d) => {
              const dt = new Date(d);
              // Determine the actual span of the visible data (not the selected
              // range button) so we pick a label format that avoids duplicates.
              // e.g. 3Y selected but stock only has 3 months of data → all ticks
              // would be "2026" with year-only format. Instead, detect the real
              // span and fall back to month+year when it's ≤ 18 months.
              const spanDays =
                filtered.length >= 2
                  ? (new Date(filtered[filtered.length - 1].date).getTime() -
                      new Date(filtered[0].date).getTime()) /
                    86_400_000
                  : 0;

              if (range === "1D" || range === "1W" || range === "1M" || spanDays <= 31) {
                // For the live intraday point (a full ISO timestamp, not just
                // a date), show the time in IST instead of the date.
                if (range === "1D" && d.length > 10) {
                  return new Intl.DateTimeFormat("en-IN", {
                    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
                  }).format(dt);
                }
                return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
              }
              if (range === "3M" || range === "1Y" || spanDays <= 548 /* ~18 months */) {
                return dt.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
              }
              // True multi-year span: year-only is safe (won't duplicate).
              return String(dt.getFullYear());
            }}
            interval="preserveStartEnd"
            minTickGap={50}
            tick={{ fontSize: 11, fill: "var(--color-muted)" }}
            axisLine={{ stroke: "var(--color-border-default)" }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => `₹${Math.round(v).toLocaleString("en-IN")}`}
            tick={{ fontSize: 11, fill: "var(--color-muted)" }}
            axisLine={false}
            tickLine={false}
            width={64}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border-default)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(d) => {
              const s = String(d ?? "");
              if (range === "1D" && s.length > 10) {
                // Live intraday point — show time in IST
                return new Intl.DateTimeFormat("en-IN", {
                  timeZone: "Asia/Kolkata",
                  hour: "2-digit", minute: "2-digit", hour12: false,
                }).format(new Date(s)) + " IST (live)";
              }
              return new Date(s).toLocaleDateString("en-IN", {
                day: "numeric", month: "short", year: "numeric",
              });
            }}
            formatter={(v: unknown) => [
              `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 })}`,
              "Close",
            ]}
          />
          <Area
            type="monotone"
            dataKey="close"
            stroke={stroke}
            strokeWidth={2}
            fill="url(#priceFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
