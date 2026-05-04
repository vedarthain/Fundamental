/** Turns formula sub-percentiles into plain-English statements per pillar.
 *
 * Each formula has an "is-strength" framing (when sub_pct is high) and an
 * "is-gap" framing (when sub_pct is low). For each pillar, we surface the
 * top driver (strength) and bottom driver (gap), plus a one-line summary
 * derived from the pillar percentile band.
 *
 * This is the v1 placeholder for the AI narrative engine. Same UI shape;
 * Claude-generated narratives slot in later.
 */

export type Pillar = "Quality" | "Valuation" | "Momentum";

export type DriverLine = { label: string; subPct: number; kind: "up" | "down" };

export type PillarStory = {
  pillar: Pillar;
  pct: number | null;
  summary: string;
  strength: DriverLine | null;
  gap: DriverLine | null;
};

/** When sub_pct is HIGH, this stock is doing well on this metric. */
const STRENGTH_PHRASE: Record<string, string> = {
  // Quality — profitability
  roe_3y: "Returns on equity beat the cluster",
  roe_5y: "Returns on equity beat the cluster",
  roe_latest: "Latest year RoE is among the highest",
  roa_3y: "Returns on assets beat peers",
  roce_3y: "Returns on capital employed beat peers",
  roce_5y: "Returns on capital have stayed strong over five years",
  roce_latest: "Latest RoCE is top-tier",
  op_margin_3y: "Operating margins are above peers",
  op_margin_5y: "Operating margins consistently beat peers",
  op_margin_latest: "Latest operating margin is strong",
  op_margin_trend: "Operating margin is improving over time",
  op_margin_trend_3y: "Operating margin is improving",
  op_margin_trend_7y: "Operating margin has improved over seven years",
  ebitda_margin_3y: "EBITDA margins beat the cluster",
  gross_margin_3y: "Gross margins beat peers (pricing power)",
  gross_margin_5y: "Gross margins have stayed strong",
  gross_margin_latest: "Gross margin is among the highest",
  gross_margin_trend: "Gross margins are expanding",
  // Quality — growth
  rev_cagr_3y: "Revenue is growing faster than peers",
  rev_cagr_5y: "5-year revenue growth beats the cluster",
  rev_cagr_7y: "7-year revenue growth beats the cluster",
  rev_cagr_10y: "Decade of revenue growth ahead of peers",
  np_cagr_3y: "Profits are growing faster than peers",
  np_cagr_5y: "5-year profit growth beats the cluster",
  np_cagr_7y: "7-year profit growth beats the cluster",
  np_cagr_10y: "Decade of profit growth ahead of peers",
  rev_yoy_latest: "Latest year revenue jumped above peers",
  np_yoy_latest: "Latest year profit jumped above peers",
  loan_book_cagr_3y: "Loan book growing faster than peer banks",
  book_value_cagr_5y: "Book value is compounding faster than peers",
  book_value_cagr_7y: "Book value is compounding faster than peers",
  book_value_cagr_10y: "Book value has compounded for a decade",
  np_consistency_3y: "Profits steady year-after-year",
  np_consistency_5y: "Profits steady through the cycle",
  np_consistency_7y: "Profits steady over seven years",
  np_consistency_10y: "Profits steady over a full decade",
  roe_avg_above_threshold_5y: "RoE above 15% in most of last five years",
  roe_avg_above_threshold_10y: "RoE above 15% in most of last ten years",
  np_growth_above_inflation_10y: "Profit growth beats inflation in most years",
  // Quality — cash & balance sheet
  cfo_pat_3y: "Cash flow keeps pace with reported profit",
  cfo_pat_latest: "Latest year cash flow matches reported profit",
  cfo_ebitda_3y: "Cash conversion above peers",
  cfo_sales_3y: "Cash conversion from sales is strong",
  debt_equity: "Lower debt vs equity than peers",
  net_debt_ebitda: "Lower net debt to EBITDA than peers",
  interest_coverage: "Interest comfortably covered by profit",
  equity_to_assets: "Stronger capital cushion than peers",
  wc_days: "Working capital cycle tighter than peers",
  dso: "Receivables collected faster than peers",
  inv_days: "Inventory cycle tighter than peers",
  asset_turnover: "Generates more sales per rupee of assets",
  capex_intensity_3y: "Lower capex intensity than peers",
  // Valuation
  pe_ttm: "Cheaper P/E than the cluster",
  pb: "Cheaper P/B than the cluster",
  ev_ebitda_ttm: "Cheaper EV/EBITDA than the cluster",
  peg: "Cheaper PEG than the cluster",
  fcf_yield: "Higher free cash flow yield than peers",
  div_yield: "Higher dividend yield than peers",
  earnings_yield_trend: "Earnings yield trending up (re-rating room)",
  ev_sales_ttm: "Cheaper EV/Sales than peers",
  p_aum: "Cheaper price-to-AUM than peer NBFCs",
  p_premium: "Cheaper price-to-premium than peer insurers",
  // Momentum
  ret_3m_rel: "3-month return beats the market",
  ret_6m_rel: "6-month return beats the market",
  ret_12m_rel: "12-month return beats the market",
  pct_above_200ema_252d: "Trending above 200-day EMA most of the year",
  ema_stack_bull: "Moving averages stacked bullishly",
  tech_net_score_scaled: "Technical signals net bullish",
  sales_yoy_q: "Latest quarter sales growth beats peers",
  np_yoy_q: "Latest quarter profit growth beats peers",
};

/** When sub_pct is LOW, this stock is lagging peers. */
const GAP_PHRASE: Record<string, string> = {
  roe_3y: "RoE lags the cluster",
  roe_5y: "RoE has lagged peers for five years",
  roe_latest: "Latest year RoE is below peers",
  roa_3y: "RoA lags peer banks/NBFCs",
  roce_3y: "RoCE lags peers",
  roce_5y: "RoCE has lagged for five years",
  roce_latest: "Latest RoCE is below peers",
  op_margin_3y: "Operating margins lag peers",
  op_margin_5y: "Operating margins lag the cluster",
  op_margin_latest: "Latest operating margin is below peers",
  op_margin_trend: "Operating margin is shrinking",
  op_margin_trend_3y: "Operating margin is contracting",
  op_margin_trend_7y: "Operating margin has shrunk over seven years",
  ebitda_margin_3y: "EBITDA margins lag the cluster",
  gross_margin_3y: "Gross margins below peers — weak pricing power",
  gross_margin_5y: "Gross margins have lagged for five years",
  gross_margin_latest: "Latest gross margin is below peers",
  gross_margin_trend: "Gross margins are compressing",
  rev_cagr_3y: "Revenue growing slower than peers",
  rev_cagr_5y: "5-year revenue growth lags the cluster",
  rev_cagr_7y: "7-year revenue growth lags the cluster",
  rev_cagr_10y: "Decade of revenue growth below peers",
  np_cagr_3y: "Profit growth lags peers",
  np_cagr_5y: "5-year profit growth lags the cluster",
  np_cagr_7y: "7-year profit growth lags the cluster",
  np_cagr_10y: "Decade of profit growth below peers",
  rev_yoy_latest: "Latest year revenue lagged peers",
  np_yoy_latest: "Latest year profit lagged peers",
  loan_book_cagr_3y: "Loan book growth lags peer banks",
  book_value_cagr_5y: "Book value compounding lags peers",
  book_value_cagr_7y: "Book value compounding lags peers",
  book_value_cagr_10y: "Decade of book value growth lags peers",
  np_consistency_3y: "Profits volatile vs peers",
  np_consistency_5y: "Profits volatile vs peers",
  np_consistency_7y: "Profits volatile vs peers",
  np_consistency_10y: "Profits volatile vs peers over a decade",
  roe_avg_above_threshold_5y: "RoE rarely above 15% in last five years",
  roe_avg_above_threshold_10y: "RoE rarely above 15% in last ten years",
  np_growth_above_inflation_10y: "Profit growth often below inflation",
  cfo_pat_3y: "Cash flow lags reported profit (accrual flag)",
  cfo_pat_latest: "Latest cash flow lags reported profit",
  cfo_ebitda_3y: "Cash conversion below peers",
  cfo_sales_3y: "Weak cash flow from sales",
  debt_equity: "Higher debt vs equity than peers",
  net_debt_ebitda: "Higher net debt to EBITDA than peers",
  interest_coverage: "Interest coverage tight",
  equity_to_assets: "Capital cushion thinner than peers",
  wc_days: "Working capital cycle longer than peers",
  dso: "Receivables collected slower than peers",
  inv_days: "Inventory cycle longer than peers",
  asset_turnover: "Lower asset productivity than peers",
  capex_intensity_3y: "Higher capex intensity than peers",
  pe_ttm: "P/E richer than peers",
  pb: "P/B richer than peers",
  ev_ebitda_ttm: "EV/EBITDA richer than peers",
  peg: "PEG richer than peers",
  fcf_yield: "FCF yield below peers",
  div_yield: "Dividend yield below peers",
  earnings_yield_trend: "Earnings yield trending down",
  ev_sales_ttm: "EV/Sales richer than peers",
  p_aum: "Price-to-AUM richer than peer NBFCs",
  p_premium: "Price-to-premium richer than peer insurers",
  ret_3m_rel: "3-month return lags the market",
  ret_6m_rel: "6-month return lags the market",
  ret_12m_rel: "12-month return lags the market",
  pct_above_200ema_252d: "Stock spent most of the year below 200-day EMA",
  ema_stack_bull: "Moving averages not in bullish stack",
  tech_net_score_scaled: "Technical signals net bearish",
  sales_yoy_q: "Latest quarter sales growth lags peers",
  np_yoy_q: "Latest quarter profit growth lags peers",
};

function summary(p: Pillar, pct: number | null): string {
  if (pct == null) return "Not enough data to score this pillar.";
  if (pct >= 80) {
    if (p === "Quality") return "Excellent — among the strongest businesses in the cluster.";
    if (p === "Valuation") return "Attractive — meaningfully cheaper than peers.";
    return "Strong — both price action and earnings momentum lead the cluster.";
  }
  if (pct >= 60) {
    if (p === "Quality") return "Strong — clearly above the cluster median.";
    if (p === "Valuation") return "Reasonably valued — better than half the cluster.";
    return "Above the cluster median on price and earnings momentum.";
  }
  if (pct >= 40) {
    if (p === "Quality") return "Mid-pack — fundamentals broadly in line with peers.";
    if (p === "Valuation") return "Fairly priced — neither cheap nor expensive vs peers.";
    return "Mid-pack momentum — moving with the cluster, not against it.";
  }
  if (pct >= 20) {
    if (p === "Quality") return "Below median — multiple gaps vs the cluster.";
    if (p === "Valuation") return "Looks expensive vs cluster fundamentals.";
    return "Momentum is fading vs the cluster.";
  }
  if (p === "Quality") return "Weak — quality concerns across the board.";
  if (p === "Valuation") return "Pricing looks stretched vs peers.";
  return "Weak momentum — meaningfully behind the cluster.";
}

function bestAndWorst(components: Record<string, number>) {
  const entries = Object.entries(components).filter(([, v]) => v != null && !Number.isNaN(v));
  if (entries.length === 0) return { best: null, worst: null };
  entries.sort((a, b) => b[1] - a[1]);
  return { best: entries[0], worst: entries[entries.length - 1] };
}

export function buildPillarStory(
  pillar: Pillar,
  pct: number | null,
  components: Record<string, number>
): PillarStory {
  const { best, worst } = bestAndWorst(components);
  const strength: DriverLine | null = best
    ? {
        label: STRENGTH_PHRASE[best[0]] || best[0],
        subPct: best[1],
        kind: "up",
      }
    : null;
  const gap: DriverLine | null = worst && worst[1] < 50
    ? {
        label: GAP_PHRASE[worst[0]] || worst[0],
        subPct: worst[1],
        kind: "down",
      }
    : null;
  return {
    pillar,
    pct,
    summary: summary(pillar, pct),
    strength,
    gap,
  };
}
