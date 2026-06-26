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
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const revalidate = 86400;

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
};

export async function GET() {
  const rows = await sql<Row[]>`
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
      COALESCE(u.is_nifty50,  false)                      AS is_nifty50,
      COALESCE(u.is_nifty200, false)                      AS is_nifty200,
      COALESCE(u.is_nifty500, false)                      AS is_nifty500,
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
    WHERE u.is_active
    ORDER BY r.quality_pct DESC NULLS LAST, r.valuation_pct DESC NULLS LAST
  `;

  return NextResponse.json(rows, {
    headers: {
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
    },
  });
}
