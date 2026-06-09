"use client";

/**
 * Sub-tab switcher inside the stock page's "Corporate actions" tab. Splits the
 * two feeds onto separate panels instead of stacking both on one page:
 *   • Announcements    — exchange filings (BSE)
 *   • Corporate actions — dividends, bonus/splits, board meetings
 *
 * Both panels are server-rendered ReactNodes passed in by the page; this
 * component only toggles which one is visible.
 */

import { useState, type ReactNode } from "react";

type SubTab = "announcements" | "corporate";

export function StockActionsTabs({
  announcements,
  corporate,
}: {
  announcements: ReactNode;
  corporate: ReactNode;
}) {
  const [tab, setTab] = useState<SubTab>("announcements");

  const Tab = ({ id, label }: { id: SubTab; label: string }) => {
    const active = tab === id;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => setTab(id)}
        className="px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-all"
        style={
          active
            ? {
                background: "var(--color-tab-tint-numbers)",
                color: "var(--color-ink)",
                border: "1px solid var(--color-accent-700)",
                boxShadow: "inset 0 -2px 0 0 var(--color-accent-700)",
              }
            : {
                background: "transparent",
                color: "var(--color-muted)",
                border: "1px solid var(--color-border-default)",
              }
        }
      >
        {label}
      </button>
    );
  };

  return (
    <div>
      <div role="tablist" aria-label="Corporate actions sections" className="flex flex-wrap items-center gap-1.5 mb-4">
        <Tab id="announcements" label="Announcements" />
        <Tab id="corporate" label="Corporate actions" />
      </div>
      <div role="tabpanel" className="animate-tab-fade" key={tab}>
        {tab === "announcements" ? announcements : corporate}
      </div>
    </div>
  );
}
