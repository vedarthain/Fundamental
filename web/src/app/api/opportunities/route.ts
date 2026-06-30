/**
 * GET /api/opportunities
 *
 * Returns fundamentally strong stocks that have undergone a price correction —
 * high Quality + high Valuation (cheap relative to peers) combined with
 * correction-depth signals: relative returns vs market and 200-day EMA trend.
 *
 * Server floor: Q ≥ 30, V ≥ 30 (permissive so the client can apply tighter
 * interactive filters without a round-trip). ~900 rows at the loose floor,
 * ~420 at Q≥55+V≥55, ~200 at the "Corrected Quality" default Q≥55+V≥50+M≤50.
 *
 * All return/CAGR metrics come from cluster_metrics JSONB on metrics_snapshot —
 * extracted here so the client receives flat, typed fields.
 *
 * Cache: 24h via s-maxage (revalidated when scores update).
 */
import { NextResponse } from "next/server";
import { sql, golden } from "@/lib/db";

export const runtime = "nodejs";
export const revalidate = 86400;

// Boilerplate-filing title patterns (POSIX regex, case-insensitive via !~*).
// These are procedural compliance filings every company makes every quarter —
// no catalyst value. Deliberately does NOT include "Regulation 30 (LODR)",
// which is the clause half of ALL filings (including real news) are filed under.
const FILING_NOISE_RE =
  "(trading window|newspaper|(analyst|investor)\\s.{0,25}(call|meet|conference|presentation|interaction|day)" +
  "|compliance certificate|certificate under reg|book closure|record date" +
  "|loss of .{0,20}certificate|duplicate .{0,20}certificate|change of address|change in registrar" +
  "|postal ballot|scrutinizer|esop|esps" +
  "|allotment of (non.?convertible|ncd|debenture|commercial paper|warrant)" +
  "|forfeiture|sub.?division|reconciliation of share)";

type Row = {
  symbol: string;
  company_name: string;
  industry_id: string;
  industry_name: string;
  sector_id: string;
  sector_name: string;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  composite_pct: number | null;
  peer_rank: number | null;
  peer_count: number | null;
  // Index membership
  is_nifty50: boolean;
  is_nifty100: boolean;
  is_nifty200: boolean;
  is_nifty500: boolean;
  // Correction-depth signals
  ret_1m_rel: number | null;          // 1M return vs market (decimal)
  ret_3m_rel: number | null;          // 3M return vs market (decimal)
  ret_6m_rel: number | null;          // 6M return vs market (decimal, −0.25 = underperformed 25%)
  ret_12m_rel: number | null;         // 12M return vs market
  pct_above_200ema: number | null;    // fraction of past 252 days above 200d EMA (0–1)
  ema_stack_bull: boolean | null;     // short-term EMA stack bullish = recovery signal
  // Business-health metrics
  pe_ttm: number | null;
  pb: number | null;
  np_cagr_5y: number | null;
  rev_cagr_5y: number | null;
  roe_3y: number | null;
  np_yoy_q: number | null;            // latest-quarter net profit YoY growth
  // Actual historical prices from golden.price_history (not back-calculated)
  price_1m_ago: number | null;
  price_3m_ago: number | null;
  price_6m_ago: number | null;
  price_1y_ago: number | null;
  // Recovery signals computed from golden.price_history OHLCV
  above_200sma: boolean | null;
  off_52w_low_pct: number | null;
  accum_ratio_20d: number | null;
  // Latest exchange filing (BSE announcement) — single most recent headline
  filing_title: string | null;
  filing_category: string | null;
  filing_date: string | null;
  filing_url: string | null;
};

type HistPrices = {
  symbol: string;
  price_1m_ago: number | null;
  price_3m_ago: number | null;
  price_6m_ago: number | null;
  price_1y_ago: number | null;
};

type RecoverySignals = {
  symbol: string;
  above_200sma: boolean | null;      // current adj_close > 200-day SMA
  off_52w_low_pct: number | null;    // (current - 252d_low) / 252d_low
  accum_ratio_20d: number | null;    // up-day vol / down-day vol over last 20 sessions
};

type LatestFiling = {
  symbol: string;
  filing_title: string | null;
  filing_category: string | null;
  filing_date: string | null;        // ISO timestamp
  filing_url: string | null;         // BSE PDF attachment, when present
};

type NiftyReturns = {
  ret_1m: number | null;
  ret_3m: number | null;
  ret_6m: number | null;
  ret_1y: number | null;
};

type BenchmarkRow = NiftyReturns & { index_code: string };

export async function GET() {
  // Run all five queries in parallel — stocks, NIFTY benchmark, historical
  // prices from golden for accurate "from ₹X" display, recovery signals
  // computed from 300 days of OHLCV in golden.price_history, and the single
  // latest BSE filing per symbol for the inline headline.
  const [rows, niftyRows, histRows, recoveryRows, filingRows] = await Promise.all([
    sql<Row[]>`
    WITH ranked AS (
      SELECT
        s.symbol,
        s.cluster_id,
        s.maturity_tier,
        s.quality_pct,
        s.valuation_pct,
        s.momentum_pct,
        s.composite_pct,
        RANK() OVER (
          PARTITION BY s.cluster_id, s.maturity_tier
          ORDER BY s.composite_pct DESC NULLS LAST
        )::int AS peer_rank,
        COUNT(*) OVER (
          PARTITION BY s.cluster_id, s.maturity_tier
        )::int AS peer_count
      FROM app.scores s
      WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
        AND COALESCE(s.quality_pct,   0) >= 30
        AND COALESCE(s.valuation_pct, 0) >= 30
    )
    SELECT
      r.symbol,
      u.company_name,
      r.cluster_id                                        AS industry_id,
      c.name                                              AS industry_name,
      mc.id                                               AS sector_id,
      mc.name                                             AS sector_name,
      r.maturity_tier,
      sm.market_cap_cr::float                             AS market_cap_cr,
      sm.current_price::float                             AS current_price,
      -- is_nifty50/200 from universe (seeded in migrations 0009/0010).
      -- is_nifty100/500 derived from index_constituent (kept current by
      -- fetch-index-constituents.py) since they were never seeded in universe.
      COALESCE(u.is_nifty50,  false)                      AS is_nifty50,
      (n100.symbol IS NOT NULL)                           AS is_nifty100,
      COALESCE(u.is_nifty200, false)                      AS is_nifty200,
      (n500.symbol IS NOT NULL)                           AS is_nifty500,
      r.quality_pct,
      r.valuation_pct,
      r.momentum_pct,
      r.composite_pct,
      r.peer_rank,
      r.peer_count,
      -- Correction-depth signals (1M computed from 21-trading-day window)
      (m.cluster_metrics->>'ret_1m_rel')::float           AS ret_1m_rel,
      (m.cluster_metrics->>'ret_3m_rel')::float           AS ret_3m_rel,
      (m.cluster_metrics->>'ret_6m_rel')::float           AS ret_6m_rel,
      (m.cluster_metrics->>'ret_12m_rel')::float          AS ret_12m_rel,
      (m.cluster_metrics->>'pct_above_200ema_252d')::float AS pct_above_200ema,
      CASE (m.cluster_metrics->>'ema_stack_bull')
        WHEN '1' THEN true
        WHEN '1.0' THEN true
        ELSE false
      END                                                 AS ema_stack_bull,
      -- Business-health metrics
      (m.cluster_metrics->>'pe_ttm')::float               AS pe_ttm,
      (m.cluster_metrics->>'pb')::float                   AS pb,
      (m.cluster_metrics->>'np_cagr_5y')::float           AS np_cagr_5y,
      (m.cluster_metrics->>'rev_cagr_5y')::float          AS rev_cagr_5y,
      COALESCE(
        (m.cluster_metrics->>'roe_3y')::float,
        (m.cluster_metrics->>'roce_3y')::float
      )                                                   AS roe_3y,
      (m.cluster_metrics->>'np_yoy_q')::float             AS np_yoy_q
    FROM ranked r
    JOIN app.universe u ON u.symbol = r.symbol
    JOIN app.cluster c ON c.id = r.cluster_id
    JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    LEFT JOIN app.screener_meta sm ON sm.symbol = r.symbol
    LEFT JOIN app.metrics_snapshot m
      ON m.symbol = r.symbol
     AND m.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
    LEFT JOIN (
      SELECT symbol FROM app.index_constituent WHERE index_code = 'NIFTY100'
    ) n100 ON n100.symbol = r.symbol
    LEFT JOIN (
      SELECT symbol FROM app.index_constituent WHERE index_code = 'NIFTY500'
    ) n500 ON n500.symbol = r.symbol
    WHERE u.is_active
    ORDER BY r.quality_pct DESC NULLS LAST, r.valuation_pct DESC NULLS LAST
  `,

    // Benchmark returns for Nifty 50, Nifty 100 (proxy for Nifty 200), and
    // Nifty 500 — fetched in one pass via a lateral join over the index codes.
    // The page shows the strip matching the active index filter.
    sql<BenchmarkRow[]>`
      SELECT
        codes.index_code,
        CASE WHEN m.close > 0
          THEN ((t.close - m.close) / m.close)::float END AS ret_1m,
        CASE WHEN q.close > 0
          THEN ((t.close - q.close) / q.close)::float END AS ret_3m,
        CASE WHEN h.close > 0
          THEN ((t.close - h.close) / h.close)::float END AS ret_6m,
        CASE WHEN y.close > 0
          THEN ((t.close - y.close) / y.close)::float END AS ret_1y
      FROM (VALUES ('NIFTY50'), ('NIFTY100'), ('NIFTY500')) AS codes(index_code)
      CROSS JOIN LATERAL (
        SELECT close, date FROM app.market_index_history
        WHERE index_code = codes.index_code ORDER BY date DESC LIMIT 1
      ) t
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history
        WHERE index_code = codes.index_code AND date <= t.date - INTERVAL '30 days'
        ORDER BY date DESC LIMIT 1
      ) m ON TRUE
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history
        WHERE index_code = codes.index_code AND date <= t.date - INTERVAL '90 days'
        ORDER BY date DESC LIMIT 1
      ) q ON TRUE
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history
        WHERE index_code = codes.index_code AND date <= t.date - INTERVAL '180 days'
        ORDER BY date DESC LIMIT 1
      ) h ON TRUE
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history
        WHERE index_code = codes.index_code AND date <= t.date - INTERVAL '365 days'
        ORDER BY date DESC LIMIT 1
      ) y ON TRUE
    `,

    // Actual closing prices at 4 anchor dates from golden.price_history.
    // Using scalar subqueries for anchor dates so Postgres treats them as
    // constants and can use the (interval, date) index on each scan.
    golden<HistPrices[]>`
      WITH latest AS (
        SELECT MAX(date) AS d FROM golden.price_history WHERE interval = '1d'
      ),
      d_1m AS (
        SELECT MAX(date) AS d FROM golden.price_history
        WHERE interval = '1d' AND date <= (SELECT d FROM latest) - INTERVAL '30 days'
      ),
      d_3m AS (
        SELECT MAX(date) AS d FROM golden.price_history
        WHERE interval = '1d' AND date <= (SELECT d FROM latest) - INTERVAL '90 days'
      ),
      d_6m AS (
        SELECT MAX(date) AS d FROM golden.price_history
        WHERE interval = '1d' AND date <= (SELECT d FROM latest) - INTERVAL '180 days'
      ),
      d_1y AS (
        SELECT MAX(date) AS d FROM golden.price_history
        WHERE interval = '1d' AND date <= (SELECT d FROM latest) - INTERVAL '365 days'
      )
      SELECT
        REPLACE(p.symbol, '.NS', '') AS symbol,
        -- Use adj_close (populated by apply-corp-adjustments.py) so that
        -- splits/bonuses within the lookback window don't distort the "from ₹X"
        -- anchor and the % return pill. For stocks with no corporate actions,
        -- adj_close = close (no change in behaviour).
        MAX(p.adj_close) FILTER (WHERE p.date = (SELECT d FROM d_1m))::float AS price_1m_ago,
        MAX(p.adj_close) FILTER (WHERE p.date = (SELECT d FROM d_3m))::float AS price_3m_ago,
        MAX(p.adj_close) FILTER (WHERE p.date = (SELECT d FROM d_6m))::float AS price_6m_ago,
        MAX(p.adj_close) FILTER (WHERE p.date = (SELECT d FROM d_1y))::float AS price_1y_ago
      FROM golden.price_history p
      WHERE p.interval = '1d'
        AND p.date IN (
          (SELECT d FROM d_1m),
          (SELECT d FROM d_3m),
          (SELECT d FROM d_6m),
          (SELECT d FROM d_1y)
        )
        AND p.symbol LIKE '%.NS'
      GROUP BY REPLACE(p.symbol, '.NS', '')
    `,

    // Recovery signals — three new signals computed from 300 calendar days
    // (~215 trading days) of OHLCV in golden.price_history.
    // ROW_NUMBER DESC ranks the most recent session as rn=1, so:
    //   rn <= 200 → 200-session SMA window
    //   rn <= 252 → approx 52-week low window
    //   rn <= 20  → 20-session volume accumulation window
    golden<RecoverySignals[]>`
      WITH ranked AS (
        SELECT
          REPLACE(symbol, '.NS', '') AS sym,
          adj_close,
          volume,
          close >= open              AS is_up_day,
          ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
        FROM golden.price_history
        WHERE interval = '1d'
          AND date >= CURRENT_DATE - INTERVAL '300 days'
          AND symbol LIKE '%.NS'
      ),
      agg AS (
        SELECT
          sym                                                          AS symbol,
          MAX(adj_close) FILTER (WHERE rn = 1)                        AS current_adj,
          AVG(adj_close) FILTER (WHERE rn <= 200)                     AS sma_200,
          MIN(adj_close) FILTER (WHERE rn <= 252)                     AS low_252d,
          SUM(volume)    FILTER (WHERE rn <= 20 AND is_up_day)        AS vol_up,
          SUM(volume)    FILTER (WHERE rn <= 20 AND NOT is_up_day)    AS vol_dn
        FROM ranked
        GROUP BY sym
      )
      SELECT
        symbol,
        (current_adj > sma_200)::boolean                              AS above_200sma,
        CASE WHEN low_252d > 0
             THEN ((current_adj - low_252d) / low_252d)::float END    AS off_52w_low_pct,
        CASE WHEN vol_dn > 0
             THEN (vol_up::float / vol_dn)::float END                 AS accum_ratio_20d
      FROM agg
      WHERE current_adj IS NOT NULL
    `,

    // Latest *substantive* exchange filing per symbol (last 90 days) for the
    // inline headline. DISTINCT ON + the (symbol, published_at DESC) index makes
    // this one row per symbol cheaply.
    //
    // Boilerplate filter: ~34% of BSE filings are pure procedural compliance —
    // trading-window closures, newspaper-publication intimations, analyst-meet
    // notices, ESOP/debt allotments, etc. Every company files these every
    // quarter; they carry zero differentiating signal and would crowd out the
    // one real catalyst. We exclude them by title pattern (NOT the "Regulation
    // 30 (LODR)" clause itself — that wraps half of ALL filings including real
    // news). If everything recent is boilerplate, the symbol shows no headline.
    //
    // Fail-soft: if app.announcement is absent in this environment, fall back to
    // an empty list rather than 500-ing the page.
    sql<LatestFiling[]>`
      SELECT DISTINCT ON (a.symbol)
        a.symbol,
        a.title              AS filing_title,
        a.category           AS filing_category,
        a.published_at::text AS filing_date,
        a.pdf_url            AS filing_url
      FROM app.announcement a
      WHERE a.published_at > now() - interval '90 days'
        AND a.title !~* ${FILING_NOISE_RE}
      ORDER BY a.symbol, a.published_at DESC NULLS LAST
    `.catch(() => [] as LatestFiling[]),
  ]);

  // Merge historical prices, recovery signals and latest filing by symbol.
  const histMap     = new Map(histRows.map((h) => [h.symbol, h]));
  const recoveryMap = new Map(recoveryRows.map((rv) => [rv.symbol, rv]));
  const filingMap   = new Map(filingRows.map((f) => [f.symbol, f]));

  const rowsWithPrices = rows.map((r) => {
    const h  = histMap.get(r.symbol);
    const rv = recoveryMap.get(r.symbol);
    const f  = filingMap.get(r.symbol);
    return {
      ...r,
      price_1m_ago:     h?.price_1m_ago     ?? null,
      price_3m_ago:     h?.price_3m_ago     ?? null,
      price_6m_ago:     h?.price_6m_ago     ?? null,
      price_1y_ago:     h?.price_1y_ago     ?? null,
      above_200sma:     rv?.above_200sma    ?? null,
      off_52w_low_pct:  rv?.off_52w_low_pct ?? null,
      accum_ratio_20d:  rv?.accum_ratio_20d ?? null,
      filing_title:     f?.filing_title     ?? null,
      filing_category:  f?.filing_category  ?? null,
      filing_date:      f?.filing_date      ?? null,
      filing_url:       f?.filing_url       ?? null,
    };
  });

  const nullReturns: NiftyReturns = { ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null };
  const benchmarkMap = new Map(niftyRows.map((r) => [r.index_code, r as NiftyReturns]));

  const benchmarks = {
    n50:  benchmarkMap.get("NIFTY50")  ?? nullReturns,
    n100: benchmarkMap.get("NIFTY100") ?? nullReturns,
    // NIFTY200 price history not tracked; NIFTY100 is the closest proxy.
    n200: benchmarkMap.get("NIFTY100") ?? nullReturns,
    n500: benchmarkMap.get("NIFTY500") ?? nullReturns,
  };

  return NextResponse.json({ rows: rowsWithPrices, benchmarks }, {
    headers: {
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
    },
  });
}
