"use client";

import { useState } from "react";
import Link from "next/link";

// Horizontal row of compact tool "tiles" (name + one-line tagline). Selecting
// a tile reveals its full write-up (body, "Best for" list, Open link) in a
// panel below the row. Keeps the landing scannable — all tools visible at a
// glance — while carrying enough copy to choose once a tile is selected.

export type ToolCard = {
  href: string;
  title: string;
  tagline: string;
  body: string;
  useFor: string[];
  accent: string;
};

export default function ToolsAccordion({ tools }: { tools: ToolCard[] }) {
  // First tool selected by default so the write-up panel isn't empty on load.
  const [selected, setSelected] = useState<string>(tools[0]?.href ?? "");
  const active = tools.find((t) => t.href === selected) ?? tools[0];

  return (
    <div className="mt-10">
      {/* Horizontal row of selectable tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tools.map((t) => {
          const isActive = t.href === selected;
          return (
            <button
              key={t.href}
              onClick={() => setSelected(t.href)}
              aria-pressed={isActive}
              className="card text-left px-4 py-3.5 transition-all hover:-translate-y-[2px] hover:shadow-md"
              style={{
                borderTop: `3px solid ${t.accent}`,
                background: isActive ? "var(--color-paper)" : "var(--color-card)",
                outline: isActive ? `2px solid ${t.accent}` : "none",
                outlineOffset: "-2px",
              }}
            >
              <div className="font-display text-[15px] tracking-tight leading-tight">
                {t.title}
              </div>
              <div className="muted-text italic text-[11.5px] mt-1 leading-snug">
                {t.tagline}
              </div>
            </button>
          );
        })}
      </div>

      {/* Write-up for the selected tile */}
      {active && (
        <div
          className="card mt-4 p-5"
          style={{ borderLeft: `3px solid ${active.accent}` }}
        >
          <div className="font-display text-[20px] tracking-tight leading-tight">
            {active.title}
          </div>
          <p className="text-[13.5px] leading-[1.55] muted-text mt-2">
            {active.body}
          </p>
          <div className="mt-3">
            <div className="text-[10.5px] uppercase tracking-wide muted-text mb-1.5">
              Best for
            </div>
            <ul className="space-y-1 text-[12.5px] leading-[1.4]">
              {active.useFor.map((u) => (
                <li key={u} className="flex gap-2">
                  <span style={{ color: active.accent }} aria-hidden>
                    •
                  </span>
                  <span>{u}</span>
                </li>
              ))}
            </ul>
          </div>
          <Link
            href={active.href}
            className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium"
            style={{ color: active.accent }}
          >
            Open {active.title} <span aria-hidden>→</span>
          </Link>
        </div>
      )}
    </div>
  );
}
