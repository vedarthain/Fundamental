import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type IdeaHorizon = "1M" | "3M" | "6M" | "1Y" | ">1Y" | "EXIT";

export type ClusterGem = {
  symbol: string;
  company_name: string | null;
  cluster_id: string | null;
  cluster_name: string | null;
  market_cap_cr: number | null;
  ltp: number | null;
  anchor_price: number | null;
  pct_move: number | null;
  verdict: string | null;
  confidence: "high" | "medium" | "low" | null;
  target_price: number | null;
  fair_value: number | null;
  buy_below: number | null;
  bear_floor: number | null;
  upside_pct: number | null;
  valuation_method: string | null;
  generated_at: string | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  is_portfolio: boolean;
  is_gem: boolean;
  sell_timeline: string;
  horizon: IdeaHorizon;
  horizon_label: string;
  strategy_desc: string;
  is_taken: boolean;
  is_cleared: boolean;
};

export type PortfolioActionCall = {
  symbol: string;
  company_name: string | null;
  cluster_name: string | null;
  total_qty: number;
  weighted_avg_cost: number;
  ltp: number;
  anchor_price: number | null;
  pct_move: number | null;
  invested_val: number;
  cur_val: number;
  pnl: number;
  pnl_pct: number;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  verdict: string | null;
  target_price: number | null;
  buy_below: number | null;
  bear_floor: number | null;
  upside_pct: number | null;
  valuation_method: string | null;
  generated_at: string | null;
  action_today: "TRIM / TAKE PROFIT" | "HOLD & COMPOUND" | "ACCUMULATE / ADD" | "EXIT / CUT LOSS";
  action_reason: string;
  sell_timeline: string;
  horizon: IdeaHorizon;
  horizon_label: string;
  strategy_desc: string;
  is_taken: boolean;
  is_cleared: boolean;
};

function determineIdeaHorizon(args: {
  actionToday?: string;
  upsidePct?: number | null;
  momentumPct?: number | null;
  qualityPct?: number | null;
  compositePct?: number | null;
  marketCapCr?: number | null;
}): { horizon: IdeaHorizon; label: string; timeline: string; strategy: string } {
  const { actionToday, upsidePct, momentumPct, qualityPct, compositePct, marketCapCr } = args;
  const upside = upsidePct ?? 0;
  const mom = momentumPct ?? 50;
  const qual = qualityPct ?? 50;
  const comp = compositePct ?? 50;
  const mcap = marketCapCr ?? 1000;

  if (actionToday === "EXIT / CUT LOSS" || (qual < 45 && mom < 40)) {
    return {
      horizon: "EXIT",
      label: "🛑 Exit / Cut Loss",
      timeline: "Immediate",
      strategy: "Risk Mitigation — thesis breakdown, stop-loss breached or deterioration.",
    };
  }

  if (actionToday === "TRIM / TAKE PROFIT" || upside <= 0) {
    return {
      horizon: "EXIT",
      label: "💰 Harvest / Trim",
      timeline: "1–2 Weeks",
      strategy: "Profit Harvesting — target reached, lock in gains.",
    };
  }

  // 1M: Tactical swing / momentum breakout
  if (mom >= 72 && upside <= 22) {
    return {
      horizon: "1M",
      label: "⚡ 1M Tactical",
      timeline: "2–4 Weeks (Tactical Swing)",
      strategy: "Momentum breakout & quick alpha with tight risk guard.",
    };
  }

  // 3M: Quarterly catalyst / earnings inflection
  if (mom >= 58 || (upside <= 32 && comp >= 68)) {
    return {
      horizon: "3M",
      label: "🚀 3M Catalyst",
      timeline: "2–3 Months (Quarterly)",
      strategy: "Quarterly earnings beat & sector rotation catalyst.",
    };
  }

  // 6M: Medium-term turnaround & growth
  if (upside <= 45 || qual < 65) {
    return {
      horizon: "6M",
      label: "📈 6M Turnaround",
      timeline: "5–6 Months (Medium Growth)",
      strategy: "Operating margin expansion, capacity ramp-up or turnaround.",
    };
  }

  // >1Y: Secular monopoly / multi-year compounding machine
  if (qual >= 75 && (upside >= 50 || mcap >= 25000)) {
    return {
      horizon: ">1Y",
      label: "💎 >1Y Compounder",
      timeline: "1–3 Years (Multi-Year)",
      strategy: "High-ROCE secular monopoly compounder (buy & hold).",
    };
  }

  // 1Y: Core institutional cycle
  return {
    horizon: "1Y",
    label: "🏛️ 1Y Core",
    timeline: "9–12 Months (Full Cycle)",
    strategy: "Full-cycle multi-factor valuation re-rating to fair value.",
  };
}

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }

  try {
    // 1. Fetch Cluster Calls / Screened Candidates with anchor_price and generated_at
    const rawGems = await sql<any[]>`
      WITH latest_verdict AS (
          SELECT DISTINCT ON (symbol)
              symbol, verdict, confidence, target_price, fair_value, buy_below, bear_floor, upside_pct, valuation_method, generated_at, anchor_price
          FROM app.stock_verdict
          ORDER BY symbol, generated_at DESC
      ),
      latest_panel AS (
          SELECT DISTINCT ON (symbol)
              symbol, company_name, cluster_id, market_cap_cr, current_price, composite_pct, quality_pct, valuation_pct, momentum_pct
          FROM app.cluster_stocks_panel_cache
          ORDER BY symbol, snapshot_date DESC
      ),
      intraday_price AS (
          SELECT DISTINCT ON (symbol) symbol, ltp
          FROM app.stock_intraday
          ORDER BY symbol, ts DESC
      ),
      user_calls AS (
          SELECT symbol,
                 bool_or(cleared_at IS NULL) AS has_active_call,
                 bool_or(cleared_at IS NOT NULL) AS has_cleared_call
          FROM app.stock_call
          GROUP BY symbol
      )
      SELECT 
          p.symbol,
          p.company_name,
          p.cluster_id,
          c.name AS cluster_name,
          p.market_cap_cr,
          COALESCE(si.ltp, p.current_price) AS ltp,
          v.anchor_price,
          v.verdict,
          v.confidence,
          v.target_price,
          v.fair_value,
          v.buy_below,
          v.bear_floor,
          v.upside_pct,
          v.valuation_method,
          v.generated_at,
          p.composite_pct,
          p.quality_pct,
          p.valuation_pct,
          p.momentum_pct,
          EXISTS(SELECT 1 FROM app.portfolio_holding ph WHERE ph.symbol = p.symbol AND ph.quantity > 0) AS is_portfolio,
          COALESCE(uc.has_active_call, false) AS is_call_active,
          COALESCE(uc.has_cleared_call, false) AS is_call_cleared
      FROM latest_panel p
      JOIN latest_verdict v ON v.symbol = p.symbol
      LEFT JOIN app.cluster c ON c.id = p.cluster_id
      LEFT JOIN intraday_price si ON si.symbol = p.symbol
      LEFT JOIN user_calls uc ON uc.symbol = p.symbol
      WHERE v.target_price IS NOT NULL AND v.buy_below IS NOT NULL
        AND p.composite_pct >= 60
        AND p.quality_pct >= 50
      ORDER BY v.generated_at DESC, p.composite_pct DESC
      LIMIT 250
    `;

    const clusterGems: ClusterGem[] = rawGems.map((r) => {
      const ltp = Number(r.ltp ?? 0);
      const buyBelow = Number(r.buy_below ?? 0);
      const upside = Number(r.upside_pct ?? 0);
      const comp = Number(r.composite_pct ?? 0);
      const qual = Number(r.quality_pct ?? 0);
      const mom = Number(r.momentum_pct ?? 50);
      const mcap = Number(r.market_cap_cr ?? 0);
      const anchor = r.anchor_price ? Number(r.anchor_price) : null;
      const pctMove = anchor && anchor > 0 ? ((ltp - anchor) / anchor) * 100 : null;

      const isGem = comp >= 75 && qual >= 58 && (buyBelow > 0 && ltp <= buyBelow * 1.05) && upside >= 15 && mcap >= 800;

      const isPortfolio = Boolean(r.is_portfolio);
      const isCallActive = Boolean(r.is_call_active);
      const isCallCleared = Boolean(r.is_call_cleared);

      const isTaken = isPortfolio || isCallActive;
      const isCleared = !isTaken && isCallCleared;

      const horizonInfo = determineIdeaHorizon({
        upsidePct: upside,
        momentumPct: mom,
        qualityPct: qual,
        compositePct: comp,
        marketCapCr: mcap,
      });

      return {
        symbol: r.symbol,
        company_name: r.company_name,
        cluster_id: r.cluster_id,
        cluster_name: r.cluster_name ?? "General",
        market_cap_cr: mcap,
        ltp,
        anchor_price: anchor,
        pct_move: pctMove,
        verdict: r.verdict,
        confidence: r.confidence,
        target_price: r.target_price ? Number(r.target_price) : null,
        fair_value: r.fair_value ? Number(r.fair_value) : null,
        buy_below: r.buy_below ? Number(r.buy_below) : null,
        bear_floor: r.bear_floor ? Number(r.bear_floor) : null,
        upside_pct: r.upside_pct ? Number(r.upside_pct) : null,
        valuation_method: r.valuation_method,
        generated_at: r.generated_at ? new Date(r.generated_at).toISOString() : null,
        composite_pct: comp,
        quality_pct: qual,
        valuation_pct: r.valuation_pct ? Number(r.valuation_pct) : null,
        momentum_pct: mom,
        is_portfolio: isPortfolio,
        is_gem: isGem,
        sell_timeline: horizonInfo.timeline,
        horizon: horizonInfo.horizon,
        horizon_label: horizonInfo.label,
        strategy_desc: horizonInfo.strategy,
        is_taken: isTaken,
        is_cleared: isCleared,
      };
    });

    // 2. Fetch Portfolio Holdings with Action Sweeps
    const rawPortfolio = await sql<any[]>`
      WITH latest_verdict AS (
          SELECT DISTINCT ON (symbol)
              symbol, verdict, confidence, target_price, fair_value, buy_below, bear_floor, upside_pct, valuation_method, generated_at, anchor_price
          FROM app.stock_verdict
          ORDER BY symbol, generated_at DESC
      ),
      latest_panel AS (
          SELECT DISTINCT ON (symbol)
              symbol, current_price, composite_pct, quality_pct, valuation_pct, momentum_pct
          FROM app.cluster_stocks_panel_cache
          ORDER BY symbol, snapshot_date DESC
      ),
      intraday_price AS (
          SELECT DISTINCT ON (symbol) symbol, ltp
          FROM app.stock_intraday
          ORDER BY symbol, ts DESC
      )
      SELECT 
          p.symbol,
          SUM(p.quantity) AS total_qty,
          SUM(p.quantity * p.avg_cost) / NULLIF(SUM(p.quantity), 0) AS weighted_avg_cost,
          COALESCE(MAX(si.ltp), MAX(lp.current_price), MAX(p.broker_ltp)) AS ltp,
          SUM(p.broker_cur_value) AS cur_val,
          SUM(p.quantity * p.avg_cost) AS invested_val,
          SUM(p.broker_cur_value) - SUM(p.quantity * p.avg_cost) AS pnl,
          CASE WHEN SUM(p.quantity * p.avg_cost) > 0 
               THEN ((SUM(p.broker_cur_value) - SUM(p.quantity * p.avg_cost)) / SUM(p.quantity * p.avg_cost)) * 100 
               ELSE NULL END AS pnl_pct,
          u.company_name,
          c.name AS cluster_name,
          lp.composite_pct,
          lp.quality_pct,
          lp.valuation_pct,
          lp.momentum_pct,
          v.verdict,
          v.confidence,
          v.target_price,
          v.fair_value,
          v.buy_below,
          v.bear_floor,
          v.upside_pct,
          v.valuation_method,
          v.generated_at,
          v.anchor_price
      FROM app.portfolio_holding p
      LEFT JOIN app.universe u ON u.symbol = p.symbol
      LEFT JOIN app.cluster_assignment ca ON ca.symbol = p.symbol
      LEFT JOIN app.cluster c ON c.id = ca.cluster_id
      LEFT JOIN latest_panel lp ON lp.symbol = p.symbol
      LEFT JOIN intraday_price si ON si.symbol = p.symbol
      LEFT JOIN latest_verdict v ON v.symbol = p.symbol
      WHERE p.quantity > 0
      GROUP BY p.symbol, u.company_name, c.name, lp.composite_pct, lp.quality_pct, lp.valuation_pct, lp.momentum_pct,
               v.verdict, v.confidence, v.target_price, v.fair_value, v.buy_below, v.bear_floor, v.upside_pct, v.valuation_method, v.generated_at, v.anchor_price
      ORDER BY v.generated_at DESC NULLS LAST
    `;

    const portfolioActions: PortfolioActionCall[] = rawPortfolio.map((r) => {
      const ltp = Number(r.ltp ?? 0);
      const avgCost = Number(r.weighted_avg_cost ?? 0);
      const target = r.target_price ? Number(r.target_price) : null;
      const buyBelow = r.buy_below ? Number(r.buy_below) : null;
      const bearFloor = r.bear_floor ? Number(r.bear_floor) : null;
      const upside = r.upside_pct ? Number(r.upside_pct) : 0;
      const pnlPct = r.pnl_pct ? Number(r.pnl_pct) : 0;
      const qual = r.quality_pct ? Number(r.quality_pct) : 50;
      const mom = r.momentum_pct ? Number(r.momentum_pct) : 50;
      const comp = r.composite_pct ? Number(r.composite_pct) : 50;
      const anchor = r.anchor_price ? Number(r.anchor_price) : null;
      const pctMove = anchor && anchor > 0 ? ((ltp - anchor) / anchor) * 100 : null;

      let actionToday: "TRIM / TAKE PROFIT" | "HOLD & COMPOUND" | "ACCUMULATE / ADD" | "EXIT / CUT LOSS" = "HOLD & COMPOUND";
      let reason = "Core business compounding intact toward 12M forward target.";
      let timeline = "9–12 Months";

      // Precise institutional rules
      if (target && ltp >= target) {
        actionToday = "TRIM / TAKE PROFIT";
        reason = `LTP (₹${ltp.toFixed(1)}) has exceeded 12M Target (₹${target.toFixed(1)}). Take profit on strength.`;
        timeline = "Immediate (1–2 Wks)";
      } else if (upside <= -15) {
        actionToday = "TRIM / TAKE PROFIT";
        reason = `Negative upside (${upside.toFixed(1)}%) to fundamental target. Multiple expansion stretched.`;
        timeline = "Immediate (1–2 Wks)";
      } else if (bearFloor && ltp <= bearFloor && qual < 50) {
        actionToday = "EXIT / CUT LOSS";
        reason = `Trading below Bear Floor (₹${bearFloor.toFixed(1)}) with weak quality (${qual}). Cut loss.`;
        timeline = "Immediate";
      } else if (qual < 45 && mom < 35) {
        actionToday = "EXIT / CUT LOSS";
        reason = "Dual deterioration in fundamental quality and technical momentum.";
        timeline = "Immediate";
      } else if (buyBelow && ltp <= buyBelow * 1.02 && comp >= 75 && qual >= 58) {
        actionToday = "ACCUMULATE / ADD";
        reason = `Trading inside institutional accumulate zone (≤ ₹${buyBelow.toFixed(1)}) with strong composite (${comp}).`;
        timeline = "6–12 Months";
      } else if (upside >= 25 && qual >= 55) {
        actionToday = "HOLD & COMPOUND";
        reason = `Strong forward upside (+${upside.toFixed(1)}%) supported by solid balance sheet.`;
        timeline = "9–12 Months";
      }

      const horizonInfo = determineIdeaHorizon({
        actionToday,
        upsidePct: upside,
        momentumPct: mom,
        qualityPct: qual,
        compositePct: comp,
      });

      return {
        symbol: r.symbol,
        company_name: r.company_name,
        cluster_name: r.cluster_name ?? "General",
        total_qty: Number(r.total_qty ?? 0),
        weighted_avg_cost: avgCost,
        ltp,
        anchor_price: anchor,
        pct_move: pctMove,
        invested_val: Number(r.invested_val ?? 0),
        cur_val: Number(r.cur_val ?? 0),
        pnl: Number(r.pnl ?? 0),
        pnl_pct: pnlPct,
        composite_pct: comp,
        quality_pct: qual,
        valuation_pct: r.valuation_pct ? Number(r.valuation_pct) : null,
        momentum_pct: mom,
        verdict: r.verdict,
        target_price: target,
        buy_below: buyBelow,
        bear_floor: bearFloor,
        upside_pct: r.upside_pct ? Number(r.upside_pct) : null,
        valuation_method: r.valuation_method,
        generated_at: r.generated_at ? new Date(r.generated_at).toISOString() : null,
        action_today: actionToday,
        action_reason: reason,
        sell_timeline: horizonInfo.timeline,
        horizon: horizonInfo.horizon,
        horizon_label: horizonInfo.label,
        strategy_desc: horizonInfo.strategy,
        is_taken: true,
        is_cleared: false,
      };
    });

    const summary = {
      totalGems: clusterGems.filter((g) => g.is_gem).length,
      totalClusterCalls: clusterGems.length,
      portfolioTotalCount: portfolioActions.length,
      portfolioTrimCount: portfolioActions.filter((p) => p.action_today === "TRIM / TAKE PROFIT").length,
      portfolioHoldCount: portfolioActions.filter((p) => p.action_today === "HOLD & COMPOUND").length,
      portfolioAccumulateCount: portfolioActions.filter((p) => p.action_today === "ACCUMULATE / ADD").length,
      portfolioExitCount: portfolioActions.filter((p) => p.action_today === "EXIT / CUT LOSS").length,
      totalInvestedCr: portfolioActions.reduce((acc, p) => acc + p.invested_val, 0) / 1e7,
      totalCurrentCr: portfolioActions.reduce((acc, p) => acc + p.cur_val, 0) / 1e7,
      horizonCounts: {
        "1M": clusterGems.filter((g) => g.horizon === "1M").length,
        "3M": clusterGems.filter((g) => g.horizon === "3M").length,
        "6M": clusterGems.filter((g) => g.horizon === "6M").length,
        "1Y": clusterGems.filter((g) => g.horizon === "1Y").length,
        ">1Y": clusterGems.filter((g) => g.horizon === ">1Y").length,
        "EXIT": clusterGems.filter((g) => g.horizon === "EXIT").length,
      },
      statusCounts: {
        takenCount: clusterGems.filter((g) => g.is_taken).length,
        clearedCount: clusterGems.filter((g) => g.is_cleared).length,
        freshCount: clusterGems.filter((g) => !g.is_taken && !g.is_cleared).length,
      },
    };

    return NextResponse.json({
      summary,
      clusterGems,
      portfolioActions,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
