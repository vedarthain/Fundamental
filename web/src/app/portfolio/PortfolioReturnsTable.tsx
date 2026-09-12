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

type SortKey = "symbol" | "qty" | "buy" | "ltp" | "pnl" | "d1" | "w1" | "m1" | "y1";

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
  ltp: number | null;
  pnl: number | null;
  d1: number | null;
  w1: number | null;
  m1: number | null;
  y1: number | null;
  qty: number | null;
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

export function PortfolioReturnsTable() {
  const [rows, setRows] = useState<Display[] | null>(null);
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
          (wd.rows ?? []).map((r) => ({
            symbol: r.symbol,
            name: r.company_name,
            buy: r.avg_cost ?? null,
            ltp: r.ltp ?? r.current_price,
            pnl: r.pos_pnl_pct ?? null, // already a percent
            d1: r.ret_1d, // already a percent
            w1: pctFromFrac(r.ret_1w),
            m1: pctFromFrac(r.ret_1m),
            y1: pctFromFrac(r.ret_1y),
            qty: r.held_qty ?? null,
          })),
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const c = { all: rows?.length ?? 0, profit: 0, loss: 0 };
    for (const r of rows ?? []) {
      if (r.pnl == null) continue;
      if (r.pnl > 0) c.profit++;
      else if (r.pnl < 0) c.loss++;
    }
    return c;
  }, [rows]);

  const sorted = useMemo(() => {
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
      return dir * (av - bv);
    });
  }, [rows, sort, bucket]);

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
  // Only bail out when there are genuinely no holdings. An empty *bucket*
  // ("no losers today") must still render the pills, otherwise the filter
  // traps you on a blank card with no way back to All.
  if (counts.all === 0) {
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
    // `overflow-hidden` on the card would also trap the sticky header (any
    // non-visible overflow creates the anchoring scrollport), so it too is
    // dropped from md up. Below md it stays, to clip the rounded corners.
    <div className="card overflow-hidden md:overflow-visible">
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b hairline">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-[14px] font-semibold">
            Returns{" "}
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
          Return is yours · 1D–1Y are the stock&apos;s
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
                    : "Nothing at a loss right now."}
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
                  <Link
                    href={`/stock/${r.symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline tabular-nums"
                  >
                    {r.symbol}
                  </Link>
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
  );
}
