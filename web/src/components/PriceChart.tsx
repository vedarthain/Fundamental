"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { PCT_CAP, type RetWindow } from "@/lib/returnGuards";

export type PricePoint = { date: string; close: number };

/** One user price-alert line on the chart. Mirrors PriceAlert in
 *  lib/price-alerts (kept local so this client bundle never imports the
 *  server-only module). */
export type ChartPriceAlert = {
  id: number;
  price: number;
  direction: "above" | "below";
  status: "armed" | "triggered";
};

// Green = armed (watching), orange = triggered (crossed) — matches the Alerts
// tab's severity colours so the two surfaces read the same.
const ALERT_ARMED = "var(--color-score-good)";
const ALERT_TRIGGERED = "var(--color-score-weak)";

type Range = "1D" | "1W" | "1M" | "3M" | "1Y" | "3Y" | "5Y" | "10Y" | "ALL";

// Ranges that have a shared plausibility cap (see returnGuards). A broken split
// basis upstream can make a short-horizon return physically impossible; when it
// exceeds the cap we suppress the headline number rather than print garbage.
// 3M / 5Y / 10Y / ALL have no cap (no scanner equivalent, and long-horizon real
// multibaggers are genuinely huge), so they render as-is.
const RANGE_TO_CAP: Partial<Record<Range, RetWindow>> = {
  "1D": "1d", "1W": "1w", "1M": "1m", "1Y": "1y", "3Y": "3y",
};

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

/** Human label per range — used under the headline return when the visible
 *  span is under a year (CAGR isn't meaningful there). */
const RANGE_LABEL: Record<Range, string> = {
  "1D": "1 day", "1W": "1 week", "1M": "1 month", "3M": "3 months",
  "1Y": "1 year", "3Y": "3 years", "5Y": "5 years", "10Y": "10 years",
  "ALL": "all time",
};

/** Date-span label for the visible data — moves with the selected range.
 *  ≥2y → year range ("2002–2026"); shorter → "Mon YY – Mon YY". */
function spanLabel(first: PricePoint | undefined, last: PricePoint | undefined, spanYears: number): string {
  if (!first || !last) return "—";
  if (spanYears >= 2) {
    const a = first.date.slice(0, 4);
    const b = last.date.slice(0, 4);
    return a === b ? a : `${a}–${b}`;
  }
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  return `${fmt(first.date)} – ${fmt(last.date)}`;
}

/** IST calendar date ("YYYY-MM-DD") of a timestamp — used to anchor the 1D
 *  curve on the close of the day before the intraday ticks. */
function istDayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

export function PriceChart({
  data,
  intraday,
  currentPrice,
  priceFetchedAt,
  prefix = "₹",
  symbol,
  priceAlerts,
  canSetAlerts = false,
}: {
  data: PricePoint[];
  /** Optional identity label shown in the card header (e.g. "3MINDIA"). */
  symbol?: string;
  /** Today's intraday ticks (oldest-first), used to draw a real 1D curve
   *  instead of a straight yesterday-close → current-price line. */
  intraday?: { ts: string; ltp: number }[];
  currentPrice?: number;
  priceFetchedAt?: string;
  /** Value prefix for the headline/axis/tooltip. "₹" for stocks; pass "" for
   *  index levels (which aren't a rupee amount). */
  prefix?: string;
  /** User's live price-alert lines for this symbol (armed + triggered). */
  priceAlerts?: ChartPriceAlert[];
  /** Whether to render the create/manage controls (signed-in stock pages). */
  canSetAlerts?: boolean;
}) {
  const [range, setRange] = useState<Range>("1Y");
  const router = useRouter();
  const alerts = priceAlerts ?? [];
  const [alertInput, setAlertInput] = useState("");
  const [alertBusy, setAlertBusy] = useState(false);
  const [alertErr, setAlertErr] = useState<string | null>(null);

  async function addAlert() {
    const price = Number(alertInput);
    if (!Number.isFinite(price) || price <= 0) {
      setAlertErr("Enter a price above 0.");
      return;
    }
    setAlertBusy(true);
    setAlertErr(null);
    try {
      const r = await fetch("/api/alerts/price", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, price }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setAlertInput("");
      router.refresh();
    } catch (e) {
      setAlertErr(e instanceof Error ? e.message : "Could not add alert.");
    } finally {
      setAlertBusy(false);
    }
  }

  async function removeAlert(id: number) {
    setAlertBusy(true);
    try {
      await fetch("/api/alerts/price", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      router.refresh();
    } catch {
      /* refresh re-reads truth regardless */
    } finally {
      setAlertBusy(false);
    }
  }

  // Filter the full daily series down to the selected range.
  const filtered = useMemo(() => {
    if (data.length === 0) return [];
    if (range === "ALL") return data;
    if (range === "1D") {
      // Preferred: draw the real intraday curve from the latest session's
      // ticks. The ts is a full ISO timestamp; the tickFormatter renders it as
      // IST time (detected via length > 10).
      if (intraday && intraday.length > 0) {
        const pts = intraday.map((t) => ({ date: t.ts, close: t.ltp }));
        // Anchor on the daily close from the day BEFORE the ticks' day so the
        // line reads "prior close → session". Using data.slice(-1) is wrong
        // once that point is the SAME day as the ticks (weekend / after EOD) —
        // it would flat-line at the close value. p.date is "YYYY-MM-DD", so a
        // lexicographic "<" against the ticks' IST day is correct.
        const tickDay = istDayOf(intraday[0].ts);
        const anchor = [...data].reverse().find((p) => p.date < tickDay);
        return anchor ? [anchor, ...pts] : pts;
      }
      // Fallback (no ticks at all for this symbol): yesterday's EOD close →
      // current price, a straight 2-point line.
      const base = data.slice(-1);
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
  }, [data, intraday, range, currentPrice, priceFetchedAt]);

  // Direction colour — green if last close ≥ first close in the visible range,
  // red if it dropped. Uses our existing earthy score palette.
  const positive =
    filtered.length >= 2 && filtered[filtered.length - 1].close >= filtered[0].close;
  const stroke = positive ? "var(--color-score-excellent)" : "var(--color-score-poor)";
  const fillStop = positive ? "var(--color-score-good)" : "var(--color-score-weak)";

  // Return anchor — the "N ago" reference point. The scanner measures from the
  // most recent close ON OR BEFORE the target date; match that here (instead of
  // filtered[0], the first point on/after) so the chart's headline return and
  // the scanner's row agree for the same stock + timeframe. Falls back to the
  // first visible point when the stock is younger than the window. `data` is
  // date-ascending from SQL. 1D/ALL keep the visible-range anchor.
  const headAnchor = useMemo<PricePoint | undefined>(() => {
    if (range === "1D" || range === "ALL") return filtered[0];
    const days = RANGE_DAYS[range];
    const cutoff = Date.now() - days * 86_400_000;
    let onOrBefore: PricePoint | undefined;
    for (const p of data) {
      if (new Date(p.date).getTime() <= cutoff) onOrBefore = p;
      else break;
    }
    return onOrBefore ?? filtered[0];
  }, [data, range, filtered]);

  // Headline numbers — current price + period change.
  const last = filtered[filtered.length - 1]?.close;
  const first = headAnchor?.close;
  const changeAbs = last != null && first != null ? last - first : null;
  const rawChangePct = changeAbs != null && first ? (changeAbs / first) * 100 : null;
  // Suppress a physically-impossible headline return (upstream broken split
  // basis) so the chart never prints garbage — same guard the scanner uses.
  const capWin = RANGE_TO_CAP[range];
  const changePct =
    rawChangePct != null && capWin != null && Math.abs(rawChangePct) > PCT_CAP[capWin]
      ? null
      : rawChangePct;

  // Header stats — computed from the VISIBLE range so the identity line, the
  // headline return and CAGR all move with the selected timeframe (instead of
  // being pinned to the full 24y history).
  const spanFirst = headAnchor;
  const spanLast = filtered[filtered.length - 1];
  const spanYears =
    spanFirst && spanLast
      ? (new Date(spanLast.date).getTime() - new Date(spanFirst.date).getTime()) /
        (365.25 * 24 * 3600 * 1000)
      : 0;
  const periodCagr =
    changePct != null && spanYears > 1 && spanFirst && spanFirst.close > 0 && spanLast
      ? (Math.pow(spanLast.close / spanFirst.close, 1 / spanYears) - 1) * 100
      : null;
  const subLabel = spanLabel(spanFirst, spanLast, spanYears);
  const cagrLabel =
    periodCagr != null ? `${periodCagr.toFixed(1)}% CAGR · ${spanYears.toFixed(0)}y` : RANGE_LABEL[range];

  if (data.length === 0) {
    return (
      <div className="h-[260px] flex items-center justify-center muted-text text-[13px]">
        No price history available.
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Identity + headline period return — both track the selected range. */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide muted-text">Price history</div>
          <div className="font-display text-[18px] mt-0.5">
            {symbol && <>{symbol} · </>}
            <span className="muted-text">{subLabel}</span>
          </div>
        </div>
        {changePct != null && (
          <div className="text-right shrink-0">
            <div
              className="font-display text-[20px] tabular-nums leading-none"
              style={{ color: changePct >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)" }}
            >
              {changePct >= 0 ? "+" : ""}{changePct.toFixed(changePct >= 100 ? 0 : 2)}%
            </div>
            <div className="text-[10px] muted-text mt-1">{cagrLabel}</div>
          </div>
        )}
      </div>

      {/* Current price + absolute change, then range tabs. */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          {last != null && (
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] font-medium tabular-nums">
                {prefix}{last.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
              {changeAbs != null && (
                <span
                  className="text-[12px] font-medium tabular-nums"
                  style={{ color: stroke }}
                >
                  {changeAbs >= 0 ? "+" : ""}
                  {changeAbs.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </span>
              )}
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
            tickFormatter={(v) => `${prefix}${Math.round(v).toLocaleString("en-IN")}`}
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
                // Live intraday point — show date + time in IST so the hover
                // detail says which day the tick belongs to, not just the clock.
                const dt = new Date(s);
                const datePart = new Intl.DateTimeFormat("en-IN", {
                  timeZone: "Asia/Kolkata", day: "numeric", month: "short",
                }).format(dt);
                const timePart = new Intl.DateTimeFormat("en-IN", {
                  timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
                }).format(dt);
                return `${datePart}, ${timePart} IST (live)`;
              }
              return new Date(s).toLocaleDateString("en-IN", {
                day: "numeric", month: "short", year: "numeric",
              });
            }}
            formatter={(v: unknown) => [
              `${prefix}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 })}`,
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
          {alerts.map((a) => {
            const c = a.status === "triggered" ? ALERT_TRIGGERED : ALERT_ARMED;
            return (
              <ReferenceLine
                key={a.id}
                y={a.price}
                stroke={c}
                strokeDasharray="4 3"
                strokeWidth={1.5}
                ifOverflow="extendDomain"
                label={{
                  value: "A",
                  position: "left",
                  fill: c,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>

      {/* Price-alert controls — signed-in stock pages only. */}
      {canSetAlerts && symbol && (
        <div className="mt-3 pt-3 border-t hairline">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-wide muted-text">
              Price alert
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] muted-text">{prefix}</span>
              <input
                type="number"
                inputMode="decimal"
                value={alertInput}
                onChange={(e) => setAlertInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !alertBusy) addAlert();
                }}
                placeholder="target price"
                className="w-[110px] rounded-md border px-2 py-1 text-[13px] tabular-nums"
                style={{ borderColor: "var(--color-border-default)", background: "var(--color-card)" }}
              />
              <button
                type="button"
                onClick={addAlert}
                disabled={alertBusy}
                className="rounded-md px-2.5 py-1 text-[12.5px] font-medium text-white transition-opacity disabled:opacity-60"
                style={{ backgroundColor: "var(--color-accent-600)" }}
              >
                {alertBusy ? "…" : "Add"}
              </button>
            </div>
            {alertErr && (
              <span className="text-[12px]" style={{ color: "var(--color-score-poor)" }}>
                {alertErr}
              </span>
            )}
          </div>

          {alerts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {alerts.map((a) => {
                const c = a.status === "triggered" ? ALERT_TRIGGERED : ALERT_ARMED;
                return (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium"
                    style={{ backgroundColor: `${c}1a`, color: c }}
                  >
                    <span aria-hidden className="font-bold">A</span>
                    {prefix}
                    {a.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    <span className="muted-text text-[10.5px]">
                      {a.status === "triggered" ? "hit" : a.direction}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAlert(a.id)}
                      disabled={alertBusy}
                      aria-label="Remove alert"
                      className="ml-0.5 leading-none hover:opacity-70"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
