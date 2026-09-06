// CapTierBadge — renders a stock's SEBI market-cap tier (Large / Mid / Small).
//
// Source of truth: app.universe.market_cap_category, populated from AMFI's
// official semi-annual categorisation (top 100 = Large, 101–250 = Mid, 251+ =
// Small). AMFI republishes only ~twice a year and only includes a stock once it
// has a ~6-month average market cap, so a fresh IPO has NO tier for months.
//
// For those NULL-tier names we distinguish two cases by listing_date:
//   • listed within NEW_LISTING_MONTHS → "Newly listed" chip (honest: not yet
//     in AMFI's list, rather than pretending a tier we can't source).
//   • older & still NULL → genuinely uncovered (illiquid etc.) → render nothing.

import { monthsSinceListing } from "@/lib/score";

export type CapCategory = "large_cap" | "mid_cap" | "small_cap" | null | undefined;

// AMFI is semi-annual, so a name still NULL after a full year has had a cycle to
// appear — beyond this it's uncovered, not new.
const NEW_LISTING_MONTHS = 12;

const LABEL: Record<string, string> = {
  large_cap: "Large Cap",
  mid_cap: "Mid Cap",
  small_cap: "Small Cap",
};

// Per-tier accent so the tier is scannable at a glance without shouting.
const TONE: Record<string, { bg: string; fg: string }> = {
  large_cap: { bg: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", fg: "var(--color-accent-700)" },
  mid_cap: { bg: "color-mix(in srgb, #b45309 14%, transparent)", fg: "#b45309" },
  small_cap: { bg: "color-mix(in srgb, var(--color-ink) 8%, transparent)", fg: "var(--color-ink)" },
};

export function capTierLabel(cat: CapCategory): string | null {
  if (!cat) return null;
  return LABEL[cat] ?? null;
}

/** True when CapTierBadge would render something (a tier or "Newly listed").
 *  Lets callers avoid emitting an empty wrapper for uncovered names. */
export function hasCapTierBadge(cat: CapCategory, listingDate?: string | null): boolean {
  if (capTierLabel(cat)) return true;
  const months = monthsSinceListing(listingDate);
  return months != null && months <= NEW_LISTING_MONTHS;
}

export default function CapTierBadge({
  category,
  listingDate,
  className = "",
  textClass = "text-[10px]",
}: {
  category: CapCategory;
  listingDate?: string | null;
  className?: string;
  /** Font-size utility for the badge text; override to shrink it per-context. */
  textClass?: string;
}) {
  const label = capTierLabel(category);
  if (label && category) {
    const tone = TONE[category] ?? TONE.small_cap;
    return (
      <span
        className={`inline-flex items-center rounded px-1.5 py-[1px] ${textClass} font-semibold tracking-wide ${className}`}
        style={{ background: tone.bg, color: tone.fg }}
        title="Market-cap tier per AMFI's official SEBI categorisation (Large = top 100 by 6-month avg market cap, Mid = 101–250, Small = 251+). Refreshed twice a year."
      >
        {label}
      </span>
    );
  }

  // No official tier. If the stock is fresh, say so; otherwise render nothing.
  const months = monthsSinceListing(listingDate);
  if (months != null && months <= NEW_LISTING_MONTHS) {
    return (
      <span
        className={`inline-flex items-center rounded px-1.5 py-[1px] ${textClass} font-semibold tracking-wide ${className}`}
        style={{
          background: "color-mix(in srgb, var(--color-ink) 6%, transparent)",
          color: "var(--color-ink)",
          opacity: 0.7,
        }}
        title="No official market-cap tier yet — AMFI publishes its SEBI Large/Mid/Small list only twice a year and includes a stock once it has a ~6-month average market cap. This name is too recently listed to be in the current list."
      >
        Newly listed
      </span>
    );
  }
  return null;
}
