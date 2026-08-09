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
import type { AllStockRow } from "@/lib/allStocks";
import type { GraphUniverse } from "@/lib/graphUniverse";
import type { DividendUniverse } from "@/lib/dividendScanner";
import type { ThemesData } from "@/lib/themes";
import type { SparkPoint } from "@/components/Sparkline";
import MomentumClient from "./MomentumClient";
import GraphClient from "./GraphClient";
import DividendClient from "./DividendClient";
import TrendLeadersClient from "./TrendLeadersClient";
import SupportFloorClient from "./SupportFloorClient";
import RotationClient from "./RotationClient";
import FallenLeadersClient from "./FallenLeadersClient";
import AllStocksClient from "./AllStocksClient";
import ThemesClient from "./ThemesClient";
import ScannerDatePicker from "./ScannerDatePicker";

// "peers" is no longer a top-level tab — it folded into "sectors" as a toggle.
export type Tab = "igniting" | "trend" | "floor" | "fallen" | "sectors" | "all" | "graph" | "themes" | "dividends";
// Which cut the merged Sectors/Peers ("rotation") tab is showing.
type RotView = "sectors" | "peers";

export default function ScannerTabs({
  momentumSnapDate,
  momentumSignals,
  momentumDates,
  momentumSpark,
  trendSnapDate,
  trendSignals,
  trendDates,
  trendSpark,
  floorSnapDate,
  floorSignals,
  floorDates,
  floorSpark,
  rotation,
  allStocksSnapDate,
  allStocks,
  graphUniverse,
  dividendUniverse,
  themes,
  nifty500,
  portfolioSymbols = [],
  initialTab = "igniting",
}: {
  momentumSnapDate: string | null;
  momentumSignals: MomentumSignal[];
  momentumDates: string[];
  momentumSpark: Record<string, SparkPoint[]>;
  trendSnapDate: string | null;
  trendSignals: TrendLeaderSignal[];
  trendDates: string[];
  trendSpark: Record<string, SparkPoint[]>;
  floorSnapDate: string | null;
  floorSignals: SupportFloorSignal[];
  floorDates: string[];
  floorSpark: Record<string, SparkPoint[]>;
  rotation: RotationData;
  allStocksSnapDate: string | null;
  allStocks: AllStockRow[];
  graphUniverse: GraphUniverse;
  dividendUniverse: DividendUniverse;
  themes: ThemesData;
  nifty500: string[];
  portfolioSymbols?: string[];
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [n500Only, setN500Only] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  // Sectors ⇄ Peer groups toggle inside the merged "sectors" tab. Seed from
  // ?rot= so a deep-link (or the redirected ?tab=peers) opens the right cut.
  const [rotView, setRotView] = useState<RotView>(() => {
    if (typeof window === "undefined") return "sectors";
    const p = new URLSearchParams(window.location.search);
    if (p.get("rot") === "peers" || p.get("tab") === "peers") return "peers";
    return "sectors";
  });

  function selectRotView(next: RotView) {
    setRotView(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("rot", next);
      window.history.replaceState(null, "", url);
    }
  }

  // Mirror the active tab into the URL (?tab=) so a refresh reopens the same
  // scanner instead of snapping back to "Igniting today". Use history.replaceState
  // rather than the Next router so we don't trigger an RSC refetch of all the
  // scanner data on every tab click — the page already reads ?tab= on load.
  function selectTab(next: Tab) {
    setTab(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url);
    }
  }

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

  const allCount = n500Only ? allStocks.filter((r) => r.is_n500).length : allStocks.length;

  // Merged Sectors/Peers tab: the count reflects whichever cut is active.
  const rotCount = rotView === "peers" ? peers.length : sectors.length;

  const tabs: { id: Tab; label: string; sub: string; count: number | null }[] = [
    { id: "igniting", label: "Igniting today", sub: "Volume breakouts", count: momentum.length },
    { id: "trend", label: "Trend Leaders", sub: "Fresh golden crosses", count: trend.length },
    { id: "floor", label: "At Support", sub: "Multi-year tested floors", count: floor.length },
    { id: "fallen", label: "Fallen Leaders", sub: "Beaten-down quality", count: null },
    { id: "sectors", label: "Sectors & Peers", sub: "Rotation map", count: rotCount },
    { id: "themes", label: "Themes", sub: "Index vs. constituents", count: themes.themes.length },
    { id: "graph", label: "Graph", sub: "Candles by industry", count: null },
    { id: "dividends", label: "Dividend Scanner", sub: "Income by sector · yield", count: null },
    { id: "all", label: "All stocks", sub: "Full universe · sortable", count: allCount },
  ];

  // All-stocks is a 10-column browse table; give it the full width so it uses
  // the side gutters instead of scrolling. The per-stock scanners now carry a
  // sector→industry tree on the left, so they need the wide layout too — the
  // tree eats ~230px and the table would otherwise be squeezed. Only the
  // rotation tabs (Sectors / Peers), which have no tree, stay in the tighter
  // reading column.
  const wide =
    tab === "all" ||
    tab === "graph" ||
    tab === "dividends" ||
    tab === "igniting" ||
    tab === "trend" ||
    tab === "floor" ||
    tab === "themes" ||
    tab === "fallen";

  return (
    <div className={`theme-indigo mx-auto px-6 py-10 ${wide ? "max-w-[1560px]" : "max-w-[1180px]"}`}>
      <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-8">
        {/* Collapsed rail: a slim button to reveal the scanner nav again. */}
        {!railOpen && (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="flex shrink-0 self-start items-center gap-1.5 rounded-lg border hairline px-2.5 py-2 hover:bg-[var(--color-paper)] transition-colors"
            aria-label="Show scanners"
            title="Show scanners"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 6l6 6-6 6" />
            </svg>
            <span className="text-[11px] uppercase tracking-wide muted-text md:hidden">Scanners</span>
          </button>
        )}

        {/* Left rail: vertical scanner nav + NIFTY 500 toggle pinned at the bottom. */}
        {railOpen && (
        <aside className="w-full md:w-[232px] md:shrink-0">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[11px] uppercase tracking-wide muted-text">Scanners</span>
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              className="rounded p-1 hover:bg-[var(--color-border)] transition-colors"
              aria-label="Hide scanners"
              title="Hide scanners"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
          </div>
          <nav className="flex flex-col gap-1" role="tablist" aria-orientation="vertical">
            {tabs.map((t) => {
              const active = tab === t.id;
              // "All stocks" is the full-universe browse surface, not a caught
              // signal — set it off below a partition from the scanners above.
              const partitionBefore = t.id === "all";
              return (
                <div key={t.id} className={partitionBefore ? "mt-2 pt-2 border-t hairline" : undefined}>
                <button
                  role="tab"
                  aria-selected={active}
                  onClick={() => selectTab(t.id)}
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
                </div>
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
        )}

        {/* Right panel: the selected scanner's table up top, its description below. */}
        <div className="min-w-0 flex-1">
          {tab === "igniting" && (
            <MomentumClient
              snapDate={momentumSnapDate}
              signals={momentum}
              spark={momentumSpark}
              datePicker={<ScannerDatePicker param="mDate" dates={momentumDates} selected={momentumSnapDate} />}
            />
          )}
          {tab === "trend" && (
            <TrendLeadersClient
              snapDate={trendSnapDate}
              signals={trend}
              spark={trendSpark}
              datePicker={<ScannerDatePicker param="tDate" dates={trendDates} selected={trendSnapDate} />}
            />
          )}
          {tab === "floor" && (
            <SupportFloorClient
              snapDate={floorSnapDate}
              signals={floor}
              spark={floorSpark}
              datePicker={<ScannerDatePicker param="fDate" dates={floorDates} selected={floorSnapDate} />}
            />
          )}
          {tab === "fallen" && <FallenLeadersClient n500Only={n500Only} />}
          {tab === "all" && (
            <AllStocksClient snapDate={allStocksSnapDate} rows={allStocks} n500Only={n500Only} />
          )}
          {tab === "graph" && (
            <GraphClient universe={graphUniverse} nifty500={nifty500} n500Only={n500Only} portfolioSymbols={portfolioSymbols} />
          )}
          {tab === "dividends" && (
            <DividendClient universe={dividendUniverse} nifty500={nifty500} n500Only={n500Only} />
          )}
          {tab === "sectors" && (
            <div>
              {/* Sectors ⇄ Peer groups toggle — same RotationData, two cuts. */}
              <div className="inline-flex items-center gap-1 rounded-lg p-1 border hairline mb-4" role="group" aria-label="Rotation grouping">
                {([
                  { id: "sectors" as RotView, label: "Sectors" },
                  { id: "peers" as RotView, label: "Peer groups" },
                ]).map((opt) => {
                  const active = rotView === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => selectRotView(opt.id)}
                      className="px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors"
                      style={active ? { background: "var(--color-accent-600)", color: "#fff" } : { color: "var(--color-muted)" }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {rotView === "peers" ? (
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
              ) : (
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
          )}
          {tab === "themes" && (
            <ThemesClient
              themes={themes.themes}
              snapDate={themes.snapDate}
              indexLastDate={themes.indexLastDate}
              n500Only={n500Only}
              nifty500={nifty500}
              portfolioSymbols={portfolioSymbols}
            />
          )}
        </div>
      </div>
    </div>
  );
}
