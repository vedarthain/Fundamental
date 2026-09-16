"use client";

/**
 * PortfolioReturnsTable — the "Returns" tab on /portfolio.
 *
 * A flat table of every stock currently held: your buy price and unrealised
 * return, then the stock's trailing 1D / 1W / 1M / 1Y price performance.
 *
 * Those two groups answer different questions and the header says so. "Return"
 * is measured from YOUR average cost, so it depends on when you bought. The
 * 1D–1Y columns describe the INSTRUMENT over a calendar window — a name you
 * bought last week still shows a full 1Y number. Reading the 1Y column as
 * "what I made" is the easy mistake; that's what the Return column is for.
 * (Portfolio-level time-weighted return lives on the Scorecard tab.)
 *
 * Data path mirrors PortfolioScorecard: /api/portfolio/symbols for membership,
 * then /api/watchlist for the rich per-symbol rows — the same endpoint the
 * watchlist and scorecard already use, so every surface shows identical numbers.
 *
 * UNITS, the one real trap here: /api/watchlist hands back ret_1d as a PERCENT
 * but ret_1w/ret_1m/ret_1y as FRACTIONS (it divides by 100 to match the chart's
 * contract). Rendering them uniformly silently shows 1W as "0.0%" instead of
 * "4.1%". `pctFromFrac` converts; `ret_1d` is passed through untouched.
 *
 * STOCKS vs OTHERS. The two sub-tabs are fed from DIFFERENT sources, and that
 * asymmetry is structural rather than an oversight:
 *
 *   Stocks — /api/watchlist, i.e. the scored universe. Full trailing windows.
 *   Others — ETFs and index funds, handed down as props from the server render.
 *            They are not in app.universe (nothing to score), so the watchlist
 *            endpoint cannot return them at any price.
 *
 * Consequence: Others has Qty / Buy / Invested / LTP / Return — every figure
 * that depends only on your position — but NO 1D-1Y. Those windows need a price
 * history, and app.etf_price stores exactly one number per instrument, the last
 * traded price, overwritten on each pull. There is no ETF bar series anywhere in
 * the database to compute them from. The columns render "—" rather than being
 * hidden, so the gap is legible instead of looking like a different table.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ApiRow = {
  symbol: string;
  company_name: string | null;
  ltp: number | null;
  current_price: number | null;
  ret_1d: number | null; // PERCENT
  ret_1w: number | null; // fraction
  ret_1m: number | null; // fraction
  ret_1y: number | null; // fraction
  held_qty?: number | null;
  avg_cost?: number | null; // rupees, raw broker average
  pos_pnl_pct?: number | null; // PERCENT — LTP vs avg cost
};

type SortKey = "symbol" | "qty" | "buy" | "inv" | "ltp" | "pnl" | "d1" | "w1" | "m1" | "y1";

/** Which half of the book the table is showing. Mirrors the Holdings tab's
 *  sub-tabs, and uses the same `isMapped` signal underneath. */
type View = "stocks" | "others";

/**
 * One unscored position (ETF, index fund), handed down from the server render.
 * Deliberately a slim projection of `Instrument` rather than the whole thing —
 * this table needs five numbers, and passing the full object would ship scores,
 * drawdown anchors and broker lots into the client for nothing.
 */
export type OtherRow = {
  key: string;
  name: string;
  qty: number;
  buy: number | null;
  ltp: number | null;
  invested: number;
  pnlPct: number | null;
};

/**
 * Profit / Loss segregation is by the position's OWN unrealised return, not by
 * any trailing-window column — 1Y being green says nothing about whether you're
 * up on the name. Positions with no computable return (no avg cost, or no LTP)
 * are unclassifiable, so they appear under "All" only rather than being silently
 * dumped into "Loss" by a `<= 0` test on a null.
 */
type Bucket = "all" | "profit" | "loss";

type Display = {
  symbol: string;
  name: string | null;
  buy: number | null;
  /** qty × buy. Null when either side is missing — never silently 0, which
   *  would read as "cost me nothing" and drag any subtotal down with it. */
  inv: number | null;
  ltp: number | null;
  pnl: number | null;
  d1: number | null;
  w1: number | null;
  m1: number | null;
  y1: number | null;
  qty: number | null;
  /** False for ETFs/index funds — they have no price history, so the trailing
   *  columns are structurally absent rather than merely missing today. */
  scored: boolean;
};

const pctFromFrac = (f: number | null | undefined): number | null =>
  f == null ? null : f * 100;

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

function fmtLtp(v: number | null): string {
  if (v == null) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function deltaColor(v: number | null): string {
  if (v == null) return "var(--color-muted)";
  if (v === 0) return "var(--color-muted)";
  return v > 0 ? "var(--color-delta-up, #15803D)" : "var(--color-delta-down, #DC2626)";
}

/** Portfolio-level trailing return, from /api/portfolio/symbols. */
type PortfolioReturns = {
  ret1d: number | null;
  ret1w: number | null;
  ret1m: number | null;
  ret6m: number | null;
  ret1y: number | null;
  asOf: string | null;
  historyDays: number | null;
};

export function PortfolioReturnsTable({
  totals,
  others = [],
}: {
  totals?: ReturnsTotals;
  others?: OtherRow[];
}) {
  const [rows, setRows] = useState<Display[] | null>(null);
  const [pf, setPf] = useState<PortfolioReturns | null>(null);
  const [view, setView] = useState<View>("stocks");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "symbol",
    dir: "asc",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // ONE request, not two. `symbols=@portfolio` makes the route resolve
        // holdings from the session, and `lean=1` drops the glance/verdict
        // payload this table never reads — together ~65% of the bytes and
        // three of the route's eight parallel query branches.
        const w = await fetch("/api/watchlist?symbols=@portfolio&lean=1");
        if (!w.ok) throw new Error("Could not load your holdings.");
        const wd = (await w.json()) as { rows: ApiRow[]; signedIn: boolean };
        if (cancelled) return;
        setSignedIn(wd.signedIn);
        if (!wd.signedIn) return;
        setRows(
          (wd.rows ?? []).map((r) => {
            const qty = r.held_qty ?? null;
            const buy = r.avg_cost ?? null;
            return {
              symbol: r.symbol,
              name: r.company_name,
              buy,
              inv: qty != null && buy != null ? qty * buy : null,
              ltp: r.ltp ?? r.current_price,
              pnl: r.pos_pnl_pct ?? null, // already a percent
              d1: r.ret_1d, // already a percent
              w1: pctFromFrac(r.ret_1w),
              m1: pctFromFrac(r.ret_1m),
              y1: pctFromFrac(r.ret_1y),
              qty,
              scored: true,
            };
          }),
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Portfolio-level trailing return for the summary strip. Separate request
  // from the table's: this one is time-weighted over the SNAPSHOT series, a
  // fundamentally different measurement from the per-stock price windows below,
  // and it rides on an endpoint the Scorecard tab already calls. Failure is
  // silent on purpose — the table is the point of this tab, and a strip that
  // can't load must not take it down.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/portfolio/symbols");
        if (!r.ok) return;
        const d = (await r.json()) as { returns?: PortfolioReturns | null };
        if (!cancelled) setPf(d.returns ?? null);
      } catch {
        /* strip stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ETF rows, shaped like the scored ones so a single renderer handles both.
  // `scored: false` is what blanks the trailing columns downstream.
  const otherRows = useMemo<Display[]>(
    () =>
      others.map((o) => ({
        symbol: o.key,
        name: o.name,
        buy: o.buy,
        inv: o.invested,
        ltp: o.ltp,
        pnl: o.pnlPct,
        d1: null,
        w1: null,
        m1: null,
        y1: null,
        qty: o.qty,
        scored: false,
      })),
    [others],
  );

  // The active half. Stocks stay null while the fetch is in flight so the
  // loading state still works; Others is server-rendered and always ready,
  // which is why it must NOT inherit that null.
  const viewRows: Display[] | null = view === "others" ? otherRows : rows;

  const counts = useMemo(() => {
    const c = { all: viewRows?.length ?? 0, profit: 0, loss: 0 };
    for (const r of viewRows ?? []) {
      if (r.pnl == null) continue;
      if (r.pnl > 0) c.profit++;
      else if (r.pnl < 0) c.loss++;
    }
    return c;
  }, [viewRows]);

  const sorted = useMemo(() => {
    const rows = viewRows;
    if (!rows) return null;
    const inBucket = (r: Display) =>
      bucket === "all"
        ? true
        : r.pnl == null
          ? false
          : bucket === "profit"
            ? r.pnl > 0
            : r.pnl < 0;
    const dir = sort.dir === "asc" ? 1 : -1;
    return rows.filter(inBucket).sort((a, b) => {
      if (sort.key === "symbol") return dir * a.symbol.localeCompare(b.symbol);
      const av = a[sort.key];
      const bv = b[sort.key];
      // Nulls always sink, regardless of direction — a missing 1Y shouldn't
      // win the "best performer" sort.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "boolean" || typeof bv === "boolean") return 0;
      return dir * (av - bv);
    });
  }, [viewRows, sort, bucket]);

  /**
   * Subtotals for the ACTIVE view — the thing the strip's whole-book figures
   * can't tell you: what the Stocks half cost and what it's worth, separately
   * from the ETF half.
   *
   * Summed from the visible rows rather than from the server totals, because
   * the server totals are whole-book and there is no split of them. Rows with
   * an unknown cost or price are counted in `missing` and excluded from the
   * sums, and the UI says so — a subtotal quietly short by one position is
   * worse than one that admits it.
   */
  const subtotal = useMemo(() => {
    let invested = 0;
    let current = 0;
    let missing = 0;
    for (const r of sorted ?? []) {
      if (r.inv == null || r.ltp == null || r.qty == null) { missing++; continue; }
      invested += r.inv;
      current += r.qty * r.ltp;
    }
    const pnl = current - invested;
    return {
      invested,
      current,
      pnl,
      pnlPct: invested > 0 ? (pnl / invested) * 100 : null,
      missing,
    };
  }, [sorted]);

  if (signedIn === false) {
    return (
      <div className="card p-8 text-center">
        <div className="text-[14px] mb-2">Sign in to see your returns</div>
        <div className="muted-text text-[12px]">
          This table is built from your uploaded trades.
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="card p-8 text-center">
        <div className="text-[14px] mb-2">Couldn&apos;t load returns</div>
        <div className="muted-text text-[12px]">{error}</div>
      </div>
    );
  }
  if (sorted == null) {
    return <div className="card p-8 text-center muted-text text-[13px]">Loading…</div>;
  }
  // Only bail out when there are genuinely no holdings ANYWHERE. An empty
  // bucket ("no losers today") or an empty sub-tab ("no ETFs") must still
  // render the pills and tabs, otherwise the filter traps you on a blank card
  // with no way back.
  if ((rows?.length ?? 0) === 0 && otherRows.length === 0) {
    return (
      <div className="card p-8 text-center">
        <div className="text-[14px] mb-2">No holdings yet</div>
        <div className="muted-text text-[12px]">
          Import holdings on the Transactions tab to populate this table.
        </div>
      </div>
    );
  }

  const cols: { key: SortKey; label: string; title: string }[] = [
    { key: "qty", label: "Qty", title: "Shares you currently hold" },
    { key: "buy", label: "Buy", title: "Your average cost per share" },
    { key: "inv", label: "Invested", title: "What this position cost you: quantity × average cost" },
    { key: "ltp", label: "LTP", title: "Last traded price" },
    { key: "pnl", label: "Return", title: "Your unrealised return: LTP vs your average cost" },
    { key: "d1", label: "1D", title: "Price change over the last session" },
    { key: "w1", label: "1W", title: "Price change over the last week" },
    { key: "m1", label: "1M", title: "Price change over the last month" },
    { key: "y1", label: "1Y", title: "Price change over the last year" },
  ];

  const toggle = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : // Returns are most useful biggest-first; names read A→Z.
          { key, dir: key === "symbol" ? "asc" : "desc" },
    );

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  return (
    <>
    <SummaryStrip totals={totals} pf={pf} />
    {/* `overflow-hidden` on the card would also trap the sticky header (any
        non-visible overflow creates the anchoring scrollport), so it too is
        dropped from md up. Below md it stays, to clip the rounded corners. */}
    <div className="card overflow-hidden md:overflow-visible">
      {/* Stocks / Others — the same split as the Holdings tab, driven by the
          same isMapped signal, so the two tabs can't disagree about what counts
          as a stock. Switching resets the Profit/Loss pill: those counts are
          per-view, and leaving "Loss 12" selected while moving to a view with
          three losers reads as data loss rather than a filter. */}
      <div className="flex items-center gap-1 px-4 pt-2 border-b hairline">
        {([
          { v: "stocks", label: "Stocks", n: rows?.length ?? 0 },
          { v: "others", label: "Others", n: otherRows.length },
        ] as const).map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => { setView(o.v); setBucket("all"); }}
            className="relative px-3 py-2 text-[12.5px] font-medium transition-colors"
            style={{ color: view === o.v ? "var(--color-accent-700)" : "var(--color-muted)" }}
          >
            {o.label}
            <span className="ml-1.5 text-[11px] tabular-nums muted-text">{o.n}</span>
            {view === o.v && (
              <span className="absolute left-0 right-0 -bottom-px h-[2px]" style={{ background: "var(--color-accent-600)" }} />
            )}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b hairline">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-[14px] font-semibold">
            {view === "others" ? "ETFs & funds" : "Stocks"}{" "}
            <span className="muted-text font-normal">({sorted.length})</span>
          </h2>
          <div className="flex items-center gap-1">
            {(
              [
                { v: "all", label: "All", tint: null },
                { v: "profit", label: "Profit", tint: "var(--color-delta-up, #15803D)" },
                { v: "loss", label: "Loss", tint: "var(--color-delta-down, #DC2626)" },
              ] as const
            ).map((p) => {
              const active = bucket === p.v;
              return (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => setBucket(p.v)}
                  className="rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums transition-colors"
                  style={{
                    background: active
                      ? `color-mix(in srgb, ${p.tint ?? "var(--color-fg)"} 12%, transparent)`
                      : "transparent",
                    color: active ? (p.tint ?? "var(--color-fg)") : "var(--color-muted)",
                    border: `1px solid ${
                      active
                        ? `color-mix(in srgb, ${p.tint ?? "var(--color-fg)"} 32%, transparent)`
                        : "var(--color-hairline, rgba(0,0,0,0.10))"
                    }`,
                  }}
                >
                  {p.label} {counts[p.v]}
                </button>
              );
            })}
          </div>
        </div>
        <span className="muted-text text-[11px]">
          {view === "others"
            ? "Live LTP · no 1D–1Y: unscored instruments have no price history"
            : "Return is yours · 1D–1Y are the stock’s"}
        </span>
      </div>
      {/* Subtotal for the visible rows. The strip above is whole-book; this is
          the half you're actually looking at, which is the number the Stocks /
          Others split exists to expose. Recomputed from the rows on screen, so
          it also tracks the Profit/Loss filter rather than silently showing an
          unfiltered total next to a filtered table. */}
      <div className="flex items-center gap-x-6 gap-y-1 flex-wrap px-4 py-2 border-b hairline text-[11.5px]">
        <span className="muted-text">
          {bucket === "all" ? "Subtotal" : `Subtotal (${bucket})`}
        </span>
        <span className="tabular-nums">
          <span className="muted-text">Invested </span>
          <span className="font-semibold">{inr(subtotal.invested)}</span>
        </span>
        <span className="tabular-nums">
          <span className="muted-text">Current </span>
          <span className="font-semibold">{inr(subtotal.current)}</span>
        </span>
        <span className="tabular-nums" style={{ color: deltaColor(subtotal.pnl) }}>
          <span className="muted-text">P&amp;L </span>
          <span className="font-semibold">
            {subtotal.pnl >= 0 ? "+" : "−"}{inr(Math.abs(subtotal.pnl))}
          </span>
          {subtotal.pnlPct != null && <span> ({fmtPct(subtotal.pnlPct)})</span>}
        </span>
        {subtotal.missing > 0 && (
          <span className="muted-text">
            {subtotal.missing} position{subtotal.missing > 1 ? "s" : ""} excluded — no cost or price
          </span>
        )}
      </div>
      {/* `overflow-x-auto` makes this a scroll container on BOTH axes (CSS
          forces a `visible` axis to `auto` when the other isn't visible), and a
          sticky <th> then anchors to this box instead of the viewport — i.e. it
          never sticks. So horizontal scrolling is kept only below md, where the
          table genuinely doesn't fit; from md up the overflow goes back to
          visible and the sticky header works. */}
      <div className="overflow-x-auto md:overflow-visible">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide muted-text">
              {/* top-[84px] = SnapshotRibbon (28px) + SiteHeader (56px). Same
                  offset StockPageTabs uses, so the column headers park directly
                  under the site header instead of sliding beneath it. z-20 stays
                  below the header's z-30 — the header must win any overlap.
                  The background must be opaque or rows show through it. */}
              <th
                className="sticky top-[84px] z-20 px-3 py-2 text-left font-semibold cursor-pointer select-none border-b hairline"
                style={{ backgroundColor: "var(--color-paper)" }}
                onClick={() => toggle("symbol")}
              >
                Stock{arrow("symbol")}
              </th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className="sticky top-[84px] z-20 px-3 py-2 text-right font-semibold cursor-pointer select-none whitespace-nowrap border-b hairline"
                  style={{ backgroundColor: "var(--color-paper)" }}
                  title={c.title}
                  onClick={() => toggle(c.key)}
                >
                  {c.label}
                  {arrow(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={cols.length + 1} className="px-3 py-8 text-center muted-text text-[12px]">
                  {bucket === "profit"
                    ? "Nothing in profit right now."
                    : bucket === "loss"
                      ? "Nothing at a loss right now."
                      : "No ETFs, funds or other non-equity holdings."}
                </td>
              </tr>
            )}
            {sorted.map((r) => (
              <tr key={r.symbol} className="border-b hairline hover:bg-[var(--color-paper)]">
                <td className="px-3 py-2">
                  {/* Opens in a new tab: this table is a scan-and-compare
                      surface, and navigating away would drop the sort, the
                      profit/loss bucket and the scroll position. rel="noopener"
                      is mandatory with target="_blank" — without it the opened
                      page gets a handle on window.opener. */}
                  {/* Unscored instruments have no /stock page — there is no
                      universe row behind them — so they render as plain text.
                      Linking anyway would 404 on every ETF. */}
                  {r.scored ? (
                    <Link
                      href={`/stock/${r.symbol}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:underline tabular-nums"
                    >
                      {r.symbol}
                    </Link>
                  ) : (
                    <span className="font-medium tabular-nums">{r.symbol}</span>
                  )}
                  {r.name && (
                    <div className="text-[10.5px] muted-text truncate max-w-[220px]">{r.name}</div>
                  )}
                </td>
                {/* Quantity is a count, not money — no ₹, and an em dash rather
                    than "0" when the broker didn't report one, so a missing
                    figure never reads as a closed position. */}
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap muted-text">
                  {r.qty == null ? "—" : r.qty.toLocaleString("en-IN")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {fmtLtp(r.buy)}
                </td>
                {/* Invested is rounded to whole rupees: it's a position-size
                    figure you scan, not a price you reconcile to the paisa. */}
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap muted-text">
                  {r.inv == null ? "—" : inr(r.inv)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap">
                  {fmtLtp(r.ltp)}
                </td>
                {/* Your return sits apart from the trailing-window columns: it's
                    measured from YOUR cost, not from a calendar window. */}
                <td
                  className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap"
                  style={{ color: deltaColor(r.pnl) }}
                >
                  {fmtPct(r.pnl)}
                </td>
                {(["d1", "w1", "m1", "y1"] as const).map((k) => (
                  <td
                    key={k}
                    className="px-3 py-2 text-right tabular-nums whitespace-nowrap"
                    style={{ color: deltaColor(r[k]) }}
                  >
                    {fmtPct(r[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}

/** Totals the strip needs, handed down from the server render so the figures are
 *  byte-identical to the Performance tab's cards rather than re-derived here. */
export type ReturnsTotals = {
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPct: number | null;
};

/**
 * Summary strip above the Returns table: the whole book on one line —
 * Invested, Current value, and trailing 1D / 1W / 1M / 6M / 1Y.
 *
 * TWO DIFFERENT MEASUREMENTS sit side by side here and the distinction is not
 * cosmetic. Invested / Current value are live, priced at read time. The
 * trailing percentages are TIME-WEIGHTED over `app.portfolio_snapshot`, an
 * end-of-day series, with trade cashflows netted out so that topping up a
 * position doesn't book your own deposit as a gain. So the strip's 1D will not
 * equal (current − previous close) on today's live prices, and shouldn't: one
 * is a return, the other is a mark. The "as of" note carries the snapshot date
 * so the gap is visible rather than confusing.
 *
 * 6M and 1Y render "—" until the snapshot series is long enough to span them.
 * The footnote states the actual depth, because a bare dash reads as a bug
 * while "62 days of history" reads as the true answer: not yet.
 */
function SummaryStrip({
  totals,
  pf,
}: {
  totals?: ReturnsTotals;
  pf: PortfolioReturns | null;
}) {
  const windows: { label: string; value: number | null }[] = [
    { label: "1D", value: pf?.ret1d ?? null },
    { label: "1W", value: pf?.ret1w ?? null },
    { label: "1M", value: pf?.ret1m ?? null },
    { label: "6M", value: pf?.ret6m ?? null },
    { label: "1Y", value: pf?.ret1y ?? null },
  ];
  // Nothing to say at all — don't render an empty shell.
  if (!totals && windows.every((w) => w.value == null)) return null;

  const short = pf?.historyDays != null && windows.some((w) => w.value == null);

  return (
    <div className="card p-3 md:p-4 mb-3">
      <div className="flex items-center gap-x-6 gap-y-3 flex-wrap">
        {totals && (
          <>
            <Metric label="Invested" value={inr(totals.invested)} />
            <Metric label="Current value" value={inr(totals.currentValue)} />
            <Metric
              label="Total P&L"
              value={`${totals.pnl >= 0 ? "+" : "−"}${inr(Math.abs(totals.pnl))}`}
              color={deltaColor(totals.pnl)}
              sub={totals.pnlPct == null ? undefined : fmtPct(totals.pnlPct)}
            />
            {/* Vertical rule marks the boundary between live marks (left) and
                time-weighted returns (right) — the one thing a reader must not
                conflate. Hidden below md where the row wraps anyway. */}
            <div className="hidden md:block self-stretch w-px" style={{ background: "var(--color-hairline, rgba(0,0,0,0.10))" }} />
          </>
        )}
        {windows.map((w) => (
          <Metric
            key={w.label}
            label={w.label}
            value={fmtPct(w.value)}
            color={deltaColor(w.value)}
          />
        ))}
      </div>
      {short && (
        <div className="muted-text text-[10.5px] mt-2">
          Windows longer than {pf!.historyDays} days show “—”: performance is tracked
          from your first snapshot onward, and that history is {pf!.historyDays} days deep
          {pf?.asOf ? ` (through ${pf.asOf})` : ""}.
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide muted-text">{label}</div>
      <div
        className="text-[15px] md:text-[16px] font-semibold tabular-nums"
        style={{ color: color ?? "var(--color-fg)" }}
      >
        {value}
      </div>
      {sub && <div className="text-[10.5px] tabular-nums" style={{ color: color }}>{sub}</div>}
    </div>
  );
}

const inr = (n: number) =>
  `₹${Math.round(n).toLocaleString("en-IN")}`;
