"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  FileText,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  SlidersHorizontal,
  Table as TableIcon,
  LayoutGrid,
  Percent,
  Calendar,
  Sparkles,
  Building2,
  CheckCircle2,
  X,
} from "lucide-react";
import CapTierBadge, { type CapCategory } from "@/components/CapTierBadge";

export type DeclaredResult = {
  symbol: string;
  company_name: string;
  sector: string;
  industry: string;
  market_cap_category: string | null;
  ltp: number;
  market_cap_cr: number;
  change_p: number;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  period_end: string;
  curr_sales: number | null;
  curr_op: number | null;
  curr_np: number | null;
  yago_sales: number | null;
  yago_np: number | null;
  qoq_sales: number | null;
  qoq_np: number | null;
  sales_yoy: number | null;
  np_yoy: number | null;
  opm_pct: number | null;
  filing_title: string | null;
  published_at: string | null;
  pdf_url: string | null;
  declaration_date: string;
};

type QuickFilter = "all" | "beats" | "double_digit" | "high_margin" | "turnarounds";
type SortOption = "date_desc" | "np_growth_desc" | "sales_growth_desc" | "margin_desc" | "mcap_desc";

function fmtCr(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  if (Math.abs(v) >= 1000) {
    return `₹${(v / 1000).toFixed(2)}k Cr`;
  }
  return `₹${v.toFixed(1)} Cr`;
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number | null | undefined, sign = true): { text: string; isPositive: boolean; isNegative: boolean } {
  if (v == null || isNaN(v)) return { text: "—", isPositive: false, isNegative: false };
  if (v === 999.0) return { text: "Turnaround (Loss → Profit)", isPositive: true, isNegative: false };
  const s = sign && v > 0 ? "+" : "";
  return {
    text: `${s}${v.toFixed(1)}%`,
    isPositive: v > 0,
    isNegative: v < 0,
  };
}

function formatQuarter(periodEnd: string): string {
  if (!periodEnd) return "—";
  try {
    const d = new Date(periodEnd);
    const month = d.getMonth() + 1; // 1-12
    const year = d.getFullYear();
    const shortYear = String(year).slice(-2);
    // Indian Financial Year: April-March
    if (month >= 1 && month <= 3) return `Q4 FY${shortYear} (Mar ${year})`;
    if (month >= 4 && month <= 6) return `Q1 FY${Number(shortYear) + 1} (Jun ${year})`;
    if (month >= 7 && month <= 9) return `Q2 FY${Number(shortYear) + 1} (Sep ${year})`;
    return `Q3 FY${Number(shortYear) + 1} (Dec ${year})`;
  } catch {
    return periodEnd;
  }
}

function formatDeclarationDate(dateStr: string): { label: string; badge?: string } {
  if (!dateStr) return { label: "—" };
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    const formatted = d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    if (diffDays === 0) return { label: formatted, badge: "Today" };
    if (diffDays === 1) return { label: formatted, badge: "Yesterday" };
    if (diffDays >= 2 && diffDays <= 5) return { label: formatted, badge: `${diffDays}d ago` };

    return { label: formatted };
  } catch {
    return { label: dateStr };
  }
}

export function ResultsCornerClient({ results }: { results: DeclaredResult[] }) {
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("date_desc");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Filtered and sorted results
  const filtered = useMemo(() => {
    let list = results;

    // Search query
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.symbol.toLowerCase().includes(q) ||
          r.company_name.toLowerCase().includes(q) ||
          r.sector.toLowerCase().includes(q) ||
          r.industry.toLowerCase().includes(q),
      );
    }

    // Quick filter
    if (quickFilter === "beats") {
      list = list.filter((r) => r.np_yoy != null && (r.np_yoy >= 20 || r.np_yoy === 999.0));
    } else if (quickFilter === "double_digit") {
      list = list.filter((r) => (r.np_yoy ?? 0) >= 10 && (r.sales_yoy ?? 0) >= 10);
    } else if (quickFilter === "high_margin") {
      list = list.filter((r) => (r.opm_pct ?? 0) >= 25);
    } else if (quickFilter === "turnarounds") {
      list = list.filter((r) => r.np_yoy === 999.0);
    }

    // Sort
    return [...list].sort((a, b) => {
      if (sortBy === "date_desc") {
        const da = a.declaration_date || a.period_end || "";
        const db = b.declaration_date || b.period_end || "";
        return db.localeCompare(da);
      }
      if (sortBy === "np_growth_desc") {
        return (b.np_yoy ?? -999) - (a.np_yoy ?? -999);
      }
      if (sortBy === "sales_growth_desc") {
        return (b.sales_yoy ?? -999) - (a.sales_yoy ?? -999);
      }
      if (sortBy === "margin_desc") {
        return (b.opm_pct ?? -999) - (a.opm_pct ?? -999);
      }
      if (sortBy === "mcap_desc") {
        return b.market_cap_cr - a.market_cap_cr;
      }
      return 0;
    });
  }, [results, search, quickFilter, sortBy]);

  // Paginated slice
  const paginated = useMemo(() => {
    return filtered.slice(0, page * pageSize);
  }, [filtered, page]);

  // Overall KPI metrics
  const stats = useMemo(() => {
    const total = results.length;
    const beats = results.filter((r) => r.np_yoy != null && (r.np_yoy >= 20 || r.np_yoy === 999.0)).length;
    const margins = results.map((r) => r.opm_pct).filter((v): v is number => v != null && v > 0);
    const medianMargin = margins.length > 0 ? margins.sort((a, b) => a - b)[Math.floor(margins.length / 2)] : 0;
    const turnarounds = results.filter((r) => r.np_yoy === 999.0).length;

    return { total, beats, medianMargin, turnarounds };
  }, [results]);

  return (
    <div className="space-y-4">
      {/* Masthead Banner */}
      <div className="card p-4 md:p-5 border hairline">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold tracking-wider uppercase mb-1.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
              <Sparkles className="w-3 h-3" />
              <span>Earnings Season Intelligence</span>
            </div>
            <h1 className="font-display text-[22px] md:text-[24px] font-semibold tracking-tight">
              Results Corner
            </h1>
            <p className="muted-text text-[13px] max-w-2xl mt-0.5">
              Live corporate quarterly financial results declared for NSE equities — revenue growth, net profit, operating margins, and direct exchange filing PDFs.
            </p>
          </div>

          {/* Quick KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-2.5 rounded-lg border hairline bg-[var(--color-paper)]">
              <div className="text-[11px] muted-text uppercase font-medium">Declared</div>
              <div className="text-[18px] font-semibold tabular-nums mt-0.5">{stats.total}</div>
            </div>
            <div className="p-2.5 rounded-lg border hairline bg-[var(--color-paper)]">
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 uppercase font-medium">Profit Beats</div>
              <div className="text-[18px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                {stats.beats}
              </div>
            </div>
            <div className="p-2.5 rounded-lg border hairline bg-[var(--color-paper)]">
              <div className="text-[11px] muted-text uppercase font-medium">Median OPM</div>
              <div className="text-[18px] font-semibold tabular-nums mt-0.5">
                {stats.medianMargin ? `${stats.medianMargin.toFixed(1)}%` : "—"}
              </div>
            </div>
            <div className="p-2.5 rounded-lg border hairline bg-[var(--color-paper)]">
              <div className="text-[11px] text-indigo-600 dark:text-indigo-400 uppercase font-medium">Turnarounds</div>
              <div className="text-[18px] font-semibold tabular-nums text-indigo-600 dark:text-indigo-400 mt-0.5">
                {stats.turnarounds}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Control Toolbar */}
      <div className="card p-3 border hairline space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 muted-text" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by company name, symbol, or sector..."
              className="w-full pl-9 pr-8 py-1.5 text-[13px] rounded-md border hairline bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-600)]"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Sort selector */}
            <div className="inline-flex items-center gap-1.5 text-[12px] muted-text">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="px-2 py-1 rounded border hairline bg-[var(--color-paper)] text-[12px] font-medium focus:outline-none"
              >
                <option value="date_desc">Sort: Declaration Date (Newest)</option>
                <option value="np_growth_desc">Sort: Profit Growth (YoY %)</option>
                <option value="sales_growth_desc">Sort: Revenue Growth (YoY %)</option>
                <option value="margin_desc">Sort: Highest Margin (OPM %)</option>
                <option value="mcap_desc">Sort: Market Cap (Cr)</option>
              </select>
            </div>

            {/* View Mode Toggle */}
            <div className="inline-flex items-center rounded-md border hairline p-0.5 bg-[var(--color-paper)]">
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                  viewMode === "table"
                    ? "bg-[var(--color-accent-600)] text-white"
                    : "muted-text hover:text-[var(--color-ink)]"
                }`}
              >
                <TableIcon className="w-3 h-3" />
                <span>Table</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                  viewMode === "grid"
                    ? "bg-[var(--color-accent-600)] text-white"
                    : "muted-text hover:text-[var(--color-ink)]"
                }`}
              >
                <LayoutGrid className="w-3 h-3" />
                <span>Cards</span>
              </button>
            </div>
          </div>
        </div>

        {/* Quick Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t hairline">
          {[
            { key: "all", label: "All Results", count: results.length },
            { key: "beats", label: "🚀 Profit Beats (>20% YoY)", count: stats.beats },
            { key: "double_digit", label: "⚡ Double-Digit (Sales & PAT >10%)" },
            { key: "high_margin", label: "💎 High Margin (OPM >25%)" },
            { key: "turnarounds", label: "🔄 Turnarounds (Loss to Profit)", count: stats.turnarounds },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setQuickFilter(f.key as QuickFilter);
                setPage(1);
              }}
              className={`px-2.5 py-1 rounded-full text-[12px] font-medium transition-colors border hairline ${
                quickFilter === f.key
                  ? "bg-[var(--color-ink)] text-[var(--color-paper)] border-transparent"
                  : "bg-transparent muted-text hover:text-[var(--color-ink)] hover:bg-[var(--color-paper)]"
              }`}
            >
              {f.label}
              {f.count != null && <span className="ml-1 opacity-70 tabular-nums">({f.count})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Main Results View */}
      {paginated.length === 0 ? (
        <div className="card p-12 text-center border hairline space-y-2">
          <FileText className="w-10 h-10 mx-auto muted-text opacity-40" />
          <h3 className="text-[15px] font-semibold">No declared results matched</h3>
          <p className="muted-text text-[13px] max-w-md mx-auto">
            Try adjusting your search query or selecting a different filter chip above.
          </p>
        </div>
      ) : viewMode === "table" ? (
        /* TABLE VIEW */
        <div className="card overflow-x-auto border hairline">
          <table className="w-full text-left text-[12.5px] border-collapse">
            <thead>
              <tr className="border-b hairline bg-[var(--color-paper)] text-[11px] uppercase tracking-wider muted-text">
                <th className="py-2.5 px-3 font-semibold">Declared Date</th>
                <th className="py-2.5 px-3 font-semibold">Company / Sector</th>
                <th className="py-2.5 px-3 font-semibold">Quarter Ended</th>
                <th className="py-2.5 px-3 font-semibold text-right">Revenue (Sales)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Net Profit (PAT)</th>
                <th className="py-2.5 px-3 font-semibold text-right">OPM %</th>
                <th className="py-2.5 px-3 font-semibold text-right">CMP & Day %</th>
                <th className="py-2.5 px-3 font-semibold text-center">Score</th>
                <th className="py-2.5 px-3 font-semibold text-center">Filing</th>
              </tr>
            </thead>
            <tbody className="divide-y hairline">
              {paginated.map((r) => {
                const decDate = formatDeclarationDate(r.declaration_date);
                const salesYoy = fmtPct(r.sales_yoy);
                const npYoy = fmtPct(r.np_yoy);
                const dayMove = fmtPct(r.change_p);

                return (
                  <tr key={`${r.symbol}-${r.period_end}`} className="hover:bg-[var(--color-paper)] transition-colors">
                    {/* Declaration Date */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-medium tabular-nums">{decDate.label}</div>
                      {decDate.badge && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
                          {decDate.badge}
                        </span>
                      )}
                    </td>

                    {/* Company / Sector */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/stock/${r.symbol}`}
                          className="font-bold text-[13px] hover:underline text-[var(--color-ink)]"
                        >
                          {r.symbol}
                        </Link>
                        {r.market_cap_category && (
                          <CapTierBadge category={r.market_cap_category as CapCategory} />
                        )}
                      </div>
                      <div className="text-[11.5px] muted-text truncate max-w-[200px]" title={r.company_name}>
                        {r.company_name}
                      </div>
                      <div className="text-[10.5px] opacity-75 truncate max-w-[200px]">
                        {r.sector} · {r.industry}
                      </div>
                    </td>

                    {/* Quarter Ended */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-medium text-[12px]">{formatQuarter(r.period_end)}</div>
                      <div className="text-[10.5px] muted-text tabular-nums">{r.period_end}</div>
                    </td>

                    {/* Revenue & YoY */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap tabular-nums">
                      <div className="font-semibold text-[13px]">{fmtCr(r.curr_sales)}</div>
                      {r.sales_yoy != null && (
                        <div
                          className={`text-[11px] font-medium ${
                            salesYoy.isPositive ? "text-emerald-600 dark:text-emerald-400" : salesYoy.isNegative ? "text-red-600 dark:text-red-400" : "muted-text"
                          }`}
                        >
                          {salesYoy.text} YoY
                        </div>
                      )}
                    </td>

                    {/* Net Profit & YoY */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap tabular-nums">
                      <div className="font-semibold text-[13px]">{fmtCr(r.curr_np)}</div>
                      {r.np_yoy != null && (
                        <div
                          className={`text-[11px] font-medium ${
                            npYoy.isPositive ? "text-emerald-600 dark:text-emerald-400" : npYoy.isNegative ? "text-red-600 dark:text-red-400" : "muted-text"
                          }`}
                        >
                          {npYoy.text} {r.np_yoy !== 999.0 && "YoY"}
                        </div>
                      )}
                    </td>

                    {/* OPM % */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap tabular-nums">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[11.5px] font-semibold ${
                          (r.opm_pct ?? 0) >= 20
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : (r.opm_pct ?? 0) >= 10
                            ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        }`}
                      >
                        {r.opm_pct != null ? `${r.opm_pct.toFixed(1)}%` : "—"}
                      </span>
                    </td>

                    {/* CMP & Day % */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap tabular-nums">
                      <div className="font-medium text-[12.5px]">{fmtMoney(r.ltp)}</div>
                      {r.change_p != null && (
                        <div
                          className={`text-[11px] ${
                            dayMove.isPositive ? "text-emerald-600 dark:text-emerald-400" : dayMove.isNegative ? "text-red-600 dark:text-red-400" : "muted-text"
                          }`}
                        >
                          {dayMove.text}
                        </div>
                      )}
                    </td>

                    {/* Composite Score */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {r.composite_pct != null ? (
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-bold tabular-nums ${
                            r.composite_pct >= 70
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : r.composite_pct >= 50
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {r.composite_pct}
                        </span>
                      ) : (
                        <span className="muted-text">—</span>
                      )}
                    </td>

                    {/* PDF Filing */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {r.pdf_url ? (
                        <a
                          href={r.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 hover:bg-indigo-100 transition-colors"
                          title={r.filing_title || "Official Exchange Filing PDF"}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>PDF</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                        </a>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Enclosed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* CARDS GRID VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {paginated.map((r) => {
            const decDate = formatDeclarationDate(r.declaration_date);
            const salesYoy = fmtPct(r.sales_yoy);
            const npYoy = fmtPct(r.np_yoy);
            const dayMove = fmtPct(r.change_p);

            return (
              <div
                key={`${r.symbol}-${r.period_end}`}
                className="card p-4 border hairline hover:border-[var(--color-accent-500)] transition-colors flex flex-col justify-between space-y-3"
              >
                <div>
                  {/* Top Bar: Declared Date + Quarter */}
                  <div className="flex items-center justify-between text-[11px] pb-2 border-b hairline">
                    <div className="inline-flex items-center gap-1.5 font-medium tabular-nums muted-text">
                      <Calendar className="w-3 h-3" />
                      <span>{decDate.label}</span>
                      {decDate.badge && (
                        <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
                          {decDate.badge}
                        </span>
                      )}
                    </div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {formatQuarter(r.period_end)}
                    </span>
                  </div>

                  {/* Company Header */}
                  <div className="flex items-start justify-between gap-2 mt-2.5">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/stock/${r.symbol}`}
                          className="font-bold text-[15px] hover:underline text-[var(--color-ink)]"
                        >
                          {r.symbol}
                        </Link>
                        {r.market_cap_category && (
                          <CapTierBadge category={r.market_cap_category as CapCategory} />
                        )}
                      </div>
                      <div className="text-[12px] muted-text font-medium truncate max-w-[220px]" title={r.company_name}>
                        {r.company_name}
                      </div>
                      <div className="text-[11px] opacity-75 truncate max-w-[220px]">
                        {r.sector} · {r.industry}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-[14px] font-bold tabular-nums">{fmtMoney(r.ltp)}</div>
                      {r.change_p != null && (
                        <div
                          className={`text-[11px] font-medium tabular-nums ${
                            dayMove.isPositive ? "text-emerald-600 dark:text-emerald-400" : dayMove.isNegative ? "text-red-600 dark:text-red-400" : "muted-text"
                          }`}
                        >
                          {dayMove.text}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Financial Metrics Box */}
                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-[var(--color-paper)] border hairline mt-3 text-center">
                    <div>
                      <div className="text-[10px] uppercase font-medium muted-text">Revenue</div>
                      <div className="text-[12.5px] font-bold tabular-nums mt-0.5">{fmtCr(r.curr_sales)}</div>
                      {r.sales_yoy != null && (
                        <div
                          className={`text-[10px] font-semibold ${
                            salesYoy.isPositive ? "text-emerald-600 dark:text-emerald-400" : salesYoy.isNegative ? "text-red-600 dark:text-red-400" : "muted-text"
                          }`}
                        >
                          {salesYoy.text}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-[10px] uppercase font-medium muted-text">Net Profit</div>
                      <div className="text-[12.5px] font-bold tabular-nums mt-0.5">{fmtCr(r.curr_np)}</div>
                      {r.np_yoy != null && (
                        <div
                          className={`text-[10px] font-semibold ${
                            npYoy.isPositive ? "text-emerald-600 dark:text-emerald-400" : npYoy.isNegative ? "text-red-600 dark:text-red-400" : "muted-text"
                          }`}
                        >
                          {npYoy.text}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-[10px] uppercase font-medium muted-text">OPM %</div>
                      <div className="text-[12.5px] font-bold tabular-nums mt-0.5">
                        {r.opm_pct != null ? `${r.opm_pct.toFixed(1)}%` : "—"}
                      </div>
                      <div className="text-[10px] muted-text font-medium">Margin</div>
                    </div>
                  </div>
                </div>

                {/* Footer: Composite Score & Filing PDF */}
                <div className="flex items-center justify-between pt-2 border-t hairline text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="muted-text">Score:</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold ${
                        (r.composite_pct ?? 0) >= 70
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : (r.composite_pct ?? 0) >= 50
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      }`}
                    >
                      {r.composite_pct ?? "—"}/100
                    </span>
                  </div>

                  {r.pdf_url ? (
                    <a
                      href={r.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11.5px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 hover:bg-indigo-100 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Filing PDF</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  ) : (
                    <Link
                      href={`/stock/${r.symbol}`}
                      className="text-[11.5px] font-medium hover:underline text-[var(--color-accent-600)]"
                    >
                      View Details →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Load More */}
      {paginated.length < filtered.length && (
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            className="px-4 py-2 rounded-md font-medium text-[13px] border hairline bg-[var(--color-paper)] hover:bg-[var(--color-accent-600)] hover:text-white transition-colors"
          >
            Load More Results ({filtered.length - paginated.length} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
