"use client";

/**
 * Client-side watchlist renderer.  Reads symbols from localStorage,
 * fetches their card data from /api/watchlist, renders rows grouped by
 * maturity tier (same visual language as /sectors).
 *
 * States:
 *   - hydrating (initial SSR + first mount): skeleton
 *   - empty (no symbols saved): empty-state copy + CTA
 *   - loading (have symbols, fetching data): inline spinner
 *   - loaded: tier-grouped rows
 *   - error: friendly retry button
 */

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Home, Bookmark, BookmarkCheck } from "lucide-react";
import {
  useBookmarks,
  newBookmarkId,
  WATCH_BOOKMARKS_KEY,
  type WatchBookmark,
} from "@/lib/scannerBookmarks";
import type { BusinessHealth } from "@/lib/businessHealth";
import { useWatchlist, saveWatchlistNote } from "@/lib/watchlist";
import { band, bandColor, tierLabel } from "@/lib/score";
import { WatchlistButton } from "@/components/WatchlistButton";
import { CallToggle } from "@/components/CallToggle";
import { PriceChart, type Range as ChartRange } from "@/components/PriceChart";
import type { TradeMark } from "@/app/tools/scanner/CandleChart";
import CapTierBadge, { type CapCategory } from "@/components/CapTierBadge";
import { IntradayPriceBadge } from "@/components/IntradayPriceBadge";
import { metricsForSector, METRIC_META, fmtMetric, type GlanceMetrics, type MetricKey } from "@/lib/glance";

type Row = {
  symbol: string;
  company_name: string | null;
  sector_name: string | null;
  industry_name: string | null;
  maturity_tier: string;
  /** SEBI market-cap tier + listing date (from app.universe) → CapTierBadge. */
  market_cap_category?: string | null;
  listing_date?: string | null;
  market_cap_cr: number | null;
  current_price: number | null;
  /** Intraday pinger's last-refresh time for current_price (ISO) → IST pill. */
  price_fetched_at?: string | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  /** Trailing-window returns (fractions) computed live off golden EOD with the
   *  chart's rangePct method — windows mirror the graph tabs so the header pills
   *  and the chart agree. */
  ret_1w: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_1y: number | null;
  ret_3y: number | null;
  ret_5y: number | null;
  ret_10y: number | null;
  ret_all: number | null;
  /** Persistence fields — 4-snapshot trend. Null if <2 snapshots of
   *  history (recent listing, missing data). */
  raw_delta: number | null;
  cluster_avg_delta: number | null;
  cluster_adjusted: number | null;
  snaps_improving: number;
  /** Per-user metadata (signed-in only). */
  added_at: string | null;
  close_on_add: number | null;
  close_on_add_date: string | null;
  note: string | null;
  /** Fresh daily quote from golden. */
  ltp: number | null;
  ret_1d: number | null;
  high_52w: number | null;
  low_52w: number | null;
  from_high_pct: number | null;
  from_low_pct: number | null;
  /** Volume context (daily-fresh from golden). */
  vol: number | null;
  avg_vol_30d: number | null;
  rel_vol: number | null;
  turnover_cr: number | null;
  delivery_pct: number | null;
  /** LTP's trading date + staleness vs the feed's newest bar. */
  ltp_date?: string | null;
  stale?: boolean;
  /** Portfolio ownership — drives the "P" badge (purple=held, grey=exited). */
  held?: boolean;
  traded?: boolean;
  /** Position summary for held names: shares held + avg cost + P&L % (LTP vs
   *  avg cost). */
  held_qty?: number | null;
  avg_cost?: number | null;
  pos_pnl_pct?: number | null;
  /** Earliest recorded Buy date for held/traded names → "Bought <date>" chip. */
  bought_on?: string | null;
  /** Real executed trades → B/S markers on the card's price chart. */
  trades?: TradeMark[];
};

// ── Corporate-actions / quarterly extras (lazy per-symbol) ──────────────────
type Dividend = { ex_date: string; amount: number | null; purpose: string | null };
type Bonus = { ex_date: string; action_type: string; purpose: string | null };
type Quarter = {
  period_end: string;
  sales: number | null;
  net_profit: number | null;
  operating_profit: number | null;
  profit_before_tax: number | null;
  opm_pct: number | null;
  npm_pct: number | null;
  sales_yoy: number | null;
  np_yoy: number | null;
};
type NewsItem = {
  title: string;
  source: string | null;
  url: string | null;
  published_at: string;
};
type Shareholding = { period_end: string; promoter_pct: number | null };
type Extras = {
  dividends: Dividend[];
  bonuses: Bonus[];
  quarterly: Quarter[];
  news: NewsItem[];
  shareholding: Shareholding[];
  /** Sector-aware peer fundamentals + the metric rows this stock's cluster
   *  scorecard weights most. Moved here off the list response — see the lean=1
   *  note on the /api/watchlist fetch. */
  glance: GlanceMetrics | null;
  glance_keys: MetricKey[];
};

// In-memory caches so re-opening a stock (or re-rendering) doesn't refetch.
const extrasCache = new Map<string, Extras>();

// ── Sector → industry tree (left rail grouping) ─────────────────────────────
type IndustryNode = { name: string; stocks: Row[] };
type SectorNode = { name: string; industries: IndustryNode[]; count: number };

function buildSectorTree(rows: Row[]): { tree: SectorNode[]; industryCount: number } {
  const bySector = new Map<string, Map<string, Row[]>>();
  for (const r of rows) {
    const sec = r.sector_name || "—";
    const ind = r.industry_name || "—";
    if (!bySector.has(sec)) bySector.set(sec, new Map());
    const inds = bySector.get(sec)!;
    if (!inds.has(ind)) inds.set(ind, []);
    inds.get(ind)!.push(r);
  }
  let industryCount = 0;
  const tree: SectorNode[] = [];
  for (const [sec, inds] of bySector) {
    const industries: IndustryNode[] = [];
    let count = 0;
    for (const [ind, stocks] of inds) {
      stocks.sort((a, b) => (b.composite_pct ?? 0) - (a.composite_pct ?? 0));
      industries.push({ name: ind, stocks });
      count += stocks.length;
      industryCount += 1;
    }
    industries.sort((a, b) => a.name.localeCompare(b.name));
    tree.push({ name: sec, industries, count });
  }
  tree.sort((a, b) => a.name.localeCompare(b.name));
  return { tree, industryCount };
}

/** Narrow the sector tree to rows matching `query` (sector / industry / symbol
 *  / company name). Empty query returns the tree unchanged. A sector or
 *  industry whose *name* matches keeps all its children; otherwise only
 *  matching stocks survive. */
function filterTree(tree: SectorNode[], query: string): SectorNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return tree;
  const stockHit = (r: Row) =>
    r.symbol.toLowerCase().includes(q) ||
    (r.company_name ?? "").toLowerCase().includes(q);

  const out: SectorNode[] = [];
  for (const sec of tree) {
    const secHit = sec.name.toLowerCase().includes(q);
    const industries: IndustryNode[] = [];
    let count = 0;
    for (const ind of sec.industries) {
      const indHit = ind.name.toLowerCase().includes(q);
      const stocks = secHit || indHit ? ind.stocks : ind.stocks.filter(stockHit);
      if (stocks.length > 0) {
        industries.push({ name: ind.name, stocks });
        count += stocks.length;
      }
    }
    if (industries.length > 0) out.push({ name: sec.name, industries, count });
  }
  return out;
}

// Persist the open stock so a refresh reopens what you were looking at,
// instead of jumping to the top-scored name. Per-browser, best-effort.
const SEL_KEY = "equityroots:watchlist:selected:v1";
function readSelected(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SEL_KEY);
  } catch {
    return null;
  }
}
function writeSelected(sym: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEL_KEY, sym);
  } catch {
    // Quota/private-mode — non-fatal; selection just won't persist.
  }
}

/**
 * When supplied, `source` drives the list from an external symbol set (e.g. the
 * Portfolio tab feeds current holdings) instead of the saved watchlist. In that
 * mode the remove/× affordance is hidden — you don't "unsave" a holding — and
 * the header/empty copy come from the source. Omit it for the normal watchlist.
 */
export type WatchSource = {
  symbols: string[];
  hydrated: boolean;
  /** Rendered in place of the watchlist EmptyState when there are 0 symbols. */
  empty: ReactNode;
  /** Header/missing-section noun, e.g. "in your portfolio". */
  ownerLabel: string;
};

export function WatchlistClient({ source }: { source?: WatchSource } = {}) {
  const wl = useWatchlist();
  const symbols = source ? source.symbols : wl.symbols;
  const hydrated = source ? source.hydrated : wl.hydrated;
  const count = symbols.length;
  const signedIn = source ? true : wl.signedIn;
  const remove = wl.remove;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Master/detail: which stock is open in the right-hand panel. The detail
  // deep-dive is the single unified view — chart + scorecard-driven
  // fundamentals — so there's no separate mode toggle any more.
  const [selected, setSelected] = useState<string | null>(null);
  // "Back to start" — the rail scrolls INSIDE itself (it is a sticky column
  // with its own overflow-y), so window.scrollTo alone leaves the tree exactly
  // where it was. Both have to be reset for the page to actually look like the
  // top of the watchlist.
  const railScrollRef = useRef<HTMLDivElement | null>(null);
  const [showTop, setShowTop] = useState(false);
  // Parked stock — the same dual-mode store the scanner's saved spots use
  // (server when signed in, localStorage when not), so it follows you across
  // devices rather than living in one browser. One slot: a bookmark you have to
  // manage is a bookmark you stop using.
  //
  // Declared HERE, with the other hooks, and not next to the goMark/toggleMark
  // helpers that use it. This component has four early returns below
  // (unhydrated / empty / loading / error); a hook called after them runs on
  // some renders and not others, which is the "change in the order of Hooks"
  // React throws on. Hooks first, derived logic wherever it reads best.
  const { items: marks, add: addMark, remove: removeMark } = useBookmarks<WatchBookmark>(
    WATCH_BOOKMARKS_KEY,
  );
  useEffect(() => {
    // passive: this fires on every frame of a scroll and does nothing but read
    // scrollY, so it must never be allowed to block the scroll itself.
    const onScroll = () => setShowTop(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const backToStart = () => {
    railScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // Left-rail tree: node keys present here are expanded (default: all
  // collapsed — the user opens a sector by clicking its arrow). Sector key =
  // sector name; industry key = `${sector}//${industry}`.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Left-rail search — filters the tree by sector / industry / symbol / company.
  const [query, setQuery] = useState("");
  // Left rail can be collapsed to hand the whole width to the detail panel.
  const [railOpen, setRailOpen] = useState(true);
  // Snapshot date from the API response so we can tell the user when the
  // prices/scores were computed.  Same value /sectors and the top ribbon
  // show — keeps the "as-of" date consistent across surfaces.
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);

  // Fetch whenever the symbol list changes (post-hydration only — avoid
  // a wasted fetch with empty symbols during SSR).
  useEffect(() => {
    if (!hydrated) return;
    if (symbols.length === 0) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    // lean=1 drops glance / verdict / glance_keys from every row. They were 61%
    // of the response (426KB of 697KB on a 234-name list) but only the ONE
    // selected card ever renders glance, and nothing rendered verdict at all.
    // The selected card now gets its glance rows from /api/watchlist/extras,
    // which it was already fetching on open anyway — so this costs no extra
    // round-trip, it just moves the payload off the critical path.
    fetch(`/api/watchlist?symbols=${encodeURIComponent(symbols.join(","))}&lean=1`)
      .then((r) => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then((data: { rows: Row[]; snapshot_date?: string | null }) => {
        setRows(data.rows);
        setSnapshotDate(data.snapshot_date ?? null);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [hydrated, symbols.join(",")]);  // join so changing order doesn't refetch unnecessarily

  // Keep the detail panel pointed at a valid row: preserve the current
  // selection if it still exists, otherwise open the top-scored stock.
  useEffect(() => {
    if (!rows || rows.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((cur) => {
      if (cur && rows.some((r) => r.symbol === cur)) return cur;
      // Restore the last-viewed stock across a refresh before falling back to
      // the top-scored name (which is why every reload jumped to one stock).
      const saved = readSelected();
      if (saved && rows.some((r) => r.symbol === saved)) return saved;
      const top = [...rows].sort(
        (a, b) => (b.composite_pct ?? 0) - (a.composite_pct ?? 0),
      )[0];
      return top?.symbol ?? null;
    });
  }, [rows]);

  // Remember the open stock so the effect above can reopen it on refresh.
  useEffect(() => {
    if (selected) writeSelected(selected);
  }, [selected]);

  // Arrow-key navigation through the list. rotate() is defined further down
  // (it needs flatOrder), so we stash the latest copy in a ref and let a
  // stable listener call it — keeps the effect off the early-return path.
  const rotateRef = useRef<(dir: 1 | -1) => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); rotateRef.current(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); rotateRef.current(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Render states ─────────────────────────────────────────────────────────
  if (!hydrated) {
    return <Skeleton />;
  }

  if (count === 0) {
    return source ? <>{source.empty}</> : <EmptyState />;
  }

  if (loading && rows === null) {
    return <Skeleton />;
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <div className="text-[14px] mb-2">Couldn&apos;t load your watchlist</div>
        <div className="muted-text text-[12px] mb-4">{error}</div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-[12px] underline"
        >
          Try again
        </button>
      </div>
    );
  }

  // If some symbols didn't return rows (e.g., a stock got delisted from the
  // universe), show what we have + flag the missing ones explicitly.
  const found = new Set((rows || []).map((r) => r.symbol));
  const missing = symbols.filter((s) => !found.has(s));

  // Group rows into a sector → industry tree for the left rail, then narrow it
  // to the search query (matches sector, industry, symbol, or company name).
  // industryCount is still returned by buildSectorTree but no longer read here —
  // the summary row that displayed it is gone, and the left rail names the
  // industries outright.
  const { tree: fullTree } = buildSectorTree(rows || []);
  const tree = filterTree(fullTree, query);
  const searching = query.trim().length > 0;

  // Which sector/industry the selected stock belongs to, so the rail can mark
  // where you are. Read off the row itself rather than searching the tree: the
  // tree is filtered by the search box, so a query that hides the selected
  // stock would otherwise clear the highlight while the selection is still
  // live. Same "—" fallback buildSectorTree uses, or the two would not match
  // for a stock with no sector.
  const activeRow = (rows || []).find((r) => r.symbol === selected) ?? null;
  const activeSector = activeRow ? activeRow.sector_name || "—" : null;
  const activeIndustry = activeRow ? activeRow.industry_name || "—" : null;

  const toggleNode = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Clicking a sector reveals its INDUSTRIES and nothing else. It used to also
  // jump the detail panel to the sector's first stock, which meant opening a
  // sector to see what was in it threw away whatever you were looking at. One
  // click, one level: sector → industries, then you pick the industry, then the
  // stock. Nothing here touches the selection.
  const onSectorClick = (sec: SectorNode) => {
    toggleNode(sec.name);
  };

  // Expand-all / collapse-all for the rail tree. Keys are every sector node
  // plus every `${sector}//${industry}` node in the FULL tree, so one click
  // opens (or closes) every stock regardless of the current search filter.
  const allNodeKeys = fullTree.flatMap((s) => [
    s.name,
    ...s.industries.map((i) => `${s.name}//${i.name}`),
  ]);
  const allExpanded = allNodeKeys.length > 0 && allNodeKeys.every((k) => expanded.has(k));
  const toggleAllNodes = () => setExpanded(allExpanded ? new Set() : new Set(allNodeKeys));

  // Flat symbol order following the tree (sector → industry → composite-desc)
  // so the "next" button rotates through the list in the same order it reads.
  const flatOrder = tree.flatMap((s) => s.industries.flatMap((i) => i.stocks.map((r) => r.symbol)));
  const rotate = (dir: 1 | -1) => {
    if (flatOrder.length === 0) return;
    const cur = selected ? flatOrder.indexOf(selected) : -1;
    const next = ((cur === -1 ? 0 : cur + dir) + flatOrder.length) % flatOrder.length;
    setSelected(flatOrder[next]);
  };
  rotateRef.current = rotate;
  // Jump to the FIRST stock in the list — the same order Prev/Next walk, which
  // is tree order (sector → industry → composite desc), not the order you
  // added things. Scrolls both the page and the rail back to the top, because
  // selecting the first stock while the rail is scrolled to the Z's shows you a
  // panel with no visible row highlighted.
  const mark = marks[0] ?? null;
  const markedHere = !!mark && !!selected && mark.sym === selected;
  const toggleMark = () => {
    if (markedHere) {
      removeMark(mark!.id);
      return;
    }
    if (!selected) return;
    // add() caps the list at 1, so saving a new stock replaces the old one —
    // no "you already have a bookmark" dialog to dismiss.
    addMark({ id: newBookmarkId(), label: selected, sym: selected, created: Date.now() });
  };
  const goMark = () => {
    if (!mark) return;
    // The bookmarked stock can have been removed from the watchlist since it
    // was saved. Jumping to a symbol that is no longer in flatOrder would blank
    // the panel, so check first and drop the dead bookmark instead.
    if (!flatOrder.includes(mark.sym)) {
      removeMark(mark.id);
      return;
    }
    setSelected(mark.sym);
    railScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goFirst = () => {
    if (flatOrder.length === 0) return;
    setSelected(flatOrder[0]);
    railScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Removing the stock you're currently viewing used to blank the selection,
  // which let the "restore-or-fall-back" effect above snap the panel to the
  // top-composite name (e.g. KHAITANLTD) instead of leaving you where you were.
  // Pick the reading-order neighbour BEFORE removing so the panel advances to
  // the next stock in the list (falling back to the previous one, or empty when
  // it was the last), mirroring the Prev/Next rotation.
  const removeStock = (sym: string) => {
    if (selected === sym) {
      const idx = flatOrder.indexOf(sym);
      const neighbour = idx === -1 ? null : (flatOrder[idx + 1] ?? flatOrder[idx - 1] ?? null);
      setSelected(neighbour);
    }
    remove(sym);
  };

  return (
    <div className="space-y-3">
      {/* The summary row that used to sit here is gone. The sector/industry
          counts duplicated the left rail, which lists both by name, and the
          stock count now lives in the rotate bar where you are actually
          looking. The snapshot chip moved there with it rather than being
          dropped — it is the only thing on this page that tells you how old
          the scores are. */}
      <div
        className={`grid grid-cols-1 gap-4 items-start ${
          // 240px, not 300px. The rail's width is set here, not by its
          // contents — so inlining the counts as "Consumer (55)" frees space
          // inside the column but gains the chart nothing until the column
          // itself shrinks. The 60px goes straight into the detail panel.
          railOpen ? "lg:grid-cols-[240px_1fr]" : "lg:grid-cols-[36px_1fr]"
        }`}
      >
        {/* LEFT rail — sector → industry tree with search, matching the
            Graph-tab industries browser. Collapsible to free up width. */}
        {!railOpen ? (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="card hidden lg:flex flex-col items-center gap-2 py-3 lg:sticky lg:top-4 transition-colors hover:bg-[var(--color-paper)]"
            title="Show sectors & industries"
            aria-label="Show sectors and industries panel"
          >
            <span className="text-[13px] leading-none">☰</span>
            <span
              className="text-[10px] font-semibold uppercase tracking-wide muted-text"
              style={{ writingMode: "vertical-rl" }}
            >
              Sectors &amp; industries
            </span>
          </button>
        ) : (
        <div className="card overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] flex flex-col">
          <div className="px-3 py-2.5 border-b hairline flex items-center justify-between gap-2 shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wide muted-text">
              Sectors &amp; industries
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] muted-text tabular-nums">
                {tree.length} · {tree.reduce((n, s) => n + s.industries.length, 0)}
              </span>
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                className="hidden lg:inline-flex items-center justify-center w-5 h-5 rounded muted-text hover:text-[var(--color-ink)] hover:bg-[var(--color-paper)] transition-colors"
                title="Collapse panel"
                aria-label="Collapse sectors and industries panel"
              >
                ‹
              </button>
            </div>
          </div>
          <div className="p-2 border-b hairline shrink-0">
            <div className="relative">
              <span
                aria-hidden
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] muted-text pointer-events-none"
              >
                ⌕
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search stock or industry…"
                className="w-full rounded-md border hairline bg-transparent pl-7 pr-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-600)]"
              />
            </div>
          </div>

          {/* Expand-all / collapse-all — one click opens or closes every stock.
              Disabled while searching (matches force the tree open). */}
          <div className="px-2 py-1.5 border-b hairline shrink-0 flex justify-end">
            <button
              type="button"
              onClick={toggleAllNodes}
              disabled={searching || allNodeKeys.length === 0}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] muted-text hover:text-[var(--color-ink)] hover:bg-[var(--color-paper)] transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              title={searching ? "Clear search to collapse" : allExpanded ? "Collapse every sector & stock" : "Expand every sector & stock"}
            >
              <span aria-hidden className="text-[10px]">{allExpanded ? "⊟" : "⊞"}</span>
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          </div>

          <div ref={railScrollRef} className="overflow-y-auto flex-1 min-h-0">
            {tree.length === 0 ? (
              <div className="p-4 text-center muted-text text-[12px]">No matches.</div>
            ) : (
              tree.map((sec) => {
                const secOpen = searching || expanded.has(sec.name);
                const secActive = activeSector === sec.name;
                return (
                  <div key={sec.name}>
                    <button
                      type="button"
                      onClick={() => onSectorClick(sec)}
                      className={`w-full flex items-center gap-2 px-3 py-2 border-b hairline text-left transition-colors ${
                        secActive ? "" : "hover:bg-[var(--color-paper)]"
                      }`}
                      // Inset shadow rather than a real left border: a border
                      // would shift the row's text 3px when it activates, and
                      // the whole rail would twitch as you arrow through stocks.
                      style={
                        secActive
                          ? {
                              background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)",
                              boxShadow: "inset 3px 0 0 var(--color-accent-600)",
                            }
                          : undefined
                      }
                      aria-current={secActive ? "true" : undefined}
                      aria-expanded={secOpen}
                    >
                      <Chevron open={secOpen} />
                      {/* Count sits inline — "Consumer (55)" — rather than
                          right-aligned. A right-aligned number reserves a
                          column of its own plus the gap to it across every
                          row; inline it costs only the digits it needs.
                          shrink-0 keeps it visible when the name truncates. */}
                      <span className="flex items-baseline gap-1 min-w-0 flex-1">
                        <span
                          className="text-[12.5px] font-semibold truncate"
                          style={secActive ? { color: "var(--color-accent-700)" } : undefined}
                        >
                          {sec.name}
                        </span>
                        <span className="text-[11px] muted-text tabular-nums shrink-0">
                          ({sec.count})
                        </span>
                      </span>
                    </button>
                    {secOpen &&
                      sec.industries.map((ind) => {
                        const key = `${sec.name}//${ind.name}`;
                        const indOpen = searching || expanded.has(key);
                        // Only inside the active sector — two sectors can carry
                        // an industry of the same name, and lighting both up
                        // would point at a stock that is not there.
                        const indActive = secActive && activeIndustry === ind.name;
                        return (
                          <div key={ind.name}>
                            <button
                              type="button"
                              onClick={() => toggleNode(key)}
                              className={`w-full flex items-center gap-2 pl-6 pr-3 py-1.5 border-b hairline text-left transition-colors ${
                                indActive ? "" : "hover:bg-[var(--color-paper)]"
                              }`}
                              style={
                                indActive
                                  ? {
                                      background: "color-mix(in srgb, var(--color-accent-600) 7%, transparent)",
                                      boxShadow: "inset 3px 0 0 var(--color-accent-600)",
                                    }
                                  : undefined
                              }
                              aria-current={indActive ? "true" : undefined}
                              aria-expanded={indOpen}
                            >
                              <Chevron open={indOpen} small />
                              <span className="flex items-baseline gap-1 min-w-0 flex-1">
                                <span
                                  className="text-[12px] truncate"
                                  style={indActive ? { color: "var(--color-accent-700)", fontWeight: 600 } : undefined}
                                >
                                  {ind.name}
                                </span>
                                <span className="text-[10.5px] muted-text tabular-nums shrink-0">
                                  ({ind.stocks.length})
                                </span>
                              </span>
                            </button>
                            {indOpen && (
                              <div className="divide-y hairline">
                                {ind.stocks.map((r) => (
                                  <ThinRow
                                    key={r.symbol}
                                    row={r}
                                    active={selected === r.symbol}
                                    onSelect={() => setSelected(r.symbol)}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })
            )}
          </div>
        </div>
        )}

        {/* RIGHT panel — full detail for the selected stock. */}
        <div className="card overflow-hidden min-h-[240px]">
          {(() => {
            const sel = (rows || []).find((r) => r.symbol === selected);
            if (!sel) {
              return (
                <div className="p-8 text-center muted-text text-[13px]">
                  Pick a stock from the list to see its full detail.
                </div>
              );
            }
            const pos = flatOrder.indexOf(sel.symbol);
            // Position of the selected stock WITHIN its own industry (resets to
            // 1/N each time you cross into the next industry). Walk the same
            // sector→industry→stocks tree the list renders from so the counter
            // always matches the visible grouping.
            let indPos = -1;
            let indTotal = 0;
            outer: for (const s of tree) {
              for (const ind of s.industries) {
                const i = ind.stocks.findIndex((r) => r.symbol === sel.symbol);
                if (i >= 0) {
                  indPos = i;
                  indTotal = ind.stocks.length;
                  break outer;
                }
              }
            }
            return (
              <>
                {/* Rotate bar — step through the watchlist without leaving the
                    detail panel. Position readout confirms where you are. */}
                <div className="flex items-center justify-between gap-2 px-4 md:px-5 py-2 border-b hairline bg-[var(--color-paper)]/50">
                  {/* min-w-0 is load-bearing. A flex item defaults to
                      min-width:auto, so it refuses to shrink below its content
                      — a long industry name ("Pharmaceuticals & Biotechnology")
                      pushed this bar wider than the card, the card wider than
                      the page, and the whole site gained a horizontal scrollbar.
                      min-w-0 lets it shrink; truncate does the rest. */}
                  <span className="text-[11px] muted-text tabular-nums flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    <span className="shrink-0">
                      {pos >= 0 ? `${pos + 1} / ${flatOrder.length}` : `${flatOrder.length}`}
                    </span>
                    {indPos >= 0 && (
                      <span
                        className="rounded px-1.5 py-[1px] font-medium tabular-nums truncate min-w-0"
                        style={{
                          background: "color-mix(in srgb, var(--color-muted) 10%, transparent)",
                        }}
                        title={`Stock ${indPos + 1} of ${indTotal} in ${sel.industry_name ?? "this industry"} — ${sel.sector_name ?? "no sector"}`}
                      >
                        {/* Sector leads. "1/5 in Beverages" tells you where you
                            are inside the industry but not which sector that
                            industry belongs to — and the rail groups by sector
                            first, so without it the chip and the rail read in
                            different orders. */}
                        <span className="font-semibold">{sel.sector_name ?? "—"}</span>
                        {" · "}
                        {indPos + 1}/{indTotal} in {sel.industry_name ?? "industry"}
                      </span>
                    )}
                    <span className="hidden sm:inline opacity-70">· use ← → keys</span>
                    {snapshotDate && (
                      <span
                        className="hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border"
                        style={{
                          borderColor: "var(--color-border-default)",
                          backgroundColor: "var(--color-paper)",
                        }}
                        title="Scoring snapshot date (Q/V/M percentiles). Refreshed weekly; LTP price refreshes daily — see the top ribbon."
                      >
                        <span className="opacity-70">Scores</span>
                        <span className="font-medium" style={{ color: "var(--color-ink)" }}>
                          {formatSnapshotDate(snapshotDate)}
                        </span>
                      </span>
                    )}
                    {loading && <span className="opacity-70">· refreshing…</span>}
                  </span>
                  <div className="flex items-center gap-2.5 shrink-0">
                    {/* Count sits immediately left of Prev/Next — the number is
                        the thing you scan for, so it carries the accent colour
                        and the weight; the words stay muted. */}
                    <span className="text-[11.5px] tabular-nums whitespace-nowrap">
                      <span
                        className="font-semibold text-[13px]"
                        style={{ color: "var(--color-accent-600)" }}
                      >
                        {count}
                      </span>{" "}
                      <span className="muted-text">
                        {count === 1 ? "stock" : "stocks"}{" "}
                        <span className="hidden sm:inline">
                          {source ? source.ownerLabel : "on your watchlist"}
                        </span>
                      </span>
                    </span>
                    <div className="inline-flex rounded-md border hairline overflow-hidden">
                    {/* Home — first stock in list order. Sits with Prev/Next
                        because it is the same kind of move: it changes which
                        stock is open. The floating ↑ Top button only scrolls;
                        these two do different things and are deliberately not
                        merged. Disabled when you are already on the first. */}
                    <button
                      type="button"
                      onClick={goFirst}
                      disabled={flatOrder.length === 0 || selected === flatOrder[0]}
                      className="px-2.5 py-1 text-[12px] hover:bg-[var(--color-paper)] transition-colors disabled:opacity-40"
                      aria-label="First stock in the watchlist"
                      title={
                        flatOrder.length
                          ? `Go to the first stock (${flatOrder[0]})`
                          : "No stocks in the list"
                      }
                    >
                      {/* An SVG, not "⌂" (U+2302). That glyph is missing from
                          most UI font stacks and renders as nothing or as a
                          tofu box — the button was there and invisible. Same
                          class of mistake as colouring text with a token
                          without checking what it resolves to: never signal
                          with something you have not confirmed renders. */}
                      <Home size={13} className="inline-block align-[-2px]" />
                    </button>
                    {/* Bookmark — park the stock you are on, jump back to it
                        later. Filled icon + accent colour when the stock in
                        front of you IS the parked one, so the button's state is
                        readable without hovering for a tooltip. */}
                    <button
                      type="button"
                      onClick={toggleMark}
                      disabled={!selected}
                      className="px-2.5 py-1 text-[12px] border-l hairline hover:bg-[var(--color-paper)] transition-colors disabled:opacity-40"
                      style={markedHere ? { color: "var(--color-accent-600)" } : undefined}
                      aria-pressed={markedHere}
                      aria-label={markedHere ? "Remove bookmark" : "Bookmark this stock"}
                      title={
                        markedHere
                          ? `${selected} is bookmarked — click to clear`
                          : mark
                            ? `Bookmark ${selected ?? "this stock"} (replaces ${mark.label})`
                            : `Bookmark ${selected ?? "this stock"}`
                      }
                    >
                      {markedHere ? (
                        <BookmarkCheck size={13} className="inline-block align-[-2px]" />
                      ) : (
                        <Bookmark size={13} className="inline-block align-[-2px]" />
                      )}
                    </button>
                    {/* The jump target. Only rendered when a bookmark exists
                        AND you are not already looking at it — a button that
                        takes you where you already are is noise. */}
                    {mark && !markedHere && (
                      <button
                        type="button"
                        onClick={goMark}
                        className="px-2.5 py-1 text-[12px] border-l hairline hover:bg-[var(--color-paper)] transition-colors tabular-nums"
                        style={{ color: "var(--color-accent-600)" }}
                        title={`Go to your bookmarked stock (${mark.label})`}
                        aria-label={`Go to bookmarked stock ${mark.label}`}
                      >
                        {mark.label}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => rotate(-1)}
                      disabled={flatOrder.length < 2}
                      className="px-2.5 py-1 text-[12px] border-l hairline hover:bg-[var(--color-paper)] transition-colors disabled:opacity-40"
                      aria-label="Previous stock"
                      title="Previous stock"
                    >
                      ‹ Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => rotate(1)}
                      disabled={flatOrder.length < 2}
                      className="px-2.5 py-1 text-[12px] border-l hairline hover:bg-[var(--color-paper)] transition-colors disabled:opacity-40"
                      aria-label="Next stock"
                      title="Next stock"
                    >
                      Next ›
                    </button>
                    </div>
                  </div>
                </div>
                <WatchRow
                  row={sel}
                  signedIn={signedIn}
                  onRemove={() => removeStock(sel.symbol)}
                  showRemove={!source}
                />
              </>
            );
          })()}
        </div>
      </div>

      {missing.length > 0 && (
        <section className="card p-4">
          <div className="text-[12px] muted-text mb-2">
            {missing.length} symbol{missing.length === 1 ? "" : "s"} {source ? source.ownerLabel : "in your watchlist"} no longer appear in our universe (delisted, renamed, or scoring paused):
          </div>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((sym) => (
              <span
                key={sym}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] tabular-nums"
                style={{ borderColor: "var(--color-border-default)", backgroundColor: "var(--color-paper)" }}
              >
                {sym}
                {!source && (
                  <button
                    type="button"
                    onClick={() => remove(sym)}
                    className="muted-text hover:text-[var(--color-ink)] ml-0.5"
                    aria-label={`Remove ${sym}`}
                    title="Remove from watchlist"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Back to the start of the watchlist. Fixed, not sticky — a sticky
          element inside the grid would be trapped by the column that contains
          it. Only appears past 400px so it is not covering content on a page
          you have not scrolled. */}
      {showTop && (
        <button
          type="button"
          onClick={backToStart}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-1.5 px-3 py-2 rounded-full border hairline shadow-md text-[12px] font-medium transition-colors hover:bg-[var(--color-paper)]"
          style={{ background: "var(--color-bg, #fff)" }}
          title="Back to the start of the watchlist"
          aria-label="Back to the start of the watchlist"
        >
          <span aria-hidden className="text-[13px] leading-none">↑</span>
          Top
        </button>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** YYYY-MM-DD → "Mon, 24 May 2026" for human-readable "as of" badges. */
function formatSnapshotDate(iso: string): string {
  // Anchor at noon UTC so a date string parses to the same day regardless of
  // the viewer's timezone — avoids "Sat 24 May" turning into "Fri 23" in -ve
  // offsets.
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────

/** Disclosure chevron that rotates from ▶ (closed) to ▼ (open). */
function Chevron({ open, small = false }: { open: boolean; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block muted-text transition-transform shrink-0 ${small ? "text-[8px]" : "text-[9px]"}`}
      style={{ transform: open ? "rotate(90deg)" : "none" }}
    >
      ▶
    </span>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="card p-4">
          <div className="h-4 bg-[var(--color-paper)] rounded animate-pulse mb-3 w-1/3" />
          <div className="space-y-2">
            <div className="h-3 bg-[var(--color-paper)] rounded animate-pulse w-full" />
            <div className="h-3 bg-[var(--color-paper)] rounded animate-pulse w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card p-10 text-center">
      <div className="text-[20px] font-display mb-2">No stocks on your watchlist yet</div>
      <p className="muted-text text-[13.5px] max-w-md mx-auto mb-5">
        Open any stock page and click <span className="font-medium">Watch</span> to add it here. Your list is saved to your account when you&apos;re signed in, otherwise on this device.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2 text-[12.5px]">
        <Link
          href="/sectors"
          className="px-3 py-1.5 rounded-md border font-medium transition-colors hover:bg-[var(--color-paper)]"
          style={{ borderColor: "var(--color-border-default)" }}
        >
          Browse Sectors
        </Link>
        <Link
          href="/tools/screener"
          className="px-3 py-1.5 rounded-md border font-medium transition-colors hover:bg-[var(--color-paper)]"
          style={{ borderColor: "var(--color-border-default)" }}
        >
          Open Screener
        </Link>
      </div>
    </div>
  );
}

const TIER_COLORS: Record<string, { stripe: string; bg: string; label: string }> = {
  veteran: { stripe: "#2e9a47", bg: "rgba(46,154,71,0.10)",  label: "#206b32" },
  mature:  { stripe: "#3a9290", bg: "rgba(58,146,144,0.10)", label: "#236663" },
  mid:     { stripe: "#c08e2c", bg: "rgba(192,142,44,0.12)", label: "#8a6116" },
  new:     { stripe: "#7882b8", bg: "rgba(120,130,184,0.12)", label: "#3f4978" },
};

/** Maturity-tier pill shown in the detail panel (moved off the left rail). */
function TierBadge({ tier }: { tier: string }) {
  const c = TIER_COLORS[tier] ?? { stripe: "var(--color-muted)", bg: "var(--color-paper)", label: "var(--color-muted)" };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] uppercase tracking-wide font-semibold shrink-0"
      style={{ backgroundColor: c.bg, color: c.label }}
      title="Company maturity tier"
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: c.stripe }} />
      {tierLabel(tier)}
    </span>
  );
}

// Tri-state portfolio badge — same convention as the scanner graph tools:
// purple "P" = currently held, grey "P" = ever bought but fully exited.
const P_HELD = "#7c3aed";
const P_EXITED = "#9ca3af";
function PBadge({ held, traded, size = 16 }: { held?: boolean; traded?: boolean; size?: number }) {
  if (!held && !traded) return null;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold leading-none shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.58, color: "#fff", backgroundColor: held ? P_HELD : P_EXITED }}
      title={held ? "In your portfolio" : "Previously held — fully exited"}
    >
      P
    </span>
  );
}

/** Held-position summary chip — "P 6 SH @₹1,586 -25.3%". Sits under the
 *  composite/Buy-Sell controls so the position (qty, avg cost, unrealized P&L)
 *  reads as a single glanceable line without opening the detail chart. */
function HoldChip({ qty, avgCost, pnlPct }: { qty: number; avgCost?: number | null; pnlPct?: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] tabular-nums font-medium">
      <PBadge held size={14} />
      <span>{qty.toLocaleString("en-IN")} SH</span>
      {avgCost != null && <span className="muted-text">@{fmtPrice(avgCost)}</span>}
      {pnlPct != null && (
        <span style={{ color: deltaColor(pnlPct) }}>
          {pnlPct >= 0 ? "+" : ""}
          {pnlPct.toFixed(1)}%
        </span>
      )}
    </span>
  );
}

/** Amber "stale" chip — shown only when a symbol's latest golden bar trails the
 *  feed's newest. The as-of date lives in the tooltip so healthy rows stay
 *  clutter-free (no per-row date text). */
function StaleChip({ date }: { date: string }) {
  return (
    <span
      className="inline-flex items-center rounded px-1 py-px text-[8.5px] font-semibold uppercase tracking-wide leading-none shrink-0"
      style={{ color: "#92400e", backgroundColor: "#fef3c7" }}
      title={`Stale — latest bar is ${formatShortDate(date)}, behind the rest of the feed`}
    >
      Stale
    </span>
  );
}

/** "EOD · <date>" tag on the returns row — makes explicit that every price and
 *  return on the card is the last END-OF-DAY close (yesterday's, until the next
 *  pipeline refresh lands today's), NOT a live intraday quote. Muted so it reads
 *  as a footnote, not a metric. */
/** Compact left-rail row: symbol · LTP · since-add %. One click opens the
 *  full detail on the right. Kept deliberately dense so 100+ names stay
 *  scannable. */
function ThinRow({
  row,
  active,
  onSelect,
}: {
  row: Row;
  active: boolean;
  onSelect: () => void;
}) {
  const ltp = row.ltp ?? row.current_price;
  const sinceAdd =
    ltp != null && row.close_on_add != null && row.close_on_add !== 0
      ? Math.round((ltp / row.close_on_add - 1) * 1000) / 10
      : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className="w-full text-left pl-9 pr-3 py-2 flex items-center gap-2 transition-colors hover:bg-[var(--color-paper)]"
      style={
        active
          ? {
              backgroundColor: "var(--color-paper)",
              boxShadow: "inset 2px 0 0 var(--color-accent-600)",
            }
          : undefined
      }
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-[13px] tabular-nums truncate">{row.symbol}</span>
          {/* Shares held. The detail panel already carries this via HoldChip,
              but the left rail is what gets scanned across 100+ names, so the
              position size belongs here too. Hidden for names you don't hold,
              which keeps the plain watchlist unchanged. */}
          {row.held && row.held_qty != null && (
            <span
              className="inline-flex items-center rounded px-1 py-px text-[9px] font-semibold tabular-nums leading-none shrink-0"
              style={{
                background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)",
                color: "var(--color-accent-700)",
              }}
              title={`You hold ${row.held_qty.toLocaleString("en-IN")} share${row.held_qty === 1 ? "" : "s"}`}
            >
              {row.held_qty.toLocaleString("en-IN")} SH
            </span>
          )}
        </div>
        <div className="text-[10px] muted-text truncate leading-tight">{row.company_name}</div>
        {row.added_at && (
          <div className="text-[9.5px] muted-text/80 leading-tight tabular-nums">
            Added {formatShortDate(row.added_at.slice(0, 10))}
          </div>
        )}
      </div>
      <div className="text-right shrink-0 tabular-nums">
        <div className="text-[12px] font-medium leading-tight">{fmtPrice(ltp)}</div>
        <div className="text-[10.5px] leading-tight" style={{ color: deltaColor(sinceAdd) }}>
          {fmtSignedPct(sinceAdd)}
        </div>
      </div>
    </button>
  );
}

function WatchRow({
  row,
  signedIn,
  onRemove,
  showRemove = true,
}: {
  row: Row;
  signedIn: boolean;
  onRemove: () => void;
  showRemove?: boolean;
}) {
  const compositeBand = band(row.composite_pct);
  const compositeColor = bandColor(compositeBand);
  const ltp = row.ltp ?? row.current_price;
  // ⓘ company profile. Closed by default and fetched only on the first open —
  // business_summary is ~1.5KB of prose per symbol, so shipping it with the
  // list would be ~350KB for 234 names that mostly never get read.
  const [profileOpen, setProfileOpen] = useState(false);
  // Performance since you added the stock: LTP vs the close captured on add-day.
  // 0% on the day you add (LTP == close_on_add), then moves with the stock.
  const sinceAdd =
    ltp != null && row.close_on_add != null && row.close_on_add !== 0
      ? Math.round((ltp / row.close_on_add - 1) * 1000) / 10
      : null;
  // "Added" cell: the add-day close and its date rolled into one — "₹266 @ 18 Aug '26".
  // Falls back to just the add date (or "—") when no captured close exists yet.
  const addedDateIso = row.close_on_add_date ?? (row.added_at ? row.added_at.slice(0, 10) : null);
  const addedValue =
    row.close_on_add != null
      ? `${fmtPrice(row.close_on_add)}${addedDateIso ? ` @ ${formatShortDate(addedDateIso)}` : ""}`
      : addedDateIso
        ? formatShortDate(addedDateIso)
        : "—";
  return (
    <div className="px-4 md:px-5 py-3 hover:bg-[var(--color-paper)]/60 transition-colors">
      <div className="flex items-start gap-3">
        {/* Identity + sector/tier chips below. The live price moved onto the
            chart header (color-coded by the 1D move), so it's no longer here. */}
        {/* Was four stacked lines — name, sector·industry, live price, tier
            chips — costing ~60px before the chart started. They are one
            wrapping row now. Nothing was dropped: every item is still here,
            reading left to right in the order you'd ask for it. On a narrow
            column it wraps back to two lines on its own, which is the width
            where the stacking was actually earning its height. */}
        <div className="min-w-0 max-w-[46%]">
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
            <Link
              href={`/stock/${row.symbol}`}
              className="flex items-baseline gap-2 min-w-0 hover:opacity-80"
            >
              <span className="font-medium text-[14px] tabular-nums shrink-0">{row.symbol}</span>
              <span className="muted-text text-[12px] truncate">{row.company_name}</span>
            </Link>
            {/* Outside the <Link>: nesting a button inside an anchor is invalid
                HTML and the click would navigate to /stock/… instead. */}
            <button
              type="button"
              onClick={() => setProfileOpen((v) => !v)}
              aria-expanded={profileOpen}
              className="inline-flex items-center justify-center shrink-0 w-4 h-4 rounded-full border hairline text-[9px] font-serif italic leading-none muted-text hover:text-[var(--color-ink)] hover:bg-[var(--color-paper)] transition-colors"
              style={profileOpen ? { borderColor: "var(--color-accent-600)", color: "var(--color-accent-600)" } : undefined}
              title={`What does ${row.symbol} do?`}
              aria-label={`Company information for ${row.symbol}`}
            >
              i
            </button>
            {row.stale && row.ltp_date ? <StaleChip date={row.ltp_date} /> : null}
            {row.current_price != null && (
              <IntradayPriceBadge
                price={row.current_price}
                fetchedAt={row.price_fetched_at ?? null}
                className="text-[11px] muted-text font-medium"
              />
            )}
            {row.maturity_tier && <TierBadge tier={row.maturity_tier} />}
            <CapTierBadge
              category={row.market_cap_category as CapCategory}
              listingDate={row.listing_date}
              textClass="text-[9px]"
            />
          </div>
          <div className="text-[10.5px] muted-text mt-0.5 truncate">
            {row.sector_name ?? "—"} · {row.industry_name ?? "—"}
          </div>
        </div>

        {/* Entry context (Added / Since add) on the left, Q/V/M pushed to the
            far right; the 52-week extremes hug the right edge beneath. A
            vertical hairline partitions this block from the name. The 1D move +
            EOD date moved down to sit on top of the price chart (DetailExtras). */}
        <div className="flex-1 min-w-0 pt-0.5 pl-3 border-l hairline flex flex-col gap-y-1.5">
          <div className="flex items-baseline justify-between gap-x-3 gap-y-1 text-[10.5px] tabular-nums">
            <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap min-w-0">
              <InlineStat
                label="Added"
                value={addedValue}
                title={
                  row.close_on_add_date
                    ? `Closed ₹${row.close_on_add?.toLocaleString("en-IN", { maximumFractionDigits: 2 })} on ${formatSnapshotDate(row.close_on_add_date)} — your reference point`
                    : row.added_at
                      ? `Added ${formatSnapshotDate(row.added_at.slice(0, 10))}`
                      : undefined
                }
              />
              <InlineStat
                label="Since add"
                value={fmtSignedPct(sinceAdd)}
                color={deltaColor(sinceAdd)}
                title={
                  row.close_on_add != null
                    ? `LTP vs your add-day close ₹${row.close_on_add.toLocaleString("en-IN", { maximumFractionDigits: 2 })} — your P&L since watching`
                    : "Set when you add the stock"
                }
              />
              {/* 52W extremes moved up from their own row into this wrap group.
                  They were going to become dashed lines on the chart, until the
                  chart turned out to clip any level outside the visible price
                  range — on 1W/1M/3M the 52-week high is off-canvas, so five of
                  the eight range tabs would have shown nothing at all. Same
                  height saved, no number lost. */}
              <InlineStat
                label="52W High"
                title="52-week high (split-adjusted) and how far LTP sits below it"
                value={
                  row.high_52w != null
                    ? `${fmtPrice(row.high_52w)}${row.from_high_pct != null ? ` (${fmtSignedPct(row.from_high_pct)})` : ""}`
                    : "—"
                }
                color={deltaColor(row.from_high_pct)}
              />
              <InlineStat
                label="52W Low"
                title="52-week low (split-adjusted) and how far LTP sits above it"
                value={
                  row.low_52w != null
                    ? `${fmtPrice(row.low_52w)}${row.from_low_pct != null ? ` (${fmtSignedPct(row.from_low_pct)})` : ""}`
                    : "—"
                }
                color={deltaColor(row.from_low_pct)}
              />
            </div>
            <div className="flex items-baseline gap-x-3 shrink-0">
              <ReturnPill label="Q" value={row.quality_pct}   pct />
              <ReturnPill label="V" value={row.valuation_pct} pct />
              <ReturnPill label="M" value={row.momentum_pct}  pct />
            </div>
          </div>
        </div>

        {/* Composite + B/S on top; the held "P" summary sits directly below. */}
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            {row.composite_pct != null && (
              <span
                className="inline-block min-w-[40px] text-center px-2 py-0.5 rounded-md tabular-nums font-medium text-[12px]"
                style={{
                  backgroundColor: compositeColor,
                  color: compositeBand === "neutral" ? "var(--color-ink)" : "white",
                }}
                title="Composite peer-cluster score"
              >
                {Math.round(row.composite_pct)}
              </span>
            )}
            {/* Buy/Sell call toggle — shares state with the scanner + Calls tab. */}
            <CallToggle symbol={row.symbol} size="sm" />
            {/* Quick remove — hidden when the list is sourced (e.g. Portfolio
                tab), where "remove" has no meaning. */}
            {showRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="muted-text hover:text-[var(--color-delta-down)] transition-colors text-[16px] leading-none px-1"
                aria-label={`Remove ${row.symbol} from watchlist`}
                title="Remove from watchlist"
              >
                ×
              </button>
            )}
          </div>
          {row.held && row.held_qty != null && (
            <HoldChip qty={row.held_qty} avgCost={row.avg_cost} pnlPct={row.pos_pnl_pct} />
          )}
        </div>
      </div>

      {/* Company profile — full width under the header, above the chart, so it
          pushes content down rather than covering it. A floating popover would
          sit on top of the chart, which is the thing you are reading it
          alongside. */}
      {profileOpen && <CompanyProfile symbol={row.symbol} onClose={() => setProfileOpen(false)} />}

      {/* Price chart + latest results side by side, then quarterly-trend
          graph beside dividends, then two-column news. The session-liquidity
          stats (Rel Vol / Turnover / Delivery) ride next to the chart's price-
          alert "Add" button via extraStats. */}
      <DetailExtras
        symbol={row.symbol}
        sector={row.sector_name}
        signedIn={signedIn}
        trades={row.trades}
        rangeReturns={rowRangeReturns(row)}
        ret1d={row.ret_1d}
        ltpDate={row.ltp_date}
        extraStats={
          <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap text-[10.5px] tabular-nums">
            <InlineStat
              label="Rel Vol"
              title={
                row.avg_vol_30d != null
                  ? `Latest volume vs its ~30-day average (${fmtVol(row.vol)} vs ${fmtVol(Math.round(row.avg_vol_30d))}). >1 = busier than usual.`
                  : "Latest volume relative to its ~30-day average"
              }
              value={row.rel_vol != null ? `${row.rel_vol.toFixed(2)}×` : "—"}
              color={
                row.rel_vol == null
                  ? undefined
                  : row.rel_vol >= 2
                    ? "var(--color-delta-up)"
                    : row.rel_vol < 0.5
                      ? "var(--color-delta-down)"
                      : undefined
              }
            />
            <InlineStat
              label="Turnover"
              title="Value traded on the latest session (volume × close), in ₹ crore"
              value={row.turnover_cr != null ? `₹${row.turnover_cr.toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr` : "—"}
            />
            <InlineStat
              label="Delivery"
              title="Share of latest-session volume that settled as delivery (not intraday churn). Higher = more conviction. Not always available."
              value={row.delivery_pct != null ? `${row.delivery_pct.toFixed(0)}%` : "—"}
            />
          </div>
        }
      />

      {/* Editable note — signed-in only (it lives on the server row). */}
      {signedIn ? (
        <NoteEditor symbol={row.symbol} initial={row.note} />
      ) : (
        row.note == null && (
          <div className="mt-2 text-[10.5px] muted-text italic">
            Sign in to record a reference note and your add-day price for this stock.
          </div>
        )
      )}

      {/* Persistence row — multi-snapshot trend.  Frames as "context for
          review", not a buy/sell signal: muted color, no green/red,
          explicit "vs cluster" framing so users don't read the raw
          delta as the headline number. */}
      {row.raw_delta != null && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] tabular-nums muted-text">
          <span title="4-snapshot composite_pct change minus the cluster's average change. Positive = beating peers.">
            vs cluster{" "}
            <span
              className="font-semibold"
              style={{
                color: (row.cluster_adjusted ?? 0) >= 0
                  ? "var(--color-accent-600)"
                  : "var(--color-muted)",
              }}
            >
              {row.cluster_adjusted == null
                ? "—"
                : `${row.cluster_adjusted >= 0 ? "+" : ""}${row.cluster_adjusted.toFixed(1)}`}
            </span>
          </span>
          <span title="Raw 4-snapshot composite percentile change">
            raw{" "}
            <span className="font-medium" style={{ color: "var(--color-ink)" }}>
              {row.raw_delta >= 0 ? "+" : ""}{row.raw_delta.toFixed(1)}
            </span>
          </span>
          <span title="Snapshot-to-snapshot transitions where composite_pct increased">
            improving{" "}
            <span className="font-medium" style={{ color: "var(--color-ink)" }}>
              {row.snaps_improving}/{Math.max(0, Math.min(3, row.snaps_improving + (row.cluster_adjusted == null ? 0 : 3 - row.snaps_improving)))}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}


// ── Corporate actions + quarterly results ───────────────────────────────────

/** Lazily loads dividends / bonuses / quarterly results / news for a stock,
 *  deduped via the module-level cache. */
// ---------------------------------------------------------------------------
// Company profile (the ⓘ button)
// ---------------------------------------------------------------------------

type Profile = {
  symbol: string;
  company_name: string;
  sector: string | null;
  industry: string | null;
  market_cap_category: string | null;
  listing_date: string | null;
  business_summary: string | null;
  website: string | null;
  employees: number | null;
  ceo_name: string | null;
  ceo_title: string | null;
  fetched_at: string | null;
  health: BusinessHealth | null;
};

// Module-level, same pattern as extrasCache: re-opening the ⓘ on a symbol you
// already looked at must not re-hit the API.
const profileCache = new Map<string, Profile>();

// Academic qualifications yfinance appends to officer names — "Mr. Pathik
// Paresh Shah B.E.", "Ms. Vishakha Vivek Mulye B.Com, CA". Nobody reads a CEO
// line to learn they have a B.Com, and the suffix is what made the facts row
// run together as "…Shah B.E.Employees: 4,162". Matched as an explicit SET,
// not a pattern: a heuristic like "trailing short token" would eat real
// surnames (Shah, Rao, Jain).
const DEGREE_TOKENS = new Set([
  "BE", "BSC", "BCOM", "BTECH", "BA", "BBA", "BPHARM", "BARCH", "BED",
  "MSC", "MCOM", "MTECH", "MBA", "MA", "MS", "MPHIL",
  "PHD", "LLB", "LLM", "CA", "CS", "CFA", "CPA", "ACA", "FCA", "ACS", "FCS",
  "ICWA", "CWA", "PGDM", "PGDBM", "IAS", "IPS", "IRS", "CAIIB", "DISA",
]);

/** "Mr. Pathik Paresh Shah B.E." → "Pathik Paresh Shah". Drops the honorific
 *  and any trailing qualifications, and collapses the double spaces yfinance
 *  leaves between initials ("Mr. B.  Sairam"). */
function cleanPerson(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/^(Mr|Mrs|Ms|Dr|Prof|Shri|Smt)\.?\s+/i, "");
  const parts = s.split(/[\s,]+/).filter(Boolean);
  while (parts.length > 1) {
    const tok = parts[parts.length - 1];
    // Two rules, both anchored at the END of the name only:
    //  1. a known qualification ("CA", "MBA", "B.Com")
    //  2. a dotted abbreviation with letters AFTER a dot ("B.Tech.", "M.M.S.",
    //     "B.E.(Mach.)"). The "letters after a dot" test is what protects
    //     initials: "B." and "S." have none, so "Mr. B. Sairam" survives, and
    //     a real name never contains an internal period.
    const isDegree =
      DEGREE_TOKENS.has(tok.replace(/\./g, "").toUpperCase()) || /\.[A-Za-z]/.test(tok);
    if (!isDegree) break;
    parts.pop();
  }
  return parts.join(" ");
}

/** Split a business summary into its first sentence and the rest.
 *  The lookbehind is doing real work: "D. B. Corp Limited engages in…" would
 *  otherwise split after "D", because a naive /\.\s+/ cannot tell an initial
 *  from a full stop. Skipping periods that follow a single capital letter
 *  handles the initials that start a third of Indian company names. */
function splitLede(summary: string): { lede: string; rest: string } {
  const s = summary.replace(/\s+/g, " ").trim();
  const m = s.match(/(?<![A-Z])\.\s+(?=[A-Z])/);
  if (!m || m.index == null) return { lede: s, rest: "" };
  return { lede: s.slice(0, m.index + 1), rest: s.slice(m.index + m[0].length) };
}

/** Founded year and head-office city, pulled out of the prose so they can sit
 *  in the facts row instead of being buried in the last line of a paragraph.
 *  [Certain] coverage: 2,142 of 2,155 summaries state a founding/incorporation
 *  year and 2,154 state "based in" or "headquartered in" — this is a stable
 *  yfinance sentence template, not a hopeful guess. Both return null when the
 *  template is absent; nothing is inferred. */
function extractFounded(summary: string): string | null {
  const m = summary.match(/\b(?:founded|incorporated|established)\s+in\s+(\d{4})\b/i);
  return m ? m[1] : null;
}
function extractHq(summary: string): string | null {
  const m = summary.match(/\b(?:is\s+)?(?:headquartered|based)\s+in\s+([A-Z][A-Za-z.\- ]{1,28}?)\s*[,.]/);
  return m ? m[1].trim() : null;
}

/** The pros/cons block. Two columns on a wide panel, stacked on a narrow one.
 *
 *  Deliberately NOT a score. Every attempt to roll these into a single number
 *  throws away the only thing that makes them useful — which specific fact
 *  fired — and the platform already has a composite score for the "one number"
 *  job. This block exists to answer a different question: what would someone
 *  arguing for this stock say, and what would someone arguing against it say.
 *
 *  Green and red carry the sign, but the ✓ / ! prefixes carry it too, because
 *  ~8% of men cannot separate those two hues and a colour-only signal is not a
 *  signal for them. */
function HealthBullets({ health, symbol }: { health: BusinessHealth; symbol: string }) {
  const { pros, cons } = health;

  if (pros.length === 0 && cons.length === 0) {
    // Two different reasons for an empty block, and they deserve different
    // sentences. Thin history is a fact about the company; nothing firing on a
    // full history means the company is unremarkable on every rule — which is
    // itself an answer, not a failure.
    return (
      <p className="text-[11px] muted-text italic mb-2">
        {health.years === 0
          ? `No annual financials on file for ${symbol}.`
          : health.years < 4
            ? `Only ${health.years} year${health.years === 1 ? "" : "s"} of financials — too short to judge trends.`
            : `Nothing stands out either way on ${health.years} years of financials.`}
      </p>
    );
  }

  const col = (items: typeof pros, title: string, colour: string, glyph: string) =>
    items.length > 0 && (
      <div className="min-w-0">
        <div className="text-[9.5px] uppercase tracking-wide font-semibold mb-1" style={{ color: colour }}>
          {title}
        </div>
        <ul className="space-y-0.5">
          {items.map((c) => (
            <li key={c.id} className="flex gap-1.5 text-[11px] leading-snug">
              <span aria-hidden className="shrink-0 font-bold" style={{ color: colour }}>
                {glyph}
              </span>
              <span className="min-w-0">{c.text}</span>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="mb-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {col(pros, "Working for it", "var(--color-up, #15803d)", "✓")}
        {col(cons, "Working against it", "var(--color-down, #b91c1c)", "!")}
      </div>
      {health.leverageSkipped && (
        // Said out loud rather than silently omitted. A lender with no debt or
        // margin line looks like a gap in the data; it is a deliberate
        // abstention, and naming the substitutes is what makes it read as one.
        <p className="mt-1.5 text-[9.5px] muted-text italic">
          Read as a lender: debt, margin and cash-conversion checks are skipped — those are the business
          model here, not a signal. Return on assets and cost-to-income are used in their place.
        </p>
      )}
    </div>
  );
}

function CompanyProfile({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [data, setData] = useState<Profile | null>(profileCache.get(symbol) ?? null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const cached = profileCache.get(symbol);
    if (cached) {
      setData(cached);
      setErr(false);
      return;
    }
    let alive = true;
    setData(null);
    setErr(false);
    fetch(`/api/stock/profile?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: Profile) => {
        if (!alive) return;
        profileCache.set(symbol, j);
        setData(j);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [symbol]);

  // Close on Escape — the panel is dismissible chrome, and reaching back for
  // the ⓘ to close it is the thing that makes an expander annoying.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="mt-2 rounded-md border hairline p-3"
      style={{ background: "var(--color-paper)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wide muted-text font-semibold">
          About {symbol}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[13px] leading-none muted-text hover:text-[var(--color-ink)] shrink-0"
          title="Close"
          aria-label="Close company information"
        >
          ×
        </button>
      </div>

      {err ? (
        <div className="text-[11.5px] muted-text italic">Could not load company information.</div>
      ) : data === null ? (
        <div className="text-[11.5px] muted-text italic">Loading…</div>
      ) : (
        <>
          {(() => {
            const summary = data.business_summary ?? "";
            const { lede, rest } = summary ? splitLede(summary) : { lede: "", rest: "" };
            const facts: { k: string; v: ReactNode }[] = [];
            if (data.ceo_name) {
              // The raw title can be "Chief Executive Officer of DB Digital",
              // which is longer than the name it labels. Collapsed to "CEO" in
              // the label column; the full title is on hover.
              facts.push({ k: "CEO", v: <span title={data.ceo_title ?? undefined}>{cleanPerson(data.ceo_name)}</span> });
            }
            const founded = summary ? extractFounded(summary) : null;
            const hq = summary ? extractHq(summary) : null;
            if (founded) facts.push({ k: "Founded", v: founded });
            if (hq) facts.push({ k: "Head office", v: hq });
            if (data.employees != null) {
              facts.push({ k: "Employees", v: data.employees.toLocaleString("en-IN") });
            }
            if (data.listing_date) {
              facts.push({ k: "Listed", v: formatShortDate(data.listing_date) });
            }
            if (data.industry || data.sector) {
              facts.push({ k: "Industry", v: data.industry ?? data.sector });
            }
            return (
              <>
                {/* The lede sentence alone answers "what is this company".
                    Given its own line at a readable size because it is the one
                    part of the prose most people will ever read. */}
                {lede && <p className="text-[12px] leading-snug mb-2">{lede}</p>}

                {/* Health ABOVE the facts grid, not below it. The order on this
                    card is the order of the questions: what does it do (lede),
                    is it any good (here), and only then the trivia. The facts
                    are reference; this is the part with a view. */}
                {data.health && <HealthBullets health={data.health} symbol={symbol} />}

                {/* Facts as a LABELLED GRID, not a wrapping inline row. The
                    inline version ran together — "…Shah B.E.Employees: 4,162
                    Listed: 06 Jan '10" — because flex gaps vanish at a wrap
                    boundary and there was no separator carrying the structure.
                    A grid puts every label in the same column, so the eye can
                    scan down it. */}
                {facts.length > 0 && (
                  <dl className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1 text-[11px] mb-2">
                    {facts.map((f) => (
                      <Fragment key={f.k}>
                        <dt className="muted-text whitespace-nowrap">{f.k}</dt>
                        <dd className="font-medium tabular-nums min-w-0 truncate">{f.v}</dd>
                      </Fragment>
                    ))}
                  </dl>
                )}

                {data.website && (
                  <a
                    href={data.website.startsWith("http") ? data.website : `https://${data.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-[11px] font-medium hover:underline mb-1.5"
                    style={{ color: "var(--color-accent-600)" }}
                  >
                    {data.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
                  </a>
                )}

                {/* The remaining prose — the brand lists, the segment
                    breakdowns, the former-name history — behind a disclosure.
                    It is reference material, not something you read every time
                    you open a stock. <details> rather than useState: it is
                    native, keyboard-accessible, and needs no re-render. */}
                {rest && (
                  <details className="group">
                    <summary className="cursor-pointer list-none text-[10.5px] font-medium select-none" style={{ color: "var(--color-accent-600)" }}>
                      <span className="group-open:hidden">More about the business ▾</span>
                      <span className="hidden group-open:inline">Less ▴</span>
                    </summary>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed max-h-[11rem] overflow-y-auto pr-1">
                      {rest}
                    </p>
                  </details>
                )}

                {!summary && (
                  // 451 of 2,593 active symbols have no summary — say so rather
                  // than rendering an empty box that reads as a failed load.
                  <p className="text-[11.5px] muted-text italic">
                    No business description on file for {symbol}.
                  </p>
                )}
              </>
            );
          })()}

          <div className="mt-2 flex items-center justify-between gap-2 text-[9.5px] muted-text">
            {/* Dated on purpose. Every row in the table was written by one
                backfill and nothing refreshes it, so an undated card would
                imply a currency it does not have. */}
            {/* Two dates, because the two halves of this card have genuinely
                different vintages and merging them into one would misdate one
                of them. The description is a frozen 2026-05-04 backfill; the
                bullets are computed from annual statements that ARE refreshed.
                The bullets are the fresher half and the footer should not let
                the stale half speak for them. */}
            <span>
              {[
                data.fetched_at
                  ? `Description as of ${formatShortDate(data.fetched_at.slice(0, 10))}`
                  : "Description date unknown",
                // asOf, not latestPeriod — where a trailing year was built the
                // profit bullets describe it, and those two can be six months
                // apart. Dating the card with the fiscal year would make the
                // freshest number on it look like the stalest.
                data.health?.asOf ? `financials to ${data.health.asOf}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <Link href={`/stock/${symbol}`} className="hover:underline shrink-0">
              Full profile →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function useExtras(symbol: string): { data: Extras | null; err: boolean } {
  const [data, setData] = useState<Extras | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const cached = extrasCache.get(symbol);
    if (cached) {
      setData(cached);
      setErr(false);
      return;
    }
    let alive = true;
    setData(null);
    setErr(false);
    fetch(`/api/watchlist/extras?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: Extras) => {
        if (!alive) return;
        const e: Extras = {
          dividends: j.dividends ?? [],
          bonuses: j.bonuses ?? [],
          quarterly: j.quarterly ?? [],
          news: j.news ?? [],
          shareholding: j.shareholding ?? [],
          glance: j.glance ?? null,
          glance_keys: j.glance_keys ?? [],
        };
        extrasCache.set(symbol, e);
        setData(e);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [symbol]);

  return { data, err };
}

/** Detail body below the score/return strips. Layout:
 *   Row A — price chart (squeezed) | fundamentals column (Sales / Net profit /
 *           OPM / NPM / Dividend, each a single row with its own sparkline)
 *   Row B — recent news in two columns
 */
/** Map a row's header returns (stored as FRACTIONS) to the chart's per-range
 *  PERCENT scale, keyed by chart Range. Feeding this to PriceChart makes the
 *  graph's range tabs render the exact same value as the header pills, so the
 *  1Y (etc.) can never show two different numbers. */
function rowRangeReturns(row: Row): Partial<Record<ChartRange, number | null>> {
  const p = (frac: number | null) => (frac == null ? null : frac * 100);
  return {
    "1W": p(row.ret_1w),
    "1M": p(row.ret_1m),
    "3M": p(row.ret_3m),
    "1Y": p(row.ret_1y),
    "3Y": p(row.ret_3y),
    "5Y": p(row.ret_5y),
    "10Y": p(row.ret_10y),
    "ALL": p(row.ret_all),
  };
}

function DetailExtras({
  symbol,
  sector,
  signedIn,
  trades,
  rangeReturns,
  ret1d,
  ltpDate,
  extraStats,
}: {
  symbol: string;
  sector: string | null;
  signedIn?: boolean;
  trades?: TradeMark[];
  /** Header pill returns (PERCENT) passed to the chart so its range tabs show
   *  the exact same number as the pills — one source of truth, no drift. */
  rangeReturns?: Partial<Record<ChartRange, number | null>>;
  /** 1D move (percent) + EOD date, rendered as a thin strip directly above the
   *  price chart (relocated out of the card header). */
  ret1d?: number | null;
  ltpDate?: string | null;
  /** Rel Vol / Turnover / Delivery, rendered inline next to the chart's price-
   *  alert "Add" button. */
  extraStats?: ReactNode;
}) {
  const { data, err } = useExtras(symbol);
  const quarterly = data?.quarterly ?? [];
  const dividends = data?.dividends ?? [];
  const news = data?.news ?? [];
  const shareholding = data?.shareholding ?? [];
  // Arrives with the rest of the extras rather than on every list row. Until it
  // lands, FundamentalsColumn already has `loading` — the same spinner the
  // quarterly/dividend blocks beside it use — so there's no new empty state.
  const glance = data?.glance ?? null;
  const glanceKeys = data?.glance_keys;
  const loadingExtras = data === null && !err;
  const nothing =
    data !== null &&
    quarterly.length === 0 &&
    dividends.length === 0 &&
    news.length === 0;

  return (
    <div className="mt-3 space-y-4">
      {/* Row A: price chart, fundamentals, and — from xl up — news, all on the
          same row. News used to sit below this grid, so its top was pushed
          down by the taller of the two columns (the chart body alone is
          300px). Trimming header chrome could never fix that; only moving
          news *beside* the chart puts it on the first screen. Below xl there
          isn't width for a third column, so it spans back underneath. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_220px] xl:grid-cols-[minmax(0,1fr)_220px_minmax(240px,300px)] gap-4 items-start">
        {/* Shared chart module — same expand / draw / price-alert features as
            the stock page. Self-fetches candles by symbol; alert controls show
            when signed in. The held-position summary now lives in the card
            header (HoldChip), so the chart starts clean here. */}
        <div className="min-w-0">
          <PriceChart
            symbol={symbol}
            canSetAlerts={!!signedIn}
            trades={trades}
            rangeReturns={rangeReturns}
            dayChangePct={ret1d}
            asOfLabel={ltpDate ? formatShortDate(ltpDate) : undefined}
            extraStats={extraStats}
          />
        </div>
        <FundamentalsColumn
          quarterly={quarterly}
          dividends={dividends}
          shareholding={shareholding}
          loading={loadingExtras}
          glance={glance}
          glanceKeys={glanceKeys}
          sector={sector}
        />

        {/* Third column at xl; full-width row beneath the other two below it.
            Rendered even when empty — an absent column used to read as "the
            news failed to load", and the answer "there is none" is itself
            information. Suppressed only while the fetch is still in flight. */}
        {!loadingExtras && (
          <div className="min-w-0 lg:col-span-2 xl:col-span-1">
            {news.length > 0 ? (
              <NewsGrid news={news} />
            ) : (
              <>
                <div className="text-[9.5px] uppercase tracking-wide muted-text mb-1">
                  Recent news
                </div>
                <div className="text-[11px] muted-text italic">
                  No recent news for {symbol}.
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {nothing && (
        <div className="text-[11px] muted-text italic">
          No corporate actions, results, or news on record for {symbol}.
        </div>
      )}
    </div>
  );
}

/** Sparkline colour: first→last non-null, flipped for "lower is better"
 *  metrics. Flat/insufficient data reads muted. */
function trendColorFor(series: (number | null)[], inverse?: boolean): string {
  const nn = series.filter((v): v is number => v != null);
  if (nn.length < 2) return "var(--color-muted)";
  const up = nn[nn.length - 1] > nn[0];
  const good = inverse ? !up : up;
  return good ? "var(--color-score-good)" : "var(--color-delta-down)";
}

/** The four P&L flow metrics that our source reports quarterly (there is no
 *  quarterly balance sheet, so returns/leverage/efficiency are annual-only). */
const FLOW_KEYS: MetricKey[] = ["sales", "net_profit", "opm", "npm"];

/** Right-hand fundamentals box with a Yearly ⇄ Quarterly toggle:
 *
 *   QUARTERLY — Revenue / Net profit / OPM / NPM, the only lines our source
 *     reports quarterly, each an 8-quarter sparkline with YoY. Freshest read.
 *   YEARLY — the scorecard fundamentals this stock's cluster actually weights
 *     (flow YoY + RoCE for a compounder, debtor-days for IT, inventory-days for
 *     realty …). Returns/leverage/efficiency are balance-sheet based and so are
 *     annual-only; the dividend graph and the sector caveat sit here too.
 *
 *  Quarterly flow comes from `quarterly` (the extras API); yearly rows from the
 *  `glance` annual series already on the row, ordered by `glanceKeys`. */
function FundamentalsColumn({
  quarterly,
  dividends,
  shareholding,
  loading,
  glance,
  glanceKeys,
  sector,
}: {
  quarterly: Quarter[];
  dividends: Dividend[];
  shareholding: Shareholding[];
  loading: boolean;
  glance: GlanceMetrics | null;
  glanceKeys: MetricKey[] | undefined;
  sector: string | null;
}) {
  // Default to Yearly — that's where the cluster-specific fundamentals live
  // (the whole point of the scorecard-driven rows); Quarterly is one click away.
  const [mode, setMode] = useState<"y" | "q">("y");

  const latest = quarterly[0];
  const sectorCfg = metricsForSector(sector);
  const keys = glanceKeys && glanceKeys.length > 0 ? glanceKeys : sectorCfg.keys;
  // Yearly rows: flow metrics first (Revenue / profit / margins), then the
  // scorecard ratios — deduped, drawn from the annual `glance` series.
  const yearlyKeys = [
    ...FLOW_KEYS.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !FLOW_KEYS.includes(k)),
  ];

  // Quarterly flow series — last 8 quarters, oldest→newest for the sparkline.
  const q8 = [...quarterly].slice(0, 8).reverse();
  const qSales = q8.map((q) => q.sales);
  const qNp = q8.map((q) => q.net_profit);
  const qOpm = q8.map((q) => q.opm_pct);
  const qNpm = q8.map((q) => q.npm_pct);

  // Dividend series: amounts over time (skip purpose-only rows for the graph).
  const divChrono = [...dividends].sort((a, b) => a.ex_date.localeCompare(b.ex_date));
  const divSeries = divChrono.map((d) => d.amount);
  const latestDiv = [...divChrono].reverse().find((d) => d.amount != null);

  // Promoter holding: API hands rows newest-first. Sparkline wants oldest→newest.
  // Deltas are in percentage POINTS (pp): promoter 62%→63% is +1.0pp, not +1.6%.
  // QoQ = latest vs prior quarter; YoY = latest vs 4 quarters back.
  const promLatest = shareholding[0]?.promoter_pct ?? null;
  const promQoQ =
    promLatest != null && shareholding[1]?.promoter_pct != null
      ? promLatest - (shareholding[1].promoter_pct as number)
      : null;
  const promYoY =
    promLatest != null && shareholding[4]?.promoter_pct != null
      ? promLatest - (shareholding[4].promoter_pct as number)
      : null;
  const promSeries = [...shareholding].reverse().map((s) => s.promoter_pct);
  const hasPromoter = shareholding.some((s) => s.promoter_pct != null);

  const hasQuarter = quarterly.length > 0;
  const hasYearly = yearlyKeys.some((k) => glance?.[k]?.value != null);
  const nothing = !hasQuarter && !hasYearly && dividends.length === 0 && !hasPromoter;

  // If the chosen cadence has no data but the other does, fall back so the box
  // is never blank when there's something to show. Promoter lives in the Yearly
  // view (like dividend), so it counts toward keeping us on Yearly.
  const effMode: "y" | "q" = nothing
    ? mode
    : mode === "q" && !hasQuarter
      ? "y"
      : mode === "y" && !hasYearly && dividends.length === 0 && !hasPromoter
        ? "q"
        : mode;

  return (
    <div className="rounded-md border hairline overflow-hidden">
      <div className="px-3 py-2 border-b hairline flex items-center justify-between gap-2">
        <span className="text-[9.5px] uppercase tracking-wide muted-text">
          Fundamentals
          {effMode === "q" && latest && (
            <span className="normal-case tracking-normal"> · {fmtQuarter(latest.period_end)}</span>
          )}
        </span>
        {/* Yearly ⇄ Quarterly toggle. */}
        <div className="inline-flex rounded-md border hairline overflow-hidden shrink-0">
          {(["y", "q"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className="px-2 py-0.5 text-[10px] font-medium transition-colors border-l first:border-l-0 hairline"
              style={
                effMode === m
                  ? { backgroundColor: "var(--color-accent-600)", color: "white" }
                  : undefined
              }
              aria-pressed={effMode === m}
            >
              {m === "y" ? "Yearly" : "Quarterly"}
            </button>
          ))}
        </div>
      </div>

      {nothing ? (
        <div className="px-3 py-3 text-[11px] muted-text italic">
          {loading ? "Loading…" : "No results on record."}
        </div>
      ) : effMode === "q" ? (
        /* ── Quarterly: flow metrics, 8-quarter trend. ── */
        <div className="divide-y hairline">
          <MetricSpark
            label={sectorCfg.salesLabel}
            value={latest ? `₹${fmtCr(latest.sales)} Cr` : "—"}
            yoy={latest?.sales_yoy ?? null}
            series={qSales}
            color={trendColorFor(qSales)}
          />
          <MetricSpark
            label="Net profit"
            value={latest ? `₹${fmtCr(latest.net_profit)} Cr` : "—"}
            yoy={latest?.np_yoy ?? null}
            series={qNp}
            color={trendColorFor(qNp)}
          />
          <MetricSpark
            label="OPM"
            value={latest?.opm_pct == null ? "—" : `${latest.opm_pct.toFixed(1)}%`}
            series={qOpm}
            color={trendColorFor(qOpm)}
          />
          <MetricSpark
            label="NPM"
            value={latest?.npm_pct == null ? "—" : `${latest.npm_pct.toFixed(1)}%`}
            series={qNpm}
            color={trendColorFor(qNpm)}
          />
        </div>
      ) : (
        /* ── Yearly: scorecard flow + ratios (annual) + dividend. ── */
        <>
          <div className="divide-y hairline">
            {yearlyKeys.map((k) => {
              const meta = METRIC_META[k];
              const m = glance?.[k] ?? null;
              const label = k === "sales" ? sectorCfg.salesLabel : meta.label;
              return (
                <MetricSpark
                  key={k}
                  label={label}
                  value={fmtMetric(m?.value ?? null, meta.format)}
                  yoy={FLOW_KEYS.includes(k) ? m?.yoy ?? null : null}
                  series={m?.series ?? []}
                  color={trendColorFor(m?.series ?? [], meta.inverse)}
                  valueTitle={meta.help}
                />
              );
            })}
            {/* Dividend graph — always shown; not a scored metric. */}
            <MetricSpark
              label="Dividend"
              value={
                latestDiv?.amount != null
                  ? `₹${latestDiv.amount}`
                  : dividends.length > 0
                    ? (dividends[0].purpose ?? "—")
                    : "—"
              }
              valueTitle={latestDiv ? `Latest dividend · ex ${fmtShortDate(latestDiv.ex_date)}` : undefined}
              series={divSeries}
              color="var(--color-delta-up)"
            />
            {/* Promoter holding — current %, growth sparkline, QoQ + YoY (pp). */}
            {hasPromoter && (
              <PromoterSpark
                value={promLatest != null ? `${promLatest.toFixed(1)}%` : "—"}
                qoq={promQoQ}
                yoy={promYoY}
                series={promSeries}
              />
            )}
          </div>

          {sectorCfg.note && (
            <div className="px-3 py-2 text-[9.5px] muted-text italic leading-snug border-t hairline">
              {sectorCfg.note}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One fundamentals row: label + latest value + optional YoY badge on top, a
 *  small sparkline of the metric's history below. */
function MetricSpark({
  label,
  value,
  series,
  yoy = null,
  color = "var(--color-accent-600)",
  valueTitle,
}: {
  label: string;
  value: string;
  series: (number | null)[];
  yoy?: number | null;
  color?: string;
  valueTitle?: string;
}) {
  return (
    <div className="px-3 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9.5px] uppercase tracking-wide muted-text">{label}</span>
        {yoy != null && (
          <span
            className="text-[9.5px] font-medium tabular-nums"
            style={{ color: yoy >= 0 ? "var(--color-delta-up)" : "var(--color-delta-down)" }}
            title="Year-on-year change vs the prior comparable period"
          >
            {yoy >= 0 ? "+" : ""}
            {yoy.toFixed(1)}% YoY
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <span className="text-[12.5px] font-medium tabular-nums leading-tight truncate" title={valueTitle}>
          {value}
        </span>
        <div className="w-[84px] shrink-0">
          <Sparkline values={series} color={color} />
        </div>
      </div>
    </div>
  );
}

/** Promoter-holding row: current % + growth sparkline, with QoQ and YoY deltas
 *  expressed in percentage POINTS (pp). Deltas below ±0.1pp read as "flat" (and
 *  aren't colored) — sub-0.1pp drift is usually rounding / ESOP noise, not a
 *  promoter buying or selling. Colour follows sign otherwise. */
function PromoterSpark({
  value,
  qoq,
  yoy,
  series,
}: {
  value: string;
  qoq: number | null;
  yoy: number | null;
  series: (number | null)[];
}) {
  const NOISE = 0.1; // pp
  const fmtDelta = (d: number | null): { text: string; color: string } => {
    if (d == null) return { text: "—", color: "var(--color-muted)" };
    if (Math.abs(d) < NOISE) return { text: "≈0", color: "var(--color-muted)" };
    const sign = d > 0 ? "+" : "−";
    const color = d > 0 ? "var(--color-delta-up)" : "var(--color-delta-down)";
    return { text: `${sign}${Math.abs(d).toFixed(1)}`, color };
  };
  const q = fmtDelta(qoq);
  const y = fmtDelta(yoy);
  return (
    <div className="px-3 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9.5px] uppercase tracking-wide muted-text">Promoters</span>
        <span className="text-[9.5px] font-medium tabular-nums" title="Change in promoter holding, in percentage points (pp)">
          <span style={{ color: q.color }}>{q.text}</span>
          <span className="muted-text"> QoQ · </span>
          <span style={{ color: y.color }}>{y.text}</span>
          <span className="muted-text"> YoY</span>
        </span>
      </div>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <span className="text-[12.5px] font-medium tabular-nums leading-tight" title="Latest promoter holding (% of shares)">
          {value}
        </span>
        <div className="w-[84px] shrink-0">
          <Sparkline values={series} color="var(--color-accent-600)" />
        </div>
      </div>
    </div>
  );
}

/** Minimal responsive sparkline. Stretches to the container width; the last
 *  point gets a dot. Non-scaling stroke keeps the line crisp despite the
 *  horizontal stretch. Renders a flat baseline when there's <2 points. */
function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const H = 16;
  const W = 100; // viewBox units; preserveAspectRatio="none" stretches x to fit
  const pts = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v != null);

  if (pts.length < 2) {
    return <div className="h-[16px]" aria-hidden />;
  }

  const xMax = values.length - 1 || 1;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const range = max - min || 1;
  const x = (i: number) => (i / xMax) * W;
  const y = (v: number) => H - 2 - ((v - min) / range) * (H - 4);

  const d = pts
    .map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[16px] block">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {/* One dot per quarter so each data point is legible, last one emphasised. */}
      {pts.map((p, k) => (
        <circle
          key={p.i}
          cx={x(p.i)}
          cy={y(p.v)}
          r={k === pts.length - 1 ? 2 : 1.4}
          fill={k === pts.length - 1 ? color : "var(--color-paper)"}
          stroke={color}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/** Recent news in two columns. */
function NewsGrid({ news }: { news: NewsItem[] }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wide muted-text mb-1">Recent news</div>
      {/* Two columns while this is a full-width row; one narrow column once it
          moves beside the chart at xl, where it is capped to roughly the
          chart's height and scrolls internally rather than stretching the row
          (which would push everything below it back down the page). */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-x-4 gap-y-1 xl:max-h-[400px] xl:overflow-y-auto xl:pr-1">
        {news.map((n, i) => (
          <li key={`${n.published_at}-${i}`}>
            <a
              href={n.url ?? "#"}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="block group"
              title={isFreshNews(n.published_at) ? `${n.title}\n\nPublished in the last 7 days` : n.title}
            >
              {/* Freshness is a filled chip, not a text colour. accent-700 is
                  #1d324b against ink #15171c — at 11px those are the same
                  colour to the eye, so recolouring the headline changed
                  nothing you could see. */}
              <div className="text-[11px] leading-tight group-hover:underline line-clamp-2">
                {isFreshNews(n.published_at) && (
                  <span
                    className="inline-block align-[1px] mr-1.5 px-1 rounded text-[8.5px] font-bold uppercase tracking-wide leading-[1.5]"
                    style={{ background: "var(--color-accent-600)", color: "#fff" }}
                    title="Published in the last 7 days"
                  >
                    New
                  </span>
                )}
                {n.title}
              </div>
              <div
                className="text-[9px] muted-text tabular-nums flex items-center gap-1.5"
                style={isFreshNews(n.published_at) ? { color: "var(--color-accent-600)" } : undefined}
              >
                {n.source && <span>{n.source}</span>}
                {n.source && <span aria-hidden>·</span>}
                <span>{fmtNewsDate(n.published_at)}</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Published within the last 7 days — drives the accent colouring in NewsGrid.
 *  Unparseable timestamps are NOT fresh: a bad date should read as old rather
 *  than light up every headline on the page. Future-dated items (feeds do ship
 *  them, timezone-skewed) count as fresh, which is the honest reading. */
function isFreshNews(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= 7 * 24 * 60 * 60 * 1000;
}

/** ISO timestamp → "20 Jul '26" for the news byline. */
function fmtNewsDate(iso: string | null): string {
  // `app.news.published_at` is nullable and some rows are NULL. `new Date(null)`
  // is the epoch, not an error — which is how a headline came to be dated
  // "1 Jan '70" and sort to the top of the list. Bail before that.
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1990) return "";
  const day = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const yr = d.toLocaleDateString("en-IN", { year: "2-digit" });
  return `${day} '${yr}`;
}

/** "2026-03-31" → "Q4 FY26" (Indian fiscal year ending March). */
function fmtQuarter(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const m = d.getUTCMonth() + 1; // 1..12
  const y = d.getUTCFullYear();
  // Indian FY: Apr–Jun=Q1, Jul–Sep=Q2, Oct–Dec=Q3, Jan–Mar=Q4.
  const q = m <= 3 ? 4 : m <= 6 ? 1 : m <= 9 ? 2 : 3;
  const fy = m <= 3 ? y : y + 1; // Jan–Mar belongs to the FY ending that year
  return `Q${q} FY${String(fy).slice(2)}`;
}

/** ₹-crore number with thousands separators; "—" when null. */
function fmtCr(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/** "2026-06-05" → "5 Jun '26". */
function fmtShortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const yr = d.toLocaleDateString("en-IN", { year: "2-digit", timeZone: "UTC" });
  return `${day} '${yr}`;
}

// ── Metric cell + formatters ────────────────────────────────────────────────

/** Inline "label: value" stat matching the Q/V/M ReturnPill rhythm — used for
 *  the entry-context (Added / Since add), 52-week extremes, and the chart's
 *  liquidity stats so they all read as one consistent inline family. */
function InlineStat({
  label,
  value,
  title,
  color,
}: {
  label: string;
  value: string;
  title?: string;
  color?: string;
}) {
  return (
    <span title={title} className="whitespace-nowrap">
      <span className="muted-text">{label}: </span>
      <span className="font-medium" style={color ? { color } : undefined}>{value}</span>
    </span>
  );
}

/** ₹-prefixed price with up to 2 decimals; "—" when null. */
function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Compact share count in Indian units — "1.2 Cr", "3.4 L", "5.6K". */
function fmtVol(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)} Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)} L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

/** Signed percent (+/−, 1 dp), "—" when null. */
function fmtSignedPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function deltaColor(v: number | null): string | undefined {
  if (v == null || v === 0) return undefined;
  return v > 0 ? "var(--color-delta-up)" : "var(--color-delta-down)";
}

/** YYYY-MM-DD → "24 May '26" (compact, for the metric strip). */
function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
  const yr = d.toLocaleDateString("en-IN", { year: "2-digit", timeZone: "UTC" });
  return `${day} '${yr}`;
}

// ── Editable note ────────────────────────────────────────────────────────────

function NoteEditor({ symbol, initial }: { symbol: string; initial: string | null }) {
  const [val, setVal] = useState(initial ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initial ?? "");

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const flush = (next: string) => {
    if (next === lastSaved.current) return;
    setStatus("saving");
    saveWatchlistNote(symbol, next)
      .then(() => {
        lastSaved.current = next;
        setStatus("saved");
      })
      .catch(() => setStatus("error"));
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value.slice(0, 500);
    setVal(next);
    setStatus("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next), 800);
  };

  const onBlur = () => {
    if (timer.current) clearTimeout(timer.current);
    flush(val);
  };

  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between mb-1">
        <label className="text-[9.5px] uppercase tracking-wide muted-text" htmlFor={`note-${symbol}`}>
          Note
        </label>
        <span className="text-[9.5px] muted-text tabular-nums">
          {status === "saving" && "saving…"}
          {status === "saved" && "saved ✓"}
          {status === "error" && <span style={{ color: "var(--color-delta-down)" }}>save failed</span>}
        </span>
      </div>
      <textarea
        id={`note-${symbol}`}
        value={val}
        onChange={onChange}
        onBlur={onBlur}
        rows={2}
        maxLength={500}
        placeholder="Why you're watching this — thesis, level to buy, catalyst to wait for…"
        className="w-full rounded-md border hairline bg-transparent px-2.5 py-1.5 text-[12px] leading-[1.5] resize-y focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-600)]"
      />
    </div>
  );
}

function ReturnPill({
  label, value, pct = false, signed = false,
}: { label: string; value: number | null; pct?: boolean; signed?: boolean }) {
  if (value == null) {
    return (
      <span className="muted-text">
        {label}: <span className="opacity-60">—</span>
      </span>
    );
  }
  if (pct) {
    return (
      <span>
        <span className="muted-text">{label}: </span>
        <span className="font-medium">{Math.round(value)}</span>
      </span>
    );
  }
  if (signed) {
    const v = value * 100;
    const color = v >= 0 ? "var(--color-delta-up)" : "var(--color-delta-down)";
    // Multi-year multibaggers read as absurd percentages (+96,800%). Once a
    // gain clears ~10x, switch to the "×" multiple convention (969×) — the way
    // long-horizon returns are actually quoted.
    let body: string;
    if (value >= 9) {
      body = `${Math.round(value + 1).toLocaleString("en-IN")}×`;
    } else {
      const sign = v >= 0 ? "+" : "";
      body = `${sign}${Math.abs(v) >= 10 ? Math.round(v).toString() : v.toFixed(1)}%`;
    }
    return (
      <span>
        <span className="muted-text">{label}: </span>
        <span className="font-medium" style={{ color }}>{body}</span>
      </span>
    );
  }
  return <span>{label}: {value}</span>;
}

// WatchlistButton is reused on /stock pages so users can still toggle there;
// the row's × button is just a faster way to prune from this page.
void WatchlistButton;
