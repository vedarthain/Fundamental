/**
 * /api/market/overview — public market snapshot for the /market page.
 *
 * Single endpoint returning everything the public top-of-page needs:
 *   - indices: today's close, %change, 1W/1M/1Y returns for each tracked index
 *   - movers:  top 10 gainers + top 10 losers over the last 1 week, with
 *              cluster + quality context (the cluster-aware diff vs every
 *              other Indian market page)
 *   - advanceDecline: today's count of stocks up vs flat vs down (1W basis)
 *   - sectorHeat: per-sector aggregate 1W move, for the heatmap
 *   - fii: latest FII/DII numbers + a 30-day series for the trend chart
 *   - snapshotDate / ltpDate / fiiDate for the freshness label
 *
 * One round-trip keeps the page fast and the cache key simple.  All
 * queries are indexed reads from materialised caches or the small new
 * tables; wrapped in unstable_cache with a 1-hour TTL.
 *
 * Cost (Rule #1): ~6 cheap queries, executed in parallel, ~30 KB JSON.
 */
import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { sql, golden } from "@/lib/db";
import { upcomingHolidays } from "@/lib/nse-holidays";

export const runtime = "nodejs";

// ── Shapes returned to the client ──────────────────────────────────────────

export type IndexRow = {
  code: string;
  name: string;
  close: number;
  pct_change_1d: number | null;
  pct_change_1w: number | null;
  pct_change_1m: number | null;
  pct_change_1y: number | null;
  date: string;
  /** Last ~90 daily closes for the sparkline. Newest last. */
  sparkline: { date: string; close: number }[];
};

export type IndexSeriesPoint = { date: string; close: number };

export type Mover = {
  symbol: string;
  company_name: string | null;
  sector_name: string | null;
  industry_name: string | null;
  current_price: number | null;
  market_cap_cr: number | null;
  /** Period return as a fraction (e.g. 0.045 = +4.5%). Period is whichever
   *  bucket the row was loaded for; the same shape covers 1D and 1W. */
  ret: number | null;
  composite_pct: number | null;
  quality_pct: number | null;
  maturity_tier: string | null;
};

export type SectorHeatRow = {
  sector_name: string;
  industry_count: number;
  stocks_count: number;
  avg_ret_1d: number | null;
  avg_ret_1w: number | null;
  avg_composite_pct: number | null;
};

export type AdvanceDeclineSet = { up: number; flat: number; down: number };

export type FiiPoint = {
  date: string;
  fii_net: number | null;
  dii_net: number | null;
};

export type WeekRangeStat = {
  at_high: number;       // close within 0.5% of 52W high
  at_low: number;        // close within 0.5% of 52W low
  near_high: number;     // close within 5% of 52W high (excluding at_high)
  near_low: number;      // close within 5% of 52W low  (excluding at_low)
  total: number;
};

export type HolidayItem = { date: string; name: string };

/** Universe codes for the movers filter. FULL = no universe restriction. */
export type MoverUniverse = "NIFTY50" | "NIFTY200" | "FULL";

export type OverviewResponse = {
  indices: IndexRow[];
  /** Full 1Y daily series for the headline charts. Keyed by index_code. */
  heroSeries: Record<string, IndexSeriesPoint[]>;
  /** Top gainers / losers in two timeframes × three universes.  Client
   *  switches the visible set with two small toggles per card. */
  movers: Record<MoverUniverse, {
    "1D": { up: Mover[]; down: Mover[] };
    "1W": { up: Mover[]; down: Mover[] };
  }>;
  /** A/D in both 1D (golden close-vs-prev) and 1W (panel ret_1w). */
  advanceDecline: { "1D": AdvanceDeclineSet; "1W": AdvanceDeclineSet };
  weekRange: WeekRangeStat;
  sectorHeat: SectorHeatRow[];
  fii: {
    latest: { date: string; fii_net: number | null; dii_net: number | null } | null;
    series: FiiPoint[];
  };
  holidays: HolidayItem[];
  snapshotDate: string | null;
  ltpDate: string | null;
};

// ── Data loaders ───────────────────────────────────────────────────────────

async function loadSparklines(): Promise<Map<string, IndexSeriesPoint[]>> {
  // 90 trading days per index, newest LAST so the sparkline renders
  // left-to-right chronologically without a client reverse.
  const rows = await sql<{ index_code: string; date: string; close: number }[]>`
    WITH ranked AS (
      SELECT index_code, date::text AS date, close::float AS close,
             ROW_NUMBER() OVER (PARTITION BY index_code ORDER BY date DESC) AS rn
        FROM app.market_index_history
    )
    SELECT index_code, date, close
      FROM ranked
     WHERE rn <= 90
     ORDER BY index_code, date
  `;
  const out = new Map<string, IndexSeriesPoint[]>();
  for (const r of rows) {
    const arr = out.get(r.index_code) ?? [];
    arr.push({ date: r.date, close: r.close });
    out.set(r.index_code, arr);
  }
  return out;
}

/** Hero charts get a 1Y series each. List intentionally small (2-3 indices
 *  at most) — we don't want to balloon JSON size for indices that already
 *  have a 90-day sparkline. */
const HERO_INDEX_CODES = ["NIFTY50", "NIFTYBANK"] as const;

async function loadHeroSeries(): Promise<Record<string, IndexSeriesPoint[]>> {
  const rows = await sql<{ index_code: string; date: string; close: number }[]>`
    SELECT index_code, date::text AS date, close::float AS close
      FROM app.market_index_history
     WHERE index_code = ANY(${[...HERO_INDEX_CODES]})
     ORDER BY index_code, date
  `;
  const out: Record<string, IndexSeriesPoint[]> = {};
  for (const r of rows) {
    (out[r.index_code] ??= []).push({ date: r.date, close: r.close });
  }
  return out;
}

async function loadIndices(): Promise<IndexRow[]> {
  // For each index: latest close + 1d/1w/1m/1y returns computed by
  // joining to the close from N trading days back. Done with self-LEFT
  // JOINs so a missing prior date returns NULL instead of dropping the
  // row.
  //
  // Trading days are approximated as 5 calendar days for 1W, 22 for 1M,
  // 252 for 1Y — close enough for a leaderboard. Exact match using
  // window functions is possible but adds complexity for a card that's
  // tolerant of a few-percent fuzziness.
  // Sparklines fetched in parallel and attached below.
  const indexRows = await sql<Omit<IndexRow, "sparkline">[]>`
    WITH latest_date AS (
      SELECT MAX(date) AS d FROM app.market_index_history
    ),
    today AS (
      SELECT h.index_code, h.display_name AS name, h.close::float, h.date::text, h.pct_change::float AS pct_change_1d
        FROM app.market_index_history h
        JOIN latest_date l ON l.d = h.date
    )
    SELECT t.index_code AS code,
           t.name,
           t.close,
           t.pct_change_1d,
           CASE WHEN w.close > 0 THEN ((t.close - w.close::float) / w.close::float * 100)::float ELSE NULL END AS pct_change_1w,
           CASE WHEN m.close > 0 THEN ((t.close - m.close::float) / m.close::float * 100)::float ELSE NULL END AS pct_change_1m,
           CASE WHEN y.close > 0 THEN ((t.close - y.close::float) / y.close::float * 100)::float ELSE NULL END AS pct_change_1y,
           t.date
      FROM today t
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history h2
         WHERE h2.index_code = t.index_code AND h2.date <= (t.date::date - INTERVAL '7 days')
         ORDER BY h2.date DESC LIMIT 1
      ) w ON TRUE
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history h2
         WHERE h2.index_code = t.index_code AND h2.date <= (t.date::date - INTERVAL '30 days')
         ORDER BY h2.date DESC LIMIT 1
      ) m ON TRUE
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history h2
         WHERE h2.index_code = t.index_code AND h2.date <= (t.date::date - INTERVAL '365 days')
         ORDER BY h2.date DESC LIMIT 1
      ) y ON TRUE
     ORDER BY
       -- Headline indices first, then sectoral.
       CASE t.index_code
         WHEN 'NIFTY50' THEN 0
         WHEN 'NIFTYBANK' THEN 1
         WHEN 'NIFTYMIDCAP100' THEN 2
         WHEN 'NIFTYSMALLCAP100' THEN 3
         WHEN 'NIFTYNEXT50' THEN 4
         WHEN 'NIFTY100' THEN 5
         WHEN 'NIFTY500' THEN 6
         ELSE 100
       END,
       t.name
  `;
  // Attach sparklines.
  const sparks = await loadSparklines();
  return indexRows.map((r) => ({ ...r, sparkline: sparks.get(r.code) ?? [] }));
}

// ---------------------------------------------------------------------------
// Mover pool loaders — pull the top N (~300) movers per period × direction
// with universe membership flags attached, then partition into the three
// universe buckets in Node. Trades 12 small SQL queries for 4 slightly
// larger ones, which is a net latency win because each query carries its
// own roundtrip + planner overhead.
// ---------------------------------------------------------------------------

type MoverWithFlags = Mover & { is_nifty50: boolean; is_nifty200: boolean };

async function loadMovers1WPool(direction: "up" | "down", limit: number): Promise<MoverWithFlags[]> {
  if (direction === "up") {
    return sql<MoverWithFlags[]>`
      SELECT
        c.symbol, c.company_name,
        mc.name AS sector_name, cl.name AS industry_name,
        c.current_price::float AS current_price,
        c.market_cap_cr::float AS market_cap_cr,
        c.ret_1w::float        AS ret,
        c.composite_pct::float AS composite_pct,
        c.quality_pct::float   AS quality_pct,
        c.maturity_tier,
        COALESCE(u.is_nifty50,  false) AS is_nifty50,
        COALESCE(u.is_nifty200, false) AS is_nifty200
      FROM app.cluster_stocks_panel_cache c
      JOIN app.cluster cl       ON cl.id = c.cluster_id
      JOIN app.meta_cluster mc  ON mc.id = cl.meta_cluster_id
      LEFT JOIN app.universe u  ON u.symbol = c.symbol
      WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
        AND c.ret_1w IS NOT NULL
        AND c.market_cap_cr >= 500
      ORDER BY c.ret_1w DESC
      LIMIT ${limit}
    `;
  }
  return sql<MoverWithFlags[]>`
    SELECT
      c.symbol, c.company_name,
      mc.name AS sector_name, cl.name AS industry_name,
      c.current_price::float AS current_price,
      c.market_cap_cr::float AS market_cap_cr,
      c.ret_1w::float        AS ret,
      c.composite_pct::float AS composite_pct,
      c.quality_pct::float   AS quality_pct,
      c.maturity_tier,
      COALESCE(u.is_nifty50,  false) AS is_nifty50,
      COALESCE(u.is_nifty200, false) AS is_nifty200
    FROM app.cluster_stocks_panel_cache c
    JOIN app.cluster cl       ON cl.id = c.cluster_id
    JOIN app.meta_cluster mc  ON mc.id = cl.meta_cluster_id
    LEFT JOIN app.universe u  ON u.symbol = c.symbol
    WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
      AND c.ret_1w IS NOT NULL
      AND c.market_cap_cr >= 500
    ORDER BY c.ret_1w ASC
    LIMIT ${limit}
  `;
}

/**
 * Loads ALL active panel-cache rows with universe flags in a single
 * query.  Used by deriveMovers1DPool to look up cluster + quality +
 * universe context for the top movers without firing a per-symbol
 * IN clause.  ~2,150 rows; ~150 KB; one indexed scan.
 */
async function loadAllPanelContext(): Promise<Map<string, MoverWithFlags>> {
  const rows = await sql<MoverWithFlags[]>`
    SELECT
      c.symbol,
      c.company_name,
      mc.name AS sector_name,
      cl.name AS industry_name,
      c.current_price::float AS current_price,
      c.market_cap_cr::float AS market_cap_cr,
      0::float               AS ret,
      c.composite_pct::float AS composite_pct,
      c.quality_pct::float   AS quality_pct,
      c.maturity_tier,
      COALESCE(u.is_nifty50,  false) AS is_nifty50,
      COALESCE(u.is_nifty200, false) AS is_nifty200
    FROM app.cluster_stocks_panel_cache c
    JOIN app.cluster cl      ON cl.id = c.cluster_id
    JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
    LEFT JOIN app.universe u ON u.symbol = c.symbol
    WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
      AND c.market_cap_cr >= 500
  `;
  return new Map(rows.map((r) => [r.symbol, r]));
}

/**
 * Derive 1D mover pool from the consolidated snapshot — no DB hit.
 * Sorts symbols by pct_1d, slices top `limit`, joins each with the
 * panel-cache context map.
 */
/** |1D| return beyond this (fraction) is treated as a data artifact and kept
 *  out of the movers leaderboards. See scripts/build-market-snapshot.py. */
const MAX_PLAUSIBLE_1D_RET = 0.25;

function deriveMovers1DPool(
  direction: "up" | "down",
  limit: number,
  snap: Map<string, GoldenSnap>,
  panelCtx: Map<string, MoverWithFlags>,
): MoverWithFlags[] {
  // Build (symbol, pct) pairs filtered to symbols with both a 1D move
  // AND panel context (market_cap_cr >= 500 etc.).
  const candidates: Array<{ symbol: string; pct: number; today_close: number }> = [];
  for (const [sym, s] of snap) {
    if (s.pct_1d == null) continue;
    if (!panelCtx.has(sym)) continue;  // drops micro-caps + delisted
    // Guard: |1D| beyond ~25% is implausible (NSE circuit bands cap legit
    // daily moves at ~20%) — almost always an unadjusted corp action / bad
    // golden tick. Drop it so the board never shows e.g. "TRENT -33.4% 1D".
    // Mirrors MAX_PLAUSIBLE_1D in scripts/build-market-snapshot.py.
    if (Math.abs(s.pct_1d) > MAX_PLAUSIBLE_1D_RET) continue;
    candidates.push({ symbol: sym, pct: s.pct_1d, today_close: s.today_close });
  }
  candidates.sort((a, b) =>
    direction === "up" ? b.pct - a.pct : a.pct - b.pct,
  );

  const out: MoverWithFlags[] = [];
  for (const c of candidates) {
    if (out.length >= limit) break;
    const ctx = panelCtx.get(c.symbol);
    if (!ctx) continue;
    out.push({
      ...ctx,
      current_price: ctx.current_price ?? c.today_close,
      ret: c.pct,
    });
  }
  return out;
}

/** Slice the four mover pools into 3 universes × 2 periods × 2 directions
 *  × top N. Pure JS — no DB roundtrips. */
function sliceMovers({
  pool1WUp, pool1WDown, pool1DUp, pool1DDown, limit,
}: {
  pool1WUp: MoverWithFlags[];
  pool1WDown: MoverWithFlags[];
  pool1DUp: MoverWithFlags[];
  pool1DDown: MoverWithFlags[];
  limit: number;
}): OverviewResponse["movers"] {
  const strip = (rows: MoverWithFlags[]): Mover[] =>
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rows.map(({ is_nifty50, is_nifty200, ...m }) => m);

  const pick = (rows: MoverWithFlags[], universe: MoverUniverse): Mover[] => {
    const filtered = universe === "NIFTY50"
      ? rows.filter((r) => r.is_nifty50)
      : universe === "NIFTY200"
        ? rows.filter((r) => r.is_nifty200)
        : rows;
    return strip(filtered.slice(0, limit));
  };

  const out = {} as OverviewResponse["movers"];
  for (const u of ["NIFTY50", "NIFTY200", "FULL"] as MoverUniverse[]) {
    out[u] = {
      "1D": { up: pick(pool1DUp, u), down: pick(pool1DDown, u) },
      "1W": { up: pick(pool1WUp, u), down: pick(pool1WDown, u) },
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Legacy per-universe loaders kept below; no longer called by loadOverview()
// but preserved in case we add per-universe live filtering later.
// ---------------------------------------------------------------------------

async function loadMovers1W(
  direction: "up" | "down",
  universe: MoverUniverse,
  limit: number,
): Promise<Mover[]> {
  // 1W movers from the materialised panel cache.  Universe filter via
  // join to app.universe — three variants because the membership column
  // varies. Postgres.js's tagged templates can't safely template a
  // column NAME, so we branch the SQL instead of trying to interpolate.
  //
  // Both sort directions share the same shape; only the ORDER BY flips.
  const orderDir = direction === "up" ? "DESC" : "ASC";
  if (universe === "NIFTY50") {
    return direction === "up"
      ? sql<Mover[]>`
          SELECT
            c.symbol, c.company_name, mc.name AS sector_name, cl.name AS industry_name,
            c.current_price::float AS current_price,
            c.market_cap_cr::float AS market_cap_cr,
            c.ret_1w::float        AS ret,
            c.composite_pct::float AS composite_pct,
            c.quality_pct::float   AS quality_pct,
            c.maturity_tier
          FROM app.cluster_stocks_panel_cache c
          JOIN app.cluster cl       ON cl.id = c.cluster_id
          JOIN app.meta_cluster mc  ON mc.id = cl.meta_cluster_id
          JOIN app.universe u       ON u.symbol = c.symbol AND u.is_nifty50
          WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
            AND c.ret_1w IS NOT NULL
          ORDER BY c.ret_1w DESC
          LIMIT ${limit}
        `
      : sql<Mover[]>`
          SELECT
            c.symbol, c.company_name, mc.name AS sector_name, cl.name AS industry_name,
            c.current_price::float AS current_price,
            c.market_cap_cr::float AS market_cap_cr,
            c.ret_1w::float        AS ret,
            c.composite_pct::float AS composite_pct,
            c.quality_pct::float   AS quality_pct,
            c.maturity_tier
          FROM app.cluster_stocks_panel_cache c
          JOIN app.cluster cl       ON cl.id = c.cluster_id
          JOIN app.meta_cluster mc  ON mc.id = cl.meta_cluster_id
          JOIN app.universe u       ON u.symbol = c.symbol AND u.is_nifty50
          WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
            AND c.ret_1w IS NOT NULL
          ORDER BY c.ret_1w ASC
          LIMIT ${limit}
        `;
  }
  if (universe === "NIFTY200") {
    return direction === "up"
      ? sql<Mover[]>`
          SELECT
            c.symbol, c.company_name, mc.name AS sector_name, cl.name AS industry_name,
            c.current_price::float AS current_price,
            c.market_cap_cr::float AS market_cap_cr,
            c.ret_1w::float        AS ret,
            c.composite_pct::float AS composite_pct,
            c.quality_pct::float   AS quality_pct,
            c.maturity_tier
          FROM app.cluster_stocks_panel_cache c
          JOIN app.cluster cl       ON cl.id = c.cluster_id
          JOIN app.meta_cluster mc  ON mc.id = cl.meta_cluster_id
          JOIN app.universe u       ON u.symbol = c.symbol AND u.is_nifty200
          WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
            AND c.ret_1w IS NOT NULL
          ORDER BY c.ret_1w DESC
          LIMIT ${limit}
        `
      : sql<Mover[]>`
          SELECT
            c.symbol, c.company_name, mc.name AS sector_name, cl.name AS industry_name,
            c.current_price::float AS current_price,
            c.market_cap_cr::float AS market_cap_cr,
            c.ret_1w::float        AS ret,
            c.composite_pct::float AS composite_pct,
            c.quality_pct::float   AS quality_pct,
            c.maturity_tier
          FROM app.cluster_stocks_panel_cache c
          JOIN app.cluster cl       ON cl.id = c.cluster_id
          JOIN app.meta_cluster mc  ON mc.id = cl.meta_cluster_id
          JOIN app.universe u       ON u.symbol = c.symbol AND u.is_nifty200
          WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
            AND c.ret_1w IS NOT NULL
          ORDER BY c.ret_1w ASC
          LIMIT ${limit}
        `;
  }
  // FULL — same query without a universe join. Market-cap floor stays to
  // dampen micro-cap noise.
  void orderDir; // referenced only for documentation; we branch on direction explicitly above
  return direction === "up"
    ? sql<Mover[]>`
        SELECT
          c.symbol, c.company_name, mc.name AS sector_name, cl.name AS industry_name,
          c.current_price::float AS current_price,
          c.market_cap_cr::float AS market_cap_cr,
          c.ret_1w::float        AS ret,
          c.composite_pct::float AS composite_pct,
          c.quality_pct::float   AS quality_pct,
          c.maturity_tier
        FROM app.cluster_stocks_panel_cache c
        JOIN app.cluster cl       ON cl.id = c.cluster_id
        JOIN app.meta_cluster mc  ON mc.id = cl.meta_cluster_id
        WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
          AND c.ret_1w IS NOT NULL
          AND c.market_cap_cr >= 500
        ORDER BY c.ret_1w DESC
        LIMIT ${limit}
      `
    : sql<Mover[]>`
        SELECT
          c.symbol, c.company_name, mc.name AS sector_name, cl.name AS industry_name,
          c.current_price::float AS current_price,
          c.market_cap_cr::float AS market_cap_cr,
          c.ret_1w::float        AS ret,
          c.composite_pct::float AS composite_pct,
          c.quality_pct::float   AS quality_pct,
          c.maturity_tier
        FROM app.cluster_stocks_panel_cache c
        JOIN app.cluster cl       ON cl.id = c.cluster_id
        JOIN app.meta_cluster mc  ON mc.id = cl.meta_cluster_id
        WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
          AND c.ret_1w IS NOT NULL
          AND c.market_cap_cr >= 500
        ORDER BY c.ret_1w ASC
        LIMIT ${limit}
      `;
}

async function loadMovers1D(
  direction: "up" | "down",
  universe: MoverUniverse,
  limit: number,
): Promise<Mover[]> {
  // 1D crosses two DBs (golden has prices, app has universe + cluster
  // context). Strategy:
  //   1. Pull the universe's symbol list from app first (cheap — at most
  //      ~2,150 rows for FULL, 200 for NIFTY200, 50 for NIFTY50).
  //   2. Ask golden for close-vs-prev moves restricted to those symbols.
  //      This guarantees the SQL ORDER BY is computing the top mover
  //      WITHIN the universe, not slicing the universe out of a
  //      whole-market top list (which was the previous bug — NIFTY 50
  //      gainers came back as 1-2 rows because few Nifty 50 names were
  //      in the all-market top 250).
  //   3. Pull cluster/quality context from app for the surviving symbols.

  const universeSymbols = await sql<{ symbol: string }[]>`
    SELECT u.symbol
      FROM app.universe u
     WHERE u.is_active
       AND ${
         universe === "NIFTY50"
           ? sql`u.is_nifty50`
           : universe === "NIFTY200"
             ? sql`u.is_nifty200`
             : sql`TRUE`
       }
  `;
  if (universeSymbols.length === 0) return [];
  const symList = universeSymbols.map((r) => r.symbol);

  // golden uses 'SBIN.NS' format; we compare on stripped REPLACE(..., '.NS').
  // Direction flips ORDER BY only.
  const moves = direction === "up"
    ? await golden<{ symbol: string; today_close: number; prev_close: number; pct: number }[]>`
        WITH bounds AS (
          SELECT date AS latest FROM golden.price_history WHERE interval='1d'
           ORDER BY date DESC LIMIT 1
        ),
        prev AS (
          SELECT MAX(date) AS d FROM golden.price_history
           WHERE interval='1d' AND date < (SELECT latest FROM bounds)
        ),
        today_close AS (
          SELECT REPLACE(symbol, '.NS', '') AS symbol, close
            FROM golden.price_history, bounds
           WHERE interval='1d' AND date = bounds.latest
             AND REPLACE(symbol, '.NS', '') = ANY(${symList})
        ),
        prev_close AS (
          SELECT REPLACE(symbol, '.NS', '') AS symbol, close
            FROM golden.price_history, prev
           WHERE interval='1d' AND date = prev.d
             AND REPLACE(symbol, '.NS', '') = ANY(${symList})
        )
        SELECT t.symbol, t.close AS today_close, p.close AS prev_close,
               ((t.close - p.close) / NULLIF(p.close, 0))::float AS pct
          FROM today_close t
          JOIN prev_close p ON p.symbol = t.symbol
         WHERE p.close > 0
         ORDER BY pct DESC NULLS LAST
         LIMIT ${limit * 3}
      `
    : await golden<{ symbol: string; today_close: number; prev_close: number; pct: number }[]>`
        WITH bounds AS (
          SELECT date AS latest FROM golden.price_history WHERE interval='1d'
           ORDER BY date DESC LIMIT 1
        ),
        prev AS (
          SELECT MAX(date) AS d FROM golden.price_history
           WHERE interval='1d' AND date < (SELECT latest FROM bounds)
        ),
        today_close AS (
          SELECT REPLACE(symbol, '.NS', '') AS symbol, close
            FROM golden.price_history, bounds
           WHERE interval='1d' AND date = bounds.latest
             AND REPLACE(symbol, '.NS', '') = ANY(${symList})
        ),
        prev_close AS (
          SELECT REPLACE(symbol, '.NS', '') AS symbol, close
            FROM golden.price_history, prev
           WHERE interval='1d' AND date = prev.d
             AND REPLACE(symbol, '.NS', '') = ANY(${symList})
        )
        SELECT t.symbol, t.close AS today_close, p.close AS prev_close,
               ((t.close - p.close) / NULLIF(p.close, 0))::float AS pct
          FROM today_close t
          JOIN prev_close p ON p.symbol = t.symbol
         WHERE p.close > 0
         ORDER BY pct ASC NULLS LAST
         LIMIT ${limit * 3}
      `;

  if (moves.length === 0) return [];

  // Fetch panel-cache context + universe membership flags for these
  // symbols so we can filter to the requested universe in Node land
  // (cheaper than another DB roundtrip per universe).
  const symbols = moves.map((m) => m.symbol);
  const context = await sql<{
    symbol: string;
    company_name: string | null;
    sector_name: string | null;
    industry_name: string | null;
    current_price: number | null;
    market_cap_cr: number | null;
    composite_pct: number | null;
    quality_pct: number | null;
    maturity_tier: string | null;
    is_nifty50: boolean;
    is_nifty200: boolean;
  }[]>`
    SELECT
      c.symbol,
      c.company_name,
      mc.name AS sector_name,
      cl.name AS industry_name,
      c.current_price::float AS current_price,
      c.market_cap_cr::float AS market_cap_cr,
      c.composite_pct::float AS composite_pct,
      c.quality_pct::float   AS quality_pct,
      c.maturity_tier,
      COALESCE(u.is_nifty50,  false) AS is_nifty50,
      COALESCE(u.is_nifty200, false) AS is_nifty200
    FROM app.cluster_stocks_panel_cache c
    JOIN app.cluster cl      ON cl.id = c.cluster_id
    JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
    LEFT JOIN app.universe u ON u.symbol = c.symbol
    WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
      AND c.symbol = ANY(${symbols})
      AND c.market_cap_cr >= 500
  `;
  const ctxBySym = new Map(context.map((c) => [c.symbol, c]));

  // Merge in the same order we sorted by pct.  Universe filter already
  // happened at the SQL level (symList ANY clause), so we only drop
  // symbols missing panel context (extremely rare — typically a fresh
  // listing not yet in cluster_stocks_panel_cache).
  const out: Mover[] = [];
  for (const m of moves) {
    const c = ctxBySym.get(m.symbol);
    if (!c) continue;
    out.push({
      symbol:        m.symbol,
      company_name:  c.company_name,
      sector_name:   c.sector_name,
      industry_name: c.industry_name,
      current_price: c.current_price ?? m.today_close,
      market_cap_cr: c.market_cap_cr,
      ret:           m.pct,
      composite_pct: c.composite_pct,
      quality_pct:   c.quality_pct,
      maturity_tier: c.maturity_tier,
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function loadAdvanceDecline1W(): Promise<AdvanceDeclineSet> {
  // 1W: ret_1w is a fraction in the cache (0.012 = 1.2%). Flat band ±0.5%.
  const rows = await sql<{ direction: string; n: number }[]>`
    SELECT CASE
             WHEN ret_1w >  0.005 THEN 'up'
             WHEN ret_1w < -0.005 THEN 'down'
             ELSE 'flat'
           END AS direction,
           COUNT(*)::int AS n
      FROM app.cluster_stocks_panel_cache
     WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
       AND ret_1w IS NOT NULL
     GROUP BY 1
  `;
  const mut: AdvanceDeclineSet = { up: 0, flat: 0, down: 0 };
  for (const r of rows) {
    if (r.direction === "up") mut.up = r.n;
    else if (r.direction === "down") mut.down = r.n;
    else mut.flat = r.n;
  }
  return mut;
}

/**
 * Consolidated golden snapshot — ONE query that returns
 * (symbol, today_close, prev_close, pct_1d, hi_52w, lo_52w) for every
 * actively-traded symbol.  All the per-symbol 1D + 52W derivations
 * (movers, A/D, sector heat, range bands) consume this in Node instead
 * of running their own golden scan.
 *
 * Replaces 4 separate golden queries (each with its own multi-CTE
 * setup) → 1 query.  On a cold Neon compute this is the difference
 * between ~15s and ~2s end-to-end.
 */
type GoldenSnap = {
  today_close: number;
  prev_close: number | null;
  pct_1d: number | null;
  hi_52w: number | null;
  lo_52w: number | null;
};

async function loadGoldenSnapshot(): Promise<Map<string, GoldenSnap>> {
  const rows = await golden<{
    symbol: string;
    today_close: number;
    prev_close: number | null;
    pct_1d: number | null;
    hi_52w: number | null;
    lo_52w: number | null;
  }[]>`
    WITH bounds AS (
      SELECT date AS latest FROM golden.price_history WHERE interval='1d'
       ORDER BY date DESC LIMIT 1
    ),
    prev AS (
      SELECT MAX(date) AS d FROM golden.price_history
       WHERE interval='1d' AND date < (SELECT latest FROM bounds)
    ),
    horizon AS (
      SELECT (SELECT latest FROM bounds) - INTERVAL '370 days' AS cutoff
    ),
    yearly AS (
      SELECT REPLACE(p.symbol, '.NS', '') AS symbol,
             MAX(p.close) AS hi, MIN(p.close) AS lo
        FROM golden.price_history p, horizon h
       WHERE p.interval = '1d' AND p.date >= h.cutoff
       GROUP BY 1
    ),
    today_close AS (
      SELECT REPLACE(symbol, '.NS', '') AS symbol, close
        FROM golden.price_history, bounds
       WHERE interval = '1d' AND date = bounds.latest
    ),
    prev_close AS (
      SELECT REPLACE(symbol, '.NS', '') AS symbol, close
        FROM golden.price_history, prev
       WHERE interval = '1d' AND date = prev.d
    )
    SELECT
      t.symbol,
      t.close::float                                        AS today_close,
      p.close::float                                        AS prev_close,
      CASE
        WHEN p.close IS NOT NULL AND p.close > 0
          THEN ((t.close - p.close) / p.close)::float
        ELSE NULL
      END                                                    AS pct_1d,
      y.hi::float                                            AS hi_52w,
      y.lo::float                                            AS lo_52w
    FROM today_close t
    LEFT JOIN prev_close p ON p.symbol = t.symbol
    LEFT JOIN yearly y     ON y.symbol = t.symbol
  `;
  const out = new Map<string, GoldenSnap>();
  for (const r of rows) {
    out.set(r.symbol, {
      today_close: r.today_close,
      prev_close:  r.prev_close,
      pct_1d:      r.pct_1d,
      hi_52w:      r.hi_52w,
      lo_52w:      r.lo_52w,
    });
  }
  return out;
}

function deriveAdvanceDecline1D(snap: Map<string, GoldenSnap>): AdvanceDeclineSet {
  // Flat band ±0.5%, same as the 1W variant.  Pure JS — no DB hit.
  const mut: AdvanceDeclineSet = { up: 0, flat: 0, down: 0 };
  for (const s of snap.values()) {
    if (s.pct_1d == null) continue;
    if (s.pct_1d >  0.005) mut.up++;
    else if (s.pct_1d < -0.005) mut.down++;
    else mut.flat++;
  }
  return mut;
}

async function loadSectorHeat1W(): Promise<{
  sector_name: string;
  display_order: number;
  industry_count: number;
  stocks_count: number;
  avg_ret_1w: number | null;
  avg_composite_pct: number | null;
}[]> {
  return sql<{
    sector_name: string;
    display_order: number;
    industry_count: number;
    stocks_count: number;
    avg_ret_1w: number | null;
    avg_composite_pct: number | null;
  }[]>`
    SELECT
      mc.name AS sector_name,
      mc.display_order,
      COUNT(DISTINCT c.cluster_id)::int AS industry_count,
      COUNT(c.symbol)::int              AS stocks_count,
      -- Cap-weighted 1W return (Σ(ret·cap)/Σ(cap), micro-caps < ₹500cr
      -- dropped) so the heatmap's 1W view matches its cap-weighted 1D view
      -- and the live sector-live aggregation. NULLIF guards a zero-weight
      -- sector. Composite stays an equal-weight percentile mean.
      (SUM(c.ret_1w * c.market_cap_cr) FILTER (WHERE c.market_cap_cr >= 500)
       / NULLIF(SUM(c.market_cap_cr) FILTER (WHERE c.market_cap_cr >= 500), 0))::float AS avg_ret_1w,
      AVG(c.composite_pct)::float       AS avg_composite_pct
    FROM app.cluster_stocks_panel_cache c
    JOIN app.cluster cl      ON cl.id = c.cluster_id
    JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
    WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
      AND c.ret_1w IS NOT NULL
    GROUP BY mc.name, mc.display_order
    ORDER BY mc.display_order, mc.name
  `;
}

async function loadSectorMap(): Promise<Map<string, { sector: string; cap: number | null }>> {
  // sector + (snapshot) market cap per symbol. Cap is the weight used to
  // cap-weight the EOD sector-heat fallback, so it stays consistent with the
  // live /api/market/sector-live aggregation (also cap-weighted).
  const rows = await sql<{ symbol: string; sector_name: string; market_cap_cr: number | null }[]>`
    SELECT c.symbol, mc.name AS sector_name, c.market_cap_cr::float AS market_cap_cr
      FROM app.cluster_stocks_panel_cache c
      JOIN app.cluster cl      ON cl.id = c.cluster_id
      JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
     WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
  `;
  return new Map(rows.map((r) => [r.symbol, { sector: r.sector_name, cap: r.market_cap_cr }]));
}

function deriveSectorHeat(
  oneWeek: Awaited<ReturnType<typeof loadSectorHeat1W>>,
  snap: Map<string, GoldenSnap>,
  sectorBySym: Map<string, { sector: string; cap: number | null }>,
): SectorHeatRow[] {
  // CAP-WEIGHTED 1D move per sector from the snapshot — mirrors the live
  // /api/market/sector-live aggregation so the heatmap doesn't switch methods
  // between its live value and this EOD fallback. sector_ret = Σ(cap·ret)/Σ(cap),
  // micro-caps (< ₹500cr) dropped. Falls back to NULL when a sector has no
  // weight (no qualifying caps).
  const MIN_CAP_CR = 500;
  const agg1D = new Map<string, { weighted: number; weight: number }>();
  for (const [sym, s] of snap) {
    const info = sectorBySym.get(sym);
    if (!info || s.pct_1d == null || Number.isNaN(s.pct_1d)) continue;
    const cap = info.cap;
    if (cap == null || !Number.isFinite(cap) || cap < MIN_CAP_CR) continue;
    const cur = agg1D.get(info.sector) ?? { weighted: 0, weight: 0 };
    cur.weighted += s.pct_1d * cap;
    cur.weight   += cap;
    agg1D.set(info.sector, cur);
  }
  return oneWeek.map((s) => {
    const agg = agg1D.get(s.sector_name);
    return {
      sector_name:       s.sector_name,
      industry_count:    s.industry_count,
      stocks_count:      s.stocks_count,
      avg_ret_1d:        agg && agg.weight > 0 ? agg.weighted / agg.weight : null,
      avg_ret_1w:        s.avg_ret_1w,
      avg_composite_pct: s.avg_composite_pct,
    };
  });
}

function deriveWeekRange(snap: Map<string, GoldenSnap>): WeekRangeStat {
  // Same bucket definitions as before (at = within 0.5%, near = within
  // 5% but not at).  Derived from the consolidated snapshot — no extra
  // DB hit.
  let at_high = 0, at_low = 0, near_high = 0, near_low = 0, total = 0;
  for (const s of snap.values()) {
    if (s.hi_52w == null || s.lo_52w == null || s.hi_52w <= 0 || s.lo_52w <= 0) continue;
    total++;
    const c = s.today_close;
    if (c >= s.hi_52w * 0.995) at_high++;
    else if (c >= s.hi_52w * 0.95) near_high++;
    if (c <= s.lo_52w * 1.005) at_low++;
    else if (c <= s.lo_52w * 1.05) near_low++;
  }
  return { at_high, at_low, near_high, near_low, total };
}

async function loadFii(): Promise<OverviewResponse["fii"]> {
  // Last 5 trading sessions = one trading week.  Bars are tall and
  // readable instead of a 60-bar mosaic.
  const series = await sql<FiiPoint[]>`
    SELECT date::text, fii_net::float, dii_net::float
      FROM app.fii_dii_flow
     ORDER BY date DESC
     LIMIT 5
  `;
  // Series comes back newest-first; reverse for left-to-right rendering.
  series.reverse();
  const latest = series.length > 0 ? series[series.length - 1] : null;
  return { latest, series };
}

async function loadSnapshotDates(): Promise<{ snapshotDate: string | null; ltpDate: string | null }> {
  // Panel-cache snapshot_date is the *scoring* snapshot; index history
  // MAX(date) is the LTP/prices date for the indices side.  For the
  // /market overview we use both, surfaced to the UI as freshness labels.
  const rows = await sql<{ snapshot_date: string | null; ltp_date: string | null }[]>`
    SELECT
      (SELECT MAX(snapshot_date)::text FROM app.cluster_stocks_panel_cache) AS snapshot_date,
      (SELECT MAX(date)::text          FROM app.market_index_history)        AS ltp_date
  `;
  return {
    snapshotDate: rows[0]?.snapshot_date ?? null,
    ltpDate:      rows[0]?.ltp_date      ?? null,
  };
}

// ── Cached aggregator ──────────────────────────────────────────────────────

async function loadOverview(): Promise<OverviewResponse> {
  // Massive consolidation: instead of 4 separate golden queries (each
  // scanning thousands of price_history rows with its own CTE setup),
  // we run ONE golden query (loadGoldenSnapshot) and derive everything
  // 1D + 52W from the resulting Map in Node.  On a cold Neon compute
  // this drops the route from ~15-20s to a couple of seconds.
  //
  // All app-side queries fan out in parallel alongside.
  const [
    indices,
    heroSeries,
    ad1W,
    sector1W,
    sectorMap,
    panelCtx,
    fii,
    dates,
    movers1WUp,
    movers1WDown,
    snap,
  ] = await Promise.all([
    loadIndices(),
    loadHeroSeries(),
    loadAdvanceDecline1W(),
    loadSectorHeat1W(),
    loadSectorMap(),
    loadAllPanelContext(),
    loadFii(),
    loadSnapshotDates(),
    loadMovers1WPool("up", 300),
    loadMovers1WPool("down", 300),
    loadGoldenSnapshot(),
  ]);

  // Pure-JS derivations from the consolidated snapshot.
  const ad1D       = deriveAdvanceDecline1D(snap);
  const weekRange  = deriveWeekRange(snap);
  const sectorHeat = deriveSectorHeat(sector1W, snap, sectorMap);
  const movers1DUp   = deriveMovers1DPool("up",   300, snap, panelCtx);
  const movers1DDown = deriveMovers1DPool("down", 300, snap, panelCtx);

  const advanceDecline = { "1D": ad1D, "1W": ad1W };

  // Partition each pool into 3 universes × top 7.
  const movers = sliceMovers({
    pool1WUp: movers1WUp,
    pool1WDown: movers1WDown,
    pool1DUp: movers1DUp,
    pool1DDown: movers1DDown,
    limit: 7,
  });

  const holidays = upcomingHolidays(new Date(), 5);

  return {
    indices,
    heroSeries,
    movers,
    advanceDecline,
    weekRange,
    sectorHeat,
    fii,
    holidays,
    snapshotDate: dates.snapshotDate,
    ltpDate:      dates.ltpDate,
  };
}

/**
 * Read the precomputed snapshot from app.market_snapshot_cache.
 *
 * This is the fast path — a single indexed row read (~5-30 KB JSONB)
 * returned as-is. Sub-100ms on Neon even cold. Populated daily by
 * scripts/build-market-snapshot.py after refresh-ltp.
 */
async function loadOverviewFromCache(): Promise<OverviewResponse | null> {
  const rows = await sql<{ data: OverviewResponse }[]>`
    SELECT data
      FROM app.market_snapshot_cache
     ORDER BY date DESC
     LIMIT 1
  `;
  return rows[0]?.data ?? null;
}

// Cache strategy:
//   - Dev: 30s TTL
//   - Prod: 1h TTL — daily refresh-ltp wiring purges via /api/revalidate.
// The TTL applies to the (already-fast) DB read, so first-after-purge is
// ~one indexed SELECT, not a 21-second aggregation.
const CACHE_TTL_S = process.env.NODE_ENV === "development" ? 30 : 3600;
const getCachedOverview = unstable_cache(
  async (): Promise<OverviewResponse> => {
    // Prefer the precomputed snapshot. Fall back to live computation
    // only if the cache table is empty (first deploy before the daily
    // build script has run). The fallback path is slow but produces a
    // correct response so the page never renders an error.
    const cached = await loadOverviewFromCache();
    if (cached) return cached;
    console.warn("[market] snapshot cache empty — falling back to live compute. "
                 + "Run scripts/build-market-snapshot.py to populate.");
    return loadOverview();
  },
  ["market-overview-v2"],   // bumped key so the new code doesn't serve old blobs
  {
    revalidate: CACHE_TTL_S,
    tags: ["market", "panel-cache", "snapshot"],
  },
);

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getCachedOverview();
  // Edge-cache header so Vercel's CDN serves repeat hits without
  // invoking the function. The payload is identical for all visitors
  // (no per-user data) so `public` is correct.
  //   s-maxage=3600         — CDN caches 1h, matches our unstable_cache TTL
  //   stale-while-revalidate=86400  — serve stale up to 24h while refreshing
  // Effect: 1 origin hit per region per hour at most, even under heavy
  // bot traffic. Cuts Fast Origin Transfer dramatically on repeated reads.
  //
  // Cache-Tag tells Vercel CDN which named tags this response belongs to.
  // When refresh-ltp calls revalidateTag('market'), Vercel CDN purges every
  // cached response that carried this tag. Without it, revalidateTag only
  // invalidates the unstable_cache layer, leaving the CDN to keep serving
  // the stale response until its s-maxage expires naturally — which is
  // exactly the symptom we hit on the 29th.
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "Cache-Tag":     "market,panel-cache,snapshot",
    },
  });
}
