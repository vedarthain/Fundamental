"use client";

import { useEffect, useState } from "react";
import {
  getModelAnalysis,
  ModelCard,
  parseParameterItems,
  parseVerdictPoints,
} from "@/components/VerdictPanel";

type AuditPayload = {
  verdict: string | null;
  confidence: string | null;
  points: string[];
  trigger_text: string | null;
  generated_at: string | null;
};

const auditCache = new Map<string, AuditPayload | null>();

function cleanPointText(raw: string, tagRegex: RegExp): { metric: string; peer: string; reason: string } {
  const cleaned = raw
    .replace(tagRegex, "")
    .replace(/<\/?(b|strong|i|em)>/gi, "")
    .replace(/^(\*|-|•)\s*/, "")
    .trim();
  const parts = cleaned.split(/\s+[—–-]{1,2}\s+/);
  return {
    metric: parts[0] ?? cleaned,
    peer: parts.length >= 3 ? parts[1] : "",
    reason: parts.length >= 3 ? parts.slice(2).join(" — ") : parts.length === 2 ? parts[1] : "",
  };
}

export function VerdictAuditSection({ symbol }: { symbol: string }) {
  const [audit, setAudit] = useState<AuditPayload | null | undefined>(() =>
    auditCache.has(symbol) ? auditCache.get(symbol) : undefined,
  );
  const [loading, setLoading] = useState(!auditCache.has(symbol));

  useEffect(() => {
    if (auditCache.has(symbol)) {
      setAudit(auditCache.get(symbol));
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/admin/stock-context?symbol=${encodeURIComponent(symbol)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (controller.signal.aborted) return;
        const payload = (json?.audit ?? null) as AuditPayload | null;
        auditCache.set(symbol, payload);
        setAudit(payload);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [symbol]);

  if (loading) {
    return (
      <div className="text-[12px] muted-text py-2">
        Loading Trigger, Working/Risks &amp; 8 Quantitative Models…
      </div>
    );
  }

  if (!audit || (!audit.trigger_text && (!audit.points || audit.points.length === 0))) {
    return (
      <div className="text-[12px] muted-text italic py-1">
        Detailed justification factors &amp; quantitative models not generated for {symbol} yet.
      </div>
    );
  }

  const { good, bad, params } = parseVerdictPoints(audit.points ?? []);
  const parsedParams = params.length > 0 ? parseParameterItems(params) : [];
  const greenModels: { label: string; value: string }[] = [];
  const redModels: { label: string; value: string }[] = [];
  for (const item of parsedParams) {
    const analysis = getModelAnalysis(item.label, item.value);
    if (analysis.status === "green") greenModels.push(item);
    else redModels.push(item);
  }

  return (
    <div className="space-y-3 pt-1">
      {/* Trigger / Verdict Description */}
      {audit.trigger_text && (
        <div className="rounded border hairline bg-[var(--color-card)] px-3 py-2 text-[12.5px]">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider muted-text">
              Trigger / Re-evaluation Condition
            </span>
            {audit.generated_at && (
              <span className="text-[10.5px] font-mono muted-text">
                Generated: {audit.generated_at.slice(0, 10)}
              </span>
            )}
          </div>
          <p className="font-medium leading-snug">{audit.trigger_text}</p>
        </div>
      )}

      {/* Verdict Justification Points: The Good & The Bad */}
      {(good.length > 0 || bad.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-emerald-200/90 bg-emerald-50/40 p-3">
            <div className="text-xs font-bold text-emerald-900 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
                <span>What&apos;s Working (The Good)</span>
              </span>
              <span className="text-[10px] font-mono text-emerald-800 bg-emerald-100/80 px-1.5 py-0.2 rounded font-semibold">
                {good.length} factors
              </span>
            </div>
            {good.length > 0 ? (
              <ul className="space-y-1.5 text-[12px] text-slate-700">
                {good.map((p, idx) => {
                  const { metric, peer, reason } = cleanPointText(p, /^<b>(the good|good|strengths):?<\/b>:?\s*/i);
                  return (
                    <li key={idx} className="flex items-start gap-1.5 leading-snug">
                      <span className="text-emerald-600 font-bold shrink-0 mt-0.5">•</span>
                      <div>
                        <strong className="text-slate-900 font-semibold">{metric}</strong>
                        {peer && <span className="text-emerald-800 font-medium"> — {peer}</span>}
                        {reason && <span className="text-slate-600"> — {reason}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="text-xs text-slate-400 italic">No specific strengths recorded.</div>
            )}
          </div>

          <div className="rounded-lg border border-rose-200/90 bg-rose-50/40 p-3">
            <div className="text-xs font-bold text-rose-900 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-600 shrink-0" />
                <span>Risks &amp; Headwinds (The Bad)</span>
              </span>
              <span className="text-[10px] font-mono text-rose-800 bg-rose-100/80 px-1.5 py-0.2 rounded font-semibold">
                {bad.length} factors
              </span>
            </div>
            {bad.length > 0 ? (
              <ul className="space-y-1.5 text-[12px] text-slate-700">
                {bad.map((p, idx) => {
                  const { metric, peer, reason } = cleanPointText(p, /^<b>(the bad|bad|risks|warnings):?<\/b>:?\s*/i);
                  return (
                    <li key={idx} className="flex items-start gap-1.5 leading-snug">
                      <span className="text-rose-500 font-bold shrink-0 mt-0.5">•</span>
                      <div>
                        <strong className="text-slate-900 font-semibold">{metric}</strong>
                        {peer && <span className="text-rose-700 font-medium"> — {peer}</span>}
                        {reason && <span className="text-slate-600"> — {reason}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="text-xs text-slate-400 italic">No critical risks recorded.</div>
            )}
          </div>
        </div>
      )}

      {/* Quantitative Institutional Models */}
      {parsedParams.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-wider muted-text block">
            Quantitative Institutional Models ({greenModels.length + redModels.length} models checked)
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200/90 bg-slate-50/60 p-3">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-200/60">
                <div className="flex items-center gap-1.5 font-bold text-slate-800 text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  <span>Passed / Healthy Models</span>
                </div>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {greenModels.length} Passed
                </span>
              </div>
              {greenModels.length > 0 ? (
                <div className="space-y-1.5">
                  {greenModels.map((item, idx) => (
                    <ModelCard key={idx} item={item} />
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400 italic py-1">No models currently in green standing.</div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200/90 bg-slate-50/60 p-3">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-200/60">
                <div className="flex items-center gap-1.5 font-bold text-slate-800 text-xs">
                  <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                  <span>Caution &amp; Risk Flags</span>
                </div>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                  {redModels.length} Flagged
                </span>
              </div>
              {redModels.length > 0 ? (
                <div className="space-y-1.5">
                  {redModels.map((item, idx) => (
                    <ModelCard key={idx} item={item} />
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500 italic py-1">
                  Clean slate: Zero warnings flagged across models.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
