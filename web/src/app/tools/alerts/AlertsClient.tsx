"use client";

/**
 * AlertsClient — renders ring-1 portfolio alerts: active cards on top,
 * dismissed greyed below, plus a "Check now" that re-evaluates on demand.
 *
 * Dismiss is optimistic: the card greys immediately and POSTs; a failure
 * reverts it. "Check now" re-evaluates server-side then refreshes the route so
 * the server component re-reads the reconciled set (no client-side merge).
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AlertRow, AlertEnrichment, Severity } from "@/lib/alerts";
import { band, bandColor } from "@/lib/score";
import { CandleChart } from "@/app/tools/scanner/CandleChart";
import type { Drawing, AlertLine } from "@/app/tools/scanner/CandleChart";
import { useChartDrawings, usePriceAlertLines } from "@/lib/chartOverlays";
import type { Candle } from "@/lib/candles";

const SEV_COLOR: Record<Severity, string> = {
  urgent: "var(--color-score-poor)",
  warn: "var(--color-score-weak)",
  info: "var(--color-accent-600)",
};
const SEV_LABEL: Record<Severity, string> = {
  urgent: "Urgent",
  warn: "Watch",
  info: "FYI",
};

// Category tabs. Each tab claims a set of rule_keys; "all" is the union.
// Order is deliberate: price alerts (user-created) first after All, then the
// automatic rules roughly by urgency. A rule_key not listed falls into "all"
// only, so new rules stay visible even before they get their own tab.
type TabKey =
  | "all"
  | "price_level"
  | "target_hit"
  | "deep_drawdown"
  | "big_down_day"
  | "composite_slip"
  | "hold_limit";

const TABS: { key: TabKey; label: string; rules: string[] }[] = [
  { key: "all", label: "All", rules: [] },
  { key: "price_level", label: "Price alerts", rules: ["price_level"] },
  { key: "target_hit", label: "Target", rules: ["target_hit"] },
  { key: "deep_drawdown", label: "Drawdown", rules: ["deep_drawdown"] },
  { key: "big_down_day", label: "Down day", rules: ["big_down_day"] },
  { key: "composite_slip", label: "Rank", rules: ["composite_slip"] },
  { key: "hold_limit", label: "Hold limit", rules: ["hold_limit"] },
];

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

// A percentile score (0–100) rendered as a compact pill: "Q 62".
function ScorePill({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="tabular-nums">
      <span className="muted-text">{label} </span>
      <span className="font-medium">{value == null ? "—" : Math.round(value)}</span>
    </span>
  );
}

// A period return (fraction, e.g. 0.024) rendered signed + coloured: "1M +4.2%".
function RetPill({ label, value }: { label: string; value: number | null }) {
  if (value == null) {
    return (
      <span className="tabular-nums muted-text">
        {label} <span className="opacity-60">—</span>
      </span>
    );
  }
  const v = value * 100;
  const color = v >= 0 ? "var(--color-delta-up)" : "var(--color-delta-down)";
  const txt = Math.abs(v) >= 10 ? Math.round(v).toString() : v.toFixed(1);
  return (
    <span className="tabular-nums">
      <span className="muted-text">{label} </span>
      <span className="font-medium" style={{ color }}>
        {v >= 0 ? "+" : ""}
        {txt}%
      </span>
    </span>
  );
}

// Same range set as the /watchlist price chart (1W … ALL) so the two graphs
// read identically. "ALL" over-asks; the OHLC route clamps to listed history.
const RANGE_OPTIONS: { label: string; days: number }[] = [
  { label: "1W", days: 7 },
  { label: "1M", days: 31 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
  { label: "5Y", days: 1825 },
  { label: "10Y", days: 3660 },
  { label: "ALL", days: 11000 },
];

/** ₹ with Indian grouping, no decimals — for the position badge. */
function rupee(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/**
 * The cost-relative readout for the chart badge — mirrors the watchlist's
 * "held + P&L%" chip, but sourced from the alert's own context (which carries
 * avg cost + the gain/loss that tripped the rule). Only the cost-basis rules
 * (target_hit / deep_drawdown) have this; others return null (no badge).
 */
function positionReadout(ruleKey: string, ctx: Record<string, unknown>): { avg: number; pct: number } | null {
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const avg = num(ctx.avg);
  if (avg == null) return null;
  if (ruleKey === "target_hit") {
    const g = num(ctx.gainPct);
    return g == null ? null : { avg, pct: g };
  }
  if (ruleKey === "deep_drawdown") {
    const l = num(ctx.lossPct);
    return l == null ? null : { avg, pct: -l };
  }
  return null;
}
// Reuse across re-renders / re-opens so a range already fetched is instant.
const candleCache = new Map<string, Candle[]>();

// The single detail chart — fills its parent's height so it uses the full pane.
// Same /api/scanner/ohlc source + CandleChart renderer as the watchlist, down to
// the range set and the cost-relative badge next to "Price".
function AlertChart({
  symbol,
  readout,
  qty,
  drawings,
  alertLines,
}: {
  symbol: string;
  readout?: { avg: number; pct: number } | null;
  qty?: number | null;
  drawings?: Drawing[];
  alertLines?: AlertLine[];
}) {
  const [days, setDays] = useState(365);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const key = `${symbol}:${days}`;
    const cached = candleCache.get(key);
    if (cached) {
      setCandles(cached);
      setErr(false);
      return;
    }
    let alive = true;
    setCandles(null);
    setErr(false);
    fetch(`/api/scanner/ohlc?syms=${encodeURIComponent(symbol)}&days=${days}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: { data: Record<string, Candle[]> }) => {
        if (!alive) return;
        const c = j.data?.[symbol] ?? [];
        candleCache.set(key, c);
        setCandles(c);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [symbol, days]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[9.5px] uppercase tracking-wide muted-text">Price</span>
          {qty != null && qty > 0 && (
            <span className="text-[10.5px] tabular-nums muted-text">
              {qty.toLocaleString("en-IN")} SH
            </span>
          )}
          {readout && (
            <span className="flex items-center gap-1 text-[10.5px] tabular-nums">
              <span className="muted-text">avg {rupee(readout.avg)}</span>
              <span
                className="font-medium"
                style={{
                  color: readout.pct >= 0 ? "var(--color-delta-up)" : "var(--color-delta-down)",
                }}
              >
                {readout.pct >= 0 ? "+" : ""}
                {readout.pct.toFixed(1)}%
              </span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap rounded-md border hairline overflow-hidden">
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.days}
              type="button"
              onClick={() => setDays(o.days)}
              className="px-2.5 py-1 text-[11px] tabular-nums transition-colors border-l first:border-l-0 hairline"
              style={
                days === o.days
                  ? { backgroundColor: "var(--color-accent-600)", color: "white" }
                  : undefined
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-[260px] w-full rounded-md border hairline overflow-hidden">
        {err ? (
          <div className="h-full flex items-center justify-center muted-text text-[12px]">
            Couldn&apos;t load price data.
          </div>
        ) : candles === null ? (
          <div className="h-full flex items-center justify-center muted-text text-[12px]">
            Loading chart…
          </div>
        ) : candles.length === 0 ? (
          <div className="h-full flex items-center justify-center muted-text text-[12px]">
            No price history.
          </div>
        ) : (
          <CandleChart
            candles={candles}
            interactive
            weekly={days > 730}
            drawings={drawings}
            alerts={alertLines}
          />
        )}
      </div>
    </div>
  );
}

const keyOf = (a: AlertRow) => `${a.ruleKey}-${a.id}`;

// One row in the left sector tree — severity dot, symbol/title, composite chip.
function TreeRow({
  a,
  enrich,
  selected,
  onSelect,
}: {
  a: AlertRow;
  enrich?: AlertEnrichment;
  selected: boolean;
  onSelect: () => void;
}) {
  const color = SEV_COLOR[a.severity];
  const dimmed = a.status === "dismissed";
  const comp = a.ruleKey === "hold_limit" ? null : enrich?.composite ?? null;
  const isAgg = a.ruleKey === "hold_limit";
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--color-paper)]"
      style={{
        opacity: dimmed ? 0.55 : 1,
        ...(selected
          ? {
              backgroundColor: "var(--color-paper)",
              boxShadow: "inset 2px 0 0 var(--color-accent-600)",
            }
          : {}),
      }}
      title={a.reason}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 flex-1">
        <span className="ink-text text-[12.5px] font-medium">
          {isAgg ? "Hold limit" : a.symbol}
        </span>
        <span className="muted-text ml-1.5 text-[11px]">{a.title}</span>
      </span>
      {comp != null && (
        <span className="muted-text tabular-nums text-[11px]">{Math.round(comp)}</span>
      )}
    </button>
  );
}

export function AlertsClient({
  initialActive,
  initialDismissed,
  enrich = {},
  heldQty = {},
}: {
  initialActive: AlertRow[];
  initialDismissed: AlertRow[];
  enrich?: Record<string, AlertEnrichment>;
  heldQty?: Record<string, number>;
}) {
  const router = useRouter();
  // Shared overlays so the lines a user drew (or the price alerts they armed) on
  // the scanner Graph tab also render on this alert chart.
  const getDrawings = useChartDrawings();
  const getAlertLines = usePriceAlertLines();
  const [active, setActive] = useState<AlertRow[]>(initialActive);
  const [dismissed, setDismissed] = useState<AlertRow[]>(initialDismissed);
  const [checking, startCheck] = useTransition();
  const [tab, setTab] = useState<TabKey>("all");
  // The focused alert (key = ruleKey-id). Falls back to the first in view when
  // the selection isn't present in the current filter.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const matchesTab = (a: AlertRow, key: TabKey): boolean => {
    if (key === "all") return true;
    const t = TABS.find((x) => x.key === key);
    return t ? t.rules.includes(a.ruleKey) : true;
  };

  const visibleActive = active.filter((a) => matchesTab(a, tab));
  const visibleDismissed = dismissed.filter((a) => matchesTab(a, tab));
  // Flat nav order = active first, then dismissed. Prev/Next walk this list.
  const flat = [...visibleActive, ...visibleDismissed];

  const idxRaw = flat.findIndex((a) => keyOf(a) === selectedKey);
  const idx = idxRaw < 0 ? 0 : idxRaw;
  const sel = flat[idx] ?? null;
  const atFirst = idx <= 0;
  const atLast = idx >= flat.length - 1;
  const go = (delta: number) => {
    const n = flat[idx + delta];
    if (n) setSelectedKey(keyOf(n));
  };

  // Keyboard ← / → step through stocks (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "ArrowLeft" && !atFirst) { e.preventDefault(); go(-1); }
      if (e.key === "ArrowRight" && !atLast) { e.preventDefault(); go(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const same = (a: AlertRow, b: AlertRow) => a.id === b.id && a.ruleKey === b.ruleKey;

  const dismiss = async (card: AlertRow) => {
    setActive((xs) => xs.filter((a) => !same(a, card)));
    setDismissed((xs) => [{ ...card, status: "dismissed" }, ...xs]);
    try {
      const r = await fetch("/api/alerts/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: card.id, ruleKey: card.ruleKey }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      setDismissed((xs) => xs.filter((a) => !same(a, card)));
      setActive((xs) => [card, ...xs]);
    }
  };

  const checkNow = () => {
    startCheck(async () => {
      try {
        await fetch("/api/alerts/evaluate", { method: "POST" });
      } catch {
        /* refresh still re-reads whatever's there */
      }
      router.refresh();
    });
  };

  // Group the flat list by sector for the left tree. hold_limit + unmapped names
  // land in "Other". Sectors sorted alphabetically; rows keep flat order within.
  const groups = new Map<string, AlertRow[]>();
  for (const a of flat) {
    const sector =
      a.ruleKey === "hold_limit" ? "Portfolio" : enrich[a.symbol]?.sector ?? "Other";
    const arr = groups.get(sector) ?? [];
    arr.push(a);
    groups.set(sector, arr);
  }
  const sectorNames = Array.from(groups.keys()).sort((x, y) => x.localeCompare(y));

  const selEnrich = sel ? enrich[sel.symbol] : undefined;
  const selShowEnrich = sel != null && sel.ruleKey !== "hold_limit" && selEnrich != null;
  const selComp = selShowEnrich ? selEnrich!.composite : null;

  return (
    <div>
      {/* Top bar: count · horizontal category tabs · Check now. */}
      <div className="flex items-center gap-3 mb-3">
        <div className="muted-text text-[12.5px] shrink-0">
          {active.length === 0
            ? "No active alerts"
            : `${active.length} active`}
        </div>
        <div
          className="flex items-center gap-1 overflow-x-auto flex-1"
          style={{ scrollbarWidth: "none" }}
          role="tablist"
        >
          {TABS.map((t) => {
            const activeN = active.filter((a) => matchesTab(a, t.key)).length;
            const total =
              activeN + dismissed.filter((a) => matchesTab(a, t.key)).length;
            if (t.key !== "all" && total === 0) return null;
            const selTab = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={selTab}
                onClick={() => setTab(t.key)}
                className={`shrink-0 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${
                  selTab ? "text-white" : "muted-text hover:bg-[var(--color-paper)]"
                }`}
                style={
                  selTab
                    ? { backgroundColor: "var(--color-accent-600)" }
                    : { border: "1px solid var(--color-border-default)" }
                }
              >
                {t.label}
                {activeN > 0 && (
                  <span
                    className="ml-1.5 inline-block rounded-full px-1.5 text-[10.5px] font-semibold"
                    style={
                      selTab
                        ? { backgroundColor: "rgba(255,255,255,0.25)" }
                        : {
                            backgroundColor: "var(--color-paper)",
                            color: "var(--color-accent-600)",
                          }
                    }
                  >
                    {activeN}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={checkNow}
          disabled={checking}
          className="shrink-0 rounded-md px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity disabled:opacity-60"
          style={{ backgroundColor: "var(--color-accent-600)" }}
        >
          {checking ? "Checking…" : "Check now"}
        </button>
      </div>

      {flat.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="ink-text text-[15px] font-medium mb-1">
            {tab === "all" ? "All clear" : "Nothing here"}
          </p>
          <p className="muted-text text-[13px] max-w-sm mx-auto">
            {tab === "all"
              ? "Nothing needs your attention right now. Alerts appear here when a holding hits its +25% target, drops sharply in a day, or falls 20% below your cost."
              : "No alerts in this category. Switch to All to see everything."}
          </p>
        </div>
      ) : (
        // Master/detail: left sector tree, right single big chart.
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 items-stretch">
          {/* LEFT — sector tree of alerted names. */}
          <div className="card overflow-y-auto lg:h-[calc(100vh-190px)] lg:min-h-[480px]">
            {sectorNames.map((s) => (
              <div key={s}>
                <div className="sticky top-0 z-10 bg-[var(--color-paper)]/95 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide muted-text border-b hairline">
                  {s}
                  <span className="ml-1.5 opacity-70">{groups.get(s)!.length}</span>
                </div>
                <div className="divide-y hairline">
                  {groups.get(s)!.map((a) => (
                    <TreeRow
                      key={keyOf(a)}
                      a={a}
                      enrich={enrich[a.symbol]}
                      selected={sel != null && keyOf(a) === keyOf(sel)}
                      onSelect={() => setSelectedKey(keyOf(a))}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* RIGHT — the focused alert: header + prev/next, scores, one chart. */}
          <div className="card flex flex-col overflow-hidden p-4 lg:h-[calc(100vh-190px)] lg:min-h-[480px]">
            {sel && (
              <>
                {/* Prev/Next stepper + position. */}
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => go(-1)}
                    disabled={atFirst}
                    className="rounded-md border hairline px-2.5 py-1 text-[13px] font-medium disabled:opacity-40 hover:bg-[var(--color-paper)] transition-colors"
                    aria-label="Previous stock"
                    title="Previous stock (←)"
                  >
                    ‹
                  </button>
                  <span className="text-[12px] tabular-nums muted-text min-w-[54px] text-center">
                    {idx + 1} / {flat.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => go(1)}
                    disabled={atLast}
                    className="rounded-md border hairline px-2.5 py-1 text-[13px] font-medium disabled:opacity-40 hover:bg-[var(--color-paper)] transition-colors"
                    aria-label="Next stock"
                    title="Next stock (→)"
                  >
                    ›
                  </button>
                  {sel.status === "active" && sel.ruleKey !== "hold_limit" && (
                    <button
                      type="button"
                      onClick={() => dismiss(sel)}
                      className="ml-auto shrink-0 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-[var(--color-paper)]"
                      style={{ borderColor: "var(--color-border-default)" }}
                      aria-label={`Dismiss ${sel.title} for ${sel.symbol}`}
                    >
                      Dismiss
                    </button>
                  )}
                </div>

                {/* Title line. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5"
                    style={{
                      color: SEV_COLOR[sel.severity],
                      backgroundColor: `${SEV_COLOR[sel.severity]}1a`,
                    }}
                  >
                    {SEV_LABEL[sel.severity]}
                  </span>
                  <span className="ink-text text-[15px] font-semibold">{sel.title}</span>
                  {sel.ruleKey !== "hold_limit" && (
                    <Link
                      href={`/stock/${sel.symbol}`}
                      className="text-[13px] font-semibold underline decoration-dotted hover:no-underline"
                      style={{ color: "var(--color-accent-600)" }}
                    >
                      {sel.symbol}
                    </Link>
                  )}
                  {selComp != null && (
                    <span
                      className="inline-block min-w-[34px] text-center px-1.5 py-0.5 rounded tabular-nums font-semibold text-[11px]"
                      style={{
                        backgroundColor: bandColor(band(selComp)),
                        color: band(selComp) === "neutral" ? "var(--color-ink)" : "white",
                      }}
                      title="Composite peer-cluster score (0–100)"
                    >
                      {Math.round(selComp)}
                    </span>
                  )}
                  <span className="muted-text text-[11px] ml-auto whitespace-nowrap">
                    {ago(sel.triggeredAt)}
                  </span>
                </div>

                <p className="ink-text mt-1 text-[13px] leading-[1.5]">{sel.reason}</p>

                {selShowEnrich && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                    <ScorePill label="Q" value={selEnrich!.quality} />
                    <ScorePill label="V" value={selEnrich!.valuation} />
                    <ScorePill label="M" value={selEnrich!.momentum} />
                    <span className="muted-text">·</span>
                    <RetPill label="1D" value={selEnrich!.ret1d} />
                    <RetPill label="1W" value={selEnrich!.ret1w} />
                    <RetPill label="1M" value={selEnrich!.ret1m} />
                    <RetPill label="6M" value={selEnrich!.ret6m} />
                    <RetPill label="1Y" value={selEnrich!.ret1y} />
                  </div>
                )}

                {/* Single chart, filling the rest of the pane. */}
                {sel.ruleKey !== "hold_limit" ? (
                  <div className="mt-3 flex-1 min-h-0">
                    <AlertChart
                      key={sel.symbol}
                      symbol={sel.symbol}
                      readout={positionReadout(sel.ruleKey, sel.context)}
                      qty={heldQty[sel.symbol] ?? null}
                      drawings={getDrawings(sel.symbol)}
                      alertLines={getAlertLines(sel.symbol)}
                    />
                  </div>
                ) : (
                  <div className="mt-3 flex-1 min-h-[200px] flex items-center justify-center muted-text text-[12.5px]">
                    An aggregate digest — no single chart.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
