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
 * header + chart above the panel, and the news beside it.
 *
 * EVERYTHING ON THIS PAGE EXCEPT NEWS/FILINGS COMES FROM ONE FETCH:
 * /api/admin/verdict?queue=1 already returns, per entry, sector/industry
 * (tree), action/confidence/ageDays (header + tree badges), and
 * ltp/anchorPrice/targetPrice/buyBelow/bearFloor/upsidePct (header stats) —
 * the same payload the Board tab reads, plus `summary`/`counts` for the top
 * bar. Grouping/filtering/ranking those client-side costs nothing further.
 *
 * THE CHART SELF-FETCHES. <PriceChart symbol={...} /> without a `candles` prop
 * fetches its own OHLC — see that component's header — so no chart data is
 * loaded here either.
 *
 * News and filings are the one genuinely new read: GET
 * /api/admin/stock-context?symbol=X, a copy of the stock page's own two
 * queries (see that route's header for why it is not folded into the verdict
 * route). A symbol can legitimately have one and not the other — e.g. recent
 * BSE filings but no press coverage, or vice versa — that is a true read of
 * app.announcement / app.news, not a bug in this page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PriceChart } from "@/components/PriceChart";
import { VerdictPanel, VerdictEmpty } from "@/components/VerdictPanel";
import type { QueueEntry, VerdictQueue, VerdictData } from "@/lib/verdict";

type NewsRow = { title: string; source: string; url: string; published_at: string | null };
type FilingRow = {
  title: string;
  category: string;
  headline: string | null;
  published_at: string | null;
  pdf_url: string | null;
};

type Scope = "all" | "watchlist" | "portfolio" | "archived";

const ACTION_COLOR: Record<string, string> = {
  BUY: "bg-emerald-600 text-white",
  ACCUMULATE: "bg-emerald-500 text-white",
  HOLD: "bg-slate-500 text-white",
  WATCH: "bg-amber-500 text-white",
  SELL: "bg-rose-600 text-white",
  AVOID: "bg-rose-600 text-white",
  "REDUCE & AVOID": "bg-rose-600 text-white",
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

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
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

export function VerdictDetailClient() {
  const [queueState, setQueueState] = useState<
    { kind: "loading" } | { kind: "ok"; q: VerdictQueue } | { kind: "error"; msg: string }
  >({ kind: "loading" });
  const [symbol, setSymbol] = useState<string | null>(null);
  const [treeSearch, setTreeSearch] = useState("");
  const [openSector, setOpenSector] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("all");

  const [verdictState, setVerdictState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "ok"; data: VerdictData | null } | { kind: "error"; msg: string }
  >({ kind: "idle" });
  const [contextState, setContextState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "ok"; news: NewsRow[]; filings: FilingRow[] } | { kind: "error" }
  >({ kind: "idle" });

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
        if (q.entries.length > 0 && !symbol) {
          setSymbol(q.entries[0].symbol);
          setOpenSector(q.entries[0].sector ?? "Unclassified");
        }
      })
      .catch(() => {
        if (live) setQueueState({ kind: "error", msg: "The stock list request did not complete." });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Verdict + news/filings, per selected symbol.
  useEffect(() => {
    if (!symbol) return;
    let live = true;
    setVerdictState({ kind: "loading" });
    setContextState({ kind: "loading" });

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

    return () => {
      live = false;
    };
  }, [symbol]);

  // Scope (All Active / Watchlist / Portfolio / Archived), applied before
  // search and the tree grouping. "Archived" mirrors the Board's dormant
  // bucket — a symbol no longer on the watchlist or in the portfolio.
  const scoped = useMemo(() => {
    if (queueState.kind !== "ok") return [];
    const all = queueState.q.entries;
    if (scope === "watchlist") return all.filter((e) => e.isWatchlist);
    if (scope === "portfolio") return all.filter((e) => e.isPortfolio || e.isHolding);
    if (scope === "archived") return all.filter((e) => e.bucket === "dormant");
    return all;
  }, [queueState, scope]);

  const scopeCounts = useMemo(() => {
    if (queueState.kind !== "ok") return { all: 0, watchlist: 0, portfolio: 0, archived: 0 };
    const all = queueState.q.entries;
    return {
      all: all.length,
      watchlist: all.filter((e) => e.isWatchlist).length,
      portfolio: all.filter((e) => e.isPortfolio || e.isHolding).length,
      archived: all.filter((e) => e.bucket === "dormant").length,
    };
  }, [queueState]);

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
      const sector = e.sector ?? "Unclassified";
      const industry = e.industry ?? "Unclassified";
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
  }, [scoped, treeSearch]);

  // Flat, tree-order list of symbols currently visible — what Prev/Next and
  // the arrow keys walk, and what the "N / total" counter counts against.
  const flatOrder = useMemo(
    () => tree.flatMap((s) => s.industries.flatMap((i) => i.entries.map((e) => e.symbol))),
    [tree],
  );

  // Auto-expand the sector containing a search hit, so searching doesn't land
  // on a tree that still looks collapsed around the match.
  useEffect(() => {
    if (treeSearch.trim() && tree.length > 0) {
      setOpenSector(tree[0].sector);
    }
  }, [treeSearch, tree]);

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

  return (
    <div>
      {/* ── Top bar: completion + action counts (same numbers as the Board) ── */}
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
        <span className="muted-text">
          Pending <span className="font-mono text-amber-700">{q.summary.pendingCount}</span>
        </span>
        <span className="muted-text">
          Changed <span className="font-mono text-indigo-700">{q.summary.changedCount}</span>
        </span>
        <span className="h-3 w-px bg-[var(--color-border-default)]" />
        <span className="font-semibold text-emerald-700">BUY {ac.buy}</span>
        <span className="font-semibold text-emerald-600">ACCUMULATE {ac.accumulate}</span>
        <span className="font-semibold text-slate-600">HOLD {ac.hold}</span>
        <span className="font-semibold text-amber-600">WATCH {ac.watch}</span>
        <span className="font-semibold text-rose-700">REDUCE &amp; AVOID {ac.avoid + ac.sell}</span>
      </div>

      {/* ── Scope tabs ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-2">
        {(
          [
            ["all", `All Active (${scopeCounts.all})`],
            ["watchlist", `Watchlist (${scopeCounts.watchlist})`],
            ["portfolio", `Portfolio (${scopeCounts.portfolio})`],
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_280px] gap-3 items-start">
        {/* ── Tree: sector → industry → stock, action badge per stock ──── */}
        <div className="rounded-md border hairline p-2 lg:sticky lg:top-3 lg:max-h-[calc(100vh-2rem)] overflow-y-auto">
          <input
            value={treeSearch}
            onChange={(e) => setTreeSearch(e.target.value)}
            placeholder="Find a stock"
            className="w-full px-2 py-1 text-[12px] rounded-md border hairline bg-transparent mb-2"
          />
          {tree.length === 0 ? (
            <p className="muted-text text-[11px] py-2">No match.</p>
          ) : (
            tree.map((s) => (
              <div key={s.sector} className="mb-1">
                <button
                  onClick={() => setOpenSector(openSector === s.sector ? null : s.sector)}
                  className="w-full flex items-center justify-between text-left px-1 py-1 text-[11.5px] font-semibold rounded hover:bg-[var(--color-paper)]"
                >
                  <span className="truncate">{s.sector}</span>
                  <span className="muted-text tabular-nums text-[10px] shrink-0 ml-1">
                    {s.count}
                  </span>
                </button>
                {openSector === s.sector && (
                  <div className="pl-2 border-l hairline ml-1.5">
                    {s.industries.map((ind) => (
                      <div key={ind.industry} className="mt-0.5">
                        <div className="muted-text text-[10px] uppercase tracking-wide px-1 py-0.5 truncate">
                          {ind.industry}
                        </div>
                        {ind.entries.map((e) => (
                          <button
                            key={e.symbol}
                            onClick={() => setSymbol(e.symbol)}
                            className={`w-full flex items-center justify-between gap-1 text-left px-1.5 py-[3px] text-[11.5px] rounded font-mono ${
                              symbol === e.symbol
                                ? "bg-slate-800 text-white"
                                : "hover:bg-[var(--color-paper)]"
                            }`}
                          >
                            <span className="truncate">{e.symbol}</span>
                            <span
                              className={`shrink-0 px-1 rounded text-[9px] font-sans font-semibold tracking-wide ${
                                symbol === e.symbol ? "bg-white/20 text-white" : actionClass(e.action)
                              }`}
                              title={e.action ?? "No verdict yet"}
                            >
                              {actionShort(e.action)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* ── Stock header, nav strip, map (price chart), verdict below ── */}
        <div className="min-w-0">
          {!symbol ? (
            <p className="muted-text text-[12.5px] py-6 text-center">Pick a stock from the tree.</p>
          ) : (
            <>
              {/* Nav strip */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-[11px]">
                <span className="muted-text">
                  {posInOrder >= 0 ? posInOrder + 1 : "—"} / {flatOrder.length}
                  <span className="hidden sm:inline"> · use ← → keys</span>
                  {selected?.cluster_name && (
                    <span className="ml-2">
                      {selected.sector ?? "Unclassified"} · {selected.cluster_name}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => rotate(-1)}
                    className="px-2 py-[3px] rounded-md border hairline hover:bg-[var(--color-paper)]"
                  >
                    ‹ Prev
                  </button>
                  <button
                    onClick={() => rotate(1)}
                    className="px-2 py-[3px] rounded-md border hairline hover:bg-[var(--color-paper)]"
                  >
                    Next ›
                  </button>
                </span>
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
                  {selected?.confidence && (
                    <span className="muted-text text-[10px] uppercase">{selected.confidence} confidence</span>
                  )}
                </div>
                <div className="muted-text text-[11px] mt-0.5">
                  {(selected?.sector ?? "Unclassified")} · {(selected?.industry ?? "Unclassified")}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] mt-1.5">
                  <span>
                    <span className="muted-text">LTP </span>
                    <span className="font-mono font-semibold">{money(selected?.ltp ?? null)}</span>
                    {selected?.pctMove != null && (
                      <span className={`font-mono ml-1 ${selected.pctMove >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {pct(selected.pctMove)} since call
                      </span>
                    )}
                  </span>
                  <span>
                    <span className="muted-text">Target </span>
                    <span className="font-mono">{money(selected?.targetPrice ?? null)}</span>
                  </span>
                  <span>
                    <span className="muted-text">Buy below </span>
                    <span className="font-mono">{money(selected?.buyBelow ?? null)}</span>
                  </span>
                  <span>
                    <span className="muted-text">Bear floor </span>
                    <span className="font-mono">{money(selected?.bearFloor ?? null)}</span>
                  </span>
                  {selected?.upsidePct != null && (
                    <span>
                      <span className="muted-text">Upside </span>
                      <span className="font-mono">{pct(selected.upsidePct)}</span>
                    </span>
                  )}
                  {selected?.generated_at && (
                    <span className="muted-text">Called {shortDate(selected.generated_at)}</span>
                  )}
                </div>
              </div>

              {/* Map (price chart) */}
              <div className="rounded-md border hairline overflow-hidden mb-3">
                <PriceChart symbol={symbol} />
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
                <VerdictPanel symbol={symbol} data={verdictState.data} />
              )}
            </>
          )}
        </div>

        {/* ── News + filings, far right ────────────────────────────────── */}
        <div className="rounded-md border hairline p-2 lg:sticky lg:top-3 lg:max-h-[calc(100vh-2rem)] overflow-y-auto">
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5">
            {symbol ? `News & filings · ${symbol}` : "News & filings"}
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
            <p className="muted-text text-[11px]">Could not load news/filings.</p>
          ) : (
            <>
              {contextState.news.length === 0 && contextState.filings.length === 0 && (
                <p className="muted-text text-[11px]">Nothing on record for {symbol}.</p>
              )}
              {contextState.news.length > 0 && (
                <div className="mb-3">
                  <div className="muted-text text-[9.5px] uppercase tracking-wide mb-1">
                    News ({contextState.news.length})
                  </div>
                  <ul className="space-y-1.5">
                    {contextState.news.slice(0, 15).map((n, i) => (
                      <li key={i} className="text-[11px] leading-tight">
                        <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {n.title}
                        </a>
                        <div className="muted-text text-[9.5px] mt-[1px]">
                          {n.source} · {shortDate(n.published_at)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {contextState.news.length === 0 && (
                <p className="muted-text text-[10px] mb-3">No news in the last 6 months.</p>
              )}
              <div>
                <div className="muted-text text-[9.5px] uppercase tracking-wide mb-1">
                  Filings ({contextState.filings.length})
                </div>
                {contextState.filings.length === 0 ? (
                  <p className="muted-text text-[10px]">No exchange filings on record.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {contextState.filings.slice(0, 15).map((f, i) => (
                      <li key={i} className="text-[11px] leading-tight">
                        {f.pdf_url ? (
                          <a href={f.pdf_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                            {f.headline || f.title}
                          </a>
                        ) : (
                          <span>{f.headline || f.title}</span>
                        )}
                        <div className="muted-text text-[9.5px] mt-[1px]">
                          {f.category} · {shortDate(f.published_at)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
