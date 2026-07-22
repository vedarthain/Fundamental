"use client";

/**
 * ScannerTabs — the tab shell over the two daily scanners.
 *
 *   Igniting today  → MomentumClient   (one-day volume explosion)
 *   Trend Leaders   → TrendLeadersClient (fresh golden cross, slow burn)
 *
 * Both scanners answer "where's the move?" on different clocks — a single-day
 * spike vs. a multi-week trend just beginning — so they live under one roof and
 * the tab is the only chrome. Each panel self-contains its own header + table.
 */

import { useState } from "react";
import type { MomentumSignal } from "@/lib/momentum";
import type { TrendLeaderSignal } from "@/lib/trendLeaders";
import MomentumClient from "./MomentumClient";
import TrendLeadersClient from "./TrendLeadersClient";

type Tab = "igniting" | "trend";

export default function ScannerTabs({
  momentumSnapDate,
  momentumSignals,
  trendSnapDate,
  trendSignals,
}: {
  momentumSnapDate: string | null;
  momentumSignals: MomentumSignal[];
  trendSnapDate: string | null;
  trendSignals: TrendLeaderSignal[];
}) {
  const [tab, setTab] = useState<Tab>("igniting");

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "igniting", label: "Igniting today", count: momentumSignals.length },
    { id: "trend", label: "Trend Leaders", count: trendSignals.length },
  ];

  return (
    <div className="theme-indigo mx-auto max-w-[1100px] px-6 py-10">
      <div className="mb-8 inline-flex items-center gap-1 rounded-lg p-1 border hairline" role="tablist">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className="px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-colors"
              style={
                active
                  ? { background: "var(--color-accent-600)", color: "#fff" }
                  : { color: "var(--color-muted)" }
              }
            >
              {t.label}
              <span
                className="ml-1.5 text-[11px] tabular-nums"
                style={{ opacity: active ? 0.85 : 0.6 }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "igniting" ? (
        <MomentumClient snapDate={momentumSnapDate} signals={momentumSignals} />
      ) : (
        <TrendLeadersClient snapDate={trendSnapDate} signals={trendSignals} />
      )}
    </div>
  );
}
