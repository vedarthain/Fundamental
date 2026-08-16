"use client";

/**
 * AlertsClient — renders ring-1 portfolio alerts: active cards on top,
 * dismissed greyed below, plus a "Check now" that re-evaluates on demand.
 *
 * Dismiss is optimistic: the card greys immediately and POSTs; a failure
 * reverts it. "Check now" re-evaluates server-side then refreshes the route so
 * the server component re-reads the reconciled set (no client-side merge).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AlertRow, Severity } from "@/lib/alerts";

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

function AlertCard({
  a,
  dimmed,
  onDismiss,
}: {
  a: AlertRow;
  dimmed: boolean;
  onDismiss?: (id: number) => void;
}) {
  const color = SEV_COLOR[a.severity];
  return (
    <div
      className="card flex items-start gap-3 p-4 transition-opacity"
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
          <span className="muted-text text-[11px] ml-auto whitespace-nowrap">
            {ago(a.triggeredAt)}
          </span>
        </div>
        <p className="ink-text mt-1 text-[13px] leading-[1.5]">{a.reason}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(a.id)}
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
}: {
  initialActive: AlertRow[];
  initialDismissed: AlertRow[];
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

  const dismiss = async (id: number) => {
    const card = active.find((a) => a.id === id);
    if (!card) return;
    // Optimistic: move active → dismissed immediately.
    setActive((xs) => xs.filter((a) => a.id !== id));
    setDismissed((xs) => [{ ...card, status: "dismissed" }, ...xs]);
    try {
      const r = await fetch("/api/alerts/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      // Revert on failure.
      setDismissed((xs) => xs.filter((a) => a.id !== id));
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

      {/* Category tabs. A tab is shown only if it has any alert (active or
          dismissed), except "All" which is always present. The count badge
          reflects ACTIVE alerts in that category. */}
      <div
        className="flex items-center gap-1 overflow-x-auto mb-4 pb-px"
        style={{ scrollbarWidth: "none" }}
        role="tablist"
      >
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
              className={`shrink-0 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${
                sel ? "text-white" : "muted-text hover:bg-[var(--color-paper)]"
              }`}
              style={
                sel
                  ? { backgroundColor: "var(--color-accent-600)" }
                  : { border: "1px solid var(--color-border-default)" }
              }
            >
              {t.label}
              {activeN > 0 && (
                <span
                  className="ml-1.5 inline-block rounded-full px-1.5 text-[10.5px] font-semibold"
                  style={
                    sel
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

      {visibleActive.length === 0 && visibleDismissed.length === 0 ? (
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
        <div className="space-y-3">
          {visibleActive.map((a) => (
            <AlertCard key={a.id} a={a} dimmed={false} onDismiss={dismiss} />
          ))}

          {visibleDismissed.length > 0 && (
            <>
              <div className="flex items-center gap-3 pt-4 pb-1">
                <div
                  className="h-px flex-1"
                  style={{ backgroundColor: "var(--color-border-default)" }}
                />
                <span className="muted-text text-[11px] uppercase tracking-wide">
                  Dismissed
                </span>
                <div
                  className="h-px flex-1"
                  style={{ backgroundColor: "var(--color-border-default)" }}
                />
              </div>
              {visibleDismissed.map((a) => (
                <AlertCard key={a.id} a={a} dimmed onDismiss={undefined} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
