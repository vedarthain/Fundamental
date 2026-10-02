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

const ORDER: Record<IpoRow["status"], number> = { open: 0, upcoming: 1, closed: 2, listed: 3 };

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
           total_subscription::float8 AS total_subscription,
           rhp_url, registrar,
           fetched_at::text           AS fetched_at
      FROM app.ipo
     WHERE listing_exchange IS NULL
        OR listing_exchange ILIKE '%NSE%'
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

const STATUS_STYLE: Record<IpoRow["status"], { label: string; color: string; bg: string }> = {
  open: { label: "Open", color: "var(--color-score-good)", bg: "var(--color-accent-50)" },
  upcoming: { label: "Upcoming", color: "var(--color-accent-700)", bg: "var(--color-accent-50)" },
  closed: { label: "Closed", color: "var(--color-score-weak)", bg: "transparent" },
  listed: { label: "Listed", color: "var(--color-muted)", bg: "transparent" },
};

export function IpoTracker({ data }: { data: IpoData }) {
  const { rows, fetchedAt } = data;
  const ageH = fetchedAt
    ? (Date.now() - new Date(fetchedAt).getTime()) / 3_600_000
    : null;
  const stale = ageH == null || ageH > IPO_STALE_HOURS;

  const counts = rows.reduce<Record<string, number>>((m, r) => {
    m[r.status] = (m[r.status] ?? 0) + 1;
    return m;
  }, {});

  const groups = (["open", "upcoming", "closed", "listed"] as const)
    .map((s) => ({ status: s, rows: rows.filter((r) => r.status === s) }))
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]);

  return (
    <div className="mt-6">
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
          <section key={g.status} className="mt-7">
            <div className="flex items-baseline gap-2">
              <h2 className="font-display text-[19px] tracking-tight" style={{ color: st.color }}>
                {st.label}
              </h2>
              <span className="text-[11.5px] muted-text">{g.rows.length}</span>
            </div>
            <div className="mt-2.5 overflow-x-auto">
              <table className="w-full text-[12.5px]" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-wide muted-text">
                    <th className="text-left font-semibold py-1.5 pr-3">Issue</th>
                    <th className="text-left font-semibold py-1.5 pr-3">Type</th>
                    <th className="text-right font-semibold py-1.5 pr-3">Band</th>
                    <th className="text-right font-semibold py-1.5 pr-3">Lot</th>
                    <th className="text-right font-semibold py-1.5 pr-3">1 lot</th>
                    <th className="text-right font-semibold py-1.5 pr-3">Size</th>
                    <th className="text-left font-semibold py-1.5 pr-3">Bidding</th>
                    <th className="text-right font-semibold py-1.5 pr-3">
                      {g.status === "listed" ? "Listing" : "Subs"}
                    </th>
                    <th className="text-left font-semibold py-1.5">
                      {g.status === "listed" ? "Listed" : "Allotment"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => {
                    const gain = listingGain(r);
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
                          {g.status === "listed" ? (
                            gain == null ? (
                              "—"
                            ) : (
                              <span
                                className="font-semibold"
                                style={{
                                  color: gain >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)",
                                }}
                              >
                                {gain >= 0 ? "+" : ""}
                                {gain.toFixed(0)}%
                              </span>
                            )
                          ) : r.total_subscription == null ? (
                            "—"
                          ) : (
                            `${r.total_subscription.toFixed(2)}×`
                          )}
                        </td>
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
          application at the top of the band. For listed issues the last column compares the
          actual listing price against the top of the band. Upcoming issues often have no
          band, symbol or dates yet; those read &ldquo;TBA&rdquo; rather than zero.
        </p>
        <p className="text-[13px] muted-text leading-[1.6] mt-2">
          There is no grey-market premium here and no view on whether to apply. GMP has no
          verifiable source, and the rest would be advice.
        </p>
      </section>
    </div>
  );
}
