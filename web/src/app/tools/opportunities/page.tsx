"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { tierLabel, displayCompanyName } from "@/lib/score";

// ── Types ─────────────────────────────────────────────────────────────────────

type IndexFilter = "" | "n50" | "n100" | "n200" | "n500";

type NiftyReturns = {
  ret_1m: number | null;
  ret_3m: number | null;
  ret_6m: number | null;
  ret_1y: number | null;
};

type Benchmarks = {
  n50:  NiftyReturns;
  n100: NiftyReturns;
  n200: NiftyReturns;
  n500: NiftyReturns;
};

type Opportunity = {
  symbol: string;
  company_name: string;
  industry_id: string;
  industry_name: string;
  sector_id: string;
  sector_name: string;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  composite_pct: number | null;
  peer_rank: number | null;
  peer_count: number | null;
  is_nifty50: boolean;
  is_nifty100: boolean;
  is_nifty200: boolean;
  is_nifty500: boolean;
  ret_1m_rel: number | null;
  ret_3m_rel: number | null;
  ret_6m_rel: number | null;
  ret_12m_rel: number | null;
  ema_stack_bull: boolean | null;
  // Actual historical prices from golden.price_history
  price_1m_ago: number | null;
  price_3m_ago: number | null;
  price_6m_ago: number | null;
  price_1y_ago: number | null;
  // Recovery signals computed from golden.price_history OHLCV
  above_200sma: boolean | null;
  off_52w_low_pct: number | null;    // (current - 252-session low) / low
  accum_ratio_20d: number | null;    // up-day volume / down-day volume, last 20 sessions
  // Fundamentals
  np_yoy_q: number | null;           // latest quarter net profit YoY growth
  // Latest exchange filing (BSE) — inline headline
  filing_title: string | null;
  filing_category: string | null;
  filing_date: string | null;
  filing_url: string | null;
};

type SortKey = "symbol" | "mcap" | "ret_1m" | "ret_3m" | "ret_6m" | "ret_12m" | "composite";
type SortDir = "asc" | "desc";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute absolute price return directly from anchor and current prices.
 *  Consistent with the "from ₹X" sub-text shown in each cell. */
function priceReturn(current: number | null, anchor: number | null): number | null {
  return current != null && anchor != null && anchor > 0
    ? (current - anchor) / anchor
    : null;
}

// ── Recovery signals ──────────────────────────────────────────────────────────

/** Price-action recovery signals (0–5). */
function recoverySignals(r: Opportunity) {
  return [
    { key: "sma",   label: "Above 200-day SMA",            active: r.above_200sma === true },
    { key: "vol",   label: "Volume accumulation (20d)",    active: (r.accum_ratio_20d ?? 0) > 1.2 },
    { key: "ema",   label: "Short-term EMA stack bullish", active: r.ema_stack_bull === true },
    { key: "low",   label: "Off 52W low > 5%",             active: (r.off_52w_low_pct ?? 0) > 0.05 },
    { key: "rel1m", label: "Outperforming index (1M)",     active: (r.ret_1m_rel ?? -1) > 0 },
  ];
}

/** Count of firing price-action signals (0–5). */
function recoveryScore(r: Opportunity): number {
  return recoverySignals(r).filter((s) => s.active).length;
}

/** True when latest quarter net profit grew YoY — fundamentals backing price recovery. */
function earningsGrowing(r: Opportunity): boolean {
  return (r.np_yoy_q ?? -Infinity) > 0;
}

// ── Return cell ───────────────────────────────────────────────────────────────

function styleReturn(val: number | null): { text: string; color: string; bg: string } {
  if (val == null) return { text: "—", color: "var(--color-muted)", bg: "transparent" };
  const pct = val * 100;
  const text = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  if (pct <= -30) return { text, color: "#7f1d1d", bg: "rgba(220,38,38,0.18)" };
  if (pct <= -20) return { text, color: "#991b1b", bg: "rgba(220,38,38,0.12)" };
  if (pct <= -10) return { text, color: "#b45309", bg: "rgba(217,119,6,0.11)" };
  if (pct <= -3)  return { text, color: "#92400e", bg: "rgba(180,100,30,0.07)" };
  if (pct >= 10)  return { text, color: "var(--color-score-good)", bg: "rgba(22,163,74,0.09)" };
  return { text, color: "var(--color-muted)", bg: "transparent" };
}

function ReturnCell({ value, fromPrice }: { value: number | null; fromPrice: number | null }) {
  const s = styleReturn(value);
  return (
    <td className="px-4 py-3 text-right tabular-nums">
      {value == null
        ? <span className="muted-text text-[12px]">—</span>
        : (
          <div className="inline-flex flex-col items-end gap-0.5">
            <span
              className="inline-block rounded-md px-2.5 py-1 text-[12.5px] font-semibold"
              style={{ background: s.bg, color: s.color }}
            >
              {s.text}
            </span>
            {fromPrice != null && (
              <span className="text-[9.5px] muted-text tabular-nums">
                from ₹{fromPrice.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </span>
            )}
          </div>
        )
      }
    </td>
  );
}

// ── Sort ──────────────────────────────────────────────────────────────────────

function sortVal(r: Opportunity, k: SortKey): number | string | null {
  switch (k) {
    case "symbol":    return r.symbol;
    case "mcap":      return r.market_cap_cr;
    case "ret_1m":    return priceReturn(r.current_price, r.price_1m_ago);
    case "ret_3m":    return priceReturn(r.current_price, r.price_3m_ago);
    case "ret_6m":    return priceReturn(r.current_price, r.price_6m_ago);
    case "ret_12m":   return priceReturn(r.current_price, r.price_1y_ago);
    case "composite": return r.composite_pct;
  }
}

function sortRows(rows: Opportunity[], k: SortKey, dir: SortDir): Opportunity[] {
  const d = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = sortVal(a, k), bv = sortVal(b, k);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return d * (av < bv ? -1 : av > bv ? 1 : 0);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  const [rows, setRows]           = useState<Opportunity[]>([]);
  const [benchmarks, setBenchmarks] = useState<Benchmarks | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [recoveryWatch, setRecoveryWatch] = useState(false);
  const [indexFilter, setIndexFilter]     = useState<IndexFilter>("n50");
  const [sortKey, setSortKey]     = useState<SortKey>("ret_6m");
  const [sortDir, setSortDir]     = useState<SortDir>("asc"); // worst performers first

  useEffect(() => {
    fetch("/api/opportunities")
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((data: { rows: Opportunity[]; benchmarks: Benchmarks }) => {
        setRows(data.rows);
        setBenchmarks(data.benchmarks);
        setLoading(false);
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false); });
  }, []);

  // Core screen: Q ≥ 55, V ≥ 50, M ≤ 50
  const base = useMemo(() =>
    rows.filter((r) =>
      (r.quality_pct   ?? 0) >= 55 &&
      (r.valuation_pct ?? 0) >= 50 &&
      (r.momentum_pct  ?? 100) <= 50
    ), [rows]
  );

  // Apply index + recovery watch filters
  const filtered = useMemo(() => {
    let out = base;
    if (indexFilter === "n50")  out = out.filter((r) => r.is_nifty50);
    if (indexFilter === "n100") out = out.filter((r) => r.is_nifty100);
    if (indexFilter === "n200") out = out.filter((r) => r.is_nifty200);
    if (indexFilter === "n500") out = out.filter((r) => r.is_nifty500);
    if (recoveryWatch)          out = out.filter((r) => recoveryScore(r) >= 2);
    return out;
  }, [base, indexFilter, recoveryWatch]);

  const sorted = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(k);
      // Return columns: asc = worst performers first (the most corrected)
      // Price/Mcap: desc = largest first
      setSortDir(k === "symbol" ? "asc" : k.startsWith("ret") ? "asc" : "desc");
    }
  }

  const recoveryCount = useMemo(() => base.filter((r) => recoveryScore(r) >= 2).length, [base]);

  return (
    <div className="theme-indigo mx-auto max-w-[1100px] px-4 md:px-6 py-8 md:py-10">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[12px] uppercase tracking-wide muted-text flex items-center gap-2 mb-2">
            <Link href="/tools" className="hover:underline">Tools</Link>
            <span aria-hidden style={{ color: "var(--color-border-default)" }}>›</span>
            <span>Correction Opportunities</span>
          </div>
          <h1 className="font-display text-[30px] tracking-tight leading-tight">
            Strong businesses,{" "}
            <em className="accent">temporarily beaten down</em>
          </h1>
          <p className="mt-1.5 text-[13.5px] muted-text max-w-[560px]">
            Fundamentally strong stocks (Quality ≥ 55, Valuation ≥ 50) that have
            sold off. The return columns are absolute price change over each window;
            the benchmark strip below shows how the index moved over the same
            periods, for comparison.
          </p>
        </div>

        {/* Recovery Watch toggle */}
        <div className="shrink-0 pt-6">
          <button
            onClick={() => setRecoveryWatch((v) => !v)}
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-2 transition-all text-[13px] font-medium"
            style={recoveryWatch
              ? { borderColor: "#16a34a", background: "rgba(22,163,74,0.10)", color: "#15803d" }
              : { borderColor: "var(--color-border-default)", background: "var(--color-card)", color: "var(--color-muted)" }
            }
          >
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${recoveryWatch ? "animate-livepulse" : ""}`}
              style={{ background: recoveryWatch ? "#16a34a" : "var(--color-border-default)" }}
            />
            Recovery Watch
            <span
              className="px-1.5 py-0.5 rounded-full text-[10.5px] font-semibold"
              style={{ background: "rgba(22,163,74,0.15)", color: "#15803d" }}
            >
              {recoveryCount}
            </span>
          </button>
          <p className="mt-1.5 text-[10.5px] muted-text max-w-[200px] text-right">
            {recoveryWatch
              ? "≥ 2 of 5 recovery signals firing"
              : "Show only stocks where sell-off is easing"}
          </p>
        </div>
      </div>

      {/* ── Index filter chips ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(
          [
            { key: "" as IndexFilter,     label: "All NSE" },
            { key: "n50"  as IndexFilter, label: "Nifty 50" },
            { key: "n100" as IndexFilter, label: "Nifty 100" },
            { key: "n200" as IndexFilter, label: "Nifty 200" },
            { key: "n500" as IndexFilter, label: "Nifty 500" },
          ] as const
        ).map(({ key, label }) => {
          const active = indexFilter === key;
          return (
            <button
              key={key}
              onClick={() => setIndexFilter(key)}
              className="px-3 py-1 rounded-full border text-[12px] font-medium transition-colors"
              style={active
                ? { background: "var(--color-accent-600)", color: "white", borderColor: "var(--color-accent-600)" }
                : { background: "var(--color-card)", color: "var(--color-muted)", borderColor: "var(--color-border-default)" }
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Benchmark strip — matches active index filter ──────────────── */}
      {!loading && !error && benchmarks && (
        <BenchmarkStrip
          nifty={
            indexFilter === "n50"  ? benchmarks.n50  :
            indexFilter === "n100" ? benchmarks.n100 :
            indexFilter === "n200" ? benchmarks.n200 :
            benchmarks.n500
          }
          indexFilter={indexFilter}
        />
      )}

      {/* ── Count ──────────────────────────────────────────────────────── */}
      {!loading && !error && (
        <div className="mb-3 text-[12px] muted-text flex items-center gap-3">
          <span>
            <span className="font-medium ink-text">{sorted.length}</span> stock{sorted.length !== 1 ? "s" : ""}
          </span>
          {recoveryWatch && (
            <button onClick={() => setRecoveryWatch(false)} className="underline hover:no-underline">
              ← Show all {base.length}
            </button>
          )}
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="card p-16 text-center muted-text">Loading…</div>
      ) : error ? (
        <div className="card p-12 text-center" style={{ color: "var(--color-score-poor)" }}>{error}</div>
      ) : sorted.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="font-display text-[18px] mb-2">No matches</div>
          <p className="muted-text text-[13px]">No stocks with recovery signals right now.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr
                  className="text-left text-[10.5px] uppercase tracking-wide muted-text"
                  style={{ background: "var(--color-paper)", borderBottom: "2px solid var(--color-border-default)" }}
                >
                  <th className="px-4 py-3 w-8 text-center">#</th>
                  <Th k="symbol"  label="Stock"  onSort={toggleSort} sortKey={sortKey} sortDir={sortDir} align="left" />
                  <Th k="mcap"    label="Mcap" sub="₹ Cr" onSort={toggleSort} sortKey={sortKey} sortDir={sortDir} />
                  <Th k="ret_1m"    label="1M"  onSort={toggleSort} sortKey={sortKey} sortDir={sortDir}
                    title="1-month absolute price return" />
                  <Th k="ret_3m"    label="3M"  onSort={toggleSort} sortKey={sortKey} sortDir={sortDir}
                    title="3-month absolute price return" />
                  <Th k="ret_6m"    label="6M"  onSort={toggleSort} sortKey={sortKey} sortDir={sortDir}
                    title="6-month absolute price return" />
                  <Th k="ret_12m"   label="12M" onSort={toggleSort} sortKey={sortKey} sortDir={sortDir}
                    title="12-month absolute price return" />
                  <Th k="composite" label="Score" sub="peer %" onSort={toggleSort} sortKey={sortKey} sortDir={sortDir}
                    title="Industry Score percentile (0–100) within peer cluster · peer rank shown below" align="center" />
                </tr>
              </thead>

              <tbody>
                {sorted.map((r, i) => {
                  const score = recoveryScore(r);
                  return (
                    <tr key={r.symbol} className="border-t hairline hover:bg-[var(--color-paper)]/50">

                      <td className="px-4 py-3 text-center muted-text text-[11px] tabular-nums">{i + 1}</td>

                      {/* Stock — symbol + name + industry·tier + current price */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/stock/${r.symbol}`}
                            className="font-semibold text-[13px] hover:text-[var(--color-accent-600)]"
                          >
                            {r.symbol}
                          </Link>
                        </div>
                        <div className="text-[11px] muted-text truncate max-w-[200px] mt-0.5">
                          {displayCompanyName(r.company_name, r.symbol)}
                        </div>
                        <div className="text-[10.5px] muted-text mt-0.5">
                          <Link href={`/industry/${r.industry_id}`} className="hover:text-[var(--color-accent-600)]">
                            {r.industry_name}
                          </Link>
                          <span className="mx-1">·</span>
                          <span>{tierLabel(r.maturity_tier)}</span>
                        </div>
                        {r.current_price != null && (
                          <div className="text-[12px] font-semibold ink-text mt-1 tabular-nums">
                            ₹{r.current_price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                          </div>
                        )}
                        {(score > 0 || earningsGrowing(r)) && (
                          <RecoveryBadge
                            signals={recoverySignals(r)}
                            score={score}
                            earnings={earningsGrowing(r)}
                          />
                        )}
                        {/* Latest exchange filing — single most recent headline */}
                        {r.filing_title && (
                          <FilingLine
                            title={r.filing_title}
                            category={r.filing_category}
                            date={r.filing_date}
                            url={r.filing_url}
                            symbol={r.symbol}
                          />
                        )}
                      </td>

                      {/* Mcap */}
                      <td className="px-4 py-3 text-right tabular-nums muted-text text-[12px]">
                        {fmtCr(r.market_cap_cr)}
                      </td>

                      {/* Return columns — absolute % pill + actual historical price from golden */}
                      <ReturnCell value={priceReturn(r.current_price, r.price_1m_ago)} fromPrice={r.price_1m_ago} />
                      <ReturnCell value={priceReturn(r.current_price, r.price_3m_ago)} fromPrice={r.price_3m_ago} />
                      <ReturnCell value={priceReturn(r.current_price, r.price_6m_ago)} fromPrice={r.price_6m_ago} />
                      <ReturnCell value={priceReturn(r.current_price, r.price_1y_ago)} fromPrice={r.price_1y_ago} />

                      {/* Composite score + peer rank */}
                      <CompositePill
                        score={r.composite_pct}
                        peerRank={r.peer_rank}
                        peerCount={r.peer_count}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Legend ─────────────────────────────────────────────────────── */}
      {!loading && !error && sorted.length > 0 && (
        <div
          className="mt-4 rounded-lg border p-4"
          style={{ background: "var(--color-paper)", borderColor: "var(--color-border-default)" }}
        >
          <p className="text-[10.5px] uppercase tracking-wide font-semibold muted-text mb-3">
            How to read this table
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">

            {/* Return colours */}
            <div>
              <p className="text-[11px] font-semibold ink-text mb-1.5">Return colour scale</p>
              <div className="flex flex-col gap-1">
                {[
                  { bg: "rgba(220,38,38,0.18)",  color: "#7f1d1d", label: "> 30% fall" },
                  { bg: "rgba(220,38,38,0.12)",  color: "#991b1b", label: "> 20% fall" },
                  { bg: "rgba(217,119,6,0.11)",  color: "#b45309", label: "> 10% fall" },
                  { bg: "rgba(22,163,74,0.09)",  color: "var(--color-score-good)", label: "> 10% gain" },
                ].map(({ bg, color, label }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span
                      className="inline-block rounded px-2 py-0.5 text-[10px] font-semibold tabular-nums w-14 text-center"
                      style={{ background: bg, color }}
                    >
                      −XX%
                    </span>
                    <span className="text-[11px] muted-text">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recovery signals */}
            <div>
              <p className="text-[11px] font-semibold ink-text mb-1.5">Recovery signal chips</p>
              <div className="flex flex-col gap-1.5">
                {[
                  { chip: "SMA",  bg: "#475569", color: "#fff", desc: "Price above 200-day moving average" },
                  { chip: "VOL",  bg: "#475569", color: "#fff", desc: "Buying volume > selling volume (20 days)" },
                  { chip: "EMA",  bg: "#475569", color: "#fff", desc: "Short-term EMAs re-stacking upward" },
                  { chip: "52W",  bg: "#475569", color: "#fff", desc: "Price > 5% above 52-week low" },
                  { chip: "1M↑",  bg: "#475569", color: "#fff", desc: "Outperforming the index this month" },
                  { chip: "Q↑",   bg: "#4f46e5", color: "#fff", desc: "Latest quarter profit grew YoY (fundamentals)" },
                ].map(({ chip, color, bg, desc }) => (
                  <div key={chip} className="flex items-center gap-2">
                    <span
                      className="inline-block text-[9px] font-bold px-1.5 py-[2px] rounded shrink-0 w-9 text-center tracking-wide"
                      style={{ background: bg, color }}
                    >
                      {chip}
                    </span>
                    <span className="text-[11px] muted-text">{desc}</span>
                  </div>
                ))}
                {/* Chips are on/off labels — strength is the N/5 colour, not the chip colour */}
                <div className="flex items-center gap-2 mt-1 pt-1.5" style={{ borderTop: "1px solid var(--color-border-default)" }}>
                  <span className="inline-block text-[9px] font-semibold w-9 text-center tabular-nums shrink-0">N/5</span>
                  <span className="text-[11px] muted-text">
                    Price-signal score — colour shows strength:{" "}
                    <span style={{ color: "#15803d" }} className="font-semibold">4–5</span> ·{" "}
                    <span style={{ color: "#b45309" }} className="font-semibold">2–3</span> ·{" "}
                    <span style={{ color: "#6b7280" }} className="font-semibold">1</span>. Hover to see what&apos;s not firing.
                  </span>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCr(n: number | null): string {
  if (n == null) return "—";
  if (n >= 100_000) return `${(n / 100_000).toFixed(2)}L`;
  if (n >= 1_000)   return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-IN");
}

function Th({
  k, label, sub, onSort, sortKey, sortDir, align = "right", title,
}: {
  k: SortKey; label: string; sub?: string;
  onSort: (k: SortKey) => void;
  sortKey: SortKey; sortDir: SortDir;
  align?: "left" | "right" | "center"; title?: string;
}) {
  const active = sortKey === k;
  const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  const textAlign = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const itemsAlign = align === "right" ? "items-end" : align === "center" ? "items-center" : "items-start";
  return (
    <th
      onClick={() => onSort(k)}
      title={title}
      className={`px-4 py-3 cursor-pointer select-none whitespace-nowrap text-[10.5px] uppercase tracking-wide ${textAlign} ${active ? "ink-text" : "muted-text"}`}
    >
      <div className={`flex flex-col ${itemsAlign}`}>
        <span>{label}{arrow}</span>
        {sub && <span className="text-[9px] normal-case font-normal">{sub}</span>}
      </div>
    </th>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function CompositePill({
  score, peerRank, peerCount,
}: {
  score: number | null;
  peerRank: number | null;
  peerCount: number | null;
}) {
  if (score == null) {
    return (
      <td className="px-4 py-3 text-center">
        <span className="muted-text text-[12px]">—</span>
      </td>
    );
  }

  let color: string, bg: string;
  if      (score >= 70) { color = "var(--color-score-good)"; bg = "rgba(22,163,74,0.10)"; }
  else if (score >= 50) { color = "#ca8a04";                 bg = "rgba(202,138,4,0.10)"; }
  else if (score >= 30) { color = "#ea580c";                 bg = "rgba(234,88,12,0.10)"; }
  else                  { color = "var(--color-score-poor)"; bg = "rgba(220,38,38,0.10)"; }

  const rankText = peerRank != null && peerCount != null
    ? `${ordinal(peerRank)} of ${peerCount}`
    : null;

  return (
    <td className="px-4 py-3 text-center">
      <div className="flex flex-col items-center gap-0.5">
        <span
          className="inline-block rounded-md px-2.5 py-1 text-[12.5px] font-semibold tabular-nums"
          style={{ background: bg, color }}
        >
          {Math.round(score)}
        </span>
        {rankText && (
          <span className="text-[10px] muted-text tabular-nums">{rankText}</span>
        )}
      </div>
    </td>
  );
}

// ── Recovery badge ────────────────────────────────────────────────────────────

type SignalState = { key: string; label: string; active: boolean };

/**
 * Shows a score pill (e.g. "↗ 3/5") + 5 coloured dots, one per recovery signal.
 * Each dot has a tooltip (title) naming the signal. Colour scales with score.
 */
// Short labels shown inside each signal chip — must match the order in recoverySignals().
const SIGNAL_LABELS: Record<string, string> = {
  sma:   "SMA",
  vol:   "VOL",
  ema:   "EMA",
  low:   "52W",
  rel1m: "1M↑",
};

function RecoveryBadge({
  signals, score, earnings,
}: {
  signals: SignalState[];
  score: number;
  earnings: boolean;
}) {
  // Chips are pure on/off labels — one neutral colour, no per-chip meaning.
  // Strength is carried only by the N/5 score text below.
  const CHIP_BG = "#475569"; // slate-600
  const scoreColor =
    score >= 4 ? "#15803d" :   // green — strong
    score >= 2 ? "#b45309" :   // amber — building
    "#6b7280";                 // gray  — weak

  const inactive = signals.filter((s) => !s.active);
  const inactiveTitle = inactive.length
    ? "Not firing: " + inactive.map((s) => s.label).join(" · ")
    : "All price signals firing";

  return (
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      {/* Active price-action chips — neutral slate, label-only */}
      {signals.filter((s) => s.active).map((s) => (
        <span
          key={s.key}
          title={s.label}
          className="inline-block text-[9px] font-bold px-1.5 py-[2px] rounded cursor-default tracking-wide select-none"
          style={{ background: CHIP_BG, color: "#fff" }}
        >
          {SIGNAL_LABELS[s.key] ?? s.key.toUpperCase()}
        </span>
      ))}
      {/* Price score — colour encodes strength; hover lists what's not firing */}
      {score > 0 && (
        <span
          className="text-[9px] font-semibold tabular-nums cursor-default"
          style={{ color: scoreColor }}
          title={inactiveTitle}
        >
          {score}/5
        </span>
      )}
      {/* Earnings chip — indigo, separate from price signals */}
      {earnings && (
        <span
          title="Latest quarter net profit grew YoY — fundamentals backing the recovery"
          className="inline-block text-[9px] font-bold px-1.5 py-[2px] rounded cursor-default tracking-wide select-none"
          style={{ background: "#4f46e5", color: "#fff" }}
        >
          Q↑
        </span>
      )}
    </div>
  );
}

// ── Latest filing line ────────────────────────────────────────────────────────

/** Colour a BSE category so the filing type scans at a glance. */
function filingCatColor(category: string | null): string {
  const c = (category || "").toLowerCase();
  if (c.includes("result"))   return "var(--color-score-good)";
  if (c.includes("board"))    return "var(--color-accent-600)";
  if (c.includes("dividend")) return "var(--color-accent-700)";
  if (c.includes("insider") || c.includes("sast")) return "var(--color-score-weak)";
  return "var(--color-muted)";
}

function fmtFilingDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * One-line latest exchange filing under each stock. Links straight to the BSE
 * PDF when available (the actual document), else to the stock's filings feed.
 * Truncates to a single line so the row stays compact.
 */
function FilingLine({
  title, category, date, url, symbol,
}: {
  title: string;
  category: string | null;
  date: string | null;
  url: string | null;
  symbol: string;
}) {
  const color = filingCatColor(category);
  const when  = fmtFilingDate(date);
  const href  = url ?? `/stock/${symbol}#announcements`;
  const external = !!url;

  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      title={title}
      className="group mt-1.5 flex items-center gap-1.5 max-w-[240px] hover:text-[var(--color-accent-600)]"
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color }}
        aria-hidden
      />
      {when && (
        <span className="text-[9.5px] muted-text tabular-nums shrink-0">{when}</span>
      )}
      <span className="text-[10px] muted-text truncate group-hover:text-[var(--color-accent-600)]">
        {title}
      </span>
    </a>
  );
}

// ── Benchmark strip ───────────────────────────────────────────────────────────

function fmtIndexReturn(v: number | null): { text: string; color: string } {
  if (v == null) return { text: "—", color: "var(--color-muted)" };
  const pct = v * 100;
  const text = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  const color = pct >= 0 ? "var(--color-score-good)" : "#dc2626";
  return { text, color };
}

const BENCHMARK_LABEL: Record<IndexFilter, string> = {
  "n50":  "Nifty 50",
  "n100": "Nifty 100",
  "n200": "Nifty 100",   // NIFTY200 price history not tracked; Nifty 100 is closest proxy
  "n500": "Nifty 500",
  "":     "Nifty 500",
};

function BenchmarkStrip({ nifty, indexFilter }: { nifty: NiftyReturns; indexFilter: IndexFilter }) {
  const items: { label: string; value: number | null }[] = [
    { label: "1M",  value: nifty.ret_1m },
    { label: "3M",  value: nifty.ret_3m },
    { label: "6M",  value: nifty.ret_6m },
    { label: "1Y",  value: nifty.ret_1y },
  ];
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-4 py-2.5"
      style={{ background: "var(--color-paper)", borderColor: "var(--color-border-default)" }}
    >
      <span className="text-[11px] uppercase tracking-wide muted-text font-medium whitespace-nowrap">
        {BENCHMARK_LABEL[indexFilter]} (benchmark)
      </span>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map(({ label, value }) => {
          const { text, color } = fmtIndexReturn(value);
          return (
            <span key={label} className="flex items-baseline gap-1.5">
              <span className="text-[11px] muted-text">{label}</span>
              <span className="text-[13px] font-semibold tabular-nums" style={{ color }}>{text}</span>
            </span>
          );
        })}
      </div>
      <span className="text-[10.5px] muted-text ml-auto hidden sm:block">
        Stock columns show return <em>relative to this index</em>
      </span>
    </div>
  );
}
