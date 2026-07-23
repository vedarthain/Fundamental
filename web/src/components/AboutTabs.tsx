"use client";

/**
 * AboutTabs — the sub-tab switcher inside the stock page's "About" tab.
 *
 *   Overview        → business description, key people, shareholding
 *   Further details → the facts table (industry, cluster, market cap, listed,
 *                     history spans) that used to sit beside the chart
 *
 * Kept deliberately light: two pill buttons + a panel. It sits in the left
 * column of the About layout; the price chart lives in the right column.
 */

import { useState, type ReactNode } from "react";

type Key = "overview" | "details";

export function AboutTabs({
  overview,
  details,
}: {
  overview: ReactNode;
  details: ReactNode;
}) {
  const [active, setActive] = useState<Key>("overview");

  const tabs: { key: Key; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "details", label: "Further details" },
  ];

  return (
    <div>
      <div className="inline-flex items-center gap-1 rounded-lg p-1 border hairline mb-4" role="tablist">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.key)}
              className="px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-colors"
              style={
                isActive
                  ? { background: "var(--color-accent-600)", color: "#fff" }
                  : { color: "var(--color-muted)" }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="animate-tab-fade" key={active}>
        {active === "overview" ? overview : details}
      </div>
    </div>
  );
}
