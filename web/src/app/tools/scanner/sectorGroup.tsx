"use client";

/**
 * Sector grouping for the ranked scanners (Trend Leaders / At Support / Fallen
 * Leaders). These tables are RANKED — the top row is the strongest signal — so
 * grouping is opt-in: `orderBySector` re-buckets rows by sector while keeping
 * each sector's rows in their original (ranked) order, and `SectorHeaderRow`
 * draws the band that precedes each group's first row.
 */

import { useMemo } from "react";

type Sector = string | null | undefined;

/** Stable-group items by sector (unknown/empty sector sinks to the bottom),
 *  preserving each group's incoming ranked order. */
export function orderBySector<T>(items: T[], sectorOf: (t: T) => Sector): T[] {
  const key = (t: T) => (sectorOf(t) || "").trim();
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const ka = key(a.it);
      const kb = key(b.it);
      if (ka === kb) return a.i - b.i; // keep ranked order within a sector
      if (!ka) return 1; // unknown sector last
      if (!kb) return -1;
      return ka.localeCompare(kb);
    })
    .map((x) => x.it);
}

/** Per-sector totals across the whole (ordered) list, for the "· N" on each
 *  group header — so the count reflects the group, not just the current page. */
export function useSectorCounts<T>(items: T[], sectorOf: (t: T) => Sector): Map<string, number> {
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) {
      const k = (sectorOf(it) || "").trim() || "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [items, sectorOf]);
}

/** The opt-in "Group by sector" pill, styled to match the scanners' toggles. */
export function GroupBySectorToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  const GREEN = "var(--color-delta-up, #0a0)";
  return (
    <button
      onClick={onToggle}
      aria-pressed={on}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12.5px] font-medium transition-colors"
      style={
        on
          ? { borderColor: GREEN, background: "color-mix(in srgb, var(--color-delta-up, #0a0) 10%, transparent)", color: GREEN }
          : { borderColor: "var(--color-border)", color: "var(--color-muted)" }
      }
    >
      <span
        className="w-2 h-2 rounded-full"
        style={{ background: on ? GREEN : "var(--color-border)" }}
      />
      Group by sector
    </button>
  );
}

/** A full-width group-header row; render it before the first row of each sector. */
export function SectorHeaderRow({
  label,
  count,
  colSpan,
}: {
  label: string;
  count: number;
  colSpan: number;
}) {
  return (
    <tr className="bg-[var(--color-paper)]">
      <td
        colSpan={colSpan}
        className="px-3 py-1.5 border-b hairline text-[11px] font-semibold uppercase tracking-wide muted-text"
      >
        {label}
        <span className="ml-1.5 font-normal opacity-60">· {count}</span>
      </td>
    </tr>
  );
}
