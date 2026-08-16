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

const RANGE_OPTIONS: { label: string; days: number }[] = [
  { label: "1M", days: 31 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
];
// Reuse across re-renders / re-opens so a range already fetched is instant.
const candleCache = new Map<string, Candle[]>();

// Inline candle chart for an alert's symbol — mirrors the watchlist's ChartBlock
// (same /api/scanner/ohlc source + CandleChart renderer), just a touch shorter.
function AlertChart({ symbol }: { symbol: string }) {
  const [days, setDays] = useState(180);
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
    <div className="mt-2.5">
      <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
        <span className="text-[9.5px] uppercase tracking-wide muted-text">Price</span>
        <div className="flex rounded-md border hairline overflow-hidden">
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.days}
              type="button"
              onClick={() => setDays(o.days)}
              className="px-2 py-0.5 text-[10.5px] tabular-nums transition-colors border-l first:border-l-0 hairline"
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
      <div className="h-[200px] w-full rounded-md border hairline overflow-hidden">
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
          <CandleChart candles={candles} interactive weekly={days > 730} />
        )}
      </div>
    </div>
  );
}

function AlertCard({
  a,
  dimmed,
  enrich,
  onDismiss,
}: {
  a: AlertRow;
  dimmed: boolean;
  enrich?: AlertEnrichment;
  onDismiss?: (a: AlertRow) => void;
}) {
  const color = SEV_COLOR[a.severity];
  // hold_limit is an aggregate digest (sentinel symbol) — no single chart/scores.
  const showEnrich = a.ruleKey !== "hold_limit" && enrich != null;
  const comp = enrich?.composite ?? null;
  const compColor = bandColor(band(comp));
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-paper)]/60"
      style={{
        borderLeft: `3px solid ${color}`,
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5"
            style={{ color, backgroundColor: `${color}1a` }}
          >
            {SEV_LABEL[a.severity]}
          </span>
          <span className="ink-text text-[14px] font-medium">{a.title}</span>
          {a.ruleKey !== "hold_limit" && (
            <Link
              href={`/stock/${a.symbol}`}
              className="text-[12px] font-semibold underline decoration-dotted hover:no-underline"
              style={{ color: "var(--color-accent-600)" }}
            >
              {a.symbol}
            </Link>
          )}
          {showEnrich && comp != null && (
            <span
              className="ml-auto inline-block min-w-[34px] text-center px-1.5 py-0.5 rounded tabular-nums font-semibold text-[11px]"
              style={{
                backgroundColor: compColor,
                color: band(comp) === "neutral" ? "var(--color-ink)" : "white",
              }}
              title="Composite peer-cluster score (0–100)"
            >
              {Math.round(comp)}
            </span>
          )}
          <span
            className={`muted-text text-[11px] whitespace-nowrap ${
              showEnrich && comp != null ? "" : "ml-auto"
            }`}
          >
            {ago(a.triggeredAt)}
          </span>
        </div>
        <p className="ink-text mt-1 text-[13px] leading-[1.5]">{a.reason}</p>

        {showEnrich && (
          <>
            {/* Scores (QVM) + return ladder — same figures as the watchlist row. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <ScorePill label="Q" value={enrich!.quality} />
              <ScorePill label="V" value={enrich!.valuation} />
              <ScorePill label="M" value={enrich!.momentum} />
              <span className="muted-text">·</span>
              <RetPill label="1D" value={enrich!.ret1d} />
              <RetPill label="1W" value={enrich!.ret1w} />
              <RetPill label="1M" value={enrich!.ret1m} />
              <RetPill label="6M" value={enrich!.ret6m} />
              <RetPill label="1Y" value={enrich!.ret1y} />
            </div>
            {/* Chart only for live cards — skip it on greyed/dismissed rows so a
                long dismissed list doesn't fire a fetch per row. */}
            {!dimmed && <AlertChart symbol={a.symbol} />}
          </>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(a)}
          className="shrink-0 self-center rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-[var(--color-paper)]"
          style={{ borderColor: "var(--color-border-default)" }}
          aria-label={`Dismiss ${a.title} for ${a.symbol}`}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

export function AlertsClient({
  initialActive,
  initialDismissed,
  enrich = {},
}: {
  initialActive: AlertRow[];
  initialDismissed: AlertRow[];
  enrich?: Record<string, AlertEnrichment>;
}) {
  const router = useRouter();
  const [active, setActive] = useState<AlertRow[]>(initialActive);
  const [dismissed, setDismissed] = useState<AlertRow[]>(initialDismissed);
  const [checking, startCheck] = useTransition();
  const [tab, setTab] = useState<TabKey>("all");

  // Which rule_keys does a tab match? "all" matches everything.
  const matchesTab = (a: AlertRow, key: TabKey): boolean => {
    if (key === "all") return true;
    const t = TABS.find((x) => x.key === key);
    return t ? t.rules.includes(a.ruleKey) : true;
  };

  const visibleActive = active.filter((a) => matchesTab(a, tab));
  const visibleDismissed = dismissed.filter((a) => matchesTab(a, tab));

  // Identity is (ruleKey, id): app.alert and app.price_alert ids can overlap,
  // so id alone isn't unique across the merged feed.
  const same = (a: AlertRow, b: AlertRow) => a.id === b.id && a.ruleKey === b.ruleKey;

  const dismiss = async (card: AlertRow) => {
    // Optimistic: move active → dismissed immediately.
    setActive((xs) => xs.filter((a) => !same(a, card)));
    setDismissed((xs) => [{ ...card, status: "dismissed" }, ...xs]);
    try {
      const r = await fetch("/api/alerts/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // ruleKey lets the endpoint route price-alert cards to their own table.
        body: JSON.stringify({ id: card.id, ruleKey: card.ruleKey }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      // Revert on failure.
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="muted-text text-[12.5px]">
          {active.length === 0
            ? "No active alerts"
            : `${active.length} active alert${active.length === 1 ? "" : "s"}`}
        </div>
        <button
          type="button"
          onClick={checkNow}
          disabled={checking}
          className="rounded-md px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity disabled:opacity-60"
          style={{ backgroundColor: "var(--color-accent-600)" }}
        >
          {checking ? "Checking…" : "Check now"}
        </button>
      </div>

      {/* Watchlist-style master/detail: category rail on the left, the alert
          feed on the right. A category is listed only if it has any alert
          (active or dismissed), except "All" which is always present. */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4 items-start">
        {/* LEFT rail — categories. */}
        <div className="card overflow-hidden lg:sticky lg:top-4">
          <div className="divide-y hairline" role="tablist">
            {TABS.map((t) => {
              const activeN = active.filter((a) => matchesTab(a, t.key)).length;
              const total =
                activeN + dismissed.filter((a) => matchesTab(a, t.key)).length;
              if (t.key !== "all" && total === 0) return null;
              const sel = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={sel}
                  onClick={() => setTab(t.key)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--color-paper)]"
                  style={
                    sel
                      ? {
                          backgroundColor: "var(--color-paper)",
                          boxShadow: "inset 2px 0 0 var(--color-accent-600)",
                        }
                      : undefined
                  }
                >
                  <span
                    className={sel ? "ink-text font-semibold" : "ink-text"}
                  >
                    {t.label}
                  </span>
                  {activeN > 0 && (
                    <span
                      className="ml-auto inline-block rounded-full px-1.5 text-[10.5px] font-semibold"
                      style={{
                        backgroundColor: "var(--color-paper)",
                        color: "var(--color-accent-600)",
                        border: "1px solid var(--color-border-default)",
                      }}
                    >
                      {activeN}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT panel — the alert feed. */}
        <div className="card overflow-hidden min-h-[240px]">
          {visibleActive.length === 0 && visibleDismissed.length === 0 ? (
            <div className="p-8 text-center">
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
            <div className="divide-y hairline">
              {visibleActive.map((a) => (
                <AlertCard
                  key={`${a.ruleKey}-${a.id}`}
                  a={a}
                  dimmed={false}
                  enrich={enrich[a.symbol]}
                  onDismiss={dismiss}
                />
              ))}

              {visibleDismissed.length > 0 && (
                <>
                  <div className="flex items-center gap-3 px-4 py-2 bg-[var(--color-paper)]/40">
                    <span className="muted-text text-[11px] uppercase tracking-wide">
                      Dismissed
                    </span>
                    <div
                      className="h-px flex-1"
                      style={{ backgroundColor: "var(--color-border-default)" }}
                    />
                  </div>
                  {visibleDismissed.map((a) => (
                    <AlertCard
                      key={`${a.ruleKey}-${a.id}`}
                      a={a}
                      dimmed
                      enrich={enrich[a.symbol]}
                      onDismiss={undefined}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
