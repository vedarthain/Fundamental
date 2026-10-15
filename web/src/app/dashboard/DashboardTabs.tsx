"use client";

import { useState, type ReactNode } from "react";

export type DashboardTabKey = "book" | "signals" | "radar";

export function DashboardTabs({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<DashboardTabKey>("book");

  return (
    <div className="mt-2.5 dashboard-root" data-tab-active={activeTab}>
      <style>{`
        @media (max-width: 639.98px) {
          .dashboard-root[data-tab-active="book"] [data-tab]:not([data-tab="book"]) {
            display: none !important;
          }
          .dashboard-root[data-tab-active="signals"] [data-tab]:not([data-tab="signals"]) {
            display: none !important;
          }
          .dashboard-root[data-tab-active="radar"] [data-tab]:not([data-tab="radar"]) {
            display: none !important;
          }
        }
      `}</style>

      {/* 
        Mobile Segmented Control (< sm).
        Non-sticky to prevent header overlap bugs on mobile.
        High-contrast, clean pill styling with real theme variables.
      */}
      <div className="sm:hidden mb-2.5">
        <div
          role="tablist"
          aria-label="Dashboard sections"
          className="grid grid-cols-3 gap-1 p-1 rounded-lg border hairline"
          style={{
            backgroundColor: "var(--color-card)",
            borderColor: "var(--color-border-default)",
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "book"}
            onClick={() => setActiveTab("book")}
            className={`py-1.5 px-2 rounded-md text-[11.5px] font-medium text-center transition-all flex items-center justify-center gap-1.5 ${
              activeTab === "book"
                ? "font-semibold shadow-xs"
                : "muted-text hover:text-[var(--color-ink)]"
            }`}
            style={
              activeTab === "book"
                ? {
                    backgroundColor: "var(--color-paper)",
                    color: "var(--color-ink)",
                    border: "1px solid var(--color-border-default)",
                  }
                : undefined
            }
          >
            <span>💼</span>
            <span>Book</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "signals"}
            onClick={() => setActiveTab("signals")}
            className={`py-1.5 px-2 rounded-md text-[11.5px] font-medium text-center transition-all flex items-center justify-center gap-1.5 ${
              activeTab === "signals"
                ? "font-semibold shadow-xs"
                : "muted-text hover:text-[var(--color-ink)]"
            }`}
            style={
              activeTab === "signals"
                ? {
                    backgroundColor: "var(--color-paper)",
                    color: "var(--color-ink)",
                    border: "1px solid var(--color-border-default)",
                  }
                : undefined
            }
          >
            <span>⚡</span>
            <span>Signals</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "radar"}
            onClick={() => setActiveTab("radar")}
            className={`py-1.5 px-2 rounded-md text-[11.5px] font-medium text-center transition-all flex items-center justify-center gap-1.5 ${
              activeTab === "radar"
                ? "font-semibold shadow-xs"
                : "muted-text hover:text-[var(--color-ink)]"
            }`}
            style={
              activeTab === "radar"
                ? {
                    backgroundColor: "var(--color-paper)",
                    color: "var(--color-ink)",
                    border: "1px solid var(--color-border-default)",
                  }
                : undefined
            }
          >
            <span>📅</span>
            <span>Calendar</span>
          </button>
        </div>
      </div>

      {/* 
        Unified Grid:
        - Mobile (< sm): Clean 1-column stack, displaying only the tiles matching the active tab.
        - Tablet/Desktop (>= sm): 2-up from sm, 3-up from lg. All tiles are direct grid children.
      */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 items-start">
        {children}
      </div>
    </div>
  );
}
