"use client";

/**
 * Watchlist toggle for a single stock. Renders an outline heart when the
 * stock isn't watched, a filled heart when it is. Click toggles state.
 *
 * Two variants:
 *   - default: pill button with label ("Watch" / "Watching")
 *   - icon: just the heart icon, for compact contexts (stock-row tables)
 *
 * Zero server impact: state lives entirely in localStorage via useWatchlist.
 */

import { Heart } from "lucide-react";
import { useWatchlist } from "@/lib/watchlist";

export function WatchlistButton({
  symbol,
  variant = "default",
  className = "",
}: {
  symbol: string;
  variant?: "default" | "icon";
  className?: string;
}) {
  const { isWatched, toggle, hydrated, isFull } = useWatchlist();
  const watched = hydrated && isWatched(symbol);

  // While hydrating (server render + first paint), render in a neutral
  // "not watched" state. After client hydration we re-render with the
  // real value. Avoids a flash of "watched" → "not watched" or vice versa.
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!watched && isFull) {
      // Soft cap reached. Hint to the user without blocking.
      alert(`Watchlist is full (100 stocks max). Remove one before adding ${symbol}.`);
      return;
    }
    toggle(symbol);
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={watched ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
        title={watched ? "Watching — click to remove" : "Add to watchlist"}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:bg-[var(--color-paper)] ${className}`}
      >
        <Heart
          size={15}
          fill={watched ? "var(--color-delta-down)" : "none"}
          stroke={watched ? "var(--color-delta-down)" : "var(--color-muted)"}
          strokeWidth={1.75}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={watched ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors text-[12px] font-medium ${className}`}
      style={
        watched
          ? {
              borderColor: "var(--color-delta-down)",
              backgroundColor: "color-mix(in srgb, var(--color-delta-down) 8%, transparent)",
              color: "var(--color-delta-down)",
            }
          : {
              borderColor: "var(--color-border-default)",
              backgroundColor: "var(--color-card)",
              color: "var(--color-ink)",
            }
      }
    >
      <Heart
        size={13}
        fill={watched ? "var(--color-delta-down)" : "none"}
        strokeWidth={2}
      />
      <span>{watched ? "Watching" : "Watch"}</span>
    </button>
  );
}
