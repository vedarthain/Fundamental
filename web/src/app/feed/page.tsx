import Link from "next/link";
import { sql } from "@/lib/db";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { band, bandColor, tierLabel } from "@/lib/score";

// Score data changes weekly. 6h ISR cache avoids waking Neon on every visit.
// force-dynamic removed — this page has no per-request searchParams/cookies.
export const revalidate = 21600;

type DeltaRow = {
  symbol: string;
  company_name: string;
  industry_id: string;
  industry_name: string;
  maturity_tier: string;
  prev_composite: number | null;
  curr_composite: number | null;
  prev_quality: number | null;
  curr_quality: number | null;
  prev_valuation: number | null;
  curr_valuation: number | null;
  prev_momentum: number | null;
  curr_momentum: number | null;
};

type SnapshotPair = {
  prev_date: string;
  curr_date: string;
  movers_count: number;
};

const PILLARS = [
  { key: "composite", label: "Industry Score" },
  { key: "quality", label: "Quality" },
  { key: "valuation", label: "Valuation" },
  { key: "momentum", label: "Momentum" },
] as const;

type PillarKey = (typeof PILLARS)[number]["key"];

function isPillarKey(s: string | undefined): s is PillarKey {
  return !!s && PILLARS.some((p) => p.key === s);
}

async function loadDeltas(pillar: PillarKey) {
  // Get the two latest distinct snapshot dates
  const dates = await sql<{ snapshot_date: string }[]>`
    SELECT DISTINCT snapshot_date::text
    FROM app.scores
    ORDER BY snapshot_date DESC
    LIMIT 2
  `;
  if (dates.length < 2) {
    return { movers: [] as DeltaRow[], pair: null as SnapshotPair | null };
  }
  const [curr, prev] = dates;

  const rows = await sql<DeltaRow[]>`
    WITH cur AS (SELECT * FROM app.scores WHERE snapshot_date = ${curr.snapshot_date}),
         prv AS (SELECT * FROM app.scores WHERE snapshot_date = ${prev.snapshot_date})
    SELECT
      cur.symbol,
      u.company_name,
      cur.cluster_id AS industry_id, c.name AS industry_name, cur.maturity_tier,
      prv.composite_pct AS prev_composite, cur.composite_pct AS curr_composite,
      prv.quality_pct   AS prev_quality,   cur.quality_pct   AS curr_quality,
      prv.valuation_pct AS prev_valuation, cur.valuation_pct AS curr_valuation,
      prv.momentum_pct  AS prev_momentum,  cur.momentum_pct  AS curr_momentum
    FROM cur
    JOIN prv USING (symbol)
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = cur.cluster_id
  `;
  return {
    movers: rows,
    pair: {
      prev_date: prev.snapshot_date,
      curr_date: curr.snapshot_date,
      movers_count: rows.length,
    } as SnapshotPair,
  };
}

function deltaFor(r: DeltaRow, pillar: PillarKey): number | null {
  const cur = r[`curr_${pillar}` as keyof DeltaRow] as number | null;
  const prv = r[`prev_${pillar}` as keyof DeltaRow] as number | null;
  if (cur == null || prv == null) return null;
  return cur - prv;
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const pillar: PillarKey = isPillarKey(sp.pillar) ? sp.pillar : "composite";
  const { movers, pair } = await loadDeltas(pillar);

  const withDelta = movers
    .map((r) => ({ row: r, d: deltaFor(r, pillar) }))
    .filter((x): x is { row: DeltaRow; d: number } => x.d != null);

  const ups = [...withDelta].sort((a, b) => b.d - a.d).slice(0, 15);
  const downs = [...withDelta].sort((a, b) => a.d - b.d).slice(0, 15);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-10">
      <header className="max-w-[760px]">
        <div className="text-[12px] uppercase tracking-wide muted-text">Score delta feed</div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight mt-1">
          What changed this week.
        </h1>
        <p className="mt-3 text-[14.5px] muted-text leading-[1.6]">
          The biggest movers between two weekly snapshots. Up means score
          improved (climbed within its peer cluster); down means it slipped.
        </p>
        {pair && (
          <div className="mt-3 text-[12px] muted-text">
            Comparing <span className="tabular-nums ink-text">{pair.curr_date}</span> vs{" "}
            <span className="tabular-nums ink-text">{pair.prev_date}</span> ·{" "}
            {pair.movers_count.toLocaleString("en-IN")} stocks in both snapshots
          </div>
        )}
      </header>

      {/* Pillar tabs */}
      <nav className="mt-6 flex flex-wrap gap-1.5">
        {PILLARS.map((p) => {
          const active = p.key === pillar;
          const href = p.key === "composite" ? "/feed" : `/feed?pillar=${p.key}`;
          return (
            <Link
              key={p.key}
              href={href}
              className={`px-3 py-1.5 rounded-full text-[12px] border transition-colors ${
                active
                  ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
                  : "hairline bg-[var(--color-card)] hover:bg-[var(--color-paper)]"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>

      {pair == null ? (
        <EmptyState />
      ) : (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Board
            label="Biggest gains"
            color="var(--color-score-good)"
            icon="up"
            rows={ups}
            pillar={pillar}
          />
          <Board
            label="Biggest losses"
            color="var(--color-score-poor)"
            icon="down"
            rows={downs}
            pillar={pillar}
          />
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card p-12 mt-10 text-center">
      <div className="font-display text-[20px] mb-2">Building the ledger</div>
      <p className="muted-text text-[14px] max-w-[480px] mx-auto leading-[1.6]">
        We need at least two weekly snapshots to compute deltas. The next snapshot will
        unlock this feed.
      </p>
    </div>
  );
}

function Board({
  label, color, icon, rows, pillar,
}: {
  label: string;
  color: string;
  icon: "up" | "down";
  rows: { row: DeltaRow; d: number }[];
  pillar: PillarKey;
}) {
  return (
    <section className="card overflow-hidden">
      <header
        className="px-4 py-3 border-b hairline flex items-baseline justify-between"
        style={{ borderTop: `3px solid ${color}` }}
      >
        <div className="font-medium text-[14px]" style={{ color }}>
          {label}
        </div>
        <div className="muted-text text-[11px] uppercase tracking-wide">
          {pillar} · top {rows.length}
        </div>
      </header>
      <ol className="divide-y hairline">
        {rows.map((r, i) => (
          <li key={r.row.symbol}>
            <Link
              href={`/stock/${r.row.symbol}`}
              className="grid grid-cols-[20px_1fr_98px_64px] items-center gap-3 px-4 py-3 hover:bg-[var(--color-paper)]/60 transition-colors"
            >
              <span className="muted-text tabular-nums text-[11px]">{i + 1}</span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-[13px] tabular-nums">{r.row.symbol}</span>
                  <span className="muted-text text-[11px] truncate">
                    {r.row.industry_name} · {tierLabel(r.row.maturity_tier)}
                  </span>
                </div>
                <div className="muted-text text-[11.5px] truncate">
                  {r.row.company_name}
                </div>
              </div>
              <ScoreSpan
                prev={r.row[`prev_${pillar}` as keyof DeltaRow] as number}
                curr={r.row[`curr_${pillar}` as keyof DeltaRow] as number}
              />
              <DeltaPill d={r.d} icon={icon} />
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-4 py-6 text-[12px] muted-text text-center">
            No moves to show.
          </li>
        )}
      </ol>
    </section>
  );
}

function ScoreSpan({ prev, curr }: { prev: number; curr: number }) {
  return (
    <div className="flex items-baseline gap-1.5 tabular-nums text-[12px] justify-end">
      <span className="muted-text">{Math.round(prev)}</span>
      <span className="muted-text" style={{ fontSize: 9 }}>
        →
      </span>
      <span
        className="font-semibold"
        style={{
          color: bandColor(band(curr)),
        }}
      >
        {Math.round(curr)}
      </span>
    </div>
  );
}

function DeltaPill({ d, icon }: { d: number; icon: "up" | "down" }) {
  const positive = d >= 0;
  const colour = positive ? "var(--color-score-good)" : "var(--color-score-poor)";
  const Icon = icon === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className="inline-flex items-center justify-end gap-1 tabular-nums font-semibold text-[13px]"
      style={{ color: colour }}
    >
      <Icon size={13} strokeWidth={2.5} />
      {positive ? "+" : ""}
      {Math.round(d)}
    </span>
  );
}
