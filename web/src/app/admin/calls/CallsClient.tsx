"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search, Sparkles, Wallet, Coins, ArrowRight, ArrowDownUp, CheckCircle2, ShieldCheck, ExternalLink } from "lucide-react";
import type { ClusterGem, PortfolioActionCall, IdeaHorizon } from "@/app/api/admin/calls/route";

function money(v: number | null | undefined): string {
  if (v == null) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}`;
}

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function getCallBoxStyle(isTaken: boolean, isCleared: boolean, move: number | null | undefined) {
  if (isCleared) {
    return {
      cardClass: "bg-slate-100/90 border-slate-300 text-slate-500 opacity-65",
      badgeClass: "bg-slate-200 text-slate-700 border-slate-300",
      badgeText: "EXITED / CLOSED",
      rowClass: "bg-slate-100/70 opacity-65 text-slate-500",
      boxType: "exited" as const,
    };
  }
  if (isTaken) {
    if (move != null && move > 0.5) {
      return {
        cardClass: "bg-emerald-50/40 border-emerald-400 shadow-xs ring-1 ring-emerald-400/40",
        badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300 font-bold",
        badgeText: `PROFIT (${pct(move)})`,
        rowClass: "bg-emerald-50/40 hover:bg-emerald-50/70 border-l-4 border-l-emerald-500",
        boxType: "profit" as const,
      };
    }
    if (move != null && move < -0.5) {
      return {
        cardClass: "bg-rose-50/40 border-rose-400 shadow-xs ring-1 ring-rose-400/40",
        badgeClass: "bg-rose-100 text-rose-800 border-rose-300 font-bold",
        badgeText: `LOSS (${pct(move)})`,
        rowClass: "bg-rose-50/40 hover:bg-rose-50/70 border-l-4 border-l-rose-500",
        boxType: "loss" as const,
      };
    }
    return {
      cardClass: "bg-blue-50/40 border-blue-400 shadow-xs ring-1 ring-blue-400/40",
      badgeClass: "bg-blue-100 text-blue-800 border-blue-300 font-bold",
      badgeText: "TAKEN / ACTIVE",
      rowClass: "bg-blue-50/40 hover:bg-blue-50/70 border-l-4 border-l-blue-500",
      boxType: "taken" as const,
    };
  }
  return {
    cardClass: "bg-white border-slate-200/90 hover:border-slate-300",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
    badgeText: "FRESH IDEA",
    rowClass: "hover:bg-slate-50/60",
    boxType: "fresh" as const,
  };
}

export function getHorizonBadge(horizon: string | null | undefined) {
  switch (horizon) {
    case "1M":
      return "bg-amber-100 text-amber-900 border-amber-300";
    case "3M":
      return "bg-cyan-100 text-cyan-900 border-cyan-300";
    case "6M":
      return "bg-indigo-100 text-indigo-900 border-indigo-300";
    case "1Y":
      return "bg-purple-100 text-purple-900 border-purple-300";
    case ">1Y":
      return "bg-emerald-100 text-emerald-900 border-emerald-300";
    case "EXIT":
      return "bg-rose-100 text-rose-900 border-rose-300";
    default:
      return "bg-slate-100 text-slate-800 border-slate-300";
  }
}

type CallTab = "plan" | "portfolio" | "gems";
type SortBy = "date_desc" | "date_asc" | "perf_desc" | "upside_desc" | "comp_desc";

export function CallsClient() {
  const [data, setData] = useState<{
    summary: {
      totalGems: number;
      totalClusterCalls: number;
      portfolioTotalCount: number;
      portfolioTrimCount: number;
      portfolioHoldCount: number;
      portfolioAccumulateCount: number;
      portfolioExitCount: number;
      totalInvestedCr: number;
      totalCurrentCr: number;
      horizonCounts?: Record<string, number>;
      statusCounts?: { takenCount: number; clearedCount: number; freshCount: number };
    };
    clusterGems: ClusterGem[];
    portfolioActions: PortfolioActionCall[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<CallTab>("plan");
  const [capital, setCapital] = useState<number>(100000);
  const [sortBy, setSortBy] = useState<SortBy>("date_desc");
  const [search, setSearch] = useState("");
  const [selectedCluster, setSelectedCluster] = useState<string>("ALL");
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [selectedHorizon, setSelectedHorizon] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [gemsOnly, setGemsOnly] = useState(false);
  const [avoidOwned, setAvoidOwned] = useState(false);
  const [userCallOverrides, setUserCallOverrides] = useState<Record<string, { is_taken: boolean; is_cleared: boolean }>>({});

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/calls");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load calls");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleTakeCall = async (symbol: string) => {
    setUserCallOverrides((prev) => ({
      ...prev,
      [symbol]: { is_taken: true, is_cleared: false },
    }));
    try {
      await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, side: "B" }),
      });
    } catch {
      // optimistic update maintained
    }
  };

  const handleExitCall = async (symbol: string) => {
    setUserCallOverrides((prev) => ({
      ...prev,
      [symbol]: { is_taken: false, is_cleared: true },
    }));
    try {
      await fetch("/api/calls", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
    } catch {
      // optimistic update maintained
    }
  };

  // Top 6 curated deployment calls spanning distinct horizons
  const curatedPlan = useMemo(() => {
    const basePicks = [
      {
        symbol: "INDUSTOWER",
        name: "Indus Towers Ltd.",
        cluster: "Telecom",
        weightPct: 20,
        cmp: 380.9,
        buyBelow: 370.7,
        target: 554.4,
        stopLoss: 335.0,
        upside: 46.5,
        scores: "100 / 82 / 51",
        horizon: "1Y" as IdeaHorizon,
        horizonLabel: "🏛️ 1Y Core Institutional",
        timeline: "9–12 Months",
        role: "1Y Alpha FCF Compounder",
        rationale: "FCF yield > 15%, zero-discount cash collection, massive bad debt recoveries, 5G tenancy growth.",
      },
      {
        symbol: "BHARTIARTL",
        name: "Bharti Airtel Ltd.",
        cluster: "Telecom",
        weightPct: 20,
        cmp: 1805.1,
        buyBelow: 1934.2,
        target: 2484.7,
        stopLoss: 1620.0,
        upside: 25.9,
        scores: "91 / 77 / 64",
        horizon: ">1Y" as IdeaHorizon,
        horizonLabel: "💎 >1Y Secular Compounder",
        timeline: "1–3 Years",
        role: ">1Y Monopoly Bedrock",
        rationale: "Secular telecom duopoly, industry-leading ARPU expansion, massive institutional accumulation.",
      },
      {
        symbol: "MAHABANK",
        name: "Bank of Maharashtra",
        cluster: "PSU Banks",
        weightPct: 15,
        cmp: 83.2,
        buyBelow: 79.7,
        target: 108.3,
        stopLoss: 71.0,
        upside: 33.1,
        scores: "100 / 87 / 72",
        horizon: "6M" as IdeaHorizon,
        horizonLabel: "📈 6M Medium Turnaround",
        timeline: "5–6 Months",
        role: "6M Banking Growth Anchor",
        rationale: "Highest ROA (>1.5%) and lowest Net NPA (<0.25%) in PSU banking. Compounding loan book at low P/B.",
      },
      {
        symbol: "NATCOPHARM",
        name: "Natco Pharma Ltd.",
        cluster: "Pharma CDMO / APIs",
        weightPct: 15,
        cmp: 790.5,
        buyBelow: 766.8,
        target: 1022.5,
        stopLoss: 690.0,
        upside: 30.7,
        scores: "96 / 73 / 37",
        horizon: "3M" as IdeaHorizon,
        horizonLabel: "🚀 3M Catalyst",
        timeline: "2–3 Months",
        role: "3M Defensive High-Margin",
        rationale: "Operating margin > 35%, zero net debt, lucrative specialty generic launches in North America.",
      },
      {
        symbol: "ALLDIGI",
        name: "Alldigi Tech Ltd.",
        cluster: "Commercial Services",
        weightPct: 15,
        cmp: 789.2,
        buyBelow: 815.0,
        target: 1117.7,
        stopLoss: 582.0,
        upside: 34.4,
        scores: "94 / 78 / 52",
        horizon: "1M" as IdeaHorizon,
        horizonLabel: "⚡ 1M Tactical Swing",
        timeline: "2–4 Weeks",
        role: "1M B2B Tech Alpha",
        rationale: "High ROCE (>22%), expanding enterprise customer retention, compounding digital revenue.",
      },
      {
        symbol: "ORIENTCEM",
        name: "Orient Cement Ltd.",
        cluster: "Cement",
        weightPct: 15,
        cmp: 112.0,
        buyBelow: 110.5,
        target: 154.7,
        stopLoss: 79.0,
        upside: 37.2,
        scores: "94 / 73 / 25",
        horizon: "3M" as IdeaHorizon,
        horizonLabel: "🚀 3M Catalyst",
        timeline: "2–3 Months",
        role: "3M Asset Re-rating Turnaround",
        rationale: "M&A and capacity expansion catalyst; trading at steep discount to replacement plant value.",
      },
    ];

    let picksToDeploy = basePicks;

    if (avoidOwned && data) {
      // Find which base picks are NOT held in portfolio
      const unheldBase = basePicks.filter((p) => {
        const port = data.portfolioActions.find((a) => a.symbol === p.symbol);
        const gem = data.clusterGems.find((g) => g.symbol === p.symbol);
        return !(port && port.total_qty > 0) && !gem?.is_portfolio;
      });

      const usedSymbols = new Set(unheldBase.map((p) => p.symbol));
      const usedClusters = new Set(unheldBase.map((p) => p.cluster));
      const replacements: typeof basePicks = [];

      for (const g of data.clusterGems) {
        if (unheldBase.length + replacements.length >= 6) break;
        if (g.is_portfolio) continue;
        if (usedSymbols.has(g.symbol)) continue;
        if (g.cluster_name && usedClusters.has(g.cluster_name)) continue;
        if (!g.target_price || !g.buy_below || !g.ltp) continue;

        replacements.push({
          symbol: g.symbol,
          name: g.company_name || g.symbol,
          cluster: g.cluster_name || "General",
          weightPct: 15,
          cmp: g.ltp,
          buyBelow: g.buy_below,
          target: g.target_price,
          stopLoss: g.bear_floor || Math.round(g.ltp * 0.85),
          upside: Math.round(g.upside_pct || 25),
          scores: `${g.composite_pct ?? "—"} / ${g.quality_pct ?? "—"} / ${g.momentum_pct ?? "—"}`,
          horizon: g.horizon,
          horizonLabel: g.horizon_label,
          timeline: g.sell_timeline,
          role: `${g.horizon} Cluster Alpha`,
          rationale: `Top unheld gem in ${g.cluster_name}. ${g.strategy_desc}`,
        });
        usedSymbols.add(g.symbol);
        if (g.cluster_name) usedClusters.add(g.cluster_name);
      }

      const combined = [...unheldBase, ...replacements].slice(0, 6);
      if (combined.length > 0) {
        const weightPerStock = Math.floor(100 / combined.length);
        const remainder = 100 - weightPerStock * combined.length;
        picksToDeploy = combined.map((p, idx) => ({
          ...p,
          weightPct: idx === 0 ? weightPerStock + remainder : weightPerStock,
        }));
      }
    }

    return picksToDeploy.map((p) => {
      const gem = data?.clusterGems.find((g) => g.symbol === p.symbol);
      const port = data?.portfolioActions.find((a) => a.symbol === p.symbol);
      const liveCmp = port?.ltp ?? gem?.ltp ?? p.cmp;
      const cmp = liveCmp > 0 ? liveCmp : p.cmp;
      const anchorPrice = gem?.anchor_price ?? p.cmp;
      const pctMove = gem?.pct_move ?? (anchorPrice > 0 ? ((cmp - anchorPrice) / anchorPrice) * 100 : 0);
      const isPortfolio = Boolean(port && port.total_qty > 0) || Boolean(gem?.is_portfolio);
      const heldQty = port?.total_qty ?? 0;
      const callDate = gem?.generated_at ?? "2026-10-31";
      const actionToday = port?.action_today ?? (isPortfolio ? "HOLD & COMPOUND" : "ACCUMULATE / ADD");

      const override = userCallOverrides[p.symbol];
      const isTaken = override ? override.is_taken : Boolean(port && port.total_qty > 0) || Boolean(gem?.is_taken);
      const isCleared = override ? override.is_cleared : Boolean(gem?.is_cleared);
      const boxStyle = getCallBoxStyle(isTaken, isCleared, pctMove);

      const allocatedAmount = Math.round((capital * p.weightPct) / 100);
      const totalShares = Math.floor(allocatedAmount / cmp);
      const tranche1Shares = Math.ceil(totalShares / 2);
      const tranche2Shares = Math.max(0, totalShares - tranche1Shares);
      const t1Value = tranche1Shares * cmp;
      const t2Value = tranche2Shares * cmp;
      const projectedValue = Math.round(totalShares * p.target);
      const profitRupees = projectedValue - allocatedAmount;

      return {
        ...p,
        cmp,
        anchorPrice,
        pctMove,
        isPortfolio,
        heldQty,
        callDate,
        actionToday,
        isTaken,
        isCleared,
        boxStyle,
        allocatedAmount,
        totalShares,
        tranche1Shares,
        tranche2Shares,
        t1Value,
        t2Value,
        projectedValue,
        profitRupees,
      };
    });
  }, [capital, avoidOwned, data, userCallOverrides]);

  const totalProjectedProfit = useMemo(() => {
    return curatedPlan.reduce((acc, p) => acc + p.profitRupees, 0);
  }, [curatedPlan]);

  const blendedUpside = useMemo(() => {
    if (capital <= 0) return 0;
    return (totalProjectedProfit / capital) * 100;
  }, [totalProjectedProfit, capital]);

  const clusters = useMemo(() => {
    if (!data) return [];
    const list = new Set<string>();
    if (activeTab === "gems") {
      data.clusterGems.forEach((g) => { if (g.cluster_name) list.add(g.cluster_name); });
    } else {
      data.portfolioActions.forEach((p) => { if (p.cluster_name) list.add(p.cluster_name); });
    }
    return ["ALL", ...Array.from(list).sort()];
  }, [data, activeTab]);

  const filteredPortfolio = useMemo(() => {
    if (!data) return [];
    const list = data.portfolioActions.filter((p) => {
      if (selectedHorizon !== "ALL" && p.horizon !== selectedHorizon) return false;
      if (search) {
        const q = search.toLowerCase();
        const matchSym = p.symbol.toLowerCase().includes(q);
        const matchName = p.company_name?.toLowerCase().includes(q);
        if (!matchSym && !matchName) return false;
      }
      if (selectedCluster !== "ALL" && p.cluster_name !== selectedCluster) return false;
      if (actionFilter !== "ALL" && !p.action_today.includes(actionFilter)) return false;
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === "date_desc") {
        return new Date(b.generated_at ?? 0).getTime() - new Date(a.generated_at ?? 0).getTime();
      }
      if (sortBy === "date_asc") {
        return new Date(a.generated_at ?? 0).getTime() - new Date(b.generated_at ?? 0).getTime();
      }
      if (sortBy === "perf_desc") {
        return (b.pct_move ?? b.pnl_pct ?? 0) - (a.pct_move ?? a.pnl_pct ?? 0);
      }
      if (sortBy === "upside_desc") {
        return (b.upside_pct ?? 0) - (a.upside_pct ?? 0);
      }
      if (sortBy === "comp_desc") {
        return (b.composite_pct ?? 0) - (a.composite_pct ?? 0);
      }
      return 0;
    });

    return list;
  }, [data, search, selectedCluster, actionFilter, selectedHorizon, sortBy]);

  const filteredGems = useMemo(() => {
    if (!data) return [];
    const list = data.clusterGems.filter((g) => {
      const override = userCallOverrides[g.symbol];
      const isTaken = override ? override.is_taken : g.is_taken;
      const isCleared = override ? override.is_cleared : g.is_cleared;

      if (avoidOwned && g.is_portfolio) return false;
      if (gemsOnly && !g.is_gem) return false;
      if (selectedHorizon !== "ALL" && g.horizon !== selectedHorizon) return false;

      if (selectedStatus === "taken" && !isTaken) return false;
      if (selectedStatus === "profit" && !(isTaken && (g.pct_move ?? 0) > 0.5)) return false;
      if (selectedStatus === "loss" && !(isTaken && (g.pct_move ?? 0) < -0.5)) return false;
      if (selectedStatus === "exited" && !isCleared) return false;
      if (selectedStatus === "fresh" && (isTaken || isCleared)) return false;

      if (search) {
        const q = search.toLowerCase();
        const matchSym = g.symbol.toLowerCase().includes(q);
        const matchName = g.company_name?.toLowerCase().includes(q);
        if (!matchSym && !matchName) return false;
      }
      if (selectedCluster !== "ALL" && g.cluster_name !== selectedCluster) return false;
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === "date_desc") {
        return new Date(b.generated_at ?? 0).getTime() - new Date(a.generated_at ?? 0).getTime();
      }
      if (sortBy === "date_asc") {
        return new Date(a.generated_at ?? 0).getTime() - new Date(b.generated_at ?? 0).getTime();
      }
      if (sortBy === "perf_desc") {
        return (b.pct_move ?? 0) - (a.pct_move ?? 0);
      }
      if (sortBy === "upside_desc") {
        return (b.upside_pct ?? 0) - (a.upside_pct ?? 0);
      }
      if (sortBy === "comp_desc") {
        return (b.composite_pct ?? 0) - (a.composite_pct ?? 0);
      }
      return 0;
    });

    return list;
  }, [data, search, selectedCluster, gemsOnly, sortBy, avoidOwned, selectedHorizon, selectedStatus, userCallOverrides]);

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Institutional Calls &amp; Capital Allocation Desk
            </h1>
            <span className="px-2 py-0.5 rounded text-[10.5px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              ACTIONABLE CALLS
            </span>
          </div>
          <p className="text-[12.5px] text-slate-500 mt-0.5">
            Active capital deployment plan, exact share sizing, entry tranches, date-wise history, and live performance.
          </p>
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors"
        >
          {loading ? "Refreshing…" : "Refresh Calls"}
        </button>
      </div>

      {/* Primary Navigation Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("plan")}
            className={`px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-all flex items-center gap-1.5 ${
              activeTab === "plan"
                ? "bg-indigo-700 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            <span>₹1 Lakh Deployment Plan</span>
          </button>

          <button
            onClick={() => { setActiveTab("portfolio"); setActionFilter("ALL"); }}
            className={`px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-all flex items-center gap-1.5 ${
              activeTab === "portfolio"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>Portfolio Sweep ({data?.summary?.portfolioTotalCount ?? 0})</span>
          </button>

          <button
            onClick={() => { setActiveTab("gems"); setActionFilter("ALL"); }}
            className={`px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-all flex items-center gap-1.5 ${
              activeTab === "gems"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Cluster Gems &amp; Calls ({data?.summary?.totalClusterCalls ?? 0})</span>
          </button>
        </div>

        {/* Search, Cluster Selector & Date-wise Sort Controls */}
        {activeTab !== "plan" && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Sort Selector */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-300 rounded-md px-2 py-0.5">
              <ArrowDownUp className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="text-[12px] bg-transparent text-slate-800 font-medium focus:outline-none cursor-pointer"
              >
                <option value="date_desc">📅 Date Called (Newest First)</option>
                <option value="date_asc">📅 Date Called (Oldest First)</option>
                <option value="perf_desc">📈 Performance Since Call</option>
                <option value="upside_desc">🎯 12M Forward Upside</option>
                <option value="comp_desc">⭐ Composite Score</option>
              </select>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search symbol..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1 text-[12px] rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 w-32 sm:w-44"
              />
            </div>

            <select
              value={selectedCluster}
              onChange={(e) => setSelectedCluster(e.target.value)}
              className="text-[12px] px-2.5 py-1 rounded-md border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400 max-w-[160px]"
            >
              {clusters.map((c) => (
                <option key={c} value={c}>
                  {c === "ALL" ? "All Clusters" : c}
                </option>
              ))}
            </select>

            {activeTab === "portfolio" && (
              <div className="flex items-center gap-1">
                {(["ALL", "TRIM", "HOLD", "ACCUMULATE", "EXIT"] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => setActionFilter(a)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      actionFilter === a
                        ? "bg-slate-800 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}

            {activeTab === "gems" && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setAvoidOwned((o) => !o)}
                  className={`px-2.5 py-1 rounded text-[11.5px] font-medium border transition-colors flex items-center gap-1 ${
                    avoidOwned
                      ? "bg-indigo-600 text-white border-indigo-700 shadow-2xs font-semibold"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                  }`}
                  title="Filter out stocks already present in your portfolio to avoid duplicate purchases"
                >
                  <CheckCircle2 className={`w-3.5 h-3.5 ${avoidOwned ? "text-white" : "text-emerald-500"}`} />
                  <span>{avoidOwned ? "Avoiding Owned (Fresh Only)" : "Avoid Already Owned"}</span>
                </button>

                <button
                  onClick={() => setGemsOnly((o) => !o)}
                  className={`px-2.5 py-1 rounded text-[11.5px] font-medium border transition-colors flex items-center gap-1 ${
                    gemsOnly
                      ? "bg-amber-50 text-amber-800 border-amber-300"
                      : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  <span>Gems Only</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Horizon Strategy & Call Status Filter Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 py-2 px-3 rounded-lg border border-slate-200 bg-slate-50/70 text-[11.5px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wide mr-1">
            Idea Horizon:
          </span>
          {[
            { id: "ALL", label: `All Horizons (${data?.clusterGems.length ?? 0})` },
            { id: "1M", label: `⚡ 1M Tactical (${data?.summary?.horizonCounts?.["1M"] ?? 0})` },
            { id: "3M", label: `🚀 3M Catalyst (${data?.summary?.horizonCounts?.["3M"] ?? 0})` },
            { id: "6M", label: `📈 6M Turnaround (${data?.summary?.horizonCounts?.["6M"] ?? 0})` },
            { id: "1Y", label: `🏛️ 1Y Core (${data?.summary?.horizonCounts?.["1Y"] ?? 0})` },
            { id: ">1Y", label: `💎 >1Y Compounder (${data?.summary?.horizonCounts?.[">1Y"] ?? 0})` },
            { id: "EXIT", label: `🛑 Exit Ideas (${data?.summary?.horizonCounts?.["EXIT"] ?? 0})` },
          ].map((h) => (
            <button
              key={h.id}
              onClick={() => setSelectedHorizon(h.id)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all ${
                selectedHorizon === h.id
                  ? "bg-slate-900 text-white shadow-xs font-bold"
                  : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>

        {activeTab === "gems" && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wide mr-1">
              Call Status:
            </span>
            {[
              { id: "ALL", label: "All" },
              { id: "taken", label: "🟦 Taken" },
              { id: "profit", label: "🟩 In Profit" },
              { id: "loss", label: "🟥 In Loss" },
              { id: "exited", label: "⬛ Exited" },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedStatus(s.id)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                  selectedStatus === s.id
                    ? "bg-indigo-700 text-white shadow-xs font-bold"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div className="h-64 rounded-lg border border-slate-200 bg-[var(--color-paper)] flex items-center justify-center text-[13px] text-slate-500">
          Calculating institutional capital allocation models and loading portfolio...
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-[13px] text-rose-800">
          {error}
        </div>
      )}

      {/* TAB 1: 1 LAKH MONTHLY DEPLOYMENT PLAN */}
      {!loading && !error && activeTab === "plan" && (
        <div className="space-y-5">
          {/* Capital Slider / Selector Card */}
          <div className="rounded-lg border border-indigo-200/80 bg-gradient-to-r from-indigo-50/60 via-white to-slate-50 p-4 shadow-2xs">
            <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-indigo-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">
                  ₹
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
                    Monthly Fresh Capital Deployment Calculator
                  </div>
                  <div className="text-base font-bold text-slate-900">
                    Deploying {money(capital)} across 6 Diversified Institutional Alpha Calls
                  </div>
                </div>
              </div>

              {/* Capital Preset Buttons & Mode Toggle */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center bg-white rounded-md border border-slate-300 p-0.5 text-[11px]">
                  <button
                    onClick={() => setAvoidOwned(false)}
                    className={`px-2.5 py-1 rounded transition-colors font-medium ${
                      !avoidOwned
                        ? "bg-indigo-600 text-white shadow-2xs font-bold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Foundation Barbell (6 Core)
                  </button>
                  <button
                    onClick={() => setAvoidOwned(true)}
                    className={`px-2.5 py-1 rounded transition-colors font-medium flex items-center gap-1 ${
                      avoidOwned
                        ? "bg-indigo-600 text-white shadow-2xs font-bold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Avoid Already Owned (Fresh Only)</span>
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  {[50000, 100000, 200000, 500000].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setCapital(amt)}
                      className={`px-2.5 py-1 rounded text-[11.5px] font-mono font-medium transition-all ${
                        capital === amt
                          ? "bg-slate-900 text-white shadow-xs font-bold"
                          : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-100"
                      }`}
                    >
                      {amt >= 100000 ? `₹${amt / 100000}L` : `₹${amt / 1000}k`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* KPI Summary of the Plan */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3.5">
              <div className="rounded-md border border-slate-200 bg-white p-2.5 shadow-2xs">
                <div className="text-[10px] uppercase font-medium text-slate-400">Total Deployment</div>
                <div className="text-[17px] font-mono font-bold text-slate-900 mt-0.5">
                  {money(capital)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">6 Diversified Tranches</div>
              </div>

              <div className="rounded-md border border-emerald-200 bg-emerald-50/30 p-2.5 shadow-2xs">
                <div className="text-[10px] uppercase font-medium text-emerald-800">Tranche 1 (Buy Today)</div>
                <div className="text-[17px] font-mono font-bold text-emerald-700 mt-0.5">
                  {money(capital / 2)}
                </div>
                <div className="text-[10px] text-emerald-600 mt-0.5">50% market entry at CMP</div>
              </div>

              <div className="rounded-md border border-blue-200 bg-blue-50/30 p-2.5 shadow-2xs">
                <div className="text-[10px] uppercase font-medium text-blue-800">Tranche 2 (Pullback Limit)</div>
                <div className="text-[17px] font-mono font-bold text-blue-700 mt-0.5">
                  {money(capital / 2)}
                </div>
                <div className="text-[10px] text-blue-600 mt-0.5">50% GTT orders at Buy Below</div>
              </div>

              <div className="rounded-md border border-indigo-200 bg-indigo-50/30 p-2.5 shadow-2xs">
                <div className="text-[10px] uppercase font-medium text-indigo-800">Projected 12M Return</div>
                <div className="text-[17px] font-mono font-bold text-indigo-700 mt-0.5">
                  +{money(totalProjectedProfit)} ({pct(blendedUpside)})
                </div>
                <div className="text-[10px] text-indigo-600 mt-0.5">Target Value: {money(capital + totalProjectedProfit)}</div>
              </div>
            </div>
          </div>

          {/* Actionable Call Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {curatedPlan.map((c) => (
              <div
                key={c.symbol}
                className={`rounded-lg p-4 shadow-2xs transition-all flex flex-col justify-between border ${c.boxStyle.cardClass}`}
              >
                <div>
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100 flex-wrap gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link
                          href={`/stock/${c.symbol}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-base font-bold text-slate-900 hover:text-indigo-600 flex items-center gap-1"
                          title="Open stock details in new window"
                        >
                          <span>{c.symbol}</span>
                          <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                        </Link>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${getHorizonBadge(c.horizon)}`}>
                          {c.horizonLabel}
                        </span>
                        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {c.weightPct}% ({money(c.allocatedAmount)})
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {c.name} · <span className="font-medium text-slate-600">{c.cluster}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10.5px] border ${c.boxStyle.badgeClass}`}>
                        {c.boxStyle.badgeText}
                      </span>
                      {!c.isTaken && !c.isCleared && (
                        <button
                          onClick={() => handleTakeCall(c.symbol)}
                          className="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-2xs transition-colors"
                          title="Take this call"
                        >
                          + Take
                        </button>
                      )}
                      {c.isTaken && (
                        <button
                          onClick={() => handleExitCall(c.symbol)}
                          className="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-slate-600 hover:bg-slate-700 text-white shadow-2xs transition-colors"
                          title="Exit this call"
                        >
                          Exit
                        </button>
                      )}
                      {c.isCleared && (
                        <button
                          onClick={() => handleTakeCall(c.symbol)}
                          className="px-2 py-0.5 rounded text-[10.5px] font-medium bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors"
                          title="Re-open this call"
                        >
                          Re-take
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Provenance, Call Performance & Holding Status */}
                  <div className="flex items-center justify-between text-[11px] bg-slate-50 border border-slate-200/80 rounded px-2.5 py-1.5 mb-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-slate-500 font-mono text-[10.5px]">
                        Call: {fmtDate(c.callDate)} @ {money(c.anchorPrice)}
                      </span>
                      {c.pctMove != null && (
                        <span className={`font-mono font-bold text-[10.5px] px-1.5 py-0.2 rounded border ${
                          c.pctMove >= 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"
                        }`}>
                          {pct(c.pctMove)}
                        </span>
                      )}
                    </div>

                    <div>
                      {c.isPortfolio ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300">
                          HELD ({c.heldQty} sh)
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                          FRESH CANDIDATE
                        </span>
                      )}
                    </div>
                  </div>

                  {c.isPortfolio && (
                    <div className="text-[10.5px] text-amber-900 bg-amber-50/80 border border-amber-200 rounded p-2 mb-2.5 leading-snug">
                      ⚠️ <strong>Already in your portfolio.</strong> Do not buy as a new stock every week. Rule: <strong>{c.actionToday}</strong> toward {money(c.target)} target. Only add if price pulls back to Limit Dip (≤ {money(c.buyBelow)}).
                    </div>
                  )}

                  {/* Sizing & Execution Box */}
                  <div className="bg-slate-50/70 rounded-md border border-slate-200/80 p-3 mb-3">
                    <div className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide mb-2 flex items-center justify-between">
                      <span>Execution Blueprint</span>
                      <span className="text-indigo-700 font-bold font-mono">Total: {c.totalShares} Shares</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                      <div className="bg-white rounded border border-slate-200 p-2">
                        <div className="text-[10px] text-emerald-700 font-semibold uppercase">Tranche 1 (Today)</div>
                        <div className="font-mono font-bold text-slate-900 mt-0.5">
                          Buy {c.tranche1Shares} @ {money(c.cmp)}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Cost: {money(c.t1Value)}</div>
                      </div>

                      <div className="bg-white rounded border border-slate-200 p-2">
                        <div className="text-[10px] text-blue-700 font-semibold uppercase">Tranche 2 (Limit Dip)</div>
                        <div className="font-mono font-bold text-slate-900 mt-0.5">
                          Limit {c.tranche2Shares} @ ≤ {money(c.buyBelow)}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Cost: {money(c.t2Value)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Price Boundaries Strip */}
                  <div className="grid grid-cols-3 gap-2 text-[11px] mb-3">
                    <div className="rounded border border-slate-200 p-2 bg-white">
                      <div className="text-slate-400 font-medium text-[9.5px] uppercase">CMP / Entry</div>
                      <div className="font-mono font-bold text-slate-900 mt-0.5">{money(c.cmp)}</div>
                      <div className="text-[9.5px] text-emerald-700 font-medium mt-0.5">Buy ≤ {money(c.buyBelow)}</div>
                    </div>

                    <div className="rounded border border-indigo-200 p-2 bg-indigo-50/20">
                      <div className="text-indigo-600 font-medium text-[9.5px] uppercase">{c.timeline} Target</div>
                      <div className="font-mono font-bold text-indigo-700 mt-0.5">{money(c.target)}</div>
                      <div className="text-[9.5px] text-indigo-700 font-bold mt-0.5">+{c.upside}% ({money(c.profitRupees)})</div>
                    </div>

                    <div className="rounded border border-rose-200 p-2 bg-rose-50/20">
                      <div className="text-rose-600 font-medium text-[9.5px] uppercase">Hard Stop-Loss</div>
                      <div className="font-mono font-bold text-rose-700 mt-0.5">{money(c.stopLoss)}</div>
                      <div className="text-[9.5px] text-rose-600 font-medium mt-0.5">Floor</div>
                    </div>
                  </div>

                  <p className="text-[11.5px] text-slate-600 leading-relaxed">
                    <strong>Institutional Thesis:</strong> {c.rationale}
                  </p>
                </div>

                <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 font-medium">Role: <span className="text-slate-700">{c.role}</span></span>
                  <Link
                    href={`/admin/verdicts?symbol=${c.symbol}&scope=all`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                  >
                    <span>Verdict</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Funding Strategy Note */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-[12px] text-slate-700 leading-relaxed">
            <div className="font-semibold text-slate-900 mb-1 flex items-center gap-1.5">
              <span>💡</span>
              <span>Where to source this {money(capital)}: Self-Funded via Portfolio Trims</span>
            </div>
            <p>
              You don&apos;t necessarily need new outside cash for this deployment. Trimming your overextended holdings identified in today&apos;s sweep easily generates more than enough liquidity:
            </p>
            <ul className="list-disc pl-5 mt-1.5 space-y-0.5 text-slate-600">
              <li><strong>`PAYTM`</strong> (+79% gain): Sell 4 shares to unlock <strong>~₹6,645</strong>.</li>
              <li><strong>`FEDERALBNK`</strong> (+37% gain, target exceeded): Trim 35 shares to unlock <strong>~₹12,173</strong>.</li>
              <li><strong>`ABCAPITAL`</strong> (stretched multiple): Trim 13 shares to unlock <strong>~₹4,771</strong>.</li>
              <li><strong>`GODFRYPHLP`</strong> (+26% gain): Trim 3 shares to unlock <strong>~₹5,184</strong>.</li>
              <li><strong>`JSWENERGY` / `SUBROS`</strong> (deteriorating momentum): Exiting unlocks <strong>~₹9,170</strong>.</li>
            </ul>
          </div>

          {/* Institutional Portfolio Discipline & Anti-Churn Rule */}
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4 text-[12px] text-amber-950 leading-relaxed shadow-2xs">
            <div className="font-bold text-amber-900 mb-1 flex items-center gap-1.5 text-[12.5px]">
              <ShieldCheck className="w-4 h-4 text-amber-700" />
              <span>Institutional Rule: Why We Avoid Buying New Stocks Every Week</span>
            </div>
            <p className="text-amber-900/90">
              High-performing institutional portfolios maintain <strong>15 to 20 high-conviction positions</strong>, never 50+ fragmented bets.
            </p>
            <ul className="list-disc pl-5 mt-1.5 space-y-1 text-amber-900/80">
              <li>
                <strong>Once Recommended → Stays in HOLD &amp; COMPOUND:</strong> When you buy a stock called by the desk (e.g. <code>INDUSTOWER</code> or <code>BHARTIARTL</code>), it enters your portfolio. You do not buy it as a &ldquo;new stock&rdquo; next week. It remains in compound mode until it hits its 12M target price or stop-loss.
              </li>
              <li>
                <strong>Avoid Portfolio Bloat:</strong> If you buy 6 new stocks every week, you would hold 24 stocks in a month and over 100 stocks in a year. The <strong>&ldquo;Avoid Already Owned&rdquo;</strong> filter ensures you only evaluate fresh ideas when you actually have new capital to deploy.
              </li>
              <li>
                <strong>Cycle Capital via Trims:</strong> Only add new stocks when existing positions reach their 12M targets (e.g., trimming Federal Bank or Paytm) or when deploying scheduled fresh monthly savings.
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* TAB 2: PORTFOLIO SWEEP VIEW */}
      {!loading && !error && activeTab === "portfolio" && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3">Call Date</th>
                  <th className="py-2.5 px-3">Stock &amp; Cluster</th>
                  <th className="py-2.5 px-3">Action &amp; Horizon</th>
                  <th className="py-2.5 px-3">Call Status</th>
                  <th className="py-2.5 px-3 text-right">Holdings</th>
                  <th className="py-2.5 px-3 text-right">CMP / LTP</th>
                  <th className="py-2.5 px-3 text-right">Since Call (Perf)</th>
                  <th className="py-2.5 px-3 text-right">Buy Below</th>
                  <th className="py-2.5 px-3 text-right">Target &amp; Horizon</th>
                  <th className="py-2.5 px-3 text-right">Upside</th>
                  <th className="py-2.5 px-3 text-center">Score (C/Q/M)</th>
                  <th className="py-2.5 px-3">Action Rationale &amp; Sell Timeline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPortfolio.map((p) => {
                  const isTrim = p.action_today.includes("TRIM");
                  const isAccumulate = p.action_today.includes("ACCUMULATE");
                  const isExit = p.action_today.includes("EXIT");

                  const actionBadge = isTrim
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : isAccumulate
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : isExit
                        ? "bg-rose-50 text-rose-800 border-rose-200"
                        : "bg-blue-50 text-blue-800 border-blue-200";

                  const override = userCallOverrides[p.symbol];
                  const isTaken = override ? override.is_taken : (p.is_taken ?? true);
                  const isCleared = override ? override.is_cleared : (p.is_cleared ?? false);
                  const perfMove = p.pct_move != null ? p.pct_move : p.pnl_pct;
                  const boxStyle = getCallBoxStyle(isTaken, isCleared, perfMove);

                  return (
                    <tr key={p.symbol} className={`transition-colors ${boxStyle.rowClass}`}>
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                        {fmtDate(p.generated_at)}
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Link
                            href={`/stock/${p.symbol}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold text-slate-900 hover:text-indigo-600 transition-colors flex items-center gap-1"
                            title="Open stock chart & fundamentals in new window"
                          >
                            <span>{p.symbol}</span>
                            <ExternalLink className="w-3 h-3 text-slate-400" />
                          </Link>
                          <Link
                            href={`/admin/verdicts?symbol=${p.symbol}&scope=all`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold flex items-center"
                            title="View institutional verdict in new window"
                          >
                            <span>Verdict</span>
                            <ArrowUpRight className="w-2.5 h-2.5" />
                          </Link>
                        </div>
                        <div className="text-[10.5px] text-slate-500 truncate max-w-[140px]">
                          {p.cluster_name}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-start">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10.5px] font-semibold border ${actionBadge}`}>
                            {p.action_today}
                          </span>
                          <span className={`inline-block px-1.5 py-0.2 rounded text-[9.5px] font-bold border ${getHorizonBadge(p.horizon)}`}>
                            {p.horizon_label || p.horizon}
                          </span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10.5px] border ${boxStyle.badgeClass}`}>
                            {boxStyle.badgeText}
                          </span>
                          {isTaken && (
                            <button
                              onClick={() => handleExitCall(p.symbol)}
                              className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-600 hover:bg-slate-700 text-white transition-colors"
                              title="Mark call as exited"
                            >
                              Exit
                            </button>
                          )}
                          {isCleared && (
                            <button
                              onClick={() => handleTakeCall(p.symbol)}
                              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors"
                              title="Re-open call"
                            >
                              Re-take
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="font-mono text-slate-800 font-medium">
                          {p.total_qty} @ {money(p.weighted_avg_cost)}
                        </div>
                        <div className={`text-[10.5px] font-mono font-medium ${p.pnl_pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          PnL: {pct(p.pnl_pct)}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {money(p.ltp)}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {p.pct_move != null ? (
                          <div className={`font-mono font-bold text-[11.5px] ${p.pct_move >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {pct(p.pct_move)}
                            <div className="text-[9.5px] text-slate-400 font-normal">from {money(p.anchor_price)}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono text-emerald-700 whitespace-nowrap">
                        {money(p.buy_below)}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="font-mono font-semibold text-indigo-700">
                          {money(p.target_price)}
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium">
                          {p.sell_timeline || "Target"}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <span className={`font-mono font-bold ${
                          (p.upside_pct ?? 0) >= 15 ? "text-emerald-700" : (p.upside_pct ?? 0) >= 0 ? "text-blue-700" : "text-rose-700"
                        }`}>
                          {pct(p.upside_pct)}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span className="font-mono text-[11px] text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                          {p.composite_pct ?? "—"} / {p.quality_pct ?? "—"} / {p.momentum_pct ?? "—"}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 max-w-[260px]">
                        <div className="text-[11.5px] text-slate-700 leading-snug">
                          {p.action_reason}
                        </div>
                        <div className="text-[10.5px] text-slate-400 mt-0.5 flex items-center gap-1 font-mono">
                          <span>Horizon: {p.sell_timeline}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CLUSTER GEMS & CALLS VIEW */}
      {!loading && !error && activeTab === "gems" && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3">Call Date</th>
                  <th className="py-2.5 px-3">Stock &amp; Cluster</th>
                  <th className="py-2.5 px-3">Call Status</th>
                  <th className="py-2.5 px-3 text-right">CMP / LTP</th>
                  <th className="py-2.5 px-3 text-right">Since Call (Perf)</th>
                  <th className="py-2.5 px-3 text-right">Accumulate Below</th>
                  <th className="py-2.5 px-3 text-right">Target &amp; Horizon</th>
                  <th className="py-2.5 px-3 text-right">Upside</th>
                  <th className="py-2.5 px-3 text-right">Bear Floor</th>
                  <th className="py-2.5 px-3 text-center">Scores (C/Q/M/V)</th>
                  <th className="py-2.5 px-3">Horizon Strategy &amp; Model</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredGems.map((g) => {
                  const override = userCallOverrides[g.symbol];
                  const isTaken = override ? override.is_taken : g.is_taken;
                  const isCleared = override ? override.is_cleared : g.is_cleared;
                  const boxStyle = getCallBoxStyle(isTaken, isCleared, g.pct_move);

                  return (
                    <tr key={g.symbol} className={`transition-colors ${boxStyle.rowClass}`}>
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                        {fmtDate(g.generated_at)}
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Link
                            href={`/stock/${g.symbol}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold text-slate-900 hover:text-indigo-600 transition-colors flex items-center gap-1"
                            title="Open stock chart & fundamentals in new window"
                          >
                            <span>{g.symbol}</span>
                            <ExternalLink className="w-3 h-3 text-slate-400" />
                          </Link>
                          <Link
                            href={`/admin/verdicts?symbol=${g.symbol}&scope=all`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold flex items-center"
                            title="View institutional verdict in new window"
                          >
                            <span>Verdict</span>
                            <ArrowUpRight className="w-2.5 h-2.5" />
                          </Link>
                          {g.is_portfolio && (
                            <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                              HELD
                            </span>
                          )}
                          {g.is_gem && (
                            <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-0.5">
                              <Sparkles className="w-2.5 h-2.5 text-amber-500" /> GEM
                            </span>
                          )}
                        </div>
                        <div className="text-[10.5px] text-slate-500 truncate max-w-[150px]">
                          {g.cluster_name} {g.market_cap_cr ? `· ₹${Math.round(g.market_cap_cr).toLocaleString("en-IN")} Cr` : ""}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10.5px] border ${boxStyle.badgeClass}`}>
                            {boxStyle.badgeText}
                          </span>
                          {!isTaken && !isCleared && (
                            <button
                              onClick={() => handleTakeCall(g.symbol)}
                              className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                              title="Take this call"
                            >
                              + Take
                            </button>
                          )}
                          {isTaken && (
                            <button
                              onClick={() => handleExitCall(g.symbol)}
                              className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-600 hover:bg-slate-700 text-white transition-colors"
                              title="Exit call"
                            >
                              Exit
                            </button>
                          )}
                          {isCleared && (
                            <button
                              onClick={() => handleTakeCall(g.symbol)}
                              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors"
                              title="Re-open call"
                            >
                              Re-take
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {money(g.ltp)}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {g.pct_move != null ? (
                          <div className={`font-mono font-bold text-[11.5px] ${g.pct_move >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {pct(g.pct_move)}
                            <div className="text-[9.5px] text-slate-400 font-normal">from {money(g.anchor_price)}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                        {money(g.buy_below)}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="font-mono font-bold text-indigo-700">
                          {money(g.target_price)}
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium">
                          {g.sell_timeline || "Target"}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <span className={`font-mono font-bold ${
                          (g.upside_pct ?? 0) >= 30 ? "text-emerald-700" : "text-blue-700"
                        }`}>
                          {pct(g.upside_pct)}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono text-rose-700 whitespace-nowrap">
                        {money(g.bear_floor)}
                      </td>

                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span className="font-mono text-[11px] text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                          {g.composite_pct ?? "—"} / {g.quality_pct ?? "—"} / {g.momentum_pct ?? "—"} / {g.valuation_pct ?? "—"}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 max-w-[220px]">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${getHorizonBadge(g.horizon)}`}>
                            {g.horizon_label}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-700 leading-snug">
                          {g.strategy_desc}
                        </div>
                        <div className="text-[10px] text-slate-400 capitalize truncate mt-0.5 font-mono">
                          Model: {g.valuation_method ? g.valuation_method.replace(/_/g, " ") : "Multi-Model"}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
