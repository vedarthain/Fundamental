"use client";

/** Tier-tab switcher inside the stocks panel on /sectors.
 *
 * Receives server-rendered children — one <section data-tier="X"> per maturity
 * tier — and toggles which ones are visible based on the active tab. The
 * "All" tab shows every section (with their TierHeader strips intact); a
 * specific tier tab shows just that tier's section and hides its header so
 * the tab label IS the header.
 *
 * Why a client component: tab state needs React state. The actual stock rows
 * stay server-rendered (passed as children) so we keep the perf benefits of
 * server components — only the switcher is shipped to the browser.
 */

import { Children, isValidElement, useState, type ReactNode } from "react";

export type TierMeta = { tier: string; label: string; count: number };

export function TierFilter({
  tiers, children,
}: {
  tiers: TierMeta[];
  children: ReactNode;
}) {
  const [active, setActive] = useState<string>("all");

  // Flatten children to an array of ReactElements so we can read their
  // data-tier attribute and conditionally hide each block.
  const blocks = Children.toArray(children).filter(isValidElement);
  const totalCount = tiers.reduce((a, t) => a + t.count, 0);

  return (
    <div>
      <div className="px-4 md:px-5 pt-3 pb-2 border-b hairline overflow-x-auto">
        <div className="flex items-center gap-1.5 text-[11.5px]">
          <TierTab
            label="All"
            count={totalCount}
            active={active === "all"}
            onClick={() => setActive("all")}
          />
          {tiers.map((t) => (
            <TierTab
              key={t.tier}
              label={t.label}
              count={t.count}
              active={active === t.tier}
              onClick={() => setActive(t.tier)}
              tierKey={t.tier}
            />
          ))}
        </div>
      </div>

      {blocks.map((block) => {
        // Each block is a <section data-tier="X" data-with-header="...">
        const props = (block as React.ReactElement<{ "data-tier"?: string }>).props;
        const blockTier = props["data-tier"];
        if (active !== "all" && blockTier !== active) return null;
        // When a specific tier is active, hide the tier-header strip (the tab
        // label already carries that signal). When "All" is active, headers
        // stay visible so users can scan tier boundaries within the list.
        const hideHeader = active !== "all";
        return (
          <div
            key={blockTier}
            data-tier-block={blockTier}
            className={hideHeader ? "tier-block-no-header" : undefined}
          >
            {block}
          </div>
        );
      })}

      {/* CSS-only header hide for the focused-tier modes. Keeps the
          children inert + means we don't have to re-render server output. */}
      <style>{`
        .tier-block-no-header > * > [data-tier-header] { display: none; }
      `}</style>
    </div>
  );
}

function TierTab({
  label, count, active, onClick, tierKey,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tierKey?: string;
}) {
  // Lift each tier's accent color into the active state so the tab visually
  // matches the colored tier-header it replaces. Keeps the "veteran = green"
  // mental model consistent across the page.
  const accent =
    tierKey === "veteran" ? "#2e9a47" :
    tierKey === "mature"  ? "#3a9290" :
    tierKey === "mid"     ? "#c08e2c" :
    tierKey === "new"     ? "#7882b8" :
                            "var(--color-accent-600)";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
        active ? "font-semibold" : "font-medium muted-text"
      }`}
      style={
        active
          ? {
              borderColor: accent,
              backgroundColor: "var(--color-card)",
              color: "var(--color-ink)",
              boxShadow: `inset 0 0 0 1px ${accent}`,
            }
          : {
              borderColor: "var(--color-border-default)",
              backgroundColor: "transparent",
            }
      }
    >
      <span>{label}</span>
      <span className="tabular-nums text-[10.5px] muted-text">· {count}</span>
    </button>
  );
}
