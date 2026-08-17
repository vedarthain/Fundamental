"use client";

/**
 * ThemesClient — the "Themes" scanner tab, rebuilt as a Graph-style candle grid.
 *
 * Pick a theme (Auto, Bank, IT, …) on the left; the right pane is a 3×2 grid of
 * candlestick charts — exactly like the Graph tab — but with the traded INDEX
 * pinned in slot 1 (purple, fixed on every page) and its constituents filling
 * the other five slots, paged 5 at a time. So every screen reads the index next
 * to five of its members on the same timeframe.
 *
 * Data:
 *   - index candles      ← /api/scanner/index-ohlc (app.market_index_history)
 *   - constituent candles← /api/scanner/ohlc (golden, split-safe) via useGraphCandles
 *   - constituent scores ← passed in on each Theme (panel-cache join)
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import type { Theme, ThemeConstituent } from "@/lib/themes";
import type { Candle } from "@/lib/candles";
import { displayCompanyName } from "@/lib/score";
import { WatchlistButton } from "@/components/WatchlistButton";
import { useWatchlist } from "@/lib/watchlist";
import { WindowPicker } from "./WindowPicker";
import type { WindowOpt } from "./sparkWindows";
import { CandleChart } from "./CandleChart";
import { useGraphCandles } from "./useGraphCandles";
import { useIndexCandles } from "./useIndexCandles";
import { WEEKLY_THRESHOLD_DAYS } from "@/lib/candleConfig";
import type { TradeMark } from "@/lib/portfolio";

const P_HELD = "#7c3aed"; // dark purple — currently held
const P_EXITED = "#9ca3af"; // grey — ever bought, not held now

// Tri-state portfolio badge (held → purple, ever-traded-not-held → grey).
function PBadge({ held, traded, size = 18 }: { held: boolean; traded: boolean; size?: number }) {
  if (!held && !traded) return null;
  const col = held ? P_HELD : P_EXITED;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold leading-none shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.58, color: "#fff", backgroundColor: col }}
      title={held ? "In your portfolio" : "Previously held — fully exited"}
    >
      P
    </span>
  );
}

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";
const PURPLE = "#7c3aed";
const CONS_PER_PAGE = 5; // slot 1 is always the index; 5 constituents fill the rest

// Index history goes back ~21y; stock candles ~5y in golden, so at 10Y the
// purple index fills the window while constituents show what golden has.
const THEME_WINDOWS: WindowOpt[] = [
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
function idxNum(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
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

// Metrics read off a candle series (last close, period change, hi/lo).
function seriesStats(series: Candle[] | undefined) {
  if (!series || series.length === 0) return { last: null as Candle | null, chg: null as number | null, hi: null as number | null, lo: null as number | null };
  const first = series[0];
  const last = series[series.length - 1];
  const hi = Math.max(...series.map((c) => c.h));
  const lo = Math.min(...series.map((c) => c.l));
  const chg = first && last && first.c > 0 ? (last.c / first.c - 1) * 100 : null;
  return { last, chg, hi, lo };
}

type FocusTarget =
  | { kind: "index"; theme: Theme }
  | { kind: "stock"; stock: ThemeConstituent };

export default function ThemesClient({
  themes,
  snapDate,
  indexLastDate,
  n500Only,
  nifty500,
  portfolioSymbols = [],
  tradedSymbols = [],
  tradesBySymbol = {},
}: {
  themes: Theme[];
  snapDate: string | null;
  indexLastDate: string | null;
  n500Only: boolean;
  nifty500: string[];
  portfolioSymbols?: string[];
  tradedSymbols?: string[];
  tradesBySymbol?: Record<string, TradeMark[]>;
}) {
  const [selectedCode, setSelectedCode] = useState<string>(themes[0]?.code ?? "");
  const [page, setPage] = useState(0);
  const [days, setDays] = useState<number>(365);
  const [treeOpen, setTreeOpen] = useState(true);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [pOnly, setPOnly] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);

  const { symbols: watchSyms, hydrated: watchHydrated } = useWatchlist();
  const watchSet = useMemo(
    () => new Set(watchSyms.map((s) => s.toUpperCase())),
    [watchSyms],
  );
  const portfolioSet = useMemo(
    () => new Set(portfolioSymbols.map((s) => s.toUpperCase())),
    [portfolioSymbols],
  );
  const tradedSet = useMemo(
    () => new Set(tradedSymbols.map((s) => s.toUpperCase())),
    [tradedSymbols],
  );
  const n500 = useMemo(() => new Set(nifty500), [nifty500]);

  const theme = useMemo(
    () => themes.find((t) => t.code === selectedCode) ?? themes[0],
    [themes, selectedCode],
  );

  // Constituents in scope: NIFTY 500 (global toggle), Watch, and Portfolio
  // filters all narrow the grid — same semantics as the Graph tab.
  const constituents = useMemo<ThemeConstituent[]>(() => {
    if (!theme) return [];
    return theme.constituents.filter((c) => {
      if (n500Only && !n500.has(c.symbol)) return false;
      if (watchOnly && !watchSet.has(c.symbol)) return false;
      if (pOnly && !portfolioSet.has(c.symbol)) return false;
      return true;
    });
  }, [theme, n500Only, n500, watchOnly, watchSet, pOnly, portfolioSet]);

  const pageCount = Math.max(1, Math.ceil(constituents.length / CONS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const pageStocks = constituents.slice(safePage * CONS_PER_PAGE, safePage * CONS_PER_PAGE + CONS_PER_PAGE);
  const pageSymbols = pageStocks.map((s) => s.symbol);

  // Switch theme + jump back to the first page in one handler (avoids a
  // setState-in-effect; safePage already clamps if the N500 toggle shrinks the
  // list under the current page).
  const selectTheme = (code: string) => { setSelectedCode(code); setPage(0); };

  // Left-rail tree: each theme expands to reveal its constituent stocks.
  const [openThemes, setOpenThemes] = useState<Set<string>>(
    () => new Set(themes[0] ? [themes[0].code] : []),
  );
  const scopedConstituents = (t: Theme) =>
    n500Only ? t.constituents.filter((c) => n500.has(c.symbol)) : t.constituents;
  const toggleThemeOpen = (code: string) =>
    setOpenThemes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  // Click a stock in the tree → select its theme and jump to the page holding it.
  const selectStock = (t: Theme, symbol: string) => {
    const idx = scopedConstituents(t).findIndex((c) => c.symbol === symbol);
    setSelectedCode(t.code);
    setPage(idx >= 0 ? Math.floor(idx / CONS_PER_PAGE) : 0);
  };

  const consCandles = useGraphCandles(pageSymbols, days);
  const idxCandles = useIndexCandles(theme?.code ?? "", days);
  const weekly = days > WEEKLY_THRESHOLD_DAYS;

  // Esc closes the focus overlay.
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFocus(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  if (!theme) {
    return <div className="muted-text text-[13px] py-8">No theme data yet.</div>;
  }

  const idxStats = seriesStats(idxCandles.candles);
  const rangeStart = constituents.length ? safePage * CONS_PER_PAGE + 1 : 0;
  const rangeEnd = safePage * CONS_PER_PAGE + pageStocks.length;
  // How many of THIS index's constituents you actually hold (distinct from the
  // Portfolio toggle's total-holdings count).
  const heldInTheme = constituents.filter((c) => portfolioSet.has(c.symbol)).length;

  return (
    <div className="flex flex-col">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-display text-[20px] tracking-tight leading-tight">
            {theme.displayName ?? theme.label} · index vs. constituents
          </h1>
          <p className="text-[12px] muted-text">
            {constituents.length} names
            {constituents.length ? <> · showing {rangeStart}–{rangeEnd}</> : null}
            {heldInTheme > 0 ? (
              <>
                {" · "}
                <span style={{ color: PURPLE, fontWeight: 600 }}>
                  {heldInTheme} held
                </span>
              </>
            ) : null}
            {n500Only ? " · NIFTY 500 scope" : ""}
            {snapDate ? <> · panel {snapDate}</> : null}
            {indexLastDate ? <> · index to {indexLastDate}</> : null}
          </p>
          <p className="text-[11px] muted-text mt-0.5">
            <span style={{ color: PURPLE, fontWeight: 600 }}>ER</span> = Excess Return — a stock&apos;s
            return over the selected window minus the index&apos;s own return (positive = beating its theme).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { setWatchOnly((v) => !v); setPage(0); }}
            disabled={!watchOnly && watchSet.size === 0}
            className="inline-flex items-center gap-1.5 rounded-md border hairline px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-40 hover:bg-[var(--color-paper)]"
            style={
              watchOnly
                ? { borderColor: "#e8a838", backgroundColor: "color-mix(in srgb, #e8a838 12%, transparent)", color: "#e8a838" }
                : undefined
            }
            aria-pressed={watchOnly}
            title={watchSet.size === 0 ? "Star some stocks first" : watchOnly ? "Showing watched only — click for all" : "Show watched only"}
          >
            <Star size={13} fill={watchOnly ? "#e8a838" : "none"} strokeWidth={2} />
            <span>Watch{watchHydrated && watchSet.size > 0 ? ` · ${watchSet.size}` : ""}</span>
          </button>
          <button
            type="button"
            onClick={() => { setPOnly((v) => !v); setPage(0); }}
            disabled={!pOnly && portfolioSet.size === 0}
            className="inline-flex items-center gap-1.5 rounded-md border hairline px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-40 hover:bg-[var(--color-paper)]"
            style={
              pOnly
                ? { borderColor: PURPLE, backgroundColor: "color-mix(in srgb, #7c3aed 12%, transparent)", color: PURPLE }
                : undefined
            }
            aria-pressed={pOnly}
            title={portfolioSet.size === 0 ? "No portfolio holdings yet — add them on the Portfolio tab" : pOnly ? "Showing portfolio holdings only — click for all" : "Show portfolio holdings only"}
          >
            <span
              className="inline-flex items-center justify-center rounded-full border font-bold leading-none"
              style={{ width: 15, height: 15, fontSize: 9.5, borderColor: pOnly ? PURPLE : "currentColor", color: pOnly ? "#fff" : "inherit", backgroundColor: pOnly ? PURPLE : "transparent" }}
              aria-hidden
            >
              P
            </span>
            <span>Portfolio{portfolioSet.size > 0 ? ` · ${portfolioSet.size}` : ""}</span>
          </button>
          <WindowPicker options={THEME_WINDOWS} days={days} onSelect={setDays} loading={consCandles.loading || idxCandles.loading} />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage <= 0}
              className="rounded-md border hairline px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40 hover:bg-[var(--color-paper)] transition-colors"
              aria-label="Previous page"
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
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        </div>
      </header>

      <div className="flex gap-3 h-[calc(100vh-158px)] min-h-[560px]">
        {/* ── Left: theme picker ── */}
        {!treeOpen && (
          <button
            type="button"
            onClick={() => setTreeOpen(true)}
            className="shrink-0 self-start rounded-lg border hairline px-2 py-2 hover:bg-[var(--color-paper)] transition-colors"
            aria-label="Show theme list"
            title="Show theme list"
          >
            <Chevron open />
          </button>
        )}
        {treeOpen && (
          <aside className="w-[200px] shrink-0 overflow-y-auto rounded-xl border hairline p-2 text-[12.5px]">
            <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b hairline">
              <span className="text-[11px] uppercase tracking-wide muted-text">Themes</span>
              <button
                type="button"
                onClick={() => setTreeOpen(false)}
                className="rounded p-1 hover:bg-[var(--color-border)] transition-colors"
                aria-label="Hide theme list"
                title="Hide list"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
            </div>
            {themes.map((t) => {
              const active = t.code === selectedCode;
              const open = openThemes.has(t.code);
              const list = scopedConstituents(t);
              const held = list.filter((c) => portfolioSet.has(c.symbol)).length;
              return (
                <div key={t.code} className="mb-0.5">
                  <div
                    className="flex items-center gap-0.5 rounded-md pr-1"
                    style={active ? { background: "color-mix(in srgb, #7c3aed 12%, transparent)" } : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => toggleThemeOpen(t.code)}
                      className="shrink-0 rounded p-1 hover:bg-[var(--color-border)] transition-colors"
                      aria-label={open ? "Collapse stocks" : "Expand stocks"}
                    >
                      <Chevron open={open} />
                    </button>
                    <button
                      type="button"
                      onClick={() => selectTheme(t.code)}
                      className="flex-1 flex items-center gap-1.5 py-2 text-left min-w-0"
                    >
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: active ? PURPLE : "var(--color-border)" }}
                        aria-hidden
                      />
                      <span
                        className="font-semibold flex-1 truncate"
                        style={active ? { color: PURPLE } : undefined}
                      >
                        {t.displayName ?? t.label}
                      </span>
                      {held > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded-full px-1.5 text-[9.5px] font-bold tabular-nums leading-[15px] shrink-0"
                          style={{ color: "#fff", background: PURPLE }}
                          title={`You hold ${held} of this index's ${list.length} constituents`}
                        >
                          P{held}
                        </span>
                      )}
                      <span className="text-[10.5px] tabular-nums muted-text">{list.length}</span>
                    </button>
                  </div>
                  {open && (
                    <ul className="ml-5 mb-1 border-l hairline pl-1.5">
                      {list.map((c, i) => {
                        const onPage =
                          active &&
                          i >= safePage * CONS_PER_PAGE &&
                          i < safePage * CONS_PER_PAGE + CONS_PER_PAGE;
                        return (
                          <li key={c.symbol} className="flex items-center gap-0.5">
                            <WatchlistButton symbol={c.symbol} variant="icon" className="!w-6 !h-6 shrink-0" />
                            <button
                              type="button"
                              onClick={() => selectStock(t, c.symbol)}
                              className="flex-1 min-w-0 flex items-center rounded px-1.5 py-1 text-left hover:bg-[var(--color-paper)] transition-colors"
                              style={onPage ? { color: PURPLE, fontWeight: 600 } : undefined}
                            >
                              <span className="text-[11.5px] tabular-nums truncate">{c.symbol}</span>
                            </button>
                          </li>
                        );
                      })}
                      {list.length === 0 && (
                        <li className="px-1.5 py-1 text-[11px] muted-text italic">none in scope</li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </aside>
        )}

        {/* ── Right: 3×2 candle grid — index pinned in slot 1, then 5 constituents ── */}
        <div className="min-w-0 flex-1 grid grid-cols-3 grid-rows-2 gap-3">
          {/* Slot 1: the index (purple, no volume) — fixed on every page */}
          <div
            className="flex flex-col rounded-xl overflow-hidden border-2"
            style={{ borderColor: "color-mix(in srgb, #7c3aed 45%, transparent)" }}
          >
            <div className="flex items-center gap-2 border-b hairline px-3 py-2">
              <span
                className="inline-flex items-center rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide shrink-0"
                style={{ color: "#fff", background: PURPLE }}
              >
                Index
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[13px] truncate" style={{ color: PURPLE }}>
                  {theme.displayName ?? theme.label}
                </div>
                <div className="text-[10.5px] muted-text truncate">{constituents.length} constituents</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[12.5px] tabular-nums font-semibold">
                  {idxStats.last ? idxNum(idxStats.last.c) : "—"}
                </div>
                <div className="text-[10.5px] tabular-nums font-medium" style={{ color: idxStats.chg == null ? "var(--color-muted)" : idxStats.chg >= 0 ? GREEN : RED }}>
                  {idxStats.chg == null ? "" : `${idxStats.chg >= 0 ? "+" : ""}${idxStats.chg.toFixed(1)}%`}
                </div>
                {idxStats.hi != null && idxStats.lo != null && (
                  <div className="text-[9.5px] tabular-nums muted-text mt-0.5" title="Period high / low">
                    <span style={{ color: GREEN }}>H</span> {idxNum(idxStats.hi)}
                    {"  "}
                    <span style={{ color: RED }}>L</span> {idxNum(idxStats.lo)}
                  </div>
                )}
              </div>
            </div>
            <div
              className="flex-1 min-h-0 transition-opacity"
              style={{ opacity: idxCandles.loading && idxCandles.candles.length === 0 ? 0.4 : 1 }}
            >
              <CandleChart candles={idxCandles.candles} weekly={weekly} hideVolume />
            </div>
            <div className="flex items-center justify-end border-t hairline px-2 py-1">
              <button
                type="button"
                onClick={() => idxCandles.candles.length >= 2 && setFocus({ kind: "index", theme })}
                disabled={idxCandles.candles.length < 2}
                className="inline-flex items-center gap-1 rounded-md border hairline px-2 py-1 text-[10.5px] font-medium disabled:opacity-40 hover:bg-[var(--color-paper)] transition-colors"
                title="Expand chart"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
                Expand
              </button>
            </div>
          </div>

          {/* Empty state: a filter (or scope) hid every constituent — say so
              instead of leaving the lone index looking broken. */}
          {constituents.length === 0 && (
            <div className="col-span-2 row-span-2 flex items-center justify-center rounded-xl border hairline">
              <div className="text-center px-6 max-w-[420px]">
                <div className="text-[14px] font-semibold mb-1">No constituents to show</div>
                <div className="text-[12.5px] muted-text leading-[1.5]">
                  {watchOnly
                    ? "You're not watching any of this index's constituents. Turn off the Watch filter to see all names."
                    : pOnly
                      ? "None of this index's constituents are in your portfolio — showing the index only. Turn off the Portfolio filter to see all names."
                      : n500Only
                        ? "No constituents of this index are in the NIFTY 500 scope. Switch to the full universe to see all names."
                        : "This index has no constituents on record yet."}
                </div>
              </div>
            </div>
          )}

          {/* Slots 2-6: five constituents */}
          {pageStocks.map((st) => {
            const series = consCandles.data[st.symbol];
            const { last, chg, hi, lo } = seriesStats(series);
            const chgColor = chg == null ? "var(--color-muted)" : chg >= 0 ? GREEN : RED;
            // Excess return = stock's window return minus the index's own — >0
            // means it's beating its theme, not just riding the tide.
            const excess = chg != null && idxStats.chg != null ? chg - idxStats.chg : null;
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
                      {st.compositePct != null && (
                        <span
                          className="text-[10.5px] tabular-nums font-medium shrink-0"
                          style={{ color: scoreColor(st.compositePct) }}
                          title="Industry Score percentile"
                        >
                          {Math.round(st.compositePct)}
                        </span>
                      )}
                    </div>
                    <div className="text-[10.5px] muted-text truncate">
                      {displayCompanyName(st.name, st.symbol)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-center justify-end gap-2.5">
                      {(st.qualityPct != null || st.valuationPct != null) && (
                        <div className="flex items-center gap-1.5 text-[10px] tabular-nums font-medium">
                          <span title="Quality percentile">
                            <span className="muted-text">Q</span>{" "}
                            <span style={{ color: scoreColor(st.qualityPct) }}>
                              {st.qualityPct != null ? Math.round(st.qualityPct) : "—"}
                            </span>
                          </span>
                          <span title="Valuation percentile">
                            <span className="muted-text">V</span>{" "}
                            <span style={{ color: scoreColor(st.valuationPct) }}>
                              {st.valuationPct != null ? Math.round(st.valuationPct) : "—"}
                            </span>
                          </span>
                        </div>
                      )}
                      <div className="text-[12.5px] tabular-nums font-semibold">
                        {last ? inr(last.c) : "—"}
                      </div>
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
                  </div>
                </div>
                <div
                  className="flex-1 min-h-0 transition-opacity"
                  style={{ opacity: consCandles.loading && !series ? 0.4 : 1 }}
                >
                  <CandleChart candles={series} weekly={weekly} />
                </div>
                <div className="flex items-center justify-between gap-1.5 border-t hairline px-2 py-1">
                  <span
                    className="text-[10.5px] tabular-nums font-semibold"
                    style={{ color: excess == null ? "var(--color-muted)" : excess >= 0 ? GREEN : RED }}
                    title={`Excess return vs. the index over ${THEME_WINDOWS.find((w) => w.days === days)?.label ?? "the window"} — the stock's return minus the index's own`}
                  >
                    ER {excess == null ? "—" : `${excess >= 0 ? "+" : ""}${excess.toFixed(1)}%`}
                  </span>
                  <div className="flex items-center gap-1.5">
                  <PBadge held={portfolioSet.has(st.symbol)} traded={tradedSet.has(st.symbol)} />
                  <button
                    type="button"
                    onClick={() => series && series.length >= 2 && setFocus({ kind: "stock", stock: st })}
                    disabled={!series || series.length < 2}
                    className="inline-flex items-center gap-1 rounded-md border hairline px-2 py-1 text-[10.5px] font-medium disabled:opacity-40 hover:bg-[var(--color-paper)] transition-colors"
                    title="Expand chart"
                    aria-label={`Expand ${st.symbol} chart`}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                    Expand
                  </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Focus overlay: one expanded, interactive chart ── */}
      {focus && (() => {
        const isIndex = focus.kind === "index";
        const series = isIndex ? idxCandles.candles : consCandles.data[focus.stock.symbol];
        const label = isIndex ? (focus.theme.displayName ?? focus.theme.label) : focus.stock.symbol;
        const sub = isIndex
          ? `${constituents.length} constituents`
          : displayCompanyName(focus.stock.name, focus.stock.symbol);
        const { last, chg, hi, lo } = seriesStats(series);
        const chgColor = chg == null ? "var(--color-muted)" : chg >= 0 ? GREEN : RED;
        const fmt = isIndex ? idxNum : inr;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-8"
            onClick={() => setFocus(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`${label} expanded chart`}
          >
            <div
              className="relative flex h-[88vh] w-[94vw] max-w-[1280px] flex-col rounded-2xl border hairline shadow-2xl"
              style={{ background: "var(--color-card, #fff)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 border-b hairline px-4 py-3">
                {!isIndex && <WatchlistButton symbol={focus.stock.symbol} variant="icon" className="shrink-0" />}
                {isIndex && (
                  <span
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide shrink-0"
                    style={{ color: "#fff", background: PURPLE }}
                  >
                    Index
                  </span>
                )}
                <div className="min-w-0">
                  <div className="font-semibold text-[15px] truncate" style={isIndex ? { color: PURPLE } : undefined}>
                    {isIndex ? label : (
                      <Link href={`/stock/${focus.stock.symbol}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {label}
                      </Link>
                    )}
                  </div>
                  <div className="text-[11px] muted-text truncate">{sub}</div>
                </div>
                <div className="ml-auto flex items-center gap-4">
                  {!isIndex && (
                    <PBadge held={portfolioSet.has(focus.stock.symbol)} traded={tradedSet.has(focus.stock.symbol)} />
                  )}
                  <div className="text-right leading-tight">
                    <div className="text-[15px] tabular-nums font-semibold">{last ? fmt(last.c) : "—"}</div>
                    <div className="text-[11px] tabular-nums font-medium" style={{ color: chgColor }}>
                      {chg == null ? "" : `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`}
                      {hi != null && lo != null && (
                        <span className="muted-text font-normal">
                          {"  "}
                          <span style={{ color: GREEN }}>H</span> {fmt(hi)}{"  "}
                          <span style={{ color: RED }}>L</span> {fmt(lo)}
                        </span>
                      )}
                    </div>
                  </div>
                  <WindowPicker options={THEME_WINDOWS} days={days} onSelect={setDays} loading={consCandles.loading || idxCandles.loading} />
                  <button
                    type="button"
                    onClick={() => setFocus(null)}
                    className="rounded-md border hairline px-2.5 py-1.5 text-[13px] font-medium hover:bg-[var(--color-paper)] transition-colors"
                    aria-label="Close expanded chart"
                    title="Close (Esc)"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 p-2">
                <CandleChart
                  candles={series}
                  interactive
                  weekly={weekly}
                  hideVolume={isIndex}
                  trades={isIndex ? undefined : tradesBySymbol[focus.stock.symbol]}
                />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
