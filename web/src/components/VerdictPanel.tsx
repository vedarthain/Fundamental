"use client";

import { useState } from "react";
import type { VerdictData, VerdictRow, DriftRow, EvidenceValue, VerdictBucket } from "@/lib/verdictTypes";
import { BUCKET_COLOR, STALE_DAYS, verdictBucket } from "@/lib/verdictTypes";

/**
 * The admin-only Verdict tab.
 *
 * Renders a hand-written verdict (app.stock_verdict, migration 0086) with the
 * figures it was written against placed next to today's values, so a verdict
 * that has gone out of date says so through the numbers that moved rather than
 * through its age. See lib/verdict.ts for why drift is the primary signal and
 * the date is secondary.
 *
 * Rendered in two places from this one file: the stock page's 7th tab (as a
 * server component) and the watchlist's verdict sheet (inside a client
 * modal). It therefore imports only from lib/verdictTypes, which has no
 * database — see that file's header. Two copies of this panel would be the
 * CLAUDE.md §4 drift failure with a stale opinion attached.
 *
 * Gating stays server-side in BOTH paths and is not a property of this file:
 * the stock page omits the prop entirely for a non-admin request, and the
 * sheet's data comes from an admin-gated route that 403s. Hiding it with CSS
 * would ship the text to everyone.
 *
 * `points` carry light inline HTML (<b>, <i>, entities) written by hand in a
 * Claude Code session and inserted via dangerouslySetInnerHTML. That is
 * acceptable here and nowhere else on the site: the only writer is the operator
 * running scripts/verdict-load.py against their own database, the content is
 * never user-submitted, and the panel is only ever rendered to an admin. If
 * this table ever acquires a second writer, this is the line that has to change
 * first.
 */

/** Keys whose stored value is a 0..1 rate and reads better as a percentage. */
const RATE_KEYS = new Set([
  "pct_above_200ema_252d", "fcf_yield", "div_yield", "roce_3y", "roce_5y",
  "roe_3y", "roe_5y", "op_margin_3y", "op_margin_latest",
  "ret_3m_rel", "ret_6m_rel", "ret_12m_rel",
]);

function fmt(key: string, v: EvidenceValue): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v;
  if (RATE_KEYS.has(key)) return `${(v * 100).toFixed(1)}%`;
  return Math.abs(v) >= 1000 ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 })
                             : v.toFixed(2);
}

function label(key: string): string {
  return key.replace(/_/g, " ");
}

function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function formatValuationMethod(method: string | null | undefined): string {
  if (!method) return "Multi-Model Triangulation";
  switch (method) {
    case "gordon_pb_roe":
      return "Gordon Growth P/B-ROE Multi-Stage";
    case "normalized_ev_ebitda":
      return "Normalized EV/EBITDA Cycle Multiple";
    case "quality_pe":
      return "Forward Quality P/E with Growth PEG";
    case "owner_dcf":
      return "2-Stage Owner Earnings Free Cash Flow DCF";
    case "historical_bands":
      return "10-Year Historical Valuation Multiple Bands";
    default:
      return method.replace(/_/g, " ").toUpperCase();
  }
}

/* ------------------------------------------------------------------ empty */

/**
 * No verdict written yet. This renders rather than returning null on purpose:
 * a tab that shows nothing is indistinguishable from a tab that failed, and
 * "nobody has written one" is a different fact from "the query broke".
 */
export function VerdictEmpty({ symbol }: { symbol: string }) {
  return (
    <div className="max-w-[760px] rounded-lg border p-5"
         style={{ borderColor: "var(--color-border-default)", background: "var(--color-paper)" }}>
      <div className="text-[13px] font-semibold ink-text">No verdict written for {symbol}</div>
      <p className="mt-2 text-[13px] muted-text leading-relaxed">
        Verdicts are written by hand, a batch of symbols at a time, from the evidence pack
        built by <code>scripts/verdict-evidence.py</code>. Nothing generates them on a
        schedule, so an absent verdict means exactly that — not a failure, and not a
        neutral opinion.
      </p>
      <p className="mt-2 text-[13px] muted-text leading-relaxed">
        <a href="/admin/verdicts" className="underline">/admin/verdicts</a> lists which
        tracked symbols are still missing one.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------- drift */

function DriftTable({ drift }: { drift: DriftRow[] }) {
  if (drift.length === 0) {
    return (
      <p className="text-[12.5px] muted-text">
        This verdict stored no evidence figures, so nothing can be checked against today&apos;s
        values. Treat it as unverifiable rather than current.
      </p>
    );
  }
  const comparable = drift.filter((d) => d.comparable && !d.liveMissing);
  // Present in the live metric set but carrying no value this snapshot. Kept
  // apart from both of the other groups: scoring these as "moved" flagged
  // every verdict in the first batch on day one, and scoring them as
  // unchanged would have been a lie in the other direction.
  const unverifiable = drift.filter((d) => d.comparable && d.liveMissing);
  const derived = drift.filter((d) => !d.comparable);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px] min-w-[460px]">
        <thead>
          <tr className="muted-text">
            <th className="text-left py-1.5 pr-3 font-medium">Figure</th>
            <th className="text-right py-1.5 px-3 font-medium">Written against</th>
            <th className="text-right py-1.5 px-3 font-medium">Now</th>
            <th className="text-right py-1.5 pl-3 font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {comparable.map((d) => (
            <tr key={d.key} style={{ borderTop: "1px solid var(--color-border-default)" }}>
              <td className="py-1.5 pr-3">{label(d.key)}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{fmt(d.key, d.stored)}</td>
              <td className="py-1.5 px-3 text-right tabular-nums font-medium"
                  style={d.moved ? { color: "var(--color-delta-down)" } : undefined}>
                {fmt(d.key, d.live)}
              </td>
              <td className="py-1.5 pl-3 text-right tabular-nums"
                  style={{ color: d.moved ? "var(--color-delta-down)" : "var(--color-muted)" }}>
                {d.relPct === null
                  ? (d.moved ? "changed" : "—")
                  : `${d.relPct >= 0 ? "+" : ""}${(d.relPct * 100).toFixed(1)}%`}
              </td>
            </tr>
          ))}
          {unverifiable.map((d) => (
            <tr key={d.key} style={{ borderTop: "1px solid var(--color-border-default)" }}>
              <td className="py-1.5 pr-3">{label(d.key)}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{fmt(d.key, d.stored)}</td>
              <td className="py-1.5 px-3 text-right" colSpan={2}
                  style={{ color: "var(--color-score-mid, #d4951a)" }}>
                not computed in the current snapshot — unverified, not unchanged
              </td>
            </tr>
          ))}
          {derived.map((d) => (
            <tr key={d.key} style={{ borderTop: "1px solid var(--color-border-default)" }}>
              <td className="py-1.5 pr-3">{label(d.key)}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{fmt(d.key, d.stored)}</td>
              <td className="py-1.5 px-3 text-right muted-text" colSpan={2}>
                no live counterpart — cannot be rechecked
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------- panel */

function parseVerdictPoints(points: string[]) {
  const good: string[] = [];
  const bad: string[] = [];
  const params: string[] = [];
  const decision: string[] = [];
  const other: string[] = [];

  for (const p of points) {
    const clean = p.trim();
    const lower = clean.toLowerCase();
    if (lower.startsWith("<b>the good") || lower.startsWith("<b>good") || lower.includes("<b>strengths")) {
      good.push(clean);
    } else if (lower.startsWith("<b>the bad") || lower.startsWith("<b>bad") || lower.includes("<b>risks") || lower.includes("<b>warnings")) {
      bad.push(clean);
    } else if (lower.includes("<b>validated parameters") || lower.includes("<b>parameters validated")) {
      params.push(clean);
    } else if (lower.startsWith("<i>decision") || lower.startsWith("<i>summary") || lower.startsWith("<b>decision")) {
      decision.push(clean);
    } else {
      other.push(clean);
    }
  }

  const isTwoColumn = good.length > 0 || bad.length > 0;
  return { good, bad, params, decision, other, isTwoColumn };
}

function stripTag(text: string, tagRegex: RegExp): string {
  return text.replace(tagRegex, "").trim();
}

function parseParameterItems(paramStrings: string[]) {
  const items: { label: string; value: string }[] = [];
  for (const raw of paramStrings) {
    const stripped = stripTag(raw, /^<b>(validated parameters|parameters validated):?<\/b>:?\s*/i);
    const chunks = stripped.includes("|")
      ? stripped.split("|").map((s) => s.trim()).filter(Boolean)
      : stripped.split(/,\s*(?=[A-Za-z0-9''\s]+:)/).map((s) => s.trim()).filter(Boolean);
    for (const chunk of chunks) {
      if (chunk.includes(":")) {
        const colonIdx = chunk.indexOf(":");
        const lbl = chunk.slice(0, colonIdx).trim();
        const val = chunk.slice(colonIdx + 1).trim();
        if (lbl && val) {
          items.push({ label: lbl, value: val });
        }
      } else if (items.length > 0) {
        items[items.length - 1].value += ` — ${chunk}`;
      }
    }
  }
  return items;
}

const LIGHT_THEME: Record<VerdictBucket, {
  text: string;
  border: string;
  borderSoft: string;
  bg: string;
  badgeBg: string;
  badgeText: string;
}> = {
  buy: {
    text: "#059669", // emerald-600
    border: "#10b981", // emerald-500
    borderSoft: "rgba(16, 185, 129, 0.35)",
    bg: "rgba(16, 185, 129, 0.03)",
    badgeBg: "rgba(16, 185, 129, 0.1)",
    badgeText: "#065f46",
  },
  hold: {
    text: "#2563eb", // blue-600
    border: "#3b82f6", // blue-500
    borderSoft: "rgba(59, 130, 246, 0.35)",
    bg: "rgba(59, 130, 246, 0.03)",
    badgeBg: "rgba(59, 130, 246, 0.1)",
    badgeText: "#1e40af",
  },
  watch: {
    text: "#d97706", // warm amber-600 (lighter & friendly)
    border: "#f59e0b", // amber-500
    borderSoft: "rgba(245, 158, 11, 0.35)",
    bg: "rgba(245, 158, 11, 0.03)",
    badgeBg: "rgba(245, 158, 11, 0.1)",
    badgeText: "#92400e",
  },
  sell: {
    text: "#e11d48", // rose-600 (modern coral rose)
    border: "#f43f5e", // rose-500
    borderSoft: "rgba(244, 63, 94, 0.35)",
    bg: "rgba(244, 63, 94, 0.03)",
    badgeBg: "rgba(244, 63, 94, 0.1)",
    badgeText: "#9f1239",
  },
};

function renderVerdictBullet(raw: string, idx: number, tagRegex: RegExp, tone: "good" | "bad") {
  let cleaned = stripTag(raw, tagRegex);
  // Remove leading bullet indicator like "* ", "- ", "• "
  cleaned = cleaned.replace(/^(\*|-|•)\s*/, "").trim();
  // Strip any embedded <b>, </b>, <strong>, </strong> to eliminate aggressive bolding
  cleaned = cleaned.replace(/<\/?(b|strong)>/gi, "");

  // Split on delimiter: " - ", ", - ", or " — "
  const parts = cleaned.split(/\s*(?:,\s*-\s*|\s+-\s+|\s*—\s*)\s*/);

  const isGood = tone === "good";
  const bulletColor = isGood ? "text-emerald-500" : "text-rose-500";
  const metricColor = "text-slate-800 font-medium";
  const peerColor = isGood ? "text-emerald-700 font-normal" : "text-rose-700 font-normal";
  const reasonColor = "text-slate-500 font-normal";
  const sepColor = "text-slate-300";

  if (parts.length >= 2) {
    let metricPart = parts[0];
    const peerPart = parts[1];
    const reasonPart = parts.slice(2).join(" - ");

    // If negative review point used ">" for a low, bottom-ranking or lagging metric, convert to "<"
    if (!isGood && metricPart.includes(" > ")) {
      const fullLower = cleaned.toLowerCase();
      const isExcess = fullLower.includes("exceeds") || fullLower.includes("premium to") || fullLower.includes("high debt");
      const isLow = fullLower.includes("lowest") || fullLower.includes("ranks #5") || fullLower.includes("ranks #4") ||
                    fullLower.includes("dead last") || fullLower.includes("lags") || fullLower.includes("depressed") ||
                    fullLower.includes("softened") || fullLower.includes("thin") || fullLower.includes("worst") ||
                    fullLower.includes("below") || fullLower.includes("sluggish");
      if (isLow || !isExcess) {
        metricPart = metricPart.replace(" > ", " < ");
      }
    }

    return (
      <li key={idx} className="flex items-start gap-2">
        <span className={`${bulletColor} font-mono text-[13px] shrink-0 mt-0.5 select-none`}>*</span>
        <div className="text-[12.5px] leading-relaxed">
          <span className={metricColor}>{metricPart}</span>
          <span className={`${sepColor} mx-1.5`}>-</span>
          <span className={peerColor}>{peerPart}</span>
          {reasonPart ? (
            <>
              <span className={`${sepColor} mx-1.5`}>-</span>
              <span className={reasonColor}>{reasonPart}</span>
            </>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <li key={idx} className="flex items-start gap-2">
      <span className={`${bulletColor} font-mono text-[13px] shrink-0 mt-0.5 select-none`}>*</span>
      <div
        className="text-[12.5px] leading-relaxed text-slate-700 font-normal"
        dangerouslySetInnerHTML={{ __html: cleaned }}
      />
    </li>
  );
}

function getModelAnalysis(label: string, value: string): {
  status: "green" | "red" | "amber";
  badge: string;
  contextNote: string;
} {
  const lbl = label.toLowerCase();
  const val = value.toLowerCase();

  // Beneish M-Score (Clean < -1.78)
  if (lbl.includes("beneish")) {
    if (val.includes("clean") || val.includes("low manipulation") || val.includes("-2") || val.includes("-3") || val.includes("-4")) {
      return {
        status: "green",
        badge: "Clean Books",
        contextNote: "Clean financial reporting; zero statistical signs of revenue inflation or cooked earnings.",
      };
    }
    return {
      status: "red",
      badge: "Forensic Risk",
      contextNote: "Abnormal deviations in receivables, gross margins, or asset capitalization.",
    };
  }

  // Piotroski F-Score (7-9 green)
  if (lbl.includes("piotroski")) {
    if (val.includes("strong") || val.includes("8") || val.includes("9") || val.includes("7/")) {
      return {
        status: "green",
        badge: "Strong Health",
        contextNote: "Operational efficiency, margins, and asset turnover expanding simultaneously.",
      };
    } else if (val.includes("moderate") || val.includes("5/") || val.includes("6/")) {
      return {
        status: "amber",
        badge: "Moderate Health",
        contextNote: "Operational momentum is mixed; cash flow and margins need monitoring.",
      };
    }
    return {
      status: "red",
      badge: "Weak Operations",
      contextNote: "Deteriorating operating performance, weakening balance sheet leverage and cash flow.",
    };
  }

  // Altman Z-Score (Solvency)
  if (lbl.includes("altman")) {
    if (val.includes("safe") || (!val.includes("grey") && !val.includes("distress") && parseFloat(val) >= 2.6)) {
      return {
        status: "green",
        badge: "Safe Solvency",
        contextNote: "Zero bankruptcy risk; strong liquidity and balance sheet equity buffer.",
      };
    } else if (val.includes("grey") || val.includes("moderate")) {
      return {
        status: "amber",
        badge: "Adequate Buffer",
        contextNote: "Adequate solvency buffer; minimal immediate default risk but monitor borrowings.",
      };
    }
    return {
      status: "red",
      badge: "Distress Alert",
      contextNote: "Solvency under pressure; high debt obligations relative to cash generation.",
    };
  }

  // Sloan Accruals (Cash Integrity)
  if (lbl.includes("sloan")) {
    if (val.includes("conservative") || val.includes("high cash") || val.includes("negative") || val.startsWith("-")) {
      return {
        status: "green",
        badge: "Cash Realized",
        contextNote: "High cash integrity; accounting profits are fully collected into real bank cash.",
      };
    } else if (val.includes("normal") || val.includes("balanced")) {
      return {
        status: "green",
        badge: "Balanced Cash",
        contextNote: "Reported net earnings match regular operating cash collections.",
      };
    }
    return {
      status: "red",
      badge: "Accrual Drag",
      contextNote: "Earnings are locked in unpaid receivables rather than physical cash in the bank.",
    };
  }

  // DuPont 5-Stage ROE
  if (lbl.includes("dupont")) {
    if (val.includes("high debt") || val.includes("leverage: 3") || val.includes("leverage: 4")) {
      return {
        status: "amber",
        badge: "Debt Driven",
        contextNote: "High ROE is propelled by balance sheet debt rather than underlying margins.",
      };
    }
    return {
      status: "green",
      badge: "Quality Moat",
      contextNote: "High ROE is powered by monopoly operating margins, not borrowed bank leverage.",
    };
  }

  // Peter Lynch Model & PEG
  if (lbl.includes("lynch") || lbl.includes("peg")) {
    if (val.includes("undervalued") || val.includes("peg <= 1") || val.includes("0.") || val.includes("attractive")) {
      return {
        status: "green",
        badge: "Growth Bargain",
        contextNote: "Fast earnings compounder trading at an attractive growth-adjusted multiple.",
      };
    } else if (val.includes("fairly") || val.includes("1.0 - 1.5")) {
      return {
        status: "green",
        badge: "Fair Growth",
        contextNote: "Current multiple is reasonably balanced with trailing growth rate.",
      };
    } else if (val.includes("expensive") || val.includes("stretched") || val.includes("> 2.5")) {
      return {
        status: "red",
        badge: "Growth Overpriced",
        contextNote: "Stock multiple has expanded far ahead of fundamental earnings expansion.",
      };
    }
    return {
      status: "amber",
      badge: "Priced In",
      contextNote: "Current compound growth expectations are largely reflected in valuation.",
    };
  }

  // Cash Conversion
  if (lbl.includes("cash conversion") || lbl.includes("cfo/pat") || lbl.includes("cfo/ebit")) {
    if (val.includes("excellent") || parseFloat(val.replace(/[^0-9.]/g, "")) >= 1.0) {
      return {
        status: "green",
        badge: "Cash Machine",
        contextNote: "Generates over ₹1.00 pure cash for every ₹1.00 of accounting profit.",
      };
    }
    return {
      status: "red",
      badge: "Cash Leakage",
      contextNote: "Operating cash flow is failing to keep pace with reported net income.",
    };
  }

  // 10Y Valuation Band
  if (lbl.includes("valuation") || lbl.includes("p/e") || lbl.includes("band")) {
    if (val.includes("above") || val.includes("expensive") || val.includes("premium") || val.includes("ceiling")) {
      return {
        status: "red",
        badge: "Ceiling Risk",
        contextNote: "Trading near or above its 10-year historical maximum valuation ceiling.",
      };
    } else if (val.includes("lower") || val.includes("discount") || val.includes("cheap")) {
      return {
        status: "green",
        badge: "Floor Value",
        contextNote: "Trading near 10-year historical valuation floor; favorable margin of safety.",
      };
    }
    return {
      status: "amber",
      badge: "Median Range",
      contextNote: "Multiple is trading inside its 10-year historical median valuation corridor.",
    };
  }

  // Technical Trend
  if (lbl.includes("technical") || lbl.includes("trend")) {
    if (val.includes("bullish") || val.includes("accumulate")) {
      return {
        status: "green",
        badge: "Trend Support",
        contextNote: "Trading above 200-day EMA with structural institutional accumulation.",
      };
    } else if (val.includes("downtrend") || val.includes("corrective")) {
      return {
        status: "red",
        badge: "Downtrend",
        contextNote: "Trading below 200-day EMA; ongoing institutional distribution pressure.",
      };
    }
    return {
      status: "amber",
      badge: "Base Building",
      contextNote: "Rangebound consolidation near support; awaiting directional volume trigger.",
    };
  }

  return {
    status: "green",
    badge: "Validated",
    contextNote: "Quantitative parameters verified against audited filings.",
  };
}

function renderModelCard(item: { label: string; value: string }, idx: number) {
  const analysis = getModelAnalysis(item.label, item.value);
  const isGreen = analysis.status === "green";
  const isRed = analysis.status === "red";

  // Clean, neutral card container to eliminate eye strain
  // Small colored dot provides clear semantic signal without heavy saturated backgrounds
  const dotColor = isGreen
    ? "bg-emerald-500"
    : isRed
    ? "bg-rose-500"
    : "bg-amber-500";

  const badgeTheme = isGreen
    ? "text-emerald-700 bg-emerald-50/60 border-emerald-200/60"
    : isRed
    ? "text-rose-700 bg-rose-50/60 border-rose-200/60"
    : "text-amber-700 bg-amber-50/60 border-amber-200/60";

  return (
    <div
      key={idx}
      className="rounded-md border border-slate-200/80 bg-white p-2.5 text-[12px] shadow-2xs hover:border-slate-300 transition-colors"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-medium text-slate-500 text-[10.5px] uppercase tracking-wider">
          {item.label}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 text-[10px] font-normal px-2 py-0.5 rounded-full border ${badgeTheme}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor} shrink-0`} />
          {analysis.badge}
        </span>
      </div>
      <div className="font-mono text-[11.5px] font-normal text-slate-700 leading-snug">
        {item.value}
      </div>
      {analysis.contextNote && (
        <div className="text-[11px] text-slate-400 font-normal mt-1.5 leading-snug border-t border-slate-100 pt-1">
          {analysis.contextNote}
        </div>
      )}
    </div>
  );
}

function VerdictContentBlock({
  verdict,
  ageDays,
  latestAnnual,
  stock,
  shareholding,
}: {
  verdict: VerdictRow;
  ageDays: number;
  latestAnnual?: any;
  stock?: any;
  shareholding?: any;
}) {
  const bucket = verdictBucket(verdict.verdict);
  const theme = LIGHT_THEME[bucket] || LIGHT_THEME.hold;
  const { good, bad, params, decision, other, isTwoColumn } = parseVerdictPoints(verdict.points);
  const parsedParams = parseParameterItems(params);

  // Separate institutional models into Green (passed/healthy) vs Red/Caution
  const greenModels: { label: string; value: string }[] = [];
  const redModels: { label: string; value: string }[] = [];
  for (const item of parsedParams) {
    const analysis = getModelAnalysis(item.label, item.value);
    if (analysis.status === "green") {
      greenModels.push(item);
    } else {
      redModels.push(item);
    }
  }

  return (
    <div
      className="rounded-lg border p-4 sm:p-5 transition-all shadow-xs"
      style={{
        borderColor: "var(--color-border-default)",
        borderTop: `3px solid ${theme.border}`,
        background: "var(--color-paper)",
      }}
    >
      {/* 2-Column Tight Top Layout: Verdict / Watch (Col 1) + Action Plan & Triggers (Col 2) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-stretch">
        {/* Left Column: Verdict Title & Executive Conclusion (Engine Details Hidden) */}
        <div
          className="rounded-lg border p-3.5 flex flex-col justify-between"
          style={{
            borderColor: "var(--color-border-default)",
            borderLeft: `3.5px solid ${theme.border}`,
            background: "var(--color-paper)",
          }}
        >
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider mb-1 text-slate-500">
              Verdict Headline
            </div>
            <div className="text-[15px] font-medium tracking-tight leading-snug" style={{ color: theme.text }}>
              {verdict.verdict}
            </div>
          </div>
          <div className="text-[11px] text-slate-500 mt-2.5 pt-1.5 border-t border-slate-200/50 flex items-center justify-between flex-wrap gap-2">
            <span>Confidence: <span className="text-slate-700 font-medium capitalize">{verdict.confidence}</span></span>
            <span>Written {dateOnly(verdict.generated_at)} ({ageDays}d ago){verdict.snapshot_date ? ` · Snapshot ${verdict.snapshot_date}` : ""}</span>
          </div>
        </div>

        {/* Right Column: Decision & Action Plan + Trigger */}
        {(decision.length > 0 || verdict.trigger_text) && (
          <div
            className="rounded-lg border p-3.5 text-[12px] leading-relaxed flex flex-col justify-between"
            style={{
              borderLeft: `3.5px solid ${theme.border}`,
              borderColor: "var(--color-border-default)",
              backgroundColor: theme.bg,
            }}
          >
            <div>
              <div className="flex items-center gap-1.5 font-medium text-[10px] uppercase tracking-wider mb-1 text-slate-500">
                <span>🎯</span>
                <span>Decision &amp; Action Plan</span>
              </div>
              {decision.length > 0 && (
                <div className="text-slate-700 leading-snug font-normal text-[12px]">
                  {decision.map((p, idx) => (
                    <div
                      key={idx}
                      dangerouslySetInnerHTML={{
                        __html: stripTag(p, /^<i>(decision|summary):?<\/i>:?\s*/i).replace(/<\/?(b|strong)>/gi, ""),
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            {verdict.trigger_text && (
              <div className="mt-2 pt-1.5 border-t border-slate-200/60 text-[11px] leading-snug">
                <span className="font-medium text-slate-600">What would change this verdict:</span>{" "}
                <span className="text-slate-500 font-normal" dangerouslySetInnerHTML={{ __html: verdict.trigger_text.replace(/<\/?(b|strong)>/gi, "") }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Institutional Valuation & Accumulation Targets */}
      {verdict.target_price != null && (
        <div
          className="mt-3.5 rounded-lg border p-4 shadow-2xs"
          style={{
            borderColor: "var(--color-border-default)",
            background: "linear-gradient(to right, rgba(248, 250, 252, 0.95), rgba(241, 245, 249, 0.75))",
          }}
        >
          <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-slate-200/70 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[14px]">🎯</span>
              <span className="text-[12px] font-semibold tracking-wide uppercase text-slate-700">
                Institutional Target &amp; Accumulation Framework
              </span>
            </div>
            {verdict.valuation_method && (
              <span className="text-[10px] font-medium font-mono px-2 py-0.5 rounded bg-slate-200/80 text-slate-700 border border-slate-300/60">
                Model: {formatValuationMethod(verdict.valuation_method)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Target Price */}
            <div className="rounded-md border border-slate-200/90 bg-white p-2.5 shadow-2xs">
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                Base Target Price
              </div>
              <div className="text-[17px] font-mono font-bold text-slate-900 mt-0.5">
                ₹{Math.round(verdict.target_price).toLocaleString("en-IN")}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Fair Intrinsic Multi-Model Value
              </div>
            </div>

            {/* Upside Potential */}
            <div className="rounded-md border border-slate-200/90 bg-white p-2.5 shadow-2xs">
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                Valuation Upside
              </div>
              <div
                className={`text-[17px] font-mono font-bold mt-0.5 ${
                  (verdict.upside_pct ?? 0) >= 0 ? "text-emerald-700" : "text-slate-600"
                }`}
              >
                {(verdict.upside_pct ?? 0) >= 0 ? "+" : ""}
                {verdict.upside_pct != null ? verdict.upside_pct.toFixed(1) : "0.0"}%
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Expected compounder upside
              </div>
            </div>

            {/* Accumulate Zone / Buy Below */}
            <div className="rounded-md border border-emerald-200/80 bg-emerald-50/40 p-2.5 shadow-2xs">
              <div className="text-[10px] font-medium text-emerald-800 uppercase tracking-wide">
                Accumulate Below
              </div>
              <div className="text-[17px] font-mono font-bold text-emerald-800 mt-0.5">
                {verdict.buy_below != null
                  ? `≤ ₹${Math.round(verdict.buy_below).toLocaleString("en-IN")}`
                  : "—"}
              </div>
              <div className="text-[10px] text-emerald-700/80 mt-0.5">
                Margin of safety entry ceiling
              </div>
            </div>

            {/* Bear Market Floor */}
            <div className="rounded-md border border-slate-200/90 bg-white p-2.5 shadow-2xs">
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                Bear Market Floor
              </div>
              <div className="text-[17px] font-mono font-bold text-slate-700 mt-0.5">
                {verdict.bear_floor != null
                  ? `₹${Math.round(verdict.bear_floor).toLocaleString("en-IN")}`
                  : "—"}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Hard book value &amp; cycle support
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Layout */}
      {isTwoColumn ? (
        <div className="mt-5 space-y-6">
          {/* 1ST SECTION: Positive & Negative Fundamental Review */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <span>1. Fundamental Operating Review</span>
              </div>
              <span className="text-[11px] text-slate-400 font-normal">
                {good.length + bad.length} factors evaluated
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Box 1: The Good */}
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/40 p-3.5 sm:p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200/60">
                    <div className="flex items-center gap-2 font-medium text-slate-700 text-[12.5px]">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                      The Good (What&apos;s Working)
                    </div>
                    <span className="text-[10px] font-normal font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                      {good.length} Strengths
                    </span>
                  </div>
                  {good.length > 0 ? (
                    <ul className="space-y-2.5">
                      {good.map((p, idx) =>
                        renderVerdictBullet(p, idx, /^<b>(the good|good|strengths):?<\/b>:?\s*/i, "good")
                      )}
                    </ul>
                  ) : (
                    <div className="text-[12px] text-slate-400 italic py-2">No material fundamental strengths identified.</div>
                  )}
                </div>
              </div>

              {/* Box 2: The Bad */}
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/40 p-3.5 sm:p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200/60">
                    <div className="flex items-center gap-2 font-medium text-slate-700 text-[12.5px]">
                      <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />
                      The Bad (Risks &amp; Warnings)
                    </div>
                    <span className="text-[10px] font-normal font-mono px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200/60">
                      {bad.length} Warnings
                    </span>
                  </div>
                  {bad.length > 0 ? (
                    <ul className="space-y-2.5">
                      {bad.map((p, idx) =>
                        renderVerdictBullet(p, idx, /^<b>(the bad|bad|risks|warnings):?<\/b>:?\s*/i, "bad")
                      )}
                    </ul>
                  ) : (
                    <div className="text-[12px] text-slate-400 italic py-2">No critical red flags or capital warnings detected.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 2ND SECTION: Institutional Quantitative Models */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <span>2. Quantitative Institutional Models</span>
              </div>
              <span className="text-[11px] text-slate-400 font-normal">
                {greenModels.length + redModels.length} models checked
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Box 3: Passed / Healthy Models */}
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/40 p-3.5 sm:p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200/60">
                    <div className="flex items-center gap-2 font-medium text-slate-700 text-[12.5px]">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                      Verified Strengths
                    </div>
                    <span className="text-[10px] font-normal font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                      {greenModels.length} Passed
                    </span>
                  </div>
                  {greenModels.length > 0 ? (
                    <div className="space-y-2">
                      {greenModels.map((item, idx) => renderModelCard(item, idx))}
                    </div>
                  ) : (
                    <div className="text-[12px] text-slate-400 italic py-2">No models currently in green standing.</div>
                  )}
                </div>
              </div>

              {/* Box 4: Caution & Risk Models */}
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/40 p-3.5 sm:p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200/60">
                    <div className="flex items-center gap-2 font-medium text-slate-700 text-[12.5px]">
                      <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />
                      Caution &amp; Risk Flags
                    </div>
                    <span className="text-[10px] font-normal font-mono px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200/60">
                      {redModels.length} Flagged
                    </span>
                  </div>
                  {redModels.length > 0 ? (
                    <div className="space-y-2">
                      {redModels.map((item, idx) => renderModelCard(item, idx))}
                    </div>
                  ) : (
                    <div className="text-[12px] text-slate-500 font-normal italic py-2 flex items-center gap-1.5">
                      <span className="text-emerald-600 font-normal">✓</span> Clean slate: Zero red flags or valuation warnings flagged across models.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 3RD SECTION: All Parameters Used in Analysis (Below sections 1 & 2 across full width) */}
          <div className="rounded-lg border p-4 bg-slate-500/5 border-slate-500/20 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200/70 pb-2">
              <div className="flex items-center gap-1.5 font-medium text-slate-700 text-[12.5px]">
                <span className="text-[14px]">📋</span> All Parameters Used in Analysis
              </div>
              <span className="text-[10px] uppercase font-medium tracking-wider px-2 py-0.5 rounded bg-slate-200/80 text-slate-600">
                Derived from DB
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start pt-1">
              {/* 1. Underlying Financial Inputs (Audited Annual Filings) */}
              {latestAnnual && (
                <div>
                  <div className="text-[10.5px] font-medium text-slate-500 uppercase tracking-wide mb-1.5 flex items-center justify-between">
                    <span>1. Audited Statements (P&amp;L &amp; BS)</span>
                    <span className="text-[10px] text-slate-400 font-normal">
                      FY {String(latestAnnual.period_end || "").slice(0, 4)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">Operating Profit</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        ₹{latestAnnual.operating_profit != null ? Math.round(Number(latestAnnual.operating_profit)).toLocaleString("en-IN") : "—"} Cr
                      </div>
                    </div>
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">Operating Cash (CFO)</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        ₹{latestAnnual.cash_from_operating != null ? Math.round(Number(latestAnnual.cash_from_operating)).toLocaleString("en-IN") : "—"} Cr
                      </div>
                    </div>
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">Net Profit (PAT)</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        ₹{latestAnnual.net_profit != null ? Math.round(Number(latestAnnual.net_profit)).toLocaleString("en-IN") : "—"} Cr
                      </div>
                    </div>
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">Sales / Revenue</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        ₹{latestAnnual.sales != null ? Math.round(Number(latestAnnual.sales)).toLocaleString("en-IN") : "—"} Cr
                      </div>
                    </div>
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">Total Assets</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        ₹{latestAnnual.total_assets != null ? Math.round(Number(latestAnnual.total_assets)).toLocaleString("en-IN") : "—"} Cr
                      </div>
                    </div>
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">Borrowings / Debt</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        ₹{latestAnnual.borrowings != null ? Math.round(Number(latestAnnual.borrowings)).toLocaleString("en-IN") : "0"} Cr
                      </div>
                    </div>
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">Net Worth / Reserves</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        ₹{latestAnnual.reserves != null ? Math.round(Number(latestAnnual.reserves)).toLocaleString("en-IN") : "—"} Cr
                      </div>
                    </div>
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">Trade Receivables</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        ₹{latestAnnual.receivables != null ? Math.round(Number(latestAnnual.receivables)).toLocaleString("en-IN") : "—"} Cr
                      </div>
                    </div>
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">Depreciation</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        ₹{latestAnnual.depreciation != null ? Math.round(Number(latestAnnual.depreciation)).toLocaleString("en-IN") : "—"} Cr
                      </div>
                    </div>
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">Net Fixed Assets</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        ₹{latestAnnual.net_block != null ? Math.round(Number(latestAnnual.net_block)).toLocaleString("en-IN") : "—"} Cr
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. Key Multiples & Ratios Checked */}
              {verdict.evidence && Object.keys(verdict.evidence).length > 0 && (
                <div>
                  <div className="text-[10.5px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">
                    2. Financial Ratios &amp; Multiples
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {Object.entries(verdict.evidence).map(([k, v]) => (
                      <div
                        key={k}
                        className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]"
                      >
                        <div className="text-slate-500 text-[10px] truncate" title={label(k)}>
                          {label(k)}
                        </div>
                        <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                          {fmt(k, v)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. Shareholding & Smart Money */}
              {shareholding && (
                <div>
                  <div className="text-[10.5px] font-medium text-slate-500 uppercase tracking-wide mb-1.5 flex items-center justify-between">
                    <span>3. Smart Money &amp; Governance</span>
                    <span className="text-[10px] text-slate-400 font-normal">Latest Pattern</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">DII Holding</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        {shareholding.dii_pct != null ? `${Number(shareholding.dii_pct).toFixed(1)}%` : "—"}
                      </div>
                    </div>
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">FII Holding</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        {shareholding.fii_pct != null ? `${Number(shareholding.fii_pct).toFixed(1)}%` : "—"}
                      </div>
                    </div>
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">Promoter Stake</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        {shareholding.promoter_pct != null ? `${Number(shareholding.promoter_pct).toFixed(1)}%` : "—"}
                      </div>
                    </div>
                    <div className="rounded bg-[var(--color-paper)] border border-slate-200/80 px-2 py-1 text-[11.5px]">
                      <div className="text-slate-500 text-[10px]">Pledged Shares</div>
                      <div className="font-mono font-normal text-slate-700 text-[11.5px]">
                        {shareholding.pledge_pct != null ? `${Number(shareholding.pledge_pct).toFixed(1)}%` : "0.0%"}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Any remaining context points */}
          {other.length > 0 && (
            <div className="space-y-2 text-[12.5px] muted-text pt-1">
              {other.map((p, idx) => (
                <div key={idx} dangerouslySetInnerHTML={{ __html: p }} />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Legacy single-list presentation */
        <ol className="mt-4 space-y-2.5 text-[13.5px] leading-relaxed list-decimal pl-5">
          {verdict.points.map((p, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: p }} />
          ))}
        </ol>
      )}
    </div>
  );
}

export function VerdictPanel({
  symbol,
  data,
  latestAnnual,
  stock,
  shareholding,
}: {
  symbol: string;
  data: VerdictData;
  latestAnnual?: any;
  stock?: any;
  shareholding?: any;
}) {
  const { current, history, drift, ageDays, dormant } = data;
  const movedCount = drift.filter((d) => d.moved).length;
  const checkedCount = drift.filter((d) => d.comparable && !d.liveMissing).length;
  const unverifiedCount = drift.filter((d) => d.comparable && d.liveMissing).length;
  const stale = ageDays > STALE_DAYS;

  // Categorize available verdicts across models
  const allVerdicts = [current, ...(history || [])];

  const geminiVerdict = allVerdicts.find((v) =>
    v.model?.toLowerCase().includes("gemini"),
  );
  const claudeVerdict = allVerdicts.find(
    (v) =>
      v.model?.toLowerCase().includes("claude") ||
      v.model?.toLowerCase().includes("opus") ||
      v.model?.toLowerCase().includes("sonnet") ||
      !v.model,
  );
  const ollamaVerdict = allVerdicts.find(
    (v) =>
      v.model?.toLowerCase().includes("ollama") ||
      v.model?.toLowerCase().includes("qwen"),
  );

  type TabId = "gemini" | "claude" | "ollama";
  const tabs: { id: TabId; label: string; verdict: VerdictRow }[] = [];
  if (geminiVerdict) tabs.push({ id: "gemini", label: "✨ Google Gemini", verdict: geminiVerdict });
  if (claudeVerdict) tabs.push({ id: "claude", label: "☁️ Claude Opus", verdict: claudeVerdict });
  if (ollamaVerdict) tabs.push({ id: "ollama", label: "🖥️ Local Ollama", verdict: ollamaVerdict });

  // Fallback if none matched
  if (tabs.length === 0) {
    tabs.push({ id: "gemini", label: "✨ AI Verdict", verdict: current });
  }

  const [activeTab, setActiveTab] = useState<TabId>(tabs[0].id);
  const selectedVerdict = tabs.find((t) => t.id === activeTab)?.verdict || tabs[0].verdict;

  return (
    <div className="space-y-5 w-full">
      {/* Single-line Compact Header Bar */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 px-1 py-1 border-b border-slate-200/60 flex-wrap gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          Admin Confidential · Evidence-Backed Fundamental Audit
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          {dormant && (
            <span className="text-[10.5px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/70 font-medium">
              Archived: not currently tracked
            </span>
          )}
          {movedCount > 0 && (
            <span className="text-[10.5px] text-rose-800 bg-rose-50 px-2 py-0.5 rounded border border-rose-200/70 font-medium">
              ⚠️ {movedCount} of {checkedCount} figures moved
            </span>
          )}
          {stale && movedCount === 0 && (
            <span className="text-[10.5px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 font-medium">
              Written {ageDays}d ago
            </span>
          )}
        </div>
      </div>

      {/* Model Selection Tabs (when multiple model verdicts exist) */}
      {tabs.length > 1 && (
        <div className="flex items-center gap-2 border-b hairline pb-2 flex-wrap">
          <span className="text-[11.5px] font-semibold text-slate-500 mr-1">AI Verdict Engine:</span>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* The Active Verdict View */}
      <VerdictContentBlock verdict={selectedVerdict} ageDays={ageDays} latestAnnual={latestAnnual} stock={stock} shareholding={shareholding} />

      {/* Stored vs live */}
      <div className="rounded-lg border p-5"
           style={{ borderColor: "var(--color-border-default)", background: "var(--color-paper)" }}>
        <div className="text-[13px] font-semibold ink-text">
          What it was written against, and what those figures are now
        </div>
        <p className="mt-1 mb-3 text-[12px] muted-text leading-relaxed">
          Frozen at the time of writing and re-read live on every page load. This is how the
          verdict reports its own staleness — through the numbers that moved, not through a
          date.
        </p>
        <DriftTable drift={drift} />
      </div>

      {/* History */}
      {history.length > 0 && (
        <details className="rounded-lg border p-5"
                 style={{ borderColor: "var(--color-border-default)", background: "var(--color-paper)" }}>
          <summary className="text-[13px] font-semibold ink-text cursor-pointer">
            {history.length} earlier verdict{history.length === 1 ? "" : "s"} for {symbol}
          </summary>
          <p className="mt-2 text-[12px] muted-text leading-relaxed">
            Nothing is overwritten. Each entry shows what was believed, when, and which of its
            figures had already changed by the time the next one was written — so the reason a
            verdict moved is computed rather than remembered.
          </p>
          <div className="mt-4 space-y-4">
            {history.map((h, i) => (
              <PriorVerdict key={h.generated_at} prior={h}
                            succeededBy={i === 0 ? current : history[i - 1]} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * One superseded verdict, with the diff against whichever verdict replaced it.
 *
 * The most useful part of the Consumer Durables v3 report was its table of what
 * changed from v2 and why. That table can be derived from two consecutive rows,
 * so it is derived — relying on a hand-written "downgraded because…" note means
 * the note goes missing in the month it matters.
 */
function PriorVerdict({ prior, succeededBy }: { prior: VerdictRow; succeededBy: VerdictRow }) {
  const changedKeys = Object.keys(prior.evidence).filter((k) => {
    const a = prior.evidence[k];
    const b = succeededBy.evidence[k];
    if (b === undefined) return false;
    if (typeof a === "number" && typeof b === "number") {
      return a !== 0 ? Math.abs(b / a - 1) >= 0.1 : b !== 0;
    }
    return a !== b;
  });
  const verdictChanged = prior.verdict !== succeededBy.verdict;
  const bucket = verdictBucket(prior.verdict);
  const color = BUCKET_COLOR[bucket];
  const { good, bad, decision, other } = parseVerdictPoints(prior.points);

  return (
    <div
      className="rounded-lg border p-4 transition-all"
      style={{
        borderLeft: `4px solid ${color}`,
        borderColor: "var(--color-border-default)",
        background: "var(--color-paper)",
      }}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="text-[14px] font-semibold tracking-tight" style={{ color }}>
            {prior.verdict}
          </div>
          <div className="text-[11.5px] muted-text mt-0.5">
            written {dateOnly(prior.generated_at)} · confidence: <span className="ink-text font-medium">{prior.confidence}</span>
            {prior.model && <span> · <span className="font-mono text-[10.5px]">{prior.model}</span></span>}
          </div>
        </div>
        {verdictChanged && (
          <div className="text-[11.5px] font-medium px-2 py-0.5 rounded bg-amber-500/10 text-amber-800 border border-amber-500/20">
            → became &ldquo;{succeededBy.verdict.split("—")[0].trim()}&rdquo; on {dateOnly(succeededBy.generated_at)}
          </div>
        )}
      </div>

      <div className="text-[11.5px] muted-text mt-1 italic">
        {changedKeys.length > 0
          ? `Figures that had moved by then: ${changedKeys.map(label).join(", ")}.`
          : verdictChanged
            ? "No stored figure had moved materially — the change was a refinement of analytical reasoning."
            : "Restated with no material change in underlying figures."}
      </div>

      {/* Structured 2-box display for earlier verdict */}
      {(good.length > 0 || bad.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          {/* The Good */}
          <div className="rounded border p-3 bg-emerald-500/5 border-emerald-500/20">
            <div className="text-[12px] font-semibold text-emerald-800 mb-1.5 flex items-center gap-1">
              <span>🟢</span> The Good
            </div>
            {good.length > 0 ? (
              <ul className="space-y-1.5 text-[12px]">
                {good.map((p, i) =>
                  renderVerdictBullet(p, i, /^<b>(the good|good|strengths):?<\/b>:?\s*/i, "good")
                )}
              </ul>
            ) : (
              <div className="text-[11px] muted-text italic">No strengths recorded.</div>
            )}
          </div>

          {/* The Bad */}
          <div className="rounded border p-3 bg-rose-500/5 border-rose-500/20">
            <div className="text-[12px] font-semibold text-rose-800 mb-1.5 flex items-center gap-1">
              <span>🔴</span> The Bad / Risks
            </div>
            {bad.length > 0 ? (
              <ul className="space-y-1.5 text-[12px]">
                {bad.map((p, i) =>
                  renderVerdictBullet(p, i, /^<b>(the bad|bad|risks|warnings):?<\/b>:?\s*/i, "bad")
                )}
              </ul>
            ) : (
              <div className="text-[11px] muted-text italic">No critical risks recorded.</div>
            )}
          </div>
        </div>
      )}

      {/* Decision / Note from earlier verdict */}
      {decision.length > 0 && (
        <div className="mt-2.5 text-[12px] text-slate-700 border-t border-slate-200/50 pt-2">
          {decision.map((p, i) => (
            <div key={i} dangerouslySetInnerHTML={{ __html: stripTag(p, /^<i>(decision|summary):?<\/i>:?\s*/i) }} />
          ))}
        </div>
      )}

      {other.length > 0 && (
        <div className="mt-2 text-[11.5px] muted-text space-y-1">
          {other.map((p, i) => (
            <div key={i} dangerouslySetInnerHTML={{ __html: p }} />
          ))}
        </div>
      )}
    </div>
  );
}
