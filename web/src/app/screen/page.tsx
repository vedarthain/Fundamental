import Link from "next/link";
import { sql } from "@/lib/db";
import { band, bandColor, fmtPct, tierLabel } from "@/lib/score";
import { Controls } from "./Controls";
import { PAGE_SIZE, parseParams } from "./types";

export const dynamic = "force-dynamic";

type Row = {
  symbol: string;
  company_name: string;
  industry_id: string;
  industry_name: string;
  sector_name: string;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  composite_pct: number | null;
  blend: number | null;
};

async function loadRows(
  w: { q: number; v: number; m: number },
  page: number
): Promise<{ rows: Row[]; total: number }> {
  const offset = (page - 1) * PAGE_SIZE;

  const [{ n }] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM app.scores s
    JOIN app.universe u USING (symbol)
    WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
  `;

  const rows = await sql<Row[]>`
    SELECT s.symbol,
           u.company_name,
           s.cluster_id AS industry_id,
           c.name AS industry_name,
           mc.name AS sector_name,
           s.maturity_tier,
           sm.market_cap_cr,
           sm.current_price::float AS current_price,
           s.quality_pct,
           s.valuation_pct,
           s.momentum_pct,
           s.composite_pct,
           ROUND(
             (COALESCE(s.quality_pct, 0)   * ${w.q} +
              COALESCE(s.valuation_pct, 0) * ${w.v} +
              COALESCE(s.momentum_pct, 0)  * ${w.m}) / 100.0
           )::int AS blend
    FROM app.scores s
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = s.cluster_id
    JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    LEFT JOIN app.screener_meta sm USING (symbol)
    WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
    ORDER BY blend DESC NULLS LAST, s.composite_pct DESC NULLS LAST
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `;

  return { rows, total: n };
}

export default async function ScreenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const params = parseParams(sp);
  const { rows, total } = await loadRows(params.weights, params.page);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const { q, v, m } = params.weights;

  return (
    <div className="theme-indigo mx-auto max-w-[1300px] px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <header className="max-w-[680px]">
          <div className="text-[12px] uppercase tracking-wide muted-text flex items-center gap-2">
            <Link href="/discover" className="hover:underline">Discover</Link>
            <span aria-hidden style={{ color: "var(--color-border-default)" }}>›</span>
            <span>Investing Trials</span>
          </div>
          <h1 className="font-display text-[36px] tracking-tight leading-tight mt-1">
            Your lens, <em className="accent">your ranking</em>
          </h1>
          <p className="mt-3 text-[15px] muted-text">
            Set your own Quality / Valuation / Momentum weights. Every stock is re-blended
            using your weights across all clusters — no re-percentiling. Use this to find
            stocks that fit your investing style, not the platform default.
          </p>
          <div className="mt-3 text-[12px] muted-text">
            Active weights: Q <span className="tabular-nums ink-text">{q}</span> ·
            V <span className="tabular-nums ink-text">{v}</span> ·
            M <span className="tabular-nums ink-text">{m}</span>
            {" "}· {total.toLocaleString("en-IN")} stocks
          </div>
        </header>

        {/* Context callout */}
        <div
          className="card p-4 max-w-[280px] text-[12.5px] muted-text leading-relaxed shrink-0"
          style={{ borderTop: "3px solid var(--color-score-neutral)" }}
        >
          <div className="font-medium ink-text mb-1 text-[13px]">How this differs from Industry Score</div>
          <p>
            Industry Score uses sector-tuned weights per cluster and re-percentiles the
            result. Your blend here uses the same pillar scores but with your weights
            applied uniformly across all sectors — no re-ranking.
          </p>
          <Link href="/discover" className="mt-2 inline-block underline hover:no-underline ink-text">
            ← Back to Discover
          </Link>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-8">
        <aside className="card p-5 self-start lg:sticky lg:top-20">
          <div className="text-[11px] uppercase tracking-wide muted-text mb-4">Score weighting</div>
          <Controls weights={params.weights} preset={params.preset} />

          <div className="mt-6 pt-5 border-t hairline text-[12px] muted-text space-y-1.5">
            <div className="font-medium ink-text text-[12.5px]">Your Score formula</div>
            <p>blend = (Q × {q} + V × {v} + M × {m}) ÷ 100</p>
            <p className="text-[11.5px]">
              No re-percentiling — direct weighted average of the three stored pillar scores.
            </p>
          </div>
        </aside>

        <main>
          <ResultsTable rows={rows} weights={params.weights} />
          <Pagination page={params.page} totalPages={totalPages} weights={params.weights} preset={params.preset} />
        </main>
      </div>
    </div>
  );
}

function ResultsTable({ rows, weights }: { rows: Row[]; weights: { q: number; v: number; m: number } }) {
  if (rows.length === 0) {
    return <div className="card p-12 text-center muted-text">No data available.</div>;
  }

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-[14px]">
        <thead className="bg-[var(--color-paper)]">
          <tr className="text-left muted-text text-[11px] uppercase tracking-wide">
            <th className="px-4 py-3 w-[34px]">#</th>
            <th className="px-4 py-3">Stock</th>
            <th className="px-4 py-3">Sector · Industry · Tier</th>
            <th className="px-4 py-3 text-right">
              Mkt cap
              <div className="text-[9px] font-normal normal-case mt-0.5">(₹ Cr)</div>
            </th>
            <th className="px-3 py-3 text-right">
              Q
              <div className="text-[9px] font-normal normal-case mt-0.5">quality</div>
            </th>
            <th className="px-3 py-3 text-right">
              V
              <div className="text-[9px] font-normal normal-case mt-0.5">valuation</div>
            </th>
            <th className="px-3 py-3 text-right">
              M
              <div className="text-[9px] font-normal normal-case mt-0.5">momentum</div>
            </th>
            <th className="px-3 py-3 text-right" title="Platform Industry Score for reference">
              Ind. Score
              <div className="text-[9px] font-normal normal-case mt-0.5">platform</div>
            </th>
            <th className="px-4 py-3 text-right"
              title={`Your blend: Q×${weights.q} + V×${weights.v} + M×${weights.m}`}
            >
              Your Score
              <div className="text-[9px] font-normal normal-case mt-0.5 tabular-nums">
                {weights.q} / {weights.v} / {weights.m}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.symbol} className="border-t hairline hover:bg-[var(--color-paper)]/50">
              <td className="px-4 py-3 muted-text tabular-nums text-[12px]">{i + 1}</td>
              <td className="px-4 py-3">
                <Link href={`/stock/${r.symbol}`} className="font-medium hover:text-[var(--color-accent-600)]">
                  {r.symbol}
                </Link>
                <div className="text-[12px] muted-text truncate max-w-[240px]">{r.company_name}</div>
              </td>
              <td className="px-4 py-3 text-[12px]">
                <div className="text-[10px] uppercase tracking-wide muted-text mb-0.5">{r.sector_name}</div>
                <Link href={`/industry/${r.industry_id}`} className="hover:text-[var(--color-accent-600)]">
                  {r.industry_name}
                </Link>
                <div className="muted-text">{tierLabel(r.maturity_tier)}</div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-[12px] muted-text">
                {fmtMktCapBare(r.market_cap_cr)}
              </td>
              <PillarCell value={r.quality_pct} />
              <PillarCell value={r.valuation_pct} />
              <PillarCell value={r.momentum_pct} />
              {/* Industry Score — muted, reference only */}
              <td className="px-3 py-3 text-right tabular-nums text-[12px] muted-text">
                {r.composite_pct ?? "—"}
              </td>
              <BlendCell value={r.blend} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PillarCell({ value }: { value: number | null }) {
  const b = band(value);
  return (
    <td className="px-3 py-3 text-right tabular-nums">
      <span style={{ color: bandColor(b) }} className="font-medium">
        {fmtPct(value, "")}
      </span>
    </td>
  );
}

function BlendCell({ value }: { value: number | null }) {
  const b = band(value);
  return (
    <td className="px-4 py-3 text-right">
      <span
        className="inline-block min-w-[40px] text-center px-2 py-0.5 rounded-md tabular-nums font-medium text-[13px]"
        style={{
          backgroundColor: bandColor(b),
          color: b === "neutral" ? "var(--color-ink)" : "white",
        }}
      >
        {value == null ? "—" : value}
      </span>
    </td>
  );
}

function fmtMktCapBare(n: number | null): string {
  if (n == null) return "—";
  if (n >= 100_000) return `${(n / 100_000).toFixed(2)}L`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-IN");
}

function Pagination({
  page, totalPages, weights, preset,
}: { page: number; totalPages: number; weights: { q: number; v: number; m: number }; preset: string }) {
  if (totalPages <= 1) return null;

  const buildHref = (p: number) => {
    const q = new URLSearchParams();
    q.set("q", String(weights.q));
    q.set("v", String(weights.v));
    q.set("m", String(weights.m));
    q.set("preset", preset);
    q.set("page", String(p));
    return "/screen?" + q.toString();
  };

  const pages: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <nav className="mt-5 flex items-center justify-center gap-1.5 text-[13px]">
      <PageBtn href={buildHref(Math.max(1, page - 1))} disabled={page === 1}>← Prev</PageBtn>
      {start > 1 && <><PageBtn href={buildHref(1)}>1</PageBtn>{start > 2 && <span className="muted-text">…</span>}</>}
      {pages.map((p) => <PageBtn key={p} href={buildHref(p)} active={p === page}>{p}</PageBtn>)}
      {end < totalPages && <>{end < totalPages - 1 && <span className="muted-text">…</span>}<PageBtn href={buildHref(totalPages)}>{totalPages}</PageBtn></>}
      <PageBtn href={buildHref(Math.min(totalPages, page + 1))} disabled={page === totalPages}>Next →</PageBtn>
    </nav>
  );
}

function PageBtn({ href, children, active, disabled }: {
  href: string; children: React.ReactNode; active?: boolean; disabled?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center px-2.5 py-1 rounded-md tabular-nums border ${
        active
          ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
          : "hairline text-[var(--color-ink)] hover:bg-[var(--color-paper)]"
      } ${disabled ? "opacity-40 pointer-events-none" : ""}`}
    >
      {children}
    </Link>
  );
}
