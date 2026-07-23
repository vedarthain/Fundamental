/**
 * supportFloor.ts — the "at a multi-year tested floor" scanner (mean-reversion
 * sibling of momentum.ts / trendLeaders.ts).
 *
 * Finds stocks sitting ON a horizontal support band they've bounced off
 * repeatedly: >=3 confirmed swing lows clustered within ~8% of the same floor,
 * spread over >13 months, with price now within ~12% above that floor (and not
 * below it). This is the OPPOSITE of the two momentum scanners — it surfaces
 * names near their lows, not their highs.
 *
 * IMPORTANT — this finds LOCATION, not DIRECTION. A stock at a tested floor may
 * bounce or slice straight through (value trap). No standalone edge is proven;
 * the fundamental score is what separates a quality name at a floor from a
 * broken business grinding down. More touches is NOT more bullish.
 *
 * Two-DB shape (mirrors the siblings): swing-low/floor detection on `golden`,
 * fundamental enrichment from `app`, merged in JS.
 */
import { sql, golden } from "@/lib/db";

export type SupportFloorSignal = {
  symbol: string;
  close: number;
  floorPx: number;
  pctAbove: number | null;
  nTouch: number;
  spanDays: number;
  firstTouch: string;
  lastTouch: string;
  turnoverCr: number | null;
  marketCapCr: number | null;
  compositePct: number | null;
  qualityPct: number | null;
  momentumPct: number | null;
  isScored: boolean;
};

// Ruleset knobs.
const LOOKBACK_DAYS = 1900; // ~5 trading years of history
const SWING_WIN = 15; //       a confirmed swing low is the min over +/-15 sessions
const BAND = 1.08; //          swing lows within 8% of the floor count as "tests"
const MIN_TOUCH = 3; //        floor must be tested >= 3 times
const MIN_SPAN = 400; //       first->last test spread >= ~13 months (a real floor)
const NEAR_FLOOR = 1.12; //    close within 12% above the floor = "at support now"
const PRICE_FLOOR = 30; //     >= Rs 30
const TURNOVER_FLOOR = 1e7; // >= Rs 1 cr average daily turnover
const MAX_ROWS = 60;

type GoldenRow = {
  symbol: string;
  close: number;
  floor_px: number;
  pct_above: number | null;
  n_touch: number;
  span_days: number;
  first_touch: string;
  last_touch: string;
  turnover_cr: number | null;
};

async function screenGolden(): Promise<{ snapDate: string; rows: GoldenRow[] }> {
  const latest = await golden<{ d: string }[]>`
    SELECT max(date)::text AS d FROM golden.price_history_1d WHERE interval = '1d'
  `;
  const snapDate = latest[0]?.d;
  if (!snapDate) return { snapDate: "", rows: [] };

  const rows = await golden<GoldenRow[]>`
    WITH base AS (
      SELECT symbol, date, low, close,
             MIN(low)    OVER (PARTITION BY symbol ORDER BY date
                               ROWS BETWEEN ${SWING_WIN} PRECEDING AND ${SWING_WIN} FOLLOWING) AS w_min,
             AVG(volume) OVER (PARTITION BY symbol ORDER BY date
                               ROWS BETWEEN 49 PRECEDING AND CURRENT ROW)                      AS avg_vol50
      FROM golden.price_history_1d
      WHERE interval = '1d' AND date > (${snapDate}::date - ${LOOKBACK_DAYS}::int)
    ),
    sw AS (   -- confirmed swing lows only
      SELECT symbol, date, low FROM base WHERE low = w_min
    ),
    floors AS (
      SELECT symbol, MIN(low) AS floor_px FROM sw GROUP BY symbol
    ),
    touches AS (
      SELECT s.symbol, f.floor_px,
             COUNT(*) AS n_touch, MIN(s.date) AS first_touch, MAX(s.date) AS last_touch
      FROM sw s JOIN floors f ON f.symbol = s.symbol
      WHERE s.low <= f.floor_px * ${BAND}
      GROUP BY s.symbol, f.floor_px
    ),
    latest AS (SELECT max(date) d FROM golden.price_history_1d WHERE interval = '1d'),
    cur AS (
      SELECT b.symbol, b.close AS cur_close, b.avg_vol50
      FROM base b JOIN latest l ON b.date = l.d
    )
    SELECT replace(t.symbol, '.NS','')                       AS symbol,
           c.cur_close::float8                               AS close,
           t.floor_px::float8                                AS floor_px,
           ((c.cur_close / NULLIF(t.floor_px, 0) - 1) * 100)::float8 AS pct_above,
           t.n_touch::int                                    AS n_touch,
           (t.last_touch - t.first_touch)::int               AS span_days,
           t.first_touch::text                               AS first_touch,
           t.last_touch::text                                AS last_touch,
           (c.avg_vol50 * c.cur_close / 1e7)::float8         AS turnover_cr
    FROM touches t
    JOIN cur c ON c.symbol = t.symbol
    WHERE t.n_touch >= ${MIN_TOUCH}
      AND (t.last_touch - t.first_touch) >= ${MIN_SPAN}
      AND c.cur_close >= t.floor_px
      AND c.cur_close <= t.floor_px * ${NEAR_FLOOR}
      AND c.cur_close >= ${PRICE_FLOOR}
      AND c.avg_vol50 * c.cur_close >= ${TURNOVER_FLOOR}
    ORDER BY ((c.cur_close / NULLIF(t.floor_px, 0) - 1) * 100) ASC, t.n_touch DESC
    LIMIT ${MAX_ROWS}
  `;
  return { snapDate, rows };
}

async function enrich(rows: GoldenRow[]): Promise<SupportFloorSignal[]> {
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
      floorPx: r.floor_px,
      pctAbove: r.pct_above,
      nTouch: r.n_touch,
      spanDays: r.span_days,
      firstTouch: r.first_touch,
      lastTouch: r.last_touch,
      turnoverCr: r.turnover_cr,
      marketCapCr: c?.market_cap_cr ?? null,
      compositePct: c?.composite_pct ?? null,
      qualityPct: c?.quality_pct ?? null,
      momentumPct: c?.momentum_pct ?? null,
      isScored: !!c,
    };
  });
}

export async function computeSupportFloor(): Promise<{ snapDate: string; signals: SupportFloorSignal[] }> {
  const { snapDate, rows } = await screenGolden();
  const signals = await enrich(rows);
  return { snapDate, signals };
}

export async function persistSupportFloor(snapDate: string, signals: SupportFloorSignal[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM app.support_floor_signal WHERE snap_date = ${snapDate}`;
    for (const s of signals) {
      await tx`
        INSERT INTO app.support_floor_signal
          (snap_date, symbol, close, floor_px, pct_above, n_touch, span_days,
           first_touch, last_touch, turnover_cr, market_cap_cr, composite_pct,
           quality_pct, momentum_pct, is_scored)
        VALUES
          (${snapDate}, ${s.symbol}, ${s.close}, ${s.floorPx}, ${s.pctAbove}, ${s.nTouch}, ${s.spanDays},
           ${s.firstTouch}, ${s.lastTouch}, ${s.turnoverCr}, ${s.marketCapCr}, ${s.compositePct},
           ${s.qualityPct}, ${s.momentumPct}, ${s.isScored})
      `;
    }
  });
}

export async function loadLatestSupportFloor(): Promise<{ snapDate: string | null; signals: SupportFloorSignal[] }> {
  const dateRow = await sql<{ d: string | null }[]>`
    SELECT max(snap_date)::text AS d FROM app.support_floor_signal
  `;
  const snapDate = dateRow[0]?.d ?? null;
  if (!snapDate) return { snapDate: null, signals: [] };

  const rows = await sql<
    {
      symbol: string;
      close: number;
      floorPx: number;
      pctAbove: number | null;
      nTouch: number;
      spanDays: number;
      firstTouch: string;
      lastTouch: string;
      turnoverCr: number | null;
      marketCapCr: number | null;
      compositePct: number | null;
      qualityPct: number | null;
      momentumPct: number | null;
      is_scored: boolean;
    }[]
  >`
    SELECT symbol,
           close::float8           AS close,
           floor_px::float8        AS "floorPx",
           pct_above::float8       AS "pctAbove",
           n_touch::int            AS "nTouch",
           span_days::int          AS "spanDays",
           first_touch::text       AS "firstTouch",
           last_touch::text        AS "lastTouch",
           turnover_cr::float8     AS "turnoverCr",
           market_cap_cr::float8   AS "marketCapCr",
           composite_pct::float8   AS "compositePct",
           quality_pct::float8     AS "qualityPct",
           momentum_pct::float8    AS "momentumPct",
           is_scored
    FROM app.support_floor_signal
    WHERE snap_date = ${snapDate}
    ORDER BY pct_above ASC, n_touch DESC
  `;
  const signals: SupportFloorSignal[] = rows.map((r) => ({
    symbol: r.symbol,
    close: r.close,
    floorPx: r.floorPx,
    pctAbove: r.pctAbove,
    nTouch: r.nTouch,
    spanDays: r.spanDays,
    firstTouch: r.firstTouch,
    lastTouch: r.lastTouch,
    turnoverCr: r.turnoverCr,
    marketCapCr: r.marketCapCr,
    compositePct: r.compositePct,
    qualityPct: r.qualityPct,
    momentumPct: r.momentumPct,
    isScored: r.is_scored,
  }));
  return { snapDate, signals };
}
