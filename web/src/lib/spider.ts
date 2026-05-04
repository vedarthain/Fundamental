/** Build the 5-axis radar data for a stock vs its (cluster, tier) median.
 *
 * The five standardized axes (per REQUIREMENTS.md §1a):
 *   Profitability, Growth, Cash & Balance Sheet, Valuation, Momentum
 *
 * Each axis is a percentile (0-100). Cluster-aware roll-up: which underlying
 * components feed each axis depends on the cluster's scorecard.
 */

export type SpiderAxis = "Profitability" | "Growth" | "Cash & BS" | "Valuation" | "Momentum";
export type ComponentMap = Record<string, number>;  // {formula_id: percentile}

const PROFITABILITY = new Set([
  "roe_3y", "roe_5y", "roe_latest",
  "roa_3y",
  "roce_3y", "roce_5y", "roce_latest",
  "op_margin_3y", "op_margin_5y", "op_margin_latest",
  "op_margin_trend", "op_margin_trend_3y", "op_margin_trend_7y",
  "ebitda_margin_3y",
  "gross_margin_3y", "gross_margin_5y", "gross_margin_latest", "gross_margin_trend",
  "roe_avg_above_threshold_5y", "roe_avg_above_threshold_10y",
]);

const GROWTH = new Set([
  "rev_cagr_3y", "rev_cagr_5y", "rev_cagr_7y", "rev_cagr_10y",
  "np_cagr_3y", "np_cagr_5y", "np_cagr_7y", "np_cagr_10y",
  "rev_yoy_latest", "np_yoy_latest",
  "loan_book_cagr_3y",
  "book_value_cagr_3y", "book_value_cagr_5y", "book_value_cagr_7y", "book_value_cagr_10y",
  "np_growth_above_inflation_10y",
]);

const CASH_BS = new Set([
  "cfo_pat_3y", "cfo_pat_latest", "cfo_ebitda_3y", "cfo_sales_3y",
  "debt_equity", "net_debt_ebitda", "interest_coverage", "equity_to_assets",
  "wc_days", "dso", "inv_days", "asset_turnover", "capex_intensity_3y",
  "np_consistency_3y", "np_consistency_5y", "np_consistency_7y", "np_consistency_10y",
]);

const VALUATION = new Set([
  "pe_ttm", "pb", "ev_ebitda_ttm", "peg",
  "fcf_yield", "div_yield", "earnings_yield_trend",
  "ev_sales_ttm", "p_aum", "p_premium",
]);

const MOMENTUM = new Set([
  "ret_3m_rel", "ret_6m_rel", "ret_12m_rel",
  "pct_above_200ema_252d", "ema_stack_bull", "tech_net_score_scaled",
  "sales_yoy_q", "np_yoy_q",
]);

function bucket(name: string): SpiderAxis | null {
  if (PROFITABILITY.has(name)) return "Profitability";
  if (GROWTH.has(name)) return "Growth";
  if (CASH_BS.has(name)) return "Cash & BS";
  if (VALUATION.has(name)) return "Valuation";
  if (MOMENTUM.has(name)) return "Momentum";
  return null;
}

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function buildSpider(
  q: ComponentMap,
  v: ComponentMap,
  m: ComponentMap,
): { axis: SpiderAxis; value: number | null }[] {
  const groups: Record<SpiderAxis, number[]> = {
    Profitability: [],
    Growth: [],
    "Cash & BS": [],
    Valuation: [],
    Momentum: [],
  };
  for (const src of [q, v, m]) {
    for (const [k, vv] of Object.entries(src)) {
      const ax = bucket(k);
      if (ax && vv != null && !Number.isNaN(vv)) groups[ax].push(Number(vv));
    }
  }
  return (["Profitability", "Growth", "Cash & BS", "Valuation", "Momentum"] as SpiderAxis[])
    .map((ax) => ({ axis: ax, value: avg(groups[ax]) }));
}
