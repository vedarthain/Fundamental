/**
 * /compare — side-by-side stock comparison.
 *
 * Usage: /compare?a=INFY&b=TCS&c=HCLTECH&d=WIPRO&e=TECHM[&view=raw]
 *
 * Two views, toggled by ?view=:
 *   - "fundamental" (default) — peer-cluster scorecards (Composite, Q/V/M,
 *     rank, market cap). Apples-to-apples ranking within a cluster.
 *   - "raw" — actual financial numbers from the latest annual filing
 *     (Revenue, Net Profit, margins, RoE, debt). Read the absolute scale,
 *     not the relative percentile.
 *
 * Design choices:
 *   - Server-rendered: all params drive rendering; no client state.
 *   - Up to 5 columns: enough to compare a small cluster end-to-end; the
 *     metric column shrinks on wider grids; horizontal scroll past that.
 *   - Winner-in-row gets an accent stripe (only for rows where "better" is
 *     well-defined; cluster/sector cells have no winner).
 *   - Cross-cluster comparison gets a warning banner.
 */
import Link from "next/link";
import { sql } from "@/lib/db";
import { band, bandColor, fmtRupeesCr, tierLabel } from "@/lib/score";
import { ArrowLeftRight } from "lucide-react";

export const revalidate = 1800;
export const dynamic = "force-dynamic";

type ViewMode = "fundamental" | "raw";

type CompareRow = {
  symbol: string;
  company_name: string;
  sector: string | null;
  industry: string | null;
  maturity_tier: string;
  industry_id: string;
  industry_name: string;
  sector_name: string;
  market_cap_cr: number | null;
  current_price: number | null;
  listing_date: string | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  rank_in_industry: number | null;
  industry_peer_count: number | null;
  // Raw-data fields — latest + previous annual filing
  fy_latest: string | null;        // period_end of latest annual
  fy_prev: string | null;          // period_end of one-year prior
  sales: number | null;            // ₹ Cr
  sales_prev: number | null;
  operating_profit: number | null;
  operating_profit_prev: number | null;
  net_profit: number | null;
  net_profit_prev: number | null;
  cash_from_operating: number | null;
  total_assets: number | null;
  borrowings: number | null;
  equity_book: number | null;      // equity_share_capital + reserves
};

async function loadOne(symbol: string): Promise<CompareRow | null> {
  const upper = symbol.toUpperCase();
  // Single round-trip: score row + rank + 2 latest annual rows attached via
  // LATERAL joins. The LATERAL keeps the per-symbol annual lookup separate
  // from the score join — annual_latest is "most recent FY", annual_prev is
  // "the FY before that". This works even when reporting gaps exist.
  const rows = await sql<CompareRow[]>`
    WITH latest AS (SELECT MAX(snapshot_date) AS d FROM app.scores),
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
      me.cluster_id AS industry_id, c.name AS industry_name, mc.name AS sector_name,
      sm.market_cap_cr::float AS market_cap_cr,
      sm.current_price::float AS current_price,
      me.composite_pct, me.quality_pct, me.valuation_pct, me.momentum_pct,
      ((SELECT COUNT(*) FROM peers
         WHERE COALESCE(composite_pct, -1) > COALESCE(me.composite_pct, -1)
       ) + 1)::int AS rank_in_industry,
      (SELECT COUNT(*) FROM peers)::int AS industry_peer_count,
      al.period_end::text  AS fy_latest,
      ap.period_end::text  AS fy_prev,
      al.sales::float                AS sales,
      ap.sales::float                AS sales_prev,
      al.operating_profit::float     AS operating_profit,
      ap.operating_profit::float     AS operating_profit_prev,
      al.net_profit::float           AS net_profit,
      ap.net_profit::float           AS net_profit_prev,
      al.cash_from_operating::float  AS cash_from_operating,
      al.total_assets::float         AS total_assets,
      al.borrowings::float           AS borrowings,
      (COALESCE(al.equity_share_capital, 0) + COALESCE(al.reserves, 0))::float AS equity_book
    FROM me
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = me.cluster_id
    JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    LEFT JOIN app.screener_meta sm USING (symbol)
    LEFT JOIN LATERAL (
      SELECT * FROM app.fundamentals_annual a
      WHERE a.symbol = me.symbol
      ORDER BY a.period_end DESC LIMIT 1
    ) al ON TRUE
    LEFT JOIN LATERAL (
      SELECT * FROM app.fundamentals_annual a
      WHERE a.symbol = me.symbol AND a.period_end < al.period_end
      ORDER BY a.period_end DESC LIMIT 1
    ) ap ON TRUE
  `;
  return rows[0] ?? null;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const view: ViewMode = sp.view === "raw" ? "raw" : "fundamental";
  // Up to 5 slots — a/b/c/d/e. Missing slots are filtered out.
  const raw = [sp.a, sp.b, sp.c, sp.d, sp.e]
    .map((s) => (s ?? "").trim().toUpperCase())
    .filter((s) => s.length > 0)
    .slice(0, 5);

  const loaded = await Promise.all(raw.map((s) => loadOne(s)));
  const found = loaded.filter((r): r is CompareRow => r != null);
  const missing = raw.filter((s, i) => loaded[i] == null);

  const allSameCluster =
    found.length >= 2 &&
    found.every((r) => r.industry_id === found[0].industry_id);

  // Preserve current symbols + view in tab URLs so a tab switch doesn't reset selection.
  const baseParams = new URLSearchParams();
  const slotKeys = ["a", "b", "c", "d", "e"] as const;
  raw.forEach((s, i) => { if (s) baseParams.set(slotKeys[i], s); });
  const hrefFundamental = `/compare?${baseParams.toString()}`;
  baseParams.set("view", "raw");
  const hrefRaw = `/compare?${baseParams.toString()}`;

  return (
    <div className="theme-amber mx-auto max-w-[1200px] px-6 py-10">
      <header className="max-w-[820px]">
        <div className="text-[12px] uppercase tracking-wide muted-text flex items-center gap-2">
          <ArrowLeftRight size={13} />
          <span>Peer comparison</span>
        </div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight mt-1">
          Stocks <em className="accent">side by side</em>.
        </h1>
        <p className="mt-3 text-[14.5px] muted-text leading-[1.6] max-w-[640px]">
          Pick up to five NSE symbols. Switch between the peer-relative
          scorecard and the raw financial filings.
        </p>
        <div className="mt-2 text-[12px] muted-text">
          <Link href="/discover" className="hover:text-[var(--color-accent-700)]">
            ← Back to Discover
          </Link>
        </div>
      </header>

      <CompareForm initial={raw} view={view} />

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
          . Symbols are case-insensitive but must match the NSE ticker.
        </div>
      )}

      {found.length === 0 && missing.length === 0 && <EmptyState />}

      {found.length > 0 && (
        <>
          {/* Tab strip */}
          <div className="mt-7 mb-4 border-b hairline flex gap-1">
            <TabLink href={hrefFundamental} active={view === "fundamental"} label="Fundamental comparison" sub="Peer-relative scorecard" />
            <TabLink href={hrefRaw}        active={view === "raw"}         label="Raw data comparison"   sub="Latest annual filing" />
          </div>

          {!allSameCluster && found.length >= 2 && view === "fundamental" && (
            <div
              className="mb-4 px-4 py-3 rounded-md text-[12.5px] leading-[1.55]"
              style={{
                background: "var(--color-paper)",
                border: "1px solid var(--color-border-default)",
              }}
            >
              <strong>Different clusters.</strong> {found.map((r) => r.symbol).join(", ")} sit
              in different peer groups, so percentile scores aren&apos;t directly comparable
              (Quality 80 in IT Services ≠ Quality 80 in Cement). Treat the comparison as
              directional. The <em>Raw data</em> tab compares absolute numbers, which IS
              meaningful across clusters.
            </div>
          )}

          {view === "fundamental" ? (
            <FundamentalTable rows={found} />
          ) : (
            <RawTable rows={found} />
          )}
        </>
      )}
    </div>
  );
}

function TabLink({ href, active, label, sub }: { href: string; active: boolean; label: string; sub?: string }) {
  return (
    <Link
      href={href}
      className="px-4 py-2.5 text-[13.5px] -mb-px border-b-2 transition-colors"
      style={
        active
          ? { borderColor: "var(--color-accent-500)", color: "var(--color-ink)" }
          : { borderColor: "transparent", color: "var(--color-muted)" }
      }
    >
      <div className="font-medium">{label}</div>
      {sub && <div className="text-[10.5px] muted-text font-normal mt-0.5">{sub}</div>}
    </Link>
  );
}

/** Quick-pick form: up to 5 symbol inputs + Go button, GET-submitted. */
function CompareForm({ initial, view }: { initial: string[]; view: ViewMode }) {
  const slots: { name: "a" | "b" | "c" | "d" | "e"; placeholder: string }[] = [
    { name: "a", placeholder: "e.g. INFY" },
    { name: "b", placeholder: "e.g. TCS" },
    { name: "c", placeholder: "e.g. HCLTECH" },
    { name: "d", placeholder: "+ optional" },
    { name: "e", placeholder: "+ optional" },
  ];
  return (
    <form
      action="/compare"
      method="get"
      className="mt-6 flex flex-wrap gap-2 items-center"
    >
      {slots.map((s, i) => (
        <SymbolInput
          key={s.name}
          name={s.name}
          placeholder={s.placeholder}
          defaultValue={initial[i] ?? ""}
        />
      ))}
      {/* Carry the view through the form so submit doesn't reset to default */}
      {view !== "fundamental" && <input type="hidden" name="view" value={view} />}
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

// ---------------------------------------------------------------------------
// Shared row-table primitive — used by both fundamental + raw views
// ---------------------------------------------------------------------------

type RowDef<R> = {
  label: string;
  sub?: string;
  extract: (r: R) => number | null;
  // true = max wins, false = min wins, null = no winner highlight
  higherIsBetter: boolean | null;
  render: (r: R) => React.ReactNode;
};

function ScorecardTable<R extends { symbol: string; company_name: string }>({
  rows, defs,
}: {
  rows: R[];
  defs: RowDef<R>[];
}) {
  const winners: (number | null)[] = defs.map((d) => {
    if (d.higherIsBetter === null) return null;
    let bestIdx: number | null = null;
    let bestVal: number | null = null;
    for (let i = 0; i < rows.length; i++) {
      const v = d.extract(rows[i]);
      if (v == null) continue;
      if (bestVal == null || (d.higherIsBetter ? v > bestVal : v < bestVal)) {
        bestVal = v;
        bestIdx = i;
      }
    }
    return bestIdx;
  });

  // Metric column fixed at 180px; each stock column gets a min of 150px so
  // 5 columns still fit on a typical laptop without truncation. Horizontal
  // scroll kicks in past that.
  const colW = `minmax(150px, 1fr)`;
  const gridCols = `180px ${rows.map(() => colW).join(" ")}`;
  const minWidth = 180 + rows.length * 160;

  return (
    <div className="card overflow-x-auto">
      {/* Header row — stock identity */}
      <div
        className="grid items-end gap-3 px-4 py-4 border-b hairline"
        style={{ gridTemplateColumns: gridCols, minWidth }}
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

      {defs.map((d, i) => (
        <div
          key={d.label}
          className="grid gap-3 px-4 py-3 border-b hairline last:border-b-0"
          style={{ gridTemplateColumns: gridCols, minWidth }}
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

// ---------------------------------------------------------------------------
// Fundamental view — peer-relative scorecard
// ---------------------------------------------------------------------------

function FundamentalTable({ rows }: { rows: CompareRow[] }) {
  const defs: RowDef<CompareRow>[] = [
    {
      label: "Composite",
      sub: "Cluster-tuned blend (0–100)",
      extract: (r) => r.composite_pct,
      higherIsBetter: true,
      render: (r) => <ScoreCell value={r.composite_pct} highlight />,
    },
    { label: "Quality",   extract: (r) => r.quality_pct,   higherIsBetter: true, render: (r) => <ScoreCell value={r.quality_pct} /> },
    { label: "Valuation", sub: "Higher = cheaper", extract: (r) => r.valuation_pct, higherIsBetter: true, render: (r) => <ScoreCell value={r.valuation_pct} /> },
    { label: "Momentum",  extract: (r) => r.momentum_pct,  higherIsBetter: true, render: (r) => <ScoreCell value={r.momentum_pct} /> },
    {
      label: "Rank in cluster",
      extract: (r) => (r.rank_in_industry != null ? -r.rank_in_industry : null),
      higherIsBetter: true,
      render: (r) =>
        r.rank_in_industry != null && r.industry_peer_count != null ? (
          <span className="tabular-nums">
            {r.rank_in_industry} <span className="muted-text">of {r.industry_peer_count}</span>
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
          <div className="muted-text text-[10.5px] uppercase tracking-wide">{r.sector_name}</div>
          {r.industry_name}
        </span>
      ),
    },
    { label: "Maturity tier", extract: () => null, higherIsBetter: null, render: (r) => <span>{tierLabel(r.maturity_tier)}</span> },
    {
      label: "Market cap",
      extract: (r) => r.market_cap_cr,
      higherIsBetter: true,
      render: (r) => r.market_cap_cr != null
        ? <span className="tabular-nums">{fmtRupeesCr(r.market_cap_cr)}</span>
        : <span className="muted-text">—</span>,
    },
  ];
  return <ScorecardTable rows={rows} defs={defs} />;
}

// ---------------------------------------------------------------------------
// Raw-data view — actual financial numbers
// ---------------------------------------------------------------------------

function FmtCr({ v }: { v: number | null }) {
  if (v == null) return <span className="muted-text">—</span>;
  return <span className="tabular-nums">{v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}<span className="muted-text text-[10.5px]"> Cr</span></span>;
}

function FmtPctSigned({ v, suffix = "%" }: { v: number | null; suffix?: string }) {
  if (v == null || !isFinite(v)) return <span className="muted-text">—</span>;
  const color = v >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)";
  return (
    <span className="tabular-nums font-medium" style={{ color }}>
      {v >= 0 ? "+" : ""}{v.toFixed(1)}{suffix}
    </span>
  );
}

function FmtPctAbs({ v }: { v: number | null }) {
  if (v == null || !isFinite(v)) return <span className="muted-text">—</span>;
  return <span className="tabular-nums">{v.toFixed(1)}%</span>;
}

function RawTable({ rows }: { rows: CompareRow[] }) {
  // Derived metric helpers — all percentages so winner ordering is direct.
  // Guard divisions: return null on null/zero denominator rather than NaN/Infinity.
  const salesGrowth = (r: CompareRow) =>
    r.sales != null && r.sales_prev != null && r.sales_prev !== 0
      ? ((r.sales / r.sales_prev) - 1) * 100
      : null;
  const npGrowth = (r: CompareRow) =>
    r.net_profit != null && r.net_profit_prev != null && r.net_profit_prev !== 0
      ? ((r.net_profit / r.net_profit_prev) - 1) * 100
      : null;
  const opMargin = (r: CompareRow) =>
    r.sales && r.operating_profit != null ? (r.operating_profit / r.sales) * 100 : null;
  const npMargin = (r: CompareRow) =>
    r.sales && r.net_profit != null ? (r.net_profit / r.sales) * 100 : null;
  const roe = (r: CompareRow) =>
    r.equity_book && r.net_profit != null && r.equity_book > 0
      ? (r.net_profit / r.equity_book) * 100
      : null;
  const de = (r: CompareRow) =>
    r.equity_book && r.borrowings != null && r.equity_book > 0
      ? r.borrowings / r.equity_book
      : null;

  const defs: RowDef<CompareRow>[] = [
    {
      label: "Reporting year",
      sub: "Latest filed FY end",
      extract: () => null,
      higherIsBetter: null,
      render: (r) => r.fy_latest
        ? <span className="tabular-nums text-[12.5px]">{r.fy_latest}</span>
        : <span className="muted-text">—</span>,
    },
    { label: "Revenue",          extract: (r) => r.sales,             higherIsBetter: true,  render: (r) => <FmtCr v={r.sales} /> },
    { label: "Revenue growth YoY", sub: "vs prior FY", extract: salesGrowth, higherIsBetter: true, render: (r) => <FmtPctSigned v={salesGrowth(r)} /> },
    { label: "Operating profit", extract: (r) => r.operating_profit,  higherIsBetter: true,  render: (r) => <FmtCr v={r.operating_profit} /> },
    { label: "Operating margin", sub: "OP / Revenue", extract: opMargin, higherIsBetter: true, render: (r) => <FmtPctAbs v={opMargin(r)} /> },
    { label: "Net profit",       extract: (r) => r.net_profit,        higherIsBetter: true,  render: (r) => <FmtCr v={r.net_profit} /> },
    { label: "Net profit growth YoY", sub: "vs prior FY", extract: npGrowth, higherIsBetter: true, render: (r) => <FmtPctSigned v={npGrowth(r)} /> },
    { label: "Net margin",       sub: "NP / Revenue", extract: npMargin, higherIsBetter: true, render: (r) => <FmtPctAbs v={npMargin(r)} /> },
    { label: "Return on equity", sub: "NP / book equity", extract: roe, higherIsBetter: true, render: (r) => <FmtPctAbs v={roe(r)} /> },
    { label: "Cash from operations", extract: (r) => r.cash_from_operating, higherIsBetter: true, render: (r) => <FmtCr v={r.cash_from_operating} /> },
    { label: "Total assets",     extract: (r) => r.total_assets,      higherIsBetter: true,  render: (r) => <FmtCr v={r.total_assets} /> },
    { label: "Borrowings",       extract: (r) => r.borrowings,        higherIsBetter: false, render: (r) => <FmtCr v={r.borrowings} /> },
    { label: "Debt / Equity",    sub: "Borrowings / book equity", extract: de, higherIsBetter: false, render: (r) => {
        const v = de(r);
        return v == null
          ? <span className="muted-text">—</span>
          : <span className="tabular-nums">{v.toFixed(2)}×</span>;
      }
    },
    {
      label: "Book equity",
      sub: "Share capital + reserves",
      extract: (r) => r.equity_book,
      higherIsBetter: true,
      render: (r) => <FmtCr v={r.equity_book} />,
    },
  ];
  return <ScorecardTable rows={rows} defs={defs} />;
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
