import Link from "next/link";
import type { AlertRow, Severity } from "@/lib/alerts";
import { loadAttention } from "@/lib/attention";

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

const HOLD_SENTINEL = "__ALL__";

export type StaleBroker = { label: string; ageDays: number };

/**
 * One-line "needs a look" disclosure. Closed by default — five alert
 * cards on first paint stole the holdings table. Native <details>, no
 * hydrate. Quiet books render nothing.
 */
export async function AttentionStrip({
  userId,
  staleBrokers = [],
}: {
  userId: number;
  staleBrokers?: StaleBroker[];
}) {
  const { alerts, headlines } = await loadAttention(userId);
  const stale = staleBrokers.filter((b) => b.ageDays >= 5);
  if (alerts.length === 0 && headlines.length === 0 && stale.length === 0) {
    return null;
  }

  const bits: string[] = [];
  if (alerts.length > 0) bits.push(`${alerts.length} open`);
  if (stale.length > 0) bits.push(`${stale.length} stale file${stale.length > 1 ? "s" : ""}`);
  if (headlines.length > 0) bits.push(`${headlines.length} headline${headlines.length > 1 ? "s" : ""}`);
  const urgent = alerts.filter((a) => a.severity === "urgent").length;

  return (
    <details
      className="group mb-2 rounded-md border hairline"
      style={{ backgroundColor: "var(--color-card)" }}
    >
      <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-1.5 text-[12px] select-none">
        <span className="muted-text transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
        <span className="font-medium">Needs a look</span>
        <span className="muted-text">· {bits.join(" · ")}</span>
        {urgent > 0 && (
          <span
            className="ml-auto text-[11px] font-medium"
            style={{ color: "var(--color-score-poor)" }}
          >
            {urgent} urgent
          </span>
        )}
      </summary>
      <div className="border-t hairline">
        {stale.map((b) => (
          <p key={b.label} className="px-3 py-1.5 text-[12px] border-b hairline">
            {b.label} holdings file is {b.ageDays} days old — day-change may
            be about the CSV, not the market.
          </p>
        ))}
        {alerts.map((a) => (
          <AlertLine key={`${a.ruleKey}-${a.id}`} row={a} />
        ))}
        {headlines.map((h) => (
          <p key={h.id} className="px-3 py-1.5 text-[12px] border-t hairline">
            <span className="muted-text text-[11px] mr-1.5">News</span>
            {h.title}
            {h.symbols.length > 0 && (
              <span className="muted-text"> · {h.symbols.slice(0, 3).join(", ")}</span>
            )}
          </p>
        ))}
        <div className="px-3 py-1.5 border-t hairline">
          <Link
            href="/tools/alerts"
            className="text-[11px] font-medium"
            style={{ color: "var(--color-accent-700)" }}
          >
            See all alerts
          </Link>
        </div>
      </div>
    </details>
  );
}

function AlertLine({ row }: { row: AlertRow }) {
  const href =
    row.symbol && row.symbol !== HOLD_SENTINEL
      ? `/stock/${encodeURIComponent(row.symbol)}`
      : "/tools/alerts";
  return (
    <Link
      href={href}
      className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-2 px-3 py-1.5 border-t hairline hover:bg-[var(--color-paper)]"
    >
      <span
        className="text-[11px] font-medium"
        style={{ color: SEV_COLOR[row.severity] }}
      >
        {SEV_LABEL[row.severity]}
      </span>
      <span className="min-w-0 truncate">
        <span className="font-medium text-[12px] font-mono">
          {row.symbol === HOLD_SENTINEL ? row.title : row.symbol}
        </span>
        <span className="muted-text text-[12px]"> — {row.reason}</span>
      </span>
    </Link>
  );
}
