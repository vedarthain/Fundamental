/**
 * oi-alerts.ts — one-time "other income" spike detection.
 *
 * Problem:
 *   Screener reports "Other Income" as a separate line in the P&L.  For most
 *   quarters this is modest (treasury income, forex, dividend from subs).  But
 *   occasionally a company books a very large one-time gain here — stake sale,
 *   debt restructuring, demerger accounting, or a fair-value revaluation.
 *
 *   When that happens the quarterly net profit (and therefore TTM earnings) is
 *   inflated.  Downstream scoring metrics that use net profit — P/E TTM,
 *   np_cagr_5y, roe_avg*, np_growth_above_inflation* — all move in the stock's
 *   favour even though the underlying business didn't improve.  Result: the
 *   composite score jumps by 20-30 points with no real business change.
 *
 * Detection heuristics (both conditions must hold):
 *   1. Other income > 40% of PBT in the LATEST quarter.
 *   2. Other income > 5× the average of the PRIOR 2–9 quarters.
 *   3. Absolute OI ≥ ₹10 Cr (avoids micro-cap noise).
 *   4. At least 3 prior quarters available (otherwise we have no baseline).
 *   5. NOT a financial-sector stock (insurers, banks — investment income is
 *      their core business, so a high OI/PBT ratio is structural, not anomalous).
 *
 * Exclusions:
 *   - meta_cluster_id = 'financials' is always excluded.
 *
 * Usage:
 *   • getOIAlertForSymbol(symbol, sectorId) — single stock (stock page).
 *   • getOIAlerts(symbols)                  — batch (ideas page, screener).
 */
import "server-only";
import { sql } from "@/lib/db";

export type OIAlert = {
  symbol: string;
  /** YYYY-MM-DD of the latest quarter where the spike was detected */
  period_end: string;
  /** Other income in that quarter (₹ Cr) */
  oi_cr: number;
  /** Average other income across prior 2–9 quarters (₹ Cr) */
  avg_prior_oi: number;
  /** oi_cr / avg_prior_oi — how many times larger than the baseline */
  spike_ratio: number;
  /** other_income / profit_before_tax × 100 */
  oi_pct_pbt: number;
};

// ---------------------------------------------------------------------------
// Shared SQL fragment — CTE chain that detects the spike.
// Used by both single-symbol and batch variants.
// ---------------------------------------------------------------------------
const SPIKE_THRESHOLD_PCT_PBT = 0.40;   // 40% of PBT
const SPIKE_THRESHOLD_RATIO   = 5;      // 5× prior average
const MIN_OI_CR                = 10;    // ₹10 Cr floor

/**
 * Batch variant — returns a Map<symbol, OIAlert> for every affected symbol in
 * the input list.  One DB round-trip regardless of how many symbols.
 *
 * Sector exclusion: joins scores → cluster → meta_cluster and filters out
 * 'financials'.  Symbols not found in app.scores (unscored) are skipped
 * gracefully (LEFT JOIN defaults to non-financial).
 */
export async function getOIAlerts(
  symbols: string[],
): Promise<Map<string, OIAlert>> {
  if (symbols.length === 0) return new Map();

  const rows = await sql<OIAlert[]>`
    WITH
    -- Latest quarter per symbol
    latest_q AS (
      SELECT DISTINCT ON (symbol)
        symbol,
        period_end::text  AS period_end,
        other_income,
        profit_before_tax
      FROM app.fundamentals_quarterly
      WHERE symbol         = ANY(${symbols})
        AND profit_before_tax  > 0
        AND other_income  IS NOT NULL
      ORDER BY symbol, period_end DESC
    ),
    -- 8-quarter baseline (excluding the latest quarter itself)
    prior_avg AS (
      SELECT symbol,
             AVG(GREATEST(other_income, 0)) AS avg_prior_oi,
             COUNT(*)                        AS n_prior
      FROM (
        SELECT symbol,
               other_income,
               ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY period_end DESC) AS rn
          FROM app.fundamentals_quarterly
         WHERE symbol = ANY(${symbols})
           AND other_income IS NOT NULL
      ) r
      WHERE rn BETWEEN 2 AND 9
      GROUP BY symbol
      HAVING COUNT(*) >= 3
    ),
    -- Latest cluster per symbol (to resolve meta_cluster for sector exclusion)
    latest_cluster AS (
      SELECT DISTINCT ON (symbol)
        symbol,
        cluster_id
      FROM app.scores
      WHERE symbol = ANY(${symbols})
      ORDER BY symbol, snapshot_date DESC
    )
    SELECT
      lq.symbol,
      lq.period_end,
      ROUND(lq.other_income)::float                                      AS oi_cr,
      ROUND(pa.avg_prior_oi)::float                                      AS avg_prior_oi,
      ROUND((lq.other_income / NULLIF(pa.avg_prior_oi, 0))::numeric, 1)::float AS spike_ratio,
      ROUND((lq.other_income / lq.profit_before_tax * 100)::numeric, 1)::float AS oi_pct_pbt
    FROM latest_q lq
    JOIN prior_avg     pa  ON pa.symbol     = lq.symbol
    -- Sector exclusion: drop financials
    JOIN latest_cluster lc ON lc.symbol    = lq.symbol
    JOIN app.cluster    c  ON c.id         = lc.cluster_id
    JOIN app.meta_cluster mc ON mc.id      = c.meta_cluster_id
    WHERE
      lq.other_income >= ${MIN_OI_CR}
      AND lq.other_income / lq.profit_before_tax   > ${SPIKE_THRESHOLD_PCT_PBT}
      AND lq.other_income / NULLIF(pa.avg_prior_oi, 0) > ${SPIKE_THRESHOLD_RATIO}
      AND mc.id != 'financials'
  `;

  return new Map(rows.map((r) => [r.symbol, r]));
}

/**
 * Single-symbol variant — used by the stock page where we already know the
 * sector (meta_cluster_id) and can skip the cluster JOIN.
 *
 * Returns null for financial-sector stocks or stocks that don't trigger the
 * spike criteria.
 */
export async function getOIAlertForSymbol(
  symbol: string,
  /** meta_cluster_id from app.meta_cluster.id — e.g. "financials", "materials" */
  sectorId: string,
): Promise<OIAlert | null> {
  if (sectorId === "financials") return null;

  const rows = await sql<OIAlert[]>`
    WITH
    latest_q AS (
      SELECT DISTINCT ON (symbol)
        symbol,
        period_end::text AS period_end,
        other_income,
        profit_before_tax
      FROM app.fundamentals_quarterly
      WHERE symbol = ${symbol}
        AND profit_before_tax  > 0
        AND other_income IS NOT NULL
      ORDER BY symbol, period_end DESC
    ),
    prior_avg AS (
      SELECT symbol,
             AVG(GREATEST(other_income, 0)) AS avg_prior_oi,
             COUNT(*)                        AS n_prior
      FROM (
        SELECT symbol,
               other_income,
               ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY period_end DESC) AS rn
          FROM app.fundamentals_quarterly
         WHERE symbol = ${symbol}
           AND other_income IS NOT NULL
      ) r
      WHERE rn BETWEEN 2 AND 9
      GROUP BY symbol
      HAVING COUNT(*) >= 3
    )
    SELECT
      lq.symbol,
      lq.period_end,
      ROUND(lq.other_income)::float                                      AS oi_cr,
      ROUND(pa.avg_prior_oi)::float                                      AS avg_prior_oi,
      ROUND((lq.other_income / NULLIF(pa.avg_prior_oi, 0))::numeric, 1)::float AS spike_ratio,
      ROUND((lq.other_income / lq.profit_before_tax * 100)::numeric, 1)::float AS oi_pct_pbt
    FROM latest_q lq
    JOIN prior_avg pa ON pa.symbol = lq.symbol
    WHERE
      lq.other_income >= ${MIN_OI_CR}
      AND lq.other_income / lq.profit_before_tax   > ${SPIKE_THRESHOLD_PCT_PBT}
      AND lq.other_income / NULLIF(pa.avg_prior_oi, 0) > ${SPIKE_THRESHOLD_RATIO}
  `;

  return rows[0] ?? null;
}
