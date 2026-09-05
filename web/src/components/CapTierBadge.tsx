// CapTierBadge — renders a stock's SEBI market-cap tier (Large / Mid / Small).
//
// Source of truth: app.universe.market_cap_category, populated from AMFI's
// official semi-annual categorisation (top 100 = Large, 101–250 = Mid, 251+ =
// Small). Names not in AMFI's list are NULL and render nothing (honest — we
// don't guess a tier we can't source).

export type CapCategory = "large_cap" | "mid_cap" | "small_cap" | null | undefined;

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

export default function CapTierBadge({
  category,
  className = "",
}: {
  category: CapCategory;
  className?: string;
}) {
  const label = capTierLabel(category);
  if (!label || !category) return null;
  const tone = TONE[category] ?? TONE.small_cap;
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-[1px] text-[10px] font-semibold tracking-wide ${className}`}
      style={{ background: tone.bg, color: tone.fg }}
      title="Market-cap tier per AMFI's official SEBI categorisation (Large = top 100 by 6-month avg market cap, Mid = 101–250, Small = 251+). Refreshed twice a year."
    >
      {label}
    </span>
  );
}
