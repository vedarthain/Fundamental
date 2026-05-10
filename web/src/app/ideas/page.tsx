/**
 * /ideas — opinionated weekly feed of stocks worth a closer look.
 *
 * Design rules (full spec: docs/IDEAS_DESIGN.md):
 *   1. Conviction gate — surface only stocks with 4+ weeks of consistent movement.
 *   2. Default to recognizable names (Nifty 500 toggle).
 *   3. Cap each section at 5 entries — signal beats coverage.
 *   4. One-line plain-English "why" with every entry, templated from pillar deltas.
 *   5. Show the 12-week trail, not just the snapshot.
 *   6. Persistent disclaimer — we don't predict prices.
 *
 * A stock appears in at most one section per render (first match wins).
 * Sections ordered: Building strength → Losing ground → Breakouts → Breakdowns.
 */
import Link from "next/link";
import { sql } from "@/lib/db";
import { ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Sparkles, AlertTriangle } from "lucide-react";
import { band, bandColor, tierLabel } from "@/lib/score";
import { Sparkline } from "@/components/Sparkline";

export const revalidate = 1800;
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RawScoreRow = {
  symbol: string;
  snapshot_date: string;
  rn: number;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  maturity_tier: string | null;
  cluster_id: string;
  company_name: string;
  is_nifty500: boolean;
  cluster_name: string;
};

type Stock = {
  symbol: string;
  company_name: string;
  cluster_id: string;
  cluster_name: string;
  maturity_tier: string | null;
  is_nifty500: boolean;
  // Current snapshot
  curr: { c: number; q: number; v: number; m: number };
  // Comparison snapshot (windowBack ago)
  then: { c: number; q: number; v: number; m: number };
  // Min/max over the window for persistence checks
  windowMaxC: number;
  windowMinC: number;
  trail: { label: string; value: number | null }[];
};

type SectionKey = "strength" | "losing" | "breakout" | "breakdown";

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadIdeas(nifty500Only: boolean) {
  // Step 1 — distinct snapshot dates, newest first, up to 12.
  const dates = await sql<{ snapshot_date: string }[]>`
    SELECT DISTINCT snapshot_date::text
    FROM app.scores
    ORDER BY snapshot_date DESC
    LIMIT 12
  `;

  if (dates.length === 0) {
    return { stocks: [] as Stock[], snapshots: [] as string[], windowBack: 0 };
  }

  // Step 2 — pull all symbol × date rows for those snapshots, joined.
  const rows = await sql<RawScoreRow[]>`
    WITH recent_dates AS (
      SELECT DISTINCT snapshot_date
      FROM app.scores
      ORDER BY snapshot_date DESC
      LIMIT 12
    ),
    recent AS (
      SELECT
        s.symbol,
        s.snapshot_date,
        s.composite_pct, s.quality_pct, s.valuation_pct, s.momentum_pct,
        s.maturity_tier, s.cluster_id,
        ROW_NUMBER() OVER (PARTITION BY s.symbol ORDER BY s.snapshot_date DESC) AS rn
      FROM app.scores s
      WHERE s.snapshot_date IN (SELECT snapshot_date FROM recent_dates)
    )
    SELECT
      r.symbol,
      r.snapshot_date::text AS snapshot_date,
      r.rn::int AS rn,
      r.composite_pct, r.quality_pct, r.valuation_pct, r.momentum_pct,
      r.maturity_tier, r.cluster_id,
      u.company_name,
      u.is_nifty500,
      c.name AS cluster_name
    FROM recent r
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = r.cluster_id
    ${nifty500Only ? sql`WHERE u.is_nifty500 = TRUE` : sql``}
    ORDER BY r.symbol, r.snapshot_date DESC
  `;

  // Window-back position (1-indexed since rn=1 is current). Ideal: 5 means "compare to 4 weeks ago".
  // Falls back gracefully when there aren't 5 snapshots yet.
  const ideal = 5;
  const windowBack = Math.min(ideal, dates.length);

  // Group rows by symbol.
  const bySymbol = new Map<string, RawScoreRow[]>();
  for (const r of rows) {
    let arr = bySymbol.get(r.symbol);
    if (!arr) {
      arr = [];
      bySymbol.set(r.symbol, arr);
    }
    arr.push(r);
  }

  const stocks: Stock[] = [];
  for (const [symbol, srows] of bySymbol) {
    // rows are ordered DESC by snapshot_date; rn=1 is most recent.
    const curr = srows.find((r) => r.rn === 1);
    const then = srows.find((r) => r.rn === windowBack) ?? srows[srows.length - 1];
    if (!curr || !then) continue;
    if (
      curr.composite_pct == null ||
      then.composite_pct == null ||
      curr.quality_pct == null ||
      then.quality_pct == null ||
      curr.valuation_pct == null ||
      then.valuation_pct == null ||
      curr.momentum_pct == null ||
      then.momentum_pct == null
    ) {
      continue;
    }

    // Window-min/max only over the comparison window (rn 1..windowBack).
    const window = srows.filter((r) => r.rn <= windowBack && r.composite_pct != null);
    const windowMaxC = Math.max(...window.map((r) => r.composite_pct as number));
    const windowMinC = Math.min(...window.map((r) => r.composite_pct as number));

    // Trail: full ASC history (oldest → newest) for sparkline.
    const trail = [...srows]
      .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      .map((r) => ({ label: r.snapshot_date, value: r.composite_pct }));

    stocks.push({
      symbol,
      company_name: curr.company_name,
      cluster_id: curr.cluster_id,
      cluster_name: curr.cluster_name,
      maturity_tier: curr.maturity_tier,
      is_nifty500: curr.is_nifty500,
      curr: {
        c: curr.composite_pct!,
        q: curr.quality_pct!,
        v: curr.valuation_pct!,
        m: curr.momentum_pct!,
      },
      then: {
        c: then.composite_pct!,
        q: then.quality_pct!,
        v: then.valuation_pct!,
        m: then.momentum_pct!,
      },
      windowMaxC,
      windowMinC,
      trail,
    });
  }

  return {
    stocks,
    snapshots: dates.map((d) => d.snapshot_date),
    windowBack,
  };
}

// ---------------------------------------------------------------------------
// Section assignment
// ---------------------------------------------------------------------------

const SECTION_ORDER: SectionKey[] = ["strength", "losing", "breakout", "breakdown"];

function classify(s: Stock, windowBack: number): SectionKey | null {
  const dC = s.curr.c - s.then.c;
  // If we have <2 snapshots, no comparison is meaningful.
  if (windowBack < 2) return null;

  // Building strength — sustained climb, current is fresh window-high, in respectable territory.
  if (dC >= 10 && s.curr.c >= s.windowMaxC && s.curr.c >= 50) {
    return "strength";
  }
  // Losing ground — sustained slip, current is fresh window-low, below stronghold.
  if (dC <= -10 && s.curr.c <= s.windowMinC && s.curr.c < 60) {
    return "losing";
  }
  // Recent breakouts — just crossed top quartile.
  if (s.curr.c >= 75 && s.then.c < 75) {
    return "breakout";
  }
  // Recent breakdowns — just fell below median.
  if (s.curr.c < 50 && s.then.c >= 50) {
    return "breakdown";
  }
  return null;
}

function rankWithin(section: SectionKey, a: Stock, b: Stock): number {
  switch (section) {
    case "strength":
      return (b.curr.c - b.then.c) - (a.curr.c - a.then.c); // biggest gain first
    case "losing":
      return (a.curr.c - a.then.c) - (b.curr.c - b.then.c); // biggest drop first
    case "breakout":
      return b.curr.c - a.curr.c; // strongest current first
    case "breakdown":
      return a.curr.c - b.curr.c; // weakest current first
  }
}

// ---------------------------------------------------------------------------
// "Why" templater — builds a one-line plain-English reason from pillar deltas.
// Future: replace with Claude-generated text + validator (Phase 3).
// ---------------------------------------------------------------------------

function whyLine(s: Stock): string {
  const dq = s.curr.q - s.then.q;
  const dv = s.curr.v - s.then.v;
  const dm = s.curr.m - s.then.m;

  const items: { key: "Q" | "V" | "M"; delta: number; curr: number }[] = [
    { key: "Q", delta: dq, curr: s.curr.q },
    { key: "V", delta: dv, curr: s.curr.v },
    { key: "M", delta: dm, curr: s.curr.m },
  ];
  const biggest = items.reduce((acc, it) =>
    Math.abs(it.delta) > Math.abs(acc.delta) ? it : acc,
  );

  const label = biggest.key === "Q" ? "Quality" : biggest.key === "V" ? "Valuation" : "Momentum";
  const dir = biggest.delta >= 0 ? "up" : "down";
  const mag = Math.abs(Math.round(biggest.delta));
  const pct = Math.round(biggest.curr);

  // "All small" — the largest pillar move is under 5 pts. Talk about composite drift instead.
  if (mag < 5) {
    const cDelta = Math.round(s.curr.c - s.then.c);
    if (cDelta >= 0) {
      return `Broad-based drift higher across all three pillars (composite +${cDelta}).`;
    }
    return `Broad-based weakness across all three pillars (composite ${cDelta}).`;
  }

  // Inverse phrasing for valuation: "valuation pct went up" actually means the stock got cheaper.
  // We avoid that confusion by phrasing valuation as "cheaper" / "more expensive".
  if (biggest.key === "V") {
    if (dir === "up") {
      return `Valuation cheapened ${mag} pts — now in the top ${100 - pct}% of its cluster.`;
    }
    return `Valuation richened ${mag} pts — has run ahead of fundamentals.`;
  }

  // Quality / Momentum — direction reads naturally.
  if (dir === "up") {
    return `${label} up ${mag} pts — now in the top ${100 - pct}% of its cluster.`;
  }
  return `${label} slipped ${mag} pts — now in the bottom ${pct}% of its cluster.`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function IdeasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const showAll = sp.scope === "all";
  const nifty500Only = !showAll;

  const { stocks, snapshots, windowBack } = await loadIdeas(nifty500Only);

  // Assign each qualifying stock to exactly one section.
  const sectioned: Record<SectionKey, Stock[]> = {
    strength: [],
    losing: [],
    breakout: [],
    breakdown: [],
  };

  for (const s of stocks) {
    const k = classify(s, windowBack);
    if (k) sectioned[k].push(s);
  }
  for (const k of SECTION_ORDER) {
    sectioned[k].sort((a, b) => rankWithin(k, a, b));
    sectioned[k] = sectioned[k].slice(0, 5);
  }

  const totalIdeas = SECTION_ORDER.reduce((n, k) => n + sectioned[k].length, 0);
  const earlyArchive = windowBack < 5; // Less than ~4 weeks of history.
  const nifty500Empty = nifty500Only && stocks.length === 0 && snapshots.length > 0;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-10">
      {/* Header */}
      <header className="max-w-[760px]">
        <div className="text-[12px] uppercase tracking-wide muted-text">Ideas Feed</div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight mt-1">
          Stocks worth a <em className="accent">closer look</em>.
        </h1>
        <p className="mt-3 text-[14.5px] muted-text leading-[1.6]">
          We surface stocks where our score has changed meaningfully over the last few weeks
          — fundamentals strengthening, slipping, breaking out, or breaking down. Each entry
          shows the 12-week trail so you can judge spike vs trend yourself.
        </p>
        <p className="mt-2 text-[12.5px] muted-text leading-[1.55] italic">
          We don&apos;t predict prices. We surface companies whose fundamentals are moving
          relative to their peer cluster. Always do your own research.
        </p>

        {snapshots.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] muted-text">
            <span>
              Latest snapshot: <span className="tabular-nums ink-text">{snapshots[0]}</span>
              {windowBack >= 2 && (
                <>
                  {" "}· comparing vs{" "}
                  <span className="tabular-nums ink-text">
                    {snapshots[Math.min(windowBack, snapshots.length) - 1]}
                  </span>
                </>
              )}
            </span>
            <span className="muted-text">·</span>
            <span>
              {totalIdeas.toLocaleString("en-IN")} idea{totalIdeas === 1 ? "" : "s"} surfaced
            </span>
          </div>
        )}
      </header>

      {/* Scope toggle */}
      <nav className="mt-6 flex flex-wrap gap-1.5">
        <ScopePill href="/ideas" label="Nifty 500" active={nifty500Only} hint="Recognizable names only" />
        <ScopePill href="/ideas?scope=all" label="All stocks" active={showAll} hint="Includes small-caps" />
      </nav>

      {/* Banners */}
      {snapshots.length === 0 && <FirstSnapshotBanner />}
      {nifty500Empty && <Nifty500EmptyBanner />}
      {earlyArchive && snapshots.length > 0 && !nifty500Empty && (
        <ConvictionFilterBanner snapshotsHave={snapshots.length} />
      )}

      {/* Boards */}
      {snapshots.length > 0 && !nifty500Empty && (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Board
            title="Building strength"
            subtitle="Sustained climb across the last few weeks"
            color="var(--color-score-good)"
            icon={<TrendingUp size={15} strokeWidth={2.2} />}
            stocks={sectioned.strength}
            section="strength"
            emptyHint="No stocks meeting the 4-week sustained-climb threshold."
          />
          <Board
            title="Losing ground"
            subtitle="Score has weakened consistently"
            color="var(--color-score-poor)"
            icon={<TrendingDown size={15} strokeWidth={2.2} />}
            stocks={sectioned.losing}
            section="losing"
            emptyHint="No stocks meeting the 4-week sustained-decline threshold."
          />
          <Board
            title="Recent breakouts"
            subtitle="Just entered top-quartile of its cluster"
            color="var(--color-score-excellent)"
            icon={<Sparkles size={15} strokeWidth={2.2} />}
            stocks={sectioned.breakout}
            section="breakout"
            emptyHint="No new top-quartile entrants this week."
          />
          <Board
            title="Recent breakdowns"
            subtitle="Just fell below median this week"
            color="var(--color-score-weak)"
            icon={<AlertTriangle size={15} strokeWidth={2.2} />}
            stocks={sectioned.breakdown}
            section="breakdown"
            emptyHint="No fresh breakdowns this week."
          />
        </div>
      )}

      {/* Footer disclaimer (persistent trust builder) */}
      <footer className="mt-12 pt-6 border-t hairline text-[11.5px] muted-text leading-[1.6] max-w-[760px]">
        Information surface only — not investment advice. Scores are computed from public
        filings and prices. Stocks listed here are those whose fundamentals have moved
        relative to their peer cluster, not predictions about future prices.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UI components
// ---------------------------------------------------------------------------

function ScopePill({
  href,
  label,
  active,
  hint,
}: {
  href: string;
  label: string;
  active: boolean;
  hint: string;
}) {
  return (
    <Link
      href={href}
      title={hint}
      className={`px-3 py-1.5 rounded-full text-[12px] border transition-colors ${
        active
          ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
          : "hairline bg-[var(--color-card)] hover:bg-[var(--color-paper)]"
      }`}
    >
      {label}
    </Link>
  );
}

function FirstSnapshotBanner() {
  return (
    <div className="card p-12 mt-10 text-center">
      <div className="font-display text-[20px] mb-2">No snapshots yet</div>
      <p className="muted-text text-[14px] max-w-[480px] mx-auto leading-[1.6]">
        The score archive is empty. Run <code className="font-mono text-[12.5px]">./snap</code> to
        take the first snapshot. Ideas will populate from the second snapshot onwards.
      </p>
    </div>
  );
}

function Nifty500EmptyBanner() {
  return (
    <div className="card p-8 mt-8 text-[13px] leading-[1.6]">
      <div className="font-display text-[17px] mb-2">Nifty 500 filter not yet seeded</div>
      <p className="muted-text">
        No stocks are currently flagged as Nifty 500 in <code className="font-mono">app.universe.is_nifty500</code>.
        Either populate the flag (see <code className="font-mono">docs/IDEAS_DESIGN.md</code> for the SQL),
        or switch to <Link href="/ideas?scope=all" className="text-[var(--color-accent-700)] underline">All stocks</Link>{" "}
        for now.
      </p>
    </div>
  );
}

function ConvictionFilterBanner({ snapshotsHave }: { snapshotsHave: number }) {
  return (
    <div
      className="mt-6 px-4 py-3 rounded-[10px] text-[12.5px] flex items-start gap-2.5"
      style={{
        background: "var(--color-accent-50)",
        border: "1px solid var(--color-accent-200)",
        color: "var(--color-accent-700)",
      }}
    >
      <Sparkles size={14} className="mt-[2px] shrink-0" />
      <div>
        <strong>Conviction filter is in early-archive mode.</strong> We have{" "}
        {snapshotsHave} weekly snapshot{snapshotsHave === 1 ? "" : "s"} so far. The{" "}
        <em>4-week sustained-trend</em> rule activates once we have ≥5 snapshots
        — until then ideas use whatever history is available, so noise is higher.
      </div>
    </div>
  );
}

function Board({
  title,
  subtitle,
  color,
  icon,
  stocks,
  section,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  color: string;
  icon: React.ReactNode;
  stocks: Stock[];
  section: SectionKey;
  emptyHint: string;
}) {
  return (
    <section className="card overflow-hidden">
      <header
        className="px-4 py-3 border-b hairline"
        style={{ borderTop: `3px solid ${color}` }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2 font-medium text-[14px]" style={{ color }}>
            <span style={{ color }}>{icon}</span>
            {title}
          </div>
          <div className="muted-text text-[10.5px] uppercase tracking-wide">
            top {stocks.length || 5}
          </div>
        </div>
        <div className="muted-text text-[11.5px] mt-0.5">{subtitle}</div>
      </header>

      <ol className="divide-y hairline">
        {stocks.map((s, i) => (
          <li key={s.symbol}>
            <Row stock={s} rank={i + 1} section={section} />
          </li>
        ))}
        {stocks.length === 0 && (
          <li className="px-4 py-8 text-[12px] muted-text text-center leading-[1.55]">
            {emptyHint}
          </li>
        )}
      </ol>
    </section>
  );
}

function Row({ stock, rank, section }: { stock: Stock; rank: number; section: SectionKey }) {
  const dC = stock.curr.c - stock.then.c;
  const isGain = section === "strength" || section === "breakout";
  const deltaColor = isGain ? "var(--color-score-good)" : "var(--color-score-poor)";
  const Arrow = isGain ? ArrowUpRight : ArrowDownRight;
  const why = whyLine(stock);
  const sparkColor = bandColor(band(stock.curr.c));

  return (
    <Link
      href={`/stock/${stock.symbol}`}
      className="block px-4 py-3.5 hover:bg-[var(--color-paper)]/60 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: rank + identity + why */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="muted-text tabular-nums text-[11px] w-[14px] shrink-0">
              {rank}
            </span>
            <span className="font-medium text-[13.5px] tabular-nums">{stock.symbol}</span>
            <span className="muted-text text-[11px] truncate">
              {stock.cluster_name} · {tierLabel(stock.maturity_tier)}
            </span>
          </div>
          <div className="muted-text text-[11.5px] truncate ml-[22px]">
            {stock.company_name}
          </div>
          <div className="text-[12px] mt-1.5 ml-[22px] leading-[1.5]" style={{ color: "var(--color-ink)" }}>
            {why}
          </div>
        </div>

        {/* Right: sparkline + score delta */}
        <div className="shrink-0 flex flex-col items-end gap-1">
          <Sparkline
            data={stock.trail}
            width={120}
            height={32}
            stroke={sparkColor}
          />
          <div className="flex items-baseline gap-1.5 tabular-nums text-[11.5px]">
            <span className="muted-text">{Math.round(stock.then.c)}</span>
            <span className="muted-text" style={{ fontSize: 9 }}>→</span>
            <span
              className="font-semibold"
              style={{ color: bandColor(band(stock.curr.c)) }}
            >
              {Math.round(stock.curr.c)}
            </span>
            <span
              className="inline-flex items-center gap-0.5 font-semibold ml-1"
              style={{ color: deltaColor }}
            >
              <Arrow size={11} strokeWidth={2.6} />
              {dC >= 0 ? "+" : ""}
              {Math.round(dC)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
