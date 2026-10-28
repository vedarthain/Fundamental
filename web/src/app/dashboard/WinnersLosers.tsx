/**
 * Zone — the split of the book into winners and losers, and what each side has
 * done since its own extreme.
 *
 * SEPARATE FROM "Your book" ON PURPOSE. That tile answers "what do I own",
 * ordered by size, and a position's size says nothing about whether it is
 * working. This one answers a different question — "how is the book divided,
 * and which names are moving against the side they are on" — which is the
 * admission test the page docstring sets for a new tile.
 *
 * No new query. Everything is arithmetic over the portfolio BookZone and
 * ConcentrationZone already loaded (portfolioOnce.ts), so this tile costs a
 * render and nothing else.
 *
 * THE TWO COLUMNS ARE DELIBERATELY NOT THE SAME MEASURE
 *
 *   • In profit  → `fallFromTopPct`: how far below its highest close since your
 *     purchase date it now sits. On a winner that is the gain already handed
 *     back — the number that decides whether to trim.
 *   • At a loss  → `riseFromBottomPct`: how far above its lowest close since
 *     your purchase date it has come. On a loser that is whether the position
 *     is still falling or has turned.
 *
 * Showing fall-from-top on a loser, or rise-from-bottom on a winner, is
 * arithmetically fine and tells you nothing: a loser is near its low almost by
 * definition. Hence one measure per side, each ranked worst-first.
 *
 * BOTH MEASURES CAN BE NULL, AND THAT IS NOT ZERO. lib/portfolio.ts computes
 * them only from a REAL recorded trade date and deliberately refuses the
 * import-date proxy, so a position with no tradebook has no window to measure.
 * Those names are excluded from the ranking and COUNTED in the footnote rather
 * than silently dropped — a book where most rows are unmeasurable must say so,
 * or the top-five reads as "the worst five" when it is "the worst five of the
 * nine we could measure".
 *
 * The bar counts NAMES, not money. "Nine of twelve are green" is a different
 * fact from "the book is up", the P&L in Your book already states the second,
 * and conflating them is how a book carried by one position looks healthy.
 */
import { Zone, Empty, SymbolLink, Delta } from "./ui";
import { getPortfolio } from "./portfolioOnce";
import { type Instrument } from "@/lib/portfolio";

const ROWS_PER_SIDE = 5;

export async function WinnersLosers({ userId }: { userId: number }) {
  const portfolio = await getPortfolio(userId);
  const equities = portfolio.instruments.filter((i) => i.isMapped);

  if (!portfolio.hasHoldings || equities.length === 0) {
    return (
      <Zone title="Winners & losers">
        <Empty>Nothing to split until the book has equity holdings.</Empty>
      </Zone>
    );
  }

  // pnlPct null (no cost basis) belongs on neither side — it is not a flat
  // position, it is an unknown one, and putting it in "at a loss" would invent
  // a loss. Counted in `unpriced` so the two sides still add up to the book.
  const winners = equities.filter((i) => i.pnlPct != null && i.pnlPct >= 0);
  const losers = equities.filter((i) => i.pnlPct != null && i.pnlPct < 0);
  const unpriced = equities.length - winners.length - losers.length;
  const rated = winners.length + losers.length;

  const givenBack = rank(winners, (i) => i.fallFromTopPct);
  const recovered = rank(losers, (i) => i.riseFromBottomPct);
  const unmeasured =
    winners.length - givenBack.length + (losers.length - recovered.length);

  const winShare = rated > 0 ? (winners.length / rated) * 100 : 0;

  return (
    <Zone title="Winners & losers" href="/portfolio" count={equities.length}>
      {/* One bar, two segments, counts printed on the labels rather than inside
          the segments — at this width a segment can be 12px wide and no number
          fits in it. */}
      <div className="pb-1.5 border-b hairline">
        <div className="flex items-baseline justify-between text-[10px] mb-[3px]">
          <span style={{ color: "var(--color-delta-up)" }} className="tabular-nums">
            {winners.length} in profit
          </span>
          <span className="muted-text tabular-nums">
            {rated > 0 ? `${Math.round(winShare)}% green` : "—"}
          </span>
          <span style={{ color: "var(--color-delta-down)" }} className="tabular-nums">
            {losers.length} at a loss
          </span>
        </div>
        <div
          className="flex w-full overflow-hidden rounded-sm"
          style={{ height: 6, backgroundColor: "var(--color-border-default)" }}
          role="img"
          aria-label={`${winners.length} of ${rated} equity holdings in profit, ${losers.length} at a loss`}
        >
          <span
            style={{ width: `${winShare}%`, backgroundColor: "var(--color-delta-up)" }}
          />
          <span
            style={{
              width: `${100 - winShare}%`,
              backgroundColor: "var(--color-delta-down)",
            }}
          />
        </div>
        {unpriced > 0 && (
          <p className="muted-text text-[9.5px] mt-[3px]">
            {unpriced} more with no cost basis — on neither side.
          </p>
        )}
      </div>

      <Side
        title="In profit · most given back from its high"
        rows={givenBack}
        value={(i) => (i.fallFromTopPct === 0 ? "0%" : `−${i.fallFromTopPct}%`)}
        tone="down"
        empty="No measurable winners."
      />
      <Side
        title="At a loss · most recovered off its low"
        rows={recovered}
        value={(i) => (i.riseFromBottomPct === 0 ? "0%" : `+${i.riseFromBottomPct}%`)}
        tone="up"
        empty="No measurable losers."
      />

      {unmeasured > 0 && (
        <p className="muted-text text-[9.5px] mt-1.5">
          {unmeasured} position{unmeasured === 1 ? "" : "s"} not ranked — no
          purchase date on record, so there is no window to measure from. Import
          the broker tradebook on Portfolio.
        </p>
      )}
    </Zone>
  );
}

/**
 * Worst-first, nulls dropped rather than sorted to the end — a null is "we
 * cannot measure this", and leaving it in the list at rank 6 would imply it was
 * measured and found unremarkable.
 */
function rank(list: Instrument[], key: (i: Instrument) => number | null) {
  return list
    .filter((i) => key(i) != null)
    .sort((a, b) => (key(b) ?? 0) - (key(a) ?? 0))
    .slice(0, ROWS_PER_SIDE);
}

function Side({
  title,
  rows,
  value,
  tone,
  empty,
}: {
  title: string;
  rows: Instrument[];
  value: (i: Instrument) => string;
  tone: "up" | "down";
  empty: string;
}) {
  const color = tone === "up" ? "var(--color-delta-up)" : "var(--color-delta-down)";
  return (
    <div className="mt-1.5">
      <div className="muted-text text-[9.5px] uppercase tracking-wide truncate">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="muted-text text-[10.5px] py-[2px]">{empty}</p>
      ) : (
        <table className="w-full text-[11.5px] table-fixed">
          <tbody>
            {rows.map((i) => (
              <tr key={i.key} className="border-t hairline">
                <td className="py-[3px] text-left truncate">
                  <SymbolLink symbol={i.symbol} label={i.symbol ?? i.name} />
                </td>
                <td className="py-[3px] text-right tabular-nums w-[26%]">
                  <Delta v={i.pnlPct} />
                </td>
                <td
                  className="py-[3px] text-right tabular-nums w-[26%] font-semibold"
                  style={{ color }}
                  title={
                    tone === "down"
                      ? "Below its highest close since your purchase date"
                      : "Above its lowest close since your purchase date"
                  }
                >
                  {value(i)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
