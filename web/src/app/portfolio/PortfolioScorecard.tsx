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

export function PortfolioScorecard() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/portfolio/symbols");
        if (r.ok) {
          const d = (await r.json()) as { signedIn: boolean; symbols: string[] };
          setSignedIn(d.signedIn);
          setSymbols(d.symbols ?? []);
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

  return <WatchlistClient source={source} />;
}
