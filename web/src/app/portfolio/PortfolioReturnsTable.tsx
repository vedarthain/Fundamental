"use client";

/**
 * PortfolioReturnsTable — the "Returns" tab on /portfolio.
 *
 * A flat table of every stock currently held: LTP plus trailing 1D / 1W / 1M /
 * 1Y price performance. Deliberately price-only — these are the STOCK's
 * returns over each window, not your position's. A name you bought last week
 * still shows a full 1Y number, because the column describes the instrument,
 * not your entry. (Position-level P&L lives on the Holdings tab; portfolio-level
 * time-weighted return lives on the Scorecard tab.)
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
};

type SortKey = "symbol" | "ltp" | "d1" | "w1" | "m1" | "y1";

type Display = {
  symbol: string;
  name: string | null;
  ltp: number | null;
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
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "symbol",
    dir: "asc",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetch("/api/portfolio/symbols");
        if (!s.ok) throw new Error("Could not load your holdings.");
        const sd = (await s.json()) as { signedIn: boolean; symbols: string[] };
        if (cancelled) return;
        setSignedIn(sd.signedIn);
        if (!sd.signedIn) return;
        const syms = sd.symbols ?? [];
        if (syms.length === 0) {
          setRows([]);
          return;
        }
        const w = await fetch(`/api/watchlist?symbols=${encodeURIComponent(syms.join(","))}`);
        if (!w.ok) throw new Error("Could not load price performance.");
        const wd = (await w.json()) as { rows: ApiRow[] };
        if (cancelled) return;
        setRows(
          (wd.rows ?? []).map((r) => ({
            symbol: r.symbol,
            name: r.company_name,
            ltp: r.ltp ?? r.current_price,
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

  const sorted = useMemo(() => {
    if (!rows) return null;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
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
  }, [rows, sort]);

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
  if (sorted.length === 0) {
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
    { key: "ltp", label: "LTP", title: "Last traded price" },
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
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b hairline">
        <h2 className="text-[14px] font-semibold">
          Returns{" "}
          <span className="muted-text font-normal">({sorted.length})</span>
        </h2>
        <span className="muted-text text-[11px]">stock price performance, not position P&amp;L</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b hairline text-[11px] uppercase tracking-wide muted-text">
              <th
                className="px-3 py-2 text-left font-semibold cursor-pointer select-none"
                onClick={() => toggle("symbol")}
              >
                Stock{arrow("symbol")}
              </th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className="px-3 py-2 text-right font-semibold cursor-pointer select-none whitespace-nowrap"
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
            {sorted.map((r) => (
              <tr key={r.symbol} className="border-b hairline hover:bg-[var(--color-paper)]">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/stock/${r.symbol}`}
                      className="font-medium hover:underline tabular-nums"
                    >
                      {r.symbol}
                    </Link>
                    {r.qty != null && (
                      <span
                        className="inline-flex items-center rounded px-1 py-px text-[9px] font-semibold tabular-nums leading-none shrink-0"
                        style={{
                          background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)",
                          color: "var(--color-accent-700)",
                        }}
                      >
                        {r.qty.toLocaleString("en-IN")} SH
                      </span>
                    )}
                  </div>
                  {r.name && (
                    <div className="text-[10.5px] muted-text truncate max-w-[220px]">{r.name}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap">
                  {fmtLtp(r.ltp)}
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
