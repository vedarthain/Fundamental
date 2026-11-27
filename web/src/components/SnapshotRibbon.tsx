/**
 * SnapshotRibbon — thin dark strip above the site header.
 *
 * The Bloomberg silhouette (sticky, dark, monospace, red/green) repurposed
 * for the platform's actual edge: a *weekly snapshot archive*, not a live
 * tape. Each cell here surfaces a "moat" fact (per docs/MOAT.md):
 *
 *   SNAPSHOT  → when the current weekly run finished (the receipts)
 *   COVERAGE  → universe size scored this snapshot
 *   MOVERS    → count of stocks whose composite_pct moved ≥ 5 vs prior snapshot
 *   TOP MOVE  → biggest single-stock score jump or drop this snapshot
 *   ARCHIVE   → how many snapshots are stored (grows every Sunday)
 *
 * Why not Nifty/Sensex/USD-INR like Bloomberg: golden_db has no index-level
 * data, and the docs (PITCH.md, MOAT.md) explicitly position the product
 * away from market-tape coverage ("Bloomberg has more data; we have a
 * sharper view of it"). The ribbon reinforces that, not contradicts it.
 *
 * Server component — runs the aggregate query on each request. Cached at
 * the segment level (revalidate below) since the underlying snapshot only
 * changes when the Friday ETL run lands.
 */
import TodayCell from "@/components/TodayCell";
import { RibbonIndices } from "@/components/RibbonIndices";

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <span className="kbd-label" style={{ color: "var(--color-strip-muted)" }}>
        {label}
      </span>
      <span className="num num-sm" style={{ color: "var(--color-strip-fg)" }}>
        {children}
      </span>
    </span>
  );
}

function Sep() {
  return (
    <span
      aria-hidden
      className="h-3 w-px shrink-0"
      style={{ backgroundColor: "var(--color-strip-rule)" }}
    />
  );
}

export async function SnapshotRibbon() {
  const todayIstSeed = new Date().toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <div
      className="border-b sticky top-0 z-40 w-full overflow-hidden"
      style={{
        backgroundColor: "var(--color-strip-bg)",
        borderColor: "var(--color-strip-rule)",
      }}
    >
      <div
        className="mx-auto max-w-[1600px] px-3.5 sm:px-6 h-7 flex items-center gap-2.5 sm:gap-3 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        <Cell label="TODAY"><TodayCell initial={todayIstSeed} /></Cell>
        <RibbonIndices />
        <Sep />
        <span
          className="kbd-label whitespace-nowrap shrink-0 font-bold"
          style={{ color: "#ffffff" }}
          title="EquityRoots is not a SEBI-registered investment adviser. Information only."
        >
          INFO ONLY · NOT ADVICE
        </span>
      </div>
    </div>
  );
}
