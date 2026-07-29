"use client";

/**
 * AllStocksClient — the Scanner's "All stocks" tab: the full scored universe
 * as one sortable, paginated performance table (1D / 1W / 1M / 1Y), with the
 * stock's sector and peer group alongside.
 *
 * Unlike the other scanners (which pre-sort by a fixed rule), this is a browse
 * surface: every column header is a sort toggle, and a text box filters by
 * symbol / company name. 30 rows per page. The scanner's All-NSE / NIFTY-500
 * universe toggle narrows the list here too.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { displayCompanyName } from "@/lib/score";
import type { AllStockRow } from "@/lib/allStocks";
import { RowSparkline } from "./RowSparkline";
import { WindowPicker } from "./WindowPicker";
import { usePagedSparklines } from "./usePagedSparklines";
import { ALLSTOCKS_WINDOWS, ALLSTOCKS_DEFAULT_DAYS } from "./sparkWindows";
import { Pager, usePager } from "./Pager";

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";
const PAGE_SIZE = 30;

type SortKey =
  | "symbol"
  | "sector"
  | "peer_group"
  | "current_price"
  | "ret_1d"
  | "ret_1w"
  | "ret_1m"
  | "ret_1y"
  | "composite_pct"
  | "composite_rank";

const TEXT_KEYS: ReadonlySet<SortKey> = new Set(["symbol", "sector", "peer_group"]);
// Columns that read best low→high on first click (rank #1 = best on top).
const ASC_FIRST_KEYS: ReadonlySet<SortKey> = new Set(["composite_rank"]);

function retFmt(pct: number | null): { text: string; color: string } {
  if (pct == null) return { text: "—", color: "var(--color-muted)" };
  const text = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  return { text, color: pct > 0 ? GREEN : pct < 0 ? RED : "var(--color-muted)" };
}
function scoreColor(p: number | null): string {
  if (p == null) return "var(--color-muted)";
  if (p >= 66) return GREEN;
  if (p >= 40) return "var(--color-score-weak, #b7791f)";
  return RED;
}

export default function AllStocksClient({
  snapDate,
  rows,
  n500Only,
}: {
  snapDate: string | null;
  rows: AllStockRow[];
  n500Only: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("ret_1d");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [q, setQ] = useState("");

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      // Text columns read best A→Z; rank best low→high; returns/score high→low.
      setDir(TEXT_KEYS.has(k) || ASC_FIRST_KEYS.has(k) ? "asc" : "desc");
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (n500Only && !r.is_n500) return false;
      if (needle) {
        const hay = `${r.symbol} ${r.company_name ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, n500Only, q]);

  const sorted = useMemo(() => {
    const numeric = !TEXT_KEYS.has(sortKey);
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls always sink to the bottom, regardless of sort direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = numeric
        ? (av as number) - (bv as number)
        : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, dir]);

  const pager = usePager(sorted, PAGE_SIZE);

  // Mini price charts are fetched lazily for the visible page only (the universe
  // is far too large to batch up front); switching the window refetches.
  const [windowDays, setWindowDays] = useState(ALLSTOCKS_DEFAULT_DAYS);
  const pageSymbols = useMemo(() => pager.pageItems.map((r) => r.symbol), [pager.pageItems]);
  const spark = usePagedSparklines(pageSymbols, windowDays);

  const arrow = (k: SortKey) => (k === sortKey ? (dir === "asc" ? " ▲" : " ▼") : "");
  const thBtn = "cursor-pointer select-none hover:text-[var(--color-ink)] transition-colors";

  return (
    <>
      <header className="max-w-[720px]">
        <div className="eyebrow mb-3">Full universe</div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight">All stocks</h1>
        <p className="mt-2 text-[12.5px] muted-text">
          Every scored NSE name with 1D / 1W / 1M / 1Y performance · {sorted.length} names
          {snapDate && <> · panel {snapDate}</>}
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by symbol or company…"
          className="w-full max-w-[320px] rounded-lg border hairline px-3 py-1.5 text-[13px] bg-transparent"
        />
        <WindowPicker
          options={ALLSTOCKS_WINDOWS}
          days={windowDays}
          onSelect={setWindowDays}
          loading={spark.loading}
        />
      </div>

      {sorted.length === 0 ? (
        <div className="mt-5 card p-8 text-center">
          <div className="text-[15px] font-medium">No stocks match.</div>
          <p className="muted-text mt-2 text-[13.5px]">Clear the filter or widen to All NSE.</p>
        </div>
      ) : (
        <div className="mt-5 card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b hairline text-[11px] uppercase tracking-wide muted-text">
                  <th className={`text-left px-3 py-2.5 ${thBtn}`} onClick={() => toggleSort("symbol")}>
                    Stock{arrow("symbol")}
                  </th>
                  <th className={`text-left px-2 py-2.5 ${thBtn}`} onClick={() => toggleSort("sector")}>
                    Sector{arrow("sector")}
                  </th>
                  <th className={`text-left px-2 py-2.5 ${thBtn}`} onClick={() => toggleSort("peer_group")}>
                    Peer group{arrow("peer_group")}
                  </th>
                  <th className={`text-right px-2 py-2.5 ${thBtn}`} onClick={() => toggleSort("current_price")}>
                    Price{arrow("current_price")}
                  </th>
                  <th className={`text-right px-2 py-2.5 ${thBtn}`} title="1-day price return" onClick={() => toggleSort("ret_1d")}>
                    1D{arrow("ret_1d")}
                  </th>
                  <th className={`text-right px-2 py-2.5 ${thBtn}`} title="1-week price return" onClick={() => toggleSort("ret_1w")}>
                    1W{arrow("ret_1w")}
                  </th>
                  <th className={`text-right px-2 py-2.5 ${thBtn}`} title="1-month price return" onClick={() => toggleSort("ret_1m")}>
                    1M{arrow("ret_1m")}
                  </th>
                  <th className={`text-right px-2 py-2.5 ${thBtn}`} title="1-year price return" onClick={() => toggleSort("ret_1y")}>
                    1Y{arrow("ret_1y")}
                  </th>
                  <th className={`text-right px-2 py-2.5 ${thBtn}`} title="Industry Score percentile (fundamental)" onClick={() => toggleSort("composite_pct")}>
                    Score{arrow("composite_pct")}
                  </th>
                  <th className={`text-right px-2 py-2.5 ${thBtn}`} title="Composite rank across the whole scored universe (#1 = best)" onClick={() => toggleSort("composite_rank")}>
                    Rank{arrow("composite_rank")}
                  </th>
                  <th className="text-center px-3 py-2.5" title="Adjusted-close price over the selected window">Trend</th>
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map((r) => (
                  <tr key={r.symbol} className="border-b hairline hover:bg-[var(--color-paper)] transition-colors">
                    <td className="px-3 py-2.5">
                      <Link href={`/stock/${r.symbol}`} className="font-semibold hover:underline">
                        {r.symbol}
                      </Link>
                      <div className="text-[10.5px] muted-text truncate max-w-[190px]">
                        {displayCompanyName(r.company_name ?? "", r.symbol)}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 muted-text truncate max-w-[150px]">{r.sector ?? "—"}</td>
                    <td className="px-2 py-2.5 muted-text truncate max-w-[170px]">{r.peer_group ?? "—"}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {r.current_price == null ? "—" : `₹${r.current_price.toLocaleString("en-IN")}`}
                    </td>
                    {[r.ret_1d, r.ret_1w, r.ret_1m, r.ret_1y].map((v, i) => {
                      const s = retFmt(v);
                      return (
                        <td key={i} className="px-2 py-2.5 text-right tabular-nums font-medium" style={{ color: s.color }}>
                          {s.text}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2.5 text-right tabular-nums font-semibold" style={{ color: scoreColor(r.composite_pct) }}>
                      {r.composite_pct == null ? "—" : r.composite_pct}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums muted-text">
                      {r.composite_rank == null ? "—" : `#${r.composite_rank}`}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="inline-flex transition-opacity" style={{ opacity: spark.loading ? 0.4 : 1 }}>
                        <RowSparkline series={spark.data[r.symbol]} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 pb-3">
            <Pager {...pager} noun="stocks" />
          </div>
        </div>
      )}

      <section className="mt-8 card p-5 max-w-[820px]">
        <div className="text-[11px] uppercase tracking-wide muted-text mb-2">About this tab</div>
        <p className="text-[13.5px] leading-[1.55]">
          The whole scored universe in one place — sort by any column (click a header to toggle
          ascending / descending) and page through 30 at a time. <strong>1W / 1M / 1Y</strong> come
          from the weekly scoring panel; <strong>1D</strong> is the latest daily close vs. the prior
          one. <strong>Score</strong> is the fundamental Industry-Score percentile and{" "}
          <strong>Rank</strong> is that score turned into an absolute market position (#1 = best,
          fixed across sorts and the universe toggle). <strong>Trend</strong> is a split-adjusted mini
          price chart — switch it between 3M and 5Y with the toggle above. Use the All-NSE /
          NIFTY-500 toggle on the left to switch the universe.
        </p>
      </section>
    </>
  );
}
