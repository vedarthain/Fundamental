import { sql } from "@/lib/db";
import { loadTrailingReturns } from "@/lib/trailingReturns";

export type ReportStockRow = {
  // Identity
  symbol: string;
  company_name: string;
  sector: string;
  industry: string;
  market_cap_category: string | null;
  market_cap_cr: number | null;
  maturity_tier: string | null;
  is_nifty500: boolean;
  listing_date: string | null;

  // Price & Returns
  ltp: number | null;
  ret_1d: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;

  // Verdicts & Price Targets
  verdict: string | null;
  confidence: string | null;
  buy_below: number | null;
  target_price: number | null;
  fair_value: number | null;
  bear_floor: number | null;
  upside_pct: number | null;
  risk_reward: number | null;
  valuation_method: string | null;
  verdict_date: string | null;

  // Moat Audit
  moat_strength: string | null;
  moat_type: string | null;
  moat_rationale: string | null;

  // Factor Scores
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  peer_rank: number | null;
  peer_count: number | null;

  // Valuation & Fundamentals
  pe_ttm: number | null;
  pb: number | null;
  div_yield: number | null;
  roe_3y: number | null;
  op_margin_3y: number | null;
  sales_cagr_5y: number | null;
  profit_cagr_5y: number | null;

  // Portfolio Holdings
  is_in_portfolio: boolean;
  held_quantity: number | null;
  avg_cost: number | null;
  invested_value: number | null;
  current_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
};

let cachedReportRows: { rows: ReportStockRow[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export async function loadReportData(forceRefresh: boolean = false): Promise<ReportStockRow[]> {
  const now = Date.now();
  if (!forceRefresh && cachedReportRows && now - cachedReportRows.fetchedAt < CACHE_TTL_MS) {
    return cachedReportRows.rows;
  }

  const rawRows = await sql<any[]>`
    WITH latest_panel AS (
      SELECT
        p.symbol,
        p.company_name,
        p.cluster_id,
        p.maturity_tier,
        p.market_cap_cr,
        p.current_price AS cache_price,
        p.composite_pct,
        p.quality_pct,
        p.valuation_pct,
        p.momentum_pct,
        p.ret_1w,
        p.ret_1m,
        p.ret_1y,
        RANK() OVER (PARTITION BY p.cluster_id, p.maturity_tier ORDER BY p.composite_pct DESC NULLS LAST) AS peer_rank,
        COUNT(*) OVER (PARTITION BY p.cluster_id, p.maturity_tier) AS peer_count
      FROM app.cluster_stocks_panel_cache p
      WHERE p.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
    ),
    latest_verdict AS (
      SELECT DISTINCT ON (symbol)
        symbol,
        verdict,
        confidence,
        target_price,
        fair_value,
        buy_below,
        bear_floor,
        upside_pct,
        valuation_method,
        generated_at
      FROM app.stock_verdict
      ORDER BY symbol, generated_at DESC
    ),
    latest_metrics AS (
      SELECT
        symbol,
        (cluster_metrics->>'pe_ttm')::float AS pe_ttm,
        (cluster_metrics->>'pb')::float AS pb,
        COALESCE(
          (cluster_metrics->>'roe_3y')::float,
          (cluster_metrics->>'roce_3y')::float
        ) AS roe_3y,
        (cluster_metrics->>'div_yield')::float AS div_yield,
        (cluster_metrics->>'op_margin_3y')::float AS op_margin_3y,
        (cluster_metrics->>'np_cagr_5y')::float AS np_cagr_5y,
        (cluster_metrics->>'rev_cagr_5y')::float AS rev_cagr_5y
      FROM app.metrics_snapshot
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.metrics_snapshot)
    ),
    holdings AS (
      SELECT
        symbol,
        SUM(quantity) AS quantity,
        SUM(quantity * avg_cost) / NULLIF(SUM(quantity), 0) AS avg_cost,
        SUM(broker_cur_value) AS broker_cur_value
      FROM app.portfolio_holding
      WHERE quantity > 0
      GROUP BY symbol
    ),
    nifty500_set AS (
      SELECT symbol FROM app.index_constituent WHERE index_code = 'NIFTY500'
    )
    SELECT
      u.symbol,
      COALESCE(u.company_name, p.company_name, u.symbol) AS company_name,
      COALESCE(mc.name, u.sector, 'Other') AS sector,
      COALESCE(c.name, u.industry, 'General') AS industry,
      u.market_cap_category,
      COALESCE(p.market_cap_cr, sm.market_cap_cr) AS market_cap_cr,
      COALESCE(p.maturity_tier, u.maturity_tier) AS maturity_tier,
      u.listing_date::text AS listing_date,
      (n500.symbol IS NOT NULL) AS is_nifty500,

      -- Prices
      COALESCE(sm.current_price, p.cache_price) AS ltp,

      -- Verdict / Calls Desk
      v.verdict,
      v.confidence,
      v.buy_below,
      v.target_price,
      v.fair_value,
      v.bear_floor,
      v.upside_pct,
      v.valuation_method,
      to_char(v.generated_at, 'YYYY-MM-DD') AS verdict_date,

      -- Moat
      mo.moat_strength,
      mo.moat_type,
      COALESCE(mo.rationale, mo.moat_summary) AS moat_rationale,

      -- Scores & Ranks
      p.composite_pct,
      p.quality_pct,
      p.valuation_pct,
      p.momentum_pct,
      p.peer_rank,
      p.peer_count,

      -- Fundamentals
      m.pe_ttm,
      m.pb,
      m.div_yield,
      m.roe_3y,
      m.op_margin_3y,
      m.rev_cagr_5y AS sales_cagr_5y,
      m.np_cagr_5y AS profit_cagr_5y,

      -- Panel returns as baseline
      p.ret_1w,
      p.ret_1m,
      p.ret_1y,

      -- Portfolio
      (h.quantity > 0) AS is_in_portfolio,
      h.quantity AS held_quantity,
      h.avg_cost,
      (h.quantity * h.avg_cost) AS invested_value,
      h.broker_cur_value AS current_value
    FROM app.universe u
    LEFT JOIN latest_panel p ON p.symbol = u.symbol
    LEFT JOIN latest_verdict v ON v.symbol = u.symbol
    LEFT JOIN latest_metrics m ON m.symbol = u.symbol
    LEFT JOIN holdings h ON h.symbol = u.symbol
    LEFT JOIN app.company_moat mo ON mo.symbol = u.symbol
    LEFT JOIN app.screener_meta sm ON sm.symbol = u.symbol
    LEFT JOIN app.cluster c ON c.id = p.cluster_id
    LEFT JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    LEFT JOIN nifty500_set n500 ON n500.symbol = u.symbol
    WHERE u.is_active = TRUE
    ORDER BY p.composite_pct DESC NULLS LAST, u.symbol ASC
  `;

  // Trailing returns from golden if available
  let trailingMap = new Map<string, any>();
  try {
    const symbols = rawRows.map((r) => r.symbol);
    trailingMap = await loadTrailingReturns(symbols);
  } catch {
    // Non-fatal
  }

  const rows: ReportStockRow[] = rawRows.map((r) => {
    const tr = trailingMap.get(r.symbol);
    const ltp = r.ltp != null ? Number(r.ltp) : null;
    const target = r.target_price != null ? Number(r.target_price) : null;
    const bear = r.bear_floor != null ? Number(r.bear_floor) : null;

    let rr: number | null = null;
    if (ltp != null && target != null && bear != null && ltp > bear && target > ltp) {
      rr = Math.round(((target - ltp) / (ltp - bear)) * 10) / 10;
    }

    const toPct = (val: any) => (val != null ? Math.round(Number(val) * 1000) / 10 : null);

    const ret1d = tr?.ret_1d != null ? toPct(tr.ret_1d) : null;
    const ret1w = tr?.ret_1w != null ? toPct(tr.ret_1w) : toPct(r.ret_1w);
    const ret1m = tr?.ret_1m != null ? toPct(tr.ret_1m) : toPct(r.ret_1m);
    const ret1y = tr?.ret_1y != null ? toPct(tr.ret_1y) : toPct(r.ret_1y);

    const heldQty = r.held_quantity != null ? Number(r.held_quantity) : null;
    const avgCost = r.avg_cost != null ? Number(r.avg_cost) : null;
    const invVal = heldQty != null && avgCost != null ? heldQty * avgCost : null;
    const curVal = heldQty != null && ltp != null ? heldQty * ltp : (r.current_value != null ? Number(r.current_value) : null);
    const pnl = invVal != null && curVal != null ? curVal - invVal : null;
    const pnlPct = invVal != null && curVal != null && invVal > 0 ? Math.round(((curVal - invVal) / invVal) * 1000) / 10 : null;

    return {
      symbol: r.symbol,
      company_name: r.company_name,
      sector: r.sector,
      industry: r.industry,
      market_cap_category: r.market_cap_category,
      market_cap_cr: r.market_cap_cr != null ? Math.round(Number(r.market_cap_cr)) : null,
      maturity_tier: r.maturity_tier ? r.maturity_tier.toUpperCase() : null,
      is_nifty500: Boolean(r.is_nifty500),
      listing_date: r.listing_date ?? null,

      ltp: ltp != null ? Math.round(ltp * 100) / 100 : null,
      ret_1d: ret1d,
      ret_1w: ret1w,
      ret_1m: ret1m,
      ret_1y: ret1y,

      verdict: r.verdict ?? null,
      confidence: r.confidence ? r.confidence.toUpperCase() : null,
      buy_below: r.buy_below != null ? Math.round(Number(r.buy_below) * 100) / 100 : null,
      target_price: target != null ? Math.round(target * 100) / 100 : null,
      fair_value: r.fair_value != null ? Math.round(Number(r.fair_value) * 100) / 100 : null,
      bear_floor: bear != null ? Math.round(bear * 100) / 100 : null,
      upside_pct: r.upside_pct != null ? Math.round(Number(r.upside_pct) * 10) / 10 : null,
      risk_reward: rr,
      valuation_method: r.valuation_method ?? null,
      verdict_date: r.verdict_date ?? null,

      moat_strength: r.moat_strength ? r.moat_strength.toUpperCase() : null,
      moat_type: r.moat_type ?? null,
      moat_rationale: r.moat_rationale ?? null,

      composite_pct: r.composite_pct != null ? Math.round(Number(r.composite_pct)) : null,
      quality_pct: r.quality_pct != null ? Math.round(Number(r.quality_pct)) : null,
      valuation_pct: r.valuation_pct != null ? Math.round(Number(r.valuation_pct)) : null,
      momentum_pct: r.momentum_pct != null ? Math.round(Number(r.momentum_pct)) : null,
      peer_rank: r.peer_rank != null ? Number(r.peer_rank) : null,
      peer_count: r.peer_count != null ? Number(r.peer_count) : null,

      pe_ttm: r.pe_ttm != null ? Math.round(Number(r.pe_ttm) * 10) / 10 : null,
      pb: r.pb != null ? Math.round(Number(r.pb) * 10) / 10 : null,
      div_yield: r.div_yield != null ? Math.round(Number(r.div_yield) * 100) / 100 : null,
      roe_3y: r.roe_3y != null ? Math.round(Number(r.roe_3y) * 10) / 10 : null,
      op_margin_3y: r.op_margin_3y != null ? Math.round(Number(r.op_margin_3y) * 10) / 10 : null,
      sales_cagr_5y: r.sales_cagr_5y != null ? Math.round(Number(r.sales_cagr_5y) * 10) / 10 : null,
      profit_cagr_5y: r.profit_cagr_5y != null ? Math.round(Number(r.profit_cagr_5y) * 10) / 10 : null,

      is_in_portfolio: Boolean(r.is_in_portfolio),
      held_quantity: heldQty,
      avg_cost: avgCost != null ? Math.round(avgCost * 100) / 100 : null,
      invested_value: invVal != null ? Math.round(invVal) : null,
      current_value: curVal != null ? Math.round(curVal) : null,
      unrealized_pnl: pnl != null ? Math.round(pnl) : null,
      unrealized_pnl_pct: pnlPct,
    };
  });

  cachedReportRows = { rows, fetchedAt: Date.now() };
  return rows;
}
