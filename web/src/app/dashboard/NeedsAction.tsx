/**
 * Zone 2 — everything asking for a decision, in one severity-ranked list.
 *
 * Four sources that used to live on four different pages:
 *   portfolio rules + user price alerts  → loadAttention (already merged; do
 *     NOT also call loadPriceAlertRows — loadAlerts folds those in, and calling
 *     both double-counts every triggered level)
 *   earnings-quality other-income spikes → getOIAlerts
 *   verdict evidence that has since moved → loadVerdictChips
 *   two-day headlines on held/watched     → loadAttention
 *
 * Nothing here re-evaluates a rule: this reads the last reconciled state, so
 * opening the dashboard costs reads only. /tools/alerts owns "check now".
 */
import Link from "next/link";
import { loadAttention } from "@/lib/attention";
import { loadPortfolioSymbols } from "@/lib/portfolio";
import { getOIAlerts, type OIAlert } from "@/lib/oi-alerts";
import { loadVerdictChips, type VerdictChip } from "@/lib/verdict";
import type { Severity } from "@/lib/alerts";
import { Zone, Empty, SymbolLink } from "./ui";

/**
 * The box scrolls, so the cap only has to be small enough that the DOM stays
 * cheap — not small enough to fit the visible area.
 */
const ITEM_CAP = 20;
/** A verdict older than this is called out even when nothing has moved. */
const VERDICT_STALE_DAYS = 120;

const SEV_COLOR: Record<Severity, string> = {
  urgent: "var(--color-score-poor)",
  warn: "var(--color-score-weak)",
  info: "var(--color-accent-600)",
};
const SEV_RANK: Record<Severity, number> = { urgent: 0, warn: 1, info: 2 };

type Item = {
  key: string;
  severity: Severity;
  symbol: string | null;
  label: string;
  reason: string;
};

export async function NeedsAction({ userId }: { userId: number }) {
  const [{ alerts, headlines }, held] = await Promise.all([
    loadAttention(userId),
    loadPortfolioSymbols(userId).catch(() => [] as string[]),
  ]);

  // Both of these are keyed on the held set, so an empty book skips the
  // round-trips entirely rather than querying with an empty array.
  const [oi, chips] = await Promise.all<
    [Promise<Map<string, OIAlert>>, Promise<Map<string, VerdictChip>>]
  >([
    held.length > 0
      ? getOIAlerts(held).catch(() => new Map<string, OIAlert>())
      : Promise.resolve(new Map<string, OIAlert>()),
    held.length > 0
      ? loadVerdictChips(held).catch(() => new Map<string, VerdictChip>())
      : Promise.resolve(new Map<string, VerdictChip>()),
  ]);

  const items: Item[] = [];

  for (const a of alerts) {
    items.push({
      key: `alert:${a.ruleKey}:${a.id}`,
      severity: a.severity,
      symbol: a.symbol,
      label: a.title,
      reason: a.reason,
    });
  }

  for (const [symbol, flag] of oi) {
    items.push({
      key: `oi:${symbol}`,
      severity: "warn",
      symbol,
      label: "Other income spike",
      reason: `${flag.spike_ratio.toFixed(1)}× its prior average and ${Math.round(
        flag.oi_pct_pbt,
      )}% of PBT in ${flag.period_end} — the quarter's profit is not all operating`,
    });
  }

  for (const [symbol, chip] of chips) {
    if (chip.movedCount > 0) {
      items.push({
        key: `drift:${symbol}`,
        severity: "warn",
        symbol,
        label: "Verdict evidence moved",
        reason: `${chip.movedCount} of ${chip.comparableCount} figures behind the "${chip.verdict}" call have changed since it was written`,
      });
    } else if (chip.stale || chip.ageDays >= VERDICT_STALE_DAYS) {
      items.push({
        key: `stale:${symbol}`,
        severity: "info",
        symbol,
        label: "Verdict ageing",
        reason: `"${chip.verdict}" written ${chip.ageDays} days ago and not revisited`,
      });
    }
  }

  for (const h of headlines) {
    items.push({
      key: `news:${h.id}`,
      severity: "info",
      symbol: h.symbols[0] ?? null,
      label: "Headline",
      reason: h.title,
    });
  }

  items.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const shown = items.slice(0, ITEM_CAP);
  const urgent = items.filter((i) => i.severity === "urgent").length;

  return (
    <Zone
      title="Needs action"
      href="/tools/alerts"
      count={items.length || undefined}
      meta={urgent > 0 ? `${urgent} urgent` : undefined}
    >
      {shown.length === 0 ? (
        <Empty>
          Nothing open. Rules, price levels and verdict drift are all quiet.
        </Empty>
      ) : (
        <ul className="divide-y hairline">
          {shown.map((i) => (
            <li key={i.key} className="py-[3px] flex gap-1.5 items-baseline">
              <span
                className="shrink-0 rounded-full self-center"
                style={{
                  width: 5,
                  height: 5,
                  backgroundColor: SEV_COLOR[i.severity],
                }}
                aria-label={i.severity}
              />
              {/* One line per item, reason truncated: the point of this zone is
                  the count and the names, not the prose. The detail is on
                  /tools/alerts, which is one tap away in the header. */}
              <span className="min-w-0 flex-1 text-[11.5px] truncate">
                {i.symbol && (
                  <>
                    <SymbolLink symbol={i.symbol} />{" "}
                  </>
                )}
                <span className="font-medium">{i.label}</span>
                <span className="muted-text"> — {i.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {items.length > shown.length && (
        <Link
          href="/tools/alerts"
          className="block mt-1 text-[10px]"
          style={{ color: "var(--color-accent-700)" }}
        >
          {items.length - shown.length} more
        </Link>
      )}
    </Zone>
  );
}
