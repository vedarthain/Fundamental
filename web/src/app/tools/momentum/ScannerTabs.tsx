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
import type { RotationData } from "@/lib/rotation";
import MomentumClient from "./MomentumClient";
import TrendLeadersClient from "./TrendLeadersClient";
import SupportFloorClient from "./SupportFloorClient";
import RotationClient from "./RotationClient";
import FallenLeadersClient from "./FallenLeadersClient";
import ScannerDatePicker from "./ScannerDatePicker";

export type Tab = "igniting" | "trend" | "floor" | "fallen" | "sectors" | "peers";
export const SCANNER_TABS: Tab[] = ["igniting", "trend", "floor", "fallen", "sectors", "peers"];

export default function ScannerTabs({
  momentumSnapDate,
  momentumSignals,
  momentumDates,
  trendSnapDate,
  trendSignals,
  trendDates,
  floorSnapDate,
  floorSignals,
  floorDates,
  rotation,
  nifty500,
  initialTab = "igniting",
}: {
  momentumSnapDate: string | null;
  momentumSignals: MomentumSignal[];
  momentumDates: string[];
  trendSnapDate: string | null;
  trendSignals: TrendLeaderSignal[];
  trendDates: string[];
  floorSnapDate: string | null;
  floorSignals: SupportFloorSignal[];
  floorDates: string[];
  rotation: RotationData;
  nifty500: string[];
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [n500Only, setN500Only] = useState(false);

  // NIFTY 500 membership as a fast lookup; the toggle narrows both scanners to
  // large/mid-cap index names. Default OFF — the igniting scanner's edge is the
  // sub-500 small-caps, so the filter is opt-in, not a gate.
  const n500 = useMemo(() => new Set(nifty500), [nifty500]);
  const momentum = n500Only ? momentumSignals.filter((s) => n500.has(s.symbol)) : momentumSignals;
  const trend = n500Only ? trendSignals.filter((s) => n500.has(s.symbol)) : trendSignals;
  const floor = n500Only ? floorSignals.filter((s) => n500.has(s.symbol)) : floorSignals;

  // Rotation views are pre-aggregated server-side for both universes; the
  // toggle just picks which cut to show (see loadRotation).
  const sectors = n500Only ? rotation.sectorsN500 : rotation.sectorsAll;
  const peers = n500Only ? rotation.peersN500 : rotation.peersAll;

  const tabs: { id: Tab; label: string; sub: string; count: number | null }[] = [
    { id: "igniting", label: "Igniting today", sub: "Volume breakouts", count: momentum.length },
    { id: "trend", label: "Trend Leaders", sub: "Fresh golden crosses", count: trend.length },
    { id: "floor", label: "At Support", sub: "Multi-year tested floors", count: floor.length },
    { id: "fallen", label: "Fallen Leaders", sub: "Beaten-down quality", count: null },
    { id: "peers", label: "Peer groups", sub: "Cluster rotation", count: peers.length },
    { id: "sectors", label: "Sectors", sub: "Sector rotation", count: sectors.length },
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
            <MomentumClient
              snapDate={momentumSnapDate}
              signals={momentum}
              datePicker={<ScannerDatePicker param="mDate" dates={momentumDates} selected={momentumSnapDate} />}
            />
          )}
          {tab === "trend" && (
            <TrendLeadersClient
              snapDate={trendSnapDate}
              signals={trend}
              datePicker={<ScannerDatePicker param="tDate" dates={trendDates} selected={trendSnapDate} />}
            />
          )}
          {tab === "floor" && (
            <SupportFloorClient
              snapDate={floorSnapDate}
              signals={floor}
              datePicker={<ScannerDatePicker param="fDate" dates={floorDates} selected={floorSnapDate} />}
            />
          )}
          {tab === "fallen" && <FallenLeadersClient n500Only={n500Only} />}
          {tab === "peers" && (
            <RotationClient
              snapDate={rotation.snapDate}
              rows={peers}
              title="Peer groups"
              eyebrow="Rotation map"
              groupLabel="Peer group"
              noun="peer groups"
              datePicker={<ScannerDatePicker param="rDate" dates={rotation.dates} selected={rotation.snapDate} />}
              intro={
                <>
                  The scoring peer clusters (~46 of them) ranked by <strong>median 1-week return</strong>,
                  so you can see <strong>which pockets are being bid up</strong> and which are being sold.
                  Peer groups are tighter than sectors — they&apos;re the same clusters the platform
                  scores stocks within — so this is the granular read on rotation.
                </>
              }
            />
          )}
          {tab === "sectors" && (
            <RotationClient
              snapDate={rotation.snapDate}
              rows={sectors}
              title="Sectors"
              eyebrow="Rotation map"
              groupLabel="Sector"
              noun="sectors"
              datePicker={<ScannerDatePicker param="rDate" dates={rotation.dates} selected={rotation.snapDate} />}
              intro={
                <>
                  Broad sectors ranked by <strong>median 1-week return</strong> — the top-down
                  complement to the per-stock scanners. It answers <strong>where the money is
                  rotating</strong> before you drill into single names. Read breadth alongside the
                  median: a green sector on thin breadth is a couple of names, not a wave.
                </>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
