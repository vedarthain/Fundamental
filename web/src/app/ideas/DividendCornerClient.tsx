"use client";

/**
 * DividendCornerClient.tsx — /ideas?view=dividends
 *
 * Dedicated Dividend Corner under Ideas:
 *   1. "List of Stocks" (Default) — Flat, high-density, searchable and sortable
 *      table of all dividend-paying stocks across the universe with trailing yield,
 *      4-year DPS history, Composite score, and upcoming payouts.
 *   2. "By Sector & Industry" — Hierarchical sector/industry drill-down tree.
 *   3. "Upcoming Calendar" — Chronological listing of upcoming ex-dates and board meetings.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  X,
  Coins,
  List,
  Layers,
  Calendar,
  ChevronRight,
  TrendingUp,
  Percent,
  CheckCircle2,
  Clock,
  ExternalLink,
  ArrowUpDown,
  Filter,
} from "lucide-react";
import IpoBadge from "@/components/IpoBadge";
import { WatchlistButton } from "@/components/WatchlistButton";
import { band, bandColor, displayCompanyName } from "@/lib/score";
import type { DividendUniverse, DivSector, DivStock, NextEvent } from "@/lib/dividendScanner";

// ---------------------------------------------------------------------------
// Helpers & Types
// ---------------------------------------------------------------------------

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";

type SubTab = "list" | "sectors" | "calendar";
type FilterPill = "all" | "high_yield" | "consistent" | "upcoming" | "quality";
type SortKey = "yield" | "composite" | "ltp" | "symbol" | "next" | `fy${number}`;
type SortDir = "asc" | "desc";

function inr(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtEventDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function scoreColor(p: number | null): string {
  if (p == null) return "var(--color-muted)";
  if (p >= 66) return GREEN;
  if (p >= 40) return "var(--color-score-weak, #b7791f)";
  return RED;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 transition-transform"
      style={{ transform: open ? "rotate(90deg)" : "none" }}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DividendCornerClient({
  universe,
  nifty500 = [],
}: {
  universe: DividendUniverse;
  nifty500?: string[];
}) {
  const { fyLabels, snapDate } = universe;

  const [activeTab, setActiveTab] = useState<SubTab>("list");
  const [n500Only, setN500Only] = useState(false);
  const [search, setSearch] = useState("");
  const [filterPill, setFilterPill] = useState<FilterPill>("all");
  const [sortKey, setSortKey] = useState<SortKey>("yield");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Sector tree state for the "sectors" tab
  const [treeOpen, setTreeOpen] = useState(true);
  const [selectedSector, setSelectedSector] = useState<string>("");
  const [selectedIndustry, setSelectedIndustry] = useState<string>("");

  const n500Set = useMemo(() => new Set(nifty500), [nifty500]);

  // Flatten all stocks across sectors and industries
  const allStocks = useMemo(() => {
    const seen = new Set<string>();
    const list: DivStock[] = [];
    for (const s of universe.sectors) {
      for (const ind of s.industries) {
        for (const st of ind.stocks) {
          if (!seen.has(st.symbol)) {
            seen.add(st.symbol);
            list.push(st);
          }
        }
      }
    }
    return list;
  }, [universe.sectors]);

  // Stocks with upcoming events for the calendar tab
  const upcomingStocks = useMemo(() => {
    return allStocks
      .filter((s) => s.nextEvent != null)
      .sort((a, b) => {
        const da = a.nextEvent?.date ? Date.parse(a.nextEvent.date) : 0;
        const db = b.nextEvent?.date ? Date.parse(b.nextEvent.date) : 0;
        return da - db;
      });
  }, [allStocks]);

  // Filtered stocks for the flat list view
  const filteredStocks = useMemo(() => {
    let res = allStocks;

    // 1. NIFTY 500 scope
    if (n500Only && n500Set.size > 0) {
      res = res.filter((s) => n500Set.has(s.symbol));
    }

    // 2. Search query
    const q = search.trim().toLowerCase();
    if (q) {
      res = res.filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          (s.name && s.name.toLowerCase().includes(q)) ||
          s.sector.toLowerCase().includes(q) ||
          s.industry.toLowerCase().includes(q)
      );
    }

    // 3. Category Filter Pill
    if (filterPill === "high_yield") {
      res = res.filter((s) => s.divYield != null && s.divYield >= 3.0);
    } else if (filterPill === "consistent") {
      // Paid in all 4 fiscal years
      res = res.filter((s) => s.dps.length >= 4 && s.dps.every((d) => d != null && d > 0));
    } else if (filterPill === "upcoming") {
      res = res.filter((s) => s.nextEvent != null);
    } else if (filterPill === "quality") {
      res = res.filter((s) => s.composite_pct != null && s.composite_pct >= 70);
    }

    // 4. Sorting
    const dir = sortDir === "asc" ? 1 : -1;
    return [...res].sort((a, b) => {
      let va: any = null;
      let vb: any = null;

      if (sortKey === "symbol") {
        va = a.symbol;
        vb = b.symbol;
        return va.localeCompare(vb) * dir;
      } else if (sortKey === "ltp") {
        va = a.ltp;
        vb = b.ltp;
      } else if (sortKey === "yield") {
        va = a.divYield;
        vb = b.divYield;
      } else if (sortKey === "composite") {
        va = a.composite_pct;
        vb = b.composite_pct;
      } else if (sortKey === "next") {
        va = a.nextEvent ? Date.parse(a.nextEvent.date) : null;
        vb = b.nextEvent ? Date.parse(b.nextEvent.date) : null;
      } else if (sortKey.startsWith("fy")) {
        const idx = Number(sortKey.slice(2));
        va = a.dps[idx] ?? null;
        vb = b.dps[idx] ?? null;
      }

      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [allStocks, n500Only, n500Set, search, filterPill, sortKey, sortDir]);

  // Paginated slice
  const totalPages = Math.ceil(filteredStocks.length / pageSize) || 1;
  const pagedStocks = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredStocks.slice(start, start + pageSize);
  }, [filteredStocks, page, pageSize]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
    setPage(1);
  }

  // Sector tree data for the "sectors" tab
  const sectorList = useMemo(() => {
    if (!n500Only) return universe.sectors;
    const out: DivSector[] = [];
    for (const s of universe.sectors) {
      const inds = [];
      let count = 0;
      for (const ind of s.industries) {
        const stocks = ind.stocks.filter((st) => n500Set.has(st.symbol));
        if (stocks.length) {
          inds.push({ ...ind, stocks });
          count += stocks.length;
        }
      }
      if (inds.length) out.push({ ...s, count, industries: inds });
    }
    return out;
  }, [universe.sectors, n500Only, n500Set]);

  const activeSector = selectedSector || sectorList[0]?.name || "";
  const currentSectorObj = sectorList.find((s) => s.name === activeSector);

  const sectorFilteredStocks = useMemo(() => {
    if (!currentSectorObj) return [];
    if (selectedIndustry) {
      const ind = currentSectorObj.industries.find((i) => i.id === selectedIndustry);
      return ind ? ind.stocks : [];
    }
    return currentSectorObj.industries.flatMap((i) => i.stocks);
  }, [currentSectorObj, selectedIndustry]);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Top Header & Tab Switcher ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4 hairline">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1 rounded-md bg-[color-mix(in_srgb,var(--color-accent-600)_12%,transparent)] text-[var(--color-accent-600)]">
              <Coins size={18} strokeWidth={2.4} />
            </span>
            <h1 className="text-[22px] font-bold tracking-tight">Dividend Corner</h1>
          </div>
          <p className="text-[13px] muted-text leading-relaxed">
            High-yield dividends, historical DPS payouts across fiscal years, consistency records, and upcoming declared payouts.
            {snapDate && <span className="ml-2 font-mono text-[11px] opacity-75">· Panel: {snapDate}</span>}
          </p>
        </div>

        {/* ── Inner Tabs ── */}
        <div className="flex items-center gap-1.5 p-1 rounded-lg border hairline bg-[var(--color-paper)] self-start md:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab("list")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium transition-all ${
              activeTab === "list"
                ? "bg-[var(--color-surface)] shadow-sm text-[var(--color-ink)] font-semibold"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            <List size={14} />
            <span>List of Stocks</span>
            <span className="text-[10px] tabular-nums px-1.5 py-0.2 rounded-full bg-[var(--color-border)] text-[var(--color-muted)]">
              {allStocks.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("sectors")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium transition-all ${
              activeTab === "sectors"
                ? "bg-[var(--color-surface)] shadow-sm text-[var(--color-ink)] font-semibold"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            <Layers size={14} />
            <span>By Sector & Industry</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("calendar")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium transition-all ${
              activeTab === "calendar"
                ? "bg-[var(--color-surface)] shadow-sm text-[var(--color-ink)] font-semibold"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            <Calendar size={14} />
            <span>Upcoming Calendar</span>
            {upcomingStocks.length > 0 && (
              <span className="text-[10px] tabular-nums px-1.5 py-0.2 rounded-full bg-[var(--color-accent-600)] text-white">
                {upcomingStocks.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── TAB 1: FLAT LIST OF STOCKS (Primary Request) ── */}
      {activeTab === "list" && (
        <div className="flex flex-col gap-4">
          {/* Controls Bar: Search, Universe Scope, and Quick Filter Pills */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by symbol, company name, sector or industry…"
                className="w-full pl-9 pr-8 py-2 text-[13px] rounded-lg border hairline bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent-500)] transition-colors"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Universe Scope (All NSE vs NIFTY 500) */}
            <div className="flex items-center gap-2 self-start lg:self-auto">
              <span className="text-[11px] uppercase tracking-wide muted-text">Scope:</span>
              <div className="inline-flex rounded-lg p-0.5 border hairline bg-[var(--color-paper)]">
                <button
                  type="button"
                  onClick={() => {
                    setN500Only(false);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1 text-[12px] rounded-md font-medium transition-colors ${
                    !n500Only
                      ? "bg-[var(--color-accent-600)] text-white shadow-xs"
                      : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  All NSE
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setN500Only(true);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1 text-[12px] rounded-md font-medium transition-colors ${
                    n500Only
                      ? "bg-[var(--color-accent-600)] text-white shadow-xs"
                      : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  NIFTY 500
                </button>
              </div>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] uppercase tracking-wide muted-text mr-1">Filter:</span>
            {[
              { id: "all" as FilterPill, label: "All Dividend Payers" },
              { id: "high_yield" as FilterPill, label: "High Yield (≥ 3%)" },
              { id: "consistent" as FilterPill, label: "4-Year Consistent (All FYs)" },
              { id: "quality" as FilterPill, label: "High Quality (Comp ≥ 70)" },
              { id: "upcoming" as FilterPill, label: "Upcoming Payout / Meeting" },
            ].map((p) => {
              const active = filterPill === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setFilterPill(p.id);
                    setPage(1);
                  }}
                  className={`px-3 py-1 rounded-full text-[12px] font-medium border transition-colors ${
                    active
                      ? "border-[var(--color-accent-500)] bg-[color-mix(in_srgb,var(--color-accent-600)_12%,transparent)] text-[var(--color-accent-700)] font-semibold"
                      : "border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-paper)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Results Summary Bar */}
          <div className="flex items-center justify-between text-[12px] text-[var(--color-muted)] px-1">
            <div>
              Showing <span className="font-semibold text-[var(--color-ink)]">{filteredStocks.length}</span> dividend stocks
              {n500Only ? " in Nifty 500" : " across NSE"}
            </div>
            <div>
              Sorted by: <span className="font-semibold text-[var(--color-ink)]">{sortKey.toUpperCase()}</span> ({sortDir})
            </div>
          </div>

          {/* Flat List Table */}
          <div className="rounded-xl border hairline overflow-hidden bg-[var(--color-surface)] shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="border-b hairline bg-[var(--color-paper)] text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                    <th className="py-2.5 px-3 font-semibold">
                      <button
                        type="button"
                        onClick={() => handleSort("symbol")}
                        className="inline-flex items-center gap-1 hover:text-[var(--color-ink)]"
                      >
                        Stock & Sector
                        <ArrowUpDown size={11} />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("ltp")}
                        className="inline-flex items-center gap-1 hover:text-[var(--color-ink)] ml-auto"
                      >
                        LTP
                        <ArrowUpDown size={11} />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("yield")}
                        className="inline-flex items-center gap-1 hover:text-[var(--color-ink)] ml-auto"
                      >
                        Trailing Yield
                        <ArrowUpDown size={11} />
                      </button>
                    </th>
                    {fyLabels.map((lbl, idx) => (
                      <th key={lbl} className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleSort(`fy${idx}` as SortKey)}
                          className="inline-flex items-center gap-1 hover:text-[var(--color-ink)] ml-auto"
                        >
                          {lbl} DPS
                          <ArrowUpDown size={11} />
                        </button>
                      </th>
                    ))}
                    <th className="py-2.5 px-3 font-semibold text-center">
                      <button
                        type="button"
                        onClick={() => handleSort("composite")}
                        className="inline-flex items-center gap-1 hover:text-[var(--color-ink)] mx-auto"
                      >
                        Composite
                        <ArrowUpDown size={11} />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-left">
                      <button
                        type="button"
                        onClick={() => handleSort("next")}
                        className="inline-flex items-center gap-1 hover:text-[var(--color-ink)]"
                      >
                        Next Corporate Action
                        <ArrowUpDown size={11} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y hairline">
                  {pagedStocks.length === 0 ? (
                    <tr>
                      <td colSpan={5 + fyLabels.length} className="py-12 text-center text-[var(--color-muted)] italic">
                        No dividend stocks match the selected criteria.
                      </td>
                    </tr>
                  ) : (
                    pagedStocks.map((st) => {
                      const yieldVal = st.divYield;
                      const isHighYield = yieldVal != null && yieldVal >= 3.0;
                      const comp = st.composite_pct;
                      const next = st.nextEvent;

                      return (
                        <tr
                          key={st.symbol}
                          className="hover:bg-[var(--color-paper)] transition-colors group"
                        >
                          {/* Symbol & Company Name */}
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <Link
                                    href={`/stock/${st.symbol}`}
                                    className="font-semibold text-[13.5px] hover:text-[var(--color-accent-600)] transition-colors"
                                  >
                                    {st.symbol}
                                  </Link>
                                  {st.is_ipo && <IpoBadge show={true} />}
                                </div>
                                <div className="text-[11.5px] muted-text truncate max-w-[210px]" title={st.name ?? ""}>
                                  {displayCompanyName(st.name, st.symbol)}
                                </div>
                                <div className="text-[10px] text-[var(--color-muted)] font-mono truncate max-w-[210px]">
                                  {st.sector} · {st.industry}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* LTP */}
                          <td className="py-2.5 px-3 text-right font-mono text-[13px] font-medium">
                            {inr(st.ltp)}
                          </td>

                          {/* Trailing Yield */}
                          <td className="py-2.5 px-3 text-right font-mono">
                            {yieldVal != null ? (
                              <span
                                className={`inline-block px-2 py-0.5 rounded-md font-semibold text-[12.5px] ${
                                  isHighYield
                                    ? "bg-[color-mix(in_srgb,var(--color-delta-up)_15%,transparent)] text-[var(--color-delta-up)]"
                                    : "text-[var(--color-ink)]"
                                }`}
                              >
                                {yieldVal.toFixed(2)}%
                              </span>
                            ) : (
                              <span className="text-[var(--color-muted)]">—</span>
                            )}
                          </td>

                          {/* Last 4 FY DPS */}
                          {st.dps.map((val, idx) => (
                            <td key={idx} className="py-2.5 px-3 text-right font-mono text-[12.5px]">
                              {val != null ? (
                                <div>
                                  <span className="text-[var(--color-ink)]">{inr(val)}</span>
                                  {st.dpsYield[idx] != null && (
                                    <div className="text-[10px] muted-text">
                                      {st.dpsYield[idx]?.toFixed(1)}%
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[var(--color-muted)]">—</span>
                              )}
                            </td>
                          ))}

                          {/* Composite Score */}
                          <td className="py-2.5 px-3 text-center">
                            {comp != null ? (
                              <span
                                className="inline-block min-w-[32px] px-1.5 py-0.5 rounded text-[11.5px] font-bold font-mono text-white shadow-2xs"
                                style={{ backgroundColor: bandColor(band(comp)) }}
                              >
                                {comp}
                              </span>
                            ) : (
                              <span className="text-[var(--color-muted)] text-[11px]">—</span>
                            )}
                          </td>

                          {/* Next Event */}
                          <td className="py-2.5 px-3">
                            {next ? (
                              <div className="flex flex-col text-[11.5px]">
                                <div className="flex items-center gap-1.5 font-medium">
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase tracking-wider ${
                                      next.type === "dividend"
                                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                        : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                                    }`}
                                  >
                                    {next.type === "dividend" ? "Ex-Date" : "Meeting"}
                                  </span>
                                  <span className="font-mono text-[11px]">{fmtEventDate(next.date)}</span>
                                </div>
                                <div className="text-[11px] muted-text truncate max-w-[200px]" title={next.purpose}>
                                  {next.amount != null ? `₹${next.amount.toFixed(2)}/sh · ` : ""}
                                  {next.purpose}
                                </div>
                              </div>
                            ) : (
                              <span className="text-[11px] text-[var(--color-muted)] italic">No upcoming event</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t hairline bg-[var(--color-paper)] text-[12px]">
                <div className="text-[var(--color-muted)]">
                  Page <span className="font-semibold text-[var(--color-ink)]">{page}</span> of{" "}
                  <span className="font-semibold text-[var(--color-ink)]">{totalPages}</span> ({filteredStocks.length} total)
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded border hairline disabled:opacity-40 hover:bg-[var(--color-surface)]"
                  >
                    Previous
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const pageNum = i + 1;
                    return (
                      <button
                        key={pageNum}
                        type="button"
                        onClick={() => setPage(pageNum)}
                        className={`px-2.5 py-1 rounded text-[11.5px] font-medium border hairline ${
                          page === pageNum
                            ? "bg-[var(--color-accent-600)] text-white"
                            : "hover:bg-[var(--color-surface)] text-[var(--color-muted)]"
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="px-2.5 py-1 rounded border hairline disabled:opacity-40 hover:bg-[var(--color-surface)]"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: BY SECTOR & INDUSTRY ── */}
      {activeTab === "sectors" && (
        <div className="flex gap-4 min-h-[560px]">
          {/* Sector / Industry Selector */}
          <div className="w-[260px] shrink-0 border hairline rounded-xl bg-[var(--color-surface)] p-3 overflow-y-auto max-h-[700px]">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--color-muted)] mb-2 px-1">
              Sectors & Industries
            </div>
            <div className="flex flex-col gap-1">
              {sectorList.map((s) => {
                const isSelected = activeSector === s.name;
                return (
                  <div key={s.name} className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSector(s.name);
                        setSelectedIndustry("");
                      }}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium text-left transition-colors ${
                        isSelected && !selectedIndustry
                          ? "bg-[var(--color-accent-600)] text-white font-semibold"
                          : "hover:bg-[var(--color-paper)] text-[var(--color-ink)]"
                      }`}
                    >
                      <span className="truncate">{s.name}</span>
                      <span className="text-[10px] opacity-75 tabular-nums">({s.count})</span>
                    </button>

                    {/* Sub-industries if sector is selected */}
                    {isSelected && (
                      <div className="ml-3 pl-2 border-l hairline flex flex-col gap-0.5 my-1">
                        {s.industries.map((ind) => (
                          <button
                            key={ind.id}
                            type="button"
                            onClick={() => setSelectedIndustry(ind.id)}
                            className={`flex items-center justify-between px-2 py-1 rounded text-[11.5px] text-left transition-colors ${
                              selectedIndustry === ind.id
                                ? "bg-[color-mix(in_srgb,var(--color-accent-600)_15%,transparent)] text-[var(--color-accent-700)] font-semibold"
                                : "text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-paper)]"
                            }`}
                          >
                            <span className="truncate">{ind.name}</span>
                            <span className="text-[10px] opacity-75">({ind.stocks.length})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sector Table */}
          <div className="flex-1 rounded-xl border hairline bg-[var(--color-surface)] overflow-hidden shadow-xs">
            <div className="p-3 border-b hairline bg-[var(--color-paper)] flex items-center justify-between">
              <div>
                <h3 className="font-bold text-[14px]">
                  {activeSector} {selectedIndustry ? `· ${currentSectorObj?.industries.find((i) => i.id === selectedIndustry)?.name}` : ""}
                </h3>
                <span className="text-[11.5px] text-[var(--color-muted)]">
                  {sectorFilteredStocks.length} dividend stocks in this category
                </span>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[640px]">
              <table className="w-full text-left text-[12.5px]">
                <thead className="bg-[var(--color-paper)] text-[10.5px] uppercase tracking-wider text-[var(--color-muted)] sticky top-0 border-b hairline">
                  <tr>
                    <th className="py-2 px-3">Symbol</th>
                    <th className="py-2 px-3 text-right">LTP</th>
                    <th className="py-2 px-3 text-right">Yield</th>
                    {fyLabels.map((lbl) => (
                      <th key={lbl} className="py-2 px-3 text-right">{lbl} DPS</th>
                    ))}
                    <th className="py-2 px-3 text-center">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y hairline font-mono">
                  {sectorFilteredStocks.map((st) => (
                    <tr key={st.symbol} className="hover:bg-[var(--color-paper)] transition-colors">
                      <td className="py-2 px-3 font-sans">
                        <Link href={`/stock/${st.symbol}`} className="font-semibold hover:underline">
                          {st.symbol}
                        </Link>
                        <div className="text-[11px] muted-text truncate max-w-[180px]">{st.name}</div>
                      </td>
                      <td className="py-2 px-3 text-right">{inr(st.ltp)}</td>
                      <td className="py-2 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                        {st.divYield != null ? `${st.divYield.toFixed(2)}%` : "—"}
                      </td>
                      {st.dps.map((d, i) => (
                        <td key={i} className="py-2 px-3 text-right text-[11.5px]">
                          {d != null ? inr(d) : "—"}
                        </td>
                      ))}
                      <td className="py-2 px-3 text-center">
                        {st.composite_pct != null ? (
                          <span
                            className="inline-block px-1.5 py-0.2 rounded text-[10.5px] font-bold text-white"
                            style={{ backgroundColor: bandColor(band(st.composite_pct)) }}
                          >
                            {st.composite_pct}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: UPCOMING CALENDAR ── */}
      {activeTab === "calendar" && (
        <div className="flex flex-col gap-4">
          <div className="p-4 rounded-xl border hairline bg-[var(--color-surface)] shadow-xs">
            <h3 className="font-bold text-[15px] mb-1">Upcoming Corporate Actions & Ex-Dates</h3>
            <p className="text-[12.5px] muted-text mb-4">
              Officially declared dividend ex-dates and board meetings scheduled to consider quarterly results/dividends on BSE/NSE.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b hairline bg-[var(--color-paper)] text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Event Type</th>
                    <th className="py-2.5 px-3">Company</th>
                    <th className="py-2.5 px-3">Purpose & Details</th>
                    <th className="py-2.5 px-3 text-right">LTP</th>
                    <th className="py-2.5 px-3 text-right">Yield</th>
                    <th className="py-2.5 px-3 text-center">Composite</th>
                  </tr>
                </thead>
                <tbody className="divide-y hairline">
                  {upcomingStocks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-[var(--color-muted)] italic">
                        No upcoming dividend corporate actions recorded for the near term.
                      </td>
                    </tr>
                  ) : (
                    upcomingStocks.map((st) => {
                      const ev = st.nextEvent!;
                      return (
                        <tr key={st.symbol} className="hover:bg-[var(--color-paper)] transition-colors">
                          <td className="py-2.5 px-3 font-mono font-medium text-[12px]">
                            {fmtEventDate(ev.date)}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10.5px] font-bold uppercase tracking-wider ${
                                ev.type === "dividend"
                                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                  : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                              }`}
                            >
                              {ev.type === "dividend" ? "Dividend Ex-Date" : "Board Meeting"}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <Link href={`/stock/${st.symbol}`} className="font-semibold hover:text-[var(--color-accent-600)]">
                              {st.symbol}
                            </Link>
                            <div className="text-[11.5px] muted-text">{displayCompanyName(st.name, st.symbol)}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium">
                              {ev.amount != null ? (
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold mr-1.5">
                                  ₹{ev.amount.toFixed(2)}/share
                                </span>
                              ) : null}
                              {ev.purpose}
                            </div>
                            <div className="text-[11px] text-[var(--color-muted)] font-mono">{st.sector}</div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-medium">
                            {inr(st.ltp)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                            {st.divYield != null ? `${st.divYield.toFixed(2)}%` : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {st.composite_pct != null ? (
                              <span
                                className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold text-white font-mono"
                                style={{ backgroundColor: bandColor(band(st.composite_pct)) }}
                              >
                                {st.composite_pct}
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
