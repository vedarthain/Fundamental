import Link from "next/link";
import { sql } from "@/lib/db";
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
};

type LatestSnapshot = { snapshot_date: string };

async function loadHeatMap(): Promise<{ tiles: ClusterTile[]; snapshotDate: string | null }> {
  const latest = await sql<LatestSnapshot[]>`
    SELECT MAX(snapshot_date)::text AS snapshot_date FROM app.scores
  `;
  const snapshotDate = latest[0]?.snapshot_date ?? null;
  if (!snapshotDate) return { tiles: [], snapshotDate: null };

  const tiles = await sql<ClusterTile[]>`
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
  `;
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
