"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import {
  Calendar,
  TrendingUp,
  Target,
  Shield,
  Coins,
  Wallet,
  Sparkles,
  CheckCircle2,
  ExternalLink,
  Search,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Edit3,
  RotateCcw,
  Check,
  X,
  Filter,
} from "lucide-react";
import { PriceChart } from "@/components/PriceChart";
import CapTierBadge, { type CapCategory } from "@/components/CapTierBadge";
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

function daysAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    return `${days}d ago`;
  } catch {
    return "";
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

function actionBadgeClass(action: string | null | undefined): string {
  if (!action) return "bg-slate-200 text-slate-700";
  const up = action.toUpperCase();
  if (up.includes("ACCUMULATE")) return "bg-emerald-100 text-emerald-800 border-emerald-300";
  if (up.includes("BUY")) return "bg-emerald-600 text-white border-emerald-700";
  if (up.includes("HOLD")) return "bg-blue-100 text-blue-800 border-blue-300";
  if (up.includes("TRIM")) return "bg-amber-100 text-amber-800 border-amber-300";
  if (up.includes("EXIT") || up.includes("SELL") || up.includes("AVOID")) return "bg-rose-100 text-rose-800 border-rose-300";
  return "bg-slate-100 text-slate-700 border-slate-300";
}

const CUSTOM_PURCHASE_KEY = "calls_custom_purchase_v1";

type Scope = "all" | "curated" | "portfolio";

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
    availableDates?: string[];
    clusterGems: ClusterGem[];
    portfolioActions: PortfolioActionCall[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Scope
  const [selectedDate, setSelectedDate] = useState<string>("ALL");
  const [scope, setScope] = useState<Scope>("all");
  const [search, setSearch] = useState("");
  const [capital, setCapital] = useState<number>(100000);

  // Selected Stock
  const [selectedSymbol, setSelectedSymbol] = useState<string>("UNIONBANK");

  // Expanded sectors set for the tree
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set());

  // Call status overrides (Take/Exit)
  const [userCallOverrides, setUserCallOverrides] = useState<Record<string, { is_taken: boolean; is_cleared: boolean }>>({});

  // Custom User Purchase overrides (date & price)
  const [customPurchases, setCustomPurchases] = useState<Record<string, { purchase_date: string; purchase_price: number }>>({});
  const [isEditingPurchase, setIsEditingPurchase] = useState(false);
  const [editPurchaseDate, setEditPurchaseDate] = useState("");
  const [editPurchasePrice, setEditPurchasePrice] = useState("");

  // Load custom purchases from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_PURCHASE_KEY);
      if (saved) setCustomPurchases(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  const saveCustomPurchase = (symbol: string, d: string, p: number) => {
    const updated = {
      ...customPurchases,
      [symbol]: { purchase_date: d, purchase_price: p },
    };
    setCustomPurchases(updated);
    try {
      localStorage.setItem(CUSTOM_PURCHASE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
    setIsEditingPurchase(false);
  };

  const clearCustomPurchase = (symbol: string) => {
    const updated = { ...customPurchases };
    delete updated[symbol];
    setCustomPurchases(updated);
    try {
      localStorage.setItem(CUSTOM_PURCHASE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
    setIsEditingPurchase(false);
  };

  // Fetch calls data
  const fetchData = useCallback(async (dateFilter?: string) => {
    setLoading(true);
    setError(null);
    try {
      const d = dateFilter ?? selectedDate;
      const url = d && d !== "ALL" ? `/api/admin/calls?date=${encodeURIComponent(d)}` : `/api/admin/calls`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load calls");
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchData(selectedDate);
  }, [selectedDate, fetchData]);

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
      // optimistic
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
      // optimistic
    }
  };

  // Curated 6 deployment picks with exact target allocation and institutional rationale
  const curatedPicks = useMemo(() => [
    {
      symbol: "INDUSTOWER",
      name: "Indus Towers Ltd.",
      sector: "Telecommunication",
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
      symbol: "UNIONBANK",
      name: "Union Bank of India",
      sector: "Financial Services",
      cluster: "PSU Banks",
      weightPct: 20,
      cmp: 173.1,
      buyBelow: 182.3,
      target: 270.1,
      stopLoss: 130.0,
      upside: 45.2,
      scores: "83 / 68 / 74",
      horizon: "6M" as IdeaHorizon,
      horizonLabel: "📈 6M High-Momentum Banking",
      timeline: "5–6 Months",
      role: "6M Banking Growth Anchor",
      rationale: "Tier-1 PSU banking leader with surging momentum (Momentum 74), expanding corporate credit book, and multi-year asset quality turnaround.",
    },
    {
      symbol: "SHAREINDIA",
      name: "Share India Securities Ltd.",
      sector: "Financial Services",
      cluster: "Capital Markets",
      weightPct: 15,
      cmp: 182.4,
      buyBelow: 172.4,
      target: 265.2,
      stopLoss: 123.0,
      upside: 50.7,
      scores: "91 / 66 / 69",
      horizon: "1M" as IdeaHorizon,
      horizonLabel: "⚡ 1M Tactical Swing / High Momentum",
      timeline: "3–6 Weeks",
      role: "1M FinTech / Algo Alpha",
      rationale: "Surging algorithmic trading volumes, high ROE (>25%), robust institutional inflows, and strong relative strength.",
    },
    {
      symbol: "NATCOPHARM",
      name: "Natco Pharma Ltd.",
      sector: "Healthcare",
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
      sector: "Services",
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
      symbol: "APOLLOTYRE",
      name: "Apollo Tyres Ltd.",
      sector: "Automobile and Auto Components",
      cluster: "Auto Components",
      weightPct: 15,
      cmp: 400.4,
      buyBelow: 371.9,
      target: 498.1,
      stopLoss: 265.0,
      upside: 31.3,
      scores: "100 / 63 / 51",
      horizon: "3M" as IdeaHorizon,
      horizonLabel: "🚀 3M Support Rebound & Margin Expansion",
      timeline: "2–3 Months",
      role: "3M Cyclical Margin Expansion",
      rationale: "Sitting right at strong multi-month support, expanding European and domestic EBITDA margins, and ongoing balance sheet deleveraging.",
    },
  ], []);

  // Map of curated symbols
  const curatedSymbolMap = useMemo(() => {
    const map = new Map<string, typeof curatedPicks[0]>();
    curatedPicks.forEach((p) => map.set(p.symbol, p));
    return map;
  }, [curatedPicks]);

  // Master Unified Call Items List
  const unifiedCalls = useMemo(() => {
    if (!data) return [];

    const callMap = new Map<string, any>();

    // 1. Process Cluster Gems
    data.clusterGems.forEach((g) => {
      const cur = curatedSymbolMap.get(g.symbol);
      const port = data.portfolioActions.find((p) => p.symbol === g.symbol);

      const cmp = g.ltp ?? cur?.cmp ?? 0;
      const target = g.target_price ?? cur?.target ?? 0;
      const buyBelow = g.buy_below ?? cur?.buyBelow ?? 0;
      const stopLoss = g.bear_floor ?? cur?.stopLoss ?? Math.round(cmp * 0.82);
      const upside = g.upside_pct ?? (target > 0 && cmp > 0 ? ((target - cmp) / cmp) * 100 : cur?.upside ?? 0);

      // Anchor 1: Call Given
      const callDate = g.call_date ?? g.generated_at ?? "2026-10-31";
      const callPrice = g.call_price ?? g.anchor_price ?? cmp;
      const callPerfPct = g.call_perf_pct ?? (callPrice > 0 ? ((cmp - callPrice) / callPrice) * 100 : 0);

      // Anchor 2: Stock Purchase
      const customP = customPurchases[g.symbol];
      const purchaseDate = customP?.purchase_date ?? g.purchase_date ?? port?.purchase_date ?? null;
      const purchasePrice = customP?.purchase_price ?? g.purchase_price ?? port?.weighted_avg_cost ?? null;
      const purchasePerfPct =
        purchasePrice && purchasePrice > 0 ? ((cmp - purchasePrice) / purchasePrice) * 100 : null;

      const isPortfolio = Boolean(port && port.total_qty > 0) || Boolean(g.is_portfolio);
      const heldQty = port?.total_qty ?? g.held_qty ?? 0;
      const investedVal = port?.invested_val ?? g.invested_val ?? (purchasePrice ? purchasePrice * heldQty : 0);
      const curVal = port?.cur_val ?? g.cur_val ?? (cmp * heldQty);

      const override = userCallOverrides[g.symbol];
      const isTaken = override ? override.is_taken : isPortfolio || g.is_taken;
      const isCleared = override ? override.is_cleared : g.is_cleared;

      const weightPct = cur?.weightPct ?? (isPortfolio ? 15 : 10);
      const allocatedAmount = Math.round((capital * weightPct) / 100);
      const totalShares = cmp > 0 ? Math.floor(allocatedAmount / cmp) : 0;
      const tranche1Shares = Math.ceil(totalShares / 2);
      const tranche2Shares = Math.max(0, totalShares - tranche1Shares);
      const t1Value = tranche1Shares * cmp;
      const t2Value = tranche2Shares * cmp;
      const projectedValue = Math.round(totalShares * target);
      const profitRupees = projectedValue - allocatedAmount;

      callMap.set(g.symbol, {
        symbol: g.symbol,
        name: g.company_name || cur?.name || g.symbol,
        sector: g.sector || cur?.sector || "General",
        industry: g.industry || "General",
        market_cap_category: g.market_cap_category || "mid_cap",
        cluster: g.cluster_name || cur?.cluster || "General",
        marketCapCr: g.market_cap_cr ?? 0,
        cmp,
        buyBelow,
        target,
        stopLoss,
        upside: Math.round(upside * 10) / 10,
        scores: `${g.composite_pct ?? cur?.scores?.split(" / ")[0] ?? "—"} / ${g.quality_pct ?? "—"} / ${g.momentum_pct ?? "—"}`,
        composite_pct: g.composite_pct ?? 70,
        quality_pct: g.quality_pct ?? 65,
        valuation_pct: g.valuation_pct ?? 60,
        momentum_pct: g.momentum_pct ?? 65,
        horizon: g.horizon || cur?.horizon || ("6M" as IdeaHorizon),
        horizonLabel: g.horizon_label || cur?.horizonLabel || "📈 6M High-Momentum",
        timeline: g.sell_timeline || cur?.timeline || "5–6 Months",
        role: cur?.role || `${g.horizon || "6M"} Opportunity`,
        rationale: cur?.rationale || g.strategy_desc || g.verdict || "High-conviction re-rating catalyst.",
        actionToday: isPortfolio ? (port?.action_today || "HOLD & COMPOUND") : (cmp <= buyBelow * 1.02 ? "BUY / ACCUMULATE" : "WATCH / ACCUMULATE"),
        actionReason: port?.action_reason || g.strategy_desc,
        isPortfolio,
        heldQty,
        investedVal,
        curVal,
        isCurated: Boolean(cur),
        weightPct,
        allocatedAmount,
        totalShares,
        tranche1Shares,
        tranche2Shares,
        t1Value,
        t2Value,
        projectedValue,
        profitRupees,
        // Dual Anchors
        callDate,
        callPrice,
        callPerfPct,
        purchaseDate,
        purchasePrice,
        purchasePerfPct,
        isTaken,
        isCleared,
      });
    });

    // 2. Add any Curated picks that weren't in clusterGems
    curatedPicks.forEach((cp) => {
      if (!callMap.has(cp.symbol)) {
        const port = data.portfolioActions.find((p) => p.symbol === cp.symbol);
        const cmp = port?.ltp ?? cp.cmp;
        const target = cp.target;
        const buyBelow = cp.buyBelow;
        const stopLoss = cp.stopLoss;
        const upside = cp.upside;

        const callDate = "2026-10-31";
        const callPrice = cp.cmp;
        const callPerfPct = ((cmp - callPrice) / callPrice) * 100;

        const customP = customPurchases[cp.symbol];
        const purchaseDate = customP?.purchase_date ?? port?.purchase_date ?? null;
        const purchasePrice = customP?.purchase_price ?? port?.weighted_avg_cost ?? null;
        const purchasePerfPct =
          purchasePrice && purchasePrice > 0 ? ((cmp - purchasePrice) / purchasePrice) * 100 : null;

        const isPortfolio = Boolean(port && port.total_qty > 0);
        const heldQty = port?.total_qty ?? 0;
        const investedVal = port?.invested_val ?? (purchasePrice ? purchasePrice * heldQty : 0);
        const curVal = port?.cur_val ?? (cmp * heldQty);

        const allocatedAmount = Math.round((capital * cp.weightPct) / 100);
        const totalShares = Math.floor(allocatedAmount / cmp);
        const tranche1Shares = Math.ceil(totalShares / 2);
        const tranche2Shares = Math.max(0, totalShares - tranche1Shares);
        const t1Value = tranche1Shares * cmp;
        const t2Value = tranche2Shares * cmp;
        const projectedValue = Math.round(totalShares * target);
        const profitRupees = projectedValue - allocatedAmount;

        callMap.set(cp.symbol, {
          symbol: cp.symbol,
          name: cp.name,
          sector: cp.sector,
          industry: cp.cluster,
          market_cap_category: "large_cap",
          cluster: cp.cluster,
          marketCapCr: 25000,
          cmp,
          buyBelow,
          target,
          stopLoss,
          upside,
          scores: cp.scores,
          composite_pct: 85,
          quality_pct: 75,
          valuation_pct: 70,
          momentum_pct: 70,
          horizon: cp.horizon,
          horizonLabel: cp.horizonLabel,
          timeline: cp.timeline,
          role: cp.role,
          rationale: cp.rationale,
          actionToday: isPortfolio ? (port?.action_today || "HOLD & COMPOUND") : "BUY / ACCUMULATE",
          actionReason: "Curated monthly deployment plan selection.",
          isPortfolio,
          heldQty,
          investedVal,
          curVal,
          isCurated: true,
          weightPct: cp.weightPct,
          allocatedAmount,
          totalShares,
          tranche1Shares,
          tranche2Shares,
          t1Value,
          t2Value,
          projectedValue,
          profitRupees,
          callDate,
          callPrice,
          callPerfPct,
          purchaseDate,
          purchasePrice,
          purchasePerfPct,
          isTaken: isPortfolio,
          isCleared: false,
        });
      }
    });

    // 3. Add any Portfolio actions not yet in map
    data.portfolioActions.forEach((pa) => {
      if (!callMap.has(pa.symbol)) {
        const cmp = pa.ltp;
        const target = pa.target_price ?? Math.round(cmp * 1.35);
        const buyBelow = pa.buy_below ?? Math.round(cmp * 0.98);
        const stopLoss = pa.bear_floor ?? Math.round(cmp * 0.85);
        const upside = pa.upside_pct ?? 25;

        const callDate = pa.call_date ?? pa.generated_at ?? "2026-10-31";
        const callPrice = pa.call_price ?? pa.anchor_price ?? cmp;
        const callPerfPct = pa.call_perf_pct ?? (callPrice > 0 ? ((cmp - callPrice) / callPrice) * 100 : 0);

        const customP = customPurchases[pa.symbol];
        const purchaseDate = customP?.purchase_date ?? pa.purchase_date ?? null;
        const purchasePrice = customP?.purchase_price ?? pa.weighted_avg_cost ?? null;
        const purchasePerfPct =
          purchasePrice && purchasePrice > 0 ? ((cmp - purchasePrice) / purchasePrice) * 100 : null;

        callMap.set(pa.symbol, {
          symbol: pa.symbol,
          name: pa.company_name || pa.symbol,
          sector: pa.sector || "General",
          industry: pa.industry || "General",
          market_cap_category: pa.market_cap_category || "mid_cap",
          cluster: pa.cluster_name || "General",
          marketCapCr: 10000,
          cmp,
          buyBelow,
          target,
          stopLoss,
          upside: Math.round(upside * 10) / 10,
          scores: `${pa.composite_pct ?? "—"} / ${pa.quality_pct ?? "—"} / ${pa.momentum_pct ?? "—"}`,
          composite_pct: pa.composite_pct ?? 70,
          quality_pct: pa.quality_pct ?? 65,
          valuation_pct: pa.valuation_pct ?? 60,
          momentum_pct: pa.momentum_pct ?? 65,
          horizon: pa.horizon,
          horizonLabel: pa.horizon_label,
          timeline: pa.sell_timeline,
          role: "Portfolio Holding",
          rationale: pa.action_reason,
          actionToday: pa.action_today,
          actionReason: pa.action_reason,
          isPortfolio: true,
          heldQty: pa.total_qty,
          investedVal: pa.invested_val,
          curVal: pa.cur_val,
          isCurated: false,
          weightPct: 15,
          allocatedAmount: 15000,
          totalShares: Math.floor(15000 / cmp),
          tranche1Shares: Math.ceil(Math.floor(15000 / cmp) / 2),
          tranche2Shares: Math.floor(Math.floor(15000 / cmp) / 2),
          t1Value: Math.ceil(Math.floor(15000 / cmp) / 2) * cmp,
          t2Value: Math.floor(Math.floor(15000 / cmp) / 2) * cmp,
          projectedValue: Math.round(Math.floor(15000 / cmp) * target),
          profitRupees: Math.round(Math.floor(15000 / cmp) * target) - 15000,
          callDate,
          callPrice,
          callPerfPct,
          purchaseDate,
          purchasePrice,
          purchasePerfPct,
          isTaken: true,
          isCleared: false,
        });
      }
    });

    return Array.from(callMap.values());
  }, [data, curatedPicks, curatedSymbolMap, capital, customPurchases, userCallOverrides]);

  // Filter unified calls based on Scope and Search
  const filteredCalls = useMemo(() => {
    return unifiedCalls.filter((c) => {
      if (scope === "curated" && !c.isCurated) return false;
      if (scope === "portfolio" && !c.isPortfolio) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const mSym = c.symbol.toLowerCase().includes(q);
        const mName = c.name.toLowerCase().includes(q);
        const mSec = c.sector.toLowerCase().includes(q);
        const mClust = c.cluster.toLowerCase().includes(q);
        if (!mSym && !mName && !mSec && !mClust) return false;
      }
      return true;
    });
  }, [unifiedCalls, scope, search]);

  // Group calls by Sector
  const sectorGroups = useMemo(() => {
    const map = new Map<string, typeof filteredCalls>();
    filteredCalls.forEach((c) => {
      const sec = c.sector || "Other";
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push(c);
    });

    // Sort calls within each sector: curated first, then composite score desc
    const groups: { sector: string; count: number; calls: typeof filteredCalls }[] = [];
    map.forEach((calls, sector) => {
      calls.sort((a, b) => {
        if (a.isCurated && !b.isCurated) return -1;
        if (!a.isCurated && b.isCurated) return 1;
        return (b.composite_pct ?? 0) - (a.composite_pct ?? 0);
      });
      groups.push({ sector, count: calls.length, calls });
    });

    // Sort sectors alphabetically
    groups.sort((a, b) => a.sector.localeCompare(b.sector));
    return groups;
  }, [filteredCalls]);

  // Default expand all sectors initially or when search matches
  useEffect(() => {
    if (sectorGroups.length > 0 && expandedSectors.size === 0) {
      setExpandedSectors(new Set(sectorGroups.map((g) => g.sector)));
    }
  }, [sectorGroups, expandedSectors.size]);

  // Selected Call Detail
  const selectedCall = useMemo(() => {
    return filteredCalls.find((c) => c.symbol === selectedSymbol) || filteredCalls[0] || null;
  }, [filteredCalls, selectedSymbol]);

  // Sync edit form when selectedCall changes
  useEffect(() => {
    if (selectedCall) {
      setEditPurchaseDate(selectedCall.purchaseDate || new Date().toISOString().slice(0, 10));
      setEditPurchasePrice(selectedCall.purchasePrice ? String(selectedCall.purchasePrice) : String(selectedCall.cmp));
      setIsEditingPurchase(false);
    }
  }, [selectedCall]);

  const toggleSector = (sec: string) => {
    setExpandedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(sec)) next.delete(sec);
      else next.add(sec);
      return next;
    });
  };

  const expandAll = () => setExpandedSectors(new Set(sectorGroups.map((g) => g.sector)));
  const collapseAll = () => setExpandedSectors(new Set());

  // Distinct dates for dropdown
  const dateOptions = useMemo(() => {
    const list = data?.availableDates ? [...data.availableDates] : [];
    // Ensure 2026-10-31 is present if not already
    if (!list.includes("2026-10-31")) list.unshift("2026-10-31");
    return Array.from(new Set(list));
  }, [data]);

  return (
    <div className="space-y-4">
      {/* ── Top Header & Filter Bar ─────────────────────────────────────────── */}
      <div className="bg-white border hairline rounded-lg p-3 sm:p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 font-sans">
                  Institutional Calls Desk
                </h1>
                <span className="px-2 py-0.5 rounded text-[10.5px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300">
                  DUAL-ANCHOR ENGINE
                </span>
                {selectedDate !== "ALL" && (
                  <span className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Snapshot: {selectedDate}
                  </span>
                )}
              </div>
              <p className="text-[12px] text-slate-500 mt-0.5">
                Sector-grouped calls with Dual-Anchor tracking: Call Generation vs. User Execution performance.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Top Date Dropdown */}
            <div className="flex items-center gap-1.5 bg-slate-50 border hairline rounded-md px-2.5 py-1 text-[12px]">
              <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <label htmlFor="call-date-select" className="font-semibold text-slate-600 text-[11.5px]">
                Date:
              </label>
              <select
                id="call-date-select"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent font-medium text-slate-900 focus:outline-none cursor-pointer"
              >
                <option value="ALL">📅 All Active Dates (Latest)</option>
                {dateOptions.map((d) => (
                  <option key={d} value={d}>
                    {fmtDate(d)} ({daysAgo(d)})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="px-2.5 py-1 rounded-md text-[12px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 border hairline transition-colors flex items-center gap-1"
            >
              <RotateCcw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
              <span>{loading ? "Loading…" : "Refresh"}</span>
            </button>
          </div>
        </div>

        {/* Scope selector & Search Bar */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t hairline">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setScope("all")}
              className={`px-3 py-1 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 ${
                scope === "all"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>All Calls ({unifiedCalls.length})</span>
            </button>

            <button
              onClick={() => setScope("curated")}
              className={`px-3 py-1 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 ${
                scope === "curated"
                  ? "bg-indigo-700 text-white shadow-xs"
                  : "bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border border-indigo-200"
              }`}
            >
              <Coins className="w-3.5 h-3.5 text-amber-300" />
              <span>Curated Plan (Top 6)</span>
            </button>

            <button
              onClick={() => setScope("portfolio")}
              className={`px-3 py-1 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 ${
                scope === "portfolio"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Portfolio Holdings ({unifiedCalls.filter((c) => c.isPortfolio).length})</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Find symbol, company, sector..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1 text-[12px] rounded-md border hairline bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 w-48 sm:w-64"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="text-[11.5px] muted-text hidden sm:block tabular-nums font-mono">
              {sectorGroups.length} Sectors · {filteredCalls.length} Calls
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Two-Pane Verdict Layout ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)] gap-4 items-start">
        {/* ── Left Rail: Sectors & Calls Tree ───────────────────────────────── */}
        <div className="rounded-lg border hairline bg-white lg:sticky lg:top-3 lg:max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden shadow-2xs">
          <div className="px-3 py-2 border-b hairline flex items-center justify-between gap-2 shrink-0 bg-slate-50/70">
            <span className="text-[11.5px] font-bold uppercase tracking-wider text-slate-700">
              Sectors &amp; Calls
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] muted-text tabular-nums font-mono">
                {sectorGroups.length}s · {filteredCalls.length}c
              </span>
              <button
                type="button"
                onClick={expandedSectors.size === sectorGroups.length ? collapseAll : expandAll}
                className="text-[10px] text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded border hairline bg-white"
              >
                {expandedSectors.size === sectorGroups.length ? "⊟ Collapse" : "⊞ Expand"}
              </button>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 min-h-0 p-1.5 space-y-1">
            {sectorGroups.length === 0 ? (
              <div className="text-center py-8 px-2 text-slate-400 text-xs">
                No calls found matching the current filter.
              </div>
            ) : (
              sectorGroups.map((g) => {
                const isSecOpen = !!search.trim() || expandedSectors.has(g.sector);
                return (
                  <div key={g.sector} className="rounded border hairline bg-slate-50/40 overflow-hidden">
                    {/* Sector Header Toggle */}
                    <button
                      onClick={() => toggleSector(g.sector)}
                      className="w-full flex items-center justify-between px-2 py-1.5 text-left text-[12px] font-bold text-slate-800 hover:bg-slate-100/80 transition-colors"
                      aria-expanded={isSecOpen}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isSecOpen ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        )}
                        <span className="truncate text-indigo-950 font-semibold">{g.sector}</span>
                      </div>
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-slate-200/80 text-slate-700 shrink-0">
                        {g.count}
                      </span>
                    </button>

                    {/* Stock Calls inside this Sector */}
                    {isSecOpen && (
                      <div className="p-1 space-y-1 border-t hairline bg-white">
                        {g.calls.map((call) => {
                          const isSel = selectedCall?.symbol === call.symbol;
                          const callMove = call.callPerfPct;
                          return (
                            <button
                              key={call.symbol}
                              onClick={() => setSelectedSymbol(call.symbol)}
                              className={`w-full flex items-center justify-between p-2 rounded-md text-left transition-all ${
                                isSel
                                  ? "bg-slate-900 text-white shadow-xs"
                                  : "hover:bg-slate-100/80 text-slate-900"
                              }`}
                            >
                              <div className="min-w-0 flex-1 pr-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-bold text-[12.5px] tracking-tight">
                                    {call.symbol}
                                  </span>
                                  {call.isCurated && (
                                    <span
                                      className={`text-[9px] font-bold px-1 rounded ${
                                        isSel
                                          ? "bg-amber-400 text-slate-950"
                                          : "bg-amber-100 text-amber-900 border border-amber-300"
                                      }`}
                                      title="Top 6 Curated Deployment Plan Pick"
                                    >
                                      ★ TOP 6
                                    </span>
                                  )}
                                  {call.isPortfolio && (
                                    <span
                                      className={`text-[9px] font-bold px-1 rounded ${
                                        isSel
                                          ? "bg-blue-400 text-slate-950"
                                          : "bg-blue-100 text-blue-900 border border-blue-300"
                                      }`}
                                      title="Held in Portfolio"
                                    >
                                      P
                                    </span>
                                  )}
                                </div>
                                <div
                                  className={`text-[10.5px] truncate mt-0.5 ${
                                    isSel ? "text-slate-300" : "text-slate-500"
                                  }`}
                                >
                                  {call.name}
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                <div className="font-mono font-bold text-[12px]">{money(call.cmp)}</div>
                                <div className="flex items-center justify-end gap-1 mt-0.5">
                                  {callMove != null ? (
                                    <span
                                      className={`text-[10px] font-mono font-semibold ${
                                        callMove >= 0
                                          ? isSel
                                            ? "text-emerald-400"
                                            : "text-emerald-700"
                                          : isSel
                                          ? "text-rose-400"
                                          : "text-rose-600"
                                      }`}
                                    >
                                      {pct(callMove)}
                                    </span>
                                  ) : null}
                                  <span
                                    className={`px-1 rounded text-[8.5px] font-sans font-bold uppercase ${
                                      isSel
                                        ? "bg-white/20 text-white"
                                        : actionBadgeClass(call.actionToday)
                                    }`}
                                  >
                                    {call.actionToday?.split(" ")[0]}
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right Panel: Call Detail & Dual-Anchor Deep Dive ─────────────── */}
        <div className="space-y-4">
          {!selectedCall ? (
            <div className="bg-white border hairline rounded-lg p-12 text-center text-slate-500">
              Select a stock from the sector list on the left to inspect call details.
            </div>
          ) : (
            <>
              {/* Header Card */}
              <div className="bg-white border hairline rounded-lg p-4 shadow-2xs space-y-3">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-2xl font-bold font-mono tracking-tight text-slate-900">
                        {selectedCall.symbol}
                      </h2>
                      <span className="text-base text-slate-700 font-medium">
                        {selectedCall.name}
                      </span>
                      <CapTierBadge category={selectedCall.market_cap_category as CapCategory} />
                      {selectedCall.isCurated && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                          ★ ₹1L Curated Allocation Pick
                        </span>
                      )}
                      {selectedCall.isPortfolio && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-900 border border-blue-300">
                          Portfolio Position ({selectedCall.heldQty} sh)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-[12px] text-slate-600 flex-wrap">
                      <span className="font-semibold text-indigo-700">{selectedCall.sector}</span>
                      <span>•</span>
                      <span>{selectedCall.industry}</span>
                      <span>•</span>
                      <span className="muted-text">MCAP: ₹{selectedCall.marketCapCr?.toLocaleString()} Cr</span>
                    </div>
                  </div>

                  <div className="text-right flex flex-col items-end">
                    <div className="text-2xl font-bold font-mono text-slate-900">
                      {money(selectedCall.cmp)}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold border ${actionBadgeClass(
                          selectedCall.actionToday
                        )}`}
                      >
                        {selectedCall.actionToday}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${getHorizonBadge(
                          selectedCall.horizon
                        )}`}
                      >
                        {selectedCall.horizonLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quick actions strip */}
                <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t hairline text-[12px]">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTakeCall(selectedCall.symbol)}
                      disabled={selectedCall.isTaken}
                      className={`px-2.5 py-1 rounded text-[11.5px] font-semibold transition-colors flex items-center gap-1 ${
                        selectedCall.isTaken
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-300 opacity-80"
                          : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{selectedCall.isTaken ? "Call Taken" : "Take Call"}</span>
                    </button>

                    <button
                      onClick={() => handleExitCall(selectedCall.symbol)}
                      disabled={selectedCall.isCleared}
                      className="px-2.5 py-1 rounded text-[11.5px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 border hairline transition-colors"
                    >
                      {selectedCall.isCleared ? "Call Closed" : "Mark Exit"}
                    </button>
                  </div>

                  <Link
                    href={`/stock/${selectedCall.symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-800 text-[12px]"
                  >
                    <span>Open Full Deep-Dive Analysis</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>

              {/* ── ⭐ DUAL-ANCHOR PERFORMANCE CARDS (CORE REQUIREMENT) ──────── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ANCHOR 1: CALL GIVEN */}
                <div className="bg-gradient-to-br from-indigo-50/60 to-purple-50/40 border border-indigo-200 rounded-lg p-4 shadow-2xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-indigo-900 font-bold text-[12.5px]">
                      <span className="w-2 h-2 rounded-full bg-indigo-600" />
                      <span>ANCHOR 1: CALL GIVEN</span>
                    </div>
                    <span className="text-[11px] font-mono text-indigo-700 font-medium">
                      Engine Call
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-indigo-100">
                    <div>
                      <div className="text-[11px] text-slate-500 uppercase font-semibold">Call Date</div>
                      <div className="text-[13px] font-bold font-mono text-slate-900 mt-0.5">
                        {fmtDate(selectedCall.callDate)}
                      </div>
                      <div className="text-[10.5px] text-slate-500">{daysAgo(selectedCall.callDate)}</div>
                    </div>

                    <div>
                      <div className="text-[11px] text-slate-500 uppercase font-semibold">Anchor Call Price</div>
                      <div className="text-[13px] font-bold font-mono text-slate-900 mt-0.5">
                        {money(selectedCall.callPrice)}
                      </div>
                      <div className="text-[10.5px] text-slate-500">LTP: {money(selectedCall.cmp)}</div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-indigo-100 flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-indigo-950">
                      Performance Since Call:
                    </span>
                    <div className="text-right">
                      <span
                        className={`text-base font-bold font-mono ${
                          (selectedCall.callPerfPct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {pct(selectedCall.callPerfPct)}
                      </span>
                      {selectedCall.callPrice && (
                        <span className="text-[11px] font-mono text-slate-500 ml-1.5">
                          ({selectedCall.cmp >= selectedCall.callPrice ? "+" : ""}
                          {money(selectedCall.cmp - selectedCall.callPrice)}/sh)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* ANCHOR 2: USER PURCHASE */}
                <div className="bg-gradient-to-br from-emerald-50/60 to-teal-50/40 border border-emerald-200 rounded-lg p-4 shadow-2xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-emerald-950 font-bold text-[12.5px]">
                      <span className="w-2 h-2 rounded-full bg-emerald-600" />
                      <span>ANCHOR 2: STOCK PURCHASE</span>
                    </div>
                    <button
                      onClick={() => setIsEditingPurchase(!isEditingPurchase)}
                      className="text-[11px] font-medium text-emerald-800 hover:text-emerald-950 inline-flex items-center gap-1 underline underline-offset-2"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>{selectedCall.purchasePrice ? "Edit / Override" : "Log Purchase"}</span>
                    </button>
                  </div>

                  {isEditingPurchase ? (
                    <div className="bg-white/90 p-2.5 rounded border border-emerald-300 space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                        <div>
                          <label className="block text-slate-600 font-semibold mb-0.5">Purchase Date</label>
                          <input
                            type="date"
                            value={editPurchaseDate}
                            onChange={(e) => setEditPurchaseDate(e.target.value)}
                            className="w-full px-2 py-1 text-xs border rounded bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-0.5">Purchase Price (₹)</label>
                          <input
                            type="number"
                            step="0.05"
                            value={editPurchasePrice}
                            onChange={(e) => setEditPurchasePrice(e.target.value)}
                            className="w-full px-2 py-1 text-xs border rounded bg-white font-mono"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        <button
                          onClick={() => setIsEditingPurchase(false)}
                          className="px-2 py-0.5 text-xs text-slate-600 hover:text-slate-800"
                        >
                          Cancel
                        </button>
                        {customPurchases[selectedCall.symbol] && (
                          <button
                            onClick={() => clearCustomPurchase(selectedCall.symbol)}
                            className="px-2 py-0.5 text-xs text-rose-700 hover:text-rose-900 border border-rose-200 rounded bg-rose-50"
                          >
                            Reset
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const p = parseFloat(editPurchasePrice);
                            if (!Number.isNaN(p) && p > 0 && editPurchaseDate) {
                              saveCustomPurchase(selectedCall.symbol, editPurchaseDate, p);
                            }
                          }}
                          className="px-3 py-0.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded shadow-2xs"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-emerald-100">
                        <div>
                          <div className="text-[11px] text-slate-500 uppercase font-semibold">Purchase Date</div>
                          <div className="text-[13px] font-bold font-mono text-slate-900 mt-0.5">
                            {selectedCall.purchaseDate ? fmtDate(selectedCall.purchaseDate) : "Not in Portfolio"}
                          </div>
                          <div className="text-[10.5px] text-slate-500">
                            {selectedCall.purchaseDate ? daysAgo(selectedCall.purchaseDate) : "Ready for Tranche 1"}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] text-slate-500 uppercase font-semibold">Purchase Price / Avg</div>
                          <div className="text-[13px] font-bold font-mono text-slate-900 mt-0.5">
                            {selectedCall.purchasePrice ? money(selectedCall.purchasePrice) : "—"}
                          </div>
                          <div className="text-[10.5px] text-slate-500">
                            {selectedCall.heldQty > 0 ? `Held: ${selectedCall.heldQty} sh` : "Pending Entry"}
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-emerald-100 flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-emerald-950">
                          Performance to Purchase:
                        </span>
                        <div className="text-right">
                          {selectedCall.purchasePerfPct != null ? (
                            <>
                              <span
                                className={`text-base font-bold font-mono ${
                                  selectedCall.purchasePerfPct >= 0 ? "text-emerald-700" : "text-rose-600"
                                }`}
                              >
                                {pct(selectedCall.purchasePerfPct)}
                              </span>
                              {selectedCall.purchasePrice && (
                                <span className="text-[11px] font-mono text-slate-500 ml-1.5">
                                  ({selectedCall.cmp >= selectedCall.purchasePrice ? "+" : ""}
                                  {money(selectedCall.cmp - selectedCall.purchasePrice)}/sh)
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-slate-500 font-medium italic">
                              Click &ldquo;Log Purchase&rdquo; to track
                            </span>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ── Key Decision Levels (4-Card Grid) ─────────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white border hairline rounded-lg p-3 shadow-2xs">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                    Current Price
                  </div>
                  <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                    {money(selectedCall.cmp)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Live Market Close</div>
                </div>

                <div className="bg-white border hairline rounded-lg p-3 shadow-2xs">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                    Buy Below Ceiling
                  </div>
                  <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                    {money(selectedCall.buyBelow)}
                  </div>
                  <div className="mt-0.5">
                    {selectedCall.cmp <= selectedCall.buyBelow * 1.01 ? (
                      <span className="text-[10.5px] font-bold text-emerald-700 bg-emerald-50 px-1 rounded">
                        ✓ In Buy Zone
                      </span>
                    ) : (
                      <span className="text-[10.5px] font-semibold text-amber-700 bg-amber-50 px-1 rounded">
                        Wait for Pullback
                      </span>
                    )}
                  </div>
                </div>

                <div className="bg-white border hairline rounded-lg p-3 shadow-2xs">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                    Target Price
                  </div>
                  <div className="text-xl font-bold font-mono text-emerald-700 mt-1">
                    {money(selectedCall.target)}
                  </div>
                  <div className="text-[11px] font-bold text-emerald-700 mt-0.5">
                    +{selectedCall.upside}% Forward Upside
                  </div>
                </div>

                <div className="bg-white border hairline rounded-lg p-3 shadow-2xs">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                    Stop Loss / Floor
                  </div>
                  <div className="text-xl font-bold font-mono text-rose-600 mt-1">
                    {money(selectedCall.stopLoss)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Buffer: -{Math.round(((selectedCall.cmp - selectedCall.stopLoss) / selectedCall.cmp) * 100)}%
                  </div>
                </div>
              </div>

              {/* ── Tranche Deployment Sizing ─────────────────────────────────── */}
              <div className="bg-white border hairline rounded-lg p-4 shadow-2xs space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-indigo-700" />
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                      Capital Sizing &amp; Staggered Tranches
                    </h3>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {selectedCall.weightPct}% Allocation (₹{selectedCall.allocatedAmount.toLocaleString()})
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 font-medium">
                    Projected at Target: <strong className="text-emerald-700 font-mono">{money(selectedCall.projectedValue)}</strong> (+{money(selectedCall.profitRupees)})
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg border border-indigo-100 bg-indigo-50/40">
                    <div className="font-bold text-indigo-950 flex items-center justify-between">
                      <span>Tranche 1: Market Order (Today)</span>
                      <span className="font-mono text-indigo-700">~{money(selectedCall.t1Value)}</span>
                    </div>
                    <p className="text-slate-600 mt-1">
                      Buy <strong>{selectedCall.tranche1Shares} shares</strong> at current CMP ({money(selectedCall.cmp)}) to establish primary position.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/40">
                    <div className="font-bold text-amber-950 flex items-center justify-between">
                      <span>Tranche 2: Limit Order on Dip</span>
                      <span className="font-mono text-amber-800">~{money(selectedCall.t2Value)}</span>
                    </div>
                    <p className="text-slate-600 mt-1">
                      Set GTT limit for <strong>{selectedCall.tranche2Shares} shares</strong> at or below {money(selectedCall.buyBelow)} to average down.
                    </p>
                  </div>
                </div>
              </div>

              {/* ── Interactive Candlestick Chart ─────────────────────────────── */}
              <div className="bg-white border hairline rounded-lg p-3 sm:p-4 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-slate-700" />
                    <h3 className="text-sm font-bold text-slate-900 tracking-wide">
                      Interactive Price Action &amp; Levels
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Scroll/drag to inspect support regions &amp; EMAs
                  </span>
                </div>

                <div className="w-full pt-1">
                  <PriceChart symbol={selectedCall.symbol} />
                </div>
              </div>

              {/* ── Multi-Factor Pillars & Investment Rationale ──────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Scorecard */}
                <div className="bg-white border hairline rounded-lg p-4 shadow-2xs space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Multi-Factor Scorecard
                  </h3>
                  <div className="space-y-2.5">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-600 font-medium">Composite Score</span>
                        <span className="font-bold font-mono text-slate-900">{selectedCall.composite_pct}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-indigo-600 h-1.5 rounded-full"
                          style={{ width: `${selectedCall.composite_pct}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-600 font-medium">Fundamental Quality</span>
                        <span className="font-bold font-mono text-slate-900">{selectedCall.quality_pct}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-emerald-600 h-1.5 rounded-full"
                          style={{ width: `${selectedCall.quality_pct}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-600 font-medium">Valuation Margin</span>
                        <span className="font-bold font-mono text-slate-900">{selectedCall.valuation_pct}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-cyan-600 h-1.5 rounded-full"
                          style={{ width: `${selectedCall.valuation_pct}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-600 font-medium">Technical Momentum</span>
                        <span className="font-bold font-mono text-slate-900">{selectedCall.momentum_pct}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-purple-600 h-1.5 rounded-full"
                          style={{ width: `${selectedCall.momentum_pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Thesis & Rationale */}
                <div className="md:col-span-2 bg-white border hairline rounded-lg p-4 shadow-2xs space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Institutional Thesis &amp; Strategy
                  </h3>
                  <p className="text-[13px] leading-relaxed text-slate-800 font-medium bg-slate-50/70 p-3 rounded border hairline">
                    {selectedCall.rationale}
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                    <div>
                      <span className="text-slate-500 font-medium">Execution Horizon:</span>{" "}
                      <strong className="text-slate-900">{selectedCall.timeline}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 font-medium">Cluster Role:</span>{" "}
                      <strong className="text-slate-900">{selectedCall.role}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
