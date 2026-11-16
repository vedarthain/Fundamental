import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ClusterVerdictRow = {
  symbol: string;
  company_name: string | null;
  market_cap_cr: number;
  ltp: number;
  buy_below: number | null;
  target_price: number | null;
  bear_floor: number | null;
  upside_pct: number | null;
  composite_pct: number;
  quality_pct: number;
  valuation_pct: number;
  momentum_pct: number;
  q_end: string | null;
  q_sales: number | null;
  q_pat: number | null;
  verdict: string | null;
  business_summary: string | null;
  moat_strength: string | null;
  moat_type: string | null;
  moat_points: string[];
  in_portfolio: boolean;
  action_group: "actionable" | "watch" | "hold_avoid";
  action_label: string;
  why: string;
};

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }

  const clusterId = req.nextUrl.searchParams.get("clusterId");
  if (!clusterId) {
    return NextResponse.json({ error: "clusterId required" }, { status: 400 });
  }

  const [rows, moatRows] = await Promise.all([
    sql<any[]>`
      WITH latest_verdict AS (
        SELECT DISTINCT ON (symbol)
          symbol, verdict, target_price, buy_below, bear_floor, upside_pct
        FROM app.stock_verdict
        ORDER BY symbol, generated_at DESC
      ),
      latest_panel AS (
        SELECT DISTINCT ON (symbol)
          symbol, company_name, cluster_id, market_cap_cr, current_price,
          composite_pct, quality_pct, valuation_pct, momentum_pct
        FROM app.cluster_stocks_panel_cache
        ORDER BY symbol, snapshot_date DESC
      ),
      latest_q AS (
        SELECT DISTINCT ON (symbol)
          symbol, period_end::text AS q_end, sales::float AS q_sales, net_profit::float AS q_pat
        FROM app.fundamentals_quarterly
        ORDER BY symbol, period_end DESC
      )
      SELECT
        p.symbol,
        p.company_name,
        COALESCE(p.market_cap_cr, 0)::float AS market_cap_cr,
        COALESCE(sm.current_price, p.current_price, 0)::float AS ltp,
        v.buy_below::float,
        v.target_price::float,
        v.bear_floor::float,
        CASE
          WHEN v.target_price > 0 AND COALESCE(sm.current_price, p.current_price) > 0
            THEN ROUND(((v.target_price - COALESCE(sm.current_price, p.current_price)) / COALESCE(sm.current_price, p.current_price) * 100)::numeric, 1)::float
          ELSE v.upside_pct::float
        END AS upside_pct,
        COALESCE(p.composite_pct, 0)::float AS composite_pct,
        COALESCE(p.quality_pct, 0)::float AS quality_pct,
        COALESCE(p.valuation_pct, 0)::float AS valuation_pct,
        COALESCE(p.momentum_pct, 0)::float AS momentum_pct,
        q.q_end,
        q.q_sales,
        q.q_pat,
        v.verdict,
        u.business_summary,
        EXISTS(SELECT 1 FROM app.portfolio_holding h WHERE h.symbol = p.symbol AND h.quantity > 0) AS in_portfolio
      FROM latest_panel p
      LEFT JOIN latest_verdict v ON v.symbol = p.symbol
      LEFT JOIN app.screener_meta sm ON sm.symbol = p.symbol
      LEFT JOIN app.universe u ON u.symbol = p.symbol
      LEFT JOIN latest_q q ON q.symbol = p.symbol
      WHERE p.cluster_id = ${clusterId}
      ORDER BY p.composite_pct DESC NULLS LAST, upside_pct DESC NULLS LAST
    `,
    sql<{ symbol: string; moat_strength: string | null; moat_type: string | null; moat_points: unknown }[]>`
      SELECT symbol, moat_strength, moat_type, moat_points
      FROM app.company_moat
    `.catch(() => [] as { symbol: string; moat_strength: string | null; moat_type: string | null; moat_points: unknown }[]),
  ]);
  const moatMap = new Map(moatRows.map((m) => [m.symbol, m]));

  const items: ClusterVerdictRow[] = rows.map((r) => {
    const ltp = Number(r.ltp ?? 0);
    const bb = r.buy_below != null ? Number(r.buy_below) : null;
    const tgt = r.target_price != null ? Number(r.target_price) : null;
    const up = r.upside_pct != null ? Number(r.upside_pct) : null;
    const verd = (r.verdict as string | null) ?? "";
    const vLower = verd.toLowerCase();
    const shortVerdict = verd.replace(/^[^—]+—\s*/, "").trim();
    const inZone = bb != null && ltp > 0 && ltp <= bb * 1.02;

    let action_group: "actionable" | "watch" | "hold_avoid" = "watch";
    let action_label = "WATCH";
    let why = shortVerdict || "Monitor fundamentals and price entry.";

    if (vLower.startsWith("avoid")) {
      action_group = "hold_avoid";
      action_label = "AVOID";
      why = shortVerdict || "Weak fundamentals or high risk flags.";
    } else if (vLower.startsWith("hold")) {
      action_group = "hold_avoid";
      action_label = "HOLD";
      why = shortVerdict || "Quality business, limited upside at current price.";
    } else if (vLower.startsWith("buy") || vLower.startsWith("accumulate")) {
      if (inZone || (up != null && up >= 15)) {
        action_group = "actionable";
        action_label = inZone ? "ACCUMULATE (IN ZONE)" : "ACCUMULATE";
      } else {
        action_group = "watch";
        action_label = "WATCH (WAIT DIP)";
      }
      why = shortVerdict || "Strong fundamentals and attractive valuation.";
    } else if (inZone && up != null && up >= 15 && Number(r.composite_pct) >= 60 && Number(r.quality_pct) >= 50) {
      action_group = "actionable";
      action_label = "WATCH (IN ZONE)";
      why = shortVerdict
        ? `Trading inside buy zone (≤ ₹${bb?.toFixed(1)}). ${shortVerdict}`
        : `Trading inside buy zone (≤ ₹${bb?.toFixed(1)}).`;
    } else {
      action_group = "watch";
      action_label = inZone ? "WATCH (IN ZONE)" : "WATCH";
      if (bb != null && ltp > bb * 1.02) {
        const dist = ((ltp - bb) / bb) * 100;
        why = `+${dist.toFixed(1)}% above Buy Below ₹${bb.toFixed(1)}${shortVerdict ? ` — ${shortVerdict}` : ""}`;
      } else if (up != null && up < 10 && tgt != null) {
        why = `Limited upside (${up.toFixed(1)}% to ₹${tgt.toFixed(1)})${shortVerdict ? ` — ${shortVerdict}` : ""}`;
      }
    }

    return {
      symbol: r.symbol,
      company_name: r.company_name,
      market_cap_cr: Number(r.market_cap_cr ?? 0),
      ltp,
      buy_below: bb,
      target_price: tgt,
      bear_floor: r.bear_floor != null ? Number(r.bear_floor) : null,
      upside_pct: up,
      composite_pct: Number(r.composite_pct ?? 0),
      quality_pct: Number(r.quality_pct ?? 0),
      valuation_pct: Number(r.valuation_pct ?? 0),
      momentum_pct: Number(r.momentum_pct ?? 0),
      q_end: r.q_end,
      q_sales: r.q_sales != null ? Number(r.q_sales) : null,
      q_pat: r.q_pat != null ? Number(r.q_pat) : null,
      verdict: r.verdict,
      business_summary: r.business_summary,
      moat_strength: moatMap.get(r.symbol)?.moat_strength ?? null,
      moat_type: moatMap.get(r.symbol)?.moat_type ?? null,
      moat_points: Array.isArray(moatMap.get(r.symbol)?.moat_points) ? (moatMap.get(r.symbol)!.moat_points as string[]) : [],
      in_portfolio: Boolean(r.in_portfolio),
      action_group,
      action_label,
      why,
    };
  });

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
