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
 * Compact "needs a look" strip. Quiet books render nothing.
 * Alerts are the last-reconciled set — never re-evaluated here.
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

  return (
    <section
      className="mb-4 rounded-md border hairline overflow-hidden"
      style={{ backgroundColor: "var(--color-card)" }}
      aria-label="Needs a look today"
    >
      <div
        className="flex items-baseline justify-between gap-3 px-3 py-1.5 border-b hairline"
      >
        <span className="text-[11px] font-medium muted-text">
          Needs a look today
          {alerts.length > 0 ? ` · ${alerts.length} open` : ""}
        </span>
        <Link
          href="/tools/alerts"
          className="text-[11px] font-medium"
          style={{ color: "var(--color-accent-700)" }}
        >
          See all alerts
        </Link>
      </div>
      {stale.map((b) => (
        <p
          key={b.label}
          className="px-3 py-2 text-[13px] border-b hairline"
          style={{ backgroundColor: "var(--color-tab-tint-about, #fbf2ed)" }}
        >
          {b.label} holdings file is {b.ageDays} days old — day-change may be a
          story about the CSV, not the market.
        </p>
      ))}
      {alerts.map((a) => (
        <AlertLine key={`${a.ruleKey}-${a.id}`} row={a} />
      ))}
      {headlines.map((h) => (
        <p key={h.id} className="px-3 py-2 text-[13px] border-t hairline">
          <span className="muted-text text-[11px] mr-2">News</span>
          {h.title}
          {h.symbols.length > 0 && (
            <span className="muted-text text-[12px]">
              {" "}
              · {h.symbols.slice(0, 3).join(", ")}
            </span>
          )}
        </p>
      ))}
    </section>
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
      className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 px-3 py-2 border-t hairline hover:bg-[var(--color-paper)]"
    >
      <span
        className="text-[11px] font-medium pt-0.5"
        style={{ color: SEV_COLOR[row.severity] }}
      >
        {SEV_LABEL[row.severity]}
      </span>
      <span>
        <span className="font-medium text-[13px] font-mono">
          {row.symbol === HOLD_SENTINEL ? row.title : row.symbol}
        </span>
        <span className="block text-[12px] muted-text leading-snug mt-0.5">
          {row.reason}
        </span>
      </span>
    </Link>
  );
}
