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

export function WatchlistTabs() {
  const [view, setView] = useState<View>("watchlist");
  const { list } = useCalls();
  // Badge counts active calls only — cleared ones are history, not open calls.
  const activeCount = list.filter((c) => c.cleared_at == null).length;

  const tab = (v: View, label: string, count?: number) => (
    <button
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      className="px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors"
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
      <div className="mb-3 inline-flex items-center gap-1 rounded-lg border hairline p-1">
        {tab("watchlist", "Watchlist")}
        {tab("calls", "Calls", activeCount)}
      </div>
      {view === "watchlist" ? <WatchlistClient /> : <CallsClient />}
    </div>
  );
}
