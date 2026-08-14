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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { displayCompanyName } from "@/lib/score";
import type { GraphUniverse, GraphSector, GraphIndustry, GraphStock } from "@/lib/graphUniverse";
import { WatchlistButton } from "@/components/WatchlistButton";
import { StarButton } from "@/components/StarButton";
import { useStarred } from "@/lib/starred";
import { WindowPicker } from "./WindowPicker";
import type { WindowOpt } from "./sparkWindows";
import { CandleChart, type ChartTool, type Drawing } from "./CandleChart";
import { useGraphCandles } from "./useGraphCandles";
import { WEEKLY_THRESHOLD_DAYS } from "@/lib/candleConfig";
import type { TradeMark } from "@/lib/portfolio";
import type { Candle } from "@/lib/candles";

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";
const PER_PAGE = 6;
const P_HELD = "#7c3aed"; // dark purple — currently held
const P_EXITED = "#9ca3af"; // grey — ever bought, not held now

// Small grid charts show ONE marker: the latest BUY, and only for a currently
// held stock — no sell history, no earlier lots (the expanded chart keeps the
// full B/S history). Returns [] when the stock has no buy on record.
function latestBuyMark(list?: TradeMark[]): TradeMark[] {
  if (!list?.length) return [];
  let best: TradeMark | null = null;
  for (const t of list) {
    if (t.side !== "B") continue;
    if (!best || t.d > best.d) best = t;
  }
  return best ? [best] : [];
}

// Tri-state portfolio badge. Held → dark purple; ever-traded-not-held → grey;
// never → nothing. Returns null when no badge should show.
function PBadge({
  held,
  traded,
  size = 18,
}: {
  held: boolean;
  traded: boolean;
  size?: number;
}) {
  if (!held && !traded) return null;
  const col = held ? P_HELD : P_EXITED;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold leading-none shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.58, color: "#fff", backgroundColor: col }}
      title={held ? "In your portfolio" : "Previously held — fully exited"}
      aria-label={held ? "currently held" : "previously held, exited"}
    >
      P
    </span>
  );
}

// "% increase in price till date" shown beside the P badge — current price vs
// your quantity-weighted average buy price. Green/red; hidden when we can't
// derive a cost basis or a live price. (avgBuyPrice is hoisted below.)
function HoldGainBadge({ trades, last }: { trades?: TradeMark[]; last: number | null }) {
  const avg = avgBuyPrice(trades);
  if (avg == null || last == null || !(last > 0)) return null;
  const pct = (last / avg - 1) * 100;
  return (
    <span
      className="text-[10.5px] tabular-nums font-semibold shrink-0"
      style={{ color: pct >= 0 ? GREEN : RED }}
      title={`Since your avg buy ${inr(avg)} → ${inr(last)}`}
    >
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

// One grid page: a chunk of a single industry within the active sector. Paging
// walks these in order so the grid rolls from one industry into the next.
type SecPage = {
  indId: string;
  indName: string;
  stocks: GraphStock[];
  chunkStart: number; // 1-based index of the first stock (within the industry)
  indTotal: number;   // total stocks in this industry
};

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

// Percentage move over the last `back` candles (last close vs the close `back`
// bars earlier). Returns null when the series is too short. Used for the 1D/1W
// growth badges overlaid on each chart.
function pctBack(series: Candle[] | undefined, back: number): number | null {
  if (!series || series.length <= back) return null;
  const last = series[series.length - 1];
  const prev = series[series.length - 1 - back];
  if (!last || !prev || !(prev.c > 0)) return null;
  return (last.c / prev.c - 1) * 100;
}

// Small "1D +1.2%" style tag; muted label, green/red value.
function GrowthTag({ label, v }: { label: string; v: number | null }) {
  const color = v == null ? "var(--color-muted)" : v >= 0 ? GREEN : RED;
  return (
    <span className="tabular-nums">
      <span className="muted-text">{label}</span>{" "}
      <span style={{ color }}>{v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}</span>
    </span>
  );
}

// Quantity-weighted average BUY price across a symbol's trades — the cost basis
// used for the "since you bought" gain shown next to the portfolio (P) badge.
// Sells are ignored: this answers "how far has price moved from what I paid",
// not realised P&L.
function avgBuyPrice(list?: TradeMark[]): number | null {
  if (!list?.length) return null;
  let cost = 0;
  let qty = 0;
  for (const t of list) {
    if (t.side !== "B" || !(t.price > 0) || !(t.qty > 0)) continue;
    cost += t.price * t.qty;
    qty += t.qty;
  }
  return qty > 0 ? cost / qty : null;
}

// Ruler / measure-tool glyph.
function RulerIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M2 12l10-10 10 10-10 10z" />
      <path d="M8 6l2 2M6 8l2 2M11 9l2 2M9 11l2 2M14 12l2 2M12 14l2 2" />
    </svg>
  );
}

function HLineIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M3 12h18" />
      <circle cx="7" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="17" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TrendIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M4 19L20 5" />
      <circle cx="4" cy="19" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="20" cy="5" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EraseIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M4 20h16" />
      <path d="M13.5 6.5l4 4L9 19H5l-1-4z" />
    </svg>
  );
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
  portfolioSymbols = [],
  tradedSymbols = [],
  tradesBySymbol = {},
}: {
  universe: GraphUniverse;
  nifty500: string[];
  n500Only: boolean;
  /** The user's REAL portfolio holdings (app.portfolio_holding). Drives the
   *  auto-lit "P" marker + the Portfolio filter/count — read-only here;
   *  holdings are edited on the Portfolio tab. */
  portfolioSymbols?: string[];
  /** Symbols ever traded (app.portfolio_transaction) — grey "P" when not held. */
  tradedSymbols?: string[];
  /** Executed B/S trades per symbol, for markers on the expanded chart. */
  tradesBySymbol?: Record<string, TradeMark[]>;
}) {
  const { snapDate } = universe;
  const portfolioSet = useMemo(
    () => new Set(portfolioSymbols.map((s) => s.toUpperCase())),
    [portfolioSymbols],
  );
  const tradedSet = useMemo(
    () => new Set(tradedSymbols.map((s) => s.toUpperCase())),
    [tradedSymbols],
  );

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

  // Starred stocks: a local-only favourites list (see @/lib/starred). One job
  // here — power the "Favourites only" filter that hides all non-starred names.
  // Deliberately does NOT reorder the default view: starring a stock leaves it
  // exactly where it is (the user asked not to be yanked to the top), so they
  // can star in place and recall the set later via the Favourites toggle.
  // Distinct from the watchlist heart: purely a Graph-tab scan aid, no server.
  const { symbols: starredSyms, hydrated: starHydrated } = useStarred();
  const starSet = useMemo(() => new Set(starredSyms), [starredSyms]);
  const [favOnly, setFavOnly] = useState(false);
  // Portfolio "P" — auto-derived from the user's REAL holdings (portfolioSet
  // above), NOT a manual tag. The marker lights on its own for held names and
  // the count is the holding total; nothing to click. Powers "Portfolio only".
  const [pOnly, setPOnly] = useState(false);
  // Industry Score (composite percentile) range filter. null = open on that end.
  // A stock survives when its composite_pct sits within [min, max].
  const [minComposite, setMinComposite] = useState<number | null>(null);
  const [maxComposite, setMaxComposite] = useState<number | null>(null);

  // Apply favourites + score range → the tree/grid actually rendered. We drop
  // non-matching stocks (and any industry/sector that empties out). Order is
  // preserved from the source (composite-desc) — no starred-first shuffle.
  const viewSectors = useMemo<GraphSector[]>(() => {
    if (!favOnly && !pOnly && minComposite == null && maxComposite == null) return sectors;
    const keep = (st: GraphStock) => {
      if (favOnly && !starSet.has(st.symbol)) return false;
      if (pOnly && !portfolioSet.has(st.symbol)) return false;
      if (minComposite != null || maxComposite != null) {
        if (st.composite_pct == null) return false;
        if (minComposite != null && st.composite_pct < minComposite) return false;
        if (maxComposite != null && st.composite_pct > maxComposite) return false;
      }
      return true;
    };
    const out: GraphSector[] = [];
    for (const s of sectors) {
      const inds: GraphIndustry[] = [];
      let count = 0;
      for (const ind of s.industries) {
        const stocks = ind.stocks.filter(keep);
        if (!stocks.length) continue;
        inds.push({ ...ind, stocks });
        count += stocks.length;
      }
      if (inds.length) out.push({ ...s, count, industries: inds });
    }
    return out;
  }, [sectors, starSet, favOnly, portfolioSet, pOnly, minComposite, maxComposite]);

  // How many of your favourites / holdings survive the CURRENT score range —
  // powers the "n / total" badge so you can see, without toggling, how many of
  // your names sit in strong (or weak) industries. Only computed when a score
  // filter is active; otherwise the badges show the plain total.
  const scoreActive = minComposite != null || maxComposite != null;
  const { favInRange, portInRange } = useMemo(() => {
    if (!scoreActive) return { favInRange: 0, portInRange: 0 };
    const favSeen = new Set<string>();
    const portSeen = new Set<string>();
    for (const s of sectors) {
      for (const ind of s.industries) {
        for (const st of ind.stocks) {
          if (st.composite_pct == null) continue;
          if (minComposite != null && st.composite_pct < minComposite) continue;
          if (maxComposite != null && st.composite_pct > maxComposite) continue;
          if (starSet.has(st.symbol)) favSeen.add(st.symbol);
          if (portfolioSet.has(st.symbol)) portSeen.add(st.symbol);
        }
      }
    }
    return { favInRange: favSeen.size, portInRange: portSeen.size };
  }, [scoreActive, sectors, starSet, portfolioSet, minComposite, maxComposite]);

  // Flat lookup: industry_id → { industry, sectorName }.
  const industryById = useMemo(() => {
    const m = new Map<string, { ind: GraphIndustry; sector: string }>();
    for (const s of viewSectors) for (const ind of s.industries) m.set(ind.id, { ind, sector: s.name });
    return m;
  }, [viewSectors]);

  const firstIndustry = viewSectors[0]?.industries[0]?.id ?? "";
  const [selectedInd, setSelectedInd] = useState<string>(firstIndustry);
  const [page, setPage] = useState(0);
  // Charts per page: 6 (dense 3×2) or 4 (roomier 2×2 for a clearer read).
  const [perPage, setPerPage] = useState<number>(PER_PAGE);
  const [days, setDays] = useState<number>(180);
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeQuery, setTreeQuery] = useState("");
  const [focus, setFocus] = useState<GraphStock | null>(null);
  // Drawing/measure tool armed on the expanded chart, via the overlay toolbar.
  // Reset whenever the overlay closes.
  const [tool, setTool] = useState<ChartTool>("none");

  // Persisted chart drawings, keyed by symbol. Hlines show on every chart
  // (incl. the small grid); trend lines only on the expanded chart. Stored in
  // localStorage so they survive reloads.
  const DRAW_KEY = "er:chartDrawings:v1";
  const [drawings, setDrawings] = useState<Record<string, Drawing[]>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAW_KEY);
      if (raw) setDrawings(JSON.parse(raw));
    } catch {
      /* ignore corrupt/unavailable storage */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(DRAW_KEY, JSON.stringify(drawings));
    } catch {
      /* ignore quota/unavailable storage */
    }
  }, [drawings]);
  const addDrawing = useCallback((symbol: string, d: Drawing) => {
    setDrawings((prev) => ({ ...prev, [symbol]: [...(prev[symbol] ?? []), d] }));
  }, []);
  const clearDrawings = useCallback((symbol: string) => {
    setDrawings((prev) => {
      if (!prev[symbol]?.length) return prev;
      const next = { ...prev };
      delete next[symbol];
      return next;
    });
  }, []);
  const deleteDrawing = useCallback((symbol: string, index: number) => {
    setDrawings((prev) => {
      const arr = prev[symbol];
      if (!arr) return prev;
      const rest = arr.filter((_, i) => i !== index);
      const next = { ...prev };
      if (rest.length) next[symbol] = rest;
      else delete next[symbol];
      return next;
    });
  }, []);

  // Esc closes the focus (expanded chart) overlay.
  useEffect(() => {
    if (!focus) {
      setTool("none");
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  // Tree open-state: everything starts collapsed — the user expands a sector by
  // clicking its arrow. (We still auto-open the sector of a restored selection.)
  const [openSectors, setOpenSectors] = useState<Set<string>>(() => new Set());
  const [openIndustries, setOpenIndustries] = useState<Set<string>>(() => new Set());

  // Remember the Graph tab's position (industry + sector-wide page + window) so a
  // browser refresh lands you back exactly where you were instead of resetting to
  // the first sector. Restored in an effect (not a useState initializer) to avoid
  // an SSR/client hydration mismatch; the mount write is skipped so an empty store
  // never clobbers a previously saved position.
  const GRAPH_NAV_KEY = "er:graphNav:v1";
  const navHydrated = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(GRAPH_NAV_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { ind?: string; page?: number; days?: number; perPage?: number };
        if (saved.ind && industryById.has(saved.ind)) {
          setSelectedInd(saved.ind);
          // Intentionally do NOT auto-open the sector here — the tree stays
          // collapsed until the user clicks a sector's arrow themselves.
        }
        if (typeof saved.page === "number") setPage(saved.page);
        if (typeof saved.days === "number") setDays(saved.days);
        if (saved.perPage === 4 || saved.perPage === 6) setPerPage(saved.perPage);
      }
    } catch {
      /* ignore corrupt/unavailable storage */
    }
    // Restore once, on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!navHydrated.current) {
      navHydrated.current = true; // skip the mount write
      return;
    }
    try {
      localStorage.setItem(GRAPH_NAV_KEY, JSON.stringify({ ind: selectedInd, page, days, perPage }));
    } catch {
      /* ignore quota/unavailable storage */
    }
  }, [selectedInd, page, days, perPage]);

  // Sector-wide paging. The grid pages across the WHOLE sector, not just the
  // selected industry: each page is a slice of a SINGLE industry (never
  // straddling two), so when one industry runs out, Next rolls into the next
  // industry in the sector. Paging only stops at the sector's first/last page —
  // no hard stop per industry. `selectedInd` anchors WHICH sector we're in; the
  // "current industry" shown is derived from whichever page you're on.
  const activeAnchor = industryById.has(selectedInd) ? selectedInd : firstIndustry;
  const activeSectorName = industryById.get(activeAnchor)?.sector ?? viewSectors[0]?.name ?? "";
  const activeSector = useMemo(
    () => viewSectors.find((s) => s.name === activeSectorName),
    [viewSectors, activeSectorName],
  );

  // Tree search: filter the sector→industry→stock tree by symbol, company name
  // or industry name. A matching industry name keeps all its stocks; otherwise
  // only the matching stocks survive. Empty query → the full tree. Clicking a
  // result still resolves via industryById (built from the unfiltered universe).
  const searching = treeQuery.trim().length > 0;
  const treeSectors = useMemo<GraphSector[]>(() => {
    const q = treeQuery.trim().toLowerCase();
    if (!q) return viewSectors;
    const out: GraphSector[] = [];
    for (const s of viewSectors) {
      const inds: GraphIndustry[] = [];
      for (const ind of s.industries) {
        const indHit = ind.name.toLowerCase().includes(q);
        const stocks = indHit
          ? ind.stocks
          : ind.stocks.filter(
              (st) =>
                st.symbol.toLowerCase().includes(q) ||
                (st.name ?? "").toLowerCase().includes(q),
            );
        if (indHit || stocks.length > 0) inds.push({ ...ind, stocks });
      }
      if (inds.length > 0) {
        out.push({ ...s, industries: inds, count: inds.reduce((n, i) => n + i.stocks.length, 0) });
      }
    }
    return out;
  }, [viewSectors, treeQuery]);

  const sectorPages = useMemo<SecPage[]>(() => {
    const out: SecPage[] = [];
    if (!activeSector) return out;
    for (const ind of activeSector.industries) {
      const total = ind.stocks.length;
      if (total === 0) continue;
      for (let i = 0; i < total; i += perPage) {
        out.push({
          indId: ind.id,
          indName: ind.name,
          stocks: ind.stocks.slice(i, i + perPage),
          chunkStart: i + 1,
          indTotal: total,
        });
      }
    }
    return out;
  }, [activeSector, perPage]);

  const pageCount = Math.max(1, sectorPages.length);
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const curPage = sectorPages[safePage];
  const activeInd = curPage?.indId ?? activeAnchor;
  const pageStocks: GraphStock[] = curPage?.stocks ?? [];
  const pageSymbols = pageStocks.map((s) => s.symbol);

  const candles = useGraphCandles(pageSymbols, days);
  // Beyond ~2Y the loader rolls daily bars up to weekly, so volume is a weekly
  // sum — label it "/wk" everywhere so the number's unit is unambiguous.
  const weekly = days > WEEKLY_THRESHOLD_DAYS;

  // Absolute page index of an industry's first chunk within its own sector — so
  // clicking an industry (or a stock) in the tree lands exactly on it, then
  // rolls forward through the rest of the sector from there.
  function pageOffsetOfIndustry(sectorName: string, indId: string): number {
    const sec = viewSectors.find((s) => s.name === sectorName);
    if (!sec) return 0;
    let idx = 0;
    for (const ind of sec.industries) {
      if (ind.stocks.length === 0) continue;
      if (ind.id === indId) return idx;
      idx += Math.ceil(ind.stocks.length / perPage);
    }
    return 0;
  }

  function selectIndustry(id: string) {
    const sector = industryById.get(id)?.sector ?? "";
    setSelectedInd(id);
    setPage(pageOffsetOfIndustry(sector, id));
    setOpenIndustries((prev) => new Set(prev).add(id));
  }
  // Clicking a SECTOR name loads its first page (first non-empty industry) so you
  // can drive the grid straight from the sector, then page through the whole
  // sector. Expand/collapse stays on the chevron.
  const firstIndustryOfSector = useCallback((name: string): string | null => {
    const sec = viewSectors.find((s) => s.name === name);
    return sec?.industries.find((i) => i.stocks.length > 0)?.id ?? null;
  }, [viewSectors]);
  function selectSector(name: string) {
    const first = firstIndustryOfSector(name);
    if (!first) return;
    setSelectedInd(first);
    setPage(0);
    // Load the graph only — expand/collapse stays under the chevron's control.
  }
  // Total pages a sector spans under the current page size.
  const sectorPageCount = useCallback((name: string): number => {
    const sec = viewSectors.find((s) => s.name === name);
    if (!sec) return 0;
    return sec.industries.reduce((n, i) => n + Math.ceil(i.stocks.length / perPage), 0);
  }, [viewSectors, perPage]);

  // Sectors that actually have charts, in tree order — the rails Prev/Next roll
  // along once a sector's own pages are exhausted.
  const stockSectorNames = useMemo(
    () => viewSectors.filter((s) => s.industries.some((i) => i.stocks.length > 0)).map((s) => s.name),
    [viewSectors],
  );
  const curSectorPos = stockSectorNames.indexOf(activeSectorName);
  const atFirstPage = safePage <= 0 && curSectorPos <= 0;
  const atLastPage = safePage >= pageCount - 1 && curSectorPos >= stockSectorNames.length - 1;

  // Next/Prev auto-cross the sector boundary: at a sector's last page, Next rolls
  // into the next sector's first page (and the pager count switches to THAT
  // sector's total); Prev mirrors it, landing on the previous sector's last page.
  function gotoNextPage() {
    if (safePage < pageCount - 1) { setPage(safePage + 1); return; }
    const nextName = stockSectorNames[curSectorPos + 1];
    if (!nextName) return;
    selectSector(nextName);
  }
  function gotoPrevPage() {
    if (safePage > 0) { setPage(safePage - 1); return; }
    const prevName = stockSectorNames[curSectorPos - 1];
    if (!prevName) return;
    const first = firstIndustryOfSector(prevName);
    if (!first) return;
    setSelectedInd(first);
    setPage(Math.max(0, sectorPageCount(prevName) - 1)); // land on its last page
  }
  // Switching page size keeps you on the same industry's first page (predictable,
  // no jarring jump to an unrelated slice).
  function changePerPage(n: number) {
    const anchor = activeInd;
    const sector = activeSectorName;
    const sec = viewSectors.find((s) => s.name === sector);
    let idx = 0;
    if (sec) {
      for (const ind of sec.industries) {
        if (ind.stocks.length === 0) continue;
        if (ind.id === anchor) break;
        idx += Math.ceil(ind.stocks.length / n);
      }
    }
    setPerPage(n);
    setPage(idx);
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
    const sector = industryById.get(id)?.sector ?? "";
    setSelectedInd(id);
    setPage(pageOffsetOfIndustry(sector, id) + Math.floor(idx / perPage));
  }
  // Search results carry a filtered stock list, so a positional index would be
  // wrong — resolve the stock's true index within the unfiltered industry.
  function jumpToStockSymbol(id: string, symbol: string) {
    const real = industryById.get(id)?.ind.stocks.findIndex((s) => s.symbol === symbol) ?? -1;
    jumpToStock(id, real >= 0 ? real : 0);
  }

  const rangeStart = curPage ? curPage.chunkStart : 0;
  const rangeEnd = curPage ? curPage.chunkStart + pageStocks.length - 1 : 0;
  // Page position WITHIN the current industry (header), distinct from the
  // sector-wide page position shown in the pager on the right.
  const indPageCount = curPage ? Math.ceil(curPage.indTotal / perPage) : 0;
  const indPageIdx = curPage ? Math.floor((curPage.chunkStart - 1) / perPage) + 1 : 0;

  // Global progress across the WHOLE view (all sectors), in STOCKS — so with the
  // Portfolio/Favourites filter on you can see "67 / 88 seen" without opening the
  // tree. Sectors before the current one count fully; the current sector counts
  // the stocks on pages up to and including the one you're on.
  const globalProgress = useMemo(() => {
    let total = 0, seen = 0, reachedActive = false;
    for (const s of viewSectors) {
      const secStocks = s.industries.reduce((n, i) => n + i.stocks.length, 0);
      total += secStocks;
      if (s.name === activeSectorName) {
        // Count stocks on pages 0..safePage within this sector.
        const counts: number[] = [];
        for (const ind of s.industries) {
          const t = ind.stocks.length;
          for (let i = 0; i < t; i += perPage) counts.push(Math.min(perPage, t - i));
        }
        for (let p = 0; p <= safePage && p < counts.length; p++) seen += counts[p];
        reachedActive = true;
      } else if (!reachedActive) {
        seen += secStocks; // a sector fully behind us → all its stocks seen
      }
    }
    return { seen, total };
  }, [viewSectors, activeSectorName, safePage, perPage]);

  // Count shown on each filter button. Priority: if the button's OWN filter is
  // on, show paging progress "seen / total" (e.g. P · 67/88); else if a score
  // filter is active, show how many pass it "in-range / total"; else the plain
  // total. The "/" forms get a slightly smaller font so 4 digits fit.
  const favCount = favOnly
    ? `${globalProgress.seen} / ${globalProgress.total}`
    : scoreActive
      ? `${favInRange} / ${starSet.size}`
      : `${starSet.size}`;
  const portCount = pOnly
    ? `${globalProgress.seen} / ${globalProgress.total}`
    : scoreActive
      ? `${portInRange} / ${portfolioSet.size}`
      : `${portfolioSet.size}`;

  return (
    <div className="flex flex-col">
      <header className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-[200px] flex-1">
            <h1 className="font-display text-[20px] tracking-tight leading-tight truncate">Charts by industry</h1>
            <p className="text-[12px] muted-text truncate">
              {curPage ? (
                <>
                  <span className="ink-text font-medium">{activeSectorName}</span> ·{" "}
                  <span className="ink-text font-medium">{curPage.indName}</span> ·{" "}
                  {curPage.indTotal} names · showing {rangeStart}–{rangeEnd} : {indPageIdx}/{indPageCount}
                </>
              ) : (
                <>Pick an industry from the tree{snapDate ? <> · panel {snapDate}</> : null}</>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 ml-auto">
            <button
              type="button"
              onClick={() => { setFavOnly((v) => !v); setPage(0); }}
              disabled={!favOnly && starSet.size === 0}
              className="inline-flex items-center gap-1.5 rounded-md border hairline px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-40 hover:bg-[var(--color-paper)]"
              style={
                favOnly
                  ? {
                      borderColor: "#e8a838",
                      backgroundColor: "color-mix(in srgb, #e8a838 12%, transparent)",
                      color: "#e8a838",
                    }
                  : undefined
              }
              aria-pressed={favOnly}
              title={
                starSet.size === 0
                  ? "Star some stocks first"
                  : favOnly
                    ? "Showing favourites only — click for all"
                    : "Show favourites only"
              }
            >
              <Star size={13} fill={favOnly ? "#e8a838" : "none"} strokeWidth={2} />
              <span>
                Fav
                {starHydrated && starSet.size > 0 ? (
                  <span className="tabular-nums" style={favOnly || scoreActive ? { fontSize: "0.9em" } : undefined}>
                    {` · ${favCount}`}
                  </span>
                ) : ""}
              </span>
            </button>
            <button
              type="button"
              onClick={() => { setPOnly((v) => !v); setPage(0); }}
              disabled={!pOnly && portfolioSet.size === 0}
              className="inline-flex items-center gap-1.5 rounded-md border hairline px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-40 hover:bg-[var(--color-paper)]"
              style={
                pOnly
                  ? {
                      borderColor: "#7c3aed",
                      backgroundColor: "color-mix(in srgb, #7c3aed 12%, transparent)",
                      color: "#7c3aed",
                    }
                  : undefined
              }
              aria-pressed={pOnly}
              title={
                portfolioSet.size === 0
                  ? "No portfolio holdings yet — add them on the Portfolio tab"
                  : pOnly
                    ? "Showing portfolio holdings only — click for all"
                    : "Show portfolio holdings only"
              }
            >
              <span
                className="inline-flex items-center justify-center rounded-full border font-bold leading-none"
                style={{
                  width: 15,
                  height: 15,
                  fontSize: 9.5,
                  borderColor: pOnly ? "#7c3aed" : "currentColor",
                  color: pOnly ? "#fff" : "inherit",
                  backgroundColor: pOnly ? "#7c3aed" : "transparent",
                }}
                aria-hidden
              >
                P
              </span>
              <span>
                Portfolio
                {portfolioSet.size > 0 ? (
                  <span className="tabular-nums" style={pOnly || scoreActive ? { fontSize: "0.9em" } : undefined}>
                    {` · ${portCount}`}
                  </span>
                ) : ""}
              </span>
            </button>
            <div
              className="inline-flex items-center gap-1 rounded-md border hairline px-2 py-1 text-[12px] font-medium transition-colors"
              style={
                minComposite != null || maxComposite != null
                  ? { borderColor: "var(--color-accent-600)", color: "var(--color-accent-700)", background: "color-mix(in srgb, var(--color-accent-600) 10%, transparent)" }
                  : undefined
              }
              title="Show only stocks whose Industry Score falls within this range"
            >
              <span className="muted-text whitespace-nowrap">Score</span>
              <input
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                placeholder="min"
                value={minComposite ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (v === "") { setMinComposite(null); setPage(0); return; }
                  const n = Math.max(0, Math.min(100, Math.round(Number(v))));
                  setMinComposite(Number.isFinite(n) ? n : null);
                  setPage(0);
                }}
                className="w-11 bg-transparent text-right tabular-nums outline-none placeholder:text-[var(--color-muted)] placeholder:font-normal"
                aria-label="Minimum Industry Score"
              />
              <span className="muted-text">–</span>
              <input
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                placeholder="max"
                value={maxComposite ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (v === "") { setMaxComposite(null); setPage(0); return; }
                  const n = Math.max(0, Math.min(100, Math.round(Number(v))));
                  setMaxComposite(Number.isFinite(n) ? n : null);
                  setPage(0);
                }}
                className="w-11 bg-transparent text-left tabular-nums outline-none placeholder:text-[var(--color-muted)] placeholder:font-normal"
                aria-label="Maximum Industry Score"
              />
              {(minComposite != null || maxComposite != null) && (
                <button
                  type="button"
                  onClick={() => { setMinComposite(null); setMaxComposite(null); setPage(0); }}
                  className="ml-0.5 rounded px-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  aria-label="Clear score filter"
                  title="Clear score filter"
                >
                  ×
                </button>
              )}
            </div>
            {/* Charts per page: 4 (clearer) vs 6 (denser). */}
            <div className="inline-flex items-center rounded-md border hairline overflow-hidden text-[12px] font-medium" role="group" aria-label="Charts per page">
              {[4, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => changePerPage(n)}
                  aria-pressed={perPage === n}
                  title={`Show ${n} charts per page`}
                  className="px-2.5 py-1.5 tabular-nums transition-colors hover:bg-[var(--color-paper)]"
                  style={perPage === n ? { background: "var(--color-accent-600)", color: "#fff" } : undefined}
                >
                  {n}
                </button>
              ))}
            </div>
            <WindowPicker options={GRAPH_WINDOWS} days={days} onSelect={setDays} loading={candles.loading} />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={gotoPrevPage}
                disabled={atFirstPage}
                className="rounded-md border hairline px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40 hover:bg-[var(--color-paper)] transition-colors"
                aria-label="Previous page"
                title={safePage <= 0 ? "Previous sector" : "Previous page"}
              >
                ‹
              </button>
              <span className="text-[12px] tabular-nums muted-text px-1 min-w-[64px] text-center">
                {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                onClick={gotoNextPage}
                disabled={atLastPage}
                className="rounded-md border hairline px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40 hover:bg-[var(--color-paper)] transition-colors"
                aria-label="Next page"
                title={safePage >= pageCount - 1 ? "Next sector" : "Next page"}
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
          {/* Tree search — filter by symbol, company or industry name. */}
          <div className="relative px-1 mb-1.5">
            <svg
              width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
              className="absolute left-2.5 top-1/2 -translate-y-1/2 muted-text pointer-events-none"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={treeQuery}
              onChange={(e) => setTreeQuery(e.target.value)}
              placeholder="Search stock or industry…"
              aria-label="Search charts by stock or industry"
              className="w-full rounded-md border hairline bg-[var(--color-paper)] pl-7 pr-2 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent-600)]"
            />
          </div>
          {searching && treeSectors.length === 0 && (
            <p className="px-2 py-3 text-[12px] muted-text text-center">
              No matches for “{treeQuery.trim()}”.
            </p>
          )}
          {treeSectors.map((s) => {
            const open = searching || openSectors.has(s.name);
            const isActiveSector = s.name === activeSectorName;
            return (
              <div key={s.name} className="mb-0.5">
                <div
                  className="flex items-center gap-1 rounded-md pr-2 transition-colors hover:bg-[var(--color-paper)]"
                  style={isActiveSector ? { background: "color-mix(in srgb, var(--color-accent-600) 10%, transparent)" } : undefined}
                >
                  <button
                    type="button"
                    onClick={() => toggleSector(s.name)}
                    className="shrink-0 rounded p-1 hover:bg-[var(--color-border)] transition-colors"
                    aria-label={open ? "Collapse sector" : "Expand sector"}
                  >
                    <Chevron open={open} />
                  </button>
                  <button
                    type="button"
                    onClick={() => selectSector(s.name)}
                    className="flex-1 flex items-center gap-1.5 py-1.5 text-left min-w-0"
                    title={`Show ${s.name} charts`}
                  >
                    <span
                      className="font-semibold flex-1 truncate"
                      style={isActiveSector ? { color: "var(--color-accent-700)" } : undefined}
                    >
                      {s.name}
                    </span>
                    <span className="text-[10.5px] tabular-nums muted-text">{s.count}</span>
                  </button>
                </div>
                {open && (
                  <div className="ml-2 border-l hairline pl-1.5">
                    {s.industries.map((ind) => {
                      const isSel = ind.id === activeInd;
                      const stocksOpen = searching || openIndustries.has(ind.id);
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
                                  !searching && isSel && curPage != null &&
                                  i >= curPage.chunkStart - 1 &&
                                  i < curPage.chunkStart - 1 + pageStocks.length;
                                return (
                                  <li key={st.symbol} className="flex items-center gap-0.5">
                                    <StarButton symbol={st.symbol} variant="icon" className="!w-6 !h-6 shrink-0" />
                                    <button
                                      type="button"
                                      onClick={() => searching ? jumpToStockSymbol(ind.id, st.symbol) : jumpToStock(ind.id, i)}
                                      className="flex-1 min-w-0 flex items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-[var(--color-paper)] transition-colors"
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

        {/* ── Right: candlestick grid — 3×2 (6) or 2×2 (4) per the toggle ── */}
        <div className={`min-w-0 flex-1 grid grid-rows-2 gap-3 ${perPage === 4 ? "grid-cols-2" : "grid-cols-3"}`}>
          {pageStocks.map((st) => {
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
                <div className="flex items-start gap-2 border-b hairline px-3 py-2">
                  <StarButton symbol={st.symbol} variant="icon" className="-ml-1 shrink-0" />
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
                  <div className="text-right shrink-0 tabular-nums">
                    <div className="flex items-center justify-end gap-2.5">
                      {(st.quality_pct != null || st.value_pct != null) && (
                        <div className="flex items-center gap-1.5 text-[10px] font-medium">
                          <span title="Quality percentile">
                            <span className="muted-text">Q</span>{" "}
                            <span style={{ color: scoreColor(st.quality_pct) }}>
                              {st.quality_pct != null ? Math.round(st.quality_pct) : "—"}
                            </span>
                          </span>
                          <span title="Valuation percentile">
                            <span className="muted-text">V</span>{" "}
                            <span style={{ color: scoreColor(st.value_pct) }}>
                              {st.value_pct != null ? Math.round(st.value_pct) : "—"}
                            </span>
                          </span>
                        </div>
                      )}
                      <span className="text-[12.5px] font-semibold">
                        {last ? inr(last.c) : "—"}
                      </span>
                    </div>
                    <div className="text-[10.5px] font-medium" style={{ color: chgColor }}>
                      {chg == null ? "" : `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`}
                    </div>
                    {hi != null && lo != null && (
                      <div className="text-[9.5px] muted-text mt-0.5" title="Period high / low">
                        <span style={{ color: GREEN }}>H</span> {inr(hi)}
                        {"  "}
                        <span style={{ color: RED }}>L</span> {inr(lo)}
                      </div>
                    )}
                    {lastVol != null && (
                      <div
                        className="text-[9.5px] muted-text mt-0.5"
                        title="Latest session volume · multiple of period average"
                      >
                        {weekly ? "Vol/wk" : "Vol"} {fmtVol(lastVol)}
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
                  <CandleChart candles={series} weekly={weekly} drawings={drawings[st.symbol]} trades={portfolioSet.has(st.symbol) ? latestBuyMark(tradesBySymbol[st.symbol]) : undefined} />
                </div>
                <div className="flex items-center gap-1.5 border-t hairline px-2 py-1">
                  <PBadge held={portfolioSet.has(st.symbol)} traded={tradedSet.has(st.symbol)} />
                  {portfolioSet.has(st.symbol) && (
                    <HoldGainBadge trades={tradesBySymbol[st.symbol]} last={last?.c ?? null} />
                  )}
                  {series && series.length > 1 && (
                    <div className="flex items-center gap-2.5 text-[10px] font-medium ml-2">
                      <GrowthTag label="1D" v={weekly ? null : pctBack(series, 1)} />
                      <GrowthTag label="1W" v={pctBack(series, weekly ? 1 : 5)} />
                    </div>
                  )}
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => series && series.length >= 2 && setFocus(st)}
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
            );
          })}
        </div>
      </div>

      {/* ── Focus overlay: one expanded, interactive chart ── */}
      {focus && (() => {
        const series = candles.data[focus.symbol];
        const first = series?.[0];
        const last = series?.[series.length - 1];
        const chg = first && last && first.c > 0 ? (last.c / first.c - 1) * 100 : null;
        const chgColor = chg == null ? "var(--color-muted)" : chg >= 0 ? GREEN : RED;
        const hi = series && series.length ? Math.max(...series.map((c) => c.h)) : null;
        const lo = series && series.length ? Math.min(...series.map((c) => c.l)) : null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-8"
            onClick={() => setFocus(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`${focus.symbol} expanded chart`}
          >
            <div
              className="relative flex h-[88vh] w-[94vw] max-w-[1280px] flex-col rounded-2xl border hairline shadow-2xl"
              style={{ background: "var(--color-card, #fff)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 border-b hairline px-4 py-3">
                <StarButton symbol={focus.symbol} variant="icon" className="shrink-0" />
                <WatchlistButton symbol={focus.symbol} variant="icon" className="shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/stock/${focus.symbol}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-[15px] hover:underline truncate"
                    >
                      {focus.symbol}
                    </Link>
                    {focus.composite_pct != null && (
                      <span
                        className="text-[11px] tabular-nums font-medium shrink-0"
                        style={{ color: scoreColor(focus.composite_pct) }}
                        title="Industry Score percentile"
                      >
                        {Math.round(focus.composite_pct)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] font-medium">
                    <span className="muted-text truncate">
                      {displayCompanyName(focus.name, focus.symbol)}
                    </span>
                    {series && series.length > 1 && (
                      <span className="flex items-center gap-3 shrink-0">
                        <GrowthTag label="1D" v={weekly ? null : pctBack(series, 1)} />
                        <GrowthTag label="1W" v={pctBack(series, weekly ? 1 : 5)} />
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <PBadge held={portfolioSet.has(focus.symbol)} traded={tradedSet.has(focus.symbol)} />
                    {portfolioSet.has(focus.symbol) && (
                      <HoldGainBadge trades={tradesBySymbol[focus.symbol]} last={last?.c ?? null} />
                    )}
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border hairline p-0.5">
                    {([
                      { id: "measure", label: "Measure", icon: <RulerIcon size={13} />, hint: "Measure price move between two points" },
                      { id: "hline", label: "H-line", icon: <HLineIcon size={13} />, hint: "Add a horizontal price line (shows on all charts)" },
                      { id: "trend", label: "Trend", icon: <TrendIcon size={13} />, hint: "Draw a trend line between two points" },
                      { id: "erase", label: "Erase", icon: <EraseIcon size={13} />, hint: "Click a line to delete it" },
                    ] as const).map((t) => {
                      const active = tool === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTool((cur) => (cur === t.id ? "none" : t.id))}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium hover:bg-[var(--color-paper)] transition-colors"
                          style={
                            active
                              ? { color: "var(--color-accent-700)", background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)" }
                              : undefined
                          }
                          aria-pressed={active}
                          title={t.hint}
                        >
                          {t.icon}
                          {t.label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => clearDrawings(focus.symbol)}
                      disabled={!drawings[focus.symbol]?.length}
                      className="inline-flex items-center rounded-md px-2 py-1 text-[12px] font-medium text-[var(--color-muted)] hover:bg-[var(--color-paper)] hover:text-[var(--color-ink)] disabled:opacity-40 transition-colors"
                      title="Remove all drawings on this stock"
                    >
                      Clear
                    </button>
                  </div>
                  {tool !== "none" && (
                    <span className="text-[11px] muted-text">
                      {tool === "hline"
                        ? "Click to place the line"
                        : tool === "erase"
                          ? "Click a line to delete"
                          : "Click 2 points"}
                    </span>
                  )}
                  <div className="text-right leading-tight">
                    <div className="text-[15px] tabular-nums font-semibold">
                      {last ? inr(last.c) : "—"}
                    </div>
                    <div className="text-[11px] tabular-nums font-medium" style={{ color: chgColor }}>
                      {chg == null ? "" : `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`}
                      {hi != null && lo != null && (
                        <span className="muted-text font-normal">
                          {"  "}
                          <span style={{ color: GREEN }}>H</span> {inr(hi)}{"  "}
                          <span style={{ color: RED }}>L</span> {inr(lo)}
                        </span>
                      )}
                    </div>
                  </div>
                  <WindowPicker options={GRAPH_WINDOWS} days={days} onSelect={setDays} loading={candles.loading} />
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
              <div
                className="flex-1 min-h-0 p-2 transition-opacity"
                style={{ opacity: candles.loading && !series ? 0.4 : 1 }}
              >
                <CandleChart
                  candles={series}
                  interactive
                  weekly={weekly}
                  tool={tool}
                  drawings={drawings[focus.symbol]}
                  trades={tradesBySymbol[focus.symbol]}
                  onAddDrawing={(d) => addDrawing(focus.symbol, d)}
                  onDeleteDrawing={(i) => deleteDrawing(focus.symbol, i)}
                />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
