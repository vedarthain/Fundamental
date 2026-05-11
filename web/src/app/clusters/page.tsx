import Link from "next/link";
import { sql, golden } from "@/lib/db";
import { band, bandColor, fmtPct } from "@/lib/score";

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

export default async function Home() {
  const { tiles, snapshotDate } = await loadHeatMap();

  const grouped = new Map<string, { name: string; order: number; tiles: ClusterTile[] }>();
  for (const t of tiles) {
    const k = t.meta_cluster_id;
    if (!grouped.has(k)) {
      grouped.set(k, { name: t.meta_cluster_name, order: t.meta_display_order, tiles: [] });
    }
    grouped.get(k)!.tiles.push(t);
  }
  const groups = Array.from(grouped.values()).sort((a, b) => a.order - b.order);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <Hero
        snapshotDate={snapshotDate}
        clusterCount={tiles.length}
        stockCount={tiles.reduce((a, b) => a + b.stock_count, 0)}
      />
      <ScoreBandsLegend />
      <div className="mt-10 space-y-12">
        {groups.map((g) => (
          <MetaClusterRow key={g.name} name={g.name} tiles={g.tiles} />
        ))}
      </div>
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

function MetaClusterRow({ name, tiles }: { name: string; tiles: ClusterTile[] }) {
  return (
    <section>
      <h2 className="font-display text-[22px] mb-4 tracking-tight">{name}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <ClusterTileCard key={t.cluster_id} tile={t} />
        ))}
      </div>
    </section>
  );
}

function ClusterTileCard({ tile }: { tile: ClusterTile }) {
  const b = band(tile.avg_composite);
  const bg = bandColor(b);
  const numColor = b === "neutral" ? "var(--color-ink)" : "white";
  return (
    <Link
      href={`/cluster/${tile.cluster_id}`}
      className="card p-4 group hover:border-[var(--color-accent-300)] transition-colors block"
    >
      <div className="flex items-start gap-3">
        <div
          className="w-12 h-12 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: bg }}
        >
          <span className="text-[18px] font-medium tabular-nums" style={{ color: numColor }}>
            {tile.avg_composite == null ? "—" : Math.round(tile.avg_composite)}
          </span>
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-medium leading-tight truncate">
            {tile.cluster_name}
          </div>
          <div className="text-[11px] muted-text mt-0.5">{tile.stock_count} stocks</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1 text-[11px]">
        <PillarMini label="Q" value={tile.avg_quality} />
        <PillarMini label="V" value={tile.avg_valuation} />
        <PillarMini label="M" value={tile.avg_momentum} />
      </div>
      {(tile.ret_1w != null || tile.ret_1m != null || tile.ret_1y != null) && (
        <div
          className="mt-1.5 grid grid-cols-3 gap-1 text-[10.5px]"
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

function PillarMini({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between rounded-sm px-1.5 py-0.5 hairline border">
      <span className="muted-text">{label}</span>
      <span className="tabular-nums">{fmtPct(value, "")}</span>
    </div>
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
