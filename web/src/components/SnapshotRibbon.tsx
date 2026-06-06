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
import { sql, golden } from "@/lib/db";
import { unstable_cache } from "next/cache";

type SnapshotStats = {
  latest: Date | null;          // weekly scoring snapshot date
  ltpDate: Date | string | null; // most recent bhavcopy / LTP date (golden EOD)
  intradayDate: string | null;   // most recent intraday pinger write (IST date)
  coverage: number;
  clusters: number;
  archiveCount: number;
};

async function fetchSnapshot(): Promise<SnapshotStats> {
  // Minimal ribbon query — just snapshot date, total stocks, total
  // clusters, archive count. Used to also compute MOVERS + TOP MOVE
  // via prior-snapshot delta CTE, but those panels were removed and
  // their subqueries were pure waste on every cold render.
  //
  // The LTP/bhavcopy date is fetched separately from golden_db because
  // it's a different pool (read-only price warehouse). Both queries run
  // in parallel; the ribbon is cached for an hour so the extra round
  // trip lands at most once per hour per region.
  const [appRows, goldenRows] = await Promise.all([
    sql<
      {
        latest: Date | null;
        coverage: string;
        clusters: string;
        archive_count: string;
        intraday_date: string | null;
      }[]
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
          WHERE snapshot_date = (SELECT d FROM latest)) AS clusters,
        (SELECT COUNT(DISTINCT snapshot_date) FROM app.scores) AS archive_count,
        -- Most recent intraday pinger write, as an IST calendar date. Lets
        -- the PRICES cell show TODAY once the pinger has run, instead of
        -- lagging on golden's EOD bhavcopy date until tonight's ingest.
        (SELECT (MAX(price_fetched_at) AT TIME ZONE 'Asia/Kolkata')::date::text
           FROM app.screener_meta) AS intraday_date
    `,
    // MAX(date) in golden.price_history WHERE interval='1d' is the most
    // recent trading day for which bhavcopy data is present — which is
    // the LTP date. Single index lookup; cheap.
    golden<{ ltp_date: Date | string | null }[]>`
      SELECT MAX(date) AS ltp_date
        FROM golden.price_history
       WHERE interval = '1d'
    `,
  ]);

  const r = appRows[0];
  return {
    latest: r.latest,
    ltpDate: goldenRows[0]?.ltp_date ?? null,
    intradayDate: r.intraday_date ?? null,
    coverage: Number(r.coverage),
    clusters: Number(r.clusters),
    archiveCount: Number(r.archive_count),
  };
}

/** ISO "YYYY-MM-DD" for a Date or string, or null. Used to compare the
 *  golden EOD date against the intraday pinger date so we can show whichever
 *  is more recent in the PRICES cell. */
function isoDay(d: Date | string | null): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
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

  // PRICES date = the fresher of golden's EOD bhavcopy date and the intraday
  // pinger's last-write date. During market hours (and until tonight's EOD
  // ingest) the intraday date is "today" and wins; pre-pinger it falls back
  // to the EOD date. Compared as ISO day strings so it's TZ-stable.
  const eodDay = isoDay(s.ltpDate);
  const intraDay = s.intradayDate;
  const pricesDay =
    intraDay && (!eodDay || intraDay > eodDay) ? intraDay : (eodDay ?? null);

  return (
    <div
      className="border-b sticky top-0 z-40"
      style={{
        backgroundColor: "var(--color-strip-bg)",
        borderColor: "var(--color-strip-rule)",
      }}
    >
      <div className="mx-auto max-w-[1300px] px-4 md:px-6 h-7 flex items-center gap-4 overflow-x-auto">
        {/* PRICES — last LTP / bhavcopy date. Updates daily (Mon-Fri 18:30 IST).
            Shown first because price freshness is what users typically wonder
            about ("are these stale?"). */}
        <Cell label="PRICES">{formatSnapshotDate(pricesDay)}</Cell>
        <Sep />
        {/* SNAPSHOT — weekly scoring snapshot date. Updates Fridays after
            close. Quality/Valuation/Momentum percentiles are pinned to this. */}
        <Cell label="SNAPSHOT">{formatSnapshotDate(s.latest)}</Cell>
        <Sep />
        <Cell label="COVERAGE">{s.coverage.toLocaleString("en-IN")}</Cell>
        <Sep />
        <Cell label="PEER GROUPS">{s.clusters}</Cell>
        <Sep />
        <Cell label="ARCHIVE">
          {s.archiveCount} {s.archiveCount === 1 ? "snapshot" : "snapshots"}
        </Cell>
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
