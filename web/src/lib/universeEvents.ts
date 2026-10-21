/**
 * universeEvents.ts — the immutable add/remove log for the tracked universe.
 *
 * Backed by app.universe_event (migration 0055), which the ETL sync-universe
 * command appends to every time it onboards a new NSE listing ('added') or
 * retires a dark name ('removed'). Because it is append-only, ANY past week can
 * be replayed — unlike app.universe.synced_at, which only remembers each
 * symbol's most-recent transition.
 *
 * The page groups events into ISO weeks (Mon–Sun) so "what changed this week"
 * is a natural read. source='backfill' rows are the one-time seed reconstructed
 * from synced_at when the log was created — flagged so the UI can mark them as
 * approximate rather than live-recorded.
 *
 * TWO THINGS THIS LOG DOES NOT KNOW, both joined in below.
 *
 * 1. WHEN THE STOCK LISTED. event_at is when OUR sync ran, which for a backfilled
 *    coverage gap has nothing to do with the market. MHHL listed on 2018-02-16
 *    and was onboarded on 2026-10-20, so the bare log renders a seven-year-old
 *    company as a new listing — a 3,168-day error, presented to users as news.
 *    app.universe.listing_date is populated for every active symbol (3,179 of
 *    3,179 on 2026-10-21), so `isNewListing` is a join, not a migration.
 *
 * 2. WHETHER WE CAN ACTUALLY SCORE IT YET. A day-1 IPO is admitted to the
 *    universe immediately and has no annual history, so compute_metrics
 *    deliberately withholds it (maturity_tier outside SCORED_TIERS). Without
 *    this, HD FIRE PROTECT — scoreable, five years of Screener history — and
 *    SIGNORIA — zero annuals, nothing to score — appear identical.
 *    `coverageStatus` is read from app.coverage_ledger rather than re-derived,
 *    so the page shows the ETL's own verdict instead of a second opinion that
 *    can drift from it.
 */
import { sql } from "@/lib/db";

/** The ETL's own coverage verdict (app.coverage_ledger.status, migration 0068). */
export type CoverageStatus =
  | "scored"
  | "gated_stale_financials"
  | "gated_insufficient_history"
  | "fetch_failing"
  | "never_attempted"
  | "no_metrics"
  | "unclassified";

export type UniverseEvent = {
  id: number;
  symbol: string;
  event: "added" | "removed";
  companyName: string | null;
  eventAt: string; // ISO timestamp
  source: "sync" | "backfill";
  /** app.universe.listing_date — when NSE listed it, not when we noticed. */
  listingDate: string | null;
  /**
   * Listed within 90 days of the moment we onboarded it. False means this row
   * is a coverage backfill of an existing company, not a new listing. NULL
   * listing_date → false: unknown is not news.
   */
  isNewListing: boolean;
  /** NULL for 'removed' events and for symbols not in the latest snapshot. */
  coverageStatus: CoverageStatus | null;
};

export type UniverseWeek = {
  /** ISO week start (Monday) as YYYY-MM-DD, in Asia/Kolkata. */
  weekStart: string;
  added: UniverseEvent[];
  removed: UniverseEvent[];
};

/**
 * Load the most recent membership changes, newest first, grouped by ISO week.
 * Backfill seed rows all share (roughly) the same timestamp, so they collapse
 * into whichever week the log was created — expected and harmless.
 *
 * @param weeks how many ISO weeks back to include (default 12).
 */
export async function loadUniverseChanges(weeks = 12): Promise<UniverseWeek[]> {
  const rows = await sql<UniverseEvent[]>`
    WITH latest AS (
      -- One snapshot only. coverage_ledger keeps every weekly snapshot, so an
      -- unqualified join would multiply each event by the number of weeks run.
      SELECT max(snapshot_date) AS d FROM app.coverage_ledger
    )
    SELECT e.id,
           e.symbol,
           e.event,
           e.company_name AS "companyName",
           e.event_at     AS "eventAt",
           e.source,
           u.listing_date AS "listingDate",
           (u.listing_date IS NOT NULL
            AND u.listing_date >= (e.event_at AT TIME ZONE 'Asia/Kolkata')::date
                                  - 90) AS "isNewListing",
           CASE WHEN e.event = 'added' THEN c.status END AS "coverageStatus"
      FROM app.universe_event e
      LEFT JOIN app.universe u ON u.symbol = e.symbol
      LEFT JOIN latest ON true
      LEFT JOIN app.coverage_ledger c
             ON c.symbol = e.symbol AND c.snapshot_date = latest.d
     WHERE e.event_at >= (date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')
                        - make_interval(weeks => ${weeks - 1}))
     ORDER BY e.event_at DESC, e.symbol ASC
  `;

  // Group into ISO weeks (Monday start) in IST. Doing the bucketing in JS keeps
  // the SQL simple and avoids a GROUP BY that would lose per-event rows.
  const byWeek = new Map<string, UniverseWeek>();
  for (const r of rows) {
    const d = new Date(r.eventAt);
    const weekStart = isoWeekStartIST(d);
    let bucket = byWeek.get(weekStart);
    if (!bucket) {
      bucket = { weekStart, added: [], removed: [] };
      byWeek.set(weekStart, bucket);
    }
    (r.event === "added" ? bucket.added : bucket.removed).push(r);
  }

  // Newest week first.
  return [...byWeek.values()].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
}

/** Monday 00:00 IST of the week containing `d`, as YYYY-MM-DD. */
function isoWeekStartIST(d: Date): string {
  // Shift to IST wall-clock, then snap back to Monday.
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const dow = (ist.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  ist.setUTCDate(ist.getUTCDate() - dow);
  return ist.toISOString().slice(0, 10);
}

/** Totals across the whole tracked history — for a header summary. */
export async function loadUniverseChangeTotals(): Promise<{
  added: number;
  removed: number;
  lastEventAt: string | null;
}> {
  const rows = await sql<{ added: number; removed: number; lastEventAt: string | null }[]>`
    SELECT COUNT(*) FILTER (WHERE event = 'added' AND source = 'sync')::int   AS added,
           COUNT(*) FILTER (WHERE event = 'removed' AND source = 'sync')::int AS removed,
           MAX(event_at) FILTER (WHERE source = 'sync')                        AS "lastEventAt"
      FROM app.universe_event
  `;
  return rows[0] ?? { added: 0, removed: 0, lastEventAt: null };
}
