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

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useWatchlist, saveWatchlistNote } from "@/lib/watchlist";
import { band, bandColor, tierLabel } from "@/lib/score";
import { WatchlistButton } from "@/components/WatchlistButton";
import { CandleChart } from "@/app/tools/scanner/CandleChart";
import type { Candle } from "@/lib/candles";

type Row = {
  symbol: string;
  company_name: string | null;
  sector_name: string | null;
  industry_name: string | null;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
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
type Extras = {
  dividends: Dividend[];
  bonuses: Bonus[];
  quarterly: Quarter[];
  news: NewsItem[];
};

// In-memory caches so re-opening a stock (or re-rendering) doesn't refetch.
const extrasCache = new Map<string, Extras>();
const candleCache = new Map<string, Candle[]>();

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

export function WatchlistClient() {
  const { symbols, hydrated, remove, count, signedIn } = useWatchlist();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Master/detail: which stock is open in the right-hand panel.
  const [selected, setSelected] = useState<string | null>(null);
  // Left-rail tree: node keys present here are expanded (default: all
  // collapsed — the user opens a sector by clicking its arrow). Sector key =
  // sector name; industry key = `${sector}//${industry}`.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Left-rail search — filters the tree by sector / industry / symbol / company.
  const [query, setQuery] = useState("");
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
    fetch(`/api/watchlist?symbols=${encodeURIComponent(symbols.join(","))}`)
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
      const top = [...rows].sort(
        (a, b) => (b.composite_pct ?? 0) - (a.composite_pct ?? 0),
      )[0];
      return top?.symbol ?? null;
    });
  }, [rows]);

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
    return <EmptyState />;
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
  const { tree: fullTree, industryCount } = buildSectorTree(rows || []);
  const tree = filterTree(fullTree, query);
  const searching = query.trim().length > 0;

  const toggleNode = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap text-[12px] muted-text tabular-nums">
        <span>
          {count} {count === 1 ? "stock" : "stocks"} on your watchlist
        </span>
        <span className="opacity-70">
          Sectors ({tree.length}) · Industries ({industryCount})
        </span>
        {snapshotDate && (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border"
            style={{
              borderColor: "var(--color-border-default)",
              backgroundColor: "var(--color-paper)",
            }}
            title="Scoring snapshot date (Q/V/M percentiles). Refreshed weekly; LTP price refreshes daily — see the top ribbon."
          >
            <span className="opacity-70">Scores snapshot</span>
            <span className="font-medium" style={{ color: "var(--color-ink)" }}>
              {formatSnapshotDate(snapshotDate)}
            </span>
          </span>
        )}
        {loading && <span>· refreshing…</span>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">
        {/* LEFT rail — sector → industry tree with search, matching the
            Graph-tab industries browser. */}
        <div className="card overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] flex flex-col">
          <div className="px-3 py-2.5 border-b hairline flex items-center justify-between shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wide muted-text">
              Sectors &amp; industries
            </span>
            <span className="text-[10.5px] muted-text tabular-nums">
              {tree.length} · {tree.reduce((n, s) => n + s.industries.length, 0)}
            </span>
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

          <div className="overflow-y-auto flex-1 min-h-0">
            {tree.length === 0 ? (
              <div className="p-4 text-center muted-text text-[12px]">No matches.</div>
            ) : (
              tree.map((sec) => {
                const secOpen = searching || expanded.has(sec.name);
                return (
                  <div key={sec.name}>
                    <button
                      type="button"
                      onClick={() => toggleNode(sec.name)}
                      className="w-full flex items-center gap-2 px-3 py-2 border-b hairline text-left transition-colors hover:bg-[var(--color-paper)]"
                      aria-expanded={secOpen}
                    >
                      <Chevron open={secOpen} />
                      <span className="text-[12.5px] font-semibold truncate flex-1">
                        {sec.name}
                      </span>
                      <span className="text-[11px] muted-text tabular-nums">{sec.count}</span>
                    </button>
                    {secOpen &&
                      sec.industries.map((ind) => {
                        const key = `${sec.name}//${ind.name}`;
                        const indOpen = searching || expanded.has(key);
                        return (
                          <div key={ind.name}>
                            <button
                              type="button"
                              onClick={() => toggleNode(key)}
                              className="w-full flex items-center gap-2 pl-6 pr-3 py-1.5 border-b hairline text-left transition-colors hover:bg-[var(--color-paper)]"
                              aria-expanded={indOpen}
                            >
                              <Chevron open={indOpen} small />
                              <span className="text-[12px] truncate flex-1">{ind.name}</span>
                              <span className="text-[10.5px] muted-text tabular-nums">
                                {ind.stocks.length}
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
            return (
              <>
                {/* Rotate bar — step through the watchlist without leaving the
                    detail panel. Position readout confirms where you are. */}
                <div className="flex items-center justify-between gap-2 px-4 md:px-5 py-2 border-b hairline bg-[var(--color-paper)]/50">
                  <span className="text-[11px] muted-text tabular-nums flex items-center gap-2">
                    {pos >= 0 ? `${pos + 1} / ${flatOrder.length}` : `${flatOrder.length}`}
                    <span className="hidden sm:inline opacity-70">· use ← → keys</span>
                  </span>
                  <div className="inline-flex rounded-md border hairline overflow-hidden">
                    <button
                      type="button"
                      onClick={() => rotate(-1)}
                      disabled={flatOrder.length < 2}
                      className="px-2.5 py-1 text-[12px] hover:bg-[var(--color-paper)] transition-colors disabled:opacity-40"
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
                <WatchRow
                  row={sel}
                  signedIn={signedIn}
                  onRemove={() => remove(sel.symbol)}
                />
              </>
            );
          })()}
        </div>
      </div>

      {missing.length > 0 && (
        <section className="card p-4">
          <div className="text-[12px] muted-text mb-2">
            {missing.length} symbol{missing.length === 1 ? "" : "s"} in your watchlist no longer appear in our universe (delisted, renamed, or scoring paused):
          </div>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((sym) => (
              <span
                key={sym}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] tabular-nums"
                style={{ borderColor: "var(--color-border-default)", backgroundColor: "var(--color-paper)" }}
              >
                {sym}
                <button
                  type="button"
                  onClick={() => remove(sym)}
                  className="muted-text hover:text-[var(--color-ink)] ml-0.5"
                  aria-label={`Remove ${sym}`}
                  title="Remove from watchlist"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </section>
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
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10.5px] uppercase tracking-wide font-semibold shrink-0"
      style={{ backgroundColor: c.bg, color: c.label }}
      title="Company maturity tier"
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: c.stripe }} />
      {tierLabel(tier)}
    </span>
  );
}

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
        <div className="font-medium text-[13px] tabular-nums truncate">{row.symbol}</div>
        <div className="text-[10px] muted-text truncate leading-tight">{row.company_name}</div>
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
}: {
  row: Row;
  signedIn: boolean;
  onRemove: () => void;
}) {
  const compositeBand = band(row.composite_pct);
  const compositeColor = bandColor(compositeBand);
  const ltp = row.ltp ?? row.current_price;
  // Performance since you added the stock: LTP vs the close captured on add-day.
  // 0% on the day you add (LTP == close_on_add), then moves with the stock.
  const sinceAdd =
    ltp != null && row.close_on_add != null && row.close_on_add !== 0
      ? Math.round((ltp / row.close_on_add - 1) * 1000) / 10
      : null;
  return (
    <div className="px-4 md:px-5 py-3 hover:bg-[var(--color-paper)]/60 transition-colors">
      <div className="flex items-start gap-3">
        <Link href={`/stock/${row.symbol}`} className="flex-1 min-w-0 block">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-[14px] tabular-nums">{row.symbol}</span>
            <span className="muted-text text-[12px] truncate">{row.company_name}</span>
          </div>
          <div className="text-[10.5px] muted-text mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{row.sector_name ?? "—"} · {row.industry_name ?? "—"}</span>
            {row.maturity_tier && <TierBadge tier={row.maturity_tier} />}
          </div>
        </Link>

        {/* Composite score badge */}
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

        {/* Quick remove */}
        <button
          type="button"
          onClick={onRemove}
          className="muted-text hover:text-[var(--color-delta-down)] transition-colors text-[16px] leading-none px-1"
          aria-label={`Remove ${row.symbol} from watchlist`}
          title="Remove from watchlist"
        >
          ×
        </button>
      </div>

      {/* Price context strip: what you added at, where it is now, and how far
          it sits from its 52-week extremes. */}
      <div className="mt-2.5 grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-2 tabular-nums">
        <Metric
          label="Added"
          title={row.added_at ? `Added ${formatSnapshotDate(row.added_at.slice(0, 10))}` : undefined}
          value={row.added_at ? formatShortDate(row.added_at.slice(0, 10)) : "—"}
        />
        <Metric
          label="Close @ add"
          title={
            row.close_on_add_date
              ? `Closing price on ${formatSnapshotDate(row.close_on_add_date)} — your reference point`
              : "Captured when you added the stock"
          }
          value={fmtPrice(row.close_on_add)}
        />
        <Metric label="LTP" title="Latest daily close (split-adjusted)" value={fmtPrice(ltp)} />
        <Metric
          label="Since add"
          title={
            row.close_on_add != null
              ? `LTP vs your add-day close ₹${row.close_on_add.toLocaleString("en-IN", { maximumFractionDigits: 2 })} — your P&L since watching`
              : "Set when you add the stock"
          }
          value={fmtSignedPct(sinceAdd)}
          color={deltaColor(sinceAdd)}
        />
        <Metric
          label="From 52W H"
          title={
            row.high_52w != null
              ? `52-week high ₹${row.high_52w.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
              : undefined
          }
          value={fmtSignedPct(row.from_high_pct)}
        />
        <Metric
          label="From 52W L"
          title={
            row.low_52w != null
              ? `52-week low ₹${row.low_52w.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
              : undefined
          }
          value={fmtSignedPct(row.from_low_pct)}
        />
      </div>

      {/* Scores + longer-horizon returns (weekly panel). */}
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] tabular-nums">
        <ReturnPill label="Q" value={row.quality_pct}   pct />
        <ReturnPill label="V" value={row.valuation_pct} pct />
        <ReturnPill label="M" value={row.momentum_pct}  pct />
        <span className="muted-text">·</span>
        <ReturnPill label="1D" value={row.ret_1d == null ? null : row.ret_1d / 100} signed />
        <ReturnPill label="1W" value={row.ret_1w} signed />
        <ReturnPill label="1M" value={row.ret_1m} signed />
        <ReturnPill label="1Y" value={row.ret_1y} signed />
      </div>

      {/* Price chart (split-safe daily candles). */}
      <ChartBlock symbol={row.symbol} />

      {/* Corporate actions + quarterly-result snapshot. */}
      <ExtrasBlock symbol={row.symbol} />

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

// ── Price chart ─────────────────────────────────────────────────────────────

const RANGE_OPTIONS: { label: string; days: number }[] = [
  { label: "1W", days: 7 },
  { label: "1M", days: 31 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
  { label: "5Y", days: 1825 },
  { label: "10Y", days: 3660 },
  // "ALL" over-asks; the OHLC route clamps to full listed history.
  { label: "ALL", days: 11000 },
];

/** Embeds the scanner's CandleChart, fetching candles from /api/scanner/ohlc
 *  for the selected range. Reuses an in-memory cache so range/stock switches
 *  that were already loaded are instant. */
function ChartBlock({ symbol }: { symbol: string }) {
  const [days, setDays] = useState(365);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const key = `${symbol}:${days}`;
    const cached = candleCache.get(key);
    if (cached) {
      setCandles(cached);
      setErr(false);
      return;
    }
    let alive = true;
    setCandles(null);
    setErr(false);
    fetch(`/api/scanner/ohlc?syms=${encodeURIComponent(symbol)}&days=${days}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: { data: Record<string, Candle[]> }) => {
        if (!alive) return;
        const c = j.data?.[symbol] ?? [];
        candleCache.set(key, c);
        setCandles(c);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [symbol, days]);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
        <span className="text-[9.5px] uppercase tracking-wide muted-text">Price</span>
        <div className="flex flex-wrap rounded-md border hairline overflow-hidden">
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.days}
              type="button"
              onClick={() => setDays(o.days)}
              className="px-2 py-0.5 text-[10.5px] tabular-nums transition-colors border-l first:border-l-0 hairline"
              style={
                days === o.days
                  ? { backgroundColor: "var(--color-accent-600)", color: "white" }
                  : undefined
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[300px] w-full rounded-md border hairline overflow-hidden">
        {err ? (
          <div className="h-full flex items-center justify-center muted-text text-[12px]">
            Couldn&apos;t load price data.
          </div>
        ) : candles === null ? (
          <div className="h-full flex items-center justify-center muted-text text-[12px]">
            Loading chart…
          </div>
        ) : candles.length === 0 ? (
          <div className="h-full flex items-center justify-center muted-text text-[12px]">
            No price history.
          </div>
        ) : (
          <CandleChart candles={candles} interactive weekly={days > 730} />
        )}
      </div>
    </div>
  );
}

// ── Corporate actions + quarterly results ───────────────────────────────────

/** Lazily loads dividends / bonuses / quarterly results for the open stock. */
function ExtrasBlock({ symbol }: { symbol: string }) {
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
        };
        extrasCache.set(symbol, e);
        setData(e);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [symbol]);

  if (err) return null;
  if (data === null) {
    return <div className="mt-3 text-[11px] muted-text">Loading corporate actions…</div>;
  }

  const { dividends, bonuses, quarterly, news } = data;
  const nothing =
    dividends.length === 0 &&
    bonuses.length === 0 &&
    quarterly.length === 0 &&
    news.length === 0;
  if (nothing) {
    return (
      <div className="mt-3 text-[11px] muted-text italic">
        No corporate actions, results, or news on record for {symbol}.
      </div>
    );
  }

  const latest = quarterly[0];

  return (
    <div className="mt-4 space-y-4">
      {/* Latest-result highlight strip — the headline numbers pulled out of
          the table so the current quarter reads at a glance. */}
      {latest && (
        <div>
          <div className="text-[9.5px] uppercase tracking-wide muted-text mb-1.5">
            Latest results · {fmtQuarter(latest.period_end)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ResultStat label="Sales" value={`₹${fmtCr(latest.sales)} Cr`} yoy={latest.sales_yoy} />
            <ResultStat label="Net profit" value={`₹${fmtCr(latest.net_profit)} Cr`} yoy={latest.np_yoy} />
            <ResultStat label="OPM" value={latest.opm_pct == null ? "—" : `${latest.opm_pct.toFixed(1)}%`} />
            <ResultStat label="NPM" value={latest.npm_pct == null ? "—" : `${latest.npm_pct.toFixed(1)}%`} />
          </div>
        </div>
      )}

      {/* Two-column body on wide screens: results table beside recent news. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quarterly result trend */}
        {quarterly.length > 0 && (
          <div>
            <div className="text-[9.5px] uppercase tracking-wide muted-text mb-1">
              Quarterly trend (₹ Cr)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="muted-text text-left">
                    <th className="font-medium py-1 pr-2">Qtr</th>
                    <th className="font-medium py-1 px-2 text-right">Sales</th>
                    <th className="font-medium py-1 px-2 text-right">Net profit</th>
                    <th className="font-medium py-1 pl-2 text-right">OPM</th>
                  </tr>
                </thead>
                <tbody>
                  {quarterly.map((q) => (
                    <tr key={q.period_end} className="border-t hairline">
                      <td className="py-1 pr-2">{fmtQuarter(q.period_end)}</td>
                      <td className="py-1 px-2 text-right">{fmtCr(q.sales)}</td>
                      <td className="py-1 px-2 text-right">{fmtCr(q.net_profit)}</td>
                      <td className="py-1 pl-2 text-right">
                        {q.opm_pct == null ? "—" : `${q.opm_pct.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recent news */}
        {news.length > 0 && (
          <div>
            <div className="text-[9.5px] uppercase tracking-wide muted-text mb-1">
              Recent news
            </div>
            <ul className="space-y-1.5">
              {news.map((n, i) => (
                <li key={`${n.published_at}-${i}`}>
                  <a
                    href={n.url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="block group"
                    title={n.title}
                  >
                    <div className="text-[11.5px] leading-snug group-hover:underline line-clamp-2">
                      {n.title}
                    </div>
                    <div className="text-[9.5px] muted-text tabular-nums mt-0.5 flex items-center gap-1.5">
                      {n.source && <span>{n.source}</span>}
                      {n.source && <span aria-hidden>·</span>}
                      <span>{fmtNewsDate(n.published_at)}</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Corporate actions — dividends and bonus/rights on one line each. */}
      {(dividends.length > 0 || bonuses.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {dividends.length > 0 && (
            <div>
              <div className="text-[9.5px] uppercase tracking-wide muted-text mb-1">Dividends</div>
              <div className="flex flex-wrap gap-1.5">
                {dividends.map((d, i) => (
                  <span
                    key={`${d.ex_date}-${i}`}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border hairline text-[11px] tabular-nums"
                    title={d.purpose ?? undefined}
                  >
                    <span className="muted-text">{fmtShortDate(d.ex_date)}</span>
                    <span className="font-medium">
                      {d.amount != null ? `₹${d.amount}` : (d.purpose ?? "—")}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {bonuses.length > 0 && (
            <div>
              <div className="text-[9.5px] uppercase tracking-wide muted-text mb-1">
                Bonus &amp; rights
              </div>
              <div className="flex flex-wrap gap-1.5">
                {bonuses.map((b, i) => (
                  <span
                    key={`${b.ex_date}-${i}`}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border hairline text-[11px] tabular-nums"
                    title={b.purpose ?? undefined}
                  >
                    <span className="muted-text">{fmtShortDate(b.ex_date)}</span>
                    <span
                      className="font-medium uppercase text-[9.5px] px-1 rounded"
                      style={{ backgroundColor: "var(--color-paper)" }}
                    >
                      {b.action_type}
                    </span>
                    {b.purpose && <span className="truncate max-w-[160px]">{b.purpose}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One headline stat in the latest-results strip, with an optional YoY badge. */
function ResultStat({
  label,
  value,
  yoy,
}: {
  label: string;
  value: string;
  yoy?: number | null;
}) {
  return (
    <div className="rounded-md border hairline px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wide muted-text leading-tight">{label}</div>
      <div className="text-[13px] font-medium leading-tight mt-0.5">{value}</div>
      {yoy != null && (
        <div
          className="text-[9.5px] font-medium tabular-nums mt-0.5"
          style={{ color: yoy >= 0 ? "var(--color-delta-up)" : "var(--color-delta-down)" }}
          title="Year-on-year change vs the same quarter last year"
        >
          {yoy >= 0 ? "+" : ""}
          {yoy.toFixed(1)}% YoY
        </div>
      )}
    </div>
  );
}

/** ISO timestamp → "20 Jul '26" for the news byline. */
function fmtNewsDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
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

function Metric({
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
    <div className="min-w-0" title={title}>
      <div className="text-[9.5px] uppercase tracking-wide muted-text leading-tight">{label}</div>
      <div className="text-[12px] font-medium leading-tight mt-0.5" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

/** ₹-prefixed price with up to 2 decimals; "—" when null. */
function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
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
    const sign = v >= 0 ? "+" : "";
    const txt = Math.abs(v) >= 10 ? Math.round(v).toString() : v.toFixed(1);
    return (
      <span>
        <span className="muted-text">{label}: </span>
        <span className="font-medium" style={{ color }}>{sign}{txt}%</span>
      </span>
    );
  }
  return <span>{label}: {value}</span>;
}

// WatchlistButton is reused on /stock pages so users can still toggle there;
// the row's × button is just a faster way to prune from this page.
void WatchlistButton;
