import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { band, bandColor, fmtPct, tierLabel } from "@/lib/score";

// Score data changes weekly. 6h ISR cache avoids waking Neon on every visit.
// force-dynamic removed — this page has no per-request searchParams/cookies.
export const revalidate = 21600;

type ClusterMeta = {
  industry_id: string;
  industry_name: string;
  sector_name: string;
  description: string | null;
};

type LeaderRow = {
  symbol: string;
  company_name: string;
  maturity_tier: string;
  market_cap_cr: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  composite_pct: number | null;
};

const TIER_OPTS = ["all", "veteran", "mature", "mid", "new"] as const;
type TierOpt = (typeof TIER_OPTS)[number];

async function loadCluster(id: string): Promise<ClusterMeta | null> {
  const rows = await sql<ClusterMeta[]>`
    SELECT c.id AS industry_id, c.name AS industry_name,
           mc.name AS sector_name, c.description
    FROM app.cluster c
    JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    WHERE c.id = ${id}
  `;
  return rows[0] ?? null;
}

async function loadLeaders(id: string, tier: TierOpt): Promise<LeaderRow[]> {
  const tierFilter = tier === "all"
    ? sql``
    : sql`AND s.maturity_tier = ${tier}`;

  return sql<LeaderRow[]>`
    SELECT s.symbol, u.company_name, s.maturity_tier,
           sm.market_cap_cr,
           s.quality_pct, s.valuation_pct, s.momentum_pct, s.composite_pct
    FROM app.scores s
    JOIN app.universe u USING (symbol)
    LEFT JOIN app.screener_meta sm USING (symbol)
    WHERE s.cluster_id = ${id}
      AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
      ${tierFilter}
  `;
}

export default async function LeadersPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const requested = sp.tier ?? "all";
  const tier: TierOpt = (TIER_OPTS as readonly string[]).includes(requested)
    ? (requested as TierOpt)
    : "all";

  const cluster = await loadCluster(id);
  if (!cluster) return notFound();

  const all = await loadLeaders(id, tier);

  if (all.length === 0) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-10">
        <Breadcrumb cluster={cluster} />
        <h1 className="font-display text-[36px] mt-3 tracking-tight">{cluster.industry_name} · Leaders</h1>
        <div className="card p-12 mt-8 text-center muted-text">
          No stocks scored in this {tier === "all" ? "cluster" : `cluster's ${tierLabel(tier)} tier`} yet.
        </div>
      </div>
    );
  }

  const topQuality   = topBy(all, "quality_pct", 10);
  const topValuation = topBy(all, "valuation_pct", 10);
  const topMomentum  = topBy(all, "momentum_pct", 10);
  const topComposite = topBy(all, "composite_pct", 10);

  return (
    <div className="mx-auto max-w-[1300px] px-6 py-10">
      <Breadcrumb cluster={cluster} />

      <header className="mt-3 max-w-[760px]">
        <div className="text-[12px] uppercase tracking-wide muted-text">
          {cluster.sector_name}
        </div>
        <h1 className="font-display text-[36px] mt-1 tracking-tight leading-tight">
          {cluster.industry_name} · Leaders
        </h1>
        <p className="mt-3 text-[14.5px] muted-text">
          Top 10 within this peer cluster across each pillar plus overall Industry Score.
          {tier !== "all" && (
            <> Filtered to <strong className="ink-text">{tierLabel(tier)}</strong>.</>
          )}
        </p>
      </header>

      <TierBar id={id} tier={tier} />

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Board title="Top Quality"   accent="var(--color-accent-600)" pillar="quality_pct"   rows={topQuality} />
        <Board title="Top Valuation" accent="var(--color-accent-400)" pillar="valuation_pct" rows={topValuation} />
        <Board title="Top Momentum"  accent="var(--color-accent-300)" pillar="momentum_pct"  rows={topMomentum} />
        <Board title="Top Industry Score" accent="var(--color-score-excellent)" pillar="composite_pct" rows={topComposite} />
      </div>

      <div className="mt-8 text-[12px]">
        <Link href={`/industry/${id}`} className="muted-text hover:text-[var(--color-accent-600)]">
          ← See all {all.length} stocks in this cluster
        </Link>
      </div>
    </div>
  );
}

function Breadcrumb({ cluster }: { cluster: ClusterMeta }) {
  return (
    <nav className="text-[12px] muted-text">
      <Link href="/" className="hover:text-[var(--color-accent-600)]">All clusters</Link>
      <span className="mx-1.5">/</span>
      <Link href={`/industry/${cluster.industry_id}`} className="hover:text-[var(--color-accent-600)]">
        {cluster.industry_name}
      </Link>
      <span className="mx-1.5">/</span>
      <span>Leaders</span>
    </nav>
  );
}

function TierBar({ id, tier }: { id: string; tier: TierOpt }) {
  const opts: { value: TierOpt; label: string }[] = [
    { value: "all", label: "All tiers" },
    { value: "veteran", label: "Long-established" },
    { value: "mature", label: "Established" },
    { value: "mid", label: "Emerging" },
    { value: "new", label: "New Listing" },
  ];
  return (
    <div className="mt-6 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide muted-text mr-2">Tier</span>
      {opts.map((o) => {
        const active = o.value === tier;
        const href = o.value === "all"
          ? `/industry/${id}/leaders`
          : `/industry/${id}/leaders?tier=${o.value}`;
        const cls = `inline-flex items-center px-2.5 py-1 rounded-full text-[12px] border transition-colors ${
          active
            ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
            : "bg-[var(--color-card)] hairline hover:bg-[var(--color-paper)]"
        }`;
        return (
          <Link key={o.value} href={href} className={cls}>
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

function Board({
  title, accent, pillar, rows,
}: {
  title: string;
  accent: string;
  pillar: keyof Pick<LeaderRow, "quality_pct" | "valuation_pct" | "momentum_pct" | "composite_pct">;
  rows: LeaderRow[];
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b hairline" style={{ borderTop: `3px solid ${accent}` }}>
        <div className="font-medium text-[14px]" style={{ color: accent }}>
          {title}
        </div>
      </div>
      <ol className="divide-y hairline">
        {rows.map((r, i) => {
          const v = r[pillar];
          const b = band(v);
          return (
            <li key={r.symbol}>
              <Link
                href={`/stock/${r.symbol}`}
                className="grid grid-cols-[20px_1fr_44px] items-center gap-2 px-4 py-2.5 hover:bg-[var(--color-paper)]/60 transition-colors"
              >
                <span className="text-[11px] muted-text tabular-nums">{i + 1}</span>
                <div className="min-w-0">
                  <div className="font-medium text-[13px] truncate">{r.symbol}</div>
                  <div className="text-[11px] muted-text truncate">
                    {r.company_name}
                  </div>
                </div>
                <span
                  className="inline-flex items-center justify-center px-2 py-0.5 rounded-md tabular-nums font-medium text-[12px]"
                  style={{
                    backgroundColor: bandColor(b),
                    color: b === "neutral" ? "var(--color-ink)" : "white",
                  }}
                >
                  {fmtPct(v, "")}
                </span>
              </Link>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="px-4 py-6 text-center text-[12px] muted-text">No data</li>
        )}
      </ol>
    </div>
  );
}

function topBy(rows: LeaderRow[], key: keyof LeaderRow, n: number): LeaderRow[] {
  return rows
    .filter((r) => r[key] != null)
    .sort((a, b) => Number(b[key]) - Number(a[key]))
    .slice(0, n);
}
