/**
 * Zone 7 — the fortnight ahead for YOUR names: results dates and ex-dates.
 *
 * The universe-wide calendar is ~43 companies in any two-week window, which is
 * a list nobody reads. Restricted to held + watchlisted, it becomes the one
 * genuinely time-sensitive thing on this page: the dates you should not be
 * surprised by.
 *
 * Source is app.corporate_action, action_type 'board_meeting'. BSE publishes
 * every board meeting there, most of them not results — rights issues, fund
 * raising, narrative blurbs — so the purpose filter is load-bearing, not
 * cosmetic. A symbol can also carry SEVERAL rows for the same meeting (one
 * structured, one prose), hence MIN(ex_date) GROUP BY symbol rather than
 * SELECT DISTINCT: without it HCLTECH shows up twice on the same date.
 *
 * Dates are intentions, not commitments. A company can move its board meeting,
 * and this table records what was last filed — which is why the header says
 * "as filed" rather than implying a guarantee.
 */
import { sql } from "@/lib/db";
import { loadPortfolioSymbols } from "@/lib/portfolio";
import { Zone, Empty, SymbolLink, fmtDay } from "./ui";

const WINDOW_DAYS = 14;
const ROW_CAP = 30;

/** 'R' = results (board meeting), 'X' = an ex-date you must hold through. */
type EventKind = "R" | "X";

type ResultRow = {
  symbol: string;
  date: string;
  kind: EventKind;
  purpose: string;
};

/**
 * Results dates and ex-dates in one query.
 *
 * Both halves read app.corporate_action, so a UNION beats two round-trips —
 * but they are NOT the same kind of date and the UI must not merge them: a
 * results date is "news is coming", an ex-date is "own it by this day or you
 * do not get the dividend/bonus". Hence the `kind` discriminator rather than
 * one undifferentiated list.
 *
 * The ex-date half deliberately excludes 'board_meeting', which is the results
 * half's action_type — without that exclusion every results date would appear
 * twice, once per branch.
 */
async function loadUpcomingResults(userId: number, held: string[]): Promise<ResultRow[]> {
  return sql<ResultRow[]>`
    WITH mine AS (
      SELECT ca.*
        FROM app.corporate_action ca
       WHERE
         -- ::int is required, not stylistic. A bare placeholder here binds as
         -- unknown, and date + unknown is ambiguous in Postgres (date+int vs
         -- date+interval), so the query errors and the .catch() below turns a
         -- broken query into a silent empty widget. It did exactly that once.
         ca.ex_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ${WINDOW_DAYS}::int
         AND (
           ca.symbol = ANY(${held})
           OR ca.symbol IN (SELECT w.symbol FROM app.user_watchlist w WHERE w.user_id = ${userId})
         )
    )
    SELECT symbol, MIN(ex_date)::text AS date, 'R' AS kind, MIN(purpose) AS purpose
      FROM mine
     WHERE action_type = 'board_meeting' AND purpose ILIKE '%result%'
     GROUP BY symbol
    UNION ALL
    SELECT symbol, MIN(ex_date)::text AS date, 'X' AS kind,
           MIN(action_type) AS purpose
      FROM mine
     WHERE action_type <> 'board_meeting'
     GROUP BY symbol, action_type
     ORDER BY 2, 3, 1
     LIMIT ${ROW_CAP}
  `.catch(() => [] as ResultRow[]);
}

export async function ResultsZone({ userId }: { userId: number }) {
  const held = await loadPortfolioSymbols(userId).catch(() => [] as string[]);
  const rows = await loadUpcomingResults(userId, held);
  const heldSet = new Set(held);

  // Group by date AND kind, so one line reads "14 Oct · results: A, B, C" and
  // the ex-dates never get mixed into the same sentence as the results.
  const groups = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const k = `${r.date}|${r.kind}`;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }

  return (
    /* No `href`: there is no calendar page in this app, and a header link to one
       that does not exist is worse than no link. */
    <Zone
      title="Calendar"
      count={rows.length || undefined}
      meta={`${WINDOW_DAYS}d · results + ex-dates · as filed`}
    >
      {rows.length === 0 ? (
        <Empty>
          No results or ex-dates in the next {WINDOW_DAYS} days for your holdings
          or watchlist.
        </Empty>
      ) : (
        <ul className="divide-y hairline">
          {[...groups].map(([key, group]) => (
            <li key={key} className="py-[3px] flex items-baseline gap-1.5">
              <span className="shrink-0 muted-text text-[10px] tabular-nums w-[42px]">
                {fmtDay(group[0].date)}
              </span>
              <KindChip row={group[0]} />
              <span className="min-w-0 flex-1 text-[11.5px] truncate">
                {group.map((r, i) => (
                  <span key={`${r.symbol}-${r.purpose}`}>
                    {i > 0 && <span className="muted-text"> · </span>}
                    <SymbolLink symbol={r.symbol} />
                    {/* A watchlist name reporting is interesting; a name you own
                        reporting is the one you have money on. */}
                    {heldSet.has(r.symbol) && (
                      <span className="muted-text text-[9.5px]"> held</span>
                    )}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Zone>
  );
}

/**
 * Results dates and ex-dates look identical in a list and mean opposite things
 * — one is "news arrives", the other is "the deadline to be on the register".
 * The chip is the only thing distinguishing them, so it carries the action type
 * (dividend / bonus / split) rather than a generic "ex".
 */
function KindChip({ row }: { row: ResultRow }) {
  const results = row.kind === "R";
  const label = results ? "results" : row.purpose.replace(/_/g, " ");
  return (
    <span
      className="shrink-0 rounded px-1 text-[9px] font-semibold uppercase tracking-wide"
      style={{
        backgroundColor: results
          ? "var(--color-accent-600)"
          : "var(--color-score-weak)",
        color: "white",
      }}
    >
      {label}
    </span>
  );
}
