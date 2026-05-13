import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { band, bandColor, fmtPct, tierLabel } from "@/lib/score";

export const revalidate = 3600;

type ClusterMeta = {
  industry_id: string;
  industry_name: string;
  sector_name: string;
  description: string | null;
};

type StockRow = {
  symbol: string;
  company_name: string;
  maturity_tier: string;
  market_cap_cr: number | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  score_status: string | null;
};

async function loadCluster(id: string) {
  const meta = await sql<ClusterMeta[]>`
    SELECT c.id AS industry_id, c.name AS industry_name,
           mc.name AS sector_name, c.description
    FROM app.cluster c
    JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    WHERE c.id = ${id}
  `;
  if (meta.length === 0) return null;

  const latest = await sql<{ snapshot_date: string }[]>`
    SELECT MAX(snapshot_date)::text AS snapshot_date FROM app.scores WHERE cluster_id = ${id}
  `;
  const snapshot = latest[0]?.snapshot_date ?? null;
  if (!snapshot) return { meta: meta[0], snapshot: null, stocks: [] as StockRow[] };

  const stocks = await sql<StockRow[]>`
    SELECT
      s.symbol,
      u.company_name,
      s.maturity_tier,
      sm.market_cap_cr::float AS market_cap_cr,
      s.composite_pct,
      s.quality_pct,
      s.valuation_pct,
      s.momentum_pct,
      s.score_status
    FROM app.scores s
    JOIN app.universe u USING (symbol)
    LEFT JOIN app.screener_meta sm USING (symbol)
    WHERE s.cluster_id = ${id} AND s.snapshot_date = ${snapshot}
    ORDER BY
      CASE s.maturity_tier
        WHEN 'veteran' THEN 1
        WHEN 'mature'  THEN 2
        WHEN 'mid'     THEN 3
        WHEN 'new'     THEN 4
        ELSE 5
      END,
      s.composite_pct DESC NULLS LAST
  `;
  return { meta: meta[0], snapshot, stocks };
}

const TIER_ORDER = ["veteran", "mature", "mid", "new"] as const;
const TIER_DISPLAY: Record<string, { label: string; sub: string }> = {
  veteran: {
    label: "Long-term Compounders",
    sub: "10+ years of fundamentals — the most credible scores",
  },
  mature: {
    label: "Established",
    sub: "7–9 years of fundamentals",
  },
  mid: {
    label: "Emerging",
    sub: "3–6 years of fundamentals — younger track records",
  },
  new: {
    label: "New Listings",
    sub: "1–2 years of data — scores reflect very limited history",
  },
};

export default async function ClusterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadCluster(id);
  if (!data) return notFound();
  const { meta, snapshot, stocks } = data;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-10">
      <Link href="/sectors" className="text-[12px] muted-text hover:text-[var(--color-accent-600)]">
        ← All sectors
      </Link>
      <header className="mt-3 flex items-start justify-between gap-8">
        <div className="max-w-[760px]">
          <div className="text-[12px] muted-text uppercase tracking-wide">
            {meta.sector_name}
          </div>
          <h1 className="font-display text-[36px] mt-1 leading-tight tracking-tight">
            {meta.industry_name}
          </h1>
          {meta.description && (
            <p className="mt-3 text-[15px] muted-text">{meta.description}</p>
          )}
          <div className="mt-3 text-[12px] muted-text">
            {stocks.length} stocks scored
            {snapshot && <> · snapshot {snapshot}</>}
          </div>
        </div>
        <Link
          href={`/industry/${meta.industry_id}/leaders`}
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[13px] border hairline bg-[var(--color-card)] hover:bg-[var(--color-paper)] hover:border-[var(--color-accent-300)] transition-colors"
        >
          <span>View Leaders</span>
          <span className="muted-text">→</span>
        </Link>
      </header>

      {/* Group stocks by tier so credible long-history stocks come first */}
      {TIER_ORDER.map((tier) => {
        const inTier = stocks.filter((s) => s.maturity_tier === tier);
        if (inTier.length === 0) return null;
        const td = TIER_DISPLAY[tier];
        return (
          <section key={tier} className="mt-10">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <div>
                <h2 className="font-display text-[22px] tracking-tight">
                  {td.label}{" "}
                  <span className="text-[14px] muted-text tabular-nums font-sans">
                    · {inTier.length}
                  </span>
                </h2>
                <div className="text-[12px] muted-text mt-0.5">{td.sub}</div>
              </div>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-[14px]">
                <thead className="bg-[var(--color-paper)]">
                  <tr className="text-left muted-text text-[12px] uppercase tracking-wide">
                    <th className="px-4 py-3">Stock</th>
                    <th className="px-4 py-3 text-right">Market cap</th>
                    <th className="px-4 py-3 text-right">Quality</th>
                    <th className="px-4 py-3 text-right">Valuation</th>
                    <th className="px-4 py-3 text-right">Momentum</th>
                    <th className="px-4 py-3 text-right">Composite</th>
                  </tr>
                </thead>
                <tbody>
                  {inTier.map((s) => (
                    <tr key={s.symbol} className="border-t hairline hover:bg-[var(--color-paper)]/40 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/stock/${s.symbol}`} className="font-medium hover:text-[var(--color-accent-600)]">
                          {s.symbol}
                        </Link>
                        <div className="text-[12px] muted-text truncate max-w-[300px]">
                          {s.company_name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[13px] muted-text">
                        {s.market_cap_cr ? `₹${(s.market_cap_cr / 100).toFixed(1)}K Cr` : "—"}
                      </td>
                      <PillarCell value={s.quality_pct} />
                      <PillarCell value={s.valuation_pct} />
                      <PillarCell value={s.momentum_pct} />
                      <CompositeCell value={s.composite_pct} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PillarCell({ value }: { value: number | null }) {
  const b = band(value);
  return (
    <td className="px-4 py-3 text-right tabular-nums">
      <span style={{ color: bandColor(b) }} className="font-medium">
        {fmtPct(value, "")}
      </span>
    </td>
  );
}

function CompositeCell({ value }: { value: number | null }) {
  const b = band(value);
  return (
    <td className="px-4 py-3 text-right">
      <span
        className="inline-block min-w-[36px] text-center px-2 py-0.5 rounded-md tabular-nums font-medium text-[13px]"
        style={{ backgroundColor: bandColor(b), color: b === "neutral" ? "var(--color-ink)" : "white" }}
      >
        {value == null ? "—" : Math.round(value)}
      </span>
    </td>
  );
}
