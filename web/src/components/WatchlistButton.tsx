"use client";

/**
 * Watch toggle for a single stock. Renders an outline star when the stock
 * isn't watched, a filled amber star when it is. Click toggles state.
 *
 * "Watch" is the single tracking concept — starring a stock adds it to the
 * watchlist (server-backed when signed in). This replaces the old separate
 * Scanner "Favourites" star; there is now one star, one list.
 *
 * Two variants:
 *   - default: pill button with label ("Watch" / "Watching")
 *   - icon: just the star icon, for compact contexts (stock-row tables)
 */

import { Star } from "lucide-react";
import { useWatchlist } from "@/lib/watchlist";

const STAR_COLOR = "#e8a838"; // amber — the Watch star

export function WatchlistButton({
  symbol,
  variant = "default",
  className = "",
}: {
  symbol: string;
  variant?: "default" | "icon";
  className?: string;
}) {
  const { isWatched, toggle, hydrated, isFull, maxSize } = useWatchlist();
  const watched = hydrated && isWatched(symbol);

  // While hydrating (server render + first paint), render in a neutral
  // "not watched" state. After client hydration we re-render with the
  // real value. Avoids a flash of "watched" → "not watched" or vice versa.
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!watched && isFull) {
      // Soft cap reached. Hint to the user without blocking.
      alert(`Watch list is full (${maxSize} stocks max). Remove one before adding ${symbol}.`);
      return;
    }
    toggle(symbol);
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={watched ? `Stop watching ${symbol}` : `Watch ${symbol}`}
        title={watched ? "Watching — click to remove" : "Watch this stock"}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:bg-[var(--color-paper)] ${className}`}
      >
        <Star
          size={15}
          fill={watched ? STAR_COLOR : "none"}
          stroke={watched ? STAR_COLOR : "var(--color-muted)"}
          strokeWidth={1.75}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={watched ? `Stop watching ${symbol}` : `Watch ${symbol}`}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors text-[12px] font-medium ${className}`}
      style={
        watched
          ? {
              borderColor: STAR_COLOR,
              backgroundColor: `color-mix(in srgb, ${STAR_COLOR} 12%, transparent)`,
              color: "var(--color-ink)",
            }
          : {
              borderColor: "var(--color-border-default)",
              backgroundColor: "var(--color-card)",
              color: "var(--color-ink)",
            }
      }
    >
      <Star
        size={13}
        fill={watched ? STAR_COLOR : "none"}
        stroke={watched ? STAR_COLOR : "currentColor"}
        strokeWidth={2}
      />
      <span>{watched ? "Watching" : "Watch"}</span>
    </button>
  );
}
