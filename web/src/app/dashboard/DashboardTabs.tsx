"use client";

import { useState, type ReactNode } from "react";

export type DashboardTabKey = "book" | "signals" | "radar";

export function DashboardTabs({
  bookGroup,
  signalsGroup,
  radarGroup,
}: {
  bookGroup: ReactNode;
  signalsGroup: ReactNode;
  radarGroup: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<DashboardTabKey>("book");

  return (
    <div className="mt-2">
      {/* 
        Mobile Segmented Control (iOS dock style).
        Hidden on sm and above where the full multi-column grid is displayed.
      */}
      <div className="sm:hidden mb-2 sticky top-[46px] z-20 py-1" style={{ backgroundColor: "var(--color-bg)" }}>
        <div
          role="tablist"
          aria-label="Dashboard sections"
          className="grid grid-cols-3 gap-1 p-1 rounded-lg border hairline shadow-xs"
          style={{ backgroundColor: "var(--color-card)" }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "book"}
            onClick={() => setActiveTab("book")}
            className={`py-1.5 px-1 rounded-md text-[11px] font-semibold text-center transition flex items-center justify-center gap-1 ${
              activeTab === "book"
                ? "bg-[var(--color-bg)] text-[var(--color-foreground)] shadow-xs border hairline"
                : "muted-text hover:text-[var(--color-foreground)]"
            }`}
          >
            <span>💼</span>
            <span>Book & Calls</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "signals"}
            onClick={() => setActiveTab("signals")}
            className={`py-1.5 px-1 rounded-md text-[11px] font-semibold text-center transition flex items-center justify-center gap-1 ${
              activeTab === "signals"
                ? "bg-[var(--color-bg)] text-[var(--color-foreground)] shadow-xs border hairline"
                : "muted-text hover:text-[var(--color-foreground)]"
            }`}
          >
            <span>⚡</span>
            <span>Signals</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "radar"}
            onClick={() => setActiveTab("radar")}
            className={`py-1.5 px-1 rounded-md text-[11px] font-semibold text-center transition flex items-center justify-center gap-1 ${
              activeTab === "radar"
                ? "bg-[var(--color-bg)] text-[var(--color-foreground)] shadow-xs border hairline"
                : "muted-text hover:text-[var(--color-foreground)]"
            }`}
          >
            <span>📅</span>
            <span>Calendar</span>
          </button>
        </div>
      </div>

      {/* 
        Grid Container:
        - Mobile (< sm): Only the active tab group is displayed (`block space-y-2`),
          preventing a 3,000px+ vertical scroll stack.
        - Desktop (>= sm): All three groups use `sm:contents`, dissolving the wrappers
          so all child widgets tile directly into the 2/3-column grid without ragged rows.
      */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 items-start">
        {/* Tab 1: Book & Calls Group */}
        <div className={activeTab === "book" ? "block space-y-2 sm:space-y-0 sm:contents" : "hidden sm:contents"}>
          {bookGroup}
        </div>

        {/* Tab 2: Signals & Sector Group */}
        <div className={activeTab === "signals" ? "block space-y-2 sm:space-y-0 sm:contents" : "hidden sm:contents"}>
          {signalsGroup}
        </div>

        {/* Tab 3: Calendar, Filings & Radar Group */}
        <div className={activeTab === "radar" ? "block space-y-2 sm:space-y-0 sm:contents" : "hidden sm:contents"}>
          {radarGroup}
        </div>
      </div>
    </div>
  );
}
