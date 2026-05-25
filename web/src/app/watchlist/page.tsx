/**
 * /watchlist — the user's saved stocks, with current scores and prices.
 *
 * Server stub + client hydration. The list of symbols lives in
 * localStorage (per-device), so the server doesn't know what to render
 * until the client tells it. We render a thin shell + delegate to a
 * client component that:
 *   1. Reads symbols from localStorage
 *   2. Calls /api/watchlist?symbols=A,B,C
 *   3. Renders cards
 *
 * Cost (Rule #1): one fetch per page load.  The API uses
 * cluster_stocks_panel_cache (same materialised table as /sectors), so
 * the Neon query is a fast indexed read.
 */
import { WatchlistClient } from "./WatchlistClient";

// Force-dynamic because the page state lives in the user's localStorage —
// no point caching anything at the route level.
export const dynamic = "force-dynamic";

export default function WatchlistPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 md:px-6 py-6 md:py-8">
      <header className="mb-6">
        <h1 className="font-display text-[26px] md:text-[30px] leading-[1.1] tracking-tight">
          Your watchlist
        </h1>
        <p className="muted-text text-[13px] mt-1">
          Stocks you&apos;re tracking — refreshed with each weekly snapshot. Saved on this device.
        </p>
      </header>
      <WatchlistClient />
    </div>
  );
}
