"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  FileText,
  Calendar,
  Sparkles,
  Building2,
  Table as TableIcon,
  LayoutGrid,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Percent,
  CheckCircle2,
  X,
  Clock,
  Briefcase,
  Layers,
} from "lucide-react";
import CapTierBadge, { type CapCategory } from "@/components/CapTierBadge";
import { WatchlistButton } from "@/components/WatchlistButton";
import { band, bandColor } from "@/lib/score";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResultsCalendarEvent = {
  symbol: string;
  company_name: string;
  sector: string;
  industry: string;
  market_cap_category: string | null;
  meeting_date: string; // YYYY-MM-DD
  agenda: string;
  pdf_url: string | null;
  ltp: number | null;
  market_cap_cr: number | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  pe: number | null;
  last_period: string | null;
  last_sales: number | null;
  last_np: number | null;
  sales_yoy: number | null;
  np_yoy: number | null;
  opm_pct: number | null;
};

export type DeclaredResult = {
  symbol: string;
  company_name: string;
  sector: string;
  industry: string;
  market_cap_category: string | null;
  ltp: number;
  market_cap_cr: number;
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

type ViewSection = "calendar" | "declared";
type CalendarDateFilter = "all" | "today" | "tomorrow" | "next7" | "past7" | "past30";
type CalendarPurposeFilter = "all" | "results" | "dividends";
type CalendarSort = "date_asc" | "date_desc" | "mcap_desc" | "score_desc" | "np_desc" | "sales_desc";

type DeclaredFilter = "all" | "beats" | "double_digit" | "high_margin" | "turnarounds";
type DeclaredSort = "date_desc" | "np_growth_desc" | "sales_growth_desc" | "margin_desc" | "mcap_desc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  if (v === 999.0) return { text: "Turnaround", isPositive: true, isNegative: false };
  const s = sign && v > 0 ? "+" : "";
  return {
    text: `${s}${v.toFixed(1)}%`,
    isPositive: v > 0,
    isNegative: v < 0,
  };
}

function formatQuarter(periodEnd: string | null | undefined): string {
  if (!periodEnd) return "—";
  try {
    const d = new Date(periodEnd);
    const month = d.getMonth() + 1; // 1-12
    const year = d.getFullYear();
    const shortYear = String(year).slice(-2);
    if (month >= 1 && month <= 3) return `Q4 FY${shortYear}`;
    if (month >= 4 && month <= 6) return `Q1 FY${Number(shortYear) + 1}`;
    if (month >= 7 && month <= 9) return `Q2 FY${Number(shortYear) + 1}`;
    return `Q3 FY${Number(shortYear) + 1}`;
  } catch {
    return periodEnd;
  }
}

function formatMeetingDate(dateStr: string): { label: string; badge?: string; badgeColor?: string; diffDays: number } {
  if (!dateStr) return { label: "—", diffDays: 0 };
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(dateStr + "T00:00:00");
    const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
    const label = d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    let badge: string | undefined;
    let badgeColor: string | undefined;
    if (diffDays === 0) {
      badge = "Today";
      badgeColor = "var(--color-score-good)";
    } else if (diffDays === 1) {
      badge = "Tomorrow";
      badgeColor = "var(--color-accent-600)";
    } else if (diffDays > 1 && diffDays <= 7) {
      badge = `in ${diffDays}d`;
      badgeColor = "var(--color-accent-500)";
    } else if (diffDays === -1) {
      badge = "Yesterday";
      badgeColor = "var(--color-muted)";
    } else if (diffDays < -1 && diffDays >= -7) {
      badge = `${Math.abs(diffDays)}d ago`;
      badgeColor = "var(--color-muted)";
    }
    return { label, badge, badgeColor, diffDays };
  } catch {
    return { label: dateStr, diffDays: 0 };
  }
}

function cleanAgenda(raw: string): string {
  if (!raw) return "Board Meeting";
  let s = raw.trim();
  // Strip common BSE filing announcement prefixes
  s = s.replace(/^Board Meeting Intimation for\s+/i, "");
  s = s.replace(/^Outcome of Board Meeting held on [^,]+,?\s*/i, "");
  s = s.replace(/^[A-Za-z0-9\s.&]+has informed BSE that the meeting of the Board of Directors of the Company is scheduled on [^,]+,?\s*(?:inter alia,?\s*)?(?:to consider and approve\s*)?/i, "");
  s = s.replace(/^Intimation of Board Meeting for\s+/i, "");
  s = s.replace(/^Board Meeting Outcome for\s+/i, "");
  s = s.replace(/^Consideration and Approval of\s+/i, "");
  s = s.replace(/^Considering and Approving\s+/i, "");
  s = s.replace(/^To consider and approve\s+/i, "");
  if (!s || s.length < 3) return raw.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ResultsCornerClient({
  calendarEvents,
  declaredResults,
}: {
  calendarEvents: ResultsCalendarEvent[];
  declaredResults: DeclaredResult[];
}) {
  const [section, setSection] = useState<ViewSection>("calendar");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [search, setSearch] = useState("");

  // Calendar tab filters
  const [dateFilter, setDateFilter] = useState<CalendarDateFilter>("all");
  const [purposeFilter, setPurposeFilter] = useState<CalendarPurposeFilter>("all");
  const [calendarSort, setCalendarSort] = useState<CalendarSort>("date_desc");

  // Declared tab filters
  const [declaredFilter, setDeclaredFilter] = useState<DeclaredFilter>("all");
  const [declaredSort, setDeclaredSort] = useState<DeclaredSort>("date_desc");

  // -------------------------------------------------------------------------
  // Filtering & Sorting for Results Calendar
  // -------------------------------------------------------------------------

  const filteredCalendar = useMemo(() => {
    return calendarEvents
      .filter((ev) => {
        // Search text
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          const matchSym = ev.symbol.toLowerCase().includes(q);
          const matchName = ev.company_name.toLowerCase().includes(q);
          const matchSector = ev.sector.toLowerCase().includes(q);
          const matchAgenda = ev.agenda.toLowerCase().includes(q);
          if (!matchSym && !matchName && !matchSector && !matchAgenda) return false;
        }

        // Date filter
        const { diffDays } = formatMeetingDate(ev.meeting_date);
        if (dateFilter === "today" && diffDays !== 0) return false;
        if (dateFilter === "tomorrow" && diffDays !== 1) return false;
        if (dateFilter === "next7" && (diffDays < 0 || diffDays > 7)) return false;
        if (dateFilter === "past7" && (diffDays > 0 || diffDays < -7)) return false;
        if (dateFilter === "past30" && (diffDays > 0 || diffDays < -30)) return false;

        // Purpose filter
        const agLower = ev.agenda.toLowerCase();
        if (purposeFilter === "results") {
          const isResult = agLower.includes("result") || agLower.includes("financial") || agLower.includes("quarter");
          if (!isResult) return false;
        }
        if (purposeFilter === "dividends") {
          if (!agLower.includes("dividend")) return false;
        }

        return true;
      })
      .sort((a, b) => {
        switch (calendarSort) {
          case "date_asc":
            return a.meeting_date.localeCompare(b.meeting_date);
          case "date_desc":
            return b.meeting_date.localeCompare(a.meeting_date);
          case "mcap_desc":
            return (b.market_cap_cr ?? 0) - (a.market_cap_cr ?? 0);
          case "score_desc":
            return (b.composite_pct ?? 0) - (a.composite_pct ?? 0);
          case "np_desc":
            return (b.np_yoy ?? -9999) - (a.np_yoy ?? -9999);
          case "sales_desc":
            return (b.sales_yoy ?? -9999) - (a.sales_yoy ?? -9999);
          default:
            return b.meeting_date.localeCompare(a.meeting_date);
        }
      });
  }, [calendarEvents, search, dateFilter, purposeFilter, calendarSort]);

  // Calendar stats
  const calendarStats = useMemo(() => {
    let today = 0;
    let next7 = 0;
    let resultsOnly = 0;
    for (const ev of calendarEvents) {
      const { diffDays } = formatMeetingDate(ev.meeting_date);
      if (diffDays === 0) today++;
      if (diffDays >= 0 && diffDays <= 7) next7++;
      const ag = ev.agenda.toLowerCase();
      if (ag.includes("result") || ag.includes("financial")) resultsOnly++;
    }
    return { today, next7, resultsOnly, total: calendarEvents.length };
  }, [calendarEvents]);

  // -------------------------------------------------------------------------
  // Filtering & Sorting for Declared Results
  // -------------------------------------------------------------------------

  const filteredDeclared = useMemo(() => {
    return declaredResults
      .filter((r) => {
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          const matchSym = r.symbol.toLowerCase().includes(q);
          const matchName = r.company_name.toLowerCase().includes(q);
          const matchSector = r.sector.toLowerCase().includes(q);
          const matchInd = r.industry.toLowerCase().includes(q);
          if (!matchSym && !matchName && !matchSector && !matchInd) return false;
        }

        switch (declaredFilter) {
          case "beats":
            return r.np_yoy != null && r.np_yoy >= 20;
          case "double_digit":
            return (
              r.sales_yoy != null &&
              r.sales_yoy >= 10 &&
              r.np_yoy != null &&
              (r.np_yoy >= 10 || r.np_yoy === 999.0)
            );
          case "high_margin":
            return r.opm_pct != null && r.opm_pct >= 25;
          case "turnarounds":
            return r.np_yoy === 999.0 || (r.yago_np != null && r.yago_np <= 0 && (r.curr_np ?? 0) > 0);
          default:
            return true;
        }
      })
      .sort((a, b) => {
        switch (declaredSort) {
          case "date_desc":
            return b.declaration_date.localeCompare(a.declaration_date);
          case "np_growth_desc":
            return (b.np_yoy ?? -9999) - (a.np_yoy ?? -9999);
          case "sales_growth_desc":
            return (b.sales_yoy ?? -9999) - (a.sales_yoy ?? -9999);
          case "margin_desc":
            return (b.opm_pct ?? -9999) - (a.opm_pct ?? -9999);
          case "mcap_desc":
            return b.market_cap_cr - a.market_cap_cr;
          default:
            return 0;
        }
      });
  }, [declaredResults, search, declaredFilter, declaredSort]);

  return (
    <div className="space-y-6">
      {/* ── Top Header & Mode Switcher ────────────────────────────────────── */}
      <div className="card p-5 border hairline">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--color-accent-50)] text-[var(--color-accent-700)] border border-[var(--color-accent-200)] mb-1.5">
              <Sparkles size={11} strokeWidth={2.5} />
              Corporate Actions &amp; Earnings Tracker
            </div>
            <h1 className="font-display text-[22px] sm:text-[25px] font-semibold tracking-tight text-[var(--color-ink)]">
              Results Corner
            </h1>
            <p className="text-[13px] muted-text mt-1 max-w-2xl leading-relaxed">
              Announcement of results dates, scheduled corporate board meetings &amp; quarterly financial performance track record for NSE stocks.
            </p>
          </div>

          {/* Segmented Switcher */}
          <div className="inline-flex p-1 rounded-lg bg-[var(--color-paper)] border hairline shrink-0 self-start lg:self-center">
            <button
              type="button"
              onClick={() => { setSection("calendar"); setSearch(""); }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-all ${
                section === "calendar"
                  ? "bg-[var(--color-card)] text-[var(--color-accent-700)] shadow-sm font-semibold"
                  : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              <Calendar size={14} strokeWidth={2.2} />
              Results Calendar
              <span className={`text-[11px] px-1.5 py-0.2 rounded-full tabular-nums ${
                section === "calendar" ? "bg-[var(--color-accent-100)] text-[var(--color-accent-800)]" : "bg-[var(--color-card)]"
              }`}>
                {calendarEvents.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => { setSection("declared"); setSearch(""); }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-all ${
                section === "declared"
                  ? "bg-[var(--color-card)] text-[var(--color-accent-700)] shadow-sm font-semibold"
                  : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              <FileText size={14} strokeWidth={2.2} />
              Declared Results
              <span className={`text-[11px] px-1.5 py-0.2 rounded-full tabular-nums ${
                section === "declared" ? "bg-[var(--color-accent-100)] text-[var(--color-accent-800)]" : "bg-[var(--color-card)]"
              }`}>
                {declaredResults.length}
              </span>
            </button>
          </div>
        </div>

        {/* Quick Highlights Bar */}
        {section === "calendar" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t hairline">
            <div className="px-3 py-2 rounded-md bg-[var(--color-paper)]/70">
              <div className="text-[11px] font-medium muted-text uppercase tracking-wider">Scheduled Today</div>
              <div className="text-[17px] font-semibold tabular-nums text-[var(--color-ink)] mt-0.5">
                {calendarStats.today} <span className="text-[11.5px] font-normal muted-text">meetings</span>
              </div>
            </div>
            <div className="px-3 py-2 rounded-md bg-[var(--color-paper)]/70">
              <div className="text-[11px] font-medium muted-text uppercase tracking-wider">Next 7 Days</div>
              <div className="text-[17px] font-semibold tabular-nums text-[var(--color-ink)] mt-0.5">
                {calendarStats.next7} <span className="text-[11.5px] font-normal muted-text">companies</span>
              </div>
            </div>
            <div className="px-3 py-2 rounded-md bg-[var(--color-paper)]/70">
              <div className="text-[11px] font-medium muted-text uppercase tracking-wider">Quarterly Results</div>
              <div className="text-[17px] font-semibold tabular-nums text-[var(--color-ink)] mt-0.5">
                {calendarStats.resultsOnly} <span className="text-[11.5px] font-normal muted-text">notices</span>
              </div>
            </div>
            <div className="px-3 py-2 rounded-md bg-[var(--color-paper)]/70">
              <div className="text-[11px] font-medium muted-text uppercase tracking-wider">Tracking Window</div>
              <div className="text-[17px] font-semibold tabular-nums text-[var(--color-ink)] mt-0.5">
                ±60 Days <span className="text-[11.5px] font-normal muted-text">calendar</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Toolbar: Search, Filters & View Toggle ───────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative flex-1 max-w-md">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 muted-text pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                section === "calendar"
                  ? "Search symbol, company, sector, agenda..."
                  : "Search symbol, company, industry..."
              }
              className="w-full pl-9 pr-8 py-2 rounded-lg border hairline bg-[var(--color-card)] text-[13px] ink-text focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-600)] transition"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs muted-text hover:text-[var(--color-ink)]"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Sort & View Mode */}
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            {section === "calendar" ? (
              <select
                value={calendarSort}
                onChange={(e) => setCalendarSort(e.target.value as CalendarSort)}
                className="px-3 py-2 rounded-lg border hairline bg-[var(--color-card)] text-[12.5px] font-medium text-[var(--color-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-600)]"
              >
                <option value="date_asc">Meeting Date: Upcoming First</option>
                <option value="date_desc">Meeting Date: Newest First</option>
                <option value="mcap_desc">Market Cap: High to Low</option>
                <option value="score_desc">Composite Score: High to Low</option>
                <option value="np_desc">Last PAT YoY %: Highest</option>
                <option value="sales_desc">Last Sales YoY %: Highest</option>
              </select>
            ) : (
              <select
                value={declaredSort}
                onChange={(e) => setDeclaredSort(e.target.value as DeclaredSort)}
                className="px-3 py-2 rounded-lg border hairline bg-[var(--color-card)] text-[12.5px] font-medium text-[var(--color-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-600)]"
              >
                <option value="date_desc">Filing Date: Newest First</option>
                <option value="np_growth_desc">Profit Growth YoY %</option>
                <option value="sales_growth_desc">Revenue Growth YoY %</option>
                <option value="margin_desc">Operating Margin (OPM %)</option>
                <option value="mcap_desc">Market Cap: High to Low</option>
              </select>
            )}

            <div className="flex items-center rounded-lg border hairline p-0.5 bg-[var(--color-paper)]">
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded ${
                  viewMode === "table"
                    ? "bg-[var(--color-card)] text-[var(--color-accent-600)] shadow-xs"
                    : "muted-text hover:text-[var(--color-ink)]"
                }`}
                title="Dense Table View"
              >
                <TableIcon size={16} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                className={`p-1.5 rounded ${
                  viewMode === "cards"
                    ? "bg-[var(--color-card)] text-[var(--color-accent-600)] shadow-xs"
                    : "muted-text hover:text-[var(--color-ink)]"
                }`}
                title="Cards Grid View"
              >
                <LayoutGrid size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Sub-Filters */}
        {section === "calendar" ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11.5px] uppercase tracking-wider font-semibold muted-text mr-1">
              Date:
            </span>
            <FilterPill
              label="All Meetings"
              active={dateFilter === "all"}
              onClick={() => setDateFilter("all")}
            />
            <FilterPill
              label={`Today (${calendarStats.today})`}
              active={dateFilter === "today"}
              onClick={() => setDateFilter("today")}
              highlight={calendarStats.today > 0}
            />
            <FilterPill
              label="Tomorrow"
              active={dateFilter === "tomorrow"}
              onClick={() => setDateFilter("tomorrow")}
            />
            <FilterPill
              label={`Next 7 Days (${calendarStats.next7})`}
              active={dateFilter === "next7"}
              onClick={() => setDateFilter("next7")}
            />
            <FilterPill
              label="Past 7 Days"
              active={dateFilter === "past7"}
              onClick={() => setDateFilter("past7")}
            />
            <FilterPill
              label="Past 30 Days"
              active={dateFilter === "past30"}
              onClick={() => setDateFilter("past30")}
            />

            <span className="text-[11.5px] uppercase tracking-wider font-semibold muted-text ml-2 mr-1">
              Agenda:
            </span>
            <FilterPill
              label="All Agendas"
              active={purposeFilter === "all"}
              onClick={() => setPurposeFilter("all")}
            />
            <FilterPill
              label="Quarterly Results"
              active={purposeFilter === "results"}
              onClick={() => setPurposeFilter("results")}
            />
            <FilterPill
              label="Dividends"
              active={purposeFilter === "dividends"}
              onClick={() => setPurposeFilter("dividends")}
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11.5px] uppercase tracking-wider font-semibold muted-text mr-1">
              Filter:
            </span>
            <FilterPill
              label="All Declared"
              active={declaredFilter === "all"}
              onClick={() => setDeclaredFilter("all")}
            />
            <FilterPill
              label="🚀 Profit Beats (>20% YoY)"
              active={declaredFilter === "beats"}
              onClick={() => setDeclaredFilter("beats")}
            />
            <FilterPill
              label="⚡ Double-Digit (Sales & PAT >10%)"
              active={declaredFilter === "double_digit"}
              onClick={() => setDeclaredFilter("double_digit")}
            />
            <FilterPill
              label="💎 High Margin (OPM >25%)"
              active={declaredFilter === "high_margin"}
              onClick={() => setDeclaredFilter("high_margin")}
            />
            <FilterPill
              label="🔄 Turnarounds (Loss to Profit)"
              active={declaredFilter === "turnarounds"}
              onClick={() => setDeclaredFilter("turnarounds")}
            />
          </div>
        )}
      </div>

      {/* ── Content View ─────────────────────────────────────────────────── */}
      {section === "calendar" ? (
        <CalendarView
          events={filteredCalendar}
          viewMode={viewMode}
          hasSearch={Boolean(search)}
        />
      ) : (
        <DeclaredView
          results={filteredDeclared}
          viewMode={viewMode}
          hasSearch={Boolean(search)}
        />
      )}
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
  highlight = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${
        active
          ? "bg-[var(--color-accent-600)] text-white font-semibold"
          : highlight
          ? "bg-[var(--color-accent-100)] text-[var(--color-accent-800)] border border-[var(--color-accent-300)] hover:bg-[var(--color-accent-200)]"
          : "bg-[var(--color-paper)] text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-paper)]/80 border hairline"
      }`}
    >
      {label}
    </button>
  );
}

// ===========================================================================
// SECTION 1: Results Calendar (Board Meetings & Stock Performance)
// ===========================================================================

function CalendarView({
  events,
  viewMode,
  hasSearch,
}: {
  events: ResultsCalendarEvent[];
  viewMode: "table" | "cards";
  hasSearch: boolean;
}) {
  if (events.length === 0) {
    return (
      <div className="card p-12 text-center border hairline">
        <Calendar size={32} className="mx-auto text-[var(--color-muted)] opacity-50 mb-3" />
        <div className="text-[15px] font-medium text-[var(--color-ink)]">
          No scheduled results or board meetings found
        </div>
        <p className="text-[12.5px] muted-text max-w-md mx-auto mt-1">
          {hasSearch
            ? "Try clearing your search query or broadening your date and agenda filters."
            : "No board meeting dates announced within the selected date window for this universe tier."}
        </p>
      </div>
    );
  }

  if (viewMode === "table") {
    return (
      <div className="card overflow-hidden border hairline">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b hairline bg-[var(--color-paper)]/80 text-[11px] uppercase tracking-wider font-semibold muted-text">
                <th className="py-3 px-4">Meeting Date</th>
                <th className="py-3 px-4">Stock &amp; Sector</th>
                <th className="py-3 px-4">Agenda / Purpose</th>
                <th className="py-3 px-4 text-right">CMP &amp; Cap</th>
                <th className="py-3 px-4 text-center">Score</th>
                <th className="py-3 px-4 text-right">Last Quarter Performance</th>
                <th className="py-3 px-4 text-center">Watch</th>
              </tr>
            </thead>
            <tbody className="divide-y hairline">
              {events.map((ev) => {
                const { label: dateLabel, badge: dateBadge, badgeColor } = formatMeetingDate(ev.meeting_date);
                const qLabel = formatQuarter(ev.last_period);
                const salesGrow = fmtPct(ev.sales_yoy);
                const npGrow = fmtPct(ev.np_yoy);
                const agendaText = cleanAgenda(ev.agenda);

                return (
                  <tr
                    key={`${ev.symbol}-${ev.meeting_date}`}
                    className="hover:bg-[var(--color-paper)]/50 transition-colors group"
                  >
                    {/* Meeting Date */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-semibold text-[13px] text-[var(--color-ink)] tabular-nums">
                        {dateLabel}
                      </div>
                      {dateBadge && (
                        <span
                          className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded"
                          style={{
                            background: `color-mix(in srgb, ${badgeColor || "var(--color-accent-600)"} 15%, transparent)`,
                            color: badgeColor || "var(--color-accent-600)",
                          }}
                        >
                          {dateBadge}
                        </span>
                      )}
                    </td>

                    {/* Stock Identity */}
                    <td className="py-3.5 px-4 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/stock/${ev.symbol}`}
                          className="font-bold text-[13.5px] hover:text-[var(--color-accent-600)] transition-colors inline-flex items-center gap-1 text-[var(--color-ink)]"
                        >
                          {ev.symbol}
                          <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                        {ev.market_cap_category && (
                          <CapTierBadge category={ev.market_cap_category as CapCategory} />
                        )}
                      </div>
                      <div className="text-[11.5px] muted-text truncate max-w-[220px]">
                        {ev.company_name}
                      </div>
                      <div className="text-[10.5px] muted-text/80 truncate mt-0.5">
                        {ev.sector}
                      </div>
                    </td>

                    {/* Meeting Agenda & PDF Intimation */}
                    <td className="py-3.5 px-4 max-w-[280px]">
                      <div
                        className="text-[12px] text-[var(--color-ink)] line-clamp-2 leading-snug font-medium"
                        title={ev.agenda}
                      >
                        {agendaText}
                      </div>
                      {ev.pdf_url && (
                        <a
                          href={ev.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-1 text-[11px] font-medium text-[var(--color-accent-600)] hover:underline"
                        >
                          <FileText size={11} />
                          BSE Notice (PDF)
                          <ExternalLink size={10} />
                        </a>
                      )}
                    </td>

                    {/* CMP & Market Cap */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="font-semibold tabular-nums text-[13px] text-[var(--color-ink)]">
                        {fmtMoney(ev.ltp)}
                      </div>
                      <div className="text-[11px] muted-text tabular-nums">
                        {fmtCr(ev.market_cap_cr)}
                      </div>
                    </td>

                    {/* Composite Score */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      {ev.composite_pct != null ? (
                        <div
                          className="inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-[12px] tabular-nums"
                          style={{
                            background: `color-mix(in srgb, ${bandColor(band(ev.composite_pct))} 16%, transparent)`,
                            color: bandColor(band(ev.composite_pct)),
                          }}
                        >
                          {Math.round(ev.composite_pct)}
                        </div>
                      ) : (
                        <span className="muted-text text-[11px]">—</span>
                      )}
                    </td>

                    {/* Previous Quarter Performance Track Record */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {ev.last_sales != null || ev.last_np != null ? (
                        <div>
                          <div className="text-[10.5px] font-semibold uppercase tracking-wider muted-text">
                            {qLabel}
                          </div>
                          <div className="text-[12px] text-[var(--color-ink)] tabular-nums mt-0.5">
                            Sales: <span className="font-medium">{fmtCr(ev.last_sales)}</span>
                            {ev.sales_yoy != null && (
                              <span
                                className={`ml-1 font-semibold text-[11px] ${
                                  salesGrow.isPositive
                                    ? "text-[var(--color-score-good)]"
                                    : salesGrow.isNegative
                                    ? "text-[var(--color-score-poor)]"
                                    : "muted-text"
                                }`}
                              >
                                ({salesGrow.text})
                              </span>
                            )}
                          </div>
                          <div className="text-[12px] text-[var(--color-ink)] tabular-nums">
                            PAT: <span className="font-medium">{fmtCr(ev.last_np)}</span>
                            {ev.np_yoy != null && (
                              <span
                                className={`ml-1 font-semibold text-[11px] ${
                                  npGrow.isPositive
                                    ? "text-[var(--color-score-good)]"
                                    : npGrow.isNegative
                                    ? "text-[var(--color-score-poor)]"
                                    : "muted-text"
                                }`}
                              >
                                ({npGrow.text})
                              </span>
                            )}
                          </div>
                          {ev.opm_pct != null && (
                            <div className="text-[11px] muted-text tabular-nums mt-0.5">
                              OPM: <span className="font-medium text-[var(--color-ink)]">{ev.opm_pct.toFixed(1)}%</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11.5px] muted-text italic">First track / unavailable</span>
                      )}
                    </td>

                    {/* Watchlist Star */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <WatchlistButton symbol={ev.symbol} variant="icon" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Cards Grid View
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {events.map((ev) => {
        const { label: dateLabel, badge: dateBadge, badgeColor } = formatMeetingDate(ev.meeting_date);
        const qLabel = formatQuarter(ev.last_period);
        const salesGrow = fmtPct(ev.sales_yoy);
        const npGrow = fmtPct(ev.np_yoy);
        const agendaText = cleanAgenda(ev.agenda);

        return (
          <div
            key={`${ev.symbol}-${ev.meeting_date}`}
            className="card p-4 border hairline hover:border-[var(--color-accent-300)] transition-all flex flex-col justify-between"
          >
            {/* Top row: Meeting Date Banner & Watchlist */}
            <div>
              <div className="flex items-center justify-between pb-3 border-b hairline">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-[var(--color-paper)] text-[var(--color-accent-600)]">
                    <Calendar size={14} />
                  </div>
                  <div>
                    <span className="text-[12.5px] font-bold text-[var(--color-ink)] tabular-nums">
                      {dateLabel}
                    </span>
                    {dateBadge && (
                      <span
                        className="ml-2 text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded"
                        style={{
                          background: `color-mix(in srgb, ${badgeColor || "var(--color-accent-600)"} 15%, transparent)`,
                          color: badgeColor || "var(--color-accent-600)",
                        }}
                      >
                        {dateBadge}
                      </span>
                    )}
                  </div>
                </div>
                <WatchlistButton symbol={ev.symbol} variant="icon" />
              </div>

              {/* Stock Title & CMP */}
              <div className="flex items-start justify-between gap-2 mt-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/stock/${ev.symbol}`}
                      className="font-bold text-[15px] hover:text-[var(--color-accent-600)] transition-colors text-[var(--color-ink)]"
                    >
                      {ev.symbol}
                    </Link>
                    {ev.market_cap_category && (
                      <CapTierBadge category={ev.market_cap_category as CapCategory} />
                    )}
                  </div>
                  <div className="text-[12px] muted-text truncate max-w-[210px] mt-0.5">
                    {ev.company_name}
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-bold text-[14px] text-[var(--color-ink)] tabular-nums">
                    {fmtMoney(ev.ltp)}
                  </div>
                  <div className="text-[11px] muted-text tabular-nums">
                    {fmtCr(ev.market_cap_cr)}
                  </div>
                </div>
              </div>

              {/* Meeting Agenda Box */}
              <div className="mt-3 p-2.5 rounded-lg bg-[var(--color-paper)]/70 text-[12px] leading-snug">
                <div className="font-semibold text-[10.5px] uppercase tracking-wider text-[var(--color-accent-700)] mb-0.5 flex items-center gap-1">
                  <Briefcase size={10} />
                  Board Agenda
                </div>
                <div className="text-[var(--color-ink)] font-medium line-clamp-2" title={ev.agenda}>
                  {agendaText}
                </div>
                {ev.pdf_url && (
                  <a
                    href={ev.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold text-[var(--color-accent-600)] hover:underline"
                  >
                    <FileText size={11} />
                    Official BSE Notice
                    <ExternalLink size={10} />
                  </a>
                )}
              </div>

              {/* Previous Performance Grid */}
              <div className="mt-3 pt-3 border-t hairline">
                <div className="text-[10.5px] uppercase tracking-wider font-semibold muted-text mb-2 flex items-center justify-between">
                  <span>Track Record ({qLabel})</span>
                  {ev.composite_pct != null && (
                    <span className="font-bold tabular-nums" style={{ color: bandColor(band(ev.composite_pct)) }}>
                      Score: {Math.round(ev.composite_pct)}/100
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded bg-[var(--color-card)] border hairline">
                    <div className="text-[10px] muted-text uppercase">Sales</div>
                    <div className="text-[11.5px] font-semibold tabular-nums mt-0.5">
                      {fmtCr(ev.last_sales)}
                    </div>
                    <div
                      className={`text-[10.5px] font-bold tabular-nums ${
                        salesGrow.isPositive
                          ? "text-[var(--color-score-good)]"
                          : salesGrow.isNegative
                          ? "text-[var(--color-score-poor)]"
                          : "muted-text"
                      }`}
                    >
                      {salesGrow.text}
                    </div>
                  </div>

                  <div className="p-2 rounded bg-[var(--color-card)] border hairline">
                    <div className="text-[10px] muted-text uppercase">PAT</div>
                    <div className="text-[11.5px] font-semibold tabular-nums mt-0.5">
                      {fmtCr(ev.last_np)}
                    </div>
                    <div
                      className={`text-[10.5px] font-bold tabular-nums ${
                        npGrow.isPositive
                          ? "text-[var(--color-score-good)]"
                          : npGrow.isNegative
                          ? "text-[var(--color-score-poor)]"
                          : "muted-text"
                      }`}
                    >
                      {npGrow.text}
                    </div>
                  </div>

                  <div className="p-2 rounded bg-[var(--color-card)] border hairline">
                    <div className="text-[10px] muted-text uppercase">OPM %</div>
                    <div className="text-[11.5px] font-semibold tabular-nums mt-0.5">
                      {ev.opm_pct != null ? `${ev.opm_pct.toFixed(1)}%` : "—"}
                    </div>
                    <div className="text-[10px] muted-text">Margin</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom link */}
            <div className="mt-3 pt-2">
              <Link
                href={`/stock/${ev.symbol}`}
                className="w-full py-1.5 px-3 rounded-md bg-[var(--color-paper)] hover:bg-[var(--color-accent-50)] text-[var(--color-ink)] hover:text-[var(--color-accent-700)] text-[12px] font-medium flex items-center justify-center gap-1 transition-colors"
              >
                View Full Fundamentals
                <ChevronRight size={13} />
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// SECTION 2: Declared Results (Earnings Reported)
// ===========================================================================

function DeclaredView({
  results,
  viewMode,
  hasSearch,
}: {
  results: DeclaredResult[];
  viewMode: "table" | "cards";
  hasSearch: boolean;
}) {
  if (results.length === 0) {
    return (
      <div className="card p-12 text-center border hairline">
        <FileText size={32} className="mx-auto text-[var(--color-muted)] opacity-50 mb-3" />
        <div className="text-[15px] font-medium text-[var(--color-ink)]">
          No declared results found
        </div>
        <p className="text-[12.5px] muted-text max-w-md mx-auto mt-1">
          {hasSearch
            ? "Try clearing your search query or broadening your filters."
            : "No quarterly results found matching this criteria."}
        </p>
      </div>
    );
  }

  if (viewMode === "table") {
    return (
      <div className="card overflow-hidden border hairline">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b hairline bg-[var(--color-paper)]/80 text-[11px] uppercase tracking-wider font-semibold muted-text">
                <th className="py-3 px-4">Declaration Date</th>
                <th className="py-3 px-4">Stock &amp; Sector</th>
                <th className="py-3 px-4">Quarter Ended</th>
                <th className="py-3 px-4 text-right">Net Sales (₹ Cr)</th>
                <th className="py-3 px-4 text-right">Net Profit (₹ Cr)</th>
                <th className="py-3 px-4 text-right">OPM %</th>
                <th className="py-3 px-4 text-right">CMP &amp; M-Cap</th>
                <th className="py-3 px-4 text-center">Score</th>
                <th className="py-3 px-4 text-center">Filing PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y hairline">
              {results.map((r) => {
                const { label: decDateLabel, badge: decBadge } = formatMeetingDate(r.declaration_date);
                const quarterLabel = formatQuarter(r.period_end);
                const salesGrow = fmtPct(r.sales_yoy);
                const npGrow = fmtPct(r.np_yoy);

                return (
                  <tr
                    key={`${r.symbol}-${r.period_end}`}
                    className="hover:bg-[var(--color-paper)]/50 transition-colors group"
                  >
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-medium text-[13px] tabular-nums text-[var(--color-ink)]">
                        {decDateLabel}
                      </div>
                      {decBadge && (
                        <span className="inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-[var(--color-accent-100)] text-[var(--color-accent-800)]">
                          {decBadge}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/stock/${r.symbol}`}
                          className="font-bold text-[13.5px] hover:text-[var(--color-accent-600)] transition-colors inline-flex items-center gap-1 text-[var(--color-ink)]"
                        >
                          {r.symbol}
                          <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                        {r.market_cap_category && (
                          <CapTierBadge category={r.market_cap_category as CapCategory} />
                        )}
                      </div>
                      <div className="text-[11.5px] muted-text truncate max-w-[220px]">
                        {r.company_name}
                      </div>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-medium text-[12px] px-2 py-0.5 rounded bg-[var(--color-paper)] text-[var(--color-ink)]">
                        {quarterLabel}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="font-semibold tabular-nums text-[13px] text-[var(--color-ink)]">
                        {fmtCr(r.curr_sales)}
                      </div>
                      {r.sales_yoy != null && (
                        <div
                          className={`text-[11px] tabular-nums font-semibold ${
                            salesGrow.isPositive
                              ? "text-[var(--color-score-good)]"
                              : salesGrow.isNegative
                              ? "text-[var(--color-score-poor)]"
                              : "muted-text"
                          }`}
                        >
                          {salesGrow.text} YoY
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="font-semibold tabular-nums text-[13px] text-[var(--color-ink)]">
                        {fmtCr(r.curr_np)}
                      </div>
                      {r.np_yoy != null && (
                        <div
                          className={`text-[11px] tabular-nums font-semibold ${
                            npGrow.isPositive
                              ? "text-[var(--color-score-good)]"
                              : npGrow.isNegative
                              ? "text-[var(--color-score-poor)]"
                              : "muted-text"
                          }`}
                        >
                          {npGrow.text} YoY
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {r.opm_pct != null ? (
                        <span className="font-semibold tabular-nums text-[12.5px] text-[var(--color-ink)]">
                          {r.opm_pct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="muted-text">—</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="font-semibold tabular-nums text-[13px] text-[var(--color-ink)]">
                        {fmtMoney(r.ltp)}
                      </div>
                      <div className="text-[11px] muted-text tabular-nums">
                        {fmtCr(r.market_cap_cr)}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      {r.composite_pct != null ? (
                        <div
                          className="inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-[12px] tabular-nums"
                          style={{
                            background: `color-mix(in srgb, ${bandColor(band(r.composite_pct))} 16%, transparent)`,
                            color: bandColor(band(r.composite_pct)),
                          }}
                        >
                          {Math.round(r.composite_pct)}
                        </div>
                      ) : (
                        <span className="muted-text text-[11px]">—</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      {r.pdf_url ? (
                        <a
                          href={r.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-accent-50)] text-[var(--color-accent-700)] hover:bg-[var(--color-accent-100)] border border-[var(--color-accent-200)] text-[11.5px] font-medium transition-colors"
                          title="Open official BSE financial results attachment"
                        >
                          <FileText size={12} />
                          Filing
                          <ExternalLink size={10} />
                        </a>
                      ) : (
                        <span className="text-[11px] muted-text italic">Reported</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Cards Grid View
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {results.map((r) => {
        const { label: decDateLabel, badge: decBadge } = formatMeetingDate(r.declaration_date);
        const quarterLabel = formatQuarter(r.period_end);
        const salesGrow = fmtPct(r.sales_yoy);
        const npGrow = fmtPct(r.np_yoy);

        return (
          <div
            key={`${r.symbol}-${r.period_end}`}
            className="card p-4 border hairline hover:border-[var(--color-accent-300)] transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between pb-3 border-b hairline">
                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/stock/${r.symbol}`}
                    className="font-bold text-[15px] hover:text-[var(--color-accent-600)] transition-colors text-[var(--color-ink)]"
                  >
                    {r.symbol}
                  </Link>
                  {r.market_cap_category && (
                    <CapTierBadge category={r.market_cap_category as CapCategory} />
                  )}
                </div>
                <WatchlistButton symbol={r.symbol} variant="icon" />
              </div>

              <div className="text-[12px] muted-text truncate mt-1">
                {r.company_name}
              </div>

              <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t hairline">
                <div>
                  <div className="text-[10px] muted-text uppercase font-semibold">Declaration</div>
                  <div className="text-[12px] font-medium tabular-nums text-[var(--color-ink)] mt-0.5">
                    {decDateLabel}
                  </div>
                  {decBadge && (
                    <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-[var(--color-accent-100)] text-[var(--color-accent-800)]">
                      {decBadge}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[10px] muted-text uppercase font-semibold">Quarter</div>
                  <span className="inline-block mt-0.5 text-[11px] font-medium px-2 py-0.5 rounded bg-[var(--color-paper)] text-[var(--color-ink)]">
                    {quarterLabel}
                  </span>
                </div>
              </div>

              {/* 3 Metrics Box */}
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div className="p-2 rounded bg-[var(--color-paper)]/70">
                  <div className="text-[10px] muted-text uppercase">Revenue</div>
                  <div className="text-[12px] font-bold tabular-nums text-[var(--color-ink)] mt-0.5">
                    {fmtCr(r.curr_sales)}
                  </div>
                  <div
                    className={`text-[10.5px] font-semibold tabular-nums ${
                      salesGrow.isPositive
                        ? "text-[var(--color-score-good)]"
                        : salesGrow.isNegative
                        ? "text-[var(--color-score-poor)]"
                        : "muted-text"
                    }`}
                  >
                    {salesGrow.text}
                  </div>
                </div>

                <div className="p-2 rounded bg-[var(--color-paper)]/70">
                  <div className="text-[10px] muted-text uppercase">Net Profit</div>
                  <div className="text-[12px] font-bold tabular-nums text-[var(--color-ink)] mt-0.5">
                    {fmtCr(r.curr_np)}
                  </div>
                  <div
                    className={`text-[10.5px] font-semibold tabular-nums ${
                      npGrow.isPositive
                        ? "text-[var(--color-score-good)]"
                        : npGrow.isNegative
                        ? "text-[var(--color-score-poor)]"
                        : "muted-text"
                    }`}
                  >
                    {npGrow.text}
                  </div>
                </div>

                <div className="p-2 rounded bg-[var(--color-paper)]/70">
                  <div className="text-[10px] muted-text uppercase">OPM %</div>
                  <div className="text-[12px] font-bold tabular-nums text-[var(--color-ink)] mt-0.5">
                    {r.opm_pct != null ? `${r.opm_pct.toFixed(1)}%` : "—"}
                  </div>
                  <div className="text-[10px] muted-text">Margin</div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t hairline flex items-center justify-between">
              <div>
                <span className="text-[13px] font-bold tabular-nums text-[var(--color-ink)]">
                  {fmtMoney(r.ltp)}
                </span>
                <span className="text-[11px] muted-text ml-1 tabular-nums">
                  ({fmtCr(r.market_cap_cr)})
                </span>
              </div>
              {r.pdf_url && (
                <a
                  href={r.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--color-accent-600)] hover:underline"
                >
                  <FileText size={12} />
                  Filing PDF
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
