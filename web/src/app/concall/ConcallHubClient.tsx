"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Headphones,
  Search,
  Sparkles,
  Table as TableIcon,
} from "lucide-react";
import type { ConcallDigest } from "@/lib/concallTypes";
import CapTierBadge, { type CapCategory } from "@/components/CapTierBadge";
import { band, bandColor } from "@/lib/score";

export type ConcallHubItem = ConcallDigest & {
  companyName: string;
  sector: string;
  industry: string;
  marketCapCategory: string | null;
  ltp: number | null;
  marketCapCr: number | null;
  compositePct: number | null;
  qualityPct: number | null;
  valuationPct: number | null;
  momentumPct: number | null;
  salesYoy: number | null;
  npYoy: number | null;
};

export type ConcallCalendarRow = {
  id: string;
  symbol: string;
  companyName: string;
  sector: string;
  marketCapCategory: string | null;
  compositePct: number | null;
  salesYoy: number | null;
  npYoy: number | null;
  publishedAt: string;
  title: string;
  audioUrl: string | null;
  transcriptUrl: string | null;
  hasSummary: boolean;
  tone: "Optimistic" | "Neutral" | "Cautious" | null;
  quarterLabel: string | null;
  topTakeaway: string | null;
};

type HubTab = "latest" | "upcoming" | "search" | "matrix";
type CompanyScope = "all" | "my_stocks" | "ai_ready" | "optimistic" | "cautious";

const THEME_PRESETS = [
  "Guidance",
  "Margins",
  "Order book",
  "Capex",
  "AI",
  "Demand",
  "Exports",
  "Raw material",
];

const TONE_PILL: Record<ConcallDigest["tone"], string> = {
  Optimistic: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Neutral: "bg-slate-100 text-slate-700 border-slate-200",
  Cautious: "bg-amber-50 text-amber-800 border-amber-200",
};

function istDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function fmtIstTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .toUpperCase();
}

function fmtDateGroupLabel(dateKey: string, todayKey: string, yesterdayKey: string): string {
  const d = new Date(`${dateKey}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return dateKey;
  const short = d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    ...(dateKey.slice(0, 4) !== todayKey.slice(0, 4) ? { year: "numeric" } : {}),
  });
  if (dateKey === todayKey) return `${short} (Today)`;
  if (dateKey === yesterdayKey) return `${short} (Yesterday)`;
  return short;
}

function fmtCr(v: number | null): string {
  if (v == null) return "—";
  return `₹${Math.round(v).toLocaleString("en-IN")} Cr`;
}

export function ConcallHubClient({
  latestCalls,
  upcomingCalls,
  digests,
  totalArchiveCount,
  mySymbols,
  signedIn,
}: {
  latestCalls: ConcallCalendarRow[];
  upcomingCalls: ConcallCalendarRow[];
  digests: ConcallHubItem[];
  totalArchiveCount: number;
  mySymbols: string[];
  signedIn: boolean;
}) {
  const [tab, setTab] = useState<HubTab>("latest");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [companyScope, setCompanyScope] = useState<CompanyScope>("all");
  const [query, setQuery] = useState("");

  // Cross-Concall Search tab state
  const [themeQuery, setThemeQuery] = useState("Guidance");
  const [minQuality, setMinQuality] = useState<number>(0);

  const mySet = useMemo(() => new Set(mySymbols), [mySymbols]);

  const { todayKey, yesterdayKey } = useMemo(() => {
    const now = new Date();
    const yest = new Date(now.getTime() - 86400 * 1000);
    return {
      todayKey: istDateKey(now.toISOString()),
      yesterdayKey: istDateKey(yest.toISOString()),
    };
  }, []);

  const sectors = useMemo(() => {
    const s = new Set<string>();
    for (const c of latestCalls) if (c.sector) s.add(c.sector);
    for (const c of upcomingCalls) if (c.sector) s.add(c.sector);
    return [...s].sort();
  }, [latestCalls, upcomingCalls]);

  const latestDigests = useMemo(() => {
    const seen = new Set<string>();
    const out: ConcallHubItem[] = [];
    for (const d of digests) {
      if (seen.has(d.symbol)) continue;
      seen.add(d.symbol);
      out.push(d);
    }
    return out;
  }, [digests]);

  const activeRows = tab === "upcoming" ? upcomingCalls : latestCalls;

  const filteredCalendarRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activeRows.filter((r) => {
      if (sectorFilter !== "all" && r.sector !== sectorFilter) return false;
      if (companyScope === "my_stocks" && !mySet.has(r.symbol)) return false;
      if (companyScope === "ai_ready" && !r.hasSummary) return false;
      if (companyScope === "optimistic" && r.tone !== "Optimistic") return false;
      if (companyScope === "cautious" && r.tone !== "Cautious") return false;
      if (q) {
        const hay = `${r.symbol} ${r.companyName} ${r.sector} ${r.title}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeRows, sectorFilter, companyScope, mySet, query]);

  // Group filtered calendar rows by IST date (datewise stacked cards)
  const dateGroups = useMemo(() => {
    const map = new Map<string, ConcallCalendarRow[]>();
    for (const r of filteredCalendarRows) {
      const dk = istDateKey(r.publishedAt);
      const list = map.get(dk) ?? [];
      list.push(r);
      map.set(dk, list);
    }
    return [...map.entries()].map(([dateKey, items]) => ({
      dateKey,
      label: fmtDateGroupLabel(dateKey, todayKey, yesterdayKey),
      items,
    }));
  }, [filteredCalendarRows, todayKey, yesterdayKey]);

  const themeMatches = useMemo(() => {
    const q = themeQuery.trim().toLowerCase();
    if (!q) return [];
    const out: {
      item: ConcallHubItem;
      snippets: { tag: string; text: string; quote: string }[];
    }[] = [];

    for (const d of digests) {
      if (minQuality > 0 && (d.qualityPct ?? 0) < minQuality) continue;
      if (companyScope === "my_stocks" && !mySet.has(d.symbol)) continue;
      const snippets: { tag: string; text: string; quote: string }[] = [];

      for (const n of d.numbersMentioned) {
        if (
          n.metric.toLowerCase().includes(q) ||
          n.value.toLowerCase().includes(q) ||
          n.quote.toLowerCase().includes(q)
        ) {
          snippets.push({ tag: n.metric, text: n.value, quote: n.quote });
        }
      }
      for (const h of d.highlights) {
        if (
          h.category.toLowerCase().includes(q) ||
          h.point.toLowerCase().includes(q) ||
          h.quote.toLowerCase().includes(q)
        ) {
          snippets.push({ tag: h.category, text: h.point, quote: h.quote });
        }
      }
      for (const qa of d.qaHighlights) {
        if (
          qa.topic.toLowerCase().includes(q) ||
          qa.question.toLowerCase().includes(q) ||
          qa.answer.toLowerCase().includes(q) ||
          qa.quote.toLowerCase().includes(q)
        ) {
          snippets.push({ tag: `Q&A · ${qa.topic}`, text: qa.answer, quote: qa.quote });
        }
      }

      if (snippets.length > 0) {
        out.push({ item: d, snippets: snippets.slice(0, 4) });
      }
    }
    return out;
  }, [digests, themeQuery, minQuality, companyScope, mySet]);

  return (
    <div className="space-y-6">
      {/* Header matching Concall Calendar aesthetic + EquityRoots metrics */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div>
          <h1 className="font-display text-[24px] md:text-[28px] font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            Concall Calendar
            <Calendar size={22} className="text-slate-700" />
          </h1>
          <p className="text-[13.5px] text-slate-500 mt-0.5">
            Transcripts, Recordings, Quote-Verified AI Analysis &amp; Guidance vs. Actuals ({totalArchiveCount.toLocaleString("en-IN")}+ filings)
          </p>
        </div>

        {/* Segmented Tab Switcher */}
        <div className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
          {(
            [
              { id: "latest", label: "Latest Concalls" },
              { id: "upcoming", label: "Upcoming Concalls" },
              { id: "search", label: "🔎 Topic Search" },
              { id: "matrix", label: "📊 Guidance vs Actuals" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-all ${
                tab === t.id
                  ? "bg-white text-slate-900 font-semibold shadow-2xs border-b-2 border-slate-900"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* ── CALENDAR VIEWS: LATEST CONCALLS & UPCOMING CONCALLS ──────────── */}
      {(tab === "latest" || tab === "upcoming") && (
        <div className="space-y-5">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[13.5px] font-semibold text-slate-800 mr-1">Filter:</span>

            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-[13px] font-medium text-slate-800 focus:outline-none focus:border-slate-400"
            >
              <option value="all">All Sectors</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              value={companyScope}
              onChange={(e) => setCompanyScope(e.target.value as CompanyScope)}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-[13px] font-medium text-slate-800 focus:outline-none focus:border-slate-400"
            >
              <option value="all">All Companies</option>
              {signedIn && mySymbols.length > 0 && (
                <option value="my_stocks">★ My Portfolio &amp; Watchlist ({mySymbols.length})</option>
              )}
              <option value="ai_ready">✨ AI Summary Ready ({latestDigests.length})</option>
              <option value="optimistic">🟢 Optimistic Tone</option>
              <option value="cautious">🟡 Cautious Tone</option>
            </select>

            <div className="relative flex-1 min-w-[220px] max-w-xs">
              <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a company"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
              />
            </div>
          </div>

          {/* Date-Grouped Stacked Containers */}
          {dateGroups.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-12 text-center text-[13.5px] text-slate-500">
              No {tab === "upcoming" ? "upcoming" : "recent"} concalls match your filters.
            </div>
          ) : (
            <div className="space-y-5">
              {dateGroups.map((group) => (
                <section
                  key={group.dateKey}
                  className="rounded-2xl bg-slate-100/75 border border-slate-200/90 p-4 md:p-5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-[15.5px] font-bold text-slate-900 underline decoration-slate-400 underline-offset-4">
                      {group.label}
                    </h2>
                    <span className="text-[11.5px] font-medium text-slate-500">
                      {group.items.length} {group.items.length === 1 ? "company" : "companies"}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {group.items.map((row) => (
                      <div
                        key={row.id}
                        className="rounded-xl border border-slate-200/95 bg-white px-4 py-3.5 shadow-2xs hover:border-slate-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        {/* Left: Company Name + Time + EquityRoots Fundamentals */}
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={row.hasSummary ? `/concall/${row.symbol}` : `/stock/${row.symbol}`}
                              className="inline-flex items-center gap-0.5 text-[15px] font-semibold text-slate-900 hover:text-indigo-700 transition-colors"
                            >
                              <span>{row.companyName}</span>
                              <ChevronRight size={15} className="text-slate-400" />
                            </Link>

                            <Link
                              href={`/stock/${row.symbol}`}
                              className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[11px] font-semibold text-slate-600 hover:text-indigo-700"
                            >
                              {row.symbol}
                            </Link>

                            {row.marketCapCategory && (
                              <CapTierBadge category={row.marketCapCategory as CapCategory} />
                            )}

                            {row.quarterLabel && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white font-mono text-[10.5px] font-semibold">
                                {row.quarterLabel}
                              </span>
                            )}

                            {row.tone && (
                              <span
                                className={`px-2 py-0.5 rounded-full border text-[10.5px] font-semibold ${TONE_PILL[row.tone]}`}
                              >
                                {row.tone}
                              </span>
                            )}

                            {row.compositePct != null && (
                              <span
                                title="EquityRoots Q/V/M Composite Percentile"
                                className="px-1.5 py-0.5 rounded font-mono text-[11px] font-bold"
                                style={{
                                  background: `color-mix(in srgb, ${bandColor(band(row.compositePct))} 15%, transparent)`,
                                  color: bandColor(band(row.compositePct)),
                                }}
                              >
                                QVM {Math.round(row.compositePct)}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500">
                            <span className="inline-flex items-center gap-1 font-mono text-slate-600">
                              <Clock size={12} className="text-slate-400" />
                              {fmtIstTime(row.publishedAt)}
                            </span>
                            <span>· {row.sector}</span>
                            {row.salesYoy != null && (
                              <span className="font-mono">
                                · Sales{" "}
                                <strong
                                  className={
                                    row.salesYoy >= 0 ? "text-emerald-700" : "text-rose-700"
                                  }
                                >
                                  {row.salesYoy >= 0 ? "+" : ""}
                                  {row.salesYoy.toFixed(1)}%
                                </strong>
                              </span>
                            )}
                            {row.npYoy != null && (
                              <span className="font-mono">
                                · PAT{" "}
                                <strong
                                  className={row.npYoy >= 0 ? "text-emerald-700" : "text-rose-700"}
                                >
                                  {row.npYoy >= 0 ? "+" : ""}
                                  {row.npYoy.toFixed(1)}%
                                </strong>
                              </span>
                            )}
                          </div>

                          {row.topTakeaway && (
                            <p className="text-[12.5px] text-slate-600 line-clamp-1 pt-0.5">
                              {row.topTakeaway}
                            </p>
                          )}
                        </div>

                        {/* Right: Listen | Transcript | Summary Action Buttons */}
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {row.audioUrl && (
                            <a
                              href={row.audioUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-amber-50/70 hover:border-amber-300 text-[12.5px] font-medium text-slate-800 transition-colors"
                            >
                              <Headphones size={14} className="text-amber-600" />
                              Listen
                            </a>
                          )}

                          {row.transcriptUrl && (
                            <a
                              href={row.transcriptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50/70 hover:border-emerald-300 text-[12.5px] font-medium text-slate-800 transition-colors"
                            >
                              <FileText size={14} className="text-emerald-600" />
                              {tab === "upcoming" ? "Schedule" : "Transcript"}
                            </a>
                          )}

                          {row.hasSummary ? (
                            <Link
                              href={`/concall/${row.symbol}`}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-[12.5px] font-semibold text-indigo-900 transition-colors"
                            >
                              <Sparkles size={14} className="text-indigo-600" />
                              Summary
                            </Link>
                          ) : (
                            <Link
                              href={`/concall/${row.symbol}?tab=filings`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-[12.5px] font-medium text-slate-600 transition-colors"
                            >
                              <Sparkles size={13} className="text-slate-400" />
                              Filings
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: CROSS-CONCALL KEYWORD & THEME SEARCH ──────────────────── */}
      {tab === "search" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-3">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={themeQuery}
                  onChange={(e) => setThemeQuery(e.target.value)}
                  placeholder="Search across all concall guidance, Q&A, and verbatim quotes (e.g. AI, order book, capex, margins)…"
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-[13.5px] focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="text-[12px] text-slate-500 whitespace-nowrap">Min Quality:</label>
                <select
                  value={minQuality}
                  onChange={(e) => setMinQuality(Number(e.target.value))}
                  className="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-[12.5px]"
                >
                  <option value={0}>Any Score</option>
                  <option value={50}>Quality ≥ 50</option>
                  <option value={70}>Quality ≥ 70</option>
                  <option value={85}>Quality ≥ 85</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mr-1">
                Popular themes:
              </span>
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setThemeQuery(preset)}
                  className={`px-2.5 py-0.5 rounded-full text-[11.5px] font-medium border transition-colors ${
                    themeQuery.toLowerCase() === preset.toLowerCase()
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {themeMatches.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 text-[13px]">
              No concall mentions found for &ldquo;{themeQuery}&rdquo;.
            </div>
          ) : (
            <div className="space-y-3">
              {themeMatches.map(({ item, snippets }) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/concall/${item.symbol}`}
                        className="font-semibold text-[14.5px] text-slate-900 hover:text-indigo-700"
                      >
                        {item.companyName}
                      </Link>
                      <span className="font-mono text-[11.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        {item.symbol}
                      </span>
                      {item.quarterLabel && (
                        <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-[10.5px] font-semibold">
                          {item.quarterLabel}
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[10.5px] font-semibold ${TONE_PILL[item.tone]}`}
                      >
                        {item.tone}
                      </span>
                    </div>
                    <Link
                      href={`/concall/${item.symbol}`}
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-700 hover:underline"
                    >
                      Open Summary <ExternalLink size={11} />
                    </Link>
                  </div>

                  <div className="space-y-2">
                    {snippets.map((s, idx) => (
                      <div key={idx} className="rounded-xl bg-slate-50/80 border border-slate-200/70 p-3">
                        <div className="text-[11px] font-semibold text-indigo-800 mb-0.5">
                          {s.tag}
                        </div>
                        <div className="text-[13px] text-slate-900">{s.text}</div>
                        {s.quote && (
                          <div className="mt-1 text-[11.5px] italic text-slate-500">
                            &ldquo;{s.quote}&rdquo;
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 4: GUIDANCE VS DELIVERED ACTUALS MATRIX ──────────────────── */}
      {tab === "matrix" && (
        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
              <TableIcon size={15} className="text-indigo-600" />
              Stated Management Guidance vs. Delivered Quarterly Actuals
            </div>
            <span className="text-[11.5px] text-slate-500">
              Factual comparison · No investment advice
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Company</th>
                  <th className="py-2.5 px-3">Quarter</th>
                  <th className="py-2.5 px-3">Tone</th>
                  <th className="py-2.5 px-3">Key Figures / Guidance Stated</th>
                  <th className="py-2.5 px-3 text-right">Actual Sales YoY</th>
                  <th className="py-2.5 px-3 text-right">Actual PAT YoY</th>
                  <th className="py-2.5 px-3 text-center">Q/V/M</th>
                  <th className="py-2.5 px-4 text-right">M-Cap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {latestDigests.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <Link
                        href={`/concall/${d.symbol}`}
                        className="font-semibold text-slate-900 hover:text-indigo-700"
                      >
                        {d.companyName}
                      </Link>
                      <div className="font-mono text-[11px] text-slate-500">{d.symbol}</div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[12px] whitespace-nowrap">
                      {d.quarterLabel || "Latest"}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${TONE_PILL[d.tone]}`}
                      >
                        {d.tone}
                      </span>
                    </td>
                    <td className="py-3 px-3 max-w-md">
                      {d.numbersMentioned.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {d.numbersMentioned.slice(0, 3).map((n, idx) => (
                            <span
                              key={idx}
                              title={n.quote}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-[11.5px] text-slate-800"
                            >
                              <span className="text-slate-500">{n.metric}:</span>
                              <strong className="font-mono">{n.value}</strong>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500 text-[12px]">
                          {d.highlights[0]?.point ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold whitespace-nowrap">
                      {d.salesYoy != null ? (
                        <span className={d.salesYoy >= 0 ? "text-emerald-700" : "text-rose-700"}>
                          {d.salesYoy >= 0 ? "+" : ""}
                          {d.salesYoy.toFixed(1)}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold whitespace-nowrap">
                      {d.npYoy != null ? (
                        <span className={d.npYoy >= 0 ? "text-emerald-700" : "text-rose-700"}>
                          {d.npYoy >= 0 ? "+" : ""}
                          {d.npYoy.toFixed(1)}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-bold">
                      {d.compositePct != null ? Math.round(d.compositePct) : "—"}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-[12px] text-slate-600 whitespace-nowrap">
                      {fmtCr(d.marketCapCr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
