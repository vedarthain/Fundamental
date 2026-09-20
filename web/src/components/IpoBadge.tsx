/**
 * IpoBadge — the "<1Y" chip shown beside a symbol we hold less than a year of
 * price history for.
 *
 * WHY THE LABEL SAYS "<1Y" AND NOT "IPO".
 *
 * It used to say IPO. That was a claim about the COMPANY, and it is false for a
 * large minority of the names it lands on. NSE resets listing_date when a
 * business graduates from the Emerge SME board to the mainboard, and admits
 * batches of established BSE companies at once — 25 names share the single
 * listing date 2026-08-17, among them EKI Energy, Dhoot Transmission and
 * Chemcrux. Those are not IPOs. "NEW" was considered and rejected for the same
 * reason: a company trading since 2021 is not new, so the word is the same lie
 * in a gentler register.
 *
 * The fact we actually hold is about US, not about the business: we have under
 * twelve months of bars, so we will not publish a percentile we cannot stand
 * behind. "<1Y" states exactly that and is true for a day-one float and for a
 * twenty-year-old migrant alike.
 *
 * This matters more than wording, because our confidence is genuinely uneven.
 * For KOTYARK and SOLEX we could PROVE the listing date was misleading — golden
 * held years of bars behind it. For the 2026-08-17 batch golden holds nothing
 * before the listing date, so we cannot tell a fresh float from an old company
 * that just changed venue. Same chip, two different epistemic positions
 * underneath. A label that only describes coverage stays honest in both.
 *
 * WHY THE PREDICATE IS NOT JUST `listing_date > now - 1 year`.
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
 * chip exactly when we also suppress its percentile: <12 months of observed
 * trading AND a short fundamental record. Sharing one predicate is the point. If
 * the chip and the score gate could disagree, you would get a stock showing a
 * full percentile next to a badge saying it is too new to have one, and the
 * obvious reading is that one of the two is broken.
 *
 * PASS `first_bar_date`, NOT `listing_date`. The first bucket above was only
 * half-handled by the old listing_date test: it rescued migrations of OLD
 * companies via the fundamentals clause, but SME→mainboard migrations of YOUNG
 * companies have neither a long record nor an old listing_date, so both clauses
 * fired. KOTYARK (4.8 years of bars, 4 years of annuals) and SOLEX (8.6 years of
 * bars) were badged as IPOs. Measuring from the earliest bar we hold closes that
 * hole — see the note on hasScoreableHistory.
 *
 * The consequence to state plainly: a genuine recent listing that happens to
 * carry 6+ years of pre-listing financials in its DRHP will NOT get the chip.
 * That is the side we chose to be wrong on — a missing chip understates what we
 * know, while a wrong chip asserts something false about a real company.
 *
 * NAMING: the file, component and `isIpo` export still say "Ipo" while the
 * rendered label no longer does. That is deliberate debt, not an oversight —
 * renaming touches 12 call sites across the scanner clients, and the label was
 * the part that was lying to users. Rename when something else brings you into
 * these files anyway.
 */
import { hasScoreableHistory } from "@/lib/score";

/** True when the badge should render. Exported so loaders can precompute the
 *  flag server-side (the panel loaders already ship a boolean rather than the
 *  two raw fields) and so list views can filter on "IPOs only". */
export function isIpo(
  listingDate: string | null | undefined,
  firstBarDate: string | null | undefined,
  yearsOfData: number | null | undefined,
): boolean {
  return !hasScoreableHistory(listingDate, firstBarDate, yearsOfData);
}

const TITLE =
  "Under 12 months of price history on record, and a short financial record. Percentile scores are suppressed: momentum and market-relative valuation are noise on this little data. This describes our coverage, not the company — it may be a genuine new listing or a business that traded elsewhere before moving to the NSE mainboard.";

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
      &lt;1Y
    </span>
  );
}
