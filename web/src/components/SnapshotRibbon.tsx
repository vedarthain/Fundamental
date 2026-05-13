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

type SnapshotStats = {
  latest: Date | null;
  coverage: number;
  clusters: number;
  upgrades: number | null;
  downgrades: number | null;
  topMoverSymbol: string | null;
  topMoverDelta: number | null;
  archiveCount: number;
};

async function fetchSnapshot(): Promise<SnapshotStats> {
  // One round-trip with multiple subqueries. Each is keyed off the latest
  // and prior snapshot_date so the ribbon always reflects the most recent
  // run, no parameter wiring needed.
  const rows = await sql<
    {
      latest: Date | null;
      coverage: string;
      clusters: string;
      upgrades: string | null;
      downgrades: string | null;
      top_symbol: string | null;
      top_delta: number | null;
      archive_count: string;
    }[]
  >`
    WITH latest AS (SELECT MAX(snapshot_date) AS d FROM app.scores),
    prior AS (
      SELECT MAX(snapshot_date) AS d FROM app.scores
      WHERE snapshot_date < (SELECT d FROM latest)
    ),
    delta AS (
      SELECT c.symbol, (c.composite_pct - p.composite_pct)::int AS dlt
      FROM app.scores c
      JOIN app.scores p USING (symbol)
      WHERE c.snapshot_date = (SELECT d FROM latest)
        AND p.snapshot_date = (SELECT d FROM prior)
        AND c.composite_pct IS NOT NULL
        AND p.composite_pct IS NOT NULL
    ),
    top_abs AS (
      -- Cap at |dlt| <= 40. Composite_pct is 0-100, so a single-snapshot
      -- swing greater than 40 is almost always noise from a recent listing
      -- (e.g. BLUESTONE, CCAVENUE in their first months of trading) or a
      -- peer-set change rather than a real score-mover signal.
      SELECT symbol, dlt
      FROM delta
      WHERE ABS(dlt) <= 40
      ORDER BY ABS(dlt) DESC NULLS LAST
      LIMIT 1
    )
    SELECT
      (SELECT d FROM latest) AS latest,
      (SELECT COUNT(*) FROM app.scores WHERE snapshot_date = (SELECT d FROM latest)) AS coverage,
      (SELECT COUNT(*) FROM app.cluster) AS clusters,
      (SELECT COUNT(*) FROM delta WHERE dlt >= 5)  AS upgrades,
      (SELECT COUNT(*) FROM delta WHERE dlt <= -5) AS downgrades,
      (SELECT symbol FROM top_abs) AS top_symbol,
      (SELECT dlt    FROM top_abs) AS top_delta,
      (SELECT COUNT(DISTINCT snapshot_date) FROM app.scores) AS archive_count
  `;

  const r = rows[0];
  return {
    latest: r.latest,
    coverage: Number(r.coverage),
    clusters: Number(r.clusters),
    upgrades: r.upgrades == null ? null : Number(r.upgrades),
    downgrades: r.downgrades == null ? null : Number(r.downgrades),
    topMoverSymbol: r.top_symbol,
    topMoverDelta: r.top_delta,
    archiveCount: Number(r.archive_count),
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
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <span
        className="kbd-label"
        style={{ color: "var(--color-strip-muted)" }}
      >
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
  const s = await getCachedSnapshot();
  const topSign = s.topMoverDelta != null && s.topMoverDelta >= 0 ? "+" : "";

  return (
    <div
      className="border-b sticky top-0 z-40"
      style={{
        backgroundColor: "var(--color-strip-bg)",
        borderColor: "var(--color-strip-rule)",
      }}
    >
      <div className="mx-auto max-w-[1300px] px-4 md:px-6 h-7 flex items-center gap-4 overflow-x-auto">
        <Cell label="SNAPSHOT">{formatSnapshotDate(s.latest)}</Cell>
        <Sep />
        <Cell label="COVERAGE">{s.coverage.toLocaleString("en-IN")}</Cell>
        <Sep />
        <Cell label="CLUSTERS">{s.clusters}</Cell>
        {s.upgrades != null && s.downgrades != null && (
          <>
            <Sep />
            <Cell label="MOVERS">
              <span className="delta-up">▲{s.upgrades}</span>
              <span style={{ color: "var(--color-strip-muted)" }}> · </span>
              <span className="delta-down">▼{s.downgrades}</span>
            </Cell>
          </>
        )}
        {s.topMoverSymbol && s.topMoverDelta != null && (
          <>
            <Sep />
            <Cell label="TOP MOVE">
              <span style={{ color: "var(--color-strip-fg)" }}>
                {s.topMoverSymbol}
              </span>{" "}
              <span
                className={s.topMoverDelta >= 0 ? "delta-up" : "delta-down"}
              >
                {topSign}
                {s.topMoverDelta}
              </span>
            </Cell>
          </>
        )}
        <Sep />
        <Cell label="ARCHIVE">
          {s.archiveCount} {s.archiveCount === 1 ? "snapshot" : "snapshots"}
        </Cell>
      </div>
    </div>
  );
}
