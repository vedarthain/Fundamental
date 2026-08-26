"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { CandleChart, type AlertLine } from "@/app/tools/scanner/CandleChart";
import type { Candle } from "@/lib/candles";
import { WEEKLY_THRESHOLD_DAYS } from "@/lib/candleConfig";
import { PCT_CAP, type RetWindow } from "@/lib/returnGuards";

/** One user price-alert line on the chart. Mirrors PriceAlert in
 *  lib/price-alerts (kept local so this client bundle never imports the
 *  server-only module). */
export type ChartPriceAlert = {
  id: number;
  price: number;
  direction: "above" | "below";
  status: "armed" | "triggered";
};

type Range = "1W" | "1M" | "3M" | "1Y" | "3Y" | "5Y" | "10Y" | "ALL";
const RANGES: Range[] = ["1W", "1M", "3M", "1Y", "3Y", "5Y", "10Y", "ALL"];

/** Lookback in calendar days per range (ALL is special-cased). */
const RANGE_DAYS: Record<Exclude<Range, "ALL">, number> = {
  "1W":  7,
  "1M":  30,
  "3M":  90,
  "1Y":  365,
  "3Y":  365 * 3,
  "5Y":  365 * 5,
  "10Y": 365 * 10,
};

// Ranges that carry a shared plausibility cap (see returnGuards). A broken split
// basis upstream can make a short-horizon return physically impossible; when it
// exceeds the cap we suppress the % rather than print garbage. 3M / 5Y / 10Y /
// ALL have no cap (long-horizon real multibaggers are genuinely huge).
const RANGE_TO_CAP: Partial<Record<Range, RetWindow>> = {
  "1W": "1w", "1M": "1m", "1Y": "1y", "3Y": "3y",
};

/** Human label per range — used under the headline when the visible span is
 *  under a year (CAGR isn't meaningful there). */
const RANGE_LABEL: Record<Range, string> = {
  "1W": "1 week", "1M": "1 month", "3M": "3 months", "1Y": "1 year",
  "3Y": "3 years", "5Y": "5 years", "10Y": "10 years", "ALL": "all time",
};

/** Date-span label for the visible data — moves with the selected range.
 *  ≥2y → year range ("2002–2026"); shorter → "Mon YY – Mon YY". */
function spanLabel(first: Candle | undefined, last: Candle | undefined, spanYears: number): string {
  if (!first || !last) return "—";
  if (spanYears >= 2) {
    const a = first.d.slice(0, 4);
    const b = last.d.slice(0, 4);
    return a === b ? a : `${a}–${b}`;
  }
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  return `${fmt(first.d)} – ${fmt(last.d)}`;
}

/** Monday-anchored ISO week bucket key for a "YYYY-MM-DD" date. */
function weekKey(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  const dow = (dt.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

/** Roll an ascending daily series up to weekly OHLCV (open=first, high/low=week
 *  extremes, close=last, volume=sum). Each bar labelled by its LAST trading day
 *  so the rightmost candle tracks the latest date. Mirrors candles.ts/toWeekly
 *  so long windows stay readable in the small SVG. */
function toWeekly(daily: Candle[]): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curKey = "";
  for (const c of daily) {
    const key = weekKey(c.d);
    if (key !== curKey) {
      cur = { d: c.d, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
      out.push(cur);
      curKey = key;
    } else if (cur) {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.d = c.d;
      cur.v += c.v;
    }
  }
  return out;
}

/** Anchor close for a range: the last close ON OR BEFORE (lastDate − days) —
 *  the same "on/before the target date" basis the scanner uses, so the chart's
 *  headline return agrees with the scanner row. Falls back to the first bar when
 *  the stock is younger than the window. Returns the % change to the last close,
 *  guarded against a physically-impossible value. */
function rangePct(candles: Candle[], range: Range): number | null {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1];
  let anchor: Candle;
  if (range === "ALL") {
    anchor = candles[0];
  } else {
    const cutoff = new Date(last.d);
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
    const cut = cutoff.toISOString().slice(0, 10);
    let onOrBefore: Candle | undefined;
    for (const c of candles) {
      if (c.d <= cut) onOrBefore = c;
      else break;
    }
    anchor = onOrBefore ?? candles[0];
  }
  if (!anchor.c) return null;
  const raw = (last.c / anchor.c - 1) * 100;
  const cap = RANGE_TO_CAP[range];
  if (cap != null && Math.abs(raw) > PCT_CAP[cap]) return null;
  return raw;
}

function fmtPct(p: number): string {
  return `${p >= 0 ? "+" : ""}${p.toFixed(Math.abs(p) >= 100 ? 0 : 2)}%`;
}

export function PriceChart({
  candles,
  currentPrice,
  prefix = "₹",
  symbol,
  priceAlerts,
  canSetAlerts = false,
}: {
  /** Split-safe daily OHLC candles, ascending by date. */
  candles: Candle[];
  /** Optional identity label shown in the card header (e.g. "3MINDIA"). */
  symbol?: string;
  /** Live intraday LTP — shown as the headline price (the last candle is EOD). */
  currentPrice?: number;
  /** Value prefix for the headline. "₹" for stocks. */
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

  // Candles visible for the selected range, anchored on the LAST bar (not "now")
  // so a day-or-two-stale tail still fills the window. Long spans roll up to
  // weekly so the SVG stays readable.
  const visible = useMemo(() => {
    if (candles.length === 0) return [];
    let sliced: Candle[];
    if (range === "ALL") {
      sliced = candles;
    } else {
      const last = candles[candles.length - 1].d;
      const cutoff = new Date(last);
      cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
      const cut = cutoff.toISOString().slice(0, 10);
      const f = candles.filter((c) => c.d >= cut);
      sliced = f.length >= 2 ? f : candles.slice(-2);
    }
    const spanDays =
      sliced.length >= 2
        ? (new Date(sliced[sliced.length - 1].d).getTime() - new Date(sliced[0].d).getTime()) /
          86_400_000
        : 0;
    return spanDays > WEEKLY_THRESHOLD_DAYS ? toWeekly(sliced) : sliced;
  }, [candles, range]);

  const weekly = useMemo(() => {
    if (visible.length < 2) return false;
    const spanDays =
      (new Date(visible[visible.length - 1].d).getTime() - new Date(visible[0].d).getTime()) /
      86_400_000;
    return spanDays > WEEKLY_THRESHOLD_DAYS;
  }, [visible]);

  // Per-range % change — precomputed so each range button can show its own move.
  const rangePctMap = useMemo(() => {
    const m = {} as Record<Range, number | null>;
    for (const r of RANGES) m[r] = rangePct(candles, r);
    return m;
  }, [candles]);

  const alertLines: AlertLine[] = alerts.map((a) => ({
    price: a.price,
    status: a.status === "triggered" ? "triggered" : "armed",
  }));

  // Headline: latest EOD close (or live LTP) + selected-range change + CAGR.
  const first = visible[0];
  const last = visible[visible.length - 1];
  const headline = currentPrice ?? last?.c;
  const changePct = rangePctMap[range];
  const spanYears =
    first && last
      ? (new Date(last.d).getTime() - new Date(first.d).getTime()) /
        (365.25 * 24 * 3600 * 1000)
      : 0;
  const periodCagr =
    changePct != null && spanYears > 1 && first && first.c > 0 && last
      ? (Math.pow(last.c / first.c, 1 / spanYears) - 1) * 100
      : null;
  const subLabel = spanLabel(first, last, spanYears);
  const cagrLabel =
    periodCagr != null ? `${periodCagr.toFixed(1)}% CAGR · ${spanYears.toFixed(0)}y` : RANGE_LABEL[range];

  if (candles.length === 0) {
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
              {fmtPct(changePct)}
            </div>
            <div className="text-[10px] muted-text mt-1">{cagrLabel}</div>
          </div>
        )}
      </div>

      {/* Headline price, then range tabs — each tab shows its own % change. */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          {headline != null && (
            <span className="text-[18px] font-medium tabular-nums">
              {prefix}{headline.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {RANGES.map((r) => {
            const active = r === range;
            const p = rangePctMap[r];
            const pColor =
              p == null
                ? "var(--color-muted)"
                : p >= 0
                  ? "var(--color-score-good)"
                  : "var(--color-score-poor)";
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className="flex flex-col items-center gap-0.5 px-2 py-0.5 rounded-md transition-colors"
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
                <span className="text-[11px] font-medium leading-none">{r}</span>
                <span
                  className="text-[9px] tabular-nums leading-none font-medium"
                  style={{ color: active ? pColor : pColor, opacity: active ? 1 : 0.9 }}
                >
                  {p == null ? "—" : fmtPct(p)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Candlestick + volume — split-safe OHLC, hover readout, alert lines. */}
      <div className="w-full h-[300px]">
        <CandleChart candles={visible} interactive weekly={weekly} alerts={alertLines} />
      </div>

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
                const c = a.status === "triggered" ? "var(--color-score-weak)" : "var(--color-score-good)";
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
