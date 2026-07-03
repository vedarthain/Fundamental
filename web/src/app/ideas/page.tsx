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
  Activity, Trophy, CalendarDays,
} from "lucide-react";
import { band, bandColor, tierLabel, hasScoreableHistory } from "@/lib/score";
import { getOIAlerts } from "@/lib/oi-alerts";
import { Sparkline, type SparkPoint } from "@/components/Sparkline";
import { WatchlistButton } from "@/components/WatchlistButton";

// Score data changes weekly. 6h ISR cache avoids waking Neon on every visit.
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
  industry_name: string;
  listing_date: string | null;
  years_of_data: number | null;
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
  // Current snapshot
  curr: { c: number; q: number; v: number; m: number };
  // Comparison snapshot (windowBack ago)
  then: { c: number; q: number; v: number; m: number };
  // Min/max over the window for persistence checks
  windowMaxC: number;
  windowMinC: number;
  trail: { label: string; value: number | null }[];
  // Peer-cluster average composite at each snapshot in `trail` (same order/length,
  // null where the cluster had no data). Drives the dashed overlay so the reader
  // sees the stock's path RELATIVE to peers, not just absolute.
  peerTrail: SparkPoint[];
  // Composite delta over the window MINUS the cluster's average delta — i.e.
  // gearing up after stripping out the broad price tide. Null if no peer data.
  clusterAdj: number | null;
  // Consistency of the 12-week trail (weeks-up, current streak, etc.).
  stats: TrendStats;
  // Quarterly shareholding deltas (null when ETL hasn't captured 2 quarters yet)
  share: ShareSnap | null;
  /** True when the latest quarter contains a large one-time "other income"
   *  that may have temporarily inflated the composite score. */
  oiAlert: boolean;
};

/** Consistency descriptors derived from a composite trail (oldest → newest). */
type TrendStats = {
  transitions: number; // week-to-week comparisons available
  up: number;          // count of weeks the score rose
  down: number;        // count of weeks the score fell
  streakUp: number;    // consecutive rising weeks from the latest end
  streakDown: number;  // consecutive falling weeks from the latest end
};

function trendStats(trail: SparkPoint[]): TrendStats {
  const vals = trail.map((t) => t.value).filter((v): v is number => v != null);
  let up = 0, down = 0, transitions = 0;
  for (let i = 1; i < vals.length; i++) {
    transitions++;
    if (vals[i] > vals[i - 1]) up++;
    else if (vals[i] < vals[i - 1]) down++;
  }
  let streakUp = 0;
  for (let i = vals.length - 1; i > 0; i--) {
    if (vals[i] > vals[i - 1]) streakUp++; else break;
  }
  let streakDown = 0;
  for (let i = vals.length - 1; i > 0; i--) {
    if (vals[i] < vals[i - 1]) streakDown++; else break;
  }
  return { transitions, up, down, streakUp, streakDown };
}

// Trend-based — assigned exclusively by classify() (first match wins).
type TrendSectionKey = "strength" | "losing" | "breakout" | "breakdown";
// Quality/value/flow-based — independent filters; a stock can be in
// multiple of these and also in one of the trend buckets above.
type ThemedSectionKey = "compounder" | "cheap" | "promoter_up" | "fii_up";
type SectionKey = TrendSectionKey | ThemedSectionKey;

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadIdeas(tier: IdxTier) {
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
      u.listing_date::text AS listing_date,
      u.years_of_data,
      c.name AS industry_name
    FROM recent r
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = r.cluster_id
    WHERE TRUE
    ${idxCond("r.symbol", tier)}
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

  // Step 2.6 — peer-cluster average composite at each recent snapshot, across
  // the FULL universe (not tier-limited), so the cluster baseline is unbiased.
  // Powers the dashed overlay line and the cluster-adjusted ("vs peers") delta.
  const clusterTrailRows = await sql<{ cluster_id: string; d: string; avg: number }[]>`
    WITH recent_dates AS (
      SELECT DISTINCT snapshot_date FROM app.scores ORDER BY snapshot_date DESC LIMIT 12
    )
    SELECT cluster_id, snapshot_date::text AS d, AVG(composite_pct)::float AS avg
      FROM app.scores
     WHERE snapshot_date IN (SELECT snapshot_date FROM recent_dates)
       AND composite_pct IS NOT NULL
     GROUP BY cluster_id, snapshot_date
  `;
  const clusterAvgByDate = new Map<string, Map<string, number>>();
  for (const r of clusterTrailRows) {
    let m = clusterAvgByDate.get(r.cluster_id);
    if (!m) { m = new Map(); clusterAvgByDate.set(r.cluster_id, m); }
    m.set(r.d, r.avg);
  }

  // Comparison window = the FULL available trail (up to 12 snapshots ≈ 12 weeks;
  // `dates` is already LIMIT 12). A full quarter captures a results cycle and is
  // far more stable week-to-week than a 4-week window (less price-noise churn →
  // better continuity), and it makes the delta, consistency badges, "since"
  // caption and the 12-week sparkline all describe ONE period. Adapts down
  // gracefully in the early-archive phase when we have only a few snapshots.
  const windowBack = dates.length;
  const latestDate = dates[0].snapshot_date;
  const oldDate = dates[dates.length - 1].snapshot_date;

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
    // Minimum-history gate: keep fresh IPOs (< ~1yr of trading) out of every
    // Ideas bucket. A 3-month listing can score top-decile on price noise; it
    // has no business being surfaced as an idea until its record is trustable.
    if (!hasScoreableHistory(curr.listing_date, curr.years_of_data)) continue;
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

    // Peer baseline: the stock's cluster average composite at each trail date.
    const clusterAvg = clusterAvgByDate.get(curr.industry_id);
    const peerTrail: SparkPoint[] = trail.map((t) => ({
      label: t.label,
      value: clusterAvg?.get(t.label) ?? null,
    }));
    // Cluster-adjusted window delta = own delta − cluster average delta.
    const peerLatest = clusterAvg?.get(latestDate);
    const peerOld = clusterAvg?.get(oldDate);
    const clusterAdj =
      peerLatest != null && peerOld != null
        ? (curr.composite_pct! - then.composite_pct!) - (peerLatest - peerOld)
        : null;

    stocks.push({
      symbol,
      company_name: curr.company_name,
      industry_id: curr.industry_id,
      industry_name: curr.industry_name,
      maturity_tier: curr.maturity_tier,
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
      peerTrail,
      clusterAdj,
      // Consistency is measured over the SAME comparison window as the delta and
      // the "since {date}" caption (the last `windowBack` snapshots), so the
      // numbers all describe one period. The sparkline still shows the fuller
      // 12-week trail for visual context.
      stats: trendStats(trail.slice(-windowBack)),
      share: shareBySymbol.get(symbol) ?? null,
      oiAlert: false, // populated in the batch check below
    });
  }

  // Step 3 — batch OI spike check.  One DB round-trip for all loaded symbols.
  // Marks stocks whose latest quarter contains a large one-time "other income"
  // that may have temporarily inflated their composite score.
  if (stocks.length > 0) {
    const allSymbols = stocks.map((s) => s.symbol);
    const oiFlagged = await getOIAlerts(allSymbols);
    for (const s of stocks) {
      if (oiFlagged.has(s.symbol)) s.oiAlert = true;
    }
  }

  return {
    stocks,
    snapshots: dates.map((d) => d.snapshot_date),
    windowBack,
  };
}

// ---------------------------------------------------------------------------
// "First batch" — top-of-page digest. Three independent, freshly-computed
// surfaces that answer "what's new" at a glance, above the evergreen buckets:
//   1. Score movers   — biggest week-over-week composite shifts (latest two snapshots).
//   2. Result winners — companies whose latest quarter beat the year-ago quarter.
//   3. On the calendar — upcoming ex-dates / board meetings in the next ~3 weeks.
// Each is fail-soft (missing/sparse tables → empty card, never a 500).
// ---------------------------------------------------------------------------

type ScoreMover = {
  symbol: string; company_name: string;
  then: number; now: number; delta: number;
  trail: SparkPoint[];
  peerTrail: SparkPoint[];
  clusterAdj: number | null;
  stats: TrendStats;
};
type ResultWinner = {
  symbol: string; company_name: string;
  npYoy: number; salesYoy: number; npNow: number; composite: number | null;
};
type UpcomingEvent = {
  symbol: string; company_name: string; action_type: string;
  ex_date: string; purpose: string; amount: number | null; composite: number | null;
};

// Index-membership tiers — the single universe control for the whole page
// (buckets, movers, winners, calendar). Nesting: Nifty 50 ⊂ 100 ⊂ 200 ⊂ 500 ⊂ All.
// Membership comes from app.index_constituent (maintained by
// scripts/fetch-index-constituents.py from NSE list CSVs) — the authoritative,
// refreshed source, not the partial is_nifty* booleans on app.universe.
// Default = nifty50 (the highlighted pill) — the cleanest, most recognizable slice.
const IDX_TIERS = [
  { key: "nifty50",  label: "Nifty 50",  code: "NIFTY50"  },
  { key: "nifty100", label: "Nifty 100", code: "NIFTY100" },
  { key: "nifty200", label: "Nifty 200", code: "NIFTY200" },
  { key: "nifty500", label: "Nifty 500", code: "NIFTY500" },
  { key: "all",      label: "All",       code: null       },
] as const;
type IdxTier = (typeof IDX_TIERS)[number]["key"];

function isIdxTier(s: string | undefined): s is IdxTier {
  return !!s && (IDX_TIERS as readonly { key: string }[]).some((t) => t.key === s);
}

function idxCode(tier: IdxTier): string | null {
  return IDX_TIERS.find((t) => t.key === tier)?.code ?? null;
}

/** SQL membership predicate for a tier. Returns an `AND <col> IN (...)` fragment
 *  scoping a query to the chosen index's constituents, or empty SQL for "All".
 *  `col` is the symbol column expression in the caller's query (e.g. "r.symbol",
 *  "p.symbol", "ca.symbol"). Always emitted as `AND ...`, so the caller must
 *  already have a WHERE (or use it as the sole condition via WHERE TRUE). */
function idxCond(col: string, tier: IdxTier) {
  const code = idxCode(tier);
  if (code == null) return sql``;
  return sql`AND ${sql.unsafe(col)} IN (
    SELECT symbol FROM app.index_constituent WHERE index_code = ${code}
  )`;
}

/** Build a /ideas href that preserves the current searchParams, applying the
 *  given overrides (null removes a key). Used by the universe pills and the
 *  calendar pager so navigation keeps the rest of the page state intact. */
function ideasHref(
  sp: Record<string, string | undefined>,
  overrides: Record<string, string | null>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v != null) params.set(k, v);
  for (const [k, v] of Object.entries(overrides)) {
    if (v == null) params.delete(k);
    else params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/ideas?${qs}` : "/ideas";
}

/** Score movers are derived in the page from the 4-week window that loadIdeas
 *  already computes (curr vs `windowBack` snapshots ago, ~4 weeks) — see
 *  buildScoreMovers below. We use the longer window deliberately: between
 *  quarterly results Quality is frozen, so a 1-week composite move is almost
 *  pure price (Valuation re-rate + Momentum). Four weeks shows the actual
 *  behaviour — steady drift vs. a single-week spike — and the sparkline trail
 *  lets the reader judge which. */
// Sort key: peer-relative climb (cluster-adjusted) is the primary signal —
// it strips out the broad price tide so we rank durable, stock-specific moves,
// not "everyone rallied this week". Falls back to raw delta when a stock has no
// peer baseline. Because the metric is stable week to week, the same genuine
// climbers persist on the list → continuity, instead of a churning cast.
function moverRank(m: ScoreMover): number {
  return m.clusterAdj ?? m.delta;
}

function buildScoreMovers(stocks: Stock[]): { up: ScoreMover[]; down: ScoreMover[] } {
  // `stocks` is already scoped to the selected index tier by loadIdeas.
  // Gates:
  //   - LEAST(then, now) >= 30 — genuine re-rates of already-respectable names,
  //     not microcaps whipping up from near-zero (a data-quality artifact).
  //   - consistency: rose (fell) in >= 60% of the available weeks — a SUSTAINED
  //     climb (slide), not a one-week price pop. This is what stops the list
  //     reshuffling every week on noise.
  const pool: ScoreMover[] = stocks
    .filter((s) => Math.min(s.curr.c, s.then.c) >= 30 && s.stats.transitions >= 2)
    .map((s) => ({
      symbol: s.symbol,
      company_name: s.company_name,
      then: s.then.c,
      now: s.curr.c,
      delta: s.curr.c - s.then.c,
      trail: s.trail,
      peerTrail: s.peerTrail,
      clusterAdj: s.clusterAdj,
      stats: s.stats,
    }));
  // "Sustained" = rose (fell) in >= 60% of weeks, OR is on a clear current
  // streak of >= 3 weeks in that direction. The streak clause admits a stock
  // that was choppy early but has been climbing steadily of late — that's real,
  // followable continuity, not a one-week pop — and keeps the headline card from
  // going empty on small, stable universes (e.g. Nifty 50).
  const consistent = (m: ScoreMover, dir: "up" | "down") => {
    const hits = dir === "up" ? m.stats.up : m.stats.down;
    const streak = dir === "up" ? m.stats.streakUp : m.stats.streakDown;
    return hits / m.stats.transitions >= 0.6 || streak >= 3;
  };
  const up = pool
    .filter((m) => m.delta >= 5 && consistent(m, "up"))
    .sort((a, b) => moverRank(b) - moverRank(a))
    .slice(0, 5);
  const down = pool
    .filter((m) => m.delta <= -5 && consistent(m, "down"))
    .sort((a, b) => moverRank(a) - moverRank(b))
    .slice(0, 5);
  return { up, down };
}

/** Result winners — latest reported quarter vs the same quarter a year ago
 *  (rn=1 vs rn=5). Requires real YoY profit + revenue growth, margin expansion,
 *  a material year-ago base (so the % isn't a low-base mirage), and a decent
 *  composite (quality gate). Recent filings only (within ~110d of the newest
 *  period_end in the table) so stragglers don't masquerade as "this season".
 *
 *  Scoped to the chosen index tier (single page-wide universe control), ordered
 *  by YoY profit growth, top 10 (matches the movers/calendar card height so the
 *  grid row has no gap). All still pass the same quality + material-base gates. */
async function loadResultWinners(tier: IdxTier): Promise<ResultWinner[]> {
  try {
    return await sql<ResultWinner[]>`
      WITH ranked AS (
        SELECT symbol, period_end, sales, net_profit,
               ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY period_end DESC) AS rn
          FROM app.fundamentals_quarterly
      ),
      pairs AS (
        SELECT c.symbol, c.period_end AS curr_pe,
               c.sales AS s_now, c.net_profit AS np_now,
               y.sales AS s_yago, y.net_profit AS np_yago
          FROM ranked c
          JOIN ranked y ON y.symbol = c.symbol AND y.rn = 5
         WHERE c.rn = 1
      )
      SELECT p.symbol, u.company_name,
             ROUND((p.np_now / p.np_yago - 1) * 100)::int AS "npYoy",
             ROUND((p.s_now / p.s_yago - 1) * 100)::int  AS "salesYoy",
             ROUND(p.np_now)::int AS "npNow",
             sc.composite_pct AS composite
        FROM pairs p
        JOIN app.universe u ON u.symbol = p.symbol
        LEFT JOIN app.scores sc
          ON sc.symbol = p.symbol
         AND sc.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
       WHERE p.s_now > 0 AND p.s_yago > 0 AND p.np_yago >= 10 AND p.s_now >= 100
         AND p.np_now > p.np_yago * 1.15
         AND p.s_now  > p.s_yago * 1.05
         AND (p.np_now / p.s_now) > (p.np_yago / p.s_yago)
         AND p.curr_pe >= (SELECT MAX(period_end) FROM app.fundamentals_quarterly) - interval '110 days'
         AND sc.composite_pct >= 60
         ${idxCond("p.symbol", tier)}
       ORDER BY (p.np_now / p.np_yago) DESC
       LIMIT 10
    `;
  } catch {
    return [];
  }
}

/** Upcoming events — dividends / board meetings with an ex_date in the next
 *  ~3 weeks. DISTINCT ON collapses the indianapi+bse dual-source dupes (prefer
 *  indianapi), mirroring the stock-page dedup. */
async function loadUpcomingEvents(tier: IdxTier): Promise<UpcomingEvent[]> {
  try {
    return await sql<UpcomingEvent[]>`
      SELECT ca.symbol, u.company_name, ca.action_type,
             ca.ex_date::text AS ex_date, ca.purpose, ca.amount,
             sc.composite_pct AS composite
        FROM (
          SELECT DISTINCT ON (symbol, action_type, ex_date)
                 symbol, action_type, ex_date, purpose, amount
            FROM app.corporate_action
           WHERE ex_date >= CURRENT_DATE AND ex_date <= CURRENT_DATE + interval '21 days'
           ORDER BY symbol, action_type, ex_date, (source = 'indianapi') DESC
        ) ca
        JOIN app.universe u ON u.symbol = ca.symbol
        LEFT JOIN app.scores sc
          ON sc.symbol = ca.symbol
         AND sc.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
       WHERE TRUE
       ${idxCond("ca.symbol", tier)}
       ORDER BY ca.ex_date ASC, ca.symbol
       LIMIT 120
    `;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Section assignment
// ---------------------------------------------------------------------------

const SECTION_ORDER: TrendSectionKey[] = ["strength", "losing", "breakout", "breakdown"];

function classify(s: Stock, windowBack: number): TrendSectionKey | null {
  const dC = s.curr.c - s.then.c;
  // If we have <2 snapshots, no comparison is meaningful.
  if (windowBack < 2) return null;

  const t = Math.max(1, s.stats.transitions);
  // Building strength — sustained climb: fresh window-high, in respectable
  // territory, AND at least 40% of weeks were up. The ratio gate blocks a
  // single-week spike (or flat-then-jump: e.g. 1/11 up scores 9% — well
  // below the 40% floor). Symmetrical with score-movers' 60% gate.
  if (dC >= 10 && s.curr.c >= s.windowMaxC && s.curr.c >= 50
      && s.stats.up / t >= 0.4) {
    return "strength";
  }
  // Losing ground — sustained slip: fresh window-low, soft territory, AND at
  // least 40% of weeks were down.
  if (dC <= -10 && s.curr.c <= s.windowMinC && s.curr.c < 60
      && s.stats.down / t >= 0.4) {
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

// Peer-relative climb for ranking the trend buckets (same rationale as the
// movers card): cluster-adjusted delta first so a sector-wide rally doesn't
// crowd out genuine stock-specific strength; raw delta as the fallback.
function peerClimb(s: Stock): number {
  return s.clusterAdj ?? (s.curr.c - s.then.c);
}

function rankWithin(section: TrendSectionKey, a: Stock, b: Stock): number {
  switch (section) {
    case "strength":
      return peerClimb(b) - peerClimb(a); // biggest peer-relative gain first
    case "losing":
      return peerClimb(a) - peerClimb(b); // biggest peer-relative drop first
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

  // Fallback (and default for trend buckets): biggest pillar delta — but
  // section-aware so the narrative matches the direction of the bucket.
  // "Building Strength" should say what ROSE, not what slipped.
  // "Losing Ground" should say what FELL, not what improved.
  const dq = s.curr.q - s.then.q;
  const dv = s.curr.v - s.then.v;
  const dm = s.curr.m - s.then.m;

  const items: { key: "Q" | "V" | "M"; delta: number; curr: number }[] = [
    { key: "Q", delta: dq, curr: s.curr.q },
    { key: "V", delta: dv, curr: s.curr.v },
    { key: "M", delta: dm, curr: s.curr.m },
  ];
  const pos = items.filter((it) => it.delta > 0);
  const neg = items.filter((it) => it.delta < 0);
  const byAbsDesc = (acc: typeof items[0], it: typeof items[0]) =>
    Math.abs(it.delta) > Math.abs(acc.delta) ? it : acc;

  let biggest: typeof items[0];
  if ((section === "strength" || section === "breakout") && pos.length > 0) {
    // Lead with what drove the score UP — biggest positive mover.
    biggest = pos.reduce((acc, it) => it.delta > acc.delta ? it : acc);
  } else if ((section === "losing" || section === "breakdown") && neg.length > 0) {
    // Lead with what drove the score DOWN — biggest negative mover.
    biggest = neg.reduce((acc, it) => it.delta < acc.delta ? it : acc);
  } else {
    // Themed buckets or edge-case (all pillars flat/opposite): biggest absolute.
    biggest = items.reduce(byAbsDesc);
  }

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

export const metadata = {
  title: "Ideas — weekly NSE stock ideas from the scoring engine · EquityRoots",
  description:
    "Auto-generated weekly stock ideas grounded in EquityRoots' peer-cluster scores — compounders, cheap-in-cluster names and momentum shifts across the NSE.",
};

export default async function IdeasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  // Single page-wide universe control: one index tier drives everything —
  // buckets, score movers, result winners and the calendar. Default = Nifty 50
  // (the highlighted pill): the cleanest, most recognizable slice. Opt wider via
  // ?idx=nifty100|nifty200|nifty500|all.
  const idxTier: IdxTier = isIdxTier(sp.idx) ? sp.idx : "nifty50";
  // Active tab — one bucket at a time. Defaults to "strength" so first load
  // shows the biggest positive-trend stocks.
  const activeTab: TabKey = isTabKey(sp.bucket) ? sp.bucket : "strength";

  // Calendar pagination — 10 events per page, 1-indexed. Matches the Score
  // movers card's max of 10 (5 up + 5 down) so the three cards in the grid row
  // are roughly equal height and the calendar fills down instead of leaving a
  // gap below it.
  const CAL_PER_PAGE = 10;
  const calPage = Math.max(1, Number.parseInt(sp.cal ?? "1", 10) || 1);

  const [{ stocks, snapshots, windowBack }, resultWinners, upcoming] = await Promise.all([
    loadIdeas(idxTier),
    loadResultWinners(idxTier),
    loadUpcomingEvents(idxTier),
  ]);

  // Score movers — biggest composite shifts over the ~4-week comparison window
  // (curr vs windowBack snapshots ago). `stocks` is already scoped to the tier,
  // so this is derived in-page with no extra query.
  let movers = buildScoreMovers(stocks);
  // Fallback: narrow universes (Nifty 50 / 100) often have no SUSTAINED movers
  // in a given window — stable large-caps just don't swing. Rather than show an
  // empty headline card, widen the movers (only) to Nifty 200 and flag it.
  // One extra query, and only when the selected tier yielded nothing.
  let moversTierLabel: string | null = null;
  if (movers.up.length + movers.down.length === 0 && (idxTier === "nifty50" || idxTier === "nifty100")) {
    const fb = await loadIdeas("nifty200");
    const fbMovers = buildScoreMovers(fb.stocks);
    if (fbMovers.up.length + fbMovers.down.length > 0) {
      movers = fbMovers;
      moversTierLabel = "Nifty 200";
    }
  }
  // Human-readable "since" date for the movers card caption.
  const moversSince = snapshots[Math.min(windowBack, snapshots.length) - 1] ?? null;

  // Calendar page slice.
  const calTotalPages = Math.max(1, Math.ceil(upcoming.length / CAL_PER_PAGE));
  const calPageClamped = Math.min(calPage, calTotalPages);
  const upcomingPage = upcoming.slice((calPageClamped - 1) * CAL_PER_PAGE, calPageClamped * CAL_PER_PAGE);

  // Band controls — tier pills (movers + winners) and calendar pager links.
  const idxItems = IDX_TIERS.map((t) => ({
    key: t.key,
    label: t.label,
    active: t.key === idxTier,
    href: ideasHref(sp, { idx: t.key }),
  }));
  const calPrevHref = calPageClamped > 1 ? ideasHref(sp, { cal: String(calPageClamped - 1) }) : null;
  const calNextHref = calPageClamped < calTotalPages ? ideasHref(sp, { cal: String(calPageClamped + 1) }) : null;

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
  // The chosen tier has no scored constituents (e.g. an index not yet seeded
  // in app.index_constituent on this environment). "All" never trips this.
  const tierEmpty = idxTier !== "all" && stocks.length === 0 && snapshots.length > 0;
  const idxLabel = IDX_TIERS.find((t) => t.key === idxTier)?.label ?? "All";

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-10">
      {/* Header */}
      <header className="max-w-[760px]">
        <div className="text-[12px] uppercase tracking-wide muted-text">Ideas Feed</div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight mt-1">
          Stocks worth a <em className="accent">closer look</em>.
        </h1>

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

      {/* Universe control — single page-wide index tier (drives buckets, movers,
          winners and the calendar). */}
      <nav className="mt-6">
        <TierPills items={idxItems} />
      </nav>

      {/* Banners */}
      {snapshots.length === 0 && <FirstSnapshotBanner />}
      {tierEmpty && <TierEmptyBanner label={idxLabel} />}
      {earlyArchive && snapshots.length > 0 && !tierEmpty && (
        <ConvictionFilterBanner snapshotsHave={snapshots.length} />
      )}

      {/* Tab strip — one bucket at a time. URL-driven so each tab is shareable.
          The dot color matches the section's accent so the eye finds the
          active tab fast. Counts give an at-a-glance overview of where the
          action is this week. */}
      {snapshots.length > 0 && !tierEmpty && (
        <>
          <ThisWeekBand
            movers={movers}
            moversSince={moversSince}
            moversTierLabel={moversTierLabel}
            winners={resultWinners}
            upcoming={upcomingPage}
            calPage={calPageClamped}
            calTotalPages={calTotalPages}
            calPrevHref={calPrevHref}
            calNextHref={calNextHref}
          />

          <BucketTabs
            active={activeTab}
            scopeQuery={`&idx=${idxTier}`}
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

      {/* How to read this page — moved to the foot so the surfaces lead, and the
          methodology note is there for anyone who scrolls to understand it. */}
      <section className="mt-12 pt-6 border-t hairline max-w-[760px]">
        <div className="text-[12px] uppercase tracking-wide muted-text mb-1.5">How to read this</div>
        <p className="text-[13px] muted-text leading-[1.6]">
          We surface stocks where our score has changed meaningfully over the last few weeks
          — fundamentals strengthening, slipping, breaking out, or breaking down. Each entry
          shows the 12-week trail so you can judge spike vs trend yourself.
        </p>
      </section>

      {/* Footer disclaimer (persistent trust builder) */}
      <footer className="mt-6 text-[11.5px] muted-text leading-[1.6] max-w-[760px]">
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

// ---------------------------------------------------------------------------
// "This week" top band — the first-batch digest. Three cards, side by side on
// desktop, stacked on mobile. Each is self-contained and degrades to a quiet
// empty state rather than vanishing, so the band's shape is predictable.
// ---------------------------------------------------------------------------

const EVENT_LABEL: Record<string, string> = {
  dividend: "Dividend",
  board_meeting: "Board meeting",
  bonus: "Bonus",
  split: "Split",
  rights: "Rights",
  buyback: "Buyback",
};

function eventDateLabel(iso: string): string {
  // iso is YYYY-MM-DD. Render as "19 Jun" + relative "in Nd" hint.
  const d = new Date(iso + "T00:00:00");
  const dd = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  const rel = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days}d`;
  return `${dd} · ${rel}`;
}

function ThisWeekBand({
  movers, moversSince, moversTierLabel, winners, upcoming,
  calPage, calTotalPages, calPrevHref, calNextHref,
}: {
  movers: { up: ScoreMover[]; down: ScoreMover[] };
  moversSince: string | null;
  moversTierLabel: string | null;
  winners: ResultWinner[];
  upcoming: UpcomingEvent[];
  calPage: number;
  calTotalPages: number;
  calPrevHref: string | null;
  calNextHref: string | null;
}) {
  return (
    <section className="mt-6">
      <div className="flex items-baseline gap-2 mb-2.5">
        <h2 className="font-display text-[17px]">Latest signal</h2>
        <span className="muted-text text-[11.5px]">
          composite shifts, earnings beats and what&apos;s on the calendar
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 1 — Score movers (4-week behaviour, not a single week) */}
        <div className="card overflow-hidden">
          <header className="px-4 py-2.5 border-b hairline flex items-center gap-2"
                  style={{ borderTop: "3px solid var(--color-accent-500)" }}>
            <Activity size={14} strokeWidth={2.2} style={{ color: "var(--color-accent-600)" }} />
            <span className="font-medium text-[13px]">Score movers</span>
            {moversTierLabel && (
              <span className="text-[9.5px] px-1.5 py-[1px] rounded-full tabular-nums"
                    style={{ background: "var(--color-accent-50)", color: "var(--color-accent-700)" }}
                    title="Not enough sustained movers in the selected index — widened to Nifty 200.">
                {moversTierLabel}
              </span>
            )}
            <span className="muted-text text-[10.5px] ml-auto uppercase tracking-wide"
                  title={moversSince ? `composite change since ${moversSince}` : undefined}>
              {moversSince ? "since " + moversSince : "last 4 weeks"}
            </span>
          </header>
          <div className="p-3">
            {movers.up.length === 0 && movers.down.length === 0 ? (
              <p className="text-[12px] muted-text leading-[1.5]">
                No notable composite shifts in this index tier over the window.
              </p>
            ) : (
              <>
                <MoverList label="Upgrades" rows={movers.up} positive />
                {/* Clear demarcation between the rising and falling halves. */}
                {movers.up.length > 0 && movers.down.length > 0 && (
                  <div className="my-2.5 border-t hairline" />
                )}
                <MoverList label="Downgrades" rows={movers.down} positive={false} />
              </>
            )}
          </div>
        </div>

        {/* 2 — Result winners */}
        <div className="card overflow-hidden">
          <header className="px-4 py-2.5 border-b hairline flex items-center gap-2"
                  style={{ borderTop: "3px solid var(--color-score-good)" }}>
            <Trophy size={14} strokeWidth={2.2} style={{ color: "var(--color-score-good)" }} />
            <span className="font-medium text-[13px]">Result winners</span>
            <span className="muted-text text-[10.5px] ml-auto uppercase tracking-wide">latest quarter</span>
          </header>
          {winners.length === 0 ? (
            <p className="p-4 text-[12px] muted-text leading-[1.5]">
              No standout YoY beats in the latest reporting window yet.
            </p>
          ) : (
            <ol className="divide-y hairline">
              {winners.map((w) => (
                <li key={w.symbol} className="flex items-stretch">
                  <Link href={`/stock/${w.symbol}`}
                        className="block min-w-0 flex-1 pl-4 py-2.5 hover:bg-[var(--color-paper)]/60 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[12.5px] tabular-nums">{w.symbol}</span>
                      <span className="inline-flex items-center gap-0.5 text-[11.5px] font-semibold tabular-nums"
                            style={{ color: "var(--color-score-good)" }}>
                        <ArrowUpRight size={11} strokeWidth={2.6} />
                        Profit {fmtYoy(w.npYoy)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="muted-text text-[11px] truncate">{w.company_name}</span>
                      <span className="muted-text text-[10.5px] tabular-nums shrink-0">
                        Sales {fmtYoy(w.salesYoy)}
                      </span>
                    </div>
                  </Link>
                  <div className="flex items-center px-2 shrink-0">
                    <WatchlistButton symbol={w.symbol} variant="icon" />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* 3 — On the calendar */}
        <div className="card overflow-hidden">
          <header className="px-4 py-2.5 border-b hairline flex items-center gap-2"
                  style={{ borderTop: "3px solid var(--color-accent-400)" }}>
            <CalendarDays size={14} strokeWidth={2.2} style={{ color: "var(--color-accent-500)" }} />
            <span className="font-medium text-[13px]">On the calendar</span>
            <span className="muted-text text-[10.5px] ml-auto uppercase tracking-wide">next 3 weeks</span>
          </header>
          {upcoming.length === 0 ? (
            <p className="p-4 text-[12px] muted-text leading-[1.5]">
              No ex-dates or board meetings scheduled in the next three weeks.
            </p>
          ) : (
            <>
              <ol className="divide-y hairline">
                {upcoming.map((e) => (
                  <li key={`${e.symbol}-${e.action_type}-${e.ex_date}`} className="flex items-stretch">
                    <Link href={`/stock/${e.symbol}`}
                          className="block min-w-0 flex-1 pl-4 py-2.5 hover:bg-[var(--color-paper)]/60 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-[12.5px] tabular-nums">{e.symbol}</span>
                        <span className="muted-text text-[10.5px] tabular-nums shrink-0">
                          {eventDateLabel(e.ex_date)}
                        </span>
                      </div>
                      <div className="muted-text text-[11px] truncate mt-0.5">
                        {EVENT_LABEL[e.action_type] ?? e.action_type}
                        {e.amount != null ? ` · ₹${Number(e.amount)}` : ""}
                        {e.purpose && e.action_type !== "dividend" ? ` · ${e.purpose}` : ""}
                      </div>
                    </Link>
                    <div className="flex items-center px-2 shrink-0">
                      <WatchlistButton symbol={e.symbol} variant="icon" />
                    </div>
                  </li>
                ))}
              </ol>
              {calTotalPages > 1 && (
                <div className="flex items-center justify-between gap-2 px-4 py-2 border-t hairline">
                  <PagerLink href={calPrevHref} label="‹ Prev" />
                  <span className="muted-text text-[10.5px] tabular-nums">
                    Page {calPage} of {calTotalPages}
                  </span>
                  <PagerLink href={calNextHref} label="Next ›" />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** Index-tier pills for the band — Nifty 50 / 200 / 500 / All. Nifty 50 is the
 *  default (highlighted) slice. Reuses the same URL-preserving links the rest
 *  of the page uses, with scroll={false} so switching tiers doesn't jump. */
function TierPills({ items }: { items: { key: string; label: string; active: boolean; href: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide muted-text mr-0.5">Universe</span>
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          scroll={false}
          className="px-2.5 py-1 rounded-full text-[11.5px] border transition-colors whitespace-nowrap"
          style={
            it.active
              ? {
                  borderColor: "var(--color-accent-300)",
                  backgroundColor: "var(--color-accent-50)",
                  color: "var(--color-accent-700)",
                  fontWeight: 600,
                }
              : {
                  borderColor: "var(--color-border-default)",
                  backgroundColor: "transparent",
                  color: "var(--color-muted)",
                }
          }
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}

/** Calendar pager button. Disabled (muted, non-interactive) when href is null. */
function PagerLink({ href, label }: { href: string | null; label: string }) {
  if (!href) {
    return <span className="text-[11px] muted-text opacity-40 select-none px-1.5 py-0.5">{label}</span>;
  }
  return (
    <Link
      href={href}
      scroll={false}
      className="text-[11px] px-1.5 py-0.5 rounded hover:bg-[var(--color-paper)] transition-colors"
      style={{ color: "var(--color-accent-700)" }}
    >
      {label}
    </Link>
  );
}

function fmtYoy(pct: number): string {
  // Big YoY % off a low base reads as noise; show as a multiple past +300%.
  if (pct >= 300) return `+${(pct / 100 + 1).toFixed(1).replace(/\.0$/, "")}×`;
  return `+${pct}%`;
}

/** Continuity + peer-relative descriptors shown under each idea row.
 *  - streak/consistency: turns a churning list into a followable one — the
 *    reader sees "▲ 5-wk streak" or "8/11 wks up", and can track a name across
 *    weeks instead of watching the cast rotate.
 *  - vs peers: the cluster-adjusted delta — gearing up AFTER removing the broad
 *    price tide, so a sector-wide rally doesn't masquerade as stock strength. */
function TrendBadges({
  stats, clusterAdj, positive,
}: {
  stats: TrendStats;
  clusterAdj: number | null;
  positive: boolean;
}) {
  // ONE consistent format for every row: "N/M wks up|down" over the comparison
  // window (the same window the delta and "since {date}" caption use). A streak
  // hint is appended only when notable, in the SAME shape each time.
  const hits = positive ? stats.up : stats.down;
  const streak = positive ? stats.streakUp : stats.streakDown;
  const arrow = positive ? "▲" : "▼";
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] muted-text tabular-nums">
      <span>{arrow} {hits}/{stats.transitions} wks {positive ? "up" : "down"}</span>
      {streak >= 3 && <span title={`On a ${streak}-week ${positive ? "rising" : "falling"} streak`}>· {streak}-wk streak</span>}
      {clusterAdj != null && (
        <span
          title="Composite change vs the stock's peer-cluster average over the same window — strips out the broad price move."
          style={{ color: clusterAdj >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)" }}
        >
          · vs peers {clusterAdj >= 0 ? "+" : ""}{Math.round(clusterAdj)}
        </span>
      )}
    </span>
  );
}

function MoverList({ label, rows, positive }: { label: string; rows: ScoreMover[]; positive: boolean }) {
  if (rows.length === 0) return null;
  const color = positive ? "var(--color-score-good)" : "var(--color-score-poor)";
  const Arrow = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color }}>{label}</span>
        <span className="text-[10px] muted-text tabular-nums">{rows.length}</span>
      </div>
      <ul className="space-y-1">
        {rows.map((m) => (
          <li key={m.symbol} className="flex items-center gap-1">
            <Link href={`/stock/${m.symbol}`}
                  className="block min-w-0 flex-1 py-0.5 hover:opacity-80 transition-opacity">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[12px] tabular-nums truncate min-w-0 flex-1">{m.symbol}</span>
                <Sparkline data={m.trail} overlay={m.peerTrail} width={54} height={16} stroke={bandColor(band(m.now))} />
                <span className="flex items-center gap-1 tabular-nums text-[11px] shrink-0">
                  <span className="muted-text">{Math.round(m.then)}</span>
                  <span className="muted-text" style={{ fontSize: 9 }}>→</span>
                  <span className="font-semibold" style={{ color: bandColor(band(m.now)) }}>
                    {Math.round(m.now)}
                  </span>
                  <span className="inline-flex items-center font-semibold ml-0.5" style={{ color }}>
                    <Arrow size={10} strokeWidth={2.6} />
                    {m.delta >= 0 ? "+" : ""}{Math.round(m.delta)}
                  </span>
                </span>
              </div>
              <div className="mt-0.5">
                <TrendBadges stats={m.stats} clusterAdj={m.clusterAdj} positive={positive} />
              </div>
            </Link>
            <WatchlistButton symbol={m.symbol} variant="icon" className="shrink-0" />
          </li>
        ))}
      </ul>
    </div>
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

function TierEmptyBanner({ label }: { label: string }) {
  return (
    <div className="card p-8 mt-8 text-[13px] leading-[1.6]">
      <div className="font-display text-[17px] mb-2">{label} not yet seeded</div>
      <p className="muted-text">
        No scored stocks are in <span className="font-medium">{label}</span> in this environment&apos;s{" "}
        <code className="font-mono">app.index_constituent</code>. Run{" "}
        <code className="font-mono">scripts/fetch-index-constituents.py</code> to populate it, or switch to{" "}
        <Link href="/ideas?idx=all" className="text-[var(--color-accent-700)] underline">All</Link>.
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
        {snapshotsHave} weekly snapshot{snapshotsHave === 1 ? "" : "s"} so far. Ideas compare
        over the <em>full available history</em> (up to ~12 weeks once we have it); with only a
        few snapshots, the trail is short so noise is higher.
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
          <li key={s.symbol} className="flex items-stretch">
            <div className="min-w-0 flex-1">
              <Row stock={s} rank={i + 1} section={section} />
            </div>
            <div className="flex items-center pr-3 shrink-0">
              <WatchlistButton symbol={s.symbol} variant="icon" />
            </div>
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
  // Continuity/peer badges only make sense for the trend buckets (the themed
  // buckets — compounder/cheap/promoter/fii — are level-based, not trend-based).
  const isTrendSection =
    section === "strength" || section === "losing" ||
    section === "breakout" || section === "breakdown";

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
          {stock.oiAlert && (
            <div
              className="inline-flex items-center gap-1 mt-1.5 ml-[22px] text-[10.5px] font-medium rounded px-1.5 py-0.5"
              style={{ background: "color-mix(in srgb, #b45309 12%, transparent)", color: "#92400e" }}
            >
              <AlertTriangle size={10} strokeWidth={2.4} />
              Score may include one-time income
            </div>
          )}
        </div>

        {/* Right: sparkline (with peer overlay) + score delta + trend badges */}
        <div className="shrink-0 flex flex-col items-end gap-1">
          <Sparkline
            data={stock.trail}
            overlay={stock.peerTrail}
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
          {isTrendSection && (
            <TrendBadges stats={stock.stats} clusterAdj={stock.clusterAdj} positive={!isNegative} />
          )}
        </div>
      </div>
    </Link>
  );
}
