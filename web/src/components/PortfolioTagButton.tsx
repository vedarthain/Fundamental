"use client";

/**
 * Portfolio "P" tag toggle for a single stock on the Scanner's Graph tab.
 *
 * A sibling of StarButton (the amber star). Same one-tap toggle, different
 * intent and colour: a "P" flags a name as a portfolio candidate you want to
 * eyeball on the charts. This is a scanner-view marker only — NOT a real
 * holding (those live on the Portfolio tab). See @/lib/portfolioTag.
 *
 * Rendered as a circled "P" so it reads the same tagged/untagged whether it's
 * a header control or a compact chip: violet-filled when tagged, hollow when
 * not — matching how the star fills amber.
 */

import { usePortfolioTag } from "@/lib/portfolioTag";

const VIOLET = "#7c3aed";

export function PortfolioTagButton({
  symbol,
  variant = "default",
  className = "",
}: {
  symbol: string;
  variant?: "default" | "icon";
  className?: string;
}) {
  const { isTagged, toggle, hydrated } = usePortfolioTag();
  const tagged = hydrated && isTagged(symbol);

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggle(symbol);
  };

  // The circled-P glyph, shared by both variants. Fills violet when tagged.
  const glyph = (
    <span
      className="inline-flex items-center justify-center rounded-full border font-bold leading-none"
      style={{
        width: 16,
        height: 16,
        fontSize: 10,
        borderColor: tagged ? VIOLET : "var(--color-muted)",
        color: tagged ? "#fff" : "var(--color-muted)",
        backgroundColor: tagged ? VIOLET : "transparent",
      }}
      aria-hidden
    >
      P
    </span>
  );

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={tagged ? `Untag ${symbol} from portfolio` : `Tag ${symbol} as portfolio`}
        title={tagged ? "Portfolio tag — click to remove" : "Tag as portfolio (P)"}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:bg-[var(--color-paper)] ${className}`}
      >
        {glyph}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={tagged ? `Untag ${symbol} from portfolio` : `Tag ${symbol} as portfolio`}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors text-[12px] font-medium ${className}`}
      style={
        tagged
          ? {
              borderColor: VIOLET,
              backgroundColor: `color-mix(in srgb, ${VIOLET} 12%, transparent)`,
              color: VIOLET,
            }
          : {
              borderColor: "var(--color-border-default)",
              backgroundColor: "var(--color-card)",
              color: "var(--color-ink)",
            }
      }
    >
      {glyph}
      <span>{tagged ? "Portfolio" : "Tag P"}</span>
    </button>
  );
}
