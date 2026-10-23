/**
 * /ipo — the IPO tracker, as its own page under Segments.
 *
 * WHY IT MOVED OFF /ideas
 *
 * It was `/ideas?view=ipo`: a second top-level view bolted onto a page whose
 * every other control (eight buckets, four trend boards, an index-tier pill
 * row, a results calendar) means nothing on it. IpoTracker.tsx's own header
 * says why it was never a ninth bucket — "an IPO has no score, no history" —
 * and that argument applies one level up too. A reader looking for what is
 * open to apply for this week has no reason to look under Ideas, which is the
 * scored-stock feed.
 *
 * Segments is where the site answers "what is out there": indices, sectors,
 * industries, themes, the whole stock list. A listing calendar is the same
 * kind of question — market structure, not an opinion — so it belongs here.
 *
 * NOTHING ABOUT THE DATA CHANGED. loadIpos, IpoTracker and the status helpers
 * are imported from their original home rather than copied. A second copy of
 * the status derivation is how the dashboard's IPO zone and this table would
 * start disagreeing about what "open" means, which is CLAUDE.md §4's duplicated
 * buy marker with a date attached. /ideas?view=ipo still works — it redirects
 * here, so bookmarks and the dashboard tile are not broken by the move.
 */
import Link from "next/link";
import {
  IpoTracker,
  loadIpos,
  ipoCounts,
  defaultIpoStatus,
  isIpoStatus,
  IPO_STATUSES,
  type IpoStatus,
} from "../ideas/IpoTracker";

// The Upstox token this snapshot needs expires daily and is renewed by hand,
// so the feed itself updates at most once a day. An hour of ISR is well inside
// that and keeps the open/closed boundary honest on the day an issue closes.
// The age the reader sees comes from `fetched_at` on the row, not from when
// this page rendered, so ISR cannot make a stale snapshot look fresh.
export const revalidate = 3600;

export const metadata = {
  title: "IPO tracker · EquityRoots",
  description:
    "Mainboard and SME issues — open, upcoming, closed and recently listed, with dates, price bands and lot sizes.",
};

/** Same four colours the tracker's own section headings use. Kept as CSS
 *  variables rather than literals so the dot and the heading cannot drift. */
const STATUS_DOT: Record<IpoStatus, string> = {
  open: "var(--color-score-good)",
  upcoming: "var(--color-accent-700)",
  closed: "var(--color-score-weak)",
  listed: "var(--color-muted)",
};

const STATUS_LABEL: Record<IpoStatus, string> = {
  open: "Open now",
  upcoming: "Upcoming",
  closed: "Closed",
  listed: "Listed",
};

export default async function IpoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const data = await loadIpos();
  // Falls back to the first status that HAS rows rather than to a hardcoded
  // "open": for most of the year nothing is open, and landing on an empty
  // table makes the tracker look broken on exactly the days there is nothing
  // to apply for.
  const active: IpoStatus = isIpoStatus(sp.ipo) ? sp.ipo : defaultIpoStatus(data.rows);
  const n = ipoCounts(data.rows);

  return (
    <div className="mx-auto max-w-[1600px] px-5 pt-6 pb-10">
      <div className="text-[12px] uppercase tracking-wide muted-text flex items-center gap-2 flex-wrap">
        <Link href="/sectors" className="hover:underline">Segments</Link>
        <span aria-hidden style={{ color: "var(--color-border-default)" }}>›</span>
        <span>IPO tracker</span>
      </div>

      {/* A horizontal status row, not the two-column rail /ideas uses. That rail
          exists to separate "which view" from "which tab within it"; with the
          view switch gone there is one axis left, and giving it a 370px sidebar
          would spend the IPO table's eleven columns on chrome. */}
      <nav
        className="mt-3 flex flex-wrap gap-1.5"
        role="tablist"
        aria-label="IPO status"
      >
        {IPO_STATUSES.map((s) => {
          const on = s === active;
          return (
            <Link
              key={s}
              href={`/ipo?ipo=${s}`}
              scroll={false}
              role="tab"
              aria-selected={on}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12.5px] transition-colors"
              style={
                on
                  ? {
                      borderColor: "var(--color-accent-300)",
                      backgroundColor: "var(--color-accent-50)",
                      color: "var(--color-accent-700)",
                      fontWeight: 600,
                    }
                  : {
                      borderColor: "var(--color-border-default)",
                      color: "var(--color-muted)",
                    }
              }
            >
              <span
                aria-hidden
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: STATUS_DOT[s] }}
              />
              {STATUS_LABEL[s]}
              <span className="tabular-nums muted-text">{n[s]}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-5">
        <IpoTracker data={data} active={active} />
      </div>
    </div>
  );
}
