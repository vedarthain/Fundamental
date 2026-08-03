"use client";

/**
 * scannerTree — a reusable sector → industry tree for the ranked scanners
 * (Igniting / Trend Leaders / At Support / Fallen Leaders / All stocks).
 *
 * It mirrors the Graph tab's left rail, but instead of browsing the whole
 * universe it is built ONLY from the rows a scanner actually caught: every
 * branch shown corresponds to a real hit, with live counts. Clicking a sector
 * or industry filters the table to that slice; "All" clears it.
 *
 * One hook (`useScannerTree`) owns the tree + selection + filtering; one
 * component (`ScannerTree`) renders the collapsible aside. Callers pass stable
 * (module-scope) `sectorOf`/`industryOf` accessors so the memo doesn't churn.
 */

import { useMemo, useState } from "react";

export type ScannerTreeSel = { sector: string; industry: string | null } | null;

export type ScannerTreeIndustry = { name: string; count: number };
export type ScannerTreeSector = { name: string; count: number; industries: ScannerTreeIndustry[] };

type Accessors<T> = {
  sectorOf: (t: T) => string | null | undefined;
  industryOf: (t: T) => string | null | undefined;
};

const DASH = "—";
function norm(v: string | null | undefined): string {
  return (v || "").trim() || DASH;
}

export function useScannerTree<T>(rows: T[], acc: Accessors<T>) {
  const { sectorOf, industryOf } = acc;

  // Build sector → industry with counts from the caught rows only. Sectors
  // sort by count desc (biggest pockets first); industries alphabetical.
  const tree = useMemo<ScannerTreeSector[]>(() => {
    const secMap = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const sec = norm(sectorOf(r));
      const ind = norm(industryOf(r));
      let inds = secMap.get(sec);
      if (!inds) {
        inds = new Map();
        secMap.set(sec, inds);
      }
      inds.set(ind, (inds.get(ind) ?? 0) + 1);
    }
    const out: ScannerTreeSector[] = [];
    for (const [sec, inds] of secMap) {
      let count = 0;
      const industries: ScannerTreeIndustry[] = [];
      for (const [name, n] of inds) {
        industries.push({ name, count: n });
        count += n;
      }
      industries.sort((a, b) => a.name.localeCompare(b.name));
      out.push({ name: sec, count, industries });
    }
    out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return out;
  }, [rows, sectorOf, industryOf]);

  const [selected, setSelected] = useState<ScannerTreeSel>(null);
  const [treeOpen, setTreeOpen] = useState(true);
  const [openSectors, setOpenSectors] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!selected) return rows;
    return rows.filter((r) => {
      if (norm(sectorOf(r)) !== selected.sector) return false;
      if (selected.industry == null) return true;
      return norm(industryOf(r)) === selected.industry;
    });
  }, [rows, selected, sectorOf, industryOf]);

  function toggleSector(name: string) {
    setOpenSectors((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function selectSector(name: string) {
    setSelected({ sector: name, industry: null });
    setOpenSectors((prev) => new Set(prev).add(name));
  }
  function selectIndustry(sector: string, industry: string) {
    setSelected({ sector, industry });
  }

  return {
    tree,
    selected,
    filtered,
    treeOpen,
    setTreeOpen,
    openSectors,
    toggleSector,
    selectSector,
    selectIndustry,
    clear: () => setSelected(null),
  };
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
      className="shrink-0 transition-transform"
      style={{ transform: open ? "rotate(90deg)" : "none" }}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

const ACCENT_BG = "color-mix(in srgb, var(--color-accent-600) 12%, transparent)";
const ACCENT_INK = "var(--color-accent-700)";

export type UseScannerTree<T> = ReturnType<typeof useScannerTree<T>>;

/** The collapsible sector → industry aside. Pass the whole hook object. */
export function ScannerTree<T>({
  tree,
  selected,
  treeOpen,
  setTreeOpen,
  openSectors,
  toggleSector,
  selectSector,
  selectIndustry,
  clear,
  total,
}: UseScannerTree<T> & { total: number }) {
  if (!treeOpen) {
    return (
      <button
        type="button"
        onClick={() => setTreeOpen(true)}
        className="shrink-0 self-start rounded-lg border hairline px-2 py-2 hover:bg-[var(--color-paper)] transition-colors"
        aria-label="Show sector tree"
        title="Show sector tree"
      >
        <Chevron open />
      </button>
    );
  }
  return (
    <aside className="w-[216px] shrink-0 self-start max-h-[calc(100vh-120px)] overflow-y-auto rounded-xl border hairline p-2 text-[12.5px]">
      <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b hairline">
        <span className="text-[11px] uppercase tracking-wide muted-text">Sectors</span>
        <button
          type="button"
          onClick={() => setTreeOpen(false)}
          className="rounded p-1 hover:bg-[var(--color-border)] transition-colors"
          aria-label="Hide sector tree"
          title="Hide tree"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      </div>

      {/* All — clears the filter. */}
      <button
        type="button"
        onClick={clear}
        className="w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-paper)] transition-colors mb-0.5"
        style={selected == null ? { background: ACCENT_BG, color: ACCENT_INK, fontWeight: 600 } : undefined}
      >
        <span className="flex-1 truncate">All sectors</span>
        <span className="text-[10.5px] tabular-nums muted-text">{total}</span>
      </button>

      {tree.map((s) => {
        const open = openSectors.has(s.name);
        const secSel = selected?.sector === s.name && selected.industry == null;
        return (
          <div key={s.name} className="mb-0.5">
            <div
              className="flex items-center gap-1 rounded-md pr-1 transition-colors"
              style={secSel ? { background: ACCENT_BG } : undefined}
            >
              <button
                type="button"
                onClick={() => toggleSector(s.name)}
                className="shrink-0 rounded p-1 hover:bg-[var(--color-border)] transition-colors"
                aria-label={open ? "Collapse" : "Expand"}
              >
                <Chevron open={open} />
              </button>
              <button
                type="button"
                onClick={() => selectSector(s.name)}
                className="flex-1 flex items-center gap-1.5 py-1.5 text-left min-w-0"
              >
                <span className="font-semibold flex-1 truncate" style={secSel ? { color: ACCENT_INK } : undefined}>
                  {s.name}
                </span>
                <span className="text-[10.5px] tabular-nums muted-text">{s.count}</span>
              </button>
            </div>
            {open && (
              <div className="ml-2 border-l hairline pl-1.5">
                {s.industries.map((ind) => {
                  const indSel = selected?.sector === s.name && selected.industry === ind.name;
                  return (
                    <button
                      key={ind.name}
                      type="button"
                      onClick={() => selectIndustry(s.name, ind.name)}
                      className="w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-paper)] transition-colors"
                      style={indSel ? { background: ACCENT_BG } : undefined}
                    >
                      <span className="flex-1 truncate" style={indSel ? { color: ACCENT_INK, fontWeight: 600 } : undefined}>
                        {ind.name}
                      </span>
                      <span className="text-[10.5px] tabular-nums muted-text">{ind.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}
