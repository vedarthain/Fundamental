"use client";

/**
 * Watchlist Verdict Tab — Institutional Conviction Board
 *
 * A high-clarity dashboard grouping tracked portfolio and watchlist stocks
 * by institutional conviction action (BUY, ACCUMULATE, HOLD, WATCH, AVOID),
 * providing company name, 1-line thesis, anchor vs LTP, and performance tracking.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { VerdictSheet } from "@/components/VerdictSheet";
import { STALE_DAYS, type QueueBucket } from "@/lib/verdictTypes";
import type { QueueEntry, TimelineWeek, VerdictQueue } from "@/lib/verdict";

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

function inr(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type ConvictionCategory = "all" | "buy" | "hold" | "watch" | "avoid" | "missing" | "dormant";

function categorize(e: QueueEntry): "buy" | "hold" | "watch" | "avoid" | "missing" | "dormant" {
  if (e.bucket === "dormant") return "dormant";
  if (e.bucket === "missing" || !e.action) return "missing";
  const act = e.action.toUpperCase();
  if (act.includes("BUY") || act.includes("ACCUMULATE")) return "buy";
  if (act.includes("HOLD")) return "hold";
  if (act.includes("WATCH") || act.includes("SPECULATIVE")) return "watch";
  if (act.includes("AVOID") || act.includes("REDUCE") || act.includes("SELL")) return "avoid";
  return "hold";
}

const ACTION_THEMES: Record<string, { dot: string; pill: string }> = {
  BUY: { dot: "bg-emerald-500", pill: "bg-emerald-50/70 text-emerald-800 border-emerald-200/70" },
  ACCUMULATE: { dot: "bg-emerald-500", pill: "bg-emerald-50/70 text-emerald-800 border-emerald-200/70" },
  HOLD: { dot: "bg-slate-400", pill: "bg-slate-100 text-slate-700 border-slate-200" },
  WATCH: { dot: "bg-amber-500", pill: "bg-amber-50/80 text-amber-800 border-amber-200/70" },
  SPECULATIVE: { dot: "bg-amber-500", pill: "bg-amber-50/80 text-amber-800 border-amber-200/70" },
  REDUCE: { dot: "bg-rose-400", pill: "bg-rose-50/70 text-rose-700 border-rose-200/70" },
  AVOID: { dot: "bg-rose-500", pill: "bg-rose-50/80 text-rose-800 border-rose-200/80" },
  SELL: { dot: "bg-rose-500", pill: "bg-rose-50/80 text-rose-800 border-rose-200/80" },
};

function getBadgeTheme(action: string | null) {
  if (!action) return { dot: "bg-slate-300", pill: "bg-slate-50 text-slate-400 border-slate-200" };
  const firstWord = action.toUpperCase().split(/[\s,]+/)[0];
  return ACTION_THEMES[firstWord] || { dot: "bg-slate-400", pill: "bg-slate-100 text-slate-700 border-slate-200" };
}

type SortKey = "move" | "freshness" | "symbol" | "urgency";

export function VerdictQueueClient() {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ok"; q: VerdictQueue } | { kind: "error"; msg: string }
  >({ kind: "loading" });
  const [open, setOpen] = useState<string | null>(null);
  const [category, setCategory] = useState<ConvictionCategory>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("freshness");
  const [showTimeline, setShowTimeline] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/verdict?queue=1", { cache: "no-store" })
      .then(async (r) => {
        if (!live) return;
        if (r.status === 401) {
          setState({
            kind: "error",
            msg: "Verdicts are admin-only and this session is not an admin session.",
          });
          return;
        }
        if (!r.ok) {
          setState({ kind: "error", msg: `The queue request failed (${r.status}).` });
          return;
        }
        setState({ kind: "ok", q: (await r.json()) as VerdictQueue });
      })
      .catch(() => {
        if (live) setState({ kind: "error", msg: "The queue request did not complete." });
      });
    return () => {
      live = false;
    };
  }, []);

  // Category counts across live entries
  const counts = useMemo(() => {
    const res = { buy: 0, hold: 0, watch: 0, avoid: 0, missing: 0, dormant: 0, total: 0 };
    if (state.kind !== "ok") return res;
    for (const e of state.q.entries) {
      const cat = categorize(e);
      if (cat !== "dormant") res.total++;
      res[cat]++;
    }
    return res;
  }, [state]);

  // Filtered & Sorted list
  const filtered = useMemo(() => {
    if (state.kind !== "ok") return [];
    let list = state.q.entries;

    // Filter by conviction category
    if (category !== "all") {
      list = list.filter((e) => categorize(e) === category);
    } else {
      // By default in 'all', show active tracked stocks (exclude dormant unless explicitly picked)
      list = list.filter((e) => e.bucket !== "dormant");
    }

    // Filter by text search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.symbol.toLowerCase().includes(q) ||
          (e.company_name && e.company_name.toLowerCase().includes(q)) ||
          (e.industry && e.industry.toLowerCase().includes(q)) ||
          (e.thesis && e.thesis.toLowerCase().includes(q))
      );
    }

    // Sort
    return list.slice().sort((a, b) => {
      if (sortKey === "move") {
        const ma = a.pctMove ?? -9999;
        const mb = b.pctMove ?? -9999;
        return mb - ma;
      }
      if (sortKey === "freshness") {
        const ta = a.generated_at ? new Date(a.generated_at).getTime() : 0;
        const tb = b.generated_at ? new Date(b.generated_at).getTime() : 0;
        return tb - ta;
      }
      if (sortKey === "urgency") {
        const ua = a.movedCount > 0 ? 2 : (a.ageDays ?? 0) > STALE_DAYS ? 1 : 0;
        const ub = b.movedCount > 0 ? 2 : (b.ageDays ?? 0) > STALE_DAYS ? 1 : 0;
        return ub - ua || (b.ageDays ?? 0) - (a.ageDays ?? 0);
      }
      return a.symbol.localeCompare(b.symbol);
    });
  }, [state, category, search, sortKey]);

  if (state.kind === "loading") {
    return (
      <div className="py-16 text-center text-[13px] text-slate-500">
        <div className="inline-block w-5 h-5 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin mb-2" />
        <div>Loading Institutional Conviction Board…</div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-4 text-[13px] max-w-[640px] text-rose-800">
        <span className="font-medium">Could not load conviction board:</span> {state.msg}
      </div>
    );
  }

  const { trackedCount, timeline } = state.q;

  return (
    <div className="space-y-4 w-full">
      {/* 1. Conviction Overview Cards Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* BUY & ACCUMULATE */}
        <button
          type="button"
          onClick={() => setCategory(category === "buy" ? "all" : "buy")}
          className={`p-3 rounded-lg border text-left transition-all relative ${
            category === "buy"
              ? "border-emerald-500 bg-emerald-50/30 ring-1 ring-emerald-500 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Buy &amp; Accumulate
            </span>
          </div>
          <div className="text-[20px] font-mono font-medium text-slate-900 mt-1">
            {counts.buy}
          </div>
          <div className="text-[10.5px] text-emerald-700 font-normal mt-0.5">
            Top conviction entry
          </div>
        </button>

        {/* HOLD */}
        <button
          type="button"
          onClick={() => setCategory(category === "hold" ? "all" : "hold")}
          className={`p-3 rounded-lg border text-left transition-all ${
            category === "hold"
              ? "border-slate-600 bg-slate-100/50 ring-1 ring-slate-600 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              Hold
            </span>
          </div>
          <div className="text-[20px] font-mono font-medium text-slate-900 mt-1">
            {counts.hold}
          </div>
          <div className="text-[10.5px] text-slate-500 font-normal mt-0.5">
            Maintain standing
          </div>
        </button>

        {/* WATCH */}
        <button
          type="button"
          onClick={() => setCategory(category === "watch" ? "all" : "watch")}
          className={`p-3 rounded-lg border text-left transition-all ${
            category === "watch"
              ? "border-amber-500 bg-amber-50/30 ring-1 ring-amber-500 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Watch
            </span>
          </div>
          <div className="text-[20px] font-mono font-medium text-slate-900 mt-1">
            {counts.watch}
          </div>
          <div className="text-[10.5px] text-amber-700 font-normal mt-0.5">
            Catalyst corridor
          </div>
        </button>

        {/* REDUCE & AVOID */}
        <button
          type="button"
          onClick={() => setCategory(category === "avoid" ? "all" : "avoid")}
          className={`p-3 rounded-lg border text-left transition-all ${
            category === "avoid"
              ? "border-rose-400 bg-rose-50/30 ring-1 ring-rose-400 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              Reduce &amp; Avoid
            </span>
          </div>
          <div className="text-[20px] font-mono font-medium text-slate-900 mt-1">
            {counts.avoid}
          </div>
          <div className="text-[10.5px] text-rose-700 font-normal mt-0.5">
            Capital preservation
          </div>
        </button>

        {/* PENDING VERDICT */}
        <button
          type="button"
          onClick={() => setCategory(category === "missing" ? "all" : "missing")}
          className={`p-3 rounded-lg border text-left transition-all ${
            category === "missing"
              ? "border-slate-400 bg-slate-50 ring-1 ring-slate-400 shadow-2xs"
              : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
              Pending
            </span>
          </div>
          <div className="text-[20px] font-mono font-medium text-slate-900 mt-1">
            {counts.missing}
          </div>
          <div className="text-[10.5px] text-slate-400 font-normal mt-0.5">
            Awaiting analysis
          </div>
        </button>
      </div>

      {/* 2. Controls & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
        {/* Category Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 text-[12px]">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              category === "all"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All Active ({counts.total})
          </button>
          <button
            type="button"
            onClick={() => setCategory("buy")}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              category === "buy"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Buy ({counts.buy})
          </button>
          <button
            type="button"
            onClick={() => setCategory("hold")}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              category === "hold"
                ? "bg-slate-700 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Hold ({counts.hold})
          </button>
          <button
            type="button"
            onClick={() => setCategory("watch")}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              category === "watch"
                ? "bg-amber-600 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Watch ({counts.watch})
          </button>
          <button
            type="button"
            onClick={() => setCategory("avoid")}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              category === "avoid"
                ? "bg-rose-600 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Avoid ({counts.avoid})
          </button>
          <button
            type="button"
            onClick={() => setCategory("missing")}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              category === "missing"
                ? "bg-slate-600 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Pending ({counts.missing})
          </button>
          {counts.dormant > 0 && (
            <button
              type="button"
              onClick={() => setCategory("dormant")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                category === "dormant"
                  ? "bg-slate-500 text-white shadow-xs"
                  : "bg-slate-100 text-slate-400 hover:bg-slate-200"
              }`}
            >
              Archived ({counts.dormant})
            </button>
          )}
        </div>

        {/* Search & Sort */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search symbol, company, sector..."
              className="w-full text-[12px] bg-white border border-slate-200 rounded-md px-2.5 py-1 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[11px]"
              >
                ✕
              </button>
            )}
          </div>

          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Sort order"
            className="text-[12px] bg-white border border-slate-200 rounded-md px-2 py-1 text-slate-700 focus:outline-none focus:border-slate-400"
          >
            <option value="freshness">Sort: Recently Updated</option>
            <option value="move">Sort: Return Since Verdict</option>
            <option value="urgency">Sort: Needs Review (Drift)</option>
            <option value="symbol">Sort: Symbol (A-Z)</option>
          </select>
        </div>
      </div>

      {/* 3. The Conviction Table */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-500">
          No stocks match the selected conviction filter or search term.
          <div className="mt-2">
            <button
              type="button"
              onClick={() => {
                setCategory("all");
                setSearch("");
              }}
              className="text-[12px] text-emerald-700 font-medium hover:underline"
            >
              Reset filters
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] border-collapse min-w-[920px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  <th className="text-left py-2.5 px-3.5">Company &amp; Sector</th>
                  <th className="text-left py-2.5 px-3">Conviction</th>
                  <th className="text-left py-2.5 px-3 w-[40%]">1-Line Verdict Thesis</th>
                  <th className="text-right py-2.5 px-3">At Verdict</th>
                  <th className="text-right py-2.5 px-3">Current LTP</th>
                  <th className="text-right py-2.5 px-3">Return</th>
                  <th className="text-right py-2.5 px-3.5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((e) => {
                  const badge = getBadgeTheme(e.action);
                  const isMissing = !e.verdict;
                  const hasMoved = e.movedCount > 0;
                  const isStale = e.ageDays != null && e.ageDays > STALE_DAYS;

                  return (
                    <tr
                      key={e.symbol}
                      className="hover:bg-slate-50/70 transition-colors group"
                    >
                      {/* Symbol & Company */}
                      <td className="py-2.5 px-3.5">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/stock/${e.symbol}`}
                            className="font-mono font-medium text-[13px] text-slate-900 group-hover:text-emerald-700 hover:underline"
                          >
                            {e.symbol}
                          </Link>
                          {e.bucket === "dormant" && (
                            <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded font-normal">
                              archived
                            </span>
                          )}
                        </div>
                        <div className="text-[11.5px] text-slate-500 truncate max-w-[210px] mt-0.5">
                          {e.company_name || e.industry || "—"}
                        </div>
                        {e.industry && (
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[210px]">
                            {e.industry}
                          </div>
                        )}
                      </td>

                      {/* Conviction Action */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {isMissing ? (
                          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-normal px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                            Pending
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <span
                              className={`inline-flex items-center gap-1.5 text-[10.5px] font-medium px-2 py-0.5 rounded-full border ${badge.pill}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                              {e.action || "HOLD"}
                            </span>
                            <div className="text-[10px] text-slate-400">
                              {e.ageDays != null ? `${e.ageDays}d ago` : ""}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* 1-Line Verdict Thesis */}
                      <td className="py-2.5 px-3">
                        {isMissing ? (
                          <span className="text-[11.5px] text-slate-400 italic">
                            Tracked on watchlist. Awaiting AI quantitative verdict generation.
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setOpen(e.symbol)}
                            className="text-left text-[12px] leading-relaxed text-slate-600 hover:text-slate-900 transition-colors line-clamp-2"
                            title="Click to view full verdict analysis"
                          >
                            {e.thesis || e.verdict}
                          </button>
                        )}
                        {/* Evidence drift or warning indicator */}
                        {hasMoved && (
                          <div className="text-[10.5px] text-rose-600 font-normal mt-1 flex items-center gap-1">
                            <span>⚠️</span>
                            <span>{e.movedCount} key metrics shifted since writing</span>
                          </div>
                        )}
                        {!hasMoved && isStale && (
                          <div className="text-[10.5px] text-amber-700 font-normal mt-1">
                            Review window open ({e.ageDays}d old)
                          </div>
                        )}
                      </td>

                      {/* Price at Verdict */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono text-[12px] text-slate-500">
                        {e.anchorPrice != null ? (
                          <div>
                            <div>₹{inr(e.anchorPrice)}</div>
                            {e.priceAsof && (
                              <div className="text-[10px] text-slate-400 font-sans">
                                {shortDate(e.priceAsof)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Current LTP */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono text-[12px] font-medium text-slate-800">
                        {e.ltp != null ? `₹${inr(e.ltp)}` : <span className="text-slate-300 font-normal">—</span>}
                      </td>

                      {/* Return Since Verdict */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {e.pctMove != null ? (
                          <span
                            className={`inline-block font-mono text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                              e.pctMove >= 0
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200/70"
                                : "bg-rose-50 text-rose-700 border-rose-200/70"
                            }`}
                          >
                            {e.pctMove >= 0 ? "+" : ""}
                            {e.pctMove.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-300 font-mono text-[11px]">—</span>
                        )}
                      </td>

                      {/* Action Button */}
                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setOpen(e.symbol)}
                          className="px-2.5 py-1 text-[11.5px] font-medium rounded-md border border-slate-200/90 text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Optional Collapsible Audit & Drift Timeline */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setShowTimeline(!showTimeline)}
          className="text-[11.5px] font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1.5 transition-colors"
        >
          <span>{showTimeline ? "▼ Hide" : "▶ Show"} Weekly Evidence Drift Audit</span>
          <span className="text-[10px] text-slate-400">({timeline.length} weeks tracked)</span>
        </button>

        {showTimeline && (
          <div className="mt-3">
            <Timeline weeks={timeline} onOpen={setOpen} />
          </div>
        )}
      </div>

      {/* Slide-over Verdict Sheet Modal */}
      {open && <VerdictSheet symbol={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------- weekly */

function Timeline({
  weeks,
  onOpen,
}: {
  weeks: TimelineWeek[];
  onOpen: (s: string) => void;
}) {
  const anything = weeks.some(
    (w) => w.written.length || w.broke.length || w.wentStale.length || w.added.length
  );

  return (
    <div className="rounded-lg border border-slate-200/80 bg-white p-4 max-w-[900px] shadow-2xs">
      <div className="text-[12.5px] font-medium text-slate-800">Weekly Evidence Shift History</div>
      <p className="mt-1 mb-3 text-[11.5px] text-slate-500 leading-relaxed font-normal">
        The metrics snapshot runs weekly. <b>Broke</b> notes the exact week a stock&apos;s financial metrics diverged from the frozen evidence.
      </p>

      {!anything ? (
        <div className="text-[12px] text-slate-400 py-2">
          No material evidence shifts recorded in this time window.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[560px]">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100 text-[10.5px] uppercase">
                <th className="text-left py-1 pr-3 font-medium">Week</th>
                <th className="text-left py-1 px-3 font-medium">Evidence Shifted</th>
                <th className="text-left py-1 px-3 font-medium">Turned Stale</th>
                <th className="text-left py-1 px-3 font-medium">Verdicts Written</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 font-normal">
              {weeks.map((w) => (
                <tr key={w.weekStart} className="hover:bg-slate-50/50">
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-slate-500">{shortDate(w.weekStart)}</td>
                  <td className="py-1.5 px-3">
                    {w.broke.length > 0 ? (
                      <span className="text-rose-600 font-medium">{w.broke.join(", ")}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-1.5 px-3">
                    {w.wentStale.length > 0 ? (
                      <span className="text-amber-700">{w.wentStale.join(", ")}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-1.5 px-3">
                    {w.written.length > 0 ? (
                      <span className="text-emerald-700">{w.written.join(", ")}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
