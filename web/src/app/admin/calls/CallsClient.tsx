"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search, ShieldAlert, Sparkles, TrendingUp, CheckCircle, AlertTriangle, Wallet, Calculator, Coins, ArrowRight } from "lucide-react";
import type { ClusterGem, PortfolioActionCall } from "@/app/api/admin/calls/route";

function money(v: number | null | undefined): string {
  if (v == null) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}`;
}

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

type CallTab = "plan" | "portfolio" | "gems";

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

  const [activeTab, setActiveTab] = useState<CallTab>("plan");
  const [capital, setCapital] = useState<number>(100000);
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

  // Top 4 curated deployment calls
  const curatedPlan = useMemo(() => {
    const picks = [
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
        role: "Alpha FCF Compounder",
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
        role: "Core Monopoly Bedrock",
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
        role: "Banking Growth Anchor",
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
        role: "Defensive High-Margin",
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
        role: "B2B Tech Alpha",
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
        role: "Asset Re-rating Turnaround",
        rationale: "M&A and capacity expansion catalyst; trading at steep discount to replacement plant value.",
      },
    ];

    return picks.map((p) => {
      const allocatedAmount = Math.round((capital * p.weightPct) / 100);
      const totalShares = Math.floor(allocatedAmount / p.cmp);
      const tranche1Shares = Math.ceil(totalShares / 2);
      const tranche2Shares = totalShares - tranche1Shares;
      const t1Value = tranche1Shares * p.cmp;
      const t2Value = tranche2Shares * p.cmp;
      const projectedValue = Math.round(totalShares * p.target);
      const profitRupees = projectedValue - allocatedAmount;

      return {
        ...p,
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
  }, [capital]);

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
              Institutional Calls &amp; Capital Allocation Desk
            </h1>
            <span className="px-2 py-0.5 rounded text-[10.5px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              ACTIONABLE CALLS
            </span>
          </div>
          <p className="text-[12.5px] text-slate-500 mt-0.5">
            Active monthly capital deployment plan, exact share sizing, entry tranches, and portfolio sweep.
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

        {/* Search & Cluster Selector for Table Views */}
        {activeTab !== "plan" && (
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

              {/* Capital Preset Buttons */}
              <div className="flex items-center gap-1.5">
                {[50000, 100000, 200000, 500000].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setCapital(amt)}
                    className={`px-2.5 py-1 rounded text-[11.5px] font-mono font-medium transition-all ${
                      capital === amt
                        ? "bg-indigo-600 text-white shadow-xs font-bold"
                        : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-100"
                    }`}
                  >
                    {amt >= 100000 ? `₹${amt / 100000}L` : `₹${amt / 1000}k`}
                  </button>
                ))}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {curatedPlan.map((c) => (
              <div
                key={c.symbol}
                className="rounded-lg border border-slate-200/90 bg-white p-4 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100 flex-wrap gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/admin/verdicts?symbol=${c.symbol}&scope=all`}
                          className="text-base font-bold text-slate-900 hover:text-indigo-600 flex items-center gap-1"
                        >
                          <span>{c.symbol}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                        </Link>
                        <span className="text-[10.5px] font-mono font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {c.weightPct}% Allocation ({money(c.allocatedAmount)})
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {c.name} · <span className="font-medium text-slate-600">{c.cluster}</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">Scores (C/Q/M)</div>
                      <div className="text-[12px] font-mono font-bold text-slate-800">{c.scores}</div>
                    </div>
                  </div>

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
                          Buy {c.tranche1Shares} shares @ {money(c.cmp)}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Cost: {money(c.t1Value)}</div>
                      </div>

                      <div className="bg-white rounded border border-slate-200 p-2">
                        <div className="text-[10px] text-blue-700 font-semibold uppercase">Tranche 2 (Limit Dip)</div>
                        <div className="font-mono font-bold text-slate-900 mt-0.5">
                          Limit {c.tranche2Shares} shares $\le$ {money(c.buyBelow)}
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
                      <div className="text-[9.5px] text-emerald-700 font-medium mt-0.5">Buy $\le$ {money(c.buyBelow)}</div>
                    </div>

                    <div className="rounded border border-indigo-200 p-2 bg-indigo-50/20">
                      <div className="text-indigo-600 font-medium text-[9.5px] uppercase">12M Target</div>
                      <div className="font-mono font-bold text-indigo-700 mt-0.5">{money(c.target)}</div>
                      <div className="text-[9.5px] text-indigo-700 font-bold mt-0.5">+{c.upside}% ({money(c.profitRupees)})</div>
                    </div>

                    <div className="rounded border border-rose-200 p-2 bg-rose-50/20">
                      <div className="text-rose-600 font-medium text-[9.5px] uppercase">Hard Stop-Loss</div>
                      <div className="font-mono font-bold text-rose-700 mt-0.5">{money(c.stopLoss)}</div>
                      <div className="text-[9.5px] text-rose-600 font-medium mt-0.5">Structural Floor</div>
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
                    className="font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                  >
                    <span>View Full Audit &amp; Verdict</span>
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
        </div>
      )}

      {/* TAB 2: PORTFOLIO SWEEP VIEW */}
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

      {/* TAB 3: CLUSTER GEMS & CALLS VIEW */}
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
