"use client";

/**
 * Star toggle for a single stock — a local-only "pin to top" control.
 *
 * DELIBERATELY distinct from WatchlistButton (the heart): the heart is your
 * cross-device, auth-backed tracking list; a star here is a purely-local
 * ordering hint that floats a stock to the top of its industry in the Scanner's
 * Graph tab. Different intent, different colour (amber vs. red), different store
 * (@/lib/starred, localStorage only). See starred.ts for the rationale.
 *
 * Two variants:
 *   - default: pill button with label ("Star" / "Starred")
 *   - icon: just the star icon, for compact contexts (chart-card headers, tree)
 */

import { Star } from "lucide-react";
import { useStarred } from "@/lib/starred";

const AMBER = "#e8a838";

export function StarButton({
  symbol,
  variant = "default",
  className = "",
}: {
  symbol: string;
  variant?: "default" | "icon";
  className?: string;
}) {
  const { isStarred, toggle, hydrated } = useStarred();
  const starred = hydrated && isStarred(symbol);

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggle(symbol);
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={starred ? `Unstar ${symbol}` : `Star ${symbol}`}
        title={starred ? "Starred — click to unpin" : "Star to pin to top"}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:bg-[var(--color-paper)] ${className}`}
      >
        <Star
          size={15}
          fill={starred ? AMBER : "none"}
          stroke={starred ? AMBER : "var(--color-muted)"}
          strokeWidth={1.75}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={starred ? `Unstar ${symbol}` : `Star ${symbol}`}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors text-[12px] font-medium ${className}`}
      style={
        starred
          ? {
              borderColor: AMBER,
              backgroundColor: `color-mix(in srgb, ${AMBER} 12%, transparent)`,
              color: AMBER,
            }
          : {
              borderColor: "var(--color-border-default)",
              backgroundColor: "var(--color-card)",
              color: "var(--color-ink)",
            }
      }
    >
      <Star size={13} fill={starred ? AMBER : "none"} strokeWidth={2} />
      <span>{starred ? "Starred" : "Star"}</span>
    </button>
  );
}
