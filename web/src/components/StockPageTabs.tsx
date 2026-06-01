"use client";

/**
 * Stock-page tab switcher. Five tabs:
 *   • Latest result    — quarterly flash + TTM ratios (the default landing)
 *   • About            — company description, basics, price chart
 *   • Strengths & gaps — peer-cluster percentile bars + pillar stories
 *   • Trend            — multi-snapshot composite trajectory + peer context
 *   • The Numbers      — annual + quarterly fundamentals tables
 *
 * Why client-side state instead of URL: switching is instant, no navigation
 * spinner, and the parent server component still controls all data fetching.
 * Trade-off: tab choice doesn't survive a page reload — acceptable for now.
 *
 * Each tab content area gets its own subtle background tint so the page no
 * longer feels uniformly cream. The tints are *very* light by design — we
 * want eye-catching, not eye-straining.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Activity, Info, Layers, BarChart3, TrendingUp } from "lucide-react";

type TabKey = "results" | "about" | "strengths" | "trend" | "numbers";

type TabDef = {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
  /** Stripe + tint accent — hex tuned to feel distinct yet stay paper-warm. */
  stripe: string;
  tint: string;
};

const TABS: TabDef[] = [
  {
    key: "results",
    label: "Latest result",
    icon: <Activity size={14} strokeWidth={1.8} />,
    // Green stripe to echo the "JUST OUT" chip beside the company name —
    // visually links the badge in the header to its expanded content here.
    stripe: "var(--color-delta-up)",
    tint: "var(--color-tab-tint-strength)",
  },
  {
    key: "about",
    label: "About",
    icon: <Info size={14} strokeWidth={1.8} />,
    stripe: "var(--color-accent-400)",
    tint: "var(--color-tab-tint-about)",
  },
  {
    key: "strengths",
    label: "Strengths & gaps",
    icon: <Layers size={14} strokeWidth={1.8} />,
    stripe: "var(--color-score-good)",
    tint: "var(--color-tab-tint-strength)",
  },
  {
    key: "trend",
    label: "Trend",
    icon: <TrendingUp size={14} strokeWidth={1.8} />,
    // Accent-600 is the same hue as the trend line itself, so the
    // stripe visually previews what's inside the panel.
    stripe: "var(--color-accent-600)",
    tint: "var(--color-tab-tint-about)",
  },
  {
    key: "numbers",
    label: "The Numbers",
    icon: <BarChart3 size={14} strokeWidth={1.8} />,
    stripe: "var(--color-tab-numbers-stripe)",
    tint: "var(--color-tab-tint-numbers)",
  },
];

export function StockPageTabs({
  results,
  about,
  strengths,
  trend,
  numbers,
}: {
  results: ReactNode;
  about: ReactNode;
  strengths: ReactNode;
  trend: ReactNode;
  numbers: ReactNode;
}) {
  // Default to "results" so visitors land on the freshest signal first.
  // If the URL has #latest-result (chip click from a different tab), open
  // the results tab too — and let the browser handle the scroll naturally.
  const [active, setActive] = useState<TabKey>("results");
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#latest-result") setActive("results");
  }, []);
  const activeDef = TABS.find((t) => t.key === active)!;

  return (
    <div className="mt-3">
      {/* Tab bar — sticky so user can switch while reading mid-tab */}
      <div
        role="tablist"
        aria-label="Stock page sections"
        className="sticky top-[84px] z-20 -mx-6 px-6 py-3 backdrop-blur"
        style={{
          // Pearl paper at 90% — matches the rest of the site's sticky bars.
          // (Old value referenced the warm cream palette retired earlier.)
          background: "color-mix(in srgb, var(--color-paper) 90%, transparent)",
          borderBottom: "1px solid var(--color-border-default)",
        }}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {TABS.map((t) => {
            const isActive = t.key === active;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${t.key}`}
                onClick={() => setActive(t.key)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-all"
                style={
                  isActive
                    ? {
                        background: t.tint,
                        color: "var(--color-ink)",
                        border: `1px solid ${t.stripe}`,
                        boxShadow: `inset 0 -2px 0 0 ${t.stripe}`,
                      }
                    : {
                        background: "transparent",
                        color: "var(--color-muted)",
                        border: "1px solid var(--color-border-default)",
                      }
                }
              >
                <span style={{ color: isActive ? t.stripe : "var(--color-muted)" }}>
                  {t.icon}
                </span>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panels — use display:none for inactive so each section's animations
          replay when the user lands on it (re-mount-like effect via key). */}
      <div className="relative">
        {/* Subtle top accent stripe matching the active tab */}
        <div
          aria-hidden
          className="h-[3px] w-full transition-colors"
          style={{ background: activeDef.stripe, opacity: 0.6 }}
        />

        <div
          className="relative -mx-6 px-6 pt-4 pb-2 transition-colors"
          style={{
            background: `linear-gradient(180deg, ${activeDef.tint} 0%, transparent 320px)`,
          }}
        >
          <Panel show={active === "results"}   keyName="results">   {results}   </Panel>
          <Panel show={active === "about"}     keyName="about">     {about}     </Panel>
          <Panel show={active === "strengths"} keyName="strengths"> {strengths} </Panel>
          <Panel show={active === "trend"}     keyName="trend">     {trend}     </Panel>
          <Panel show={active === "numbers"}   keyName="numbers">   {numbers}   </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel({
  show, keyName, children,
}: {
  show: boolean;
  keyName: TabKey;
  children: ReactNode;
}) {
  // Re-mount on each show so any heat-tile-drop animations replay.
  // (Hidden panels keep their state in memory but are not rendered when show=false.)
  if (!show) return null;
  return (
    <div
      key={keyName}
      role="tabpanel"
      id={`panel-${keyName}`}
      className="animate-tab-fade"
    >
      {children}
    </div>
  );
}
