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
  Quote,
  Scale,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import type { ConcallDigest, ConcallNumberItem } from "@/lib/concallTypes";
import CapTierBadge, { type CapCategory } from "@/components/CapTierBadge";
import {
  ConcallAudioBar,
  type ActiveConcallAudio,
} from "@/components/ConcallAudioBar";
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
  periodLabel: string | null;
  salesCr: number | null;
  salesYoy: number | null;
  salesQoq: number | null;
  ebitdaCr: number | null;
  ebitdaYoy: number | null;
  opmPct: number | null;
  opmYoyBps: number | null;
  patCr: number | null;
  npYoy: number | null;
  roce3y: number | null;
  roe3y: number | null;
  opMargin3y: number | null;
  cfoPat3y: number | null;
  debtEquity: number | null;
  peTtm: number | null;
  evEbitdaTtm: number | null;
  audioAnnouncementId: string | null;
  cachedAudioUrl: string | null;
  cachedAudioKind: "audio" | "video" | "youtube" | "webcast" | null;
};

export type ConcallCalendarRow = {
  id: string;
  symbol: string;
  companyName: string;
  sector: string;
  marketCapCategory: string | null;
  compositePct: number | null;
  salesCr: number | null;
  salesYoy: number | null;
  ebitdaYoy: number | null;
  opmPct: number | null;
  opmYoyBps: number | null;
  npYoy: number | null;
  roce3y: number | null;
  peTtm: number | null;
  publishedAt: string;
  title: string;
  audioAnnouncementId: string | null;
  cachedAudioUrl: string | null;
  cachedAudioKind: "audio" | "video" | "youtube" | "webcast" | null;
  transcriptUrl: string | null;
  hasSummary: boolean;
  tone: "Optimistic" | "Neutral" | "Cautious" | null;
  quarterLabel: string | null;
  callMetrics: ConcallNumberItem[];
  topTakeaway: string | null;
};

type HubTab = "latest" | "upcoming" | "matrix" | "search";
type CompanyScope = "all" | "my_stocks" | "ai_ready" | "optimistic" | "cautious";

const THEME_PRESETS = [
  "Guidance",
  "Margins",
  "Order book",
  "Capex",
  "NIM",
  "AI",
  "Demand",
  "Exports",
  "Asset quality",
];

const TONE_PILL: Record<ConcallDigest["tone"], string> = {
  Optimistic: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Neutral: "bg-slate-100 text-slate-700 border-slate-200",
  Cautious: "bg-amber-50 text-amber-800 border-amber-200",
};

const CAT_PILL: Record<string, string> = {
  Guidance: "bg-indigo-50 text-indigo-800 border-indigo-200",
  Margins: "bg-sky-50 text-sky-800 border-sky-200",
  Capex: "bg-purple-50 text-purple-800 border-purple-200",
  "Order Book": "bg-teal-50 text-teal-800 border-teal-200",
  Demand: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Risk: "bg-rose-50 text-rose-800 border-rose-200",
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

function fmtCompactCr(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1000) return `₹${Math.round(v).toLocaleString("en-IN")} Cr`;
  return `₹${v.toFixed(0)} Cr`;
}

function fmtSignedPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function isFinancialSector(sector: string): boolean {
  return /bank|finance|financial|nbfc|insurance/i.test(sector);
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
  const [showQuotesInMatrix, setShowQuotesInMatrix] = useState(false);

  // Inline sticky audio player state
  const [activeAudio, setActiveAudio] = useState<ActiveConcallAudio | null>(null);

  // Cross-Concall Theme Search tab state
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
    for (const d of digests) if (d.sector) s.add(d.sector);
    return [...s].sort();
  }, [latestCalls, upcomingCalls, digests]);

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

  // Date-grouped stacked containers for Latest & Upcoming Concalls
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

  // Date-grouped stacked containers for Guidance vs Actuals
  const filteredGuidanceDateGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = digests.filter((d) => {
      if (sectorFilter !== "all" && d.sector !== sectorFilter) return false;
      if (companyScope === "my_stocks" && !mySet.has(d.symbol)) return false;
      if (companyScope === "optimistic" && d.tone !== "Optimistic") return false;
      if (companyScope === "cautious" && d.tone !== "Cautious") return false;
      if (q) {
        const hay = `${d.symbol} ${d.companyName} ${d.sector} ${d.industry}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const map = new Map<string, ConcallHubItem[]>();
    for (const d of filtered) {
      const dk = istDateKey(d.publishedAt);
      const list = map.get(dk) ?? [];
      list.push(d);
      map.set(dk, list);
    }
    return [...map.entries()].map(([dateKey, items]) => ({
      dateKey,
      label: fmtDateGroupLabel(dateKey, todayKey, yesterdayKey),
      items,
    }));
  }, [digests, sectorFilter, companyScope, mySet, query, todayKey, yesterdayKey]);

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
    <div className={`space-y-3.5 ${activeAudio ? "pb-36" : ""}`}>
      {/* Compact Top Header — bold title + small italic description */}
      <header className="space-y-2">
        <div>
          <h1 className="font-sans text-[20px] md:text-[22px] font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            Concall Calendar
            <Calendar size={19} className="text-slate-700" />
          </h1>
          <p className="text-[11.5px] italic text-slate-500 mt-0.5 leading-snug">
            Datewise earnings calls, inline audio recordings, official BSE transcripts &amp; quote-verified Guidance vs. Actuals ({totalArchiveCount.toLocaleString("en-IN")}+ filings)
          </p>
        </div>

        {/* Dedicated Full-Width Tab Row */}
        <div className="border-b border-slate-200 flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar">
          {(
            [
              {
                id: "latest",
                label: "Latest Concalls",
                count: latestCalls.length,
              },
              {
                id: "upcoming",
                label: "Upcoming Concalls",
                count: upcomingCalls.length,
              },
              {
                id: "matrix",
                label: "Guidance vs Actuals",
                count: digests.length,
              },
              {
                id: "search",
                label: "Topic Search",
                count: null,
              },
            ] as const
          ).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-[13.5px] whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  active
                    ? "border-slate-900 text-slate-900 font-semibold"
                    : "border-transparent text-slate-500 hover:text-slate-800 font-medium"
                }`}
              >
                <span>{t.label}</span>
                {t.count != null && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full font-mono text-[10.5px] ${
                      active
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Shared Filter Bar for Latest, Upcoming, AND Datewise Guidance vs Actuals */}
      {tab !== "search" && (
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <span className="text-[13.5px] font-semibold text-slate-800 mr-0.5">Filter:</span>

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
              {tab !== "matrix" && (
                <option value="ai_ready">✨ AI Summary Ready ({latestDigests.length})</option>
              )}
              <option value="optimistic">🟢 Optimistic Tone</option>
              <option value="cautious">🟡 Cautious Tone</option>
            </select>

            <div className="relative flex-1 min-w-[210px] max-w-xs">
              <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a company or symbol"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
              />
            </div>
          </div>

          {tab === "matrix" && (
            <button
              type="button"
              onClick={() => setShowQuotesInMatrix((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12.5px] font-medium transition-colors ${
                showQuotesInMatrix
                  ? "bg-indigo-50 border-indigo-200 text-indigo-800"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Quote size={13} />
              {showQuotesInMatrix ? "Hide Verbatim Quotes" : "Show Verbatim Quotes"}
            </button>
          )}
        </div>
      )}

      {/* ── TABS 1 & 2: DATE-STACKED LATEST & UPCOMING CONCALLS ──────────── */}
      {(tab === "latest" || tab === "upcoming") && (
        <div>
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
                    {group.items.map((row) => {
                      const isListening =
                        activeAudio?.announcementId != null &&
                        activeAudio.announcementId === row.audioAnnouncementId;
                      const finSector = isFinancialSector(row.sector);

                      return (
                        <div
                          key={row.id}
                          className="rounded-xl border border-slate-200/95 bg-white px-4 py-3.5 shadow-2xs hover:border-slate-300 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-3.5"
                        >
                          {/* Left: Company + Rich Multi-Metric Strip + Call-Discussed KPIs */}
                          <div className="min-w-0 space-y-1.5 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={
                                  row.hasSummary
                                    ? `/concall/${row.symbol}`
                                    : `/concall/${row.symbol}?tab=filings`
                                }
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

                            {/* Expanded Multi-Metric Financial Strip (Rev, EBITDA, OPM ±bps, PAT, ROCE, P/E) */}
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-slate-500">
                              <span className="inline-flex items-center gap-1 font-mono text-slate-600">
                                <Clock size={12} className="text-slate-400" />
                                {fmtIstTime(row.publishedAt)}
                              </span>
                              <span>· {row.sector}</span>

                              {row.salesYoy != null && (
                                <span className="font-mono">
                                  · {finSector ? "Income" : "Rev"}{" "}
                                  {row.salesCr != null ? `${fmtCompactCr(row.salesCr)} (` : ""}
                                  <strong
                                    className={
                                      row.salesYoy >= 0 ? "text-emerald-700" : "text-rose-700"
                                    }
                                  >
                                    {fmtSignedPct(row.salesYoy)}
                                  </strong>
                                  {row.salesCr != null ? ")" : ""}
                                </span>
                              )}

                              {!finSector && row.ebitdaYoy != null && (
                                <span className="font-mono">
                                  · EBITDA{" "}
                                  <strong
                                    className={
                                      row.ebitdaYoy >= 0 ? "text-emerald-700" : "text-rose-700"
                                    }
                                  >
                                    {fmtSignedPct(row.ebitdaYoy)}
                                  </strong>
                                </span>
                              )}

                              {row.opmPct != null && (
                                <span className="font-mono">
                                  · {finSector ? "Fin. Margin" : "OPM"}{" "}
                                  <strong className="text-slate-800">
                                    {row.opmPct.toFixed(1)}%
                                  </strong>
                                  {row.opmYoyBps != null && (
                                    <span
                                      className={`ml-1 text-[11px] ${
                                        row.opmYoyBps >= 0 ? "text-emerald-700" : "text-rose-700"
                                      }`}
                                    >
                                      ({row.opmYoyBps >= 0 ? "+" : ""}
                                      {row.opmYoyBps} bps)
                                    </span>
                                  )}
                                </span>
                              )}

                              {row.npYoy != null && (
                                <span className="font-mono">
                                  · PAT{" "}
                                  <strong
                                    className={
                                      row.npYoy >= 0 ? "text-emerald-700" : "text-rose-700"
                                    }
                                  >
                                    {fmtSignedPct(row.npYoy)}
                                  </strong>
                                </span>
                              )}

                              {row.roce3y != null && (
                                <span className="font-mono">
                                  · ROCE <strong className="text-slate-700">{row.roce3y.toFixed(0)}%</strong>
                                </span>
                              )}

                              {row.peTtm != null && row.peTtm > 0 && (
                                <span className="font-mono">
                                  · P/E <strong className="text-slate-700">{row.peTtm.toFixed(1)}x</strong>
                                </span>
                              )}
                            </div>

                            {/* Call-Specific Operational KPIs actually discussed on the call */}
                            {row.callMetrics.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                {row.callMetrics.map((m, idx) => (
                                  <span
                                    key={idx}
                                    title={m.quote ? `"${m.quote}"` : undefined}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100/90 border border-slate-200/80 text-[11px] text-slate-700"
                                  >
                                    <span className="text-slate-500">{m.metric}:</span>
                                    <strong className="font-mono text-slate-900">{m.value}</strong>
                                  </span>
                                ))}
                              </div>
                            )}

                            {row.topTakeaway && (
                              <p className="text-[12.5px] text-slate-600 line-clamp-1">
                                {row.topTakeaway}
                              </p>
                            )}
                          </div>

                          {/* Right: Inline Listen | Transcript PDF | Summary Buttons */}
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {row.audioAnnouncementId && (
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveAudio({
                                    announcementId: row.audioAnnouncementId!,
                                    symbol: row.symbol,
                                    companyName: row.companyName,
                                    quarterLabel: row.quarterLabel,
                                    preResolvedUrl: row.cachedAudioUrl,
                                    preResolvedKind: row.cachedAudioKind,
                                  })
                                }
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12.5px] font-medium transition-colors ${
                                  isListening
                                    ? "border-amber-400 bg-amber-50 text-amber-900 font-semibold"
                                    : "border-slate-200 bg-white hover:bg-amber-50/70 hover:border-amber-300 text-slate-800"
                                }`}
                              >
                                <Headphones size={14} className="text-amber-600" />
                                {isListening ? "Playing…" : "Listen"}
                              </button>
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
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: DATE-STACKED GUIDANCE VS DELIVERED ACTUALS ────────────── */}
      {tab === "matrix" && (
        <div className="space-y-5">
          {filteredGuidanceDateGroups.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-12 text-center text-[13.5px] text-slate-500">
              No summarized concalls match your filters.
            </div>
          ) : (
            filteredGuidanceDateGroups.map((group) => (
              <section
                key={group.dateKey}
                className="rounded-2xl bg-slate-100/75 border border-slate-200/90 p-4 md:p-5 space-y-3.5"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-[15.5px] font-bold text-slate-900 underline decoration-slate-400 underline-offset-4">
                    {group.label}
                  </h2>
                  <span className="text-[11.5px] font-medium text-slate-500">
                    {group.items.length} {group.items.length === 1 ? "company" : "companies"} · Guidance vs. Actuals
                  </span>
                </div>

                <div className="space-y-3.5">
                  {group.items.map((d) => {
                    const finSector = isFinancialSector(d.sector);
                    const guidanceHighlights = d.highlights.filter((h) =>
                      ["Guidance", "Margins", "Capex", "Order Book", "Demand"].includes(h.category),
                    );
                    const riskHighlights = d.highlights.filter((h) => h.category === "Risk");
                    const isListening =
                      activeAudio?.announcementId != null &&
                      activeAudio.announcementId === d.audioAnnouncementId;

                    return (
                      <article
                        key={d.id}
                        className="rounded-xl border border-slate-200/95 bg-white p-4 md:p-5 shadow-2xs space-y-4"
                      >
                        {/* Card Top Row: Company + Tone + QVM + Actions */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/concall/${d.symbol}`}
                              className="inline-flex items-center gap-0.5 text-[15.5px] font-bold text-slate-900 hover:text-indigo-700"
                            >
                              <span>{d.companyName}</span>
                              <ChevronRight size={15} className="text-slate-400" />
                            </Link>
                            <Link
                              href={`/stock/${d.symbol}`}
                              className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[11px] font-semibold text-slate-600 hover:text-indigo-700"
                            >
                              {d.symbol}
                            </Link>
                            {d.quarterLabel && (
                              <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-[11px] font-semibold">
                                {d.quarterLabel}
                              </span>
                            )}
                            <span
                              className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${TONE_PILL[d.tone]}`}
                            >
                              Tone: {d.tone}
                            </span>
                            {d.compositePct != null && (
                              <span
                                className="px-1.5 py-0.5 rounded font-mono text-[11px] font-bold"
                                style={{
                                  background: `color-mix(in srgb, ${bandColor(band(d.compositePct))} 15%, transparent)`,
                                  color: bandColor(band(d.compositePct)),
                                }}
                              >
                                QVM {Math.round(d.compositePct)}
                              </span>
                            )}
                            <span className="text-[12px] text-slate-500">· {d.sector}</span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {d.audioAnnouncementId && (
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveAudio({
                                    announcementId: d.audioAnnouncementId!,
                                    symbol: d.symbol,
                                    companyName: d.companyName,
                                    quarterLabel: d.quarterLabel,
                                    preResolvedUrl: d.cachedAudioUrl,
                                    preResolvedKind: d.cachedAudioKind,
                                  })
                                }
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12px] font-medium ${
                                  isListening
                                    ? "border-amber-400 bg-amber-50 text-amber-900 font-semibold"
                                    : "border-slate-200 bg-white hover:bg-amber-50/70 text-slate-800"
                                }`}
                              >
                                <Headphones size={13} className="text-amber-600" />
                                Listen
                              </button>
                            )}
                            {d.pdfUrl && (
                              <a
                                href={d.pdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50/70 text-[12px] font-medium text-slate-800"
                              >
                                <FileText size={13} className="text-emerald-600" />
                                Transcript
                              </a>
                            )}
                            <Link
                              href={`/concall/${d.symbol}?tab=guidance`}
                              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-[12px] font-semibold text-indigo-900"
                            >
                              <Sparkles size={13} className="text-indigo-600" />
                              5Q Deep Comparison
                            </Link>
                          </div>
                        </div>

                        {/* Side-by-Side Comparison: Left = Management Guidance & Call KPIs | Right = Delivered Multi-Metric Reality */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                          {/* LEFT (7 cols): What Management Guided / Stated on Concall */}
                          <div className="lg:col-span-7 rounded-xl border border-indigo-100 bg-indigo-50/25 p-3.5 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-indigo-900">
                                <Target size={13} className="text-indigo-600" />
                                Management Guidance &amp; Operational KPIs (Stated on Call)
                              </span>
                            </div>

                            {/* Call-stated numerical KPIs (NIM, TCV, ARPU, Order Book, Capex, Margins, etc.) */}
                            {d.numbersMentioned.length > 0 && (
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {d.numbersMentioned.slice(0, 6).map((n, idx) => (
                                  <div
                                    key={idx}
                                    className="rounded-lg border border-indigo-200/60 bg-white px-2.5 py-2"
                                  >
                                    <div className="text-[10.5px] text-slate-500 leading-tight truncate">
                                      {n.metric}
                                    </div>
                                    <div className="font-mono text-[13px] font-bold text-slate-900 mt-0.5">
                                      {n.value}
                                    </div>
                                    {showQuotesInMatrix && n.quote && (
                                      <p className="mt-1 pt-1 border-t border-slate-100 text-[10.5px] italic text-slate-500 leading-snug">
                                        &ldquo;{n.quote}&rdquo;
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Stated Guidance / Margin / Capex / Order Book / Risk Takeaways */}
                            <div className="space-y-1.5">
                              {(guidanceHighlights.length > 0 ? guidanceHighlights : d.highlights)
                                .slice(0, 4)
                                .map((h, idx) => (
                                  <div
                                    key={idx}
                                    className="rounded-lg bg-white border border-slate-200/80 px-3 py-2 text-[12.5px] text-slate-800"
                                  >
                                    <div className="flex items-start gap-2">
                                      <span
                                        className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${
                                          CAT_PILL[h.category] ?? "bg-slate-100 text-slate-700"
                                        }`}
                                      >
                                        {h.category}
                                      </span>
                                      <div className="min-w-0">
                                        <p className="leading-snug">{h.point}</p>
                                        {showQuotesInMatrix && h.quote && (
                                          <p className="mt-1 pl-2 border-l-2 border-indigo-200 text-[11px] italic text-slate-500">
                                            &ldquo;{h.quote}&rdquo;
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}

                              {riskHighlights[0] && (
                                <div className="rounded-lg bg-rose-50/50 border border-rose-200/70 px-3 py-2 text-[12px] text-slate-800 flex items-start gap-2">
                                  <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded border border-rose-200 bg-rose-50 text-rose-800 text-[10px] font-semibold">
                                    Watchpoint
                                  </span>
                                  <span>{riskHighlights[0].point}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* RIGHT (5 cols): Actual Delivered Multi-Metric Reality */}
                          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col justify-between space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-slate-800">
                                <Scale size={13} className="text-emerald-600" />
                                Delivered Financial Reality ({d.periodLabel || "Latest Qtr"})
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              {/* 1. Revenue / Income */}
                              <div className="rounded-lg bg-white border border-slate-200/90 p-2.5">
                                <div className="text-[10.5px] text-slate-500">
                                  {finSector ? "Interest / Total Income" : "Quarterly Revenue"}
                                </div>
                                <div className="font-mono text-[13.5px] font-bold text-slate-900 mt-0.5">
                                  {fmtCompactCr(d.salesCr)}
                                </div>
                                <div className="font-mono text-[11px] mt-0.5 flex flex-wrap gap-x-2">
                                  {d.salesYoy != null && (
                                    <span
                                      className={
                                        d.salesYoy >= 0 ? "text-emerald-700 font-semibold" : "text-rose-700 font-semibold"
                                      }
                                    >
                                      {fmtSignedPct(d.salesYoy)} YoY
                                    </span>
                                  )}
                                  {d.salesQoq != null && (
                                    <span className="text-slate-500">
                                      {fmtSignedPct(d.salesQoq)} QoQ
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* 2. EBITDA / Operating Profit */}
                              <div className="rounded-lg bg-white border border-slate-200/90 p-2.5">
                                <div className="text-[10.5px] text-slate-500">
                                  {finSector ? "Financing Profit" : "Operating Profit (EBITDA)"}
                                </div>
                                <div className="font-mono text-[13.5px] font-bold text-slate-900 mt-0.5">
                                  {fmtCompactCr(d.ebitdaCr)}
                                </div>
                                <div className="font-mono text-[11px] mt-0.5">
                                  {d.ebitdaYoy != null ? (
                                    <span
                                      className={
                                        d.ebitdaYoy >= 0
                                          ? "text-emerald-700 font-semibold"
                                          : "text-rose-700 font-semibold"
                                      }
                                    >
                                      {fmtSignedPct(d.ebitdaYoy)} YoY
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </div>
                              </div>

                              {/* 3. OPM % & YoY bps vs 3Y Avg */}
                              <div className="rounded-lg bg-white border border-slate-200/90 p-2.5">
                                <div className="text-[10.5px] text-slate-500">
                                  {finSector ? "Financing Margin" : "Operating Margin (OPM)"}
                                </div>
                                <div className="font-mono text-[13.5px] font-bold text-slate-900 mt-0.5">
                                  {d.opmPct != null ? `${d.opmPct.toFixed(1)}%` : "—"}
                                </div>
                                <div className="font-mono text-[11px] mt-0.5 flex flex-wrap gap-x-1.5">
                                  {d.opmYoyBps != null && (
                                    <span
                                      className={
                                        d.opmYoyBps >= 0
                                          ? "text-emerald-700 font-semibold"
                                          : "text-rose-700 font-semibold"
                                      }
                                    >
                                      {d.opmYoyBps >= 0 ? "+" : ""}
                                      {d.opmYoyBps} bps YoY
                                    </span>
                                  )}
                                  {d.opMargin3y != null && (
                                    <span className="text-slate-500">
                                      (3Y: {d.opMargin3y.toFixed(1)}%)
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* 4. Net Profit (PAT) */}
                              <div className="rounded-lg bg-white border border-slate-200/90 p-2.5">
                                <div className="text-[10.5px] text-slate-500">Net Profit (PAT)</div>
                                <div className="font-mono text-[13.5px] font-bold text-slate-900 mt-0.5">
                                  {fmtCompactCr(d.patCr)}
                                </div>
                                <div className="font-mono text-[11px] mt-0.5">
                                  {d.npYoy != null ? (
                                    <span
                                      className={
                                        d.npYoy >= 0
                                          ? "text-emerald-700 font-semibold"
                                          : "text-rose-700 font-semibold"
                                      }
                                    >
                                      {fmtSignedPct(d.npYoy)} YoY
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </div>
                              </div>

                              {/* 5. Capital Efficiency (ROCE / ROE) */}
                              <div className="rounded-lg bg-white border border-slate-200/90 p-2.5">
                                <div className="text-[10.5px] text-slate-500">Capital Return (3Y)</div>
                                <div className="font-mono text-[12.5px] font-bold text-slate-900 mt-0.5">
                                  ROCE {d.roce3y != null ? `${d.roce3y.toFixed(1)}%` : "—"}
                                </div>
                                <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                                  ROE {d.roe3y != null ? `${d.roe3y.toFixed(1)}%` : "—"}
                                </div>
                              </div>

                              {/* 6. Cash Conversion, Leverage & Valuation */}
                              <div className="rounded-lg bg-white border border-slate-200/90 p-2.5">
                                <div className="text-[10.5px] text-slate-500">
                                  Cash Flow &amp; Valuation
                                </div>
                                <div className="font-mono text-[12.5px] font-bold text-slate-900 mt-0.5">
                                  {d.peTtm != null && d.peTtm > 0 ? `P/E ${d.peTtm.toFixed(1)}x` : "P/E —"}
                                  {d.evEbitdaTtm != null && d.evEbitdaTtm > 0
                                    ? ` · EV/EB ${d.evEbitdaTtm.toFixed(1)}x`
                                    : ""}
                                </div>
                                <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                                  {d.cfoPat3y != null
                                    ? `CFO/PAT ${Math.round(d.cfoPat3y * 100)}%`
                                    : ""}
                                  {d.debtEquity != null ? ` · D/E ${d.debtEquity.toFixed(2)}` : ""}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      )}

      {/* ── TAB 4: CROSS-CONCALL TOPIC & THEME SEARCH ────────────────────── */}
      {tab === "search" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-3">
            <div>
              <div className="text-[13.5px] font-semibold text-slate-900">
                Cross-Company Concall Theme Scanner
              </div>
              <p className="text-[12.5px] text-slate-500 mt-0.5">
                Unlike company search, Topic Search scans <strong>inside spoken CEO/CFO commentary, numbers, and analyst Q&amp;A</strong> across companies to discover who is discussing a macro trend, sector tailwind, capex cycle, or risk.
              </p>
            </div>

            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={themeQuery}
                  onChange={(e) => setThemeQuery(e.target.value)}
                  placeholder="Type any topic, KPI, or macro theme (e.g. NIM, order book, capex, tariff, AI, rural demand, margin)…"
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
                Quick themes:
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

      {/* Sticky Inline Audio/Video/YouTube Player */}
      <ConcallAudioBar target={activeAudio} onClose={() => setActiveAudio(null)} />
    </div>
  );
}
