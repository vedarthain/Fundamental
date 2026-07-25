"use client";

/**
 * Pager — shared 10-per-page pagination for the scanner tables.
 *
 * usePager slices a signal array into the current page and returns the page
 * controls' state; <Pager> renders the prev/next + numbered controls. It hides
 * itself when there's only one page, so short scanners (8 rows) show no chrome
 * while a longer one (14 rows) spills to page 2.
 */

import { useEffect, useMemo, useState } from "react";

export const PAGE_SIZE = 10;

export function usePager<T>(items: T[], pageSize: number = PAGE_SIZE): {
  page: number;
  setPage: (p: number) => void;
  pageCount: number;
  pageItems: T[];
  rangeStart: number;
  rangeEnd: number;
  total: number;
} {
  const [page, setPage] = useState(1);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Reset to page 1 whenever the underlying list changes (e.g. NIFTY 500 filter
  // toggles or a fresh scan loads) so we never strand the viewer on an empty page.
  useEffect(() => {
    setPage(1);
  }, [total]);

  const clamped = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => items.slice((clamped - 1) * pageSize, clamped * pageSize),
    [items, clamped, pageSize],
  );

  return {
    page: clamped,
    setPage,
    pageCount,
    pageItems,
    rangeStart: total === 0 ? 0 : (clamped - 1) * pageSize + 1,
    rangeEnd: Math.min(clamped * pageSize, total),
    total,
  };
}

export function Pager({
  page,
  pageCount,
  setPage,
  rangeStart,
  rangeEnd,
  total,
  noun,
}: {
  page: number;
  pageCount: number;
  setPage: (p: number) => void;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  noun: string;
}) {
  if (pageCount <= 1) return null;

  // Windowed page list: 1 … (page-1) page (page+1) … last. Keeps the control
  // compact when a table runs to dozens of pages (e.g. the full universe).
  const pages: (number | "ellipsis")[] = (() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
    const nums = [...new Set([1, page - 1, page, page + 1, pageCount])]
      .filter((n) => n >= 1 && n <= pageCount)
      .sort((a, b) => a - b);
    const out: (number | "ellipsis")[] = [];
    let prev = 0;
    for (const n of nums) {
      if (n - prev > 1) out.push("ellipsis");
      out.push(n);
      prev = n;
    }
    return out;
  })();

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="text-[12px] muted-text tabular-nums">
        {rangeStart}–{rangeEnd} of {total} {noun}
      </div>
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page <= 1}
          className="px-2.5 py-1 rounded-md text-[12.5px] font-medium border hairline transition-colors disabled:opacity-40"
          style={{ color: "var(--color-muted)" }}
        >
          ‹ Prev
        </button>
        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span key={`e${i}`} className="px-1 text-[12.5px] muted-text select-none">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              aria-current={p === page ? "page" : undefined}
              className="min-w-[28px] px-2 py-1 rounded-md text-[12.5px] font-medium tabular-nums transition-colors"
              style={
                p === page
                  ? { background: "var(--color-accent-600)", color: "#fff" }
                  : { color: "var(--color-muted)" }
              }
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => setPage(page + 1)}
          disabled={page >= pageCount}
          className="px-2.5 py-1 rounded-md text-[12.5px] font-medium border hairline transition-colors disabled:opacity-40"
          style={{ color: "var(--color-muted)" }}
        >
          Next ›
        </button>
      </div>
    </div>
  );
}
