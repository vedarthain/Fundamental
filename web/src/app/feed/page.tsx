/**
 * /feed — deprecated. Now a 301 redirect to /market.
 *
 * Why removed: the old page showed week-over-week composite delta as
 * "biggest gains / biggest losses". In practice this was a momentum
 * signal that rewarded single-week pops and decayed within a week —
 * users reading it as a buy/sell signal walked into a high-turnover
 * trap that contradicts the platform's "thinking, not trading" thesis.
 *
 * The persistence-based replacement lives in three places:
 *   - /market               — public "Building strength" card
 *   - /watchlist            — per-symbol trend column (for owned positions)
 *   - /stock/[symbol]       — trend chart + plain-English summary
 *
 * Redirect (not 404) so existing bookmarks and any stray external link
 * don't break — visitors land on the closest equivalent surface.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-static";

export default function FeedDeprecatedRedirect() {
  redirect("/market");
}
