"use client";

/**
 * MarketClient — visual /market overview (compact layout).
 *
 * Design goals:
 *   - Density over decoration. Hero chart compact (~150px), tiles small,
 *     movers as a 5-row sparkline list, not 10-row barchart.
 *   - Every numeric card has a chart, none are text-only.
 *   - Distinct cluster + quality context on every mover row (the moat
 *     vs commodity market pages).
 *
 * Layout (desktop):
 *
 *   ┌─ Hero NIFTY 50 area chart + range selector ────────────────────────┐
 *   │ small + dense                                                       │
 *   └─────────────────────────────────────────────────────────────────────┘
 *   ┌─ Index sparkline strip (broad + sectoral) ─────────────────────────┐
 *   └─────────────────────────────────────────────────────────────────────┘
 *   ┌─ Top gainers (5) ─┬─ Top losers (5) ─┐  ┌─ A/D donut ──┐
 *   │                   │                  │  ├─ 52W H/L     ┤
 *   │                   │                  │  ├─ Holidays    ┤
 *   └───────────────────┴──────────────────┘  └─ FII/DII bar ┘
 *   ┌─ Sector heatmap ──────────────────────────────────────────────────┐
 *   └────────────────────────────────────────────────────────────────────┘
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/**
 * MountedChart — wraps any recharts ResponsiveContainer tree.
 *
 * Recharts' ResponsiveContainer measures its parent immediately on render.
 * During the first commit (and again under React Strict Mode's double-mount
 * in dev), the parent's computed dimensions can be -1 (hasn't been laid
 * out yet), which makes recharts spam "width(-1) height(-1)" warnings.
 *
 * A simple `setMounted(true)` in useEffect is insufficient because:
 *   1. Strict Mode mounts → unmounts → mounts again, and the chart can
 *      measure -1 on each cycle.
 *   2. Flex children resolve width async; the wrapper div can hold a
 *      brief 0-width state even after first paint.
 *
 * The robust fix is to attach a ResizeObserver to our wrapper and only
 * render children once we've observed BOTH width > 0 and height > 0.
 * From that point on the chart can responsively resize without warnings.
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

    const check = (): boolean => {
      const el = ref.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // Fast path — already laid out at first effect tick.
    if (check()) {
      setReady(true);
      return;
    }

    // Slow path — wait for ResizeObserver to report real dimensions.
    const obs = new ResizeObserver(() => {
      if (!cancelled && check()) {
        setReady(true);
        obs.disconnect();
      }
    });
    obs.observe(ref.current);

    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {ready ? children : null}
    </div>
  );
}
import type {
  OverviewResponse, IndexRow, Mover, SectorHeatRow, FiiPoint, IndexSeriesPoint,
  WeekRangeStat, HolidayItem, MoverUniverse, AdvanceDeclineSet,
  BuildingStrengthRow,
} from "../api/market/overview/route";

const UP    = "var(--color-delta-up)";
const DOWN  = "var(--color-delta-down)";
const INK   = "var(--color-ink)";
const MUTED = "var(--color-muted)";
const ACCENT = "var(--color-accent-600)";

/**
 * Suppress recharts' dev-only "width(-1) height(-1)" warning, which fires
 * during the first measurement cycle of every ResponsiveContainer.  We've
 * already gated chart mounts behind a ResizeObserver-confirmed dimension
 * check, but recharts emits this from its own internal subtree where our
 * wrapper has no influence. The warning is purely cosmetic noise — the
 * charts render correctly once dimensions resolve. Filter only this exact
 * message; everything else (real warnings + errors) passes through.
 *
 * Production builds are unaffected — process.env.NODE_ENV !== 'development'
 * skips the patch entirely, so the original console.warn stays untouched.
 */
function useSuppressRechartsDimensionWarning() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === "string" && first.includes("of chart should be greater than 0")) {
        return;
      }
      original(...args);
    };
    return () => {
      console.warn = original;
    };
  }, []);
}

export function MarketClient({ data }: { data: OverviewResponse }) {
  useSuppressRechartsDimensionWarning();
  const nifty     = data.indices.find((r) => r.code === "NIFTY50");
  const niftyBank = data.indices.find((r) => r.code === "NIFTYBANK");
  return (
    <div className="space-y-4">
      <HeroPair
        left={nifty}
        leftSeries={data.heroSeries["NIFTY50"] ?? []}
        right={niftyBank}
        rightSeries={data.heroSeries["NIFTYBANK"] ?? []}
      />
      <IndicesStrip rows={data.indices.filter((r) => r.code !== "NIFTYBANK")} />

      {/* Movers + Building strength row.  Movers is the wide left side
          (existing UX), Building strength is the secondary discovery
          card on the right.  Stacked on mobile. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <MoversPair sets={data.movers} />
        </div>
        <BuildingStrengthCard rows={data.buildingStrength ?? []} />
      </div>

      {/* Four small cards in a single row underneath. Equal width so the
          page reads as a dense dashboard rather than empty gaps to the
          right of the movers. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdvanceDeclineDonut sets={data.advanceDecline} />
        <WeekRangeCard stat={data.weekRange} />
        <FiiBarCard latest={data.fii.latest} series={data.fii.series} />
        <HolidaysCard holidays={data.holidays} />
      </div>

      <SectorHeatmap rows={data.sectorHeat} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Hero pair — NIFTY 50 + NIFTY Bank, side by side, sharing one range toggle
// ──────────────────────────────────────────────────────────────────────────

type Range = "1M" | "3M" | "6M" | "1Y";
const RANGE_DAYS: Record<Range, number> = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365 };

function HeroPair({
  left, leftSeries, right, rightSeries,
}: {
  left: IndexRow | undefined;
  leftSeries: IndexSeriesPoint[];
  right: IndexRow | undefined;
  rightSeries: IndexSeriesPoint[];
}) {
  // Single range selector drives both panels — cleaner UX, and keeping them
  // synced lets the eye compare slopes directly.
  const [range, setRange] = useState<Range>("3M");
  return (
    <section className="card overflow-hidden">
      <div className="px-3 md:px-4 pt-3 pb-2 flex items-center justify-between gap-2 border-b hairline">
        <div className="muted-text text-[10px] tracking-[0.12em] font-semibold uppercase">
          Headline indices
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-md border" style={{ borderColor: "var(--color-border-default)" }}>
          {(["1M", "3M", "6M", "1Y"] as Range[]).map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)}
              className={`px-2 py-0.5 text-[11px] font-medium tabular-nums rounded transition-colors ${
                range === r ? "" : "muted-text hover:bg-[var(--color-paper)]"
              }`}
              style={range === r ? { backgroundColor: ACCENT, color: "white" } : undefined}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x hairline">
        <HeroPanel label="NIFTY 50"   row={left}  series={leftSeries}  range={range} chartIdSuffix="50" />
        <HeroPanel label="NIFTY BANK" row={right} series={rightSeries} range={range} chartIdSuffix="bank" />
      </div>
    </section>
  );
}

function HeroPanel({
  label, row, series, range, chartIdSuffix,
}: {
  label: string;
  row: IndexRow | undefined;
  series: IndexSeriesPoint[];
  range: Range;
  chartIdSuffix: string;
}) {
  const points = useMemo(() => {
    if (series.length === 0) return [];
    const cutoff = Date.now() - RANGE_DAYS[range] * 86_400_000;
    const filtered = series.filter((p) => new Date(p.date).getTime() >= cutoff);
    return filtered.length >= 2 ? filtered : series.slice(-Math.max(2, RANGE_DAYS[range] / 7));
  }, [series, range]);

  if (!row || points.length === 0) {
    return (
      <div className="px-3 md:px-4 py-3 muted-text text-[12px]">{label} — no data.</div>
    );
  }

  const first = points[0].close;
  const last  = points[points.length - 1].close;
  const change = last - first;
  const changePct = first > 0 ? (change / first) * 100 : 0;
  const positive = change >= 0;
  const stroke = positive ? UP : DOWN;
  const yMin = Math.min(...points.map((p) => p.close)) * 0.995;
  const yMax = Math.max(...points.map((p) => p.close)) * 1.005;

  const dailyPct = row.pct_change_1d;
  const dailyColor = dailyPct == null ? MUTED : dailyPct >= 0 ? UP : DOWN;
  const gradId = `hero-fill-${chartIdSuffix}`;

  return (
    <div className="px-3 md:px-4 pt-2.5 pb-2">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="muted-text text-[10px] tracking-[0.10em] font-semibold uppercase">{label}</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="font-display text-[20px] md:text-[22px] leading-none tabular-nums">
              {row.close.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
            </span>
            <span className="tabular-nums text-[11.5px] font-medium" style={{ color: dailyColor }}>
              {dailyPct == null ? "—" : `${dailyPct >= 0 ? "+" : ""}${dailyPct.toFixed(2)}%`}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="muted-text text-[10px]">{range}</div>
          <div className="tabular-nums text-[12.5px] font-medium" style={{ color: stroke }}>
            {positive ? "+" : ""}{changePct.toFixed(2)}%
          </div>
        </div>
      </div>
      <MountedChart className="h-[100px] md:h-[110px] mt-1.5 -mx-1 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 2, right: 10, left: 0, bottom: 2 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-border-default)" strokeDasharray="2 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtMonth} minTickGap={28}
              tick={{ fontSize: 9, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
            <YAxis domain={[yMin, yMax]}
              tickFormatter={(v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              tick={{ fontSize: 9, fill: "var(--color-muted)" }} axisLine={false} tickLine={false}
              width={42} orientation="right" />
            <Tooltip cursor={{ stroke: "var(--color-border-default)" }} contentStyle={chartTooltipStyle}
              labelFormatter={(l) => fmtFull(String(l ?? ""))}
              formatter={(v: unknown) => [
                Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 }),
                label,
              ]} />
            <Area type="monotone" dataKey="close" stroke={stroke} strokeWidth={1.4} fill={`url(#${gradId})`} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </MountedChart>
      <div className="mt-1 flex flex-wrap gap-3 text-[10.5px] tabular-nums">
        <RangeChange label="1W" value={row.pct_change_1w} />
        <RangeChange label="1M" value={row.pct_change_1m} />
        <RangeChange label="1Y" value={row.pct_change_1y} />
      </div>
    </div>
  );
}

function RangeChange({ label, value, positive }: { label: string; value: number | null; positive?: boolean }) {
  if (value == null) return <span><span className="muted-text">{label}</span> <span className="opacity-60">—</span></span>;
  const v = value;
  const isUp = positive ?? v >= 0;
  return (
    <span>
      <span className="muted-text">{label}</span>{" "}
      <span className="font-medium" style={{ color: isUp ? UP : DOWN }}>
        {isUp ? "+" : ""}{v.toFixed(2)}%
      </span>
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Index strip — compact sparkline tiles
// ──────────────────────────────────────────────────────────────────────────

function IndicesStrip({ rows }: { rows: IndexRow[] }) {
  // NIFTY 50 + NIFTY BANK now live in the hero pair — exclude here so we
  // don't duplicate them. The broad set below covers the remaining
  // broad-market indices; sectoral indices land in the dense second row.
  const broadCodes = new Set(["NIFTYMIDCAP100", "NIFTYSMALLCAP100", "NIFTYNEXT50", "NIFTY100", "NIFTY500"]);
  const broad  = rows.filter((r) => r.code !== "NIFTY50" && r.code !== "NIFTYBANK" && broadCodes.has(r.code));
  const sector = rows.filter((r) => r.code !== "NIFTY50" && r.code !== "NIFTYBANK" && !broadCodes.has(r.code));

  return (
    <section className="space-y-2">
      {broad.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {broad.map((r) => <SparkTile key={r.code} row={r} />)}
        </div>
      )}
      {sector.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-2">
          {sector.map((r) => <SparkTile key={r.code} row={r} compact />)}
        </div>
      )}
    </section>
  );
}

/** Short display names — recharts strips the "Nifty" prefix in compact
 *  mode, which leaves cryptic standalone numbers ("100"). This map keeps
 *  labels readable while saving horizontal space. */
const SHORT_NAME: Record<string, string> = {
  NIFTYMIDCAP100:  "Midcap 100",
  NIFTYSMALLCAP100:"Smallcap 100",
  NIFTYNEXT50:     "Next 50",
  NIFTY100:        "Largecap 100",   // Nifty 100 ≈ NSE's "large cap" universe
  NIFTY500:        "Total 500",
  NIFTYIT:         "IT",
  NIFTYAUTO:       "Auto",
  NIFTYFMCG:       "FMCG",
  NIFTYPHARMA:     "Pharma",
  NIFTYENERGY:     "Energy",
  NIFTYMETAL:      "Metal",
  NIFTYREALTY:     "Realty",
};

function SparkTile({ row, compact = false }: { row: IndexRow; compact?: boolean }) {
  const v = row.pct_change_1d;
  const positive = (v ?? 0) >= 0;
  const color = v == null ? MUTED : positive ? UP : DOWN;
  const shortName = SHORT_NAME[row.code] ?? row.name;
  return (
    <div className="card px-2.5 py-2 flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-1.5">
        <span className={`muted-text font-medium leading-tight ${compact ? "text-[9.5px]" : "text-[10.5px]"} truncate`}
          title={row.name}>
          {compact ? shortName : row.name}
        </span>
        <span className={`tabular-nums font-medium ${compact ? "text-[9.5px]" : "text-[10px]"}`} style={{ color }}>
          {v == null ? "—" : `${positive ? "+" : ""}${v.toFixed(1)}%`}
        </span>
      </div>
      <div className="flex items-end justify-between gap-1.5">
        <span className={`font-medium tabular-nums shrink-0 ${compact ? "text-[12px]" : "text-[13.5px]"}`}>
          {row.close.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
        </span>
        {/* min-w-0 lets flex-1 actually shrink under content; without it,
            the child sparkline div can briefly report a negative width
            during hydration and recharts spams a warning. minWidth on
            ResponsiveContainer is the final belt-and-braces. */}
        <MountedChart className={`flex-1 min-w-0 ${compact ? "h-[20px]" : "h-[26px]"} -mr-0.5`}>
          {row.sparkline.length > 1 && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={row.sparkline} margin={{ top: 1, right: 0, left: 0, bottom: 0 }}>
                <Line type="monotone" dataKey="close" stroke={positive ? UP : DOWN} strokeWidth={1.1} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </MountedChart>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Movers — compact sparkline list (top 5 each)
// ──────────────────────────────────────────────────────────────────────────

type MoverPeriod = "1D" | "1W";

const UNIVERSE_LABEL: Record<MoverUniverse, string> = {
  NIFTY50:  "Nifty 50",
  NIFTY200: "Nifty 200",
  FULL:     "Full universe",
};
const UNIVERSE_ORDER: MoverUniverse[] = ["NIFTY50", "NIFTY200", "FULL"];

/**
 * MoversPair — shared header (universe + period selectors) with two
 * side-by-side columns (gainers / losers). Sharing the selectors avoids
 * the case where a user picks "Nifty 50" on the left and "Full" on the
 * right and ends up comparing apples to oranges.
 */
function MoversPair({ sets }: { sets: OverviewResponse["movers"] }) {
  const [universe, setUniverse] = useState<MoverUniverse>("NIFTY50");
  const [period, setPeriod] = useState<MoverPeriod>("1D");
  const bucket = sets[universe][period];

  return (
    <section className="card overflow-hidden">
      {/* Shared toolbar */}
      <div className="px-3 md:px-4 py-2.5 border-b hairline flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-display text-[15px] leading-tight">
            Top movers <span className="muted-text font-normal text-[12px]">· {UNIVERSE_LABEL[universe]} · {period}</span>
          </div>
          <div className="muted-text text-[10.5px] mt-0.5">Dot = quality percentile in peer cluster</div>
        </div>
        <div className="flex items-center gap-1.5">
          <Toggle<MoverUniverse>
            value={universe} onChange={setUniverse}
            options={UNIVERSE_ORDER.map((u) => ({
              value: u,
              label: u === "NIFTY50" ? "N50" : u === "NIFTY200" ? "N200" : "Full",
            }))}
          />
          <Toggle<MoverPeriod>
            value={period} onChange={setPeriod}
            options={[{ value: "1D", label: "1D" }, { value: "1W", label: "1W" }]}
          />
        </div>
      </div>
      {/* Two columns of rows */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x hairline">
        <MoverColumn label="Top gainers" rows={bucket.up}   direction="up"   />
        <MoverColumn label="Top losers"  rows={bucket.down} direction="down" />
      </div>
    </section>
  );
}

function Toggle<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-md border" style={{ borderColor: "var(--color-border-default)" }}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums rounded transition-colors ${
            value === o.value ? "" : "muted-text hover:bg-[var(--color-paper)]"
          }`}
          style={value === o.value ? { backgroundColor: ACCENT, color: "white" } : undefined}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MoverColumn({
  label, rows, direction,
}: {
  label: string;
  rows: Mover[];
  direction: "up" | "down";
}) {
  return (
    <div>
      <div className="px-3 md:px-4 py-1.5 muted-text text-[10.5px] tracking-wide uppercase font-semibold">
        {label}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-5 muted-text text-[12px]">No matches in this universe.</div>
      ) : (
        <ul className="divide-y hairline">
          {rows.map((r) => <MoverRow key={r.symbol} row={r} direction={direction} />)}
        </ul>
      )}
    </div>
  );
}

function MoverRow({ row, direction }: { row: Mover; direction: "up" | "down" }) {
  const movePct = (row.ret ?? 0) * 100;
  const moveColor = direction === "up" ? UP : DOWN;
  const sign = movePct >= 0 ? "+" : "";
  const qPct = row.quality_pct ?? 0;
  const qColor = qualityColor(qPct);
  return (
    <li>
      <Link href={`/stock/${row.symbol}`} className="block px-3 md:px-4 py-2 hover:bg-[var(--color-paper)] transition-colors">
        <div className="flex items-center gap-2.5">
          {/* Quality dot — visual indicator of Q-percentile */}
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: qColor, boxShadow: `0 0 0 2px ${qColor}33` }}
            title={`Quality: ${Math.round(qPct)}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-[13px] tabular-nums">{row.symbol}</span>
              <span className="muted-text text-[10.5px] truncate">{row.industry_name}</span>
            </div>
          </div>
          <span className="tabular-nums text-[13px] font-medium shrink-0" style={{ color: moveColor }}>
            {sign}{movePct.toFixed(1)}%
          </span>
        </div>
      </Link>
    </li>
  );
}

function qualityColor(pct: number): string {
  if (pct >= 80) return "#1f8a4c";
  if (pct >= 60) return "#6cab43";
  if (pct >= 40) return "#d6a035";
  if (pct >= 20) return "#c97a3f";
  return "#a14a32";
}

// ──────────────────────────────────────────────────────────────────────────
// Advance / Decline — donut
// ──────────────────────────────────────────────────────────────────────────

type AdPeriod = "1D" | "1W";

function AdvanceDeclineDonut({ sets }: { sets: { "1D": AdvanceDeclineSet; "1W": AdvanceDeclineSet } }) {
  const [period, setPeriod] = useState<AdPeriod>("1D");
  const { up, flat, down } = sets[period];
  const total = up + flat + down;
  const data = [
    { name: "Up",   value: up,   fill: UP },
    { name: "Flat", value: flat, fill: MUTED },
    { name: "Down", value: down, fill: DOWN },
  ];
  return (
    <section className="card p-3 md:p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-[14px] leading-tight">Advance / Decline</div>
          <div className="muted-text text-[10px] mt-0.5">{total.toLocaleString("en-IN")} stocks · {period}</div>
        </div>
        <Toggle<AdPeriod>
          value={period} onChange={setPeriod}
          options={[{ value: "1D", label: "1D" }, { value: "1W", label: "1W" }]}
        />
      </div>
      <MountedChart className="mt-1 relative h-[120px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={38} outerRadius={56} stroke="none" paddingAngle={2} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Pie>
            <Tooltip contentStyle={chartTooltipStyle}
              formatter={(v: unknown, n: unknown) => {
                const num = Number(v);
                return [`${num.toLocaleString("en-IN")} (${total ? ((num / total) * 100).toFixed(0) : 0}%)`, String(n ?? "")];
              }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center"
             style={{ pointerEvents: "none" }}>
          <span className="font-display text-[18px] tabular-nums leading-none">{up.toLocaleString("en-IN")}</span>
          <span className="text-[9.5px] muted-text tracking-wide uppercase mt-0.5">advancing</span>
        </div>
      </MountedChart>
      <div className="grid grid-cols-3 gap-1.5 mt-1 text-[10.5px] tabular-nums">
        <LegendCell dot={UP}   label="Up"   value={up}   total={total} />
        <LegendCell dot={MUTED} label="Flat" value={flat} total={total} />
        <LegendCell dot={DOWN} label="Down" value={down} total={total} />
      </div>
    </section>
  );
}

function LegendCell({ dot, label, value, total }: { dot: string; label: string; value: number; total: number }) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-1">
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: dot }} />
      <span className="muted-text">{label}</span>
      <span className="ml-auto font-medium" style={{ color: INK }}>{value.toLocaleString("en-IN")}</span>
      <span className="muted-text">({pct.toFixed(0)}%)</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 52-week high / low
// ──────────────────────────────────────────────────────────────────────────

function WeekRangeCard({ stat }: { stat: WeekRangeStat }) {
  return (
    <section className="card p-3 md:p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-display text-[14px] leading-tight">52-week high / low</div>
        <div className="muted-text text-[10px]">{stat.total.toLocaleString("en-IN")} stocks scanned</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <RangeStat label="At 52W high"   sublabel="within 0.5%" value={stat.at_high}   accent={UP} />
        <RangeStat label="At 52W low"    sublabel="within 0.5%" value={stat.at_low}    accent={DOWN} />
        <RangeStat label="Near 52W high" sublabel="within 5%"   value={stat.near_high} accent={UP}   subtle />
        <RangeStat label="Near 52W low"  sublabel="within 5%"   value={stat.near_low}  accent={DOWN} subtle />
      </div>
    </section>
  );
}

function RangeStat({
  label, sublabel, value, accent, subtle = false,
}: { label: string; sublabel: string; value: number; accent: string; subtle?: boolean }) {
  return (
    <div
      className="rounded-md border p-2"
      style={{
        borderColor: "var(--color-border-default)",
        backgroundColor: subtle ? "var(--color-card)" : `color-mix(in srgb, ${accent} 10%, var(--color-card))`,
      }}
    >
      <div className="font-display tabular-nums leading-none" style={{ color: accent, fontSize: subtle ? 18 : 22 }}>
        {value.toLocaleString("en-IN")}
      </div>
      <div className="text-[10px] mt-1" style={{ color: INK }}>{label}</div>
      <div className="text-[9.5px] muted-text">{sublabel}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Building strength — persistence signal, cluster-adjusted
//
// Shows stocks where composite_pct rose MORE than the average rise in
// their peer cluster over the last 4 weekly snapshots.  Subtracting
// the cluster's average isolates stock-specific moves from sector lift
// (a stock that improved +10 while its cluster averaged +9 contributes
// just +1 of "alpha" — the cluster-adjusted column).
//
// Intentionally NOT a buy signal — the empty header text below frames
// it as "outpacing peers" rather than "go buy these".  No emoji, no
// green/red color urgency, no progress bar.  Five-row max per the
// premortem (a short list signals quality, not noise).
// ──────────────────────────────────────────────────────────────────────────

function BuildingStrengthCard({ rows }: { rows: BuildingStrengthRow[] }) {
  return (
    <section className="card overflow-hidden">
      <div className="px-3 md:px-4 py-2.5 border-b hairline">
        <div className="font-display text-[15px] leading-tight">Building strength</div>
        <div className="muted-text text-[10.5px] mt-0.5 leading-snug">
          Outpacing peer cluster over last 4 weekly snapshots
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 md:px-4 py-5 muted-text text-[12px]">
          Need 4+ snapshots of history to compute. Will populate as new
          weekly snapshots accumulate.
        </div>
      ) : (
        <ul className="divide-y hairline">
          {rows.map((r) => <BuildingRow key={r.symbol} row={r} />)}
        </ul>
      )}
    </section>
  );
}

function BuildingRow({ row }: { row: BuildingStrengthRow }) {
  const qPct = row.quality_pct ?? 0;
  const qColor = qPct >= 80 ? "#1f8a4c"
              : qPct >= 60 ? "#6cab43"
              : qPct >= 40 ? "#d6a035"
              : qPct >= 20 ? "#c97a3f" : "#a14a32";
  return (
    <li>
      <Link
        href={`/stock/${row.symbol}`}
        className="block px-3 md:px-4 py-2.5 hover:bg-[var(--color-paper)] transition-colors"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-medium text-[13px] tabular-nums">{row.symbol}</span>
              <span className="muted-text text-[10.5px] truncate">{row.industry_name}</span>
            </div>
            <div className="text-[10.5px] muted-text mt-0.5 flex items-center gap-2">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: qColor }}
                title={`Quality: ${Math.round(qPct)}`}
              />
              <span>{row.company_name}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-semibold text-[13.5px] tabular-nums" style={{ color: "var(--color-accent-600)" }}>
              +{row.cluster_adjusted.toFixed(1)}
            </div>
            <div className="text-[9.5px] muted-text leading-tight">vs cluster</div>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] tabular-nums muted-text">
          <span>raw <span className="font-medium" style={{ color: INK }}>+{row.raw_delta.toFixed(1)}</span></span>
          <span>cluster avg <span className="font-medium" style={{ color: INK }}>{row.cluster_avg_delta >= 0 ? "+" : ""}{row.cluster_avg_delta.toFixed(1)}</span></span>
          <span>composite <span className="font-medium" style={{ color: INK }}>{Math.round(row.composite_pct ?? 0)}</span></span>
        </div>
      </Link>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// FII / DII — grouped bars (compact)
// ──────────────────────────────────────────────────────────────────────────

function FiiBarCard({
  latest, series,
}: { latest: OverviewResponse["fii"]["latest"]; series: FiiPoint[] }) {
  // With only 5 sessions on the X axis we have room to show BOTH FII and
  // DII as side-by-side bars per day — much more useful for the user
  // than just FII alone. Colour is fixed (FII purple-ish, DII teal) so
  // direction signal stays in the dedicated "today" cell at the top.
  const FII_COLOR = "#7c6dd0";
  const DII_COLOR = "#0f8a8a";
  return (
    <section className="card p-3 md:p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="font-display text-[14px] leading-tight">FII / DII flow · 1W</div>
          <div className="muted-text text-[10.5px] mt-0.5">Net cash ₹ Cr · last {series.length} sessions</div>
        </div>
        {latest && (
          <div className="flex gap-3 text-[11px] tabular-nums">
            <NetMini label="FII" value={latest.fii_net} />
            <NetMini label="DII" value={latest.dii_net} />
          </div>
        )}
      </div>
      <MountedChart className="mt-2 h-[170px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} barGap={2} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-border-default)" strokeDasharray="2 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDay}
              tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
              tick={{ fontSize: 9, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} width={34} />
            <ReferenceLine y={0} stroke="var(--color-border-default)" />
            <Tooltip contentStyle={chartTooltipStyle}
              labelFormatter={(l) => fmtFull(String(l ?? ""))}
              formatter={(v: unknown, n: unknown) => [
                `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`,
                String(n) === "fii_net" ? "FII net" : "DII net",
              ]} />
            <Bar dataKey="fii_net" fill={FII_COLOR} radius={[3, 3, 0, 0]} />
            <Bar dataKey="dii_net" fill={DII_COLOR} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </MountedChart>
      <div className="mt-1 flex items-center gap-3 text-[10px] muted-text">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: FII_COLOR }} />FII net</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: DII_COLOR }} />DII net</span>
        <span className="ml-auto">bars above 0 = buying</span>
      </div>
    </section>
  );
}

function NetMini({ label, value }: { label: string; value: number | null }) {
  if (value == null) return <span><span className="muted-text">{label}</span> —</span>;
  const positive = value >= 0;
  return (
    <span>
      <span className="muted-text">{label} </span>
      <span className="font-medium" style={{ color: positive ? UP : DOWN }}>
        {positive ? "+" : "−"}₹{Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
      </span>
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Upcoming NSE holidays
// ──────────────────────────────────────────────────────────────────────────

function HolidaysCard({ holidays }: { holidays: HolidayItem[] }) {
  return (
    <section className="card p-3 md:p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-display text-[14px] leading-tight">Upcoming NSE holidays</div>
        <div className="muted-text text-[10px]">Markets closed</div>
      </div>
      {holidays.length === 0 ? (
        <div className="muted-text text-[12px] mt-2">No upcoming holidays in calendar.</div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {holidays.map((h) => {
            const d = new Date(`${h.date}T12:00:00Z`);
            const dayLabel = d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
            const daysAway = Math.max(0, Math.round((d.getTime() - Date.now()) / 86_400_000));
            return (
              <li key={h.date} className="flex items-center gap-2 text-[12px]">
                <span className="font-display tabular-nums w-[88px] shrink-0">{dayLabel}</span>
                <span className="truncate flex-1">{h.name}</span>
                <span className="muted-text text-[10.5px] tabular-nums">
                  {daysAway === 0 ? "today" : `+${daysAway}d`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sector heatmap — sized + colored cells (kept, compacted)
// ──────────────────────────────────────────────────────────────────────────

type SectorPeriod = "1D" | "1W";

function SectorHeatmap({ rows }: { rows: SectorHeatRow[] }) {
  const [period, setPeriod] = useState<SectorPeriod>("1D");
  if (rows.length === 0) return null;
  const maxStocks = Math.max(...rows.map((r) => r.stocks_count));

  // Auto-calibrate the colour scale to the data range. Indian sector
  // 1W averages typically cluster within ±2%, so a fixed ±5% cap makes
  // every tile look pale. Cap at max(|values|) clipped to [1.5%, 5%]
  // so very flat weeks still get visual contrast and an outlier doesn't
  // wash out the rest.
  const values = rows.map((r) => (period === "1D" ? r.avg_ret_1d : r.avg_ret_1w) ?? 0);
  const dataMax = Math.max(...values.map(Math.abs));
  const cap = Math.min(0.05, Math.max(0.015, dataMax * 1.05));
  const capPct = (cap * 100).toFixed(1);

  return (
    <section className="card overflow-hidden">
      <div className="px-3 md:px-4 py-2.5 border-b hairline flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-display text-[14px] leading-tight">Sector heatmap · {period}</div>
          <div className="muted-text text-[10.5px] mt-0.5">
            Tile size = stocks · colour = avg {period} return
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] muted-text">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: DOWN, opacity: 0.7 }} />−{capPct}%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: "var(--color-paper)" }} />0</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: UP, opacity: 0.7 }} />+{capPct}%</span>
          <Toggle<SectorPeriod>
            value={period} onChange={setPeriod}
            options={[{ value: "1D", label: "1D" }, { value: "1W", label: "1W" }]}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5 p-2">
        {rows.map((s) => {
          const r = (period === "1D" ? s.avg_ret_1d : s.avg_ret_1w) ?? 0;
          const intensity = Math.min(Math.abs(r) / cap, 1);
          const bg = r > 0
            ? `color-mix(in srgb, var(--color-delta-up) ${Math.round(intensity * 50)}%, var(--color-paper))`
            : r < 0
              ? `color-mix(in srgb, var(--color-delta-down) ${Math.round(intensity * 50)}%, var(--color-paper))`
              : "var(--color-paper)";
          const sizeBoost = Math.round((s.stocks_count / maxStocks) * 14);
          return (
            <div key={s.sector_name} className="rounded-md border p-2 flex flex-col justify-between"
              style={{ borderColor: "var(--color-border-default)", backgroundColor: bg, minHeight: 72 + sizeBoost }}>
              <div>
                <div className="text-[11.5px] font-medium leading-tight">{s.sector_name}</div>
                <div className="text-[9px] muted-text mt-0.5">{s.stocks_count} stocks</div>
              </div>
              <div className="text-[15px] font-display tabular-nums mt-1" style={{ color: r >= 0 ? UP : DOWN }}>
                {r === 0 ? "0.0%" : `${r > 0 ? "+" : ""}${(r * 100).toFixed(2)}%`}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const chartTooltipStyle: React.CSSProperties = {
  backgroundColor: "var(--color-card)",
  border: "1px solid var(--color-border-default)",
  borderRadius: 6,
  fontSize: 10.5,
  padding: "5px 7px",
};

function fmtMonth(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** Short day label used by the 5-bar FII/DII chart — "Mon 26". */
function fmtDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit" });
}

function fmtFull(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
