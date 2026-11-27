"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Mic,
  Search,
  Sparkles,
  Table as TableIcon,
  Volume2,
} from "lucide-react";
import type { ConcallDigest } from "@/lib/concallTypes";
import { ConcallDigestCard } from "@/components/ConcallDigestCard";
import CapTierBadge, { type CapCategory } from "@/components/CapTierBadge";
import { WatchlistButton } from "@/components/WatchlistButton";
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

export type ConcallFilingRow = {
  id: string;
  symbol: string;
  companyName: string;
  sector: string;
  title: string;
  publishedAt: string;
  pdfUrl: string | null;
  hasDigest: boolean;
};

type HubTab = "digests" | "search" | "matrix" | "filings";
type ToneFilter = "all" | "Optimistic" | "Neutral" | "Cautious";

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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtCr(v: number | null): string {
  if (v == null) return "—";
  return `₹${Math.round(v).toLocaleString("en-IN")} Cr`;
}

export function ConcallHubClient({
  digests,
  filings,
  totalArchiveCount,
  mySymbols,
  signedIn,
}: {
  digests: ConcallHubItem[];
  filings: ConcallFilingRow[];
  totalArchiveCount: number;
  mySymbols: string[];
  signedIn: boolean;
}) {
  const [tab, setTab] = useState<HubTab>("digests");
  const [toneFilter, setToneFilter] = useState<ToneFilter>("all");
  const [myOnly, setMyOnly] = useState(false);
  const [sectorFilter, setSectorFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>(() =>
    digests[0] ? { [digests[0].id]: true } : {},
  );

  // Cross-Concall Search tab state
  const [themeQuery, setThemeQuery] = useState("Guidance");
  const [minQuality, setMinQuality] = useState<number>(0);

  // Filings tab state
  const [filingKind, setFilingKind] = useState<"all" | "transcript" | "audio">("all");
  const [filingSearch, setFilingSearch] = useState("");

  const mySet = useMemo(() => new Set(mySymbols), [mySymbols]);

  const sectors = useMemo(() => {
    const s = new Set<string>();
    for (const d of digests) if (d.sector) s.add(d.sector);
    return [...s].sort();
  }, [digests]);

  // Group digests by symbol so multi-quarter history passes cleanly into ConcallDigestCard
  const digestsBySymbol = useMemo(() => {
    const m = new Map<string, ConcallHubItem[]>();
    for (const d of digests) {
      const list = m.get(d.symbol) ?? [];
      list.push(d);
      m.set(d.symbol, list);
    }
    return m;
  }, [digests]);

  // Latest digest per symbol for the main feed & matrix
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

  const filteredDigests = useMemo(() => {
    const q = query.trim().toLowerCase();
    return latestDigests.filter((d) => {
      if (toneFilter !== "all" && d.tone !== toneFilter) return false;
      if (myOnly && !mySet.has(d.symbol)) return false;
      if (sectorFilter !== "all" && d.sector !== sectorFilter) return false;
      if (q) {
        const hay = `${d.symbol} ${d.companyName} ${d.sector} ${d.industry}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [latestDigests, toneFilter, myOnly, mySet, sectorFilter, query]);

  // Cross-concall keyword search matches
  const themeMatches = useMemo(() => {
    const q = themeQuery.trim().toLowerCase();
    if (!q) return [];
    const out: {
      item: ConcallHubItem;
      snippets: { tag: string; text: string; quote: string }[];
    }[] = [];

    for (const d of digests) {
      if (minQuality > 0 && (d.qualityPct ?? 0) < minQuality) continue;
      if (myOnly && !mySet.has(d.symbol)) continue;
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
  }, [digests, themeQuery, minQuality, myOnly, mySet]);

  const filteredFilings = useMemo(() => {
    const q = filingSearch.trim().toLowerCase();
    return filings.filter((f) => {
      const isAudio = /audio|video|recording/i.test(f.title);
      if (filingKind === "audio" && !isAudio) return false;
      if (filingKind === "transcript" && isAudio) return false;
      if (myOnly && !mySet.has(f.symbol)) return false;
      if (q) {
        const hay = `${f.symbol} ${f.companyName} ${f.sector} ${f.title}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [filings, filingKind, filingSearch, myOnly, mySet]);

  const optCount = latestDigests.filter((d) => d.tone === "Optimistic").length;
  const neuCount = latestDigests.filter((d) => d.tone === "Neutral").length;
  const cauCount = latestDigests.filter((d) => d.tone === "Cautious").length;

  return (
    <div className="space-y-5">
      {/* Page Header & Feature Strip */}
      <header className="pb-4 border-b hairline flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 mb-1">
            <Sparkles size={13} /> Quote-Verified Earnings Intelligence
          </div>
          <h1 className="font-display text-[22px] md:text-[26px] font-semibold tracking-tight leading-tight">
            Concall Intelligence Hub
          </h1>
          <p className="muted-text text-[13px] mt-1 max-w-2xl">
            Every stated guidance figure, margin driver, capex plan, and analyst Q&amp;A is programmatically verified against verbatim quotes in the BSE transcript — paired with EquityRoots Q/V/M scores and delivered quarterly actuals.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2.5 shrink-0">
          <div className="card px-3.5 py-2 text-center">
            <div className="font-mono text-[16px] font-bold text-slate-900">
              {latestDigests.length.toLocaleString("en-IN")}
            </div>
            <div className="text-[10.5px] muted-text">AI Digests</div>
          </div>
          <div className="card px-3.5 py-2 text-center">
            <div className="font-mono text-[16px] font-bold text-emerald-700">100%</div>
            <div className="text-[10.5px] muted-text">Quote-Verified</div>
          </div>
          <div className="card px-3.5 py-2 text-center">
            <div className="font-mono text-[16px] font-bold text-indigo-700">
              {totalArchiveCount.toLocaleString("en-IN")}
            </div>
            <div className="text-[10.5px] muted-text">BSE Filings</div>
          </div>
        </div>
      </header>

      {/* Feature Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b hairline">
        <div className="flex items-center gap-1 overflow-x-auto">
          {(
            [
              { id: "digests", label: "🎙️ Concall Digests", count: latestDigests.length },
              { id: "search", label: "🔎 Cross-Concall Search" },
              { id: "matrix", label: "📊 Guidance vs Actuals" },
              { id: "filings", label: "📁 Exchange Transcripts", count: filings.length },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative px-3.5 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
                tab === t.id ? "text-[var(--color-accent-700)] font-semibold" : "muted-text hover:text-[var(--color-ink)]"
              }`}
            >
              {t.label}
              {"count" in t && t.count !== undefined && (
                <span className="ml-1.5 text-[11px] tabular-nums muted-text">({t.count})</span>
              )}
              {tab === t.id && (
                <span
                  className="absolute left-0 right-0 -bottom-px h-[2px]"
                  style={{ background: "var(--color-accent-600)" }}
                />
              )}
            </button>
          ))}
        </div>

        {signedIn && mySymbols.length > 0 && (
          <button
            type="button"
            onClick={() => setMyOnly((v) => !v)}
            className={`px-3 py-1 rounded-full text-[12px] font-medium border transition-colors mb-1.5 ${
              myOnly
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            ★ My Portfolio &amp; Watchlist ({mySymbols.length})
          </button>
        )}
      </div>

      {/* ── TAB 1: AI CONCALL DIGESTS ────────────────────────────────────── */}
      {tab === "digests" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "all", label: `All (${latestDigests.length})` },
                  { id: "Optimistic", label: `🟢 Optimistic (${optCount})` },
                  { id: "Neutral", label: `⚪ Neutral (${neuCount})` },
                  { id: "Cautious", label: `🟡 Cautious (${cauCount})` },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setToneFilter(p.id)}
                  className={`px-3 py-1 rounded-full text-[12px] font-medium border transition-colors ${
                    toneFilter === p.id
                      ? "bg-[var(--color-accent-600)] text-white border-transparent"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] text-slate-700"
              >
                <option value="all">All Sectors</option>
                {sectors.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter symbol or company…"
                  className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] w-52 focus:outline-none focus:border-indigo-400"
                />
              </div>
            </div>
          </div>

          {filteredDigests.length === 0 ? (
            <div className="card p-10 text-center muted-text text-[13px]">
              No concall digests match the selected filters yet.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDigests.map((d) => {
                const isOpen = Boolean(expandedIds[d.id]);
                const allForSym = digestsBySymbol.get(d.symbol) ?? [d];
                return (
                  <div key={d.id} className="card overflow-hidden border hairline">
                    {/* Summary Bar */}
                    <div
                      onClick={() => setExpandedIds((p) => ({ ...p, [d.id]: !isOpen }))}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 cursor-pointer hover:bg-slate-50/70 transition-colors"
                    >
                      <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                        <Link
                          href={`/stock/${d.symbol}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono font-bold text-[14px] text-indigo-700 hover:underline"
                        >
                          {d.symbol}
                        </Link>
                        <span className="font-medium text-[13.5px] text-slate-900 truncate max-w-[240px]">
                          {d.companyName}
                        </span>
                        {d.marketCapCategory && (
                          <CapTierBadge category={d.marketCapCategory as CapCategory} />
                        )}
                        {d.quarterLabel && (
                          <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-[11px] font-semibold">
                            {d.quarterLabel}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${TONE_PILL[d.tone]}`}
                        >
                          {d.tone}
                        </span>
                        <span className="text-[11.5px] muted-text hidden md:inline">
                          · {d.sector}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {d.compositePct != null && (
                          <span
                            title="EquityRoots Q/V/M Composite Score"
                            className="inline-flex items-center justify-center px-2 py-0.5 rounded font-mono text-[11.5px] font-bold"
                            style={{
                              background: `color-mix(in srgb, ${bandColor(band(d.compositePct))} 16%, transparent)`,
                              color: bandColor(band(d.compositePct)),
                            }}
                          >
                            QVM {Math.round(d.compositePct)}
                          </span>
                        )}
                        <div onClick={(e) => e.stopPropagation()}>
                          <WatchlistButton symbol={d.symbol} variant="icon" />
                        </div>
                        <span className="text-slate-400">
                          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </span>
                      </div>
                    </div>

                    {/* Preview bullets when collapsed */}
                    {!isOpen && d.highlights[0] && (
                      <div className="px-4 pb-3 pt-0 text-[12.5px] text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="truncate max-w-3xl">
                          <strong className="text-slate-800">{d.highlights[0].category}:</strong>{" "}
                          {d.highlights[0].point}
                        </span>
                      </div>
                    )}

                    {/* Expanded Full ConcallDigestCard */}
                    {isOpen && (
                      <div className="border-t hairline p-3 bg-slate-50/40">
                        <ConcallDigestCard concalls={allForSym} symbol={d.symbol} compact />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: CROSS-CONCALL KEYWORD & THEME SEARCH ──────────────────── */}
      {tab === "search" && (
        <div className="space-y-4">
          <div className="card p-4 md:p-5 space-y-3">
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
                <label className="text-[12px] muted-text whitespace-nowrap">Min Quality:</label>
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
              <span className="text-[11px] uppercase tracking-wider muted-text font-semibold mr-1">
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
            <div className="card p-10 text-center muted-text text-[13px]">
              No concall mentions found for &ldquo;{themeQuery}&rdquo;.
            </div>
          ) : (
            <div className="space-y-3">
              {themeMatches.map(({ item, snippets }) => (
                <div key={item.id} className="card p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b hairline">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/stock/${item.symbol}`}
                        className="font-mono font-bold text-[14px] text-indigo-700 hover:underline"
                      >
                        {item.symbol}
                      </Link>
                      <span className="text-[13px] font-medium text-slate-800">
                        {item.companyName}
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
                    <div className="flex items-center gap-2 text-[11.5px] muted-text">
                      {item.qualityPct != null && (
                        <span className="font-mono font-semibold text-slate-700">
                          Quality {Math.round(item.qualityPct)}
                        </span>
                      )}
                      {item.pdfUrl && (
                        <a
                          href={item.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
                        >
                          PDF <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {snippets.map((s, idx) => (
                      <div key={idx} className="rounded-lg bg-slate-50/80 border border-slate-200/70 p-3">
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

      {/* ── TAB 3: GUIDANCE VS DELIVERED ACTUALS MATRIX ──────────────────── */}
      {tab === "matrix" && (
        <div className="card overflow-hidden border hairline">
          <div className="px-4 py-3 border-b hairline bg-slate-50/70 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
              <TableIcon size={15} className="text-indigo-600" />
              Stated Management Guidance vs. Delivered Quarterly Actuals
            </div>
            <span className="text-[11.5px] muted-text">
              Factual comparison · No investment advice
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-slate-50 border-b hairline text-[11px] uppercase tracking-wider muted-text">
                <tr>
                  <th className="py-2.5 px-4">Company</th>
                  <th className="py-2.5 px-3">Quarter</th>
                  <th className="py-2.5 px-3">Tone</th>
                  <th className="py-2.5 px-3">Key Figures / Guidance Stated</th>
                  <th className="py-2.5 px-3 text-right">Actual Sales YoY</th>
                  <th className="py-2.5 px-3 text-right">Actual PAT YoY</th>
                  <th className="py-2.5 px-3 text-center">Q/V/M</th>
                  <th className="py-2.5 px-3 text-right">M-Cap</th>
                </tr>
              </thead>
              <tbody className="divide-y hairline">
                {latestDigests.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <Link
                        href={`/stock/${d.symbol}`}
                        className="font-mono font-bold text-indigo-700 hover:underline"
                      >
                        {d.symbol}
                      </Link>
                      <div className="text-[11px] muted-text truncate max-w-[180px]">
                        {d.companyName}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[12px] whitespace-nowrap">
                      {d.quarterLabel || fmtDate(d.publishedAt)}
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
                    <td className="py-3 px-3 text-right font-mono text-[12px] text-slate-600 whitespace-nowrap">
                      {fmtCr(d.marketCapCr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 4: RAW BSE EXCHANGE TRANSCRIPTS & AUDIO RECORDINGS ───────── */}
      {tab === "filings" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {(
                [
                  { id: "all", label: "All Concall Filings" },
                  { id: "transcript", label: "Written Transcripts" },
                  { id: "audio", label: "Audio / Video Links" },
                ] as const
              ).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setFilingKind(k.id)}
                  className={`px-3 py-1 rounded-full text-[12px] font-medium border transition-colors ${
                    filingKind === k.id
                      ? "bg-[var(--color-accent-600)] text-white border-transparent"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={filingSearch}
                onChange={(e) => setFilingSearch(e.target.value)}
                placeholder="Search symbol or filing title…"
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] w-60 focus:outline-none focus:border-indigo-400"
              />
            </div>
          </div>

          <div className="card overflow-hidden border hairline">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead className="bg-slate-50 border-b hairline text-[11px] uppercase tracking-wider muted-text">
                  <tr>
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-3">Stock</th>
                    <th className="py-2.5 px-3">Exchange Filing Headline</th>
                    <th className="py-2.5 px-3 text-center">AI Digest</th>
                    <th className="py-2.5 px-4 text-right">Attachment</th>
                  </tr>
                </thead>
                <tbody className="divide-y hairline">
                  {filteredFilings.map((f) => {
                    const isAudio = /audio|video|recording/i.test(f.title);
                    return (
                      <tr key={f.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-4 font-mono text-[12px] text-slate-600 whitespace-nowrap">
                          {fmtDate(f.publishedAt)}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <Link
                            href={`/stock/${f.symbol}`}
                            className="font-mono font-bold text-indigo-700 hover:underline"
                          >
                            {f.symbol}
                          </Link>
                          <div className="text-[11px] muted-text truncate max-w-[180px]">
                            {f.companyName}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 max-w-xl">
                          <div className="flex items-center gap-1.5">
                            {isAudio ? (
                              <Volume2 size={13} className="text-amber-600 shrink-0" />
                            ) : (
                              <Mic size={13} className="text-indigo-600 shrink-0" />
                            )}
                            <span className="line-clamp-1">{f.title}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          {f.hasDigest ? (
                            <button
                              type="button"
                              onClick={() => {
                                setQuery(f.symbol);
                                setTab("digests");
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-semibold hover:bg-emerald-100"
                            >
                              <CheckCircle2 size={11} /> Ready
                            </button>
                          ) : (
                            <span className="text-[11px] muted-text">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          {f.pdfUrl && (
                            <a
                              href={f.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <FileText size={12} /> PDF <ExternalLink size={10} />
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
