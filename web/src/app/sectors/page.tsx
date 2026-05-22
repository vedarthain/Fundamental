import Link from "next/link";
import { unstable_cache } from "next/cache";
import { sql, golden } from "@/lib/db";
import { band, bandColor, tierLabel } from "@/lib/score";
import { TierFilter, type TierMeta } from "./TierFilter";

// revalidate alone is insufficient: in Next.js 15, awaiting searchParams
// (needed for the TierFilter) marks the page as dynamic and bypasses ISR.
// unstable_cache on the data layer ensures the DB is only hit once per
// revalidation period regardless of searchParams or per-request rendering.
export const revalidate = 86400;

type IndustryTile = {
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
  // Market-cap-weighted total return at three horizons, computed across the
  // stocks in the cluster that have both market-cap data and a price history
  // long enough for the window. Null when no coverage.
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
};

type LatestSnapshot = { snapshot_date: string };

/** Per-stock row for the right-hand stocks panel. */
type StockRow = {
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

/**
 * Load stocks for a single industry (cluster_id), each annotated with its own
 * 1W / 1M / 1Y price return. Used by the right-hand stocks panel on /sectors
 * once an industry is selected from the sidebar.
 *
 * Two-step approach: app DB for score + identity rows, golden DB for prices,
 * merge in memory. We never join across DBs (they're separate Neon projects).
 */
async function loadIndustryStocks(
  industryId: string,
  snapshotDate: string,
): Promise<StockRow[]> {
  const rows = await sql<Omit<StockRow, "ret_1w" | "ret_1m" | "ret_1y">[]>`
    SELECT
      s.symbol,
      u.company_name,
      sm.market_cap_cr::float AS market_cap_cr,
      sm.current_price::float AS current_price,
      s.composite_pct, s.quality_pct, s.valuation_pct, s.momentum_pct,
      s.maturity_tier
    FROM app.scores s
    JOIN app.universe u USING (symbol)
    LEFT JOIN app.screener_meta sm USING (symbol)
    WHERE s.snapshot_date = ${snapshotDate}
      AND s.cluster_id = ${industryId}
    ORDER BY s.composite_pct DESC NULLS LAST
  `;
  if (rows.length === 0) return [];

  // Fetch prices for just these stocks rather than the whole universe — much
  // smaller payload, and golden_db doesn't have to scan rows we'll drop.
  //
  // Resilience note: we filter close IS NOT NULL everywhere because a
  // broken daily ingest (e.g. 2026-05-15 wrote rows for 2162 symbols but
  // populated close for only 275) would otherwise blank out every return.
  // p_now uses per-symbol most-recent non-null close; lookbacks anchor to
  // the global latest date minus N days.
  const symbolsNS = rows.map((r) => `${r.symbol}.NS`);
  type PriceRow = { symbol: string; p_now: number | null; p_w1: number | null; p_m1: number | null; p_y1: number | null };
  const prices = await golden<PriceRow[]>`
    WITH latest_d AS (
      SELECT MAX(date) AS d FROM golden.price_history
       WHERE interval = '1d' AND close IS NOT NULL
    ),
    syms AS (SELECT unnest(${symbolsNS}::text[]) AS symbol)
    SELECT
      REPLACE(s.symbol, '.NS', '') AS symbol,
      (SELECT close::float FROM golden.price_history p
        WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
        ORDER BY p.date DESC LIMIT 1) AS p_now,
      (SELECT close::float FROM golden.price_history p
        WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
          AND p.date <= (SELECT d FROM latest_d) - INTERVAL '7 days'
        ORDER BY p.date DESC LIMIT 1) AS p_w1,
      (SELECT close::float FROM golden.price_history p
        WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
          AND p.date <= (SELECT d FROM latest_d) - INTERVAL '30 days'
        ORDER BY p.date DESC LIMIT 1) AS p_m1,
      (SELECT close::float FROM golden.price_history p
        WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
          AND p.date <= (SELECT d FROM latest_d) - INTERVAL '365 days'
        ORDER BY p.date DESC LIMIT 1) AS p_y1
    FROM syms s
  `;
  const priceBy = new Map<string, PriceRow>();
  for (const p of prices) priceBy.set(p.symbol, p);

  return rows.map((r) => {
    const p = priceBy.get(r.symbol);
    const ret = (now: number | null | undefined, past: number | null | undefined): number | null =>
      now != null && past != null && past > 0 ? now / past - 1 : null;
    return {
      ...r,
      ret_1w: ret(p?.p_now, p?.p_w1),
      ret_1m: ret(p?.p_now, p?.p_m1),
      ret_1y: ret(p?.p_now, p?.p_y1),
    };
  });
}

// Wrap the data fetch in unstable_cache so it's cached at the data layer.
// Without this, Next.js 15's `await searchParams` in the page component
// marks the entire page as dynamic, bypassing the revalidate = 86400 ISR
// and hitting Neon on every single request.
const getCachedHeatMap = unstable_cache(
  () => loadHeatMap(),
  ["sectors-heatmap"],
  { revalidate: 86400 },
);

async function loadHeatMap(): Promise<{ tiles: IndustryTile[]; snapshotDate: string | null }> {
  const latest = await sql<LatestSnapshot[]>`
    SELECT MAX(snapshot_date)::text AS snapshot_date FROM app.scores
  `;
  const snapshotDate = latest[0]?.snapshot_date ?? null;
  if (!snapshotDate) return { tiles: [], snapshotDate: null };

  // Everything comes from one table: app.cluster_composite_cache. Returns
  // (ret_1w / ret_1m / ret_1y) are pre-computed by the ETL `score` command
  // after each weekly run and stored as numeric columns. /sectors no longer
  // hits golden_db at all — single 46-row read from app DB makes the page
  // <300ms even on cold start.
  const tiles = await sql<IndustryTile[]>`
    SELECT
      cc.cluster_id      AS industry_id,
      cc.industry_name,
      cc.meta_cluster_id AS sector_id,
      cc.sector_name,
      mc.display_order   AS meta_display_order,
      cc.n_stocks        AS stock_count,
      cc.composite_aggr_pct::float AS avg_composite,
      cc.quality_aggr_pct::float   AS avg_quality,
      cc.valuation_aggr_pct::float AS avg_valuation,
      cc.momentum_aggr_pct::float  AS avg_momentum,
      cc.ret_1w::float   AS ret_1w,
      cc.ret_1m::float   AS ret_1m,
      cc.ret_1y::float   AS ret_1y
    FROM app.cluster_composite_cache cc
    JOIN app.meta_cluster mc ON mc.id = cc.meta_cluster_id
    WHERE cc.snapshot_date = ${snapshotDate}
    ORDER BY mc.display_order, cc.industry_name
  `;
  return { tiles, snapshotDate };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { tiles, snapshotDate } = await getCachedHeatMap();

  // Group by meta_cluster (sector), preserving the curated display_order
  // so financials always lead, frontier-tech lands last, etc.
  type Group = { id: string; name: string; order: number; tiles: IndustryTile[] };
  const groupedMap = new Map<string, Group>();
  for (const t of tiles) {
    const k = t.sector_id;
    if (!groupedMap.has(k)) {
      groupedMap.set(k, { id: t.sector_id, name: t.sector_name, order: t.meta_display_order, tiles: [] });
    }
    groupedMap.get(k)!.tiles.push(t);
  }
  const groups = Array.from(groupedMap.values()).sort((a, b) => a.order - b.order);

  // Active sector — from ?sector=<id>. Defaults to first sector.
  const activeSectorId =
    (sp.sector && groups.find((g) => g.id === sp.sector)?.id) ||
    groups[0]?.id;
  const activeGroup = groups.find((g) => g.id === activeSectorId);

  // Active industry — from ?industry=<id>. Must belong to the active sector,
  // else we fall back to the first industry in that sector. Sorted by avg
  // composite desc so the "strongest" industry leads.
  const sectorIndustries = activeGroup
    ? [...activeGroup.tiles].sort((a, b) => (b.avg_composite ?? 0) - (a.avg_composite ?? 0))
    : [];
  const activeIndustryId =
    (sp.industry && sectorIndustries.find((t) => t.industry_id === sp.industry)?.industry_id) ||
    sectorIndustries[0]?.industry_id;
  const activeIndustry = sectorIndustries.find((t) => t.industry_id === activeIndustryId);

  // Load stocks for the active industry. Server-side fetch so we render the
  // populated panel on first paint — no client loading state.
  const industryStocks: StockRow[] = activeIndustry && snapshotDate
    ? await loadIndustryStocks(activeIndustry.industry_id, snapshotDate)
    : [];

  return (
    <div className="theme-teal mx-auto max-w-[1200px] px-4 md:px-6 py-6 md:py-8">
      <Hero
        snapshotDate={snapshotDate}
        clusterCount={tiles.length}
        stockCount={tiles.reduce((a, b) => a + b.stock_count, 0)}
      />

      {groups.length > 0 && (
        <>
          <SectorTabs groups={groups} activeId={activeSectorId!} />

          {/* Sidebar + stocks panel. Sidebar lists every industry in the
              active sector with inline 1W/1M/1Y returns; stocks panel shows
              the per-stock breakdown for whichever industry is selected.
              On mobile the sidebar collapses to a chip strip above the
              stocks list — the grid switches to a single column. */}
          {activeGroup && activeIndustry && (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 md:gap-6">
              <IndustrySidebar
                sectorId={activeGroup.id}
                industries={sectorIndustries}
                activeIndustryId={activeIndustry.industry_id}
              />
              <StocksPanel industry={activeIndustry} stocks={industryStocks} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Industry sidebar. Lists every industry (cluster) in the active sector.
 * Each entry shows the composite score badge + name + stock count + inline
 * 1W / 1M / 1Y returns. Active row gets a tinted background + bold name.
 *
 * On mobile (<md) it switches to a horizontally-scrolling chip strip so
 * the user can still pick an industry without losing space to a sidebar.
 */
function IndustrySidebar({
  sectorId, industries, activeIndustryId,
}: {
  sectorId: string;
  industries: IndustryTile[];
  activeIndustryId: string;
}) {
  return (
    <aside className="md:sticky md:top-32 md:self-start">
      {/* Desktop: a contained card with its own internal scroll, so users
          can flip industries without the page scrolling. Mobile keeps the
          card visually but switches to a horizontal chip strip inside. */}
      <div className="card overflow-hidden md:max-h-[calc(100vh-10rem)] md:flex md:flex-col">
        <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b hairline">
          <span className="text-[10.5px] uppercase tracking-wide muted-text font-medium">
            Industries
          </span>
          <span className="text-[10.5px] tabular-nums muted-text">
            {industries.length}
          </span>
        </div>
        {/* Scroll container — horizontal on mobile, vertical on desktop. */}
        <div className="flex md:flex-col gap-1.5 md:gap-1 overflow-x-auto md:overflow-x-visible md:overflow-y-auto p-2">
          {industries.map((ind) => (
            <IndustryRow
              key={ind.industry_id}
              sectorId={sectorId}
              industry={ind}
              active={ind.industry_id === activeIndustryId}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

function IndustryRow({
  sectorId, industry, active,
}: {
  sectorId: string;
  industry: IndustryTile;
  active: boolean;
}) {
  const compositeBand = band(industry.avg_composite);
  const compositeColor = bandColor(compositeBand);
  const numColor = compositeBand === "neutral" ? "var(--color-ink)" : "#fff";
  return (
    <Link
      href={`/sectors?sector=${encodeURIComponent(sectorId)}&industry=${encodeURIComponent(industry.industry_id)}`}
      scroll={false}
      className="block shrink-0 md:shrink rounded-md border transition-colors hover:bg-[var(--color-paper)]/60"
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
          <span className="text-[14px] font-medium tabular-nums leading-none" style={{ color: numColor }}>
            {industry.avg_composite == null ? "—" : Math.round(industry.avg_composite)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={`text-[12.5px] leading-tight truncate ${active ? "font-semibold" : "font-medium"}`}
            style={{ color: "var(--color-ink)" }}
          >
            {industry.industry_name}
          </div>
          <div className="text-[10.5px] muted-text">{industry.stock_count} stock{industry.stock_count === 1 ? "" : "s"}</div>
        </div>
      </div>
      {/* Returns row at the bottom of each industry entry */}
      <div className="grid grid-cols-3 gap-1 px-2.5 pb-2 text-[10px]">
        <ReturnMini label="1W" value={industry.ret_1w} />
        <ReturnMini label="1M" value={industry.ret_1m} />
        <ReturnMini label="1Y" value={industry.ret_1y} />
      </div>
    </Link>
  );
}

/**
 * Right-hand panel — stocks in the selected industry, segregated by maturity
 * tier. Each tier is its own sub-section so visitors can spot "compounders"
 * vs "newly listed" at a glance.
 *
 * Composite badge intentionally absent — Composite is the Discover surface's
 * anchor metric. Here we surface the three pillars (Q/V/M) directly so
 * visitors can see *why* a stock scores well, not just the headline.
 */
const TIER_ORDER = ["veteran", "mature", "mid", "new"] as const;

function StocksPanel({ industry, stocks }: { industry: IndustryTile; stocks: StockRow[] }) {
  // Bucket stocks by maturity tier preserving the score-desc order from the
  // SQL query (so each bucket is internally ranked).
  const byTier = new Map<string, StockRow[]>();
  for (const s of stocks) {
    const t = s.maturity_tier || "—";
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t)!.push(s);
  }
  // Tier display order: veterans (compounders) first, then established,
  // emerging, new listings. Any unknown tiers tacked on at the end.
  const orderedTiers = [
    ...TIER_ORDER.filter((t) => byTier.has(t)),
    ...Array.from(byTier.keys()).filter((t) => !(TIER_ORDER as readonly string[]).includes(t)),
  ];

  return (
    <section className="card overflow-hidden">
      <header className="px-4 md:px-5 py-3 border-b hairline flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10.5px] uppercase tracking-wide muted-text">{industry.sector_name}</div>
          <h2 className="font-display text-[18px] leading-tight mt-0.5">{industry.industry_name}</h2>
        </div>
        <div className="muted-text text-[11px] tabular-nums">
          {industry.stock_count} stock{industry.stock_count === 1 ? "" : "s"}
        </div>
      </header>

      {stocks.length === 0 ? (
        <div className="px-5 py-10 text-center muted-text text-[13px]">
          No stocks in this industry at the latest snapshot.
        </div>
      ) : (
        <TierFilter
          tiers={orderedTiers.map<TierMeta>((tier) => ({
            tier,
            label: tierLabel(tier) + "s",
            count: byTier.get(tier)!.length,
          }))}
        >
          {orderedTiers.map((tier) => {
            const bucket = byTier.get(tier)!;
            return (
              // data-tier on the section is what TierFilter reads to decide
              // visibility. data-tier-header on the TierHeader lets the
              // "specific tier active" mode hide it via CSS.
              <section key={tier} data-tier={tier}>
                <div data-tier-header>
                  <TierHeader tier={tier} count={bucket.length} />
                </div>
                <div className="divide-y hairline">
                  {bucket.map((s) => (
                    <StockRowItem key={s.symbol} stock={s} />
                  ))}
                </div>
              </section>
            );
          })}
        </TierFilter>
      )}
    </section>
  );
}

/**
 * Tier color map — four distinct accent hues so each maturity bucket reads
 * as visually separate. The same color is used in three places per tier:
 *   1. The tier-header strip (background tint + dot + label tint)
 *   2. The left-border stripe on every stock row in that tier
 *   3. The optional badge if we ever surface tier on the stock card
 */
function tierColors(tier: string): { stripe: string; bg: string; label: string } {
  switch (tier) {
    case "veteran": return { stripe: "#2e9a47", bg: "rgba(46,154,71,0.10)",  label: "#206b32" };
    case "mature":  return { stripe: "#3a9290", bg: "rgba(58,146,144,0.10)", label: "#236663" };
    case "mid":     return { stripe: "#c08e2c", bg: "rgba(192,142,44,0.12)", label: "#8a6116" };
    case "new":     return { stripe: "#7882b8", bg: "rgba(120,130,184,0.12)", label: "#3f4978" };
    default:        return { stripe: "var(--color-muted)", bg: "var(--color-paper)", label: "var(--color-muted)" };
  }
}

/**
 * Tier divider strip. Tinted background in the tier's signature color +
 * a stronger pill containing the tier label so the boundary between
 * "Compounders" and "Emerging" is immediately visible as you scroll.
 */
function TierHeader({ tier, count }: { tier: string; count: number }) {
  const c = tierColors(tier);
  return (
    <div
      className="px-4 md:px-5 py-2.5 flex items-center gap-2.5 border-b hairline"
      style={{ backgroundColor: c.bg }}
    >
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: c.stripe }} />
      <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: c.label }}>
        {tierLabel(tier) + "s"}
      </span>
      <span className="tabular-nums text-[11px] muted-text">· {count}</span>
    </div>
  );
}

/**
 * Stock row — single-line horizontal layout (compact, scales to 40+ stocks
 * per industry without forcing endless scroll).
 *
 *   Desktop:  [Identity 1fr]  [Returns 168px]  [Pillars 168px]
 *   Mobile:   [Identity]  +  [Returns + Pillars on second line, side-by-side]
 *
 * 3px colored left stripe still carries the tier identity through the list.
 * Each cell is the same compact pill so the row reads as a uniform strip
 * rather than a stacked card.
 */
function StockRowItem({ stock }: { stock: StockRow }) {
  const tc = tierColors(stock.maturity_tier);
  return (
    <Link
      href={`/stock/${stock.symbol}`}
      className="block hover:bg-[var(--color-paper)]/60 transition-colors"
      style={{ borderLeft: `3px solid ${tc.stripe}` }}
    >
      {/* Desktop: 4-column strip — identity / returns / pillars / Industry Score */}
      <div className="hidden md:grid items-center gap-4 px-5 py-2.5"
        style={{ gridTemplateColumns: "1fr 168px 168px 56px" }}
      >
        <StockIdentity stock={stock} />
        <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
          <ReturnMini label="1W" value={stock.ret_1w} />
          <ReturnMini label="1M" value={stock.ret_1m} />
          <ReturnMini label="1Y" value={stock.ret_1y} />
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
          <PillarCell label="Q" value={stock.quality_pct}   title="Quality" />
          <PillarCell label="V" value={stock.valuation_pct} title="Valuation" />
          <PillarCell label="M" value={stock.momentum_pct}  title="Momentum" />
        </div>
        <CompositeBadge value={stock.composite_pct} />
      </div>

      {/* Mobile: 2-line stack. Industry Score sits next to identity at the
          top-right so the most-summary number is glanceable without scrolling
          past returns + pillars first. */}
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
            <PillarCell label="Q" value={stock.quality_pct}   title="Quality" />
            <PillarCell label="V" value={stock.valuation_pct} title="Valuation" />
            <PillarCell label="M" value={stock.momentum_pct}  title="Momentum" />
          </div>
        </div>
      </div>
    </Link>
  );
}

/** Industry Score pill — colored by score band. The number that's most
 * summary about a stock; deserves prominence (right-most on desktop, top-
 * right on mobile). Title attribute spells out what the score means since
 * column headers don't fit alongside variable-width rows.
 */
function CompositeBadge({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <span
        title="Industry Score — peer-relative composite, not available for this stock"
        className="inline-block min-w-[40px] text-center px-2 py-0.5 rounded-md tabular-nums text-[12px] muted-text"
        style={{ background: "var(--color-paper)", color: "var(--color-muted)" }}
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

/** Shared identity block — symbol + company + LTP + mcap on a single line. */
function StockIdentity({ stock }: { stock: StockRow }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-medium text-[13.5px] tabular-nums shrink-0">{stock.symbol}</span>
        <span className="muted-text text-[11.5px] truncate">{stock.company_name}</span>
      </div>
      <div className="muted-text text-[10.5px] mt-0.5 tabular-nums flex flex-wrap gap-x-2.5 gap-y-0">
        {stock.current_price != null && <span>₹{stock.current_price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>}
        {stock.market_cap_cr != null && (
          <span>
            <span className="muted-text">mcap </span>
            ₹{stock.market_cap_cr >= 1_00_000
              ? `${(stock.market_cap_cr / 1_00_000).toFixed(1)}L Cr`
              : `${Math.round(stock.market_cap_cr).toLocaleString("en-IN")} Cr`}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Single pillar score cell (Q / V / M). Labeled mini-badge, score number
 * tinted by the band palette so 80 reads green, 40 reads red. Lives inside
 * StockRowItem's vertical pillars row.
 */
function PillarCell({ label, value, title }: { label: string; value: number | null; title: string }) {
  if (value == null) {
    return (
      <div
        className="flex flex-col items-center rounded-sm px-2 py-1 hairline border opacity-50"
        title={title}
      >
        <span className="text-[9.5px] font-semibold tracking-wider leading-tight" style={{ color: "var(--color-muted)" }}>{label}</span>
        <span className="tabular-nums font-semibold text-[12px] leading-tight muted-text">—</span>
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
      <span className="text-[9.5px] font-semibold tracking-wider leading-tight" style={{ color: "var(--color-muted)" }}>{label}</span>
      <span className="tabular-nums font-semibold text-[12px] leading-tight" style={{ color }}>
        {Math.round(value)}
      </span>
    </div>
  );
}

function SectorTabs({
  groups, activeId,
}: {
  groups: { id: string; name: string; tiles: IndustryTile[] }[];
  activeId: string;
}) {
  // Sectors are split into TWO ROWS so every label is visible at first paint.
  // The previous single-row + horizontal-scroll layout buried right-edge
  // tabs unless the user noticed the scrollbar. Two rows fit ~5 tabs each
  // on a 1200px container, no scroll, no hidden tabs.
  const half = Math.ceil(groups.length / 2);
  const row1 = groups.slice(0, half);
  const row2 = groups.slice(half);

  // Sticky on scroll so the user can pick a sector without bouncing back
  // to the top. backdrop-blur keeps tiles below readable through the strip.
  //
  // Mobile (<md): all tabs flow as a single wrapping group — splitting into
  // 2 rows on narrow viewports just produces 4-6 messy visual rows scattered
  // into 2 logical groups. On md+ we restore the 2-row visual hierarchy.
  // -mx-4 md:-mx-6 matches the outer page padding so the sticky bleed
  // reaches the viewport edge cleanly on both phones and desktops.
  return (
    <div
      className="mt-6 md:mt-8 flex flex-col gap-1 md:gap-1.5 sticky top-[84px] z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2 backdrop-blur-md"
      style={{ backgroundColor: "color-mix(in srgb, var(--color-paper) 92%, transparent)" }}
    >
      {/* Mobile: single wrapping group of all sectors */}
      <div className="md:hidden">
        <SectorTabRow groups={groups} activeId={activeId} />
      </div>
      {/* Desktop: 2-row visual hierarchy */}
      <div className="hidden md:contents">
        <SectorTabRow groups={row1} activeId={activeId} />
        {row2.length > 0 && <SectorTabRow groups={row2} activeId={activeId} />}
      </div>
    </div>
  );
}

function SectorTabRow({
  groups, activeId,
}: {
  groups: { id: string; name: string; tiles: IndustryTile[] }[];
  activeId: string;
}) {
  // Active border switches to the accent color so the "you are here" signal
  // is consistent across the row (no longer dependent on the sector's band
  // color — that signal was removed along with the per-tab dot per design
  // direction "no point in showing cross-industry strength on sector tabs").
  const accent = "var(--color-accent-600)";
  return (
    <div className="flex flex-wrap gap-1 md:gap-1.5">
      {groups.map((g) => {
        const active = g.id === activeId;
        const stockTotal = g.tiles.reduce((a, t) => a + t.stock_count, 0);
        return (
          <Link
            key={g.id}
            href={`/sectors?sector=${encodeURIComponent(g.id)}`}
            scroll={false}
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
            <span className={active ? "font-semibold" : "font-medium"}>{g.name}</span>
            <span className="tabular-nums text-[11px] muted-text">
              {g.tiles.length}·{stockTotal}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function SectorTilesGrid({ tiles }: { tiles: IndustryTile[] }) {
  // Single column on the narrowest phones (<400px) so labels don't truncate
  // into "Capital Mar..." 2 cols at 400px+, scales up from there. Slightly
  // larger gap on mobile so the tiles breathe.
  return (
    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {tiles.map((t) => (
        <IndustryTileCard key={t.industry_id} tile={t} />
      ))}
    </div>
  );
}

function Hero(props: { snapshotDate: string | null; clusterCount: number; stockCount: number }) {
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
        <span>{props.clusterCount} peer sectors</span>
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
        <span className="inline-block transition-transform group-open:rotate-90">›</span>
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

/**
 * Tile — denser layout. Composite badge + name + stock count on one row,
 * pill-style 1W/1M/1Y returns below. The Q/V/M average pillars were dropped
 * from the visible tile (still on the cluster detail page) because they
 * doubled the height and the composite already aggregates them.
 */
function IndustryTileCard({ tile }: { tile: IndustryTile }) {
  const b = band(tile.avg_composite);
  const bg = bandColor(b);
  const numColor = b === "neutral" ? "var(--color-ink)" : "white";
  return (
    <Link
      href={`/industry/${tile.industry_id}`}
      className="card p-2.5 group hover:border-[var(--color-accent-300)] transition-colors block"
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: bg }}
        >
          <span className="text-[15px] font-medium tabular-nums leading-none" style={{ color: numColor }}>
            {tile.avg_composite == null ? "—" : Math.round(tile.avg_composite)}
          </span>
        </div>
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium leading-tight truncate">
            {tile.industry_name}
          </div>
          <div className="text-[10px] muted-text mt-0.5">{tile.stock_count} stocks</div>
        </div>
      </div>
      {/* Always render the returns row — previously hid the whole strip if all
          three values were null, which left some tiles (Fintech/Insurance)
          looking shorter than their neighbours and gave no signal as to WHY
          (data missing vs no movement). Now each cell shows "—" when null
          so the layout stays consistent and the user understands the gap. */}
      <div
        className="mt-2 grid grid-cols-3 gap-1 text-[10px]"
        title="Market-cap-weighted total return across the stocks in this sector"
      >
        <ReturnMini label="1W" value={tile.ret_1w} />
        <ReturnMini label="1M" value={tile.ret_1m} />
        <ReturnMini label="1Y" value={tile.ret_1y} />
      </div>
    </Link>
  );
}

/**
 * Compact return badge: "1Y +24%". Colored green/red by sign, muted when null.
 * 10.5px keeps it from competing with the pillar scores above.
 */
function ReturnMini({ label, value }: { label: string; value: number | null }) {
  if (value == null) {
    // Common cause for empty 1Y: stock is a recent listing or carved out
    // via corporate action (e.g. CCAVENUE listed Jan 2026), so there's no
    // close price ≥365 days ago to compute against. Tooltip explains so
    // users don't read "—" as a bug.
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
        <span className="text-[9.5px] font-semibold tracking-wider leading-tight" style={{ color: "var(--color-muted)" }}>{label}</span>
        <span className="tabular-nums font-semibold text-[12px] leading-tight muted-text">—</span>
      </div>
    );
  }
  const pct = value * 100;
  // Use the direction-of-movement delta tokens (theme-immune, more saturated
  // than the score-band palette) so +0.3% reads as a confident green / red
  // rather than the washed sage/peach the band ramp produces at small values.
  const color =
    pct >= 0 ? "var(--color-delta-up)" : "var(--color-delta-down)";
  const sign = pct >= 0 ? "+" : "";
  // Single decimal for sub-10% moves; no decimal once we cross +/-10%.
  const txt = Math.abs(pct) >= 10 ? Math.round(pct).toString() : pct.toFixed(1);
  return (
    <div className="flex flex-col items-center rounded-sm px-2 py-1 hairline border">
      <span className="text-[9.5px] font-semibold tracking-wider leading-tight" style={{ color: "var(--color-muted)" }}>{label}</span>
      <span className="tabular-nums font-semibold text-[12px] leading-tight" style={{ color }}>
        {sign}{txt}%
      </span>
    </div>
  );
}
