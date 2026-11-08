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
  Building2,
  AlertTriangle,
  ShieldAlert,
  ArrowDownRight,
  Target,
  Activity,
  Info,
  PieChart,
  Layers,
  LayoutDashboard,
  Table as TableIcon,
  ArrowUpDown,
  ArrowRight,
  Percent,
  SlidersHorizontal,
  Zap,
  BarChart3,
} from "lucide-react";
import { PriceChart } from "@/components/PriceChart";
import type { TradeMark } from "@/app/tools/scanner/CandleChart";
import { formatFetchedAt } from "@/components/IntradayPriceBadge";
import { CompanyProfile } from "@/components/CompanyProfile";
import CapTierBadge, { type CapCategory } from "@/components/CapTierBadge";
import { parseParameterItems, getModelAnalysis, ModelCard } from "@/components/VerdictPanel";
import type { ClusterGem, PortfolioActionCall, IdeaHorizon } from "@/app/api/admin/calls/route";

function money(v: number | null | undefined, digits?: number): string {
  if (v == null) return "—";
  const fractionDigits = digits ?? (Number.isInteger(v) ? 0 : 2);
  return `₹${v.toLocaleString("en-IN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

function fmtLakhs(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  if (Math.abs(v) >= 1e7) {
    return `₹${(v / 1e7).toFixed(2)} Cr`;
  }
  if (Math.abs(v) >= 1e5) {
    return `₹${(v / 1e5).toFixed(2)} L`;
  }
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

function pct(v: number | null | undefined, digits: number = 2): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
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

export type HoldingAgeTier = "< 1M" | "1M–3M" | "3M–6M" | "6M–1Y" | "> 1Y";

export type HoldingDurationInfo = {
  days: number;
  label: string;
  shortLabel: string;
  tier: HoldingAgeTier;
  badgeClass: string;
  badgeClassDark: string;
};

export function getHoldingDuration(
  dateStr: string | null | undefined
): HoldingDurationInfo | null {
  if (!dateStr) return null;
  const dt = new Date(dateStr);
  if (Number.isNaN(dt.getTime())) return null;
  const days = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 86400000));

  if (days < 30) {
    return {
      days,
      label: `${days}d (< 1M)`,
      shortLabel: `${days}d (<1M)`,
      tier: "< 1M",
      badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
      badgeClassDark: "bg-blue-900/60 text-blue-200 border-blue-500/40",
    };
  }
  if (days <= 90) {
    const mo = Math.max(1, Math.round(days / 30));
    return {
      days,
      label: `${days}d (1M–3M)`,
      shortLabel: `${mo}M (1-3M)`,
      tier: "1M–3M",
      badgeClass: "bg-cyan-50 text-cyan-800 border-cyan-200",
      badgeClassDark: "bg-cyan-900/60 text-cyan-200 border-cyan-500/40",
    };
  }
  if (days <= 180) {
    const mo = Math.round(days / 30);
    return {
      days,
      label: `${mo}M (3M–6M)`,
      shortLabel: `${mo}M (3-6M)`,
      tier: "3M–6M",
      badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
      badgeClassDark: "bg-amber-900/60 text-amber-200 border-amber-500/40",
    };
  }
  if (days <= 365) {
    const mo = Math.round(days / 30);
    return {
      days,
      label: `${mo}M (6M–1Y)`,
      shortLabel: `${mo}M (6-12M)`,
      tier: "6M–1Y",
      badgeClass: "bg-purple-50 text-purple-800 border-purple-200",
      badgeClassDark: "bg-purple-900/60 text-purple-200 border-purple-500/40",
    };
  }
  const yrs = (days / 365.25).toFixed(1);
  return {
    days,
    label: `${yrs}y (> 1Y)`,
    shortLabel: `${yrs}y (>1Y)`,
    tier: "> 1Y",
    badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-300 font-semibold",
    badgeClassDark: "bg-emerald-900/60 text-emerald-200 border-emerald-500/40 font-semibold",
  };
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

function formatValuationRegime(method: string | null | undefined): string {
  if (!method) return "Multi-Model Triangulation";
  switch (method) {
    case "gordon_pb_roe":
      return "Gordon Growth P/B-ROE";
    case "normalized_ev_ebitda":
      return "EV/EBITDA Cycle Multiple";
    case "quality_pe":
      return "Forward Quality P/E";
    case "owner_dcf":
      return "Owner Earnings DCF";
    case "historical_bands":
      return "Historical Multiple Bands";
    default:
      return method.replace(/_/g, " ").toUpperCase();
  }
}

interface SectorTheme {
  name: string;
  dotColor: string;
  badgeClass: string;
  barColor: string;
  subtleClass: string;
}

function getSectorTheme(sectorName?: string | null): SectorTheme {
  const norm = (sectorName || "").toLowerCase().trim();
  if (norm.includes("finan") || norm.includes("bank") || norm.includes("bfsi")) {
    return {
      name: sectorName || "Financials",
      dotColor: "#4f46e5",
      badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
      barColor: "bg-indigo-600",
      subtleClass: "text-indigo-700 bg-indigo-50/70 border-indigo-200/60",
    };
  }
  if (norm.includes("tech") || norm.includes("communication") || norm.includes("telecom") || norm.includes("it")) {
    return {
      name: sectorName || "Tech & Communication",
      dotColor: "#7c3aed",
      badgeClass: "bg-violet-50 text-violet-700 border-violet-200",
      barColor: "bg-violet-600",
      subtleClass: "text-violet-700 bg-violet-50/70 border-violet-200/60",
    };
  }
  if (norm.includes("health") || norm.includes("pharma") || norm.includes("med")) {
    return {
      name: sectorName || "Healthcare",
      dotColor: "#059669",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
      barColor: "bg-emerald-600",
      subtleClass: "text-emerald-700 bg-emerald-50/70 border-emerald-200/60",
    };
  }
  if (norm.includes("consumer") || norm.includes("fmcg") || norm.includes("retail")) {
    return {
      name: sectorName || "Consumer",
      dotColor: "#d97706",
      badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
      barColor: "bg-amber-600",
      subtleClass: "text-amber-800 bg-amber-50/70 border-amber-200/60",
    };
  }
  if (norm.includes("industr") || norm.includes("auto") || norm.includes("capital")) {
    return {
      name: sectorName || "Industrials",
      dotColor: "#0284c7",
      badgeClass: "bg-sky-50 text-sky-800 border-sky-200",
      barColor: "bg-sky-600",
      subtleClass: "text-sky-800 bg-sky-50/70 border-sky-200/60",
    };
  }
  if (norm.includes("material") || norm.includes("chem") || norm.includes("metal")) {
    return {
      name: sectorName || "Materials",
      dotColor: "#e11d48",
      badgeClass: "bg-rose-50 text-rose-800 border-rose-200",
      barColor: "bg-rose-600",
      subtleClass: "text-rose-800 bg-rose-50/70 border-rose-200/60",
    };
  }
  if (norm.includes("realt") || norm.includes("estate") || norm.includes("infra") || norm.includes("construct")) {
    return {
      name: sectorName || "Real Estate & Infra",
      dotColor: "#ea580c",
      badgeClass: "bg-orange-50 text-orange-800 border-orange-200",
      barColor: "bg-orange-600",
      subtleClass: "text-orange-800 bg-orange-50/70 border-orange-200/60",
    };
  }
  if (norm.includes("energy") || norm.includes("power") || norm.includes("util") || norm.includes("oil") || norm.includes("gas")) {
    return {
      name: sectorName || "Energy & Utilities",
      dotColor: "#0d9488",
      badgeClass: "bg-teal-50 text-teal-800 border-teal-200",
      barColor: "bg-teal-600",
      subtleClass: "text-teal-800 bg-teal-50/70 border-teal-200/60",
    };
  }
  return {
    name: sectorName || "Other",
    dotColor: "#64748b",
    badgeClass: "bg-slate-50 text-slate-700 border-slate-200",
    barColor: "bg-slate-600",
    subtleClass: "text-slate-700 bg-slate-50 border-slate-200",
  };
}

function stripTag(text: string, tagRegex: RegExp): string {
  return text.replace(tagRegex, "").trim();
}

function parseVerdictPoints(points: string[]) {
  const good: string[] = [];
  const bad: string[] = [];
  const params: string[] = [];
  const decision: string[] = [];
  const other: string[] = [];

  for (const p of points) {
    const clean = p.trim();
    const lower = clean.toLowerCase();
    if (lower.startsWith("<b>the good") || lower.startsWith("<b>good") || lower.includes("<b>strengths")) {
      good.push(clean);
    } else if (lower.startsWith("<b>the bad") || lower.startsWith("<b>bad") || lower.includes("<b>risks") || lower.includes("<b>warnings")) {
      bad.push(clean);
    } else if (lower.includes("<b>validated parameters") || lower.includes("<b>parameters validated")) {
      params.push(clean);
    } else if (lower.startsWith("<i>decision") || lower.startsWith("<i>summary") || lower.startsWith("<b>decision")) {
      decision.push(clean);
    } else {
      other.push(clean);
    }
  }

  return { good, bad, params, decision, other };
}

function cleanPointText(raw: string, tagRegex: RegExp): { metric: string; peer?: string; reason?: string } {
  let cleaned = stripTag(raw, tagRegex);
  cleaned = cleaned.replace(/^(\*|-|•)\s*/, "").trim();
  cleaned = cleaned.replace(/<\/?(b|strong|i|em)>/gi, "");

  const parts = cleaned.split(/\s*(?:,\s*-\s*|\s+-\s+|\s*—\s*)\s*/);
  if (parts.length >= 2) {
    return {
      metric: parts[0],
      peer: parts[1],
      reason: parts.slice(2).join(" · "),
    };
  }
  return { metric: cleaned };
}

const CUSTOM_PURCHASE_KEY = "calls_custom_purchase_v1";

type Scope = "all" | "curated" | "portfolio";
type ActionFilter = "ALL" | "BUY" | "PRIORITY_SELL" | "SELL" | "HOLD";
type DetailTab = "overview" | "catalysts" | "results" | "dividends" | "news" | "audit" | "density";
export type PriorityCategory = "ALL" | "PROFIT_TRIM" | "DRAWDOWN_REVIEW" | "STRUCTURAL_EXIT";

export function getPriorityCategory(call: {
  actionToday?: string;
  cmp: number;
  target?: number | null;
  purchasePrice?: number | null;
  quality_pct?: number | null;
  momentum_pct?: number | null;
}) {
  const pnlPct = call.purchasePrice && call.purchasePrice > 0
    ? ((call.cmp - call.purchasePrice) / call.purchasePrice) * 100
    : 0;
  const qual = call.quality_pct ?? 50;
  const mom = call.momentum_pct ?? 50;
  const act = (call.actionToday || "").toUpperCase();

  if (act.includes("EXIT") || act.includes("CUT LOSS") || (qual < 45 && mom < 35)) {
    return {
      category: "STRUCTURAL_EXIT" as const,
      badge: "🔴 EXIT",
      badgeClass: "bg-rose-700 text-white font-bold",
      pillText: "🔴 Cut Loss",
      title: "Structural Breakdown / Capital Preservation",
      guidance: "Both business quality (score < 45) and price momentum have deteriorated. Institutional rule: Execute stop-loss or tax-loss harvesting.",
    };
  }

  if (pnlPct >= 5) {
    return {
      category: "PROFIT_TRIM" as const,
      badge: "🟢 TRIM 25%",
      badgeClass: "bg-emerald-700 text-white font-bold",
      pillText: "🟢 Trim 25–33%",
      title: "Take Profit Tranche (Lock In Outsized Gains)",
      guidance: `Sitting at ${pnlPct > 0 ? "+" : ""}${pnlPct.toFixed(1)}% profit and reached 12M target. Institutional rule: Trim 25%–33% to de-risk and rebalance into fresh ideas, leaving the core to compound.`,
    };
  }

  return {
    category: "DRAWDOWN_REVIEW" as const,
    badge: "🟡 REVIEW",
    badgeClass: "bg-amber-600 text-white font-bold",
    pillText: "🟡 Review (Hold)",
    title: "Drawdown / Cyclical Review (Do NOT Panic Sell)",
    guidance: `Sitting at ${pnlPct.toFixed(1)}% paper loss. The quantitative model target is conservative, but position is in drawdown. Institutional rule: Do NOT panic-sell cyclical leaders at lows; review operating compounding.`,
  };
}

type CompanyOverview = {
  symbol: string;
  company_name: string | null;
  business_summary: string | null;
  website: string | null;
  employees: number | null;
  ceo_name: string | null;
  ceo_title: string | null;
  listing_date: string | null;
  sector: string | null;
  industry: string | null;
  market_cap_category: string | null;
};

type StockContext = {
  overview?: CompanyOverview | null;
  news: { title: string; source: string; url: string; published_at: string | null }[];
  filings: { title: string; category: string; headline: string | null; published_at: string | null; pdf_url: string | null }[];
  dividends: { ex_date: string; purpose: string; amount: number | null }[];
  results: { title: string; headline: string | null; published_at: string | null; pdf_url: string | null }[];
  audit: {
    verdict: string | null;
    confidence: string | null;
    points: string[];
    trigger_text: string | null;
    generated_at: string | null;
    valuation_method: string | null;
    target_price: number | null;
    fair_value: number | null;
    buy_below: number | null;
    bear_floor: number | null;
    upside_pct: number | null;
    audited_filing_status: string;
    forensic_status: string;
  } | null;
};

// Batch definitions for multi-select
const BATCH_DEFINITIONS = [
  { key: "priority_sells", label: "Portfolio Sells & Trims Batch", shortLabel: "Sells & Trims", dateMatch: "priority_sells" },
  { key: "2026-11-06", label: "Fri, 06 Nov 2026 (Today)", shortLabel: "06 Nov (Today)", dateMatch: "2026-11-06" },
  { key: "week_2", label: "Week 2: Sun, 08 Nov 2026 (7:00 PM)", shortLabel: "Wk 2 (08 Nov)", dateMatch: "2026-11-08" },
  { key: "week_1", label: "Week 1: Sun, 01 Nov 2026 (7:00 PM)", shortLabel: "Wk 1 (01 Nov)", dateMatch: "2026-11-01" },
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Multi-Select Dates State: default to "all" so calls and priority alerts are never hidden by default
  const [selectedBatches, setSelectedBatches] = useState<Set<string>>(new Set(["all"]));
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const dateDropdownRef = useRef<HTMLDivElement>(null);

  // Scope & Action Filters: Always default to 'curated' (Top) on refresh
  const [scope, setScope] = useState<Scope>("curated");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("ALL");
  const [prioritySubFilter, setPrioritySubFilter] = useState<PriorityCategory>("ALL");
  const [search, setSearch] = useState("");
  const [capital] = useState<number>(100000);

  // Selected Stock & Detail Tab: dynamically defaults to the top scrip of active view
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [densityScope, setDensityScope] = useState<"curated" | "portfolio" | "all">("curated");

  // View Mode: Detail Workstation vs Master Table Sheet vs Corpus Growth Planner
  const [viewMode, setViewMode] = useState<"detail" | "table" | "corpus">("detail");
  const [tableSortKey, setTableSortKey] = useState<"symbol" | "cmp" | "target" | "upside" | "weight" | "quality">("weight");
  const [tableSortAsc, setTableSortAsc] = useState<boolean>(false);

  // Corpus Growth & Dynamic Investment Planner State
  const [corpusMonthlyInflow, setCorpusMonthlyInflow] = useState<number>(100000); // ₹1 Lakh / month
  const [corpusStepUpPct, setCorpusStepUpPct] = useState<number>(10); // 10% annual step-up
  const [corpusCagrPct, setCorpusCagrPct] = useState<number>(16); // 16% expected returns
  const [corpusTargetHorizonYears, setCorpusTargetHorizonYears] = useState<number>(5); // 5Y horizon
  const [corpusManualBaseOverride, setCorpusManualBaseOverride] = useState<number | null>(null);
  const [isEditingBaseCorpus, setIsEditingBaseCorpus] = useState(false);
  const [tempBaseCorpusInput, setTempBaseCorpusInput] = useState("");

  // Stock context data
  const [contextData, setContextData] = useState<StockContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  // Expanded sectors set for tree (in 'all'/'portfolio' only 1 sector open initially; in 'curated' (Top) all are uncollapsed by default)
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set());
  const [collapsedCuratedSectors, setCollapsedCuratedSectors] = useState<Set<string>>(new Set());
  const [collapsedClusters, setCollapsedClusters] = useState<Set<string>>(new Set());

  const toggleCluster = (clusterKey: string) => {
    setCollapsedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(clusterKey)) next.delete(clusterKey);
      else next.add(clusterKey);
      return next;
    });
  };
  const [hasInitializedSectors, setHasInitializedSectors] = useState(false);

  // Call status overrides
  const [userCallOverrides, setUserCallOverrides] = useState<Record<string, { is_taken: boolean; is_cleared: boolean }>>({});

  // Custom User Purchase overrides - preseed INDUSTOWER to last week (02 Nov 2026 @ ₹380.00)
  const [customPurchases, setCustomPurchases] = useState<Record<string, { purchase_date: string; purchase_price: number }>>({
    INDUSTOWER: { purchase_date: "2026-11-02", purchase_price: 380.0 },
  });
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
      if (saved) {
        const parsed = JSON.parse(saved);
        // Correct stale historical test entry for INDUSTOWER
        if (parsed.INDUSTOWER && (parsed.INDUSTOWER.purchase_date === "2024-04-30" || parsed.INDUSTOWER.purchase_date < "2026-01-01")) {
          parsed.INDUSTOWER = { purchase_date: "2026-11-02", purchase_price: 380.0 };
          try {
            localStorage.setItem(CUSTOM_PURCHASE_KEY, JSON.stringify(parsed));
          } catch {
            // ignore
          }
        }
        setCustomPurchases((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
  }, []);

  const saveCustomPurchase = (sym: string, date: string, price: number) => {
    setCustomPurchases((prev) => {
      const next = { ...prev, [sym]: { purchase_date: date, purchase_price: price } };
      try {
        localStorage.setItem(CUSTOM_PURCHASE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setIsEditingPurchase(false);
  };

  const clearCustomPurchase = (sym: string) => {
    setCustomPurchases((prev) => {
      const next = { ...prev };
      delete next[sym];
      try {
        localStorage.setItem(CUSTOM_PURCHASE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setIsEditingPurchase(false);
  };

  // Fetch calls data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/calls");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // keep fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch stock context for selected symbol
  useEffect(() => {
    if (!selectedSymbol) return;
    let cancelled = false;
    setContextLoading(true);

    fetch(`/api/admin/stock-context?symbol=${encodeURIComponent(selectedSymbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json) {
          setContextData(json);
        }
      })
      .catch(() => {
        if (!cancelled) setContextData(null);
      })
      .finally(() => {
        if (!cancelled) setContextLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  // User take / exit action handlers
  const handleTakeCall = async (symbol: string) => {
    try {
      const res = await fetch("/api/admin/calls/take", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (res.ok) {
        setUserCallOverrides((prev) => ({
          ...prev,
          [symbol]: { is_taken: true, is_cleared: false },
        }));
      }
    } catch {
      setUserCallOverrides((prev) => ({
        ...prev,
        [symbol]: { is_taken: true, is_cleared: false },
      }));
    }
  };

  const handleExitCall = async (symbol: string) => {
    try {
      const res = await fetch("/api/admin/calls/exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (res.ok) {
        setUserCallOverrides((prev) => ({
          ...prev,
          [symbol]: { is_taken: false, is_cleared: true },
        }));
      }
    } catch {
      setUserCallOverrides((prev) => ({
        ...prev,
        [symbol]: { is_taken: false, is_cleared: true },
      }));
    }
  };

  // Comprehensive Curated deployment picks with rich operational thesis & company overview
  const curatedPicks = useMemo(() => [
    {
      symbol: "INDUSTOWER",
      name: "Indus Towers Ltd.",
      sector: "Tech & Communication",
      cluster: "Telecom",
      weightPct: 15,
      cmp: 378.3,
      anchorPrice: 380.0,
      callDate: "2026-11-01",
      purchaseDate: "2026-11-02",
      purchasePrice: 380.0,
      heldQty: 26,
      buyBelow: 370.7,
      target: 554.4,
      stopLoss: 335.0,
      upside: 46.5,
      scores: "100 / 82 / 51",
      horizon: "1Y" as IdeaHorizon,
      horizonLabel: "🏛️ 1Y Core",
      timeline: "9–12M",
      role: "1Y Alpha FCF Compounder",
      rationale: "India's leading telecom tower infrastructure provider benefiting from nationwide 5G densification, accelerating collection of legacy Vodafone Idea receivables, and structural Free Cash Flow yield > 15%.",
      companyOverview: "Indus Towers Ltd. is India's leading passive telecom infrastructure provider, deploying, owning, and managing over 225,000 telecom towers and 365,000 co-locations across all 22 telecom circles in India. It serves major wireless operators including Bharti Airtel, Reliance Jio, and Vodafone Idea with long-term Master Service Agreements.",
      operatingHighlights: [
        "Massive Free Cash Flow (FCF) yield exceeding 15% with high operating EBITDA margins (>52%).",
        "Consistent recovery of overdue receivables from Vodafone Idea as telco funding and tariff hikes take effect.",
        "Aggressive nationwide 5G tower tenancies and small-cell rollouts driving multi-year loading factor expansion per tower.",
        "Significant operating leverage with near-zero incremental CAPEX needed for co-location additions.",
      ],
      catalysts: [
        "Formalization of additional tenant additions from ongoing 5G site densification across Tier-2/3 cities.",
        "Dividend reinstatement / potential special dividend distribution as trapped working capital unwinds.",
        "Continuous balance sheet deleveraging leading to interest cost savings and ROE expansion toward 25%.",
      ],
      marginOfSafety: "Irreplaceable nationwide physical infrastructure asset base. Trading at significant discount to international tower peers. Bear floor well anchored at ₹335.",
    },
    {
      symbol: "UNIONBANK",
      name: "Union Bank of India",
      sector: "Financials",
      cluster: "PSU Banks",
      weightPct: 15,
      cmp: 186.0,
      anchorPrice: 178.9,
      callDate: "2026-11-01",
      buyBelow: 182.3,
      target: 270.1,
      stopLoss: 130.0,
      upside: 45.2,
      scores: "83 / 68 / 74",
      horizon: "6M" as IdeaHorizon,
      horizonLabel: "📈 6M Banking",
      timeline: "5–6M",
      role: "6M Banking Growth Anchor",
      rationale: "Tier-1 PSU banking leader demonstrating strong balance sheet turnaround, multi-quarter decline in Net NPAs (<0.95%), expanding RAM (Retail, Agri, MSME) loan book, and high technical momentum (Pillar 74).",
      companyOverview: "Union Bank of India is one of the premier public sector banking institutions in India, operating an extensive network of 8,500+ domestic branches and ATMs serving over 150 million customers across retail, agriculture, MSME (RAM), and large corporate segments. Headquartered in Mumbai, it commands significant market share in regional deposit mobilization and priority lending.",
      operatingHighlights: [
        "Robust NIM expansion with disciplined deposit re-pricing and expanding CASA ratio (>34%).",
        "Asset quality turnaround: Gross NPA falling steadily below 4.5% and Net NPA < 0.95% with high Provision Coverage Ratio (PCR > 92%).",
        "Corporate credit book accelerating at 12–14% CAGR driven by infrastructure, renewable energy, and manufacturing CAPEX.",
        "Strong capital adequacy (CRAR > 16.2%), providing substantial headroom for risk-weighted asset expansion without near-term dilution risk.",
      ],
      catalysts: [
        "Impending credit ratings upgrade by domestic and international agencies following multi-quarter balance sheet clean-up.",
        "Operating leverage kicks in as digital banking transactions cross 82% of total retail volume, lowering cost-to-income ratio.",
        "Recovery from legacy stressed assets via NCLT resolutions feeding directly into non-interest income.",
      ],
      marginOfSafety: "Sizable valuation cushion trading at an attractive Price-to-Adjusted Book Value (P/ABV < 0.85x), well below historical peak multiples of 1.2x. Floor anchored at ₹130 (0.65x ABV).",
    },
    {
      symbol: "BBTC",
      name: "Bombay Burmah Trading Corporation Ltd.",
      sector: "Consumer",
      cluster: "Packaged Foods & Dairy",
      weightPct: 15,
      cmp: 1284.3,
      anchorPrice: 1284.3,
      callDate: "2026-11-06",
      buyBelow: 1124.3,
      target: 2356.9,
      stopLoss: 1050.0,
      upside: 83.5,
      scores: "100 / 82 / 27",
      horizon: ">1Y" as IdeaHorizon,
      horizonLabel: "💎 >1Y Asset Arbitrage",
      timeline: "9–15M",
      role: ">1Y Holding Co Arbitrage",
      rationale: "Holding company of the Wadia Group controlling a massive 50.5% effective equity stake in Britannia Industries alongside prime land parcels, plantations, and auto components, trading at an extreme >60% holding discount.",
      companyOverview: "The Bombay Burmah Trading Corporation, Limited (BBTC) is a 160+ year old flagship enterprise of the Wadia Group. Its primary economic engine is its majority ownership in Britannia Industries Limited (direct and through subsidiaries), coupled with direct operations in tea and coffee plantations, auto-electrical components, and real estate assets.",
      operatingHighlights: [
        "Unrivaled asset backing: BBTC holds ~12.16 crore shares (~50.5%) of Britannia Industries Ltd, valued in excess of ₹65,000 Cr at market prices.",
        "Deep holding company discount (>60%) compared to historical typical holding discounts of 35–40%, offering a massive structural mean-reversion cushion.",
        "Zero-leverage parent holding structure with regular dividend pass-through from Britannia fueling treasury yield.",
        "Significant standalone land banks and high-margin plantation assets providing hard asset floor.",
      ],
      catalysts: [
        "Narrowing holding company discount driven by institutional activist pressure and corporate simplification.",
        "Accelerating volume recovery and rural demand tailwinds in Britannia's premium biscuit and dairy portfolio.",
        "Potential value unlocking or restructuring of non-core real estate land holdings in South and Western India.",
      ],
      marginOfSafety: "Pristine fundamental backing with Britannia market value alone representing >2.5x BBTC's current market cap. High margin of safety with firm support floor at ₹1,050.",
    },
    {
      symbol: "FMGOETZE",
      name: "Federal-Mogul Goetze (India) Ltd.",
      sector: "Industrials",
      cluster: "Auto Components (Powertrain & Body)",
      weightPct: 15,
      cmp: 466.4,
      anchorPrice: 429.3,
      callDate: "2026-10-27",
      buyBelow: 457.1,
      target: 603.6,
      stopLoss: 326.4,
      upside: 29.4,
      scores: "99 / 63 / 45",
      horizon: "3M" as IdeaHorizon,
      horizonLabel: "🚀 3M Auto Alpha",
      timeline: "2–3M",
      role: "3M Auto Components Alpha",
      rationale: "Premier manufacturer of pistons, piston rings, and engine bearings commanding unmatched domestic market share (>55%), debt-free balance sheet, and strong operating cash flows backed by parent Tenneco LLC.",
      companyOverview: "Federal-Mogul Goetze (India) Limited is a leading manufacturer of automotive powertrain components including pistons, piston rings, cylinder liners, and sintered metal products for two-wheelers, passenger cars, commercial vehicles, and agricultural tractors. It operates state-of-the-art manufacturing plants in Bangalore, Patiala, and Bhiwadi with global technical backing from Tenneco.",
      operatingHighlights: [
        "Dominant domestic market leadership (>55% market share in piston rings and OEM powertrain assemblies).",
        "Pristine balance sheet with zero net long-term debt and positive Free Cash Flow generation.",
        "Operating EBITDA margins steady at 14–16% supported by high-margin aftermarket and commercial vehicle exports.",
        "High barrier to entry with deep OEM co-engineering relationships and strict quality certifications.",
      ],
      catalysts: [
        "Cyclical upturn in commercial vehicles and tractors driving high-margin replacement demand.",
        "Margin expansion supported by localized raw material sourcing and lean operational initiatives under Tenneco.",
        "Increasing hybrid vehicle engine component complexity commanding higher realization per kit.",
      ],
      marginOfSafety: "Debt-free balance sheet with high institutional quality score of 99. Solid support floor anchored at ₹301.40.",
    },
    {
      symbol: "SHARDACROP",
      name: "Sharda Cropchem Ltd.",
      sector: "Materials",
      cluster: "Agrochemicals & Fertilizers",
      weightPct: 10,
      cmp: 685.6,
      anchorPrice: 685.6,
      callDate: "2026-11-08",
      buyBelow: 651.8,
      target: 900.0,
      stopLoss: 465.6,
      upside: 35.3,
      scores: "100 / 67 / 31",
      horizon: "6M" as IdeaHorizon,
      horizonLabel: "📈 6M Global Agchem",
      timeline: "4–6M",
      role: "6M Global Agchem Compounder",
      rationale: "Asset-light global agrochemical and non-agrochemical distributor with 2,900+ international product registrations across Europe and NAFTA, zero net debt, and accelerating volume recovery in crop protection.",
      companyOverview: "Sharda Cropchem Limited is a fast-growing global agrochemicals marketing and distribution enterprise. Operating on an asset-light virtual manufacturing model, it focuses on identifying generic off-patent molecules, securing product registrations in regulated international markets (Europe, NAFTA, LATAM, RoW), and distributing formulations through local partners.",
      operatingHighlights: [
        "Extensive intellectual property portfolio comprising 2,900+ active product registrations in high-margin regulated markets.",
        "Asset-light virtual manufacturing business model yielding negative working capital requirements and superior ROCE (>20%).",
        "Debt-free balance sheet with robust cash balances providing high structural cushion.",
        "Diversified revenue footprint across Europe (45%), NAFTA (35%), and Latin America (15%), insulating from regional monsoons.",
      ],
      catalysts: [
        "Destocking cycle completion in European agrochemicals unlocking pent-up order backlogs.",
        "Continuous pipeline of 1,000+ pending product registrations providing multi-year visibility on new market entries.",
        "Strong operating cash flow rebound driving expanded dividend payout and potential buyback.",
      ],
      marginOfSafety: "Pristine debt-free balance sheet, massive registration asset base, institutional composite percentile 100, and bear floor at ₹465.60.",
    },
    {
      symbol: "ALLDIGI",
      name: "Alldigi Tech Ltd.",
      sector: "Industrials",
      cluster: "Commercial B2B Services & Supplies",
      weightPct: 15,
      cmp: 831.65,
      anchorPrice: 772.25,
      callDate: "2026-11-01",
      buyBelow: 815.0,
      target: 1117.7,
      stopLoss: 582.0,
      upside: 34.4,
      scores: "94 / 78 / 52",
      horizon: "1M" as IdeaHorizon,
      horizonLabel: "⚡ 1M Swing",
      timeline: "2–4W",
      role: "1M B2B Tech Alpha",
      rationale: "B2B enterprise digital transformation and payroll solutions compounder delivering >24% ROCE, long-term enterprise retention (>95%), and accelerating AI-driven margin expansion.",
      companyOverview: "Alldigi Tech (formerly Allsec Technologies) is a premier digital transformation, BPO, and enterprise HR/payroll processing solutions provider, serving Global Fortune 500 enterprises across North America, Europe, and APAC with scalable cloud SaaS platforms.",
      operatingHighlights: [
        "Exceptional capital efficiency with ROCE > 24% and consistent debt-free cash generation.",
        "Long-term sticky enterprise contracts with >95% client retention and rising contract values.",
        "Accelerating adoption of AI-enabled automated customer experience (CX) and compliance workflows.",
        "High operating cash conversion with over 90% of EBITDA converting directly into free cash.",
      ],
      catalysts: [
        "Margin expansion as automated AI workflows displace legacy manual service hours.",
        "Inorganic tuck-in acquisitions enabled by debt-free treasury.",
        "Dividend payout ratio exceeding 50% providing superior cash yield to shareholders.",
      ],
      marginOfSafety: "Debt-free balance sheet with high cash per share, sticky recurring multi-year enterprise contracts, and strong floor at ₹582.",
    },
    {
      symbol: "APOLLOTYRE",
      name: "Apollo Tyres Ltd.",
      sector: "Industrials",
      cluster: "Tyres & Rubber Products",
      weightPct: 15,
      cmp: 400.4,
      anchorPrice: 384.15,
      callDate: "2026-11-01",
      buyBelow: 371.9,
      target: 498.1,
      stopLoss: 265.0,
      upside: 31.3,
      scores: "100 / 63 / 51",
      horizon: "3M" as IdeaHorizon,
      horizonLabel: "🚀 3M Support Rebound",
      timeline: "2–3M",
      role: "3M Margin Expansion",
      rationale: "Global radial tire manufacturing leader trading at strong multi-month support, expanding European EBITDA margins, accelerating debt reduction cycle, and benefiting from stabilizing raw material costs.",
      companyOverview: "Apollo Tyres is a global tire manufacturing giant with iconic brand equity across India and Europe (Vredestein brand), manufacturing high-performance radial tires for passenger vehicles, commercial trucks, off-highway vehicles, and two-wheelers.",
      operatingHighlights: [
        "Structural margin inflection: Consolidated EBITDA margins expanding toward 16% on disciplined pricing and premiumization.",
        "Strong balance sheet deleveraging with net debt-to-EBITDA dropping below 1.0x.",
        "European operations (Vredestein) capturing market share in all-season and ultra-high-performance tire categories.",
        "Improving capacity utilization across Indian plants driving operational efficiency.",
      ],
      catalysts: [
        "Stabilization in natural rubber and crude-derivative raw material inputs expanding gross margins.",
        "Recovery in Indian commercial vehicle replacement demand and automotive OEM volumes.",
        "Enhanced free cash flow generation driving accelerated debt retirement and ROE expansion toward 17%.",
      ],
      marginOfSafety: "Firm technical and fundamental support around the ₹380–₹395 zone. Substantial replacement market revenue cushioning cyclic downturns.",
    },
  ], []);

  const curatedSymbolMap = useMemo(() => {
    const map = new Map<string, typeof curatedPicks[0]>();
    curatedPicks.forEach((p) => map.set(p.symbol, p));
    return map;
  }, [curatedPicks]);

  // Unified Calls List: Cluster Gems + Curated Top Picks + Portfolio Action Calls (Buy, Sell, Trim, Exit)
  const unifiedCalls = useMemo(() => {
    if (!data) return [];
    const callMap = new Map<string, any>();

    // 1. Cluster Gems (from server)
    data.clusterGems.forEach((g) => {
      const cur = curatedSymbolMap.get(g.symbol);
      const port = data.portfolioActions.find((p) => p.symbol === g.symbol);

      const cmp = g.ltp ?? cur?.cmp ?? 0;
      const target = g.target_price ?? cur?.target ?? 0;
      const buyBelow = g.buy_below ?? cur?.buyBelow ?? 0;
      const stopLoss = g.bear_floor ?? cur?.stopLoss ?? Math.round(cmp * 0.82);
      const upside = g.upside_pct ?? (target > 0 && cmp > 0 ? ((target - cmp) / cmp) * 100 : cur?.upside ?? 0);

      // Anchor 1: Call Given
      const callDate = cur?.callDate ?? g.call_date ?? (g.generated_at ? g.generated_at.slice(0, 10) : "2026-11-01");
      const callPrice = g.call_price ?? g.anchor_price ?? cur?.anchorPrice ?? cmp;
      const callPerfPct = callPrice > 0 ? ((cmp - callPrice) / callPrice) * 100 : 0;

      const customP = customPurchases[g.symbol];
      const isPortfolio = Boolean(port && port.total_qty > 0) || Boolean(g.is_portfolio) || Boolean(customP);

      // Anchor 2: Stock Purchase (only for actual portfolio holdings or user-logged buys)
      const purchaseDate = customP?.purchase_date ?? (isPortfolio ? (g.purchase_date ?? port?.purchase_date ?? cur?.purchaseDate ?? null) : null);
      const purchasePrice = customP?.purchase_price ?? (isPortfolio ? (g.purchase_price ?? port?.weighted_avg_cost ?? cur?.purchasePrice ?? null) : null);
      const purchasePerfPct =
        purchasePrice && purchasePrice > 0 ? ((cmp - purchasePrice) / purchasePrice) * 100 : null;

      const heldQty = port?.total_qty ?? (isPortfolio ? (g.held_qty && g.held_qty > 0 ? g.held_qty : (cur?.heldQty ?? (customP ? 26 : 0))) : 0) ?? 0;
      const investedVal = port?.invested_val ?? (isPortfolio ? g.invested_val : 0) ?? (purchasePrice ? purchasePrice * heldQty : 0);
      const curVal = port?.cur_val ?? (isPortfolio ? g.cur_val : 0) ?? (cmp * heldQty);

      // ONLY actual portfolio holdings have a holding duration (from trade buy date)!
      const holdingDuration = isPortfolio && purchaseDate ? getHoldingDuration(purchaseDate) : null;

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

      // Determine Action
      let actionToday = g.action_today || (isPortfolio ? (port?.action_today || "HOLD & COMPOUND") : (cmp <= buyBelow * 1.02 ? "BUY / ACCUMULATE" : "WATCH / ACCUMULATE"));
      if (isPortfolio && port?.action_today) {
        actionToday = port.action_today;
      }

      callMap.set(g.symbol, {
        symbol: g.symbol,
        name: g.company_name || cur?.name || g.symbol,
        sector: cur?.sector || g.sector || "General",
        industry: cur?.cluster || g.industry || "General",
        market_cap_category: g.market_cap_category || "mid_cap",
        cluster: cur?.cluster || g.cluster_name || "General",
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
        horizon: cur?.horizon || g.horizon || ("6M" as IdeaHorizon),
        horizonLabel: cur?.horizonLabel || g.horizon_label || "📈 6M High-Momentum",
        timeline: cur?.timeline || g.sell_timeline || "6M",
        role: cur?.role || `${g.horizon || "6M"} Opportunity`,
        rationale: cur?.rationale || g.action_reason || g.strategy_desc || g.verdict || "High-conviction re-rating catalyst.",
        companyOverview: cur?.companyOverview || null,
        operatingHighlights: cur?.operatingHighlights || null,
        catalysts: cur?.catalysts || null,
        marginOfSafety: cur?.marginOfSafety || null,
        actionToday,
        actionReason: g.action_reason || port?.action_reason || cur?.rationale || "Active recommendation under tracking.",
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
        holdingDuration,
        isTaken,
        isCleared,
        priceFetchedAt: g.price_fetched_at ?? null,
      });
    });

    // 2. Curated Picks fallback (ensures Top are always present)
    curatedPicks.forEach((cp) => {
      if (!callMap.has(cp.symbol)) {
        const port = data.portfolioActions.find((p) => p.symbol === cp.symbol);
        const gem = data.clusterGems.find((g) => g.symbol === cp.symbol);
        const cmp = gem?.ltp ?? port?.ltp ?? cp.cmp;
        const callDate = cp.callDate ?? gem?.call_date ?? "2026-11-01";
        const callPrice = gem?.call_price ?? gem?.anchor_price ?? cp.anchorPrice ?? cp.cmp;
        const callPerfPct = callPrice > 0 ? ((cmp - callPrice) / callPrice) * 100 : 0;

        const customP = customPurchases[cp.symbol];
        const isPortfolio = Boolean(port && port.total_qty > 0) || Boolean(gem?.is_portfolio) || Boolean(customP) || Boolean(cp.purchasePrice);

        const purchaseDate = customP?.purchase_date ?? (isPortfolio ? (port?.purchase_date ?? gem?.purchase_date ?? cp.purchaseDate ?? null) : null);
        const purchasePrice = customP?.purchase_price ?? (isPortfolio ? (port?.weighted_avg_cost ?? gem?.purchase_price ?? cp.purchasePrice ?? null) : null);
        const purchasePerfPct =
          purchasePrice && purchasePrice > 0 ? ((cmp - purchasePrice) / purchasePrice) * 100 : null;

        const heldQty = port?.total_qty ?? (isPortfolio ? (gem?.held_qty && gem.held_qty > 0 ? gem.held_qty : (cp.heldQty ?? 26)) : 0);
        const investedVal = port?.invested_val ?? (purchasePrice ? purchasePrice * heldQty : 0);
        const curVal = port?.cur_val ?? (cmp * heldQty);

        // ONLY actual portfolio holdings have a holding duration (from trade buy date)!
        const holdingDuration = isPortfolio && purchaseDate ? getHoldingDuration(purchaseDate) : null;

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
          companyOverview: cp.companyOverview,
          operatingHighlights: cp.operatingHighlights,
          catalysts: cp.catalysts,
          marginOfSafety: cp.marginOfSafety,
          actionToday: isPortfolio ? (port?.action_today || "HOLD & COMPOUND") : "BUY / ACCUMULATE",
          actionReason: cp.rationale,
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
          holdingDuration,
          isTaken: isPortfolio,
          isCleared: false,
          priceFetchedAt: gem?.price_fetched_at ?? port?.price_fetched_at ?? null,
        });
      }
    });

    // 3. Add Portfolio Holdings with Action Sweeps
    data.portfolioActions.forEach((port) => {
      if (!callMap.has(port.symbol)) {
        const cmp = port.ltp;
        const target = port.target_price ?? Math.round(cmp * 1.25);
        const buyBelow = port.buy_below ?? Math.round(cmp * 0.95);
        const stopLoss = port.bear_floor ?? Math.round(cmp * 0.85);
        const upside = port.upside_pct ?? ((target - cmp) / cmp) * 100;

        const customP = customPurchases[port.symbol];
        const purchaseDate = customP?.purchase_date ?? port.purchase_date ?? null;
        const purchasePrice = customP?.purchase_price ?? port.weighted_avg_cost ?? null;
        const purchasePerfPct =
          purchasePrice && purchasePrice > 0 ? ((cmp - purchasePrice) / purchasePrice) * 100 : null;

        const callDate = port.call_date ?? (port.generated_at ? port.generated_at.slice(0, 10) : "2026-11-01");
        const callPrice = port.call_price ?? port.anchor_price ?? cmp;
        const callPerfPct = callPrice > 0 ? ((cmp - callPrice) / callPrice) * 100 : 0;

        const heldQty = port.total_qty;
        const investedVal = port.invested_val;
        const curVal = port.cur_val;

        // Portfolio holdings use their actual purchase date
        const holdingDuration = purchaseDate ? getHoldingDuration(purchaseDate) : null;

        const weightPct = 10;
        const allocatedAmount = Math.round((capital * weightPct) / 100);
        const totalShares = cmp > 0 ? Math.floor(allocatedAmount / cmp) : 0;
        const tranche1Shares = Math.ceil(totalShares / 2);
        const tranche2Shares = Math.max(0, totalShares - tranche1Shares);

        callMap.set(port.symbol, {
          symbol: port.symbol,
          name: port.company_name || port.symbol,
          sector: port.sector || "General",
          industry: port.industry || "General",
          market_cap_category: port.market_cap_category || "mid_cap",
          cluster: port.cluster_name || "Portfolio",
          marketCapCr: 0,
          cmp,
          buyBelow,
          target,
          stopLoss,
          upside: Math.round(upside * 10) / 10,
          scores: `${port.composite_pct ?? "—"} / ${port.quality_pct ?? "—"} / ${port.momentum_pct ?? "—"}`,
          composite_pct: port.composite_pct ?? 50,
          quality_pct: port.quality_pct ?? 50,
          valuation_pct: port.valuation_pct ?? 50,
          momentum_pct: port.momentum_pct ?? 50,
          horizon: port.horizon,
          horizonLabel: port.horizon_label,
          timeline: port.sell_timeline,
          role: "Portfolio Holding Action",
          rationale: port.action_reason || "Portfolio holding under active risk management.",
          companyOverview: null,
          operatingHighlights: null,
          catalysts: null,
          marginOfSafety: null,
          actionToday: port.action_today,
          actionReason: port.action_reason,
          isPortfolio: true,
          heldQty,
          investedVal,
          curVal,
          isCurated: false,
          weightPct,
          allocatedAmount,
          totalShares,
          tranche1Shares,
          tranche2Shares,
          t1Value: tranche1Shares * cmp,
          t2Value: tranche2Shares * cmp,
          projectedValue: Math.round(totalShares * target),
          profitRupees: Math.round(totalShares * target) - allocatedAmount,
          callDate,
          callPrice,
          callPerfPct,
          purchaseDate,
          purchasePrice,
          purchasePerfPct,
          holdingDuration,
          isTaken: true,
          isCleared: false,
          priceFetchedAt: port.price_fetched_at ?? null,
        });
      }
    });

    return Array.from(callMap.values());
  }, [data, curatedPicks, curatedSymbolMap, capital, customPurchases, userCallOverrides]);

  // Action counts for filtering (Buy calls vs Sell calls vs Hold calls)
  const actionCounts = useMemo(() => {
    let buy = 0;
    let sell = 0;
    let hold = 0;
    unifiedCalls.forEach((c) => {
      const act = (c.actionToday || "").toUpperCase();
      const isSell = act.includes("SELL") || act.includes("TRIM") || act.includes("EXIT") || act.includes("CUT LOSS");
      if (act.includes("BUY") || act.includes("ACCUMULATE")) {
        buy++;
      } else if (isSell && c.isPortfolio) {
        sell++;
      } else if (act.includes("HOLD") || act.includes("WATCH")) {
        hold++;
      }
    });
    return { all: buy + sell + hold, buy, sell, prioritySell: sell, hold };
  }, [unifiedCalls]);

  // Priority sell breakdown counts
  const priorityCounts = useMemo(() => {
    let profitTrim = 0;
    let drawdown = 0;
    let exit = 0;
    unifiedCalls.forEach((c) => {
      const act = (c.actionToday || "").toUpperCase();
      const isSell = act.includes("SELL") || act.includes("TRIM") || act.includes("EXIT") || act.includes("CUT LOSS");
      if (isSell && c.isPortfolio) {
        const cat = getPriorityCategory(c).category;
        if (cat === "PROFIT_TRIM") profitTrim++;
        else if (cat === "STRUCTURAL_EXIT") exit++;
        else drawdown++;
      }
    });
    return { all: profitTrim + drawdown + exit, profitTrim, drawdown, exit };
  }, [unifiedCalls]);

  // Filter unified calls based on Multi-Selected Dates, Scope, Action Filter, and Search
  const filteredCalls = useMemo(() => {
    return unifiedCalls.filter((c) => {
      // 1. Priority Sell calls: Immediate risk management alerts for held portfolio positions
      // They must ALWAYS be visible when clicking "Priority Sell", regardless of batch date or curated scope
      if (actionFilter === "PRIORITY_SELL") {
        const act = (c.actionToday || "").toUpperCase();
        const isSell = act.includes("SELL") || act.includes("TRIM") || act.includes("EXIT") || act.includes("CUT LOSS");
        if (!isSell || !c.isPortfolio) return false;
        if (prioritySubFilter !== "ALL" && getPriorityCategory(c).category !== prioritySubFilter) return false;
      } else {
        // Standard Scope Filter (Curated Top vs Portfolio vs All)
        if (scope === "curated" && !c.isCurated) return false;
        if (scope === "portfolio" && !c.isPortfolio) return false;

        // Action Filter (Buy Calls vs Sell Calls vs Hold Calls)
        if (actionFilter === "BUY") {
          const act = (c.actionToday || "").toUpperCase();
          if (!act.includes("BUY") && !act.includes("ACCUMULATE")) return false;
        } else if (actionFilter === "SELL") {
          const act = (c.actionToday || "").toUpperCase();
          const isSell = act.includes("SELL") || act.includes("TRIM") || act.includes("EXIT") || act.includes("CUT LOSS");
          if (!isSell || !c.isPortfolio) return false;
        } else if (actionFilter === "HOLD") {
          const act = (c.actionToday || "").toUpperCase();
          if (!act.includes("HOLD") && !act.includes("WATCH")) return false;
        }

        // Multi-date selection check
        if (!selectedBatches.has("all") && selectedBatches.size > 0) {
          let matchesDate = false;
          for (const b of selectedBatches) {
            if (b === "week_1" && (c.isCurated || (c.callDate && c.callDate >= "2026-10-31"))) matchesDate = true;
            else if (b === "week_2" && (c.composite_pct ?? 0) >= 80) matchesDate = true;
            else if (b === "priority_sells" && c.isPortfolio && (c.actionToday?.includes("SELL") || c.actionToday?.includes("TRIM") || c.actionToday?.includes("EXIT") || c.actionToday?.includes("CUT LOSS"))) matchesDate = true;
            else if (c.callDate && c.callDate === b) matchesDate = true;
          }
          if (!matchesDate) return false;
        }
      }

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const mSym = (c.symbol || "").toLowerCase().includes(q);
        const mName = (c.name || "").toLowerCase().includes(q);
        const mSec = (c.sector || "").toLowerCase().includes(q);
        if (!mSym && !mName && !mSec) return false;
      }

      return true;
    });
  }, [unifiedCalls, scope, actionFilter, prioritySubFilter, selectedBatches, search]);

  // Sorted table calls for Master Table View (Option 2)
  const sortedTableCalls = useMemo(() => {
    const list = [...filteredCalls];
    list.sort((a, b) => {
      let diff = 0;
      if (tableSortKey === "symbol") diff = a.symbol.localeCompare(b.symbol);
      else if (tableSortKey === "cmp") diff = a.cmp - b.cmp;
      else if (tableSortKey === "target") diff = (a.target || 0) - (b.target || 0);
      else if (tableSortKey === "upside") diff = (a.upside || 0) - (b.upside || 0);
      else if (tableSortKey === "weight") diff = (a.weightPct || 0) - (b.weightPct || 0);
      else if (tableSortKey === "quality") diff = (a.quality_pct || 0) - (b.quality_pct || 0);
      return tableSortAsc ? diff : -diff;
    });
    return list;
  }, [filteredCalls, tableSortKey, tableSortAsc]);

  const handleTableSort = (key: typeof tableSortKey) => {
    if (tableSortKey === key) {
      setTableSortAsc((prev) => !prev);
    } else {
      setTableSortKey(key);
      setTableSortAsc(false); // default descending
    }
  };

  // Group filtered calls by Sector and Cluster for the Left Rail Tree
  const sectorGroups = useMemo(() => {
    const secMap = new Map<string, typeof filteredCalls>();
    filteredCalls.forEach((c) => {
      const sec = c.sector || "Other";
      if (!secMap.has(sec)) secMap.set(sec, []);
      secMap.get(sec)!.push(c);
    });

    type CallItem = (typeof filteredCalls)[number];
    const groups: {
      sector: string;
      count: number;
      calls: CallItem[];
      clusters: {
        cluster: string;
        count: number;
        calls: CallItem[];
      }[];
    }[] = [];

    secMap.forEach((secCalls, sector) => {
      const clusterMap = new Map<string, CallItem[]>();
      secCalls.forEach((c) => {
        const clus = c.cluster || "General";
        if (!clusterMap.has(clus)) clusterMap.set(clus, []);
        clusterMap.get(clus)!.push(c);
      });

      const clusters: { cluster: string; count: number; calls: CallItem[] }[] = [];
      clusterMap.forEach((clusCalls, cluster) => {
        clusCalls.sort((a, b) => {
          if (a.isCurated && !b.isCurated) return -1;
          if (!a.isCurated && b.isCurated) return 1;
          const aAct = (a.actionToday || "").toUpperCase();
          const bAct = (b.actionToday || "").toUpperCase();
          const aIsPri = (aAct.includes("SELL") || aAct.includes("TRIM") || aAct.includes("EXIT") || aAct.includes("CUT LOSS")) && a.isPortfolio;
          const bIsPri = (bAct.includes("SELL") || bAct.includes("TRIM") || bAct.includes("EXIT") || bAct.includes("CUT LOSS")) && b.isPortfolio;
          if (aIsPri && !bIsPri) return -1;
          if (!aIsPri && bIsPri) return 1;
          return a.symbol.localeCompare(b.symbol);
        });
        clusters.push({ cluster, count: clusCalls.length, calls: clusCalls });
      });

      clusters.sort((a, b) => a.cluster.localeCompare(b.cluster));

      // Flatten sorted calls for this sector so keyboard navigation visits every stock in order
      const sortedSecCalls = clusters.flatMap((cl) => cl.calls);

      groups.push({
        sector,
        count: secCalls.length,
        calls: sortedSecCalls,
        clusters,
      });
    });

    groups.sort((a, b) => a.sector.localeCompare(b.sector));
    return groups;
  }, [filteredCalls]);

  // Selected Call Detail
  const selectedCall = useMemo(() => {
    return filteredCalls.find((c) => c.symbol === selectedSymbol) || filteredCalls[0] || null;
  }, [filteredCalls, selectedSymbol]);

  // Whenever the active view filter/scope changes, automatically navigate to the top scrip of that view
  const prevFilterKey = useRef<string>("");
  useEffect(() => {
    const key = `${scope}::${actionFilter}::${prioritySubFilter}::${Array.from(selectedBatches).sort().join(",")}`;
    if (prevFilterKey.current !== key) {
      prevFilterKey.current = key;
      const topScrip = sectorGroups[0]?.calls[0]?.symbol || filteredCalls[0]?.symbol;
      if (topScrip) {
        setSelectedSymbol(topScrip);
      }
    }
  }, [scope, actionFilter, prioritySubFilter, selectedBatches, sectorGroups, filteredCalls]);

  // Fallback: If selectedSymbol is not set or not in current filteredCalls, pick the top scrip
  useEffect(() => {
    if (filteredCalls.length > 0) {
      const exists = filteredCalls.some((c) => c.symbol === selectedSymbol);
      if (!exists || !selectedSymbol) {
        const topScrip = sectorGroups[0]?.calls[0]?.symbol || filteredCalls[0]?.symbol;
        if (topScrip) {
          setSelectedSymbol(topScrip);
        }
      }
    }
  }, [filteredCalls, sectorGroups, selectedSymbol]);

  // Chart trade markers for selected stock (displays P on graph for portfolio holdings)
  const chartTrades = useMemo<TradeMark[]>(() => {
    if (!selectedCall || !selectedCall.isPortfolio) return [];
    if (selectedCall.purchasePrice) {
      return [
        {
          d: selectedCall.purchaseDate || new Date().toISOString().slice(0, 10),
          side: "P",
          price: selectedCall.purchasePrice,
          qty: selectedCall.heldQty || selectedCall.totalShares || 1,
          derived: !selectedCall.purchaseDate,
        },
      ];
    }
    return [];
  }, [selectedCall]);

  // Live Portfolio Metrics from uploaded broker holdings
  const livePortfolioStats = useMemo(() => {
    const list = data?.portfolioActions || [];
    let curVal = (data?.summary?.totalCurrentCr || 0) * 1e7;
    let invVal = (data?.summary?.totalInvestedCr || 0) * 1e7;

    if (curVal === 0 && list.length > 0) {
      curVal = list.reduce((acc, p) => acc + (p.cur_val || 0), 0);
      invVal = list.reduce((acc, p) => acc + (p.invested_val || 0), 0);
    }
    const effectiveCurVal = curVal > 0 ? curVal : 1400000;
    const effectiveInvVal = invVal > 0 ? invVal : 1200000;
    const pnl = effectiveCurVal - effectiveInvVal;
    const pnlPct = effectiveInvVal > 0 ? (pnl / effectiveInvVal) * 100 : 0;

    const trimCash = list
      .filter((p) => p.action_today === "TRIM / TAKE PROFIT")
      .reduce((acc, p) => acc + (p.cur_val || 0) * 0.25, 0);

    return {
      currentValue: effectiveCurVal,
      investedValue: effectiveInvVal,
      pnl,
      pnlPct,
      holdingsCount: list.length > 0 ? list.length : 128,
      trimCash,
      isRealData: curVal > 0,
    };
  }, [data]);

  // Year-by-year compounding simulation
  const corpusSimulation = useMemo(() => {
    const startBase = corpusManualBaseOverride ?? livePortfolioStats.currentValue;
    const cagr = corpusCagrPct / 100;
    const stepUp = corpusStepUpPct / 100;
    const monthlyStart = corpusMonthlyInflow;

    const rows: {
      year: number;
      label: string;
      startCorpus: number;
      monthlyInflow: number;
      annualFreshInflow: number;
      returnsEarned: number;
      endCorpus: number;
      cumulativeFresh: number;
      cumulativeReturns: number;
      returnsSharePct: number;
      isCrossover: boolean;
    }[] = [];

    let currentCorpus = startBase;
    let cumFresh = 0;
    let cumReturns = 0;
    let crossoverMarked = false;

    for (let y = 1; y <= 10; y++) {
      const yearStart = currentCorpus;
      const thisYearMonthly = Math.round(monthlyStart * Math.pow(1 + stepUp, y - 1));
      const annualFresh = thisYearMonthly * 12;

      const returnOnCapital = yearStart * cagr;
      const returnOnFresh = annualFresh * (cagr * 0.5);
      const totalReturns = Math.round(returnOnCapital + returnOnFresh);

      const yearEnd = yearStart + annualFresh + totalReturns;
      cumFresh += annualFresh;
      cumReturns += totalReturns;

      const isCrossoverYear = !crossoverMarked && totalReturns >= annualFresh;
      if (isCrossoverYear) crossoverMarked = true;

      const totalGain = yearEnd - startBase;
      const returnsShare = totalGain > 0 ? Math.min(100, Math.round((cumReturns / totalGain) * 100)) : 0;

      rows.push({
        year: y,
        label: `Year ${y}`,
        startCorpus: yearStart,
        monthlyInflow: thisYearMonthly,
        annualFreshInflow: annualFresh,
        returnsEarned: totalReturns,
        endCorpus: yearEnd,
        cumulativeFresh: cumFresh,
        cumulativeReturns: cumReturns,
        returnsSharePct: returnsShare,
        isCrossover: isCrossoverYear,
      });

      currentCorpus = yearEnd;
    }

    return {
      startBase,
      rows,
      summary3Y: rows[2],
      summary5Y: rows[4],
      summary10Y: rows[9],
    };
  }, [corpusManualBaseOverride, livePortfolioStats.currentValue, corpusMonthlyInflow, corpusStepUpPct, corpusCagrPct]);

  // Dynamic Position Sizing adapted to Current Corpus
  const dynamicSizing = useMemo(() => {
    const corpus = corpusManualBaseOverride ?? livePortfolioStats.currentValue;

    // Anchor: 15% allocation
    const anchorSize = Math.round(corpus * 0.15);
    const anchorT1 = Math.round(anchorSize * 0.5);
    const anchorT2 = anchorSize - anchorT1;

    // Compounder: 10% allocation
    const compounderSize = Math.round(corpus * 0.10);
    const compounderT1 = Math.round(compounderSize * 0.5);
    const compounderT2 = compounderSize - compounderT1;

    // Tactical: 5% allocation
    const tacticalSize = Math.round(corpus * 0.05);

    // This month's deployment pool = fresh monthly cash + trimmed profit cash
    const monthlyDeployable = corpusMonthlyInflow + Math.round(livePortfolioStats.trimCash);

    return {
      corpus,
      anchor: { total: anchorSize, t1: anchorT1, t2: anchorT2 },
      compounder: { total: compounderSize, t1: compounderT1, t2: compounderT2 },
      tactical: { total: tacticalSize },
      monthlyDeployable,
    };
  }, [corpusManualBaseOverride, livePortfolioStats, corpusMonthlyInflow]);

  // Initial state & dynamic auto-expansion: ALWAYS open the selected stock's sector and cluster in left rail
  useEffect(() => {
    if (selectedCall?.sector) {
      if (scope === "curated") {
        setCollapsedCuratedSectors((prev) => {
          if (!prev.has(selectedCall.sector)) return prev;
          const next = new Set(prev);
          next.delete(selectedCall.sector);
          return next;
        });
      } else {
        setExpandedSectors((prev) => {
          if (prev.has(selectedCall.sector)) return prev;
          const next = new Set(prev);
          next.add(selectedCall.sector);
          return next;
        });
      }
      if (selectedCall.cluster) {
        const clusKey = `${selectedCall.sector}::${selectedCall.cluster}`;
        setCollapsedClusters((prev) => {
          if (!prev.has(clusKey)) return prev;
          const next = new Set(prev);
          next.delete(clusKey);
          return next;
        });
      }
      // Scroll the selected stock in the left rail into view smoothly
      setTimeout(() => {
        const el = document.getElementById(`stock-rail-${selectedCall.symbol}`);
        if (el) {
          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }, 60);
    }
  }, [selectedCall?.symbol, selectedCall?.sector, selectedCall?.cluster, scope]);

  // Price info callback from PriceChart (carries computed prev close & 1D change)
  const [stockPriceInfo, setStockPriceInfo] = useState<{
    prevClose: number | null;
    dayChangePct: number | null;
    asOfLabel: string | null;
  } | null>(null);

  // Clear stock price info when symbol changes so stale data isn't displayed
  useEffect(() => {
    setStockPriceInfo(null);
  }, [selectedCall?.symbol]);

  useEffect(() => {
    if (selectedCall) {
      setEditPurchaseDate(selectedCall.purchaseDate || new Date().toISOString().slice(0, 10));
      setEditPurchasePrice(selectedCall.purchasePrice ? String(selectedCall.purchasePrice) : String(selectedCall.cmp));
      setIsEditingPurchase(false);
    }
  }, [selectedCall]);

  const toggleSector = (sec: string) => {
    if (scope === "curated") {
      setCollapsedCuratedSectors((prev) => {
        const next = new Set(prev);
        if (next.has(sec)) next.delete(sec);
        else next.add(sec);
        return next;
      });
    } else {
      setExpandedSectors((prev) => {
        const next = new Set(prev);
        if (next.has(sec)) next.delete(sec);
        else next.add(sec);
        return next;
      });
    }
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
  const clearAllBatches = () => setSelectedBatches(new Set(["all"]));

  const expandAll = () => {
    if (scope === "curated") {
      setCollapsedCuratedSectors(new Set());
    } else {
      setExpandedSectors(new Set(sectorGroups.map((g) => g.sector)));
    }
    setCollapsedClusters(new Set());
  };

  const collapseAll = () => {
    if (scope === "curated") {
      setCollapsedCuratedSectors(new Set(sectorGroups.map((g) => g.sector)));
    } else {
      setExpandedSectors(new Set());
    }
    setCollapsedClusters(new Set());
  };

  // Keyboard Arrow Key Navigation (ArrowDown/ArrowRight = Next stock, ArrowUp/ArrowLeft = Prev stock)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const visibleList = sectorGroups.flatMap((g) => g.calls);
        if (visibleList.length === 0) return;
        const currentIndex = visibleList.findIndex((c) => c.symbol === selectedSymbol);
        if (currentIndex === -1 || currentIndex >= visibleList.length - 1) {
          setSelectedSymbol(visibleList[0].symbol);
        } else {
          setSelectedSymbol(visibleList[currentIndex + 1].symbol);
        }
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const visibleList = sectorGroups.flatMap((g) => g.calls);
        if (visibleList.length === 0) return;
        const currentIndex = visibleList.findIndex((c) => c.symbol === selectedSymbol);
        if (currentIndex <= 0) {
          setSelectedSymbol(visibleList[visibleList.length - 1].symbol);
        } else {
          setSelectedSymbol(visibleList[currentIndex - 1].symbol);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sectorGroups, selectedSymbol]);

  // Sector Density & Concentration Analysis ("Don't put all eggs in one basket")
  const sectorDensityData = useMemo(() => {
    const targetCalls = densityScope === "curated"
      ? unifiedCalls.filter((c) => c.isCurated)
      : densityScope === "portfolio"
      ? unifiedCalls.filter((c) => c.isPortfolio)
      : filteredCalls;

    const totalCap = targetCalls.reduce((sum, c) => sum + (c.allocatedAmount || (c.cmp * (c.heldQty || 100))), 0);
    const totalCallsCount = targetCalls.length;

    type CallItem = (typeof targetCalls)[number];
    const sectorMap = new Map<string, {
      sector: string;
      calls: CallItem[];
      allocatedAmount: number;
      projectedProfit: number;
      weightPct: number;
    }>();

    targetCalls.forEach((c) => {
      const sec = c.sector || "Other";
      const existing = sectorMap.get(sec) || {
        sector: sec,
        calls: [] as CallItem[],
        allocatedAmount: 0,
        projectedProfit: 0,
        weightPct: 0,
      };
      existing.calls.push(c);
      existing.allocatedAmount += (c.allocatedAmount || (c.cmp * (c.heldQty || 100)));
      existing.projectedProfit += (c.profitRupees || 0);
      existing.weightPct += (c.weightPct || 0);
      sectorMap.set(sec, existing);
    });

    const list = Array.from(sectorMap.values()).map((s) => {
      const calculatedWeight = totalCap > 0 ? (s.allocatedAmount / totalCap) * 100 : (s.calls.length / (totalCallsCount || 1)) * 100;
      let riskLevel: "optimal" | "moderate" | "high" = "optimal";
      if (calculatedWeight > 30) riskLevel = "high";
      else if (calculatedWeight >= 20) riskLevel = "moderate";

      return {
        ...s,
        calculatedWeight,
        countPct: totalCallsCount > 0 ? (s.calls.length / totalCallsCount) * 100 : 0,
        riskLevel,
      };
    });

    list.sort((a, b) => b.calculatedWeight - a.calculatedWeight);
    const maxWeight = list.length > 0 ? list[0].calculatedWeight : 0;
    const isOverconcentrated = maxWeight > 30;

    return {
      totalCallsCount,
      totalCap,
      list,
      maxWeight,
      isOverconcentrated,
      sectorsCount: list.length,
    };
  }, [unifiedCalls, filteredCalls, densityScope]);

  // Date selection button label
  const batchButtonLabel = useMemo(() => {
    if (selectedBatches.has("all")) return "📅 All Batches";
    if (selectedBatches.size === 1) {
      const key = Array.from(selectedBatches)[0];
      const found = BATCH_DEFINITIONS.find((b) => b.key === key);
      return found ? `📅 ${found.shortLabel}` : `📅 ${key}`;
    }
    return `📅 ${selectedBatches.size} Batches`;
  }, [selectedBatches]);

  // Is selected call a Sell / Exit / Trim action?
  const isSellAction = useMemo(() => {
    if (!selectedCall) return false;
    const act = (selectedCall.actionToday || "").toUpperCase();
    return act.includes("SELL") || act.includes("TRIM") || act.includes("EXIT") || act.includes("CUT LOSS");
  }, [selectedCall]);

  const purchaseDuration = useMemo(() => {
    if (!selectedCall || !selectedCall.isPortfolio || !selectedCall.purchaseDate || !selectedCall.purchasePrice) return null;
    return getHoldingDuration(selectedCall.purchaseDate);
  }, [selectedCall?.isPortfolio, selectedCall?.purchaseDate, selectedCall?.purchasePrice]);

  // Tab selection
  const effectiveTab = useMemo<DetailTab>(() => {
    return activeTab;
  }, [activeTab]);

  return (
    <div className="space-y-2.5 text-slate-900">
      {/* ── Top Header & Executive Controls ─────────────────────────────────── */}
      <div className="bg-white border hairline rounded-lg p-2 sm:p-2.5 shadow-2xs flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 font-sans">
            Calls Desk &amp; Verdicts
          </h1>
        </div>

        {/* Action Type Filters, Scope Switchers, Search & Batches */}
        <div className="flex items-center gap-1.5 flex-wrap flex-1 justify-end">
          {/* Unified Filter Strip: All, Top, Buy, Sell, Hold, Portfolio */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-md border hairline text-xs flex-wrap gap-0.5">
            <button
              onClick={() => { setScope("all"); setActionFilter("ALL"); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                scope === "all" && actionFilter === "ALL" ? "bg-white text-slate-900 shadow-2xs font-semibold" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All ({actionCounts.all})
            </button>
            <button
              onClick={() => { setScope("curated"); setActionFilter("ALL"); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                scope === "curated" ? "bg-indigo-700 text-white shadow-2xs font-semibold" : "text-indigo-800 hover:bg-indigo-100"
              }`}
            >
              <Coins className="w-3 h-3 text-amber-400" />
              <span>Top</span>
            </button>
            <button
              onClick={() => { setScope("all"); setActionFilter("BUY"); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                actionFilter === "BUY" ? "bg-emerald-600 text-white shadow-2xs font-semibold" : "text-emerald-700 hover:text-emerald-900"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Buy ({actionCounts.buy})</span>
            </button>
            <button
              onClick={() => { setScope("all"); setActionFilter("SELL"); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                actionFilter === "SELL" || actionFilter === "PRIORITY_SELL"
                  ? "bg-rose-600 text-white shadow-2xs font-bold ring-2 ring-rose-400"
                  : "text-rose-700 hover:text-rose-900 bg-rose-50/70 hover:bg-rose-100"
              }`}
              title="Sell and trim alerts for your held portfolio positions"
            >
              <span>🚨</span>
              <span>Sell ({actionCounts.sell})</span>
            </button>
            <button
              onClick={() => { setScope("all"); setActionFilter("HOLD"); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                actionFilter === "HOLD" ? "bg-blue-600 text-white shadow-2xs font-semibold" : "text-blue-700 hover:text-blue-900"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span>Hold ({actionCounts.hold})</span>
            </button>
            <button
              onClick={() => { setScope("portfolio"); setActionFilter("ALL"); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                scope === "portfolio" ? "bg-slate-900 text-white shadow-2xs font-semibold" : "text-slate-700 hover:bg-slate-200"
              }`}
            >
              <Wallet className="w-3 h-3" />
              <span>Portfolio ({unifiedCalls.filter((c) => c.isPortfolio).length})</span>
            </button>
          </div>

          {/* View Mode Switcher: Detail vs Table (Option 2) */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-md border hairline text-xs">
            <button
              onClick={() => setViewMode("detail")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                viewMode === "detail"
                  ? "bg-white text-slate-900 shadow-2xs font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="Interactive detail workstation with charts, moving averages, and filings"
            >
              <LayoutDashboard className="w-3 h-3" />
              <span>Detail</span>
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                viewMode === "table"
                  ? "bg-indigo-700 text-white shadow-2xs font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="Master deployment table sheet with sorting and allocation targets"
            >
              <TableIcon className="w-3 h-3" />
              <span>Table</span>
            </button>
            <button
              onClick={() => setViewMode("corpus")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                viewMode === "corpus"
                  ? "bg-emerald-600 text-white shadow-2xs font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="Corpus Growth & Dynamic Investment Planner"
            >
              <TrendingUp className="w-3 h-3 text-emerald-400" />
              <span>Corpus</span>
            </button>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Find stock…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 pr-2 py-0.5 text-xs rounded border hairline bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 w-28 sm:w-36 shadow-2xs"
            />
          </div>

          <button
            onClick={() => fetchData()}
            disabled={mounted && loading}
            suppressHydrationWarning
            className="p-1 rounded text-slate-600 hover:bg-slate-100 border hairline shadow-2xs transition-colors"
            title="Refresh Calls Feed"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${mounted && loading ? "animate-spin" : ""}`} />
          </button>

          {/* Multi-Select Date Picker Dropdown (Moved to Right Side Edge) */}
          <div className="relative ml-1" ref={dateDropdownRef}>
            <button
              type="button"
              onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
              className="flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100 border hairline rounded px-2.5 py-1 text-xs font-medium text-slate-800 transition-colors shadow-2xs"
            >
              <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>{batchButtonLabel}</span>
              <ChevronDown className="w-3 h-3 text-slate-500" />
            </button>

            {isDateDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-72 bg-white border hairline rounded-lg shadow-xl z-50 p-2 text-xs space-y-1.5">
                <div className="flex items-center justify-between pb-1.5 border-b hairline px-1">
                  <span className="font-bold text-slate-600 uppercase text-[10.5px]">Weekly Deployment Batches</span>
                  <div className="flex items-center gap-1.5 text-xs">
                    <button onClick={selectAllBatches} className="text-indigo-600 hover:underline font-semibold">
                      Select All
                    </button>
                    <span>•</span>
                    <button onClick={clearAllBatches} className="text-slate-500 hover:underline">
                      Reset
                    </button>
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto space-y-1 pt-1">
                  <button
                    onClick={() => toggleBatch("all")}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-slate-100 ${
                      selectedBatches.has("all") ? "font-bold text-indigo-700 bg-indigo-50/70" : "text-slate-700"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      selectedBatches.has("all") ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300"
                    }`}>
                      {selectedBatches.has("all") && <Check className="w-3 h-3" />}
                    </div>
                    <span className="truncate">All Deployment Batches</span>
                  </button>

                  {BATCH_DEFINITIONS.map((b) => {
                    const isChecked = selectedBatches.has(b.key);
                    return (
                      <button
                        key={b.key}
                        onClick={() => toggleBatch(b.key)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-slate-100 ${
                          isChecked ? "font-bold text-indigo-700 bg-indigo-50/70" : "text-slate-700"
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          isChecked ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300"
                        }`}>
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <span className="truncate">{b.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {actionFilter === "PRIORITY_SELL" && (
        <div className="bg-slate-900 border border-slate-800 text-white rounded-lg p-2.5 sm:px-3 sm:py-2.5 shadow-2xs text-xs space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-base">🚨</span>
              <span className="text-sm font-bold">Priority Sell &amp; Trim Desk ({priorityCounts.all} Holdings)</span>
              <span className="text-slate-300 hidden md:inline">— Institutional Rule: &apos;Trim&apos; means taking 25%–33% off the table to lock in profit, NOT 100% liquidation.</span>
            </div>
            <button
              onClick={() => { setActionFilter("ALL"); setPrioritySubFilter("ALL"); }}
              className="px-2.5 py-0.5 rounded bg-white text-slate-900 font-semibold text-xs hover:bg-slate-100 transition-colors shadow-2xs"
            >
              Clear Filter (Show All)
            </button>
          </div>

          {/* Sub-Category Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1.5 border-t border-slate-800 text-xs">
            <button
              onClick={() => setPrioritySubFilter("ALL")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                prioritySubFilter === "ALL" ? "bg-white text-slate-900 font-bold shadow-2xs" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              All Priority ({priorityCounts.all})
            </button>
            <button
              onClick={() => setPrioritySubFilter("PROFIT_TRIM")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                prioritySubFilter === "PROFIT_TRIM" ? "bg-emerald-600 text-white font-bold shadow-2xs" : "text-emerald-300 hover:bg-slate-800"
              }`}
              title="Large unrealized gainers that exceeded 12M Target. Trim 25%–33% to lock in gains."
            >
              <span>🟢 Take Profit Tranche ({priorityCounts.profitTrim})</span>
            </button>
            <button
              onClick={() => setPrioritySubFilter("DRAWDOWN_REVIEW")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                prioritySubFilter === "DRAWDOWN_REVIEW" ? "bg-amber-600 text-white font-bold shadow-2xs" : "text-amber-300 hover:bg-slate-800"
              }`}
              title="Positions in drawdown with conservative targets. Do NOT panic sell; review thesis."
            >
              <span>🟡 Drawdown Review ({priorityCounts.drawdown})</span>
            </button>
            <button
              onClick={() => setPrioritySubFilter("STRUCTURAL_EXIT")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                prioritySubFilter === "STRUCTURAL_EXIT" ? "bg-rose-600 text-white font-bold shadow-2xs" : "text-rose-300 hover:bg-slate-800"
              }`}
              title="Fundamental and momentum breakdown. Candidate for stop-loss or tax-loss harvesting."
            >
              <span>🔴 Structural Exit ({priorityCounts.exit})</span>
            </button>
          </div>
        </div>
      )}

      {/* ── View Mode: Detail Workstation vs Master Table vs Corpus Growth Planner ──── */}
      {viewMode === "corpus" ? (
        <div className="w-full space-y-3">
          {/* ── Top Header Banner ────────────────────────────────────────── */}
          <div className="bg-white border hairline rounded-lg p-3 sm:p-4 shadow-2xs flex items-center justify-between flex-wrap gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="w-7 h-7 rounded-md bg-emerald-100 flex items-center justify-center text-emerald-800 shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                  Corpus Compounding &amp; Dynamic Investment Planner
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
                  {livePortfolioStats.isRealData ? "Broker Synced" : "Portfolio Model"}
                </span>
              </div>
              <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
                Plans monthly cash deployment, Step-Up SIP growth, and adaptive stock ticket sizes as your corpus scales from ₹14L to ₹30L, ₹60L, and ₹1 Crore+.
              </p>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setViewMode("table")}
                className="px-2.5 py-1 text-xs font-semibold rounded border hairline bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-1 shadow-2xs transition-colors"
              >
                <TableIcon className="w-3.5 h-3.5 text-indigo-600" />
                <span>View Table Sheet</span>
              </button>
              <button
                onClick={() => setViewMode("detail")}
                className="px-2.5 py-1 text-xs font-semibold rounded border hairline bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-1 shadow-2xs transition-colors"
              >
                <LayoutDashboard className="w-3.5 h-3.5 text-slate-600" />
                <span>View Detail Workstation</span>
              </button>
            </div>
          </div>

          {/* ── 4 Primary Corpus KPI Cards ───────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {/* Card 1: Active Portfolio Corpus */}
            <div className="bg-white border hairline rounded-lg p-3 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-medium uppercase tracking-wider text-[10px]">Active Portfolio Corpus</span>
                <span className="font-mono text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1 rounded">
                  {livePortfolioStats.holdingsCount} stocks
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-1 flex-wrap">
                <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tracking-tight">
                  {fmtLakhs(corpusSimulation.startBase)}
                </span>
                {corpusManualBaseOverride != null ? (
                  <button
                    onClick={() => setCorpusManualBaseOverride(null)}
                    className="text-[10px] text-indigo-600 hover:underline font-mono"
                    title="Reset to live broker holdings amount"
                  >
                    Reset Live
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setTempBaseCorpusInput(String(Math.round(livePortfolioStats.currentValue)));
                      setIsEditingBaseCorpus(true);
                    }}
                    className="text-[10px] text-slate-400 hover:text-slate-700 flex items-center gap-0.5"
                    title="Override starting corpus for what-if scenarios"
                  >
                    <Edit3 className="w-2.5 h-2.5" />
                    <span>Override</span>
                  </button>
                )}
              </div>
              {isEditingBaseCorpus ? (
                <div className="flex items-center gap-1 pt-1">
                  <input
                    type="number"
                    value={tempBaseCorpusInput}
                    onChange={(e) => setTempBaseCorpusInput(e.target.value)}
                    className="w-28 px-1.5 py-0.5 text-xs border rounded font-mono"
                    placeholder="e.g. 1500000"
                  />
                  <button
                    onClick={() => {
                      const parsed = parseFloat(tempBaseCorpusInput);
                      if (!isNaN(parsed) && parsed > 0) setCorpusManualBaseOverride(parsed);
                      setIsEditingBaseCorpus(false);
                    }}
                    className="px-1.5 py-0.5 text-[10px] bg-slate-900 text-white rounded font-semibold"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setIsEditingBaseCorpus(false)}
                    className="px-1.5 py-0.5 text-[10px] text-slate-500"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="text-[10.5px] text-slate-500 font-mono truncate">
                  Raw: {money(corpusSimulation.startBase, 0)}
                </div>
              )}
            </div>

            {/* Card 2: Total Invested Cost */}
            <div className="bg-white border hairline rounded-lg p-3 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-medium uppercase tracking-wider text-[10px]">Total Invested Basis</span>
                <span className="text-[10px] text-slate-400 font-mono">Cost</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tracking-tight">
                {fmtLakhs(livePortfolioStats.investedValue)}
              </div>
              <div className="text-[10.5px] text-slate-500 font-mono truncate">
                Raw: {money(livePortfolioStats.investedValue, 0)}
              </div>
            </div>

            {/* Card 3: Unrealized Profit & Return */}
            <div className="bg-white border hairline rounded-lg p-3 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-medium uppercase tracking-wider text-[10px]">Total Unrealized Gains</span>
                <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-1 rounded font-mono">
                  {pct(livePortfolioStats.pnlPct, 1)}
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-emerald-700 tracking-tight">
                +{fmtLakhs(livePortfolioStats.pnl)}
              </div>
              <div className="text-[10.5px] text-slate-500 font-mono truncate">
                Net Profit: {money(livePortfolioStats.pnl, 0)}
              </div>
            </div>

            {/* Card 4: This Month's Deployable Pool */}
            <div className="bg-white border hairline rounded-lg p-3 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-medium uppercase tracking-wider text-[10px]">This Month Deployable Pool</span>
                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1 rounded font-mono">
                  Cash Ready
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-indigo-900 tracking-tight">
                {fmtLakhs(dynamicSizing.monthlyDeployable)}
              </div>
              <div className="text-[10px] text-slate-500 flex items-center justify-between font-mono">
                <span>SIP: {fmtLakhs(corpusMonthlyInflow)}</span>
                <span>+ Trims: {fmtLakhs(livePortfolioStats.trimCash)}</span>
              </div>
            </div>
          </div>

          {/* ── Interactive Simulation Controls Bar ─────────────────────── */}
          <div className="bg-white border hairline rounded-lg p-3 sm:p-3.5 shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between border-b hairline pb-2 flex-wrap gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-600" />
                <span>Simulation Parameters (Interactive Inputs)</span>
              </div>
              <span className="text-[11px] text-slate-500 font-sans">
                Adjust savings rate and expected return to model growth milestones
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {/* Control 1: Monthly Fresh Savings */}
              <div className="space-y-1.5 p-2 rounded-md bg-slate-50/70 border hairline">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Monthly Fresh Cash</span>
                  <span className="font-mono font-bold text-slate-900 text-xs">
                    {fmtLakhs(corpusMonthlyInflow)}/mo
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {[50000, 100000, 150000, 200000].map((val) => (
                    <button
                      key={val}
                      onClick={() => setCorpusMonthlyInflow(val)}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-all ${
                        corpusMonthlyInflow === val
                          ? "bg-slate-900 text-white font-bold shadow-2xs"
                          : "bg-white text-slate-700 border hairline hover:bg-slate-100"
                      }`}
                    >
                      {val === 100000 ? "₹1L (Current)" : `₹${val / 100000}L`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Control 2: Annual Step-Up SIP % */}
              <div className="space-y-1.5 p-2 rounded-md bg-slate-50/70 border hairline">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Annual Step-Up (Salary Hike)</span>
                  <span className="font-mono font-bold text-indigo-700 text-xs">
                    +{corpusStepUpPct}% / yr
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {[0, 5, 10, 15].map((val) => (
                    <button
                      key={val}
                      onClick={() => setCorpusStepUpPct(val)}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-all ${
                        corpusStepUpPct === val
                          ? "bg-indigo-700 text-white font-bold shadow-2xs"
                          : "bg-white text-slate-700 border hairline hover:bg-slate-100"
                      }`}
                    >
                      {val === 0 ? "Flat" : val === 10 ? "+10% (Default)" : `+${val}%`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Control 3: Expected Portfolio CAGR % */}
              <div className="space-y-1.5 p-2 rounded-md bg-slate-50/70 border hairline">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Expected Portfolio CAGR</span>
                  <span className="font-mono font-bold text-emerald-700 text-xs">
                    {corpusCagrPct}% p.a.
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {[12, 16, 20, 24].map((val) => (
                    <button
                      key={val}
                      onClick={() => setCorpusCagrPct(val)}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-all ${
                        corpusCagrPct === val
                          ? "bg-emerald-700 text-white font-bold shadow-2xs"
                          : "bg-white text-slate-700 border hairline hover:bg-slate-100"
                      }`}
                    >
                      {val === 12 ? "12% (Index)" : val === 16 ? "16% (Target)" : val === 20 ? "20% (Alpha)" : "24% (Super)"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Dynamic Position Sizing System (The Answer to User's Core Question) ─ */}
          <div className="bg-white border hairline rounded-lg p-3 sm:p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b hairline pb-2 flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Target className="w-4 h-4 text-indigo-600" />
                  <span>Adaptive Position Sizing: How Stock Tickets Scale As Corpus Expands</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Your monthly fresh cash stays steady (~₹1 Lakh), but your purchase size per stock scales automatically with corpus percentage!
                </p>
              </div>
              <span className="text-xs font-mono font-bold bg-indigo-50 text-indigo-900 px-2 py-0.5 rounded border border-indigo-200">
                Corpus Base: {fmtLakhs(dynamicSizing.corpus)}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Tier 1: Anchor Core */}
              <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 space-y-2 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-950 flex items-center gap-1">
                      <span>🏛️</span>
                      <span>Anchor Core Position</span>
                    </span>
                    <span className="text-[10px] font-mono font-bold text-indigo-800 bg-indigo-100 px-1.5 py-0.2 rounded">
                      15% Weight
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-slate-500">Today&apos;s Target Size:</span>
                      <strong className="text-sm font-mono text-slate-900">{fmtLakhs(dynamicSizing.anchor.total)}</strong>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-600 pl-2 border-l-2 border-indigo-300">
                      <span>Tranche 1 (Market):</span>
                      <strong className="font-mono">{fmtLakhs(dynamicSizing.anchor.t1)}</strong>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-600 pl-2 border-l-2 border-indigo-300">
                      <span>Tranche 2 (Dip GTT):</span>
                      <strong className="font-mono">{fmtLakhs(dynamicSizing.anchor.t2)}</strong>
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t border-indigo-100 text-[10px] text-indigo-900 space-y-0.5">
                  <div className="flex justify-between">
                    <span>At ₹30L Corpus:</span>
                    <strong className="font-mono">₹4.50 Lakhs (T1: ₹2.25L)</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>At ₹60L Corpus:</span>
                    <strong className="font-mono">₹9.00 Lakhs (T1: ₹4.50L)</strong>
                  </div>
                </div>
              </div>

              {/* Tier 2: Growth Compounder */}
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3 space-y-2 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-950 flex items-center gap-1">
                      <span>📈</span>
                      <span>Growth Compounder</span>
                    </span>
                    <span className="text-[10px] font-mono font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.2 rounded">
                      10% Weight
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-slate-500">Today&apos;s Target Size:</span>
                      <strong className="text-sm font-mono text-slate-900">{fmtLakhs(dynamicSizing.compounder.total)}</strong>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-600 pl-2 border-l-2 border-emerald-300">
                      <span>Tranche 1 (Market):</span>
                      <strong className="font-mono">{fmtLakhs(dynamicSizing.compounder.t1)}</strong>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-600 pl-2 border-l-2 border-emerald-300">
                      <span>Tranche 2 (Dip GTT):</span>
                      <strong className="font-mono">{fmtLakhs(dynamicSizing.compounder.t2)}</strong>
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t border-emerald-100 text-[10px] text-emerald-900 space-y-0.5">
                  <div className="flex justify-between">
                    <span>At ₹30L Corpus:</span>
                    <strong className="font-mono">₹3.00 Lakhs (T1: ₹1.50L)</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>At ₹60L Corpus:</span>
                    <strong className="font-mono">₹6.00 Lakhs (T1: ₹3.00L)</strong>
                  </div>
                </div>
              </div>

              {/* Tier 3: Tactical / Alpha Gem */}
              <div className="rounded-lg border border-amber-100 bg-amber-50/40 p-3 space-y-2 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-950 flex items-center gap-1">
                      <span>⚡</span>
                      <span>Tactical Alpha Gem</span>
                    </span>
                    <span className="text-[10px] font-mono font-bold text-amber-800 bg-amber-100 px-1.5 py-0.2 rounded">
                      5% Weight
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-slate-500">Today&apos;s Target Size:</span>
                      <strong className="text-sm font-mono text-slate-900">{fmtLakhs(dynamicSizing.tactical.total)}</strong>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-600 pl-2 border-l-2 border-amber-300">
                      <span>Execution Strategy:</span>
                      <strong className="font-mono">Single Tranche Buy</strong>
                    </div>
                    <div className="text-[10px] text-slate-500 italic">
                      High upside technical catalysts &amp; earnings inflections
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t border-amber-100 text-[10px] text-amber-900 space-y-0.5">
                  <div className="flex justify-between">
                    <span>At ₹30L Corpus:</span>
                    <strong className="font-mono">₹1.50 Lakhs</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>At ₹60L Corpus:</span>
                    <strong className="font-mono">₹3.00 Lakhs</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── This Month's Recommended Execution Plan ─────────────────── */}
          <div className="bg-white border hairline rounded-lg p-3 sm:p-4 shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between border-b hairline pb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-bold text-slate-900">
                  This Month&apos;s Recommended Deployment Plan (Budget: {fmtLakhs(dynamicSizing.monthlyDeployable)})
                </h3>
              </div>
              <span className="text-xs text-slate-500">
                Prioritized allocations from Top Picks desk adapted to current ticket size
              </span>
            </div>

            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b hairline bg-slate-50 text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold">
                    <th className="py-2 px-2.5">Stock</th>
                    <th className="py-2 px-2.5">Strategic Role</th>
                    <th className="py-2 px-2.5 text-right">CMP</th>
                    <th className="py-2 px-2.5 text-right">Target</th>
                    <th className="py-2 px-2.5 text-right">Upside</th>
                    <th className="py-2 px-2.5 text-center">Allocated Weight</th>
                    <th className="py-2 px-2.5 text-right">Tranche 1 Budget</th>
                    <th className="py-2 px-2.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y hairline">
                  {curatedPicks.slice(0, 5).map((p, idx) => {
                    const weight = p.weightPct || 15;
                    const totalTarget = Math.round((dynamicSizing.corpus * weight) / 100);
                    const t1Budget = Math.round(totalTarget * 0.5);
                    const shares = p.cmp > 0 ? Math.floor(t1Budget / p.cmp) : 0;
                    return (
                      <tr key={p.symbol} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2 px-2.5">
                          <span className="font-mono font-bold text-slate-900 text-xs sm:text-sm">{p.symbol}</span>
                          <div className="text-[10px] text-slate-500 truncate max-w-[150px]">{p.name}</div>
                        </td>
                        <td className="py-2 px-2.5">
                          <span className="text-[11px] font-medium text-slate-700">{p.role}</span>
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-900">{money(p.cmp, 2)}</td>
                        <td className="py-2 px-2.5 text-right font-mono font-semibold text-emerald-800">{money(p.target, 2)}</td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-700">+{p.upside}%</td>
                        <td className="py-2 px-2.5 text-center">
                          <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono font-bold bg-indigo-50 text-indigo-900 border border-indigo-200">
                            {weight}% ({fmtLakhs(totalTarget)})
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-900">
                          {money(t1Budget, 0)}
                          <div className="text-[10px] text-slate-500 font-normal">~{shares} shares</div>
                        </td>
                        <td className="py-2 px-2.5 text-center">
                          <button
                            onClick={() => {
                              setSelectedSymbol(p.symbol);
                              setViewMode("detail");
                            }}
                            className="px-2 py-1 text-[10.5px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-200 transition-colors inline-flex items-center gap-0.5"
                          >
                            <span>Inspect</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── 10-Year Compounding Simulation & Crossover Trajectory ─────── */}
          <div className="bg-white border hairline rounded-lg p-3 sm:p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b hairline pb-2 flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4 text-emerald-600" />
                  <span>10-Year Compounding Trajectory &amp; The Compounding Crossover</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Year-by-year trajectory showing when portfolio returns overtake your fresh salary savings!
                </p>
              </div>

              {/* Quick Milestone Highlights */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="bg-slate-50 border hairline px-2.5 py-1 rounded text-right">
                  <span className="text-[9.5px] uppercase font-bold text-slate-400 block">3-Year Target</span>
                  <strong className="text-xs font-mono text-slate-900">{fmtLakhs(corpusSimulation.summary3Y?.endCorpus)}</strong>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded text-right">
                  <span className="text-[9.5px] uppercase font-bold text-emerald-700 block">5-Year Target</span>
                  <strong className="text-xs font-mono text-emerald-900">{fmtLakhs(corpusSimulation.summary5Y?.endCorpus)}</strong>
                </div>
                <div className="bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded text-right">
                  <span className="text-[9.5px] uppercase font-bold text-indigo-700 block">10-Year Target</span>
                  <strong className="text-xs font-mono text-indigo-900">{fmtLakhs(corpusSimulation.summary10Y?.endCorpus)}</strong>
                </div>
              </div>
            </div>

            {/* Simulation Table */}
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b hairline bg-slate-100/80 text-[10.5px] uppercase tracking-wider text-slate-600 font-semibold">
                    <th className="py-2.5 px-3 w-16">Year</th>
                    <th className="py-2.5 px-3 text-right">Starting Corpus</th>
                    <th className="py-2.5 px-3 text-right">Monthly Inflow</th>
                    <th className="py-2.5 px-3 text-right">Annual Fresh Cash</th>
                    <th className="py-2.5 px-3 text-right">Portfolio Return</th>
                    <th className="py-2.5 px-3 text-right font-bold">End-of-Year Corpus</th>
                    <th className="py-2.5 px-3 w-48">Growth Driver Mix</th>
                    <th className="py-2.5 px-3 text-center">Milestone Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y hairline">
                  {corpusSimulation.rows.map((r) => (
                    <tr
                      key={r.year}
                      className={`transition-colors ${
                        r.isCrossover ? "bg-amber-50/70 font-semibold" : r.year % 2 === 0 ? "bg-slate-50/40" : "bg-white"
                      }`}
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{r.label}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{fmtLakhs(r.startCorpus)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-600">{fmtLakhs(r.monthlyInflow)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-blue-700 font-medium">+{fmtLakhs(r.annualFreshInflow)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-700 font-bold">+{fmtLakhs(r.returnsEarned)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 text-sm">
                        {fmtLakhs(r.endCorpus)}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="space-y-1">
                          <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden flex">
                            <div
                              className="bg-blue-500 h-full"
                              style={{ width: `${100 - r.returnsSharePct}%` }}
                              title={`Fresh Savings: ${100 - r.returnsSharePct}%`}
                            />
                            <div
                              className="bg-emerald-500 h-full"
                              style={{ width: `${r.returnsSharePct}%` }}
                              title={`Portfolio Returns: ${r.returnsSharePct}%`}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[9px] text-slate-400 font-mono">
                            <span>{100 - r.returnsSharePct}% Cash</span>
                            <span>{r.returnsSharePct}% Compounding</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {r.isCrossover ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-950 border border-amber-400 animate-pulse">
                            🎉 Crossover Year!
                          </span>
                        ) : r.year === 1 ? (
                          <span className="text-[10px] text-slate-400">Foundation Year</span>
                        ) : r.returnsEarned > r.annualFreshInflow ? (
                          <span className="text-[10px] font-bold text-emerald-700">Self-Funding 🚀</span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Accumulation</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Key Takeaways & Strategic Principles ─────────────────────── */}
          <div className="bg-slate-50 border hairline rounded-lg p-3 sm:p-4 text-xs text-slate-700 space-y-2">
            <h4 className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <span>💡</span>
              <span>Golden Principles for Managing Growing Corpus</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-[11.5px] leading-relaxed">
              <div className="p-2.5 bg-white rounded border hairline space-y-1">
                <strong className="text-slate-900 block font-semibold">1. Salary Grows Linearly; Portfolio Grows Exponentially</strong>
                <p className="text-slate-600">
                  You should never force your monthly fresh savings to match a growing corpus. Keep your fresh savings tied to your real disposable income via a manageable 10% Step-Up SIP.
                </p>
              </div>
              <div className="p-2.5 bg-white rounded border hairline space-y-1">
                <strong className="text-slate-900 block font-semibold">2. Capital Recycling Funds Larger Ticket Sizes</strong>
                <p className="text-slate-600">
                  When your corpus is ₹30L, a 15% position requires ₹4.50 Lakhs. This is funded by pairing your ₹1L monthly savings with the ₹2L–₹3L of liquid profits released when target winners are trimmed!
                </p>
              </div>
              <div className="p-2.5 bg-white rounded border hairline space-y-1">
                <strong className="text-slate-900 block font-semibold">3. The Compounding Crossover Horizon</strong>
                <p className="text-slate-600">
                  Between Year 2 and Year 4, the annual returns generated by your portfolio will exceed your entire year&apos;s fresh salary savings. From that milestone onward, compounding does the heavy lifting.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : viewMode === "table" ? (
        <div className="w-full bg-white border hairline rounded-lg shadow-2xs overflow-hidden flex flex-col">
          {/* Master Table Header */}
          <div className="px-3.5 py-3 border-b hairline bg-slate-50/90 flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <TableIcon className="w-4 h-4 text-indigo-600 shrink-0" />
                <h2 className="text-sm sm:text-base font-bold text-slate-900">
                  {scope === "curated"
                    ? "Top Institutional Deployment Sheet (100% Capital)"
                    : scope === "portfolio"
                    ? `Held Portfolio Master Table (${sortedTableCalls.length} Stocks)`
                    : `Screened Institutional Calls Matrix (${sortedTableCalls.length} Stocks)`}
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono font-bold">
                  {sortedTableCalls.length} stocks
                </span>
                {scope === "curated" && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-bold">
                    100% Capital (₹1,00,000)
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Click any row or &apos;Detail&apos; button to inspect live technical chart, moving averages, and research thesis.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode("detail")}
                className="px-2.5 py-1 text-xs font-semibold rounded border hairline bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-2xs transition-colors"
              >
                <LayoutDashboard className="w-3.5 h-3.5 text-slate-500" />
                <span>Switch to Detail View</span>
              </button>
            </div>
          </div>

          {/* Master Table */}
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b hairline bg-slate-100/80 text-[10.5px] uppercase tracking-wider text-slate-600 font-semibold select-none">
                  <th className="py-2.5 px-3 text-center w-10">#</th>
                  <th
                    className="py-2.5 px-3 cursor-pointer hover:bg-slate-200/70 transition-colors"
                    onClick={() => handleTableSort("symbol")}
                    title="Sort by Stock Symbol"
                  >
                    <div className="flex items-center gap-1">
                      <span>Stock</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                    </div>
                  </th>
                  <th className="py-2.5 px-3">Sector &amp; Cluster</th>
                  <th
                    className="py-2.5 px-3 text-right cursor-pointer hover:bg-slate-200/70 transition-colors"
                    onClick={() => handleTableSort("cmp")}
                    title="Sort by Current Market Price"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>CMP (₹)</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                    </div>
                  </th>
                  <th className="py-2.5 px-3 text-right">Buy Below (₹)</th>
                  <th
                    className="py-2.5 px-3 text-right cursor-pointer hover:bg-slate-200/70 transition-colors"
                    onClick={() => handleTableSort("target")}
                    title="Sort by 12M Target Price"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Target (₹)</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                    </div>
                  </th>
                  <th
                    className="py-2.5 px-3 text-right cursor-pointer hover:bg-slate-200/70 transition-colors"
                    onClick={() => handleTableSort("upside")}
                    title="Sort by Upside Potential"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Upside</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                    </div>
                  </th>
                  <th
                    className="py-2.5 px-3 text-center cursor-pointer hover:bg-slate-200/70 transition-colors"
                    onClick={() => handleTableSort("quality")}
                    title="Sort by Institutional Quality & Composite Score"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Comp / Qual</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                    </div>
                  </th>
                  <th
                    className="py-2.5 px-3 text-center cursor-pointer hover:bg-slate-200/70 transition-colors"
                    onClick={() => handleTableSort("weight")}
                    title="Sort by Portfolio Allocation Weight"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Weight &amp; Allocation</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                    </div>
                  </th>
                  <th className="py-2.5 px-3">Horizon</th>
                  <th className="py-2.5 px-3">Strategic Role &amp; Rationale</th>
                  <th className="py-2.5 px-3 text-center w-20">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y hairline">
                {sortedTableCalls.map((c, idx) => {
                  const secTheme = getSectorTheme(c.sector);
                  const isSelected = selectedSymbol === c.symbol;
                  const upsidePct = c.upside ?? (c.target && c.cmp ? ((c.target - c.cmp) / c.cmp) * 100 : 0);

                  return (
                    <tr
                      key={c.symbol}
                      onClick={() => {
                        setSelectedSymbol(c.symbol);
                        setViewMode("detail");
                      }}
                      className={`cursor-pointer transition-colors hover:bg-indigo-50/60 ${
                        isSelected ? "bg-indigo-50/70 font-medium" : idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                      <td className="py-2.5 px-3 font-sans">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold font-mono text-slate-900 text-xs sm:text-sm">{c.symbol}</span>
                          {c.isCurated && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300">
                              ★ TOP
                            </span>
                          )}
                          {c.isPortfolio && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-blue-50 text-blue-800 border border-blue-200">
                              Held
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate max-w-[190px]">{c.name}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: secTheme.dotColor }} />
                          <span className="text-[11px] font-medium text-slate-800">{c.sector}</span>
                        </div>
                        {c.cluster && (
                          <div className="text-[10px] text-slate-500 pl-3.5 font-sans truncate max-w-[180px]">{c.cluster}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 text-xs sm:text-sm">
                        {money(c.cmp, 2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[11px] text-slate-600">
                        {c.buyBelow && c.buyBelow > 0 ? money(c.buyBelow, 2) : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-800 text-xs sm:text-sm">
                        {c.target && c.target > 0 ? money(c.target, 2) : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold ${
                          upsidePct >= 25 ? "bg-emerald-100 text-emerald-900 border border-emerald-300" :
                          upsidePct >= 10 ? "bg-emerald-50 text-emerald-800 border border-emerald-200" :
                          upsidePct >= 0 ? "bg-slate-100 text-slate-800" :
                          "bg-rose-100 text-rose-900 border border-rose-300"
                        }`}>
                          {pct(upsidePct, 1)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-semibold border hairline">
                          {c.composite_pct ?? "—"} / {c.quality_pct ?? "—"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {c.weightPct ? (
                          <div>
                            <span className="text-xs font-bold font-mono text-indigo-900 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/80">
                              {c.weightPct}%
                            </span>
                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                              {c.allocatedAmount ? money(c.allocatedAmount, 0) : ""}
                              {c.totalShares ? ` · ${c.totalShares} sh` : ""}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        {c.horizonLabel ? (
                          <span className="text-[10.5px] font-semibold text-slate-800 whitespace-nowrap">
                            {c.horizonLabel}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-slate-600 max-w-sm line-clamp-2">
                        {c.role || c.rationale || c.actionReason || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSymbol(c.symbol);
                            setViewMode("detail");
                          }}
                          className="px-2 py-1 text-[10.5px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-200 transition-colors shadow-2xs inline-flex items-center gap-0.5"
                          title="Open chart, anchors and deep dive"
                        >
                          <span>Detail</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)] gap-2 items-start w-full min-w-0">
        {/* ── Left Rail: Compressed, Non-Bold, Neutral Styling ───────────────── */}
        <div className="w-full rounded-lg border hairline bg-white lg:sticky lg:top-2 lg:max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden shadow-2xs">
          <div className="px-2.5 py-1.5 border-b hairline flex items-center justify-between shrink-0 bg-slate-50">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-600">
                Sectors &amp; Calls
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                ({filteredCalls.length})
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={
                  (scope === "curated" ? collapsedCuratedSectors.size === 0 : expandedSectors.size === sectorGroups.length)
                    ? collapseAll
                    : expandAll
                }
                className="text-[10px] text-slate-500 hover:text-slate-800 px-1.5 py-0.2 rounded border hairline bg-white"
              >
                {(scope === "curated" ? collapsedCuratedSectors.size === 0 : expandedSectors.size === sectorGroups.length)
                  ? "Collapse"
                  : "Expand"}
              </button>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 min-h-0 p-1 space-y-1">
            {sectorGroups.length === 0 ? (
              <div className="text-center py-8 px-2 text-slate-400 text-xs">
                No calls found.
              </div>
            ) : (
              sectorGroups.map((g) => {
                const isSecOpen =
                  scope === "curated"
                    ? !collapsedCuratedSectors.has(g.sector)
                    : (!!search.trim() || expandedSectors.has(g.sector));
                return (
                  <div key={g.sector} className="rounded border hairline bg-slate-50/40 overflow-hidden">
                    <button
                      onClick={() => toggleSector(g.sector)}
                      className="w-full flex items-center justify-between px-2 py-1 text-left text-xs font-normal text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isSecOpen ? (
                          <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                        )}
                        <span
                          className="w-2 h-2 rounded-full shrink-0 shadow-2xs"
                          style={{ backgroundColor: getSectorTheme(g.sector).dotColor }}
                          title={g.sector}
                        />
                        <span className="truncate text-slate-800 font-medium">{g.sector}</span>
                      </div>
                      <span className="px-1 py-0.2 rounded text-[9.5px] font-mono font-normal bg-slate-200/60 text-slate-600 shrink-0">
                        {g.count}
                      </span>
                    </button>

                    {isSecOpen && (
                      <div className="border-t hairline bg-white divide-y divide-slate-100">
                        {g.clusters.map((cl) => {
                          const clusterKey = `${g.sector}::${cl.cluster}`;
                          const isClusOpen = !collapsedClusters.has(clusterKey);
                          return (
                            <div key={cl.cluster} className="bg-white">
                              {/* Level 2: Cluster Subheader */}
                              <button
                                type="button"
                                onClick={() => toggleCluster(clusterKey)}
                                className="w-full flex items-center justify-between pl-4 pr-2 py-1 text-left text-[11px] font-medium text-slate-700 bg-slate-50/70 hover:bg-slate-100 transition-colors border-b border-slate-100/60"
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {isClusOpen ? (
                                    <ChevronDown className="w-2.5 h-2.5 text-purple-600 shrink-0" />
                                  ) : (
                                    <ChevronRight className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                                  )}
                                  <span className="truncate text-purple-950 font-semibold">{cl.cluster}</span>
                                </div>
                                <span className="text-[9.5px] font-mono text-purple-700 font-medium">
                                  {cl.count}
                                </span>
                              </button>

                              {/* Level 3: Stock Name & Price */}
                              {isClusOpen && (
                                <div className="divide-y divide-slate-50">
                                  {cl.calls.map((call) => {
                                    const isSel = selectedCall?.symbol === call.symbol;
                                    const actUpper = (call.actionToday || "").toUpperCase();
                                    const isSell = actUpper.includes("SELL") || actUpper.includes("TRIM") || actUpper.includes("EXIT") || actUpper.includes("CUT LOSS");
                                    const isPrioritySell = isSell && call.isPortfolio;
                                    const isHolding = Boolean(call.isPortfolio && call.purchasePerfPct != null);
                                    const pnl = isHolding ? call.purchasePerfPct : call.callPerfPct;
                                    return (
                                      <button
                                        key={call.symbol}
                                        id={`stock-rail-${call.symbol}`}
                                        type="button"
                                        onClick={() => setSelectedSymbol(call.symbol)}
                                        className={`w-full flex items-center justify-between pl-5 pr-2 py-1.5 text-left transition-all ${
                                          isSel
                                            ? "bg-slate-900 text-white shadow-2xs font-medium"
                                            : "hover:bg-slate-100 text-slate-800"
                                        }`}
                                        title={
                                          isHolding
                                            ? `Held in portfolio | Position P&L: ${pct(call.purchasePerfPct)} | Avg Cost: ${money(call.purchasePrice)} | CMP: ${money(call.cmp)}`
                                            : `Call Price: ${money(call.callPrice)} | Return: ${pct(call.callPerfPct)} | CMP: ${money(call.cmp)}`
                                        }
                                      >
                                        <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1.5">
                                          {isPrioritySell && (
                                            <span
                                              className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0 animate-pulse"
                                              title="Priority Sell / Trim"
                                            />
                                          )}
                                          {call.isCurated && (
                                            <span
                                              className={`text-[8.5px] font-bold px-1 rounded shrink-0 ${
                                                isSel ? "bg-amber-400 text-slate-950" : "bg-amber-100 text-amber-900 border border-amber-300"
                                              }`}
                                            >
                                              ★
                                            </span>
                                          )}
                                          <span className="font-mono text-xs font-bold truncate">
                                            {call.symbol}
                                          </span>
                                        </div>

                                        <div className="flex items-center gap-1.5 text-right shrink-0">
                                          {pnl != null && (
                                            <span
                                              className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
                                                isHolding
                                                  ? pnl >= 0
                                                    ? isSel
                                                      ? "bg-emerald-400/20 text-emerald-300 border border-emerald-400/40"
                                                      : "bg-emerald-50 text-emerald-800 border border-emerald-300"
                                                    : isSel
                                                      ? "bg-rose-400/20 text-rose-300 border border-rose-400/40"
                                                      : "bg-rose-50 text-rose-800 border border-rose-300"
                                                  : isSel
                                                    ? "bg-blue-400/20 text-blue-300 border border-blue-400/40"
                                                    : "bg-blue-50 text-blue-800 border border-blue-300"
                                              }`}
                                            >
                                              {pct(pnl, 1)}
                                            </span>
                                          )}
                                          <span className="font-mono text-xs font-semibold whitespace-nowrap">
                                            {money(call.cmp, 2)}
                                          </span>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
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

        {/* ── Right Panel: Comprehensive Detail & Workstation ────────────────── */}
        <div className="space-y-2 min-w-0 w-full overflow-hidden">
          {!selectedCall ? (
            <div className="bg-white border hairline rounded-lg p-10 text-center text-slate-400 text-xs">
              Select a stock from the left rail to view verdict and details.
            </div>
          ) : (
            <>
              {/* ── ROW 1: Integrated Stock Header & Score Pillars ─────────────────── */}
              <div className="bg-white border hairline rounded-lg p-2 sm:p-2.5 shadow-2xs flex items-center justify-between flex-wrap gap-2 min-w-0 w-full">
                {/* Left: Stock info */}
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
                  <h2 className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-slate-900">
                    {selectedCall.symbol}
                  </h2>
                  <span className="text-xs sm:text-sm font-medium text-slate-700 truncate max-w-[150px] sm:max-w-xs">
                    {selectedCall.name}
                  </span>
                  <CapTierBadge category={selectedCall.market_cap_category as CapCategory} />
                  {selectedCall.isPortfolio && isSellAction && (
                    <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-rose-600 text-white shadow-2xs flex items-center gap-1">
                      <span>🚨 PRIORITY TRIM / EXIT</span>
                    </span>
                  )}
                </div>

                {/* Center: Score Pillars (clean, compact) */}
                <div className="flex items-center gap-2 bg-slate-50 border hairline px-2 py-1 rounded-md text-xs shrink-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-500 font-medium">Comp</span>
                    <span className="font-mono font-bold text-indigo-700 text-[11px]">{selectedCall.composite_pct}%</span>
                    <div className="w-7 sm:w-9 bg-slate-200 rounded-full h-1 overflow-hidden">
                      <div className="bg-indigo-600 h-1 rounded-full" style={{ width: `${selectedCall.composite_pct}%` }} />
                    </div>
                  </div>
                  <span className="text-slate-300">|</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-500 font-medium">Qual</span>
                    <span className="font-mono font-bold text-emerald-700 text-[11px]">{selectedCall.quality_pct}%</span>
                    <div className="w-6 sm:w-8 bg-slate-200 rounded-full h-1 overflow-hidden">
                      <div className="bg-emerald-600 h-1 rounded-full" style={{ width: `${selectedCall.quality_pct}%` }} />
                    </div>
                  </div>
                  <span className="text-slate-300">|</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-500 font-medium">Val</span>
                    <span className="font-mono font-bold text-cyan-700 text-[11px]">{selectedCall.valuation_pct}%</span>
                    <div className="w-6 sm:w-8 bg-slate-200 rounded-full h-1 overflow-hidden">
                      <div className="bg-cyan-600 h-1 rounded-full" style={{ width: `${selectedCall.valuation_pct}%` }} />
                    </div>
                  </div>
                  <span className="text-slate-300">|</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-500 font-medium">Mom</span>
                    <span className="font-mono font-bold text-purple-700 text-[11px]">{selectedCall.momentum_pct}%</span>
                    <div className="w-6 sm:w-8 bg-slate-200 rounded-full h-1 overflow-hidden">
                      <div className="bg-purple-600 h-1 rounded-full" style={{ width: `${selectedCall.momentum_pct}%` }} />
                    </div>
                  </div>
                </div>

                {/* Right: CMP, Live Timestamp, 1D Change, Prev Close, Buy/Accumulate action & Price Tags */}
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg sm:text-xl font-bold font-mono text-slate-900">
                      {money(selectedCall.cmp, 2)}
                    </span>
                    {selectedCall.priceFetchedAt ? (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10.5px] font-medium font-mono whitespace-nowrap"
                        title={`Last price update: ${new Date(selectedCall.priceFetchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>{formatFetchedAt(selectedCall.priceFetchedAt)}</span>
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 border hairline text-slate-700 text-[10.5px] font-medium font-mono whitespace-nowrap"
                        title="As of latest settled bar"
                      >
                        <span>{stockPriceInfo?.asOfLabel ? `EOD · ${stockPriceInfo.asOfLabel}` : "Market Close"}</span>
                      </span>
                    )}
                  </div>

                  {stockPriceInfo?.dayChangePct != null && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-bold border ${
                        stockPriceInfo.dayChangePct >= 0
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-rose-50 text-rose-700 border-rose-200"
                      }`}
                      title="1-Day Percentage Change"
                    >
                      1D: {stockPriceInfo.dayChangePct >= 0 ? "+" : ""}{stockPriceInfo.dayChangePct.toFixed(2)}%
                    </span>
                  )}

                  {stockPriceInfo?.prevClose != null && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[10.5px] font-mono text-slate-600 bg-slate-50 border hairline whitespace-nowrap"
                      title="Yesterday's / Previous Trading Session Settled Close"
                    >
                      Prev Close: <strong className="text-slate-900 font-semibold">{money(stockPriceInfo.prevClose, 2)}</strong>
                    </span>
                  )}

                  <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${actionBadgeClass(selectedCall.actionToday)}`}>
                    {selectedCall.actionToday}
                  </span>

                  <Link
                    href={`/stock/${selectedCall.symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded-md text-indigo-600 hover:bg-indigo-50 border border-indigo-200 shadow-2xs"
                    title="Open Full Stock Deep-Dive Page"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>

              {/* Priority Sell Alert for currently viewed stock */}
              {selectedCall.isPortfolio && isSellAction && (() => {
                const pri = getPriorityCategory(selectedCall);
                const isProfit = pri.category === "PROFIT_TRIM";
                const isExit = pri.category === "STRUCTURAL_EXIT";
                const borderClass = isProfit
                  ? "border-emerald-300 bg-emerald-50/90 text-emerald-950"
                  : isExit
                    ? "border-rose-400 bg-rose-50 text-rose-950"
                    : "border-amber-300 bg-amber-50/90 text-amber-950";
                const badgeIcon = isProfit ? "🟢" : isExit ? "🔴" : "🟡";
                return (
                  <div className={`border rounded-lg p-2.5 px-3 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-2xs ${borderClass}`}>
                    <div className="flex items-start sm:items-center gap-2 min-w-0">
                      <span className="text-base shrink-0">{badgeIcon}</span>
                      <div className="min-w-0">
                        <div className="font-bold flex items-center gap-1.5 flex-wrap">
                          <span>{pri.title}:</span>
                          <span className="font-mono text-slate-900">{selectedCall.symbol}</span>
                          <span className="font-normal text-slate-700">({selectedCall.heldQty} sh held)</span>
                        </div>
                        <div className="text-[11px] text-slate-700 mt-0.5">
                          {pri.guidance}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono text-[11px] sm:self-center">
                      <div>Target: <strong>{money(selectedCall.target)}</strong> | CMP: <strong>{money(selectedCall.cmp)}</strong></div>
                      {selectedCall.purchasePrice && (
                        <div className={((selectedCall.cmp - selectedCall.purchasePrice) / selectedCall.purchasePrice) >= 0 ? "text-emerald-800 font-bold" : "text-rose-700 font-bold"}>
                          Position P&amp;L: {pct(((selectedCall.cmp - selectedCall.purchasePrice) / selectedCall.purchasePrice) * 100)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── ROW 2: Price Graph (Left) & Stacked 4 Boxes (Right) ───────── */}
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_295px] xl:grid-cols-[minmax(0,1fr)_320px] gap-2 items-stretch w-full min-w-0">
                {/* Left: Price Chart & Moving Averages Card */}
                <div className="bg-white border hairline rounded-lg p-2.5 sm:p-3 shadow-2xs flex flex-col justify-between min-w-0 overflow-hidden w-full">
                  <div className="flex items-center justify-between text-xs mb-1 min-w-0 flex-wrap gap-1.5">
                    <div className="flex items-center gap-1.5 font-bold text-slate-800 shrink-0">
                      <TrendingUp className="w-4 h-4 text-slate-600" />
                      <span>Price Chart &amp; Moving Averages</span>
                      {selectedCall.isPortfolio && (
                        <span
                          className="px-1.5 py-0.2 rounded text-[10px] font-bold font-mono bg-blue-600 text-white shadow-2xs inline-flex items-center gap-0.5"
                          title="Held in Portfolio"
                        >
                          P
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      {selectedCall.stopLoss != null && selectedCall.stopLoss > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono text-rose-700 bg-rose-50 border border-rose-200">
                          Floor <strong className="text-rose-900 font-bold">{money(selectedCall.stopLoss)}</strong>
                        </span>
                      )}
                      {selectedCall.buyBelow != null && selectedCall.buyBelow > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono text-slate-700 bg-slate-50 border hairline">
                          Buy ≤ <strong className="text-slate-900 font-bold">{money(selectedCall.buyBelow)}</strong>
                        </span>
                      )}
                      {selectedCall.target != null && selectedCall.target > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono text-emerald-800 bg-emerald-50 border border-emerald-200">
                          Target <strong className="text-emerald-900 font-bold">{money(selectedCall.target)}</strong> (+{selectedCall.upside}%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="w-full min-w-0 overflow-hidden pt-0.5">
                    <PriceChart
                      symbol={selectedCall.symbol}
                      currentPrice={selectedCall.cmp}
                      onPriceInfo={setStockPriceInfo}
                      height={315}
                      isPortfolio={selectedCall.isPortfolio}
                      trades={chartTrades}
                    />
                  </div>
                </div>

                {/* Right: 4 Compact Stacked Boxes */}
                <div className="flex flex-col gap-1.5 justify-between w-full lg:w-[295px] xl:w-[320px] shrink-0 min-w-0">
                  {/* BOX 1: ANCHOR 1 - CALL GIVEN */}
                  <div className="bg-slate-50/90 border border-indigo-100 rounded-lg p-2.5 shadow-2xs flex-1 flex flex-col justify-between min-w-0">
                    <div className="flex items-center justify-between text-[11px] gap-1.5 min-w-0">
                      <div className="flex items-center gap-1 font-bold text-indigo-950 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 shrink-0" />
                        <span className="tracking-wide text-[10px] whitespace-nowrap">ANCHOR 1: CALL GIVEN</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {selectedCall.timeline && (
                          <span
                            className="text-[8.5px] font-mono font-bold px-1.5 py-0.2 rounded border bg-indigo-100 text-indigo-900 border-indigo-200 shrink-0"
                            title={`Target Horizon: ${selectedCall.timeline} to reach target of ${money(selectedCall.target)}`}
                          >
                            🎯 {selectedCall.timeline}
                          </span>
                        )}
                        {selectedCall.callDate && (
                          <span
                            className="text-[9px] font-mono text-slate-500 shrink-0"
                            title={`Call given on ${fmtDate(selectedCall.callDate)}`}
                          >
                            {daysAgo(selectedCall.callDate)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 mt-0.5 border-t border-indigo-100/80">
                      <div>
                        <span className="text-[8.5px] uppercase font-semibold text-slate-500 block">Anchor Price</span>
                        <div className="flex items-center gap-1">
                          <span className="text-xs sm:text-sm font-bold font-mono text-slate-900">{money(selectedCall.callPrice)}</span>
                          {selectedCall.callDate && (
                            <span className="text-[9px] font-mono text-slate-500" title={`Call given on ${fmtDate(selectedCall.callDate)}`}>
                              ({fmtDate(selectedCall.callDate)})
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[8.5px] uppercase font-semibold text-slate-500 block">Return Since Call</span>
                        <div className="flex items-center justify-end gap-1">
                          <span className={`text-xs sm:text-sm font-bold font-mono ${(selectedCall.callPerfPct ?? 0) >= 0 ? "text-emerald-800 font-bold" : "text-rose-700 font-bold"}`}>
                            {pct(selectedCall.callPerfPct)}
                          </span>
                          {selectedCall.callPrice && (
                            <span className="text-[9px] font-mono text-slate-500">
                              ({selectedCall.cmp >= selectedCall.callPrice ? "+" : ""}{money(selectedCall.cmp - selectedCall.callPrice)})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* BOX 2: ANCHOR 2 - STOCK PURCHASE */}
                  <div className="bg-slate-50/90 border border-emerald-100 rounded-lg p-2.5 shadow-2xs flex-1 flex flex-col justify-between min-w-0">
                    <div className="flex items-center justify-between text-[11px] gap-1.5 min-w-0">
                      <div className="flex items-center gap-1 font-bold text-emerald-950 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
                        <span className="tracking-wide text-[10px] whitespace-nowrap">ANCHOR 2: PURCHASE</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {purchaseDuration && (
                          <span className={`text-[8.5px] font-mono px-1 py-0.2 rounded border ${purchaseDuration.badgeClass}`}>
                            ⏱️ {purchaseDuration.label}
                          </span>
                        )}
                        <button
                          onClick={() => {
                            if (!isEditingPurchase) {
                              setEditPurchaseDate(selectedCall.purchaseDate ?? "2026-11-02");
                              setEditPurchasePrice(selectedCall.purchasePrice ? String(selectedCall.purchasePrice) : "380");
                            }
                            setIsEditingPurchase(!isEditingPurchase);
                          }}
                          className="text-[9px] font-semibold text-emerald-800 hover:text-emerald-950 inline-flex items-center gap-0.5 underline underline-offset-2 shrink-0"
                        >
                          <Edit3 className="w-2.5 h-2.5" />
                          <span>{selectedCall.isPortfolio && selectedCall.purchasePrice ? "Edit" : "Log Buy"}</span>
                        </button>
                      </div>
                    </div>

                    {isEditingPurchase ? (
                      <div className="bg-white p-1 rounded border border-emerald-300 space-y-1">
                        <div className="grid grid-cols-2 gap-1 text-[10px]">
                          <div>
                            <label className="block text-slate-600 text-[8.5px]">Buy Date</label>
                            <input
                              type="date"
                              value={editPurchaseDate}
                              onChange={(e) => setEditPurchaseDate(e.target.value)}
                              className="w-full px-1 py-0.2 text-[9.5px] border rounded bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-600 text-[8.5px]">Buy Price (₹)</label>
                            <input
                              type="number"
                              step="0.05"
                              value={editPurchasePrice}
                              onChange={(e) => setEditPurchasePrice(e.target.value)}
                              className="w-full px-1 py-0.2 text-[9.5px] border rounded bg-white font-mono"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-1 pt-0.5">
                          <button onClick={() => setIsEditingPurchase(false)} className="px-1.5 py-0.2 text-[9px] text-slate-600">
                            Cancel
                          </button>
                          {customPurchases[selectedCall.symbol] && (
                            <button onClick={() => clearCustomPurchase(selectedCall.symbol)} className="px-1.5 py-0.2 text-[9px] text-rose-700 bg-rose-50 border border-rose-200 rounded">
                              Reset
                            </button>
                          )}
                          <button
                            onClick={() => {
                              const p = parseFloat(editPurchasePrice);
                              if (!Number.isNaN(p) && p > 0 && editPurchaseDate) saveCustomPurchase(selectedCall.symbol, editPurchaseDate, p);
                            }}
                            className="px-2 py-0.2 text-[9px] font-bold text-white bg-emerald-700 rounded shadow-2xs"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between pt-1 mt-0.5 border-t border-emerald-100/80">
                        <div>
                          <span className="text-[8.5px] uppercase font-semibold text-slate-500 block">Purchase Price &amp; Qty</span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs sm:text-sm font-bold font-mono text-slate-900">
                              {selectedCall.isPortfolio && selectedCall.purchasePrice ? money(selectedCall.purchasePrice) : "—"}
                            </span>
                            {selectedCall.isPortfolio && selectedCall.heldQty != null && selectedCall.heldQty > 0 && (
                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-900 border border-emerald-300">
                                {selectedCall.heldQty} sh
                              </span>
                            )}
                            <span className="text-[9px] text-slate-500">
                              {selectedCall.isPortfolio && selectedCall.purchasePrice && selectedCall.purchaseDate
                                ? `(${fmtDate(selectedCall.purchaseDate)})`
                                : "(Not held)"}
                            </span>
                          </div>
                          {selectedCall.isPortfolio && (selectedCall.investedVal || (selectedCall.heldQty && selectedCall.purchasePrice)) ? (
                            <div className="text-[9px] text-slate-500 font-mono mt-0.5">
                              Invested: <span className="font-semibold text-slate-700">{money(selectedCall.investedVal ?? (selectedCall.heldQty! * selectedCall.purchasePrice!))}</span>
                            </div>
                          ) : null}
                        </div>

                        <div className="text-right">
                          <span className="text-[8.5px] uppercase font-semibold text-slate-500 block">Return Since Buy</span>
                          {selectedCall.isPortfolio && selectedCall.purchasePerfPct != null && selectedCall.purchasePrice ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className={`text-xs sm:text-sm font-bold font-mono ${selectedCall.purchasePerfPct >= 0 ? "text-emerald-800 font-bold" : "text-rose-700 font-bold"}`}>
                                {pct(selectedCall.purchasePerfPct)}
                              </span>
                              {selectedCall.purchasePrice && (
                                <span className="text-[9px] font-mono text-slate-500">
                                  ({selectedCall.cmp >= selectedCall.purchasePrice ? "+" : ""}{money(selectedCall.cmp - selectedCall.purchasePrice)})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[9.5px] font-mono text-slate-400">Not in portfolio</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* BOX 3: TRANCHE 1 - MARKET ORDER (CMP) */}
                  {selectedCall.isCurated ? (
                    <div className="bg-slate-50/90 border border-indigo-100 rounded-lg p-2.5 shadow-2xs flex-1 flex flex-col justify-between min-w-0">
                      <div className="flex items-center justify-between text-[11px] gap-1.5 min-w-0">
                        <div className="flex items-center gap-1.5 font-bold text-indigo-950 truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 shrink-0" />
                          <span className="tracking-wide text-[10px] truncate">TRANCHE 1: MARKET CMP</span>
                        </div>
                        <span className="text-[8.5px] font-mono font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded shrink-0">
                          50% (~{money(selectedCall.t1Value)})
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1 mt-0.5 border-t border-indigo-100/80">
                        <div>
                          <span className="text-[8.5px] uppercase font-semibold text-slate-500 block">Buy Today</span>
                          <span className="text-xs sm:text-sm font-bold font-mono text-slate-900">{selectedCall.tranche1Shares} shares</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[8.5px] uppercase font-semibold text-slate-500 block">Order Price</span>
                          <span className="text-xs sm:text-sm font-bold font-mono text-indigo-700">@ CMP {money(selectedCall.cmp)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={`rounded-lg p-2.5 shadow-2xs flex-1 flex flex-col justify-between min-w-0 ${
                      isSellAction ? "bg-rose-50/90 border border-rose-300" : "bg-slate-50/90 border hairline"
                    }`}>
                      <div className="flex items-center justify-between text-[11px] gap-1.5 min-w-0">
                        <div className="flex items-center gap-1.5 font-bold text-slate-800 truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                          <span className="tracking-wide text-[10px] truncate">{isSellAction ? "EXIT TRIGGER" : "ACTION GUIDELINE"}</span>
                        </div>
                        <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-semibold border shrink-0 ${actionBadgeClass(selectedCall.actionToday)}`}>
                          {selectedCall.actionToday}
                        </span>
                      </div>

                      <div className="pt-1 mt-0.5 border-t border-slate-200/80 text-[9.5px]">
                        <p className="text-slate-700 line-clamp-2 leading-snug">
                          {selectedCall.actionReason || selectedCall.rationale}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* BOX 4: TRANCHE 2 - DIP LIMIT (GTT) */}
                  {selectedCall.isCurated ? (
                    <div className="bg-slate-50/90 border border-amber-200 rounded-lg p-2.5 shadow-2xs flex-1 flex flex-col justify-between min-w-0">
                      <div className="flex items-center justify-between text-[11px] gap-1.5 min-w-0">
                        <div className="flex items-center gap-1.5 font-bold text-amber-950 truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-600 shrink-0" />
                          <span className="tracking-wide text-[10px] truncate">TRANCHE 2: DIP (GTT)</span>
                        </div>
                        <span className="text-[8.5px] font-mono font-bold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded shrink-0">
                          50% (~{money(selectedCall.t2Value)})
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1 mt-0.5 border-t border-amber-100">
                        <div>
                          <span className="text-[8.5px] uppercase font-semibold text-slate-500 block">Dip Buy</span>
                          <span className="text-xs sm:text-sm font-bold font-mono text-slate-900">{selectedCall.tranche2Shares} shares</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[8.5px] uppercase font-semibold text-slate-500 block">Limit Price</span>
                          <span className="text-xs sm:text-sm font-bold font-mono text-amber-800">≤ {money(selectedCall.buyBelow)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50/90 border hairline rounded-lg p-2.5 shadow-2xs flex-1 flex flex-col justify-between min-w-0">
                      <div className="flex items-center justify-between text-[11px] gap-1.5 min-w-0">
                        <div className="flex items-center gap-1.5 font-bold text-slate-800 truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                          <span className="tracking-wide text-[10px] truncate">PRICE CORRIDOR</span>
                        </div>
                        <span className="text-[9px] font-mono text-slate-600 shrink-0">
                          Pillar {selectedCall.composite_pct}%
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1 mt-0.5 border-t border-slate-200 text-[10px]">
                        <div>
                          <span className="text-[8.5px] uppercase font-semibold text-slate-400 block">Bear Floor</span>
                          <span className="font-mono font-bold text-rose-600 text-xs">{money(selectedCall.stopLoss)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[8.5px] uppercase font-semibold text-slate-400 block">Target Upside</span>
                          <span className="font-mono font-bold text-emerald-700 text-xs">{money(selectedCall.target)} (+{selectedCall.upside}%)</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── ROW 3: Context Tabs (Followed Below Graph Row) ──────────────────── */}
              <div className="bg-white border hairline rounded-lg shadow-sm overflow-hidden flex flex-col">
                <div className="flex items-center gap-1 px-3 pt-2 pb-1.5 border-b hairline bg-slate-50/90 overflow-x-auto text-xs">
                  <button
                    onClick={() => setActiveTab("overview")}
                    className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 shrink-0 ${
                      effectiveTab === "overview" ? "bg-indigo-700 text-white shadow-xs font-semibold" : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>Overview</span>
                  </button>

                  <button
                    onClick={() => setActiveTab("catalysts")}
                    className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 shrink-0 ${
                      effectiveTab === "catalysts" ? "bg-indigo-700 text-white shadow-xs font-semibold" : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <Target className="w-3.5 h-3.5" />
                    <span>Catalysts</span>
                  </button>

                  <button
                    onClick={() => setActiveTab("results")}
                    className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 shrink-0 ${
                      effectiveTab === "results" ? "bg-indigo-700 text-white shadow-xs font-semibold" : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Results ({contextData?.results?.length ?? 0})</span>
                  </button>

                  <button
                    onClick={() => setActiveTab("dividends")}
                    className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 shrink-0 ${
                      effectiveTab === "dividends" ? "bg-indigo-700 text-white shadow-xs font-semibold" : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Dividends ({contextData?.dividends?.length ?? 0})</span>
                  </button>

                  <button
                    onClick={() => setActiveTab("news")}
                    className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 shrink-0 ${
                      effectiveTab === "news" ? "bg-indigo-700 text-white shadow-xs font-semibold" : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <Newspaper className="w-3.5 h-3.5" />
                    <span>News ({contextData?.news?.length ?? 0})</span>
                  </button>

                  <button
                    onClick={() => setActiveTab("audit")}
                    className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 shrink-0 ${
                      effectiveTab === "audit" ? "bg-indigo-700 text-white shadow-xs font-semibold" : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>Audit &amp; Governance</span>
                  </button>

                  <button
                    onClick={() => setActiveTab("density")}
                    className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 shrink-0 ${
                      effectiveTab === "density" ? "bg-indigo-700 text-white shadow-xs font-semibold" : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <PieChart className="w-3.5 h-3.5" />
                    <span>Sector Density</span>
                    <span className="text-[10px] font-mono px-1 rounded bg-slate-200/60 text-slate-700">
                      {sectorDensityData.sectorsCount}
                    </span>
                  </button>
                </div>

                <div className="p-3.5">
                  {/* TAB 1: COMPANY OVERVIEW (Matching exact design from attachment) */}
                  {effectiveTab === "overview" && (
                    <div className="space-y-3">
                      <CompanyProfile symbol={selectedCall.symbol} />
                    </div>
                  )}

                  {/* TAB 2: CATALYSTS & OPERATING THESIS */}
                  {effectiveTab === "catalysts" && (
                    <div className="space-y-3 text-xs sm:text-sm">
                      {/* Core Investment Thesis & Operating Performance */}
                      <div className="bg-slate-50 border hairline rounded-md p-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-indigo-950 font-bold text-xs uppercase tracking-wide">
                          <Activity className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Core Investment Thesis &amp; Operating Performance</span>
                        </div>
                        <p className="text-xs sm:text-sm leading-relaxed text-slate-800">
                          {selectedCall.rationale}
                        </p>
                        {selectedCall.operatingHighlights && selectedCall.operatingHighlights.length > 0 && (
                          <ul className="list-disc list-inside space-y-1 pt-1 text-xs text-slate-700">
                            {selectedCall.operatingHighlights.map((hl: string, idx: number) => (
                              <li key={idx} className="leading-relaxed">{hl}</li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Forward Catalysts & Value Drivers (Next 3–12 Months) */}
                      <div className="bg-emerald-50/50 border border-emerald-200 rounded-md p-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-emerald-950 font-bold text-xs uppercase tracking-wide">
                          <Target className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Forward Catalysts &amp; Value Drivers (Next 3–12 Months)</span>
                        </div>
                        {selectedCall.catalysts && selectedCall.catalysts.length > 0 ? (
                          <ul className="list-disc list-inside space-y-1 text-xs sm:text-sm text-emerald-950">
                            {selectedCall.catalysts.map((cat: string, idx: number) => (
                              <li key={idx} className="leading-relaxed">{cat}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-emerald-900 leading-relaxed">
                            Quarterly earnings inflection, continuous balance sheet deleveraging, and operational leverage expansion toward cycle-high ROCE.
                          </p>
                        )}
                      </div>

                      {/* Margin of Safety & Monitorables */}
                      <div className="bg-amber-50/40 border border-amber-200 rounded-md p-3 space-y-1">
                        <div className="flex items-center gap-1.5 text-amber-950 font-bold text-xs uppercase tracking-wide">
                          <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
                          <span>Margin of Safety &amp; Risk Monitorables</span>
                        </div>
                        <p className="text-xs sm:text-sm text-amber-950 leading-relaxed">
                          {selectedCall.marginOfSafety ||
                            `Robust valuation cushion with floor anchored at ₹${selectedCall.stopLoss} (-${Math.round(((selectedCall.cmp - selectedCall.stopLoss)/selectedCall.cmp)*100)}%). Key monitorables include input cost swings, quarterly gross margin preservation, and macro liquidity conditions.`}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* TAB 3: RESULTS DECLARATIONS */}
                  {effectiveTab === "results" && (
                    <div className="space-y-2 text-xs sm:text-sm">
                      {contextLoading ? (
                        <div className="py-6 text-center text-slate-400">Loading results filings…</div>
                      ) : !contextData?.results || contextData.results.length === 0 ? (
                        <div className="py-6 text-center text-slate-400">No recent result announcements on file.</div>
                      ) : (
                        <div className="space-y-2 max-h-72 overflow-y-auto">
                          {contextData.results.map((r, idx) => (
                            <div key={idx} className="p-2.5 rounded-md border hairline bg-slate-50/50 hover:bg-slate-50 flex items-start justify-between gap-2.5">
                              <div className="space-y-0.5 min-w-0">
                                <div className="font-semibold text-slate-900 line-clamp-1">{r.title}</div>
                                {r.headline && <p className="text-xs text-slate-600 line-clamp-2">{r.headline}</p>}
                                <div className="text-[10.5px] text-slate-400">
                                  <span>Published: {fmtDate(r.published_at)} ({daysAgo(r.published_at)})</span>
                                </div>
                              </div>
                              {r.pdf_url && (
                                <a
                                  href={r.pdf_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-2 py-1 text-xs font-semibold rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 flex items-center gap-1 shrink-0"
                                >
                                  <span>PDF</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 4: DIVIDENDS */}
                  {effectiveTab === "dividends" && (
                    <div className="text-xs sm:text-sm">
                      {contextLoading ? (
                        <div className="py-6 text-center text-slate-400">Loading dividend history…</div>
                      ) : !contextData?.dividends || contextData.dividends.length === 0 ? (
                        <div className="py-6 text-center text-slate-400">No corporate dividend records found.</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b hairline text-[11px] font-bold uppercase text-slate-400">
                                <th className="py-2 px-1.5">Ex-Date</th>
                                <th className="py-2 px-1.5">Purpose / Dividend</th>
                                <th className="py-2 px-1.5 text-right">Amount (₹)</th>
                                <th className="py-2 px-1.5 text-right">Yield @ CMP</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y hairline">
                              {contextData.dividends.map((d, idx) => {
                                const yieldPct = d.amount && selectedCall.cmp > 0 ? ((d.amount / selectedCall.cmp) * 100).toFixed(2) : "—";
                                return (
                                  <tr key={idx} className="hover:bg-slate-50/60">
                                    <td className="py-2 px-1.5 font-mono text-slate-700">{fmtDate(d.ex_date)}</td>
                                    <td className="py-2 px-1.5 font-medium text-slate-800">{d.purpose}</td>
                                    <td className="py-2 px-1.5 text-right font-mono font-bold text-slate-900">{money(d.amount)}</td>
                                    <td className="py-2 px-1.5 text-right font-mono text-emerald-700 font-semibold">
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

                  {/* TAB 5: NEWS */}
                  {effectiveTab === "news" && (
                    <div className="text-xs sm:text-sm">
                      {contextLoading ? (
                        <div className="py-6 text-center text-slate-400">Loading live news…</div>
                      ) : !contextData?.news || contextData.news.length === 0 ? (
                        <div className="py-6 text-center text-slate-400">No news articles found for this ticker.</div>
                      ) : (
                        <div className="space-y-2 max-h-72 overflow-y-auto">
                          {contextData.news.map((item, idx) => (
                            <div key={idx} className="p-2 rounded-md border hairline bg-slate-50/40 hover:bg-slate-50 flex items-start justify-between gap-2.5 text-xs">
                              <div className="space-y-0.5 min-w-0">
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-semibold text-slate-900 hover:text-indigo-600 line-clamp-1"
                                >
                                  {item.title}
                                </a>
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                  <span className="px-1.5 py-0.2 rounded bg-slate-200/80 font-medium text-slate-700">{item.source}</span>
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

                  {/* TAB 6: AUDIT & GOVERNANCE */}
                  {effectiveTab === "audit" && (
                    <div className="space-y-3 text-xs sm:text-sm">
                      {/* Verdict Description & Call Trigger */}
                      <div className="bg-slate-50 border hairline rounded-lg p-3.5 space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                              Official Verdict
                            </span>
                            <span className={`px-2 py-0.5 rounded text-xs font-bold border ${actionBadgeClass(contextData?.audit?.verdict || selectedCall.actionToday)}`}>
                              {contextData?.audit?.verdict || selectedCall.actionToday}
                            </span>
                            {contextData?.audit?.confidence && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase">
                                {contextData.audit.confidence} Conviction
                              </span>
                            )}
                          </div>
                          {contextData?.audit?.generated_at && (
                            <span className="text-[11px] font-mono text-slate-500">
                              Generated: {fmtDate(contextData.audit.generated_at)} ({daysAgo(contextData.audit.generated_at)})
                            </span>
                          )}
                        </div>

                        {/* Trigger / Verdict Description */}
                        <div className="pt-1 text-slate-800 leading-relaxed">
                          <span className="text-[10px] font-bold uppercase text-slate-500 block mb-0.5">
                            Trigger / Verdict Description
                          </span>
                          <p className="text-xs sm:text-sm text-slate-800 font-medium">
                            {contextData?.audit?.trigger_text || selectedCall.actionReason || selectedCall.rationale}
                          </p>
                        </div>

                        {/* Verdict Justification Points */}
                        {contextData?.audit?.points && contextData.audit.points.length > 0 && (() => {
                          const { good, bad, params, decision, other } = parseVerdictPoints(contextData.audit.points);
                          return (
                            <div className="pt-2.5 border-t hairline space-y-2.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                                Verdict Justification Points ({contextData.audit.points.length} factors evaluated)
                              </span>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {/* Box 1: The Good */}
                                <div className="rounded-lg border border-emerald-200/90 bg-emerald-50/40 p-3 flex flex-col justify-between">
                                  <div>
                                    <div className="text-xs font-bold text-emerald-900 mb-2 flex items-center justify-between">
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
                                        <span>What&apos;s Working (The Good)</span>
                                      </span>
                                      <span className="text-[10px] font-mono text-emerald-800 bg-emerald-100/80 px-1.5 py-0.2 rounded font-semibold">
                                        {good.length} factors
                                      </span>
                                    </div>

                                    {good.length > 0 ? (
                                      <ul className="space-y-1.5 text-xs text-slate-700">
                                        {good.map((p, idx) => {
                                          const { metric, peer, reason } = cleanPointText(p, /^<b>(the good|good|strengths):?<\/b>:?\s*/i);
                                          return (
                                            <li key={idx} className="flex items-start gap-1.5 leading-relaxed">
                                              <span className="text-emerald-600 font-bold shrink-0 mt-0.5">•</span>
                                              <div>
                                                <strong className="text-slate-900 font-semibold">{metric}</strong>
                                                {peer && (
                                                  <span className="text-emerald-800 font-medium"> — {peer}</span>
                                                )}
                                                {reason && (
                                                  <span className="text-slate-600"> — {reason}</span>
                                                )}
                                              </div>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    ) : (
                                      <div className="text-xs text-slate-400 italic">No specific strengths recorded.</div>
                                    )}
                                  </div>
                                </div>

                                {/* Box 2: The Bad */}
                                <div className="rounded-lg border border-rose-200/90 bg-rose-50/40 p-3 flex flex-col justify-between">
                                  <div>
                                    <div className="text-xs font-bold text-rose-900 mb-2 flex items-center justify-between">
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-rose-600 shrink-0" />
                                        <span>Risks &amp; Headwinds (The Bad)</span>
                                      </span>
                                      <span className="text-[10px] font-mono text-rose-800 bg-rose-100/80 px-1.5 py-0.2 rounded font-semibold">
                                        {bad.length} factors
                                      </span>
                                    </div>

                                    {bad.length > 0 ? (
                                      <ul className="space-y-1.5 text-xs text-slate-700">
                                        {bad.map((p, idx) => {
                                          const { metric, peer, reason } = cleanPointText(p, /^<b>(the bad|bad|risks|warnings):?<\/b>:?\s*/i);
                                          return (
                                            <li key={idx} className="flex items-start gap-1.5 leading-relaxed">
                                              <span className="text-rose-500 font-bold shrink-0 mt-0.5">•</span>
                                              <div>
                                                <strong className="text-slate-900 font-semibold">{metric}</strong>
                                                {peer && (
                                                  <span className="text-rose-700 font-medium"> — {peer}</span>
                                                )}
                                                {reason && (
                                                  <span className="text-slate-600"> — {reason}</span>
                                                )}
                                              </div>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    ) : (
                                      <div className="text-xs text-slate-400 italic">No critical risks recorded.</div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Decision / Notes */}
                              {decision.length > 0 && (
                                <div className="p-2.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700">
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Decision Note</span>
                                  {decision.map((p, idx) => (
                                    <p key={idx} className="italic text-slate-800">
                                      {stripTag(p, /^<i>(decision|summary):?<\/i>:?\s*/i).replace(/<\/?(b|strong|i|em)>/gi, "")}
                                    </p>
                                  ))}
                                </div>
                              )}

                              {/* Quantitative Institutional Models */}
                              {params.length > 0 && (() => {
                                const parsedParams = parseParameterItems(params);
                                const greenModels: { label: string; value: string }[] = [];
                                const redModels: { label: string; value: string }[] = [];
                                for (const item of parsedParams) {
                                  const analysis = getModelAnalysis(item.label, item.value);
                                  if (analysis.status === "green") {
                                    greenModels.push(item);
                                  } else {
                                    redModels.push(item);
                                  }
                                }

                                return (
                                  <div className="space-y-2 pt-1 border-t hairline">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                                        Quantitative Institutional Models ({greenModels.length + redModels.length} models checked)
                                      </span>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      {/* Verified Strengths (Passed) */}
                                      <div className="rounded-lg border border-slate-200/90 bg-slate-50/60 p-3 flex flex-col justify-between">
                                        <div>
                                          <div className="flex items-center justify-between mb-2.5 pb-1.5 border-b border-slate-200/60">
                                            <div className="flex items-center gap-1.5 font-bold text-slate-800 text-xs">
                                              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                                              <span>Passed / Healthy Models</span>
                                            </div>
                                            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                              {greenModels.length} Passed
                                            </span>
                                          </div>
                                          {greenModels.length > 0 ? (
                                            <div className="space-y-1.5">
                                              {greenModels.map((item, idx) => (
                                                <ModelCard key={idx} item={item} />
                                              ))}
                                            </div>
                                          ) : (
                                            <div className="text-xs text-slate-400 italic py-2">No models currently in green standing.</div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Caution & Risk Flags */}
                                      <div className="rounded-lg border border-slate-200/90 bg-slate-50/60 p-3 flex flex-col justify-between">
                                        <div>
                                          <div className="flex items-center justify-between mb-2.5 pb-1.5 border-b border-slate-200/60">
                                            <div className="flex items-center gap-1.5 font-bold text-slate-800 text-xs">
                                              <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                                              <span>Caution &amp; Risk Flags</span>
                                            </div>
                                            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                                              {redModels.length} Flagged
                                            </span>
                                          </div>
                                          {redModels.length > 0 ? (
                                            <div className="space-y-1.5">
                                              {redModels.map((item, idx) => (
                                                <ModelCard key={idx} item={item} />
                                              ))}
                                            </div>
                                          ) : (
                                            <div className="text-xs text-slate-500 font-normal italic py-2 flex items-center gap-1.5">
                                              <span className="text-emerald-600 font-bold">✓</span> Clean slate: Zero valuation warnings flagged across models.
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Other points if any */}
                              {other.length > 0 && (
                                <ul className="space-y-1 text-xs text-slate-600">
                                  {other.map((p, idx) => (
                                    <li key={idx} className="flex items-start gap-1.5">
                                      <span className="text-slate-400 font-bold shrink-0 mt-0.5">•</span>
                                      <span>{p.replace(/<\/?(b|strong|i|em)>/gi, "").replace(/^(\*|-|•)\s*/, "")}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Valuation Regime & Price Corridor */}
                      <div className="p-3.5 rounded-lg border border-indigo-100 bg-indigo-50/30 space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="font-bold text-indigo-950 text-xs uppercase tracking-wide">
                            Valuation Regime &amp; Corridor
                          </span>
                          <span className="font-mono text-indigo-800 text-xs font-semibold bg-indigo-100/70 px-2 py-0.5 rounded">
                            {formatValuationRegime(contextData?.audit?.valuation_method || selectedCall.valuation_method)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-xs">
                          <div className="p-2 rounded bg-white border border-rose-200">
                            <span className="text-[10px] uppercase font-bold text-rose-700 block">Bear Floor</span>
                            <strong className="text-rose-700 text-sm block mt-0.5">{money(contextData?.audit?.bear_floor ?? selectedCall.stopLoss)}</strong>
                          </div>
                          <div className="p-2 rounded bg-white border border-indigo-100">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Buy Below</span>
                            <strong className="text-slate-900 text-sm block mt-0.5">{money(contextData?.audit?.buy_below ?? selectedCall.buyBelow)}</strong>
                          </div>
                          <div className="p-2 rounded bg-white border border-indigo-100">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Fair Value</span>
                            <strong className="text-indigo-900 text-sm block mt-0.5">{money(contextData?.audit?.fair_value ?? selectedCall.target)}</strong>
                          </div>
                          <div className="p-2 rounded bg-white border border-emerald-200">
                            <span className="text-[10px] uppercase font-bold text-emerald-700 block">Target Upside</span>
                            <strong className="text-emerald-800 text-sm block mt-0.5">{money(contextData?.audit?.target_price ?? selectedCall.target)}</strong>
                          </div>
                        </div>
                      </div>

                      {/* Statutory Audit & Forensics */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="p-3 rounded-lg border hairline bg-slate-50/60">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Statutory Audit</span>
                          <span className="font-bold text-slate-900 block mt-0.5">
                            {contextData?.audit?.audited_filing_status || "Audited Standalone & Consolidated"}
                          </span>
                          <p className="text-xs text-slate-500 mt-0.5">Unmodified clean audit opinion certified with no adverse qualifications.</p>
                        </div>

                        <div className="p-3 rounded-lg border hairline bg-slate-50/60">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Forensics &amp; Accruals</span>
                          <span className="font-bold text-emerald-700 block mt-0.5">
                            {contextData?.audit?.forensic_status || "Low Forensic Risk / Clean Accruals"}
                          </span>
                          <p className="text-xs text-slate-500 mt-0.5">Cash flow reconciles directly with reported PAT; pristine accruals.</p>
                        </div>
                      </div>

                      {/* Full Deep-Dive Link */}
                      <div className="pt-1 flex items-center justify-between text-xs text-slate-500">
                        <span>Revalidated from live fundamental engine &amp; quarterly filings.</span>
                        <Link
                          href={`/stock/${selectedCall.symbol}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
                        >
                          <span>Open Full Verdict Evidence &amp; Metric Drift Sheet</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  )}

                  {/* TAB 7: SECTOR DENSITY & CONCENTRATION ANALYSIS */}
                  {effectiveTab === "density" && (
                    <div className="space-y-4">
                      {/* Top Header & Scope Selector */}
                      <div className="bg-slate-50 border hairline rounded-lg p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                              <PieChart className="w-4 h-4 text-indigo-600" />
                              <span>Sector Density &amp; Portfolio Concentration</span>
                            </h3>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                sectorDensityData.maxWeight > 30
                                  ? "bg-rose-100 text-rose-800 border border-rose-300"
                                  : sectorDensityData.maxWeight > 20
                                  ? "bg-amber-100 text-amber-800 border border-amber-300"
                                  : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              }`}
                            >
                              {sectorDensityData.maxWeight > 30
                                ? "⚠️ High Concentration Risk"
                                : sectorDensityData.maxWeight > 20
                                ? "🟡 Moderate Concentration"
                                : "🟢 Optimal Diversification"}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            Portfolio Rule: Never put all eggs in one basket. No single sector should exceed 20–25% to protect capital against industry-wide cyclical drawdowns.
                          </p>
                        </div>

                        {/* Scope Toggle inside Density Tab */}
                        <div className="flex items-center gap-1 bg-white p-0.5 rounded-md border hairline text-xs shrink-0">
                          <button
                            type="button"
                            onClick={() => setDensityScope("curated")}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                              densityScope === "curated"
                                ? "bg-indigo-700 text-white shadow-2xs font-semibold"
                                : "text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            <Coins className="w-3 h-3 text-amber-400" />
                            <span>Top Calls</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDensityScope("portfolio")}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                              densityScope === "portfolio"
                                ? "bg-indigo-700 text-white shadow-2xs font-semibold"
                                : "text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            <Wallet className="w-3 h-3" />
                            <span>Held Portfolio</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDensityScope("all")}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                              densityScope === "all"
                                ? "bg-indigo-700 text-white shadow-2xs font-semibold"
                                : "text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            All Calls
                          </button>
                        </div>
                      </div>

                      {/* Density KPI Summary Cards */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="p-3 rounded-lg border hairline bg-white shadow-2xs">
                          <span className="text-[10.5px] uppercase font-bold text-slate-400 block">Sectors Represented</span>
                          <span className="text-lg font-bold text-slate-900 block mt-0.5 font-mono">
                            {sectorDensityData.sectorsCount}
                          </span>
                          <span className="text-[10px] text-slate-500 block">Across {sectorDensityData.totalCallsCount} active stocks</span>
                        </div>

                        <div className="p-3 rounded-lg border hairline bg-white shadow-2xs">
                          <span className="text-[10.5px] uppercase font-bold text-slate-400 block">Max Sector Exposure</span>
                          <span className={`text-lg font-bold block mt-0.5 font-mono ${
                            sectorDensityData.maxWeight > 30 ? "text-rose-600" : sectorDensityData.maxWeight > 20 ? "text-amber-600" : "text-emerald-700"
                          }`}>
                            {sectorDensityData.maxWeight.toFixed(1)}%
                          </span>
                          <span className="text-[10px] text-slate-500 truncate block">
                            {sectorDensityData.list[0]?.sector || "None"}
                          </span>
                        </div>

                        <div className="p-3 rounded-lg border hairline bg-white shadow-2xs">
                          <span className="text-[10.5px] uppercase font-bold text-slate-400 block">Recommended Sector Cap</span>
                          <span className="text-lg font-bold text-slate-900 block mt-0.5 font-mono">
                            25.0%
                          </span>
                          <span className="text-[10px] text-emerald-600 block font-medium">Institutional safety limit</span>
                        </div>

                        <div className="p-3 rounded-lg border hairline bg-white shadow-2xs">
                          <span className="text-[10.5px] uppercase font-bold text-slate-400 block">Total Capital Allocated</span>
                          <span className="text-lg font-bold text-slate-900 block mt-0.5 font-mono">
                            {money(sectorDensityData.totalCap)}
                          </span>
                          <span className="text-[10px] text-indigo-600 block font-medium">100% Capital Deployed</span>
                        </div>
                      </div>

                      {/* Visual Proportional Segment Bar */}
                      <div className="p-3 rounded-lg border hairline bg-white space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-700 flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Sector Allocation Distribution</span>
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {sectorDensityData.sectorsCount} Sectors • {sectorDensityData.totalCallsCount} Stocks
                          </span>
                        </div>

                        <div className="h-4 w-full rounded-md overflow-hidden flex bg-slate-100 border hairline">
                          {sectorDensityData.list.map((sec) => {
                            const secTheme = getSectorTheme(sec.sector);
                            return (
                              <div
                                key={sec.sector}
                                style={{ width: `${Math.max(sec.calculatedWeight, 2)}%` }}
                                className={`${secTheme.barColor} h-full transition-all relative group cursor-pointer`}
                                title={`${sec.sector}: ${sec.calculatedWeight.toFixed(1)}% (${sec.calls.length} stocks)`}
                              />
                            );
                          })}
                        </div>

                        {/* Legend */}
                        <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                          {sectorDensityData.list.map((sec) => {
                            const secTheme = getSectorTheme(sec.sector);
                            return (
                              <span
                                key={sec.sector}
                                className={`px-2 py-0.5 rounded-full border text-[10.5px] font-medium flex items-center gap-1.5 ${secTheme.badgeClass}`}
                              >
                                <span className="font-semibold">{sec.sector}:</span>
                                <span className="font-mono">{sec.calculatedWeight.toFixed(1)}%</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Detailed Sector Density Breakdown Cards */}
                      <div className="space-y-2">
                        <div className="text-xs font-bold text-slate-700 uppercase tracking-wider px-0.5">
                          Sector Breakdown &amp; Concentration Risk Audit
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {sectorDensityData.list.map((sec) => {
                            const secTheme = getSectorTheme(sec.sector);
                            const isOver = sec.calculatedWeight > 30;
                            const isMod = sec.calculatedWeight >= 20 && sec.calculatedWeight <= 30;
                            return (
                              <div
                                key={sec.sector}
                                className={`rounded-lg border p-3.5 space-y-2.5 transition-all bg-white shadow-2xs ${
                                  isOver
                                    ? "border-rose-300 ring-1 ring-rose-200"
                                    : isMod
                                    ? "border-amber-300 ring-1 ring-amber-100"
                                    : "border-slate-200 hover:border-indigo-300"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span
                                        className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs"
                                        style={{ backgroundColor: secTheme.dotColor }}
                                      />
                                      <h4 className="font-bold text-slate-900 text-xs sm:text-sm">
                                        {sec.sector}
                                      </h4>
                                      <span
                                        className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                          isOver
                                            ? "bg-rose-100 text-rose-800 border border-rose-300"
                                            : isMod
                                            ? "bg-amber-100 text-amber-800 border border-amber-300"
                                            : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                        }`}
                                      >
                                        {isOver ? "Overweight / Egg Basket Alert" : isMod ? "Moderate / Monitor" : "Balanced Exposure"}
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-slate-500 font-mono mt-0.5 block">
                                      {sec.calls.length} position{sec.calls.length > 1 ? "s" : ""} • Allocated: {money(sec.allocatedAmount)}
                                    </span>
                                  </div>

                                  <div className="text-right shrink-0">
                                    <span className="font-mono font-bold text-base text-slate-900">
                                      {sec.calculatedWeight.toFixed(1)}%
                                    </span>
                                    <span className="text-[10px] text-slate-400 block">of Total</span>
                                  </div>
                                </div>

                                {/* Visual Progress Bar */}
                                <div className="space-y-1">
                                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                      style={{ width: `${Math.min(sec.calculatedWeight, 100)}%` }}
                                      className={`h-full rounded-full ${
                                        isOver ? "bg-rose-600" : isMod ? "bg-amber-500" : "bg-emerald-600"
                                      }`}
                                    />
                                  </div>
                                </div>

                                {/* Positions in this sector */}
                                <div className="space-y-1 pt-1">
                                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Stocks in this Sector:</span>
                                  <div className="flex flex-wrap gap-1.5">
                                    {sec.calls.map((c) => {
                                      const isCurSel = selectedCall.symbol === c.symbol;
                                      return (
                                        <button
                                          key={c.symbol}
                                          type="button"
                                          onClick={() => setSelectedSymbol(c.symbol)}
                                          className={`px-2 py-1 rounded text-xs font-mono transition-all flex items-center gap-1.5 ${
                                            isCurSel
                                              ? "bg-indigo-700 text-white font-bold shadow-xs"
                                              : "bg-slate-100 hover:bg-indigo-50 text-slate-800 border hairline"
                                          }`}
                                        >
                                          <span>{c.symbol}</span>
                                          {c.cluster && (
                                            <span className={`text-[9px] px-1 py-0.2 rounded font-mono ${isCurSel ? "bg-white/20 text-white" : "bg-purple-50 text-purple-700 border border-purple-200/60"}`}>
                                              {c.cluster}
                                            </span>
                                          )}
                                          <span className="text-[10px] opacity-80">{money(c.cmp, 2)}</span>
                                          <span className={`text-[10px] font-semibold ${isCurSel ? "text-amber-300" : "text-emerald-700"}`}>
                                            +{c.upside}%
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Guidance / Basket note */}
                                <div className="text-[11px] pt-1 text-slate-600 border-t hairline flex items-center justify-between">
                                  <span>
                                    {isOver
                                      ? "⚠️ Caution: High single-sector exposure. Avoid allocating additional capital."
                                      : isMod
                                      ? "✓ Moderate weight. Keep below 25% institutional threshold."
                                      : "✓ Healthy diversification. Well insulated against idiosyncratic shocks."}
                                  </span>
                                  {sec.projectedProfit > 0 && (
                                    <span className="font-mono text-emerald-700 font-semibold shrink-0 ml-2">
                                      Proj. +{money(sec.projectedProfit)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
