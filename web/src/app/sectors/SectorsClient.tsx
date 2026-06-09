"use client";

/**
 * /sectors single-page-app client.
 *
 * Receives the ENTIRE sectors dataset (all 46 cluster tiles + every stock
 * row across all clusters) as a single prop and handles every interaction
 * client-side:
 *   - Active sector tab
 *   - Active industry sidebar selection
 *   - Active tier filter
 *
 * URL stays shareable via `history.replaceState` — switching industries
 * updates the URL but does NOT trigger a server round-trip or page re-render.
 * Bookmarking a URL still works because the parent server component reads
 * searchParams to set the initial active sector/industry.
 *
 * Why a single-page app shape on /sectors specifically: the page has ~200
 * unique URL combinations (46 industries × 4 tier filters × 10 sectors)
 * and none of them stay warm in Vercel's ISR cache. With all data
 * pre-loaded, every click is 0ms instead of 1-2s of Neon round trip.
 */
import { useState, useMemo, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { band, bandColor, tierLabelPlural, displayCompanyName } from "@/lib/score";

// ── Types ────────────────────────────────────────────────────────────────────

export type IndustryTile = {
  industry_id: string;
  industry_name: string;
  sector_id: string;
  sector_name: string;
  meta_display_order: number;
  stock_count: number;
  avg_composite: number | null;
  avg_quality: number | null;
  avg_valuation: number | null;
  avg_momentum: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
};

export type StockRow = {
  symbol: string;
  company_name: string;
  market_cap_cr: number | null;
  current_price: number | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  maturity_tier: string;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
};

export type SectorsData = {
  tiles: IndustryTile[];
  /** All stocks across all industries, pre-joined and keyed by industry_id.
   *  ~2,150 rows total, ~80KB gzipped. */
  stocksByIndustry: Record<string, StockRow[]>;
  snapshotDate: string | null;
};

// ── Main client component ────────────────────────────────────────────────────

export function SectorsClient({
  data,
  initialSectorId,
  initialIndustryId,
}: {
  data: SectorsData;
  initialSectorId: string | null;
  initialIndustryId: string | null;
}) {
  // Group tiles by meta_cluster (sector). Done in useMemo since the input
  // never changes for a given snapshot — pure derivation from props.
  const groups = useMemo(() => {
    type Group = {
      id: string;
      name: string;
      order: number;
      tiles: IndustryTile[];
    };
    const m = new Map<string, Group>();
    for (const t of data.tiles) {
      if (!m.has(t.sector_id)) {
        m.set(t.sector_id, {
          id: t.sector_id,
          name: t.sector_name,
          order: t.meta_display_order,
          tiles: [],
        });
      }
      m.get(t.sector_id)!.tiles.push(t);
    }
    return Array.from(m.values()).sort((a, b) => a.order - b.order);
  }, [data.tiles]);

  // ── Active sector ──────────────────────────────────────────────────────
  // initialSectorId from the URL may be either a meta_cluster id (internal
  // deep-links) OR a sector name (e.g. the /market heatmap links by name,
  // which has no id to hand). Match on either, case-insensitively.
  const [activeSectorId, setActiveSectorIdState] = useState<string>(() => {
    if (initialSectorId) {
      const key = initialSectorId.toLowerCase();
      const match = groups.find(
        (g) => g.id === initialSectorId || g.name.toLowerCase() === key,
      );
      if (match) return match.id;
    }
    return groups[0]?.id || "";
  });

  // ── Active industry (scoped to active sector) ──────────────────────────
  // sectorIndustries are the industries within the active sector, sorted
  // by composite desc — same ordering as before.
  const sectorIndustries = useMemo(() => {
    const g = groups.find((g) => g.id === activeSectorId);
    if (!g) return [];
    return [...g.tiles].sort(
      (a, b) => (b.avg_composite ?? 0) - (a.avg_composite ?? 0),
    );
  }, [groups, activeSectorId]);

  // Compute initial industry id: prefer the URL's, else first industry in
  // the (initial) active sector.
  const [activeIndustryId, setActiveIndustryIdState] = useState<string>(() => {
    if (
      initialIndustryId &&
      sectorIndustries.find((t) => t.industry_id === initialIndustryId)
    ) {
      return initialIndustryId;
    }
    return sectorIndustries[0]?.industry_id || "";
  });

  const activeIndustry =
    sectorIndustries.find((t) => t.industry_id === activeIndustryId) ||
    sectorIndustries[0];

  // ── URL sync (shallow, no server round-trip) ───────────────────────────
  // history.replaceState updates the URL bar without triggering a Next.js
  // re-render. Bookmarks and back/forward still work because the parent
  // server component reads searchParams to set the initial state.
  const syncUrl = useCallback((sectorId: string, industryId: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("sector", sectorId);
    url.searchParams.set("industry", industryId);
    window.history.replaceState({}, "", url.toString());
  }, []);

  const setActiveSectorId = useCallback(
    (id: string) => {
      setActiveSectorIdState(id);
      // When switching sectors, snap to the strongest industry in the new
      // sector — matches the server-rendered "default to top composite" rule.
      const g = groups.find((gg) => gg.id === id);
      const top = g
        ? [...g.tiles].sort(
            (a, b) => (b.avg_composite ?? 0) - (a.avg_composite ?? 0),
          )[0]?.industry_id || ""
        : "";
      setActiveIndustryIdState(top);
      syncUrl(id, top);
    },
    [groups, syncUrl],
  );

  const setActiveIndustryId = useCallback(
    (id: string) => {
      setActiveIndustryIdState(id);
      syncUrl(activeSectorId, id);
    },
    [activeSectorId, syncUrl],
  );

  // Stocks for the active industry. Pulled from the pre-shipped panel data
  // — no fetch, no round-trip, no loading state. Maps null cluster → [].
  const industryStocks: StockRow[] = activeIndustry
    ? data.stocksByIndustry[activeIndustry.industry_id] || []
    : [];

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <Hero
        snapshotDate={data.snapshotDate}
        clusterCount={data.tiles.length}
        stockCount={data.tiles.reduce((a, b) => a + b.stock_count, 0)}
      />

      {groups.length > 0 && (
        <>
          <SectorTabs
            groups={groups}
            activeId={activeSectorId}
            onSelect={setActiveSectorId}
          />

          {activeIndustry && (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 md:gap-6">
              <IndustrySidebar
                industries={sectorIndustries}
                activeIndustryId={activeIndustry.industry_id}
                onSelect={setActiveIndustryId}
              />
              <StocksPanel
                industry={activeIndustry}
                stocks={industryStocks}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────

function Hero(props: {
  snapshotDate: string | null;
  clusterCount: number;
  stockCount: number;
}) {
  return (
    <section className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
      <h1 className="font-display text-[26px] md:text-[30px] leading-[1.1] tracking-tight">
        Where the Indian market is{" "}
        <em className="text-[var(--color-accent-600)] not-italic">strong</em>,
        and where it isn&apos;t.
      </h1>
      <div className="flex items-center gap-x-3 text-[12px] muted-text tabular-nums flex-wrap">
        <span>{props.stockCount.toLocaleString("en-IN")} stocks</span>
        <span>·</span>
        <span>{props.clusterCount} peer groups</span>
        {props.snapshotDate && (
          <>
            <span>·</span>
            <span>Snapshot {props.snapshotDate}</span>
          </>
        )}
        <ScoreBandsLegend />
      </div>
    </section>
  );
}

function ScoreBandsLegend() {
  const bands = [
    { label: "Top 20%", b: "excellent" as const },
    { label: "Above median", b: "good" as const },
    { label: "Middle", b: "neutral" as const },
    { label: "Below median", b: "weak" as const },
    { label: "Bottom 20%", b: "poor" as const },
  ];
  return (
    <details className="group">
      <summary className="cursor-pointer hover:text-[var(--color-ink)] inline-flex items-center gap-1 list-none select-none">
        <span className="inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        Score colors
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 basis-full">
        {bands.map((bb) => (
          <span key={bb.b} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-5 rounded-sm"
              style={{ backgroundColor: bandColor(bb.b) }}
            />
            {bb.label}
          </span>
        ))}
      </div>
    </details>
  );
}

// ── Sector tabs (top of page) ────────────────────────────────────────────────

function SectorTabs({
  groups,
  activeId,
  onSelect,
}: {
  groups: { id: string; name: string; tiles: IndustryTile[] }[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const half = Math.ceil(groups.length / 2);
  const row1 = groups.slice(0, half);
  const row2 = groups.slice(half);
  return (
    <div
      className="mt-6 md:mt-8 flex flex-col gap-1 md:gap-1.5 sticky top-[84px] z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2 backdrop-blur-md"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--color-paper) 92%, transparent)",
      }}
    >
      <div className="md:hidden">
        <SectorTabRow groups={groups} activeId={activeId} onSelect={onSelect} />
      </div>
      <div className="hidden md:contents">
        <SectorTabRow groups={row1} activeId={activeId} onSelect={onSelect} />
        {row2.length > 0 && (
          <SectorTabRow groups={row2} activeId={activeId} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}

function SectorTabRow({
  groups,
  activeId,
  onSelect,
}: {
  groups: { id: string; name: string; tiles: IndustryTile[] }[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const accent = "var(--color-accent-600)";
  return (
    <div className="flex flex-wrap gap-1 md:gap-1.5">
      {groups.map((g) => {
        const active = g.id === activeId;
        const stockTotal = g.tiles.reduce((a, t) => a + t.stock_count, 0);
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onSelect(g.id)}
            className="px-2.5 md:px-3 py-1 md:py-1.5 rounded-md text-[12px] md:text-[12.5px] inline-flex items-center gap-1.5 md:gap-2 transition-colors whitespace-nowrap border"
            style={
              active
                ? {
                    borderColor: accent,
                    backgroundColor: "var(--color-accent-50)",
                    color: "var(--color-accent-700)",
                    boxShadow: `inset 0 0 0 1px ${accent}`,
                  }
                : {
                    borderColor: "var(--color-border-default)",
                    backgroundColor: "transparent",
                    color: "var(--color-muted)",
                  }
            }
          >
            <span className={active ? "font-semibold" : "font-medium"}>
              {g.name}
            </span>
            <span className="tabular-nums text-[11px] muted-text">
              {g.tiles.length}·{stockTotal}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Industry sidebar ─────────────────────────────────────────────────────────

function IndustrySidebar({
  industries,
  activeIndustryId,
  onSelect,
}: {
  industries: IndustryTile[];
  activeIndustryId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="md:sticky md:top-32 md:self-start">
      <div className="card overflow-hidden md:max-h-[calc(100vh-10rem)] md:flex md:flex-col">
        <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b hairline">
          <span className="text-[10.5px] uppercase tracking-wide muted-text font-medium">
            Industries
          </span>
          <span className="text-[10.5px] tabular-nums muted-text">
            {industries.length}
          </span>
        </div>
        <div className="flex md:flex-col gap-1.5 md:gap-1 overflow-x-auto md:overflow-x-visible md:overflow-y-auto p-2">
          {industries.map((ind) => (
            <IndustryRow
              key={ind.industry_id}
              industry={ind}
              active={ind.industry_id === activeIndustryId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

function IndustryRow({
  industry,
  active,
  onSelect,
}: {
  industry: IndustryTile;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const compositeBand = band(industry.avg_composite);
  const compositeColor = bandColor(compositeBand);
  const numColor =
    compositeBand === "neutral" ? "var(--color-ink)" : "#fff";
  return (
    <button
      type="button"
      onClick={() => onSelect(industry.industry_id)}
      className="block text-left shrink-0 md:shrink rounded-md border transition-colors hover:bg-[var(--color-paper)]/60 w-full"
      style={
        active
          ? {
              borderColor: "var(--color-accent-500)",
              backgroundColor: "var(--color-card)",
              boxShadow: "inset 0 0 0 1px var(--color-accent-500)",
            }
          : {
              borderColor: "var(--color-border-default)",
              backgroundColor: "transparent",
            }
      }
    >
      <div className="flex items-center gap-2.5 px-2.5 py-2 min-w-[180px] md:min-w-0">
        <div
          className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: compositeColor }}
        >
          <span
            className="text-[14px] font-medium tabular-nums leading-none"
            style={{ color: numColor }}
          >
            {industry.avg_composite == null
              ? "—"
              : Math.round(industry.avg_composite)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={`text-[12.5px] leading-tight truncate ${active ? "font-semibold" : "font-medium"}`}
            style={{ color: "var(--color-ink)" }}
          >
            {industry.industry_name}
          </div>
          <div className="text-[10.5px] muted-text">
            {industry.stock_count} stock
            {industry.stock_count === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 px-2.5 pb-2 text-[10px]">
        <ReturnMini label="1W" value={industry.ret_1w} />
        <ReturnMini label="1M" value={industry.ret_1m} />
        <ReturnMini label="1Y" value={industry.ret_1y} />
      </div>
    </button>
  );
}

// ── Stocks panel (right-hand area) ───────────────────────────────────────────

const TIER_ORDER = ["veteran", "mature", "mid", "new"] as const;

function StocksPanel({
  industry,
  stocks,
}: {
  industry: IndustryTile;
  stocks: StockRow[];
}) {
  const byTier = useMemo(() => {
    const m = new Map<string, StockRow[]>();
    for (const s of stocks) {
      const t = s.maturity_tier || "—";
      if (!m.has(t)) m.set(t, []);
      m.get(t)!.push(s);
    }
    // Sort each bucket by composite desc (preserves the cluster-wide ordering)
    for (const arr of m.values()) {
      arr.sort((a, b) => (b.composite_pct ?? 0) - (a.composite_pct ?? 0));
    }
    return m;
  }, [stocks]);

  const orderedTiers = useMemo(
    () => [
      ...TIER_ORDER.filter((t) => byTier.has(t)),
      ...Array.from(byTier.keys()).filter(
        (t) => !(TIER_ORDER as readonly string[]).includes(t),
      ),
    ],
    [byTier],
  );

  const [activeTier, setActiveTier] = useState<string>("all");
  // Per-tier expansion state for "All" view. Each tier is capped at
  // TIER_CAP rows by default; clicking "Show all N →" adds that tier
  // to this set and reveals every row in the bucket.
  const [expandedTiers, setExpandedTiers] = useState<Set<string>>(new Set());
  // Pagination state for the specific-tier view (Long-term Compounders /
  // Established / etc. tabs). Reset to 1 whenever the user switches tier.
  const [tierPage, setTierPage] = useState(1);
  const TIER_CAP = 10;
  const TIER_PAGE_SIZE = 10;
  const totalCount = stocks.length;

  // Wrapper that resets pagination when the active tier changes — both
  // explicit tab clicks and the "All" tab benefit from a clean reset.
  const onSelectTier = useCallback((t: string) => {
    setActiveTier(t);
    setTierPage(1);
  }, []);

  return (
    <section className="card overflow-hidden">
      <header className="px-4 md:px-5 py-3 border-b hairline flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10.5px] uppercase tracking-wide muted-text">
            {industry.sector_name}
          </div>
          <h2 className="font-display text-[18px] leading-tight mt-0.5">
            {industry.industry_name}
          </h2>
        </div>
        <div className="muted-text text-[11px] tabular-nums">
          {industry.stock_count} stock
          {industry.stock_count === 1 ? "" : "s"}
        </div>
      </header>

      {stocks.length === 0 ? (
        <div className="px-5 py-10 text-center muted-text text-[13px]">
          No stocks in this industry at the latest snapshot.
        </div>
      ) : (
        <div>
          <div className="px-4 md:px-5 pt-3 pb-2 border-b hairline overflow-x-auto">
            <div className="flex items-center gap-1.5 text-[11.5px]">
              <TierTab
                label="All"
                count={totalCount}
                active={activeTier === "all"}
                onClick={() => onSelectTier("all")}
              />
              {orderedTiers.map((t) => (
                <TierTab
                  key={t}
                  label={tierLabelPlural(t)}
                  count={byTier.get(t)!.length}
                  active={activeTier === t}
                  onClick={() => onSelectTier(t)}
                  tierKey={t}
                />
              ))}
            </div>
          </div>

          {orderedTiers.map((tier) => {
            if (activeTier !== "all" && activeTier !== tier) return null;
            const bucket = byTier.get(tier)!;
            const isAllView = activeTier === "all";

            let visible: StockRow[];
            let hiddenCount = 0;
            let totalPages = 1;
            if (isAllView) {
              // "All" view: cap each tier at TIER_CAP unless expanded.
              const isExpanded = expandedTiers.has(tier);
              const cap = isExpanded ? bucket.length : TIER_CAP;
              visible = bucket.slice(0, cap);
              hiddenCount = bucket.length - visible.length;
            } else {
              // Specific-tier view: paginate TIER_PAGE_SIZE per page.
              totalPages = Math.max(1, Math.ceil(bucket.length / TIER_PAGE_SIZE));
              const safePage = Math.min(tierPage, totalPages);
              const start = (safePage - 1) * TIER_PAGE_SIZE;
              visible = bucket.slice(start, start + TIER_PAGE_SIZE);
            }

            return (
              <section key={tier}>
                {isAllView && (
                  <TierHeader tier={tier} count={bucket.length} />
                )}
                <div className="divide-y hairline">
                  {visible.map((s) => (
                    <StockRowItem key={s.symbol} stock={s} />
                  ))}
                </div>

                {/* "All" view: per-tier "Show all" / "Show top N only" toggle */}
                {isAllView && hiddenCount > 0 && (
                  <div className="px-4 md:px-5 py-2.5 border-t hairline">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTiers((prev) => {
                          const next = new Set(prev);
                          next.add(tier);
                          return next;
                        })
                      }
                      className="text-[12px] font-medium hover:underline transition-colors"
                      style={{ color: "var(--color-accent-700)" }}
                    >
                      Show all {bucket.length} {tierLabelPlural(tier)} →
                    </button>
                  </div>
                )}
                {isAllView && expandedTiers.has(tier) && bucket.length > TIER_CAP && (
                  <div className="px-4 md:px-5 py-2.5 border-t hairline">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTiers((prev) => {
                          const next = new Set(prev);
                          next.delete(tier);
                          return next;
                        })
                      }
                      className="text-[11.5px] muted-text hover:text-[var(--color-ink)] transition-colors"
                    >
                      ↑ Show top {TIER_CAP} only
                    </button>
                  </div>
                )}

                {/* Specific-tier view: paginated nav */}
                {!isAllView && totalPages > 1 && (
                  <TierPagination
                    page={Math.min(tierPage, totalPages)}
                    totalPages={totalPages}
                    pageSize={TIER_PAGE_SIZE}
                    total={bucket.length}
                    onPageChange={setTierPage}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Compact pagination strip for the specific-tier view (Long-term Compounders /
 * Established / etc. tabs).  Prev / Next + a windowed list of page buttons +
 * a "Showing X-Y of Z" counter.  Pure presentational — the parent owns the
 * page-number state and provides onPageChange.
 */
function TierPagination({
  page, totalPages, pageSize, total, onPageChange,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const windowSize = 2;
  const lo = Math.max(1, page - windowSize);
  const hi = Math.min(totalPages, page + windowSize);
  const pages: number[] = [];
  for (let i = lo; i <= hi; i++) pages.push(i);

  return (
    <div className="px-4 md:px-5 py-2.5 border-t hairline flex flex-wrap items-center justify-between gap-2">
      <div className="text-[11px] tabular-nums muted-text">
        Showing {start}–{end} of {total}
      </div>
      <div className="flex items-center gap-1 text-[11.5px]">
        <PageNavBtn onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1}>
          ← Prev
        </PageNavBtn>
        {lo > 1 && (
          <>
            <PageNavBtn onClick={() => onPageChange(1)}>1</PageNavBtn>
            {lo > 2 && <span className="muted-text px-0.5">…</span>}
          </>
        )}
        {pages.map((p) => (
          <PageNavBtn key={p} onClick={() => onPageChange(p)} active={p === page}>
            {p}
          </PageNavBtn>
        ))}
        {hi < totalPages && (
          <>
            {hi < totalPages - 1 && <span className="muted-text px-0.5">…</span>}
            <PageNavBtn onClick={() => onPageChange(totalPages)}>{totalPages}</PageNavBtn>
          </>
        )}
        <PageNavBtn onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
          Next →
        </PageNavBtn>
      </div>
    </div>
  );
}

function PageNavBtn({
  children, onClick, active, disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-0.5 rounded tabular-nums transition-colors ${
        disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-[var(--color-paper)]"
      }`}
      style={
        active
          ? {
              backgroundColor: "var(--color-accent-50)",
              color: "var(--color-accent-700)",
              fontWeight: 600,
              boxShadow: "inset 0 0 0 1px var(--color-accent-300)",
            }
          : { color: "var(--color-ink)" }
      }
    >
      {children}
    </button>
  );
}

function TierTab({
  label,
  count,
  active,
  onClick,
  tierKey,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tierKey?: string;
}) {
  const accent =
    tierKey === "veteran"
      ? "#2e9a47"
      : tierKey === "mature"
        ? "#3a9290"
        : tierKey === "mid"
          ? "#c08e2c"
          : tierKey === "new"
            ? "#7882b8"
            : "var(--color-accent-600)";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${active ? "font-semibold" : "font-medium muted-text"}`}
      style={
        active
          ? {
              borderColor: accent,
              backgroundColor: "var(--color-card)",
              color: "var(--color-ink)",
              boxShadow: `inset 0 0 0 1px ${accent}`,
            }
          : {
              borderColor: "var(--color-border-default)",
              backgroundColor: "transparent",
            }
      }
    >
      <span>{label}</span>
      <span className="tabular-nums text-[10.5px] muted-text">· {count}</span>
    </button>
  );
}

function tierColors(tier: string): {
  stripe: string;
  bg: string;
  label: string;
} {
  switch (tier) {
    case "veteran":
      return { stripe: "#2e9a47", bg: "rgba(46,154,71,0.10)", label: "#206b32" };
    case "mature":
      return { stripe: "#3a9290", bg: "rgba(58,146,144,0.10)", label: "#236663" };
    case "mid":
      return { stripe: "#c08e2c", bg: "rgba(192,142,44,0.12)", label: "#8a6116" };
    case "new":
      return { stripe: "#7882b8", bg: "rgba(120,130,184,0.12)", label: "#3f4978" };
    default:
      return {
        stripe: "var(--color-muted)",
        bg: "var(--color-paper)",
        label: "var(--color-muted)",
      };
  }
}

function TierHeader({ tier, count }: { tier: string; count: number }) {
  const c = tierColors(tier);
  return (
    <div
      className="px-4 md:px-5 py-2.5 flex items-center gap-2.5 border-b hairline"
      style={{ backgroundColor: c.bg }}
    >
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: c.stripe }}
      />
      <span
        className="text-[11px] uppercase tracking-wide font-semibold"
        style={{ color: c.label }}
      >
        {tierLabelPlural(tier)}
      </span>
      <span className="tabular-nums text-[11px] muted-text">· {count}</span>
    </div>
  );
}

function StockRowItem({ stock }: { stock: StockRow }) {
  const tc = tierColors(stock.maturity_tier);
  return (
    <Link
      href={`/stock/${stock.symbol}`}
      className="block hover:bg-[var(--color-paper)]/60 transition-colors"
      style={{ borderLeft: `3px solid ${tc.stripe}` }}
    >
      <div
        className="hidden md:grid items-center gap-4 px-5 py-2.5"
        style={{ gridTemplateColumns: "1fr 168px 168px 56px" }}
      >
        <StockIdentity stock={stock} />
        <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
          <ReturnMini label="1W" value={stock.ret_1w} />
          <ReturnMini label="1M" value={stock.ret_1m} />
          <ReturnMini label="1Y" value={stock.ret_1y} />
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
          <PillarCell label="Q" value={stock.quality_pct} title="Quality" />
          <PillarCell label="V" value={stock.valuation_pct} title="Valuation" />
          <PillarCell label="M" value={stock.momentum_pct} title="Momentum" />
        </div>
        <CompositeBadge value={stock.composite_pct} />
      </div>

      <div className="md:hidden px-4 py-2.5">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <StockIdentity stock={stock} />
          </div>
          <CompositeBadge value={stock.composite_pct} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <ReturnMini label="1W" value={stock.ret_1w} />
            <ReturnMini label="1M" value={stock.ret_1m} />
            <ReturnMini label="1Y" value={stock.ret_1y} />
          </div>
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <PillarCell label="Q" value={stock.quality_pct} title="Quality" />
            <PillarCell label="V" value={stock.valuation_pct} title="Valuation" />
            <PillarCell label="M" value={stock.momentum_pct} title="Momentum" />
          </div>
        </div>
      </div>
    </Link>
  );
}

function StockIdentity({ stock }: { stock: StockRow }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-medium text-[13.5px] tabular-nums shrink-0">
          {stock.symbol}
        </span>
        <span className="muted-text text-[11.5px] truncate">
          {displayCompanyName(stock.company_name, stock.symbol)}
        </span>
      </div>
      <div className="muted-text text-[10.5px] mt-0.5 tabular-nums flex flex-wrap gap-x-2.5 gap-y-0">
        {stock.current_price != null && (
          <span>
            ₹
            {stock.current_price.toLocaleString("en-IN", {
              maximumFractionDigits: 2,
            })}
          </span>
        )}
        {stock.market_cap_cr != null && (
          <span>
            <span className="muted-text">mcap </span>₹
            {stock.market_cap_cr >= 1_00_000
              ? `${(stock.market_cap_cr / 1_00_000).toFixed(1)}L Cr`
              : `${Math.round(stock.market_cap_cr).toLocaleString("en-IN")} Cr`}
          </span>
        )}
      </div>
    </div>
  );
}

function CompositeBadge({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <span
        title="Industry Score — peer-relative composite, not available for this stock"
        className="inline-block min-w-[40px] text-center px-2 py-0.5 rounded-md tabular-nums text-[12px] muted-text"
        style={{
          background: "var(--color-paper)",
          color: "var(--color-muted)",
        }}
      >
        —
      </span>
    );
  }
  const b = band(value);
  return (
    <span
      title={`Industry Score: ${Math.round(value)} (peer-relative composite)`}
      className="inline-block min-w-[40px] text-center px-2 py-0.5 rounded-md tabular-nums font-medium text-[12px]"
      style={{
        backgroundColor: bandColor(b),
        color: b === "neutral" ? "var(--color-ink)" : "white",
      }}
    >
      {Math.round(value)}
    </span>
  );
}

function PillarCell({
  label,
  value,
  title,
}: {
  label: string;
  value: number | null;
  title: string;
}) {
  if (value == null) {
    return (
      <div
        className="flex flex-col items-center rounded-sm px-2 py-1 hairline border opacity-50"
        title={title}
      >
        <span
          className="text-[9.5px] font-semibold tracking-wider leading-tight"
          style={{ color: "var(--color-muted)" }}
        >
          {label}
        </span>
        <span className="tabular-nums font-semibold text-[12px] leading-tight muted-text">
          —
        </span>
      </div>
    );
  }
  const b = band(value);
  const color = bandColor(b);
  return (
    <div
      className="flex flex-col items-center rounded-sm px-2 py-1 hairline border"
      title={`${title} · ${Math.round(value)}/100`}
      style={{ borderColor: color }}
    >
      <span
        className="text-[9.5px] font-semibold tracking-wider leading-tight"
        style={{ color: "var(--color-muted)" }}
      >
        {label}
      </span>
      <span
        className="tabular-nums font-semibold text-[12px] leading-tight"
        style={{ color }}
      >
        {Math.round(value)}
      </span>
    </div>
  );
}

function ReturnMini({
  label,
  value,
}: {
  label: string;
  value: number | null;
}): ReactNode {
  if (value == null) {
    const reason =
      label === "1Y"
        ? "1Y return unavailable — less than 1 year of price history"
        : label === "1M"
          ? "1M return unavailable — less than 1 month of price history"
          : "Return unavailable — insufficient price history";
    return (
      <div
        className="flex flex-col items-center rounded-sm px-2 py-1 hairline border opacity-50"
        title={reason}
      >
        <span
          className="text-[9.5px] font-semibold tracking-wider leading-tight"
          style={{ color: "var(--color-muted)" }}
        >
          {label}
        </span>
        <span className="tabular-nums font-semibold text-[12px] leading-tight muted-text">
          —
        </span>
      </div>
    );
  }
  const pct = value * 100;
  const color =
    pct >= 0 ? "var(--color-delta-up)" : "var(--color-delta-down)";
  const sign = pct >= 0 ? "+" : "";
  const txt = Math.abs(pct) >= 10 ? Math.round(pct).toString() : pct.toFixed(1);
  return (
    <div className="flex flex-col items-center rounded-sm px-2 py-1 hairline border">
      <span
        className="text-[9.5px] font-semibold tracking-wider leading-tight"
        style={{ color: "var(--color-muted)" }}
      >
        {label}
      </span>
      <span
        className="tabular-nums font-semibold text-[12px] leading-tight"
        style={{ color }}
      >
        {sign}
        {txt}%
      </span>
    </div>
  );
}
