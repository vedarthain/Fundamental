/**
 * Portfolio Dividend read model & forecast calculator.
 *
 * Sourced from:
 *   - `app.portfolio_holding`: Held positions (quantity, avg cost, current value).
 *   - `app.corporate_action`: BSE dividend events (action_type = 'dividend', ex_date, amount, purpose).
 *   - `app.metrics_snapshot`: cluster_metrics->>'div_yield'.
 *
 * Computes:
 *   - Confirmed upcoming dividend payouts (ex_date >= CURRENT_DATE).
 *   - Trailing 12-month (TTM) realized / projected annual dividend income.
 *   - Blended portfolio dividend yield & Yield on Cost (YoC).
 *   - Monthly cash flow seasonality timeline.
 *   - Per-holding dividend breakdown for interactive what-if simulation.
 */
import "server-only";
import { sql } from "@/lib/db";

export type DividendEvent = {
  symbol: string;
  companyName: string | null;
  exDate: string; // YYYY-MM-DD
  purpose: string;
  amount: number; // ₹ per share
  heldQty: number;
  payout: number; // heldQty * amount
  isUpcoming: boolean;
};

export type HoldingDividend = {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  quantity: number;
  avgCost: number | null;
  invested: number;
  currentPrice: number | null;
  currentValue: number;
  divYield: number | null; // % (e.g. 2.5)
  yieldOnCost: number | null; // % (e.g. 3.1)
  ttmDps: number; // total dividend per share in last 365 days
  annualPayout: number; // quantity * ttmDps (or currentValue * divYield)
  paymentCount: number;
  latestExDate: string | null;
  latestAmount: number | null;
  upcomingEvent: DividendEvent | null;
};

export type MonthlyDividend = {
  month: string; // YYYY-MM
  label: string; // e.g. "Sep 2026"
  payout: number;
  eventCount: number;
};

export type PortfolioDividendReport = {
  hasHoldings: boolean;
  totalHoldings: number;
  dividendPayingCount: number;
  totalAnnualPayout: number;
  totalInvested: number;
  totalCurrentValue: number;
  portfolioYield: number; // %
  portfolioYieldOnCost: number; // %
  upcomingPayout: number;
  upcomingCount: number;
  monthlyHistory: MonthlyDividend[];
  recentEvents: DividendEvent[];
  upcomingEvents: DividendEvent[];
  holdings: HoldingDividend[];
};

export async function loadPortfolioDividends(userId: number): Promise<PortfolioDividendReport> {
  const empty: PortfolioDividendReport = {
    hasHoldings: false,
    totalHoldings: 0,
    dividendPayingCount: 0,
    totalAnnualPayout: 0,
    totalInvested: 0,
    totalCurrentValue: 0,
    portfolioYield: 0,
    portfolioYieldOnCost: 0,
    upcomingPayout: 0,
    upcomingCount: 0,
    monthlyHistory: [],
    recentEvents: [],
    upcomingEvents: [],
    holdings: [],
  };

  try {
    // 1. Fetch user holdings with company name, sector, and latest metrics
    const holdingsRows = await sql<{
      symbol: string;
      company_name: string | null;
      sector: string | null;
      qty: number;
      avg_cost: number | null;
      cur_val: number;
      ltp: number | null;
      div_yield: string | null;
    }[]>`
      WITH user_h AS (
        SELECT 
          h.symbol,
          SUM(h.quantity)::float8 as qty,
          (SUM(h.avg_cost * h.quantity) / NULLIF(SUM(h.quantity), 0))::float8 as avg_cost,
          SUM(COALESCE(h.broker_cur_value, h.quantity * h.broker_ltp))::float8 as cur_val,
          (SUM(COALESCE(h.broker_cur_value, h.quantity * h.broker_ltp)) / NULLIF(SUM(h.quantity), 0))::float8 as ltp
        FROM app.portfolio_holding h
        WHERE h.user_id = ${userId} AND h.symbol IS NOT NULL AND h.quantity > 0
        GROUP BY h.symbol
      )
      SELECT 
        h.symbol,
        u.company_name,
        u.sector,
        h.qty,
        h.avg_cost,
        h.cur_val,
        h.ltp,
        m.cluster_metrics->>'div_yield' as div_yield
      FROM user_h h
      LEFT JOIN app.universe u ON u.symbol = h.symbol
      LEFT JOIN (
        SELECT DISTINCT ON (symbol) symbol, cluster_metrics
        FROM app.metrics_snapshot
        ORDER BY symbol, snapshot_date DESC
      ) m ON m.symbol = h.symbol
      ORDER BY h.cur_val DESC NULLS LAST
    `;

    if (holdingsRows.length === 0) {
      return empty;
    }

    const heldSymbols = holdingsRows.map((r) => r.symbol);
    const qtyBySymbol = new Map<string, number>();
    for (const r of holdingsRows) {
      qtyBySymbol.set(r.symbol, r.qty);
    }

    // 2. Fetch dividend corporate actions for held symbols (past 365 days + upcoming)
    const caRows = await sql<{
      symbol: string;
      ex_date: string;
      purpose: string | null;
      amount: number;
      company_name: string | null;
      is_upcoming: boolean;
    }[]>`
      SELECT 
        ca.symbol,
        ca.ex_date::text,
        ca.purpose,
        ca.amount::float8 as amount,
        u.company_name,
        (ca.ex_date >= CURRENT_DATE) as is_upcoming
      FROM app.corporate_action ca
      LEFT JOIN app.universe u ON u.symbol = ca.symbol
      WHERE ca.symbol = ANY(${heldSymbols})
        AND ca.action_type = 'dividend'
        AND ca.amount IS NOT NULL
        AND ca.ex_date >= CURRENT_DATE - INTERVAL '365 days'
      ORDER BY ca.ex_date DESC
    `;

    // Process corporate actions into upcoming & recent events
    const upcomingEvents: DividendEvent[] = [];
    const recentEvents: DividendEvent[] = [];
    const ttmDpsBySymbol = new Map<string, { totalDps: number; count: number; latestDate: string; latestAmt: number }>();
    const upcomingBySymbol = new Map<string, DividendEvent>();

    const monthlyMap = new Map<string, { payout: number; count: number }>();

    for (const ca of caRows) {
      const heldQty = qtyBySymbol.get(ca.symbol) ?? 0;
      if (heldQty <= 0) continue;

      const payout = heldQty * ca.amount;
      const event: DividendEvent = {
        symbol: ca.symbol,
        companyName: ca.company_name,
        exDate: ca.ex_date,
        purpose: ca.purpose || "Dividend",
        amount: ca.amount,
        heldQty,
        payout,
        isUpcoming: ca.is_upcoming,
      };

      if (ca.is_upcoming) {
        upcomingEvents.push(event);
        if (!upcomingBySymbol.has(ca.symbol)) {
          upcomingBySymbol.set(ca.symbol, event);
        }
      } else {
        recentEvents.push(event);

        // Aggregate monthly history for past payouts
        const monthKey = ca.ex_date.slice(0, 7); // YYYY-MM
        const curM = monthlyMap.get(monthKey) ?? { payout: 0, count: 0 };
        curM.payout += payout;
        curM.count += 1;
        monthlyMap.set(monthKey, curM);
      }

      // Track TTM DPS
      const prev = ttmDpsBySymbol.get(ca.symbol) ?? {
        totalDps: 0,
        count: 0,
        latestDate: ca.ex_date,
        latestAmt: ca.amount,
      };
      prev.totalDps += ca.amount;
      prev.count += 1;
      ttmDpsBySymbol.set(ca.symbol, prev);
    }

    // Format monthly history sorted chronologically
    const monthsSorted = [...monthlyMap.keys()].sort();
    const monthlyHistory: MonthlyDividend[] = monthsSorted.map((m) => {
      const [year, month] = m.split("-");
      const d = new Date(Number(year), Number(month) - 1, 1);
      const label = d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
      const stat = monthlyMap.get(m)!;
      return {
        month: m,
        label,
        payout: Math.round(stat.payout * 100) / 100,
        eventCount: stat.count,
      };
    });

    // 3. Assemble per-holding summaries
    let totalInvested = 0;
    let totalCurrentValue = 0;
    let totalAnnualPayout = 0;
    let dividendPayingCount = 0;

    const holdings: HoldingDividend[] = holdingsRows.map((r) => {
      const invested = r.qty * (r.avg_cost ?? 0);
      const curVal = r.cur_val;
      totalInvested += invested;
      totalCurrentValue += curVal;

      const ttm = ttmDpsBySymbol.get(r.symbol);
      const metricYield = r.div_yield ? parseFloat(r.div_yield) * 100 : null;

      let ttmDps = ttm ? ttm.totalDps : 0;
      let annualPayout = 0;

      if (ttmDps > 0) {
        annualPayout = r.qty * ttmDps;
      } else if (metricYield != null && metricYield > 0 && curVal > 0) {
        annualPayout = curVal * (metricYield / 100);
        if (r.ltp && r.ltp > 0) {
          ttmDps = r.ltp * (metricYield / 100);
        }
      }

      if (annualPayout > 0) {
        dividendPayingCount++;
        totalAnnualPayout += annualPayout;
      }

      const divYield = curVal > 0 && annualPayout > 0
        ? (annualPayout / curVal) * 100
        : metricYield;

      const yieldOnCost = invested > 0 && annualPayout > 0
        ? (annualPayout / invested) * 100
        : null;

      return {
        symbol: r.symbol,
        companyName: r.company_name,
        sector: r.sector,
        quantity: Math.round(r.qty),
        avgCost: r.avg_cost,
        invested,
        currentPrice: r.ltp,
        currentValue: curVal,
        divYield: divYield ? Math.round(divYield * 100) / 100 : null,
        yieldOnCost: yieldOnCost ? Math.round(yieldOnCost * 100) / 100 : null,
        ttmDps: Math.round(ttmDps * 100) / 100,
        annualPayout: Math.round(annualPayout),
        paymentCount: ttm ? ttm.count : (annualPayout > 0 ? 1 : 0),
        latestExDate: ttm?.latestDate ?? null,
        latestAmount: ttm?.latestAmt ?? null,
        upcomingEvent: upcomingBySymbol.get(r.symbol) ?? null,
      };
    });

    // Sort holdings by annual payout descending
    holdings.sort((a, b) => b.annualPayout - a.annualPayout);

    const upcomingPayout = upcomingEvents.reduce((acc, e) => acc + e.payout, 0);

    const portfolioYield = totalCurrentValue > 0
      ? (totalAnnualPayout / totalCurrentValue) * 100
      : 0;

    const portfolioYieldOnCost = totalInvested > 0
      ? (totalAnnualPayout / totalInvested) * 100
      : 0;

    return {
      hasHoldings: true,
      totalHoldings: holdings.length,
      dividendPayingCount,
      totalAnnualPayout: Math.round(totalAnnualPayout),
      totalInvested: Math.round(totalInvested),
      totalCurrentValue: Math.round(totalCurrentValue),
      portfolioYield: Math.round(portfolioYield * 100) / 100,
      portfolioYieldOnCost: Math.round(portfolioYieldOnCost * 100) / 100,
      upcomingPayout: Math.round(upcomingPayout),
      upcomingCount: upcomingEvents.length,
      monthlyHistory,
      recentEvents: recentEvents.slice(0, 50),
      upcomingEvents,
      holdings,
    };
  } catch (err) {
    console.error("Error loading portfolio dividends:", err);
    return empty;
  }
}
