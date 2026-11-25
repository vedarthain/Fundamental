"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PortfolioDividendReport, HoldingDividend, DividendEvent } from "@/lib/portfolioDividends";

function inr(n: number | null | undefined, dp = 0): string {
  if (n == null || isNaN(n)) return "—";
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function pct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(2) + "%";
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export function PortfolioDividends({ report }: { report: PortfolioDividendReport }) {
  // Goal Calculator state
  const [targetMonthly, setTargetMonthly] = useState<number>(10000);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "payers" | "high_yield">("payers");
  const [sortKey, setSortKey] = useState<"payout" | "yield" | "yoc" | "value">("payout");
  const [simulatedShares, setSimulatedShares] = useState<Record<string, number>>({});
  const [eventsFilter, setEventsFilter] = useState<"all" | "paid" | "upcoming">("all");
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({});
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const [selectedScope, setSelectedScope] = useState<{ year: string | "all"; month?: string; date?: string } | null>(null);

  const allSourceEvents = useMemo(
    () => report.allEvents ?? [...report.upcomingEvents, ...report.recentEvents],
    [report.allEvents, report.upcomingEvents, report.recentEvents],
  );

  const filteredEvents = useMemo(() => {
    if (eventsFilter === "upcoming") return allSourceEvents.filter((e) => e.isUpcoming);
    if (eventsFilter === "paid") return allSourceEvents.filter((e) => !e.isUpcoming);
    return allSourceEvents;
  }, [allSourceEvents, eventsFilter]);

  // Group events into Year -> Month -> Date -> DividendEvent[] (newest first at each level)
  const dividendTree = useMemo(() => {
    type DateBucket = { date: string; label: string; payout: number; events: DividendEvent[] };
    type MonthBucket = { month: string; label: string; payout: number; eventCount: number; dates: DateBucket[] };
    type YearBucket = { year: string; payout: number; eventCount: number; months: MonthBucket[] };

    const yMap = new Map<
      string,
      {
        payout: number;
        eventCount: number;
        mMap: Map<string, { label: string; payout: number; eventCount: number; dMap: Map<string, DateBucket> }>;
      }
    >();

    for (const ev of filteredEvents) {
      const year = ev.exDate.slice(0, 4);
      const month = ev.exDate.slice(0, 7); // YYYY-MM
      const date = ev.exDate.slice(0, 10); // YYYY-MM-DD

      let yEntry = yMap.get(year);
      if (!yEntry) {
        yEntry = { payout: 0, eventCount: 0, mMap: new Map() };
        yMap.set(year, yEntry);
      }
      yEntry.payout += ev.payout;
      yEntry.eventCount += 1;

      let mEntry = yEntry.mMap.get(month);
      if (!mEntry) {
        const [yr, mo] = month.split("-");
        const mLabel = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString("en-IN", {
          month: "short",
          year: "numeric",
        });
        mEntry = { label: mLabel, payout: 0, eventCount: 0, dMap: new Map() };
        yEntry.mMap.set(month, mEntry);
      }
      mEntry.payout += ev.payout;
      mEntry.eventCount += 1;

      let dEntry = mEntry.dMap.get(date);
      if (!dEntry) {
        dEntry = { date, label: shortDate(date), payout: 0, events: [] };
        mEntry.dMap.set(date, dEntry);
      }
      dEntry.payout += ev.payout;
      dEntry.events.push(ev);
    }

    const years: YearBucket[] = [...yMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([year, yv]) => ({
        year,
        payout: yv.payout,
        eventCount: yv.eventCount,
        months: [...yv.mMap.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([month, mv]) => ({
            month,
            label: mv.label,
            payout: mv.payout,
            eventCount: mv.eventCount,
            dates: [...mv.dMap.values()].sort((a, b) => b.date.localeCompare(a.date)),
          })),
      }));

    return years;
  }, [filteredEvents]);

  // Default-open the latest year & latest month (collapsed to latest year-month-date)
  const latestYear = dividendTree[0]?.year;
  const latestMonth = dividendTree[0]?.months[0]?.month;
  const latestDate = dividendTree[0]?.months[0]?.dates[0]?.date;
  const isYearOpen = (y: string) => expandedYears[y] ?? y === latestYear;
  const isMonthOpen = (m: string) => expandedMonths[m] ?? m === latestMonth;

  const activeScope = useMemo(() => {
    if (selectedScope) {
      if (selectedScope.year === "all") return selectedScope;
      if (dividendTree.some((y) => y.year === selectedScope.year)) return selectedScope;
    }
    return latestYear ? { year: latestYear } : { year: "all" as const };
  }, [selectedScope, dividendTree, latestYear]);

  const activeYearBucket = useMemo(
    () => (activeScope.year !== "all" ? dividendTree.find((y) => y.year === activeScope.year) ?? null : null),
    [dividendTree, activeScope.year],
  );

  const tableEvents = useMemo(() => {
    return filteredEvents
      .filter((ev) => {
        if (activeScope.year !== "all" && ev.exDate.slice(0, 4) !== activeScope.year) return false;
        if (activeScope.month && ev.exDate.slice(0, 7) !== activeScope.month) return false;
        if (activeScope.date && ev.exDate !== activeScope.date) return false;
        return true;
      })
      .sort((a, b) => b.exDate.localeCompare(a.exDate));
  }, [filteredEvents, activeScope]);

  const setAllTreeOpen = (open: boolean) => {
    const yNext: Record<string, boolean> = {};
    const mNext: Record<string, boolean> = {};
    for (const y of dividendTree) {
      yNext[y.year] = open;
      for (const m of y.months) {
        mNext[m.month] = open;
      }
    }
    setExpandedYears(yNext);
    setExpandedMonths(mNext);
  };

  // Recalculated holdings considering simulated share counts
  const simulatedHoldings = useMemo(() => {
    return report.holdings.map((h) => {
      const extraShares = simulatedShares[h.symbol] ?? 0;
      const totalQty = h.quantity + extraShares;
      const dps = h.ttmDps > 0 ? h.ttmDps : (h.divYield ? (h.currentPrice ?? 0) * (h.divYield / 100) : 0);
      const simPayout = totalQty * dps;
      const simVal = totalQty * (h.currentPrice ?? (h.quantity > 0 ? h.currentValue / h.quantity : 0));
      return {
        ...h,
        simulatedQty: totalQty,
        extraShares,
        simulatedPayout: Math.round(simPayout),
        simulatedValue: Math.round(simVal),
      };
    });
  }, [report.holdings, simulatedShares]);

  // Aggregate simulated totals
  const totalSimulatedPayout = useMemo(() => {
    return simulatedHoldings.reduce((sum, h) => sum + h.simulatedPayout, 0);
  }, [simulatedHoldings]);

  const totalSimulatedValue = useMemo(() => {
    return simulatedHoldings.reduce((sum, h) => sum + h.simulatedValue, 0);
  }, [simulatedHoldings]);

  const simulatedMonthly = Math.round(totalSimulatedPayout / 12);
  const simulatedYield = totalSimulatedValue > 0 ? (totalSimulatedPayout / totalSimulatedValue) * 100 : 0;

  // Filtered & Sorted holdings
  const filteredHoldings = useMemo(() => {
    let list = simulatedHoldings;
    if (filterMode === "payers") {
      list = list.filter((h) => h.simulatedPayout > 0 || (h.divYield && h.divYield > 0));
    } else if (filterMode === "high_yield") {
      list = list.filter((h) => (h.divYield && h.divYield >= 2.0) || (h.yieldOnCost && h.yieldOnCost >= 2.0));
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (h) =>
          h.symbol.toLowerCase().includes(q) ||
          (h.companyName && h.companyName.toLowerCase().includes(q)) ||
          (h.sector && h.sector.toLowerCase().includes(q))
      );
    }

    return list.slice().sort((a, b) => {
      if (sortKey === "payout") return b.simulatedPayout - a.simulatedPayout;
      if (sortKey === "yield") return (b.divYield ?? 0) - (a.divYield ?? 0);
      if (sortKey === "yoc") return (b.yieldOnCost ?? 0) - (a.yieldOnCost ?? 0);
      return b.simulatedValue - a.simulatedValue;
    });
  }, [simulatedHoldings, filterMode, search, sortKey]);

  // Max monthly payout for relative bar chart height
  const maxMonthlyPayout = useMemo(() => {
    return Math.max(...report.monthlyHistory.map((m) => m.payout), 1);
  }, [report.monthlyHistory]);

  // Goal Calculator math
  const targetAnnual = targetMonthly * 12;
  const annualGap = Math.max(0, targetAnnual - totalSimulatedPayout);
  const monthlyGap = Math.max(0, targetMonthly - simulatedMonthly);
  const capitalNeededCurrentYield = simulatedYield > 0 ? (annualGap / (simulatedYield / 100)) : (annualGap / 0.015);
  const capitalNeededHighYield = annualGap / 0.06; // at 6% benchmark dividend yield

  if (!report.hasHoldings) {
    return (
      <div className="card p-12 text-center text-slate-500">
        <div className="w-10 h-10 mx-auto mb-3 text-slate-400">💰</div>
        <h3 className="text-[16px] font-semibold text-slate-800">No Portfolio Holdings Detected</h3>
        <p className="text-[13px] text-slate-500 mt-1 max-w-md mx-auto">
          Import your stock holdings from Zerodha, Upstox, Groww, or manual trade logs to see your live dividend income calculation.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full pb-10">
      {/* 1. HERO METRIC CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Total Annual Income */}
        <div className="p-4 rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/50 via-white to-emerald-50/20 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
              Annual Dividend
            </span>
            <span className="text-emerald-600 font-mono text-[11px]">Run-rate</span>
          </div>
          <div className="text-[22px] font-mono font-bold text-slate-900 mt-1.5">
            {inr(totalSimulatedPayout)}
          </div>
          <div className="text-[11.5px] text-emerald-700 font-medium mt-0.5">
            ≈ {inr(simulatedMonthly)} / month
          </div>
        </div>

        {/* Portfolio Yield */}
        <div className="p-4 rounded-xl border border-slate-200/90 bg-white shadow-2xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              Portfolio Yield
            </span>
            <span className="text-slate-400 text-[10.5px]">on LTP</span>
          </div>
          <div className="text-[22px] font-mono font-bold text-slate-900 mt-1.5">
            {pct(simulatedYield)}
          </div>
          <div className="text-[11.5px] text-slate-500 mt-0.5">
            On {inr(totalSimulatedValue)} portfolio value
          </div>
        </div>

        {/* Yield on Cost (YoC) */}
        <div className="p-4 rounded-xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/40 via-white to-white shadow-2xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-800">
              Yield on Cost
            </span>
            <span className="text-indigo-600 text-[10.5px] font-medium">YoC</span>
          </div>
          <div className="text-[22px] font-mono font-bold text-slate-900 mt-1.5">
            {pct(report.portfolioYieldOnCost)}
          </div>
          <div className="text-[11.5px] text-indigo-700 font-medium mt-0.5">
            On {inr(report.totalInvested)} invested capital
          </div>
        </div>

        {/* Dividend Payers Ratio */}
        <div className="p-4 rounded-xl border border-slate-200/90 bg-white shadow-2xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              Dividend Coverage
            </span>
            <span className="text-slate-400 text-[10.5px]">Payers</span>
          </div>
          <div className="text-[22px] font-mono font-bold text-slate-900 mt-1.5">
            {report.dividendPayingCount} <span className="text-[14px] text-slate-400 font-normal">/ {report.totalHoldings}</span>
          </div>
          <div className="text-[11.5px] text-slate-500 mt-0.5">
            {((report.dividendPayingCount / report.totalHoldings) * 100).toFixed(0)}% of your stocks pay dividends
          </div>
        </div>

        {/* Upcoming Confirmed */}
        <div className="p-4 rounded-xl border border-slate-200/90 bg-white shadow-2xs col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              Confirmed Upcoming
            </span>
            <span className={`w-2 h-2 rounded-full ${report.upcomingCount > 0 ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
          </div>
          <div className="text-[22px] font-mono font-bold text-slate-900 mt-1.5">
            {inr(report.upcomingPayout)}
          </div>
          <div className="text-[11.5px] text-slate-500 mt-0.5">
            {report.upcomingCount > 0 ? `${report.upcomingCount} announced event(s)` : "No pending ex-dates today"}
          </div>
        </div>
      </div>

      {/* 2. TARGET DIVIDEND GOAL & FREEDOM CALCULATOR */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900 flex items-center gap-2">
              <span>🎯</span> Financial Freedom &amp; Target Dividend Calculator
            </h3>
            <p className="text-[12.5px] text-slate-500 mt-0.5">
              Calculate the required capital to generate your target passive cash flow through dividends.
            </p>
          </div>
          {/* Preset Buttons */}
          <div className="flex items-center gap-1.5">
            {[5000, 10000, 25000, 50000, 100000].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => setTargetMonthly(val)}
                className={`px-2.5 py-1 text-[11.5px] font-medium rounded-md transition-all ${
                  targetMonthly === val
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                ₹{(val / 1000).toFixed(0)}k/mo
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-5">
          {/* Slider input */}
          <div className="space-y-3">
            <div className="flex justify-between items-center text-[13px]">
              <span className="font-medium text-slate-700">Target Monthly Income:</span>
              <span className="font-mono font-bold text-[15px] text-emerald-700">{inr(targetMonthly)}</span>
            </div>
            <input
              type="range"
              min={1000}
              max={200000}
              step={1000}
              value={targetMonthly}
              onChange={(e) => setTargetMonthly(Number(e.target.value))}
              className="w-full accent-emerald-600 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>₹1k/mo</span>
              <span>₹1L/mo</span>
              <span>₹2L/mo</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70 text-[12px] text-slate-600 space-y-1">
              <div className="flex justify-between">
                <span>Annual Target:</span>
                <span className="font-mono font-semibold text-slate-900">{inr(targetAnnual)}</span>
              </div>
              <div className="flex justify-between">
                <span>Current Annual Run-rate:</span>
                <span className="font-mono font-semibold text-emerald-700">{inr(totalSimulatedPayout)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200/60 pt-1 text-slate-700 font-medium">
                <span>Monthly Shortfall:</span>
                <span className="font-mono text-amber-700">{monthlyGap > 0 ? inr(monthlyGap) : "Goal Met! 🎉"}</span>
              </div>
            </div>
          </div>

          {/* Capital Requirement Calculation */}
          <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Option A · At Current Portfolio Yield ({pct(simulatedYield)})
                </span>
                <div className="text-[20px] font-mono font-bold text-slate-900 mt-2">
                  {inr(capitalNeededCurrentYield)}
                </div>
                <p className="text-[11.5px] text-slate-500 mt-1">
                  Additional capital required if deployed proportionately across your current portfolio holdings.
                </p>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-200/60 text-[11px] text-slate-400">
                Target: {inr(targetAnnual)} / yr ÷ {pct(simulatedYield)}
              </div>
            </div>

            <div className="p-4 rounded-xl border border-teal-200 bg-teal-50/30 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-800">
                    Option B · High-Yield Focus (~6.0% Yield)
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-100 text-teal-800">
                    Efficient
                  </span>
                </div>
                <div className="text-[20px] font-mono font-bold text-teal-950 mt-2">
                  {inr(capitalNeededHighYield)}
                </div>
                <p className="text-[11.5px] text-teal-900/80 mt-1">
                  Required capital if targeted into quality dividend champions (PSUs, Cash-Rich FMCG/IT paying 5–7%).
                </p>
              </div>
              <div className="mt-3 pt-3 border-t border-teal-200/60 text-[11px] text-teal-700">
                Saves <strong className="font-mono">{inr(Math.max(0, capitalNeededCurrentYield - capitalNeededHighYield))}</strong> in required capital!
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. MONTHLY CASH FLOW TIMELINE & SEASONALITY */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900 flex items-center gap-2">
              <span>📊</span> Trailing 12-Month Dividend Cash Flow Seasonality
            </h3>
            <p className="text-[12.5px] text-slate-500 mt-0.5">
              Actual dividend disbursements credited across your held positions by month.
            </p>
          </div>
          <div className="text-right text-[12px] text-slate-500">
            Total TTM Received: <span className="font-mono font-bold text-slate-900">{inr(report.totalAnnualPayout)}</span>
          </div>
        </div>

        {/* Monthly Bar Visualizer */}
        <div className="mt-6 grid grid-cols-6 sm:grid-cols-12 gap-2 items-end h-[160px] pb-2 border-b border-slate-200">
          {report.monthlyHistory.map((m) => {
            const heightPct = Math.max((m.payout / maxMonthlyPayout) * 100, 6);
            return (
              <div key={m.month} className="group relative flex flex-col items-center h-full justify-end">
                {/* Tooltip */}
                <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 bg-slate-900 text-white text-[11px] rounded px-2 py-1 shadow-lg whitespace-nowrap">
                  <div className="font-mono font-bold">{inr(m.payout)}</div>
                  <div className="text-[9.5px] text-slate-300">{m.eventCount} payout event(s)</div>
                </div>
                {/* Bar */}
                <div
                  className="w-full rounded-t transition-all bg-emerald-500/80 group-hover:bg-emerald-600"
                  style={{ height: `${heightPct}%` }}
                />
                <span className="text-[10px] text-slate-500 mt-2 font-mono truncate w-full text-center">
                  {m.label.split(" ")[0]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. 2-COLUMN DATEWISE DIVIDEND REPORT (YEAR -> MONTH -> DATE TREE + TABULAR ROWS) */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900 flex items-center gap-2">
              <span>📅</span> Datewise Dividend Report
            </h3>
            <p className="text-[12.5px] text-slate-500 mt-0.5">
              Select a year, month, or date on the left to filter; all matching dividend payouts appear in the table on the right.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[12px]">
              {(
                [
                  { id: "all", label: `All (${allSourceEvents.length})` },
                  { id: "paid", label: `Paid (${allSourceEvents.filter((e) => !e.isUpcoming).length})` },
                  { id: "upcoming", label: `Upcoming (${report.upcomingEvents.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setEventsFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    eventsFilter === tab.id ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 text-[11.5px]">
              <button
                type="button"
                onClick={() => setAllTreeOpen(true)}
                className="px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Expand all
              </button>
              <button
                type="button"
                onClick={() => setAllTreeOpen(false)}
                className="px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Collapse all
              </button>
            </div>
          </div>
        </div>

        {dividendTree.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-[13px]">
            No {eventsFilter === "all" ? "" : eventsFilter} dividend events on record for your positions.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-4 items-start">
            {/* LEFT COLUMN: Year -> Month -> Date collapsible tree (collapsed to latest year-month-date, no date/month sums) */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/40 overflow-hidden lg:max-h-[560px] lg:overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-100/70">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Year · Month · Date
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedScope({ year: "all" })}
                  className={`text-[11px] font-medium px-2 py-0.5 rounded transition-colors ${
                    activeScope.year === "all"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-200/70"
                  }`}
                >
                  All years
                </button>
              </div>
              <div className="divide-y divide-slate-200/80">
                {dividendTree.map((yr) => {
                  const yOpen = isYearOpen(yr.year);
                  const yActive = activeScope.year === yr.year && !activeScope.month && !activeScope.date;
                  return (
                    <div key={yr.year} className="bg-white">
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedYears((prev) => ({ ...prev, [yr.year]: !yOpen }));
                          setSelectedScope({ year: yr.year });
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
                          yActive ? "bg-emerald-50 text-emerald-900" : "hover:bg-slate-50 text-slate-900"
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                          <span className="text-[10px] text-slate-400 w-3">{yOpen ? "▾" : "▸"}</span>
                          <span className="font-mono">{yr.year}</span>
                        </span>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {yr.eventCount}
                        </span>
                      </button>

                      {yOpen && (
                        <div className="border-t border-slate-100 divide-y divide-slate-100 bg-slate-50/30">
                          {yr.months.map((mo) => {
                            const mOpen = isMonthOpen(mo.month);
                            const mActive = activeScope.month === mo.month && !activeScope.date;
                            return (
                              <div key={mo.month}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedMonths((prev) => ({ ...prev, [mo.month]: !mOpen }));
                                    setSelectedScope({ year: yr.year, month: mo.month });
                                  }}
                                  className={`w-full flex items-center justify-between pl-6 pr-3 py-1.5 text-left text-[12px] transition-colors ${
                                    mActive
                                      ? "bg-emerald-50/90 text-emerald-900 font-semibold"
                                      : "hover:bg-slate-100/70 text-slate-700 font-medium"
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5 truncate">
                                    <span className="text-[10px] text-slate-400 w-3">{mOpen ? "▾" : "▸"}</span>
                                    <span className="truncate">{mo.label.replace(` ${yr.year}`, "")}</span>
                                  </span>
                                  <span className="text-[11px] text-slate-400 tabular-nums">{mo.eventCount}</span>
                                </button>

                                {mOpen && (
                                  <div className="bg-white/70 divide-y divide-slate-100/80">
                                    {mo.dates.map((dt) => {
                                      const dActive = activeScope.date === dt.date;
                                      const isLatest = dt.date === latestDate && activeScope.year === latestYear && !activeScope.month && !activeScope.date;
                                      return (
                                        <button
                                          key={dt.date}
                                          type="button"
                                          onClick={() =>
                                            setSelectedScope({ year: yr.year, month: mo.month, date: dt.date })
                                          }
                                          className={`w-full flex items-center justify-between pl-10 pr-3 py-1.5 text-left text-[11.5px] transition-colors ${
                                            dActive
                                              ? "bg-indigo-50 text-indigo-900 font-semibold"
                                              : isLatest
                                              ? "bg-slate-100/70 text-slate-800 font-medium"
                                              : "hover:bg-slate-50 text-slate-600"
                                          }`}
                                        >
                                          <span className="font-mono truncate">{dt.label}</span>
                                          <span className="text-[10.5px] text-slate-400 tabular-nums">
                                            {dt.events.length}
                                          </span>
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
                })}
              </div>
            </div>

            {/* RIGHT COLUMN: Highlighted Year at top + single tabular list of all matching rows */}
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-emerald-50/70 border-b border-emerald-200/70">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-700 text-white font-mono text-[12.5px] font-bold">
                    {activeScope.year === "all" ? "All Years" : activeScope.year}
                  </span>
                  {activeYearBucket && (
                    <span className="font-mono font-bold text-emerald-800 text-[13.5px]">
                      {inr(activeYearBucket.payout, 2)}
                    </span>
                  )}
                  <span className="text-[12px] text-slate-600">
                    {activeScope.date
                      ? `· ${activeScope.date}`
                      : activeScope.month
                      ? `· ${activeScope.month}`
                      : activeYearBucket
                      ? `· ${activeYearBucket.eventCount} payouts`
                      : `· ${tableEvents.length} payouts`}
                  </span>
                </div>
                {(activeScope.month || activeScope.date) && (
                  <button
                    type="button"
                    onClick={() => setSelectedScope({ year: activeScope.year })}
                    className="text-[11.5px] font-medium text-emerald-800 hover:underline"
                  >
                    Show full {activeScope.year}
                  </button>
                )}
              </div>

              <div className="overflow-x-auto lg:max-h-[512px] lg:overflow-y-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500 text-[11px] font-medium">
                    <tr>
                      <th className="py-2 px-3 whitespace-nowrap">Ex-Date</th>
                      <th className="py-2 px-3">Stock</th>
                      <th className="py-2 px-3">Purpose</th>
                      <th className="py-2 px-3 text-right whitespace-nowrap">Per Share</th>
                      <th className="py-2 px-3 text-right whitespace-nowrap">Shares Held</th>
                      <th className="py-2 px-3 text-right whitespace-nowrap">Total Payout</th>
                      <th className="py-2 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tableEvents.map((e, idx) => (
                      <tr key={`${e.symbol}-${e.exDate}-${idx}`} className="hover:bg-slate-50/80">
                        <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">{e.exDate}</td>
                        <td className="py-2 px-3 font-medium text-slate-900 whitespace-nowrap">
                          <Link href={`/stock/${e.symbol}`} className="hover:underline text-indigo-700 font-mono">
                            {e.symbol}
                          </Link>
                          {e.companyName && (
                            <span className="text-slate-400 font-normal ml-2 text-[11px] hidden sm:inline">
                              {e.companyName}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-600">{e.purpose}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-800 whitespace-nowrap">
                          {inr(e.amount, 2)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600 whitespace-nowrap">
                          {e.heldQty} sh
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-700 whitespace-nowrap">
                          {inr(e.payout, 2)}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${
                              e.isUpcoming
                                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {e.isUpcoming ? "Upcoming" : "Paid"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. ALL HOLDINGS DIVIDEND BREAKDOWN & WHAT-IF SIMULATOR */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900 flex items-center gap-2">
              <span>💼</span> Per-Holding Dividend Breakdown &amp; Share Simulator
            </h3>
            <p className="text-[12.5px] text-slate-500 mt-0.5">
              Review individual yields, or adjust share counts below to test how adding shares boosts your payout.
            </p>
          </div>
          {Object.keys(simulatedShares).length > 0 && (
            <button
              type="button"
              onClick={() => setSimulatedShares({})}
              className="text-[11.5px] text-rose-600 font-medium hover:underline self-start sm:self-center"
            >
              Reset simulated shares
            </button>
          )}
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-4">
          <div className="flex items-center gap-1.5 text-[12px]">
            <button
              type="button"
              onClick={() => setFilterMode("payers")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                filterMode === "payers" ? "bg-slate-900 text-white shadow-xs" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Dividend Payers ({report.dividendPayingCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("high_yield")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                filterMode === "high_yield" ? "bg-slate-900 text-white shadow-xs" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              High Yield ≥2%
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("all")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                filterMode === "all" ? "bg-slate-900 text-white shadow-xs" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              All Holdings ({report.totalHoldings})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search stock or sector…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 text-[12px] rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-slate-400 w-full sm:w-56"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as any)}
              aria-label="Sort dividend holdings by"
              className="px-2.5 py-1.5 text-[12px] rounded-md border border-slate-200 bg-slate-50 text-slate-700 cursor-pointer"
            >
              <option value="payout">Sort: Payout (High → Low)</option>
              <option value="yield">Sort: Dividend Yield</option>
              <option value="yoc">Sort: Yield on Cost</option>
              <option value="value">Sort: Position Value</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-medium">
                <th className="py-2.5 px-3">Stock</th>
                <th className="py-2.5 px-3 text-right">Shares Held</th>
                <th className="py-2.5 px-3 text-right">Value (₹)</th>
                <th className="py-2.5 px-3 text-right">Yield</th>
                <th className="py-2.5 px-3 text-right">Yield on Cost</th>
                <th className="py-2.5 px-3 text-right">TTM DPS (₹)</th>
                <th className="py-2.5 px-3 text-right">Annual Payout</th>
                <th className="py-2.5 px-3 text-center">Simulate +Shares</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredHoldings.map((h) => {
                const isModified = (simulatedShares[h.symbol] ?? 0) > 0;
                return (
                  <tr key={h.symbol} className={`hover:bg-slate-50/70 transition-colors ${isModified ? "bg-emerald-50/30" : ""}`}>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-900 font-mono">
                        <Link href={`/stock/${h.symbol}`} className="hover:underline text-indigo-700">
                          {h.symbol}
                        </Link>
                      </div>
                      <div className="text-[10.5px] text-slate-400 truncate max-w-[180px]">
                        {h.companyName ?? "—"}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                      {h.simulatedQty} sh
                      {isModified && (
                        <div className="text-[10px] text-emerald-700 font-bold">
                          +{simulatedShares[h.symbol]} sim
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                      {inr(h.simulatedValue)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      <span className={h.divYield && h.divYield >= 2.0 ? "text-emerald-700 font-bold" : "text-slate-700"}>
                        {pct(h.divYield)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      <span className={h.yieldOnCost && h.yieldOnCost >= 2.0 ? "text-indigo-700 font-bold" : "text-slate-500"}>
                        {pct(h.yieldOnCost)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {h.ttmDps > 0 ? inr(h.ttmDps, 2) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-800">
                      {inr(h.simulatedPayout)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSimulatedShares((prev) => ({
                              ...prev,
                              [h.symbol]: (prev[h.symbol] ?? 0) + 10,
                            }));
                          }}
                          className="px-1.5 py-0.5 rounded text-[10.5px] bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-600 transition-colors"
                          title="Simulate adding +10 shares"
                        >
                          +10
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSimulatedShares((prev) => ({
                              ...prev,
                              [h.symbol]: (prev[h.symbol] ?? 0) + 50,
                            }));
                          }}
                          className="px-1.5 py-0.5 rounded text-[10.5px] bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-600 transition-colors"
                          title="Simulate adding +50 shares"
                        >
                          +50
                        </button>
                        {isModified && (
                          <button
                            type="button"
                            onClick={() => {
                              setSimulatedShares((prev) => {
                                const copy = { ...prev };
                                delete copy[h.symbol];
                                return copy;
                              });
                            }}
                            className="text-[10px] text-rose-500 hover:text-rose-700 ml-1"
                            title="Reset this stock"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredHoldings.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No holdings match your search or filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
