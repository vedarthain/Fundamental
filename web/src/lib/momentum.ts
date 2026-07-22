/**
 * momentum.ts — the "volume-ignition" breakout scanner.
 *
 * Catches the FIRST day of a run, not the aftermath: a stock making a big
 * up-move on abnormal volume while breaking a fresh high. Validated against
 * Kalyan Jewellers (+18% on 11.7x volume, Jul 9) and a full latest-day sweep
 * where every hit was a real results/order catalyst — zero pump-and-dumps.
 *
 * The delivery-% signal was removed entirely: as a "pump filter" it false-
 * flagged all five genuine winners (heavy intraday churn is normal on a
 * catalyst day), so it was never a filter — only a display column — and the
 * prod golden DB doesn't even carry delivery_pct. The real pump-guard is the
 * CATALYST column: a blank headline is the human flag, never an auto-reject.
 *
 * Two-DB shape (mirrors portfolio.ts): the price screen runs on `golden`, then
 * fundamental rank + catalyst enrichment come from `app`, merged in JS.
 */
import { sql, golden } from "@/lib/db";

export type MomentumSignal = {
  symbol: string;
  close: number;
  retPct: number;
  volX: number;
  newHigh: boolean;
  marketCapCr: number | null;
  compositePct: number | null;
  qualityPct: number | null;
  momentumPct: number | null;
  isScored: boolean;
  catalystTitle: string | null;
  catalystUrl: string | null;
  catalystSource: string | null;
  catalystAt: string | null;
};

/** Ruleset knobs — one place to tune the screen. */
const RET_MIN = 0.06; //  >= 6% up-day
const VOL_MULT = 3; //    >= 3x its own 50-day average volume
const PRICE_FLOOR = 30; // >= Rs 30 (no penny junk)
const TURNOVER_FLOOR = 1e7; // >= Rs 1 cr average daily turnover (liquidity)
const MAX_ROWS = 20; //   store the top N by volume multiple

type GoldenRow = {
  symbol: string;
  close: number;
  ret_pct: number;
  vol_x: number;
  new_high: boolean;
};

/**
 * Run the price screen over the latest golden bar and return raw ignitions
 * (already ranked by volume multiple, capped at MAX_ROWS). `snapDate` is the
 * date of that latest bar so the caller stamps rows consistently.
 */
async function screenGolden(): Promise<{ snapDate: string; rows: GoldenRow[] }> {
  const latest = await golden<{ d: string }[]>`
    SELECT max(date)::text AS d FROM golden.price_history_1d WHERE interval = '1d'
  `;
  const snapDate = latest[0]?.d;
  if (!snapDate) return { snapDate: "", rows: [] };

  // Window functions need a lookback runway; 120 days covers the 60-day high
  // and 50-day avg-volume windows with margin, cheaply.
  const rows = await golden<GoldenRow[]>`
    WITH r AS (
      SELECT symbol, date, close, volume, high,
             close / NULLIF(LAG(close) OVER (PARTITION BY symbol ORDER BY date), 0) - 1 AS ret1
      FROM golden.price_history_1d
      WHERE interval = '1d' AND date > (${snapDate}::date - 120)
    ),
    b AS (
      SELECT symbol, date, close, volume, ret1,
             AVG(volume) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 50 PRECEDING AND 1 PRECEDING) AS avg_vol50,
             MAX(high)   OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 60 PRECEDING AND 1 PRECEDING) AS hi60
      FROM r
    )
    SELECT replace(symbol, '.NS', '')                       AS symbol,
           close::float8                                     AS close,
           (ret1 * 100)::float8                              AS ret_pct,
           (volume / NULLIF(avg_vol50, 0))::float8           AS vol_x,
           (close > hi60)                                    AS new_high
    FROM b
    WHERE date = ${snapDate}::date
      AND ret1 >= ${RET_MIN}
      AND volume >= ${VOL_MULT} * avg_vol50
      AND close > hi60
      AND close >= ${PRICE_FLOOR}
      AND avg_vol50 * close >= ${TURNOVER_FLOOR}
    ORDER BY vol_x DESC
    LIMIT ${MAX_ROWS}
  `;
  return { snapDate, rows };
}

/**
 * Enrich the golden hits with fundamental rank (panel cache) + latest catalyst
 * headline (app.news), merged in JS. Returns the full signal rows.
 */
async function enrich(snapDate: string, rows: GoldenRow[]): Promise<MomentumSignal[]> {
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

  // Latest headline tagged to each symbol within 2 days of the ignition.
  const news = await sql<
    { symbol: string; title: string; url: string; source: string; published_at: string }[]
  >`
    SELECT DISTINCT ON (ns.symbol)
           ns.symbol, n.title, n.url, n.source, n.published_at::text AS published_at
    FROM app.news_stock ns
    JOIN app.news n ON n.id = ns.news_id
    WHERE ns.symbol = ANY(${symbols})
      AND n.published_at >= (${snapDate}::date - 2)
    ORDER BY ns.symbol, n.published_at DESC
  `;
  const newsBy = new Map(news.map((x) => [x.symbol, x]));

  return rows.map((r) => {
    const c = cacheBy.get(r.symbol);
    const nw = newsBy.get(r.symbol);
    return {
      symbol: r.symbol,
      close: r.close,
      retPct: r.ret_pct,
      volX: r.vol_x,
      newHigh: r.new_high,
      marketCapCr: c?.market_cap_cr ?? null,
      compositePct: c?.composite_pct ?? null,
      qualityPct: c?.quality_pct ?? null,
      momentumPct: c?.momentum_pct ?? null,
      isScored: !!c,
      catalystTitle: nw?.title ?? null,
      catalystUrl: nw?.url ?? null,
      catalystSource: nw?.source ?? null,
      catalystAt: nw?.published_at ?? null,
    };
  });
}

/** Compute today's signals end-to-end (screen + enrich). Used by the cron. */
export async function computeMomentumSignals(): Promise<{ snapDate: string; signals: MomentumSignal[] }> {
  const { snapDate, rows } = await screenGolden();
  const signals = await enrich(snapDate, rows);
  return { snapDate, signals };
}

/** Persist a day's signals — REPLACE that day's rows (idempotent re-run). */
export async function persistMomentumSignals(snapDate: string, signals: MomentumSignal[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM app.momentum_signal WHERE snap_date = ${snapDate}`;
    for (const s of signals) {
      await tx`
        INSERT INTO app.momentum_signal
          (snap_date, symbol, close, ret_pct, vol_x, new_high,
           market_cap_cr, composite_pct, quality_pct, momentum_pct, is_scored,
           catalyst_title, catalyst_url, catalyst_source, catalyst_at)
        VALUES
          (${snapDate}, ${s.symbol}, ${s.close}, ${s.retPct}, ${s.volX}, ${s.newHigh},
           ${s.marketCapCr}, ${s.compositePct}, ${s.qualityPct}, ${s.momentumPct}, ${s.isScored},
           ${s.catalystTitle}, ${s.catalystUrl}, ${s.catalystSource}, ${s.catalystAt})
      `;
    }
  });
}

/** Read the latest stored snapshot for the /tools/momentum page. */
export async function loadLatestMomentum(): Promise<{ snapDate: string | null; signals: MomentumSignal[] }> {
  const dateRow = await sql<{ d: string | null }[]>`
    SELECT max(snap_date)::text AS d FROM app.momentum_signal
  `;
  const snapDate = dateRow[0]?.d ?? null;
  if (!snapDate) return { snapDate: null, signals: [] };

  const rows = await sql<
    (Omit<MomentumSignal, "newHigh" | "isScored"> & { new_high: boolean; is_scored: boolean })[]
  >`
    SELECT symbol,
           close::float8         AS close,
           ret_pct::float8       AS "retPct",
           vol_x::float8         AS "volX",
           new_high,
           market_cap_cr::float8 AS "marketCapCr",
           composite_pct::float8 AS "compositePct",
           quality_pct::float8   AS "qualityPct",
           momentum_pct::float8  AS "momentumPct",
           is_scored,
           catalyst_title        AS "catalystTitle",
           catalyst_url          AS "catalystUrl",
           catalyst_source       AS "catalystSource",
           catalyst_at::text     AS "catalystAt"
    FROM app.momentum_signal
    WHERE snap_date = ${snapDate}
    ORDER BY vol_x DESC
  `;
  const signals: MomentumSignal[] = rows.map((r) => ({
    symbol: r.symbol,
    close: r.close,
    retPct: r.retPct,
    volX: r.volX,
    newHigh: r.new_high,
    marketCapCr: r.marketCapCr,
    compositePct: r.compositePct,
    qualityPct: r.qualityPct,
    momentumPct: r.momentumPct,
    isScored: r.is_scored,
    catalystTitle: r.catalystTitle,
    catalystUrl: r.catalystUrl,
    catalystSource: r.catalystSource,
    catalystAt: r.catalystAt,
  }));
  return { snapDate, signals };
}
