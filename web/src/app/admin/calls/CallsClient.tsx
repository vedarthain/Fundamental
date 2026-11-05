"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Calendar,
  TrendingUp,
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
  FileText,
  DollarSign,
  Newspaper,
  CheckSquare,
  Check,
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
    if (days === 1) return "1d ago";
    return `${days}d ago`;
  } catch {
    return "";
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
type DetailTab = "overview" | "results" | "dividends" | "news" | "audit";

type StockContext = {
  news: { title: string; source: string; url: string; published_at: string | null }[];
  filings: { title: string; category: string; headline: string | null; published_at: string | null; pdf_url: string | null }[];
  dividends: { ex_date: string; purpose: string; amount: number | null }[];
  results: { title: string; headline: string | null; published_at: string | null; pdf_url: string | null }[];
  audit: {
    valuation_method: string | null;
    target_price: number | null;
    buy_below: number | null;
    bear_floor: number | null;
    audited_filing_status: string;
    forensic_status: string;
  } | null;
};

// Batch definitions for multi-select
const BATCH_DEFINITIONS = [
  { key: "week_1", label: "Week 1: Sun, 01 Nov 2026 (7:00 PM)", shortLabel: "Wk 1 (01 Nov)", dateMatch: "2026-11-01" },
  { key: "week_2", label: "Week 2: Sun, 08 Nov 2026 (7:00 PM)", shortLabel: "Wk 2 (08 Nov)", dateMatch: "2026-11-08" },
  { key: "2026-10-31", label: "Sat, 31 Oct 2026", shortLabel: "31 Oct", dateMatch: "2026-10-31" },
  { key: "2026-10-30", label: "Fri, 30 Oct 2026", shortLabel: "30 Oct", dateMatch: "2026-10-30" },
  { key: "2026-10-29", label: "Thu, 29 Oct 2026", shortLabel: "29 Oct", dateMatch: "2026-10-29" },
  { key: "2026-10-28", label: "Wed, 28 Oct 2026", shortLabel: "28 Oct", dateMatch: "2026-10-28" },
  { key: "2026-10-27", label: "Tue, 27 Oct 2026", shortLabel: "27 Oct", dateMatch: "2026-10-27" },
  { key: "2026-10-25", label: "Week 0: Sun, 25 Oct 2026 (7:00 PM)", shortLabel: "Wk 0 (25 Oct)", dateMatch: "2026-10-25" },
];

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
    availableDates?: string[];
    clusterGems: ClusterGem[];
    portfolioActions: PortfolioActionCall[];
  } | null>(null);

  const [loading, setLoading] = useState(true);

  // Multi-Select Dates State
  const [selectedBatches, setSelectedBatches] = useState<Set<string>>(new Set(["week_1", "2026-10-31", "2026-10-30"]));
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const dateDropdownRef = useRef<HTMLDivElement>(null);

  // Scope & Filters
  const [scope, setScope] = useState<Scope>("all");
  const [search, setSearch] = useState("");
  const [capital] = useState<number>(100000);

  // Selected Stock & Detail Tab
  const [selectedSymbol, setSelectedSymbol] = useState<string>("UNIONBANK");
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");

  // Stock context data
  const [contextData, setContextData] = useState<StockContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  // Expanded sectors set for tree
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set());

  // Call status overrides
  const [userCallOverrides, setUserCallOverrides] = useState<Record<string, { is_taken: boolean; is_cleared: boolean }>>({});

  // Custom User Purchase overrides
  const [customPurchases, setCustomPurchases] = useState<Record<string, { purchase_date: string; purchase_price: number }>>({});
  const [isEditingPurchase, setIsEditingPurchase] = useState(false);
  const [editPurchaseDate, setEditPurchaseDate] = useState("");
  const [editPurchasePrice, setEditPurchasePrice] = useState("");

  // Close multi-select dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) {
        setIsDateDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/calls");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch contextual stock data
  useEffect(() => {
    if (!selectedSymbol) return;
    let cancelled = false;
    setContextLoading(true);

    fetch(`/api/admin/stock-context?symbol=${encodeURIComponent(selectedSymbol)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!cancelled && d) setContextData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setContextLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

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

  // Curated 6 deployment picks
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
      horizonLabel: "🏛️ 1Y Core",
      timeline: "9–12M",
      role: "1Y Alpha FCF Compounder",
      rationale: "FCF yield > 15%, bad debt recoveries, expanding 5G tenancies.",
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
      horizonLabel: "📈 6M Banking",
      timeline: "5–6M",
      role: "6M Banking Growth Anchor",
      rationale: "Tier-1 PSU banking leader (Momentum 74), expanding corporate credit book, turnaround.",
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
      horizonLabel: "⚡ 1M Swing",
      timeline: "3–6W",
      role: "1M FinTech Alpha",
      rationale: "Surging algorithmic trading volumes, >25% ROE, zero net debt, institutional accumulation.",
    },
    {
      symbol: "NATCOPHARM",
      name: "Natco Pharma Ltd.",
      sector: "Healthcare",
      cluster: "Pharma CDMO",
      weightPct: 15,
      cmp: 790.5,
      buyBelow: 766.8,
      target: 1022.5,
      stopLoss: 690.0,
      upside: 30.7,
      scores: "96 / 73 / 37",
      horizon: "3M" as IdeaHorizon,
      horizonLabel: "🚀 3M Catalyst",
      timeline: "2–3M",
      role: "3M Defensive Margin",
      rationale: "Operating margin > 35%, zero net debt, specialty generic launches in North America.",
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
      horizonLabel: "⚡ 1M Swing",
      timeline: "2–4W",
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
      horizonLabel: "🚀 3M Support Rebound",
      timeline: "2–3M",
      role: "3M Margin Expansion",
      rationale: "Firm multi-month support, expanding European EBITDA margins, debt reduction cycle.",
    },
  ], []);

  const curatedSymbolMap = useMemo(() => {
    const map = new Map<string, typeof curatedPicks[0]>();
    curatedPicks.forEach((p) => map.set(p.symbol, p));
    return map;
  }, [curatedPicks]);

  // Unified Calls List
  const unifiedCalls = useMemo(() => {
    if (!data) return [];
    const callMap = new Map<string, any>();

    // 1. Cluster Gems
    data.clusterGems.forEach((g) => {
      const cur = curatedSymbolMap.get(g.symbol);
      const port = data.portfolioActions.find((p) => p.symbol === g.symbol);

      const cmp = g.ltp ?? cur?.cmp ?? 0;
      const target = g.target_price ?? cur?.target ?? 0;
      const buyBelow = g.buy_below ?? cur?.buyBelow ?? 0;
      const stopLoss = g.bear_floor ?? cur?.stopLoss ?? Math.round(cmp * 0.82);
      const upside = g.upside_pct ?? (target > 0 && cmp > 0 ? ((target - cmp) / cmp) * 100 : cur?.upside ?? 0);

      // Anchor 1: Call Given
      const callDate = g.call_date ?? (g.generated_at ? g.generated_at.slice(0, 10) : "2026-11-01");
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
        timeline: g.sell_timeline || cur?.timeline || "5–6M",
        role: cur?.role || `${g.horizon || "6M"} Opportunity`,
        rationale: cur?.rationale || g.strategy_desc || g.verdict || "High-conviction re-rating catalyst.",
        actionToday: isPortfolio ? (port?.action_today || "HOLD & COMPOUND") : (cmp <= buyBelow * 1.02 ? "BUY / ACCUMULATE" : "WATCH / ACCUMULATE"),
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

    // 2. Curated Picks fallback
    curatedPicks.forEach((cp) => {
      if (!callMap.has(cp.symbol)) {
        const port = data.portfolioActions.find((p) => p.symbol === cp.symbol);
        const cmp = port?.ltp ?? cp.cmp;
        const callDate = "2026-11-01";
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

        callMap.set(cp.symbol, {
          symbol: cp.symbol,
          name: cp.name,
          sector: cp.sector,
          industry: cp.cluster,
          market_cap_category: "large_cap",
          cluster: cp.cluster,
          marketCapCr: 25000,
          cmp,
          buyBelow: cp.buyBelow,
          target: cp.target,
          stopLoss: cp.stopLoss,
          upside: cp.upside,
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
          t1Value: tranche1Shares * cmp,
          t2Value: tranche2Shares * cmp,
          projectedValue: Math.round(totalShares * cp.target),
          profitRupees: Math.round(totalShares * cp.target) - allocatedAmount,
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

    return Array.from(callMap.values());
  }, [data, curatedPicks, curatedSymbolMap, capital, customPurchases, userCallOverrides]);

  // Filter unified calls based on Multi-Selected Dates, Scope, and Search
  const filteredCalls = useMemo(() => {
    return unifiedCalls.filter((c) => {
      if (scope === "curated" && !c.isCurated) return false;
      if (scope === "portfolio" && !c.isPortfolio) return false;

      // Multi-date selection check
      if (!selectedBatches.has("all") && selectedBatches.size > 0) {
        let matchesDate = false;
        for (const b of selectedBatches) {
          if (b === "week_1" && (c.isCurated || (c.callDate && c.callDate >= "2026-10-31"))) matchesDate = true;
          else if (b === "week_2" && (c.composite_pct ?? 0) >= 80) matchesDate = true;
          else if (c.callDate && c.callDate === b) matchesDate = true;
        }
        if (!matchesDate) return false;
      }

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
  }, [unifiedCalls, scope, search, selectedBatches]);

  // Group calls by Sector
  const sectorGroups = useMemo(() => {
    const map = new Map<string, typeof filteredCalls>();
    filteredCalls.forEach((c) => {
      const sec = c.sector || "Other";
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push(c);
    });

    const groups: { sector: string; count: number; calls: typeof filteredCalls }[] = [];
    map.forEach((calls, sector) => {
      calls.sort((a, b) => {
        if (a.isCurated && !b.isCurated) return -1;
        if (!a.isCurated && b.isCurated) return 1;
        return (b.composite_pct ?? 0) - (a.composite_pct ?? 0);
      });
      groups.push({ sector, count: calls.length, calls });
    });

    groups.sort((a, b) => a.sector.localeCompare(b.sector));
    return groups;
  }, [filteredCalls]);

  useEffect(() => {
    if (sectorGroups.length > 0 && expandedSectors.size === 0) {
      setExpandedSectors(new Set(sectorGroups.map((g) => g.sector)));
    }
  }, [sectorGroups, expandedSectors.size]);

  // Selected Call Detail
  const selectedCall = useMemo(() => {
    return filteredCalls.find((c) => c.symbol === selectedSymbol) || filteredCalls[0] || null;
  }, [filteredCalls, selectedSymbol]);

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

  const toggleBatch = (key: string) => {
    setSelectedBatches((prev) => {
      const next = new Set(prev);
      if (key === "all") {
        if (next.has("all")) next.clear();
        else {
          next.clear();
          next.add("all");
        }
        return next;
      }
      next.delete("all");
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size === 0) next.add("all");
      return next;
    });
  };

  const selectAllBatches = () => setSelectedBatches(new Set(["all"]));
  const clearAllBatches = () => setSelectedBatches(new Set(["week_1"]));

  const expandAll = () => setExpandedSectors(new Set(sectorGroups.map((g) => g.sector)));
  const collapseAll = () => setExpandedSectors(new Set());

  // Date selection button label
  const batchButtonLabel = useMemo(() => {
    if (selectedBatches.has("all")) return "📅 All Batches (Active)";
    if (selectedBatches.size === 1) {
      const key = Array.from(selectedBatches)[0];
      const found = BATCH_DEFINITIONS.find((b) => b.key === key);
      return found ? `📅 ${found.shortLabel}` : `📅 ${key}`;
    }
    return `📅 ${selectedBatches.size} Batches Selected`;
  }, [selectedBatches]);

  return (
    <div className="space-y-2.5 text-slate-900">
      {/* ── Compact Header & Multi-Select Bar ──────────────────────────────── */}
      <div className="bg-white border hairline rounded-md px-3 py-2 shadow-2xs flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <h1 className="text-base font-bold tracking-tight text-slate-900 font-sans">
            Calls Desk
          </h1>
          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
            SUN 7 PM IST BATCH
          </span>
        </div>

        {/* Multi-Select Date Picker Dropdown */}
        <div className="flex items-center gap-1.5 relative" ref={dateDropdownRef}>
          <button
            type="button"
            onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
            className="flex items-center gap-1 bg-slate-50 hover:bg-slate-100 border hairline rounded px-2 py-1 text-[11.5px] font-semibold text-slate-800 transition-colors shadow-2xs"
          >
            <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span>{batchButtonLabel}</span>
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </button>

          {isDateDropdownOpen && (
            <div className="absolute left-0 top-full mt-1 w-64 bg-white border hairline rounded-md shadow-lg z-50 p-1.5 text-[11px] space-y-1">
              <div className="flex items-center justify-between pb-1 border-b hairline px-1">
                <span className="font-bold text-slate-500 uppercase text-[9.5px]">Filter Weekly Batches</span>
                <div className="flex items-center gap-1 text-[10px]">
                  <button onClick={selectAllBatches} className="text-indigo-600 hover:underline font-semibold">
                    All
                  </button>
                  <span>•</span>
                  <button onClick={clearAllBatches} className="text-slate-500 hover:underline">
                    Reset
                  </button>
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto space-y-0.5 pt-0.5">
                <button
                  onClick={() => toggleBatch("all")}
                  className={`w-full flex items-center gap-2 px-1.5 py-1 rounded text-left hover:bg-slate-100 ${
                    selectedBatches.has("all") ? "font-bold text-indigo-700 bg-indigo-50/60" : "text-slate-700"
                  }`}
                >
                  <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                    selectedBatches.has("all") ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300"
                  }`}>
                    {selectedBatches.has("all") && <Check className="w-2.5 h-2.5" />}
                  </div>
                  <span className="truncate">All Active Deployment Batches</span>
                </button>

                {BATCH_DEFINITIONS.map((b) => {
                  const isChecked = selectedBatches.has(b.key);
                  return (
                    <button
                      key={b.key}
                      onClick={() => toggleBatch(b.key)}
                      className={`w-full flex items-center gap-2 px-1.5 py-1 rounded text-left hover:bg-slate-100 ${
                        isChecked ? "font-bold text-indigo-700 bg-indigo-50/60" : "text-slate-700"
                      }`}
                    >
                      <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                        isChecked ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300"
                      }`}>
                        {isChecked && <Check className="w-2.5 h-2.5" />}
                      </div>
                      <span className="truncate">{b.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Scope switchers */}
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => setScope("all")}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                scope === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              All ({filteredCalls.length})
            </button>
            <button
              onClick={() => setScope("curated")}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
                scope === "curated" ? "bg-indigo-700 text-white" : "bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
              }`}
            >
              <Coins className="w-3 h-3 text-amber-400" />
              <span>Top 6</span>
            </button>
            <button
              onClick={() => setScope("portfolio")}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
                scope === "portfolio" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <Wallet className="w-3 h-3" />
              <span>Held ({unifiedCalls.filter((c) => c.isPortfolio).length})</span>
            </button>
          </div>

          {/* Search bar */}
          <div className="relative ml-1">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Find stock..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-6 pr-2 py-0.5 text-[11px] rounded border hairline bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 w-32 sm:w-40"
            />
          </div>

          <button
            onClick={() => fetchData()}
            disabled={loading}
            className="p-1 rounded text-slate-600 hover:bg-slate-100 border hairline"
            title="Refresh Calls"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Two-Pane Dense Master-Detail Workstation ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)] gap-2.5 items-start">
        {/* ── Left Rail: Compact Sector Tree ─────────────────────────────────── */}
        <div className="rounded-md border hairline bg-white lg:sticky lg:top-2 lg:max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden shadow-2xs">
          <div className="px-2.5 py-1.5 border-b hairline flex items-center justify-between shrink-0 bg-slate-50/80">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-600">
              Sectors &amp; Calls
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-500 tabular-nums font-mono">
                {sectorGroups.length}s · {filteredCalls.length}c
              </span>
              <button
                type="button"
                onClick={expandedSectors.size === sectorGroups.length ? collapseAll : expandAll}
                className="text-[9.5px] text-slate-500 hover:text-slate-800 px-1 py-0.2 rounded border hairline bg-white"
              >
                {expandedSectors.size === sectorGroups.length ? "⊟" : "⊞"}
              </button>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 min-h-0 p-1 space-y-0.5">
            {sectorGroups.length === 0 ? (
              <div className="text-center py-6 px-2 text-slate-400 text-xs">No calls match filters.</div>
            ) : (
              sectorGroups.map((g) => {
                const isSecOpen = !!search.trim() || expandedSectors.has(g.sector);
                return (
                  <div key={g.sector} className="rounded border hairline bg-slate-50/30 overflow-hidden">
                    <button
                      onClick={() => toggleSector(g.sector)}
                      className="w-full flex items-center justify-between px-2 py-1 text-left text-[11px] font-bold text-slate-800 hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-1 min-w-0">
                        {isSecOpen ? (
                          <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
                        )}
                        <span className="truncate text-indigo-950 font-semibold">{g.sector}</span>
                      </div>
                      <span className="px-1 rounded text-[9px] font-mono font-semibold bg-slate-200/80 text-slate-700 shrink-0">
                        {g.count}
                      </span>
                    </button>

                    {isSecOpen && (
                      <div className="p-0.5 space-y-0.5 border-t hairline bg-white">
                        {g.calls.map((call) => {
                          const isSel = selectedCall?.symbol === call.symbol;
                          const callMove = call.callPerfPct;
                          return (
                            <button
                              key={call.symbol}
                              onClick={() => setSelectedSymbol(call.symbol)}
                              className={`w-full flex items-center justify-between px-2 py-1 rounded text-left transition-all ${
                                isSel
                                  ? "bg-slate-900 text-white shadow-2xs"
                                  : "hover:bg-slate-100/80 text-slate-900"
                              }`}
                            >
                              <div className="min-w-0 flex-1 pr-1.5">
                                <div className="flex items-center gap-1">
                                  <span className="font-mono font-bold text-[11.5px]">{call.symbol}</span>
                                  {call.isCurated && (
                                    <span
                                      className={`text-[8.5px] font-bold px-1 rounded ${
                                        isSel ? "bg-amber-400 text-slate-950" : "bg-amber-100 text-amber-900"
                                      }`}
                                    >
                                      ★ TOP6
                                    </span>
                                  )}
                                  {call.isPortfolio && (
                                    <span
                                      className={`text-[8.5px] font-bold px-1 rounded ${
                                        isSel ? "bg-blue-400 text-slate-950" : "bg-blue-100 text-blue-900"
                                      }`}
                                    >
                                      P
                                    </span>
                                  )}
                                </div>
                                <div className={`text-[10px] truncate ${isSel ? "text-slate-300" : "text-slate-500"}`}>
                                  {call.name}
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                <div className="font-mono font-bold text-[11px]">{money(call.cmp)}</div>
                                <div className="flex items-center justify-end gap-1">
                                  {callMove != null ? (
                                    <span
                                      className={`text-[9.5px] font-mono font-semibold ${
                                        callMove >= 0
                                          ? isSel ? "text-emerald-400" : "text-emerald-700"
                                          : isSel ? "text-rose-400" : "text-rose-600"
                                      }`}
                                    >
                                      {pct(callMove)}
                                    </span>
                                  ) : null}
                                  <span
                                    className={`px-1 rounded text-[8px] font-bold uppercase ${
                                      isSel ? "bg-white/20 text-white" : actionBadgeClass(call.actionToday)
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

        {/* ── Right Panel: Compact Detail & Workstation ─────────────────────── */}
        <div className="space-y-2.5 min-w-0">
          {!selectedCall ? (
            <div className="bg-white border hairline rounded-md p-8 text-center text-slate-400 text-xs">
              Select a stock from the left rail to view details.
            </div>
          ) : (
            <>
              {/* Header Bar */}
              <div className="bg-white border hairline rounded-md p-2.5 shadow-2xs flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <h2 className="text-lg font-bold font-mono tracking-tight text-slate-900">
                    {selectedCall.symbol}
                  </h2>
                  <span className="text-xs text-slate-700 font-medium truncate max-w-xs">
                    {selectedCall.name}
                  </span>
                  <CapTierBadge category={selectedCall.market_cap_category as CapCategory} />
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200">
                    {selectedCall.sector}
                  </span>
                  {selectedCall.isCurated && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      ★ ₹1L Curated Pick
                    </span>
                  )}
                  {selectedCall.isPortfolio && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-300">
                      Held: {selectedCall.heldQty} sh
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <span className="text-lg font-bold font-mono text-slate-900">
                      {money(selectedCall.cmp)}
                    </span>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold border ${actionBadgeClass(selectedCall.actionToday)}`}>
                    {selectedCall.actionToday}
                  </span>

                  <button
                    onClick={() => handleTakeCall(selectedCall.symbol)}
                    disabled={selectedCall.isTaken}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors flex items-center gap-1 ${
                      selectedCall.isTaken
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-300"
                        : "bg-emerald-600 hover:bg-emerald-700 text-white"
                    }`}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{selectedCall.isTaken ? "Taken" : "Take"}</span>
                  </button>

                  <button
                    onClick={() => handleExitCall(selectedCall.symbol)}
                    disabled={selectedCall.isCleared}
                    className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 border hairline"
                  >
                    {selectedCall.isCleared ? "Closed" : "Exit"}
                  </button>

                  <Link
                    href={`/stock/${selectedCall.symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded text-indigo-600 hover:bg-indigo-50 border border-indigo-200"
                    title="Open Full Stock Page"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>

              {/* ── ⭐ DUAL-ANCHOR PERFORMANCE (COMPACT 2-COLUMN COMPARISON) ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {/* ANCHOR 1: CALL GIVEN */}
                <div className="bg-slate-50/70 border border-indigo-100 rounded-md p-2.5 shadow-2xs space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 font-bold text-indigo-950">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                      <span>ANCHOR 1: CALL GIVEN</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">
                      Released: {fmtDate(selectedCall.callDate)} ({daysAgo(selectedCall.callDate)})
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-indigo-100/80">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Anchor Call Price</span>
                      <span className="text-[13px] font-bold font-mono text-slate-900">{money(selectedCall.callPrice)}</span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Return Since Call</span>
                      <div className="flex items-center justify-end gap-1">
                        <span className={`text-[14px] font-bold font-mono ${(selectedCall.callPerfPct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                          {pct(selectedCall.callPerfPct)}
                        </span>
                        {selectedCall.callPrice && (
                          <span className="text-[10.5px] font-mono text-slate-500">
                            ({selectedCall.cmp >= selectedCall.callPrice ? "+" : ""}{money(selectedCall.cmp - selectedCall.callPrice)})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ANCHOR 2: USER PURCHASE */}
                <div className="bg-slate-50/70 border border-emerald-100 rounded-md p-2.5 shadow-2xs space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 font-bold text-emerald-950">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                      <span>ANCHOR 2: STOCK PURCHASE</span>
                    </div>
                    <button
                      onClick={() => setIsEditingPurchase(!isEditingPurchase)}
                      className="text-[10.5px] font-semibold text-emerald-800 hover:text-emerald-950 inline-flex items-center gap-1 underline underline-offset-2"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>{selectedCall.purchasePrice ? "Edit" : "Log Buy"}</span>
                    </button>
                  </div>

                  {isEditingPurchase ? (
                    <div className="bg-white p-2 rounded border border-emerald-300 space-y-1.5">
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <label className="block text-slate-500 text-[10px] font-bold">Buy Date</label>
                          <input
                            type="date"
                            value={editPurchaseDate}
                            onChange={(e) => setEditPurchaseDate(e.target.value)}
                            className="w-full px-1.5 py-0.5 text-xs border rounded bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-500 text-[10px] font-bold">Buy Price (₹)</label>
                          <input
                            type="number"
                            step="0.05"
                            value={editPurchasePrice}
                            onChange={(e) => setEditPurchasePrice(e.target.value)}
                            className="w-full px-1.5 py-0.5 text-xs border rounded bg-white font-mono"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-1 pt-1">
                        <button onClick={() => setIsEditingPurchase(false)} className="px-2 py-0.2 text-[10.5px] text-slate-600">
                          Cancel
                        </button>
                        {customPurchases[selectedCall.symbol] && (
                          <button onClick={() => clearCustomPurchase(selectedCall.symbol)} className="px-2 py-0.2 text-[10.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded">
                            Reset
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const p = parseFloat(editPurchasePrice);
                            if (!Number.isNaN(p) && p > 0 && editPurchaseDate) saveCustomPurchase(selectedCall.symbol, editPurchaseDate, p);
                          }}
                          className="px-2.5 py-0.2 text-[10.5px] font-bold text-white bg-emerald-700 rounded"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between pt-1 border-t border-emerald-100/80">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Purchase Price</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-bold font-mono text-slate-900">
                            {selectedCall.purchasePrice ? money(selectedCall.purchasePrice) : "—"}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {selectedCall.purchaseDate ? `(${fmtDate(selectedCall.purchaseDate)})` : "(Not Owned)"}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Return Since Purchase</span>
                        {selectedCall.purchasePerfPct != null ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className={`text-[14px] font-bold font-mono ${selectedCall.purchasePerfPct >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                              {pct(selectedCall.purchasePerfPct)}
                            </span>
                            {selectedCall.purchasePrice && (
                              <span className="text-[10.5px] font-mono text-slate-500">
                                ({selectedCall.cmp >= selectedCall.purchasePrice ? "+" : ""}{money(selectedCall.cmp - selectedCall.purchasePrice)})
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Pending Entry</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Key Decision Levels (Dense Single Bar) ───────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white border hairline rounded-md p-2 shadow-2xs text-[11px]">
                <div className="px-2 py-1 bg-slate-50/70 rounded">
                  <div className="text-[9.5px] uppercase font-bold text-slate-400">Current CMP</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">{money(selectedCall.cmp)}</div>
                </div>

                <div className="px-2 py-1 bg-slate-50/70 rounded">
                  <div className="text-[9.5px] uppercase font-bold text-slate-400">Buy Below Ceiling</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-sm font-bold font-mono text-slate-900">{money(selectedCall.buyBelow)}</span>
                    {selectedCall.cmp <= selectedCall.buyBelow * 1.01 ? (
                      <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1 rounded">In Zone</span>
                    ) : (
                      <span className="text-[9px] font-semibold text-amber-700 bg-amber-100 px-1 rounded">Wait</span>
                    )}
                  </div>
                </div>

                <div className="px-2 py-1 bg-slate-50/70 rounded">
                  <div className="text-[9.5px] uppercase font-bold text-slate-400">12M Target</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-sm font-bold font-mono text-emerald-700">{money(selectedCall.target)}</span>
                    <span className="text-[10px] font-bold font-mono text-emerald-700">(+{selectedCall.upside}%)</span>
                  </div>
                </div>

                <div className="px-2 py-1 bg-slate-50/70 rounded">
                  <div className="text-[9.5px] uppercase font-bold text-slate-400">Stop Loss / Floor</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-sm font-bold font-mono text-rose-600">{money(selectedCall.stopLoss)}</span>
                    <span className="text-[9.5px] text-slate-400 font-mono">
                      (-{Math.round(((selectedCall.cmp - selectedCall.stopLoss) / selectedCall.cmp) * 100)}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Sub-Tabs: Sizing, Results, Dividends, News, Audit ─────────── */}
              <div className="bg-white border hairline rounded-md shadow-2xs overflow-hidden">
                <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-1 border-b hairline bg-slate-50/80 overflow-x-auto text-[11px]">
                  <button
                    onClick={() => setActiveTab("overview")}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1 shrink-0 ${
                      activeTab === "overview" ? "bg-indigo-700 text-white shadow-2xs" : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <Coins className="w-3 h-3" />
                    <span>Sizing &amp; Tranches</span>
                  </button>

                  <button
                    onClick={() => setActiveTab("results")}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1 shrink-0 ${
                      activeTab === "results" ? "bg-indigo-700 text-white shadow-2xs" : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <FileText className="w-3 h-3" />
                    <span>Results ({contextData?.results?.length ?? 0})</span>
                  </button>

                  <button
                    onClick={() => setActiveTab("dividends")}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1 shrink-0 ${
                      activeTab === "dividends" ? "bg-indigo-700 text-white shadow-2xs" : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <DollarSign className="w-3 h-3" />
                    <span>Dividends ({contextData?.dividends?.length ?? 0})</span>
                  </button>

                  <button
                    onClick={() => setActiveTab("news")}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1 shrink-0 ${
                      activeTab === "news" ? "bg-indigo-700 text-white shadow-2xs" : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <Newspaper className="w-3 h-3" />
                    <span>News ({contextData?.news?.length ?? 0})</span>
                  </button>

                  <button
                    onClick={() => setActiveTab("audit")}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1 shrink-0 ${
                      activeTab === "audit" ? "bg-indigo-700 text-white shadow-2xs" : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <CheckSquare className="w-3 h-3" />
                    <span>Audit &amp; Governance</span>
                  </button>
                </div>

                <div className="p-2.5">
                  {/* TAB 1: OVERVIEW & SIZING */}
                  {activeTab === "overview" && (
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-slate-800">
                          ₹1L Deployment: {selectedCall.weightPct}% Allocation ({money(selectedCall.allocatedAmount)})
                        </span>
                        <span className="text-slate-600">
                          Target Value: <strong className="text-emerald-700 font-mono">{money(selectedCall.projectedValue)}</strong> (+{money(selectedCall.profitRupees)})
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                        <div className="p-2 rounded border border-indigo-100 bg-indigo-50/40">
                          <div className="font-bold text-indigo-950 flex justify-between">
                            <span>Tranche 1 (Market Order Today)</span>
                            <span className="font-mono text-indigo-700">~{money(selectedCall.t1Value)}</span>
                          </div>
                          <p className="text-slate-600 mt-0.5">
                            Buy <strong>{selectedCall.tranche1Shares} sh</strong> @ CMP ({money(selectedCall.cmp)}) to establish primary position.
                          </p>
                        </div>

                        <div className="p-2 rounded border border-amber-200 bg-amber-50/40">
                          <div className="font-bold text-amber-950 flex justify-between">
                            <span>Tranche 2 (Dip Limit)</span>
                            <span className="font-mono text-amber-800">~{money(selectedCall.t2Value)}</span>
                          </div>
                          <p className="text-slate-600 mt-0.5">
                            Place limit GTT for <strong>{selectedCall.tranche2Shares} sh</strong> ≤ {money(selectedCall.buyBelow)} to average down.
                          </p>
                        </div>
                      </div>

                      <div className="pt-1 border-t hairline">
                        <span className="text-[10px] font-bold uppercase text-slate-500 block mb-0.5">Operating Rationale &amp; Catalyst</span>
                        <p className="text-[11.5px] leading-relaxed text-slate-800 bg-slate-50/60 p-2 rounded border hairline">
                          {selectedCall.rationale}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: RESULTS DECLARATIONS */}
                  {activeTab === "results" && (
                    <div className="space-y-1.5 text-xs">
                      {contextLoading ? (
                        <div className="py-4 text-center text-xs text-slate-400">Loading results filings…</div>
                      ) : !contextData?.results || contextData.results.length === 0 ? (
                        <div className="py-4 text-center text-xs text-slate-400">No recent result announcements.</div>
                      ) : (
                        <div className="space-y-1 max-h-56 overflow-y-auto">
                          {contextData.results.map((r, idx) => (
                            <div key={idx} className="p-2 rounded border hairline bg-slate-50/50 hover:bg-slate-50 flex items-start justify-between gap-2 text-[11px]">
                              <div className="space-y-0.5 min-w-0">
                                <div className="font-semibold text-slate-900 leading-snug truncate">{r.title}</div>
                                {r.headline && <p className="text-slate-600 text-[10px] line-clamp-1">{r.headline}</p>}
                                <div className="text-[9.5px] text-slate-400 font-mono">
                                  {fmtDate(r.published_at)} ({daysAgo(r.published_at)})
                                </div>
                              </div>
                              {r.pdf_url && (
                                <a
                                  href={r.pdf_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-semibold shrink-0 flex items-center gap-1"
                                >
                                  <span>PDF</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 3: DIVIDENDS */}
                  {activeTab === "dividends" && (
                    <div className="text-xs">
                      {contextLoading ? (
                        <div className="py-4 text-center text-xs text-slate-400">Loading dividends…</div>
                      ) : !contextData?.dividends || contextData.dividends.length === 0 ? (
                        <div className="py-4 text-center text-xs text-slate-400">No dividend corporate actions found.</div>
                      ) : (
                        <div className="overflow-x-auto max-h-56">
                          <table className="w-full text-[11px] text-left">
                            <thead className="bg-slate-50 text-slate-600 font-bold border-b hairline">
                              <tr>
                                <th className="py-1 px-2">Ex-Date</th>
                                <th className="py-1 px-2">Purpose</th>
                                <th className="py-1 px-2 text-right">Dividend (₹)</th>
                                <th className="py-1 px-2 text-right">Yield @ CMP</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y hairline">
                              {contextData.dividends.map((d, idx) => {
                                const yieldPct = d.amount && selectedCall.cmp > 0 ? ((d.amount / selectedCall.cmp) * 100).toFixed(2) : "—";
                                return (
                                  <tr key={idx} className="hover:bg-slate-50/50">
                                    <td className="py-1 px-2 font-mono font-medium text-slate-900">{fmtDate(d.ex_date)}</td>
                                    <td className="py-1 px-2 text-slate-800">{d.purpose}</td>
                                    <td className="py-1 px-2 text-right font-mono font-bold text-emerald-700">
                                      {d.amount != null ? `₹${d.amount.toFixed(2)}` : "—"}
                                    </td>
                                    <td className="py-1 px-2 text-right font-mono text-slate-600">
                                      {yieldPct !== "—" ? `${yieldPct}%` : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 4: NEWS */}
                  {activeTab === "news" && (
                    <div className="text-xs">
                      {contextLoading ? (
                        <div className="py-4 text-center text-xs text-slate-400">Loading news…</div>
                      ) : !contextData?.news || contextData.news.length === 0 ? (
                        <div className="py-4 text-center text-xs text-slate-400">No news articles found.</div>
                      ) : (
                        <div className="space-y-1 max-h-56 overflow-y-auto">
                          {contextData.news.map((item, idx) => (
                            <div key={idx} className="p-1.5 rounded border hairline bg-slate-50/40 hover:bg-slate-50 flex items-start justify-between gap-2 text-[11px]">
                              <div className="space-y-0.5 min-w-0">
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-semibold text-slate-900 hover:text-indigo-600 line-clamp-1"
                                >
                                  {item.title}
                                </a>
                                <div className="flex items-center gap-1.5 text-[9.5px] text-slate-400">
                                  <span className="px-1 rounded bg-slate-200/70 font-medium text-slate-700">{item.source}</span>
                                  <span>{fmtDate(item.published_at)}</span>
                                  <span>•</span>
                                  <span>{daysAgo(item.published_at)}</span>
                                </div>
                              </div>
                              <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-indigo-600 shrink-0">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 5: AUDIT */}
                  {activeTab === "audit" && (
                    <div className="space-y-2 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                        <div className="p-2 rounded border hairline bg-slate-50/50">
                          <span className="text-[9.5px] uppercase font-bold text-slate-400 block">Statutory Audit</span>
                          <span className="font-bold text-slate-900 block mt-0.5">
                            {contextData?.audit?.audited_filing_status || "Audited Standalone & Consolidated"}
                          </span>
                          <p className="text-[10px] text-slate-500 mt-0.5">Unmodified clean audit opinion with no adverse qualifications.</p>
                        </div>

                        <div className="p-2 rounded border hairline bg-slate-50/50">
                          <span className="text-[9.5px] uppercase font-bold text-slate-400 block">Forensics &amp; Accruals</span>
                          <span className="font-bold text-emerald-700 block mt-0.5">
                            {contextData?.audit?.forensic_status || "Low Forensic Risk / Clean Accruals"}
                          </span>
                          <p className="text-[10px] text-slate-500 mt-0.5">Cash flow reconciles with PAT; healthy accruals.</p>
                        </div>
                      </div>

                      <div className="p-2 rounded border border-indigo-100 bg-indigo-50/30 text-[11px]">
                        <div className="font-bold text-indigo-950 flex justify-between">
                          <span>Valuation Regime</span>
                          <span className="font-mono text-indigo-700 text-[10px]">
                            {contextData?.audit?.valuation_method || "Multi-Factor Cycle Normalized"}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1 pt-1 font-mono text-[10.5px]">
                          <div>Target: <strong className="text-indigo-800">{money(selectedCall.target)}</strong></div>
                          <div>Buy Below: <strong className="text-indigo-800">{money(selectedCall.buyBelow)}</strong></div>
                          <div>Floor: <strong className="text-rose-700">{money(selectedCall.stopLoss)}</strong></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Interactive Price Chart ──────────────────────────────────── */}
              <div className="bg-white border hairline rounded-md p-2.5 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800">
                    <TrendingUp className="w-3.5 h-3.5 text-slate-600" />
                    <span>Price Chart &amp; Moving Averages</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Scroll/drag to inspect levels</span>
                </div>
                <div className="w-full h-[290px] overflow-hidden">
                  <PriceChart symbol={selectedCall.symbol} />
                </div>
              </div>

              {/* ── Multi-Factor Pillars (Ultra-Compact Single Row) ─────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white border hairline rounded-md p-2 shadow-2xs text-[10.5px]">
                <div className="px-2 py-1 rounded bg-slate-50/50">
                  <div className="flex justify-between mb-0.5">
                    <span className="text-slate-500 font-medium">Composite</span>
                    <span className="font-bold font-mono text-slate-900">{selectedCall.composite_pct}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1 overflow-hidden">
                    <div className="bg-indigo-600 h-1 rounded-full" style={{ width: `${selectedCall.composite_pct}%` }} />
                  </div>
                </div>

                <div className="px-2 py-1 rounded bg-slate-50/50">
                  <div className="flex justify-between mb-0.5">
                    <span className="text-slate-500 font-medium">Quality</span>
                    <span className="font-bold font-mono text-slate-900">{selectedCall.quality_pct}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1 overflow-hidden">
                    <div className="bg-emerald-600 h-1 rounded-full" style={{ width: `${selectedCall.quality_pct}%` }} />
                  </div>
                </div>

                <div className="px-2 py-1 rounded bg-slate-50/50">
                  <div className="flex justify-between mb-0.5">
                    <span className="text-slate-500 font-medium">Valuation</span>
                    <span className="font-bold font-mono text-slate-900">{selectedCall.valuation_pct}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1 overflow-hidden">
                    <div className="bg-cyan-600 h-1 rounded-full" style={{ width: `${selectedCall.valuation_pct}%` }} />
                  </div>
                </div>

                <div className="px-2 py-1 rounded bg-slate-50/50">
                  <div className="flex justify-between mb-0.5">
                    <span className="text-slate-500 font-medium">Momentum</span>
                    <span className="font-bold font-mono text-slate-900">{selectedCall.momentum_pct}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1 overflow-hidden">
                    <div className="bg-purple-600 h-1 rounded-full" style={{ width: `${selectedCall.momentum_pct}%` }} />
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
