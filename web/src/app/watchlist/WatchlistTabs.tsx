"use client";

/**
 * WatchlistTabs — the client shell that switches the /watchlist page between the
 * saved-stocks list and the Buy/Sell Calls table. Kept as a thin wrapper so the
 * tab bar always renders (above WatchlistClient's own empty/skeleton returns).
 */
import { useState } from "react";
import { WatchlistClient } from "./WatchlistClient";
import { CallsClient } from "./CallsClient";
import { useCalls } from "@/lib/stockCalls";

type View = "watchlist" | "calls";

/**
 * `isAdmin` is resolved on the server in page.tsx and passed down, rather than
 * being probed from the client.
 */
export function WatchlistTabs({ isAdmin = false }: { isAdmin?: boolean }) {
  const [view, setView] = useState<View>("watchlist");
  const { list } = useCalls();
  // Badge counts active calls only — cleared ones are history, not open calls.
  const activeCount = list.filter((c) => c.cleared_at == null).length;

  const tab = (v: View, label: string, count?: number) => (
    <button
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      className="px-2.5 py-0.5 text-[12px] font-medium rounded transition-colors"
      style={
        view === v
          ? { background: "var(--color-accent-600)", color: "#fff" }
          : { color: "var(--color-muted)" }
      }
    >
      {label}
      {count != null && count > 0 && <span className="ml-1 tabular-nums opacity-80">{count}</span>}
    </button>
  );

  return (
    <div>
      <div className="mb-1.5 inline-flex items-center gap-0.5 rounded-md border hairline p-0.5">
        {tab("watchlist", "Watchlist")}
        {isAdmin && tab("calls", "Calls", activeCount)}
      </div>
      {view === "calls" && isAdmin ? (
        <CallsClient />
      ) : (
        <WatchlistClient isAdmin={isAdmin} />
      )}
    </div>
  );
}
