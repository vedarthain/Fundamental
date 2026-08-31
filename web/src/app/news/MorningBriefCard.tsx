"use client";

/**
 * Admin-only "Morning Brief" card on /news.
 *
 * /news is ISR-cached with no session reads, so we must NOT gate on the server
 * (that would force the page dynamic for everyone). Instead this client
 * component fetches the latest brief from /api/admin/daily-brief?latest=1 —
 * which is admin-gated. For non-admins the request 401s and the card renders
 * nothing, so the epaper-derived content stays private without touching the
 * cache.
 */
import { useEffect, useState } from "react";

type BriefItem = { title: string; summary: string; symbols: string[] };
type BriefSection = { heading: string; items: BriefItem[] };
type Brief = {
  paperLabel: string;
  briefDate: string;
  sections: BriefSection[];
};

export function MorningBriefCard() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/daily-brief?latest=1");
        if (!r.ok) return; // 401 for non-admins → stay hidden
        const d = await r.json();
        if (alive && d.brief) setBrief(d.brief);
      } catch {
        /* stay hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!brief || brief.sections.length === 0) return null;

  return (
    <div className="card mb-5 overflow-hidden border-l-4 border-l-[#1E2761]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="rounded bg-[#1E2761] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Admin
          </span>
          <span className="font-display text-[16px]">Morning Brief</span>
          <span className="muted-text text-[12px]">
            {brief.paperLabel} · {brief.briefDate}
          </span>
        </span>
        <span className="muted-text text-[12px]">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {/* Category index — jump to a section instead of scrolling the list. */}
          {brief.sections.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5 border-b hairline pb-3">
              {brief.sections.map((sec, si) => (
                <a
                  key={si}
                  href={`#mb-sec-${si}`}
                  className="rounded-full bg-[#eef2ff] px-2.5 py-[2px] text-[11px] font-semibold text-[#1E2761] no-underline"
                >
                  {sec.heading}
                  <span className="ml-1 opacity-60">{sec.items.length}</span>
                </a>
              ))}
            </div>
          )}
          {brief.sections.map((sec, si) => (
            <div key={si} id={`mb-sec-${si}`} className="mb-3 scroll-mt-20">
              <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#1E2761]">
                {sec.heading}
              </h3>
              <ul className="space-y-1.5">
                {sec.items.map((it, ii) => (
                  <li key={ii}>
                    <div className="text-[13px] font-semibold leading-snug">{it.title}</div>
                    <div className="text-[12.5px] leading-snug">{it.summary}</div>
                    {it.symbols.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1.5">
                        {it.symbols.map((s) => (
                          <a
                            key={s}
                            href={`/stock/${s}`}
                            className="rounded-full bg-[#eef2ff] px-2 py-[1px] text-[10.5px] font-semibold text-[#1E2761] no-underline"
                          >
                            {s}
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
