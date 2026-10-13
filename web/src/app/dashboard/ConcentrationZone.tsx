/**
 * Zone 11 — how concentrated the book is: top-5 weight, largest single name,
 * largest sector, and the sector split itself.
 *
 * No new query. Everything here is arithmetic over the portfolio the book tile
 * already loaded (see portfolioOnce.ts) — which is the only reason an eleventh
 * tile is affordable at all.
 *
 * WHY THIS IS THE ONE RISK NUMBER ON THE PAGE
 *
 * Every other tile answers "what moved" or "what is due". None of them answers
 * "how much of this depends on one thing", and a 125-name book can still be a
 * three-stock bet. The weight is of CURRENT VALUE, not invested cost: cost
 * tells you what you decided, market value tells you what you are exposed to
 * now, and the gap between them is exactly the drift this tile exists to show.
 *
 * Equities only, matching BookZone's `isMapped` cut. An unmapped ETF has no
 * sector in this app, so including it would put a visible chunk of the book
 * into "Unclassified" and make every real sector weight look smaller than it is.
 */
import { Zone, Kpi, Empty, inr } from "./ui";
import { getPortfolio } from "./portfolioOnce";

const TOP_N = 5;
const SECTOR_ROWS = 8;

export async function ConcentrationZone({ userId }: { userId: number }) {
  const portfolio = await getPortfolio(userId);
  const equities = portfolio.instruments.filter((i) => i.isMapped);
  const total = equities.reduce((s, i) => s + i.currentValue, 0);

  if (!portfolio.hasHoldings || total <= 0) {
    return (
      <Zone title="Concentration">
        <Empty>Nothing to measure until the book has holdings.</Empty>
      </Zone>
    );
  }

  const byValue = [...equities].sort((a, b) => b.currentValue - a.currentValue);
  const topN = byValue.slice(0, TOP_N).reduce((s, i) => s + i.currentValue, 0);
  const largest = byValue[0];

  // Sector buckets are built here rather than read from portfolio.sectorAlloc
  // because that slice spans every instrument including the unmapped ones, and
  // this tile is deliberately the equity-only view.
  const bySector = new Map<string, number>();
  for (const i of equities) {
    const k = i.sector ?? "Unclassified";
    bySector.set(k, (bySector.get(k) ?? 0) + i.currentValue);
  }
  const sectors = [...bySector]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, share: (value / total) * 100 }));

  return (
    <Zone title="Concentration" href="/portfolio" count={equities.length}>
      <div className="grid grid-cols-3 gap-x-2 pb-1 border-b hairline">
        <Kpi label={`Top ${TOP_N}`} value={share(topN / total, 0)} />
        <Kpi
          label="Largest"
          value={share(largest.currentValue / total, 0)}
          sub={largest.symbol ?? largest.name}
        />
        <Kpi
          label="Top sector"
          value={share(sectors[0].share / 100, 0)}
          sub={sectors[0].label}
        />
      </div>

      {/* A bar per sector, not a pie: the question is "is any one of these too
          big", which is a comparison of lengths against a common baseline. A
          pie makes that the hardest possible comparison. */}
      <ul className="mt-1 space-y-[3px]">
        {sectors.slice(0, SECTOR_ROWS).map((s) => (
          <li key={s.label} className="text-[11px]">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className="shrink-0 tabular-nums">{share(s.share / 100, 1)}</span>
              <span className="shrink-0 muted-text tabular-nums text-[10px]">
                {inr(s.value)}
              </span>
            </span>
            <span
              className="mt-[1px] block rounded-sm"
              style={{
                height: 3,
                width: `${Math.max(1, Math.min(100, s.share))}%`,
                backgroundColor: "var(--color-accent-600)",
              }}
              aria-hidden
            />
          </li>
        ))}
      </ul>
      {sectors.length > SECTOR_ROWS && (
        <p className="muted-text text-[10px] mt-1">
          +{sectors.length - SECTOR_ROWS} smaller sectors
        </p>
      )}
    </Zone>
  );
}

/**
 * A weight, not a change. `pct()` from ui.tsx signs its output ("+16%"), which
 * is correct for a return and wrong here — a 16% share of the book did not go
 * up by anything. Hence a local formatter rather than reusing that one.
 */
function share(fraction: number, digits = 0): string {
  return (fraction * 100).toFixed(digits) + "%";
}
