"use client";

import { useState } from "react";
import Link from "next/link";

// Collapsed-by-default list of tools. Each row shows just the tool name +
// tagline ("symbol"); clicking a row expands its full write-up (body, "Best
// for" list, and the Open link). Keeps the landing scannable while still
// carrying enough copy to pick the right tool once expanded.

export type ToolCard = {
  href: string;
  title: string;
  tagline: string;
  body: string;
  useFor: string[];
  accent: string;
};

export default function ToolsAccordion({ tools }: { tools: ToolCard[] }) {
  // Track open rows by href. First tool open by default so the page isn't
  // a wall of unexplained titles on first load.
  const [open, setOpen] = useState<Record<string, boolean>>(
    () => (tools[0] ? { [tools[0].href]: true } : {})
  );

  function toggle(href: string) {
    setOpen((prev) => ({ ...prev, [href]: !prev[href] }));
  }

  return (
    <div className="mt-10 flex flex-col gap-3">
      {tools.map((t) => {
        const isOpen = !!open[t.href];
        return (
          <div
            key={t.href}
            className="card overflow-hidden transition-all"
            style={{ borderLeft: `3px solid ${t.accent}` }}
          >
            {/* Collapsed header — the "symbol" row, always visible */}
            <button
              onClick={() => toggle(t.href)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--color-paper)]"
            >
              <div className="min-w-0 flex-1">
                <div className="font-display text-[18px] tracking-tight leading-tight truncate">
                  {t.title}
                </div>
                <div className="muted-text italic text-[12.5px] mt-0.5 truncate">
                  {t.tagline}
                </div>
              </div>
              <span
                aria-hidden
                className="shrink-0 text-[16px] muted-text transition-transform"
                style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
              >
                ›
              </span>
            </button>

            {/* Expanded write-up */}
            {isOpen && (
              <div className="px-5 pb-5 pt-0">
                <p className="text-[13.5px] leading-[1.55] muted-text">{t.body}</p>
                <div className="mt-3">
                  <div className="text-[10.5px] uppercase tracking-wide muted-text mb-1.5">
                    Best for
                  </div>
                  <ul className="space-y-1 text-[12.5px] leading-[1.4]">
                    {t.useFor.map((u) => (
                      <li key={u} className="flex gap-2">
                        <span style={{ color: t.accent }} aria-hidden>
                          •
                        </span>
                        <span>{u}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  href={t.href}
                  className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium"
                  style={{ color: t.accent }}
                >
                  Open {t.title} <span aria-hidden>→</span>
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
