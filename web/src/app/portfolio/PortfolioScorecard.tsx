"use client";

/**
 * PortfolioScorecard — the "Scorecard" tab on /portfolio. Feeds the exact same
 * card renderer as the watchlist (WatchlistClient), but sourced from the signed-in
 * user's *current holdings* (qty > 0) rather than their saved list. The remove/×
 * affordance is suppressed by WatchlistClient when a `source` is supplied — you
 * don't "unsave" a holding.
 *
 * Symbols come from /api/portfolio/symbols (a cheap membership list); the rich
 * card data is then fetched by WatchlistClient from /api/watchlist exactly as for
 * the watchlist, so scores/prices/returns render identically.
 */
import { useEffect, useState } from "react";
import { WatchlistClient, type WatchSource } from "../watchlist/WatchlistClient";

type Returns = {
  ret1d: number | null;
  ret1w: number | null;
  ret1m: number | null;
  asOf: string | null;
};

export function PortfolioScorecard() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [returns, setReturns] = useState<Returns | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/portfolio/symbols");
        if (r.ok) {
          const d = (await r.json()) as {
            signedIn: boolean;
            symbols: string[];
            returns?: Returns | null;
          };
          setSignedIn(d.signedIn);
          setSymbols(d.symbols ?? []);
          setReturns(d.returns ?? null);
        } else {
          setSignedIn(false);
        }
      } catch {
        setSignedIn(false);
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Signed-out users have no portfolio — nudge them to sign in.
  if (hydrated && signedIn === false) {
    return (
      <div className="card p-8 text-center">
        <div className="text-[14px] mb-2">Sign in to see your scorecard</div>
        <div className="muted-text text-[12px]">
          Your scorecard is built from your uploaded trades. Once you&apos;re
          signed in, your current holdings appear here scored like the rest of
          the universe.
        </div>
      </div>
    );
  }

  const source: WatchSource = {
    symbols,
    hydrated,
    ownerLabel: "in your portfolio",
    empty: (
      <div className="card p-8 text-center">
        <div className="text-[14px] mb-2">No holdings yet</div>
        <div className="muted-text text-[12px]">
          Stocks you currently hold (quantity &gt; 0) show up here, scored and
          tracked just like your watchlist. Import holdings on the Transactions
          tab to populate it.
        </div>
      </div>
    ),
  };

  return (
    <>
      <ReturnsStrip returns={returns} />
      <WatchlistClient source={source} />
    </>
  );
}

/**
 * Trailing portfolio performance: 1D / 1W / 1M.
 *
 * These are TIME-WEIGHTED (see loadPortfolioReturns) — daily returns chained
 * with trade cashflows netted out — so topping up a position doesn't register
 * as a gain. No 1Y: app.portfolio_snapshot only starts in Jul 2026, and a
 * fabricated year number is worse than an absent one.
 */
function ReturnsStrip({ returns }: { returns: Returns | null }) {
  if (!returns) return null;
  const items: { label: string; value: number | null }[] = [
    { label: "1D", value: returns.ret1d },
    { label: "1W", value: returns.ret1w },
    { label: "1M", value: returns.ret1m },
  ];
  if (items.every((i) => i.value == null)) return null;

  return (
    <div className="card p-3 md:p-4 mb-3 flex items-center gap-5 md:gap-7 flex-wrap">
      <div className="text-[11px] font-semibold muted-text uppercase tracking-wide">
        Performance
      </div>
      {items.map((i) => (
        <div key={i.label} className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-semibold muted-text">{i.label}</span>
          <span
            className="text-[16px] md:text-[17px] font-semibold tabular-nums"
            style={{
              color:
                i.value == null
                  ? "var(--color-muted)"
                  : i.value >= 0
                    ? "var(--color-delta-up, #15803D)"
                    : "var(--color-delta-down, #DC2626)",
            }}
          >
            {i.value == null
              ? "—"
              : `${i.value >= 0 ? "+" : "−"}${Math.abs(i.value).toFixed(1)}%`}
          </span>
        </div>
      ))}
      {returns.asOf && (
        <span
          className="text-[10.5px] muted-text tabular-nums ml-auto"
          title="Time-weighted: daily returns chained with buys and sells netted out, so adding or withdrawing capital doesn't count as performance."
        >
          time-weighted · to {returns.asOf}
        </span>
      )}
    </div>
  );
}
