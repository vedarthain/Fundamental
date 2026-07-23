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

import { useMemo, useState } from "react";
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
  nifty500,
}: {
  momentumSnapDate: string | null;
  momentumSignals: MomentumSignal[];
  trendSnapDate: string | null;
  trendSignals: TrendLeaderSignal[];
  nifty500: string[];
}) {
  const [tab, setTab] = useState<Tab>("igniting");
  const [n500Only, setN500Only] = useState(false);

  // NIFTY 500 membership as a fast lookup; the toggle narrows both scanners to
  // large/mid-cap index names. Default OFF — the igniting scanner's edge is the
  // sub-500 small-caps, so the filter is opt-in, not a gate.
  const n500 = useMemo(() => new Set(nifty500), [nifty500]);
  const momentum = n500Only ? momentumSignals.filter((s) => n500.has(s.symbol)) : momentumSignals;
  const trend = n500Only ? trendSignals.filter((s) => n500.has(s.symbol)) : trendSignals;

  const tabs: { id: Tab; label: string; count: number | null }[] = [
    { id: "igniting", label: "Igniting today", count: momentum.length },
    { id: "trend", label: "Trend Leaders", count: trend.length },
  ];

  return (
    <div className="theme-indigo mx-auto max-w-[1100px] px-6 py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
      <div className="inline-flex items-center gap-1 rounded-lg p-1 border hairline" role="tablist">
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
              {t.count != null && (
                <span
                  className="ml-1.5 text-[11px] tabular-nums"
                  style={{ opacity: active ? 0.85 : 0.6 }}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

        <button
          type="button"
          role="switch"
          aria-checked={n500Only}
          onClick={() => setN500Only((v) => !v)}
          className="inline-flex items-center gap-2 text-[13px] font-medium transition-colors"
          style={{ color: n500Only ? "var(--color-accent-700)" : "var(--color-muted)" }}
          title="Show only NIFTY 500 constituents"
        >
          <span
            className="relative inline-block h-[18px] w-[32px] rounded-full transition-colors"
            style={{ background: n500Only ? "var(--color-accent-600)" : "var(--color-border)" }}
          >
            <span
              className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all"
              style={{ left: n500Only ? "16px" : "2px" }}
            />
          </span>
          NIFTY 500 only
        </button>
      </div>

      {tab === "igniting" && (
        <MomentumClient snapDate={momentumSnapDate} signals={momentum} />
      )}
      {tab === "trend" && (
        <TrendLeadersClient snapDate={trendSnapDate} signals={trend} />
      )}
    </div>
  );
}
