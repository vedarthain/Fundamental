import Link from "next/link";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = {
  cluster_id: string;
  cluster_name: string;
  meta_cluster_name: string;
  meta_display_order: number;
  pillar_weights: Record<string, number>;
  effective_from: string;
  q_components: number;
  v_components: number;
  m_components: number;
  versions: number;
};

async function load(): Promise<Row[]> {
  return sql<Row[]>`
    SELECT
      c.id AS cluster_id, c.name AS cluster_name,
      mc.name AS meta_cluster_name, mc.display_order AS meta_display_order,
      csa.pillar_weights, csa.effective_from::text,
      (SELECT COUNT(*)::int FROM jsonb_object_keys(COALESCE(csa.quality,   '{}'::jsonb))) AS q_components,
      (SELECT COUNT(*)::int FROM jsonb_object_keys(COALESCE(csa.valuation, '{}'::jsonb))) AS v_components,
      (SELECT COUNT(*)::int FROM jsonb_object_keys(COALESCE(csa.momentum,  '{}'::jsonb))) AS m_components,
      (SELECT COUNT(*)::int FROM app.cluster_scorecard cs WHERE cs.cluster_id = c.id) AS versions
    FROM app.cluster c
    JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    LEFT JOIN app.cluster_scorecard_active csa ON csa.cluster_id = c.id
    WHERE c.id <> 'unclassified'
    ORDER BY mc.display_order, c.name
  `;
}

export default async function ScorecardListPage() {
  const rows = await load();

  // Group by meta-cluster for readability
  const grouped = new Map<string, Row[]>();
  for (const r of rows) {
    if (!grouped.has(r.meta_cluster_name)) grouped.set(r.meta_cluster_name, []);
    grouped.get(r.meta_cluster_name)!.push(r);
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-10">
      <AdminHeader />
      <header className="mt-3 max-w-[760px]">
        <h1 className="font-display text-[36px] tracking-tight leading-tight">
          Cluster scorecards
        </h1>
        <p className="mt-3 text-[14px] muted-text">
          Edit pillar weights and per-component weights for any peer cluster.
          Saving creates a new versioned row in <code className="text-[12px]">app.cluster_scorecard</code>;
          it takes effect on the next scoring run (re-run <code className="text-[12px]">etl score</code>).
        </p>
      </header>

      {Array.from(grouped.entries()).map(([metaName, items]) => (
        <section key={metaName} className="mt-10">
          <div className="text-[11px] uppercase tracking-wide muted-text mb-3">
            {metaName}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((r) => (
              <Link
                key={r.cluster_id}
                href={`/admin/scorecards/${r.cluster_id}`}
                className="card p-4 hover:border-[var(--color-accent-300)] transition-colors block"
              >
                <div className="font-medium text-[14px]">{r.cluster_name}</div>
                {r.pillar_weights ? (
                  <div className="mt-3 flex items-center gap-1.5 text-[11px] tabular-nums">
                    <Pill color="var(--color-accent-600)">Q {r.pillar_weights.q}</Pill>
                    <Pill color="var(--color-accent-400)">V {r.pillar_weights.v}</Pill>
                    <Pill color="var(--color-accent-300)">M {r.pillar_weights.m}</Pill>
                  </div>
                ) : (
                  <div className="mt-3 text-[11px] muted-text italic">No scorecard</div>
                )}
                <div className="mt-2 text-[11px] muted-text">
                  {r.q_components} · {r.v_components} · {r.m_components} components
                  {" · "}
                  {r.versions} version{r.versions === 1 ? "" : "s"}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-sm border"
      style={{ borderColor: color, color }}
    >
      {children}
    </span>
  );
}

function AdminHeader() {
  return (
    <div
      className="-mt-4 mb-4 px-3 py-2 rounded-md border text-[12px] muted-text"
      style={{
        backgroundColor: "var(--color-accent-50)",
        borderColor: "var(--color-accent-200)",
      }}
    >
      <strong className="ink-text">Admin area</strong> · No authentication in v1.
      Anything saved here goes live on the next scoring run.
    </div>
  );
}
