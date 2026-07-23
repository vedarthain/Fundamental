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
import type { SupportFloorSignal } from "@/lib/supportFloor";
import MomentumClient from "./MomentumClient";
import TrendLeadersClient from "./TrendLeadersClient";
import SupportFloorClient from "./SupportFloorClient";

type Tab = "igniting" | "trend" | "floor";

export default function ScannerTabs({
  momentumSnapDate,
  momentumSignals,
  trendSnapDate,
  trendSignals,
  floorSnapDate,
  floorSignals,
  nifty500,
}: {
  momentumSnapDate: string | null;
  momentumSignals: MomentumSignal[];
  trendSnapDate: string | null;
  trendSignals: TrendLeaderSignal[];
  floorSnapDate: string | null;
  floorSignals: SupportFloorSignal[];
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
  const floor = n500Only ? floorSignals.filter((s) => n500.has(s.symbol)) : floorSignals;

  const tabs: { id: Tab; label: string; sub: string; count: number | null }[] = [
    { id: "igniting", label: "Igniting today", sub: "Volume breakouts", count: momentum.length },
    { id: "trend", label: "Trend Leaders", sub: "Fresh golden crosses", count: trend.length },
    { id: "floor", label: "At Support", sub: "Multi-year tested floors", count: floor.length },
  ];

  return (
    <div className="theme-indigo mx-auto max-w-[1180px] px-6 py-10">
      <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-8">
        {/* Left rail: vertical scanner nav + NIFTY 500 toggle pinned at the bottom. */}
        <aside className="w-full md:w-[232px] md:shrink-0">
          <div className="text-[11px] uppercase tracking-wide muted-text mb-2 px-1">Scanners</div>
          <nav className="flex flex-col gap-1" role="tablist" aria-orientation="vertical">
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className="w-full text-left rounded-lg px-3 py-2.5 transition-colors border"
                  style={
                    active
                      ? {
                          background: "color-mix(in srgb, var(--color-accent-600) 10%, transparent)",
                          borderColor: "color-mix(in srgb, var(--color-accent-600) 35%, transparent)",
                        }
                      : { borderColor: "transparent" }
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-[13.5px] font-semibold"
                      style={{ color: active ? "var(--color-accent-700)" : "var(--color-ink)" }}
                    >
                      {t.label}
                    </span>
                    {t.count != null && (
                      <span
                        className="text-[11px] tabular-nums rounded-full px-1.5 py-0.5"
                        style={{
                          background: active
                            ? "var(--color-accent-600)"
                            : "var(--color-border)",
                          color: active ? "#fff" : "var(--color-muted)",
                        }}
                      >
                        {t.count}
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] muted-text mt-0.5">{t.sub}</div>
                </button>
              );
            })}
          </nav>

          <div className="mt-5 pt-4 border-t hairline px-1">
            <div className="text-[11px] uppercase tracking-wide muted-text mb-2">Universe</div>
            <div
              className="inline-flex items-center gap-1 rounded-lg p-1 border hairline"
              role="group"
              aria-label="Universe scope"
            >
              {([
                { on: false, label: "All NSE" },
                { on: true, label: "NIFTY 500" },
              ] as const).map((opt) => {
                const active = n500Only === opt.on;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setN500Only(opt.on)}
                    className="px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors"
                    style={
                      active
                        ? { background: "var(--color-accent-600)", color: "#fff" }
                        : { color: "var(--color-muted)" }
                    }
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11.5px] muted-text mt-2 leading-[1.5]">
              <strong>All NSE</strong> is the default — the small-cap tail is where these signals
              earn their edge. <strong>NIFTY 500</strong> narrows every scanner to large/mid-cap
              index names.
            </p>
          </div>
        </aside>

        {/* Right panel: the selected scanner's table up top, its description below. */}
        <div className="min-w-0 flex-1">
          {tab === "igniting" && (
            <MomentumClient snapDate={momentumSnapDate} signals={momentum} />
          )}
          {tab === "trend" && (
            <TrendLeadersClient snapDate={trendSnapDate} signals={trend} />
          )}
          {tab === "floor" && (
            <SupportFloorClient snapDate={floorSnapDate} signals={floor} />
          )}
        </div>
      </div>
    </div>
  );
}
