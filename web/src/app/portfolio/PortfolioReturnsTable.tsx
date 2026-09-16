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

export function PortfolioReturnsTable({ others = [] }: { others?: OtherRow[] }) {
  const [rows, setRows] = useState<Display[] | null>(null);
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

  /**
   * Trailing windows for the ACTIVE view: each holding's own price return,
   * weighted by what that holding is currently worth.
   *
   * THIS IS NOT THE SAME NUMBER the Scorecard tab shows, and the difference is
   * worth understanding. Scorecard reports a time-weighted return chained over
   * `app.portfolio_snapshot` with trade cashflows netted out — a true portfolio
   * return, but whole-book only, because there is no per-segment snapshot
   * series and never has been. Scoping to a tab therefore cannot come from
   * there at any price.
   *
   * So this is computed bottom-up instead: Σ(value × return) / Σ(value) over
   * the rows on screen. For a window in which you didn't trade, the two agree.
   * Where you did trade, this one ignores the timing of the cashflow — it
   * describes how the instruments you hold TODAY performed, not what your money
   * actually earned. That is the right question for a per-segment read and the
   * wrong one for the book as a whole, which is why Scorecard keeps the TWR.
   *
   * Weights use current value, and each window weights independently: a holding
   * missing 1Y drops out of 1Y alone rather than poisoning every column.
   */
  const windows = useMemo(() => {
    const keys = ["d1", "w1", "m1", "y1"] as const;
    const out: Record<(typeof keys)[number], number | null> = {
      d1: null, w1: null, m1: null, y1: null,
    };
    for (const k of keys) {
      let acc = 0;
      let wsum = 0;
      for (const r of sorted ?? []) {
        const v = r[k];
        if (v == null || r.qty == null || r.ltp == null) continue;
        const w = r.qty * r.ltp;
        if (!(w > 0)) continue;
        acc += w * v;
        wsum += w;
      }
      out[k] = wsum > 0 ? acc / wsum : null;
    }
    return out;
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
    {/* Stocks / Others sits ABOVE the strip because it governs the strip as
        well as the table — every figure below it is scoped to the selection.
        Same isMapped split as the Holdings tab, so the two can't disagree about
        what counts as a stock. Switching resets the Profit/Loss pill: those
        counts are per-view, and leaving "Loss 12" selected while moving to a
        view with three losers reads as data loss rather than as a filter. */}
    <div className="flex items-center gap-1 mb-3 border-b hairline">
      {([
        { v: "stocks", label: "Stocks", n: rows?.length ?? 0 },
        { v: "others", label: "Others", n: otherRows.length },
      ] as const).map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => { setView(o.v); setBucket("all"); }}
          className="relative px-3 py-2 text-[13px] font-medium transition-colors"
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
    <SummaryStrip view={view} subtotal={subtotal} windows={windows} />
    {/* `overflow-hidden` on the card would also trap the sticky header (any
        non-visible overflow creates the anchoring scrollport), so it too is
        dropped from md up. Below md it stays, to clip the rounded corners. */}
    <div className="card overflow-hidden md:overflow-visible">
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

/**
 * Summary strip: Invested / Current value / Total P&L, then trailing
 * 1D / 1W / 1M / 1Y — all scoped to the selected Stocks-or-Others tab, and to
 * the Profit/Loss pill, since both are just filters on the same row set.
 *
 * TWO DIFFERENT MEASUREMENTS sit side by side and the rule between them marks
 * the boundary. Left: live marks, summed from the rows on screen at read-time
 * prices. Right: weighted-average price returns of those same rows. So the 1D
 * here describes how the instruments moved, while the P&L beside it is a
 * position. They answer different questions and will not reconcile to each
 * other — that is the intended reading, not a defect.
 *
 * NO 6M COLUMN, deliberately. /api/watchlist carries 1D, 1W, 1M and 1Y and no
 * six-month window, so a 6M here could only ever be an empty column. An
 * always-dash column trains you to ignore the row; better to not claim it.
 *
 * For the Others tab every window is null by construction — ETFs have no bar
 * series — so the whole right-hand group is replaced by a single sentence
 * saying why, rather than four dashes that look like a loading failure.
 */
function SummaryStrip({
  view,
  subtotal,
  windows,
}: {
  view: View;
  subtotal: { invested: number; current: number; pnl: number; pnlPct: number | null; missing: number };
  windows: { d1: number | null; w1: number | null; m1: number | null; y1: number | null };
}) {
  const cells: { label: string; value: number | null }[] = [
    { label: "1D", value: windows.d1 },
    { label: "1W", value: windows.w1 },
    { label: "1M", value: windows.m1 },
    { label: "1Y", value: windows.y1 },
  ];
  const noWindows = cells.every((c) => c.value == null);

  return (
    <div className="card p-3 md:p-4 mb-3">
      <div className="flex items-center gap-x-6 gap-y-3 flex-wrap">
        <Metric label="Invested" value={inr(subtotal.invested)} />
        <Metric label="Current value" value={inr(subtotal.current)} />
        <Metric
          label="Total P&L"
          value={`${subtotal.pnl >= 0 ? "+" : "−"}${inr(Math.abs(subtotal.pnl))}`}
          color={deltaColor(subtotal.pnl)}
          sub={subtotal.pnlPct == null ? undefined : fmtPct(subtotal.pnlPct)}
        />
        <div className="hidden md:block self-stretch w-px" style={{ background: "var(--color-hairline, rgba(0,0,0,0.10))" }} />
        {noWindows ? (
          <span className="muted-text text-[11.5px] max-w-[420px]">
            No trailing performance for unscored instruments — ETFs and index funds
            have a live price but no history to measure a window against.
          </span>
        ) : (
          cells.map((c) => (
            <Metric key={c.label} label={c.label} value={fmtPct(c.value)} color={deltaColor(c.value)} />
          ))
        )}
      </div>
      <div className="muted-text text-[10.5px] mt-2">
        {view === "others" ? "ETFs & index funds" : "Scored equities"} only.
        {!noWindows && " 1D–1Y are the value-weighted price returns of these holdings, not a cashflow-adjusted portfolio return — the Scorecard tab has that."}
        {subtotal.missing > 0 &&
          ` ${subtotal.missing} position${subtotal.missing > 1 ? "s" : ""} excluded from the totals: no cost or no price.`}
      </div>
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
