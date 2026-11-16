"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink, Search } from "lucide-react";
import type { ClusterVerdictRow } from "@/app/api/admin/cluster-verdicts/route";

export type ClusterTreeNode = {
  clusterId: string;
  clusterName: string;
  stockCount: number;
};

export type SectorTreeNode = {
  sectorName: string;
  stockCount: number;
  clusters: ClusterTreeNode[];
};

type GroupFilter = "all" | "actionable" | "watch" | "hold_avoid";

function fmtMoney(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function badgeClass(label: string): string {
  const u = label.toUpperCase();
  if (u.startsWith("ACCUMULATE")) {
    return "bg-emerald-100 text-emerald-800 border-emerald-300";
  }
  if (u.includes("IN ZONE")) {
    return "bg-teal-50 text-teal-800 border-teal-300";
  }
  if (u === "HOLD") {
    return "bg-blue-50 text-blue-800 border-blue-200";
  }
  if (u === "AVOID") {
    return "bg-rose-50 text-rose-800 border-rose-200";
  }
  return "bg-amber-50 text-amber-800 border-amber-200";
}

export function ClusterVerdictsClient({
  sectors,
  initialClusterId,
  initialItems,
}: {
  sectors: SectorTreeNode[];
  initialClusterId: string | null;
  initialItems: ClusterVerdictRow[];
}) {
  // Left panel starts completely collapsed to Sectors
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set());
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(initialClusterId);
  const [items, setItems] = useState<ClusterVerdictRow[]>(initialItems);
  const [loading, setLoading] = useState(false);

  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [minMcap, setMinMcap] = useState<number>(0);
  const [search, setSearch] = useState("");
  const [treeSearch, setTreeSearch] = useState("");

  const activeClusterMeta = useMemo(() => {
    for (const s of sectors) {
      const c = s.clusters.find((x) => x.clusterId === selectedClusterId);
      if (c) return { sectorName: s.sectorName, clusterName: c.clusterName };
    }
    return null;
  }, [sectors, selectedClusterId]);

  useEffect(() => {
    if (!selectedClusterId) return;
    if (selectedClusterId === initialClusterId && items === initialItems) return;

    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/admin/cluster-verdicts?clusterId=${selectedClusterId}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!controller.signal.aborted && json?.items) {
          setItems(json.items);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClusterId]);

  const toggleSector = (sectorName: string) => {
    setExpandedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(sectorName)) next.delete(sectorName);
      else next.add(sectorName);
      return next;
    });
  };

  const filteredTree = useMemo(() => {
    const q = treeSearch.trim().toLowerCase();
    if (!q) return sectors;
    return sectors
      .map((s) => ({
        ...s,
        clusters: s.clusters.filter(
          (c) => c.clusterName.toLowerCase().includes(q) || s.sectorName.toLowerCase().includes(q),
        ),
      }))
      .filter((s) => s.clusters.length > 0);
  }, [sectors, treeSearch]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (groupFilter !== "all" && item.action_group !== groupFilter) return false;
      if (minMcap > 0 && item.market_cap_cr < minMcap) return false;
      if (q) {
        const hay = `${item.symbol} ${item.company_name ?? ""} ${item.business_summary ?? ""} ${item.why}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, groupFilter, minMcap, search]);

  const counts = useMemo(() => {
    let actionable = 0;
    let watch = 0;
    let holdAvoid = 0;
    items.forEach((i) => {
      if (i.action_group === "actionable") actionable++;
      else if (i.action_group === "watch") watch++;
      else holdAvoid++;
    });
    return { all: items.length, actionable, watch, holdAvoid };
  }, [items]);

  const sections: { key: "actionable" | "watch" | "hold_avoid"; title: string; rows: ClusterVerdictRow[] }[] = useMemo(() => {
    const a = filteredItems.filter((i) => i.action_group === "actionable");
    const w = filteredItems.filter((i) => i.action_group === "watch");
    const h = filteredItems.filter((i) => i.action_group === "hold_avoid");
    return [
      { key: "actionable" as const, title: "1. Actionable Candidates (Accumulate / In Buy Zone)", rows: a },
      { key: "watch" as const, title: "2. Watchlist (Above Buy Zone / Wait for Dip or Turnaround)", rows: w },
      { key: "hold_avoid" as const, title: "3. Hold / Avoid", rows: h },
    ].filter((s) => s.rows.length > 0);
  }, [filteredItems]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-3 items-start">
      {/* Left Panel: Sectors -> Clusters (all collapsed to sectors by default) */}
      <aside className="rounded-md border hairline bg-[var(--color-card)] lg:sticky lg:top-3 lg:max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
        <div className="px-2.5 py-1.5 border-b hairline flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] font-semibold uppercase tracking-wide muted-text">
            Sectors &amp; clusters
          </span>
          <span className="text-[10px] muted-text tabular-nums">
            {sectors.length} · {sectors.reduce((n, s) => n + s.clusters.length, 0)}
          </span>
        </div>

        <div className="p-1.5 border-b hairline shrink-0">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 muted-text" />
            <input
              type="text"
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
              placeholder="Filter sector or cluster…"
              className="w-full pl-6 pr-2 py-1 text-[11.5px] rounded border hairline bg-transparent focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-1 space-y-0.5">
          {filteredTree.map((s) => {
            const open = !!treeSearch.trim() || expandedSectors.has(s.sectorName);
            return (
              <div key={s.sectorName}>
                <button
                  type="button"
                  onClick={() => toggleSector(s.sectorName)}
                  className="w-full flex items-center justify-between gap-1.5 px-1.5 py-1 rounded text-left text-[12px] font-medium hover:bg-[var(--color-paper)]"
                  aria-expanded={open}
                >
                  <span className="flex items-center gap-1 min-w-0">
                    {open ? (
                      <ChevronDown size={13} className="shrink-0 muted-text" />
                    ) : (
                      <ChevronRight size={13} className="shrink-0 muted-text" />
                    )}
                    <span className="truncate">{s.sectorName}</span>
                  </span>
                  <span className="text-[10px] muted-text tabular-nums shrink-0">
                    {s.clusters.length}
                  </span>
                </button>

                {open && (
                  <div className="pl-4 pr-0.5 py-0.5 space-y-0.5">
                    {s.clusters.map((c) => {
                      const active = c.clusterId === selectedClusterId;
                      return (
                        <button
                          key={c.clusterId}
                          type="button"
                          onClick={() => setSelectedClusterId(c.clusterId)}
                          className={`w-full flex items-center justify-between gap-1.5 px-2 py-1 rounded text-left text-[11.5px] transition-colors ${
                            active
                              ? "bg-slate-800 text-white font-medium"
                              : "hover:bg-[var(--color-paper)] muted-text hover:text-[var(--color-ink)]"
                          }`}
                        >
                          <span className="truncate">{c.clusterName}</span>
                          <span className={`text-[10px] tabular-nums shrink-0 ${active ? "text-slate-300" : "muted-text"}`}>
                            {c.stockCount}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main Content: Cluster-wise Verdict Board */}
      <section className="space-y-3 min-w-0">
        {/* Cluster Toolbar */}
        <div className="rounded-md border hairline bg-[var(--color-card)] p-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider muted-text font-semibold">
              {activeClusterMeta?.sectorName ?? "Select a cluster"}
            </div>
            <h2 className="text-[15px] font-semibold tracking-tight truncate">
              {activeClusterMeta?.clusterName ?? "Cluster Verdicts"}
              <span className="ml-2 text-[11.5px] font-normal muted-text tabular-nums">
                ({counts.all} stocks)
              </span>
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Group Filter Pills */}
            <div className="inline-flex rounded border hairline bg-[var(--color-paper)] p-0.5 text-[11.5px]">
              {(
                [
                  { k: "all", label: `All (${counts.all})` },
                  { k: "actionable", label: `Actionable (${counts.actionable})` },
                  { k: "watch", label: `Watch (${counts.watch})` },
                  { k: "hold_avoid", label: `Hold / Avoid (${counts.holdAvoid})` },
                ] as const
              ).map((t) => (
                <button
                  key={t.k}
                  type="button"
                  onClick={() => setGroupFilter(t.k)}
                  className={`px-2 py-0.5 rounded transition-colors whitespace-nowrap ${
                    groupFilter === t.k
                      ? "bg-[var(--color-card)] font-semibold shadow-2xs"
                      : "muted-text hover:text-[var(--color-ink)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Min MCap */}
            <select
              value={minMcap}
              onChange={(e) => setMinMcap(Number(e.target.value))}
              className="px-2 py-1 text-[11.5px] rounded border hairline bg-[var(--color-card)]"
              aria-label="Minimum market cap"
            >
              <option value={0}>All MCap</option>
              <option value={500}>MCap ≥ ₹500 Cr</option>
              <option value={1000}>MCap ≥ ₹1,000 Cr</option>
            </select>

            {/* Search */}
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 muted-text" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter stocks or moat…"
                className="pl-6 pr-2 py-1 text-[11.5px] rounded border hairline bg-[var(--color-card)] w-40"
              />
            </div>
          </div>
        </div>

        {/* Verdict Tables */}
        {loading ? (
          <div className="rounded-md border hairline bg-[var(--color-card)] p-8 text-center text-[12.5px] muted-text">
            Loading cluster verdicts…
          </div>
        ) : sections.length === 0 ? (
          <div className="rounded-md border hairline bg-[var(--color-card)] p-8 text-center text-[12.5px] muted-text">
            No stocks match the current filter in this cluster.
          </div>
        ) : (
          sections.map((sec) => (
            <div key={sec.key} className="rounded-md border hairline bg-[var(--color-card)] overflow-hidden">
              <div className="px-3 py-2 border-b hairline bg-[var(--color-paper)]/60 flex items-center justify-between">
                <h3 className="text-[12.5px] font-semibold tracking-tight">{sec.title}</h3>
                <span className="text-[11px] muted-text tabular-nums">{sec.rows.length}</span>
              </div>

              <div className="overflow-auto max-h-[calc(100vh-14rem)]">
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead className="sticky top-0 z-10 bg-[var(--color-card)] shadow-[0_1px_0_0_var(--color-border-default)]">
                    <tr className="text-[10.5px] uppercase tracking-wider muted-text bg-[var(--color-paper)]/70">
                      <th className="py-2 px-2.5 font-semibold">Symbol</th>
                      <th className="py-2 px-2 font-semibold">Action</th>
                      <th className="py-2 px-2 font-semibold text-right">LTP / Buy Below</th>
                      <th className="py-2 px-2 font-semibold text-right">Target (Upside)</th>
                      <th className="py-2 px-2 font-semibold text-center">C / Q / V / M</th>
                      <th className="py-2 px-2 font-semibold text-right">Latest Qtr</th>
                      <th className="py-2 px-2.5 font-semibold min-w-[340px]">Moat (Key Points) &amp; Why</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-default)]/50">
                    {sec.rows.map((r) => {
                      const inZone = r.buy_below != null && r.ltp > 0 && r.ltp <= r.buy_below * 1.02;
                      const distPct = r.buy_below && r.buy_below > 0 ? ((r.ltp - r.buy_below) / r.buy_below) * 100 : null;
                      const whyTone =
                        r.action_group === "actionable"
                          ? "bg-emerald-50/70 border-emerald-200 text-emerald-950"
                          : r.action_label === "HOLD"
                            ? "bg-blue-50/60 border-blue-200 text-blue-950"
                            : r.action_label === "AVOID"
                              ? "bg-rose-50/70 border-rose-200 text-rose-950"
                              : "bg-amber-50/60 border-amber-200 text-amber-950";

                      return (
                        <tr key={r.symbol} className="hover:bg-[var(--color-paper)]/40 align-top">
                          <td className="py-2.5 px-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <Link
                                href={`/stock/${r.symbol}`}
                                className="font-mono font-semibold text-[12.5px] hover:underline inline-flex items-center gap-1"
                              >
                                <span>{r.symbol}</span>
                                <ExternalLink size={10} className="muted-text" />
                              </Link>
                              {r.in_portfolio && (
                                <span className="text-[9.5px] font-semibold px-1 py-0.2 rounded bg-slate-800 text-white">
                                  HELD
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] muted-text truncate max-w-[150px]">
                              {r.company_name}
                            </div>
                            <div className="text-[10.5px] muted-text tabular-nums">
                              MCap ₹{Math.round(r.market_cap_cr).toLocaleString("en-IN")} Cr
                            </div>
                          </td>

                          <td className="py-2.5 px-2 whitespace-nowrap">
                            <span className={`inline-block text-[10.5px] font-semibold px-2 py-0.5 rounded border ${badgeClass(r.action_label)}`}>
                              {r.action_label}
                            </span>
                          </td>

                          <td className="py-2.5 px-2 text-right whitespace-nowrap tabular-nums">
                            <div className="font-semibold text-[12.5px]">{fmtMoney(r.ltp)}</div>
                            <div className="text-[11px] muted-text mt-0.5">
                              BB {fmtMoney(r.buy_below)}
                            </div>
                            {distPct != null && (
                              <span
                                className={`inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                                  inZone
                                    ? "bg-emerald-100 text-emerald-800"
                                    : distPct <= 8
                                      ? "bg-teal-50 text-teal-700"
                                      : "bg-amber-50 text-amber-800"
                                }`}
                              >
                                {inZone ? "IN ZONE" : `${distPct > 0 ? "+" : ""}${distPct.toFixed(1)}%`}
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 px-2 text-right whitespace-nowrap tabular-nums">
                            <div className="font-semibold text-[12.5px]">{fmtMoney(r.target_price)}</div>
                            {r.upside_pct != null && (
                              <div className={`text-[11px] font-semibold ${r.upside_pct >= 15 ? "text-emerald-700" : r.upside_pct < 0 ? "text-rose-600" : "muted-text"}`}>
                                {r.upside_pct >= 0 ? "+" : ""}
                                {r.upside_pct.toFixed(1)}%
                              </div>
                            )}
                          </td>

                          <td className="py-2.5 px-2 text-center whitespace-nowrap tabular-nums font-mono text-[11.5px]">
                            <span className="font-semibold">{Math.round(r.composite_pct)}</span>
                            <span className="muted-text"> / {Math.round(r.quality_pct)} / {Math.round(r.valuation_pct)} / {Math.round(r.momentum_pct)}</span>
                          </td>

                          <td className="py-2.5 px-2 text-right whitespace-nowrap tabular-nums text-[11.5px]">
                            {r.q_end ? (
                              <>
                                <div className="muted-text text-[10.5px]">{r.q_end.slice(0, 7)}</div>
                                <div>S: {r.q_sales != null ? `${r.q_sales.toFixed(0)}` : "—"}</div>
                                <div className={r.q_pat != null && r.q_pat < 0 ? "text-rose-600 font-semibold" : ""}>
                                  P: {r.q_pat != null ? `${r.q_pat.toFixed(1)}` : "—"}
                                </div>
                              </>
                            ) : (
                              <span className="muted-text">—</span>
                            )}
                          </td>

                          <td className="py-2.5 px-2.5 leading-relaxed space-y-1.5">
                            {r.moat_points && r.moat_points.length > 0 ? (
                              <div className="space-y-1.5">
                                {(r.moat_strength || r.moat_type) && (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {r.moat_strength && (
                                      <span
                                        className={`text-[10.5px] font-bold px-2 py-0.5 rounded border ${
                                          r.moat_strength === "Wide"
                                            ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                                            : r.moat_strength === "Narrow"
                                              ? "bg-indigo-100 text-indigo-900 border-indigo-300"
                                              : "bg-slate-100 text-slate-700 border-slate-300"
                                        }`}
                                      >
                                        {r.moat_strength} Moat
                                      </span>
                                    )}
                                    {r.moat_type && (
                                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                        {r.moat_type}
                                      </span>
                                    )}
                                  </div>
                                )}
                                <ul className="space-y-1 text-[12.5px]">
                                  {r.moat_points.map((pt, idx) => {
                                    const colonIdx = pt.indexOf(":");
                                    const label = colonIdx > 0 && colonIdx < 28 ? pt.slice(0, colonIdx) : null;
                                    const rest = label ? pt.slice(colonIdx + 1).trim() : pt;
                                    const isRisk = label?.toLowerCase().includes("risk");
                                    const isProof = label?.toLowerCase().includes("proof") || label?.toLowerCase().includes("financial");
                                    const dotColor = isRisk
                                      ? "bg-rose-500"
                                      : isProof
                                        ? "bg-violet-500"
                                        : "bg-indigo-500";
                                    const labelColor = isRisk
                                      ? "text-rose-700"
                                      : isProof
                                        ? "text-violet-700"
                                        : "text-indigo-700";
                                    return (
                                      <li key={idx} className="flex items-start gap-2">
                                        <span className={`w-1.5 h-1.5 rounded-full ${dotColor} mt-2 shrink-0`} />
                                        <span>
                                          {label && (
                                            <strong className={`${labelColor} font-semibold mr-1`}>
                                              {label}:
                                            </strong>
                                          )}
                                          {rest}
                                        </span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            ) : (
                              <span className="text-[12px] muted-text italic">
                                Moat points not generated yet
                              </span>
                            )}
                            <div className={`px-2.5 py-1.5 rounded border text-[12.5px] leading-snug ${whyTone}`}>
                              <strong className="font-semibold mr-1">Why:</strong>
                              <span>{r.why}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
