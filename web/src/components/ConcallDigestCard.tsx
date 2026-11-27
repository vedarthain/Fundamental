"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ExternalLink, MessageSquareQuote, Mic, Quote } from "lucide-react";
import type { ConcallDigest } from "@/lib/concallTypes";

const TONE_STYLE: Record<
  ConcallDigest["tone"],
  { badge: string; dot: string }
> = {
  Optimistic: {
    badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-500",
  },
  Neutral: {
    badge: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
  },
  Cautious: {
    badge: "bg-amber-50 text-amber-800 border-amber-200",
    dot: "bg-amber-500",
  },
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
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function ConcallDigestCard({
  concalls,
  symbol,
  compact = false,
}: {
  concalls: ConcallDigest[];
  symbol: string;
  compact?: boolean;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [showQuotes, setShowQuotes] = useState(false);

  if (!concalls || concalls.length === 0) return null;
  const active = concalls[Math.min(activeIdx, concalls.length - 1)];
  const toneCfg = TONE_STYLE[active.tone] ?? TONE_STYLE.Neutral;

  return (
    <section className={`${compact ? "" : "mt-6"} card p-5 md:p-6`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b hairline">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
              <Mic size={16} className="text-indigo-600" />
              Earnings Concall Digest
            </span>
            {active.quarterLabel && (
              <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-[11.5px] font-semibold">
                {active.quarterLabel}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11.5px] font-semibold ${toneCfg.badge}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${toneCfg.dot}`} />
              Tone: {active.tone}
            </span>
            <span
              title="Every point below was programmatically verified against verbatim quotes in the exchange-filed PDF transcript."
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50/80 text-emerald-800 border border-emerald-200/80 text-[11px] font-medium"
            >
              <CheckCircle2 size={12} />
              Quote-verified
            </span>
          </div>
          {active.toneRationale && (
            <p className="text-[12.5px] muted-text mt-1.5 leading-relaxed">
              {active.toneRationale}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {concalls.length > 1 && (
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[11.5px]">
              {concalls.map((c, idx) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveIdx(idx)}
                  className={`px-2 py-1 rounded-md font-mono font-medium transition-colors ${
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

          <button
            type="button"
            onClick={() => setShowQuotes((v) => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11.5px] font-medium transition-colors ${
              showQuotes
                ? "bg-indigo-50 border-indigo-200 text-indigo-800"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Quote size={12} />
            {showQuotes ? "Hide quotes" : "Show exact quotes"}
          </button>

          {active.pdfUrl && (
            <a
              href={active.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Transcript PDF <ExternalLink size={11} />
            </a>
          )}

          <Link
            href={`/concall/${encodeURIComponent(symbol)}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-[11.5px] font-medium transition-colors"
          >
            Full Concall View <ArrowRight size={11} />
          </Link>
        </div>
      </div>

      {/* Key Numbers & Guidance Strip */}
      {active.numbersMentioned.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider muted-text mb-2">
            Key Figures &amp; Guidance Stated on Call
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {active.numbersMentioned.map((n, i) => (
              <div
                key={i}
                className="rounded-lg border border-slate-200/90 bg-slate-50/60 px-3 py-2.5 flex flex-col justify-between"
              >
                <div>
                  <div className="text-[11px] text-slate-500 leading-snug">{n.metric}</div>
                  <div className="font-mono text-[14px] font-bold text-slate-900 mt-0.5">
                    {n.value}
                  </div>
                </div>
                {showQuotes && n.quote && (
                  <p className="mt-2 pt-1.5 border-t border-slate-200/70 text-[11px] italic text-slate-500 leading-snug">
                    &ldquo;{n.quote}&rdquo;
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Structured Management Commentary */}
      {active.highlights.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider muted-text mb-2.5">
            Management Commentary Takeaways
          </div>
          <div className="space-y-2.5">
            {active.highlights.map((h, i) => {
              const cls = CAT_BADGE[h.category] ?? "bg-slate-100 text-slate-700 border-slate-200";
              return (
                <div
                  key={i}
                  className="rounded-lg border border-slate-200/75 bg-white px-3.5 py-2.5"
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`shrink-0 mt-0.5 px-2 py-0.5 rounded border text-[10.5px] font-semibold ${cls}`}
                    >
                      {h.category}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-slate-800 leading-relaxed">{h.point}</p>
                      {showQuotes && h.quote && (
                        <p className="mt-1.5 pl-2.5 border-l-2 border-indigo-200 text-[11.5px] italic text-slate-500 leading-relaxed">
                          &ldquo;{h.quote}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Analyst Q&A Highlights */}
      {active.qaHighlights.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider muted-text mb-2.5">
            <MessageSquareQuote size={13} />
            Analyst Q&amp;A Highlights
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {active.qaHighlights.map((qa, i) => (
              <div
                key={i}
                className="rounded-lg border border-slate-200/80 bg-slate-50/40 p-3.5"
              >
                <div className="text-[12px] font-semibold text-indigo-800 mb-1">
                  {qa.topic}
                </div>
                {qa.question && (
                  <p className="text-[11.5px] text-slate-500 mb-1.5">
                    <span className="font-semibold text-slate-600">Q:</span> {qa.question}
                  </p>
                )}
                <p className="text-[12.5px] text-slate-800 leading-relaxed">
                  <span className="font-semibold text-emerald-700">A:</span> {qa.answer}
                </p>
                {showQuotes && qa.quote && (
                  <p className="mt-2 pt-1.5 border-t border-slate-200/70 text-[11px] italic text-slate-500 leading-snug">
                    &ldquo;{qa.quote}&rdquo;
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 pt-3 border-t hairline flex flex-wrap items-center justify-between gap-2 text-[11px] muted-text">
        <span>
          Filed {fmtDate(active.publishedAt)} · {symbol} · Factual summary of exchange-filed transcript (not investment advice).
        </span>
      </div>
    </section>
  );
}
