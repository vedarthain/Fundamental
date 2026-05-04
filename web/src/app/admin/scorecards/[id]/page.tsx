import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { ScorecardEditor } from "./EditForm";

export const dynamic = "force-dynamic";

type ClusterMeta = {
  cluster_id: string;
  cluster_name: string;
  meta_cluster_name: string;
};

type Active = {
  id: number;
  effective_from: string;
  pillar_weights: Record<string, number>;
  quality: Record<string, number>;
  valuation: Record<string, number>;
  momentum: Record<string, number>;
  loss_maker_val_fallback: [string, number][];
  edited_by: string | null;
  notes: string | null;
};

type HistoryRow = {
  id: number;
  effective_from: string;
  edited_by: string | null;
  notes: string | null;
};

async function load(id: string) {
  const meta = await sql<ClusterMeta[]>`
    SELECT c.id AS cluster_id, c.name AS cluster_name, mc.name AS meta_cluster_name
    FROM app.cluster c
    JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    WHERE c.id = ${id}
  `;
  if (meta.length === 0) return null;

  const active = await sql<Active[]>`
    SELECT id, effective_from::text, pillar_weights, quality, valuation, momentum,
           loss_maker_val_fallback, edited_by, notes
    FROM app.cluster_scorecard_active
    WHERE cluster_id = ${id}
  `;
  const history = await sql<HistoryRow[]>`
    SELECT id, effective_from::text, edited_by, notes
    FROM app.cluster_scorecard
    WHERE cluster_id = ${id}
    ORDER BY effective_from DESC
    LIMIT 20
  `;
  return { meta: meta[0], active: active[0] ?? null, history };
}

export default async function ScorecardEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await load(id);
  if (!data) return notFound();
  const { meta, active, history } = data;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-10">
      <Link
        href="/admin/scorecards"
        className="text-[12px] muted-text hover:text-[var(--color-accent-600)]"
      >
        ← All scorecards
      </Link>

      <header className="mt-3 max-w-[760px]">
        <div className="text-[12px] uppercase tracking-wide muted-text">
          {meta.meta_cluster_name}
        </div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight mt-1">
          {meta.cluster_name}
        </h1>
        <p className="mt-3 text-[13px] muted-text">
          Edit weights below and save. A new versioned row is written to{" "}
          <code className="text-[12px]">app.cluster_scorecard</code>; the loader picks
          up the most recent on the next scoring run.
        </p>
      </header>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
        <ScorecardEditor
          clusterId={meta.cluster_id}
          initial={active}
        />
        <HistoryPane history={history} activeId={active?.id ?? null} />
      </div>
    </div>
  );
}

function HistoryPane({
  history, activeId,
}: { history: HistoryRow[]; activeId: number | null }) {
  return (
    <aside className="card p-4 self-start">
      <div className="text-[11px] uppercase tracking-wide muted-text mb-3">Version history</div>
      <ul className="space-y-2.5">
        {history.map((h) => (
          <li key={h.id} className="text-[12px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="tabular-nums">
                {new Date(h.effective_from).toLocaleString("en-IN", {
                  day: "numeric", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </span>
              {h.id === activeId && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-sm uppercase tracking-wide"
                  style={{
                    backgroundColor: "var(--color-accent-50)",
                    color: "var(--color-accent-700)",
                  }}
                >
                  Active
                </span>
              )}
            </div>
            <div className="muted-text">
              {h.edited_by ?? "—"}
              {h.notes ? ` · ${h.notes}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
