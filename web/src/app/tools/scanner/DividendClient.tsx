"use client";

/**
 * DividendClient — the Dividend Scanner tab. Cloned from the Graph tab's format:
 * a header on top, then a collapsible sector → industry tree on the left and the
 * content pane on the right filling the viewport. Here the right pane is a
 * sortable table of LTP, last-4-FY dividend-per-share, trailing yield, and
 * composite. The whole universe ships with the page, so filtering/sorting is
 * instant and client-side — no refetching.
 *
 * The NIFTY-500 scope comes from the scanner shell's shared toggle (n500Only
 * prop), the same way GraphClient consumes it — so there's one universe switch
 * for the whole Scanner surface, not a per-tab one.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { displayCompanyName } from "@/lib/score";
import type { DividendUniverse, DivSector, DivStock } from "@/lib/dividendScanner";

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";

type Selection = { type: "sector" | "industry"; key: string };
type SortKey = "composite" | "ltp" | "yield" | `fy${number}`;
type SortDir = "asc" | "desc";

function inr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function scoreColor(p: number | null): string {
  if (p == null) return "var(--color-muted)";
  if (p >= 66) return GREEN;
  if (p >= 40) return "var(--color-score-weak, #b7791f)";
  return RED;
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

// Sortable column header. Hoisted to module scope (defining it inside the render
// would remount the whole table on every keystroke) — state comes in as props.
function SortHead({
  label,
  k,
  className,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  k: SortKey;
  className?: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th className={`px-2 py-2 font-medium ${className ?? "text-right"}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 hover:text-[var(--color-ink)] transition-colors"
        style={active ? { color: "var(--color-ink)" } : undefined}
        title={`Sort by ${label}`}
      >
        {label}
        <span className="text-[9px] w-2 inline-block" aria-hidden>
          {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );
}

export default function DividendClient({
  universe,
  nifty500,
  n500Only,
}: {
  universe: DividendUniverse;
  nifty500: string[];
  n500Only: boolean;
}) {
  const { fyLabels, snapDate } = universe;

  const [treeOpen, setTreeOpen] = useState(true);

  // NIFTY 500 filter: narrow every industry's stocks to index members, recompute
  // counts, and drop industries/sectors that empty out (mirrors the Graph tab).
  const n500 = useMemo(() => new Set(nifty500), [nifty500]);
  const sectors = useMemo<DivSector[]>(() => {
    if (!n500Only) return universe.sectors;
    const out: DivSector[] = [];
    for (const s of universe.sectors) {
      const inds = [];
      let count = 0;
      for (const ind of s.industries) {
        const stocks = ind.stocks.filter((st) => n500.has(st.symbol));
        if (stocks.length) {
          inds.push({ ...ind, stocks });
          count += stocks.length;
        }
      }
      if (inds.length) out.push({ ...s, count, industries: inds });
    }
    return out;
  }, [universe.sectors, n500, n500Only]);
  const [openSectors, setOpenSectors] = useState<Set<string>>(
    () => new Set(sectors[0] ? [sectors[0].name] : []),
  );
  const [selected, setSelected] = useState<Selection>(
    sectors[0] ? { type: "sector", key: sectors[0].name } : { type: "sector", key: "" },
  );
  const [sortKey, setSortKey] = useState<SortKey>("composite");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sectorByName = useMemo(() => {
    const m = new Map<string, (typeof sectors)[number]>();
    for (const s of sectors) m.set(s.name, s);
    return m;
  }, [sectors]);
  const industryById = useMemo(() => {
    const m = new Map<string, { name: string; stocks: DivStock[]; sector: string }>();
    for (const s of sectors) for (const ind of s.industries) m.set(ind.id, { name: ind.name, stocks: ind.stocks, sector: s.name });
    return m;
  }, [sectors]);

  // Toggling N500 can drop the selected sector/industry from the tree; fall back
  // to the first surviving sector so the table never goes blank.
  const activeSel: Selection = useMemo(() => {
    if (selected.type === "industry" && industryById.has(selected.key)) return selected;
    if (selected.type === "sector" && sectorByName.has(selected.key)) return selected;
    return sectors[0] ? { type: "sector", key: sectors[0].name } : selected;
  }, [selected, industryById, sectorByName, sectors]);

  // Stocks in the current selection (a whole sector, or one industry).
  const baseStocks: DivStock[] = useMemo(() => {
    if (activeSel.type === "industry") return industryById.get(activeSel.key)?.stocks ?? [];
    const sec = sectorByName.get(activeSel.key);
    return sec ? sec.industries.flatMap((i) => i.stocks) : [];
  }, [activeSel, industryById, sectorByName]);

  function sortVal(s: DivStock, key: SortKey): number | null {
    if (key === "composite") return s.composite_pct;
    if (key === "ltp") return s.ltp;
    if (key === "yield") return s.divYield;
    const idx = Number(key.slice(2)); // "fy0" → 0
    return s.dps[idx] ?? null;
  }

  const stocks = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...baseStocks].sort((a, b) => {
      const va = sortVal(a, sortKey);
      const vb = sortVal(b, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulls always last
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [baseStocks, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }
  function toggleSector(name: string) {
    setOpenSectors((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const selLabel =
    activeSel.type === "industry"
      ? industryById.get(activeSel.key)?.name ?? "—"
      : activeSel.key;
  const selSector =
    activeSel.type === "industry" ? industryById.get(activeSel.key)?.sector ?? "" : activeSel.key;

  if (universe.sectors.length === 0) {
    return <div className="muted-text text-[13px] italic">No dividend data available.</div>;
  }

  return (
    <div className="flex flex-col">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-display text-[20px] tracking-tight leading-tight">Dividend Scanner</h1>
          <p className="text-[12px] muted-text">
            <span className="ink-text font-medium">{selSector}</span>
            {activeSel.type === "industry" && (
              <>
                {" · "}
                <span className="ink-text font-medium">{selLabel}</span>
              </>
            )}{" "}
            · {stocks.length} names · dividend per share by fiscal year
            {snapDate ? <> · panel {snapDate}</> : null}
          </p>
        </div>
      </header>

      <div className="flex gap-3 h-[calc(100vh-158px)] min-h-[560px]">
        {/* ── Left: collapsible sector → industry tree ── */}
        {!treeOpen && (
          <button
            type="button"
            onClick={() => setTreeOpen(true)}
            className="shrink-0 self-start rounded-lg border hairline px-2 py-2 hover:bg-[var(--color-paper)] transition-colors"
            aria-label="Show sector tree"
            title="Show sector tree"
          >
            <Chevron open />
          </button>
        )}
        {treeOpen && (
          <aside className="w-[248px] shrink-0 overflow-y-auto rounded-xl border hairline p-2 text-[12.5px]">
            <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b hairline">
              <span className="text-[11px] uppercase tracking-wide muted-text">Sectors</span>
              <button
                type="button"
                onClick={() => setTreeOpen(false)}
                className="rounded p-1 hover:bg-[var(--color-border)] transition-colors"
                aria-label="Hide sector tree"
                title="Hide tree"
              >
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden
                >
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
            </div>
            {sectors.map((s) => {
              const open = openSectors.has(s.name);
              const secSel = activeSel.type === "sector" && activeSel.key === s.name;
              return (
                <div key={s.name} className="mb-0.5">
                  <div
                    className="flex items-center gap-1 rounded-md pr-1 transition-colors"
                    style={secSel ? { background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)" } : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSector(s.name)}
                      className="shrink-0 rounded p-1 hover:bg-[var(--color-border)] transition-colors"
                      aria-label={open ? "Collapse industries" : "Expand industries"}
                    >
                      <Chevron open={open} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected({ type: "sector", key: s.name })}
                      className="flex-1 flex items-center gap-1.5 py-1.5 text-left min-w-0"
                    >
                      <span
                        className="font-semibold flex-1 truncate"
                        style={secSel ? { color: "var(--color-accent-700)" } : undefined}
                      >
                        {s.name}
                      </span>
                      <span className="text-[10.5px] tabular-nums muted-text">{s.count}</span>
                    </button>
                  </div>
                  {open && (
                    <div className="ml-2 border-l hairline pl-1.5">
                      {s.industries.map((ind) => {
                        const isSel = activeSel.type === "industry" && activeSel.key === ind.id;
                        return (
                          <button
                            key={ind.id}
                            type="button"
                            onClick={() => setSelected({ type: "industry", key: ind.id })}
                            className="w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-paper)] transition-colors"
                            style={isSel ? { background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)" } : undefined}
                          >
                            <span
                              className="flex-1 truncate"
                              style={isSel ? { color: "var(--color-accent-700)", fontWeight: 600 } : undefined}
                            >
                              {ind.name}
                            </span>
                            <span className="text-[10.5px] tabular-nums muted-text">{ind.stocks.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </aside>
        )}

        {/* ── Right: sortable dividend table ── */}
        <div className="min-w-0 flex-1 overflow-auto rounded-xl border hairline">
          <table className="w-full text-[12.5px] border-collapse">
            <thead className="sticky top-0 z-10 bg-[var(--color-card,#fff)] border-b hairline text-[11px] uppercase tracking-wide muted-text">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Stock</th>
                <SortHead label="LTP" k="ltp" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                {fyLabels.map((fy, i) => (
                  <SortHead key={fy} label={fy} k={`fy${i}` as SortKey} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                ))}
                <SortHead label="Yield" k="yield" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHead label="Composite" k="composite" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {stocks.map((s) => (
                <tr key={s.symbol} className="border-b hairline hover:bg-[var(--color-paper)] transition-colors">
                  <td className="px-3 py-2">
                    <Link
                      href={`/stock/${s.symbol}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold hover:underline"
                    >
                      {s.symbol}
                    </Link>
                    <div className="text-[10.5px] muted-text truncate max-w-[280px]">
                      {displayCompanyName(s.name, s.symbol)}
                      <span className="opacity-70"> · {s.sector} · {s.industry}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{s.ltp != null ? inr(s.ltp) : "—"}</td>
                  {s.dps.map((d, i) => (
                    <td key={i} className="px-2 py-2 text-right tabular-nums">
                      {d != null ? d.toFixed(2) : <span className="muted-text">—</span>}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right tabular-nums font-medium">
                    {s.divYield != null ? (
                      <span style={s.divYield >= 3 ? { color: GREEN, fontWeight: 600 } : undefined}>
                        {s.divYield.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="muted-text">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold" style={{ color: scoreColor(s.composite_pct) }}>
                    {s.composite_pct != null ? Math.round(s.composite_pct) : "—"}
                  </td>
                </tr>
              ))}
              {stocks.length === 0 && (
                <tr>
                  <td colSpan={4 + fyLabels.length} className="px-3 py-6 text-center muted-text italic">
                    No stocks in this selection.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
