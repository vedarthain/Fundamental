import Link from "next/link";
import { sql, golden } from "@/lib/db";
import { band, bandColor } from "@/lib/score";

export const revalidate = 3600;

type ClusterTile = {
  cluster_id: string;
  cluster_name: string;
  meta_cluster_id: string;
  meta_cluster_name: string;
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

/**
 * Compute cluster-weighted price returns at 1W / 1M / 1Y horizons. We weight
 * by market cap so a cluster's headline number reflects the heavyweights
 * (e.g. RELIANCE dominating Energy), not the simple average across small
 * and large names.
 *
 * Returns Map<cluster_id, {w1, m1, y1}> for downstream merging onto tiles.
 */
async function loadClusterReturns(snapshotDate: string): Promise<Map<string, { w1: number | null; m1: number | null; y1: number | null }>> {
  // Per-symbol close prices: today's + nearest close ≤ 7d / 30d / 365d ago.
  // Correlated subqueries are O(log n) each on the (symbol, date) index,
  // and we run them across ~200 symbols — well within budget.
  type PriceRow = {
    symbol: string;
    p_now: number | null;
    p_w1:  number | null;
    p_m1:  number | null;
    p_y1:  number | null;
  };
  const prices = await golden<PriceRow[]>`
    WITH latest_d AS (
      SELECT MAX(date) AS d FROM golden.price_history WHERE interval = '1d'
    ),
    syms AS (
      SELECT DISTINCT symbol FROM golden.price_history
      WHERE interval = '1d' AND date = (SELECT d FROM latest_d)
    )
    SELECT
      REPLACE(s.symbol, '.NS', '') AS symbol,
      (SELECT close::float FROM golden.price_history p
        WHERE p.symbol = s.symbol AND p.interval = '1d'
          AND p.date = (SELECT d FROM latest_d)
        LIMIT 1) AS p_now,
      (SELECT close::float FROM golden.price_history p
        WHERE p.symbol = s.symbol AND p.interval = '1d'
          AND p.date <= (SELECT d FROM latest_d) - INTERVAL '7 days'
        ORDER BY p.date DESC LIMIT 1) AS p_w1,
      (SELECT close::float FROM golden.price_history p
        WHERE p.symbol = s.symbol AND p.interval = '1d'
          AND p.date <= (SELECT d FROM latest_d) - INTERVAL '30 days'
        ORDER BY p.date DESC LIMIT 1) AS p_m1,
      (SELECT close::float FROM golden.price_history p
        WHERE p.symbol = s.symbol AND p.interval = '1d'
          AND p.date <= (SELECT d FROM latest_d) - INTERVAL '365 days'
        ORDER BY p.date DESC LIMIT 1) AS p_y1
    FROM syms s
  `;

  // Per-symbol cluster + market cap at the latest score snapshot. The .NS
  // suffix only exists in golden_db; app DB stores bare tickers.
  type AssignRow = { symbol: string; cluster_id: string; market_cap_cr: number | null };
  const assignments = await sql<AssignRow[]>`
    SELECT s.symbol, s.cluster_id, sm.market_cap_cr::float AS market_cap_cr
    FROM app.scores s
    LEFT JOIN app.screener_meta sm USING (symbol)
    WHERE s.snapshot_date = ${snapshotDate}
  `;

  const priceBy = new Map<string, PriceRow>();
  for (const p of prices) priceBy.set(p.symbol, p);

  // For each cluster, accumulate numerator (sum of mcap × return) and
  // denominator (sum of mcap whose stock had enough history for that horizon).
  // We track denominator per horizon separately because some new stocks have
  // 1W history but not 1Y.
  type Accum = {
    num_w1: number; den_w1: number;
    num_m1: number; den_m1: number;
    num_y1: number; den_y1: number;
  };
  const acc = new Map<string, Accum>();
  for (const a of assignments) {
    const p = priceBy.get(a.symbol);
    const w = a.market_cap_cr ?? 0;
    if (!p || w <= 0 || p.p_now == null) continue;
    let bucket = acc.get(a.cluster_id);
    if (!bucket) {
      bucket = { num_w1: 0, den_w1: 0, num_m1: 0, den_m1: 0, num_y1: 0, den_y1: 0 };
      acc.set(a.cluster_id, bucket);
    }
    if (p.p_w1 != null && p.p_w1 > 0) {
      bucket.num_w1 += w * (p.p_now / p.p_w1 - 1);
      bucket.den_w1 += w;
    }
    if (p.p_m1 != null && p.p_m1 > 0) {
      bucket.num_m1 += w * (p.p_now / p.p_m1 - 1);
      bucket.den_m1 += w;
    }
    if (p.p_y1 != null && p.p_y1 > 0) {
      bucket.num_y1 += w * (p.p_now / p.p_y1 - 1);
      bucket.den_y1 += w;
    }
  }
  const out = new Map<string, { w1: number | null; m1: number | null; y1: number | null }>();
  for (const [cid, b] of acc) {
    out.set(cid, {
      w1: b.den_w1 > 0 ? b.num_w1 / b.den_w1 : null,
      m1: b.den_m1 > 0 ? b.num_m1 / b.den_m1 : null,
      y1: b.den_y1 > 0 ? b.num_y1 / b.den_y1 : null,
    });
  }
  return out;
}

async function loadHeatMap(): Promise<{ tiles: ClusterTile[]; snapshotDate: string | null }> {
  const latest = await sql<LatestSnapshot[]>`
    SELECT MAX(snapshot_date)::text AS snapshot_date FROM app.scores
  `;
  const snapshotDate = latest[0]?.snapshot_date ?? null;
  if (!snapshotDate) return { tiles: [], snapshotDate: null };

  // Pull cluster stats + returns in parallel — returns query touches golden_db
  // (separate Postgres) so it doesn't contend with the app DB query.
  const [rawTiles, returns] = await Promise.all([
    sql<Omit<ClusterTile, "ret_1w" | "ret_1m" | "ret_1y">[]>`
      SELECT
        c.id   AS cluster_id,
        c.name AS cluster_name,
        mc.id  AS meta_cluster_id,
        mc.name AS meta_cluster_name,
        mc.display_order AS meta_display_order,
        COUNT(s.symbol)::int AS stock_count,
        AVG(s.composite_pct)::float AS avg_composite,
        AVG(s.quality_pct)::float   AS avg_quality,
        AVG(s.valuation_pct)::float AS avg_valuation,
        AVG(s.momentum_pct)::float  AS avg_momentum
      FROM app.cluster c
      JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
      LEFT JOIN app.scores s
        ON s.cluster_id = c.id
       AND s.snapshot_date = ${snapshotDate}
      WHERE c.id <> 'unclassified'
      GROUP BY c.id, c.name, mc.id, mc.name, mc.display_order
      ORDER BY mc.display_order, c.name
    `,
    loadClusterReturns(snapshotDate),
  ]);
  const tiles: ClusterTile[] = rawTiles.map((t) => {
    const r = returns.get(t.cluster_id);
    return {
      ...t,
      ret_1w: r?.w1 ?? null,
      ret_1m: r?.m1 ?? null,
      ret_1y: r?.y1 ?? null,
    };
  });
  return { tiles, snapshotDate };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { tiles, snapshotDate } = await loadHeatMap();

  // Group by meta_cluster (sector), preserving the curated display_order
  // so financials always lead, frontier-tech lands last, etc.
  type Group = { id: string; name: string; order: number; tiles: ClusterTile[] };
  const groupedMap = new Map<string, Group>();
  for (const t of tiles) {
    const k = t.meta_cluster_id;
    if (!groupedMap.has(k)) {
      groupedMap.set(k, { id: t.meta_cluster_id, name: t.meta_cluster_name, order: t.meta_display_order, tiles: [] });
    }
    groupedMap.get(k)!.tiles.push(t);
  }
  const groups = Array.from(groupedMap.values()).sort((a, b) => a.order - b.order);

  // Active sector — from ?sector=<id> param. Defaults to first sector so the
  // page never renders empty. Falls back gracefully if URL has stale id.
  const activeId =
    (sp.sector && groups.find((g) => g.id === sp.sector)?.id) ||
    groups[0]?.id;
  const activeGroup = groups.find((g) => g.id === activeId);

  return (
    <div className="theme-teal mx-auto max-w-[1200px] px-4 md:px-6 py-8 md:py-12">
      <Hero
        snapshotDate={snapshotDate}
        clusterCount={tiles.length}
        stockCount={tiles.reduce((a, b) => a + b.stock_count, 0)}
      />
      <ScoreBandsLegend />

      {/* Sector tabs — one sector at a time. URL-driven (?sector=<id>) so
          deep links survive page refresh + history. Active tab gets a teal
          underline that matches the page theme; the dot color is the sector's
          live average composite band so collapsed sectors still telegraph
          strength at a glance. */}
      {groups.length > 0 && (
        <>
          <SectorTabs groups={groups} activeId={activeId!} />
          {activeGroup && (
            <div className="mt-6">
              <SectorTilesGrid tiles={activeGroup.tiles} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SectorTabs({
  groups, activeId,
}: {
  groups: { id: string; name: string; tiles: ClusterTile[] }[];
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
      className="mt-6 md:mt-8 flex flex-col gap-1 md:gap-1.5 sticky top-14 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2 backdrop-blur-md"
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
  groups: { id: string; name: string; tiles: ClusterTile[] }[];
  activeId: string;
}) {
  return (
    <div className="flex flex-wrap gap-1 md:gap-1.5">
      {groups.map((g) => {
        const avg =
          g.tiles.reduce((a, t) => a + (t.avg_composite ?? 0), 0) /
          Math.max(1, g.tiles.filter((t) => t.avg_composite != null).length);
        const dot = bandColor(band(avg));
        const active = g.id === activeId;
        const stockTotal = g.tiles.reduce((a, t) => a + t.stock_count, 0);
        return (
          <Link
            key={g.id}
            href={`/clusters?sector=${encodeURIComponent(g.id)}`}
            scroll={false}
            className="px-2.5 md:px-3 py-1 md:py-1.5 rounded-md text-[12px] md:text-[12.5px] inline-flex items-center gap-1.5 md:gap-2 transition-colors whitespace-nowrap border"
            style={
              active
                ? {
                    // Selected tab: tinted background + colored border + bold
                    // label — three reinforcing signals so it doesn't read as
                    // "just another chip" in a row of similar pills.
                    borderColor: dot,
                    backgroundColor: "var(--color-card)",
                    color: "var(--color-ink)",
                    boxShadow: `inset 0 0 0 1px ${dot}`,
                  }
                : {
                    borderColor: "var(--color-border-default)",
                    backgroundColor: "transparent",
                    color: "var(--color-muted)",
                  }
            }
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: dot }}
            />
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

function SectorTilesGrid({ tiles }: { tiles: ClusterTile[] }) {
  // Single column on the narrowest phones (<400px) so labels don't truncate
  // into "Capital Mar..." 2 cols at 400px+, scales up from there. Slightly
  // larger gap on mobile so the tiles breathe.
  return (
    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {tiles.map((t) => (
        <ClusterTileCard key={t.cluster_id} tile={t} />
      ))}
    </div>
  );
}

function Hero(props: { snapshotDate: string | null; clusterCount: number; stockCount: number }) {
  return (
    <section className="max-w-[720px]">
      <h1 className="font-display text-[44px] leading-[1.05] tracking-tight">
        Where the Indian market is{" "}
        <em className="text-[var(--color-accent-600)] not-italic">strong</em>,
        and where it isn&apos;t.
      </h1>
      <p className="mt-5 text-[16px] leading-[1.6] muted-text max-w-[600px]">
        Every actively traded NSE stock, scored on quality, valuation, and momentum within
        its <em>peer cluster</em> — not the whole market. Click any tile to see what&apos;s
        moving inside it.
      </p>
      <div className="mt-6 flex items-center gap-6 text-[12px] muted-text">
        <span>{props.stockCount.toLocaleString("en-IN")} stocks</span>
        <span>•</span>
        <span>{props.clusterCount} peer clusters</span>
        {props.snapshotDate && (
          <>
            <span>•</span>
            <span>Snapshot {props.snapshotDate}</span>
          </>
        )}
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
    <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] muted-text">
      <span>Cluster strength:</span>
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
  );
}

/**
 * Tile — denser layout. Composite badge + name + stock count on one row,
 * pill-style 1W/1M/1Y returns below. The Q/V/M average pillars were dropped
 * from the visible tile (still on the cluster detail page) because they
 * doubled the height and the composite already aggregates them.
 */
function ClusterTileCard({ tile }: { tile: ClusterTile }) {
  const b = band(tile.avg_composite);
  const bg = bandColor(b);
  const numColor = b === "neutral" ? "var(--color-ink)" : "white";
  return (
    <Link
      href={`/cluster/${tile.cluster_id}`}
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
            {tile.cluster_name}
          </div>
          <div className="text-[10px] muted-text mt-0.5">{tile.stock_count} stocks</div>
        </div>
      </div>
      {(tile.ret_1w != null || tile.ret_1m != null || tile.ret_1y != null) && (
        <div
          className="mt-2 grid grid-cols-3 gap-1 text-[10px]"
          title="Market-cap-weighted total return across the stocks in this cluster"
        >
          <ReturnMini label="1W" value={tile.ret_1w} />
          <ReturnMini label="1M" value={tile.ret_1m} />
          <ReturnMini label="1Y" value={tile.ret_1y} />
        </div>
      )}
    </Link>
  );
}

/**
 * Compact return badge: "1Y +24%". Colored green/red by sign, muted when null.
 * 10.5px keeps it from competing with the pillar scores above.
 */
function ReturnMini({ label, value }: { label: string; value: number | null }) {
  if (value == null) {
    return (
      <div className="flex items-center justify-between rounded-sm px-1.5 py-0.5 hairline border opacity-50">
        <span className="muted-text">{label}</span>
        <span className="tabular-nums muted-text">—</span>
      </div>
    );
  }
  const pct = value * 100;
  const color =
    pct >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)";
  const sign = pct >= 0 ? "+" : "";
  // Single decimal for sub-10% moves; no decimal once we cross +/-10%.
  const txt = Math.abs(pct) >= 10 ? Math.round(pct).toString() : pct.toFixed(1);
  return (
    <div className="flex items-center justify-between rounded-sm px-1.5 py-0.5 hairline border">
      <span className="muted-text">{label}</span>
      <span className="tabular-nums font-medium" style={{ color }}>
        {sign}{txt}%
      </span>
    </div>
  );
}
