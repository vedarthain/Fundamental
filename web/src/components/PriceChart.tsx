"use client";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

export type PricePoint = { date: string; close: number };

export function PriceChart({ data }: { data: PricePoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[260px] flex items-center justify-center muted-text text-[13px]">
        No price history available.
      </div>
    );
  }
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent-400)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-accent-400)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tickFormatter={(d) => {
              const dt = new Date(d);
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
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border-default)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(d) =>
              new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
            }
            formatter={(v: unknown) => [`₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 })}`, "Close"]}
          />
          <Area
            type="monotone"
            dataKey="close"
            stroke="var(--color-accent-500)"
            strokeWidth={2}
            fill="url(#priceFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
