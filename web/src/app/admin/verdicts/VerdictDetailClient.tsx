"use client";

/**
 * The verdict detail view: one stock at a time, picked from a tree on the
 * left, with the price chart, the full verdict (operating review, target
 * price, quant models — everything VerdictPanel already renders), and that
 * stock's news/filings on the right.
 *
 * NOT A REBUILD OF VerdictPanel. The screenshots that specified this page
 * ("Fundamental Operating Review", "Quantitative Institutional Models",
 * "Target Price") are this app's OWN VerdictPanel, already live on the stock
 * page's Verdict tab and inside the watchlist's VerdictSheet. Writing a second
 * copy here would be exactly the drift CLAUDE.md §4 warns about — two renders
 * of one verdict that can silently disagree. This page's only job is the
 * frame around that existing panel: the top stats bar, the tree, the stock
 * header + nav strip + chart above the panel, and the news beside it.
 *
 * MOST OF THIS PAGE COMES FROM ONE FETCH: /api/admin/verdict?queue=1 already
 * returns, per entry, sector/industry (tree), action/confidence/ageDays
 * (header + tree badges + action tabs), and
 * ltp/anchorPrice/targetPrice/buyBelow/bearFloor/upsidePct (header stats) —
 * the same payload the Board tab reads, plus `summary`/`counts` for the top
 * bar. Grouping/filtering/ranking those client-side costs nothing further.
 *
 * THE CHART SELF-FETCHES. <PriceChart symbol={...} /> without a `candles`
 * prop fetches its own OHLC — see that component's header.
 *
 * TWO GENUINELY NEW READS, both admin-only, both one-route-per-concern (see
 * each route's own header for why they aren't folded into /api/admin/verdict):
 *   - /api/admin/stock-context?symbol=X — news + BSE filings, copied verbatim
 *     from the stock page's own queries. A symbol can legitimately have one
 *     and not the other (recent filings, no press coverage, or vice versa) —
 *     that is a true read of app.announcement / app.news, not a bug here.
 *   - /api/admin/stock-meta?symbol=X — maturity tier, cap tier, listing date,
 *     live intraday price + 1-day move, and the scores snapshot date. All of
 *     this already exists for the scanner/watchlist pages via CapTierBadge /
 *     IntradayPriceBadge / tierLabel; this route just scopes the same source
 *     tables to one symbol instead of the whole universe.
 *
 * "Inspected" and the bookmark are admin-page-local state, kept in
 * localStorage under their own keys (not scannerBookmarks / the watchlist's
 * marks, which are user-facing and sometimes server-synced — mixing an admin
 * tool's scratch state into those would leak into a real user's watchlist UI).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Home, Bookmark, BookmarkCheck, CheckCircle2, Circle } from "lucide-react";
import { PriceChart } from "@/components/PriceChart";
import type { TradeMark } from "@/app/tools/scanner/CandleChart";
import { VerdictPanel, VerdictEmpty } from "@/components/VerdictPanel";
import CapTierBadge, { type CapCategory } from "@/components/CapTierBadge";
import { IntradayPriceBadge } from "@/components/IntradayPriceBadge";
import { tierLabel } from "@/lib/score";
// Type-only import of QueueEntry/VerdictQueue from lib/verdict.ts: that
// module's top-level `import { sql } from "@/lib/db"` pulls the Postgres
// driver (needs Node's `tls`/`net`) into any bundle that imports it as a
// VALUE. `import type` is fully erased by the compiler, so this client
// component never drags that module in — STALE_DAYS and the other runtime
// values come from verdictTypes.ts instead, which has no server code.
import type { QueueEntry, VerdictQueue } from "@/lib/verdict";
import { STALE_DAYS, getWatchSubtype, type VerdictData, type WatchSubtypeKey } from "@/lib/verdictTypes";

type NewsRow = { title: string; source: string; url: string; published_at: string | null };
type FilingRow = {
  title: string;
  category: string;
  headline: string | null;
  published_at: string | null;
  pdf_url: string | null;
};
type StockMeta = {
  maturity_tier: string | null;
  market_cap_category: CapCategory;
  listing_date: string | null;
  current_price: number | null;
  price_fetched_at: string | null;
  ret_1d: number | null;
  scores_snapshot_date: string | null;
};
type ClusterMapRow = { cluster_id: string; cluster_name: string; sector_name: string };
type SymbolMapRow = { symbol: string; cluster_name: string; sector_name: string };
type PortfolioPosition = { qty: number; avgCost: number | null };

type Scope = "nifty500" | "all" | "watchlist" | "portfolio" | "archived" | "inspected";
type ActionFilter = "buy" | "accumulate" | "hold" | "watch" | "avoid" | null;
// "all"/"near_entry"/"high_upside" are UI-only slices of the watch bucket;
// the rest are getWatchSubtype()'s own thesis-classification keys — reusing
// that function rather than re-deriving a second copy of the taxonomy, the
// way the Board tab's two independent label sets have already drifted apart.
type WatchFilterType = "all" | "near_entry" | "high_upside" | WatchSubtypeKey;

const INSPECTED_KEY = "fundamental_verdict_detail_inspected";
const BOOKMARK_KEY = "fundamental_verdict_detail_bookmark";

const ACTION_COLOR: Record<string, string> = {
  BUY: "bg-emerald-600 text-white",
  ACCUMULATE: "bg-emerald-500 text-white",
  HOLD: "bg-slate-500 text-white",
  WATCH: "bg-amber-500 text-white",
  SELL: "bg-rose-600 text-white",
  AVOID: "bg-rose-600 text-white",
  "REDUCE & AVOID": "bg-rose-600 text-white",
};

// Display labels for the WATCH dropdown's own current-selection text. Kept
// static (not derived from getWatchSubtype, which classifies a stock, not a
// filter key) — matches the same wording the dropdown's own option rows use.
const WATCH_FILTER_LABEL: Record<Exclude<WatchFilterType, "all">, string> = {
  near_entry: "Near Buy Zone",
  high_upside: "≥20% Upside",
  cashflow: "Cash Flow Proof",
  roce: "Capital Efficiency",
  pullback: "Valuation Pullback",
  turnaround: "Margin Turnaround",
  risk: "Governance / Risk",
};

function actionClass(action: string | null): string {
  if (!action) return "bg-slate-200 text-slate-600";
  const key = Object.keys(ACTION_COLOR).find((k) => action.toUpperCase().includes(k));
  return key ? ACTION_COLOR[key] : "bg-slate-300 text-slate-700";
}

function actionShort(action: string | null): string {
  if (!action) return "—";
  const up = action.toUpperCase();
  if (up.includes("ACCUMULATE")) return "ACC";
  if (up.includes("BUY")) return "BUY";
  if (up.includes("HOLD")) return "HLD";
  if (up.includes("WATCH")) return "WCH";
  if (up.includes("AVOID") || up.includes("REDUCE")) return "AVD";
  if (up.includes("SELL")) return "SEL";
  return up.slice(0, 3);
}

/** Matches a QueueEntry.action string against one of the five count-bar
 *  buckets. SELL is folded into "avoid" here — the bar shows one combined
 *  "REDUCE & AVOID" count, same as the Board. */
function actionMatchesFilter(action: string | null, filter: ActionFilter): boolean {
  if (!filter) return true;
  const up = (action ?? "").toUpperCase();
  if (filter === "accumulate") return up.includes("ACCUMULATE");
  if (filter === "buy") return up.includes("BUY") && !up.includes("ACCUMULATE");
  if (filter === "hold") return up.includes("HOLD");
  if (filter === "watch") return up.includes("WATCH") || up.includes("SPECULATIVE");
  if (filter === "avoid") return up.includes("AVOID") || up.includes("REDUCE") || up.includes("SELL");
  return true;
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

/** YYYY-MM-DD → "Mon, 24 May 2026", anchored at noon UTC so the date string
 *  doesn't roll back a day in negative timezones. Same formatter the
 *  watchlist page uses for its "Scores" badge. */
function formatSnapshotDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

function money(n: number | null): string {
  if (n == null) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function pct(n: number | null): string {
  if (n == null) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}

function readInspected(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(INSPECTED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function readBookmark(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(BOOKMARK_KEY);
  } catch {
    return null;
  }
}

export function VerdictDetailClient() {
  const [queueState, setQueueState] = useState<
    { kind: "loading" } | { kind: "ok"; q: VerdictQueue } | { kind: "error"; msg: string }
  >({ kind: "loading" });
  const [symbol, setSymbol] = useState<string | null>(null);
  const [treeSearch, setTreeSearch] = useState("");
  // Multi-node expand state, keyed by sector name and "sector//industry" —
  // same scheme WatchlistClient's rail uses, so several sectors/industries
  // can stay open at once instead of one accordion slot.
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  // Watchlist is the default scope, not Nifty 500 — the focus is "what am I
  // actually tracking", so new sessions open already narrowed to it.
  const [scope, setScope] = useState<Scope>("watchlist");
  const [actionFilter, setActionFilter] = useState<ActionFilter>(null);
  const [reviewFilter, setReviewFilter] = useState<"pending" | "due" | "changed" | null>(null);
  // Cluster filter — ported from the Board tab. Filters by cluster_id (the
  // ~79 industry-level clusters, same granularity Board filters at — not the
  // ~9 meta-cluster "sectors" the tree groups by), sourced from the SAME
  // queue payload's q.clusterProgress, so no extra fetch.
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [clusterMenuOpen, setClusterMenuOpen] = useState(false);
  const [clusterMenuSearch, setClusterMenuSearch] = useState("");
  // WATCH sub-category dropdown — ported from the Board tab's inline
  // breakdown bar, as a dropdown instead since this page's top bar is
  // already dense. Only has effect when actionFilter === "watch".
  const [watchFilter, setWatchFilter] = useState<WatchFilterType>("all");
  const [watchMenuOpen, setWatchMenuOpen] = useState(false);
  const [inspected, setInspected] = useState<Set<string>>(() => readInspected());
  const [mark, setMark] = useState<string | null>(() => readBookmark());

  const [verdictState, setVerdictState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "ok"; data: VerdictData | null } | { kind: "error"; msg: string }
  >({ kind: "idle" });
  const [contextState, setContextState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "ok"; news: NewsRow[]; filings: FilingRow[] } | { kind: "error" }
  >({ kind: "idle" });
  const [metaState, setMetaState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "ok"; meta: StockMeta } | { kind: "error" }
  >({ kind: "idle" });
  const [clusterMap, setClusterMap] = useState<Map<string, string>>(new Map());
  // symbol -> {cluster_name, sector_name}, from app.cluster_assignment —
  // covers dormant entries too, which carry cluster_id: null (see
  // cluster-map/route.ts header) and would otherwise fall back to the noisy
  // app.universe.sector/industry fields.
  const [symbolMap, setSymbolMap] = useState<Map<string, { cluster_name: string; sector_name: string }>>(new Map());
  const [positions, setPositions] = useState<Record<string, PortfolioPosition>>({});
  // "B" entry mark per held symbol (not just the one selected) — see
  // /api/admin/portfolio-positions's header for why this is unrestricted.
  const [tradesBySymbol, setTradesBySymbol] = useState<Record<string, TradeMark[]>>({});
  // True once the cluster-map fetch has settled (success or fail) — gates the
  // very first auto-selection below so it picks the tree's real first
  // sector-cluster, not whatever queue order / noisy fallback sector sorts
  // to before that map arrives.
  const [mapsReady, setMapsReady] = useState(false);

  // Queue once, for the top bar, the tree and the nav strip.
  useEffect(() => {
    let live = true;
    fetch("/api/admin/verdict?queue=1", { cache: "no-store" })
      .then(async (r) => {
        if (!live) return;
        if (!r.ok) {
          setQueueState({ kind: "error", msg: `Could not load the stock list (${r.status}).` });
          return;
        }
        const q = (await r.json()) as VerdictQueue;
        setQueueState({ kind: "ok", q });
        // Default symbol selection is pinned by the effect below, once the
        // real sector map has loaded — not here, and not to queue order
        // (q.entries[0] is arbitrary; the tree's first sector-cluster/first
        // stock is what "pin the start" means).
      })
      .catch(() => {
        if (live) setQueueState({ kind: "error", msg: "The stock list request did not complete." });
      });

    fetch("/api/admin/cluster-map", { cache: "no-store" })
      .then(async (r) => {
        if (!live || !r.ok) return;
        const j = (await r.json()) as { rows: ClusterMapRow[]; bySymbol: SymbolMapRow[] };
        setClusterMap(new Map(j.rows.map((row) => [row.cluster_id, row.sector_name])));
        setSymbolMap(
          new Map(j.bySymbol.map((row) => [row.symbol, { cluster_name: row.cluster_name, sector_name: row.sector_name }])),
        );
      })
      .catch(() => {})
      .finally(() => {
        if (live) setMapsReady(true);
      });

    fetch("/api/admin/portfolio-positions", { cache: "no-store" })
      .then(async (r) => {
        if (!live || !r.ok) return;
        const j = (await r.json()) as {
          positions: Record<string, PortfolioPosition>;
          trades?: Record<string, TradeMark[]>;
        };
        setPositions(j.positions ?? {});
        setTradesBySymbol(j.trades ?? {});
      })
      .catch(() => {});

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Verdict + news/filings + stock meta, per selected symbol.
  useEffect(() => {
    if (!symbol) return;
    let live = true;
    setVerdictState({ kind: "loading" });
    setContextState({ kind: "loading" });
    setMetaState({ kind: "loading" });

    fetch(`/api/admin/verdict?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!live) return;
        if (!r.ok) {
          setVerdictState({ kind: "error", msg: `The verdict request failed (${r.status}).` });
          return;
        }
        const j = (await r.json()) as { data: VerdictData | null };
        setVerdictState({ kind: "ok", data: j.data });
      })
      .catch(() => {
        if (live) setVerdictState({ kind: "error", msg: "The verdict request did not complete." });
      });

    fetch(`/api/admin/stock-context?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!live) return;
        if (!r.ok) {
          setContextState({ kind: "error" });
          return;
        }
        const j = await r.json();
        setContextState({ kind: "ok", news: j.news ?? [], filings: j.filings ?? [] });
      })
      .catch(() => {
        if (live) setContextState({ kind: "error" });
      });

    fetch(`/api/admin/stock-meta?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!live) return;
        if (!r.ok) {
          setMetaState({ kind: "error" });
          return;
        }
        setMetaState({ kind: "ok", meta: (await r.json()) as StockMeta });
      })
      .catch(() => {
        if (live) setMetaState({ kind: "error" });
      });

    return () => {
      live = false;
    };
  }, [symbol]);

  const toggleInspected = useCallback((sym: string) => {
    setInspected((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      try {
        localStorage.setItem(INSPECTED_KEY, JSON.stringify([...next]));
      } catch {
        // localStorage can be unavailable (private mode, quota) — inspected
        // marks are a convenience, not data, so fail silently.
      }
      return next;
    });
  }, []);

  const toggleMark = useCallback(() => {
    setMark((prev) => {
      const next = prev === symbol ? null : symbol;
      try {
        if (next) localStorage.setItem(BOOKMARK_KEY, next);
        else localStorage.removeItem(BOOKMARK_KEY);
      } catch {
        // Same as above — not worth surfacing an error for a convenience flag.
      }
      return next;
    });
  }, [symbol]);

  // Scope + cluster only — the base pool the WATCH dropdown's per-section
  // counts read from, computed BEFORE actionFilter/watchFilter/reviewFilter
  // so the dropdown always shows "how many in this scope/cluster", not "how
  // many after I've already filtered to watch".
  const scopePool = useMemo(() => {
    if (queueState.kind !== "ok") return [];
    let rows = queueState.q.entries;
    if (scope === "nifty500") rows = rows.filter((e) => e.isNifty500);
    else if (scope === "watchlist") rows = rows.filter((e) => e.isWatchlist);
    else if (scope === "portfolio") rows = rows.filter((e) => e.isPortfolio || e.isHolding);
    else if (scope === "archived") rows = rows.filter((e) => e.bucket === "dormant");
    else if (scope === "inspected") rows = rows.filter((e) => inspected.has(e.symbol));
    if (selectedCluster) rows = rows.filter((e) => e.cluster_id === selectedCluster);
    return rows;
  }, [queueState, scope, inspected, selectedCluster]);

  // Scope (All Active / Watchlist / Portfolio / Archived / Inspected), the
  // action-count tabs and the WATCH sub-category dropdown, applied before
  // search and the tree grouping. "Archived" mirrors the Board's dormant
  // bucket — a symbol no longer on the watchlist or in the portfolio.
  const scoped = useMemo(() => {
    let rows = scopePool;
    if (actionFilter) rows = rows.filter((e) => actionMatchesFilter(e.action, actionFilter));
    if (actionFilter === "watch" && watchFilter !== "all") {
      if (watchFilter === "near_entry") {
        rows = rows.filter((e) => e.ltp != null && e.buyBelow != null && e.buyBelow > 0 && e.ltp <= e.buyBelow * 1.05);
      } else if (watchFilter === "high_upside") {
        rows = rows.filter((e) => e.upsidePct != null && e.upsidePct >= 20);
      } else {
        rows = rows.filter((e) => getWatchSubtype(e).key === watchFilter);
      }
    }
    if (reviewFilter === "pending") rows = rows.filter((e) => e.bucket === "missing");
    else if (reviewFilter === "due") rows = rows.filter((e) => e.bucket === "due");
    else if (reviewFilter === "changed") rows = rows.filter((e) => e.hasActionChanged);
    return rows;
  }, [scopePool, actionFilter, watchFilter, reviewFilter]);

  // q.counts is the exact per-entry bucket tally (every tracked symbol gets
  // one entry — see lib/verdict.ts), so "pending"/"needs review" read off it
  // directly rather than recomputing. summary.pendingCount is the same number
  // by construction; counts.missing is what the click-filter above matches
  // against, so the bar shows the one it filters by.
  const needsReview = queueState.kind === "ok" ? queueState.q.counts.due : 0;
  const pendingCount = queueState.kind === "ok" ? queueState.q.counts.missing : 0;
  const changedCount = queueState.kind === "ok" ? queueState.q.summary.changedCount : 0;

  const scopeCounts = useMemo(() => {
    if (queueState.kind !== "ok")
      return { nifty500: 0, all: 0, watchlist: 0, portfolio: 0, archived: 0, inspected: 0 };
    const all = queueState.q.entries;
    return {
      nifty500: all.filter((e) => e.isNifty500).length,
      all: all.length,
      watchlist: all.filter((e) => e.isWatchlist).length,
      portfolio: all.filter((e) => e.isPortfolio || e.isHolding).length,
      archived: all.filter((e) => e.bucket === "dormant").length,
      inspected: all.filter((e) => inspected.has(e.symbol)).length,
    };
  }, [queueState, inspected]);

  // All ~79 clusters, same list the Board's dropdown reads (q.clusterProgress
  // is in the same /api/admin/verdict?queue=1 payload this page already
  // fetches), optionally narrowed by the dropdown's own search box.
  const clusters = queueState.kind === "ok" ? queueState.q.clusterProgress : [];
  const clusterMenuOptions = useMemo(() => {
    const needle = clusterMenuSearch.trim().toLowerCase();
    if (!needle) return clusters;
    return clusters.filter(
      (c) => c.clusterName.toLowerCase().includes(needle) || c.clusterId.toLowerCase().includes(needle),
    );
  }, [clusters, clusterMenuSearch]);
  const activeClusterObj = clusters.find((c) => c.clusterId === selectedCluster) ?? null;

  // Per-section counts for the WATCH dropdown, over scopePool (current
  // scope + cluster, same pool the WATCH button's own count reads from via
  // actionMatchesFilter) — not the full queue, so the dropdown's numbers
  // match what clicking "All Watch" would actually select here.
  const watchCounts = useMemo(() => {
    const res = { all: 0, near_entry: 0, high_upside: 0, cashflow: 0, roce: 0, pullback: 0, turnaround: 0, risk: 0 };
    for (const e of scopePool) {
      if (!actionMatchesFilter(e.action, "watch")) continue;
      res.all++;
      if (e.ltp != null && e.buyBelow != null && e.buyBelow > 0 && e.ltp <= e.buyBelow * 1.05) res.near_entry++;
      if (e.upsidePct != null && e.upsidePct >= 20) res.high_upside++;
      const sub = getWatchSubtype(e).key;
      if (sub === "cashflow") res.cashflow++;
      else if (sub === "roce") res.roce++;
      else if (sub === "pullback") res.pullback++;
      else if (sub === "risk") res.risk++;
      else res.turnaround++;
    }
    return res;
  }, [scopePool]);

  // Real ~9-sector taxonomy (app.meta_cluster), resolved two ways: by
  // cluster_id via clusterMap for entries that carry one (every live/tracked
  // stock), or by symbol via symbolMap for the ones that don't (dormant
  // entries — lib/verdict.ts hard-codes their cluster_id to null). Only
  // falls back to the noisy app.universe.sector/industry fields for the ~3
  // symbols app.cluster_assignment itself has no row for.
  const realSector = useCallback(
    (e: QueueEntry): string => {
      const byCluster = e.cluster_id ? clusterMap.get(e.cluster_id) : undefined;
      const bySym = symbolMap.get(e.symbol)?.sector_name;
      return byCluster ?? bySym ?? e.sector ?? "Unclassified";
    },
    [clusterMap, symbolMap],
  );
  const realIndustry = useCallback(
    (e: QueueEntry): string => {
      const bySym = symbolMap.get(e.symbol)?.cluster_name;
      return e.cluster_name ?? bySym ?? e.industry ?? "Unclassified";
    },
    [symbolMap],
  );

  const tree = useMemo(() => {
    const needle = treeSearch.trim().toUpperCase();
    const rows = scoped.filter((e) => {
      if (!needle) return true;
      return (
        e.symbol.toUpperCase().includes(needle) ||
        (e.company_name ?? "").toUpperCase().includes(needle)
      );
    });
    const bySector = new Map<string, Map<string, QueueEntry[]>>();
    for (const e of rows) {
      const sector = realSector(e);
      const industry = realIndustry(e);
      if (!bySector.has(sector)) bySector.set(sector, new Map());
      const byIndustry = bySector.get(sector)!;
      const list = byIndustry.get(industry);
      if (list) list.push(e);
      else byIndustry.set(industry, [e]);
    }
    return [...bySector.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([sector, byIndustry]) => ({
        sector,
        count: [...byIndustry.values()].reduce((s, l) => s + l.length, 0),
        industries: [...byIndustry.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([industry, entries]) => ({
            industry,
            entries: [...entries].sort((a, b) => a.symbol.localeCompare(b.symbol)),
          })),
      }));
  }, [scoped, treeSearch, realSector, realIndustry]);

  // Flat, tree-order list of symbols currently visible — what Prev/Next, Home
  // and the arrow keys walk, and what the "N / total" counter counts against.
  const flatOrder = useMemo(
    () => tree.flatMap((s) => s.industries.flatMap((i) => i.entries.map((e) => e.symbol))),
    [tree],
  );

  // Pin the very first selection to the tree's first sector-cluster / first
  // stock within it, not queue order. Waits for mapsReady so the tree is
  // already sorted by the real ~9-sector taxonomy before picking "first".
  useEffect(() => {
    if (symbol) return;
    if (!mapsReady) return;
    if (flatOrder.length === 0) return;
    setSymbol(flatOrder[0]);
  }, [symbol, mapsReady, flatOrder]);

  // Switching scope (e.g. clicking "Nifty 500") or picking a cluster from the
  // dropdown jumps to the new view's first stock in tree order, same rule as
  // the initial pin above — selecting a view should show its own first
  // stock, not whatever was selected in the previous view.
  const prevScopeRef = useRef(scope);
  const prevClusterRef = useRef(selectedCluster);
  useEffect(() => {
    const scopeChanged = prevScopeRef.current !== scope;
    const clusterChanged = prevClusterRef.current !== selectedCluster;
    prevScopeRef.current = scope;
    prevClusterRef.current = selectedCluster;
    if (!scopeChanged && !clusterChanged) return;
    if (flatOrder.length > 0) setSymbol(flatOrder[0]);
  }, [scope, selectedCluster, flatOrder]);

  const toggleNode = useCallback((key: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Every node key in the current tree — sector names plus "sector//industry"
  // pairs — for the Expand all / Collapse all toggle below.
  const allNodeKeys = useMemo(
    () => tree.flatMap((s) => [s.sector, ...s.industries.map((i) => `${s.sector}//${i.industry}`)]),
    [tree],
  );
  const allExpanded = allNodeKeys.length > 0 && allNodeKeys.every((k) => expandedNodes.has(k));
  const toggleAllNodes = useCallback(() => {
    setExpandedNodes(allExpanded ? new Set() : new Set(allNodeKeys));
  }, [allExpanded, allNodeKeys]);

  // Open the sector (and industry) containing a search hit or the selected
  // stock, so neither lands on a tree that still looks collapsed around it.
  // Also closes whichever sector/industry THIS effect auto-opened for the
  // previous stock, if the new stock is in a different one — otherwise
  // paging through Prev/Next left every cluster you'd ever visited open
  // forever. Only the auto-opened node is closed; anything the user opened
  // by hand (a sector they clicked themselves) is left alone.
  const autoOpenedRef = useRef<{ sector: string | null; industryKey: string | null }>({
    sector: null,
    industryKey: null,
  });
  useEffect(() => {
    if (tree.length === 0) return;
    if (treeSearch.trim()) return; // searching force-opens every node in the render below
    const withSelected = symbol
      ? tree.find((s) => s.industries.some((i) => i.entries.some((e) => e.symbol === symbol)))
      : null;
    if (!withSelected) return;
    const ind = withSelected.industries.find((i) => i.entries.some((e) => e.symbol === symbol));
    const newSector = withSelected.sector;
    const newIndustryKey = ind ? `${newSector}//${ind.industry}` : null;
    const prevAuto = autoOpenedRef.current;

    if (prevAuto.sector === newSector && prevAuto.industryKey === newIndustryKey) {
      return; // same cluster as last time — nothing to open or close
    }

    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (prevAuto.sector && prevAuto.sector !== newSector) {
        // Different sector-cluster: close the whole previous branch.
        next.delete(prevAuto.sector);
        if (prevAuto.industryKey) next.delete(prevAuto.industryKey);
      } else if (prevAuto.industryKey && prevAuto.industryKey !== newIndustryKey) {
        // Same sector, different industry within it: close just the old industry.
        next.delete(prevAuto.industryKey);
      }
      next.add(newSector);
      if (newIndustryKey) next.add(newIndustryKey);
      return next;
    });
    autoOpenedRef.current = { sector: newSector, industryKey: newIndustryKey };
    // Only re-run when the selected symbol or the tree shape changes — not on
    // every expandedNodes write, which would fight the user's own clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tree]);

  const rotate = useCallback(
    (dir: 1 | -1) => {
      if (flatOrder.length === 0) return;
      const cur = symbol ? flatOrder.indexOf(symbol) : -1;
      const next = ((cur === -1 ? 0 : cur + dir) + flatOrder.length) % flatOrder.length;
      setSymbol(flatOrder[next]);
    },
    [flatOrder, symbol],
  );
  const rotateRef = useRef(rotate);
  rotateRef.current = rotate;

  const goFirst = useCallback(() => {
    if (flatOrder.length > 0) setSymbol(flatOrder[0]);
  }, [flatOrder]);

  const goMark = useCallback(() => {
    if (mark && flatOrder.includes(mark)) setSymbol(mark);
  }, [mark, flatOrder]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        rotateRef.current(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        rotateRef.current(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (queueState.kind === "loading") {
    return <div className="h-[400px] rounded-md border hairline animate-pulse" />;
  }
  if (queueState.kind === "error") {
    return <p className="text-[13px] text-rose-700 py-4">{queueState.msg}</p>;
  }

  const q = queueState.q;
  const selected = q.entries.find((e) => e.symbol === symbol) ?? null;
  const posInOrder = symbol ? flatOrder.indexOf(symbol) : -1;
  const ac = q.summary.actionCounts;
  const meta = metaState.kind === "ok" ? metaState.meta : null;
  const isInspected = !!symbol && inspected.has(symbol);
  const isMarked = !!mark && mark === symbol;

  return (
    <div>
      {/* ── Top bar: completion + action counts. Each count is a filter tab —
          click BUY to see only buy calls in the tree, click again to clear. ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] rounded-md border hairline px-3 py-1.5 mb-2">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="font-semibold">Completion:</span>
          <span className="font-mono">
            {q.summary.completedCount.toLocaleString("en-IN")} / {q.summary.totalUniverse.toLocaleString("en-IN")}
          </span>
          <span className="font-mono text-emerald-700 font-semibold">
            ({q.summary.completedPercent.toFixed(1)}%)
          </span>
        </span>
        {(
          [
            ["pending", "Pending", pendingCount, "text-amber-700"],
            ["due", "Needs review", needsReview, "text-orange-700"],
            ["changed", "Changed", changedCount, "text-indigo-700"],
          ] as const
        ).map(([key, label, count, tone]) => (
          <button
            key={key}
            onClick={() => setReviewFilter(reviewFilter === key ? null : key)}
            className={`muted-text rounded px-1 py-[1px] ${
              reviewFilter === key ? "bg-slate-800 !text-white !opacity-100" : "hover:bg-[var(--color-paper)]"
            }`}
            title={`Show only ${label.toLowerCase()} stocks`}
          >
            {label} <span className={`font-mono ${reviewFilter === key ? "" : tone}`}>{count}</span>
          </button>
        ))}
        {reviewFilter && (
          <button onClick={() => setReviewFilter(null)} className="muted-text underline text-[10.5px]">
            clear
          </button>
        )}
        <span className="h-3 w-px bg-[var(--color-border-default)]" />
        {(
          [
            ["buy", "BUY", ac.buy, "text-emerald-700"],
            ["accumulate", "ACCUMULATE", ac.accumulate, "text-emerald-600"],
            ["hold", "HOLD", ac.hold, "text-slate-600"],
            ["avoid", "REDUCE & AVOID", ac.avoid + ac.sell, "text-rose-700"],
          ] as const
        ).map(([key, label, count, tone]) => (
          <button
            key={key}
            onClick={() => setActionFilter(actionFilter === key ? null : key)}
            className={`font-semibold rounded px-1.5 py-[1px] ${tone} ${
              actionFilter === key ? "bg-slate-800 !text-white" : "hover:bg-[var(--color-paper)]"
            }`}
            title={`Show only ${label} calls`}
          >
            {label} {count}
          </button>
        ))}

        {/* ── WATCH as a dropdown of sub-sections, ported from the Board
            tab's inline breakdown bar — click opens a menu of Near Buy
            Zone / ≥20% Upside / the five thesis-reason buckets instead of
            one flat WATCH count. ──────────────────────────────────────── */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setWatchMenuOpen((o) => !o)}
            className={`font-semibold rounded px-1.5 py-[1px] flex items-center gap-1 ${
              actionFilter === "watch" ? "bg-slate-800 !text-white" : "text-amber-600 hover:bg-[var(--color-paper)]"
            }`}
            title="WATCH — choose a sub-category"
          >
            <span>
              {actionFilter === "watch" && watchFilter !== "all"
                ? `WATCH · ${WATCH_FILTER_LABEL[watchFilter]}`
                : `WATCH ${ac.watch}`}
            </span>
            <span className="text-[9px]">{watchMenuOpen ? "▲" : "▼"}</span>
          </button>
          {watchMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setWatchMenuOpen(false)} />
              <div className="absolute z-20 mt-1 left-0 w-64 rounded-md border hairline bg-[var(--color-paper)] shadow-lg p-1">
                {(
                  [
                    ["all", "All Watch", watchCounts.all, "bg-amber-600 text-white", "text-slate-700"],
                    ["near_entry", "🎯 Near Buy Zone", watchCounts.near_entry, "bg-emerald-700 text-white", "text-emerald-800"],
                    ["high_upside", "🚀 ≥20% Upside", watchCounts.high_upside, "bg-teal-700 text-white", "text-teal-800"],
                    ["cashflow", "💵 Cash Flow Proof", watchCounts.cashflow, "bg-blue-700 text-white", "text-blue-800"],
                    ["roce", "⚙️ Capital Efficiency", watchCounts.roce, "bg-purple-700 text-white", "text-purple-800"],
                    ["pullback", "🏷️ Valuation Pullback", watchCounts.pullback, "bg-amber-600 text-white", "text-amber-800"],
                    ["turnaround", "📈 Margin Turnaround", watchCounts.turnaround, "bg-teal-700 text-white", "text-teal-800"],
                    ["risk", "⚠️ Governance / Risk", watchCounts.risk, "bg-rose-700 text-white", "text-rose-800"],
                  ] as const
                ).map(([key, label, count, activeClass, inactiveClass]) => {
                  const isActive = actionFilter === "watch" && watchFilter === key;
                  if (key !== "all" && count === 0) return null;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setActionFilter("watch");
                        setWatchFilter(key);
                        setWatchMenuOpen(false);
                      }}
                      className={`w-full text-left px-2 py-1 rounded text-[11.5px] font-medium flex items-center justify-between gap-2 mb-0.5 ${
                        isActive ? activeClass : `hover:bg-[var(--color-border-default)] ${inactiveClass}`
                      }`}
                    >
                      <span>{label}</span>
                      <span className={`font-mono text-[10px] ${isActive ? "" : "muted-text"}`}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {actionFilter && (
          <button
            onClick={() => {
              setActionFilter(null);
              setWatchFilter("all");
            }}
            className="muted-text underline text-[10.5px]"
          >
            clear
          </button>
        )}
      </div>

      {/* ── Scope tabs ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        {(
          [
            ["watchlist", `Watchlist (${scopeCounts.watchlist})`],
            ["nifty500", `Nifty 500 (${scopeCounts.nifty500})`],
            ["all", `All Active (${scopeCounts.all})`],
            ["portfolio", `Portfolio (${scopeCounts.portfolio})`],
            ["inspected", `Inspected (${scopeCounts.inspected})`],
            ["archived", `Archived (${scopeCounts.archived})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setScope(key as Scope)}
            className={`px-2 py-[3px] text-[11px] rounded-md border ${
              scope === key
                ? "bg-slate-800 text-white border-slate-800"
                : "hairline hover:bg-[var(--color-paper)]"
            }`}
          >
            {label}
          </button>
        ))}

        <span className="h-3 w-px bg-[var(--color-border-default)] mx-1" />

        {/* ── Cluster filter — ported from the Board tab. Click opens a
            dropdown of all clusters; picking one filters the tree to that
            cluster_id, same key the Board filters by. ────────────────── */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setClusterMenuOpen((o) => !o)}
            className={`px-2 py-[3px] text-[11px] rounded-md border flex items-center gap-1 ${
              selectedCluster
                ? "bg-slate-800 text-white border-slate-800"
                : "hairline hover:bg-[var(--color-paper)]"
            }`}
          >
            <span>
              {activeClusterObj ? `#${activeClusterObj.clusterIndex} ${activeClusterObj.clusterName}` : `Clusters (${clusters.length})`}
            </span>
            <span className="text-[9px]">{clusterMenuOpen ? "▲" : "▼"}</span>
          </button>
          {clusterMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setClusterMenuOpen(false)} />
              <div className="absolute z-20 mt-1 left-0 w-80 max-h-96 overflow-hidden flex flex-col rounded-md border hairline bg-[var(--color-paper)] shadow-lg">
                <div className="p-2 border-b hairline flex items-center gap-2 shrink-0">
                  <input
                    autoFocus
                    value={clusterMenuSearch}
                    onChange={(e) => setClusterMenuSearch(e.target.value)}
                    placeholder="Find a cluster…"
                    className="flex-1 px-2 py-1 text-[12px] rounded-md border hairline bg-transparent"
                  />
                  {selectedCluster && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCluster(null);
                        setClusterMenuOpen(false);
                      }}
                      className="text-[10.5px] text-rose-600 hover:text-rose-800 font-medium shrink-0"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="overflow-y-auto p-1">
                  {clusterMenuOptions.length === 0 ? (
                    <p className="muted-text text-[11px] py-2 px-1.5">No match.</p>
                  ) : (
                    clusterMenuOptions.map((c) => {
                      const isSelected = selectedCluster === c.clusterId;
                      return (
                        <button
                          key={c.clusterId}
                          type="button"
                          onClick={() => {
                            setSelectedCluster(isSelected ? null : c.clusterId);
                            setClusterMenuOpen(false);
                          }}
                          className={`w-full text-left px-1.5 py-1 rounded text-[11.5px] flex items-center justify-between gap-2 ${
                            isSelected ? "bg-slate-800 text-white" : "hover:bg-[var(--color-border-default)]"
                          }`}
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`text-[9.5px] font-mono shrink-0 px-1 rounded ${
                                isSelected ? "bg-white/20" : "muted-text bg-[var(--color-border-default)]"
                              }`}
                            >
                              #{c.clusterIndex}
                            </span>
                            <span className="truncate">{c.clusterName}</span>
                          </span>
                          <span className={`font-mono text-[10px] shrink-0 ${isSelected ? "" : "muted-text"}`}>
                            {c.completedStocks}/{c.totalStocks}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_280px] gap-3 items-start">
        {/* ── Tree: sector → industry → stock, action badge per stock ────
            Same disclosure pattern as the watchlist's own rail — every
            sector/industry can be open at once, not one accordion slot. ── */}
        <div className="rounded-md border hairline lg:sticky lg:top-3 lg:max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
          <div className="px-2 py-1.5 border-b hairline flex items-center justify-between gap-2 shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wide muted-text">
              Sectors &amp; industries
            </span>
            <span className="text-[10px] muted-text tabular-nums">
              {tree.length} · {tree.reduce((n, s) => n + s.industries.length, 0)}
            </span>
          </div>
          <div className="p-2 border-b hairline shrink-0">
            <input
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
              placeholder="Find a stock or industry"
              className="w-full px-2 py-1 text-[12px] rounded-md border hairline bg-transparent"
            />
          </div>
          <div className="px-2 py-1 border-b hairline shrink-0 flex justify-end">
            <button
              type="button"
              onClick={toggleAllNodes}
              disabled={!!treeSearch.trim() || allNodeKeys.length === 0}
              className="inline-flex items-center gap-1 px-1.5 py-[3px] rounded text-[10.5px] muted-text hover:text-[var(--color-ink)] hover:bg-[var(--color-paper)] disabled:opacity-40"
              title={treeSearch.trim() ? "Clear search to collapse" : allExpanded ? "Collapse every sector" : "Expand every sector"}
            >
              <span aria-hidden className="text-[9px]">{allExpanded ? "⊟" : "⊞"}</span>
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          </div>
          <div className="overflow-y-auto flex-1 min-h-0 p-1">
            {tree.length === 0 ? (
              <p className="muted-text text-[11px] py-2 px-1">No match.</p>
            ) : (
              tree.map((s) => {
                const secOpen = !!treeSearch.trim() || expandedNodes.has(s.sector);
                return (
                  <div key={s.sector} className="mb-0.5">
                    <button
                      onClick={() => toggleNode(s.sector)}
                      className="w-full flex items-center gap-1.5 text-left px-1 py-1 text-[11.5px] font-semibold rounded hover:bg-[var(--color-paper)]"
                      aria-expanded={secOpen}
                    >
                      <Chevron open={secOpen} />
                      <span className="truncate flex-1">{s.sector}</span>
                      <span className="muted-text tabular-nums text-[10px] shrink-0 ml-1">
                        {s.count}
                      </span>
                    </button>
                    {secOpen && (
                      <div className="pl-2 border-l hairline ml-2.5">
                        {s.industries.map((ind) => {
                          const indKey = `${s.sector}//${ind.industry}`;
                          const indOpen = !!treeSearch.trim() || expandedNodes.has(indKey);
                          return (
                            <div key={ind.industry} className="mt-0.5">
                              <button
                                onClick={() => toggleNode(indKey)}
                                className="w-full flex items-center gap-1 text-left px-1 py-0.5 rounded hover:bg-[var(--color-paper)]"
                                aria-expanded={indOpen}
                              >
                                <Chevron open={indOpen} small />
                                <span className="muted-text text-[10px] uppercase tracking-wide truncate flex-1">
                                  {ind.industry}
                                </span>
                                <span className="muted-text tabular-nums text-[9.5px] shrink-0">
                                  {ind.entries.length}
                                </span>
                              </button>
                              {indOpen &&
                                ind.entries.map((e) => (
                                  <button
                                    key={e.symbol}
                                    onClick={() => setSymbol(e.symbol)}
                                    className={`w-full flex items-center justify-between gap-1 text-left px-1.5 py-[3px] text-[11.5px] rounded font-mono ${
                                      symbol === e.symbol
                                        ? "bg-slate-800 text-white"
                                        : "hover:bg-[var(--color-paper)]"
                                    }`}
                                  >
                                    <span className="flex items-center gap-1 min-w-0">
                                      {inspected.has(e.symbol) && (
                                        <CheckCircle2 size={10} className="shrink-0 text-emerald-500" />
                                      )}
                                      <span className="truncate">{e.symbol}</span>
                                    </span>
                                    <span
                                      className={`shrink-0 px-1 rounded text-[9px] font-sans font-semibold tracking-wide ${
                                        symbol === e.symbol ? "bg-white/20 text-white" : actionClass(e.action)
                                      }`}
                                      title={
                                        e.hasActionChanged && e.prevAction
                                          ? `${e.action ?? "No verdict yet"} (was ${e.prevAction})`
                                          : e.action ?? "No verdict yet"
                                      }
                                    >
                                      {actionShort(e.action)}
                                      {e.hasActionChanged && <sup className="text-[7px] ml-[1px]">•</sup>}
                                    </span>
                                  </button>
                                ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Stock header, nav strip, map (price chart), verdict below ── */}
        <div className="min-w-0">
          {!symbol ? (
            <p className="muted-text text-[12.5px] py-6 text-center">Pick a stock from the tree.</p>
          ) : (
            <>
              {/* Nav strip */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-[11px]">
                <span className="muted-text flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                  <span className="shrink-0 tabular-nums">
                    {posInOrder >= 0 ? posInOrder + 1 : "—"} / {flatOrder.length}
                  </span>
                  <span className="hidden sm:inline opacity-70 shrink-0">· use ← → keys</span>
                  {selected && (
                    <span className="truncate">
                      {realSector(selected)} · {realIndustry(selected)}
                    </span>
                  )}
                  {meta?.scores_snapshot_date && (
                    <span
                      className="hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border hairline shrink-0"
                      title="Scoring snapshot date (Q/V/M percentiles)."
                    >
                      <span className="opacity-70">Scores</span>
                      <span className="font-medium">{formatSnapshotDate(meta.scores_snapshot_date)}</span>
                    </span>
                  )}
                  <span className="shrink-0 tabular-nums">
                    <span className="font-semibold text-[12.5px] text-[var(--color-accent-600,inherit)]">
                      {scopeCounts.watchlist}
                    </span>{" "}
                    stocks on your watchlist
                  </span>
                </span>
                <div className="inline-flex rounded-md border hairline overflow-hidden shrink-0">
                  <button
                    onClick={goFirst}
                    disabled={flatOrder.length === 0 || symbol === flatOrder[0]}
                    className="px-2 py-[3px] hover:bg-[var(--color-paper)] disabled:opacity-40"
                    title="First stock in this list"
                    aria-label="First stock"
                  >
                    <Home size={12} className="inline-block align-[-2px]" />
                  </button>
                  <button
                    onClick={toggleMark}
                    disabled={!symbol}
                    className={`px-2 py-[3px] border-l hairline hover:bg-[var(--color-paper)] disabled:opacity-40 ${
                      isMarked ? "text-amber-600" : ""
                    }`}
                    aria-pressed={isMarked}
                    title={isMarked ? `${symbol} is bookmarked — click to clear` : `Bookmark ${symbol}`}
                  >
                    {isMarked ? (
                      <BookmarkCheck size={12} className="inline-block align-[-2px]" />
                    ) : (
                      <Bookmark size={12} className="inline-block align-[-2px]" />
                    )}
                  </button>
                  {mark && !isMarked && (
                    <button
                      onClick={goMark}
                      className="px-2 py-[3px] border-l hairline hover:bg-[var(--color-paper)] text-amber-600 font-mono"
                      title={`Go to bookmarked stock (${mark})`}
                    >
                      {mark}
                    </button>
                  )}
                  <button
                    onClick={() => toggleInspected(symbol)}
                    className={`px-2 py-[3px] border-l hairline hover:bg-[var(--color-paper)] flex items-center gap-1 ${
                      isInspected ? "text-emerald-600" : ""
                    }`}
                    title={isInspected ? `${symbol} marked inspected — click to clear` : `Mark ${symbol} inspected`}
                  >
                    {isInspected ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                    <span className="hidden sm:inline">Inspected</span>
                  </button>
                  <button
                    onClick={() => rotate(-1)}
                    disabled={flatOrder.length < 2}
                    className="px-2 py-[3px] border-l hairline hover:bg-[var(--color-paper)] disabled:opacity-40"
                  >
                    ‹ Prev
                  </button>
                  <button
                    onClick={() => rotate(1)}
                    disabled={flatOrder.length < 2}
                    className="px-2 py-[3px] border-l hairline hover:bg-[var(--color-paper)] disabled:opacity-40"
                  >
                    Next ›
                  </button>
                </div>
              </div>

              {/* Stock header */}
              <div className="rounded-md border hairline px-3 py-2 mb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold text-[14px]">{symbol}</span>
                  {selected?.company_name && (
                    <span className="muted-text text-[12px]">{selected.company_name}</span>
                  )}
                  {selected?.action && (
                    <span className={`px-1.5 py-[1px] rounded text-[10px] font-semibold ${actionClass(selected.action)}`}>
                      {selected.action}
                    </span>
                  )}
                  {/* Changed-action badge: the "Changed" count/filter above
                      already flags which symbols flipped, but gave no way to
                      see FROM what — so a HOLD→BUY looked the same as any
                      other BUY. prevAction/hasActionChanged are already
                      computed in loadVerdictQueue (lib/verdict.ts); this is
                      the first place they're rendered. */}
                  {selected?.hasActionChanged && selected.prevAction && (
                    <span
                      className="px-1.5 py-[1px] rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200"
                      title={`Previous verdict: ${selected.prevVerdict ?? selected.prevAction}${
                        selected.prevGeneratedAt ? ` (written ${shortDate(selected.prevGeneratedAt)})` : ""
                      }`}
                    >
                      was {selected.prevAction}
                    </span>
                  )}
                  {meta?.current_price != null && (
                    <IntradayPriceBadge
                      price={meta.current_price}
                      fetchedAt={meta.price_fetched_at}
                      className="text-[13px] font-semibold"
                    />
                  )}
                  {meta?.ret_1d != null && (
                    <span className={`font-mono text-[11px] ${meta.ret_1d >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      1D: {pct(meta.ret_1d)}
                    </span>
                  )}
                  {meta?.maturity_tier && (
                    <span className="px-1.5 py-[1px] rounded text-[10px] border hairline">
                      {tierLabel(meta.maturity_tier)}
                    </span>
                  )}
                  {meta?.market_cap_category && (
                    <CapTierBadge
                      category={meta.market_cap_category}
                      listingDate={meta.listing_date}
                      textClass="text-[10px]"
                    />
                  )}
                  {selected?.confidence && (
                    <span className="muted-text text-[10px] uppercase">{selected.confidence} confidence</span>
                  )}
                </div>
                <div className="muted-text text-[11px] mt-0.5">
                  {selected ? realSector(selected) : "Unclassified"} ·{" "}
                  {selected ? realIndustry(selected) : "Unclassified"}
                </div>
                {/* LTP + target / buy-below / bear-floor / upside / called —
                    one line, one box: "the call" plus what the market is
                    doing with it right now, read together. */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] mt-1.5 rounded-md border hairline bg-[var(--color-paper)] px-2.5 py-1.5">
                  <span>
                    <span className="text-slate-600 font-medium">LTP </span>
                    <span className="font-mono font-semibold text-slate-900">{money(selected?.ltp ?? null)}</span>
                    {selected?.pctMove != null && (
                      <span className={`font-mono ml-1 ${selected.pctMove >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {pct(selected.pctMove)} since call
                      </span>
                    )}
                  </span>
                  <span>
                    <span className="text-slate-600 font-medium">Target </span>
                    <span className="font-mono font-semibold text-indigo-700">{money(selected?.targetPrice ?? null)}</span>
                  </span>
                  <span>
                    <span className="text-slate-600 font-medium">Buy below </span>
                    <span className="font-mono font-semibold text-emerald-700">{money(selected?.buyBelow ?? null)}</span>
                  </span>
                  <span>
                    <span className="text-slate-600 font-medium">Bear floor </span>
                    <span className="font-mono font-semibold text-rose-700">{money(selected?.bearFloor ?? null)}</span>
                  </span>
                  {selected?.upsidePct != null && (
                    <span>
                      <span className="text-slate-600 font-medium">Upside </span>
                      <span
                        className={`font-mono font-semibold ${selected.upsidePct >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                      >
                        {pct(selected.upsidePct)}
                      </span>
                    </span>
                  )}
                  {selected?.generated_at && (
                    <span className="text-slate-600 font-medium">
                      Called <span className="text-slate-800 font-mono">{shortDate(selected.generated_at)}</span>
                    </span>
                  )}
                </div>

                {/* Drift warning / staleness note — ported from the Board
                    tab's row-level text (VerdictQueueClient.tsx:1418-1428).
                    Drift takes priority: a verdict whose own evidence has
                    moved is untrustworthy regardless of age, so the age-only
                    note only shows when nothing has actually moved. */}
                {selected && selected.movedCount > 0 && (
                  <div className="text-[11px] text-rose-600 font-medium mt-1.5 flex items-center gap-1">
                    <span>⚠️</span>
                    <span>{selected.movedCount} key metric{selected.movedCount === 1 ? "" : "s"} shifted since writing</span>
                  </div>
                )}
                {selected && selected.movedCount === 0 && selected.ageDays != null && selected.ageDays > STALE_DAYS && (
                  <div className="text-[11px] text-amber-700 font-medium mt-1.5">
                    Review window open ({selected.ageDays}d old)
                  </div>
                )}

                {/* Held quantity — only for stocks actually in the portfolio,
                    from /api/admin/portfolio-positions (loadHeldPositions()). */}
                {symbol && (selected?.isPortfolio || selected?.isHolding) && positions[symbol] && (
                  <div className="text-[11.5px] mt-1.5">
                    <span className="muted-text">Held </span>
                    <span className="font-mono font-semibold">
                      {positions[symbol].qty.toLocaleString("en-IN")} sh
                    </span>
                    {positions[symbol].avgCost != null && (
                      <span className="muted-text ml-1">
                        @ avg {money(positions[symbol].avgCost)}
                      </span>
                    )}
                    {selected?.ltp != null && (
                      <span className="font-mono ml-2">
                        Value {money(positions[symbol].qty * selected.ltp)}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Map (price chart) */}
              <div className="rounded-md border hairline overflow-hidden mb-3">
                <PriceChart symbol={symbol} trades={symbol ? tradesBySymbol[symbol.toUpperCase()] : undefined} />
              </div>

              {/* Verdict: operating review, target price detail, quant models */}
              {verdictState.kind === "loading" && (
                <div className="h-[300px] rounded-md border hairline animate-pulse" />
              )}
              {verdictState.kind === "error" && (
                <p className="text-[13px] text-rose-700 py-4">{verdictState.msg}</p>
              )}
              {verdictState.kind === "ok" && verdictState.data == null && (
                <VerdictEmpty symbol={symbol} />
              )}
              {verdictState.kind === "ok" && verdictState.data != null && (
                <VerdictPanel symbol={symbol} data={verdictState.data} hideAccumulationBox />
              )}
            </>
          )}
        </div>

        {/* ── News, far right. Filings deliberately dropped per feedback —
            this column is news-only now; /api/admin/stock-context still
            returns filings too, just unused here. ────────────────────── */}
        <div className="rounded-md border hairline p-2 lg:sticky lg:top-3 lg:max-h-[calc(100vh-2rem)] overflow-y-auto">
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5">
            {symbol ? `News · ${symbol}` : "News"}
          </div>
          {!symbol ? (
            <p className="muted-text text-[11px]">Pick a stock to see its feed.</p>
          ) : contextState.kind === "loading" || contextState.kind === "idle" ? (
            <div className="space-y-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-[14px] rounded bg-[var(--color-border-default)] opacity-40 animate-pulse" />
              ))}
            </div>
          ) : contextState.kind === "error" ? (
            <p className="muted-text text-[11px]">Could not load news.</p>
          ) : (
            <>
              <div className="muted-text text-[9.5px] uppercase tracking-wide mb-1">
                News ({contextState.news.length})
              </div>
              {contextState.news.length === 0 ? (
                <p className="muted-text text-[10px]">No news in the last 6 months.</p>
              ) : (
                <ul className="space-y-0">
                  {contextState.news.slice(0, 15).map((n, i) => (
                    // Alternating shade (even rows only) so adjacent headlines
                    // don't visually run together in this dense, unbordered list.
                    // NOT --color-paper: this panel sits directly on the page's
                    // own --color-paper background (it never set its own white
                    // card bg), so shading with the same token painted every
                    // "shaded" row the identical color as the page behind it —
                    // invisible. --color-border-default/40 reads as a visible
                    // light-gray stripe regardless of what's behind the panel.
                    <li
                      key={i}
                      className={`text-[13px] leading-snug px-1.5 py-1.5 rounded-sm ${
                        i % 2 === 0 ? "bg-[var(--color-border-default)]/40" : ""
                      }`}
                    >
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {n.title}
                      </a>
                      <div className="muted-text text-[10.5px] mt-[1px]">
                        {n.source} · {shortDate(n.published_at)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {!selected && symbol && (
          <p className="muted-text text-[10px] col-span-full">
            {symbol} is not in the tracked queue — its tree entry disappeared (e.g. a
            filter changed underneath it). The chart and verdict above are still live.
          </p>
        )}
      </div>
    </div>
  );
}

/** Disclosure chevron that rotates from ▶ (closed) to ▼ (open). Same shape as
 *  the watchlist rail's — see WatchlistClient.tsx. */
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
