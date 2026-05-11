/**
 * /compare — side-by-side stock comparison.
 *
 * Usage: /compare?a=INFY&b=TCS&c=WIPRO
 *
 * Up to 3 symbols compared in parallel columns. Each row of the table renders
 * the same metric for each stock, with the winner highlighted (highest
 * composite, lowest valuation %ile = cheapest, etc.). Same scorecard,
 * apples-to-apples.
 *
 * Design choices:
 *   - Server-rendered: search params drive the page, no client interactivity
 *     beyond the symbol-input form at the top.
 *   - Up to 3 columns: more than that and rows become unreadable on mobile;
 *     /discover is the right surface if you want N-way ranking.
 *   - Highlight "best in row" with a subtle accent border-left on the cell;
 *     avoids a noisy color grid.
 *   - If two stocks aren't in the same cluster, we still compare them — but
 *     surface a banner noting that peer-relative scores aren't directly
 *     comparable across clusters.
 */
import Link from "next/link";
import { sql } from "@/lib/db";
import { band, bandColor, fmtRupeesCr, tierLabel } from "@/lib/score";
import { ArrowLeftRight } from "lucide-react";

export const revalidate = 1800;
export const dynamic = "force-dynamic";

type CompareRow = {
  symbol: string;
  company_name: string;
  sector: string | null;
  industry: string | null;
  maturity_tier: string;
  cluster_id: string;
  cluster_name: string;
  meta_cluster_name: string;
  market_cap_cr: number | null;
  current_price: number | null;
  listing_date: string | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  rank_in_cluster: number | null;
  cluster_peer_count: number | null;
};

async function loadOne(symbol: string): Promise<CompareRow | null> {
  const upper = symbol.toUpperCase();
  // One round-trip per stock; up to 3 in parallel via Promise.all in the page.
  // Cheaper than a giant CTE and clearer to debug. Rank computed via the same
  // pattern used on /stock/[symbol].
  const rows = await sql<CompareRow[]>`
    WITH latest AS (
      SELECT MAX(snapshot_date) AS d FROM app.scores
    ),
    me AS (
      SELECT s.* FROM app.scores s
      WHERE s.symbol = ${upper} AND s.snapshot_date = (SELECT d FROM latest)
      LIMIT 1
    ),
    peers AS (
      SELECT s.symbol, s.composite_pct
      FROM app.scores s
      JOIN me ON me.cluster_id = s.cluster_id AND me.maturity_tier = s.maturity_tier
      WHERE s.snapshot_date = (SELECT d FROM latest)
    )
    SELECT
      me.symbol,
      u.company_name, u.sector, u.industry, u.listing_date::text,
      me.maturity_tier,
      me.cluster_id, c.name AS cluster_name, mc.name AS meta_cluster_name,
      sm.market_cap_cr::float AS market_cap_cr,
      sm.current_price::float AS current_price,
      me.composite_pct, me.quality_pct, me.valuation_pct, me.momentum_pct,
      ((SELECT COUNT(*) FROM peers
         WHERE COALESCE(composite_pct, -1) > COALESCE(me.composite_pct, -1)
       ) + 1)::int AS rank_in_cluster,
      (SELECT COUNT(*) FROM peers)::int AS cluster_peer_count
    FROM me
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = me.cluster_id
    JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    LEFT JOIN app.screener_meta sm USING (symbol)
  `;
  return rows[0] ?? null;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const raw = [sp.a, sp.b, sp.c]
    .map((s) => (s ?? "").trim().toUpperCase())
    .filter((s) => s.length > 0)
    .slice(0, 3);

  const loaded = await Promise.all(raw.map((s) => loadOne(s)));
  // Drop misses but preserve order. Mismatches get logged via the empty-slot
  // banner below; here we just compare what we have.
  const found = loaded.filter((r): r is CompareRow => r != null);
  const missing = raw.filter((s, i) => loaded[i] == null);

  const allSameCluster =
    found.length >= 2 &&
    found.every((r) => r.cluster_id === found[0].cluster_id);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-10">
      <header className="max-w-[820px]">
        <div className="text-[12px] uppercase tracking-wide muted-text flex items-center gap-2">
          <ArrowLeftRight size={13} />
          <span>Compare</span>
        </div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight mt-1">
          Stocks <em className="accent">side by side</em>.
        </h1>
        <p className="mt-3 text-[14.5px] muted-text leading-[1.6] max-w-[640px]">
          Pick up to three NSE symbols. We render the same scorecard for each,
          with the row winner highlighted. Most useful when the stocks share a
          peer cluster — scores are peer-relative, so cross-cluster comparisons
          are directional, not exact.
        </p>
      </header>

      <CompareForm initial={raw} />

      {missing.length > 0 && (
        <div
          className="mt-4 px-3 py-2 rounded-md text-[12.5px] inline-flex items-center gap-2"
          style={{
            background: "var(--color-accent-50)",
            color: "var(--color-accent-700)",
            border: "1px solid var(--color-accent-200)",
          }}
        >
          Couldn&apos;t find:{" "}
          {missing.map((m, i) => (
            <span key={m} className="font-medium tabular-nums">
              {m}{i < missing.length - 1 ? "," : ""}
            </span>
          ))}
          . Check spelling — symbols are case-insensitive but must match NSE ticker.
        </div>
      )}

      {found.length === 0 && missing.length === 0 && <EmptyState />}

      {found.length > 0 && (
        <>
          {!allSameCluster && found.length >= 2 && (
            <div
              className="mt-6 px-4 py-3 rounded-md text-[12.5px] leading-[1.55]"
              style={{
                background: "var(--color-paper)",
                border: "1px solid var(--color-border-default)",
              }}
            >
              <strong>Different clusters.</strong> {found.map((r) => r.symbol).join(", ")} sit
              in different peer groups, so percentile scores aren&apos;t directly comparable
              (Quality 80 in IT Services ≠ Quality 80 in Cement). Treat the comparison as
              directional.
            </div>
          )}

          <div className="mt-8">
            <CompareTable rows={found} />
          </div>
        </>
      )}
    </div>
  );
}

/** Quick-pick form: 3 symbol inputs + Go button, GET-submitted. */
function CompareForm({ initial }: { initial: string[] }) {
  const a = initial[0] ?? "";
  const b = initial[1] ?? "";
  const c = initial[2] ?? "";
  return (
    <form
      action="/compare"
      method="get"
      className="mt-6 flex flex-wrap gap-2 items-center"
    >
      <SymbolInput name="a" placeholder="e.g. INFY"      defaultValue={a} />
      <SymbolInput name="b" placeholder="e.g. TCS"       defaultValue={b} />
      <SymbolInput name="c" placeholder="e.g. HCLTECH"   defaultValue={c} />
      <button type="submit" className="btn-primary">Compare</button>
    </form>
  );
}

function SymbolInput({ name, placeholder, defaultValue }: { name: string; placeholder: string; defaultValue: string }) {
  return (
    <input
      type="text"
      name={name}
      placeholder={placeholder}
      defaultValue={defaultValue}
      autoCapitalize="characters"
      spellCheck={false}
      className="px-3 py-2 rounded-md hairline border text-[13.5px] tabular-nums w-[150px]"
      style={{ backgroundColor: "var(--color-card)" }}
    />
  );
}

function EmptyState() {
  return (
    <div className="card p-10 mt-8 text-center max-w-[600px] mx-auto">
      <div className="font-display text-[20px] mb-2">Pick stocks to compare</div>
      <p className="muted-text text-[13.5px] leading-[1.6]">
        Enter up to three NSE symbols above and hit <em>Compare</em>. Try{" "}
        <Link href="/compare?a=INFY&b=TCS&c=HCLTECH" className="underline">
          INFY / TCS / HCLTECH
        </Link>{" "}
        or{" "}
        <Link href="/compare?a=HDFCBANK&b=ICICIBANK&c=AXISBANK" className="underline">
          HDFCBANK / ICICIBANK / AXISBANK
        </Link>{" "}
        to start.
      </p>
    </div>
  );
}

/** Row-by-row scorecard. Each row computes its winner (best value); winner gets
 * a small accent stripe. Sort direction is per-row (some "lower is better"). */
function CompareTable({ rows }: { rows: CompareRow[] }) {
  // Define rows once with a value extractor + "better" comparator.
  // higherIsBetter: true → max wins; false → min wins; null → no winner highlight.
  type RowDef = {
    label: string;
    sub?: string;
    extract: (r: CompareRow) => number | null;
    higherIsBetter: boolean | null;
    render: (r: CompareRow) => React.ReactNode;
  };

  const defs: RowDef[] = [
    {
      label: "Composite",
      sub: "Platform-default cluster-tuned blend",
      extract: (r) => r.composite_pct,
      higherIsBetter: true,
      render: (r) => <ScoreCell value={r.composite_pct} highlight />,
    },
    {
      label: "Quality",
      extract: (r) => r.quality_pct,
      higherIsBetter: true,
      render: (r) => <ScoreCell value={r.quality_pct} />,
    },
    {
      label: "Valuation",
      sub: "Higher = cheaper vs peers",
      extract: (r) => r.valuation_pct,
      higherIsBetter: true,
      render: (r) => <ScoreCell value={r.valuation_pct} />,
    },
    {
      label: "Momentum",
      extract: (r) => r.momentum_pct,
      higherIsBetter: true,
      render: (r) => <ScoreCell value={r.momentum_pct} />,
    },
    {
      label: "Rank in cluster",
      extract: (r) => (r.rank_in_cluster != null ? -r.rank_in_cluster : null), // lower rank = better, so negate
      higherIsBetter: true,
      render: (r) =>
        r.rank_in_cluster != null && r.cluster_peer_count != null ? (
          <span className="tabular-nums">
            {r.rank_in_cluster} <span className="muted-text">of {r.cluster_peer_count}</span>
          </span>
        ) : (
          <span className="muted-text">—</span>
        ),
    },
    {
      label: "Cluster",
      extract: () => null,
      higherIsBetter: null,
      render: (r) => (
        <span className="text-[12.5px]">
          <div className="muted-text text-[10.5px] uppercase tracking-wide">{r.meta_cluster_name}</div>
          {r.cluster_name}
        </span>
      ),
    },
    {
      label: "Maturity tier",
      extract: () => null,
      higherIsBetter: null,
      render: (r) => <span>{tierLabel(r.maturity_tier)}</span>,
    },
    {
      label: "Market cap",
      extract: (r) => r.market_cap_cr,
      higherIsBetter: true,
      render: (r) =>
        r.market_cap_cr != null ? (
          <span className="tabular-nums">{fmtRupeesCr(r.market_cap_cr)}</span>
        ) : (
          <span className="muted-text">—</span>
        ),
    },
    {
      label: "Current price",
      extract: () => null, // price comparison across companies isn't meaningful
      higherIsBetter: null,
      render: (r) =>
        r.current_price != null ? (
          <span className="tabular-nums">
            ₹{r.current_price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </span>
        ) : (
          <span className="muted-text">—</span>
        ),
    },
  ];

  // Pre-compute winner index per row.
  const winners: (number | null)[] = defs.map((d) => {
    if (d.higherIsBetter === null) return null;
    const vals = rows.map((r) => d.extract(r));
    let bestIdx: number | null = null;
    let bestVal: number | null = null;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v == null) continue;
      if (
        bestVal == null ||
        (d.higherIsBetter ? v > bestVal : v < bestVal)
      ) {
        bestVal = v;
        bestIdx = i;
      }
    }
    return bestIdx;
  });

  const colW = `minmax(200px, 1fr)`;
  const gridCols = `200px ${rows.map(() => colW).join(" ")}`;

  return (
    <div className="card overflow-x-auto">
      {/* Header row — stock identity */}
      <div
        className="grid items-end gap-3 px-4 py-4 border-b hairline"
        style={{ gridTemplateColumns: gridCols, minWidth: 600 }}
      >
        <div className="text-[11px] uppercase tracking-wide muted-text">Metric</div>
        {rows.map((r) => (
          <div key={r.symbol} className="min-w-0">
            <Link
              href={`/stock/${r.symbol}`}
              className="font-medium text-[15px] hover:text-[var(--color-accent-600)]"
            >
              {r.symbol}
            </Link>
            <div className="muted-text text-[12px] truncate">{r.company_name}</div>
          </div>
        ))}
      </div>

      {/* Data rows */}
      {defs.map((d, i) => (
        <div
          key={d.label}
          className="grid gap-3 px-4 py-3 border-b hairline last:border-b-0"
          style={{ gridTemplateColumns: gridCols, minWidth: 600 }}
        >
          <div>
            <div className="text-[13px] font-medium">{d.label}</div>
            {d.sub && <div className="text-[10.5px] muted-text mt-0.5">{d.sub}</div>}
          </div>
          {rows.map((r, j) => {
            const isWinner = winners[i] === j;
            return (
              <div
                key={r.symbol}
                className="text-[13.5px]"
                style={
                  isWinner
                    ? {
                        borderLeft: "2px solid var(--color-accent-500)",
                        paddingLeft: 8,
                        marginLeft: -2,
                      }
                    : undefined
                }
              >
                {d.render(r)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ScoreCell({ value, highlight }: { value: number | null; highlight?: boolean }) {
  if (value == null) return <span className="muted-text">—</span>;
  const b = band(value);
  const bg = bandColor(b);
  const text = b === "neutral" ? "var(--color-ink)" : "white";
  if (highlight) {
    return (
      <span
        className="inline-block px-2 py-0.5 rounded-md tabular-nums font-medium text-[13px]"
        style={{ backgroundColor: bg, color: text }}
      >
        {Math.round(value)}
      </span>
    );
  }
  return (
    <span className="tabular-nums font-medium" style={{ color: bg }}>
      {Math.round(value)}
    </span>
  );
}
