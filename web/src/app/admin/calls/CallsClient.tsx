"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search, ShieldAlert, Sparkles, TrendingUp, CheckCircle, AlertTriangle, Layers, Wallet } from "lucide-react";
import type { ClusterGem, PortfolioActionCall } from "@/app/api/admin/calls/route";

function money(v: number | null | undefined): string {
  if (v == null) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}`;
}

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

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
    };
    clusterGems: ClusterGem[];
    portfolioActions: PortfolioActionCall[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"portfolio" | "gems">("portfolio");
  const [search, setSearch] = useState("");
  const [selectedCluster, setSelectedCluster] = useState<string>("ALL");
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [gemsOnly, setGemsOnly] = useState(false);

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
    return data.portfolioActions.filter((p) => {
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
  }, [data, search, selectedCluster, actionFilter]);

  const filteredGems = useMemo(() => {
    if (!data) return [];
    return data.clusterGems.filter((g) => {
      if (gemsOnly && !g.is_gem) return false;
      if (search) {
        const q = search.toLowerCase();
        const matchSym = g.symbol.toLowerCase().includes(q);
        const matchName = g.company_name?.toLowerCase().includes(q);
        if (!matchSym && !matchName) return false;
      }
      if (selectedCluster !== "ALL" && g.cluster_name !== selectedCluster) return false;
      return true;
    });
  }, [data, search, selectedCluster, gemsOnly]);

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Institutional Calls &amp; Portfolio Sweep
            </h1>
            <span className="px-2 py-0.5 rounded text-[10.5px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              ADMIN DESK
            </span>
          </div>
          <p className="text-[12.5px] text-slate-500 mt-0.5">
            Institutional cluster-by-cluster conviction calls, actionable accumulation zones, and daily portfolio sweep.
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

      {/* KPI Cards */}
      {data?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="rounded-lg border border-slate-200 bg-[var(--color-paper)] p-3">
            <div className="text-[10px] font-medium uppercase text-slate-500 flex items-center justify-between">
              <span>Cluster Gems</span>
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <div className="text-xl font-mono font-bold text-slate-900 mt-1">
              {data.summary.totalGems}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">In Accumulate Zone</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-[var(--color-paper)] p-3">
            <div className="text-[10px] font-medium uppercase text-slate-500 flex items-center justify-between">
              <span>Portfolio Positions</span>
              <Wallet className="w-3.5 h-3.5 text-blue-500" />
            </div>
            <div className="text-xl font-mono font-bold text-slate-900 mt-1">
              {data.summary.portfolioTotalCount}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Active tracked holdings</div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
            <div className="text-[10px] font-medium uppercase text-emerald-800 flex items-center justify-between">
              <span>Add / Accumulate</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="text-xl font-mono font-bold text-emerald-800 mt-1">
              {data.summary.portfolioAccumulateCount}
            </div>
            <div className="text-[10px] text-emerald-700 mt-0.5">High Conviction Dips</div>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
            <div className="text-[10px] font-medium uppercase text-blue-800 flex items-center justify-between">
              <span>Hold &amp; Compound</span>
              <CheckCircle className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="text-xl font-mono font-bold text-blue-800 mt-1">
              {data.summary.portfolioHoldCount}
            </div>
            <div className="text-[10px] text-blue-700 mt-0.5">Ride toward 12M target</div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
            <div className="text-[10px] font-medium uppercase text-amber-800 flex items-center justify-between">
              <span>Trim / Take Profit</span>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <div className="text-xl font-mono font-bold text-amber-800 mt-1">
              {data.summary.portfolioTrimCount}
            </div>
            <div className="text-[10px] text-amber-700 mt-0.5">Target reached / stretched</div>
          </div>

          <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-3">
            <div className="text-[10px] font-medium uppercase text-rose-800 flex items-center justify-between">
              <span>Exit / Cut Loss</span>
              <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
            </div>
            <div className="text-xl font-mono font-bold text-rose-800 mt-1">
              {data.summary.portfolioExitCount}
            </div>
            <div className="text-[10px] text-rose-700 mt-0.5">Stop-loss / thesis broken</div>
          </div>
        </div>
      )}

      {/* Main Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
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

        {/* Search & Cluster Selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search symbol..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1 text-[12px] rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 w-36 sm:w-48"
            />
          </div>

          <select
            value={selectedCluster}
            onChange={(e) => setSelectedCluster(e.target.value)}
            className="text-[12px] px-2.5 py-1 rounded-md border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400 max-w-[200px]"
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
          )}
        </div>
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div className="h-64 rounded-lg border border-slate-200 bg-[var(--color-paper)] flex items-center justify-center text-[13px] text-slate-500">
          Scanning universe across clusters and sweeping portfolio...
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-[13px] text-rose-800">
          {error}
        </div>
      )}

      {/* PORTFOLIO SWEEP VIEW */}
      {!loading && !error && activeTab === "portfolio" && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3">Stock &amp; Cluster</th>
                  <th className="py-2.5 px-3">Action Today</th>
                  <th className="py-2.5 px-3 text-right">Holdings</th>
                  <th className="py-2.5 px-3 text-right">CMP / LTP</th>
                  <th className="py-2.5 px-3 text-right">Buy Below</th>
                  <th className="py-2.5 px-3 text-right">12M Target</th>
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

                  return (
                    <tr key={p.symbol} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/admin/verdicts?symbol=${p.symbol}&scope=all`}
                            className="font-bold text-slate-900 hover:text-indigo-600 transition-colors flex items-center gap-0.5"
                          >
                            <span>{p.symbol}</span>
                            <ArrowUpRight className="w-3 h-3 text-slate-400" />
                          </Link>
                        </div>
                        <div className="text-[10.5px] text-slate-500 truncate max-w-[150px]">
                          {p.cluster_name}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10.5px] font-semibold border ${actionBadge}`}>
                          {p.action_today}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="font-mono text-slate-800 font-medium">
                          {p.total_qty} @ {money(p.weighted_avg_cost)}
                        </div>
                        <div className={`text-[10.5px] font-mono font-medium ${p.pnl_pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {pct(p.pnl_pct)}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {money(p.ltp)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono text-emerald-700 whitespace-nowrap">
                        {money(p.buy_below)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-indigo-700 whitespace-nowrap">
                        {money(p.target_price)}
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

                      <td className="py-2.5 px-3 max-w-[280px]">
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

      {/* CLUSTER GEMS & CALLS VIEW */}
      {!loading && !error && activeTab === "gems" && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3">Stock &amp; Cluster</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">CMP / LTP</th>
                  <th className="py-2.5 px-3 text-right">Accumulate Below</th>
                  <th className="py-2.5 px-3 text-right">12M Target</th>
                  <th className="py-2.5 px-3 text-right">Upside</th>
                  <th className="py-2.5 px-3 text-right">Bear Floor</th>
                  <th className="py-2.5 px-3 text-center">Scores (C/Q/M/V)</th>
                  <th className="py-2.5 px-3">Investment Horizon &amp; Model</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredGems.map((g) => {
                  const inZone = g.buy_below != null && g.ltp != null && g.ltp <= g.buy_below * 1.05;
                  return (
                    <tr key={g.symbol} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/admin/verdicts?symbol=${g.symbol}&scope=all`}
                            className="font-bold text-slate-900 hover:text-indigo-600 transition-colors flex items-center gap-0.5"
                          >
                            <span>{g.symbol}</span>
                            <ArrowUpRight className="w-3 h-3 text-slate-400" />
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
                        <div className="text-[10.5px] text-slate-500 truncate max-w-[160px]">
                          {g.cluster_name} {g.market_cap_cr ? `· ₹${Math.round(g.market_cap_cr).toLocaleString("en-IN")} Cr` : ""}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10.5px] font-semibold border ${
                          inZone
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                            : "bg-blue-50 text-blue-800 border-blue-200"
                        }`}>
                          {inZone ? "BUY / ACCUMULATE" : "HOLD / WATCH"}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {money(g.ltp)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                        {money(g.buy_below)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-bold text-indigo-700 whitespace-nowrap">
                        {money(g.target_price)}
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

                      <td className="py-2.5 px-3 max-w-[240px]">
                        <div className="text-[11.5px] text-slate-800 font-medium">
                          {g.sell_timeline}
                        </div>
                        <div className="text-[10px] text-slate-500 capitalize truncate mt-0.5">
                          {g.valuation_method ? g.valuation_method.replace(/_/g, " ") : "Multi-Model"}
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
