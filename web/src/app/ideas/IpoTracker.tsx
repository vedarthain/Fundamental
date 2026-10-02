/**
 * /ideas?view=ipo — the IPO tracker.
 *
 * WHY IT LIVES BEHIND A TOP-LEVEL VIEW SWITCH AND NOT AS A NINTH BUCKET TAB
 *
 * The eight existing tabs are all the same shape: a scored stock, a composite
 * delta, a 12-week trail. An IPO has none of those — it has no score, no
 * history, and frequently no price band yet. Dropping it in that strip would
 * put a row with eight empty columns next to rows that fill them, which reads
 * as a data bug rather than a different kind of object. So `?view` sits ABOVE
 * `?bucket`, and the two never render at once.
 *
 * THE FRESHNESS STAMP IS NOT DECORATION
 *
 * `app.ipo` is a snapshot, because Upstox's /v2/ipos needs a user OAuth token
 * that dies daily at 03:30 IST with no refresh flow — see db/migrations/0081.
 * Measured 2026-10-02: the stored token had been dead for nine days and nothing
 * reported it. So this surface WILL go stale, and the only honest defence is to
 * render the age where the reader cannot miss it. Past STALE_HOURS the header
 * turns into a warning rather than a caption, because "Parle Products, band TBA"
 * is indistinguishable from fresh data when the date is absent — and a bidding
 * window that closed yesterday looks open.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No grey-market premium, no "should you apply", no subscription forecast. GMP
 * is an unregulated number with no verifiable source, and the rest would be
 * advice. The tracker reports the issue's own published facts and the live
 * subscription multiple Upstox reports, and stops.
 */
import { sql } from "@/lib/db";

export type IpoRow = {
  id: string;
  symbol: string | null;
  name: string;
  status: "upcoming" | "open" | "closed" | "listed";
  issue_type: "regular" | "sme";
  industry: string | null;
  issue_size_cr: number | null;
  min_price: number | null;
  max_price: number | null;
  lot_size: number | null;
  bidding_start: string | null;
  bidding_end: string | null;
  allotment_date: string | null;
  listing_date: string | null;
  listing_price: number | null;
  listing_exchange: string | null;
  last_price: number | null;
  last_price_at: string | null;
  total_subscription: number | null;
  rhp_url: string | null;
  registrar: string | null;
  fetched_at: string;
};

export type IpoData = { rows: IpoRow[]; fetchedAt: string | null };

/** A snapshot older than this stops being a caption and becomes a warning.
 *
 *  36 hours, not 24: the token expires at 03:30 IST, so a snapshot taken at
 *  22:00 on Monday is legitimately ~30h old by the time Tuesday evening's
 *  reader sees it without anything having gone wrong. 24 would cry wolf nightly.
 *  Kept identical to fetch-ipos.py's --max-age-hours default on purpose — two
 *  different staleness definitions for one table is how they drift apart. */
export const IPO_STALE_HOURS = 36;

/** Status order, and the only place it is defined. The rail, the default-tab
 *  fallback and the counts all read it, so they cannot drift out of step. */
export const IPO_STATUSES = ["open", "upcoming", "closed", "listed"] as const;
export type IpoStatus = (typeof IPO_STATUSES)[number];

export function isIpoStatus(s: string | undefined): s is IpoStatus {
  return s != null && (IPO_STATUSES as readonly string[]).includes(s);
}

export function ipoCounts(rows: IpoRow[]): Record<IpoStatus, number> {
  const out = { open: 0, upcoming: 0, closed: 0, listed: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

/** First status that actually has rows, in display order.
 *
 *  The landing tab is NOT hardcoded to "open" because for most of the year
 *  nothing is open — the 2026-10-02 snapshot had 3 open and 86 listed, but a
 *  quiet fortnight has 0. Defaulting to an empty table would make the tracker
 *  look broken on exactly the days there is nothing to apply for. */
export function defaultIpoStatus(rows: IpoRow[]): IpoStatus {
  const c = ipoCounts(rows);
  return IPO_STATUSES.find((s) => c[s] > 0) ?? "upcoming";
}

/**
 * NSE-bound IPOs, newest-relevant first.
 *
 * WHY THE EXCHANGE FILTER IS HERE AND NOT IN fetch-ipos.py
 *
 * `listing_exchange` exists ONLY on the /v2/ipos/{id} detail response — the
 * list response does not carry it. So filtering at fetch time would still have
 * to make every list AND detail call and then discard rows: no saved requests,
 * and the snapshot permanently loses the ability to answer "was this one
 * BSE-only". The table stays complete; this surface is the opinionated cut.
 *
 * WHY A NULL EXCHANGE IS ADMITTED
 *
 * Measured on the 2026-10-02 snapshot: 100 rows name NSE ('NSE' or 'BSE,NSE'),
 * 73 are BSE-only, and 20 are NULL — all of them `upcoming`, and they include
 * Reliance Jio, Flipkart, PhonePe, OYO and Zepto. A NULL there means the issue
 * has not filed a final RHP yet, so nobody knows the venue; it does not mean
 * "not NSE". Dropping them would hide the most-awaited listings in the country
 * from a tracker whose entire job is forward visibility.
 *
 * This is the same admit-on-doubt tradeoff the ETL already made for a missing
 * ISIN in etl/nse_equity_master.py, and it is made the same way on purpose:
 * an absent field is an absence of knowledge, not a negative answer. The cost
 * is bounded — a handful of upcoming rows that may turn out BSE-only, which
 * self-correct the moment the RHP lands and the next snapshot fills the field.
 *
 * Deliberately NOT filtered by status: `listed` is the retrospective cut —
 * band vs. actual listing price — the only part of this surface that can be
 * checked against reality. No LIMIT either; a LIMIT would silently truncate the
 * moment the pipeline grew, and the UI already sections by status.
 *
 * WHY THE LISTED CUT IS SIX MONTHS AND WHY IT IS NOT SIX MONTHS YET
 *
 * Upstox serves only ~3 months of listed history — its listed set stopped dead
 * at 2026-07-06 for both regular and SME on the 2026-10-02 snapshot, which is a
 * server-side window and not a pagination artifact (both issue types ended on
 * the same date, neither on a page boundary). So the second half of this window
 * is built by ACCUMULATION: app.ipo keeps a row after the API forgets it, and
 * fetch-ipos.py evicts at 183 days. Until ~2027-01 this clause therefore selects
 * everything there is, and the 6-month promise fills in from the front.
 *
 * It is a WHERE and not a LIMIT for the reason above: a row count cannot express
 * "six months" when the issue rate per month is not constant. Measured on the
 * 2026-10-02 snapshot, the 86 NSE-listed rows fall 15 / 26 / 43 / 2 across Jul,
 * Aug, Sep and Oct — any fixed LIMIT is a different number of months depending
 * on which end of that it lands in.
 */
export async function loadIpos(): Promise<IpoData> {
  const rows = (await sql`
    SELECT id, symbol, name, status, issue_type, industry,
           issue_size_cr::float8      AS issue_size_cr,
           min_price::float8          AS min_price,
           max_price::float8          AS max_price,
           lot_size,
           bidding_start::text        AS bidding_start,
           bidding_end::text          AS bidding_end,
           allotment_date::text       AS allotment_date,
           listing_date::text         AS listing_date,
           listing_price::float8      AS listing_price,
           listing_exchange,
           last_price::float8         AS last_price,
           last_price_at::text        AS last_price_at,
           total_subscription::float8 AS total_subscription,
           rhp_url, registrar,
           fetched_at::text           AS fetched_at
      FROM app.ipo
     WHERE (listing_exchange IS NULL OR listing_exchange ILIKE '%NSE%')
       -- Six months of listed history; everything still in flight regardless of
       -- age, because an upcoming issue with a year-old DRHP is still upcoming.
       AND (status <> 'listed'
            OR listing_date IS NULL
            OR listing_date >= current_date - 183)
     ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'upcoming' THEN 1
                         WHEN 'closed' THEN 2 ELSE 3 END,
              COALESCE(bidding_start, listing_date) DESC NULLS LAST,
              name
  `) as unknown as IpoRow[];
  const fetchedAt = rows.reduce<string | null>(
    (max, r) => (max == null || r.fetched_at > max ? r.fetched_at : max),
    null,
  );
  return { rows, fetchedAt };
}

function inrCr(v: number | null): string {
  if (v == null) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v >= 100 ? 0 : 1 })} Cr`;
}

function band(r: IpoRow): string {
  if (r.min_price == null && r.max_price == null) return "band TBA";
  if (r.min_price != null && r.max_price != null && r.min_price !== r.max_price) {
    return `₹${r.min_price.toFixed(0)}–${r.max_price.toFixed(0)}`;
  }
  const one = r.max_price ?? r.min_price;
  return one == null ? "band TBA" : `₹${one.toFixed(0)}`;
}

function shortDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
}

/** Lot cost at the top of the band — the number that decides whether you can
 *  even apply. Retail has to bid at least one lot, so "₹196 × 600" is the real
 *  entry ticket and is not printed anywhere else on the row. Null whenever
 *  either half is missing: a guessed lot cost is worse than a dash. */
function lotCost(r: IpoRow): string {
  const p = r.max_price ?? r.min_price;
  if (p == null || !r.lot_size) return "—";
  return `₹${Math.round(p * r.lot_size).toLocaleString("en-IN")}`;
}

/** Listing gain vs the top of the band. Only meaningful once listed, and only
 *  when both numbers exist — 1 of 141 listed rows had no listing_price on the
 *  2026-10-02 snapshot, so the null case is real and not theoretical. */
function listingGain(r: IpoRow): number | null {
  const base = r.max_price ?? r.min_price;
  if (r.status !== "listed" || r.listing_price == null || base == null || base === 0) return null;
  return ((r.listing_price - base) / base) * 100;
}

/** Growth since the issue price, measured on the LATEST close rather than the
 *  listing-day print.
 *
 *  This is the column that makes the listed section worth keeping: a listing pop
 *  is one day's auction and says little, whereas "issued at ₹429, trading at
 *  ₹1,434" is the thing you want to know next time the same bankers bring a
 *  deal. Measured against the same base as listingGain (top of band, which for
 *  a book-built issue is the cut-off almost every retail applicant paid) so the
 *  two percentages are directly comparable — different bases would make the
 *  pair silently misleading.
 *
 *  Null whenever either half is missing, which is not theoretical: 55 of the 141
 *  listed rows are BSE-only and will never appear in the NSE instrument master,
 *  and 1 of the 86 NSE rows had not traded at all. */
function sinceIssue(r: IpoRow): number | null {
  const base = r.max_price ?? r.min_price;
  if (r.last_price == null || base == null || base === 0) return null;
  return ((r.last_price - base) / base) * 100;
}

function pctCell(v: number | null) {
  if (v == null) return <span className="muted-text">—</span>;
  return (
    <span
      className="font-semibold"
      style={{ color: v >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)" }}
    >
      {v >= 0 ? "+" : ""}
      {v.toFixed(0)}%
    </span>
  );
}

/** Which venue the issue lists on, as the snapshot knows it.
 *
 *  Printed rather than implied because the surface filters to NSE-or-unknown and
 *  then renders both kinds in one table — without the badge a reader cannot tell
 *  a confirmed NSE listing from one of the 20 upcoming rows whose venue is
 *  simply not filed yet, which is exactly the distinction the filter's
 *  admit-on-doubt rule creates. "Venue TBA" is a different claim from "NSE". */
function venue(r: IpoRow): { label: string; known: boolean } {
  const v = (r.listing_exchange ?? "").toUpperCase();
  if (!v) return { label: "venue TBA", known: false };
  const nse = v.includes("NSE");
  const bse = v.includes("BSE");
  if (nse && bse) return { label: "NSE + BSE", known: true };
  if (nse) return { label: "NSE", known: true };
  return { label: v, known: true };
}

const STATUS_STYLE: Record<IpoRow["status"], { label: string; color: string; bg: string }> = {
  open: { label: "Open", color: "var(--color-score-good)", bg: "var(--color-accent-50)" },
  upcoming: { label: "Upcoming", color: "var(--color-accent-700)", bg: "var(--color-accent-50)" },
  closed: { label: "Closed", color: "var(--color-score-weak)", bg: "transparent" },
  listed: { label: "Listed", color: "var(--color-muted)", bg: "transparent" },
};

/**
 * One status at a time, chosen by the left rail.
 *
 * It used to stack all four sections down the page. That was wrong for the same
 * reason the Trends side shows one bucket: the listed section alone is 86 rows,
 * so "Open" — the only section with a deadline attached — sat three screens above
 * the fold behind history nobody scrolls to. Sectioning everything visible is
 * only honest when the sections are comparable in size, and these are 3 / 21 /
 * 10 / 86.
 */
export function IpoTracker({ data, active }: { data: IpoData; active: IpoStatus }) {
  const { rows, fetchedAt } = data;
  const ageH = fetchedAt
    ? (Date.now() - new Date(fetchedAt).getTime()) / 3_600_000
    : null;
  const stale = ageH == null || ageH > IPO_STALE_HOURS;

  const counts = ipoCounts(rows);
  const groups = [{ status: active, rows: rows.filter((r) => r.status === active) }];

  return (
    <div>
      {/* Freshness first, above the data. See the module docstring: this is the
          one control that keeps a snapshot surface honest. */}
      <div
        className="rounded-lg border px-3.5 py-2.5 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1"
        style={
          stale
            ? { borderColor: "var(--color-score-weak)", backgroundColor: "transparent",
                color: "var(--color-score-weak)" }
            : { borderColor: "var(--color-border-default)", backgroundColor: "transparent" }
        }
      >
        {stale ? (
          <span>
            <strong>Stale snapshot.</strong>{" "}
            {fetchedAt
              ? `Last updated ${new Date(fetchedAt).toLocaleString("en-IN")} (${Math.round(ageH!)}h ago).`
              : "Never updated."}{" "}
            Bidding windows and subscription figures below may already have passed. The Upstox
            session needs a fresh login before this can refresh.
          </span>
        ) : (
          <span className="muted-text">
            Snapshot as of{" "}
            <span className="ink-text tabular-nums">
              {new Date(fetchedAt!).toLocaleString("en-IN")}
            </span>
            {" · "}
            {(["open", "upcoming", "closed", "listed"] as const)
              .filter((s) => counts[s])
              .map((s) => `${counts[s]} ${STATUS_STYLE[s].label.toLowerCase()}`)
              .join(" · ")}
          </span>
        )}
      </div>

      {rows.length === 0 && (
        <div className="mt-6 text-[13px] muted-text">
          No IPO snapshot yet. Run <code>scripts/fetch-ipos.py</code> with a live Upstox session.
        </div>
      )}

      {groups.map((g) => {
        const st = STATUS_STYLE[g.status];
        return (
          <section key={g.status} className="mt-4">
            <div className="flex items-baseline gap-2">
              <h2 className="font-display text-[19px] tracking-tight" style={{ color: st.color }}>
                {st.label}
              </h2>
              <span className="text-[11.5px] muted-text">{g.rows.length}</span>
            </div>
            {g.rows.length === 0 && (
              <p className="mt-3 text-[13px] muted-text">
                Nothing {st.label.toLowerCase()} in this snapshot. That is a real answer, not a
                gap — IPO windows are lumpy and most weeks have none open.
              </p>
            )}
            {/* overflow-x-auto ONLY below md, and that is load-bearing for the
                sticky header rather than a responsive nicety.

                Per CSS overflow rules, `overflow-x: auto` with `overflow-y:
                visible` computes overflow-y to `auto` as well, which makes the
                element a scroll container. A `position: sticky` <th> inside then
                sticks to THAT container — which never scrolls vertically — so it
                pins to the top of the table and never follows the page. The
                header appears to work and silently does nothing.
                md:overflow-x-visible restores a truly-visible box on desktop, so
                sticky resolves against the viewport. Mobile keeps the contained
                horizontal scroll and gives up the sticky header, which is the
                right way round: there is no vertical room to benefit from it on
                a phone anyway. */}
            <div className="mt-2.5 overflow-x-auto md:overflow-x-visible">
              <table className="w-full text-[12.5px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                {/* top-[84px] clears the global site header, matching the offset
                    the bucket strip on the Trends side uses. Opaque rather than
                    translucent: tabular-nums sliding under a blurred header is
                    legible, column labels sliding under one are not. */}
                <thead className="sticky z-10 top-0 md:top-[84px]" style={{ backgroundColor: "var(--color-paper)" }}>
                  <tr className="text-[10.5px] uppercase tracking-wide muted-text">
                    <th className="text-left font-semibold py-1.5 pr-3">Issue</th>
                    <th className="text-left font-semibold py-1.5 pr-3">Type</th>
                    <th className="text-right font-semibold py-1.5 pr-3">Band</th>
                    <th className="text-right font-semibold py-1.5 pr-3">Lot</th>
                    <th className="text-right font-semibold py-1.5 pr-3">1 lot</th>
                    <th className="text-right font-semibold py-1.5 pr-3">Size</th>
                    <th className="text-left font-semibold py-1.5 pr-3">Bidding</th>
                    <th className="text-right font-semibold py-1.5 pr-3">
                      {g.status === "listed" ? "On listing" : "Subs"}
                    </th>
                    {g.status === "listed" && (
                      <>
                        <th className="text-right font-semibold py-1.5 pr-3">Now</th>
                        <th className="text-right font-semibold py-1.5 pr-3">Since issue</th>
                      </>
                    )}
                    <th className="text-left font-semibold py-1.5">
                      {g.status === "listed" ? "Listed" : "Allotment"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => {
                    const gain = listingGain(r);
                    const now = sinceIssue(r);
                    const ven = venue(r);
                    return (
                      <tr key={r.id} className="border-t hairline align-top">
                        <td className="py-2 pr-3">
                          <div className="font-semibold ink-text leading-tight">
                            {r.rhp_url ? (
                              <a
                                href={r.rhp_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline"
                              >
                                {r.name}
                              </a>
                            ) : (
                              r.name
                            )}
                          </div>
                          <div className="text-[10.5px] muted-text mt-0.5">
                            {/* Symbol is NULL until the RHP is filed — 20 of 23
                                upcoming rows on the first snapshot. Showing the
                                industry instead keeps the cell informative
                                rather than printing a dash. */}
                            {r.symbol ? <span className="tabular-nums">{r.symbol}</span> : "symbol TBA"}
                            {" · "}
                            <span
                              style={{
                                color: ven.known
                                  ? "var(--color-accent-700)"
                                  : "var(--color-muted)",
                                fontStyle: ven.known ? "normal" : "italic",
                              }}
                              title={
                                ven.known
                                  ? `Lists on ${ven.label}, per the issue's RHP as Upstox reports it.`
                                  : "No final RHP filed yet, so the exchange is unknown — not a claim that it is off NSE."
                              }
                            >
                              {ven.label}
                            </span>
                            {r.industry ? ` · ${r.industry}` : ""}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                            style={{
                              border: "1px solid var(--color-border-default)",
                              color: r.issue_type === "sme" ? "var(--color-muted)" : "var(--color-accent-700)",
                            }}
                          >
                            {r.issue_type === "sme" ? "SME" : "Main"}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{band(r)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.lot_size ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{lotCost(r)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{inrCr(r.issue_size_cr)}</td>
                        <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                          {r.bidding_start || r.bidding_end
                            ? `${shortDay(r.bidding_start)} – ${shortDay(r.bidding_end)}`
                            : "dates TBA"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {g.status === "listed"
                            ? pctCell(gain)
                            : r.total_subscription == null
                              ? "—"
                              : `${r.total_subscription.toFixed(2)}×`}
                        </td>
                        {g.status === "listed" && (
                          <>
                            <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                              {r.last_price == null ? (
                                <span
                                  className="muted-text"
                                  title="No NSE close available. BSE-only issues are never in the NSE instrument master, and a scrip that has not traded has no price."
                                >
                                  —
                                </span>
                              ) : (
                                <span
                                  title={
                                    r.last_price_at
                                      ? `Close as read on ${new Date(r.last_price_at).toLocaleString("en-IN")}`
                                      : undefined
                                  }
                                >
                                  ₹{r.last_price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">{pctCell(now)}</td>
                          </>
                        )}
                        <td className="py-2 tabular-nums whitespace-nowrap">
                          {shortDay(g.status === "listed" ? r.listing_date : r.allotment_date)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <section className="mt-10 pt-6 border-t hairline max-w-[760px]">
        <div className="text-[12px] uppercase tracking-wide muted-text mb-1.5">How to read this</div>
        <p className="text-[13px] muted-text leading-[1.6]">
          Every figure here is the issue&apos;s own published detail as Upstox reports it —
          price band, lot size, issue size, the bidding and allotment dates, and the live
          subscription multiple. <span className="ink-text">1 lot</span> is the minimum
          application at the top of the band. The venue beside each symbol is where the issue
          lists; <em>venue TBA</em> means no final RHP has been filed, which is not the same as
          &ldquo;not NSE&rdquo;. Upcoming issues often have no band, symbol or dates yet; those
          read &ldquo;TBA&rdquo; rather than zero.
        </p>
        <p className="text-[13px] muted-text leading-[1.6] mt-2">
          For listed issues, <span className="ink-text">on listing</span> is the listing-day
          print against the top of the band and <span className="ink-text">since issue</span> is
          the latest NSE close against the same base, so the two are comparable. The close comes
          from Upstox&apos;s public NSE instrument master, not from an intraday quote — hover the
          price for when it was read. BSE-only issues have no figure here at all. The listed
          section covers six months; Upstox itself only serves about three, so the earlier half
          is history this platform has kept rather than history it can re-fetch.
        </p>
        <p className="text-[13px] muted-text leading-[1.6] mt-2">
          There is no grey-market premium here and no view on whether to apply. GMP has no
          verifiable source, and the rest would be advice.
        </p>
      </section>
    </div>
  );
}
