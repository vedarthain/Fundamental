/** Generates 2–3 sentence stock-specific narration per pillar.
 *
 * Pulls from the stock's actual fundamentals + computed scores. Falls back
 * gracefully when data is missing. v1 is template-based; in Phase 3 the
 * narrative engine will substitute LLM-generated text using the same data.
 */

type AnnualLite = {
  period_end: string;
  sales: number | null;
  operating_profit: number | null;
  net_profit: number | null;
  cash_from_operating: number | null;
  borrowings: number | null;
  equity_share_capital: number | null;
  reserves: number | null;
};

type QuarterlyLite = {
  period_end: string;
  sales: number | null;
  operating_profit: number | null;
  net_profit: number | null;
};

type StockMeta = {
  company_name: string;
  symbol: string;
  market_cap_cr: number | null;
  current_price: number | null;
  industry_name: string;
  composite_pct: number | null;
};

type Components = Record<string, number>;

const fyOf = (iso: string) => `FY${String(new Date(iso).getFullYear()).slice(-2)}`;
const fmtCr = (n: number) =>
  n >= 100_000 ? `₹${(n / 1000).toFixed(0)}K Cr` :
  n >= 1_000   ? `₹${(n / 1000).toFixed(1)}K Cr` :
                 `₹${Math.round(n).toLocaleString("en-IN")} Cr`;
const fmtPct = (v: number, decimals = 1) => `${(v * 100).toFixed(decimals)}%`;
const signed = (v: number, decimals = 1) => (v >= 0 ? "+" : "") + (v * 100).toFixed(decimals) + "%";

/** Quality narration — focuses on returns, growth, consistency. */
export function qualityNarration(
  stock: StockMeta,
  annual: AnnualLite[],
  q_components: Components,
  pct: number | null,
): string {
  if (annual.length === 0) return defaultLine("Quality", stock, pct);
  const first = annual[0];
  const last = annual[annual.length - 1];
  const pieces: string[] = [];

  // RoE statement
  const eq = (last.equity_share_capital ?? 0) + (last.reserves ?? 0);
  if (last.net_profit != null && eq > 0) {
    const roe = last.net_profit / eq;
    const roeFirst = first.equity_share_capital !== null && first.reserves !== null
      ? first.net_profit && (first.equity_share_capital + first.reserves) > 0
        ? first.net_profit / (first.equity_share_capital + first.reserves)
        : null
      : null;
    const roeWord = roe >= 0.20 ? "strong" : roe >= 0.12 ? "decent" : roe >= 0.05 ? "modest" : roe < 0 ? "negative" : "weak";
    let s = `${stock.company_name || stock.symbol} delivers ${roeWord} returns on equity (${fmtPct(roe, 1)} in ${fyOf(last.period_end)})`;
    if (roeFirst != null && Math.abs(roe - roeFirst) > 0.02) {
      s += `, ${roe > roeFirst ? "up from" : "down from"} ${fmtPct(roeFirst, 1)} in ${fyOf(first.period_end)}`;
    }
    pieces.push(s + ".");
  }

  // Operating margin trajectory
  const opmFirst = first.sales && first.sales > 0 && first.operating_profit != null ? first.operating_profit / first.sales : null;
  const opmLast = last.sales && last.sales > 0 && last.operating_profit != null ? last.operating_profit / last.sales : null;
  if (opmFirst != null && opmLast != null) {
    const delta = (opmLast - opmFirst) * 100;
    const dir = Math.abs(delta) < 1 ? "broadly stable" :
                delta > 0 ? `expanded by ${delta.toFixed(1)} pp` :
                            `contracted by ${Math.abs(delta).toFixed(1)} pp`;
    pieces.push(`Operating margin has ${dir} since ${fyOf(first.period_end)}, currently at ${fmtPct(opmLast, 1)}.`);
  }

  // Cash conversion
  if (last.net_profit != null && last.net_profit > 0 && last.cash_from_operating != null) {
    const conv = last.cash_from_operating / last.net_profit;
    const word = conv >= 1.0 ? "exceeds" : conv >= 0.7 ? "broadly tracks" : "lags";
    pieces.push(`Cash from operations ${word} reported profit (₹${last.cash_from_operating.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr CFO vs ₹${last.net_profit.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr net profit).`);
  }

  // Closing note from cluster percentile
  if (pct != null) {
    const where = pct >= 75 ? `top quartile` : pct >= 50 ? `above-median` : pct >= 25 ? `below-median` : `bottom quartile`;
    pieces.push(`On the cluster scorecard the business sits in the ${where} for quality (${Math.round(pct)} pct in ${stock.industry_name}).`);
  }

  return pieces.join(" ") || defaultLine("Quality", stock, pct);
}

/** Valuation narration — current multiples vs peers. */
export function valuationNarration(
  stock: StockMeta,
  v_components: Components,
  pct: number | null,
): string {
  const pieces: string[] = [];
  const mc = stock.market_cap_cr;
  const pe = v_components["pe_ttm"];
  const pb = v_components["pb"];

  // Headline valuation
  if (mc != null && stock.current_price != null) {
    pieces.push(`At ₹${stock.current_price.toLocaleString("en-IN")} per share (${fmtCr(mc)} market cap), ${stock.company_name || stock.symbol} is currently valued by the market.`);
  }

  // P/E vs peers via percentile
  if (pe != null) {
    const where = pe >= 70 ? "cheap relative to peers" :
                  pe >= 50 ? "reasonably priced for the cluster" :
                  pe >= 30 ? "richer than the cluster median" :
                              "expensive vs peers";
    pieces.push(`Its earnings multiple is ${where} (P/E percentile ${Math.round(pe)} within ${stock.industry_name}).`);
  } else if (pb != null) {
    const where = pb >= 70 ? "cheap on book value vs peers" :
                  pb >= 50 ? "fairly valued on book vs peers" :
                              "richer on book than the cluster median";
    pieces.push(`On book value, the stock is ${where} (P/B percentile ${Math.round(pb)} within ${stock.industry_name}).`);
  }

  // Bottom line: pillar percentile
  if (pct != null) {
    const where = pct >= 75 ? "among the most attractively priced" :
                  pct >= 50 ? "better-than-average value" :
                  pct >= 25 ? "fairly priced to slightly expensive" :
                              "expensive vs the cluster";
    pieces.push(`Overall, the valuation pillar puts it as ${where} in ${stock.industry_name} (${Math.round(pct)} pct).`);
  }

  return pieces.join(" ") || defaultLine("Valuation", stock, pct);
}

/** Momentum narration — price action + earnings momentum. */
export function momentumNarration(
  stock: StockMeta,
  m_components: Components,
  quarterly: QuarterlyLite[],
  pct: number | null,
): string {
  const pieces: string[] = [];
  const r12 = m_components["ret_12m_rel"];
  const above = m_components["pct_above_200ema_252d"];

  // 12-month relative return
  if (r12 != null) {
    const where = r12 >= 75 ? "well ahead of the broader market" :
                  r12 >= 50 ? "ahead of the broader market" :
                  r12 >= 25 ? "behind the broader market" :
                              "well behind the broader market";
    pieces.push(`Over the past year, the stock has performed ${where} (${Math.round(r12)} pct on 12-month relative return).`);
  }

  // Trend persistence
  if (above != null) {
    const where = above >= 75 ? "spent most" :
                  above >= 50 ? "spent more than half" :
                  above >= 25 ? "spent less than half" :
                                "spent very little";
    pieces.push(`It ${where} of the last year above its 200-day moving average (${Math.round(above)} pct on trend persistence).`);
  }

  // Latest quarter earnings momentum
  if (quarterly.length >= 5) {
    const cur = quarterly[quarterly.length - 1];
    const yoy = quarterly[quarterly.length - 5];
    if (cur.sales != null && yoy.sales != null && Math.abs(yoy.sales) > 0) {
      const sg = (cur.sales - yoy.sales) / Math.abs(yoy.sales);
      let s = `Latest quarter (${fyOf(cur.period_end)} ${cur.period_end.slice(5, 7)}) sales ${signed(sg, 1)} YoY`;
      if (cur.net_profit != null && yoy.net_profit != null && Math.abs(yoy.net_profit) > 0) {
        const ng = (cur.net_profit - yoy.net_profit) / Math.abs(yoy.net_profit);
        s += ` with net profit ${signed(ng, 1)}.`;
      } else {
        s += ".";
      }
      pieces.push(s);
    }
  }

  if (pct != null) {
    const verdict = pct >= 75 ? "the market is firmly endorsing the thesis" :
                    pct >= 50 ? "the market is broadly with this stock" :
                    pct >= 25 ? "the market is unconvinced" :
                                 "the market is actively against this stock";
    pieces.push(`On the momentum pillar, ${verdict} (${Math.round(pct)} pct in ${stock.industry_name}).`);
  }

  return pieces.join(" ") || defaultLine("Momentum", stock, pct);
}

function defaultLine(pillar: string, stock: StockMeta, pct: number | null): string {
  if (pct == null) return `Insufficient data to score ${pillar.toLowerCase()} for ${stock.company_name || stock.symbol}.`;
  return `${stock.company_name || stock.symbol} scores ${Math.round(pct)} on the ${pillar.toLowerCase()} pillar within ${stock.industry_name}.`;
}
