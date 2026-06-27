"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { tierLabel, displayCompanyName } from "@/lib/score";

// ── Types ─────────────────────────────────────────────────────────────────────

type IndexFilter = "" | "n50" | "n200" | "n500";

type NiftyReturns = {
  ret_1m: number | null;
  ret_3m: number | null;
  ret_6m: number | null;
  ret_1y: number | null;
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
  is_nifty200: boolean;
  is_nifty500: boolean;
  ret_1m_rel: number | null;
  ret_3m_rel: number | null;
  ret_6m_rel: number | null;
  ret_12m_rel: number | null;
  ema_stack_bull: boolean | null;
};

type SortKey = "symbol" | "mcap" | "price" | "ret_1m" | "ret_3m" | "ret_6m" | "ret_12m" | "composite";
type SortDir = "asc" | "desc";

// ── Return cell ───────────────────────────────────────────────────────────────

function styleReturn(rel: number | null): { text: string; color: string; bg: string } {
  if (rel == null) return { text: "—", color: "var(--color-muted)", bg: "transparent" };
  const pct = rel * 100;
  const text = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  if (pct <= -30) return { text, color: "#7f1d1d", bg: "rgba(220,38,38,0.18)" };
  if (pct <= -20) return { text, color: "#991b1b", bg: "rgba(220,38,38,0.12)" };
  if (pct <= -10) return { text, color: "#b45309", bg: "rgba(217,119,6,0.11)" };
  if (pct <= -3)  return { text, color: "#92400e", bg: "rgba(180,100,30,0.07)" };
  if (pct >= 10)  return { text, color: "var(--color-score-good)", bg: "rgba(22,163,74,0.09)" };
  return { text, color: "var(--color-muted)", bg: "transparent" };
}

function ReturnCell({ value }: { value: number | null }) {
  const s = styleReturn(value);
  return (
    <td className="px-4 py-3 text-right tabular-nums">
      {value == null
        ? <span className="muted-text text-[12px]">—</span>
        : (
          <span
            className="inline-block rounded-md px-2.5 py-1 text-[12.5px] font-semibold"
            style={{ background: s.bg, color: s.color }}
          >
            {s.text}
          </span>
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
    case "price":     return r.current_price;
    case "ret_1m":    return r.ret_1m_rel;
    case "ret_3m":    return r.ret_3m_rel;
    case "ret_6m":    return r.ret_6m_rel;
    case "ret_12m":   return r.ret_12m_rel;
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
  const [nifty, setNifty]         = useState<NiftyReturns | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [recoveryWatch, setRecoveryWatch] = useState(false);
  const [indexFilter, setIndexFilter]     = useState<IndexFilter>("n50");
  const [sortKey, setSortKey]     = useState<SortKey>("ret_6m");
  const [sortDir, setSortDir]     = useState<SortDir>("asc"); // worst performers first

  useEffect(() => {
    fetch("/api/opportunities")
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((data: { rows: Opportunity[]; nifty: NiftyReturns }) => {
        setRows(data.rows);
        setNifty(data.nifty);
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
    if (indexFilter === "n200") out = out.filter((r) => r.is_nifty200);
    if (indexFilter === "n500") out = out.filter((r) => r.is_nifty500);
    if (recoveryWatch)          out = out.filter((r) => r.ema_stack_bull === true);
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

  const recoveryCount = useMemo(() => base.filter((r) => r.ema_stack_bull === true).length, [base]);

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
            underperformed the index. Returns show how much each stock fell relative
            to the benchmark — not absolute price change.
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
              ? "Price EMAs re-stacking upward"
              : "Show only stocks where sell-off is easing"}
          </p>
        </div>
      </div>

      {/* ── Index filter chips ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(
          [
            { key: "" as IndexFilter,    label: "All NSE" },
            { key: "n50"  as IndexFilter, label: "Nifty 50" },
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

      {/* ── Nifty 500 benchmark strip ──────────────────────────────────── */}
      {!loading && !error && nifty && (
        <BenchmarkStrip nifty={nifty} />
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
                  <Th k="symbol"  label="Stock"        onSort={toggleSort} sortKey={sortKey} sortDir={sortDir} align="left" />
                  <th className="px-4 py-3 hidden md:table-cell">Industry · Tier</th>
                  <Th k="mcap"      label="Mcap" sub="₹ Cr"     onSort={toggleSort} sortKey={sortKey} sortDir={sortDir} />
                  <Th k="price"     label="Price" sub="₹"        onSort={toggleSort} sortKey={sortKey} sortDir={sortDir} />
                  <Th k="ret_1m"    label="1M" sub="vs index"    onSort={toggleSort} sortKey={sortKey} sortDir={sortDir}
                    title="1-month price return vs benchmark index" />
                  <Th k="ret_3m"    label="3M" sub="vs index"    onSort={toggleSort} sortKey={sortKey} sortDir={sortDir}
                    title="3-month price return vs benchmark index" />
                  <Th k="ret_6m"    label="6M" sub="vs index"    onSort={toggleSort} sortKey={sortKey} sortDir={sortDir}
                    title="6-month price return vs benchmark index" />
                  <Th k="ret_12m"   label="12M" sub="vs index"   onSort={toggleSort} sortKey={sortKey} sortDir={sortDir}
                    title="12-month price return vs benchmark index" />
                  <Th k="composite" label="Score" sub="peer %" onSort={toggleSort} sortKey={sortKey} sortDir={sortDir}
                    title="Industry Score percentile (0–100) within peer cluster · peer rank shown below" align="center" />
                </tr>
              </thead>

              <tbody>
                {sorted.map((r, i) => {
                  const recovering = r.ema_stack_bull === true;
                  return (
                    <tr key={r.symbol} className="border-t hairline hover:bg-[var(--color-paper)]/50">

                      <td className="px-4 py-3 text-center muted-text text-[11px] tabular-nums">{i + 1}</td>

                      {/* Stock */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/stock/${r.symbol}`}
                            className="font-semibold text-[13px] hover:text-[var(--color-accent-600)]"
                          >
                            {r.symbol}
                          </Link>
                          {recovering && (
                            <span
                              className="text-[9.5px] px-1.5 py-px rounded-full font-semibold"
                              style={{ background: "rgba(22,163,74,0.14)", color: "#15803d" }}
                              title="Short-term EMA stack turning bullish — early recovery signal"
                            >
                              ↗ recovering
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] muted-text truncate max-w-[180px] mt-0.5">
                          {displayCompanyName(r.company_name, r.symbol)}
                        </div>
                      </td>

                      {/* Industry */}
                      <td className="px-4 py-3 text-[11.5px] hidden md:table-cell">
                        <Link href={`/industry/${r.industry_id}`} className="hover:text-[var(--color-accent-600)]">
                          {r.industry_name}
                        </Link>
                        <div className="muted-text text-[10.5px] mt-0.5">{tierLabel(r.maturity_tier)}</div>
                      </td>

                      {/* Mcap */}
                      <td className="px-4 py-3 text-right tabular-nums muted-text text-[12px]">
                        {fmtCr(r.market_cap_cr)}
                      </td>

                      {/* Price */}
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-[13px]">
                        {r.current_price != null
                          ? `₹${r.current_price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                          : <span className="muted-text font-normal">—</span>
                        }
                      </td>

                      {/* Return columns */}
                      <ReturnCell value={r.ret_1m_rel} />
                      <ReturnCell value={r.ret_3m_rel} />
                      <ReturnCell value={r.ret_6m_rel} />
                      <ReturnCell value={r.ret_12m_rel} />

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
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] muted-text">
          <div>Returns are <strong className="ink-text">relative to the benchmark index</strong> — negative = stock fell more than the market</div>
          <div>
            <span style={{ color: "#7f1d1d" }}>■</span> &gt;30% · {" "}
            <span style={{ color: "#991b1b" }}>■</span> &gt;20% · {" "}
            <span style={{ color: "#b45309" }}>■</span> &gt;10% underperformance vs index
          </div>
          <div>
            <span style={{ color: "#15803d" }} className="font-semibold">↗ recovering</span>
            {" "}= short-term EMAs re-stacking upward (early reversal signal)
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

// ── Benchmark strip ───────────────────────────────────────────────────────────

function fmtIndexReturn(v: number | null): { text: string; color: string } {
  if (v == null) return { text: "—", color: "var(--color-muted)" };
  const pct = v * 100;
  const text = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  const color = pct >= 0 ? "var(--color-score-good)" : "#dc2626";
  return { text, color };
}

function BenchmarkStrip({ nifty }: { nifty: NiftyReturns }) {
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
        Nifty 500 (benchmark)
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
