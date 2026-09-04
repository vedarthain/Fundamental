"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CandleChart, type AlertLine, type ChartTool, type Drawing } from "@/app/tools/scanner/CandleChart";
import type { Candle } from "@/lib/candles";
import { WEEKLY_THRESHOLD_DAYS } from "@/lib/candleConfig";
import { usePriceAlerts } from "@/lib/chartOverlays";
import { PCT_CAP, type RetWindow } from "@/lib/returnGuards";

// localStorage key for persisted chart drawings — SHARED with the scanner's
// Graph tab (GraphClient.tsx) so an hline/trend drawn there shows here too, and
// vice-versa. Shape: Record<symbol, Drawing[]>.
const DRAW_KEY = "er:chartDrawings:v1";

// Toolbar glyphs — copied from the scanner Graph toolbar so the expanded chart
// reads identically. Kept local to avoid importing from an app-route module.
function RulerIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12l10-10 10 10-10 10z" />
      <path d="M8 6l2 2M6 8l2 2M11 9l2 2M9 11l2 2M14 12l2 2M12 14l2 2" />
    </svg>
  );
}
function HLineIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12h18" />
      <circle cx="7" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="17" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function TrendIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 19L20 5" />
      <circle cx="4" cy="19" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="20" cy="5" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
function EraseIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h16" />
      <path d="M13.5 6.5l4 4L9 19H5l-1-4z" />
    </svg>
  );
}
function ExpandIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

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
  candles: candlesProp,
  currentPrice,
  prefix = "₹",
  symbol,
  priceAlerts,
  canSetAlerts = false,
  fetchDays = 11000,
}: {
  /** Split-safe daily OHLC candles, ascending by date. When omitted (and a
   *  `symbol` is given), the chart self-fetches from /api/scanner/ohlc — this
   *  is the client-side path used outside server components (e.g. watchlist). */
  candles?: Candle[];
  /** Optional identity label shown in the card header (e.g. "3MINDIA"). */
  symbol?: string;
  /** Live intraday LTP — shown as the headline price (the last candle is EOD). */
  currentPrice?: number;
  /** Value prefix for the headline. "₹" for stocks. */
  prefix?: string;
  /** User's live price-alert lines for this symbol (armed + triggered). When
   *  omitted (and a `symbol` is given), lines are read from the shared alerts
   *  hook — the client-side path used outside server components. */
  priceAlerts?: ChartPriceAlert[];
  /** Whether to render the create/manage controls (signed-in contexts). */
  canSetAlerts?: boolean;
  /** Days of history to self-fetch when `candles` isn't provided. Default is
   *  intentionally large (the OHLC route clamps to full listed history) so the
   *  range tabs — including "ALL" — all have data to slice locally. */
  fetchDays?: number;
}) {
  const [range, setRange] = useState<Range>("1Y");
  const router = useRouter();

  // Self-fetch candles when not passed as a server prop. Runs once per symbol.
  const [fetched, setFetched] = useState<Candle[] | null>(null);
  useEffect(() => {
    if (candlesProp || !symbol) return;
    let alive = true;
    setFetched(null);
    fetch(`/api/scanner/ohlc?syms=${encodeURIComponent(symbol)}&days=${fetchDays}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: Record<string, Candle[]> } | null) => {
        if (alive) setFetched(j?.data?.[symbol] ?? []);
      })
      .catch(() => alive && setFetched([]));
    return () => {
      alive = false;
    };
  }, [candlesProp, symbol, fetchDays]);

  const candles = candlesProp ?? fetched ?? [];
  const selfFetching = !candlesProp && fetched === null;

  // Alerts: server prop when given (SSR stock page), else the shared client
  // hook. `refresh()` re-syncs every mounted chart after a create/delete.
  const alertHook = usePriceAlerts(!priceAlerts && !!symbol);
  const alerts = priceAlerts ?? (symbol ? alertHook.get(symbol) : []);
  const [alertInput, setAlertInput] = useState("");
  const [alertBusy, setAlertBusy] = useState(false);
  const [alertErr, setAlertErr] = useState<string | null>(null);

  // Expanded (fullscreen) view + drawing toolbar state — mirrors the scanner
  // Graph tab. `tool` is the armed drawing/measure/alert tool; drawings persist
  // to the shared localStorage map keyed by symbol.
  const [expanded, setExpanded] = useState(false);
  const [tool, setTool] = useState<ChartTool>("none");
  const [drawings, setDrawings] = useState<Drawing[]>([]);

  // Load this symbol's drawings from the shared map on mount / symbol change.
  useEffect(() => {
    if (!symbol) return;
    try {
      const raw = localStorage.getItem(DRAW_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, Drawing[]>) : {};
      setDrawings(map[symbol] ?? []);
    } catch {
      /* ignore corrupt/unavailable storage */
    }
  }, [symbol]);

  // Persist a new drawings array back into the shared map (read-modify-write so
  // other symbols' drawings are preserved).
  const persistDrawings = useCallback(
    (next: Drawing[]) => {
      setDrawings(next);
      if (!symbol) return;
      try {
        const raw = localStorage.getItem(DRAW_KEY);
        const map = raw ? (JSON.parse(raw) as Record<string, Drawing[]>) : {};
        if (next.length) map[symbol] = next;
        else delete map[symbol];
        localStorage.setItem(DRAW_KEY, JSON.stringify(map));
      } catch {
        /* ignore quota/unavailable storage */
      }
    },
    [symbol],
  );

  const addDrawing = useCallback((d: Drawing) => persistDrawings([...drawings, d]), [drawings, persistDrawings]);
  const deleteDrawing = useCallback((i: number) => persistDrawings(drawings.filter((_, k) => k !== i)), [drawings, persistDrawings]);
  const clearDrawings = useCallback(() => persistDrawings([]), [persistDrawings]);

  // Close the expanded overlay on Escape.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Reset the armed tool whenever the overlay closes.
  useEffect(() => {
    if (!expanded) setTool("none");
  }, [expanded]);

  async function createAlertAtPrice(price: number) {
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
      alertHook.refresh(); // client-hook charts (watchlist)
      router.refresh();    // server-prop charts (stock page)
    } catch (e) {
      setAlertErr(e instanceof Error ? e.message : "Could not add alert.");
    } finally {
      setAlertBusy(false);
    }
  }

  async function addAlert() {
    await createAlertAtPrice(Number(alertInput));
  }

  async function removeAlert(id: number) {
    setAlertBusy(true);
    try {
      await fetch("/api/alerts/price", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      alertHook.refresh();
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
        {selfFetching ? "Loading chart…" : "No price history available."}
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
        <div className="flex items-start gap-3 shrink-0">
          {changePct != null && (
            <div className="text-right">
              <div
                className="font-display text-[20px] tabular-nums leading-none"
                style={{ color: changePct >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)" }}
              >
                {fmtPct(changePct)}
              </div>
              <div className="text-[10px] muted-text mt-1">{cagrLabel}</div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-1.5 rounded-md border hairline px-2 py-1 text-[12px] font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-paper)] transition-colors"
            title="Enlarge — draw trend lines, measure moves, set alerts"
            aria-label="Enlarge chart"
          >
            <ExpandIcon />
            Enlarge
          </button>
        </div>
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

      {/* Candlestick + volume — split-safe OHLC, hover readout, alert + drawing
          lines (drawings are read-only inline; edit them in the enlarged view). */}
      <div className="w-full h-[300px]">
        <CandleChart candles={visible} interactive weekly={weekly} alerts={alertLines} drawings={drawings} />
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

      {/* ── Enlarged view ─────────────────────────────────────────────────
          Fullscreen overlay reusing the same CandleChart with the scanner's
          drawing toolbar (measure / h-line / trend / erase), click-to-place
          alerts, and shared localStorage drawings. */}
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-8"
          onClick={() => setExpanded(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`${symbol ?? "Price"} expanded chart`}
        >
          <div
            className="relative flex h-[88vh] w-[94vw] max-w-[1280px] flex-col rounded-2xl border hairline shadow-2xl"
            style={{ background: "var(--color-card, #fff)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: identity + headline + drawing toolbar + close. */}
            <div className="flex flex-wrap items-center gap-3 border-b hairline px-4 py-3">
              <div className="min-w-0">
                <div className="font-display text-[16px] leading-tight">
                  {symbol ?? "Price history"}
                </div>
                <div className="text-[11px] muted-text">{subLabel}</div>
              </div>

              {headline != null && (
                <div className="text-right leading-tight">
                  <div className="text-[15px] tabular-nums font-semibold">
                    {prefix}
                    {headline.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </div>
                  {changePct != null && (
                    <div
                      className="text-[11px] tabular-nums font-medium"
                      style={{ color: changePct >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)" }}
                    >
                      {fmtPct(changePct)} · {RANGE_LABEL[range]}
                    </div>
                  )}
                </div>
              )}

              <div className="ml-auto flex items-center gap-3">
                {/* Drawing toolbar — Alert only shows for signed-in users. */}
                <div className="flex items-center gap-1 rounded-lg border hairline p-0.5">
                  {([
                    ...(canSetAlerts && symbol
                      ? [{ id: "alert" as const, label: "Alert", icon: <HLineIcon size={13} />, hint: "Click a level to set a price alert" }]
                      : []),
                    { id: "measure" as const, label: "Measure", icon: <RulerIcon size={13} />, hint: "Measure the move between two points" },
                    { id: "hline" as const, label: "H-line", icon: <HLineIcon size={13} />, hint: "Add a horizontal price line" },
                    { id: "trend" as const, label: "Trend", icon: <TrendIcon size={13} />, hint: "Draw a trend line between two points" },
                    { id: "erase" as const, label: "Erase", icon: <EraseIcon size={13} />, hint: "Click a line to delete it" },
                  ]).map((t) => {
                    const active = tool === t.id;
                    const activeStyle =
                      t.id === "alert"
                        ? { color: "var(--color-delta-up, #0a0)", background: "color-mix(in srgb, var(--color-delta-up, #0a0) 14%, transparent)" }
                        : { color: "var(--color-accent-700)", background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)" };
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTool((cur) => (cur === t.id ? "none" : t.id))}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium hover:bg-[var(--color-paper)] transition-colors"
                        style={active ? activeStyle : undefined}
                        aria-pressed={active}
                        title={t.hint}
                      >
                        {t.icon}
                        {t.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={clearDrawings}
                    disabled={!drawings.length}
                    className="inline-flex items-center rounded-md px-2 py-1 text-[12px] font-medium text-[var(--color-muted)] hover:bg-[var(--color-paper)] hover:text-[var(--color-ink)] disabled:opacity-40 transition-colors"
                    title="Remove all drawings on this stock"
                  >
                    Clear
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="rounded-md border hairline px-2.5 py-1.5 text-[13px] font-medium hover:bg-[var(--color-paper)] transition-colors"
                  aria-label="Close expanded chart"
                  title="Close (Esc)"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Range tabs (each showing its own % change), shared with the inline chart. */}
            <div className="flex flex-wrap items-center gap-3 border-b hairline px-4 py-2">
              <div className="flex flex-wrap gap-1">
                {RANGES.map((r) => {
                  const active = r === range;
                  const p = rangePctMap[r];
                  const pColor =
                    p == null ? "var(--color-muted)" : p >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)";
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRange(r)}
                      className="flex flex-col items-center gap-0.5 px-2 py-0.5 rounded-md transition-colors"
                      style={
                        active
                          ? { background: "var(--color-accent-50)", color: "var(--color-accent-700)", border: "1px solid var(--color-accent-300)" }
                          : { background: "transparent", color: "var(--color-muted)", border: "1px solid var(--color-border-default)" }
                      }
                    >
                      <span className="text-[11px] font-medium leading-none">{r}</span>
                      <span className="text-[9px] tabular-nums leading-none font-medium" style={{ color: pColor }}>
                        {p == null ? "—" : fmtPct(p)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {tool !== "none" && (
                <span className="text-[11px] muted-text">
                  {tool === "alert"
                    ? "Click a level to set an alert"
                    : tool === "hline"
                      ? "Click to place the line"
                      : tool === "erase"
                        ? "Click a line to delete"
                        : "Click 2 points"}
                </span>
              )}
              {alertErr && (
                <span className="text-[11px]" style={{ color: "var(--color-score-poor)" }}>
                  {alertErr}
                </span>
              )}
            </div>

            {/* The big interactive chart. */}
            <div className="flex-1 min-h-0 p-2">
              <CandleChart
                candles={visible}
                interactive
                weekly={weekly}
                tool={tool}
                drawings={drawings}
                alerts={alertLines}
                onAddDrawing={addDrawing}
                onDeleteDrawing={deleteDrawing}
                onPlaceAlert={(price) => {
                  void createAlertAtPrice(Math.round(price * 100) / 100);
                  setTool("none");
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
