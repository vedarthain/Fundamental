"use client";

/**
 * Watchlist Verdict Tab — Institutional Conviction Board
 *
 * A high-clarity dashboard grouping tracked portfolio and watchlist stocks
 * by institutional conviction action (BUY, ACCUMULATE, HOLD, WATCH, AVOID),
 * providing company name, 1-line thesis, anchor vs LTP, and performance tracking.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { VerdictSheet } from "@/components/VerdictSheet";
import { STALE_DAYS, type QueueBucket } from "@/lib/verdictTypes";
import type { QueueEntry, TimelineWeek, VerdictQueue } from "@/lib/verdict";

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

function inr(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type ConvictionCategory =
  | "all"
  | "watchlist"
  | "portfolio"
  | "holding"
  | "inspected"
  | "buy"
  | "accumulate"
  | "hold"
  | "watch"
  | "avoid"
  | "missing"
  | "needs_review"
  | "changed"
  | "dormant";

function categorize(e: QueueEntry): "buy" | "accumulate" | "hold" | "watch" | "avoid" | "missing" | "dormant" {
  if (e.bucket === "dormant") return "dormant";
  if (e.bucket === "missing" || !e.action) return "missing";
  const act = e.action.toUpperCase();
  if (act.includes("ACCUMULATE")) return "accumulate";
  if (act.includes("BUY")) return "buy";
  if (act.includes("HOLD")) return "hold";
  if (act.includes("WATCH") || act.includes("SPECULATIVE")) return "watch";
  if (act.includes("AVOID") || act.includes("REDUCE") || act.includes("SELL")) return "avoid";
  return "hold";
}

const ACTION_THEMES: Record<string, { dot: string; pill: string }> = {
  BUY: { dot: "bg-emerald-500", pill: "bg-emerald-50/70 text-emerald-800 border-emerald-200/70" },
  ACCUMULATE: { dot: "bg-teal-500", pill: "bg-teal-50/70 text-teal-800 border-teal-200/70" },
  HOLD: { dot: "bg-slate-400", pill: "bg-slate-100 text-slate-700 border-slate-200" },
  WATCH: { dot: "bg-amber-500", pill: "bg-amber-50/80 text-amber-800 border-amber-200/70" },
  SPECULATIVE: { dot: "bg-amber-500", pill: "bg-amber-50/80 text-amber-800 border-amber-200/70" },
  REDUCE: { dot: "bg-rose-400", pill: "bg-rose-50/70 text-rose-700 border-rose-200/70" },
  AVOID: { dot: "bg-rose-500", pill: "bg-rose-50/80 text-rose-800 border-rose-200/80" },
  SELL: { dot: "bg-rose-500", pill: "bg-rose-50/80 text-rose-800 border-rose-200/80" },
};

function getBadgeTheme(action: string | null) {
  if (!action) return { dot: "bg-slate-300", pill: "bg-slate-50 text-slate-400 border-slate-200" };
  const firstWord = action.toUpperCase().split(/[\s,]+/)[0];
  return ACTION_THEMES[firstWord] || { dot: "bg-slate-400", pill: "bg-slate-100 text-slate-700 border-slate-200" };
}

type SortKey = "symbol" | "company" | "conviction" | "thesis" | "anchor" | "ltp" | "move" | "freshness" | "urgency";
type SortDirection = "asc" | "desc";

const CONVICTION_RANK: Record<string, number> = {
  BUY: 1,
  ACCUMULATE: 2,
  HOLD: 3,
  WATCH: 4,
  SPECULATIVE: 4,
  REDUCE: 5,
  AVOID: 6,
  SELL: 6,
};

export function VerdictQueueClient() {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ok"; q: VerdictQueue } | { kind: "error"; msg: string }
  >({ kind: "loading" });
  const [open, setOpen] = useState<string | null>(null);
  const [inspectedSymbols, setInspectedSymbols] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<ConvictionCategory>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("freshness");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [showTimeline, setShowTimeline] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [showClusterTracker, setShowClusterTracker] = useState(false);
  const [clusterSearch, setClusterSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      if (key === "symbol" || key === "company" || key === "thesis" || key === "conviction") {
        setSortDir("asc");
      } else {
        setSortDir("desc");
      }
    }
  };

  // Restore inspected stocks from localStorage across sessions
  useEffect(() => {
    try {
      const raw = localStorage.getItem("fundamental_verdict_inspected_stocks");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setInspectedSymbols(new Set(parsed));
        }
      }
    } catch {
      // non-fatal
    }
  }, []);

  const openSymbol = (symbol: string) => {
    setInspectedSymbols((prev) => {
      if (prev.has(symbol)) return prev;
      const next = new Set(prev);
      next.add(symbol);
      try {
        localStorage.setItem("fundamental_verdict_inspected_stocks", JSON.stringify([...next]));
      } catch {
        // non-fatal
      }
      return next;
    });
    setOpen(symbol);
  };

  useEffect(() => {
    let live = true;
    fetch("/api/admin/verdict?queue=1", { cache: "no-store" })
      .then(async (r) => {
        if (!live) return;
        if (r.status === 401) {
          setState({
            kind: "error",
            msg: "Verdicts are admin-only and this session is not an admin session.",
          });
          return;
        }
        if (!r.ok) {
          setState({ kind: "error", msg: `The queue request failed (${r.status}).` });
          return;
        }
        setState({ kind: "ok", q: (await r.json()) as VerdictQueue });
      })
      .catch(() => {
        if (live) setState({ kind: "error", msg: "The queue request did not complete." });
      });
    return () => {
      live = false;
    };
  }, []);

  // Category counts across live entries
  const counts = useMemo(() => {
    const res = {
      buy: 0,
      accumulate: 0,
      hold: 0,
      watch: 0,
      avoid: 0,
      missing: 0,
      dormant: 0,
      changed: 0,
      needsReview: 0,
      holding: 0,
      portfolio: 0,
      watchlist: 0,
      inspected: 0,
      total: 0,
    };
    if (state.kind !== "ok") return res;
    for (const e of state.q.entries) {
      const cat = categorize(e);
      if (cat !== "dormant") res.total++;
      res[cat]++;
      if (e.hasActionChanged) res.changed++;
      if (e.bucket === "due") res.needsReview++;
      if (e.isPortfolio || e.isHolding) {
        res.portfolio++;
        res.holding++;
      }
      if (e.isWatchlist) res.watchlist++;
      if (inspectedSymbols.has(e.symbol)) res.inspected++;
    }
    return res;
  }, [state, inspectedSymbols]);

  // Filtered & Sorted list
  const filtered = useMemo(() => {
    if (state.kind !== "ok") return [];
    let list = state.q.entries;

    // Filter by cluster
    if (selectedCluster) {
      list = list.filter((e) => e.cluster_id === selectedCluster);
    }

    // Filter by conviction category
    if (category === "portfolio" || category === "holding") {
      list = list.filter((e) => e.isPortfolio || e.isHolding);
    } else if (category === "watchlist") {
      list = list.filter((e) => e.isWatchlist);
    } else if (category === "inspected") {
      list = list.filter((e) => inspectedSymbols.has(e.symbol));
    } else if (category === "changed") {
      list = list.filter((e) => e.hasActionChanged);
    } else if (category === "needs_review") {
      list = list.filter((e) => e.bucket === "due");
    } else if (category !== "all") {
      list = list.filter((e) => categorize(e) === category);
    } else {
      // By default in 'all', show active tracked stocks (exclude dormant unless explicitly picked)
      list = list.filter((e) => e.bucket !== "dormant");
    }

    // Filter by text search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.symbol.toLowerCase().includes(q) ||
          (e.company_name && e.company_name.toLowerCase().includes(q)) ||
          (e.industry && e.industry.toLowerCase().includes(q)) ||
          (e.thesis && e.thesis.toLowerCase().includes(q))
      );
    }

    // Sort
    return list.slice().sort((a, b) => {
      let diff = 0;
      if (sortKey === "symbol") {
        diff = a.symbol.localeCompare(b.symbol);
      } else if (sortKey === "company") {
        diff = (a.company_name || a.symbol).localeCompare(b.company_name || b.symbol);
      } else if (sortKey === "conviction") {
        const actA = a.action ? a.action.toUpperCase().split(/[\s,]+/)[0] : "";
        const actB = b.action ? b.action.toUpperCase().split(/[\s,]+/)[0] : "";
        const rankA = CONVICTION_RANK[actA] ?? 99;
        const rankB = CONVICTION_RANK[actB] ?? 99;
        diff = rankA - rankB;
      } else if (sortKey === "thesis") {
        diff = (a.thesis || "").localeCompare(b.thesis || "");
      } else if (sortKey === "anchor") {
        const pa = a.anchorPrice ?? -999999;
        const pb = b.anchorPrice ?? -999999;
        diff = pa - pb;
      } else if (sortKey === "ltp") {
        const pa = a.currentLtp ?? -999999;
        const pb = b.currentLtp ?? -999999;
        diff = pa - pb;
      } else if (sortKey === "move") {
        const ma = a.pctMove ?? -999999;
        const mb = b.pctMove ?? -999999;
        diff = ma - mb;
      } else if (sortKey === "freshness") {
        const ta = a.generated_at ? new Date(a.generated_at).getTime() : 0;
        const tb = b.generated_at ? new Date(b.generated_at).getTime() : 0;
        diff = ta - tb;
      } else if (sortKey === "urgency") {
        const ua = a.movedCount > 0 ? 2 : (a.ageDays ?? 0) > STALE_DAYS ? 1 : 0;
        const ub = b.movedCount > 0 ? 2 : (b.ageDays ?? 0) > STALE_DAYS ? 1 : 0;
        diff = ua - ub || (a.ageDays ?? 0) - (b.ageDays ?? 0);
      }

      if (diff === 0) {
        diff = a.symbol.localeCompare(b.symbol);
      }
      return sortDir === "asc" ? diff : -diff;
    });
  }, [state, category, search, sortKey, sortDir, selectedCluster, inspectedSymbols]);

  // Reset to page 1 whenever any filter, search, sort, or pageSize changes
  useEffect(() => {
    setCurrentPage(1);
  }, [category, search, sortKey, sortDir, selectedCluster, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filtered.length);
  const paginated = useMemo(() => {
    return filtered.slice(startIndex, endIndex);
  }, [filtered, startIndex, endIndex]);

  if (state.kind === "loading") {
    return (
      <div className="py-16 text-center text-[13px] text-slate-500">
        <div className="inline-block w-5 h-5 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin mb-2" />
        <div>Loading Institutional Conviction Board…</div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-4 text-[13px] max-w-[640px] text-rose-800">
        <span className="font-medium">Could not load conviction board:</span> {state.msg}
      </div>
    );
  }

  const { trackedCount, timeline, summary, clusterProgress } = state.q;

  const summaryData = summary || {
    totalUniverse: trackedCount,
    completedCount: counts.total - counts.missing,
    completedPercent:
      trackedCount > 0
        ? Math.round(((counts.total - counts.missing) / trackedCount) * 1000) / 10
        : 0,
    pendingCount: counts.missing,
    refreshedTodayCount: 0,
    actionCounts: {
      buy: counts.buy,
      accumulate: counts.accumulate,
      hold: counts.hold,
      watch: counts.watch,
      avoid: counts.avoid,
      sell: 0,
    },
  };

  const clusters = clusterProgress || [];
  const completedClustersCount = clusters.filter((c) => c.percent >= 90).length;
  const inProgressClustersCount = clusters.filter(
    (c) => c.percent > 0 && c.percent < 90
  ).length;
  const totalClustersCount = clusters.length;

  const filteredClusters = clusterSearch.trim()
    ? clusters.filter(
        (c) =>
          c.clusterName.toLowerCase().includes(clusterSearch.trim().toLowerCase()) ||
          c.clusterId.toLowerCase().includes(clusterSearch.trim().toLowerCase())
      )
    : clusters;

  const activeClusterObj = clusters.find((c) => c.clusterId === selectedCluster);


  return (
    <div className="space-y-2.5 w-full">
      {/* 0. Verdict Completion Summary Strip (Ultra-Compact) */}
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2.5 text-[11.5px]">
          {/* Main Completion Stats */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-900 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                Completion:
              </span>
              <span className="font-mono font-medium text-slate-900">
                {summaryData.completedCount.toLocaleString()} / {summaryData.totalUniverse.toLocaleString()}
              </span>
              <span className="font-mono text-emerald-700 font-semibold">
                ({summaryData.completedPercent.toFixed(1)}%)
              </span>
              <div className="w-20 sm:w-28 bg-slate-100 rounded-full h-1 overflow-hidden ml-1 border border-slate-200/80">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, summaryData.completedPercent)}%` }}
                />
              </div>
            </div>

            <span className="text-slate-300 hidden sm:inline">•</span>

            <div className="flex items-center gap-1">
              <span className="text-slate-500">Refreshed:</span>
              <span className="font-mono font-medium text-emerald-700">
                +{summaryData.refreshedTodayCount.toLocaleString()}
              </span>
            </div>

            <span className="text-slate-300 hidden sm:inline">•</span>

            <div className="flex items-center gap-1">
              <span className="text-slate-500">Pending:</span>
              <span className="font-mono font-medium text-amber-700">
                {summaryData.pendingCount.toLocaleString()}
              </span>
            </div>

            <span className="text-slate-300 hidden sm:inline">•</span>

            <div className="flex items-center gap-1">
              <span className="text-slate-500">Needs Review:</span>
              <span className="font-mono font-medium text-amber-700">
                {counts.needsReview.toLocaleString()}
              </span>
            </div>

            <span className="text-slate-300 hidden sm:inline">•</span>

            <div className="flex items-center gap-1">
              <span className="text-slate-500">Clusters:</span>
              <span className="font-mono font-medium text-slate-800">
                {completedClustersCount} / {totalClustersCount}
              </span>
            </div>
          </div>

          {/* Quick Actions (Cluster matrix toggle) */}
          <div className="flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => setShowClusterTracker(!showClusterTracker)}
              className={`px-2 py-0.5 rounded border font-medium transition-colors flex items-center gap-1 ${
                showClusterTracker
                  ? "border-slate-400 bg-slate-100 text-slate-900"
                  : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
              }`}
            >
              <span>Clusters ({clusters.length})</span>
              <span className="text-[9px] text-slate-500">{showClusterTracker ? "▲" : "▼"}</span>
            </button>
          </div>
        </div>

        {/* Compact Light Cluster Drawer */}
        {showClusterTracker && (
          <div className="mt-2.5 pt-2.5 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[11px] font-medium text-slate-700 flex items-center gap-1.5">
                <span>72 Clusters Breakdown</span>
                <span className="text-[9.5px] text-slate-400 font-normal font-mono">(Numbered #1 to #72)</span>
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={clusterSearch}
                  onChange={(e) => setClusterSearch(e.target.value)}
                  placeholder="Filter clusters or #number..."
                  className="text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-0.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 w-44"
                />
                {selectedCluster && (
                  <button
                    type="button"
                    onClick={() => setSelectedCluster(null)}
                    className="text-[10.5px] text-rose-600 hover:text-rose-800 font-medium"
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5 max-h-[200px] overflow-y-auto pr-1">
              {filteredClusters.map((c) => {
                const isSelected = selectedCluster === c.clusterId;
                const isComplete = c.percent >= 90;
                return (
                  <button
                    key={c.clusterId}
                    type="button"
                    onClick={() =>
                      setSelectedCluster(isSelected ? null : c.clusterId)
                    }
                    className={`text-left p-1.5 rounded border text-[11px] transition-all ${
                      isSelected
                        ? "bg-emerald-50 border-emerald-400 text-emerald-950 ring-1 ring-emerald-400"
                        : "bg-white border-slate-200 hover:border-slate-300 text-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="truncate font-medium flex items-center gap-1 min-w-0">
                        <span className="text-[9.5px] font-mono text-slate-400 bg-slate-100 px-1 py-0.2 rounded shrink-0">
                          #{c.clusterIndex}
                        </span>
                        <span className="truncate">{c.clusterName}</span>
                      </div>
                      <span
                        className={`font-mono text-[10px] shrink-0 ${
                          isComplete ? "text-emerald-700 font-semibold" : "text-slate-500"
                        }`}
                      >
                        {c.completedStocks}/{c.totalStocks}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1 mt-1 overflow-hidden">
                      <div
                        className={`h-full ${isComplete ? "bg-emerald-500" : "bg-teal-500"}`}
                        style={{ width: `${Math.min(100, c.percent)}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 1. Conviction Overview Cards Ribbon (Super Compact Tiles) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5">
        {/* BUY */}
        <button
          type="button"
          onClick={() => setCategory(category === "buy" ? "all" : "buy")}
          className={`px-2.5 py-1.5 rounded-md border text-left transition-all relative ${
            category === "buy"
              ? "border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Buy
            </span>
          </div>
          <div className="text-[16px] font-mono font-semibold text-slate-900 mt-0.5 leading-tight">
            {counts.buy}
          </div>
        </button>

        {/* ACCUMULATE */}
        <button
          type="button"
          onClick={() => setCategory(category === "accumulate" ? "all" : "accumulate")}
          className={`px-2.5 py-1.5 rounded-md border text-left transition-all relative ${
            category === "accumulate"
              ? "border-teal-500 bg-teal-50/50 ring-1 ring-teal-500 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
              Accumulate
            </span>
          </div>
          <div className="text-[16px] font-mono font-semibold text-slate-900 mt-0.5 leading-tight">
            {counts.accumulate}
          </div>
        </button>

        {/* HOLD */}
        <button
          type="button"
          onClick={() => setCategory(category === "hold" ? "all" : "hold")}
          className={`px-2.5 py-1.5 rounded-md border text-left transition-all ${
            category === "hold"
              ? "border-slate-600 bg-slate-100/60 ring-1 ring-slate-600 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              Hold
            </span>
          </div>
          <div className="text-[16px] font-mono font-semibold text-slate-900 mt-0.5 leading-tight">
            {counts.hold}
          </div>
        </button>

        {/* WATCH */}
        <button
          type="button"
          onClick={() => setCategory(category === "watch" ? "all" : "watch")}
          className={`px-2.5 py-1.5 rounded-md border text-left transition-all ${
            category === "watch"
              ? "border-amber-500 bg-amber-50/50 ring-1 ring-amber-500 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Watch
            </span>
          </div>
          <div className="text-[16px] font-mono font-semibold text-slate-900 mt-0.5 leading-tight">
            {counts.watch}
          </div>
        </button>

        {/* REDUCE & AVOID */}
        <button
          type="button"
          onClick={() => setCategory(category === "avoid" ? "all" : "avoid")}
          className={`px-2.5 py-1.5 rounded-md border text-left transition-all ${
            category === "avoid"
              ? "border-rose-400 bg-rose-50/50 ring-1 ring-rose-400 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              Reduce &amp; Avoid
            </span>
          </div>
          <div className="text-[16px] font-mono font-semibold text-slate-900 mt-0.5 leading-tight">
            {counts.avoid}
          </div>
        </button>

        {/* PENDING VERDICT */}
        <button
          type="button"
          onClick={() => setCategory(category === "missing" ? "all" : "missing")}
          className={`px-2.5 py-1.5 rounded-md border text-left transition-all ${
            category === "missing"
              ? "border-slate-400 bg-slate-50 ring-1 ring-slate-400 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
              Pending
            </span>
          </div>
          <div className="text-[16px] font-mono font-semibold text-slate-900 mt-0.5 leading-tight">
            {counts.missing}
          </div>
        </button>

        {/* NEEDS REVIEW (DRIFT / STALE) */}
        <button
          type="button"
          onClick={() => {
            if (category === "needs_review") {
              setCategory("all");
            } else {
              setCategory("needs_review");
              setSortKey("urgency");
            }
          }}
          className={`px-2.5 py-1.5 rounded-md border text-left transition-all ${
            category === "needs_review"
              ? "border-amber-500 bg-amber-50/60 ring-1 ring-amber-500 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Needs Review
            </span>
          </div>
          <div className="text-[16px] font-mono font-semibold text-slate-900 mt-0.5 leading-tight">
            {counts.needsReview}
          </div>
        </button>

        {/* CHANGED VERDICTS */}
        <button
          type="button"
          onClick={() => setCategory(category === "changed" ? "all" : "changed")}
          className={`px-2.5 py-1.5 rounded-md border text-left transition-all ${
            category === "changed"
              ? "border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              Changed
            </span>
          </div>
          <div className="text-[16px] font-mono font-semibold text-slate-900 mt-0.5 leading-tight">
            {counts.changed}
          </div>
        </button>
      </div>

      {/* 2. Controls & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
        {/* Active Filters & Reset */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 text-[12px]">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={`px-3 py-1 rounded-md font-medium transition-all ${
              category === "all"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
            }`}
          >
            All Active ({counts.total.toLocaleString()})
          </button>

          {/* Watchlist Filter Button */}
          {counts.watchlist > 0 && (
            <button
              type="button"
              onClick={() => setCategory(category === "watchlist" ? "all" : "watchlist")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 ${
                category === "watchlist"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "bg-amber-50/80 text-amber-900 border border-amber-200/90 hover:bg-amber-100"
              }`}
              title="Show stocks on your watchlist"
            >
              <span>⭐</span>
              <span>Watchlist ({counts.watchlist})</span>
            </button>
          )}

          {/* Portfolio Filter Button */}
          {counts.portfolio > 0 && (
            <button
              type="button"
              onClick={() => setCategory(category === "portfolio" ? "all" : "portfolio")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 ${
                category === "portfolio" || category === "holding"
                  ? "bg-emerald-700 text-white shadow-xs"
                  : "bg-emerald-50/80 text-emerald-800 border border-emerald-200/90 hover:bg-emerald-100"
              }`}
              title="Show stocks currently in your portfolio"
            >
              <span>💼</span>
              <span>Portfolio ({counts.portfolio})</span>
            </button>
          )}

          {/* Inspected Stocks Filter Button */}
          {counts.inspected > 0 && (
            <button
              type="button"
              onClick={() => setCategory(category === "inspected" ? "all" : "inspected")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 ${
                category === "inspected"
                  ? "bg-indigo-700 text-white shadow-xs"
                  : "bg-indigo-50/80 text-indigo-800 border border-indigo-200/90 hover:bg-indigo-100"
              }`}
              title="Show stocks you have inspected (persisted across sessions)"
            >
              <span>✓</span>
              <span>Inspected ({counts.inspected})</span>
            </button>
          )}

          {/* Active Category Filter Pill (shown only when a card above is selected, e.g. Buy, Accumulate, Hold) */}
          {category !== "all" &&
            category !== "dormant" &&
            category !== "portfolio" &&
            category !== "holding" &&
            category !== "watchlist" &&
            category !== "inspected" && (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-900 text-white text-[11.5px] font-medium shadow-xs shrink-0">
              <span className="capitalize">{category.replace("_", " ")}</span>
              <span className="text-slate-300 font-mono text-[10.5px]">
                ({filtered.length})
              </span>
              <button
                type="button"
                onClick={() => setCategory("all")}
                className="ml-1 text-slate-400 hover:text-white font-bold text-[12px] leading-none"
                title="Reset to All Active"
              >
                ✕
              </button>
            </div>
          )}

          {counts.dormant > 0 && (
            <button
              type="button"
              onClick={() => setCategory(category === "dormant" ? "all" : "dormant")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                category === "dormant"
                  ? "bg-slate-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              }`}
            >
              Archived ({counts.dormant})
            </button>
          )}

          {/* Active Cluster Filter Indicator */}
          {activeClusterObj && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-300 text-[11.5px] font-medium shadow-2xs shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Cluster #{activeClusterObj.clusterIndex}: {activeClusterObj.clusterName}</span>
              <button
                type="button"
                onClick={() => setSelectedCluster(null)}
                className="ml-1 text-emerald-600 hover:text-emerald-950 font-bold"
                title="Clear cluster filter"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Search & Sort */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search symbol, company, sector..."
              className="w-full text-[12px] bg-white border border-slate-200 rounded-md px-2.5 py-1 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[11px]"
              >
                ✕
              </button>
            )}
          </div>

          <select
            value={sortKey}
            onChange={(e) => {
              const k = e.target.value as SortKey;
              setSortKey(k);
              if (k === "symbol" || k === "company" || k === "thesis" || k === "conviction") {
                setSortDir("asc");
              } else {
                setSortDir("desc");
              }
            }}
            aria-label="Sort order"
            className="text-[12px] bg-white border border-slate-200 rounded-md px-2 py-1 text-slate-700 focus:outline-none focus:border-slate-400"
          >
            <option value="freshness">Sort: Recently Updated</option>
            <option value="move">Sort: Return Since Verdict</option>
            <option value="conviction">Sort: Conviction Tier</option>
            <option value="urgency">Sort: Needs Review (Drift)</option>
            <option value="symbol">Sort: Symbol (A-Z)</option>
            <option value="company">Sort: Company Name</option>
            <option value="ltp">Sort: Current LTP</option>
          </select>

          {/* Top Quick Page Stepper */}
          {totalPages > 1 && (
            <div className="flex items-center gap-1 text-[11.5px] bg-white border border-slate-200 rounded-md px-1.5 py-0.5 shadow-2xs">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-1 text-slate-500 hover:text-slate-900 disabled:opacity-30 disabled:hover:text-slate-500 font-bold"
                title="Previous page"
              >
                ◀
              </button>
              <span className="font-mono text-slate-700 px-1 text-[11px]">
                {safePage}/{totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-1 text-slate-500 hover:text-slate-900 disabled:opacity-30 disabled:hover:text-slate-500 font-bold"
                title="Next page"
              >
                ▶
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. The Conviction Table */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-500">
          No stocks match the selected conviction filter or search term.
          <div className="mt-2">
            <button
              type="button"
              onClick={() => {
                setCategory("all");
                setSearch("");
              }}
              className="text-[12px] text-emerald-700 font-medium hover:underline"
            >
              Reset filters
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-270px)] min-h-[380px]">
            <table className="w-full text-[12px] border-collapse min-w-[920px]">
              <thead className="sticky top-0 z-20 bg-slate-50 shadow-xs">
                <tr className="border-b border-slate-200 bg-slate-50 text-[10.5px] font-semibold uppercase tracking-wider text-slate-600 select-none">
                  <th className="sticky top-0 left-0 z-30 bg-slate-50 text-left py-2 px-3 border-b border-slate-200 shadow-xs">
                    <button
                      type="button"
                      onClick={() => toggleSort("symbol")}
                      className="group inline-flex items-center gap-1 font-semibold hover:text-slate-900 transition-colors cursor-pointer"
                      title="Click to sort by Symbol / Company"
                    >
                      <span>Company &amp; Sector</span>
                      <span className={`text-[10px] ${sortKey === "symbol" || sortKey === "company" ? "text-slate-900 font-bold" : "text-slate-300 opacity-60 group-hover:opacity-100"}`}>
                        {sortKey === "symbol" || sortKey === "company" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-50 text-left py-2 px-3 border-b border-slate-200 shadow-xs">
                    <button
                      type="button"
                      onClick={() => toggleSort("conviction")}
                      className="group inline-flex items-center gap-1 font-semibold hover:text-slate-900 transition-colors cursor-pointer"
                      title="Click to sort by Conviction Tier"
                    >
                      <span>Conviction</span>
                      <span className={`text-[10px] ${sortKey === "conviction" ? "text-slate-900 font-bold" : "text-slate-300 opacity-60 group-hover:opacity-100"}`}>
                        {sortKey === "conviction" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-50 text-left py-2 px-3 w-[40%] border-b border-slate-200 shadow-xs">
                    <button
                      type="button"
                      onClick={() => toggleSort("thesis")}
                      className="group inline-flex items-center gap-1 font-semibold hover:text-slate-900 transition-colors cursor-pointer"
                      title="Click to sort by Verdict Thesis"
                    >
                      <span>1-Line Verdict Thesis</span>
                      <span className={`text-[10px] ${sortKey === "thesis" ? "text-slate-900 font-bold" : "text-slate-300 opacity-60 group-hover:opacity-100"}`}>
                        {sortKey === "thesis" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-50 text-right py-2 px-3 border-b border-slate-200 shadow-xs">
                    <button
                      type="button"
                      onClick={() => toggleSort("anchor")}
                      className="group inline-flex items-center gap-1 font-semibold hover:text-slate-900 transition-colors cursor-pointer ml-auto"
                      title="Click to sort by Price At Verdict"
                    >
                      <span>At Verdict</span>
                      <span className={`text-[10px] ${sortKey === "anchor" ? "text-slate-900 font-bold" : "text-slate-300 opacity-60 group-hover:opacity-100"}`}>
                        {sortKey === "anchor" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-50 text-right py-2 px-3 border-b border-slate-200 shadow-xs">
                    <button
                      type="button"
                      onClick={() => toggleSort("ltp")}
                      className="group inline-flex items-center gap-1 font-semibold hover:text-slate-900 transition-colors cursor-pointer ml-auto"
                      title="Click to sort by Current Market Price (LTP)"
                    >
                      <span>Current LTP</span>
                      <span className={`text-[10px] ${sortKey === "ltp" ? "text-slate-900 font-bold" : "text-slate-300 opacity-60 group-hover:opacity-100"}`}>
                        {sortKey === "ltp" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-50 text-right py-2 px-3 border-b border-slate-200 shadow-xs">
                    <button
                      type="button"
                      onClick={() => toggleSort("move")}
                      className="group inline-flex items-center gap-1 font-semibold hover:text-slate-900 transition-colors cursor-pointer ml-auto"
                      title="Click to sort by Return %"
                    >
                      <span>Return</span>
                      <span className={`text-[10px] ${sortKey === "move" ? "text-slate-900 font-bold" : "text-slate-300 opacity-60 group-hover:opacity-100"}`}>
                        {sortKey === "move" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-50 text-right py-2 px-3.5 border-b border-slate-200 shadow-xs">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginated.map((e) => {
                  const badge = getBadgeTheme(e.action);
                  const isMissing = !e.verdict;
                  const hasMoved = e.movedCount > 0;
                  const isStale = e.ageDays != null && e.ageDays > STALE_DAYS;
                  const isInspected = inspectedSymbols.has(e.symbol);

                  return (
                    <tr
                      key={`${e.symbol}-${e.bucket}`}
                      className={`transition-colors group ${
                        isInspected
                          ? "bg-indigo-50/25 hover:bg-indigo-50/50"
                          : "hover:bg-slate-50/70"
                      }`}
                    >
                      {/* Symbol & Company */}
                      <td
                        className={`py-2 px-3 sticky left-0 z-10 transition-colors border-r border-slate-100/60 ${
                          isInspected
                            ? "bg-[#f5f6ff] group-hover:bg-[#ebeeff]"
                            : "bg-white group-hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/stock/${e.symbol}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`font-mono font-bold text-[13.5px] sm:text-[14px] hover:underline ${
                              isInspected
                                ? "text-indigo-800 group-hover:text-indigo-950"
                                : "text-slate-900 group-hover:text-emerald-700"
                            }`}
                          >
                            {e.symbol}
                          </Link>
                          {(e.isPortfolio || e.isHolding) && (
                            <span
                              className="inline-flex items-center gap-0.5 text-[8.5px] font-semibold uppercase tracking-wider px-1 py-0.2 rounded bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs shrink-0"
                              title="In your portfolio"
                            >
                              <span>💼</span>
                              <span>Portfolio</span>
                            </span>
                          )}
                          {e.isWatchlist && (
                            <span
                              className="inline-flex items-center gap-0.5 text-[8.5px] font-semibold uppercase tracking-wider px-1 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-300 shadow-2xs shrink-0"
                              title="On your watchlist"
                            >
                              <span>⭐</span>
                              <span>Watchlist</span>
                            </span>
                          )}
                          {isInspected && (
                            <span
                              className="inline-flex items-center gap-0.5 text-[8.5px] font-semibold uppercase tracking-wider px-1 py-0.2 rounded bg-indigo-100 text-indigo-700 border border-indigo-200 shadow-2xs shrink-0"
                              title="Inspected (persisted across sessions)"
                            >
                              <span>✓</span>
                              <span>Inspected</span>
                            </span>
                          )}
                          {e.bucket === "dormant" && (
                            <span className="text-[8.5px] text-slate-400 bg-slate-100 px-1 py-0.2 rounded font-normal shrink-0">
                              archived
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] font-medium text-slate-700 truncate max-w-[220px] mt-0.5">
                          {e.company_name || e.industry || "—"}
                        </div>
                        {e.industry && (
                          <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[220px]">
                            {e.industry}
                          </div>
                        )}
                      </td>

                      {/* Conviction Action */}
                      <td className="py-1.5 px-3 whitespace-nowrap">
                        {isMissing ? (
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-normal px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                            Pending
                          </span>
                        ) : (
                          <div className="space-y-0.5">
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${badge.pill}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                              {e.action || "HOLD"}
                            </span>
                            {e.hasActionChanged && e.prevAction && (
                              <div
                                className="flex items-center gap-1 text-[9px] font-mono font-medium text-indigo-700 bg-indigo-50/90 px-1.5 py-0.2 rounded border border-indigo-200/70 w-fit"
                                title={`Previous run was ${e.prevAction}${e.prevGeneratedAt ? ` (${new Date(e.prevGeneratedAt).toLocaleDateString()})` : ""}`}
                              >
                                <span className="text-slate-400 line-through">{e.prevAction}</span>
                                <span>➔</span>
                                <span className="font-semibold text-indigo-900">{e.action}</span>
                              </div>
                            )}
                            <div className="text-[9.5px] text-slate-400">
                              {e.ageDays != null ? `${e.ageDays}d ago` : ""}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* 1-Line Verdict Thesis */}
                      <td className="py-1.5 px-3">
                        {isMissing ? (
                          <span className="text-[12px] text-slate-400 italic">
                            Tracked on watchlist. Awaiting AI quantitative verdict generation.
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openSymbol(e.symbol)}
                            className={`text-left text-[13px] leading-snug hover:text-slate-950 transition-colors line-clamp-2 ${
                              isInspected
                                ? "text-indigo-950 font-normal"
                                : "text-slate-800 font-normal"
                            }`}
                            title="Click to view full verdict analysis"
                          >
                            {e.thesis || e.verdict}
                          </button>
                        )}
                        {/* Evidence drift or warning indicator */}
                        {hasMoved && (
                          <div className="text-[10px] text-rose-600 font-normal mt-0.5 flex items-center gap-1">
                            <span>⚠️</span>
                            <span>{e.movedCount} key metrics shifted since writing</span>
                          </div>
                        )}
                        {!hasMoved && isStale && (
                          <div className="text-[10px] text-amber-700 font-normal mt-0.5">
                            Review window open ({e.ageDays}d old)
                          </div>
                        )}
                      </td>

                      {/* Price at Verdict */}
                      <td className="py-1.5 px-3 text-right whitespace-nowrap font-mono text-[11.5px] text-slate-500">
                        {e.anchorPrice != null ? (
                          <div>
                            <div>₹{inr(e.anchorPrice)}</div>
                            {e.priceAsof && (
                              <div className="text-[9.5px] text-slate-400 font-sans">
                                {shortDate(e.priceAsof)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Current LTP */}
                      <td className="py-1.5 px-3 text-right whitespace-nowrap font-mono text-[11.5px] font-medium text-slate-800">
                        {e.ltp != null ? `₹${inr(e.ltp)}` : <span className="text-slate-300 font-normal">—</span>}
                      </td>

                      {/* Return Since Verdict */}
                      <td className="py-1.5 px-3 text-right whitespace-nowrap">
                        {e.pctMove != null ? (
                          <span
                            className={`inline-block font-mono text-[10.5px] font-medium px-2 py-0.2 rounded-full border ${
                              e.pctMove >= 0
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200/70"
                                : "bg-rose-50 text-rose-700 border-rose-200/70"
                            }`}
                          >
                            {e.pctMove >= 0 ? "+" : ""}
                            {e.pctMove.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-300 font-mono text-[10.5px]">—</span>
                        )}
                      </td>

                      {/* Action Button */}
                      <td className="py-1.5 px-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openSymbol(e.symbol)}
                          className={`px-2 py-0.5 text-[11px] font-medium rounded-md border transition-all ${
                            isInspected
                              ? "bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700 font-semibold shadow-xs"
                              : "border-slate-200/90 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                        >
                          {isInspected ? "✓ Inspected" : "Inspect"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls Footer */}
          {filtered.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3.5 py-2.5 bg-slate-50/80 border-t border-slate-200/80 text-[12px] text-slate-600 rounded-b-lg">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  Showing <span className="font-semibold text-slate-900 font-mono">{filtered.length === 0 ? 0 : startIndex + 1}</span>–<span className="font-semibold text-slate-900 font-mono">{endIndex}</span> of <span className="font-semibold text-slate-900 font-mono">{filtered.length.toLocaleString()}</span> stocks
                </span>
                <span className="text-slate-300 hidden sm:inline">•</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Rows per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    aria-label="Rows per page"
                    className="bg-white border border-slate-200 rounded px-2 py-0.5 text-[11.5px] text-slate-700 font-medium focus:outline-none focus:border-slate-400"
                  >
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={3500}>All ({filtered.length})</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => {
                    setCurrentPage((p) => Math.max(1, p - 1));
                    window.scrollTo({ top: 380, behavior: "smooth" });
                  }}
                  className="px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 font-medium transition-colors text-[11.5px]"
                >
                  ← Prev
                </button>

                <div className="flex items-center gap-1 px-1">
                  {/* First page if far away */}
                  {safePage > 3 && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentPage(1);
                          window.scrollTo({ top: 380, behavior: "smooth" });
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded text-[11.5px] font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                      >
                        1
                      </button>
                      {safePage > 4 && <span className="text-slate-400 px-0.5">…</span>}
                    </>
                  )}

                  {/* Window of surrounding pages */}
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p >= safePage - 2 && p <= safePage + 2)
                    .map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setCurrentPage(p);
                          window.scrollTo({ top: 380, behavior: "smooth" });
                        }}
                        className={`w-7 h-7 flex items-center justify-center rounded text-[11.5px] font-medium transition-all ${
                          p === safePage
                            ? "bg-slate-900 text-white font-semibold shadow-xs"
                            : "border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        {p}
                      </button>
                    ))}

                  {/* Last page if far away */}
                  {safePage < totalPages - 2 && (
                    <>
                      {safePage < totalPages - 3 && <span className="text-slate-400 px-0.5">…</span>}
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentPage(totalPages);
                          window.scrollTo({ top: 380, behavior: "smooth" });
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded text-[11.5px] font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                      >
                        {totalPages}
                      </button>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => {
                    setCurrentPage((p) => Math.min(totalPages, p + 1));
                    window.scrollTo({ top: 380, behavior: "smooth" });
                  }}
                  className="px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 font-medium transition-colors text-[11.5px]"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Optional Collapsible Audit & Drift Timeline */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setShowTimeline(!showTimeline)}
          className="text-[11.5px] font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1.5 transition-colors"
        >
          <span>{showTimeline ? "▼ Hide" : "▶ Show"} Weekly Evidence Drift Audit</span>
          <span className="text-[10px] text-slate-400">({timeline.length} weeks tracked)</span>
        </button>

        {showTimeline && (
          <div className="mt-3">
            <Timeline weeks={timeline} onOpen={openSymbol} />
          </div>
        )}
      </div>

      {/* Slide-over Verdict Sheet Modal */}
      {open && <VerdictSheet symbol={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------- weekly */

function Timeline({
  weeks,
  onOpen,
}: {
  weeks: TimelineWeek[];
  onOpen: (s: string) => void;
}) {
  const [tSortKey, setTSortKey] = useState<"week" | "broke" | "stale" | "written">("week");
  const [tSortDir, setTSortDir] = useState<"asc" | "desc">("desc");

  const toggleTSort = (key: "week" | "broke" | "stale" | "written") => {
    if (tSortKey === key) {
      setTSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTSortKey(key);
      setTSortDir("desc");
    }
  };

  const sortedWeeks = useMemo(() => {
    return [...weeks].sort((a, b) => {
      let diff = 0;
      if (tSortKey === "week") {
        diff = new Date(a.weekStart).getTime() - new Date(b.weekStart).getTime();
      } else if (tSortKey === "broke") {
        diff = a.broke.length - b.broke.length;
      } else if (tSortKey === "stale") {
        diff = a.wentStale.length - b.wentStale.length;
      } else if (tSortKey === "written") {
        diff = a.written.length - b.written.length;
      }
      return tSortDir === "asc" ? diff : -diff;
    });
  }, [weeks, tSortKey, tSortDir]);

  const anything = weeks.some(
    (w) => w.written.length || w.broke.length || w.wentStale.length || w.added.length
  );

  return (
    <div className="rounded-lg border border-slate-200/80 bg-white p-4 max-w-[900px] shadow-2xs">
      <div className="text-[12.5px] font-medium text-slate-800">Weekly Evidence Shift History</div>
      <p className="mt-1 mb-3 text-[11.5px] text-slate-500 leading-relaxed font-normal">
        The metrics snapshot runs weekly. <b>Broke</b> notes the exact week a stock&apos;s financial metrics diverged from the frozen evidence.
      </p>

      {!anything ? (
        <div className="text-[12px] text-slate-400 py-2">
          No material evidence shifts recorded in this time window.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[560px]">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200 text-[10.5px] font-semibold uppercase tracking-wider select-none">
                <th className="text-left py-1.5 pr-3">
                  <button
                    type="button"
                    onClick={() => toggleTSort("week")}
                    className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors cursor-pointer"
                    title="Click to sort by Week"
                  >
                    <span>Week</span>
                    <span className={`text-[9.5px] ${tSortKey === "week" ? "text-slate-900 font-bold" : "text-slate-300"}`}>
                      {tSortKey === "week" ? (tSortDir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
                <th className="text-left py-1.5 px-3">
                  <button
                    type="button"
                    onClick={() => toggleTSort("broke")}
                    className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors cursor-pointer"
                    title="Click to sort by Evidence Shifted count"
                  >
                    <span>Evidence Shifted</span>
                    <span className={`text-[9.5px] ${tSortKey === "broke" ? "text-slate-900 font-bold" : "text-slate-300"}`}>
                      {tSortKey === "broke" ? (tSortDir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
                <th className="text-left py-1.5 px-3">
                  <button
                    type="button"
                    onClick={() => toggleTSort("stale")}
                    className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors cursor-pointer"
                    title="Click to sort by Turned Stale count"
                  >
                    <span>Turned Stale</span>
                    <span className={`text-[9.5px] ${tSortKey === "stale" ? "text-slate-900 font-bold" : "text-slate-300"}`}>
                      {tSortKey === "stale" ? (tSortDir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
                <th className="text-left py-1.5 px-3">
                  <button
                    type="button"
                    onClick={() => toggleTSort("written")}
                    className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors cursor-pointer"
                    title="Click to sort by Verdicts Written count"
                  >
                    <span>Verdicts Written</span>
                    <span className={`text-[9.5px] ${tSortKey === "written" ? "text-slate-900 font-bold" : "text-slate-300"}`}>
                      {tSortKey === "written" ? (tSortDir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-normal">
              {sortedWeeks.map((w) => (
                <tr key={w.weekStart} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-2 pr-3 font-mono text-[11px] text-slate-600">{shortDate(w.weekStart)}</td>
                  <td className="py-2 px-3">
                    {w.broke.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {w.broke.map((sym) => (
                          <button
                            key={sym}
                            type="button"
                            onClick={() => onOpen(sym)}
                            className="text-rose-600 hover:text-rose-800 hover:underline font-mono font-semibold text-[11.5px]"
                            title={`Inspect ${sym} verdict & drift`}
                          >
                            {sym}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {w.wentStale.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {w.wentStale.map((sym) => (
                          <button
                            key={sym}
                            type="button"
                            onClick={() => onOpen(sym)}
                            className="text-amber-700 hover:text-amber-900 hover:underline font-mono font-semibold text-[11.5px]"
                            title={`Inspect ${sym} stale verdict`}
                          >
                            {sym}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {w.written.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {w.written.map((sym) => (
                          <button
                            key={sym}
                            type="button"
                            onClick={() => onOpen(sym)}
                            className="text-emerald-700 hover:text-emerald-900 hover:underline font-mono font-semibold text-[11.5px]"
                            title={`Inspect ${sym} verdict`}
                          >
                            {sym}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
