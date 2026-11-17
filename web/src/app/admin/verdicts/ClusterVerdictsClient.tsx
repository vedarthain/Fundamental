"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  LayoutList,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Table2,
} from "lucide-react";
import type { ClusterVerdictRow } from "@/app/api/admin/cluster-verdicts/route";
import { VerdictAuditSection } from "./VerdictAuditSection";

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
type ViewMode = "compact" | "detailed";
type SortKey = "composite" | "upside" | "zone_dist" | "quality" | "mcap" | "moat";

function fmtMoney(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function calcRiskReward(r: ClusterVerdictRow): { downsidePct: number | null; rr: number | null } {
  if (!r.ltp || r.ltp <= 0 || r.bear_floor == null || r.bear_floor <= 0) {
    return { downsidePct: null, rr: null };
  }
  const downsidePct = ((r.bear_floor - r.ltp) / r.ltp) * 100;
  const risk = r.ltp - r.bear_floor;
  const reward = r.target_price != null ? r.target_price - r.ltp : null;
  const rr = risk > 0 && reward != null && reward > 0 ? reward / risk : null;
  return { downsidePct, rr };
}

function DeepDiveMetricsStrip({ row }: { row: ClusterVerdictRow }) {
  const { downsidePct, rr } = calcRiskReward(row);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] px-2.5 py-1.5 rounded bg-slate-50 border border-slate-200/80 tabular-nums">
      <div>
        <span className="muted-text mr-1">Bear Floor:</span>
        <strong className="text-rose-700">{fmtMoney(row.bear_floor)}</strong>
        {downsidePct != null && (
          <span className="ml-1 text-[10.5px] text-rose-600">({fmtPct(downsidePct, 1)})</span>
        )}
      </div>
      <div>
        <span className="muted-text mr-1">R:R:</span>
        <strong className={rr != null && rr >= 2 ? "text-emerald-700" : ""}>
          {rr != null ? `${rr.toFixed(1)}x` : "—"}
        </strong>
      </div>
      <div>
        <span className="muted-text mr-1">Returns:</span>
        <span className={row.ret_1m != null && row.ret_1m >= 0 ? "text-emerald-700" : "text-rose-600"}>
          1M {fmtPct(row.ret_1m, 1)}
        </span>
        <span className="muted-text mx-1">·</span>
        <span className={row.ret_6m != null && row.ret_6m >= 0 ? "text-emerald-700" : "text-rose-600"}>
          6M {fmtPct(row.ret_6m, 1)}
        </span>
        <span className="muted-text mx-1">·</span>
        <span className={row.ret_1y != null && row.ret_1y >= 0 ? "text-emerald-700" : "text-rose-600"}>
          1Y {fmtPct(row.ret_1y, 1)}
        </span>
      </div>
      {(row.q_sales_yoy_pct != null || row.q_pat_yoy_pct != null) && (
        <div>
          <span className="muted-text mr-1">Qtr YoY:</span>
          <span className={row.q_sales_yoy_pct != null && row.q_sales_yoy_pct >= 0 ? "text-emerald-700 font-medium" : "text-rose-600 font-medium"}>
            Sales {fmtPct(row.q_sales_yoy_pct, 1)}
          </span>
          <span className="muted-text mx-1">·</span>
          <span className={row.q_pat_yoy_pct != null && row.q_pat_yoy_pct >= 0 ? "text-emerald-700 font-medium" : "text-rose-600 font-medium"}>
            PAT {fmtPct(row.q_pat_yoy_pct, 1)}
          </span>
        </div>
      )}
    </div>
  );
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

function whyToneClass(r: ClusterVerdictRow): string {
  if (r.action_group === "actionable") return "bg-emerald-50/70 border-emerald-200 text-emerald-950";
  if (r.action_label === "HOLD") return "bg-blue-50/60 border-blue-200 text-blue-950";
  if (r.action_label === "AVOID") return "bg-rose-50/70 border-rose-200 text-rose-950";
  return "bg-amber-50/60 border-amber-200 text-amber-950";
}

function WhyBulletsBlock({ row }: { row: ClusterVerdictRow }) {
  const points = row.why
    .split(/(?:\s*[;—]\s*|\.\s+(?=[A-Z]))/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean);

  return (
    <div className={`px-3 py-2.5 rounded border text-[12.5px] leading-snug ${whyToneClass(row)}`}>
      <strong className="font-semibold block mb-1">Verdict Rationale:</strong>
      <ul className="space-y-1">
        {points.map((pt, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 mt-1.5 shrink-0" />
            <span>{pt}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MoatPointsBlock({ row }: { row: ClusterVerdictRow }) {
  if (!row.moat_points || row.moat_points.length === 0) {
    return <span className="text-[12.5px] muted-text italic">Moat points not generated yet</span>;
  }
  return (
    <div className="space-y-1.5">
      {(row.moat_strength || row.moat_type) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {row.moat_strength && (
            <span
              className={`text-[10.5px] font-bold px-2 py-0.5 rounded border ${
                row.moat_strength === "Wide"
                  ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                  : row.moat_strength === "Narrow"
                    ? "bg-indigo-100 text-indigo-900 border-indigo-300"
                    : "bg-slate-100 text-slate-700 border-slate-300"
              }`}
            >
              {row.moat_strength} Moat
            </span>
          )}
          {row.moat_type && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
              {row.moat_type}
            </span>
          )}
        </div>
      )}
      <ul className="space-y-1 text-[13px] leading-relaxed">
        {row.moat_points.map((pt, idx) => {
          const colonIdx = pt.indexOf(":");
          const label = colonIdx > 0 && colonIdx < 28 ? pt.slice(0, colonIdx) : null;
          const rest = label ? pt.slice(colonIdx + 1).trim() : pt;
          const isRisk = label?.toLowerCase().includes("risk");
          const isProof = label?.toLowerCase().includes("proof") || label?.toLowerCase().includes("financial");
          const dotColor = isRisk ? "bg-rose-500" : isProof ? "bg-violet-500" : "bg-indigo-500";
          const labelColor = isRisk ? "text-rose-700" : isProof ? "text-violet-700" : "text-indigo-700";
          return (
            <li key={idx} className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${dotColor} mt-2 shrink-0`} />
              <span>
                {label && <strong className={`${labelColor} font-semibold mr-1`}>{label}:</strong>}
                {rest}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
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
  const [collapsedSections, setCollapsedSections] = useState<Set<"actionable" | "watch" | "hold_avoid">>(
    () => new Set(["watch", "hold_avoid"]),
  );
  const toggleSection = (key: "actionable" | "watch" | "hold_avoid") => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [showSidebar, setShowSidebar] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortKey>("composite");
  const [onlyInZone, setOnlyInZone] = useState(false);
  const [onlyMoat, setOnlyMoat] = useState(false);
  const [onlyHeld, setOnlyHeld] = useState(false);
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
    const moatRank = (m: string | null) => (m === "Wide" ? 3 : m === "Narrow" ? 2 : m ? 1 : 0);
    const list = items.filter((item) => {
      if (groupFilter !== "all" && item.action_group !== groupFilter) return false;
      if (minMcap > 0 && item.market_cap_cr < minMcap) return false;
      if (onlyInZone && !(item.buy_below != null && item.ltp > 0 && item.ltp <= item.buy_below * 1.02)) return false;
      if (onlyMoat && item.moat_strength !== "Wide" && item.moat_strength !== "Narrow") return false;
      if (onlyHeld && !item.in_portfolio) return false;
      if (q) {
        const moatTxt = item.moat_points ? item.moat_points.join(" ") : "";
        const hay = `${item.symbol} ${item.company_name ?? ""} ${item.business_summary ?? ""} ${item.why} ${moatTxt}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === "upside") return (b.upside_pct ?? -999) - (a.upside_pct ?? -999);
      if (sortBy === "quality") return b.quality_pct - a.quality_pct;
      if (sortBy === "mcap") return b.market_cap_cr - a.market_cap_cr;
      if (sortBy === "moat") return moatRank(b.moat_strength) - moatRank(a.moat_strength) || b.composite_pct - a.composite_pct;
      if (sortBy === "zone_dist") {
        const da = a.buy_below && a.buy_below > 0 ? (a.ltp - a.buy_below) / a.buy_below : 999;
        const db = b.buy_below && b.buy_below > 0 ? (b.ltp - b.buy_below) / b.buy_below : 999;
        return da - db;
      }
      return b.composite_pct - a.composite_pct;
    });
    return list;
  }, [items, groupFilter, minMcap, onlyInZone, onlyMoat, onlyHeld, search, sortBy]);

  const counts = useMemo(() => {
    let actionable = 0;
    let watch = 0;
    let holdAvoid = 0;
    let inZone = 0;
    let wideMoat = 0;
    let narrowMoat = 0;
    let held = 0;
    const upsides: number[] = [];
    items.forEach((i) => {
      if (i.action_group === "actionable") actionable++;
      else if (i.action_group === "watch") watch++;
      else holdAvoid++;
      if (i.buy_below != null && i.ltp > 0 && i.ltp <= i.buy_below * 1.02) inZone++;
      if (i.moat_strength === "Wide") wideMoat++;
      else if (i.moat_strength === "Narrow") narrowMoat++;
      if (i.in_portfolio) held++;
      if (i.upside_pct != null && Number.isFinite(i.upside_pct)) upsides.push(i.upside_pct);
    });
    upsides.sort((a, b) => a - b);
    const medianUpside = upsides.length > 0 ? upsides[Math.floor(upsides.length / 2)] : null;
    return { all: items.length, actionable, watch, holdAvoid, inZone, wideMoat, narrowMoat, held, medianUpside };
  }, [items]);

  const exportCsv = () => {
    const headers = [
      "Symbol", "Company", "Action", "MCap_Cr", "LTP", "Buy_Below", "Target", "Bear_Floor",
      "Upside_Pct", "Composite", "Quality", "Valuation", "Momentum", "Moat_Strength", "Moat_Type", "Why",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = filteredItems.map((r) => [
      r.symbol, r.company_name, r.action_label, Math.round(r.market_cap_cr), r.ltp, r.buy_below,
      r.target_price, r.bear_floor, r.upside_pct, Math.round(r.composite_pct), Math.round(r.quality_pct),
      Math.round(r.valuation_pct), Math.round(r.momentum_pct), r.moat_strength, r.moat_type, r.why,
    ].map(esc).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(activeClusterMeta?.clusterName ?? "cluster-verdicts").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

  const toggleRow = (symbol: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  return (
    <div
      className={`grid grid-cols-1 gap-3 items-start ${
        showSidebar ? "lg:grid-cols-[230px_minmax(0,1fr)]" : "lg:grid-cols-1"
      }`}
    >
      {/* Left Panel: Sectors -> Clusters (all collapsed to sectors by default) */}
      {showSidebar && (
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
      )}

      {/* Main Content: Cluster-wise Verdict Board */}
      <section className="space-y-3 min-w-0">
        {/* Cluster Toolbar (Sticky) */}
        <div className="sticky top-2 z-20 rounded-md border hairline bg-[var(--color-card)]/95 backdrop-blur-xs shadow-xs p-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => setShowSidebar((v) => !v)}
                className="p-1.5 rounded border hairline hover:bg-[var(--color-paper)] text-slate-600 shrink-0"
                title={showSidebar ? "Hide sectors panel (full width)" : "Show sectors panel"}
              >
                {showSidebar ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
              </button>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider muted-text font-semibold">
                  {activeClusterMeta?.sectorName ?? "Select a cluster"}
                </div>
                <h2 className="text-[15px] font-semibold tracking-tight truncate">
                  {activeClusterMeta?.clusterName ?? "Cluster Verdicts"}
                  <span className="ml-2 text-[11.5px] font-normal muted-text tabular-nums">
                    ({filteredItems.length}/{counts.all})
                  </span>
                </h2>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {/* View Mode Switcher: Compact Overview vs Detailed Cards */}
              <div className="inline-flex rounded border hairline bg-[var(--color-paper)] p-0.5 text-[11.5px]">
                <button
                  type="button"
                  onClick={() => setViewMode("compact")}
                  className={`px-2 py-0.5 rounded transition-colors inline-flex items-center gap-1 whitespace-nowrap ${
                    viewMode === "compact"
                      ? "bg-[var(--color-card)] font-semibold shadow-2xs"
                      : "muted-text hover:text-[var(--color-ink)]"
                  }`}
                  title="Scannable 1-line overview table — click any stock to expand Moat & Why"
                >
                  <Table2 size={12} />
                  <span>Overview</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("detailed")}
                  className={`px-2 py-0.5 rounded transition-colors inline-flex items-center gap-1 whitespace-nowrap ${
                    viewMode === "detailed"
                      ? "bg-[var(--color-card)] font-semibold shadow-2xs"
                      : "muted-text hover:text-[var(--color-ink)]"
                  }`}
                  title="Full-width cards with Moat & Why side-by-side"
                >
                  <LayoutList size={12} />
                  <span>Detailed</span>
                </button>
              </div>

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

              {/* Sort By */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="px-2 py-1 text-[11.5px] rounded border hairline bg-[var(--color-card)]"
                aria-label="Sort stocks"
              >
                <option value="composite">Sort: Composite</option>
                <option value="upside">Sort: Upside %</option>
                <option value="zone_dist">Sort: Closest to Buy Zone</option>
                <option value="quality">Sort: Quality</option>
                <option value="mcap">Sort: Market Cap</option>
                <option value="moat">Sort: Moat Strength</option>
              </select>

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
                  className="pl-6 pr-2 py-1 text-[11.5px] rounded border hairline bg-[var(--color-card)] w-36"
                />
              </div>

              {/* Export CSV */}
              <button
                type="button"
                onClick={exportCsv}
                disabled={filteredItems.length === 0}
                className="px-2 py-1 text-[11.5px] rounded border hairline bg-[var(--color-card)] hover:bg-[var(--color-paper)] inline-flex items-center gap-1 disabled:opacity-40"
                title="Export filtered rows to CSV"
              >
                <Download size={12} />
                <span className="hidden sm:inline">CSV</span>
              </button>
            </div>
          </div>

          {/* Slim Cluster KPI & Quick-Filter Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-[11px]">
            <div className="flex flex-wrap items-center gap-3 tabular-nums muted-text">
              <span>
                In Buy Zone: <strong className="text-emerald-700">{counts.inZone}</strong>
              </span>
              <span>
                Moat: <strong className="text-emerald-700">{counts.wideMoat} Wide</strong> ·{" "}
                <strong className="text-indigo-700">{counts.narrowMoat} Narrow</strong>
              </span>
              {counts.medianUpside != null && (
                <span>
                  Median Upside:{" "}
                  <strong className={counts.medianUpside >= 15 ? "text-emerald-700" : "text-slate-800"}>
                    {fmtPct(counts.medianUpside, 1)}
                  </strong>
                </span>
              )}
              <span>
                Held: <strong className="text-slate-800">{counts.held}</strong>
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOnlyInZone((v) => !v)}
                className={`px-2 py-0.5 rounded border text-[11px] font-medium transition-colors ${
                  onlyInZone
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "border-slate-200 text-slate-600 hover:bg-[var(--color-paper)]"
                }`}
              >
                In Zone Only
              </button>
              <button
                type="button"
                onClick={() => setOnlyMoat((v) => !v)}
                className={`px-2 py-0.5 rounded border text-[11px] font-medium transition-colors ${
                  onlyMoat
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-slate-200 text-slate-600 hover:bg-[var(--color-paper)]"
                }`}
              >
                Wide / Narrow Moat
              </button>
              <button
                type="button"
                onClick={() => setOnlyHeld((v) => !v)}
                className={`px-2 py-0.5 rounded border text-[11px] font-medium transition-colors ${
                  onlyHeld
                    ? "bg-slate-800 text-white border-slate-800"
                    : "border-slate-200 text-slate-600 hover:bg-[var(--color-paper)]"
                }`}
              >
                Held Only
              </button>
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
          sections.map((sec) => {
            const isCollapsed = groupFilter === "all" && collapsedSections.has(sec.key);
            return (
            <div key={sec.key} className="rounded-md border hairline bg-[var(--color-card)] overflow-hidden">
              <div
                onClick={() => groupFilter === "all" && toggleSection(sec.key)}
                className={`px-3 py-2 bg-[var(--color-paper)]/60 flex items-center justify-between ${
                  !isCollapsed ? "border-b hairline" : ""
                } ${groupFilter === "all" ? "cursor-pointer hover:bg-[var(--color-paper)]" : ""}`}
              >
                <div className="flex items-center gap-1.5">
                  {groupFilter === "all" && (
                    isCollapsed ? <ChevronRight size={14} className="muted-text" /> : <ChevronDown size={14} className="muted-text" />
                  )}
                  <h3 className="text-[12.5px] font-semibold tracking-tight">{sec.title}</h3>
                </div>
                <div className="flex items-center gap-2">
                  {!isCollapsed && viewMode === "compact" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const allExpanded = sec.rows.every((r) => expandedRows.has(r.symbol));
                        setExpandedRows((prev) => {
                          const next = new Set(prev);
                          if (allExpanded) sec.rows.forEach((r) => next.delete(r.symbol));
                          else sec.rows.forEach((r) => next.add(r.symbol));
                          return next;
                        });
                      }}
                      className="text-[11px] font-medium text-indigo-700 hover:underline"
                    >
                      {sec.rows.every((r) => expandedRows.has(r.symbol)) ? "Collapse all" : "Expand all"}
                    </button>
                  )}
                  <span className="text-[11px] font-semibold muted-text tabular-nums">{sec.rows.length}</span>
                </div>
              </div>

              {!isCollapsed && (viewMode === "compact" ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[12px]">
                    <thead className="sticky top-0 z-10 bg-[var(--color-card)] shadow-[0_1px_0_0_var(--color-border-default)]">
                      <tr className="text-[10.5px] uppercase tracking-wider muted-text bg-[var(--color-paper)]/70">
                        <th className="py-2 pl-2.5 pr-1 w-6" />
                        <th className="py-2 px-2 font-semibold">Symbol</th>
                        <th className="py-2 px-2 font-semibold">Action</th>
                        <th className="py-2 px-2 font-semibold text-right">LTP / Buy Below</th>
                        <th className="py-2 px-2 font-semibold text-right">Target (Upside)</th>
                        <th className="py-2 px-2 font-semibold text-center">C / Q / V / M</th>
                        <th className="py-2 px-2 font-semibold text-right">Latest Qtr</th>
                        <th className="py-2 px-2 font-semibold">Moat</th>
                        <th className="py-2 px-2.5 font-semibold">Why (Click row for full Moat)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-default)]/50">
                      {sec.rows.map((r) => {
                        const isOpen = expandedRows.has(r.symbol);
                        const inZone = r.buy_below != null && r.ltp > 0 && r.ltp <= r.buy_below * 1.02;
                        const distPct = r.buy_below && r.buy_below > 0 ? ((r.ltp - r.buy_below) / r.buy_below) * 100 : null;
                        return (
                          <Fragment key={r.symbol}>
                            <tr
                              onClick={() => toggleRow(r.symbol)}
                              className={`cursor-pointer transition-colors ${
                                isOpen ? "bg-indigo-50/40" : "hover:bg-[var(--color-paper)]/50"
                              }`}
                            >
                              <td className="py-2 pl-2.5 pr-1 text-slate-400">
                                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              </td>
                              <td className="py-2 px-2 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <Link
                                    href={`/stock/${r.symbol}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
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
                                <div className="text-[10.5px] muted-text truncate max-w-[165px]">
                                  {r.company_name} · ₹{Math.round(r.market_cap_cr).toLocaleString("en-IN")} Cr
                                </div>
                              </td>

                              <td className="py-2 px-2 whitespace-nowrap">
                                <span className={`inline-block text-[10.5px] font-semibold px-2 py-0.5 rounded border ${badgeClass(r.action_label)}`}>
                                  {r.action_label}
                                </span>
                              </td>

                              <td className="py-2 px-2 text-right whitespace-nowrap tabular-nums">
                                <div className="flex items-center justify-end gap-1.5">
                                  <span className="font-semibold text-[12.5px]">{fmtMoney(r.ltp)}</span>
                                  {distPct != null && (
                                    <span
                                      className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${
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
                                </div>
                                <div className="text-[10.5px] muted-text">BB {fmtMoney(r.buy_below)}</div>
                              </td>

                              <td className="py-2 px-2 text-right whitespace-nowrap tabular-nums">
                                <div className="font-semibold text-[12.5px]">{fmtMoney(r.target_price)}</div>
                                <div className="flex items-center justify-end gap-1 text-[10.5px]">
                                  {r.upside_pct != null && (
                                    <span className={`font-semibold ${r.upside_pct >= 15 ? "text-emerald-700" : r.upside_pct < 0 ? "text-rose-600" : "muted-text"}`}>
                                      {r.upside_pct >= 0 ? "+" : ""}
                                      {r.upside_pct.toFixed(1)}%
                                    </span>
                                  )}
                                  {(() => {
                                    const { rr } = calcRiskReward(r);
                                    return rr != null ? (
                                      <span className="text-[9.5px] px-1 rounded bg-slate-100 text-slate-600">
                                        {rr.toFixed(1)}x
                                      </span>
                                    ) : null;
                                  })()}
                                </div>
                              </td>

                              <td className="py-2 px-2 text-center whitespace-nowrap tabular-nums font-mono text-[11.5px]">
                                <span className="font-semibold">{Math.round(r.composite_pct)}</span>
                                <span className="muted-text"> / {Math.round(r.quality_pct)} / {Math.round(r.valuation_pct)} / {Math.round(r.momentum_pct)}</span>
                              </td>

                              <td className="py-2 px-2 text-right whitespace-nowrap tabular-nums text-[11px]">
                                {r.q_end ? (
                                  <>
                                    <span className="muted-text text-[10px]">{r.q_end.slice(0, 7)}</span>
                                    <div>
                                      S:{r.q_sales != null ? r.q_sales.toFixed(0) : "—"}
                                      {r.q_sales_yoy_pct != null && (
                                        <span className={`ml-1 text-[10px] ${r.q_sales_yoy_pct >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                                          ({fmtPct(r.q_sales_yoy_pct, 0)})
                                        </span>
                                      )}
                                    </div>
                                    <div className={r.q_pat != null && r.q_pat < 0 ? "text-rose-600 font-semibold" : ""}>
                                      P:{r.q_pat != null ? r.q_pat.toFixed(0) : "—"}
                                      {r.q_pat_yoy_pct != null && (
                                        <span className={`ml-1 text-[10px] ${r.q_pat_yoy_pct >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                                          ({fmtPct(r.q_pat_yoy_pct, 0)})
                                        </span>
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <span className="muted-text">—</span>
                                )}
                              </td>

                              <td className="py-2 px-2 whitespace-nowrap">
                                {r.moat_strength ? (
                                  <span
                                    className={`text-[10.5px] font-semibold px-2 py-0.5 rounded border ${
                                      r.moat_strength === "Wide"
                                        ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                                        : r.moat_strength === "Narrow"
                                          ? "bg-indigo-100 text-indigo-900 border-indigo-300"
                                          : "bg-slate-100 text-slate-700 border-slate-300"
                                    }`}
                                  >
                                    {r.moat_strength}
                                  </span>
                                ) : (
                                  <span className="text-[11px] muted-text">—</span>
                                )}
                              </td>

                              <td className="py-2 px-2.5 max-w-[320px]">
                                <div className="text-[12px] text-slate-700 line-clamp-2 leading-snug">
                                  {r.why}
                                </div>
                              </td>
                            </tr>

                            {isOpen && (
                              <tr className="bg-[var(--color-paper)]/45">
                                <td colSpan={9} className="px-4 py-3 border-t border-slate-200/70 space-y-2.5">
                                  <DeepDiveMetricsStrip row={r} />
                                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-3 items-start">
                                    <div className="rounded border hairline bg-[var(--color-card)] p-3">
                                      <MoatPointsBlock row={r} />
                                    </div>
                                    <WhyBulletsBlock row={r} />
                                  </div>
                                  <VerdictAuditSection symbol={r.symbol} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="divide-y divide-[var(--color-border-default)]/70">
                  {sec.rows.map((r) => {
                    const inZone = r.buy_below != null && r.ltp > 0 && r.ltp <= r.buy_below * 1.02;
                    const distPct = r.buy_below && r.buy_below > 0 ? ((r.ltp - r.buy_below) / r.buy_below) * 100 : null;
                    return (
                      <div key={r.symbol} className="p-3 space-y-2.5 hover:bg-[var(--color-paper)]/25">
                        {/* Top Metrics Bar */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-100">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Link
                              href={`/stock/${r.symbol}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono font-bold text-[14px] hover:underline inline-flex items-center gap-1"
                            >
                              <span>{r.symbol}</span>
                              <ExternalLink size={11} className="muted-text" />
                            </Link>
                            {r.in_portfolio && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-white">
                                HELD
                              </span>
                            )}
                            <span className="text-[12px] muted-text truncate max-w-[220px]">
                              {r.company_name}
                            </span>
                            <span className="text-[11px] muted-text tabular-nums">
                              MCap ₹{Math.round(r.market_cap_cr).toLocaleString("en-IN")} Cr
                            </span>
                            <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded border ${badgeClass(r.action_label)}`}>
                              {r.action_label}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-4 text-[12px] tabular-nums">
                            <div>
                              <span className="muted-text mr-1">LTP:</span>
                              <strong className="text-[13px]">{fmtMoney(r.ltp)}</strong>
                              <span className="muted-text ml-1.5">BB {fmtMoney(r.buy_below)}</span>
                              {distPct != null && (
                                <span
                                  className={`ml-1.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded ${
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
                            </div>

                            <div>
                              <span className="muted-text mr-1">Target:</span>
                              <strong className="text-[13px]">{fmtMoney(r.target_price)}</strong>
                              {r.upside_pct != null && (
                                <span className={`ml-1.5 font-semibold ${r.upside_pct >= 15 ? "text-emerald-700" : r.upside_pct < 0 ? "text-rose-600" : "muted-text"}`}>
                                  ({r.upside_pct >= 0 ? "+" : ""}
                                  {r.upside_pct.toFixed(1)}%)
                                </span>
                              )}
                            </div>

                            <div className="font-mono text-[11.5px]">
                              <span className="muted-text mr-1">C/Q/V/M:</span>
                              <strong>{Math.round(r.composite_pct)}</strong>
                              <span className="muted-text">/{Math.round(r.quality_pct)}/{Math.round(r.valuation_pct)}/{Math.round(r.momentum_pct)}</span>
                            </div>

                            {r.q_end && (
                              <div className="text-[11.5px]">
                                <span className="muted-text mr-1">{r.q_end.slice(0, 7)}:</span>
                                <span>S {r.q_sales != null ? r.q_sales.toFixed(0) : "—"}</span>
                                <span className={`ml-1.5 ${r.q_pat != null && r.q_pat < 0 ? "text-rose-600 font-semibold" : ""}`}>
                                  P {r.q_pat != null ? r.q_pat.toFixed(1) : "—"}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <DeepDiveMetricsStrip row={r} />

                        {/* Bottom Split Band: Moat (left) & Why (right) */}
                        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-3 items-start">
                          <MoatPointsBlock row={r} />
                          <WhyBulletsBlock row={r} />
                        </div>

                        <div>
                          <button
                            type="button"
                            onClick={() => toggleRow(r.symbol)}
                            className="text-[11.5px] font-medium text-indigo-700 hover:underline inline-flex items-center gap-1"
                          >
                            {expandedRows.has(r.symbol) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            <span>
                              {expandedRows.has(r.symbol)
                                ? "Hide Trigger, Working/Risks & 8 Quantitative Models"
                                : "Show Trigger, Working/Risks & 8 Quantitative Models"}
                            </span>
                          </button>
                          {expandedRows.has(r.symbol) && (
                            <div className="mt-2">
                              <VerdictAuditSection symbol={r.symbol} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            );
          })
        )}
      </section>
    </div>
  );
}
