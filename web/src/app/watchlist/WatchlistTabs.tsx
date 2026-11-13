"use client";

/**
 * WatchlistTabs — the client shell that switches the /watchlist page between the
 * saved-stocks list and the Buy/Sell Calls table. Kept as a thin wrapper so the
 * tab bar always renders (above WatchlistClient's own empty/skeleton returns).
 */
import { WatchlistClient } from "./WatchlistClient";

/**
 * `isAdmin` is resolved on the server in page.tsx and passed down, rather than
 * being probed from the client.
 */
export function WatchlistTabs({ isAdmin = false }: { isAdmin?: boolean }) {
  return <WatchlistClient isAdmin={isAdmin} />;
}
