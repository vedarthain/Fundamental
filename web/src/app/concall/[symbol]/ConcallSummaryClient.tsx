"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileText,
  Headphones,
  MessageSquareQuote,
  Presentation,
  Quote,
  Search,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import type { ConcallDigest } from "@/lib/concallTypes";
import CapTierBadge, { type CapCategory } from "@/components/CapTierBadge";
import {
  ConcallAudioBar,
  type ActiveConcallAudio,
} from "@/components/ConcallAudioBar";
import { WatchlistButton } from "@/components/WatchlistButton";
import { band, bandColor } from "@/lib/score";

export type ConcallStockHeader = {
  symbol: string;
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
  opmPct: number | null;
};

export type CompanyQuarterRow = {
  periodEnd: string;
  sales: number | null;
  operatingProfit: number | null;
  netProfit: number | null;
  opmPct: number | null;
};

export type ConcallArchiveFiling = {
  id: string;
  title: string;
  publishedAt: string;
  pdfUrl: string | null;
  cachedMediaUrl?: string | null;
  cachedMediaKind?: "audio" | "video" | "youtube" | "webcast" | null;
  kind: "transcript" | "audio" | "presentation";
};

type SubTab = "highlights" | "guidance" | "qa" | "filings";

const TONE_STYLE: Record<ConcallDigest["tone"], { pill: string; dot: string }> = {
  Optimistic: { pill: "bg-emerald-50 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  Neutral: { pill: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-400" },
  Cautious: { pill: "bg-amber-50 text-amber-800 border-amber-200", dot: "bg-amber-500" },
};

const CAT_BADGE: Record<string, string> = {
  Guidance: "bg-indigo-50 text-indigo-800 border-indigo-200",
  Demand: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Margins: "bg-sky-50 text-sky-800 border-sky-200",
  Capex: "bg-purple-50 text-purple-800 border-purple-200",
  "Order Book": "bg-teal-50 text-teal-800 border-teal-200",
  Risk: "bg-rose-50 text-rose-800 border-rose-200",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtQuarterEnd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 7);
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function fmtCr(v: number | null): string {
  if (v == null) return "—";
  return `₹${Math.round(v).toLocaleString("en-IN")} Cr`;
}

export function ConcallSummaryClient({
  stock,
  concalls,
  quarters,
  filings,
  initialTab = "highlights",
}: {
  stock: ConcallStockHeader;
  concalls: ConcallDigest[];
  quarters: CompanyQuarterRow[];
  filings: ConcallArchiveFiling[];
  initialTab?: SubTab;
}) {
  const [tab, setTab] = useState<SubTab>(initialTab);
  const [activeIdx, setActiveIdx] = useState(0);
  const [showQuotes, setShowQuotes] = useState(true);
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [qaQuery, setQaQuery] = useState("");
  const [activeAudio, setActiveAudio] = useState<ActiveConcallAudio | null>(null);

  const active = concalls[Math.min(activeIdx, Math.max(0, concalls.length - 1))] ?? null;
  const latestAudio = useMemo(
    () => filings.find((f) => (f.kind === "audio" && f.pdfUrl) || f.cachedMediaUrl),
    [filings],
  );
  const latestTranscript = useMemo(
    () => active?.pdfUrl ?? filings.find((f) => f.kind === "transcript" && f.pdfUrl)?.pdfUrl ?? null,
    [active, filings],
  );

  const segments = useMemo(() => {
    if (!active) return [];
    const seen = new Set<string>();
    for (const n of active.numbersMentioned) if (n.segment) seen.add(n.segment);
    for (const h of active.highlights) if (h.segment) seen.add(h.segment);
    for (const q of active.qaHighlights) if (q.segment) seen.add(q.segment);
    return [...seen];
  }, [active]);

  const activeNumbers = useMemo(() => {
    if (!active) return [];
    if (segmentFilter === "all") return active.numbersMentioned;
    return active.numbersMentioned.filter((n) => n.segment === segmentFilter);
  }, [active, segmentFilter]);

  const positives = useMemo(() => {
    if (!active) return [];
    return active.highlights.filter(
      (h) => h.category !== "Risk" && (segmentFilter === "all" || h.segment === segmentFilter),
    );
  }, [active, segmentFilter]);

  const risks = useMemo(() => {
    if (!active) return [];
    return active.highlights.filter(
      (h) => h.category === "Risk" && (segmentFilter === "all" || h.segment === segmentFilter),
    );
  }, [active, segmentFilter]);

  const filteredQa = useMemo(() => {
    if (!active) return [];
    const q = qaQuery.trim().toLowerCase();
    return active.qaHighlights.filter((x) => {
      if (segmentFilter !== "all" && x.segment !== segmentFilter) return false;
      if (!q) return true;
      return (
        x.topic.toLowerCase().includes(q) ||
        (x.analyst ?? "").toLowerCase().includes(q) ||
        (x.segment ?? "").toLowerCase().includes(q) ||
        x.question.toLowerCase().includes(q) ||
        x.answer.toLowerCase().includes(q) ||
        x.quote.toLowerCase().includes(q)
      );
    });
  }, [active, qaQuery, segmentFilter]);

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/concall"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium muted-text hover:text-[var(--color-accent-600)] transition-colors"
        >
          <ArrowLeft size={14} /> Concall Calendar
        </Link>
        <Link
          href={`/stock/${stock.symbol}`}
          className="text-[12.5px] font-medium text-indigo-700 hover:underline"
        >
          Open Full Stock Scorecard ({stock.symbol}) →
        </Link>
      </div>

      {/* Company + Call Header Card */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-5 md:p-6 shadow-2xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-[22px] md:text-[26px] font-bold tracking-tight text-slate-900">
                {stock.companyName}
              </h1>
              <span className="px-2 py-0.5 rounded bg-slate-100 font-mono text-[12px] font-bold text-slate-800">
                {stock.symbol}
              </span>
              {stock.marketCapCategory && (
                <CapTierBadge category={stock.marketCapCategory as CapCategory} />
              )}
              <WatchlistButton symbol={stock.symbol} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-500">
              <span>{stock.sector}</span>
              <span>·</span>
              <span>{stock.industry}</span>
              {stock.ltp != null && (
                <>
                  <span>·</span>
                  <span className="font-mono font-semibold text-slate-800">
                    ₹{stock.ltp.toLocaleString("en-IN")}
                  </span>
                </>
              )}
              {stock.marketCapCr != null && (
                <>
                  <span>·</span>
                  <span className="font-mono">{fmtCr(stock.marketCapCr)}</span>
                </>
              )}
            </div>
          </div>

          {/* Right Action Pills: Listen | Transcript | Quotes Toggle */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {concalls.length > 1 && (
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[12px]">
                {concalls.map((c, idx) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveIdx(idx)}
                    className={`px-2.5 py-1 rounded-md font-mono font-semibold transition-colors ${
                      idx === activeIdx
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {c.quarterLabel || fmtDate(c.publishedAt)}
                  </button>
                ))}
              </div>
            )}

            {latestAudio && (
              <button
                type="button"
                onClick={() =>
                  setActiveAudio({
                    announcementId: latestAudio.id,
                    symbol: stock.symbol,
                    companyName: stock.companyName,
                    quarterLabel: active?.quarterLabel,
                  })
                }
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12.5px] font-medium transition-colors ${
                  activeAudio?.announcementId === latestAudio.id
                    ? "border-amber-400 bg-amber-50 text-amber-900 font-semibold"
                    : "border-slate-200 bg-white hover:bg-amber-50/60 hover:border-amber-300 text-slate-800"
                }`}
              >
                <Headphones size={14} className="text-amber-600" />
                {activeAudio?.announcementId === latestAudio.id ? "Playing…" : "Listen"}
              </button>
            )}

            {latestTranscript && (
              <a
                href={latestTranscript}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50/60 hover:border-emerald-300 text-[12.5px] font-medium text-slate-800 transition-colors"
              >
                <FileText size={14} className="text-emerald-600" />
                Transcript
                <ExternalLink size={11} className="text-slate-400" />
              </a>
            )}

            {active && (
              <button
                type="button"
                onClick={() => setShowQuotes((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12.5px] font-medium transition-colors ${
                  showQuotes
                    ? "bg-indigo-50 border-indigo-200 text-indigo-800"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Quote size={13} />
                {showQuotes ? "Verbatim Quotes On" : "Show Quotes"}
              </button>
            )}
          </div>
        </div>

        {/* EquityRoots Fundamental + Tone Context Strip (What concall.in lacks) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-3 border-t border-slate-100">
          <div className="rounded-xl bg-slate-50/80 border border-slate-200/70 px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
              Call Quarter
            </div>
            <div className="font-mono text-[14px] font-bold text-slate-900 mt-0.5">
              {active?.quarterLabel || (quarters[0] ? fmtQuarterEnd(quarters[0].periodEnd) : "Latest")}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50/80 border border-slate-200/70 px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
              Management Tone
            </div>
            <div className="mt-0.5">
              {active ? (
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11.5px] font-semibold ${TONE_STYLE[active.tone].pill}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${TONE_STYLE[active.tone].dot}`} />
                  {active.tone}
                </span>
              ) : (
                <span className="text-[13px] text-slate-400">—</span>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50/80 border border-slate-200/70 px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
              Latest Sales YoY
            </div>
            <div
              className={`font-mono text-[14px] font-bold mt-0.5 ${
                stock.salesYoy == null
                  ? "text-slate-400"
                  : stock.salesYoy >= 0
                    ? "text-emerald-700"
                    : "text-rose-700"
              }`}
            >
              {stock.salesYoy != null
                ? `${stock.salesYoy >= 0 ? "+" : ""}${stock.salesYoy.toFixed(1)}%`
                : "—"}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50/80 border border-slate-200/70 px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
              Latest PAT YoY
            </div>
            <div
              className={`font-mono text-[14px] font-bold mt-0.5 ${
                stock.npYoy == null
                  ? "text-slate-400"
                  : stock.npYoy >= 0
                    ? "text-emerald-700"
                    : "text-rose-700"
              }`}
            >
              {stock.npYoy != null
                ? `${stock.npYoy >= 0 ? "+" : ""}${stock.npYoy.toFixed(1)}%`
                : "—"}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50/80 border border-slate-200/70 px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
              Operating Margin
            </div>
            <div className="font-mono text-[14px] font-bold text-slate-900 mt-0.5">
              {stock.opmPct != null ? `${stock.opmPct.toFixed(1)}%` : "—"}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50/80 border border-slate-200/70 px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
              Q/V/M Composite
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              {stock.compositePct != null ? (
                <>
                  <span
                    className="font-mono text-[14px] font-bold"
                    style={{ color: bandColor(band(stock.compositePct)) }}
                  >
                    {Math.round(stock.compositePct)}
                  </span>
                  <span className="text-[10.5px] text-slate-400 font-mono">
                    ({Math.round(stock.qualityPct ?? 0)}/{Math.round(stock.valuationPct ?? 0)}/
                    {Math.round(stock.momentumPct ?? 0)})
                  </span>
                </>
              ) : (
                <span className="text-[13px] text-slate-400">—</span>
              )}
            </div>
          </div>
        </div>

        {active?.toneRationale && (
          <div className="rounded-xl bg-indigo-50/50 border border-indigo-100 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-slate-800">
              <strong className="text-indigo-900">Executive Read:</strong> {active.toneRationale}
            </p>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 shrink-0">
              <CheckCircle2 size={13} /> 100% Quote-Verified against BSE PDF
            </span>
          </div>
        )}
      </div>

      {/* Workspace Sub-Tabs (Highlights | Guidance & Actuals | Analyst Q&A | Source Filings) */}
      <div className="flex items-center gap-1.5 bg-slate-100/90 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
        {(
          [
            { id: "highlights", label: "✨ Highlights", count: active?.highlights.length },
            { id: "guidance", label: "🎯 Guidance & Actuals", count: active?.numbersMentioned.length },
            { id: "qa", label: "💬 Analyst Q&A", count: active?.qaHighlights.length },
            { id: "filings", label: "📑 Filings & Audio", count: filings.length },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-2 rounded-lg text-[13px] font-medium whitespace-nowrap transition-all ${
              tab === t.id
                ? "bg-white text-slate-900 font-semibold shadow-2xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-1.5 text-[11px] font-mono text-slate-400">({t.count})</span>
            )}
          </button>
        ))}
      </div>

      {!active && tab !== "filings" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-2">
          <Sparkles size={26} className="mx-auto text-indigo-500" />
          <div className="text-[15px] font-semibold text-slate-900">
            AI Concall Digest Not Generated Yet for {stock.symbol}
          </div>
          <p className="text-[13px] text-slate-500 max-w-md mx-auto">
            Switch to the <strong>Filings &amp; Audio</strong> tab to open the raw BSE transcript or audio recording directly.
          </p>
        </div>
      ) : null}

      {/* Segment Segregation Pill Bar (when transcript spans multiple verticals) */}
      {active && tab !== "filings" && segments.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
            Segment:
          </span>
          <button
            type="button"
            onClick={() => setSegmentFilter("all")}
            className={`px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors ${
              segmentFilter === "all"
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            All Segments ({segments.length})
          </button>
          {segments.map((seg) => (
            <button
              key={seg}
              type="button"
              onClick={() => setSegmentFilter(seg)}
              className={`px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors ${
                segmentFilter === seg
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {seg}
            </button>
          ))}
        </div>
      )}

      {/* ── SUB-TAB 1: HIGHLIGHTS (Executive Summary + Bull vs Risk Split) ── */}
      {active && tab === "highlights" && (
        <div className="space-y-5">
          {activeNumbers.length > 0 && (
            <div className="rounded-2xl border border-slate-200/90 bg-white p-5">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
                <Target size={14} className="text-indigo-600" />
                Key Quantitative Figures Stated on the Call
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {activeNumbers.map((n, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="text-[11.5px] text-slate-500 leading-snug">{n.metric}</div>
                        {n.segment && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700 text-[10px] font-semibold">
                            {n.segment}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[16px] font-bold text-slate-900 mt-1">
                        {n.value}
                      </div>
                    </div>
                    {showQuotes && n.quote && (
                      <p className="mt-2.5 pt-2 border-t border-slate-200/70 text-[11px] italic text-slate-500 leading-snug">
                        &ldquo;{n.quote}&rdquo;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            className={`grid grid-cols-1 ${
              risks.length > 0 ? "lg:grid-cols-[2fr_1fr]" : ""
            } gap-5 items-start`}
          >
            {/* Positives / Strategic Drivers */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-5 space-y-3">
              <div className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-900 pb-2 border-b border-slate-100">
                <TrendingUp size={16} className="text-emerald-600" />
                Operational Drivers, Demand &amp; Margin Takeaways
              </div>
              <div className="space-y-3">
                {(positives.length > 0 ? positives : active.highlights).map((h, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-slate-200/70 bg-slate-50/30 p-3.5"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="shrink-0 flex flex-col gap-1 mt-0.5">
                        <span
                          className={`px-2 py-0.5 rounded border text-[10.5px] font-semibold text-center ${
                            CAT_BADGE[h.category] ?? "bg-slate-100 text-slate-700 border-slate-200"
                          }`}
                        >
                          {h.category}
                        </span>
                        {h.segment && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-200/75 text-slate-700 text-[10px] font-semibold text-center">
                            {h.segment}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5 min-w-0">
                        <p className="text-[13.5px] text-slate-900 leading-relaxed">{h.point}</p>
                        {showQuotes && h.quote && (
                          <p className="pl-3 border-l-2 border-indigo-300 text-[11.5px] italic text-slate-500 leading-relaxed">
                            &ldquo;{h.quote}&rdquo;
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Headwinds & Risks */}
            {risks.length > 0 && (
              <div className="rounded-2xl border border-rose-200/80 bg-rose-50/20 p-5 space-y-3">
                <div className="flex items-center gap-2 text-[13.5px] font-semibold text-rose-900 pb-2 border-b border-rose-200/60">
                  <AlertTriangle size={16} className="text-rose-600" />
                  Watchpoints &amp; Headwinds Flagged
                </div>
                <div className="space-y-3">
                  {risks.map((r, i) => (
                    <div key={i} className="rounded-xl border border-rose-200/70 bg-white p-3.5 space-y-1.5">
                      {r.segment && (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-semibold">
                          {r.segment}
                        </span>
                      )}
                      <p className="text-[13px] text-slate-800 leading-relaxed">{r.point}</p>
                      {showQuotes && r.quote && (
                        <p className="mt-2 pl-2.5 border-l-2 border-rose-300 text-[11.5px] italic text-slate-500 leading-relaxed">
                          &ldquo;{r.quote}&rdquo;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SUB-TAB 2: GUIDANCE & DELIVERED ACTUALS ───────────────────────── */}
      {active && tab === "guidance" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-7 rounded-2xl border border-slate-200/90 bg-white overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/60 font-semibold text-[13.5px] text-slate-900">
              Stated Guidance, Order Book &amp; Capex Targets
            </div>
            {activeNumbers.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-slate-500">
                No explicit numerical guidance targets were stated for this filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {activeNumbers.map((n, i) => (
                  <div key={i} className="p-4 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {n.segment && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10.5px] font-semibold">
                            {n.segment}
                          </span>
                        )}
                        <span className="text-[13px] font-semibold text-slate-800">{n.metric}</span>
                      </div>
                      <span className="font-mono text-[15px] font-bold text-indigo-700 shrink-0">
                        {n.value}
                      </span>
                    </div>
                    {n.quote && (
                      <p className="text-[12px] italic text-slate-500 leading-relaxed">
                        &ldquo;{n.quote}&rdquo;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-5 rounded-2xl border border-slate-200/90 bg-white overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/60 font-semibold text-[13.5px] text-slate-900">
              Delivered Quarterly Track Record (₹ Cr)
            </div>
            {quarters.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-slate-500">
                No quarterly history available.
              </div>
            ) : (
              <table className="w-full text-left text-[12.5px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">Quarter</th>
                    <th className="py-2.5 px-3 text-right">Sales</th>
                    <th className="py-2.5 px-3 text-right">OPM</th>
                    <th className="py-2.5 px-4 text-right">PAT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {quarters.map((q) => (
                    <tr key={q.periodEnd}>
                      <td className="py-2.5 px-4 font-sans font-medium text-slate-800">
                        {fmtQuarterEnd(q.periodEnd)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-800">
                        {q.sales != null ? Math.round(q.sales).toLocaleString("en-IN") : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600">
                        {q.opmPct != null ? `${q.opmPct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold text-slate-900">
                        {q.netProfit != null ? Math.round(q.netProfit).toLocaleString("en-IN") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── SUB-TAB 3: ANALYST Q&A ────────────────────────────────────────── */}
      {active && tab === "qa" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
              <MessageSquareQuote size={16} className="text-indigo-600" />
              Unscripted Analyst Q&amp;A Breakdown
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={qaQuery}
                onChange={(e) => setQaQuery(e.target.value)}
                placeholder="Search Q&A topics…"
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] w-60 focus:outline-none focus:border-indigo-400"
              />
            </div>
          </div>

          {filteredQa.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-500">
              No Q&amp;A exchanges match that filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredQa.map((qa, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-slate-200/90 bg-white p-5 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-block px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 text-[11.5px] font-semibold">
                      {qa.topic}
                    </span>
                    {qa.segment && (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold">
                        {qa.segment}
                      </span>
                    )}
                    {qa.analyst && (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-medium">
                        {qa.analyst}
                      </span>
                    )}
                  </div>
                  {qa.question && (
                    <p className="text-[13px] text-slate-600 leading-relaxed">
                      <strong className="text-slate-900">Analyst Q:</strong> {qa.question}
                    </p>
                  )}
                  <p className="text-[13.5px] text-slate-900 leading-relaxed">
                    <strong className="text-emerald-700">Management A:</strong> {qa.answer}
                  </p>
                  {showQuotes && qa.quote && (
                    <p className="pt-2 border-t border-slate-100 text-[11.5px] italic text-slate-500 leading-relaxed">
                      &ldquo;{qa.quote}&rdquo;
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SUB-TAB 4: SOURCE FILINGS & AUDIO ARCHIVE ─────────────────────── */}
      {tab === "filings" && (
        <div className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/60 font-semibold text-[13.5px] text-slate-900">
            Official Exchange Concall Transcripts, Audio Recordings &amp; Presentations
          </div>
          {filings.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-slate-500">
              No exchange concall filings found for {stock.symbol}.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filings.map((f) => (
                <div
                  key={f.id}
                  className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50/60"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {f.kind === "audio" ? (
                      <Headphones size={16} className="text-amber-600 shrink-0" />
                    ) : f.kind === "presentation" ? (
                      <Presentation size={16} className="text-purple-600 shrink-0" />
                    ) : (
                      <FileText size={16} className="text-emerald-600 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-slate-900 truncate max-w-2xl">
                        {f.title}
                      </div>
                      <div className="text-[11.5px] font-mono text-slate-400">
                        {fmtDate(f.publishedAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {f.kind === "audio" && (
                      <button
                        type="button"
                        onClick={() =>
                          setActiveAudio({
                            announcementId: f.id,
                            symbol: stock.symbol,
                            companyName: stock.companyName,
                            quarterLabel: active?.quarterLabel,
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50/70 hover:bg-amber-100 text-[12px] font-semibold text-amber-900"
                      >
                        <Headphones size={12} />
                        Listen
                      </button>
                    )}
                    {f.pdfUrl && (
                      <a
                        href={f.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[12px] font-medium text-slate-700"
                      >
                        {f.kind === "audio" ? "Filing Notice" : "Open Attachment"}{" "}
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={`text-[11.5px] text-slate-400 pt-2 ${activeAudio ? "pb-32" : ""}`}>
        Strictly factual summary extracted &amp; quote-verified from official BSE Regulation 30 filings. Not investment advice.
      </div>

      <ConcallAudioBar target={activeAudio} onClose={() => setActiveAudio(null)} />
    </div>
  );
}
