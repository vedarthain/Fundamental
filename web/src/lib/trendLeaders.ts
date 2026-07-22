/**
 * trendLeaders.ts — the "fresh trend initiation" scanner (slow sibling of
 * momentum.ts).
 *
 * Catches durable uptrends AT THE START: a 50-day SMA that has just crossed
 * above a RISING 200-day SMA (golden cross) within the last ~30 sessions, price
 * trading near its 52-week high. This is the FEDERALBNK-at-Rs65 signal, not the
 * "already trending" stack — because ~180 names are in-trend at any moment
 * (too broad), whereas only a handful cross fresh each month.
 *
 * Two-DB shape (mirrors momentum.ts): price/cross detection on `golden`,
 * fundamental rank enrichment from `app`, merged in JS. No news column — a
 * multi-week trend isn't a single-headline event, so the fundamental score
 * carries the "is it worth it" signal here.
 */
import { sql, golden } from "@/lib/db";

export type TrendLeaderSignal = {
  symbol: string;
  close: number;
  crossDate: string;
  crossClose: number | null;
  pctSinceCross: number | null;
  sma50: number | null;
  sma200: number | null;
  pctBelowHigh: number | null;
  marketCapCr: number | null;
  compositePct: number | null;
  qualityPct: number | null;
  momentumPct: number | null;
  isScored: boolean;
};

// Ruleset knobs.
const FRESH_DAYS = 25; //     cross within ~25 calendar days (~17 trading sessions)
const NEAR_HIGH = 0.92; //    within 8% of the 52-week high
const PRICE_FLOOR = 30; //    >= Rs 30
const TURNOVER_FLOOR = 1e7; // >= Rs 1 cr average daily turnover
const MAX_ROWS = 40;

type GoldenRow = {
  symbol: string;
  close: number;
  cross_date: string;
  cross_close: number | null;
  pct_since_cross: number | null;
  sma50: number | null;
  sma200: number | null;
  pct_below_high: number | null;
};

async function screenGolden(): Promise<{ snapDate: string; rows: GoldenRow[] }> {
  const latest = await golden<{ d: string }[]>`
    SELECT max(date)::text AS d FROM golden.price_history_1d WHERE interval = '1d'
  `;
  const snapDate = latest[0]?.d;
  if (!snapDate) return { snapDate: "", rows: [] };

  // 520-day runway: enough for a valid 200-SMA at a cross that happened up to
  // ~30 sessions ago. Heavy, but it's a once-a-day cron.
  const rows = await golden<GoldenRow[]>`
    WITH base AS (
      SELECT symbol, date, close, high, volume,
             AVG(close)  OVER w50  AS sma50,
             AVG(close)  OVER w200 AS sma200,
             AVG(volume) OVER w50  AS avg_vol50
      FROM golden.price_history_1d
      WHERE interval = '1d' AND date > (${snapDate}::date - 520)
      WINDOW w50  AS (PARTITION BY symbol ORDER BY date ROWS BETWEEN 49  PRECEDING AND CURRENT ROW),
             w200 AS (PARTITION BY symbol ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW)
    ),
    flagged AS (
      SELECT symbol, date, close, sma50, sma200, avg_vol50,
             LAG(sma50 - sma200) OVER (PARTITION BY symbol ORDER BY date)     AS prevdiff,
             LAG(sma200, 20)     OVER (PARTITION BY symbol ORDER BY date)     AS sma200_20ago,
             MAX(high)           OVER (PARTITION BY symbol ORDER BY date
                                       ROWS BETWEEN 250 PRECEDING AND CURRENT ROW) AS hi52w
      FROM base
    ),
    crosses AS (
      SELECT symbol, max(date) AS cross_date
      FROM flagged
      WHERE sma50 > sma200 AND prevdiff <= 0
      GROUP BY symbol
    ),
    cross_px AS (
      SELECT f.symbol, f.date AS cross_date, f.close AS cross_close
      FROM flagged f JOIN crosses c ON c.symbol = f.symbol AND c.cross_date = f.date
    ),
    latest AS (SELECT max(date) d FROM golden.price_history_1d WHERE interval = '1d')
    SELECT replace(f.symbol, '.NS', '')                          AS symbol,
           f.close::float8                                        AS close,
           cp.cross_date::text                                    AS cross_date,
           cp.cross_close::float8                                 AS cross_close,
           ((f.close / NULLIF(cp.cross_close, 0) - 1) * 100)::float8 AS pct_since_cross,
           f.sma50::float8                                        AS sma50,
           f.sma200::float8                                       AS sma200,
           ((f.hi52w - f.close) / NULLIF(f.hi52w, 0) * 100)::float8  AS pct_below_high
    FROM flagged f
    JOIN cross_px cp ON cp.symbol = f.symbol
    JOIN latest l    ON f.date = l.d
    WHERE f.close > f.sma50
      AND f.sma50 > f.sma200
      AND f.sma200 > f.sma200_20ago                 -- 200 rising
      AND f.close >= ${NEAR_HIGH} * f.hi52w          -- near 52w high
      AND f.close >= ${PRICE_FLOOR}
      AND f.avg_vol50 * f.close >= ${TURNOVER_FLOOR}
      AND cp.cross_date >= l.d - ${FRESH_DAYS}::int    -- fresh cross
    ORDER BY cp.cross_date DESC, pct_below_high ASC
    LIMIT ${MAX_ROWS}
  `;
  return { snapDate, rows };
}

async function enrich(rows: GoldenRow[]): Promise<TrendLeaderSignal[]> {
  if (rows.length === 0) return [];
  const symbols = rows.map((r) => r.symbol);
  const cache = await sql<
    {
      symbol: string;
      market_cap_cr: number | null;
      composite_pct: number | null;
      quality_pct: number | null;
      momentum_pct: number | null;
    }[]
  >`
    SELECT symbol,
           market_cap_cr::float8 AS market_cap_cr,
           composite_pct::float8 AS composite_pct,
           quality_pct::float8   AS quality_pct,
           momentum_pct::float8  AS momentum_pct
    FROM app.cluster_stocks_panel_cache
    WHERE snapshot_date = (SELECT max(snapshot_date) FROM app.cluster_stocks_panel_cache)
      AND symbol = ANY(${symbols})
  `;
  const cacheBy = new Map(cache.map((c) => [c.symbol, c]));
  return rows.map((r) => {
    const c = cacheBy.get(r.symbol);
    return {
      symbol: r.symbol,
      close: r.close,
      crossDate: r.cross_date,
      crossClose: r.cross_close,
      pctSinceCross: r.pct_since_cross,
      sma50: r.sma50,
      sma200: r.sma200,
      pctBelowHigh: r.pct_below_high,
      marketCapCr: c?.market_cap_cr ?? null,
      compositePct: c?.composite_pct ?? null,
      qualityPct: c?.quality_pct ?? null,
      momentumPct: c?.momentum_pct ?? null,
      isScored: !!c,
    };
  });
}

export async function computeTrendLeaders(): Promise<{ snapDate: string; signals: TrendLeaderSignal[] }> {
  const { snapDate, rows } = await screenGolden();
  const signals = await enrich(rows);
  return { snapDate, signals };
}

export async function persistTrendLeaders(snapDate: string, signals: TrendLeaderSignal[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM app.trend_leader_signal WHERE snap_date = ${snapDate}`;
    for (const s of signals) {
      await tx`
        INSERT INTO app.trend_leader_signal
          (snap_date, symbol, close, cross_date, cross_close, pct_since_cross,
           sma50, sma200, pct_below_high, market_cap_cr, composite_pct,
           quality_pct, momentum_pct, is_scored)
        VALUES
          (${snapDate}, ${s.symbol}, ${s.close}, ${s.crossDate}, ${s.crossClose}, ${s.pctSinceCross},
           ${s.sma50}, ${s.sma200}, ${s.pctBelowHigh}, ${s.marketCapCr}, ${s.compositePct},
           ${s.qualityPct}, ${s.momentumPct}, ${s.isScored})
      `;
    }
  });
}

export async function loadLatestTrendLeaders(): Promise<{ snapDate: string | null; signals: TrendLeaderSignal[] }> {
  const dateRow = await sql<{ d: string | null }[]>`
    SELECT max(snap_date)::text AS d FROM app.trend_leader_signal
  `;
  const snapDate = dateRow[0]?.d ?? null;
  if (!snapDate) return { snapDate: null, signals: [] };

  const rows = await sql<
    {
      symbol: string;
      close: number;
      crossDate: string;
      crossClose: number | null;
      pctSinceCross: number | null;
      sma50: number | null;
      sma200: number | null;
      pctBelowHigh: number | null;
      marketCapCr: number | null;
      compositePct: number | null;
      qualityPct: number | null;
      momentumPct: number | null;
      is_scored: boolean;
    }[]
  >`
    SELECT symbol,
           close::float8            AS close,
           cross_date::text         AS "crossDate",
           cross_close::float8      AS "crossClose",
           pct_since_cross::float8  AS "pctSinceCross",
           sma50::float8            AS sma50,
           sma200::float8           AS sma200,
           pct_below_high::float8   AS "pctBelowHigh",
           market_cap_cr::float8    AS "marketCapCr",
           composite_pct::float8    AS "compositePct",
           quality_pct::float8      AS "qualityPct",
           momentum_pct::float8     AS "momentumPct",
           is_scored
    FROM app.trend_leader_signal
    WHERE snap_date = ${snapDate}
    ORDER BY cross_date DESC, pct_below_high ASC
  `;
  const signals: TrendLeaderSignal[] = rows.map((r) => ({
    symbol: r.symbol,
    close: r.close,
    crossDate: r.crossDate,
    crossClose: r.crossClose,
    pctSinceCross: r.pctSinceCross,
    sma50: r.sma50,
    sma200: r.sma200,
    pctBelowHigh: r.pctBelowHigh,
    marketCapCr: r.marketCapCr,
    compositePct: r.compositePct,
    qualityPct: r.qualityPct,
    momentumPct: r.momentumPct,
    isScored: r.is_scored,
  }));
  return { snapDate, signals };
}
