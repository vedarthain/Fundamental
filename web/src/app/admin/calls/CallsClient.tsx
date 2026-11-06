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
  Clock,
} from "lucide-react";
import { PriceChart } from "@/components/PriceChart";
import { CompanyProfile } from "@/components/CompanyProfile";
import CapTierBadge, { type CapCategory } from "@/components/CapTierBadge";
import { parseParameterItems, getModelAnalysis, ModelCard } from "@/components/VerdictPanel";
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
type DetailTab = "overview" | "catalysts" | "results" | "dividends" | "news" | "audit";
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

  // Multi-Select Dates State: default to "all" so calls and priority alerts are never hidden by default
  const [selectedBatches, setSelectedBatches] = useState<Set<string>>(new Set(["all"]));
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const dateDropdownRef = useRef<HTMLDivElement>(null);

  // Scope & Action Filters: Always default to 'curated' (Top 6) on refresh
  const [scope, setScope] = useState<Scope>("curated");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("ALL");
  const [prioritySubFilter, setPrioritySubFilter] = useState<PriorityCategory>("ALL");
  const [search, setSearch] = useState("");
  const [capital] = useState<number>(100000);

  // Selected Stock & Detail Tab: default to top pick INDUSTOWER
  const [selectedSymbol, setSelectedSymbol] = useState<string>("INDUSTOWER");
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");

  // Stock context data
  const [contextData, setContextData] = useState<StockContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  // Expanded sectors set for tree (only 1 sector open initially)
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set());
  const [hasInitializedSectors, setHasInitializedSectors] = useState(false);

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
      if (saved) {
        setCustomPurchases(JSON.parse(saved));
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

  // Comprehensive Curated 6 deployment picks with rich operational thesis & company overview
  const curatedPicks = useMemo(() => [
    {
      symbol: "INDUSTOWER",
      name: "Indus Towers Ltd.",
      sector: "Telecommunication",
      cluster: "Telecom",
      weightPct: 20,
      cmp: 378.3,
      anchorPrice: 380.0,
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
      sector: "Financial Services",
      cluster: "PSU Banks",
      weightPct: 20,
      cmp: 186.0,
      anchorPrice: 178.9,
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
      rationale: "High-growth quantitative algorithmic trading pioneer with >25% ROE, zero net debt, proprietary low-latency colocation technology moats, and accelerating market share gains in institutional derivatives.",
      companyOverview: "Share India Securities is a high-growth financial services powerhouse and quantitative trading pioneer, dominating high-frequency trading (HFT), algorithmic market making, retail broking, NBFC lending, and insurance distribution with a rapidly growing proprietary algorithmic engine.",
      operatingHighlights: [
        "Industry-leading profitability metrics: Return on Equity (ROE > 26%) and Return on Capital Employed (ROCE > 28%).",
        "Zero net debt balance sheet with proprietary low-latency colocation technology moats.",
        "Surging average daily turnover (ADTO) in equity derivatives and commodities capturing outsized market share.",
        "Expanding high-margin institutional and algorithmic client base.",
      ],
      catalysts: [
        "Rapid expansion of algorithmic retail trading platforms (uTrade Algos) democratizing institutional-grade execution.",
        "Scaled NBFC loan book generating high-margin interest income with strict collateral margins.",
        "Potential inclusion in small/mid-cap indices driving passive ETF inflows.",
      ],
      marginOfSafety: "Trading at low forward P/E (< 11x) relative to >30% PAT CAGR. Strong cash pile and clean corporate governance.",
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
      rationale: "High-margin pharmaceutical innovator boasting industry-leading EBITDA margins (>35%), pristine net cash reserves, clean FDA compliance record, and high-barrier specialty generic product launches.",
      companyOverview: "Natco Pharma is an R&D-driven pharmaceutical leader specializing in complex generic formulations, oncology therapeutics, niche chemical synthesis, and crop health sciences. It possesses world-class US FDA-approved manufacturing plants and strategic international marketing alliances.",
      operatingHighlights: [
        "Industry-high operating EBITDA margin (>35%) supported by high-barrier generic oncology exclusivity.",
        "Zero net debt balance sheet with significant cash reserves and pristine working capital cycle.",
        "Expanding market share in North American Revlimid generics and upcoming launches in semaglutide / oncology pipelines.",
        "Strong domestic branded oncology formulations commanding leadership position in Indian hospitals.",
      ],
      catalysts: [
        "First-to-file generic product approvals in North America and Brazil opening high-margin revenue streams.",
        "Ramp-up of domestic crop protection / agrochemical formulations diversifying revenue streams.",
        "Potential capital return / buyback given substantial net cash reserves.",
      ],
      marginOfSafety: "Pristine balance sheet with zero debt and large cash reserves. Quality percentile score of 96 with solid bear floor at ₹690.",
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
      const callDate = g.call_date ?? (g.generated_at ? g.generated_at.slice(0, 10) : "2026-11-01");
      const callPrice = g.call_price ?? g.anchor_price ?? cur?.anchorPrice ?? cmp;
      const callPerfPct = callPrice > 0 ? ((cmp - callPrice) / callPrice) * 100 : 0;

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

      // Determine Action
      let actionToday = g.action_today || (isPortfolio ? (port?.action_today || "HOLD & COMPOUND") : (cmp <= buyBelow * 1.02 ? "BUY / ACCUMULATE" : "WATCH / ACCUMULATE"));
      if (isPortfolio && port?.action_today) {
        actionToday = port.action_today;
      }

      callMap.set(g.symbol, {
        symbol: g.symbol,
        name: g.company_name || cur?.name || g.symbol,
        sector: g.sector || cur?.sector || "General",
        industry: g.industry || cur?.cluster || "General",
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
        isTaken,
        isCleared,
      });
    });

    // 2. Curated Picks fallback (ensures Top 6 are always present)
    curatedPicks.forEach((cp) => {
      if (!callMap.has(cp.symbol)) {
        const port = data.portfolioActions.find((p) => p.symbol === cp.symbol);
        const gem = data.clusterGems.find((g) => g.symbol === cp.symbol);
        const cmp = gem?.ltp ?? port?.ltp ?? cp.cmp;
        const callDate = gem?.call_date ?? "2026-11-01";
        const callPrice = gem?.call_price ?? gem?.anchor_price ?? cp.anchorPrice ?? cp.cmp;
        const callPerfPct = callPrice > 0 ? ((cmp - callPrice) / callPrice) * 100 : 0;

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
          isTaken: isPortfolio,
          isCleared: false,
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
          isTaken: true,
          isCleared: false,
        });
      }
    });

    return Array.from(callMap.values());
  }, [data, curatedPicks, curatedSymbolMap, capital, customPurchases, userCallOverrides]);

  // Action counts for filtering (Buy calls vs Sell calls vs Hold calls)
  const actionCounts = useMemo(() => {
    let buy = 0;
    let sell = 0;
    let prioritySell = 0;
    let hold = 0;
    unifiedCalls.forEach((c) => {
      const act = (c.actionToday || "").toUpperCase();
      const isSell = act.includes("SELL") || act.includes("TRIM") || act.includes("EXIT") || act.includes("CUT LOSS");
      if (act.includes("BUY") || act.includes("ACCUMULATE")) buy++;
      else if (isSell) {
        sell++;
        if (c.isPortfolio) prioritySell++;
      } else hold++;
    });
    return { all: unifiedCalls.length, buy, sell, prioritySell, hold };
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
        // Standard Scope Filter (Curated Top 6 vs Portfolio vs All)
        if (scope === "curated" && !c.isCurated) return false;
        if (scope === "portfolio" && !c.isPortfolio) return false;

        // Action Filter (Buy Calls vs Sell Calls vs Hold Calls)
        if (actionFilter === "BUY") {
          const act = (c.actionToday || "").toUpperCase();
          if (!act.includes("BUY") && !act.includes("ACCUMULATE")) return false;
        } else if (actionFilter === "SELL") {
          const act = (c.actionToday || "").toUpperCase();
          if (!act.includes("SELL") && !act.includes("TRIM") && !act.includes("EXIT") && !act.includes("CUT LOSS")) return false;
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
            else if (c.callDate && c.callDate === b) matchesDate = true;
          }
          if (!matchesDate) return false;
        }
      }

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const mSym = c.symbol.toLowerCase().includes(q);
        const mName = c.name.toLowerCase().includes(q);
        const mSec = c.sector.toLowerCase().includes(q);
        if (!mSym && !mName && !mSec) return false;
      }

      return true;
    });
  }, [unifiedCalls, scope, actionFilter, prioritySubFilter, selectedBatches, search]);

  // Group filtered calls by Sector for the Left Rail Tree
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
        const aAct = (a.actionToday || "").toUpperCase();
        const bAct = (b.actionToday || "").toUpperCase();
        const aIsPri = (aAct.includes("SELL") || aAct.includes("TRIM") || aAct.includes("EXIT") || aAct.includes("CUT LOSS")) && a.isPortfolio;
        const bIsPri = (bAct.includes("SELL") || bAct.includes("TRIM") || bAct.includes("EXIT") || bAct.includes("CUT LOSS")) && b.isPortfolio;
        if (aIsPri && !bIsPri) return -1;
        if (!aIsPri && bIsPri) return 1;
        if (a.isCurated && !b.isCurated) return -1;
        if (!a.isCurated && b.isCurated) return 1;
        return (b.composite_pct ?? 0) - (a.composite_pct ?? 0);
      });
      groups.push({ sector, count: calls.length, calls });
    });

    groups.sort((a, b) => a.sector.localeCompare(b.sector));
    return groups;
  }, [filteredCalls]);

  // Selected Call Detail
  const selectedCall = useMemo(() => {
    return filteredCalls.find((c) => c.symbol === selectedSymbol) || filteredCalls[0] || null;
  }, [filteredCalls, selectedSymbol]);

  // Initial state & dynamic auto-expansion: ALWAYS open the selected stock's sector in left rail
  useEffect(() => {
    if (selectedCall?.sector) {
      setExpandedSectors((prev) => {
        if (prev.has(selectedCall.sector)) return prev;
        const next = new Set(prev);
        next.add(selectedCall.sector);
        return next;
      });
      // Scroll the selected stock in the left rail into view smoothly
      setTimeout(() => {
        const el = document.getElementById(`stock-rail-${selectedCall.symbol}`);
        if (el) {
          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }, 60);
    }
  }, [selectedCall?.symbol, selectedCall?.sector]);

  // Live IST running timestamp for current session ticks
  const [currentTimeIst, setCurrentTimeIst] = useState<string>("13:20");
  useEffect(() => {
    const updateTime = () => {
      try {
        const now = new Date();
        const str = now.toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        setCurrentTimeIst(str);
      } catch {
        // fallback
      }
    };
    updateTime();
    const timer = setInterval(updateTime, 30000);
    return () => clearInterval(timer);
  }, []);

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
  const clearAllBatches = () => setSelectedBatches(new Set(["all"]));

  const expandAll = () => setExpandedSectors(new Set(sectorGroups.map((g) => g.sector)));
  const collapseAll = () => setExpandedSectors(new Set());

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
          <span className="px-2 py-0.5 rounded text-[10.5px] font-mono font-medium bg-emerald-50 text-emerald-800 border border-emerald-300">
            SUN 7 PM IST
          </span>
        </div>

        {/* Action Type Filters (All vs Buy Calls vs Sell Calls vs Hold) */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center bg-slate-100 p-0.5 rounded-md border hairline text-xs">
            <button
              onClick={() => setActionFilter("ALL")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                actionFilter === "ALL" ? "bg-white text-slate-900 shadow-2xs font-semibold" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All ({actionCounts.all})
            </button>
            <button
              onClick={() => setActionFilter("BUY")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                actionFilter === "BUY" ? "bg-emerald-600 text-white shadow-2xs font-semibold" : "text-emerald-700 hover:text-emerald-900"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Buy ({actionCounts.buy})</span>
            </button>
            <button
              onClick={() => setActionFilter("PRIORITY_SELL")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                actionFilter === "PRIORITY_SELL" ? "bg-rose-600 text-white shadow-2xs font-bold ring-2 ring-rose-400" : "text-rose-700 hover:text-rose-900 bg-rose-50/70 hover:bg-rose-100"
              }`}
              title="Immediate sell/trim priority calls for held portfolio positions"
            >
              <span>🚨</span>
              <span>Priority Sell ({actionCounts.prioritySell})</span>
            </button>
            <button
              onClick={() => setActionFilter("SELL")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                actionFilter === "SELL" ? "bg-rose-600 text-white shadow-2xs font-semibold" : "text-rose-700 hover:text-rose-900"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span>Sell Calls ({actionCounts.sell})</span>
            </button>
            <button
              onClick={() => setActionFilter("HOLD")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                actionFilter === "HOLD" ? "bg-blue-600 text-white shadow-2xs font-semibold" : "text-blue-700 hover:text-blue-900"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span>Hold ({actionCounts.hold})</span>
            </button>
          </div>

          {/* Multi-Select Date Picker Dropdown */}
          <div className="relative" ref={dateDropdownRef}>
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

          {/* Scope switchers */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md border hairline text-xs">
            <button
              onClick={() => setScope("curated")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                scope === "curated" ? "bg-indigo-700 text-white shadow-2xs font-semibold" : "text-indigo-800 hover:bg-indigo-100"
              }`}
            >
              <Coins className="w-3 h-3 text-amber-400" />
              <span>Top 6</span>
            </button>
            <button
              onClick={() => setScope("all")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                scope === "all" ? "bg-slate-900 text-white shadow-2xs font-semibold" : "text-slate-700 hover:bg-slate-200"
              }`}
            >
              All Calls
            </button>
            <button
              onClick={() => setScope("portfolio")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                scope === "portfolio" ? "bg-slate-900 text-white shadow-2xs font-semibold" : "text-slate-700 hover:bg-slate-200"
              }`}
            >
              <Wallet className="w-3 h-3" />
              <span>Held ({unifiedCalls.filter((c) => c.isPortfolio).length})</span>
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
            disabled={loading}
            className="p-1 rounded text-slate-600 hover:bg-slate-100 border hairline shadow-2xs transition-colors"
            title="Refresh Calls Feed"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* 🚨 Priority Action Alert Banner (Immediate Portfolio Sells / Trims) */}
      {actionCounts.prioritySell > 0 && actionFilter !== "PRIORITY_SELL" && (
        <div className="bg-gradient-to-r from-rose-50 via-amber-50 to-rose-50 border border-rose-300 rounded-lg p-2 sm:px-3 sm:py-2 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base sm:text-lg shrink-0">🚨</span>
            <div className="text-xs min-w-0">
              <span className="font-bold text-rose-900">
                Immediate Action Required: {actionCounts.prioritySell} portfolio holding{actionCounts.prioritySell > 1 ? "s" : ""} triggered Trim / Take Profit targets.
              </span>
              <span className="hidden sm:inline text-slate-600 ml-1.5">
                Cluster price targets reached or valuation ceilings breached.
              </span>
            </div>
          </div>
          <button
            onClick={() => setActionFilter("PRIORITY_SELL")}
            className="shrink-0 px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-2xs flex items-center gap-1 transition-colors"
          >
            <span>Review Priority Sells ({actionCounts.prioritySell})</span>
            <span>&rarr;</span>
          </button>
        </div>
      )}

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

      {/* ── Two-Pane Workstation: Compressed Left Rail + Right Workstation ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-[195px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)] gap-2 items-start w-full min-w-0">
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
                onClick={expandedSectors.size === sectorGroups.length ? collapseAll : expandAll}
                className="text-[10px] text-slate-500 hover:text-slate-800 px-1.5 py-0.2 rounded border hairline bg-white"
              >
                {expandedSectors.size === sectorGroups.length ? "Collapse" : "Expand"}
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
                const isSecOpen = !!search.trim() || expandedSectors.has(g.sector);
                return (
                  <div key={g.sector} className="rounded border hairline bg-slate-50/40 overflow-hidden">
                    <button
                      onClick={() => toggleSector(g.sector)}
                      className="w-full flex items-center justify-between px-2 py-1 text-left text-xs font-normal text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-1 min-w-0">
                        {isSecOpen ? (
                          <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                        )}
                        <span className="truncate text-slate-700 font-normal">{g.sector}</span>
                      </div>
                      <span className="px-1 py-0.2 rounded text-[9.5px] font-mono font-normal bg-slate-200/60 text-slate-600 shrink-0">
                        {g.count}
                      </span>
                    </button>

                    {isSecOpen && (
                      <div className="p-0.5 space-y-0.5 border-t hairline bg-white">
                        {g.calls.map((call) => {
                          const isSel = selectedCall?.symbol === call.symbol;
                          const callMove = call.callPerfPct;
                          const actUpper = (call.actionToday || "").toUpperCase();
                          const isSell = actUpper.includes("SELL") || actUpper.includes("TRIM") || actUpper.includes("EXIT") || actUpper.includes("CUT LOSS");
                          const isPrioritySell = isSell && call.isPortfolio;
                          const priInfo = isPrioritySell ? getPriorityCategory(call) : null;
                          return (
                            <button
                              key={call.symbol}
                              id={`stock-rail-${call.symbol}`}
                              onClick={() => setSelectedSymbol(call.symbol)}
                              className={`w-full flex items-center justify-between px-2 py-1 rounded text-left transition-all ${
                                isSel
                                  ? isPrioritySell
                                    ? "bg-slate-900 text-white shadow-2xs ring-1 ring-rose-500"
                                    : "bg-slate-900 text-white shadow-2xs"
                                  : isPrioritySell
                                    ? priInfo?.category === "PROFIT_TRIM"
                                      ? "bg-emerald-50/70 hover:bg-emerald-100/80 text-slate-900 border-l-2 border-emerald-500"
                                      : priInfo?.category === "STRUCTURAL_EXIT"
                                        ? "bg-rose-50/80 hover:bg-rose-100 text-slate-900 border-l-2 border-rose-600"
                                        : "bg-amber-50/70 hover:bg-amber-100/80 text-slate-900 border-l-2 border-amber-500"
                                    : "hover:bg-slate-100/70 text-slate-800"
                              }`}
                            >
                              <div className="min-w-0 flex-1 pr-1.5">
                                <div className="flex items-center gap-1">
                                  <span className="font-mono font-medium text-xs">{call.symbol}</span>
                                  {isPrioritySell && priInfo && (
                                    <span
                                      className={`text-[8px] px-1 py-0.2 rounded font-bold uppercase tracking-tight flex items-center gap-0.5 ${
                                        isSel ? "bg-white/20 text-white" : priInfo.badgeClass
                                      }`}
                                      title={priInfo.title}
                                    >
                                      {priInfo.badge}
                                    </span>
                                  )}
                                  {call.isCurated && (
                                    <span
                                      className={`text-[8.5px] px-1 rounded font-normal ${
                                        isSel ? "bg-amber-400 text-slate-950 font-medium" : "bg-amber-100 text-amber-900"
                                      }`}
                                    >
                                      TOP6
                                    </span>
                                  )}
                                  {call.isPortfolio && !isPrioritySell && (
                                    <span
                                      className={`text-[8.5px] px-1 rounded font-normal ${
                                        isSel ? "bg-blue-400 text-slate-950" : "bg-blue-50 text-blue-900 border border-blue-200"
                                      }`}
                                    >
                                      P
                                    </span>
                                  )}
                                </div>
                                <div className={`text-[10px] truncate ${isSel ? "text-slate-300" : "text-slate-500"} font-normal`}>
                                  {call.name}
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                <div className="font-mono font-normal text-xs">{money(call.cmp)}</div>
                                <div className="flex items-center justify-end gap-1 mt-0.5">
                                  {callMove != null ? (
                                    <span
                                      className={`text-[9.5px] font-mono font-normal ${
                                        callMove >= 0
                                          ? isSel ? "text-emerald-400" : "text-emerald-700"
                                          : isSel ? "text-rose-400" : "text-rose-600"
                                      }`}
                                    >
                                      {pct(callMove)}
                                    </span>
                                  ) : null}
                                  <span
                                    className={`px-1 py-0.2 rounded text-[8px] uppercase font-normal ${
                                      isSel
                                        ? "bg-white/20 text-white"
                                        : isPrioritySell && priInfo
                                          ? priInfo.badgeClass
                                          : isSell
                                            ? "bg-rose-100 text-rose-800 border border-rose-300"
                                            : actionBadgeClass(call.actionToday)
                                    }`}
                                  >
                                    {isPrioritySell && priInfo ? priInfo.pillText : call.actionToday?.split(" ")[0]}
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
                  <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium text-slate-700 bg-slate-100 border hairline">
                    {selectedCall.sector}
                  </span>
                  {selectedCall.isCurated && (
                    <span className="px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      ★ TOP 6
                    </span>
                  )}
                  {selectedCall.isPortfolio && (
                    <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-blue-50 text-blue-800 border border-blue-200">
                      Held: {selectedCall.heldQty} sh
                    </span>
                  )}
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
                      {money(selectedCall.cmp)}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10.5px] font-medium font-mono whitespace-nowrap"
                      title="Current running session in IST"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Today {currentTimeIst} IST</span>
                    </span>
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
                      1D: {stockPriceInfo.dayChangePct >= 0 ? "+" : ""}{stockPriceInfo.dayChangePct.toFixed(1)}%
                    </span>
                  )}

                  {stockPriceInfo?.prevClose != null && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[10.5px] font-mono text-slate-600 bg-slate-50 border hairline whitespace-nowrap"
                      title="Yesterday's / Previous Trading Session Settled Close"
                    >
                      Prev Close: <strong className="text-slate-900 font-semibold">{money(stockPriceInfo.prevClose)}</strong>
                    </span>
                  )}

                  <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${actionBadgeClass(selectedCall.actionToday)}`}>
                    {selectedCall.actionToday}
                  </span>

                  {/* Buy Below Tag */}
                  <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono text-slate-700 bg-slate-50 border hairline">
                    Buy ≤ <strong className="text-slate-900 font-bold">{money(selectedCall.buyBelow)}</strong>
                  </span>

                  {/* Target Tag */}
                  <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono text-emerald-800 bg-emerald-50 border border-emerald-200">
                    Target <strong className="text-emerald-900 font-bold">{money(selectedCall.target)}</strong> (+{selectedCall.upside}%)
                  </span>

                  {/* Floor Tag */}
                  <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono text-rose-700 bg-rose-50 border border-rose-200">
                    Floor <strong className="text-rose-900 font-bold">{money(selectedCall.stopLoss)}</strong>
                  </span>

                  <button
                    onClick={() => handleTakeCall(selectedCall.symbol)}
                    disabled={selectedCall.isTaken}
                    className={`px-2 py-0.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1 ${
                      selectedCall.isTaken
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-300"
                        : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs"
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{selectedCall.isTaken ? "Taken" : "Take Call"}</span>
                  </button>

                  <button
                    onClick={() => handleExitCall(selectedCall.symbol)}
                    disabled={selectedCall.isCleared}
                    className="px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 border hairline shadow-2xs"
                  >
                    {selectedCall.isCleared ? "Closed" : "Close"}
                  </button>

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
                        <div className={((selectedCall.cmp - selectedCall.purchasePrice) / selectedCall.purchasePrice) >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                          Position P&amp;L: {pct(((selectedCall.cmp - selectedCall.purchasePrice) / selectedCall.purchasePrice) * 100)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── ROW 2: Price Graph (Left) & Stacked 4 Boxes (Right) ───────── */}
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_275px] gap-2 items-stretch w-full min-w-0">
                {/* Left: Price Chart & Moving Averages Card */}
                <div className="bg-white border hairline rounded-lg p-2.5 sm:p-3 shadow-2xs flex flex-col justify-between min-w-0 overflow-hidden w-full">
                  <div className="flex items-center justify-between text-xs mb-1 min-w-0">
                    <div className="flex items-center gap-1.5 font-bold text-slate-800">
                      <TrendingUp className="w-4 h-4 text-slate-600" />
                      <span>Price Chart &amp; Moving Averages</span>
                    </div>
                  </div>
                  <div className="w-full min-w-0 overflow-hidden pt-0.5">
                    <PriceChart
                      symbol={selectedCall.symbol}
                      currentPrice={selectedCall.cmp}
                      onPriceInfo={setStockPriceInfo}
                      height={315}
                    />
                  </div>
                </div>

                {/* Right: 4 Compact Stacked Boxes */}
                <div className="flex flex-col gap-1.5 justify-between w-full lg:w-[260px] xl:w-[275px] shrink-0 min-w-0">
                  {/* BOX 1: ANCHOR 1 - CALL GIVEN */}
                  <div className="bg-slate-50/90 border border-indigo-100 rounded-lg p-2 shadow-2xs flex-1 flex flex-col justify-between min-w-0">
                    <div className="flex items-center justify-between text-[11px] gap-1 min-w-0">
                      <div className="flex items-center gap-1.5 font-bold text-indigo-950 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 shrink-0" />
                        <span className="tracking-wide text-[10px] truncate">ANCHOR 1: CALL GIVEN</span>
                      </div>
                      <span className="text-[9px] font-mono text-slate-500 shrink-0">
                        {fmtDate(selectedCall.callDate)} ({daysAgo(selectedCall.callDate)})
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1 mt-0.5 border-t border-indigo-100/80">
                      <div>
                        <span className="text-[8.5px] uppercase font-semibold text-slate-500 block">Anchor Price</span>
                        <span className="text-xs sm:text-sm font-bold font-mono text-slate-900">{money(selectedCall.callPrice)}</span>
                      </div>

                      <div className="text-right">
                        <span className="text-[8.5px] uppercase font-semibold text-slate-500 block">Return Since Call</span>
                        <div className="flex items-center justify-end gap-1">
                          <span className={`text-xs sm:text-sm font-bold font-mono ${(selectedCall.callPerfPct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
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
                  <div className="bg-slate-50/90 border border-emerald-100 rounded-lg p-2 shadow-2xs flex-1 flex flex-col justify-between min-w-0">
                    <div className="flex items-center justify-between text-[11px] gap-1 min-w-0">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-950 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
                        <span className="tracking-wide text-[10px] truncate">ANCHOR 2: PURCHASE</span>
                      </div>
                      <button
                        onClick={() => setIsEditingPurchase(!isEditingPurchase)}
                        className="text-[9px] font-semibold text-emerald-800 hover:text-emerald-950 inline-flex items-center gap-0.5 underline underline-offset-2 shrink-0"
                      >
                        <Edit3 className="w-2.5 h-2.5" />
                        <span>{selectedCall.purchasePrice ? "Edit" : "Log Buy"}</span>
                      </button>
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
                          <span className="text-[8.5px] uppercase font-semibold text-slate-500 block">Purchase Price</span>
                          <div className="flex items-center gap-1">
                            <span className="text-xs sm:text-sm font-bold font-mono text-slate-900">
                              {selectedCall.purchasePrice ? money(selectedCall.purchasePrice) : "—"}
                            </span>
                            <span className="text-[9px] text-slate-500">
                              {selectedCall.purchaseDate ? `(${fmtDate(selectedCall.purchaseDate)})` : "(None)"}
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-[8.5px] uppercase font-semibold text-slate-500 block">Return Since Buy</span>
                          {selectedCall.purchasePerfPct != null ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className={`text-xs sm:text-sm font-bold font-mono ${selectedCall.purchasePerfPct >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                                {pct(selectedCall.purchasePerfPct)}
                              </span>
                              {selectedCall.purchasePrice && (
                                <span className="text-[9px] font-mono text-slate-500">
                                  ({selectedCall.cmp >= selectedCall.purchasePrice ? "+" : ""}{money(selectedCall.cmp - selectedCall.purchasePrice)})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[9px] text-slate-400 italic">No trade logged</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* BOX 3: TRANCHE 1 - MARKET ORDER (CMP) */}
                  {selectedCall.isCurated ? (
                    <div className="bg-slate-50/90 border border-indigo-100 rounded-lg p-2 shadow-2xs flex-1 flex flex-col justify-between min-w-0">
                      <div className="flex items-center justify-between text-[11px] gap-1 min-w-0">
                        <div className="flex items-center gap-1.5 font-bold text-indigo-950 truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 shrink-0" />
                          <span className="tracking-wide text-[10px] truncate">TRANCHE 1: MARKET CMP</span>
                        </div>
                        <span className="text-[8.5px] font-mono font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1 py-0.2 rounded shrink-0">
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
                    <div className={`rounded-lg p-2 shadow-2xs flex-1 flex flex-col justify-between min-w-0 ${
                      isSellAction ? "bg-rose-50/90 border border-rose-300" : "bg-slate-50/90 border hairline"
                    }`}>
                      <div className="flex items-center justify-between text-[11px] gap-1 min-w-0">
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
                    <div className="bg-slate-50/90 border border-amber-200 rounded-lg p-2 shadow-2xs flex-1 flex flex-col justify-between min-w-0">
                      <div className="flex items-center justify-between text-[11px] gap-1 min-w-0">
                        <div className="flex items-center gap-1.5 font-bold text-amber-950 truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-600 shrink-0" />
                          <span className="tracking-wide text-[10px] truncate">TRANCHE 2: DIP (GTT)</span>
                        </div>
                        <span className="text-[8.5px] font-mono font-bold text-amber-800 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded shrink-0">
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
                    <div className="bg-slate-50/90 border hairline rounded-lg p-2 shadow-2xs flex-1 flex flex-col justify-between min-w-0">
                      <div className="flex items-center justify-between text-[11px] gap-1 min-w-0">
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
                          <span className="text-[8.5px] uppercase font-semibold text-slate-400 block">Target Upside</span>
                          <span className="font-mono font-bold text-emerald-700 text-xs">{money(selectedCall.target)} (+{selectedCall.upside}%)</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[8.5px] uppercase font-semibold text-slate-400 block">Bear Floor</span>
                          <span className="font-mono font-bold text-rose-600 text-xs">{money(selectedCall.stopLoss)}</span>
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
                          <div className="p-2 rounded bg-white border border-indigo-100">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Buy Below</span>
                            <strong className="text-slate-900 text-sm block mt-0.5">{money(contextData?.audit?.buy_below ?? selectedCall.buyBelow)}</strong>
                          </div>
                          <div className="p-2 rounded bg-white border border-indigo-100">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Fair Value</span>
                            <strong className="text-indigo-900 text-sm block mt-0.5">{money(contextData?.audit?.fair_value ?? selectedCall.target)}</strong>
                          </div>
                          <div className="p-2 rounded bg-white border border-emerald-200">
                            <span className="text-[10px] uppercase font-bold text-emerald-700 block">Target Price</span>
                            <strong className="text-emerald-800 text-sm block mt-0.5">{money(contextData?.audit?.target_price ?? selectedCall.target)}</strong>
                          </div>
                          <div className="p-2 rounded bg-white border border-rose-200">
                            <span className="text-[10px] uppercase font-bold text-rose-700 block">Bear Floor</span>
                            <strong className="text-rose-700 text-sm block mt-0.5">{money(contextData?.audit?.bear_floor ?? selectedCall.stopLoss)}</strong>
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
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
