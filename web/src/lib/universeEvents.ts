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
 */
import { sql } from "@/lib/db";

export type UniverseEvent = {
  id: number;
  symbol: string;
  event: "added" | "removed";
  companyName: string | null;
  eventAt: string; // ISO timestamp
  source: "sync" | "backfill";
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
    SELECT id,
           symbol,
           event,
           company_name AS "companyName",
           event_at     AS "eventAt",
           source
      FROM app.universe_event
     WHERE event_at >= (date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')
                        - make_interval(weeks => ${weeks - 1}))
     ORDER BY event_at DESC, symbol ASC
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
