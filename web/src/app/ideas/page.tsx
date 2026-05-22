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
import {
  ArrowUpRight, ArrowDownRight,
  TrendingUp, TrendingDown, Sparkles, AlertTriangle,
  Award, Tag, Users, Globe2,
} from "lucide-react";
import { band, bandColor, tierLabel } from "@/lib/score";
import { Sparkline } from "@/components/Sparkline";

// Score data changes weekly. 6h ISR cache avoids waking Neon on every visit.
// force-dynamic removed — this page has no per-request searchParams/cookies.
export const revalidate = 21600;

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
  industry_id: string;
  company_name: string;
  is_nifty200: boolean;
  industry_name: string;
};

type ShareSnap = {
  // Latest 2 quarters of promoter / FII percentages, plus the period end date
  // of each. Used by the "promoter accumulation" and "FII accumulation"
  // themed buckets. Either side can be null if data was incomplete.
  promoter: number | null;
  promoterPrev: number | null;
  fii: number | null;
  fiiPrev: number | null;
  period: string | null;     // YYYY-MM-DD of latest quarter end
  periodPrev: string | null; // YYYY-MM-DD of comparison quarter end
};

type Stock = {
  symbol: string;
  company_name: string;
  industry_id: string;
  industry_name: string;
  maturity_tier: string | null;
  is_nifty200: boolean;
  // Current snapshot
  curr: { c: number; q: number; v: number; m: number };
  // Comparison snapshot (windowBack ago)
  then: { c: number; q: number; v: number; m: number };
  // Min/max over the window for persistence checks
  windowMaxC: number;
  windowMinC: number;
  trail: { label: string; value: number | null }[];
  // Quarterly shareholding deltas (null when ETL hasn't captured 2 quarters yet)
  share: ShareSnap | null;
};

// Trend-based — assigned exclusively by classify() (first match wins).
type TrendSectionKey = "strength" | "losing" | "breakout" | "breakdown";
// Quality/value/flow-based — independent filters; a stock can be in
// multiple of these and also in one of the trend buckets above.
type ThemedSectionKey = "compounder" | "cheap" | "promoter_up" | "fii_up";
type SectionKey = TrendSectionKey | ThemedSectionKey;

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadIdeas(nifty200Only: boolean) {
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
      r.maturity_tier, r.cluster_id AS industry_id,
      u.company_name,
      u.is_nifty200,
      c.name AS industry_name
    FROM recent r
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = r.cluster_id
    ${nifty200Only ? sql`WHERE u.is_nifty200 = TRUE` : sql``}
    ORDER BY r.symbol, r.snapshot_date DESC
  `;

  // Step 2.5 — latest 2 quarters of shareholding for every symbol. Used by
  // the "promoter_up" / "fii_up" themed buckets. Cheap query — quarterly
  // cadence means ~200 stocks × 2 rows = 400 rows max. We only need
  // promoter_pct and fii_pct.
  const shareRows = await sql<{
    symbol: string;
    rn: number;
    period_end: string;
    promoter_pct: number | null;
    fii_pct: number | null;
  }[]>`
    WITH ranked AS (
      SELECT symbol, period_end, promoter_pct::float AS promoter_pct, fii_pct::float AS fii_pct,
             ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY period_end DESC) AS rn
      FROM app.shareholding_pattern
    )
    SELECT symbol, rn::int AS rn, period_end::text AS period_end, promoter_pct, fii_pct
    FROM ranked
    WHERE rn <= 2
  `;
  const shareBySymbol = new Map<string, ShareSnap>();
  for (const r of shareRows) {
    let snap = shareBySymbol.get(r.symbol);
    if (!snap) {
      snap = { promoter: null, promoterPrev: null, fii: null, fiiPrev: null, period: null, periodPrev: null };
      shareBySymbol.set(r.symbol, snap);
    }
    if (r.rn === 1) {
      snap.promoter = r.promoter_pct;
      snap.fii = r.fii_pct;
      snap.period = r.period_end;
    } else if (r.rn === 2) {
      snap.promoterPrev = r.promoter_pct;
      snap.fiiPrev = r.fii_pct;
      snap.periodPrev = r.period_end;
    }
  }

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
      industry_id: curr.industry_id,
      industry_name: curr.industry_name,
      maturity_tier: curr.maturity_tier,
      is_nifty200: curr.is_nifty200,
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
      share: shareBySymbol.get(symbol) ?? null,
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

const SECTION_ORDER: TrendSectionKey[] = ["strength", "losing", "breakout", "breakdown"];

function classify(s: Stock, windowBack: number): TrendSectionKey | null {
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

function rankWithin(section: TrendSectionKey, a: Stock, b: Stock): number {
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

function whyLine(s: Stock, section?: SectionKey): string {
  // Themed-bucket "why" lines — these read off absolute levels or
  // shareholding deltas rather than weekly score change, because that's
  // the signal that placed the stock in the bucket.
  if (section === "compounder") {
    const cDelta = Math.round(s.curr.c - s.then.c);
    return `Quality ${Math.round(s.curr.q)}/100 in cluster · composite steady (Δ ${cDelta >= 0 ? "+" : ""}${cDelta} over window).`;
  }
  if (section === "cheap") {
    const v = Math.round(s.curr.v);
    return `Valuation ${v}/100 — cheaper than ${100 - v}% of its peer cluster on price-vs-fundamentals.`;
  }
  if (section === "promoter_up" && s.share?.promoter != null && s.share.promoterPrev != null) {
    const delta = s.share.promoter - s.share.promoterPrev;
    return `Promoter stake ${s.share.promoterPrev.toFixed(1)}% → ${s.share.promoter.toFixed(1)}% (+${delta.toFixed(1)}pp QoQ).`;
  }
  if (section === "fii_up" && s.share?.fii != null && s.share.fiiPrev != null) {
    const delta = s.share.fii - s.share.fiiPrev;
    return `FII stake ${s.share.fiiPrev.toFixed(1)}% → ${s.share.fii.toFixed(1)}% (+${delta.toFixed(1)}pp QoQ).`;
  }

  // Fallback (and default for trend buckets): biggest pillar delta.
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

// Tab keys for the 8 buckets. URL: /ideas?bucket=<key>. Defaults to the
// first bucket so the page is never blank.
const TAB_KEYS = [
  "strength", "losing", "breakout", "breakdown",
  "compounder", "cheap", "promoter_up", "fii_up",
] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTabKey(s: string | undefined): s is TabKey {
  return !!s && (TAB_KEYS as readonly string[]).includes(s);
}

export default async function IdeasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  // Default scope: ALL stocks. The Nifty 200 toggle is opt-in via ?scope=nifty200
  // because (a) on Neon we only have Nifty 200 in the DB anyway so both modes
  // look identical there, and (b) local dev has 2,000+ stocks and the unfiltered
  // view shows more interesting signal across the full universe.
  const nifty200Only = sp.scope === "nifty200";
  const showAll = !nifty200Only;
  // Active tab — one bucket at a time. Defaults to "strength" so first load
  // shows the biggest positive-trend stocks.
  const activeTab: TabKey = isTabKey(sp.bucket) ? sp.bucket : "strength";

  const { stocks, snapshots, windowBack } = await loadIdeas(nifty200Only);

  // Assign each qualifying stock to exactly one trend section.
  const sectioned: Record<TrendSectionKey, Stock[]> = {
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

  // ---- Themed buckets (independent of trend classification) ----
  // A stock can appear in any of these AND in one trend bucket — they answer
  // different questions ("what changed" vs "what's true now").

  // Quality compounders: top-quartile quality, veteran tier (≥10y data), with
  // a *stable* composite over the window (no big move either way). The point
  // is durable businesses, not currently in flux.
  const compounders = stocks
    .filter(
      (s) =>
        s.curr.q >= 75 &&
        s.maturity_tier === "veteran" &&
        Math.abs(s.curr.c - s.then.c) < 6,
    )
    .sort((a, b) => b.curr.q - a.curr.q)
    .slice(0, 5);

  // Cheap in cluster: top-quartile valuation percentile (i.e. cheaper than 75%
  // of peers) AND not weak overall — we don't want value-trap garbage. Min
  // composite 50 keeps the bar at "respectable business at a good price".
  const cheap = stocks
    .filter((s) => s.curr.v >= 75 && s.curr.c >= 50)
    .sort((a, b) => b.curr.v - a.curr.v)
    .slice(0, 5);

  // Promoter accumulation: promoter stake increased ≥1pp QoQ. Strong signal
  // in Indian context (insiders rarely add when they think the business is
  // mid-cycle).
  const promoterUp = stocks
    .filter((s) => {
      const p = s.share?.promoter;
      const pp = s.share?.promoterPrev;
      return p != null && pp != null && p - pp >= 1.0;
    })
    .sort(
      (a, b) =>
        (b.share!.promoter! - b.share!.promoterPrev!) -
        (a.share!.promoter! - a.share!.promoterPrev!),
    )
    .slice(0, 5);

  // FII accumulation: same as promoter, but foreign institutional. ≥1pp QoQ
  // bump = a meaningful flow story in a stock the market doesn't cover well.
  const fiiUp = stocks
    .filter((s) => {
      const f = s.share?.fii;
      const fp = s.share?.fiiPrev;
      return f != null && fp != null && f - fp >= 1.0;
    })
    .sort(
      (a, b) =>
        (b.share!.fii! - b.share!.fiiPrev!) -
        (a.share!.fii! - a.share!.fiiPrev!),
    )
    .slice(0, 5);

  const totalIdeas =
    SECTION_ORDER.reduce((n, k) => n + sectioned[k].length, 0) +
    compounders.length + cheap.length + promoterUp.length + fiiUp.length;
  const earlyArchive = windowBack < 5; // Less than ~4 weeks of history.
  const nifty200Empty = nifty200Only && stocks.length === 0 && snapshots.length > 0;

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
        <ScopePill href="/ideas" label="All stocks" active={showAll} hint="Everything in the universe" />
        <ScopePill href="/ideas?scope=nifty200" label="Nifty 200" active={nifty200Only} hint="Curated large/mid-cap set" />
      </nav>

      {/* Banners */}
      {snapshots.length === 0 && <FirstSnapshotBanner />}
      {nifty200Empty && <Nifty200EmptyBanner />}
      {earlyArchive && snapshots.length > 0 && !nifty200Empty && (
        <ConvictionFilterBanner snapshotsHave={snapshots.length} />
      )}

      {/* Tab strip — one bucket at a time. URL-driven so each tab is shareable.
          The dot color matches the section's accent so the eye finds the
          active tab fast. Counts give an at-a-glance overview of where the
          action is this week. */}
      {snapshots.length > 0 && !nifty200Empty && (
        <>
          <BucketTabs
            active={activeTab}
            scopeQuery={nifty200Only ? "&scope=nifty200" : ""}
            counts={{
              strength: sectioned.strength.length,
              losing: sectioned.losing.length,
              breakout: sectioned.breakout.length,
              breakdown: sectioned.breakdown.length,
              compounder: compounders.length,
              cheap: cheap.length,
              promoter_up: promoterUp.length,
              fii_up: fiiUp.length,
            }}
          />

          {/* Single active board — keeps the page short and scroll-free. */}
          <div className="mt-6">
            {activeTab === "strength" && (
              <Board
                title="Building strength"
                subtitle="Sustained climb across the last few weeks"
                color="var(--color-score-good)"
                icon={<TrendingUp size={15} strokeWidth={2.2} />}
                stocks={sectioned.strength}
                section="strength"
                emptyHint="No stocks meeting the 4-week sustained-climb threshold."
              />
            )}
            {activeTab === "losing" && (
              <Board
                title="Losing ground"
                subtitle="Score has weakened consistently"
                color="var(--color-score-poor)"
                icon={<TrendingDown size={15} strokeWidth={2.2} />}
                stocks={sectioned.losing}
                section="losing"
                emptyHint="No stocks meeting the 4-week sustained-decline threshold."
              />
            )}
            {activeTab === "breakout" && (
              <Board
                title="Recent breakouts"
                subtitle="Just entered top-quartile of its cluster"
                color="var(--color-score-excellent)"
                icon={<Sparkles size={15} strokeWidth={2.2} />}
                stocks={sectioned.breakout}
                section="breakout"
                emptyHint="No new top-quartile entrants this week."
              />
            )}
            {activeTab === "breakdown" && (
              <Board
                title="Recent breakdowns"
                subtitle="Just fell below median this week"
                color="var(--color-score-weak)"
                icon={<AlertTriangle size={15} strokeWidth={2.2} />}
                stocks={sectioned.breakdown}
                section="breakdown"
                emptyHint="No fresh breakdowns this week."
              />
            )}
            {activeTab === "compounder" && (
              <Board
                title="Quality compounders"
                subtitle="High quality, veteran tier, score stable over the window"
                color="var(--color-accent-600)"
                icon={<Award size={15} strokeWidth={2.2} />}
                stocks={compounders}
                section="compounder"
                emptyHint="No stocks pass the quality-≥75 + veteran + stable filter."
              />
            )}
            {activeTab === "cheap" && (
              <Board
                title="Cheap in cluster"
                subtitle="Top-quartile valuation, composite still respectable"
                color="var(--color-accent-500)"
                icon={<Tag size={15} strokeWidth={2.2} />}
                stocks={cheap}
                section="cheap"
                emptyHint="No stocks pass the value-≥75 + composite-≥50 filter."
              />
            )}
            {activeTab === "promoter_up" && (
              <Board
                title="Promoter accumulation"
                subtitle="Promoter stake up ≥1pp QoQ — insiders adding"
                color="var(--color-accent-400)"
                icon={<Users size={15} strokeWidth={2.2} />}
                stocks={promoterUp}
                section="promoter_up"
                emptyHint="No promoter-accumulation signals in the latest quarter."
              />
            )}
            {activeTab === "fii_up" && (
              <Board
                title="FII accumulation"
                subtitle="Foreign institutional stake up ≥1pp QoQ"
                color="var(--color-score-good)"
                icon={<Globe2 size={15} strokeWidth={2.2} />}
                stocks={fiiUp}
                section="fii_up"
                emptyHint="No FII-accumulation signals in the latest quarter."
              />
            )}
          </div>
        </>
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

/**
 * Tab strip for /ideas — two rows, fully visible at first paint.
 *   Row 1: Trend buckets (Building strength / Losing ground / Breakouts / Breakdowns)
 *   Row 2: Themed buckets (Quality compounders / Cheap / Promoter / FII)
 *
 * Each row has a tiny eyebrow on the left so the user knows what the row
 * means without reading every tab. The previous single-row + scroll-overflow
 * version buried the themed buckets unless the user noticed the scrollbar.
 *
 * Tabs use scroll={false} so clicking a tab doesn't reset scroll position —
 * a long stock list stays where it was. The selected tab gets a tinted
 * background + colored border + bold label so it stands apart from the rest.
 *
 * URL: /ideas?bucket=<key>[&scope=nifty200]. Scope is preserved.
 */
function BucketTabs({
  active, counts, scopeQuery,
}: {
  active: TabKey;
  scopeQuery: string;
  counts: {
    strength: number; losing: number; breakout: number; breakdown: number;
    compounder: number; cheap: number; promoter_up: number; fii_up: number;
  };
}) {
  const trendItems = [
    { key: "strength"   as TabKey, label: "Building strength",  dot: "var(--color-score-good)",      n: counts.strength },
    { key: "losing"     as TabKey, label: "Losing ground",      dot: "var(--color-score-poor)",      n: counts.losing },
    { key: "breakout"   as TabKey, label: "Recent breakouts",   dot: "var(--color-score-excellent)", n: counts.breakout },
    { key: "breakdown"  as TabKey, label: "Recent breakdowns",  dot: "var(--color-score-weak)",      n: counts.breakdown },
  ];
  const themedItems = [
    { key: "compounder"  as TabKey, label: "Quality compounders",   dot: "var(--color-accent-600)", n: counts.compounder },
    { key: "cheap"       as TabKey, label: "Cheap in cluster",      dot: "var(--color-accent-500)", n: counts.cheap },
    { key: "promoter_up" as TabKey, label: "Promoter accumulation", dot: "var(--color-accent-400)", n: counts.promoter_up },
    { key: "fii_up"      as TabKey, label: "FII accumulation",      dot: "var(--color-score-good)", n: counts.fii_up },
  ];

  // Sticky on mobile so the tab strip stays reachable while you scroll
  // through a long board. Desktop also sticks but at a lower position
  // (below the global header). Backdrop-blur keeps the underlying content
  // legible through the sticky strip.
  return (
    <div
      className="mt-6 flex flex-col gap-2 sticky top-[84px] z-20 -mx-6 px-6 py-2 backdrop-blur-md"
      style={{ backgroundColor: "color-mix(in srgb, var(--color-paper) 92%, transparent)" }}
    >
      <BucketTabRow eyebrow="Trend"  items={trendItems}  active={active} scopeQuery={scopeQuery} />
      <BucketTabRow eyebrow="Themed" items={themedItems} active={active} scopeQuery={scopeQuery} />
    </div>
  );
}

function BucketTabRow({
  eyebrow, items, active, scopeQuery,
}: {
  eyebrow: string;
  items: { key: TabKey; label: string; dot: string; n: number }[];
  active: TabKey;
  scopeQuery: string;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span
        className="text-[10px] uppercase tracking-wide muted-text shrink-0"
        style={{ minWidth: 48 }}
      >
        {eyebrow}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <BucketTab key={it.key} item={it} active={it.key === active} scopeQuery={scopeQuery} />
        ))}
      </div>
    </div>
  );
}

function BucketTab({
  item, active, scopeQuery,
}: {
  item: { key: TabKey; label: string; dot: string; n: number };
  active: boolean;
  scopeQuery: string;
}) {
  const href = `/ideas?bucket=${item.key}${scopeQuery}`;
  return (
    <Link
      href={href}
      scroll={false}
      className="px-3 py-1.5 rounded-md text-[12.5px] inline-flex items-center gap-2 transition-colors whitespace-nowrap border"
      style={
        active
          ? {
              borderColor: item.dot,
              backgroundColor: "var(--color-card)",
              color: "var(--color-ink)",
              boxShadow: `inset 0 0 0 1px ${item.dot}`,
            }
          : {
              borderColor: "var(--color-border-default)",
              backgroundColor: "transparent",
              color: "var(--color-muted)",
            }
      }
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: item.dot }}
      />
      <span className={active ? "font-semibold" : "font-medium"}>{item.label}</span>
      <span className="tabular-nums text-[11px] muted-text">{item.n}</span>
    </Link>
  );
}

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

function Nifty200EmptyBanner() {
  return (
    <div className="card p-8 mt-8 text-[13px] leading-[1.6]">
      <div className="font-display text-[17px] mb-2">Nifty 200 filter not yet seeded</div>
      <p className="muted-text">
        No stocks are currently flagged as Nifty 200 in <code className="font-mono">app.universe.is_nifty200</code>.
        Apply <code className="font-mono">db/migrations/0010_nifty200.sql</code> to populate it, or switch back to{" "}
        <Link href="/ideas" className="text-[var(--color-accent-700)] underline">All stocks</Link>.
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
  // Negative-signal sections show a red down-arrow; everything else (trend-up
  // *and* the new themed-quality buckets) shows green up-arrow framing.
  const isNegative = section === "losing" || section === "breakdown";
  const deltaColor = isNegative ? "var(--color-score-poor)" : "var(--color-score-good)";
  const Arrow = isNegative ? ArrowDownRight : ArrowUpRight;
  const why = whyLine(stock, section);
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
              {stock.industry_name} · {tierLabel(stock.maturity_tier)}
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
