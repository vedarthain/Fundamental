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

async function loadMovers1DPool(direction: "up" | "down", limit: number): Promise<MoverWithFlags[]> {
  // Pull top N 1D moves from golden, then enrich with panel + universe
  // context in a single follow-up query. Two queries total instead of
  // six (was: one per universe × direction).
  const moves = direction === "up"
    ? await golden<{ symbol: string; pct: number; today_close: number }[]>`
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
        ),
        prev_close AS (
          SELECT REPLACE(symbol, '.NS', '') AS symbol, close
            FROM golden.price_history, prev
           WHERE interval='1d' AND date = prev.d
        )
        SELECT t.symbol, t.close AS today_close,
               ((t.close - p.close) / NULLIF(p.close, 0))::float AS pct
          FROM today_close t
          JOIN prev_close  p ON p.symbol = t.symbol
         WHERE p.close > 0
         ORDER BY pct DESC NULLS LAST
         LIMIT ${limit}
      `
    : await golden<{ symbol: string; pct: number; today_close: number }[]>`
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
        ),
        prev_close AS (
          SELECT REPLACE(symbol, '.NS', '') AS symbol, close
            FROM golden.price_history, prev
           WHERE interval='1d' AND date = prev.d
        )
        SELECT t.symbol, t.close AS today_close,
               ((t.close - p.close) / NULLIF(p.close, 0))::float AS pct
          FROM today_close t
          JOIN prev_close  p ON p.symbol = t.symbol
         WHERE p.close > 0
         ORDER BY pct ASC NULLS LAST
         LIMIT ${limit}
      `;
  if (moves.length === 0) return [];

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

  const out: MoverWithFlags[] = [];
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
      is_nifty50:    c.is_nifty50,
      is_nifty200:   c.is_nifty200,
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

async function loadAdvanceDecline1D(): Promise<AdvanceDeclineSet> {
  // 1D: golden.price_history close-vs-prev. We bucket inside the same
  // query so only a 3-row result crosses the wire.  Flat band ±0.5%.
  const rows = await golden<{ direction: string; n: number }[]>`
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
    ),
    prev_close AS (
      SELECT REPLACE(symbol, '.NS', '') AS symbol, close
        FROM golden.price_history, prev
       WHERE interval='1d' AND date = prev.d
    ),
    moves AS (
      SELECT ((t.close - p.close) / NULLIF(p.close, 0))::float AS pct
        FROM today_close t
        JOIN prev_close  p ON p.symbol = t.symbol
       WHERE p.close > 0
    )
    SELECT CASE
             WHEN pct >  0.005 THEN 'up'
             WHEN pct < -0.005 THEN 'down'
             ELSE 'flat'
           END AS direction,
           COUNT(*)::int AS n
      FROM moves
     WHERE pct IS NOT NULL
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

async function loadSectorHeat(): Promise<SectorHeatRow[]> {
  // 1W average (from panel cache) + 1D average (computed from golden,
  // joined in Node by symbol). Single response shape with both columns
  // so the UI can toggle without a second roundtrip.

  // --- 1W aggregate from panel cache ---
  const oneWeek = await sql<{
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
      AVG(c.ret_1w)::float              AS avg_ret_1w,
      AVG(c.composite_pct)::float       AS avg_composite_pct
    FROM app.cluster_stocks_panel_cache c
    JOIN app.cluster cl      ON cl.id = c.cluster_id
    JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
    WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
      AND c.ret_1w IS NOT NULL
    GROUP BY mc.name, mc.display_order
    ORDER BY mc.display_order, mc.name
  `;

  // --- per-symbol 1D moves from golden ---
  const moves1D = await golden<{ symbol: string; pct: number }[]>`
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
    ),
    prev_close AS (
      SELECT REPLACE(symbol, '.NS', '') AS symbol, close
        FROM golden.price_history, prev
       WHERE interval='1d' AND date = prev.d
    )
    SELECT t.symbol, ((t.close - p.close) / NULLIF(p.close, 0))::float AS pct
      FROM today_close t
      JOIN prev_close  p ON p.symbol = t.symbol
     WHERE p.close > 0
  `;

  // --- symbol → sector map (cheap pull from panel cache) ---
  const map = await sql<{ symbol: string; sector_name: string }[]>`
    SELECT c.symbol, mc.name AS sector_name
      FROM app.cluster_stocks_panel_cache c
      JOIN app.cluster cl      ON cl.id = c.cluster_id
      JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
     WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
  `;
  const sectorBySym = new Map(map.map((r) => [r.symbol, r.sector_name]));

  // Aggregate 1D moves per sector.
  const sum1D = new Map<string, { total: number; n: number }>();
  for (const m of moves1D) {
    const sec = sectorBySym.get(m.symbol);
    if (!sec || m.pct === null || Number.isNaN(m.pct)) continue;
    const cur = sum1D.get(sec) ?? { total: 0, n: 0 };
    cur.total += m.pct;
    cur.n     += 1;
    sum1D.set(sec, cur);
  }

  return oneWeek.map((s) => {
    const agg = sum1D.get(s.sector_name);
    return {
      sector_name:       s.sector_name,
      industry_count:    s.industry_count,
      stocks_count:      s.stocks_count,
      avg_ret_1d:        agg && agg.n > 0 ? agg.total / agg.n : null,
      avg_ret_1w:        s.avg_ret_1w,
      avg_composite_pct: s.avg_composite_pct,
    };
  });
}

async function loadWeekRange(): Promise<WeekRangeStat> {
  // 52-week high / low touch count, computed against golden.price_history.
  //
  // We pull the last ~260 trading days' worth of rows for every symbol,
  // compute MAX/MIN per symbol, then compare to the latest close. Buckets:
  //   - at_high   : close >= 52W high × 0.995 (within 0.5%)
  //   - at_low    : close <= 52W low  × 1.005
  //   - near_high : close >= 52W high × 0.95 but not at_high
  //   - near_low  : close <= 52W low  × 1.05 but not at_low
  //
  // Single window query, scoped to active universe via JOIN so we don't
  // count delisted scrips. Runs once per hour inside the cached overview.
  const rows = await golden<{
    at_high: number;
    at_low: number;
    near_high: number;
    near_low: number;
    total: number;
  }[]>`
    WITH bounds AS (
      SELECT date AS latest FROM golden.price_history WHERE interval='1d'
       ORDER BY date DESC LIMIT 1
    ),
    horizon AS (
      SELECT (SELECT latest FROM bounds) - INTERVAL '370 days' AS cutoff,
             (SELECT latest FROM bounds) AS latest
    ),
    yearly AS (
      SELECT REPLACE(p.symbol, '.NS', '') AS symbol,
             MAX(p.close) AS hi,
             MIN(p.close) AS lo
        FROM golden.price_history p, horizon h
       WHERE p.interval = '1d'
         AND p.date >= h.cutoff
       GROUP BY 1
    ),
    today_close AS (
      SELECT REPLACE(p.symbol, '.NS', '') AS symbol,
             p.close
        FROM golden.price_history p, horizon h
       WHERE p.interval = '1d'
         AND p.date = h.latest
    ),
    joined AS (
      SELECT t.symbol, t.close, y.hi, y.lo
        FROM today_close t
        JOIN yearly y ON y.symbol = t.symbol
       WHERE y.hi > 0 AND y.lo > 0
    )
    SELECT
      COUNT(*) FILTER (WHERE close >= hi * 0.995)::int                                              AS at_high,
      COUNT(*) FILTER (WHERE close <= lo * 1.005)::int                                              AS at_low,
      COUNT(*) FILTER (WHERE close >= hi * 0.95 AND close <  hi * 0.995)::int                       AS near_high,
      COUNT(*) FILTER (WHERE close <= lo * 1.05 AND close >  lo * 1.005)::int                       AS near_low,
      COUNT(*)::int                                                                                  AS total
    FROM joined
  `;
  return rows[0] ?? { at_high: 0, at_low: 0, near_high: 0, near_low: 0, total: 0 };
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
  // Movers: 4 queries (2 periods × 2 dirs), each returning the top 300
  // rows with universe flags attached.  We slice into 3 universe buckets
  // in Node — cheaper than 12 separate DB roundtrips, and 300 is enough
  // headroom that the top-7 within Nifty 50 is reliably present even on
  // small-cap-led days.
  const [
    indices,
    heroSeries,
    ad1W,
    ad1D,
    weekRange,
    sectorHeat,
    fii,
    dates,
    movers1WUp,
    movers1WDown,
    movers1DUp,
    movers1DDown,
  ] = await Promise.all([
    loadIndices(),
    loadHeroSeries(),
    loadAdvanceDecline1W(),
    loadAdvanceDecline1D(),
    loadWeekRange(),
    loadSectorHeat(),
    loadFii(),
    loadSnapshotDates(),
    loadMovers1WPool("up", 300),
    loadMovers1WPool("down", 300),
    loadMovers1DPool("up", 300),
    loadMovers1DPool("down", 300),
  ]);
  const advanceDecline = { "1D": ad1D, "1W": ad1W };

  // Partition each pool into 3 universes × top 7. Membership flags
  // (is_nifty50 / is_nifty200) live on each row, so this is pure JS.
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

// Cache strategy:
//   - Dev: 30s TTL — short enough that fresh data after running
//     refresh-ltp / backfill scripts surfaces on the next reload,
//     long enough that iterating on UI without changing data is snappy.
//   - Prod: 1h TTL — daily refresh-ltp wiring purges via /api/revalidate.
const CACHE_TTL_S = process.env.NODE_ENV === "development" ? 30 : 3600;
const getCachedOverview = unstable_cache(loadOverview, ["market-overview"], {
  revalidate: CACHE_TTL_S,
  tags: ["market", "panel-cache", "snapshot"],
});

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getCachedOverview();
  return NextResponse.json(data);
}
