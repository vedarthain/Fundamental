/**
 * Zone 3 — the equity book: four totals and the largest positions.
 *
 * Equities only, via the same `isMapped` split /portfolio's Stocks tab uses.
 * ETFs and funds stay on that page under Others — mixing them here let a gold
 * ETF outrank the book.
 *
 * Totals are recomputed from the equity subset rather than read off
 * portfolio.totals, which spans every instrument including the unmapped ones.
 */
import Link from "next/link";
import { loadPortfolio, type Instrument } from "@/lib/portfolio";
import { loadSparklines } from "@/lib/sparklines";
import { Sparkline, type SparkPoint } from "@/components/Sparkline";
import { Zone, Kpi, Delta, Empty, SymbolLink, inr, signed, pct } from "./ui";

const HOLD_N = 8;
const SPARK_DAYS = 90;
const SPARK_POINTS = 24;
const STALE_BROKER_DAYS = 5;

export async function BookZone({ userId }: { userId: number }) {
  const portfolio = await loadPortfolio(userId);
  const equities = portfolio.instruments.filter((i) => i.isMapped);

  if (!portfolio.hasHoldings) {
    return (
      <Zone title="Your book">
        <div className="py-4 text-center">
          <p className="muted-text text-[12.5px] mb-3">
            Nothing in the book yet. This zone fills from your holdings — it does
            not invent a market view.
          </p>
          <div className="flex flex-wrap justify-center gap-2 text-[12.5px]">
            <Link
              href="/portfolio"
              className="px-3 py-1.5 rounded-md font-medium"
              style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
            >
              Import holdings
            </Link>
            <Link
              href="/tools/scanner"
              className="px-3 py-1.5 rounded-md border font-medium"
              style={{ borderColor: "var(--color-border-default)" }}
            >
              Find names
            </Link>
          </div>
        </div>
      </Zone>
    );
  }

  const t = totals(equities);
  const top = [...equities].sort((a, b) => b.currentValue - a.currentValue).slice(0, HOLD_N);
  const sparks = await loadSparklines(
    top.map((i) => i.symbol).filter((s): s is string => s != null),
    SPARK_DAYS,
    SPARK_POINTS,
  ).catch(() => ({}) as Record<string, SparkPoint[]>);

  const stale = portfolio.brokerSnapshots.filter((b) => b.ageDays >= STALE_BROKER_DAYS);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Kpi label="Value" value={inr(t.currentValue)} sub={`${t.holdingCount} names`} />
        <Kpi label="Invested" value={inr(t.invested)} />
        <Kpi
          label="P&L"
          value={signed(t.pnl)}
          sub={t.pnlPct != null ? pct(t.pnlPct) : undefined}
          up={t.pnl >= 0}
        />
        <Kpi
          label="Day"
          value={signed(t.dayChangeValue)}
          sub={t.dayChangePct != null ? pct(t.dayChangePct) : undefined}
          up={t.dayChangeValue >= 0}
        />
      </div>

      <Zone
        title="Your book"
        href="/portfolio"
        count={equities.length || undefined}
        meta={portfolio.priceAsOfTs ? "live" : portfolio.priceAsOf ?? undefined}
      >
        {equities.length === 0 ? (
          <Empty>
            No equity holdings — ETFs and funds stay on{" "}
            <Link href="/portfolio" className="underline" style={{ color: "var(--color-accent-700)" }}>
              Portfolio
            </Link>
            .
          </Empty>
        ) : (
          <table className="w-full text-[12.5px] table-fixed">
            <thead>
              <tr className="muted-text text-[11px]">
                <th className="pb-1 font-normal text-left">Name</th>
                <th className="pb-1 font-normal text-right hidden sm:table-cell w-[22%]">3M</th>
                <th className="pb-1 font-normal text-right w-[26%] sm:w-[20%]">Value</th>
                <th className="pb-1 font-normal text-right w-[18%] sm:w-[14%]">Day</th>
                <th className="pb-1 font-normal text-right w-[18%] sm:w-[14%]">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {top.map((i) => (
                <tr key={i.key} className="border-t hairline">
                  <td className="py-1 text-left truncate">
                    <SymbolLink symbol={i.symbol} label={i.symbol ?? i.name} />
                  </td>
                  <td className="py-1 text-right hidden sm:table-cell">
                    {i.symbol && sparks[i.symbol]?.length ? (
                      <Sparkline
                        data={sparks[i.symbol]}
                        width={90}
                        height={20}
                        fill
                        showBaseline={false}
                        stroke={
                          (i.pnlPct ?? 0) >= 0
                            ? "var(--color-delta-up)"
                            : "var(--color-delta-down)"
                        }
                      />
                    ) : (
                      <span className="muted-text">—</span>
                    )}
                  </td>
                  <td className="py-1 text-right tabular-nums truncate">{inr(i.currentValue)}</td>
                  <td className="py-1 text-right tabular-nums">
                    <Delta v={i.dayChangePct} />
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    <Delta v={i.pnlPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {stale.length > 0 && (
          <p className="muted-text text-[11px] mt-2">
            {stale.map((b) => `${b.label} ${b.ageDays}d old`).join(" · ")} — quantity
            and cost are frozen at import, so trades since then are invisible here.
          </p>
        )}
      </Zone>
    </>
  );
}

function totals(equities: Instrument[]) {
  let invested = 0;
  let currentValue = 0;
  let pnl = 0;
  let dayChangeValue = 0;
  let dayBase = 0;
  for (const i of equities) {
    invested += i.invested;
    currentValue += i.currentValue;
    pnl += i.pnl;
    if (i.dayChangeValue != null) {
      dayChangeValue += i.dayChangeValue;
      dayBase += i.currentValue - i.dayChangeValue;
    }
  }
  return {
    invested,
    currentValue,
    pnl,
    pnlPct: invested > 0 ? (pnl / invested) * 100 : null,
    dayChangeValue,
    dayChangePct: dayBase > 0 ? (dayChangeValue / dayBase) * 100 : null,
    holdingCount: equities.length,
  };
}
