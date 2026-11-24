"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import type { ReportStockRow } from "@/lib/reportData";

export type ParameterCategory =
  | "identity"
  | "pricing"
  | "verdict"
  | "dividends"
  | "moat"
  | "scores"
  | "fundamentals"
  | "portfolio";

export type ParameterDef = {
  id: keyof ReportStockRow;
  label: string;
  shortLabel?: string;
  width?: string;
  category: ParameterCategory;
  categoryLabel: string;
  description?: string;
  defaultSelected?: boolean;
  align?: "left" | "right" | "center";
  format?: "text" | "number" | "currency" | "percent" | "badge_action" | "badge_moat" | "badge_boolean" | "date";
};

export const PARAMETERS: ParameterDef[] = [
  // 1. Identity & Classification
  { id: "symbol", label: "Symbol", shortLabel: "Symbol", width: "w-24 min-w-[85px]", category: "identity", categoryLabel: "Identity & Sector", align: "left", format: "text", defaultSelected: true },
  { id: "company_name", label: "Company Name", shortLabel: "Company", width: "min-w-[160px] max-w-[220px]", category: "identity", categoryLabel: "Identity & Sector", align: "left", format: "text", defaultSelected: true },
  { id: "sector", label: "Sector", shortLabel: "Sector", width: "min-w-[120px] max-w-[160px]", category: "identity", categoryLabel: "Identity & Sector", align: "left", format: "text", defaultSelected: true },
  { id: "industry", label: "Industry / Cluster", shortLabel: "Industry", width: "min-w-[130px] max-w-[180px]", category: "identity", categoryLabel: "Identity & Sector", align: "left", format: "text", defaultSelected: false },
  { id: "market_cap_category", label: "Market Cap Tier", shortLabel: "Cap Tier", width: "w-24 min-w-[85px]", category: "identity", categoryLabel: "Identity & Sector", align: "center", format: "text", defaultSelected: false },
  { id: "market_cap_cr", label: "Market Cap (₹ Cr)", shortLabel: "Mkt Cap (₹ Cr)", width: "w-28 min-w-[100px]", category: "identity", categoryLabel: "Identity & Sector", align: "right", format: "number", defaultSelected: false },
  { id: "maturity_tier", label: "Maturity Tier", shortLabel: "Maturity", width: "w-24 min-w-[85px]", category: "identity", categoryLabel: "Identity & Sector", align: "center", format: "text", defaultSelected: false },
  { id: "is_nifty500", label: "NIFTY 500 Constituent", shortLabel: "Nifty 500", width: "w-20 min-w-[75px]", category: "identity", categoryLabel: "Identity & Sector", align: "center", format: "badge_boolean", defaultSelected: false },
  { id: "listing_date", label: "Listing Date", shortLabel: "Listing", width: "w-24 min-w-[85px]", category: "identity", categoryLabel: "Identity & Sector", align: "center", format: "date", defaultSelected: false },

  // 2. Pricing & Returns
  { id: "ltp", label: "Current Price / LTP (₹)", shortLabel: "LTP (₹)", width: "w-24 min-w-[85px]", category: "pricing", categoryLabel: "Pricing & Returns", align: "right", format: "currency", defaultSelected: true },
  { id: "ret_1d", label: "1-Day Change (%)", shortLabel: "1D %", width: "w-20 min-w-[70px]", category: "pricing", categoryLabel: "Pricing & Returns", align: "right", format: "percent", defaultSelected: true },
  { id: "ret_1w", label: "1-Week Return (%)", shortLabel: "1W %", width: "w-20 min-w-[70px]", category: "pricing", categoryLabel: "Pricing & Returns", align: "right", format: "percent", defaultSelected: false },
  { id: "ret_1m", label: "1-Month Return (%)", shortLabel: "1M %", width: "w-20 min-w-[70px]", category: "pricing", categoryLabel: "Pricing & Returns", align: "right", format: "percent", defaultSelected: false },
  { id: "ret_1y", label: "1-Year Return (%)", shortLabel: "1Y %", width: "w-20 min-w-[70px]", category: "pricing", categoryLabel: "Pricing & Returns", align: "right", format: "percent", defaultSelected: false },

  // 3. Verdicts & Calls Desk (Price Targets & Audit)
  { id: "action", label: "Verdict Action", shortLabel: "Action", width: "w-28 min-w-[95px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "center", format: "badge_action", defaultSelected: true },
  { id: "is_call_desk", label: "Active on Calls Desk?", shortLabel: "Calls Desk?", width: "w-24 min-w-[85px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "center", format: "badge_boolean", defaultSelected: false },
  { id: "call_side", label: "Call Side", shortLabel: "Call Side", width: "w-20 min-w-[70px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "center", format: "badge_action", defaultSelected: false },
  { id: "call_anchor_price", label: "Call Entry Price (₹)", shortLabel: "Call Price (₹)", width: "w-28 min-w-[95px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "right", format: "currency", defaultSelected: false },
  { id: "call_anchor_date", label: "Call Entry Date", shortLabel: "Call Date", width: "w-24 min-w-[85px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "center", format: "date", defaultSelected: false },
  { id: "confidence", label: "Confidence", shortLabel: "Confidence", width: "w-24 min-w-[85px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "center", format: "text", defaultSelected: false },
  { id: "buy_below", label: "Buy Below Price (₹)", shortLabel: "Buy Below (₹)", width: "w-28 min-w-[95px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "right", format: "currency", defaultSelected: true },
  { id: "target_price", label: "12M Target Price (₹)", shortLabel: "12M Target (₹)", width: "w-28 min-w-[100px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "right", format: "currency", defaultSelected: true },
  { id: "fair_value", label: "Fair Value (₹)", shortLabel: "Fair Value (₹)", width: "w-28 min-w-[95px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "right", format: "currency", defaultSelected: false },
  { id: "bear_floor", label: "Bear Floor / Stop (₹)", shortLabel: "Bear Floor (₹)", width: "w-28 min-w-[95px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "right", format: "currency", defaultSelected: true },
  { id: "upside_pct", label: "Upside to Target (%)", shortLabel: "Upside %", width: "w-24 min-w-[80px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "right", format: "percent", defaultSelected: true },
  { id: "risk_reward", label: "Risk / Reward Ratio", shortLabel: "Risk/Reward", width: "w-24 min-w-[85px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "right", format: "number", defaultSelected: false },
  { id: "valuation_method", label: "Valuation Model", shortLabel: "Val. Model", width: "w-28 min-w-[95px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "left", format: "text", defaultSelected: false },
  { id: "verdict_date", label: "Verdict Audit Date", shortLabel: "Verdict Date", width: "w-24 min-w-[85px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "center", format: "date", defaultSelected: false },
  { id: "verdict", label: "Full Verdict / Rationale", shortLabel: "Verdict", width: "min-w-[180px] max-w-[260px]", category: "verdict", categoryLabel: "Verdicts & Calls Desk", align: "left", format: "text", defaultSelected: false },

  // 4. Dividends & Corporate Payouts
  { id: "div_yield", label: "Dividend Yield (%)", shortLabel: "Div Yield %", width: "w-24 min-w-[75px]", category: "dividends", categoryLabel: "Dividends & Payouts", align: "right", format: "percent", defaultSelected: false },
  { id: "dps_current", label: "Dividend Per Share (₹)", shortLabel: "DPS (₹)", width: "w-24 min-w-[80px]", category: "dividends", categoryLabel: "Dividends & Payouts", align: "right", format: "currency", defaultSelected: false },
  { id: "dps_prev", label: "Prior Year DPS (₹)", shortLabel: "Prior DPS (₹)", width: "w-24 min-w-[80px]", category: "dividends", categoryLabel: "Dividends & Payouts", align: "right", format: "currency", defaultSelected: false },
  { id: "div_growth_pct", label: "Dividend Growth YoY (%)", shortLabel: "Div Growth %", width: "w-24 min-w-[80px]", category: "dividends", categoryLabel: "Dividends & Payouts", align: "right", format: "percent", defaultSelected: false },
  { id: "div_payout_cr", label: "Annual Dividend Payout (₹ Cr)", shortLabel: "Payout (₹ Cr)", width: "w-28 min-w-[90px]", category: "dividends", categoryLabel: "Dividends & Payouts", align: "right", format: "number", defaultSelected: false },
  { id: "div_paying_years", label: "Dividend Consistency (Years)", shortLabel: "Div Years", width: "w-24 min-w-[80px]", category: "dividends", categoryLabel: "Dividends & Payouts", align: "right", format: "number", defaultSelected: false },
  { id: "next_ex_date", label: "Upcoming / Recent Ex-Date", shortLabel: "Div Ex-Date", width: "w-24 min-w-[85px]", category: "dividends", categoryLabel: "Dividends & Payouts", align: "center", format: "date", defaultSelected: false },
  { id: "next_amount", label: "Upcoming Dividend Payout (₹)", shortLabel: "Next Div (₹)", width: "w-24 min-w-[85px]", category: "dividends", categoryLabel: "Dividends & Payouts", align: "right", format: "currency", defaultSelected: false },

  // 5. Moat & Business Audit
  { id: "moat_strength", label: "Moat Strength", shortLabel: "Moat", width: "w-24 min-w-[80px]", category: "moat", categoryLabel: "Moat & Business Audit", align: "center", format: "badge_moat", defaultSelected: true },
  { id: "moat_type", label: "Moat Type", shortLabel: "Moat Type", width: "w-28 min-w-[95px]", category: "moat", categoryLabel: "Moat & Business Audit", align: "left", format: "text", defaultSelected: false },
  { id: "moat_rationale", label: "Moat Rationale / Notes", shortLabel: "Moat Notes", width: "min-w-[160px] max-w-[240px]", category: "moat", categoryLabel: "Moat & Business Audit", align: "left", format: "text", defaultSelected: false },

  // 6. Factor Scores & Ranks
  { id: "composite_pct", label: "Composite Score (%)", shortLabel: "Composite %", width: "w-24 min-w-[80px]", category: "scores", categoryLabel: "Factor Scores & Ranks", align: "right", format: "number", defaultSelected: false },
  { id: "quality_pct", label: "Quality Score (%)", shortLabel: "Quality %", width: "w-20 min-w-[75px]", category: "scores", categoryLabel: "Factor Scores & Ranks", align: "right", format: "number", defaultSelected: false },
  { id: "valuation_pct", label: "Valuation Score (%)", shortLabel: "Valuation %", width: "w-20 min-w-[75px]", category: "scores", categoryLabel: "Factor Scores & Ranks", align: "right", format: "number", defaultSelected: false },
  { id: "momentum_pct", label: "Momentum Score (%)", shortLabel: "Momentum %", width: "w-24 min-w-[80px]", category: "scores", categoryLabel: "Factor Scores & Ranks", align: "right", format: "number", defaultSelected: false },
  { id: "peer_rank", label: "Peer Rank", shortLabel: "Peer Rank", width: "w-20 min-w-[70px]", category: "scores", categoryLabel: "Factor Scores & Ranks", align: "right", format: "number", defaultSelected: false },
  { id: "peer_count", label: "Peer Pool Size", shortLabel: "Peer Pool", width: "w-20 min-w-[70px]", category: "scores", categoryLabel: "Factor Scores & Ranks", align: "right", format: "number", defaultSelected: false },

  // 7. Valuation & Fundamentals
  { id: "pe_ttm", label: "P/E Ratio (TTM)", shortLabel: "P/E", width: "w-20 min-w-[65px]", category: "fundamentals", categoryLabel: "Valuation & Fundamentals", align: "right", format: "number", defaultSelected: false },
  { id: "pb", label: "Price / Book (P/B)", shortLabel: "P/B", width: "w-20 min-w-[60px]", category: "fundamentals", categoryLabel: "Valuation & Fundamentals", align: "right", format: "number", defaultSelected: false },
  { id: "roe_3y", label: "ROE / ROCE (3Y %)", shortLabel: "ROE (3Y %)", width: "w-24 min-w-[80px]", category: "fundamentals", categoryLabel: "Valuation & Fundamentals", align: "right", format: "percent", defaultSelected: false },
  { id: "op_margin_3y", label: "Operating Margin (%)", shortLabel: "Op. Margin %", width: "w-24 min-w-[80px]", category: "fundamentals", categoryLabel: "Valuation & Fundamentals", align: "right", format: "percent", defaultSelected: false },
  { id: "sales_cagr_5y", label: "5-Year Sales CAGR (%)", shortLabel: "Sales 5Y %", width: "w-24 min-w-[80px]", category: "fundamentals", categoryLabel: "Valuation & Fundamentals", align: "right", format: "percent", defaultSelected: false },
  { id: "profit_cagr_5y", label: "5-Year Profit CAGR (%)", shortLabel: "Profit 5Y %", width: "w-24 min-w-[80px]", category: "fundamentals", categoryLabel: "Valuation & Fundamentals", align: "right", format: "percent", defaultSelected: false },

  // 8. Portfolio & Holdings
  { id: "unrealized_pnl_pct", label: "Current Performance % (Portfolio)", shortLabel: "Port. Perf %", width: "w-24 min-w-[85px] max-w-[100px]", category: "portfolio", categoryLabel: "Portfolio Holdings", align: "right", format: "percent", defaultSelected: true },
  { id: "is_in_portfolio", label: "In Portfolio?", shortLabel: "Portfolio", width: "w-20 min-w-[75px]", category: "portfolio", categoryLabel: "Portfolio Holdings", align: "center", format: "badge_boolean", defaultSelected: false },
  { id: "is_watchlist", label: "In Watchlist?", shortLabel: "Watchlist", width: "w-20 min-w-[75px]", category: "portfolio", categoryLabel: "Portfolio Holdings", align: "center", format: "badge_boolean", defaultSelected: false },
  { id: "held_quantity", label: "Held Quantity", shortLabel: "Qty Held", width: "w-20 min-w-[75px]", category: "portfolio", categoryLabel: "Portfolio Holdings", align: "right", format: "number", defaultSelected: false },
  { id: "avg_cost", label: "Avg Purchase Cost (₹)", shortLabel: "Avg Cost (₹)", width: "w-28 min-w-[90px]", category: "portfolio", categoryLabel: "Portfolio Holdings", align: "right", format: "currency", defaultSelected: false },
  { id: "invested_value", label: "Invested Capital (₹)", shortLabel: "Invested (₹)", width: "w-28 min-w-[95px]", category: "portfolio", categoryLabel: "Portfolio Holdings", align: "right", format: "currency", defaultSelected: false },
  { id: "current_value", label: "Current Value (₹)", shortLabel: "Cur Value (₹)", width: "w-28 min-w-[95px]", category: "portfolio", categoryLabel: "Portfolio Holdings", align: "right", format: "currency", defaultSelected: false },
  { id: "unrealized_pnl", label: "Unrealized P&L (₹)", shortLabel: "P&L (₹)", width: "w-28 min-w-[95px]", category: "portfolio", categoryLabel: "Portfolio Holdings", align: "right", format: "currency", defaultSelected: false },
];

const CATEGORIES: { id: ParameterCategory; label: string; icon: string }[] = [
  { id: "identity", label: "Identity & Sector", icon: "🏷️" },
  { id: "pricing", label: "Pricing & Returns", icon: "💰" },
  { id: "verdict", label: "Verdicts & Calls Desk", icon: "🎯" },
  { id: "dividends", label: "Dividends & Payouts", icon: "🪙" },
  { id: "moat", label: "Moat & Business Audit", icon: "🛡️" },
  { id: "scores", label: "Factor Scores & Ranks", icon: "📊" },
  { id: "fundamentals", label: "Valuation & Fundamentals", icon: "📈" },
  { id: "portfolio", label: "Portfolio Holdings", icon: "💼" },
];

const DEFAULT_SELECTED_IDS: (keyof ReportStockRow)[] = PARAMETERS.filter((p) => p.defaultSelected).map((p) => p.id);
const STORAGE_KEY = "equityroots_report_saved_columns_v1";
const REPORT_COLUMNS_SERVER_KEY = "er:reportColumns:v1";

async function fetchReportColumnsServer(): Promise<{ signedIn: boolean; ids: (keyof ReportStockRow)[] }> {
  try {
    const r = await fetch(`/api/scanner/bookmarks?key=${encodeURIComponent(REPORT_COLUMNS_SERVER_KEY)}`, {
      credentials: "include",
    });
    if (!r.ok) return { signedIn: false, ids: [] };
    const d = (await r.json()) as { signedIn?: boolean; items?: { id: string }[] };
    if (!d.signedIn || !Array.isArray(d.items)) {
      return { signedIn: !!d.signedIn, ids: [] };
    }
    const ids = d.items
      .map((it) => it.id as keyof ReportStockRow)
      .filter((id) => PARAMETERS.some((p) => p.id === id));
    return { signedIn: true, ids };
  } catch {
    return { signedIn: false, ids: [] };
  }
}

async function putReportColumnsServer(ids: (keyof ReportStockRow)[]): Promise<void> {
  const items = ids.map((id) => ({ id: String(id), label: String(id) }));
  try {
    await fetch("/api/scanner/bookmarks", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: REPORT_COLUMNS_SERVER_KEY, items }),
    });
  } catch {
    // Best-effort
  }
}

const PRESETS: { name: string; ids: (keyof ReportStockRow)[] }[] = [
  {
    name: "Calls Desk & Verdicts",
    ids: ["symbol", "company_name", "ltp", "unrealized_pnl_pct", "action", "confidence", "buy_below", "target_price", "fair_value", "bear_floor", "upside_pct", "moat_strength", "verdict_date"],
  },
  {
    name: "Valuation & Fundamentals",
    ids: ["symbol", "company_name", "sector", "ltp", "market_cap_cr", "pe_ttm", "pb", "div_yield", "roe_3y", "op_margin_3y", "sales_cagr_5y", "composite_pct"],
  },
  {
    name: "Portfolio Audit",
    ids: ["symbol", "company_name", "is_in_portfolio", "held_quantity", "avg_cost", "ltp", "unrealized_pnl_pct", "invested_value", "current_value", "unrealized_pnl", "action", "buy_below", "target_price"],
  },
  {
    name: "Scores & Momentum",
    ids: ["symbol", "company_name", "sector", "industry", "composite_pct", "quality_pct", "valuation_pct", "momentum_pct", "peer_rank", "ltp", "ret_1d", "ret_1w", "ret_1m", "ret_1y"],
  },
];

export function ReportExtractorClient({ initialData }: { initialData: ReportStockRow[] | null }) {
  const [data, setData] = useState<ReportStockRow[]>(initialData ?? []);
  const [loading, setLoading] = useState<boolean>(!initialData || initialData.length === 0);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Fullscreen view toggle
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showFullscreenDrawer, setShowFullscreenDrawer] = useState<boolean>(false);

  // Saved user choices from localStorage / server
  const [savedPreset, setSavedPreset] = useState<(keyof ReportStockRow)[] | null>(null);
  const signedInRef = useRef(false);

  // Selected parameters set
  const [selectedIds, setSelectedIds] = useState<Set<keyof ReportStockRow>>(() => {
    return new Set(DEFAULT_SELECTED_IDS);
  });

  // Parameter search filter
  const [paramSearch, setParamSearch] = useState<string>("");

  // Collapsed categories map
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});

  // Filter toolbar
  const [universeScope, setUniverseScope] = useState<"all" | "nifty500" | "portfolio" | "watchlist" | "verdict" | "calls" | "pinned_calls">("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [stockSearch, setStockSearch] = useState<string>("");

  // Table sorting
  const [sortCol, setSortCol] = useState<keyof ReportStockRow>("symbol");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const tableRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    if (isFullscreen && tableScrollRef.current) {
      tableScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    } else if (!isFullscreen && tableRef.current) {
      tableRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Table Density: "compact" (default, high information density) vs "normal"
  const [density, setDensity] = useState<"compact" | "normal">(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("equityroots_report_density_v1");
        if (saved === "normal" || saved === "compact") return saved;
      } catch {}
    }
    return "compact";
  });
  const isCompact = density === "compact";

  // Hydrate saved choices: local cache first (instant), then server sync (cross-device)
  useEffect(() => {
    let alive = true;
    (async () => {
      let localIds: (keyof ReportStockRow)[] = [];
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            localIds = parsed.filter((id) => PARAMETERS.some((p) => p.id === id));
            if (localIds.length > 0) {
              setSavedPreset(localIds);
              setSelectedIds(new Set(localIds));
            }
          }
        }
      } catch {}

      const server = await fetchReportColumnsServer();
      if (!alive) return;
      if (server.signedIn) {
        signedInRef.current = true;
        if (server.ids.length > 0) {
          setSavedPreset(server.ids);
          setSelectedIds(new Set(server.ids));
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(server.ids));
          } catch {}
        } else if (localIds.length > 0) {
          // Carry-up local choices to server so user doesn't lose them
          putReportColumnsServer(localIds).catch(() => {});
        }
      } else {
        signedInRef.current = false;
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Listen for Escape key to exit fullscreen & lock body scroll
  useEffect(() => {
    if (isFullscreen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setIsFullscreen(false);
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        document.body.style.overflow = prevOverflow;
        window.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [isFullscreen]);

  // Save choices handler: saves locally and persists to server for this signed-in user
  const handleSaveChoices = () => {
    try {
      const ids = Array.from(selectedIds);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
      setSavedPreset(ids);
      putReportColumnsServer(ids).catch(() => {});
      setSaveStatus("✓ Saved across all devices!");
      setTimeout(() => setSaveStatus(null), 2500);
    } catch {
      setSaveStatus("Failed to save");
      setTimeout(() => setSaveStatus(null), 2500);
    }
  };

  // Fetch / refresh data from API
  const fetchData = useCallback(async (force: boolean = false) => {
    try {
      if (force) setRefreshing(true);
      else setLoading(true);

      const res = await fetch(`/api/admin/reports/data${force ? "?refresh=1" : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.rows && Array.isArray(json.rows)) {
        setData(json.rows);
      }
    } catch (e) {
      console.error("Failed to load report data:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load if no SSR data provided
  useEffect(() => {
    if (!initialData || initialData.length === 0) {
      fetchData(false);
    }
  }, [initialData, fetchData]);

  // Parameter toggle helpers
  const toggleParam = (id: keyof ReportStockRow) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategory = (catId: ParameterCategory) => {
    const catParams = PARAMETERS.filter((p) => p.category === catId);
    const allSelected = catParams.every((p) => selectedIds.has(p.id));

    setSelectedIds((prev) => {
      const next = new Set(prev);
      catParams.forEach((p) => {
        if (allSelected) next.delete(p.id);
        else next.add(p.id);
      });
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(PARAMETERS.map((p) => p.id)));
  };

  const resetToDefault = () => {
    setSelectedIds(new Set(DEFAULT_SELECTED_IDS));
  };

  const clearAll = () => {
    setSelectedIds(new Set(["symbol", "company_name"]));
  };

  const applyPreset = (ids: (keyof ReportStockRow)[]) => {
    setSelectedIds(new Set(ids));
  };

  // Filtered parameters based on search
  const filteredParams = useMemo(() => {
    if (!paramSearch.trim()) return PARAMETERS;
    const q = paramSearch.toLowerCase().trim();
    return PARAMETERS.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.categoryLabel.toLowerCase().includes(q)
    );
  }, [paramSearch]);

  // Selected parameters list in order (Symbol always leads as column 1 if selected)
  const activeColumns = useMemo(() => {
    const selected = PARAMETERS.filter((p) => selectedIds.has(p.id));
    const symIdx = selected.findIndex((p) => p.id === "symbol");
    if (symIdx > 0) {
      const sym = selected[symIdx];
      return [sym, ...selected.slice(0, symIdx), ...selected.slice(symIdx + 1)];
    }
    return selected;
  }, [selectedIds]);

  // Scope counts for dropdown
  const scopeCounts = useMemo(() => {
    return {
      all: data.length,
      nifty500: data.filter((r) => r.is_nifty500).length,
      portfolio: data.filter((r) => r.is_in_portfolio).length,
      watchlist: data.filter((r) => r.is_watchlist).length,
      verdict: data.filter((r) => Boolean(r.verdict)).length,
      calls: data.filter((r) => r.is_calls_desk).length,
      pinnedCalls: data.filter((r) => r.is_call_desk).length,
    };
  }, [data]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return data.filter((row) => {
      // 1. Universe filter
      if (universeScope === "nifty500" && !row.is_nifty500) return false;
      if (universeScope === "portfolio" && !row.is_in_portfolio) return false;
      if (universeScope === "watchlist" && !row.is_watchlist) return false;
      if (universeScope === "verdict" && !row.verdict) return false;
      if (universeScope === "calls" && !row.is_calls_desk) return false;
      if (universeScope === "pinned_calls" && !row.is_call_desk) return false;

      // 2. Action filter
      if (actionFilter !== "all") {
        if (actionFilter === "BUY" && row.action !== "BUY") return false;
        if (actionFilter === "WATCH" && row.action !== "WATCH") return false;
        if (actionFilter === "HOLD" && row.action !== "HOLD") return false;
        if (actionFilter === "SELL" && row.action !== "SELL") return false;
      }

      // 3. Stock text search
      if (stockSearch.trim()) {
        const q = stockSearch.toLowerCase().trim();
        const matchesSym = row.symbol.toLowerCase().includes(q);
        const matchesName = row.company_name?.toLowerCase().includes(q);
        const matchesSec = row.sector?.toLowerCase().includes(q);
        const matchesInd = row.industry?.toLowerCase().includes(q);
        if (!matchesSym && !matchesName && !matchesSec && !matchesInd) return false;
      }

      return true;
    });
  }, [data, universeScope, actionFilter, stockSearch]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => {
      const valA = a[sortCol];
      const valB = b[sortCol];

      if (valA == null && valB == null) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;

      if (typeof valA === "number" && typeof valB === "number") {
        return sortDir === "asc" ? valA - valB : valB - valA;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      return sortDir === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });
    return rows;
  }, [filteredRows, sortCol, sortDir]);

  // Paginated rows for preview
  const totalPages = Math.ceil(sortedRows.length / pageSize) || 1;
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

  // Handle column header click for sorting
  const handleSort = (colId: keyof ReportStockRow) => {
    if (sortCol === colId) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(colId);
      setSortDir(colId === "symbol" || colId === "company_name" ? "asc" : "desc");
    }
  };

  // CSV Generator
  const generateCSVContent = useCallback(() => {
    const cols = activeColumns;
    // Header line
    const headerLine = cols.map((c) => `"${c.label.replace(/"/g, '""')}"`).join(",");

    // Data lines
    const dataLines = sortedRows.map((row) => {
      return cols
        .map((col) => {
          const val = row[col.id];
          if (val == null) return "";
          if (typeof val === "boolean") return val ? "YES" : "NO";
          if (typeof val === "number") return val;
          const s = String(val).replace(/"/g, '""');
          return `"${s}"`;
        })
        .join(",");
    });

    return [headerLine, ...dataLines].join("\r\n");
  }, [activeColumns, sortedRows]);

  // Export CSV file download
  const handleExportCSV = () => {
    const csv = generateCSVContent();
    const dateStr = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `equityroots-custom-report-${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Copy CSV to clipboard
  const handleCopyCSV = async () => {
    try {
      const csv = generateCSVContent();
      await navigator.clipboard.writeText(csv);
      setCopyStatus("✓ Copied to clipboard!");
      setTimeout(() => setCopyStatus(null), 2500);
    } catch {
      setCopyStatus("Failed to copy");
      setTimeout(() => setCopyStatus(null), 2500);
    }
  };

  // Formatting helper for table cells
  const renderCellContent = (row: ReportStockRow, col: ParameterDef) => {
    const val = row[col.id];
    if (val == null) return <span className="text-slate-400 dark:text-slate-500">—</span>;

    if (col.id === "symbol") {
      return (
        <Link
          href={`/stock/${row.symbol}`}
          target="_blank"
          className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
        >
          {String(val)}
        </Link>
      );
    }

    if (col.id === "company_name") {
      return (
        <span className="block truncate max-w-[200px]" title={String(val)}>
          {String(val)}
        </span>
      );
    }

    if (col.format === "badge_boolean") {
      return val ? (
        <span className={`inline-flex px-1.5 rounded ${isCompact ? "text-[11px] py-0.5" : "text-xs py-0.5"} font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300`}>
          YES
        </span>
      ) : (
        <span className={`inline-flex px-1.5 rounded ${isCompact ? "text-[11px] py-0.5" : "text-xs py-0.5"} font-semibold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400`}>
          NO
        </span>
      );
    }

    if (col.format === "badge_action") {
      const s = String(val).toUpperCase();
      let colorCls = "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
      if (s === "BUY") {
        colorCls = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold border border-emerald-300 dark:border-emerald-700";
      } else if (s === "WATCH") {
        colorCls = "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-medium";
      } else if (s === "HOLD") {
        colorCls = "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border border-sky-300 dark:border-sky-700 font-medium";
      } else if (s === "SELL") {
        colorCls = "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-700 font-medium";
      }
      return <span className={`inline-flex px-1.5 rounded ${isCompact ? "text-[11px] py-0.5" : "text-xs py-0.5"} whitespace-nowrap ${colorCls}`}>{String(val)}</span>;
    }

    if (col.format === "badge_moat") {
      const s = String(val).toUpperCase();
      let colorCls = "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
      if (s === "WIDE") colorCls = "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 font-semibold";
      else if (s === "NARROW") colorCls = "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300";
      return <span className={`inline-flex px-1.5 rounded ${isCompact ? "text-[11px] py-0.5" : "text-xs py-0.5"} whitespace-nowrap ${colorCls}`}>{String(val)}</span>;
    }

    if (col.format === "percent") {
      const num = Number(val);
      const isPositive = num > 0;
      const isNegative = num < 0;

      if (col.id === "unrealized_pnl_pct") {
        return (
          <span
            className={`inline-flex items-center px-1 rounded ${isCompact ? "text-[11px] py-0.5" : "text-xs py-0.5"} font-bold ${
              isPositive
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80"
                : isNegative
                ? "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800/80"
                : "text-slate-600 dark:text-slate-400"
            }`}
          >
            {isPositive ? "+" : ""}
            {num.toFixed(1)}%
          </span>
        );
      }

      const cls = isPositive
        ? "text-emerald-600 dark:text-emerald-400 font-medium"
        : isNegative
        ? "text-rose-600 dark:text-rose-400 font-medium"
        : "text-slate-600 dark:text-slate-400";
      return (
        <span className={cls}>
          {isPositive ? "+" : ""}
          {num.toFixed(1)}%
        </span>
      );
    }

    if (col.format === "currency") {
      const num = Number(val);
      return <span>₹{num.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>;
    }

    if (col.format === "number") {
      const num = Number(val);
      return <span>{num.toLocaleString("en-IN")}</span>;
    }

    if (col.id === "company_name") {
      return <span className="max-w-[180px] sm:max-w-[220px] truncate block font-medium" title={String(val)}>{String(val)}</span>;
    }

    return <span className="max-w-[220px] truncate block" title={String(val)}>{String(val)}</span>;
  };

  // Reusable Parameter Sidebar Content
  const ParameterSidebarContent = (
    <div className="flex flex-col gap-3">
      {/* Header, Save Button & Presets */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Export Parameters ({selectedIds.size})
        </span>
        <div className="flex items-center gap-1 text-[11px]">
          <button
            onClick={selectAll}
            className="text-blue-600 dark:text-blue-400 hover:underline font-medium px-1"
          >
            All
          </button>
          <span className="text-slate-300 dark:text-slate-700">•</span>
          <button
            onClick={resetToDefault}
            className="text-slate-600 dark:text-slate-300 hover:underline font-medium px-1"
            title="Reset to default recommended columns"
          >
            Default
          </button>
          <span className="text-slate-300 dark:text-slate-700">•</span>
          <button
            onClick={clearAll}
            className="text-slate-500 dark:text-slate-400 hover:underline font-medium px-1"
            title="Clear all optional columns"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Save My Choices Button */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSaveChoices}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
          title="Save your current column selections so they persist on refresh"
        >
          <span>💾</span>
          <span>Save My Choices</span>
        </button>
        {saveStatus && (
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap animate-pulse">
            {saveStatus}
          </span>
        )}
      </div>

      {/* Quick Presets */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
          ⚡ 1-Click Presets:
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {savedPreset && (
            <button
              onClick={() => applyPreset(savedPreset)}
              className="col-span-2 px-2 py-1 text-[11px] text-left font-bold rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700/60 truncate transition-colors hover:bg-amber-100"
              title="Restore your saved column preferences"
            >
              ⭐ My Saved Choices ({savedPreset.length})
            </button>
          )}
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => applyPreset(preset.ids)}
              className="px-2 py-1 text-[11px] text-left font-medium rounded bg-slate-50 dark:bg-slate-800/80 hover:bg-blue-50 dark:hover:bg-blue-950/60 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/60 truncate transition-colors"
              title={preset.name}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Parameter Search Input */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search parameters..."
          value={paramSearch}
          onChange={(e) => setParamSearch(e.target.value)}
          className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-800 dark:text-slate-200 placeholder-slate-400"
        />
        {paramSearch && (
          <button
            onClick={() => setParamSearch("")}
            className="absolute right-2 top-1.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            ✕
          </button>
        )}
      </div>

      {/* Parameter Categories & Checkboxes */}
      <div className="flex flex-col gap-3">
        {CATEGORIES.map((cat) => {
          const catParams = filteredParams.filter((p) => p.category === cat.id);
          if (catParams.length === 0) return null;

          const selectedCount = catParams.filter((p) => selectedIds.has(p.id)).length;
          const isCollapsed = Boolean(collapsedCats[cat.id]);

          return (
            <div
              key={cat.id}
              className="border border-slate-100 dark:border-slate-800/80 rounded-lg overflow-hidden"
            >
              {/* Category Header */}
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-50/80 dark:bg-slate-800/40 select-none">
                <button
                  onClick={() =>
                    setCollapsedCats((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))
                  }
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 text-left"
                >
                  <span className="text-[10px] text-slate-400">
                    {isCollapsed ? "▶" : "▼"}
                  </span>
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>

                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-semibold ${
                      selectedCount > 0
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                    }`}
                  >
                    {selectedCount}/{catParams.length}
                  </span>
                  <button
                    onClick={() => toggleCategory(cat.id)}
                    className="text-[10px] text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                    title={selectedCount === catParams.length ? "Deselect category" : "Select all in category"}
                  >
                    {selectedCount === catParams.length ? "none" : "all"}
                  </button>
                </div>
              </div>

              {/* Category Parameter Items */}
              {!isCollapsed && (
                <div className="p-2 flex flex-col gap-1 bg-white dark:bg-slate-900">
                  {catParams.map((param) => {
                    const isChecked = selectedIds.has(param.id);
                    return (
                      <label
                        key={param.id}
                        className={`flex items-center gap-2 px-1.5 py-1 rounded text-xs cursor-pointer select-none transition-colors ${
                          isChecked
                            ? "bg-blue-50/70 text-slate-900 dark:bg-blue-950/40 dark:text-slate-100 font-medium"
                            : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleParam(param.id)}
                          className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700"
                        />
                        <span className="truncate">{param.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      className={`w-full ${
        isFullscreen
          ? "fixed inset-0 z-50 bg-slate-100 dark:bg-slate-950 p-2 sm:p-3 flex flex-col h-screen w-screen overflow-hidden"
          : "flex flex-col gap-4"
      }`}
    >
      {/* Top Header Card (Hidden in Fullscreen mode for maximum space) */}
      {!isFullscreen && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                📊 Report Extraction Desk
              </h1>
              <span className="px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-full">
                Admin Suite
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              Pick parameters from the left panel to configure, preview real-time metrics across all {data.length > 0 ? `${data.length.toLocaleString("en-IN")} active NSE stocks` : "active NSE stocks"}, and export clean CSV reports.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
              title="Re-query latest data from database"
            >
              <span className={refreshing ? "animate-spin" : ""}>🔄</span>
              <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Split Layout: Left Rail (Parameters) | Right Panel (Preview & Actions) */}
      <div
        className={
          isFullscreen
            ? "relative flex-1 min-h-0 flex flex-col w-full"
            : "flex flex-col lg:flex-row gap-3.5 items-start w-full"
        }
      >
        {/* ── LEFT RAIL: PARAMETER EXTRACTION SELECTOR (Compact column: ~260-280px) ── */}
        {!isFullscreen && (
          <div className="w-full lg:w-64 xl:w-72 shrink-0 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto">
            {ParameterSidebarContent}
          </div>
        )}

        {/* ── FULLSCREEN PARAMETERS DRAWER ── */}
        {isFullscreen && showFullscreenDrawer && (
          <div className="absolute top-16 bottom-4 left-4 w-72 z-50 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200 dark:border-slate-700">
              <span className="text-xs font-bold uppercase text-slate-700 dark:text-slate-300">
                Configure Columns
              </span>
              <button
                onClick={() => setShowFullscreenDrawer(false)}
                className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800"
              >
                ✕ Close
              </button>
            </div>
            {ParameterSidebarContent}
          </div>
        )}

        {/* ── RIGHT PANEL: PREVIEW DESK & EXPORT ACTIONS (Takes all remaining width) ── */}
        <div
          className={
            isFullscreen
              ? "flex-1 min-h-0 flex flex-col gap-2 w-full overflow-hidden"
              : "flex-1 min-w-0 flex flex-col gap-3 w-full"
          }
        >
          {/* Action Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs shrink-0">
            {/* Left Controls: Universe, Verdict & Stock filters */}
            <div className="flex flex-wrap items-center gap-2">
              {isFullscreen && (
                <button
                  onClick={() => setShowFullscreenDrawer((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 transition-colors"
                >
                  <span>⚙️</span>
                  <span>Columns ({selectedIds.size})</span>
                </button>
              )}

              {/* Universe Dropdown */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 font-medium hidden sm:inline">Scope:</span>
                <select
                  value={universeScope}
                  onChange={(e) => {
                    setUniverseScope(e.target.value as any);
                    setPage(1);
                  }}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  <option value="all">All Active NSE Stocks ({scopeCounts.all > 0 ? scopeCounts.all.toLocaleString("en-IN") : "..."})</option>
                  <option value="calls">Calls Desk Stocks ({scopeCounts.calls.toLocaleString("en-IN")})</option>
                  <option value="pinned_calls">Pinned Active Calls ({scopeCounts.pinnedCalls})</option>
                  <option value="verdict">Curated Verdicts ({scopeCounts.verdict.toLocaleString("en-IN")})</option>
                  <option value="portfolio">Portfolio Holdings ({scopeCounts.portfolio})</option>
                  <option value="watchlist">My Watchlist ({scopeCounts.watchlist})</option>
                  <option value="nifty500">NIFTY 500 Constituents ({scopeCounts.nifty500})</option>
                </select>
              </div>

              {/* Action / Verdict Dropdown */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 font-medium hidden sm:inline">Verdict:</span>
                <select
                  value={actionFilter}
                  onChange={(e) => {
                    setActionFilter(e.target.value);
                    setPage(1);
                  }}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  <option value="all">All Actions</option>
                  <option value="BUY">BUY / ACCUMULATE</option>
                  <option value="WATCH">WATCH Only</option>
                  <option value="HOLD">HOLD Only</option>
                  <option value="SELL">SELL / EXIT</option>
                </select>
              </div>

              {/* Search Stocks */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter stock / sector..."
                  value={stockSearch}
                  onChange={(e) => {
                    setStockSearch(e.target.value);
                    setPage(1);
                  }}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-400 w-32 sm:w-40"
                />
                {stockSearch && (
                  <button
                    onClick={() => setStockSearch("")}
                    className="absolute right-2 top-1.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Right Controls: Save, Fullscreen, Copy, Export */}
            <div className="flex items-center gap-2">
              {copyStatus && (
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 animate-pulse">
                  {copyStatus}
                </span>
              )}
              {saveStatus && (
                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 animate-pulse">
                  {saveStatus}
                </span>
              )}

              {/* Density Toggle Button */}
              <button
                onClick={() => {
                  setDensity((d) => {
                    const next = d === "compact" ? "normal" : "compact";
                    try {
                      localStorage.setItem("equityroots_report_density_v1", next);
                    } catch {}
                    return next;
                  });
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors border ${
                  isCompact
                    ? "bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700"
                    : "bg-white hover:bg-slate-50 text-slate-600 dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-800"
                }`}
                title={isCompact ? "Switch to Normal Row Spacing" : "Switch to Compact Density"}
              >
                <span>{isCompact ? "☵" : "☰"}</span>
                <span>{isCompact ? "Compact" : "Comfortable"}</span>
              </button>

              {/* Fullscreen Toggle Button */}
              <button
                onClick={() => {
                  setIsFullscreen((prev) => !prev);
                  setShowFullscreenDrawer(false);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  isFullscreen
                    ? "bg-amber-100 hover:bg-amber-200 text-amber-900 dark:bg-amber-950 dark:hover:bg-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200"
                }`}
                title={isFullscreen ? "Exit Fullscreen (Esc)" : "Expand to Fullscreen View"}
              >
                <span>{isFullscreen ? "✕" : "⛶"}</span>
                <span>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</span>
              </button>

              <button
                onClick={handleCopyCSV}
                disabled={activeColumns.length === 0 || sortedRows.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 transition-colors disabled:opacity-40"
                title="Copy formatted CSV to clipboard"
              >
                <span>📋</span>
                <span className="hidden sm:inline">Copy CSV</span>
              </button>

              <button
                onClick={handleExportCSV}
                disabled={activeColumns.length === 0 || sortedRows.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors disabled:opacity-40 cursor-pointer"
                title="Download CSV file for Excel / Sheets"
              >
                <span>📥</span>
                <span>Export CSV ({sortedRows.length.toLocaleString("en-IN")})</span>
              </button>
            </div>
          </div>

          {/* Live Count / Metrics Summary Bar with Top Quick Pager */}
          <div className="flex items-center justify-between text-xs px-1 text-slate-500 dark:text-slate-400 shrink-0">
            <div>
              Showing <span className="font-semibold text-slate-800 dark:text-slate-200">{sortedRows.length.toLocaleString("en-IN")}</span> stocks
              matching criteria • <span className="font-semibold text-slate-800 dark:text-slate-200">{activeColumns.length}</span> columns active
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-400 mr-1">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium"
                >
                  ‹ Prev
                </button>
                <button
                  onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="px-2.5 py-0.5 rounded bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700 text-[11px] font-semibold transition-colors"
                >
                  Next page ›
                </button>
              </div>
            )}
          </div>

          {/* Table Container */}
          <div
            ref={tableRef}
            className={`border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 shadow-xs flex flex-col overflow-hidden ${
              isFullscreen ? "flex-1 min-h-0" : ""
            }`}
          >
            {loading ? (
              <div className="py-24 flex flex-col items-center justify-center text-slate-400">
                <span className="text-2xl animate-spin mb-2">🔄</span>
                <span className="text-sm">Loading active stocks data...</span>
              </div>
            ) : activeColumns.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center text-slate-400 px-4 text-center">
                <span className="text-3xl mb-2">📋</span>
                <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                  No parameters selected
                </span>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Select at least one parameter from the left rail or pick a 1-click preset to preview and export data.
                </p>
                <button
                  onClick={resetToDefault}
                  className="mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  Load Default Columns
                </button>
              </div>
            ) : sortedRows.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center text-slate-400 px-4 text-center">
                <span className="text-3xl mb-2">🔍</span>
                <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                  No stocks match current filters
                </span>
                <p className="text-xs text-slate-400 mt-1">
                  Try clearing the search query or switching scope to &quot;All Active Stocks&quot;.
                </p>
              </div>
            ) : (
              <div
                ref={tableScrollRef}
                className={`w-full ${
                  isFullscreen ? "flex-1 min-h-0 overflow-auto" : "overflow-x-auto"
                }`}
              >
                <table className={`w-full text-left border-collapse ${isCompact ? "text-xs" : "text-sm"}`}>
                  <thead className="bg-slate-100 dark:bg-slate-800 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th
                        style={{ width: 44, minWidth: 44, maxWidth: 44, left: 0 }}
                        className={`${isCompact ? "py-1.5 px-1 text-[11px]" : "py-2 px-2 text-xs"} font-semibold text-slate-500 dark:text-slate-400 text-center sticky left-0 z-30 bg-slate-100 dark:bg-slate-800 border-r border-slate-200/80 dark:border-slate-800`}
                      >
                        #
                      </th>
                      {activeColumns.map((col, cIdx) => {
                        const isSorted = sortCol === col.id;
                        const isFirstCol = cIdx === 0;
                        return (
                          <th
                            key={col.id}
                            onClick={() => handleSort(col.id)}
                            style={isFirstCol ? { left: 44 } : undefined}
                            title={col.label}
                            className={`${isCompact ? "py-1.5 px-2 text-xs" : "py-2 px-2.5 text-sm"} font-semibold text-slate-700 dark:text-slate-300 cursor-pointer select-none hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition-colors whitespace-nowrap ${
                              isFirstCol
                                ? "sticky z-30 bg-slate-100 dark:bg-slate-800 border-r-2 border-slate-300 dark:border-slate-700 shadow-[3px_0_6px_-2px_rgba(0,0,0,0.12)]"
                                : ""
                            } ${col.width ?? ""} ${
                              col.align === "right"
                                ? "text-right"
                                : col.align === "center"
                                ? "text-center"
                                : "text-left"
                            }`}
                          >
                            <div
                              className={`inline-flex items-center gap-1 ${
                                col.align === "right"
                                  ? "justify-end"
                                  : col.align === "center"
                                  ? "justify-center"
                                  : ""
                              }`}
                            >
                              <span>{col.shortLabel ?? col.label}</span>
                              <span className="text-[9px] text-slate-400">
                                {isSorted ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                              </span>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {paginatedRows.map((row, idx) => {
                      const absoluteIdx = (page - 1) * pageSize + idx + 1;
                      return (
                        <tr
                          key={row.symbol}
                          className="group even:bg-slate-50/50 dark:even:bg-slate-800/30 hover:bg-blue-50/70 dark:hover:bg-slate-800/80 transition-colors"
                        >
                          <td
                            style={{ width: 44, minWidth: 44, maxWidth: 44, left: 0 }}
                            className={`${isCompact ? "py-1 px-1 text-[11px]" : "py-1.5 px-2 text-xs"} text-slate-400 text-center font-mono sticky left-0 z-20 bg-white group-even:bg-slate-50 dark:bg-slate-900 group-hover:bg-blue-50 dark:group-hover:bg-slate-800 border-r border-slate-200/60 dark:border-slate-800 transition-colors`}
                          >
                            {absoluteIdx}
                          </td>
                          {activeColumns.map((col, cIdx) => {
                            const isFirstCol = cIdx === 0;
                            return (
                              <td
                                key={col.id}
                                style={isFirstCol ? { left: 44 } : undefined}
                                className={`${isCompact ? "py-1 px-2 text-xs" : "py-2 px-2.5 text-sm"} whitespace-nowrap ${
                                  isFirstCol
                                    ? "sticky z-20 bg-white group-even:bg-slate-50 dark:bg-slate-900 group-hover:bg-blue-50 dark:group-hover:bg-slate-800 font-semibold border-r-2 border-slate-300 dark:border-slate-700 shadow-[3px_0_6px_-2px_rgba(0,0,0,0.12)] transition-colors"
                                    : ""
                                } ${col.width ?? ""} ${
                                  col.align === "right"
                                    ? "text-right font-mono"
                                    : col.align === "center"
                                    ? "text-center"
                                    : "text-left"
                                }`}
                              >
                                {renderCellContent(row, col)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Toolbar */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50/70 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 shrink-0">
                <div className="flex items-center gap-3">
                  <span>
                    Showing {((page - 1) * pageSize + 1).toLocaleString("en-IN")} to{" "}
                    {Math.min(page * pageSize, sortedRows.length).toLocaleString("en-IN")} of {sortedRows.length.toLocaleString("en-IN")} stocks
                  </span>
                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="text-slate-400">Page size:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 focus:outline-none"
                    >
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handlePageChange(1)}
                    disabled={page === 1}
                    className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                  >
                    « First
                  </button>
                  <button
                    onClick={() => handlePageChange(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="px-2.5 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                  >
                    ‹ Prev
                  </button>
                  <span className="px-2 font-semibold text-slate-700 dark:text-slate-200">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                    disabled={page === totalPages}
                    className="px-3.5 py-1 rounded bg-blue-600 text-white font-bold shadow-xs disabled:opacity-40 disabled:bg-slate-300 dark:disabled:bg-slate-700 hover:bg-blue-700 transition-colors cursor-pointer"
                  >
                    Next page ›
                  </button>
                  <button
                    onClick={() => handlePageChange(totalPages)}
                    disabled={page === totalPages}
                    className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                  >
                    Last »
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── METRIC & INTERPRETATION GUIDE ── */}
          {!isFullscreen && (
            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-base">📖</span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      How to Interpret Key Metrics &amp; Parameters
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Quick reference definitions for price targets, portfolio returns, moats, and risk metrics.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 mt-3.5">
                {/* 1. Upside to Target */}
                <div className="p-3 rounded-lg bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span>🎯</span> Upside to Target (%)
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      (Target - LTP) / LTP
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Projected percentage appreciation from the current market price (LTP) to the 12-month fair target price.
                  </p>
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400 border-t border-slate-200/40 dark:border-slate-700/40 pt-1 flex flex-col gap-0.5">
                    <span>• <strong>&gt; 20%:</strong> Strong headroom for potential capital appreciation.</span>
                    <span>• <strong>0% to 5%:</strong> Fully valued; minimal margin of safety.</span>
                    <span>• <strong>Negative (&le; 0%):</strong> Trading above 12M target (Profit Harvesting / Hold).</span>
                  </div>
                </div>

                {/* 2. Current Performance % */}
                <div className="p-3 rounded-lg bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span>💼</span> Current Performance % (Portfolio)
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      (LTP - Avg Cost) / Avg Cost
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Live unrealized return percentage on stocks actively held in your portfolio based on weighted average purchase price.
                  </p>
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400 border-t border-slate-200/40 dark:border-slate-700/40 pt-1 flex flex-col gap-0.5">
                    <span>• <strong>Badge:</strong> Green for positive gains (+), red for unrealized losses (-).</span>
                    <span>• <strong>Dash (—):</strong> Displayed for stocks not currently held in your portfolio.</span>
                  </div>
                </div>

                {/* 3. Buy Below Price */}
                <div className="p-3 rounded-lg bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span>🛒</span> Buy Below Price (₹)
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400">Entry Ceiling</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Maximum disciplined entry price ensuring an attractive margin of safety before initiating or adding to a position.
                  </p>
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400 border-t border-slate-200/40 dark:border-slate-700/40 pt-1 flex flex-col gap-0.5">
                    <span>• <strong>LTP &le; Buy Below:</strong> Inside favorable buy zone; attractive accumulation point.</span>
                    <span>• <strong>LTP &gt; Buy Below:</strong> Wait for a pullback into the buy zone rather than chasing.</span>
                  </div>
                </div>

                {/* 4. Bear Floor */}
                <div className="p-3 rounded-lg bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span>🛡️</span> Bear Floor / Stop (₹)
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400">Risk Floor</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Conservative downside support floor derived from historical valuation troughs, capital replacement cost, and cyclical bottoms.
                  </p>
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400 border-t border-slate-200/40 dark:border-slate-700/40 pt-1 flex flex-col gap-0.5">
                    <span>• Defines your maximum expected drawdown risk during market selloffs.</span>
                    <span>• Breaching below the bear floor prompts re-evaluation or stop loss.</span>
                  </div>
                </div>

                {/* 5. Risk / Reward */}
                <div className="p-3 rounded-lg bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span>⚖️</span> Risk / Reward Ratio (R:R)
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                      (Target - LTP) / (LTP - Floor)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Ratio of potential upside gain relative to downside risk guardrail.
                  </p>
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400 border-t border-slate-200/40 dark:border-slate-700/40 pt-1 flex flex-col gap-0.5">
                    <span>• <strong>&ge; 2.5:</strong> Highly asymmetric opportunity (upside outweighs risk).</span>
                    <span>• <strong>&lt; 1.5:</strong> Symmetrical or unfavorable risk proposition.</span>
                  </div>
                </div>

                {/* 6. Moat Strength */}
                <div className="p-3 rounded-lg bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span>🏰</span> Moat Strength &amp; Audit
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400">Durability</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Measures the sustainability of the company&apos;s competitive advantage against competitors.
                  </p>
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400 border-t border-slate-200/40 dark:border-slate-700/40 pt-1 flex flex-col gap-0.5">
                    <span>• <strong>Wide:</strong> Strong pricing power, brand, or network monopoly.</span>
                    <span>• <strong>Narrow:</strong> Defensible niche edge, but vulnerable over multi-year cycles.</span>
                    <span>• <strong>None:</strong> Commodity or highly competitive business.</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
