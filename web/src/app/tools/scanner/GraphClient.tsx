"use client";

/**
 * GraphClient — the "Graph" scanner tab: browse the whole scored universe as
 * candlestick+volume charts, four at a time, grouped by sector → industry.
 *
 * Left: a sector→industry→stock tree (9 sectors, ~49 industries, ~2,100 names).
 * Right: a 2×2 grid of candlestick+volume charts filling the viewport, paged 4
 * stocks at a time within the selected industry, with a window picker.
 *
 * Only the 4 visible symbols' OHLCV is fetched (lazily, cached) — never the
 * whole universe. See useGraphCandles + /api/scanner/ohlc.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { displayCompanyName } from "@/lib/score";
import type { GraphUniverse, GraphSector, GraphIndustry, GraphStock } from "@/lib/graphUniverse";
import { WatchlistButton } from "@/components/WatchlistButton";
import { WindowPicker } from "./WindowPicker";
import type { WindowOpt } from "./sparkWindows";
import { CandleChart } from "./CandleChart";
import { useGraphCandles } from "./useGraphCandles";

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";
const PER_PAGE = 4;

const GRAPH_WINDOWS: WindowOpt[] = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
  { label: "3Y", days: 1100 },
  { label: "5Y", days: 1830 },
  { label: "10Y", days: 3660 },
];

function inr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function fmtVol(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
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

export default function GraphClient({
  universe,
  nifty500,
  n500Only,
}: {
  universe: GraphUniverse;
  nifty500: string[];
  n500Only: boolean;
}) {
  const { snapDate } = universe;

  // When the NIFTY 500 toggle is on, narrow the tree to index members: filter
  // each industry's stocks, recompute counts, and drop industries/sectors that
  // empty out — so the tree shows ~500 names instead of the full ~2,100.
  const n500 = useMemo(() => new Set(nifty500), [nifty500]);
  const sectors = useMemo<GraphSector[]>(() => {
    if (!n500Only) return universe.sectors;
    const out: GraphSector[] = [];
    for (const s of universe.sectors) {
      const inds: GraphIndustry[] = [];
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

  // Flat lookup: industry_id → { industry, sectorName }.
  const industryById = useMemo(() => {
    const m = new Map<string, { ind: GraphIndustry; sector: string }>();
    for (const s of sectors) for (const ind of s.industries) m.set(ind.id, { ind, sector: s.name });
    return m;
  }, [sectors]);

  const firstIndustry = sectors[0]?.industries[0]?.id ?? "";
  const [selectedInd, setSelectedInd] = useState<string>(firstIndustry);
  const [page, setPage] = useState(0);
  const [days, setDays] = useState<number>(180);
  const [treeOpen, setTreeOpen] = useState(true);

  // Tree open-state: sectors expanded, and industries expanded to reveal stocks.
  const [openSectors, setOpenSectors] = useState<Set<string>>(
    () => new Set(sectors[0] ? [sectors[0].name] : []),
  );
  const [openIndustries, setOpenIndustries] = useState<Set<string>>(() => new Set());

  // Toggling the N500 filter can drop the selected industry from the tree; fall
  // back to the first still-present industry so the grid never goes blank.
  const activeInd = industryById.has(selectedInd) ? selectedInd : firstIndustry;
  const selected = industryById.get(activeInd);
  const stocks: GraphStock[] = selected?.ind.stocks ?? [];
  const pageCount = Math.max(1, Math.ceil(stocks.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStocks = stocks.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);
  const pageSymbols = pageStocks.map((s) => s.symbol);

  const candles = useGraphCandles(pageSymbols, days);

  function selectIndustry(id: string) {
    setSelectedInd(id);
    setPage(0);
    setOpenIndustries((prev) => new Set(prev).add(id));
  }
  function toggleSector(name: string) {
    setOpenSectors((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function toggleIndustryStocks(id: string) {
    setOpenIndustries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function jumpToStock(id: string, idx: number) {
    setSelectedInd(id);
    setPage(Math.floor(idx / PER_PAGE));
  }

  const rangeStart = stocks.length === 0 ? 0 : safePage * PER_PAGE + 1;
  const rangeEnd = Math.min(stocks.length, safePage * PER_PAGE + PER_PAGE);

  return (
    <div className="flex flex-col">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="font-display text-[20px] tracking-tight leading-tight">Charts by industry</h1>
            <p className="text-[12px] muted-text">
              {selected ? (
                <>
                  <span className="ink-text font-medium">{selected.sector}</span> ·{" "}
                  <span className="ink-text font-medium">{selected.ind.name}</span> ·{" "}
                  {stocks.length} names
                  {stocks.length > 0 && <> · showing {rangeStart}–{rangeEnd}</>}
                </>
              ) : (
                <>Pick an industry from the tree{snapDate ? <> · panel {snapDate}</> : null}</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <WindowPicker options={GRAPH_WINDOWS} days={days} onSelect={setDays} loading={candles.loading} />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage <= 0}
                className="rounded-md border hairline px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40 hover:bg-[var(--color-paper)] transition-colors"
                aria-label="Previous 4"
              >
                ‹
              </button>
              <span className="text-[12px] tabular-nums muted-text px-1 min-w-[64px] text-center">
                {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className="rounded-md border hairline px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40 hover:bg-[var(--color-paper)] transition-colors"
                aria-label="Next 4"
              >
                ›
              </button>
            </div>
          </div>
      </header>

      <div className="flex gap-3 h-[calc(100vh-158px)] min-h-[560px]">
        {/* ── Left: collapsible sector → industry → stock tree ── */}
        {!treeOpen && (
          <button
            type="button"
            onClick={() => setTreeOpen(true)}
            className="shrink-0 self-start rounded-lg border hairline px-2 py-2 hover:bg-[var(--color-paper)] transition-colors"
            aria-label="Show industry tree"
            title="Show industry tree"
          >
            <Chevron open />
          </button>
        )}
        {treeOpen && (
        <aside className="w-[248px] shrink-0 overflow-y-auto rounded-xl border hairline p-2 text-[12.5px]">
          <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b hairline">
            <span className="text-[11px] uppercase tracking-wide muted-text">Industries</span>
            <button
              type="button"
              onClick={() => setTreeOpen(false)}
              className="rounded p-1 hover:bg-[var(--color-border)] transition-colors"
              aria-label="Hide industry tree"
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
            return (
              <div key={s.name} className="mb-0.5">
                <button
                  type="button"
                  onClick={() => toggleSector(s.name)}
                  className="w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-paper)] transition-colors"
                >
                  <Chevron open={open} />
                  <span className="font-semibold flex-1 truncate">{s.name}</span>
                  <span className="text-[10.5px] tabular-nums muted-text">{s.count}</span>
                </button>
                {open && (
                  <div className="ml-2 border-l hairline pl-1.5">
                    {s.industries.map((ind) => {
                      const isSel = ind.id === activeInd;
                      const stocksOpen = openIndustries.has(ind.id);
                      return (
                        <div key={ind.id}>
                          <div
                            className="flex items-center gap-1 rounded-md pr-1 transition-colors"
                            style={isSel ? { background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)" } : undefined}
                          >
                            <button
                              type="button"
                              onClick={() => toggleIndustryStocks(ind.id)}
                              className="shrink-0 rounded p-1 hover:bg-[var(--color-border)] transition-colors"
                              aria-label={stocksOpen ? "Collapse stocks" : "Expand stocks"}
                            >
                              <Chevron open={stocksOpen} />
                            </button>
                            <button
                              type="button"
                              onClick={() => selectIndustry(ind.id)}
                              className="flex-1 flex items-center gap-1.5 py-1.5 text-left min-w-0"
                            >
                              <span
                                className="flex-1 truncate"
                                style={isSel ? { color: "var(--color-accent-700)", fontWeight: 600 } : undefined}
                              >
                                {ind.name}
                              </span>
                              <span className="text-[10.5px] tabular-nums muted-text">{ind.stocks.length}</span>
                            </button>
                          </div>
                          {stocksOpen && (
                            <ul className="ml-6 mb-1">
                              {ind.stocks.map((st, i) => {
                                const onPage =
                                  isSel && i >= safePage * PER_PAGE && i < safePage * PER_PAGE + PER_PAGE;
                                return (
                                  <li key={st.symbol}>
                                    <button
                                      type="button"
                                      onClick={() => jumpToStock(ind.id, i)}
                                      className="w-full flex items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-[var(--color-paper)] transition-colors"
                                      style={onPage ? { color: "var(--color-accent-700)", fontWeight: 600 } : undefined}
                                    >
                                      <span className="text-[11.5px] tabular-nums truncate">{st.symbol}</span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </aside>
        )}

        {/* ── Right: 2×2 candlestick grid ── */}
        <div className="min-w-0 flex-1 grid grid-cols-2 grid-rows-2 gap-3">
          {Array.from({ length: PER_PAGE }).map((_, i) => {
            const st = pageStocks[i];
            if (!st) {
              return (
                <div key={`empty-${i}`} className="rounded-xl border hairline bg-[var(--color-paper)]/40" />
              );
            }
            const series = candles.data[st.symbol];
            const first = series?.[0];
            const last = series?.[series.length - 1];
            const hi = series && series.length ? Math.max(...series.map((c) => c.h)) : null;
            const lo = series && series.length ? Math.min(...series.map((c) => c.l)) : null;
            const chg = first && last && first.c > 0 ? (last.c / first.c - 1) * 100 : null;
            const chgColor = chg == null ? "var(--color-muted)" : chg >= 0 ? GREEN : RED;
            const lastVol = last?.v ?? null;
            const avgVol =
              series && series.length
                ? series.reduce((a, c) => a + (c.v || 0), 0) / series.length
                : null;
            const volMult = lastVol != null && avgVol && avgVol > 0 ? lastVol / avgVol : null;
            return (
              <div key={st.symbol} className="flex flex-col rounded-xl border hairline overflow-hidden">
                <div className="flex items-center gap-2 border-b hairline px-3 py-2">
                  <WatchlistButton symbol={st.symbol} variant="icon" className="-ml-1 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/stock/${st.symbol}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-[13px] hover:underline truncate"
                      >
                        {st.symbol}
                      </Link>
                      {st.composite_pct != null && (
                        <span
                          className="text-[10.5px] tabular-nums font-medium shrink-0"
                          style={{ color: scoreColor(st.composite_pct) }}
                          title="Industry Score percentile"
                        >
                          {Math.round(st.composite_pct)}
                        </span>
                      )}
                    </div>
                    <div className="text-[10.5px] muted-text truncate">
                      {displayCompanyName(st.name, st.symbol)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12.5px] tabular-nums font-semibold">
                      {last ? inr(last.c) : "—"}
                    </div>
                    <div className="text-[10.5px] tabular-nums font-medium" style={{ color: chgColor }}>
                      {chg == null ? "" : `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`}
                    </div>
                    {hi != null && lo != null && (
                      <div className="text-[9.5px] tabular-nums muted-text mt-0.5" title="Period high / low">
                        <span style={{ color: GREEN }}>H</span> {inr(hi)}
                        {"  "}
                        <span style={{ color: RED }}>L</span> {inr(lo)}
                      </div>
                    )}
                    {lastVol != null && (
                      <div
                        className="text-[9.5px] tabular-nums muted-text mt-0.5"
                        title="Latest session volume · multiple of period average"
                      >
                        Vol {fmtVol(lastVol)}
                        {volMult != null && (
                          <span style={volMult >= 1.5 ? { color: GREEN, fontWeight: 600 } : undefined}>
                            {" "}
                            {volMult.toFixed(1)}×
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div
                  className="flex-1 min-h-0 transition-opacity"
                  style={{ opacity: candles.loading && !series ? 0.4 : 1 }}
                >
                  <CandleChart candles={series} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
