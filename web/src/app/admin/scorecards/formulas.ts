/** All formula IDs known to the Python scoring engine, grouped by pillar.
 * Keep in sync with etl/src/fundamental_etl/scoring/formulas.py REGISTRY.
 *
 * Used by the admin scorecard editor to validate/suggest metric IDs.
 */

export const QUALITY_FORMULAS = [
  // Profitability
  "roe_3y", "roe_5y", "roe_latest",
  "roa_3y",
  "roce_3y", "roce_5y", "roce_latest",
  "op_margin_3y", "op_margin_5y", "op_margin_latest",
  "op_margin_trend", "op_margin_trend_3y", "op_margin_trend_7y",
  "ebitda_margin_3y",
  "gross_margin_3y", "gross_margin_5y", "gross_margin_latest", "gross_margin_trend",
  // Growth
  "rev_cagr_3y", "rev_cagr_5y", "rev_cagr_7y", "rev_cagr_10y",
  "np_cagr_3y", "np_cagr_5y", "np_cagr_7y", "np_cagr_10y",
  "rev_yoy_latest", "np_yoy_latest",
  "loan_book_cagr_3y",
  "book_value_cagr_3y", "book_value_cagr_5y", "book_value_cagr_7y", "book_value_cagr_10y",
  // Consistency
  "np_consistency_3y", "np_consistency_5y", "np_consistency_7y", "np_consistency_10y",
  "roe_avg_above_threshold_5y", "roe_avg_above_threshold_10y",
  "np_growth_above_inflation_10y",
  // Cash & balance sheet
  "cfo_pat_3y", "cfo_pat_latest", "cfo_ebitda_3y", "cfo_sales_3y",
  "debt_equity", "net_debt_ebitda", "interest_coverage", "equity_to_assets",
  "wc_days", "dso", "inv_days", "asset_turnover", "capex_intensity_3y",
] as const;

export const VALUATION_FORMULAS = [
  "pe_ttm", "pb", "ev_ebitda_ttm", "peg",
  "fcf_yield", "div_yield", "earnings_yield_trend",
  // Loss-maker fallbacks (also valid in main valuation if cluster wants)
  "ev_sales_ttm", "p_aum", "p_premium",
] as const;

export const MOMENTUM_FORMULAS = [
  "ret_3m_rel", "ret_6m_rel", "ret_12m_rel",
  "pct_above_200ema_252d", "ema_stack_bull", "tech_net_score_scaled",
  "sales_yoy_q", "np_yoy_q",
] as const;

export const FALLBACK_FORMULAS = [
  "ev_sales_ttm", "pb", "p_aum", "p_premium", "div_yield", "earnings_yield_trend",
] as const;
