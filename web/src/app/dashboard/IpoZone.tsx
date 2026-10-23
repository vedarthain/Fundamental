/**
 * Zone 8 — IPOs in flight: open now, then upcoming, then just closed.
 *
 * Reuses /ideas' `loadIpos()` rather than writing a second query. That function
 * carries three decisions this tile must not re-derive: the NSE exchange filter
 * lives in the loader and not the ETL, a NULL `listing_exchange` is ADMITTED
 * (it means "RHP not filed", not "BSE only" — it is how Jio and Flipkart stay
 * visible), and the listed window is six months by WHERE rather than LIMIT.
 * Copying the SQL here would have forked all three. Read IpoTracker.tsx's
 * docstring before touching anything in this file.
 *
 * `listed` rows are excluded: 167 of the ~200 rows are listed history, which is
 * a browsing surface, not a deadline. What belongs on a home page is the subset
 * with a date you can still act on.
 *
 * THE AGE STAMP IS LOAD-BEARING. app.ipo is a snapshot fed by an Upstox OAuth
 * token that dies daily at 03:30 IST with no refresh flow, and on 2026-10-02 it
 * had been dead nine days with nothing reporting it. A closed bidding window
 * looks open when the snapshot date is absent, so past IPO_STALE_HOURS the meta
 * turns into a warning and the same threshold as the tracker is used — two
 * staleness definitions for one table is how they drift.
 */
import { unstable_cache } from "next/cache";
import { loadIpos, IPO_STALE_HOURS, type IpoRow } from "../ideas/IpoTracker";
import { Zone, Empty, fmtDay, num } from "./ui";

/** Display order: a deadline first, then a date, then an allotment to watch. */
const LIVE_STATUSES = ["open", "upcoming", "closed"] as const;
const ROW_CAP = 20;

const cachedIpos = unstable_cache(loadIpos, ["dashboard:ipo:v1"], {
  revalidate: 3600,
  tags: ["ipo", "panel-cache"],
});

export async function IpoZone() {
  const data = await cachedIpos().catch(() => null);
  const rows = (data?.rows ?? [])
    .filter((r) => (LIVE_STATUSES as readonly string[]).includes(r.status))
    .sort(
      (a, b) =>
        LIVE_STATUSES.indexOf(a.status as (typeof LIVE_STATUSES)[number]) -
          LIVE_STATUSES.indexOf(b.status as (typeof LIVE_STATUSES)[number]) ||
        (a.bidding_start ?? "").localeCompare(b.bidding_start ?? ""),
    )
    .slice(0, ROW_CAP);

  const ageH = ageHours(data?.fetchedAt ?? null);
  const stale = ageH != null && ageH > IPO_STALE_HOURS;

  return (
    <Zone
      title="IPO"
      href="/ipo"
      count={rows.length || undefined}
      meta={
        ageH == null
          ? "snapshot date unknown"
          : stale
            ? `snapshot ${Math.round(ageH)}h old — may be out of date`
            : `snapshot ${Math.round(ageH)}h old`
      }
    >
      {rows.length === 0 ? (
        <Empty>
          No issue open, upcoming or awaiting allotment in the current snapshot.
        </Empty>
      ) : (
        <ul className="divide-y hairline">
          {rows.map((r) => (
            <li key={r.id} className="py-[3px] flex items-baseline gap-1.5">
              <StatusChip status={r.status} />
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] truncate font-medium">
                  {trimName(r.name)}
                  {r.issue_type === "sme" && (
                    <span className="muted-text font-normal text-[9.5px]"> SME</span>
                  )}
                </span>
                <span className="block muted-text text-[10px] truncate tabular-nums">
                  {band(r)} · {window_(r)}
                </span>
              </span>
              {/* Subscription multiple, not a percentage — Delta would colour it
                  and sign it, which is wrong for a ×-times figure. */}
              <span className="shrink-0 text-[11px] tabular-nums muted-text">
                {r.total_subscription != null
                  ? `${num(r.total_subscription, 1)}×`
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Zone>
  );
}

const CHIP: Record<string, { label: string; color: string }> = {
  open: { label: "OPEN", color: "var(--color-delta-up)" },
  upcoming: { label: "SOON", color: "var(--color-accent-600)" },
  closed: { label: "CLSD", color: "var(--color-score-weak)" },
};

function StatusChip({ status }: { status: IpoRow["status"] }) {
  const c = CHIP[status] ?? CHIP.closed;
  return (
    <span
      className="shrink-0 rounded px-1 text-[8.5px] font-semibold tracking-wide self-center"
      style={{ backgroundColor: c.color, color: "white" }}
    >
      {c.label}
    </span>
  );
}

/** "Ravita Engineering Services IPO" → "Ravita Engineering Services". Every
 *  row ends in "IPO" inside a widget titled IPO. */
function trimName(name: string): string {
  return name.replace(/\s+IPO$/i, "");
}

function band(r: IpoRow): string {
  if (r.min_price == null && r.max_price == null) return "band TBA";
  if (r.min_price != null && r.max_price != null && r.min_price !== r.max_price) {
    return `₹${num(r.min_price)}–${num(r.max_price)}`;
  }
  return `₹${num(r.max_price ?? r.min_price)}`;
}

/** The date that matters differs by status: a closing deadline while open, the
 *  opening date while upcoming, the listing date once bidding is done. */
function window_(r: IpoRow): string {
  if (r.status === "open") {
    return r.bidding_end ? `closes ${fmtDay(r.bidding_end)}` : "closing date TBA";
  }
  if (r.status === "upcoming") {
    return r.bidding_start ? `opens ${fmtDay(r.bidding_start)}` : "dates TBA";
  }
  return r.listing_date ? `lists ${fmtDay(r.listing_date)}` : "listing date TBA";
}

function ageHours(fetchedAt: string | null): number | null {
  if (!fetchedAt) return null;
  const t = Date.parse(fetchedAt);
  return Number.isFinite(t) ? (Date.now() - t) / 3_600_000 : null;
}
