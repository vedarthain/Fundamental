/**
 * IpoBadge — the "IPO" chip shown beside a symbol that has been listed on NSE
 * for less than a year.
 *
 * WHY THIS IS NOT JUST `listing_date > now - 1 year`.
 *
 * Measured on prod 2026-09-19, 102 scored names carry an NSE listing_date inside
 * the last 12 months. Only 58 of them are actually new companies. The other 44
 * fall into two buckets, both of which would be libelled by an "IPO" chip:
 *
 *   • BSE→NSE migrations and SME→mainboard moves. Marsons Limited lists on NSE
 *     2026-03-13 and has audited annuals back to FY2011. Shalibhadra Finance and
 *     Nimbus Projects go back to FY2016. These are decade-old businesses that
 *     merely changed venue.
 *   • A batch of ~105 veterans (HAWKINCOOK, TIMEX, GOODYEAR…) added to the price
 *     DB on 2026-04-20 that inherited that date as their listing_date. Their
 *     signature is identical to a real IPO: recent date, few price bars.
 *
 * So the test is two-signal, and it is deliberately the SAME predicate the score
 * display gate uses — `hasScoreableHistory` in lib/score.ts. A stock earns the
 * chip exactly when we also suppress its percentile: <12 months of trading AND a
 * short fundamental record. Sharing one predicate is the point. If the chip and
 * the score gate could disagree, you would get a stock showing a full percentile
 * next to a badge saying it is too new to have one, and the obvious reading is
 * that one of the two is broken.
 *
 * The consequence to state plainly: a genuine IPO that happens to carry 6+ years
 * of pre-listing financials in its DRHP will NOT get the chip. That is the side
 * we chose to be wrong on — a missing chip is a smaller lie than calling a
 * 15-year-old company an IPO.
 */
import { hasScoreableHistory } from "@/lib/score";

/** True when the badge should render. Exported so loaders can precompute the
 *  flag server-side (the panel loaders already ship a boolean rather than the
 *  two raw fields) and so list views can filter on "IPOs only". */
export function isIpo(
  listingDate: string | null | undefined,
  yearsOfData: number | null | undefined,
): boolean {
  return !hasScoreableHistory(listingDate, yearsOfData);
}

const TITLE =
  "Listed on NSE within the last 12 months, and with a short financial record — a genuine recent listing rather than a BSE→NSE migration. Percentile scores are suppressed for these names: momentum and market-relative valuation are noise on under a year of price history.";

/**
 * Renders nothing when `show` is false, so call sites can write
 * `<IpoBadge show={r.is_ipo} />` without a surrounding conditional.
 */
export default function IpoBadge({
  show,
  className = "",
  textClass = "text-[9px]",
}: {
  show: boolean | null | undefined;
  className?: string;
  /** Font-size utility; override to shrink it inside dense tables. */
  textClass?: string;
}) {
  if (!show) return null;
  return (
    <span
      title={TITLE}
      className={`inline-flex shrink-0 items-center rounded-sm px-1 py-px ${textClass} font-bold uppercase tracking-wide leading-none text-[var(--color-paper)] bg-[var(--color-accent,#b45309)] ${className}`}
    >
      IPO
    </span>
  );
}
