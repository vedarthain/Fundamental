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

      {active.length === 0 && dismissed.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="ink-text text-[15px] font-medium mb-1">All clear</p>
          <p className="muted-text text-[13px] max-w-sm mx-auto">
            Nothing needs your attention right now. Alerts appear here when a
            holding hits its +25% target, drops sharply in a day, or falls 20%
            below your cost.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {active.map((a) => (
            <AlertCard key={a.id} a={a} dimmed={false} onDismiss={dismiss} />
          ))}

          {dismissed.length > 0 && (
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
              {dismissed.map((a) => (
                <AlertCard key={a.id} a={a} dimmed onDismiss={undefined} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
