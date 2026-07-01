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
 *   ARCHIVE   → how many snapshots are stored (grows every Friday)
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
import { sql } from "@/lib/db";
import { unstable_cache } from "next/cache";
import TodayCell from "@/components/TodayCell";

type SnapshotStats = {
  latest: Date | null;          // weekly scoring snapshot date
  coverage: number;
  clusters: number;
};

async function fetchSnapshot(): Promise<SnapshotStats> {
  // Minimal ribbon query — snapshot date, total stocks, total clusters.
  const appRows = await sql<
    { latest: Date | null; coverage: string; clusters: string }[]
  >`
    WITH latest AS (SELECT MAX(snapshot_date) AS d FROM app.scores)
    SELECT
      (SELECT d FROM latest) AS latest,
      -- "Coverage" = how many NSE stocks we track = the active universe
      -- (matches the home hero + screener breadcrumb). Counting scores at the
      -- latest snapshot instead drifts a few low (e.g. 2,157 vs 2,163) when a
      -- handful of active names miss a weekly score.
      (SELECT COUNT(*) FROM app.universe WHERE is_active) AS coverage,
      -- Populated peer groups at the latest snapshot (same definition the
      -- /sectors page uses → consistent "46"). A raw COUNT(*) on app.cluster
      -- over-counts: it includes 2 deprecated clusters + the empty
      -- "unclassified" bucket that no stock is in.
      (SELECT COUNT(*) FROM app.cluster_composite_cache
        WHERE snapshot_date = (SELECT d FROM latest)) AS clusters
  `;

  const r = appRows[0];
  return {
    latest: r.latest,
    coverage: Number(r.coverage),
    clusters: Number(r.clusters),
  };
}

// Cache for an hour — snapshot data only changes weekly, but an hour TTL
// keeps the strip fresh enough during admin re-runs without hammering DB
// on every page navigation.
const getCachedSnapshot = unstable_cache(fetchSnapshot, ["snapshot-ribbon"], {
  revalidate: 3600,
  tags: ["snapshot"],
});

function formatSnapshotDate(d: Date | string | null): string {
  if (!d) return "—";
  // `postgres` returns Date objects for top-level DATE columns, but DATE
  // values pulled through a scalar subquery (SELECT d FROM latest) come
  // back as ISO strings. Coerce defensively rather than threading types.
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  // "Wed 13 May" — short, no year.
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function Cell({
  label,
  children,
  highlight = false,
}: {
  label: string;
  children: React.ReactNode;
  /** Emphasise the value — used for SNAPSHOT so the "latest snapshot" date
   *  (what every Q/V/M percentile on the site is pinned to) stands out from
   *  the surrounding metadata. */
  highlight?: boolean;
}) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <span
        className="kbd-label"
        style={{ color: highlight ? "var(--color-strip-fg)" : "var(--color-strip-muted)" }}
      >
        {label}
      </span>
      <span
        className="num num-sm"
        style={
          highlight
            ? {
                color: "var(--color-delta-up)",
                fontWeight: 700,
                borderBottom: "1.5px solid var(--color-delta-up)",
                paddingBottom: "1px",
              }
            : { color: "var(--color-strip-fg)" }
        }
      >
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
  const s = await getCachedSnapshot();

  // Today's date in IST — seed value for SSR/static HTML. The ribbon is baked
  // into every ISR page, so this server value can freeze at revalidation time
  // (BUG-05). TodayCell recomputes it in the browser on mount, so the visible
  // date is always the current calendar day regardless of ISR staleness.
  const todayIstSeed = new Date().toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <div
      className="border-b sticky top-0 z-40"
      style={{
        backgroundColor: "var(--color-strip-bg)",
        borderColor: "var(--color-strip-rule)",
      }}
    >
      <div className="mx-auto max-w-[1300px] px-4 md:px-6 h-7 flex items-center gap-4 overflow-x-auto">
        {/* TODAY — current calendar date (IST). Leads the strip so users always
            see the current day at a glance. */}
        <Cell label="TODAY"><TodayCell initial={todayIstSeed} /></Cell>
        <Sep />
        {/* SNAPSHOT — weekly scoring snapshot date. Updates Fridays after
            close. Quality/Valuation/Momentum percentiles are pinned to this. */}
        <Cell label="SNAPSHOT" highlight>{formatSnapshotDate(s.latest)}</Cell>
        <Sep />
        <Cell label="COVERAGE">{s.coverage.toLocaleString("en-IN")}</Cell>
        <Sep />
        <Cell label="PEER GROUPS">{s.clusters}</Cell>
        <Sep />
        {/* Persistent disclaimer — sits in the dark ribbon so it's visible
            on every page without taking up dedicated UI real estate.
            Rendered bold + white so the regulatory framing reads at a
            glance and isn't easily confused with the muted metadata cells
            around it. */}
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
